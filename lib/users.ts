import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureSessionTable, ensureUserTable, getDb, UserRow } from "lib/db";
import { normalizeUserRole } from "lib/auth";
import type { SessionUser } from "types/auth";
import type { AdminUserSummary, UserMetrics } from "types/users";
import { deleteUploadedFile } from "lib/uploads";
import { inferTimezoneFromWhatsapp, normalizeTimezoneInput } from "lib/timezones";

const normalizeDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

const normalizeAvatarUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = trimmed.replace(/^\/+/, "").replace(/\\/g, "/");
  return `/${sanitized}`;
};

const parseOptionalCurrency = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
};

export type UserBasicInfo = {
  id: number;
  name: string;
  email: string | null;
};

const sanitizeLikeQuery = (value: string) =>
  value.replace(/[!%_]/g, (char) => `!${char}`);

export const searchAdminUsers = async ({
  query,
  limit = 20,
}: {
  query?: string | null;
  limit?: number;
}): Promise<{ users: UserBasicInfo[]; hasMore: boolean }> => {
  await ensureUserTable();
  const db = getDb();

  const parsedLimit = Number.isFinite(limit) ? Math.trunc(Number(limit)) : 20;
  const safeLimit = Math.min(Math.max(parsedLimit, 1), 50);

  const rawQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  const filters: string[] = [];
  const params: Array<string | number> = [];

  if (rawQuery) {
    const normalized = sanitizeLikeQuery(rawQuery);
    const wildcard = `%${normalized}%`;
    filters.push(
      `(LOWER(COALESCE(email, '')) LIKE ? ESCAPE '!'
        OR LOWER(COALESCE(name, '')) LIKE ? ESCAPE '!'
        OR LOWER(COALESCE(whatsapp_number, '')) LIKE ? ESCAPE '!'
        OR CONCAT(id, '') LIKE ? ESCAPE '!')`,
    );
    params.push(wildcard, wildcard, wildcard, wildcard);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  const [rows] = await db.query<Pick<UserRow, "id" | "name" | "email">[]>(
    `
      SELECT id, name, email
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [...params, safeLimit + 1],
  );

  const hasMore = rows.length > safeLimit;
  const limitedRows = hasMore ? rows.slice(0, safeLimit) : rows;

  const users = limitedRows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email ?? null,
  }));

  return { users, hasMore };
};

export const getAdminUsers = async (): Promise<AdminUserSummary[]> => {
  await ensureSessionTable();
  const db = getDb();

  const [rows] = await db.query<
    (UserRow & {
      active_sessions: number | null;
      last_session_at: Date | string | null;
    })[]
  >(
    `
      SELECT
        u.*, 
        SUM(CASE WHEN s.revoked_at IS NULL AND s.expires_at > NOW() THEN 1 ELSE 0 END) AS active_sessions,
        MAX(CASE WHEN s.revoked_at IS NULL THEN s.created_at ELSE NULL END) AS last_session_at
      FROM users u
      LEFT JOIN sessions s ON s.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    role: normalizeUserRole(row.role),
    isActive: Boolean(row.is_active),
    balance: (() => {
      const parsed = Number.parseFloat(row.balance ?? "0");
      if (Number.isNaN(parsed)) {
        return 0;
      }
      return Math.round(parsed * 100) / 100;
    })(),
    customPlanPrice: parseOptionalCurrency(row.custom_plan_price),
    customAddonInstancePrice: parseOptionalCurrency(row.custom_addon_instance_price),
    customAddonGroupPrice: parseOptionalCurrency(row.custom_addon_group_price),
    whatsappNumber: row.whatsapp_number ?? null,
    avatarUrl: normalizeAvatarUrl(row.avatar_path ?? null),
    createdAt: normalizeDate(row.created_at).toISOString(),
    updatedAt: normalizeDate(row.updated_at).toISOString(),
    activeSessions: Number(row.active_sessions ?? 0),
    lastSessionAt: row.last_session_at
      ? normalizeDate(row.last_session_at).toISOString()
      : null,
  }));
};

export const getAdminUserById = async (
  userId: number,
): Promise<AdminUserSummary | null> => {
  const users = await getAdminUsers();
  return users.find((user) => user.id === userId) ?? null;
};

