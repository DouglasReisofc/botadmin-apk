import crypto from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { getAffiliateProviderRuntimeConfig, getAffiliateProviderRuntimeConfigMap } from "lib/admin-affiliate-providers";
import { AFFILIATE_PROVIDER_CATALOG, AFFILIATE_PROVIDER_ORDER, resolveAffiliateProviderKey } from "lib/affiliate-provider-catalog";
import { ensureUserTable, getDb } from "lib/db";
import type {
  AffiliateConnectionStatus,
  AffiliateOAuthStartResult,
  AffiliateProviderAccountSummary,
  AffiliateProviderKey,
  AffiliateProviderSummary,
} from "types/affiliates";

type ProviderOAuthConfig = {
  authEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  defaultScopes: string[];
};

type AffiliateProviderConnectionRow = RowDataPacket & {
  id: number;
  user_id: number;
  provider: string;
  connection_key: string | null;
  account_id: string | null;
  account_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_type: string | null;
  scope_text: string | null;
  expires_at: Date | string | null;
  last_error: string | null;
  metadata_json: string | null;
  is_active: number;
  is_selected: number;
  provider_app_id: string | null;
  provider_client_secret: string | null;
  provider_app_token: string | null;
  connected_at: Date | string | null;
  last_refresh_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type AffiliateOAuthStateRow = RowDataPacket & {
  id: number;
  state_token: string;
  provider: string;
  user_id: number;
  return_to: string | null;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  metadata_json: string | null;
  created_at: Date | string;
};

type OAuthTokenPayload = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scopeText: string | null;
  expiresAt: Date | null;
  accountId: string | null;
  accountName: string | null;
  raw: Record<string, unknown>;
};

type OAuthStateMetadata = {
  connectionKey?: string | null;
  redirectUri?: string | null;
};

type SaveProviderTokenPayloadContext = {
  preserveAccountName?: boolean;
  connectionKey?: string | null;
  select?: boolean;
};

const OAUTH_STATE_TTL_MINUTES = 10;
const TOKEN_EXPIRY_SAFETY_SECONDS = 60;
const CONNECTION_KEY_MAX_LENGTH = 191;

const TABLE_CONNECTIONS = "affiliate_provider_connections";
const TABLE_OAUTH_STATES = "affiliate_oauth_states";
const SHOPEE_GRAPHQL_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const SHOPEE_VALIDATION_TIMEOUT_MS = 15_000;

const ensureTasks = new Map<string, Promise<void>>();
const ensureDone = new Set<string>();
const refreshTaskMap = new Map<string, Promise<string>>();

const normalizeDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoOrNull = (value: Date | string | null | undefined): string | null => {
  const date = normalizeDate(value);
  return date ? date.toISOString() : null;
};

const readText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const parseScopeList = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

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

const resolveProvider = (provider: string): AffiliateProviderKey | null => {
  return resolveAffiliateProviderKey(provider);
};

const sanitizeReturnTo = (value: string | null | undefined): string => {
  const candidate = String(value || "").trim();
  if (!candidate) return "/dashboard/user?section=affiliates";
  if (!candidate.startsWith("/")) return "/dashboard/user?section=affiliates";
  if (candidate.startsWith("//")) return "/dashboard/user?section=affiliates";
  return candidate;
};

const sanitizeTokenRawPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  const clone = { ...payload };
  delete clone.access_token;
  delete clone.refresh_token;
  return clone;
};

const sanitizeConnectionKey = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, CONNECTION_KEY_MAX_LENGTH);
  return normalized || null;
};

const sanitizeHttpUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const isLocalhostHost = (hostname: string): boolean => {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
};

const resolveOAuthRedirectUri = (
  configuredRedirectUri: string,
  requestOriginOverride?: string | null,
): string => {
  const configured = sanitizeHttpUrl(configuredRedirectUri);
  if (!configured) return configuredRedirectUri;
  const override = sanitizeHttpUrl(requestOriginOverride ?? null);
  if (!override) return configured;

  try {
    const configuredUrl = new URL(configured);
    const overrideUrl = new URL(override);
    if (!isLocalhostHost(configuredUrl.hostname)) {
      return configured;
    }
    if (isLocalhostHost(overrideUrl.hostname)) {
      return configured;
    }
    configuredUrl.protocol = overrideUrl.protocol;
    configuredUrl.host = overrideUrl.host;
    return configuredUrl.toString();
  } catch {
    return configured;
  }
};

const buildConnectionKeyFromAccountId = (accountId: string | null | undefined): string | null => {
  if (!accountId) return null;
  return sanitizeConnectionKey(accountId);
};

const buildRandomConnectionKey = (prefix: string): string => {
  const safePrefix = sanitizeConnectionKey(prefix) || "account";
  return `${safePrefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`.slice(
    0,
    CONNECTION_KEY_MAX_LENGTH,
  );
};

const parseOAuthStateMetadata = (raw: string | null | undefined): OAuthStateMetadata => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      connectionKey: sanitizeConnectionKey(parsed.connectionKey),
      redirectUri: sanitizeHttpUrl(parsed.redirectUri),
    };
  } catch {
    return {};
  }
};

const hasIndex = async (table: string, indexName: string): Promise<boolean> => {
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
  return Array.isArray(rows) && rows.length > 0;
};

const hasColumn = async (table: string, columnName: string): Promise<boolean> => {
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, [columnName]);
  return Array.isArray(rows) && rows.length > 0;
};

