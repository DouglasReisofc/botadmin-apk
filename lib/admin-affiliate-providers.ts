import fs from "node:fs";
import path from "node:path";

import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { AFFILIATE_PROVIDER_CATALOG, AFFILIATE_PROVIDER_ORDER, resolveAffiliateProviderKey } from "lib/affiliate-provider-catalog";
import { getDb } from "lib/db";
import { getAppBaseUrl } from "lib/meta";
import type { AffiliateProviderKey } from "types/affiliates";
import type { AdminAffiliateProviderSettings, AdminAffiliateProviderUpdatePayload } from "types/admin-affiliates";

type AffiliateProviderAdminRow = RowDataPacket & {
  provider: string;
  is_enabled: number;
  app_id: string | null;
  client_secret: string | null;
  app_token: string | null;
  auth_endpoint: string | null;
  token_endpoint: string | null;
  redirect_uri: string | null;
  scope_text: string | null;
  cookie_text: string | null;
  updated_at: Date | string | null;
};

export type AffiliateProviderRuntimeConfig = {
  provider: AffiliateProviderKey;
  enabled: boolean;
  supportsOAuth: boolean;
  implemented: boolean;
  appId: string | null;
  clientSecret: string | null;
  appToken: string | null;
  authEndpoint: string | null;
  tokenEndpoint: string | null;
  redirectUri: string | null;
  scopeText: string | null;
  extractorCookieText: string | null;
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

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const parseUrl = (value: string | null): URL | null => {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isLocalhostHost = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

const resolveRedirectUri = (
  configuredRedirect: string | null,
  fallbackRedirect: string | null,
): string | null => {
  const configuredUrl = parseUrl(configuredRedirect);
  const fallbackUrl = parseUrl(fallbackRedirect);
  if (!configuredUrl) {
    return fallbackRedirect;
  }
  if (!fallbackUrl) {
    return configuredRedirect;
  }

  // Prevent stale localhost callback URLs when app base URL is public.
  if (isLocalhostHost(configuredUrl.hostname) && !isLocalhostHost(fallbackUrl.hostname)) {
    return fallbackRedirect;
  }
  return configuredRedirect;
};

const toNullableText = (value: unknown, max: number): string | null => {
  const normalized = readString(value);
  if (!normalized) return null;
  return normalized.slice(0, max);
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  }
  return false;
};

const pickString = (source: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = readString(source[key]);
    if (value) return value;
  }
  return null;
};

const readMeliCredentialFallback = (): { appId: string | null; clientSecret: string | null; redirectUri: string | null } => {
  const envAppId =
    readString(process.env.MELI_APP_ID) ||
    readString(process.env.MELI_CLIENT_ID) ||
    readString(process.env.MERCADO_LIVRE_APP_ID) ||
    readString(process.env.MERCADOLIVRE_APP_ID) ||
    null;
  const envClientSecret =
    readString(process.env.MELI_CLIENT_SECRET) ||
    readString(process.env.MERCADO_LIVRE_CLIENT_SECRET) ||
    readString(process.env.MERCADOLIVRE_CLIENT_SECRET) ||
    null;
  const envRedirectUri =
    readString(process.env.MELI_REDIRECT_URI) ||
    readString(process.env.MERCADO_LIVRE_REDIRECT_URI) ||
    null;

  if (envAppId && envClientSecret) {
    return {
      appId: envAppId,
      clientSecret: envClientSecret,
      redirectUri: envRedirectUri,
    };
  }

  const filePath = readString(process.env.MELI_CREDENTIAL_FILE) || path.join(process.cwd(), "storage", "meli-credentials.json");
  try {
    if (!fs.existsSync(filePath)) {
      return { appId: envAppId, clientSecret: envClientSecret, redirectUri: envRedirectUri };
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      appId: envAppId || pickString(parsed, ["clientId", "client_id", "appId", "app_id", "id"]) || null,
      clientSecret: envClientSecret || pickString(parsed, ["clientSecret", "client_secret", "secret", "appSecret"]) || null,
      redirectUri: envRedirectUri || pickString(parsed, ["redirectUri", "redirect_uri", "callback", "callbackUrl"]) || null,
    };
  } catch {
    return { appId: envAppId, clientSecret: envClientSecret, redirectUri: envRedirectUri };
  }
};

