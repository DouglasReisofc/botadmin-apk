import { ResultSetHeader, RowDataPacket } from "mysql2";

import {
  ensureApiRequestPlanTable,
  getDb,
  type ApiRequestPlanRow,
} from "lib/db";

export type ApiRequestPlan = {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  requestAmount: number;
  isActive: boolean;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

const mapRow = (row: ApiRequestPlanRow): ApiRequestPlan => ({
  id: Number(row.id),
  name: row.name,
  description: row.description,
  priceCents: Number(row.price_cents ?? 0),
  requestAmount: Number(row.request_amount ?? 0),
  isActive: Boolean(row.is_active),
  orderIndex: Number.isFinite(row.order_index) ? Number(row.order_index) : 0,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
});

const getNextOrderIndex = async (): Promise<number> => {
  await ensureApiRequestPlanTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>("SELECT MAX(order_index) AS max_order FROM api_request_plans");
  const maxOrder = Array.isArray(rows) && rows.length > 0 ? Number(rows[0]?.max_order ?? 0) : 0;
  return Number.isFinite(maxOrder) ? maxOrder + 1 : 0;
};

export const listApiRequestPlans = async (options: { includeInactive?: boolean } = {}): Promise<ApiRequestPlan[]> => {
  await ensureApiRequestPlanTable();
  const db = getDb();
  const whereClause = options.includeInactive ? "" : "WHERE is_active = 1";
  const [rows] = await db.query<ApiRequestPlanRow[]>(
    `SELECT * FROM api_request_plans ${whereClause} ORDER BY order_index ASC, id ASC`,
  );
  return Array.isArray(rows) ? rows.map(mapRow) : [];
};

export const getApiRequestPlanById = async (id: number): Promise<ApiRequestPlan | null> => {
  await ensureApiRequestPlanTable();
  const db = getDb();
  const [rows] = await db.query<ApiRequestPlanRow[]>(
    `SELECT * FROM api_request_plans WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return mapRow(rows[0]);
};

const sanitizeName = (value: string): string => value.trim().slice(0, 120);
const sanitizeDescription = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 255) : null;
};

export const createApiRequestPlan = async (payload: {
  name: string;
  description?: string | null;
  priceCents: number;
  requestAmount: number;
  isActive?: boolean;
}): Promise<ApiRequestPlan> => {
  await ensureApiRequestPlanTable();
  const db = getDb();

  const name = sanitizeName(payload.name);
  if (!name) {
    throw new Error("Informe o nome do pacote.");
  }

  const priceCents = Math.max(0, Math.floor(Number(payload.priceCents ?? 0)));
  if (!Number.isFinite(priceCents) || priceCents <= 0) {
    throw new Error("Informe um valor maior que zero.");
  }

  const requestAmount = Math.max(1, Math.floor(Number(payload.requestAmount ?? 0)));
  if (!Number.isFinite(requestAmount) || requestAmount <= 0) {
    throw new Error("Informe a quantidade de requisições.");
  }

  const description = sanitizeDescription(payload.description ?? null);
  const orderIndex = await getNextOrderIndex();

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO api_request_plans (
        name,
        description,
        price_cents,
        request_amount,
        is_active,
        order_index
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    [name, description, priceCents, requestAmount, payload.isActive === false ? 0 : 1, orderIndex],
  );

  const insertedId = Number(result.insertId);
  const created = await getApiRequestPlanById(insertedId);
  if (!created) {
    throw new Error("Falha ao criar o pacote de requisições.");
  }
  return created;
};

export const updateApiRequestPlan = async (id: number, payload: {
  name?: string;
  description?: string | null;
  priceCents?: number;
  requestAmount?: number;
  isActive?: boolean;
  orderIndex?: number;
}): Promise<ApiRequestPlan | null> => {
  await ensureApiRequestPlanTable();
  const db = getDb();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (payload.name !== undefined) {
    const name = sanitizeName(payload.name);
    if (!name) {
      throw new Error("Informe o nome do pacote.");
    }
    fields.push("name = ?");
    values.push(name);
  }

  if (payload.description !== undefined) {
    fields.push("description = ?");
    values.push(sanitizeDescription(payload.description));
  }

  if (payload.priceCents !== undefined) {
    const priceCents = Math.max(0, Math.floor(Number(payload.priceCents)));
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      throw new Error("Informe um valor maior que zero.");
    }
    fields.push("price_cents = ?");
    values.push(priceCents);
  }

  if (payload.requestAmount !== undefined) {
    const requestAmount = Math.max(1, Math.floor(Number(payload.requestAmount)));
    if (!Number.isFinite(requestAmount) || requestAmount <= 0) {
      throw new Error("Informe a quantidade de requisições.");
    }
    fields.push("request_amount = ?");
    values.push(requestAmount);
  }

  if (payload.isActive !== undefined) {
    fields.push("is_active = ?");
    values.push(payload.isActive ? 1 : 0);
  }

  if (payload.orderIndex !== undefined) {
    const order = Math.max(0, Math.floor(Number(payload.orderIndex)));
    fields.push("order_index = ?");
    values.push(order);
  }

  if (fields.length === 0) {
    return getApiRequestPlanById(id);
  }

  values.push(id);

  await db.query(
    `UPDATE api_request_plans SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    values,
  );

  return getApiRequestPlanById(id);
};

export const deleteApiRequestPlan = async (id: number): Promise<void> => {
  await ensureApiRequestPlanTable();
  const db = getDb();
  await db.query("DELETE FROM api_request_plans WHERE id = ?", [id]);
};