const ensureSelectedConnectionInvariant = async (userId: number, provider: AffiliateProviderKey): Promise<void> => {
  const db = getDb();
  const [rows] = await db.query<AffiliateProviderConnectionRow[]>(
    `
      SELECT *
      FROM ${TABLE_CONNECTIONS}
      WHERE user_id = ? AND provider = ?
      ORDER BY is_selected DESC, is_active DESC, updated_at DESC, id DESC
    `,
    [userId, provider],
  );
  if (!Array.isArray(rows) || rows.length === 0) return;

  const selected =
    rows.find((row) => Number(row.is_selected) === 1 && Number(row.is_active) === 1) ||
    rows.find((row) => Number(row.is_active) === 1) ||
    rows.find((row) => Number(row.is_selected) === 1) ||
    rows[0];

  await db.query(
    `
      UPDATE ${TABLE_CONNECTIONS}
      SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ?
    `,
    [selected.id, userId, provider],
  );
};

const ensureAffiliateTables = async () =>
  runEnsure("affiliate-connections-tables", async () => {
    await ensureUserTable();
    const db = getDb();

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_CONNECTIONS} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        provider VARCHAR(64) NOT NULL,
        connection_key VARCHAR(191) NULL,
        account_id VARCHAR(191) NULL,
        account_name VARCHAR(191) NULL,
        access_token TEXT NULL,
        refresh_token TEXT NULL,
        token_type VARCHAR(64) NULL,
        scope_text TEXT NULL,
        expires_at DATETIME NULL,
        last_error TEXT NULL,
        metadata_json LONGTEXT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        is_selected TINYINT(1) NOT NULL DEFAULT 0,
        provider_app_id VARCHAR(191) NULL,
        provider_client_secret TEXT NULL,
        provider_app_token TEXT NULL,
        connected_at DATETIME NULL,
        last_refresh_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_affiliate_provider_user_provider (user_id, provider),
        KEY idx_affiliate_provider_selected (user_id, provider, is_selected),
        CONSTRAINT fk_affiliate_provider_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_OAUTH_STATES} (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        state_token VARCHAR(191) NOT NULL,
        provider VARCHAR(64) NOT NULL,
        user_id INT NOT NULL,
        return_to VARCHAR(512) NULL,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME NULL,
        metadata_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_affiliate_oauth_state_token (state_token),
        KEY idx_affiliate_oauth_state_provider (provider),
        KEY idx_affiliate_oauth_state_expires (expires_at),
        CONSTRAINT fk_affiliate_oauth_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (columnName: string, definition: string) => {
      if (!(await hasColumn(TABLE_CONNECTIONS, columnName))) {
        try {
          await db.query(`ALTER TABLE ${TABLE_CONNECTIONS} ADD COLUMN ${definition}`);
        } catch (error) {
          console.error(`[affiliate-connections] failed to add column ${columnName}:`, error);
        }
      }
    };

    await ensureColumn("connection_key", "connection_key VARCHAR(191) NULL AFTER provider");
    await ensureColumn("is_selected", "is_selected TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active");
    await ensureColumn("provider_app_id", "provider_app_id VARCHAR(191) NULL AFTER is_selected");
    await ensureColumn("provider_client_secret", "provider_client_secret TEXT NULL AFTER provider_app_id");
    await ensureColumn("provider_app_token", "provider_app_token TEXT NULL AFTER provider_client_secret");

    if (await hasIndex(TABLE_CONNECTIONS, "uq_affiliate_provider_user")) {
      try {
        await db.query(`ALTER TABLE ${TABLE_CONNECTIONS} DROP INDEX uq_affiliate_provider_user`);
      } catch (error) {
        console.error("[affiliate-connections] failed to drop old unique index:", error);
      }
    }
    if (!(await hasIndex(TABLE_CONNECTIONS, "uq_affiliate_provider_user_key"))) {
      try {
        await db.query(
          `ALTER TABLE ${TABLE_CONNECTIONS} ADD UNIQUE KEY uq_affiliate_provider_user_key (user_id, provider, connection_key)`,
        );
      } catch (error) {
        console.error("[affiliate-connections] failed to add multi-account unique index:", error);
      }
    }

    try {
      await db.query(
        `
          UPDATE ${TABLE_CONNECTIONS}
          SET connection_key = CONCAT('imported-', id)
          WHERE connection_key IS NULL OR connection_key = ''
        `,
      );
    } catch (error) {
      console.error("[affiliate-connections] failed to backfill connection_key:", error);
    }

    let pairs: RowDataPacket[] = [];
    try {
      const [pairsRows] = await db.query<RowDataPacket[]>(
        `
          SELECT user_id, provider
          FROM ${TABLE_CONNECTIONS}
          GROUP BY user_id, provider
        `,
      );
      pairs = Array.isArray(pairsRows) ? pairsRows : [];
    } catch (error) {
      console.error("[affiliate-connections] failed to load provider pairs for selected invariant:", error);
    }

    for (const pair of pairs) {
      const userId = Number(pair.user_id);
      const provider = resolveProvider(String(pair.provider || ""));
      if (!provider || !Number.isFinite(userId) || userId <= 0) continue;
      try {
        await ensureSelectedConnectionInvariant(userId, provider);
      } catch (error) {
        console.error("[affiliate-connections] failed to enforce selected invariant:", {
          userId,
          provider,
          error,
        });
      }
    }
  });

const fetchProviderConnectionRows = async (
  userId: number,
  provider: AffiliateProviderKey,
): Promise<AffiliateProviderConnectionRow[]> => {
  await ensureAffiliateTables();
  const db = getDb();
  const [rows] = await db.query<AffiliateProviderConnectionRow[]>(
    `
      SELECT *
      FROM ${TABLE_CONNECTIONS}
      WHERE user_id = ? AND provider = ?
      ORDER BY is_selected DESC, is_active DESC, updated_at DESC, id DESC
    `,
    [userId, provider],
  );
  return Array.isArray(rows) ? rows : [];
};

