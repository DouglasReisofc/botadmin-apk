import { ResultSetHeader } from "mysql2";

import { normalizeUserRole } from "lib/auth";
import type {
  AdminBotInterageAllowedUser,
  AdminBotInterageConfig,
  AdminBotInterageConfigPayload,
  BotInterageRuntimeConfig,
} from "types/botinterage";
import {
  AdminBotInterageConfigRow,
  ensureAdminBotInterageConfigTables,
  getDb,
} from "./db";

const DEFAULT_MODEL = "auto";
const DEFAULT_BASE_URL = "https://chatgpt-api.botadmin.shop";
const CACHE_TTL_MS = 60_000;

type AllowedUserRow = {
  user_id: number;
  created_at: Date | string;
  name: string;
  email: string | null;
  role: string | null;
  is_active: number;
};

export class BotInterageConfigError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BotInterageConfigError";
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
    throw new BotInterageConfigError("A URL da API é muito longa.");
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new BotInterageConfigError("Informe uma URL válida (http/https) para a API.");
  }

  return trimmed;
};

const sanitizeOptionalToken = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 4000) {
    throw new BotInterageConfigError("O token da API é muito longo.");
  }
  return trimmed;
};

const sanitizeOptionalModel = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) {
    throw new BotInterageConfigError("O modelo informado é muito longo.");
  }
  return trimmed;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const mapRowToConfig = (row: AdminBotInterageConfigRow | null): AdminBotInterageConfig => ({
  enabled: Boolean(row?.enabled),
  baseUrl: row?.api_base_url ?? DEFAULT_BASE_URL,
  hasToken: Boolean(row?.api_token && row.api_token.trim().length > 0),
  model: row?.model?.trim() || DEFAULT_MODEL,
  updatedAt: toIso(row?.updated_at ?? null),
});

const mapRowToRuntimeConfig = (row: AdminBotInterageConfigRow | null): BotInterageRuntimeConfig => ({
  enabled: Boolean(row?.enabled),
  baseUrl: (row?.api_base_url && row.api_base_url.trim()) || DEFAULT_BASE_URL,
  token: row?.api_token ?? null,
  model: row?.model?.trim() || DEFAULT_MODEL,
});

let runtimeCache: { expiresAt: number; value: BotInterageRuntimeConfig } | null = null;
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

const loadConfigRow = async (): Promise<AdminBotInterageConfigRow | null> => {
  await ensureAdminBotInterageConfigTables();
  const db = getDb();
  const [rows] = await db.query<AdminBotInterageConfigRow[]>(
    `SELECT * FROM admin_botinterage_config WHERE id = 1 LIMIT 1`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

export const getAdminBotInterageConfig = async (): Promise<AdminBotInterageConfig> => {
  const row = await loadConfigRow();
  return mapRowToConfig(row);
};

export const getBotInterageRuntimeConfig = async (): Promise<BotInterageRuntimeConfig> => {
  if (runtimeCache && runtimeCache.expiresAt > Date.now()) {
    return runtimeCache.value;
  }
  const value = mapRowToRuntimeConfig(await loadConfigRow());
  runtimeCache = { expiresAt: Date.now() + CACHE_TTL_MS, value };
  return value;
};

export const saveAdminBotInterageConfig = async (
  payload: AdminBotInterageConfigPayload,
): Promise<AdminBotInterageConfig> => {
  await ensureAdminBotInterageConfigTables();
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
    throw new BotInterageConfigError(
      "Selecione apenas uma opção: limpar ou informar um novo token.",
    );
  }

  let apiToken = currentRow?.api_token ?? null;
  if (clearToken) {
    apiToken = null;
  } else if (tokenProvided) {
    apiToken = sanitizeOptionalToken(payload.token);
    if (!apiToken) {
      throw new BotInterageConfigError("Informe um token válido da API privada.");
    }
  }

  let model = currentRow?.model?.trim() || DEFAULT_MODEL;
  if (hasOwn(payload, "model")) {
    model = sanitizeOptionalModel(payload.model) ?? DEFAULT_MODEL;
  }

  await db.query(
    `
      UPDATE admin_botinterage_config
      SET enabled = ?, api_base_url = ?, api_token = ?, model = ?
      WHERE id = 1
    `,
    [enabled ? 1 : 0, baseUrl, apiToken, model],
  );

  invalidateRuntimeCache();
  return getAdminBotInterageConfig();
};

export const listBotInterageAllowedUsers = async (): Promise<AdminBotInterageAllowedUser[]> => {
  await ensureAdminBotInterageConfigTables();
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
      FROM admin_botinterage_users abu
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

export const addBotInterageAllowedUser = async (
  userId: number,
): Promise<AdminBotInterageAllowedUser> => {
  await ensureAdminBotInterageConfigTables();
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new BotInterageConfigError("Usuário inválido.");
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
    throw new BotInterageConfigError("Usuário não encontrado.", 404);
  }

  await db.query<ResultSetHeader>(
    `
      INSERT INTO admin_botinterage_users (user_id)
      VALUES (?)
      ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
    `,
    [userId],
  );

  invalidateAllowedUserCache(userId);

  const userRow = existingUserRows[0];
  const [allowedRows] = await db.query<{ created_at: Date | string }[]>(
    `
      SELECT created_at
      FROM admin_botinterage_users
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId],
  );

  return {
    userId: userRow.id,
    name: userRow.name,
    email: userRow.email ?? null,
    role: normalizeUserRole(userRow.role),
    isActive: Boolean(userRow.is_active),
    createdAt: toIso(allowedRows[0]?.created_at) ?? new Date().toISOString(),
  };
};

export const removeBotInterageAllowedUser = async (userId: number): Promise<boolean> => {
  await ensureAdminBotInterageConfigTables();
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new BotInterageConfigError("Usuário inválido.");
  }

  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `DELETE FROM admin_botinterage_users WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  invalidateAllowedUserCache(userId);
  return result.affectedRows > 0;
};

export const isUserAllowedBotInterage = async (userId: number): Promise<boolean> => {
  void userId;
  const config = await getBotInterageRuntimeConfig();
  return Boolean(config.enabled && config.baseUrl && config.token);
};
