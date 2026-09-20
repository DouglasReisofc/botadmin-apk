import type { RowDataPacket, ResultSetHeader } from "mysql2";

import { ensureAdminPanelNotificationTable, getDb } from "lib/db";
import { createUserNotification } from "lib/user-notifications";
import { emitUserNotificationCreated } from "lib/realtime";
import { sendPushNotificationToUser } from "lib/push-notifications";
import type {
  AdminPanelNotification,
  AdminPanelNotificationStatus,
} from "types/notifications";

type NotificationRow = RowDataPacket & {
  id: number;
  title: string;
  message: string;
  content_json: string | null;
  media_type: string | null;
  media_url: string | null;
  target_url: string | null;
  target_type: "all" | "user";
  target_user_id: number | null;
  status: AdminPanelNotificationStatus;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  sent_at: Date | string | null;
  recipient_count: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const iso = (value: Date | string | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const mapRow = (row: NotificationRow): AdminPanelNotification => {
  let contentJson: Record<string, unknown> | null = null;
  if (row.content_json) {
    try {
      const parsed = JSON.parse(row.content_json);
      if (parsed && typeof parsed === "object") contentJson = parsed;
    } catch { /* invalid legacy content is ignored */ }
  }
  return {
    id: Number(row.id),
    title: row.title,
    message: row.message,
    contentJson,
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    targetUrl: row.target_url,
    targetType: row.target_type,
    targetUserId: row.target_user_id == null ? null : Number(row.target_user_id),
    status: row.status,
    startsAt: iso(row.starts_at),
    expiresAt: iso(row.expires_at),
    sentAt: iso(row.sent_at),
    recipientCount: Number(row.recipient_count ?? 0),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
};

const normalizeUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = value.trim();
  if (url.startsWith("/") || /^https?:\/\//i.test(url)) return url.slice(0, 2000);
  throw new Error("Use um link http(s) ou um caminho interno iniciado por '/'.");
};

const inferMediaType = (value: string | null, explicit: unknown): string | null => {
  const requested = typeof explicit === "string" ? explicit.trim().toLowerCase() : "";
  if (requested) return requested.slice(0, 32);
  if (!value) return null;
  const path = value.split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith(".json")) return "lottie";
  if (path.endsWith(".gif")) return "gif";
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return "video";
  if (/\.(png|jpe?g|webp|svg|avif)$/.test(path)) return "image";
  return null;
};

const getRow = async (id: number): Promise<AdminPanelNotification | null> => {
  await ensureAdminPanelNotificationTable();
  const [rows] = await getDb().query<NotificationRow[]>(
    `SELECT * FROM admin_panel_notifications WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapRow(rows[0]) : null;
};

export const listAdminPanelNotifications = async (): Promise<AdminPanelNotification[]> => {
  await ensureAdminPanelNotificationTable();
  const [rows] = await getDb().query<NotificationRow[]>(
    `SELECT * FROM admin_panel_notifications ORDER BY created_at DESC LIMIT 200`,
  );
  return rows.map(mapRow);
};

export const createAdminPanelNotification = async (
  input: Record<string, unknown>,
  createdBy: number,
): Promise<AdminPanelNotification> => {
  await ensureAdminPanelNotificationTable();
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 255) : "";
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 10000) : "";
  if (!title || !message) throw new Error("Informe título e mensagem.");
  const targetType = input.targetType === "user" ? "user" : "all";
  let targetUserId = targetType === "user" && Number.isFinite(Number(input.targetUserId))
    ? Number(input.targetUserId)
    : null;
  if (targetType === "user" && !targetUserId && typeof input.targetEmail === "string") {
    const [users] = await getDb().query<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 1 LIMIT 1`,
      [input.targetEmail.trim()],
    );
    targetUserId = users.length ? Number(users[0].id) : null;
  }
  if (targetType === "user" && !targetUserId) throw new Error("Informe o usuário destinatário.");
  const startsAt = typeof input.startsAt === "string" && input.startsAt.trim() ? new Date(input.startsAt) : new Date();
  const expiresAt = typeof input.expiresAt === "string" && input.expiresAt.trim() ? new Date(input.expiresAt) : null;
  if (Number.isNaN(startsAt.getTime()) || (expiresAt && Number.isNaN(expiresAt.getTime()))) {
    throw new Error("Data de exibição inválida.");
  }
  if (expiresAt && expiresAt <= startsAt) throw new Error("A data final deve ser posterior à inicial.");
  const contentJson = input.contentJson && typeof input.contentJson === "object"
    ? JSON.stringify(input.contentJson).slice(0, 12000)
    : null;
  const mediaUrl = normalizeUrl(input.mediaUrl);
  const mediaType = inferMediaType(mediaUrl, input.mediaType);
  const targetUrl = normalizeUrl(input.targetUrl);
  const shouldSchedule = input.sendNow === true || input.status === "scheduled" || (typeof input.startsAt === "string" && input.startsAt.trim().length > 0);
  const status: AdminPanelNotificationStatus = shouldSchedule ? "scheduled" : "draft";
  const [result] = await getDb().query<ResultSetHeader>(
    `INSERT INTO admin_panel_notifications
      (title, message, content_json, media_type, media_url, target_url, target_type, target_user_id,
       status, starts_at, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, message, contentJson, mediaType, mediaUrl, targetUrl, targetType, targetUserId,
      status, shouldSchedule ? startsAt : null, expiresAt, createdBy],
  );
  const created = await getRow(Number(result.insertId));
  if (!created) throw new Error("Não foi possível carregar a notificação criada.");
  return created;
};

export const cancelAdminPanelNotification = async (id: number): Promise<void> => {
  await ensureAdminPanelNotificationTable();
  await getDb().query(`UPDATE admin_panel_notifications SET status = 'cancelled' WHERE id = ? AND status IN ('draft','scheduled')`, [id]);
};

export const dispatchAdminPanelNotification = async (id: number): Promise<AdminPanelNotification> => {
  const notification = await getRow(id);
  if (!notification) throw new Error("Notificação não encontrada.");
  if (["sent", "sending", "cancelled"].includes(notification.status)) return notification;
  const db = getDb();
  const [claim] = await db.query<ResultSetHeader>(
    `UPDATE admin_panel_notifications SET status = 'sending' WHERE id = ? AND status IN ('draft','scheduled')`, [id],
  );
  if (!claim.affectedRows) return (await getRow(id))!;

  const [recipients] = notification.targetType === "user"
    ? await db.query<(RowDataPacket & { id: number })[]>(`SELECT id FROM users WHERE id = ? AND is_active = 1`, [notification.targetUserId])
    : await db.query<(RowDataPacket & { id: number })[]>(`SELECT id FROM users WHERE is_active = 1`);
  const metadata = {
    adminNotificationId: notification.id,
    targetUrl: notification.targetUrl,
    mediaType: notification.mediaType,
    mediaUrl: notification.mediaUrl,
    contentJson: notification.contentJson,
    expiresAt: notification.expiresAt,
  };
  let recipientCount = 0;
  for (const recipient of recipients) {
    const userNotification = await createUserNotification({
      userId: Number(recipient.id),
      type: "admin_panel_notification",
      title: notification.title,
      message: notification.message,
      metadata,
    });
    recipientCount += 1;
    emitUserNotificationCreated({ userId: userNotification.userId, notification: {
      id: userNotification.id, type: userNotification.type, title: userNotification.title,
      message: userNotification.message, isRead: userNotification.isRead,
      createdAt: userNotification.createdAt, metadata: userNotification.metadata,
    }});
    await sendPushNotificationToUser(Number(recipient.id), {
      title: notification.title,
      body: notification.message,
      data: {
        type: "admin_panel_notification",
        notificationId: notification.id,
        target_url: notification.targetUrl,
      },
      android: {
        imageUrl:
          notification.mediaType === "image" || notification.mediaType === "gif"
            ? notification.mediaUrl
            : null,
      },
    }).catch((error) => console.warn("[AdminPanelNotification] push indisponível", error));
  }
  await db.query(`UPDATE admin_panel_notifications SET status = 'sent', sent_at = NOW(), recipient_count = ? WHERE id = ?`, [recipientCount, id]);
  return (await getRow(id))!;
};

export const listDueAdminPanelNotifications = async (limit = 5): Promise<number[]> => {
  await ensureAdminPanelNotificationTable();
  const [rows] = await getDb().query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM admin_panel_notifications
     WHERE status = 'scheduled' AND (starts_at IS NULL OR starts_at <= NOW())
       AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY starts_at ASC LIMIT ?`, [limit],
  );
  return rows.map((row) => Number(row.id));
};
