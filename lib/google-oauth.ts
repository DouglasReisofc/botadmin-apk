import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { RowDataPacket } from "mysql2/promise";

import { ensureUserTable, getDb } from "lib/db";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleOAuthPurpose = "login" | "sheets";

type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleProfile = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

type OAuthStateRow = RowDataPacket & {
  state_hash: string;
  purpose: GoogleOAuthPurpose;
  user_id: number | null;
  return_path: string | null;
  expires_at: Date | string;
};

type GoogleSheetConnectionRow = RowDataPacket & {
  user_id: number;
  google_email: string;
  refresh_token_encrypted: string;
  scope: string | null;
  updated_at: Date | string;
};

const asText = (value: unknown, limit = 2_000) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

const publicBaseUrl = () => {
  const raw = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://botadmin.shop").trim();
  return raw.replace(/\/+$/, "");
};

const safePath = (value: unknown, fallback: string) => {
  const path = asText(value, 500);
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
};

const stateHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const encryptionKey = () => {
  const secret = (
    process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY ||
    process.env.MOBILE_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    ""
  ).trim();
  if (!secret) throw new Error("A chave para proteger tokens Google não está configurada.");
  return createHash("sha256").update(secret, "utf8").digest();
};

const encrypt = (plain: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
};

const decrypt = (encoded: string) => {
  const payload = Buffer.from(encoded, "base64");
  if (payload.length < 29) throw new Error("Token Google armazenado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
};

export const getGoogleOAuthConfig = (): GoogleOAuthConfig => {
  const clientId = asText(process.env.GOOGLE_OAUTH_CLIENT_ID, 500);
  const clientSecret = asText(process.env.GOOGLE_OAUTH_CLIENT_SECRET, 500);
  if (!clientId || !clientSecret) throw new Error("Login Google ainda não foi configurado pelo administrador.");
  return { clientId, clientSecret, redirectUri: `${publicBaseUrl()}/api/auth/google/callback` };
};

export const ensureGoogleOAuthTables = async () => {
  await ensureUserTable();
  const db = getDb();
  await db.query(`CREATE TABLE IF NOT EXISTS google_oauth_states (
    state_hash CHAR(64) PRIMARY KEY,
    purpose VARCHAR(16) NOT NULL,
    user_id INT NULL,
    return_path VARCHAR(512) NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX google_oauth_states_expiry (expires_at),
    INDEX google_oauth_states_user (user_id)
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS google_sheet_connections (
    user_id INT PRIMARY KEY,
    google_email VARCHAR(255) NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    scope TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX google_sheet_connections_email (google_email)
  ) ENGINE=InnoDB`);
};

export const createGoogleOAuthState = async (input: {
  purpose: GoogleOAuthPurpose;
  userId?: number | null;
  returnPath?: string | null;
}) => {
  await ensureGoogleOAuthTables();
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  await getDb().query(
    "INSERT INTO google_oauth_states (state_hash,purpose,user_id,return_path,expires_at) VALUES (?,?,?,?,?)",
    [stateHash(state), input.purpose, input.userId ?? null, safePath(input.returnPath, "/dashboard/user"), expiresAt],
  );
  return state;
};

export const consumeGoogleOAuthState = async (state: string, purpose?: GoogleOAuthPurpose) => {
  const normalized = asText(state, 500);
  if (!normalized) throw new Error("O retorno do Google não contém estado válido.");
  await ensureGoogleOAuthTables();
  const db = getDb();
  const [rows] = await db.query<OAuthStateRow[]>(
    "SELECT state_hash,purpose,user_id,return_path,expires_at FROM google_oauth_states WHERE state_hash = ? LIMIT 1",
    [stateHash(normalized)],
  );
  await db.query("DELETE FROM google_oauth_states WHERE state_hash = ?", [stateHash(normalized)]);
  const record = rows[0];
  if (!record || (purpose && record.purpose !== purpose) || new Date(record.expires_at).getTime() < Date.now()) {
    throw new Error("A solicitação Google expirou. Tente novamente.");
  }
  return { purpose: record.purpose, userId: record.user_id == null ? null : Number(record.user_id), returnPath: safePath(record.return_path, "/dashboard/user") };
};

export const googleAuthorizationUrl = (input: {
  state: string;
  scopes: string[];
  forceConsent?: boolean;
}) => {
  const config = getGoogleOAuthConfig();
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: input.scopes.join(" "),
    state: input.state,
    include_granted_scopes: "true",
  });
  if (input.forceConsent) {
    query.set("access_type", "offline");
    query.set("prompt", "consent");
  }
  return `${GOOGLE_AUTH_URL}?${query.toString()}`;
};

