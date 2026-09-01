import { ResultSetHeader, RowDataPacket } from "mysql2";

import type { UserNotification } from "types/notifications";

import {
  ensureUserNotificationTable,
  getDb,
  UserNotificationRow,
} from "lib/db";

export class UserNotificationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserNotificationError";
    this.status = status;
  }
}

const mapRow = (row: UserNotificationRow): UserNotification => {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata);
      if (parsed && typeof parsed === "object") {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = null;
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    metadata,
    isRead: row.is_read === 1,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString(),
    readAt: row.read_at
      ? row.read_at instanceof Date
        ? row.read_at.toISOString()
        : new Date(row.read_at).toISOString()
      : null,
  };
};

export const createUserNotification = async (payload: {
  userId: number;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}): Promise<UserNotification> => {
  await ensureUserNotificationTable();
  const db = getDb();

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_notifications (
        user_id,
        type,
        title,
        message,
        metadata
      ) VALUES (?, ?, ?, ?, ?)
    `,
    [
      payload.userId,
      payload.type,
      payload.title.slice(0, 255),
      payload.message.slice(0, 2000),
      payload.metadata ? JSON.stringify(payload.metadata).slice(0, 6000) : null,
    ],
  );

  const insertedId = result.insertId;
  const [rows] = await db.query<UserNotificationRow[]>(
    `SELECT * FROM user_notifications WHERE id = ? LIMIT 1`,
    [insertedId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new UserNotificationError("Não foi possível carregar a notificação criada.", 500);
  }

  return mapRow(rows[0]);
};

export const createNotificationsForUsers = async (
  userIds: number[],
  payload: {
    type: string;
    title: string;
    message: string;
    metadata?: Record<string, unknown> | null;
  },
): Promise<number> => {
  if (userIds.length === 0) {
    return 0;
  }

  await ensureUserNotificationTable();
  const db = getDb();
  const metadata = payload.metadata ? JSON.stringify(payload.metadata).slice(0, 6000) : null;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (const userId of userIds) {
    placeholders.push("(?, ?, ?, ?, ?)");
    values.push(
      userId,
      payload.type,
      payload.title.slice(0, 255),
      payload.message.slice(0, 2000),
      metadata,
    );
  }

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_notifications (
        user_id,
        type,
        title,
        message,
        metadata
      ) VALUES ${placeholders.join(", ")}
    `,
    values,
  );

  return result.affectedRows;
};

export const getNotificationsForUser = async (
  userId: number,
  limit = 50,
): Promise<UserNotification[]> => {
  await ensureUserNotificationTable();
  const db = getDb();

  const [rows] = await db.query<UserNotificationRow[]>(
    `
      SELECT *
      FROM user_notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [userId, limit],
  );

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map(mapRow);
};

export const getUnreadCountForUser = async (userId: number): Promise<number> => {
  await ensureUserNotificationTable();
  const db = getDb();

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM user_notifications WHERE user_id = ? AND is_read = 0`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const raw = rows[0].total;
  return typeof raw === "number" ? raw : Number.parseInt(String(raw ?? 0), 10) || 0;
};

export const markNotificationsAsRead = async (
  userId: number,
  notificationIds: number[] | "all",
): Promise<void> => {
  await ensureUserNotificationTable();
  const db = getDb();

  if (notificationIds === "all") {
    await db.query(
      `
        UPDATE user_notifications
        SET is_read = 1, read_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND is_read = 0
      `,
      [userId],
    );
    return;
  }

  if (notificationIds.length === 0) {
    return;
  }

  const placeholders = notificationIds.map(() => "?").join(", ");
  await db.query(
    `
      UPDATE user_notifications
      SET is_read = 1, read_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id IN (${placeholders})
    `,
    [userId, ...notificationIds],
  );
};

export const deleteAllNotificationsForUser = async (userId: number): Promise<void> => {
  await ensureUserNotificationTable();
  const db = getDb();
  await db.query(
    `DELETE FROM user_notifications WHERE user_id = ?`,
    [userId],
  );
};
