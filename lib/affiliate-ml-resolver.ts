import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureUserTable, getDb } from "lib/db";

const TABLE_NAME = "affiliate_ml_cookie_resolvers";
const PROVIDER_KEY = "mercadolivre";
const LINK_BUILDER_URL = "https://www.mercadolivre.com.br/afiliados/linkbuilder";
const CREATE_LINK_URL =
  "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_URLS_PER_BATCH = 500;
const FALLBACK_CHUNK_SIZE = 50;

type ResolverRow = RowDataPacket & {
  id: number;
  user_id: number;
  provider: string;
  cookie_text: string | null;
  csrf_token: string | null;
  affiliate_tag: string | null;
  is_enabled: number | null;
  is_valid: number | null;
  last_error: string | null;
  last_validated_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type AdminResolverUserRow = RowDataPacket & {
  user_id: number;
};

export type AffiliateMlResolverSummary = {
  provider: "mercadolivre";
  hasCookie: boolean;
  cookieHint: string | null;
  hasCsrfToken: boolean;
  tag: string | null;
  enabled: boolean;
  isValid: boolean | null;
  lastError: string | null;
  lastValidatedAt: string | null;
  updatedAt: string | null;
};

export type AffiliateMlResolverValidationResult = {
  ok: boolean;
  mode: "session" | "create_link";
  message: string;
  sampleShortUrl: string | null;
  checkedAt: string;
  resolvedTag: string | null;
  resolvedCsrfToken: string | null;
};

type AffiliateMlResolverSecrets = AffiliateMlResolverSummary & {
  cookie: string | null;
  csrfToken: string | null;
};

export type AffiliateMlGeneratedLink = {
  id: string | null;
  shortUrl: string;
  longUrl: string | null;
  originUrl: string | null;
  regex: string | null;
  text: string | null;
  tag: string | null;
  created: boolean | null;
};

type CreateLinkResult = {
  links: AffiliateMlGeneratedLink[];
  totalSuccess: number;
  totalError: number;
  rejectedMessages: string[];
  rejectedCodes: Record<string, number>;
};

const ensureTasks = new Map<string, Promise<void>>();
const ensureDone = new Set<string>();

const runEnsure = (key: string, ensureFn: () => Promise<void>): Promise<void> => {
  if (ensureDone.has(key)) return Promise.resolve();
  const active = ensureTasks.get(key);
  if (active) return active;
  const task = ensureFn()
    .then(() => {
      ensureDone.add(key);
      ensureTasks.delete(key);
    })
    .catch((error) => {
      ensureTasks.delete(key);
      throw error;
    });
  ensureTasks.set(key, task);
  return task;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeCookieHeader = (value: string | null | undefined): string | null => {
  const raw = asString(value);
  if (!raw) return null;
  const withoutPrefix = raw.replace(/^cookie\s*:\s*/i, "").replace(/\r?\n+/g, " ");
  const normalized = withoutPrefix
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("; ");
  if (!normalized || !normalized.includes("=")) return null;
  return normalized;
};

const parseCookieMap = (cookieHeader: string): Map<string, string> => {
  const map = new Map<string, string>();
  cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) return;
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!key) return;
      map.set(key, value);
    });
  return map;
};

const normalizeTag = (value: string | null | undefined): string | null => {
  const raw = asString(value);
  if (!raw) return null;
  return raw.slice(0, 190);
};

const normalizeCsrfToken = (value: string | null | undefined): string | null => {
  const raw = asString(value);
  if (!raw) return null;
  return raw.slice(0, 250);
};

const normalizeUrl = (value: string | null | undefined): string | null => {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const buildCookieHint = (cookieHeader: string | null): string | null => {
  if (!cookieHeader) return null;
  const names = Array.from(parseCookieMap(cookieHeader).keys());
  if (names.length === 0) return null;
  const preview = names.slice(0, 6).join(", ");
  return names.length > 6 ? `${preview} (+${names.length - 6})` : preview;
};

const fetchWithTimeout = async (input: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const isRecoverableCreateLinkError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || "");
  return /bad request|status 400|http 400|url inv[aá]lida|invalid url/i.test(message);
};