const fetchProviderConnectionRowById = async (
  userId: number,
  provider: AffiliateProviderKey,
  connectionId: number,
): Promise<AffiliateProviderConnectionRow | null> => {
  await ensureAffiliateTables();
  const db = getDb();
  const [rows] = await db.query<AffiliateProviderConnectionRow[]>(
    `
      SELECT *
      FROM ${TABLE_CONNECTIONS}
      WHERE id = ? AND user_id = ? AND provider = ?
      LIMIT 1
    `,
    [connectionId, userId, provider],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0] ?? null;
};

const pickSelectedConnectionRow = (rows: AffiliateProviderConnectionRow[]): AffiliateProviderConnectionRow | null => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    rows.find((row) => Number(row.is_selected) === 1 && Number(row.is_active) === 1) ||
    rows.find((row) => Number(row.is_active) === 1) ||
    rows.find((row) => Number(row.is_selected) === 1) ||
    rows[0] ||
    null
  );
};

const computeConnectionStatusForRow = (
  provider: AffiliateProviderKey,
  runtimeEnabled: boolean,
  row: AffiliateProviderConnectionRow | null,
): AffiliateConnectionStatus => {
  if (!runtimeEnabled) return "unavailable";
  if (!row) {
    return AFFILIATE_PROVIDER_CATALOG[provider].supportsOAuth ? "not_connected" : "connected";
  }
  if (!row.is_active) return "not_connected";

  const definition = AFFILIATE_PROVIDER_CATALOG[provider];
  if (!definition.supportsOAuth) {
    const hasCredentials = Boolean(readText(row.provider_app_id) && readText(row.provider_client_secret));
    if (!hasCredentials) return "not_connected";
    if (readText(row.last_error)) return "error";
    return "connected";
  }

  const expiresAt = normalizeDate(row.expires_at);
  const now = Date.now();
  if (expiresAt && expiresAt.getTime() <= now) return "expired";
  if (readText(row.last_error)) return "error";
  if (readText(row.access_token)) return "connected";
  return "not_connected";
};

const rowToAccountSummary = (
  provider: AffiliateProviderKey,
  row: AffiliateProviderConnectionRow,
  runtimeEnabled: boolean,
): AffiliateProviderAccountSummary => {
  const definition = AFFILIATE_PROVIDER_CATALOG[provider];
  const status = computeConnectionStatusForRow(provider, runtimeEnabled, row);
  return {
    id: Number(row.id),
    provider,
    accountId: readText(row.account_id),
    accountName: readText(row.account_name) || readText(row.account_id),
    connected: status === "connected",
    status,
    selected: Number(row.is_selected) === 1,
    expiresAt: toIsoOrNull(row.expires_at),
    updatedAt: toIsoOrNull(row.updated_at),
    lastError: readText(row.last_error),
    scopes: parseScopeList(row.scope_text),
    supportsOAuth: definition.supportsOAuth,
  };
};

const rowToProviderSummary = (
  providerKey: AffiliateProviderKey,
  rows: AffiliateProviderConnectionRow[],
  runtime: {
    enabled: boolean;
    appId: string | null;
    clientSecret: string | null;
  } | null,
): AffiliateProviderSummary => {
  const provider = AFFILIATE_PROVIDER_CATALOG[providerKey];
  const runtimeEnabled = Boolean(runtime?.enabled);
  const runtimeCredentialReady = provider.supportsOAuth
    ? true
    : Boolean(readText(runtime?.appId) && readText(runtime?.clientSecret));
  const selectedRow = pickSelectedConnectionRow(rows);

  let accounts: AffiliateProviderAccountSummary[] = rows.map((row) => rowToAccountSummary(providerKey, row, runtimeEnabled));
  if (!provider.supportsOAuth && accounts.length === 0 && runtimeEnabled && runtimeCredentialReady) {
    accounts = [
      {
        id: 0,
        provider: providerKey,
        accountId: null,
        accountName: "Open API configurada",
        connected: true,
        status: "connected",
        selected: true,
        expiresAt: null,
        updatedAt: null,
        lastError: null,
        scopes: [],
        supportsOAuth: false,
      },
    ];
  }

  const status = selectedRow
    ? computeConnectionStatusForRow(providerKey, runtimeEnabled, selectedRow)
    : provider.supportsOAuth
      ? runtimeEnabled
        ? "not_connected"
        : "unavailable"
      : runtimeEnabled
        ? runtimeCredentialReady
          ? "connected"
          : "not_connected"
        : "unavailable";

  const selectedConnectionId =
    selectedRow && Number.isFinite(Number(selectedRow.id)) ? Number(selectedRow.id) : accounts[0]?.id ?? null;

  const selectedAccount =
    accounts.find((account) => account.id === selectedConnectionId) ||
    accounts.find((account) => account.selected) ||
    accounts[0] ||
    null;

  return {
    provider: providerKey,
    label: provider.label,
    description: provider.description,
    logoUrl: provider.logoUrl,
    enabled: runtimeEnabled,
    supportsOAuth: provider.supportsOAuth,
    implemented: provider.implemented,
    status,
    connected: status === "connected",
    accountId: selectedAccount?.accountId ?? null,
    accountName: selectedAccount?.accountName ?? null,
    expiresAt: selectedAccount?.expiresAt ?? null,
    updatedAt: selectedAccount?.updatedAt ?? null,
    lastError: selectedAccount?.lastError ?? null,
    scopes: selectedAccount?.scopes ?? [],
    selectedConnectionId,
    accounts,
  };
};