const readShopeeCredentialFallback = (): { appId: string | null; clientSecret: string | null } => {
  const envAppId =
    readString(process.env.SHOPEE_APP_ID) ||
    readString(process.env.SHOPEE_APPID) ||
    readString(process.env.SHOPEE_PARTNER_ID) ||
    null;
  const envClientSecret =
    readString(process.env.SHOPEE_CLIENT_SECRET) ||
    readString(process.env.SHOPEE_APP_SECRET) ||
    readString(process.env.SHOPEE_SECRET) ||
    null;

  if (envAppId && envClientSecret) {
    return {
      appId: envAppId,
      clientSecret: envClientSecret,
    };
  }

  const filePath =
    readString(process.env.SHOPEE_CREDENTIAL_FILE) ||
    path.join(process.cwd(), "storage", "shopee-credentials.json");
  try {
    if (!fs.existsSync(filePath)) {
      return { appId: envAppId, clientSecret: envClientSecret };
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      appId: envAppId || pickString(parsed, ["appId", "app_id", "appid", "partnerId", "partner_id", "clientId"]) || null,
      clientSecret:
        envClientSecret || pickString(parsed, ["clientSecret", "client_secret", "secret", "appSecret", "app_secret"]) || null,
    };
  } catch {
    return { appId: envAppId, clientSecret: envClientSecret };
  }
};

const ensureAdminAffiliateProvidersTable = async (): Promise<void> =>
  runEnsure("admin-affiliate-providers-table", async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_affiliate_providers (
        provider VARCHAR(64) NOT NULL PRIMARY KEY,
        is_enabled TINYINT(1) NOT NULL DEFAULT 0,
        app_id VARCHAR(191) NULL,
        client_secret TEXT NULL,
        app_token TEXT NULL,
        auth_endpoint VARCHAR(512) NULL,
        token_endpoint VARCHAR(512) NULL,
        redirect_uri VARCHAR(512) NULL,
        scope_text TEXT NULL,
        cookie_text LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    const [cookieColumnRows] = await db.query<RowDataPacket[]>(
      `SHOW COLUMNS FROM admin_affiliate_providers LIKE 'cookie_text'`,
    );
    if (!Array.isArray(cookieColumnRows) || cookieColumnRows.length === 0) {
      await db.query(`ALTER TABLE admin_affiliate_providers ADD COLUMN cookie_text LONGTEXT NULL AFTER scope_text`);
    }

    for (const provider of AFFILIATE_PROVIDER_ORDER) {
      const definition = AFFILIATE_PROVIDER_CATALOG[provider];
      await db.query(
        `
          INSERT INTO admin_affiliate_providers (
            provider,
            is_enabled,
            auth_endpoint,
            token_endpoint,
            redirect_uri,
            scope_text
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE provider = provider
        `,
        [
          provider,
          definition.enabledByDefault ? 1 : 0,
          definition.oauthDefaults?.authEndpoint ?? null,
          definition.oauthDefaults?.tokenEndpoint ?? null,
          definition.oauthDefaults?.redirectUriPath
            ? `${getAppBaseUrl()}${definition.oauthDefaults.redirectUriPath}`
            : null,
          definition.oauthDefaults?.scopeText ?? null,
        ],
      );
    }
  });

const fetchAdminRows = async (): Promise<Map<AffiliateProviderKey, AffiliateProviderAdminRow>> => {
  await ensureAdminAffiliateProvidersTable();
  const db = getDb();
  const [rows] = await db.query<AffiliateProviderAdminRow[]>(
    `
      SELECT *
      FROM admin_affiliate_providers
    `,
  );
  const map = new Map<AffiliateProviderKey, AffiliateProviderAdminRow>();
  for (const row of rows || []) {
    const provider = resolveAffiliateProviderKey(row.provider);
    if (provider) {
      map.set(provider, row);
    }
  }
  return map;
};