const ensureResolverTable = async () =>
  runEnsure("affiliate-ml-cookie-resolver-table", async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'mercadolivre',
        cookie_text LONGTEXT NULL,
        csrf_token VARCHAR(255) NULL,
        affiliate_tag VARCHAR(191) NULL,
        is_enabled TINYINT(1) NOT NULL DEFAULT 0,
        is_valid TINYINT(1) NULL,
        last_error TEXT NULL,
        last_validated_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_affiliate_ml_cookie_user_provider (user_id, provider),
        CONSTRAINT fk_affiliate_ml_cookie_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    const [enabledColumnRows] = await db.query<RowDataPacket[]>(
      `SHOW COLUMNS FROM ${TABLE_NAME} LIKE 'is_enabled'`,
    );
    if (!Array.isArray(enabledColumnRows) || enabledColumnRows.length === 0) {
      await db.query(
        `ALTER TABLE ${TABLE_NAME} ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER affiliate_tag`,
      );
    }
  });

const toSummary = (row: ResolverRow | null): AffiliateMlResolverSummary => ({
  provider: "mercadolivre",
  hasCookie: Boolean(asString(row?.cookie_text)),
  cookieHint: buildCookieHint(asString(row?.cookie_text)),
  hasCsrfToken: Boolean(asString(row?.csrf_token)),
  tag: asString(row?.affiliate_tag),
  enabled: row?.is_enabled === 1,
  isValid: row?.is_valid === null || typeof row?.is_valid === "undefined" ? null : row?.is_valid === 1,
  lastError: asString(row?.last_error),
  lastValidatedAt: toIso(row?.last_validated_at),
  updatedAt: toIso(row?.updated_at),
});

const toSecrets = (row: ResolverRow | null): AffiliateMlResolverSecrets => ({
  ...toSummary(row),
  cookie: asString(row?.cookie_text),
  csrfToken: asString(row?.csrf_token),
});

const fetchResolverRow = async (userId: number): Promise<ResolverRow | null> => {
  await ensureResolverTable();
  const db = getDb();
  const [rows] = await db.query<ResolverRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
};

const listAdminResolverUserIds = async (): Promise<number[]> => {
  await ensureResolverTable();
  await ensureUserTable();
  const db = getDb();
  const [rows] = await db.query<AdminResolverUserRow[]>(
    `
      SELECT resolver.user_id
      FROM ${TABLE_NAME} resolver
      INNER JOIN users user_row ON user_row.id = resolver.user_id
      WHERE resolver.provider = ?
        AND resolver.is_enabled = 1
        AND (resolver.is_valid = 1 OR resolver.is_valid IS NULL)
        AND user_row.role = 'admin'
      ORDER BY resolver.user_id ASC
    `,
    [PROVIDER_KEY],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  return rows
    .map((row) => Number(row.user_id))
    .filter((value) => Number.isFinite(value) && value > 0);
};

const upsertResolverRow = async (
  userId: number,
  payload: {
    cookie: string | null;
    csrfToken: string | null;
    tag: string | null;
    enabled: boolean;
    isValid: boolean | null;
    lastError: string | null;
    lastValidatedAt: string | null;
  },
): Promise<void> => {
  await ensureResolverTable();
  const db = getDb();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_NAME} (
        user_id, provider, cookie_text, csrf_token, affiliate_tag, is_enabled, is_valid, last_error, last_validated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        cookie_text = VALUES(cookie_text),
        csrf_token = VALUES(csrf_token),
        affiliate_tag = VALUES(affiliate_tag),
        is_enabled = VALUES(is_enabled),
        is_valid = VALUES(is_valid),
        last_error = VALUES(last_error),
        last_validated_at = VALUES(last_validated_at),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      PROVIDER_KEY,
      payload.cookie,
      payload.csrfToken,
      payload.tag,
      payload.enabled ? 1 : 0,
      payload.isValid === null ? null : payload.isValid ? 1 : 0,
      payload.lastError,
      payload.lastValidatedAt ? new Date(payload.lastValidatedAt) : null,
    ],
  );
};

