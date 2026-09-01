import { ResultSetHeader } from "mysql2";

import { normalizeUserRole } from "lib/auth";
import type {
  AdminBotInterageTtsAllowedUser,
  AdminBotInterageTtsConfig,
  AdminBotInterageTtsConfigPayload,
  BotInterageTtsRuntimeConfig,
} from "types/botinterage-tts";
import {
  AdminBotInterageTtsConfigRow,
  ensureAdminBotInterageTtsConfigTables,
  getDb,
} from "./db";

const DEFAULT_BASE_URL = "";
const CACHE_TTL_MS = 60_000;

type AllowedUserRow = {
  user_id: number;
  created_at: Date | string;
  name: string;
  email: string | null;
  role: string | null;
  is_active: number;
};

export class BotInterageTtsConfigError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BotInterageTtsConfigError";
    this.status = status;
  }
}

const hasOwn = <T extends object>(obj: T, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const parseBoolean = (value: unknown): boolean =>
  value === true || value === "true" || value === 1 || value === "1";

const sanitizeOptionalUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    throw new BotInterageTtsConfigError("A URL da API TTS é muito longa.");
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new BotInterageTtsConfigError("Informe uma URL válida (http/https) para a API TTS.");
  }

  return trimmed;
};

const sanitizeOptionalToken = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 4000) {
    throw new BotInterageTtsConfigError("O token da API TTS é muito longo.");
  }
  return trimmed;
};

const sanitizeOptionalVoiceId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 190) {
    throw new BotInterageTtsConfigError("O voice_id padrão é muito longo.");
  }
  return trimmed;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const mapRowToConfig = (row: AdminBotInterageTtsConfigRow | null): AdminBotInterageTtsConfig => ({
  enabled: Boolean(row?.enabled),
  baseUrl: row?.api_base_url ?? DEFAULT_BASE_URL,
  hasToken: Boolean(row?.api_token && row.api_token.trim().length > 0),
  defaultVoiceId: row?.default_voice_id?.trim() || null,
  updatedAt: toIso(row?.updated_at ?? null),
});

const mapRowToRuntimeConfig = (
  row: AdminBotInterageTtsConfigRow | null,
): BotInterageTtsRuntimeConfig => ({
  enabled: Boolean(row?.enabled),
  baseUrl: (row?.api_base_url && row.api_base_url.trim()) || DEFAULT_BASE_URL,
  token: row?.api_token ?? null,
  defaultVoiceId: row?.default_voice_id?.trim() || null,
});

let runtimeCache: { expiresAt: number; value: BotInterageTtsRuntimeConfig } | null = null;
const userAllowedCache = new Map<number, { expiresAt: number; allowed: boolean }>();

const invalidateRuntimeCache = () => {
  runtimeCache = null;
};

const invalidateAllowedUserCache = (userId?: number) => {
  if (typeof userId === "number") {
    userAllowedCache.delete(userId);
    return;
  }
  userAllowedCache.clear();
};