const buildProviderSummaryFallback = (
  providerKey: AffiliateProviderKey,
  runtime: {
    enabled: boolean;
    appId: string | null;
    clientSecret: string | null;
  } | null,
): AffiliateProviderSummary => {
  const provider = AFFILIATE_PROVIDER_CATALOG[providerKey];
  const runtimeEnabled = Boolean(runtime?.enabled);
  const runtimeCredentialReady = provider.supportsOAuth
    ? true
    : Boolean(readText(runtime?.appId) && readText(runtime?.clientSecret));
  const status: AffiliateConnectionStatus = provider.supportsOAuth
    ? runtimeEnabled
      ? "not_connected"
      : "unavailable"
    : runtimeEnabled
      ? runtimeCredentialReady
        ? "connected"
        : "not_connected"
      : "unavailable";

  const accounts: AffiliateProviderAccountSummary[] =
    !provider.supportsOAuth && runtimeEnabled && runtimeCredentialReady
      ? [
          {
            id: 0,
            provider: providerKey,
            accountId: null,
            accountName: "Open API configurada",
            connected: true,
            status: "connected",
            selected: true,
            expiresAt: null,
            updatedAt: null,
            lastError: null,
            scopes: [],
            supportsOAuth: false,
          },
        ]
      : [];

  return {
    provider: providerKey,
    label: provider.label,
    description: provider.description,
    logoUrl: provider.logoUrl,
    enabled: runtimeEnabled,
    supportsOAuth: provider.supportsOAuth,
    implemented: provider.implemented,
    status,
    connected: status === "connected",
    accountId: accounts[0]?.accountId ?? null,
    accountName: accounts[0]?.accountName ?? null,
    expiresAt: accounts[0]?.expiresAt ?? null,
    updatedAt: accounts[0]?.updatedAt ?? null,
    lastError: accounts[0]?.lastError ?? null,
    scopes: accounts[0]?.scopes ?? [],
    selectedConnectionId: accounts[0]?.id ?? null,
    accounts,
  };
};

const getOAuthConfigForProvider = async (provider: AffiliateProviderKey): Promise<ProviderOAuthConfig> => {
  const runtime = await getAffiliateProviderRuntimeConfig(provider);
  const definition = AFFILIATE_PROVIDER_CATALOG[provider];
  if (!definition.supportsOAuth) {
    throw new Error("Esse provedor ainda nao possui conexao OAuth.");
  }
  if (!definition.implemented) {
    throw new Error("Esse provedor ainda esta em desenvolvimento.");
  }
  if (!runtime.enabled) {
    throw new Error("Provedor desativado ou credenciais OAuth incompletas.");
  }
  if (!runtime.appId || !runtime.clientSecret || !runtime.authEndpoint || !runtime.tokenEndpoint || !runtime.redirectUri) {
    throw new Error("Credenciais OAuth nao configuradas para este provedor.");
  }

  return {
    authEndpoint: runtime.authEndpoint,
    tokenEndpoint: runtime.tokenEndpoint,
    clientId: runtime.appId,
    clientSecret: runtime.clientSecret,
    redirectUri: runtime.redirectUri,
    defaultScopes: parseScopeList(runtime.scopeText || ""),
  };
};

const requestOAuthToken = async (
  provider: AffiliateProviderKey,
  params: Record<string, string>,
): Promise<OAuthTokenPayload> => {
  const config = await getOAuthConfigForProvider(provider);

  const body = new URLSearchParams(params);
  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const details = payload?.message || payload?.error_description || payload?.error || response.statusText;
    throw new Error(`Falha ao autenticar no Mercado Livre: ${details}`);
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) {
    throw new Error("Mercado Livre não retornou access_token válido.");
  }
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : null;
  const tokenType = typeof payload.token_type === "string" ? payload.token_type.trim() : null;
  const scopeText = typeof payload.scope === "string" ? payload.scope.trim() : null;
  const expiresIn = Number(payload.expires_in);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : new Date(Date.now() + 6 * 60 * 60 * 1000);

  const accountId =
    payload.user_id !== undefined && payload.user_id !== null ? String(payload.user_id).trim() : null;
  const accountName = typeof payload.nickname === "string" ? payload.nickname.trim() : null;

  return {
    accessToken,
    refreshToken,
    tokenType,
    scopeText,
    expiresAt,
    accountId: accountId || null,
    accountName: accountName || null,
    raw: payload,
  };
};

const buildShopeeAuthorizationHeader = (
  appId: string,
  clientSecret: string,
  payload: string,
): string => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHash("sha256")
    .update(`${appId}${timestamp}${payload}${clientSecret}`)
    .digest("hex");
  return `SHA256 Credential=${appId},Timestamp=${timestamp},Signature=${signature}`;
};