const rowToRuntimeConfig = (
  provider: AffiliateProviderKey,
  row: AffiliateProviderAdminRow | null,
): AffiliateProviderRuntimeConfig => {
  const definition = AFFILIATE_PROVIDER_CATALOG[provider];
  const meliFallback = provider === "mercadolivre" ? readMeliCredentialFallback() : null;
  const shopeeFallback = provider === "shopee" ? readShopeeCredentialFallback() : null;
  const fallbackRedirectUri =
    definition.oauthDefaults?.redirectUriPath != null
      ? `${getAppBaseUrl()}${definition.oauthDefaults.redirectUriPath}`
      : null;

  const appId = readString(row?.app_id) || meliFallback?.appId || shopeeFallback?.appId || null;
  const clientSecret =
    readString(row?.client_secret) || meliFallback?.clientSecret || shopeeFallback?.clientSecret || null;
  const appToken = readString(row?.app_token) || null;
  const authEndpoint = readString(row?.auth_endpoint) || definition.oauthDefaults?.authEndpoint || null;
  const tokenEndpoint = readString(row?.token_endpoint) || definition.oauthDefaults?.tokenEndpoint || null;
  const redirectUri = resolveRedirectUri(
    readString(row?.redirect_uri) || meliFallback?.redirectUri || null,
    fallbackRedirectUri,
  );
  const scopeText = readString(row?.scope_text) || definition.oauthDefaults?.scopeText || null;
  const extractorCookieText = row?.cookie_text ?? null;

  const requestedEnabled = row ? toBoolean(row.is_enabled) : definition.enabledByDefault;
  const oauthReady = !definition.supportsOAuth || (Boolean(appId && clientSecret && authEndpoint && tokenEndpoint && redirectUri));
  // Non-OAuth providers may use per-user credentials; do not hard-disable globally when
  // global env/admin credentials are absent.
  const nonOAuthReady = true;
  const enabled = definition.supportsOAuth
    ? requestedEnabled && definition.implemented && oauthReady && nonOAuthReady
    : definition.implemented && nonOAuthReady;

  return {
    provider,
    enabled,
    supportsOAuth: definition.supportsOAuth,
    implemented: definition.implemented,
    appId,
    clientSecret,
    appToken,
    authEndpoint,
    tokenEndpoint,
    redirectUri,
    scopeText,
    extractorCookieText,
  };
};