export const searchAdminUsersPaged = async ({
  query,
  page = 1,
  pageSize = 20,
  status = "all" as "all" | "active" | "inactive",
  plan = "all" as "all" | "with_active" | "without_active",
}: {
  query?: string | null;
  page?: number;
  pageSize?: number;
  status?: "all" | "active" | "inactive";
  plan?: "all" | "with_active" | "without_active";
}): Promise<{
  users: AdminUserSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}> => {
  await ensureSessionTable();
  const db = getDb();

  const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), 100));
  const safePage = Math.max(1, Math.floor(page));
  const offset = (safePage - 1) * safePageSize;

  const clauses: string[] = [];
  const params: unknown[] = [];

  const rawQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (rawQuery) {
    const normalized = sanitizeLikeQuery(rawQuery);
    const wildcard = `%${normalized}%`;
    clauses.push(
      `(LOWER(COALESCE(u.email, '')) LIKE ? ESCAPE '!'
        OR LOWER(COALESCE(u.name, '')) LIKE ? ESCAPE '!'
        OR LOWER(COALESCE(u.whatsapp_number, '')) LIKE ? ESCAPE '!'
        OR CONCAT(u.id, '') LIKE ? ESCAPE '!')`,
    );
    params.push(wildcard, wildcard, wildcard, wildcard);
  }

  if (status === "active") {
    clauses.push("u.is_active = 1");
  } else if (status === "inactive") {
    clauses.push("u.is_active = 0");
  }

  if (plan !== "all") {
    if (plan === "with_active") {
      clauses.push(
        `EXISTS (
          SELECT 1
          FROM user_plan_subscriptions active_subscription
          WHERE active_subscription.user_id = u.id
            AND active_subscription.status = 'active'
            AND (
              active_subscription.current_period_end IS NULL
              OR active_subscription.current_period_end > NOW()
            )
        )`,
      );
    } else if (plan === "without_active") {
      clauses.push(
        `NOT EXISTS (
          SELECT 1
          FROM user_plan_subscriptions active_subscription
          WHERE active_subscription.user_id = u.id
            AND active_subscription.status = 'active'
            AND (
              active_subscription.current_period_end IS NULL
              OR active_subscription.current_period_end > NOW()
            )
        )`,
      );
    }
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [countRows] = await db.query<[{ total: number }] & any[]>(
    `
      SELECT COUNT(*) AS total
      FROM users u
      ${whereSql}
    `,
    params,
  );
  const total = Number((Array.isArray(countRows) ? (countRows as any)[0]?.total : 0) ?? 0);

  const [rows] = await db.query<
    (UserRow & {
      active_sessions: number | null;
      last_session_at: Date | string | null;
      has_active_subscription: number | boolean | null;
    })[]
  >(
    `
      SELECT
        u.*,
        EXISTS (
          SELECT 1
          FROM user_plan_subscriptions active_subscription
          WHERE active_subscription.user_id = u.id
            AND active_subscription.status = 'active'
            AND (
              active_subscription.current_period_end IS NULL
              OR active_subscription.current_period_end > NOW()
            )
        ) AS has_active_subscription,
        SUM(CASE WHEN s.revoked_at IS NULL AND s.expires_at > NOW() THEN 1 ELSE 0 END) AS active_sessions,
        MAX(CASE WHEN s.revoked_at IS NULL THEN s.created_at ELSE NULL END) AS last_session_at
      FROM users u
      LEFT JOIN sessions s ON s.user_id = u.id
      ${whereSql}
      GROUP BY u.id
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, safePageSize + 1, offset],
  );

  const list = rows.slice(0, Math.min(rows.length, safePageSize));
  const hasMore = total > offset + list.length;

  return {
    users: list.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email ?? null,
      role: normalizeUserRole(row.role),
      isActive: Boolean(row.is_active),
      balance: (() => {
        const parsed = Number.parseFloat(row.balance ?? "0");
        return Number.isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
      })(),
      customPlanPrice: parseOptionalCurrency(row.custom_plan_price),
      customAddonInstancePrice: parseOptionalCurrency(row.custom_addon_instance_price),
      customAddonGroupPrice: parseOptionalCurrency(row.custom_addon_group_price),
      whatsappNumber: row.whatsapp_number ?? null,
      avatarUrl: normalizeAvatarUrl(row.avatar_path ?? null),
      createdAt: normalizeDate(row.created_at).toISOString(),
      updatedAt: normalizeDate(row.updated_at).toISOString(),
      activeSessions: Number(row.active_sessions ?? 0),
      lastSessionAt: row.last_session_at ? normalizeDate(row.last_session_at).toISOString() : null,
      hasActiveSubscription: Boolean(row.has_active_subscription),
    })),
    page: safePage,
    pageSize: safePageSize,
    total,
    hasMore,
  };
};

export const getUserBalanceById = async (userId: number): Promise<number> => {
  await ensureUserTable();
  const db = getDb();

  const [rows] = await db.query<UserRow[]>(
    `SELECT balance FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Usuário não encontrado.");
  }

  const parsed = Number.parseFloat(rows[0].balance ?? "0");
  return Number.isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
};