const loadConfigRow = async (): Promise<AdminBotInterageTtsConfigRow | null> => {
  await ensureAdminBotInterageTtsConfigTables();
  const db = getDb();
  const [rows] = await db.query<AdminBotInterageTtsConfigRow[]>(
    `SELECT * FROM admin_botinterage_tts_config WHERE id = 1 LIMIT 1`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

export const getAdminBotInterageTtsConfig = async (): Promise<AdminBotInterageTtsConfig> => {
  const row = await loadConfigRow();
  return mapRowToConfig(row);
};

export const getBotInterageTtsRuntimeConfig = async (): Promise<BotInterageTtsRuntimeConfig> => {
  // The private/Fish TTS provider was retired. Bot commands use TikTok TTS.
  return { enabled: false, baseUrl: null, token: null, defaultVoiceId: null };
};

export const saveAdminBotInterageTtsConfig = async (
  payload: AdminBotInterageTtsConfigPayload,
): Promise<AdminBotInterageTtsConfig> => {
  void payload;
  throw new BotInterageTtsConfigError(
    "A API privada de TTS foi desativada. O BotInterage usa TikTok TTS.",
    410,
  );

  await ensureAdminBotInterageTtsConfigTables();
  const db = getDb();

  const currentRow = await loadConfigRow();

  let enabled = Boolean(currentRow?.enabled);
  if (hasOwn(payload, "enabled")) {
    enabled = parseBoolean(payload.enabled);
  }

  let baseUrl = currentRow?.api_base_url ?? DEFAULT_BASE_URL;
  if (hasOwn(payload, "baseUrl")) {
    baseUrl = sanitizeOptionalUrl(payload.baseUrl) ?? DEFAULT_BASE_URL;
  }

  const clearToken = parseBoolean(payload.clearToken);
  const tokenProvided = hasOwn(payload, "token");
  if (clearToken && tokenProvided) {
    throw new BotInterageTtsConfigError(
      "Selecione apenas uma opção: limpar ou informar um novo token.",
    );
  }

  let apiToken = currentRow?.api_token ?? null;
  if (clearToken) {
    apiToken = null;
  } else if (tokenProvided) {
    apiToken = sanitizeOptionalToken(payload.token);
    if (!apiToken) {
      throw new BotInterageTtsConfigError("Informe um token válido da API TTS.");
    }
  }

  let defaultVoiceId = currentRow?.default_voice_id?.trim() || null;
  if (hasOwn(payload, "defaultVoiceId")) {
    defaultVoiceId = sanitizeOptionalVoiceId(payload.defaultVoiceId);
  }

  await db.query(
    `
      UPDATE admin_botinterage_tts_config
      SET enabled = ?, api_base_url = ?, api_token = ?, default_voice_id = ?
      WHERE id = 1
    `,
    [enabled ? 1 : 0, baseUrl, apiToken, defaultVoiceId],
  );

  invalidateRuntimeCache();
  return getAdminBotInterageTtsConfig();
};

export const listBotInterageTtsAllowedUsers = async (): Promise<AdminBotInterageTtsAllowedUser[]> => {
  await ensureAdminBotInterageTtsConfigTables();
  const db = getDb();

  const [rows] = await db.query<AllowedUserRow[]>(
    `
      SELECT
        abu.user_id,
        abu.created_at,
        u.name,
        u.email,
        u.role,
        u.is_active
      FROM admin_botinterage_tts_users abu
      INNER JOIN users u ON u.id = abu.user_id
      ORDER BY abu.created_at DESC
    `,
  );

  return rows.map((row) => ({
    userId: Number(row.user_id),
    name: row.name,
    email: row.email ?? null,
    role: normalizeUserRole(row.role),
    isActive: Boolean(row.is_active),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  }));
};

export const addBotInterageTtsAllowedUser = async (
  userId: number,
): Promise<AdminBotInterageTtsAllowedUser> => {
  await ensureAdminBotInterageTtsConfigTables();
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new BotInterageTtsConfigError("Usuário inválido.");
  }

  const db = getDb();

  const [existingUserRows] = await db.query<
    { id: number; name: string; email: string | null; role: string | null; is_active: number }[]
  >(
    `
      SELECT id, name, email, role, is_active
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId],
  );

  if (!Array.isArray(existingUserRows) || existingUserRows.length === 0) {
    throw new BotInterageTtsConfigError("Usuário não encontrado.", 404);
  }

  await db.query<ResultSetHeader>(
    `
      INSERT INTO admin_botinterage_tts_users (user_id)
      VALUES (?)
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), updated_at = CURRENT_TIMESTAMP
    `,
    [userId],
  );

  invalidateAllowedUserCache(userId);

  const row = existingUserRows[0];
  return {
    userId: row.id,
    name: row.name,
    email: row.email ?? null,
    role: normalizeUserRole(row.role),
    isActive: Boolean(row.is_active),
    createdAt: new Date().toISOString(),
  };
};

export const removeBotInterageTtsAllowedUser = async (userId: number): Promise<boolean> => {
  await ensureAdminBotInterageTtsConfigTables();
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new BotInterageTtsConfigError("Usuário inválido.");
  }

  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      DELETE FROM admin_botinterage_tts_users
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId],
  );

  invalidateAllowedUserCache(userId);
  return Number(result.affectedRows || 0) > 0;
};

export const isUserAllowedBotInterageTts = async (userId: number): Promise<boolean> => {
  void userId;
  return false;
};

export const resetBotInterageTtsConfigCaches = () => {
  invalidateRuntimeCache();
  invalidateAllowedUserCache();
};