const validateShopeeOpenApiCredentials = async (
  appId: string,
  clientSecret: string,
): Promise<void> => {
  const query = `
    query ValidateShopeeCredentials($keyword: String!) {
      productOfferV2(keyword: $keyword, page: 1, limit: 1, listType: 0, sortType: 2) {
        pageInfo {
          page
          limit
        }
      }
    }
  `;
  const payload = JSON.stringify({
    query,
    variables: {
      keyword: "teste",
    },
  });
  const authorization = buildShopeeAuthorizationHeader(appId, clientSecret, payload);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPEE_VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetch(SHOPEE_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
      },
      body: payload,
      signal: controller.signal,
      cache: "no-store",
    });

    let parsed: { data?: unknown; errors?: Array<{ message?: string; extensions?: { message?: string } }> } | null =
      null;
    try {
      parsed = (await response.json()) as {
        data?: unknown;
        errors?: Array<{ message?: string; extensions?: { message?: string } }>;
      };
    } catch {
      parsed = null;
    }

    const hasErrors = Array.isArray(parsed?.errors) && parsed!.errors!.length > 0;
    const hasProductOffer =
      parsed?.data &&
      typeof parsed.data === "object" &&
      "productOfferV2" in (parsed.data as Record<string, unknown>);

    if (!response.ok || hasErrors || !hasProductOffer) {
      const firstError = hasErrors ? parsed!.errors![0] : null;
      const message =
        firstError?.extensions?.message?.trim() ||
        firstError?.message?.trim() ||
        `Falha na Open API da Shopee (HTTP ${response.status}).`;
      throw new Error(message);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Credenciais Shopee inválidas: ${error.message}`);
    }
    throw new Error("Credenciais Shopee inválidas.");
  } finally {
    clearTimeout(timeout);
  }
};

const resolveConnectionKeyForTokenPayload = async (
  userId: number,
  provider: AffiliateProviderKey,
  tokenPayload: OAuthTokenPayload,
  context: SaveProviderTokenPayloadContext,
): Promise<string> => {
  const explicitKey = sanitizeConnectionKey(context.connectionKey);
  if (explicitKey) return explicitKey;

  const accountIdKey = buildConnectionKeyFromAccountId(tokenPayload.accountId);
  if (accountIdKey) {
    const db = getDb();
    const [rows] = await db.query<AffiliateProviderConnectionRow[]>(
      `
        SELECT connection_key
        FROM ${TABLE_CONNECTIONS}
        WHERE user_id = ? AND provider = ? AND account_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [userId, provider, tokenPayload.accountId],
    );
    const existing = Array.isArray(rows) && rows.length > 0 ? sanitizeConnectionKey(rows[0]?.connection_key) : null;
    return existing || accountIdKey;
  }

  return buildRandomConnectionKey(`${provider}-oauth`);
};

const saveProviderTokenPayload = async (
  userId: number,
  provider: AffiliateProviderKey,
  tokenPayload: OAuthTokenPayload,
  context: SaveProviderTokenPayloadContext = {},
): Promise<void> => {
  await ensureAffiliateTables();
  const db = getDb();
  const metadata = JSON.stringify(sanitizeTokenRawPayload(tokenPayload.raw));
  const connectionKey = await resolveConnectionKeyForTokenPayload(userId, provider, tokenPayload, context);

  const selectThis = context.select !== false;

  if (selectThis) {
    await db.query(
      `
        UPDATE ${TABLE_CONNECTIONS}
        SET is_selected = 0
        WHERE user_id = ? AND provider = ?
      `,
      [userId, provider],
    );
  }

  await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_CONNECTIONS} (
        user_id,
        provider,
        connection_key,
        account_id,
        account_name,
        access_token,
        refresh_token,
        token_type,
        scope_text,
        expires_at,
        last_error,
        metadata_json,
        is_active,
        is_selected,
        provider_app_id,
        provider_client_secret,
        provider_app_token,
        connected_at,
        last_refresh_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, NULL, NULL, NULL, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        account_id = VALUES(account_id),
        account_name = CASE
          WHEN ? = 1 AND (VALUES(account_name) IS NULL OR VALUES(account_name) = '')
            THEN account_name
          ELSE VALUES(account_name)
        END,
        access_token = VALUES(access_token),
        refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
        token_type = VALUES(token_type),
        scope_text = VALUES(scope_text),
        expires_at = VALUES(expires_at),
        last_error = NULL,
        metadata_json = VALUES(metadata_json),
        is_active = 1,
        is_selected = VALUES(is_selected),
        last_refresh_at = NOW(),
        connected_at = COALESCE(connected_at, NOW())
    `,
    [
      userId,
      provider,
      connectionKey,
      tokenPayload.accountId,
      tokenPayload.accountName,
      tokenPayload.accessToken,
      tokenPayload.refreshToken,
      tokenPayload.tokenType,
      tokenPayload.scopeText,
      tokenPayload.expiresAt,
      metadata,
      selectThis ? 1 : 0,
      context.preserveAccountName ? 1 : 0,
    ],
  );

  await ensureSelectedConnectionInvariant(userId, provider);
};

const saveProviderErrorByConnectionId = async (
  userId: number,
  provider: AffiliateProviderKey,
  connectionId: number,
  errorMessage: string,
): Promise<void> => {
  await ensureAffiliateTables();
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_CONNECTIONS}
      SET last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND provider = ?
    `,
    [errorMessage.slice(0, 4000), connectionId, userId, provider],
  );
};

const cleanupExpiredOAuthStates = async (): Promise<void> => {
  await ensureAffiliateTables();
  const db = getDb();
  await db.query(
    `
      DELETE FROM ${TABLE_OAUTH_STATES}
      WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)
         OR consumed_at < DATE_SUB(NOW(), INTERVAL 1 DAY)
    `,
  );
};

const createOAuthState = async (
  userId: number,
  provider: AffiliateProviderKey,
  returnTo: string,
  metadata: OAuthStateMetadata = {},
): Promise<{ state: string; expiresAt: Date }> => {
  await ensureAffiliateTables();
  await cleanupExpiredOAuthStates();

  const db = getDb();
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60 * 1000);

  const serializedMetadata = JSON.stringify({
    connectionKey: sanitizeConnectionKey(metadata.connectionKey),
    redirectUri: sanitizeHttpUrl(metadata.redirectUri),
  });

  await db.query(
    `
      INSERT INTO ${TABLE_OAUTH_STATES} (state_token, provider, user_id, return_to, expires_at, consumed_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `,
    [state, provider, userId, sanitizeReturnTo(returnTo), expiresAt, serializedMetadata],
  );

  return { state, expiresAt };
};