export const increaseUserBalance = async (userId: number, amount: number): Promise<number> => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Valor inválido para crédito de saldo.");
  }

  await ensureUserTable();
  const db = getDb();

  await db.query(
    `UPDATE users SET balance = balance + ? WHERE id = ?`,
    [amount, userId],
  );

  return getUserBalanceById(userId);
};

export const decreaseUserBalance = async (userId: number, amount: number): Promise<number> => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Valor inválido para débito de saldo.");
  }

  await ensureUserTable();
  const db = getDb();

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?`,
    [amount, userId, amount],
  );

  if (result.affectedRows === 0) {
    throw new Error("Saldo insuficiente para realizar a operação.");
  }

  return getUserBalanceById(userId);
};

export const getUserBasicById = async (userId: number): Promise<UserBasicInfo | null> => {
  await ensureUserTable();
  const db = getDb();

  const [rows] = await db.query<Pick<UserRow, "id" | "name" | "email">[]>(
    `SELECT id, name, email FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
  } satisfies UserBasicInfo;
};
export const getUserBasicByEmail = async (email: string): Promise<UserBasicInfo | null> => {
  if (typeof email !== "string") {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  await ensureUserTable();
  const db = getDb();

  const [rows] = await db.query<Pick<UserRow, "id" | "name" | "email">[]>(
    `SELECT id, name, email FROM users WHERE LOWER(email) = ? LIMIT 1`,
    [normalized],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
  };
};


export const getUserMetrics = async (): Promise<UserMetrics> => {
  const users = await getAdminUsers();

  const totalUsers = users.length;
  const activeUsers = users.filter((user) => user.isActive).length;
  const inactiveUsers = totalUsers - activeUsers;
  const activeSessions = users.reduce(
    (total, user) => total + user.activeSessions,
    0,
  );

  return {
    totalUsers,
    activeUsers,
    inactiveUsers,
    activeSessions,
  } satisfies UserMetrics;
};

type AdminUpdatableFields = {
  name?: string;
  email?: string;
  role?: "admin" | "user";
  password?: string;
  isActive?: boolean;
  balance?: number;
  whatsappNumber?: string | null;
  customPlanPrice?: number | null;
  customAddonInstancePrice?: number | null;
  customAddonGroupPrice?: number | null;
};

export const updateAdminUser = async (
  userId: number,
  updates: AdminUpdatableFields,
) => {
  await ensureUserTable();
  const db = getDb();

  const [existingRows] = await db.query<UserRow[]>(
    "SELECT * FROM users WHERE id = ? LIMIT 1",
    [userId],
  );

  if (!Array.isArray(existingRows) || existingRows.length === 0) {
    throw new Error("Usuário não encontrado.");
  }

  const existing = existingRows[0];
  let finalEmail: string | null = existing.email ?? null;
  let finalPasswordMissing = existing.password_missing;

  const fields: string[] = [];
  const values: Array<string | number | null> = [];

  if (typeof updates.name === "string" && updates.name.trim().length > 0) {
    fields.push("name = ?");
    values.push(updates.name.trim());
  }

  if (typeof updates.email === "string") {
    const trimmed = updates.email.trim();
    if (trimmed.length > 0) {
      const normalizedEmail = trimmed.toLowerCase();
      fields.push("email = ?");
      values.push(normalizedEmail);
      finalEmail = normalizedEmail;
    }
  }

  if (updates.role === "admin" || updates.role === "user") {
    fields.push("role = ?");
    values.push(updates.role);
  }

  if (typeof updates.isActive === "boolean") {
    fields.push("is_active = ?");
    values.push(updates.isActive ? 1 : 0);
  }

  if (
    typeof updates.balance === "number" &&
    Number.isFinite(updates.balance) &&
    updates.balance >= 0
  ) {
    const normalizedBalance = Math.round(updates.balance * 100) / 100;
    fields.push("balance = ?");
    values.push(normalizedBalance);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "customPlanPrice")) {
    const value = updates.customPlanPrice;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      const normalized = Math.round(value * 100) / 100;
      fields.push("custom_plan_price = ?");
      values.push(normalized);
    } else {
      fields.push("custom_plan_price = ?");
      values.push(null);
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "customAddonInstancePrice")) {
    const value = updates.customAddonInstancePrice;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      const normalized = Math.round(value * 100) / 100;
      fields.push("custom_addon_instance_price = ?");
      values.push(normalized);
    } else {
      fields.push("custom_addon_instance_price = ?");
      values.push(null);
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "customAddonGroupPrice")) {
    const value = updates.customAddonGroupPrice;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      const normalized = Math.round(value * 100) / 100;
      fields.push("custom_addon_group_price = ?");
      values.push(normalized);
    } else {
      fields.push("custom_addon_group_price = ?");
      values.push(null);
    }
  }

  if (typeof updates.password === "string" && updates.password.length > 0) {
    const hashedPassword = await bcrypt.hash(updates.password, 10);
    fields.push("password = ?");
    values.push(hashedPassword);
    finalPasswordMissing = 0;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "whatsappNumber")) {
    const value = updates.whatsappNumber;
    const sanitized = typeof value === "string" ? value.trim() : "";
    fields.push("whatsapp_number = ?");
    values.push(sanitized ? sanitized : null);
  }

  if (fields.length === 0) {
    return;
  }

  const needsCredentialsAfterUpdate = (!finalEmail || finalPasswordMissing === 1) ? 1 : 0;

  if (existing.needs_credentials_completion !== needsCredentialsAfterUpdate) {
    fields.push("needs_credentials_completion = ?");
    values.push(needsCredentialsAfterUpdate);
  }

  if (existing.password_missing !== finalPasswordMissing) {
    fields.push("password_missing = ?");
    values.push(finalPasswordMissing);
  }

  fields.push("updated_at = CURRENT_TIMESTAMP");

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
    [...values, userId],
  );

  if (result.affectedRows === 0) {
    throw new Error("Usuário não encontrado.");
  }
};