export const exchangeGoogleCode = async (code: string) => {
  const config = getGoogleOAuthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: asText(code, 4_000),
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || "O Google não autorizou esta conexão.");
  }
  return payload;
};

export const googleProfile = async (accessToken: string) => {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const profile = await response.json().catch(() => ({})) as GoogleProfile;
  const email = asText(profile.email, 255).toLowerCase();
  if (!response.ok || !email || profile.email_verified !== true) {
    throw new Error("O Google não retornou um e-mail confirmado para esta conta.");
  }
  return { email, name: asText(profile.name, 255) || email.split("@")[0], picture: asText(profile.picture, 1_000) || null };
};

export const storeGoogleSheetConnection = async (input: {
  userId: number;
  email: string;
  refreshToken?: string;
  scope?: string;
}) => {
  await ensureGoogleOAuthTables();
  const db = getDb();
  const [rows] = await db.query<GoogleSheetConnectionRow[]>(
    "SELECT user_id,google_email,refresh_token_encrypted,scope,updated_at FROM google_sheet_connections WHERE user_id = ? LIMIT 1",
    [input.userId],
  );
  const refreshToken = asText(input.refreshToken, 4_000);
  const existing = rows[0];
  if (!refreshToken && !existing) throw new Error("O Google não retornou autorização permanente. Remova o acesso do BotAdmin na conta Google e tente novamente.");
  const encrypted = refreshToken ? encrypt(refreshToken) : existing.refresh_token_encrypted;
  await db.query(`INSERT INTO google_sheet_connections (user_id,google_email,refresh_token_encrypted,scope)
    VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE google_email=VALUES(google_email),refresh_token_encrypted=VALUES(refresh_token_encrypted),scope=VALUES(scope),updated_at=CURRENT_TIMESTAMP`,
    [input.userId, input.email, encrypted, asText(input.scope, 4_000) || existing?.scope || null]);
};

export const getGoogleSheetConnection = async (userId: number) => {
  await ensureGoogleOAuthTables();
  const [rows] = await getDb().query<GoogleSheetConnectionRow[]>(
    "SELECT user_id,google_email,refresh_token_encrypted,scope,updated_at FROM google_sheet_connections WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const row = rows[0];
  return row ? { email: row.google_email, scope: row.scope, updatedAt: new Date(row.updated_at).toISOString() } : null;
};

export const getGoogleSheetsAccessToken = async (userId: number) => {
  await ensureGoogleOAuthTables();
  const [rows] = await getDb().query<GoogleSheetConnectionRow[]>(
    "SELECT user_id,google_email,refresh_token_encrypted,scope,updated_at FROM google_sheet_connections WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const config = getGoogleOAuthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: decrypt(row.refresh_token_encrypted), grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || "A conexão com Google Sheets expirou. Conecte a conta novamente.");
  return payload.access_token;
};

export const deleteGoogleSheetConnection = async (userId: number) => {
  await ensureGoogleOAuthTables();
  await getDb().query("DELETE FROM google_sheet_connections WHERE user_id = ?", [userId]);
};

export const googleScopes = {
  login: ["openid", "email", "profile"],
  sheets: ["openid", "email", "profile", "https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly"],
};