const consumeOAuthState = async (
  provider: AffiliateProviderKey,
  state: string,
): Promise<AffiliateOAuthStateRow> => {
  await ensureAffiliateTables();
  const db = getDb();
  const [rows] = await db.query<AffiliateOAuthStateRow[]>(
    `
      SELECT *
      FROM ${TABLE_OAUTH_STATES}
      WHERE state_token = ? AND provider = ?
      LIMIT 1
    `,
    [state, provider],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Estado OAuth inválido ou não encontrado.");
  }
  const row = rows[0];
  if (row.consumed_at) {
    throw new Error("Essa autorização já foi utilizada.");
  }

  const expiresAt = normalizeDate(row.expires_at);
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    await db.query(
      `
        UPDATE ${TABLE_OAUTH_STATES}
        SET consumed_at = NOW()
        WHERE id = ? AND consumed_at IS NULL
      `,
      [row.id],
    );
    throw new Error("Autorização expirada. Inicie a conexão novamente.");
  }

  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE ${TABLE_OAUTH_STATES}
      SET consumed_at = NOW()
      WHERE id = ? AND consumed_at IS NULL
    `,
    [row.id],
  );
  if (Number(result.affectedRows) < 1) {
    throw new Error("Essa autorização já foi utilizada.");
  }

  return row;
};

const exchangeAuthorizationCode = async (
  provider: AffiliateProviderKey,
  code: string,
  options: { redirectUri?: string | null } = {},
): Promise<OAuthTokenPayload> => {
  const config = await getOAuthConfigForProvider(provider);
  const redirectUri = sanitizeHttpUrl(options.redirectUri ?? null) || config.redirectUri;

  return await requestOAuthToken(provider, {
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
  });
};

const refreshAccessTokenByRow = async (
  provider: AffiliateProviderKey,
  row: AffiliateProviderConnectionRow,
): Promise<OAuthTokenPayload> => {
  const config = await getOAuthConfigForProvider(provider);
  const refreshToken = String(row.refresh_token || "").trim();
  if (!refreshToken) {
    throw new Error("Refresh token nao disponivel. Reconecte sua conta.");
  }

  return await requestOAuthToken(provider, {
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  });
};

const resolveTargetConnectionRow = async (
  userId: number,
  provider: AffiliateProviderKey,
  options: { connectionId?: number | null } = {},
): Promise<AffiliateProviderConnectionRow | null> => {
  if (Number.isFinite(Number(options.connectionId)) && Number(options.connectionId) > 0) {
    return fetchProviderConnectionRowById(userId, provider, Math.floor(Number(options.connectionId)));
  }
  const rows = await fetchProviderConnectionRows(userId, provider);
  return pickSelectedConnectionRow(rows);
};

const selectConnectionByIdInternal = async (
  userId: number,
  provider: AffiliateProviderKey,
  connectionId: number,
): Promise<void> => {
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_CONNECTIONS}
      SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ?
    `,
    [connectionId, userId, provider],
  );
};

export const listAffiliateProvidersForUser = async (userId: number): Promise<AffiliateProviderSummary[]> => {
  try {
    await ensureAffiliateTables();
    const db = getDb();
    const [rows] = await db.query<AffiliateProviderConnectionRow[]>(
      `
        SELECT *
        FROM ${TABLE_CONNECTIONS}
        WHERE user_id = ?
        ORDER BY provider ASC, is_selected DESC, is_active DESC, updated_at DESC, id DESC
      `,
      [userId],
    );

    const byProvider = new Map<AffiliateProviderKey, AffiliateProviderConnectionRow[]>();
    for (const row of rows || []) {
      const provider = resolveProvider(row.provider);
      if (!provider) continue;
      const bucket = byProvider.get(provider) || [];
      bucket.push(row);
      byProvider.set(provider, bucket);
    }

    const runtimeConfigMap = await getAffiliateProviderRuntimeConfigMap();
    return AFFILIATE_PROVIDER_ORDER.map((providerKey) =>
      rowToProviderSummary(
        providerKey,
        byProvider.get(providerKey) || [],
        (() => {
          const runtime = runtimeConfigMap.get(providerKey);
          if (!runtime) return null;
          return {
            enabled: runtime.enabled,
            appId: runtime.appId,
            clientSecret: runtime.clientSecret,
          };
        })(),
      ),
    );
  } catch (error) {
    console.error("[affiliate-connections] listAffiliateProvidersForUser failed, using fallback:", error);
    let runtimeConfigMap: Awaited<ReturnType<typeof getAffiliateProviderRuntimeConfigMap>> | null = null;
    try {
      runtimeConfigMap = await getAffiliateProviderRuntimeConfigMap();
    } catch {
      runtimeConfigMap = null;
    }
    return AFFILIATE_PROVIDER_ORDER.map((providerKey) => {
      const runtime = runtimeConfigMap?.get(providerKey) || null;
      return buildProviderSummaryFallback(providerKey, runtime
        ? {
            enabled: runtime.enabled,
            appId: runtime.appId,
            clientSecret: runtime.clientSecret,
          }
        : null);
    });
  }
};

export const getAffiliateProviderSummaryForUser = async (
  userId: number,
  providerRaw: string,
): Promise<AffiliateProviderSummary> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }
  const all = await listAffiliateProvidersForUser(userId);
  const found = all.find((entry) => entry.provider === provider);
  if (!found) {
    throw new Error("Provedor inválido.");
  }
  return found;
};