type UserProfileUpdates = {
  name?: string;
  email?: string;
  password?: string;
  whatsappNumber?: string | null;
  avatarPath?: string | null;
  timezone?: string | null;
};

export const updateUserProfile = async (
  userId: number,
  updates: UserProfileUpdates,
) => {
  await ensureUserTable();
  const db = getDb();

  const [existingRows] = await db.query<UserRow[]>(
    `SELECT * FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(existingRows) || existingRows.length === 0) {
    throw new Error("Usuário não encontrado.");
  }

  const existing = existingRows[0];

  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  let avatarToDelete: string | null = null;
  let finalEmail: string | null = existing.email ?? null;
  let finalPasswordMissing = existing.password_missing;

  if (typeof updates.name === "string" && updates.name.trim()) {
    fields.push("name = ?");
    values.push(updates.name.trim());
  }

  if (typeof updates.email === "string" && updates.email.trim()) {
    const normalizedEmail = updates.email.trim().toLowerCase();
    const [existingEmail] = await db.query<RowDataPacket[]>(
      `SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1`,
      [normalizedEmail, userId],
    );

    if (Array.isArray(existingEmail) && existingEmail.length > 0) {
      throw new Error("E-mail já está em uso por outro usuário.");
    }

    fields.push("email = ?");
    values.push(normalizedEmail);
    finalEmail = normalizedEmail;
  }

  if (typeof updates.password === "string" && updates.password.trim()) {
    const hashedPassword = await bcrypt.hash(updates.password.trim(), 10);
    fields.push("password = ?");
    values.push(hashedPassword);
    finalPasswordMissing = 0;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "whatsappNumber")) {
    const value = updates.whatsappNumber;
    fields.push("whatsapp_number = ?");
    values.push(value && value.trim() ? value.trim() : null);
  }

  let timezoneToPersist: string | null | undefined = undefined;
  if (Object.prototype.hasOwnProperty.call(updates, "timezone")) {
    const rawTimezone = updates.timezone;
    if (rawTimezone === null) {
      timezoneToPersist = null;
    } else if (typeof rawTimezone === "string") {
      const normalized = normalizeTimezoneInput(rawTimezone);
      if (rawTimezone.trim() && !normalized) {
        throw new Error("Fuso horário inválido.");
      }
      timezoneToPersist = normalized;
    } else {
      timezoneToPersist = null;
    }
  } else if (Object.prototype.hasOwnProperty.call(updates, "whatsappNumber")) {
    const inferredTimezone = inferTimezoneFromWhatsapp(updates.whatsappNumber ?? null);
    const existingTimezone = normalizeTimezoneInput(existing.timezone ?? null);
    if (!existingTimezone && inferredTimezone) {
      timezoneToPersist = inferredTimezone;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "avatarPath")) {
    const value = updates.avatarPath;
    const normalized = value && value.trim() ? value.trim() : null;
    fields.push("avatar_path = ?");
    values.push(normalized);

    if (existing.avatar_path && existing.avatar_path !== normalized) {
      avatarToDelete = existing.avatar_path;
    }

    if (!normalized && existing.avatar_path) {
      avatarToDelete = existing.avatar_path;
    }
  }

  if (fields.length === 0) {
    throw new Error("Nenhuma alteração informada.");
  }

  const needsCredentialsAfterUpdate = (!finalEmail || finalPasswordMissing === 1) ? 1 : 0;

  if (existing.needs_credentials_completion !== needsCredentialsAfterUpdate) {
    fields.push("needs_credentials_completion = ?");
    values.push(needsCredentialsAfterUpdate);
  }

  if (existing.password_missing !== finalPasswordMissing) {
    fields.push("password_missing = ?");
    values.push(finalPasswordMissing);
  }

  if (timezoneToPersist !== undefined) {
    fields.push("timezone = ?");
    values.push(timezoneToPersist);
  }

  fields.push("updated_at = CURRENT_TIMESTAMP");

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
    [...values, userId],
  );

  if (result.affectedRows === 0) {
    throw new Error("Usuário não encontrado.");
  }

  if (avatarToDelete) {
    try {
      await deleteUploadedFile(avatarToDelete);
    } catch (error) {
      console.error("Failed to delete previous avatar", error);
    }
  }

  const [rows] = await db.query<UserRow[]>(
    `SELECT id, name, email, whatsapp_number, timezone, avatar_path FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Usuário não encontrado após atualização.");
  }

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    whatsappNumber: row.whatsapp_number ?? null,
    timezone: normalizeTimezoneInput(row.timezone ?? null),
    avatarUrl: normalizeAvatarUrl(row.avatar_path ?? null),
  };
};

