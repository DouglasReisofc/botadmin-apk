import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";

import {
  ensureUserApiKeyTable,
  getDb,
  type UserApiKeyRow,
} from "lib/db";

const API_KEY_PREFIX = "sbk_";
const DEFAULT_DAILY_QUOTA = (() => {
  const raw = Number.parseInt(process.env.USER_API_DAILY_QUOTA ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return 1000;
})();

const CUSTOM_KEY_REGEX = /^[A-Za-z0-9_-]+$/;
const CUSTOM_KEY_MIN_LENGTH = 4;
const CUSTOM_KEY_MAX_LENGTH = 64;

const ROTATION_COOLDOWN_DAYS = (() => {
  const raw = Number.parseInt(process.env.USER_API_KEY_ROTATION_DAYS ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return 30;
})();

const ROTATION_COOLDOWN_MS = ROTATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

const toDate = (value: Date | string | null): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const generateApiKey = (): string => `${API_KEY_PREFIX}${crypto.randomBytes(24).toString("hex")}`;

const mapRow = (row: UserApiKeyRow): UserApiKey => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  apiKey: row.api_key,
  dailyQuota: Number(row.daily_quota),
  requestsUsed: Number(row.requests_used),
  resetAt: toDate(row.reset_at),
  rotationLockedUntil: toDate(row.rotation_locked_until),
  createdAt: toDate(row.created_at) ?? new Date(),
  updatedAt: toDate(row.updated_at) ?? new Date(),
});