export const createAffiliateOAuthAuthorizationUrl = async (
  userId: number,
  providerRaw: string,
  returnTo?: string | null,
  options: { redirectUriOrigin?: string | null } = {},
): Promise<AffiliateOAuthStartResult> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }
  const definition = AFFILIATE_PROVIDER_CATALOG[provider];
  if (!definition.supportsOAuth) {
    throw new Error("Esse provedor ainda não possui conexão OAuth.");
  }
  if (!definition.implemented) {
    throw new Error("Esse provedor ainda está em desenvolvimento.");
  }
  const config = await getOAuthConfigForProvider(provider);
  const redirectUri = resolveOAuthRedirectUri(config.redirectUri, options.redirectUriOrigin);

  const targetReturn = sanitizeReturnTo(
    returnTo || `/dashboard/user?section=affiliates&provider=${encodeURIComponent(provider)}`,
  );
  const { state, expiresAt } = await createOAuthState(userId, provider, targetReturn, {
    redirectUri,
  });

  const authUrl = new URL(config.authEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  if (config.defaultScopes.length > 0) {
    authUrl.searchParams.set("scope", config.defaultScopes.join(" "));
  }

  return {
    provider,
    authorizationUrl: authUrl.toString(),
    stateExpiresAt: expiresAt.toISOString(),
  };
};

export const completeAffiliateOAuthCallback = async (
  providerRaw: string,
  params: {
    state: string;
    code: string;
  },
): Promise<{ userId: number; provider: AffiliateProviderKey; returnTo: string; summary: AffiliateProviderSummary }> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }

  const stateValue = String(params.state || "").trim();
  const codeValue = String(params.code || "").trim();
  if (!stateValue || !codeValue) {
    throw new Error("Parâmetros OAuth inválidos.");
  }

  const stateRow = await consumeOAuthState(provider, stateValue);
  const metadata = parseOAuthStateMetadata(stateRow.metadata_json);
  const tokenPayload = await exchangeAuthorizationCode(provider, codeValue, {
    redirectUri: metadata.redirectUri,
  });
  await saveProviderTokenPayload(Number(stateRow.user_id), provider, tokenPayload, {
    connectionKey: metadata.connectionKey,
    select: true,
  });

  const summary = await getAffiliateProviderSummaryForUser(Number(stateRow.user_id), provider);
  return {
    userId: Number(stateRow.user_id),
    provider,
    returnTo: sanitizeReturnTo(stateRow.return_to),
    summary,
  };
};

export const disconnectAffiliateProviderForUser = async (
  userId: number,
  providerRaw: string,
  options: { connectionId?: number | null } = {},
): Promise<AffiliateProviderSummary> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }

  await ensureAffiliateTables();
  const targetRow = await resolveTargetConnectionRow(userId, provider, options);
  if (!targetRow) {
    return getAffiliateProviderSummaryForUser(userId, provider);
  }

  const db = getDb();
  await db.query(
    `
      DELETE FROM ${TABLE_CONNECTIONS}
      WHERE id = ? AND user_id = ? AND provider = ?
    `,
    [targetRow.id, userId, provider],
  );

  await ensureSelectedConnectionInvariant(userId, provider);
  return getAffiliateProviderSummaryForUser(userId, provider);
};

export const selectAffiliateProviderConnectionForUser = async (
  userId: number,
  providerRaw: string,
  connectionIdRaw: number,
): Promise<AffiliateProviderSummary> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }

  const connectionId = Math.floor(Number(connectionIdRaw));
  if (!Number.isFinite(connectionId) || connectionId <= 0) {
    throw new Error("Conta inválida para seleção.");
  }

  const row = await fetchProviderConnectionRowById(userId, provider, connectionId);
  if (!row) {
    throw new Error("Conta não encontrada para este provedor.");
  }

  await selectConnectionByIdInternal(userId, provider, connectionId);
  return getAffiliateProviderSummaryForUser(userId, provider);
};

export const upsertAffiliateProviderCredentialsForUser = async (
  userId: number,
  providerRaw: string,
  payload: {
    appId?: unknown;
    clientSecret?: unknown;
    appToken?: unknown;
    accountName?: unknown;
    connectionId?: unknown;
    select?: unknown;
  },
): Promise<AffiliateProviderSummary> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }

  const definition = AFFILIATE_PROVIDER_CATALOG[provider];
  if (definition.supportsOAuth) {
    throw new Error("Este provedor usa OAuth. Conecte usando o botão de autenticação.");
  }

  await ensureAffiliateTables();
  const db = getDb();

  const requestedAppId = readText(payload.appId);
  const connectionId = Number(payload.connectionId);
  const explicitConnectionId = Number.isFinite(connectionId) && connectionId > 0 ? Math.floor(connectionId) : null;

  let targetRow: AffiliateProviderConnectionRow | null = null;
  if (explicitConnectionId !== null) {
    targetRow = await fetchProviderConnectionRowById(userId, provider, explicitConnectionId);
    if (!targetRow) {
      throw new Error("Conta informada não encontrada para atualização.");
    }
  }

  if (!targetRow) {
    const [byAppRows] = await db.query<AffiliateProviderConnectionRow[]>(
      `
        SELECT *
        FROM ${TABLE_CONNECTIONS}
        WHERE user_id = ? AND provider = ? AND provider_app_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [userId, provider, requestedAppId],
    );
    targetRow = Array.isArray(byAppRows) && byAppRows.length > 0 ? byAppRows[0] : null;
  }

  // Editing an already connected account may intentionally leave the secret
  // fields blank (the UI never receives plaintext credentials back). Resolve
  // the stored values before validating so an edit only changes the fields
  // the user actually supplied.
  const appId = readText(payload.appId) || readText(targetRow?.provider_app_id);
  const clientSecret = readText(payload.clientSecret) || readText(targetRow?.provider_client_secret);
  if (!appId || !clientSecret) {
    throw new Error("Informe AppID e Senha/Secret da conta para salvar.");
  }

  if (provider === "shopee" && (!targetRow || readText(payload.appId) || readText(payload.clientSecret))) {
    await validateShopeeOpenApiCredentials(appId, clientSecret);
  }

  const connectionKey =
    sanitizeConnectionKey(targetRow?.connection_key) ||
    sanitizeConnectionKey(appId) ||
    buildRandomConnectionKey(`${provider}-account`);

  const selected = payload.select === undefined ? true : Boolean(payload.select);
  const accountName = readText(payload.accountName) || (targetRow ? readText(targetRow.account_name) : null) || `Conta ${provider}`;
  const accountId = readText(targetRow?.account_id) || appId;
  const appToken = readText(payload.appToken) || readText(targetRow?.provider_app_token) || null;

  if (selected) {
    await db.query(
      `
        UPDATE ${TABLE_CONNECTIONS}
        SET is_selected = 0
        WHERE user_id = ? AND provider = ?
      `,
      [userId, provider],
    );
  }

  await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_CONNECTIONS} (
        user_id,
        provider,
        connection_key,
        account_id,
        account_name,
        access_token,
        refresh_token,
        token_type,
        scope_text,
        expires_at,
        last_error,
        metadata_json,
        is_active,
        is_selected,
        provider_app_id,
        provider_client_secret,
        provider_app_token,
        connected_at,
        last_refresh_at
      )
      VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        account_id = VALUES(account_id),
        account_name = VALUES(account_name),
        provider_app_id = VALUES(provider_app_id),
        provider_client_secret = VALUES(provider_client_secret),
        provider_app_token = VALUES(provider_app_token),
        last_error = NULL,
        is_active = 1,
        is_selected = VALUES(is_selected),
        updated_at = CURRENT_TIMESTAMP,
        connected_at = COALESCE(connected_at, NOW())
    `,
    [
      userId,
      provider,
      connectionKey,
      accountId,
      accountName,
      selected ? 1 : 0,
      appId,
      clientSecret,
      appToken,
    ],
  );

  await ensureSelectedConnectionInvariant(userId, provider);
  return getAffiliateProviderSummaryForUser(userId, provider);
};