export const sanitizeWhatsappDigits = (value: string) => value.replace(/[^0-9]/g, "");

export const findUserIdByWhatsappDigits = async (digits: string): Promise<number | null> => {
  const sanitized = sanitizeWhatsappDigits(digits);
  if (!sanitized) {
    return null;
  }

  await ensureUserTable();
  const db = getDb();

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT id
      FROM users
      WHERE whatsapp_number IS NOT NULL
        AND REGEXP_REPLACE(whatsapp_number, '[^0-9]', '') = ?
      LIMIT 1
    `,
    [sanitized],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return Number(rows[0].id) || null;
};

export const updateUserWhatsappNumber = async (userId: number, whatsappNumber: string | null): Promise<void> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return;
  }

  await ensureUserTable();
  const db = getDb();

  const normalized = typeof whatsappNumber === "string" ? whatsappNumber.trim() : null;

  await db.query<ResultSetHeader>(
    `
      UPDATE users
      SET whatsapp_number = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [normalized && normalized.length > 0 ? normalized : null, userId],
  );
};

export const updateUserEmail = async (userId: number, email: string): Promise<void> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return;
  }

  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalized) {
    throw new Error("Informe um e-mail válido.");
  }

  await ensureUserTable();
  const db = getDb();

  await db.query<ResultSetHeader>(
    `
      UPDATE users
      SET email = ?, needs_credentials_completion = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [normalized, userId],
  );
};

export const activateUserAccount = async (userId: number): Promise<boolean> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }

  await ensureUserTable();
  const db = getDb();

  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE users
      SET is_active = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [userId],
  );

  return result.affectedRows > 0;
};

export const deleteAdminUser = async (userId: number): Promise<boolean> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }

  await ensureUserTable();
  const db = getDb();

  const [result] = await db.query<ResultSetHeader>(
    "DELETE FROM users WHERE id = ? LIMIT 1",
    [userId],
  );

  return result.affectedRows > 0;
};

/**
 * Returns accounts created by an interrupted/partial registration flow.
 *
 * These rows are deliberately limited to the flags maintained by the auth
 * flow (`needs_credentials_completion`/`password_missing`) and regular users;
 * an administrator account is never considered disposable by this helper.
 * The endpoint that calls this function still requires an explicit typed
 * confirmation, so an audit can be performed before anything is removed.
 */
export const getEmptyRegistrationCleanupPreview = async (limit = 50) => {
  await ensureUserTable();
  const db = getDb();
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 50), 1), 200);
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT id, name, email, whatsapp_number, created_at,
             needs_credentials_completion, password_missing
      FROM users
      WHERE role = 'user'
        AND (needs_credentials_completion = 1 OR password_missing = 1)
      ORDER BY created_at ASC
      LIMIT ?
    `,
    [safeLimit],
  );
  const users = (Array.isArray(rows) ? rows : []).map((row) => ({
    id: Number(row.id),
    name: String(row.name || ""),
    email: row.email ? String(row.email) : null,
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    needsCredentialsCompletion: Boolean(row.needs_credentials_completion),
    passwordMissing: Boolean(row.password_missing),
  }));
  return { users, count: users.length, limit: safeLimit };
};