const updateResolverValidationStatus = async (
  userId: number,
  payload: { isValid: boolean; message: string | null; checkedAt: string; enabled?: boolean },
): Promise<void> => {
  await ensureResolverTable();
  const db = getDb();
  const updateEnabled = typeof payload.enabled === "boolean";
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET is_valid = ?, last_error = ?, last_validated_at = ?, updated_at = CURRENT_TIMESTAMP
      ${updateEnabled ? ", is_enabled = ?" : ""}
      WHERE user_id = ? AND provider = ?
    `,
    updateEnabled
      ? [
          payload.isValid ? 1 : 0,
          payload.message,
          new Date(payload.checkedAt),
          payload.enabled ? 1 : 0,
          userId,
          PROVIDER_KEY,
        ]
      : [payload.isValid ? 1 : 0, payload.message, new Date(payload.checkedAt), userId, PROVIDER_KEY],
  );
};

const extractByPatterns = (value: string | null, patterns: RegExp[]): string | null => {
  if (!value) return null;
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    const extracted = asString(match?.[1] ?? null);
    if (extracted) return extracted;
  }
  return null;
};

const extractFromLinkBuilderHtml = (
  html: string | null,
): { csrfToken: string | null; tag: string | null } => {
  const rawCsrf =
    extractByPatterns(html, [
      /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
      /["']csrfToken["']\s*:\s*["']([^"']+)["']/i,
      /["']x-csrf-token["']\s*[:=]\s*["']([^"']+)["']/i,
      /[?&]_csrf=([^"&\s]+)/i,
    ]) || null;
  const rawTag =
    extractByPatterns(html, [
      /["']orgnickp["']\s*:\s*["']([^"']+)["']/i,
      /[?&]tag=([^"&\s]+)/i,
      /["']affiliateTag["']\s*:\s*["']([^"']+)["']/i,
    ]) || null;
  return {
    csrfToken: normalizeCsrfToken(rawCsrf),
    tag: normalizeTag(rawTag),
  };
};

const ensureSessionByLinkBuilder = async (
  cookieHeader: string,
): Promise<{ csrfToken: string | null; tag: string | null }> => {
  const response = await fetchWithTimeout(LINK_BUILDER_URL, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      cookie: cookieHeader,
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    redirect: "manual",
    cache: "no-store",
  });

  const location = asString(response.headers.get("location"))?.toLowerCase() ?? "";
  if (response.status >= 300 && response.status < 400 && location.includes("login")) {
    throw new Error("Cookie inválido ou expirado. Faça login novamente no Mercado Livre e atualize o cookie.");
  }
  if (response.status >= 400) {
    throw new Error(`Falha ao validar sessão no Link Builder (HTTP ${response.status}).`);
  }

  const html = await response.text().catch(() => "");
  return extractFromLinkBuilderHtml(html || null);
};

const parseCreateLinkResponse = (payload: unknown): CreateLinkResult => {
  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nestedData =
    data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : null;
  const nestedResult =
    data.result && typeof data.result === "object" ? (data.result as Record<string, unknown>) : null;
  const rawLinks =
    (Array.isArray(data.urls) ? data.urls : null) ||
    (Array.isArray(data.links) ? data.links : null) ||
    (nestedData && Array.isArray(nestedData.urls) ? nestedData.urls : null) ||
    (nestedData && Array.isArray(nestedData.links) ? nestedData.links : null) ||
    (nestedResult && Array.isArray(nestedResult.urls) ? nestedResult.urls : null) ||
    (nestedResult && Array.isArray(nestedResult.links) ? nestedResult.links : null) ||
    [];
  const links: AffiliateMlGeneratedLink[] = [];
  const rejectedMessages: string[] = [];
  const rejectedCodes: Record<string, number> = {};

  rawLinks.forEach((entry) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const shortUrl =
      asString(item.short_url) ||
      asString(item.shortUrl) ||
      asString(item.short_link) ||
      asString(item.shortLinkUrl) ||
      asString(item.url) ||
      asString(item.affiliate_url);
    if (shortUrl) {
      links.push({
        id: asString(item.id),
        shortUrl,
        longUrl:
          asString(item.long_url) ||
          asString(item.longUrl) ||
          asString(item.original_url) ||
          asString(item.originalUrl),
        originUrl:
          asString(item.origin_url) ||
          asString(item.originUrl) ||
          asString(item.input_url) ||
          asString(item.inputUrl),
        regex: asString(item.regex),
        text: asString(item.text),
        tag: asString(item.tag),
        created:
          typeof item.created === "boolean"
            ? item.created
            : typeof item.created === "number"
              ? item.created === 1
              : null,
      });
      return;
    }

    const rejectionMessage = asString(item.message) || asString(item.error);
    if (rejectionMessage) {
      rejectedMessages.push(rejectionMessage);
    }
    const rejectionCode = item.error_code ?? item.code ?? null;
    if (rejectionCode !== null && typeof rejectionCode !== "undefined") {
      const codeKey = String(rejectionCode);
      rejectedCodes[codeKey] = (rejectedCodes[codeKey] ?? 0) + 1;
    }
  });

  const totalSuccessRaw = data.total_success;
  const totalSuccessNested =
    nestedData?.total_success ?? nestedData?.success_count ?? nestedResult?.total_success ?? nestedResult?.success_count;
  const totalSuccess =
    typeof totalSuccessRaw === "number" && Number.isFinite(totalSuccessRaw)
      ? Math.max(0, Math.trunc(totalSuccessRaw))
      : typeof totalSuccessNested === "number" && Number.isFinite(totalSuccessNested)
        ? Math.max(0, Math.trunc(totalSuccessNested))
      : links.length;

  const totalErrorRaw = data.total_error;
  const totalErrorNested =
    nestedData?.total_error ?? nestedData?.error_count ?? nestedResult?.total_error ?? nestedResult?.error_count;
  const totalError =
    typeof totalErrorRaw === "number" && Number.isFinite(totalErrorRaw)
      ? Math.max(0, Math.trunc(totalErrorRaw))
      : typeof totalErrorNested === "number" && Number.isFinite(totalErrorNested)
        ? Math.max(0, Math.trunc(totalErrorNested))
      : Math.max(0, rawLinks.length - links.length);

  return {
    links,
    totalSuccess,
    totalError,
    rejectedMessages: Array.from(new Set(rejectedMessages.map((entry) => entry.trim()).filter(Boolean))),
    rejectedCodes,
  };
};

const createAffiliateLinks = async (params: {
  cookieHeader: string;
  csrfToken: string;
  tag: string;
  urls: string[];
}): Promise<CreateLinkResult> => {
  const urls = params.urls
    .map((entry) => normalizeUrl(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (urls.length === 0) {
    throw new Error("Nenhuma URL válida foi informada para gerar link afiliado.");
  }
  if (urls.length > MAX_URLS_PER_BATCH) {
    throw new Error(`Limite máximo de ${MAX_URLS_PER_BATCH} URLs por lote excedido.`);
  }

  const response = await fetchWithTimeout(CREATE_LINK_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      cookie: params.cookieHeader,
      origin: "https://www.mercadolivre.com.br",
      referer: LINK_BUILDER_URL,
      "x-csrf-token": params.csrfToken,
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ urls, tag: params.tag }),
    cache: "no-store",
  });

  const text = await response.text();
  const json = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  })();

  if (!response.ok) {
    const details = asString(
      json && typeof json === "object" ? (json as Record<string, unknown>).message : null,
    );
    throw new Error(
      details ||
        `Mercado Livre recusou a geração de links (HTTP ${response.status}). Verifique cookie/CSRF/tag.`,
    );
  }

  const parsed = parseCreateLinkResponse(json);
  return parsed;
};

const resolveCredentials = (params: {
  cookie: string;
  csrfToken?: string | null;
  tag?: string | null;
}): { cookie: string; csrfToken: string | null; tag: string | null } => {
  const normalizedCookie = normalizeCookieHeader(params.cookie);
  if (!normalizedCookie) {
    throw new Error("Informe um cookie válido no formato `nome=valor; nome2=valor2`.");
  }
  const cookies = parseCookieMap(normalizedCookie);
  const csrfToken = normalizeCsrfToken(params.csrfToken) || normalizeCsrfToken(cookies.get("_csrf") || null);
  const tag = normalizeTag(params.tag) || normalizeTag(cookies.get("orgnickp") || null);
  return {
    cookie: normalizedCookie,
    csrfToken,
    tag,
  };
};

const runValidation = async (params: {
  cookie: string;
  csrfToken?: string | null;
  tag?: string | null;
  sampleUrl?: string | null;
}): Promise<AffiliateMlResolverValidationResult> => {
  const resolved = resolveCredentials(params);
  const checkedAt = new Date().toISOString();

  const detectedFromSession = await ensureSessionByLinkBuilder(resolved.cookie);
  const resolvedCsrfToken = resolved.csrfToken || detectedFromSession.csrfToken;
  const resolvedTag = resolved.tag || detectedFromSession.tag;

  if (!resolvedCsrfToken) {
    return {
      ok: false,
      mode: "session",
      message:
        "Cookie sem token CSRF detectável. Refaça o login no Mercado Livre e cole o cookie completo para habilitar geração automática.",
      sampleShortUrl: null,
      checkedAt,
      resolvedTag,
      resolvedCsrfToken: null,
    };
  }
  if (!resolvedTag) {
    return {
      ok: false,
      mode: "session",
      message:
        "Não foi possível identificar automaticamente a tag de afiliado. Faça novo login no Link Builder e salve o cookie novamente.",
      sampleShortUrl: null,
      checkedAt,
      resolvedTag: null,
      resolvedCsrfToken,
    };
  }

  const sampleUrl = normalizeUrl(params.sampleUrl);
  if (!sampleUrl) {
    return {
      ok: true,
      mode: "session",
      message:
        "Cookie válido para sessão no Link Builder. Informe uma URL de teste para validar também a criação de link.",
      sampleShortUrl: null,
      checkedAt,
      resolvedTag,
      resolvedCsrfToken,
    };
  }

  const links = await createAffiliateLinks({
    cookieHeader: resolved.cookie,
    csrfToken: resolvedCsrfToken,
    tag: resolvedTag,
    urls: [sampleUrl],
  });

  const sampleShortUrl = links.links[0]?.shortUrl || null;
  if (!sampleShortUrl) {
    const rejectionHint = links.rejectedMessages[0]
      ? ` Motivo reportado pelo Mercado Livre: ${links.rejectedMessages[0]}.`
      : "";
    return {
      ok: true,
      mode: "create_link",
      message: `Cookie válido, mas a URL de teste não gerou link afiliado.${rejectionHint}`,
      sampleShortUrl: null,
      checkedAt,
      resolvedTag,
      resolvedCsrfToken,
    };
  }

  return {
    ok: true,
    mode: "create_link",
    message: "Cookie validado com sucesso e geração de link afiliado confirmada.",
    sampleShortUrl,
    checkedAt,
    resolvedTag,
    resolvedCsrfToken,
  };
};

export const getAffiliateMlResolverForUser = async (
  userId: number,
  options: { includeSecrets?: boolean } = {},
): Promise<AffiliateMlResolverSummary | AffiliateMlResolverSecrets> => {
  const row = await fetchResolverRow(userId);
  return options.includeSecrets ? toSecrets(row) : toSummary(row);
};

export const saveAffiliateMlResolverForUser = async (
  userId: number,
  payload: {
    cookie?: string | null;
    csrfToken?: string | null;
    tag?: string | null;
    sampleUrl?: string | null;
  },
): Promise<{ summary: AffiliateMlResolverSummary; validation: AffiliateMlResolverValidationResult }> => {
  const existing = (await getAffiliateMlResolverForUser(userId, {
    includeSecrets: true,
  })) as AffiliateMlResolverSecrets;

  const nextCookie = normalizeCookieHeader(payload.cookie ?? null) || existing.cookie;
  if (!nextCookie) {
    throw new Error("Informe o cookie da conta Mercado Livre para salvar o resolvedor.");
  }

  const validation = await runValidation({
    cookie: nextCookie,
    csrfToken: payload.csrfToken ?? existing.csrfToken,
    tag: payload.tag ?? existing.tag,
    sampleUrl: payload.sampleUrl ?? null,
  });

  await upsertResolverRow(userId, {
    cookie: nextCookie,
    csrfToken: validation.resolvedCsrfToken,
    tag: validation.resolvedTag,
    enabled: validation.ok ? existing.enabled : false,
    isValid: validation.ok,
    lastError: validation.ok ? null : validation.message,
    lastValidatedAt: validation.checkedAt,
  });

  const summary = (await getAffiliateMlResolverForUser(userId)) as AffiliateMlResolverSummary;
  return { summary, validation };
};

export const validateAffiliateMlResolverForUser = async (
  userId: number,
  payload: { sampleUrl?: string | null } = {},
): Promise<{ summary: AffiliateMlResolverSummary; validation: AffiliateMlResolverValidationResult }> => {
  const existing = (await getAffiliateMlResolverForUser(userId, {
    includeSecrets: true,
  })) as AffiliateMlResolverSecrets;

  if (!existing.cookie) {
    throw new Error("Nenhum cookie configurado. Salve o cookie antes de validar.");
  }

  const validation = await runValidation({
    cookie: existing.cookie,
    csrfToken: existing.csrfToken,
    tag: existing.tag,
    sampleUrl: payload.sampleUrl ?? null,
  });

  await updateResolverValidationStatus(userId, {
    isValid: validation.ok,
    message: validation.ok ? null : validation.message,
    enabled: validation.ok ? undefined : false,
    checkedAt: validation.checkedAt,
  });

  const summary = (await getAffiliateMlResolverForUser(userId)) as AffiliateMlResolverSummary;
  return { summary, validation };
};

export const clearAffiliateMlResolverForUser = async (userId: number): Promise<void> => {
  await ensureResolverTable();
  const db = getDb();
  await db.query(
    `
      DELETE FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ?
    `,
    [userId, PROVIDER_KEY],
  );
};

export const setAffiliateMlResolverEnabledForUser = async (
  userId: number,
  enabled: boolean,
): Promise<{ summary: AffiliateMlResolverSummary; validation: AffiliateMlResolverValidationResult | null }> => {
  const existing = (await getAffiliateMlResolverForUser(userId, {
    includeSecrets: true,
  })) as AffiliateMlResolverSecrets;

  if (!existing.cookie) {
    throw new Error("Nenhum cookie configurado. Salve um cookie válido antes de ativar o resolvedor.");
  }

  if (!enabled) {
    await upsertResolverRow(userId, {
      cookie: existing.cookie,
      csrfToken: existing.csrfToken,
      tag: existing.tag,
      enabled: false,
      isValid: existing.isValid,
      lastError: existing.lastError,
      lastValidatedAt: existing.lastValidatedAt,
    });
    return {
      summary: (await getAffiliateMlResolverForUser(userId)) as AffiliateMlResolverSummary,
      validation: null,
    };
  }

  const validation = await runValidation({
    cookie: existing.cookie,
    csrfToken: existing.csrfToken,
    tag: existing.tag,
  });

  await upsertResolverRow(userId, {
    cookie: existing.cookie,
    csrfToken: validation.resolvedCsrfToken,
    tag: validation.resolvedTag,
    enabled: validation.ok,
    isValid: validation.ok,
    lastError: validation.ok ? null : validation.message,
    lastValidatedAt: validation.checkedAt,
  });

  if (!validation.ok) {
    throw new Error(validation.message);
  }

  return {
    summary: (await getAffiliateMlResolverForUser(userId)) as AffiliateMlResolverSummary,
    validation,
  };
};

export const generateAffiliateMlLinksForUser = async (
  userId: number,
  urls: string[],
  options: { tag?: string | null } = {},
): Promise<{ links: AffiliateMlGeneratedLink[]; tag: string; warning?: string }> => {
  const existing = (await getAffiliateMlResolverForUser(userId, {
    includeSecrets: true,
  })) as AffiliateMlResolverSecrets;

  if (!existing.cookie) {
    throw new Error("Cookie do resolvedor não configurado. Preencha em Afiliados > Mercado Livre > Conta.");
  }
  if (!existing.enabled) {
    throw new Error("Resolvedor automático desativado. Ative o toggle em Afiliados > Mercado Livre > Conta.");
  }

  const credentials = resolveCredentials({
    cookie: existing.cookie,
    csrfToken: existing.csrfToken,
    tag: options.tag ?? existing.tag,
  });
  const resolvedCsrfToken = credentials.csrfToken;
  if (!resolvedCsrfToken) {
    throw new Error("Token CSRF não configurado para o resolvedor do Mercado Livre.");
  }
  const resolvedTag = credentials.tag;
  if (!resolvedTag) {
    throw new Error("Tag de afiliado não configurada para o resolvedor do Mercado Livre.");
  }

  try {
    const normalizedUrls = Array.from(
      new Set(
        urls
          .map((entry) => normalizeUrl(entry))
          .filter((entry): entry is string => Boolean(entry)),
      ),
    );
    const allLinks: AffiliateMlGeneratedLink[] = [];
    let rejectedTotal = 0;
    let rejectedCode111 = 0;
    const rejectedMessages = new Set<string>();

    const mergeResult = (result: CreateLinkResult) => {
      allLinks.push(...result.links);
      rejectedTotal += result.totalError;
      rejectedCode111 += result.rejectedCodes["111"] ?? 0;
      result.rejectedMessages.forEach((message) => {
        if (!message) return;
        rejectedMessages.add(message);
      });
    };

    const processBatch = async (batch: string[]): Promise<void> => {
      if (batch.length === 0) return;
      try {
        const result = await createAffiliateLinks({
          cookieHeader: credentials.cookie,
          csrfToken: resolvedCsrfToken,
          tag: resolvedTag,
          urls: batch,
        });
        mergeResult(result);
      } catch (error) {
        if (!isRecoverableCreateLinkError(error) || batch.length <= 1) {
          throw error;
        }

        const fallbackSize = Math.min(FALLBACK_CHUNK_SIZE, Math.max(1, batch.length - 1));
        if (batch.length > fallbackSize) {
          for (let index = 0; index < batch.length; index += fallbackSize) {
            await processBatch(batch.slice(index, index + fallbackSize));
          }
          return;
        }

        for (const singleUrl of batch) {
          try {
            const singleResult = await createAffiliateLinks({
              cookieHeader: credentials.cookie,
              csrfToken: resolvedCsrfToken,
              tag: resolvedTag,
              urls: [singleUrl],
            });
            mergeResult(singleResult);
          } catch (singleError) {
            if (!isRecoverableCreateLinkError(singleError)) {
              throw singleError;
            }
            rejectedTotal += 1;
            const singleMessage =
              singleError instanceof Error
                ? singleError.message
                : "URL ignorada por retorno inválido do Link Builder.";
            rejectedMessages.add(singleMessage);
          }
        }
      }
    };

    for (let i = 0; i < normalizedUrls.length; i += MAX_URLS_PER_BATCH) {
      const chunk = normalizedUrls.slice(i, i + MAX_URLS_PER_BATCH);
      await processBatch(chunk);
    }
    const dedupedLinks = Array.from(
      new Map(allLinks.map((entry) => [entry.shortUrl, entry])).values(),
    );
    let warning: string | undefined;
    if (rejectedTotal > 0) {
      if (dedupedLinks.length > 0) {
        warning = `${rejectedTotal} URL(s) não elegíveis foram ignoradas automaticamente.`;
      } else if (rejectedCode111 > 0) {
        warning =
          "Nenhuma URL retornada para este termo é elegível no programa de afiliados. Tente outro termo/categoria.";
      } else if (rejectedMessages.size > 0) {
        warning = Array.from(rejectedMessages).slice(0, 2).join(" ");
      } else {
        warning = "O Mercado Livre não retornou links afiliados para as URLs enviadas neste lote.";
      }
    }
    await upsertResolverRow(userId, {
      cookie: credentials.cookie,
      csrfToken: resolvedCsrfToken,
      tag: resolvedTag,
      enabled: true,
      isValid: true,
      lastError: null,
      lastValidatedAt: new Date().toISOString(),
    });
    return {
      links: dedupedLinks,
      tag: resolvedTag,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar link afiliado automático.";
    await updateResolverValidationStatus(userId, {
      isValid: false,
      message,
      checkedAt: new Date().toISOString(),
    });
    throw error;
  }
};

export const generateAffiliateMlLinksForUserWithAdminFallback = async (
  userId: number | null | undefined,
  urls: string[],
  options: { tag?: string | null } = {},
): Promise<{
  links: AffiliateMlGeneratedLink[];
  tag: string;
  warning?: string;
  resolverUserId: number;
  usedAdminFallback: boolean;
}> => {
  const candidateUserIds: number[] = [];
  const normalizedUserId =
    typeof userId === "number" && Number.isFinite(userId) && userId > 0
      ? Math.trunc(userId)
      : null;

  if (normalizedUserId) {
    candidateUserIds.push(normalizedUserId);
  }

  const adminUserIds = await listAdminResolverUserIds();
  for (const adminUserId of adminUserIds) {
    if (!candidateUserIds.includes(adminUserId)) {
      candidateUserIds.push(adminUserId);
    }
  }

  let lastError: Error | null = null;
  for (const candidateUserId of candidateUserIds) {
    try {
      const result = await generateAffiliateMlLinksForUser(candidateUserId, urls, options);
      return {
        ...result,
        resolverUserId: candidateUserId,
        usedAdminFallback: normalizedUserId !== null && candidateUserId !== normalizedUserId,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || "Falha ao gerar link afiliado."));
    }
  }

  throw (
    lastError ||
    new Error("Nenhuma conta afiliada válida do Mercado Livre foi encontrada para gerar o link.")
  );
};