export const refreshAffiliateProviderTokenForUser = async (
  userId: number,
  providerRaw: string,
  options: { connectionId?: number | null } = {},
): Promise<AffiliateProviderSummary> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }

  const definition = AFFILIATE_PROVIDER_CATALOG[provider];
  if (!definition.supportsOAuth) {
    throw new Error("Este provedor não usa token OAuth para atualização.");
  }

  const row = await resolveTargetConnectionRow(userId, provider, options);
  if (!row || !row.is_active) {
    throw new Error("Nenhuma conta conectada para este provedor.");
  }

  try {
    const tokenPayload = await refreshAccessTokenByRow(provider, row);
    await saveProviderTokenPayload(userId, provider, tokenPayload, {
      preserveAccountName: true,
      connectionKey: row.connection_key,
      select: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao atualizar token.";
    await saveProviderErrorByConnectionId(userId, provider, Number(row.id), message);
    throw error;
  }

  return getAffiliateProviderSummaryForUser(userId, provider);
};

export const getValidAffiliateAccessToken = async (
  userId: number,
  providerRaw: string,
  options: { forceRefresh?: boolean; connectionId?: number | null } = {},
): Promise<string> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }

  const row = await resolveTargetConnectionRow(userId, provider, options);
  if (!row || !row.is_active) {
    throw new Error("Conecte sua conta de afiliado no painel para continuar.");
  }

  const forceRefresh = Boolean(options.forceRefresh);
  const accessToken = String(row.access_token || "").trim();
  const expiresAt = normalizeDate(row.expires_at);
  const expiresSoon =
    !expiresAt || expiresAt.getTime() <= Date.now() + TOKEN_EXPIRY_SAFETY_SECONDS * 1000;

  if (!forceRefresh && accessToken && !expiresSoon) {
    return accessToken;
  }

  const refreshKey = `${userId}:${provider}:${row.id}`;
  const activeRefresh = refreshTaskMap.get(refreshKey);
  if (activeRefresh) {
    return activeRefresh;
  }

  const refreshTask = (async () => {
    try {
      const refreshed = await refreshAffiliateProviderTokenForUser(userId, provider, {
        connectionId: Number(row.id),
      });
      const nextRow = await fetchProviderConnectionRowById(userId, provider, Number(row.id));
      const nextAccessToken = String(nextRow?.access_token || "").trim();
      if (!refreshed.connected || !nextAccessToken) {
        throw new Error("Não foi possível renovar a autenticação da conta afiliada.");
      }
      return nextAccessToken;
    } finally {
      refreshTaskMap.delete(refreshKey);
    }
  })();

  refreshTaskMap.set(refreshKey, refreshTask);
  return refreshTask;
};

export const getAffiliateProviderSelectedCredentialForUser = async (
  userId: number,
  providerRaw: string,
): Promise<{
  connectionId: number;
  accountId: string | null;
  accountName: string | null;
  appId: string | null;
  clientSecret: string | null;
  appToken: string | null;
} | null> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) return null;

  const row = await resolveTargetConnectionRow(userId, provider);
  if (!row || !row.is_active) return null;

  const appId = readText(row.provider_app_id);
  const clientSecret = readText(row.provider_client_secret);

  return {
    connectionId: Number(row.id),
    accountId: readText(row.account_id),
    accountName: readText(row.account_name),
    appId,
    clientSecret,
    appToken: readText(row.provider_app_token),
  };
};

export const isAffiliateProviderEnabled = async (providerRaw: string): Promise<boolean> => {
  const provider = resolveProvider(providerRaw);
  if (!provider) return false;
  const runtime = await getAffiliateProviderRuntimeConfig(provider);
  return runtime.enabled;
};