/** Permanently removes only the incomplete regular-user registrations. */
export const deleteEmptyRegistrationUsers = async (): Promise<number> => {
  await ensureUserTable();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      DELETE FROM users
      WHERE role = 'user'
        AND (needs_credentials_completion = 1 OR password_missing = 1)
    `,
  );
  return Number(result.affectedRows || 0);
};

export const findActiveUserByWhatsappId = async (
  whatsappId: string,
): Promise<SessionUser | null> => {
  const digits = sanitizeWhatsappDigits(whatsappId);
  if (!digits) {
    return null;
  }

  await ensureUserTable();
  const db = getDb();

  const [rows] = await db.query<UserRow[]>(
    `
      SELECT id, name, email, role, is_active, whatsapp_number, timezone, avatar_path
      FROM users
      WHERE is_active = 1
        AND whatsapp_number IS NOT NULL
        AND REGEXP_REPLACE(whatsapp_number, '[^0-9]', '') = ?
      LIMIT 1
    `,
    [digits],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const row = rows[0];

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: normalizeUserRole(row.role),
    isActive: Boolean(row.is_active),
    whatsappNumber: row.whatsapp_number ?? null,
    timezone: normalizeTimezoneInput(row.timezone ?? null),
    avatarUrl: normalizeAvatarUrl(row.avatar_path ?? null),
  } satisfies SessionUser;
};

export const getSessionUserById = async (
  userId: number,
): Promise<SessionUser | null> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  await ensureUserTable();
  const db = getDb();

  const [rows] = await db.query<UserRow[]>(
    `
      SELECT id, name, email, role, is_active, whatsapp_number, timezone, avatar_path
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const row = rows[0];

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: normalizeUserRole(row.role),
    isActive: Boolean(row.is_active),
    whatsappNumber: row.whatsapp_number ?? null,
    timezone: normalizeTimezoneInput(row.timezone ?? null),
    avatarUrl: normalizeAvatarUrl(row.avatar_path ?? null),
  } satisfies SessionUser;
};
