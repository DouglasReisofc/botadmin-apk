import { ResultSetHeader, RowDataPacket } from "mysql2";

import type { BotServer, BotServerPayload } from "types/bot-instances";
import {
  BotServerRow,
  ensureBotInstanceTable,
  ensureBotServerTable,
  getDb,
} from "./db";

class BotServerError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BotServerError";
    this.status = status;
  }
}

const normalizeBaseUrl = (raw: string): string => {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");

  if (!trimmed) {
    throw new BotServerError("Informe a URL base do servidor.");
  }

  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new BotServerError("URL do servidor inválida.");
  }
};

const normalizeName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new BotServerError("Informe o nome do servidor.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new BotServerError("Informe o nome do servidor.");
  }

  if (trimmed.length > 120) {
    throw new BotServerError("O nome do servidor deve ter até 120 caracteres.");
  }

  return trimmed;
};

const normalizeApiType = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    return "wuzapi";
  }

  return value.trim().toLowerCase();
};

const normalizeGlobalKey = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new BotServerError("Informe a chave administrativa do servidor.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new BotServerError("Informe a chave administrativa do servidor.");
  }

  if (trimmed.length > 255) {
    throw new BotServerError("A chave administrativa é muito longa.");
  }

  return trimmed;
};

const normalizeSessionLimit = (value: unknown): number => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numeric = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    throw new BotServerError("O limite de sessões deve ser um número inteiro.");
  }

  if (numeric < 0) {
    throw new BotServerError("O limite de sessões não pode ser negativo.");
  }

  return Math.floor(numeric);
};

const normalizeIsActive = (value: unknown): boolean => Boolean(value);

const mapRow = (row: BotServerRow): BotServer => ({
  id: row.id,
  name: row.name,
  baseUrl: row.base_url,
  apiType: row.api_type,
  globalApiKey: row.global_api_key,
  sessionLimit: Number(row.session_limit ?? 0),
  isActive: row.is_active === 1,
  createdAt: row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString(),
});

const normalizePayload = (payload: BotServerPayload) => {
  const name = normalizeName(payload.name);
  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  const apiType = normalizeApiType(payload.apiType);
  const globalApiKey = normalizeGlobalKey(payload.globalApiKey);
  const sessionLimit = normalizeSessionLimit(payload.sessionLimit);
  const isActive = normalizeIsActive(payload.isActive ?? true);

  return {
    name,
    baseUrl,
    apiType,
    globalApiKey,
    sessionLimit,
    isActive,
  };
};

export const getAllBotServers = async (): Promise<BotServer[]> => {
  await ensureBotServerTable();
  const db = getDb();

  const [rows] = await db.query<(BotServerRow & RowDataPacket)[]>(
    "SELECT * FROM bot_servers ORDER BY name ASC",
  );

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map(mapRow);
};

export const getActiveBotServers = async (): Promise<BotServer[]> => {
  await ensureBotServerTable();
  const db = getDb();
  const [rows] = await db.query<(BotServerRow & RowDataPacket)[]>(
    "SELECT * FROM bot_servers WHERE is_active = 1 ORDER BY name ASC",
  );
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map(mapRow);
};

export const getBotServerById = async (id: number): Promise<BotServer | null> => {
  if (!Number.isFinite(id) || id <= 0) {
    throw new BotServerError("Servidor inválido.", 404);
  }

  await ensureBotServerTable();
  const db = getDb();
  const [rows] = await db.query<(BotServerRow & RowDataPacket)[]>(
    "SELECT * FROM bot_servers WHERE id = ? LIMIT 1",
    [id],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapRow(rows[0]);
};

export const createBotServer = async (payload: BotServerPayload): Promise<BotServer> => {
  const normalized = normalizePayload(payload);
  await ensureBotServerTable();
  const db = getDb();

  try {
    const [result] = await db.query<ResultSetHeader>(
      `
        INSERT INTO bot_servers (
          name,
          base_url,
          api_type,
          global_api_key,
          session_limit,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        normalized.name,
        normalized.baseUrl,
        normalized.apiType,
        normalized.globalApiKey,
        normalized.sessionLimit,
        normalized.isActive ? 1 : 0,
      ],
    );

    const insertedId = result.insertId;
    const server = await getBotServerById(insertedId);
    if (!server) {
      throw new BotServerError("Não foi possível carregar o servidor após o cadastro.", 500);
    }

    return server;
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ER_DUP_ENTRY") {
      throw new BotServerError("Já existe um servidor com esse nome.", 409);
    }
    throw error;
  }
};

export const updateBotServer = async (
  id: number,
  payload: Partial<BotServerPayload>,
): Promise<BotServer> => {
  if (!Number.isFinite(id) || id <= 0) {
    throw new BotServerError("Servidor inválido.", 404);
  }

  const current = await getBotServerById(id);
  if (!current) {
    throw new BotServerError("Servidor não encontrado.", 404);
  }

  const normalized = normalizePayload({
    name: payload.name ?? current.name,
    baseUrl: payload.baseUrl ?? current.baseUrl,
    apiType: payload.apiType ?? current.apiType,
    globalApiKey: payload.globalApiKey ?? current.globalApiKey,
    sessionLimit: payload.sessionLimit ?? current.sessionLimit,
    isActive: payload.isActive ?? current.isActive,
  });

  await ensureBotServerTable();
  const db = getDb();

  try {
    const [result] = await db.query<ResultSetHeader>(
      `
        UPDATE bot_servers
        SET
          name = ?,
          base_url = ?,
          api_type = ?,
          global_api_key = ?,
          session_limit = ?,
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        normalized.name,
        normalized.baseUrl,
        normalized.apiType,
        normalized.globalApiKey,
        normalized.sessionLimit,
        normalized.isActive ? 1 : 0,
        id,
      ],
    );

    if (result.affectedRows === 0) {
      throw new BotServerError("Servidor não encontrado.", 404);
    }

    const updated = await getBotServerById(id);
    if (!updated) {
      throw new BotServerError("Não foi possível carregar o servidor atualizado.", 500);
    }
    return updated;
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ER_DUP_ENTRY") {
      throw new BotServerError("Já existe um servidor com esse nome.", 409);
    }
    throw error;
  }
};

export const deleteBotServer = async (id: number): Promise<void> => {
  if (!Number.isFinite(id) || id <= 0) {
    throw new BotServerError("Servidor inválido.", 404);
  }

  await ensureBotInstanceTable();
  await ensureBotServerTable();
  const db = getDb();

  const [instanceRows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM bot_instances WHERE server_id = ?",
    [id],
  );

  const totalInstances = Array.isArray(instanceRows) && instanceRows.length > 0
    ? Number(instanceRows[0].total ?? 0)
    : 0;

  if (totalInstances > 0) {
    throw new BotServerError(
      "Não é possível remover o servidor porque existem instâncias associadas.",
      409,
    );
  }

  const [result] = await db.query<ResultSetHeader>(
    "DELETE FROM bot_servers WHERE id = ?",
    [id],
  );

  if (result.affectedRows === 0) {
    throw new BotServerError("Servidor não encontrado.", 404);
  }
};

export { BotServerError };
