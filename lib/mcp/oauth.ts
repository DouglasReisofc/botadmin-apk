import { createHash, randomBytes } from "crypto";

import { redisDel, redisGetJson, redisKey, redisSetJson } from "lib/redis";

type BotAdminMcpOAuthCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256" | "plain";
  scope: string;
  mode: "public" | "full";
  createdAt: string;
};

export type BotAdminMcpOAuthToken = {
  clientId: string;
  scope: string;
  mode: "public" | "full";
  createdAt: string;
};

declare global {
  var __botadminMcpOAuthCodes: Map<string, { expiresAt: number; value: BotAdminMcpOAuthCode }> | undefined;
  var __botadminMcpOAuthTokens: Map<string, { expiresAt: number; value: BotAdminMcpOAuthToken }> | undefined;
}

const CODE_TTL_MS = 5 * 60_000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const DEFAULT_CLIENT_ID = "botadmin-mcp";
const DEFAULT_SCOPE = "mcp:public";

const codeStore = globalThis.__botadminMcpOAuthCodes ?? new Map<string, { expiresAt: number; value: BotAdminMcpOAuthCode }>();
const tokenStore = globalThis.__botadminMcpOAuthTokens ?? new Map<string, { expiresAt: number; value: BotAdminMcpOAuthToken }>();
globalThis.__botadminMcpOAuthCodes = codeStore;
globalThis.__botadminMcpOAuthTokens = tokenStore;

const base64Url = (buffer: Buffer) => buffer.toString("base64url");

const sha256Base64Url = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const cleanupMemoryStore = <T>(store: Map<string, { expiresAt: number; value: T }>) => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
};

const normalizeScope = (scope: string | null | undefined) =>
  String(scope ?? "")
    .split(/\s+/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(" ") || DEFAULT_SCOPE;

export const getBotAdminMcpOAuthClientId = () =>
  process.env.BOTADMIN_MCP_OAUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;

export const getBotAdminMcpOAuthClientSecret = () =>
  process.env.BOTADMIN_MCP_OAUTH_CLIENT_SECRET?.trim() || null;

export const isValidBotAdminMcpOAuthClient = (clientId: string | null | undefined) =>
  String(clientId ?? "").trim() === getBotAdminMcpOAuthClientId();

export const resolveBotAdminMcpOAuthMode = (scope: string, clientSecret: string | null | undefined) => {
  const normalizedScope = normalizeScope(scope);
  const configuredSecret = getBotAdminMcpOAuthClientSecret();
  const requestedFull = normalizedScope.split(/\s+/g).includes("mcp:full");
  if (!requestedFull) {
    return "public" as const;
  }
  if (configuredSecret && clientSecret === configuredSecret) {
    return "full" as const;
  }
  return null;
};

export const createBotAdminMcpOAuthCode = async (input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256" | "plain";
  scope?: string | null;
  clientSecret?: string | null;
}) => {
  const scope = normalizeScope(input.scope);
  const mode = resolveBotAdminMcpOAuthMode(scope, input.clientSecret);
  if (!mode) {
    throw new Error("Scope mcp:full requer client secret valido.");
  }

  const code = base64Url(randomBytes(32));
  const value: BotAdminMcpOAuthCode = {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    scope,
    mode,
    createdAt: new Date().toISOString(),
  };
  codeStore.set(code, { expiresAt: Date.now() + CODE_TTL_MS, value });
  await redisSetJson(redisKey("mcp", "oauth", "code", code), value, CODE_TTL_MS);
  return code;
};

export const exchangeBotAdminMcpOAuthCode = async (input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}) => {
  cleanupMemoryStore(codeStore);
  const codeKey = redisKey("mcp", "oauth", "code", input.code);
  const fromRedis = await redisGetJson<BotAdminMcpOAuthCode>(codeKey);
  const fromMemory = codeStore.get(input.code)?.value ?? null;
  const code = fromRedis ?? fromMemory;
  await redisDel(codeKey);
  codeStore.delete(input.code);

  if (!code) {
    throw new Error("Authorization code invalido ou expirado.");
  }
  if (code.clientId !== input.clientId) {
    throw new Error("Client ID invalido para este authorization code.");
  }
  if (code.redirectUri !== input.redirectUri) {
    throw new Error("Redirect URI invalido para este authorization code.");
  }

  const expectedChallenge = code.codeChallengeMethod === "S256"
    ? sha256Base64Url(input.codeVerifier)
    : input.codeVerifier;
  if (expectedChallenge !== code.codeChallenge) {
    throw new Error("PKCE code verifier invalido.");
  }

  const accessToken = base64Url(randomBytes(48));
  const token: BotAdminMcpOAuthToken = {
    clientId: code.clientId,
    scope: code.scope,
    mode: code.mode,
    createdAt: new Date().toISOString(),
  };
  const hashed = tokenHash(accessToken);
  tokenStore.set(hashed, { expiresAt: Date.now() + TOKEN_TTL_MS, value: token });
  await redisSetJson(redisKey("mcp", "oauth", "token", hashed), token, TOKEN_TTL_MS);

  return {
    accessToken,
    expiresIn: Math.floor(TOKEN_TTL_MS / 1000),
    token,
  };
};

export const validateBotAdminMcpOAuthAccessToken = async (
  accessToken: string | null | undefined,
): Promise<BotAdminMcpOAuthToken | null> => {
  const token = String(accessToken ?? "").trim();
  if (!token) return null;

  cleanupMemoryStore(tokenStore);
  const hashed = tokenHash(token);
  const fromRedis = await redisGetJson<BotAdminMcpOAuthToken>(redisKey("mcp", "oauth", "token", hashed));
  if (fromRedis) return fromRedis;
  return tokenStore.get(hashed)?.value ?? null;
};