const resolveDailyQuota = (raw?: number | null): number => {
  if (Number.isFinite(raw) && typeof raw === "number" && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_DAILY_QUOTA;
};

const computeNextRotationLock = () => new Date(Date.now() + ROTATION_COOLDOWN_MS);

const ensureRotationAllowed = (row?: UserApiKeyRow | null) => {
  if (!row) {
    return;
  }
  const lockedUntil = toDate(row.rotation_locked_until);
  if (!lockedUntil) {
    return;
  }
  if (lockedUntil.getTime() <= Date.now()) {
    return;
  }
  const diffDays = Math.ceil((lockedUntil.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  const formatted = lockedUntil.toLocaleString("pt-BR");
  throw new Error(
    diffDays > 1
      ? `Aguarde ${diffDays} dias (até ${formatted}) para gerar outra chave.`
      : `Aguarde até ${formatted} para gerar outra chave.`,
  );
};

export type UserApiKey = {
  id: number;
  userId: number;
  apiKey: string;
  dailyQuota: number;
  requestsUsed: number;
  resetAt: Date | null;
  rotationLockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const findRowByApiKey = async (apiKey: string): Promise<UserApiKeyRow | null> => {
  const db = getDb();
  const [rows] = await db.query<UserApiKeyRow[]>(
    `
      SELECT *
      FROM user_api_keys
      WHERE api_key = ?
      LIMIT 1
    `,
    [apiKey],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return rows[0];
};

const findRowByUserId = async (userId: number): Promise<UserApiKeyRow | null> => {
  const db = getDb();
  const [rows] = await db.query<UserApiKeyRow[]>(
    `
      SELECT *
      FROM user_api_keys
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return rows[0];
};

const generateUniqueApiKey = async (): Promise<string> => {
  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateApiKey();
    const [rows] = await db.query<Array<{ id: number }>>(
      `
        SELECT id
        FROM user_api_keys
        WHERE api_key = ?
        LIMIT 1
      `,
      [candidate],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return candidate;
    }
  }
  // As fallback, rely on unique constraint (rare collision).
  return generateApiKey();
};

export const getOrCreateUserApiKey = async (userId: number): Promise<UserApiKey> => {
  await ensureUserApiKeyTable();
  const existing = await findRowByUserId(userId);
  if (existing) {
    return mapRow(existing);
  }

  const db = getDb();
  const now = new Date();
  const apiKey = await generateUniqueApiKey();
  const dailyQuota = resolveDailyQuota();
  const lockedUntil = computeNextRotationLock();

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_api_keys (user_id, api_key, daily_quota, requests_used, reset_at, rotation_locked_until)
      VALUES (?, ?, ?, 0, NULL, ?)
    `,
    [userId, apiKey, dailyQuota, lockedUntil],
  );

  const insertedId = Number(result.insertId);
  return {
    id: insertedId,
    userId,
    apiKey,
    dailyQuota,
    requestsUsed: 0,
    resetAt: null,
    rotationLockedUntil: lockedUntil,
    createdAt: now,
    updatedAt: now,
  };
};

export const rotateUserApiKey = async (userId: number): Promise<UserApiKey> => {
  await ensureUserApiKeyTable();
  const db = getDb();
  const existing = await findRowByUserId(userId);
  const apiKey = await generateUniqueApiKey();
  const now = new Date();
  const lockedUntil = computeNextRotationLock();

  if (existing) {
    ensureRotationAllowed(existing);
    await db.query(
      `UPDATE user_api_keys SET api_key = ?, rotation_locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [apiKey, lockedUntil, existing.id],
    );
    const updated = await findRowByUserId(userId);
    if (!updated) {
      throw new Error("Falha ao atualizar a chave de API.");
    }
    return mapRow(updated);
  }

  const dailyQuota = resolveDailyQuota();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_api_keys (user_id, api_key, daily_quota, requests_used, reset_at, rotation_locked_until)
      VALUES (?, ?, ?, 0, NULL, ?)
    `,
    [userId, apiKey, dailyQuota, lockedUntil],
  );

  const insertedId = Number(result.insertId);
  return {
    id: insertedId,
    userId,
    apiKey,
    dailyQuota,
    requestsUsed: 0,
    resetAt: null,
    rotationLockedUntil: lockedUntil,
    createdAt: now,
    updatedAt: now,
  };
};

const normalizeCustomApiKey = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const ensureCustomKeyFormat = (value: string): void => {
  if (!value) {
    throw new Error("Informe a nova chave desejada.");
  }
  if (value.length < CUSTOM_KEY_MIN_LENGTH || value.length > CUSTOM_KEY_MAX_LENGTH) {
    throw new Error(`A chave deve ter entre ${CUSTOM_KEY_MIN_LENGTH} e ${CUSTOM_KEY_MAX_LENGTH} caracteres.`);
  }
  if (!CUSTOM_KEY_REGEX.test(value)) {
    throw new Error("A chave deve conter apenas letras, números, hífen ou underline.");
  }
};

export const setUserApiKey = async (userId: number, requestedKey: string): Promise<UserApiKey> => {
  await ensureUserApiKeyTable();
  const candidate = normalizeCustomApiKey(requestedKey);
  ensureCustomKeyFormat(candidate);

  const existingWithKey = await findRowByApiKey(candidate);
  if (existingWithKey && existingWithKey.user_id !== userId) {
    throw new Error("Esta chave já está em uso por outra conta. Escolha outro valor.");
  }

  const existingRow = await findRowByUserId(userId);
  if (existingRow && existingRow.api_key === candidate) {
    return mapRow(existingRow);
  }

  const db = getDb();
  const lockedUntil = computeNextRotationLock();

  if (existingRow) {
    ensureRotationAllowed(existingRow);
    await db.query(
      `
        UPDATE user_api_keys
        SET api_key = ?, rotation_locked_until = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [candidate, lockedUntil, existingRow.id],
    );
  } else {
    const dailyQuota = resolveDailyQuota();
    await db.query(
      `
        INSERT INTO user_api_keys (user_id, api_key, daily_quota, requests_used, reset_at, rotation_locked_until)
        VALUES (?, ?, ?, 0, NULL, ?)
      `,
      [userId, candidate, dailyQuota, lockedUntil],
    );
  }

  const updated = await findRowByUserId(userId);
  if (!updated) {
    throw new Error("Falha ao atualizar a chave de API.");
  }

  return mapRow(updated);
};

export const addUserApiRequestQuota = async (userId: number, amount: number): Promise<UserApiKey> => {
  await ensureUserApiKeyTable();
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Informe a quantidade de requisições a adicionar.");
  }

  const current = await getOrCreateUserApiKey(userId);
  const db = getDb();
  await db.query(
    `
      UPDATE user_api_keys
      SET daily_quota = daily_quota + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [Math.floor(amount), current.id],
  );

  const updated = await findRowByUserId(userId);
  if (!updated) {
    throw new Error("Falha ao atualizar limite da API.");
  }
  return mapRow(updated);
};

export type UserApiConsumption =
  | { ok: true; record: UserApiKey }
  | { ok: false; status: number; message: string };

export const consumeUserApiRequest = async (apiKeyRaw: string | null | undefined): Promise<UserApiConsumption> => {
  const token = typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : "";
  if (!token) {
    return { ok: false, status: 401, message: "Informe uma chave de API válida." };
  }

  await ensureUserApiKeyTable();
  const row = await findRowByApiKey(token);
  if (!row) {
    return { ok: false, status: 401, message: "Chave de API inválida." };
  }

  const db = getDb();
  const [updateResult] = await db.query<ResultSetHeader>(
    `
      UPDATE user_api_keys
      SET
        requests_used = requests_used + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (daily_quota <= 0 OR requests_used < daily_quota)
    `,
    [row.id],
  );

  if (updateResult.affectedRows === 0) {
    return { ok: false, status: 429, message: "Limite de requisições atingido." };
  }

  const updated = await findRowByApiKey(token);
  if (!updated) {
    return { ok: false, status: 500, message: "Falha ao atualizar uso da API." };
  }

  return { ok: true, record: mapRow(updated) };
};

export const getUserApiKeyByToken = async (apiKey: string): Promise<UserApiKey | null> => {
  await ensureUserApiKeyTable();
  const row = await findRowByApiKey(apiKey.trim());
  if (!row) {
    return null;
  }
  return mapRow(row);
};