const rowToSettings = (
  provider: AffiliateProviderKey,
  row: AffiliateProviderAdminRow | null,
  runtime: AffiliateProviderRuntimeConfig,
): AdminAffiliateProviderSettings => {
  const definition = AFFILIATE_PROVIDER_CATALOG[provider];
  const requestedEnabled = row ? toBoolean(row.is_enabled) : definition.enabledByDefault;
  return {
    provider,
    label: definition.label,
    description: definition.description,
    logoUrl: definition.logoUrl,
    supportsOAuth: definition.supportsOAuth,
    implemented: definition.implemented,
    enabled: requestedEnabled,
    runtimeEnabled: runtime.enabled,
    appId: runtime.appId,
    clientSecret: runtime.clientSecret,
    appToken: runtime.appToken,
    authEndpoint: runtime.authEndpoint,
    tokenEndpoint: runtime.tokenEndpoint,
    redirectUri: runtime.redirectUri,
    scopeText: runtime.scopeText,
    extractorCookieText: runtime.extractorCookieText,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
};

export const getAffiliateProviderRuntimeConfigMap = async (): Promise<Map<AffiliateProviderKey, AffiliateProviderRuntimeConfig>> => {
  const rows = await fetchAdminRows();
  const map = new Map<AffiliateProviderKey, AffiliateProviderRuntimeConfig>();
  for (const provider of AFFILIATE_PROVIDER_ORDER) {
    map.set(provider, rowToRuntimeConfig(provider, rows.get(provider) ?? null));
  }
  return map;
};

export const getAffiliateProviderRuntimeConfig = async (
  providerRaw: string,
): Promise<AffiliateProviderRuntimeConfig> => {
  const provider = resolveAffiliateProviderKey(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }
  const rows = await fetchAdminRows();
  return rowToRuntimeConfig(provider, rows.get(provider) ?? null);
};

export const listAdminAffiliateProviderSettings = async (): Promise<AdminAffiliateProviderSettings[]> => {
  const rows = await fetchAdminRows();
  return AFFILIATE_PROVIDER_ORDER.map((provider) => {
    const row = rows.get(provider) ?? null;
    const runtime = rowToRuntimeConfig(provider, row);
    return rowToSettings(provider, row, runtime);
  });
};

export const updateAdminAffiliateProviderSettings = async (
  providerRaw: string,
  payload: AdminAffiliateProviderUpdatePayload,
): Promise<AdminAffiliateProviderSettings> => {
  const provider = resolveAffiliateProviderKey(providerRaw);
  if (!provider) {
    throw new Error("Provedor inválido.");
  }

  await ensureAdminAffiliateProvidersTable();
  const rowMap = await fetchAdminRows();
  const current = rowMap.get(provider) ?? null;
  const definition = AFFILIATE_PROVIDER_CATALOG[provider];

  const nextEnabled = payload.enabled == null
    ? current
      ? toBoolean(current.is_enabled)
      : definition.enabledByDefault
    : Boolean(payload.enabled);

  const nextAppId = payload.appId === undefined ? current?.app_id ?? null : toNullableText(payload.appId, 191);
  const nextClientSecret =
    payload.clientSecret === undefined ? current?.client_secret ?? null : toNullableText(payload.clientSecret, 4096);
  const nextAppToken = payload.appToken === undefined ? current?.app_token ?? null : toNullableText(payload.appToken, 4096);
  const nextAuthEndpoint =
    payload.authEndpoint === undefined
      ? current?.auth_endpoint ?? definition.oauthDefaults?.authEndpoint ?? null
      : toNullableText(payload.authEndpoint, 512);
  const nextTokenEndpoint =
    payload.tokenEndpoint === undefined
      ? current?.token_endpoint ?? definition.oauthDefaults?.tokenEndpoint ?? null
      : toNullableText(payload.tokenEndpoint, 512);
  const nextRedirectUri = (() => {
    const fallback =
      definition.oauthDefaults?.redirectUriPath
        ? `${getAppBaseUrl()}${definition.oauthDefaults.redirectUriPath}`
        : null;
    const currentRedirect = current?.redirect_uri ?? null;
    const requestedRedirect = payload.redirectUri === undefined
      ? currentRedirect
      : toNullableText(payload.redirectUri, 512);
    return resolveRedirectUri(requestedRedirect, fallback);
  })();
  const nextScopeText =
    payload.scopeText === undefined
      ? current?.scope_text ?? definition.oauthDefaults?.scopeText ?? null
      : toNullableText(payload.scopeText, 4000);
  const nextExtractorCookieText =
    payload.extractorCookieText === undefined
      ? current?.cookie_text ?? null
      : toNullableText(payload.extractorCookieText, 500_000);

  const db = getDb();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO admin_affiliate_providers (
        provider,
        is_enabled,
        app_id,
        client_secret,
        app_token,
        auth_endpoint,
        token_endpoint,
        redirect_uri,
        scope_text,
        cookie_text
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_enabled = VALUES(is_enabled),
        app_id = VALUES(app_id),
        client_secret = VALUES(client_secret),
        app_token = VALUES(app_token),
        auth_endpoint = VALUES(auth_endpoint),
        token_endpoint = VALUES(token_endpoint),
        redirect_uri = VALUES(redirect_uri),
        scope_text = VALUES(scope_text),
        cookie_text = VALUES(cookie_text)
    `,
    [
      provider,
      nextEnabled ? 1 : 0,
      nextAppId,
      nextClientSecret,
      nextAppToken,
      nextAuthEndpoint,
      nextTokenEndpoint,
      nextRedirectUri,
      nextScopeText,
      nextExtractorCookieText,
    ],
  );

  const afterRows = await fetchAdminRows();
  const afterRow = afterRows.get(provider) ?? null;
  const runtime = rowToRuntimeConfig(provider, afterRow);
  return rowToSettings(provider, afterRow, runtime);
};
