import { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureCustomerTable, getDb } from "lib/db";
import { getAdminWebhookRow } from "./admin-webhooks";
import { findCustomerByPhoneForUser } from "lib/customers";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const normalizePhone = (value: string) => value.trim();
const sanitizeWhatsappDigits = (value: string) => value.replace(/\D+/g, "");

let cachedAdminDigits: { value: string; expiresAt: number } = { value: "", expiresAt: 0 };

const getAdminSupportDigits = async (): Promise<string> => {
  const now = Date.now();
  if (cachedAdminDigits.expiresAt > now && cachedAdminDigits.value) {
    return cachedAdminDigits.value;
  }
  const adminRow = await getAdminWebhookRow().catch(() => null);
  const digits = adminRow?.phone_number ? sanitizeWhatsappDigits(adminRow.phone_number) : "";
  cachedAdminDigits = { value: digits, expiresAt: now + 60_000 };
  return digits;
};

const resolveCanonicalWhatsappId = async (
  whatsappId: string,
  options: { adminDigits?: string } = {},
): Promise<{ canonical: string; digits: string; adminDigits: string; isAdmin: boolean }> => {
  const trimmed = normalizePhone(whatsappId);
  const digits = sanitizeWhatsappDigits(trimmed);
  const adminDigits = options.adminDigits ?? (await getAdminSupportDigits());
  const matchesAdmin = trimmed === "__admin__" || (adminDigits && digits === adminDigits);
  if (matchesAdmin) {
    return { canonical: "__admin__", digits, adminDigits, isAdmin: true };
  }
  const canonical = digits || trimmed;
  return { canonical, digits, adminDigits, isAdmin: false };
};

const ensureSupportTables = async () => {
  const db = getDb();

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_support_threads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      whatsapp_id VARCHAR(32) NOT NULL,
      customer_name VARCHAR(255) NULL,
      profile_name VARCHAR(255) NULL,
      last_message_preview TEXT NULL,
      last_message_at DATETIME NULL,
      status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
      handling_mode ENUM('bot', 'human') NOT NULL DEFAULT 'bot',
      reminder_sent_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_whatsapp (user_id, whatsapp_id),
      INDEX idx_user_status (user_id, status, updated_at),
      CONSTRAINT fk_support_threads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureThreadColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM user_support_threads LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE user_support_threads ADD COLUMN ${definition}`);
    }
  };

  await Promise.all([
    ensureThreadColumn("handling_mode", "handling_mode ENUM('bot','human') NOT NULL DEFAULT 'bot'"),
    ensureThreadColumn("reminder_sent_at", "reminder_sent_at DATETIME NULL"),
    ensureThreadColumn("user_last_read_at", "user_last_read_at DATETIME NULL"),
    ensureThreadColumn("admin_last_read_at", "admin_last_read_at DATETIME NULL"),
  ]);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_support_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      thread_id INT NOT NULL,
      user_id INT NOT NULL,
      whatsapp_id VARCHAR(32) NOT NULL,
      direction ENUM('inbound', 'outbound') NOT NULL,
      message_type VARCHAR(32) NOT NULL,
      text TEXT NULL,
      payload LONGTEXT NULL,
      message_id VARCHAR(128) NULL,
      timestamp DATETIME NOT NULL,
      sender_user_id INT NULL,
      sender_role ENUM('user','admin','contact','system') NOT NULL DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_thread_created (thread_id, created_at),
      INDEX idx_user_whatsapp (user_id, whatsapp_id, created_at),
      CONSTRAINT fk_support_messages_thread FOREIGN KEY (thread_id) REFERENCES user_support_threads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureMessageColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM user_support_messages LIKE ?",
      [column],
    );
    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE user_support_messages ADD COLUMN ${definition}`);
    }
  };

  await Promise.all([
    ensureMessageColumn("sender_user_id", "sender_user_id INT NULL"),
    ensureMessageColumn(
      "sender_role",
      "sender_role ENUM('user','admin','contact','system') NOT NULL DEFAULT 'user'",
    ),
  ]);
};

export type SupportThread = {
  id: number;
  userId: number;
  whatsappId: string;
  customerName: string | null;
  profileName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  status: "open" | "closed";
  handlingMode: "bot" | "human";
  reminderSentAt: Date | null;
  unreadCount?: number;
};

export type SupportMessageSenderRole = "user" | "admin" | "contact" | "system";

type SupportThreadRow = RowDataPacket & {
  id: number;
  user_id: number;
  whatsapp_id: string;
  customer_name: string | null;
  profile_name: string | null;
  last_message_preview: string | null;
  last_message_at: Date | string | null;
  status: string;
  handling_mode: string | null;
  reminder_sent_at: Date | string | null;
  unread_count?: number | string | null;
};

type SupportThreadWithUserRow = SupportThreadRow & {
  user_name: string | null;
  user_email: string | null;
  user_whatsapp: string | null;
  user_avatar_path: string | null;
  user_is_active: number | boolean | null;
  has_active_subscription: number | boolean | null;
};

export type SupportThreadWithUser = {
  thread: SupportThread;
  user: {
    id: number;
    name: string;
    email: string | null;
    whatsappNumber: string | null;
    avatarUrl: string | null;
    isActive: boolean;
    hasActiveSubscription: boolean;
  };
};

const normalizeAvatarUrl = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `/${trimmed.replace(/^\/+/, "").replace(/\\/g, "/")}`;
};

const mapThreadRow = (row: SupportThreadRow): SupportThread => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  whatsappId: row.whatsapp_id,
  customerName: row.customer_name ?? null,
  profileName: row.profile_name ?? null,
  lastMessagePreview: row.last_message_preview ?? null,
  lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
  status: row.status === "closed" ? "closed" : "open",
  handlingMode: row.handling_mode === "human" ? "human" : "bot",
  reminderSentAt: row.reminder_sent_at ? new Date(row.reminder_sent_at) : null,
  unreadCount: Number(row.unread_count ?? 0) || 0,
});

export const getOrCreateSupportThread = async (
  userId: number,
  whatsappId: string,
  options?: { customerName?: string | null; profileName?: string | null },
): Promise<SupportThread> => {
  await ensureSupportTables();
  const db = getDb();
  const originalTrimmed = normalizePhone(whatsappId);
  const { canonical: normalizedWhatsappId } = await resolveCanonicalWhatsappId(originalTrimmed);

  const [existing] = await db.query<SupportThreadRow[]>(
    `SELECT * FROM user_support_threads WHERE user_id = ? AND whatsapp_id = ? LIMIT 1`,
    [userId, normalizedWhatsappId],
  );

  if (Array.isArray(existing) && existing.length > 0) {
    return mapThreadRow(existing[0]);
  }

  if (normalizedWhatsappId !== originalTrimmed) {
    const [fallbackRows] = await db.query<SupportThreadRow[]>(
      `SELECT * FROM user_support_threads WHERE user_id = ? AND whatsapp_id = ? LIMIT 1`,
      [userId, originalTrimmed],
    );
    if (Array.isArray(fallbackRows) && fallbackRows.length > 0) {
      const fallbackRow = fallbackRows[0];
      await db.query(`UPDATE user_support_threads SET whatsapp_id = ? WHERE id = ?`, [
        normalizedWhatsappId,
        fallbackRow.id,
      ]);
      await db.query(`UPDATE user_support_messages SET whatsapp_id = ? WHERE thread_id = ?`, [
        normalizedWhatsappId,
        fallbackRow.id,
      ]);
      return mapThreadRow({ ...fallbackRow, whatsapp_id: normalizedWhatsappId });
    }
  }

  const [insert] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_support_threads (user_id, whatsapp_id, customer_name, profile_name)
      VALUES (?, ?, ?, ?)
    `,
    [userId, normalizedWhatsappId, options?.customerName ?? null, options?.profileName ?? null],
  );

  const threadId = Number(insert.insertId);
  const [rows] = await db.query<SupportThreadRow[]>(
    `SELECT * FROM user_support_threads WHERE id = ? LIMIT 1`,
    [threadId],
  );

  return mapThreadRow(rows[0]);
};

export type SupportMessage = {
  id: number;
  threadId: number;
  userId: number;
  whatsappId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  text: string | null;
  payload: unknown;
  messageId: string | null;
  timestamp: string;
  senderUserId: number | null;
  senderRole: SupportMessageSenderRole;
};

export type SerializedSupportMessage = {
  id: number;
  direction: "inbound" | "outbound";
  messageType: string;
  text: string | null;
  timestamp: string;
  senderUserId: number | null;
  senderRole: SupportMessageSenderRole;
  media?: {
    mediaId?: string | null;
    mediaUrl?: string | null;
    mediaType: string;
    mimeType: string | null;
    filename?: string | null;
    caption?: string | null;
  } | null;
};

export type SerializedSupportThread = {
  whatsappId: string;
  customerName: string | null;
  profileName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  status: "open" | "closed";
  handlingMode: "bot" | "human";
  reminderSentAt: string | null;
  displayWhatsappId?: string | null;
  isAdminThread?: boolean;
  unreadCount?: number;
};

export type SupportThreadSummary = SerializedSupportThread & {
  within24h: boolean;
  minutesLeft24h: number;
};

type SupportMessageRow = RowDataPacket & {
  id: number;
  thread_id: number;
  user_id: number;
  whatsapp_id: string;
  direction: string;
  message_type: string;
  text: string | null;
  payload: string | null;
  message_id: string | null;
  timestamp: Date | string;
  sender_user_id: number | null;
  sender_role: string | null;
};

const mapMessageRow = (row: SupportMessageRow): SupportMessage => ({
  id: Number(row.id),
  threadId: Number(row.thread_id),
  userId: Number(row.user_id),
  whatsappId: row.whatsapp_id,
  direction: row.direction === "outbound" ? "outbound" : "inbound",
  messageType: row.message_type,
  text: row.text ?? null,
  payload: (() => {
    if (!row.payload) return null;
    try {
      return JSON.parse(row.payload);
    } catch {
      return row.payload;
    }
  })(),
  messageId: row.message_id ?? null,
  timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString(),
  senderUserId: row.sender_user_id == null ? null : Number(row.sender_user_id),
  senderRole: (() => {
    switch (row.sender_role) {
      case "admin":
      case "contact":
      case "system":
        return row.sender_role;
      case "user":
      default:
        return "user";
    }
  })(),
});

const extractMediaFromPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const mediaId = typeof record.mediaId === "string" ? record.mediaId : null;
  const mediaUrl = typeof record.mediaUrl === "string" ? record.mediaUrl : null;
  const mediaType = typeof record.mediaType === "string" ? record.mediaType : null;

  if (!mediaType) {
    return null;
  }

  if (!mediaId && !mediaUrl) {
    return null;
  }

  return {
    mediaId,
    mediaUrl,
    mediaType,
    mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
    filename: typeof record.filename === "string" ? record.filename : null,
    caption: typeof record.caption === "string" ? record.caption : null,
  };
};

export const serializeSupportMessage = (message: SupportMessage): SerializedSupportMessage => ({
  id: message.id,
  direction: message.direction,
  messageType: message.messageType,
  text: message.text,
  timestamp: message.timestamp,
  senderUserId: message.senderUserId,
  senderRole: message.senderRole,
  media: extractMediaFromPayload(message.payload),
});

export const serializeSupportThread = (thread: SupportThread): SerializedSupportThread => ({
  whatsappId: thread.whatsappId,
  customerName: thread.customerName,
  profileName: thread.profileName,
  lastMessagePreview: thread.lastMessagePreview,
  lastMessageAt: thread.lastMessageAt ? thread.lastMessageAt.toISOString() : null,
  status: thread.status,
  handlingMode: thread.handlingMode,
  reminderSentAt: thread.reminderSentAt ? thread.reminderSentAt.toISOString() : null,
  isAdminThread: thread.whatsappId === "__admin__",
  unreadCount: thread.unreadCount ?? 0,
});

export const recordSupportMessage = async (options: {
  userId: number;
  whatsappId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  text?: string | null;
  payload?: unknown;
  messageId?: string | null;
  timestamp?: Date;
  customerName?: string | null;
  profileName?: string | null;
  senderUserId?: number | null;
  senderRole?: SupportMessageSenderRole;
}): Promise<{ message: SupportMessage; thread: SupportThread }> => {
  const { userId, whatsappId, direction, messageType } = options;
  const timestamp = options.timestamp ? new Date(options.timestamp) : new Date();
  const trimmedWhatsappId = normalizePhone(whatsappId);
  const { canonical: normalizedWhatsappId } = await resolveCanonicalWhatsappId(trimmedWhatsappId);
  const thread = await getOrCreateSupportThread(userId, normalizedWhatsappId);
  const db = getDb();
  const isFirstInboundMessage = direction === "inbound" && (!thread.lastMessageAt);
  const isAdminThread = thread.whatsappId === "__admin__";
  const normalizedSenderRole: SupportMessageSenderRole = (() => {
    const incoming = options.senderRole;
    if (incoming === "admin" || incoming === "contact" || incoming === "system" || incoming === "user") {
      return incoming;
    }
    return direction === "inbound" ? "contact" : "user";
  })();
  const normalizedSenderUserId = (() => {
    if (typeof options.senderUserId === "number" && Number.isFinite(options.senderUserId)) {
      return Math.trunc(options.senderUserId);
    }
    if (normalizedSenderRole === "user") {
      return userId;
    }
    return null;
  })();

  const [insert] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_support_messages
        (thread_id, user_id, whatsapp_id, direction, message_type, text, payload, message_id, timestamp, sender_user_id, sender_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      thread.id,
      userId,
      normalizedWhatsappId,
      direction,
      messageType,
      options.text ?? null,
      options.payload ? JSON.stringify(options.payload) : null,
      options.messageId ?? null,
      timestamp,
      normalizedSenderUserId,
      normalizedSenderRole,
    ],
  );

  const insertedId = Number(insert.insertId);
  const [rows] = await db.query<SupportMessageRow[]>(
    `SELECT * FROM user_support_messages WHERE id = ? LIMIT 1`,
    [insertedId],
  );

  const message = mapMessageRow(rows[0]);

  const previewSource = options.text ?? (() => {
    if (!options.payload || typeof options.payload !== "object") {
      return null;
    }
    const payloadRecord = options.payload as Record<string, unknown>;
    const caption = payloadRecord.caption;
    if (typeof caption === "string" && caption.trim()) {
      return caption;
    }
    const mimeType = payloadRecord.mimeType;
    if (typeof mimeType === "string" && mimeType.trim()) {
      return mimeType;
    }
    try {
      return JSON.stringify(payloadRecord).slice(0, 120);
    } catch {
      return null;
    }
  })();
  const preview = previewSource ? previewSource.slice(0, 280) : null;

  const nextCustomerName =
    typeof options.customerName === "string" && options.customerName.trim().length > 0
      ? options.customerName
      : thread.customerName;
  const nextProfileName =
    typeof options.profileName === "string" && options.profileName.trim().length > 0
      ? options.profileName
      : thread.profileName;

  const customerLabel =
    nextCustomerName ||
    nextProfileName ||
    (isAdminThread
      ? thread.displayWhatsappId || thread.whatsappId
      : thread.whatsappId);

  const updatedThread: SupportThread = {
    ...thread,
    customerName: nextCustomerName ?? null,
    profileName: nextProfileName ?? null,
    lastMessagePreview: preview,
    lastMessageAt: timestamp,
    status: "open",
    reminderSentAt: direction === "inbound" ? null : thread.reminderSentAt,
  };

  const setClauses = [
    "last_message_preview = ?",
    "last_message_at = ?",
    "status = 'open'",
    "customer_name = COALESCE(NULLIF(?, ''), customer_name)",
    "profile_name = COALESCE(NULLIF(?, ''), profile_name)",
  ];

  const updateValues: unknown[] = [
    preview,
    timestamp,
    options.customerName ?? "",
    options.profileName ?? "",
  ];

  if (direction === "inbound") {
    setClauses.splice(2, 0, "reminder_sent_at = NULL");
  }

  await db.query(
    `
      UPDATE user_support_threads
      SET ${setClauses.join(",\n        ")}
      WHERE id = ?
    `,
    [...updateValues, thread.id],
  );

  // Dispara notificação ao abrir uma nova conversa de suporte (primeira mensagem do cliente)
  if (isFirstInboundMessage) {
    try {
      const { createUserNotification } = await import("./user-notifications");
      const { emitUserNotificationCreated } = await import("./realtime");
      const title = "Novo pedido de suporte";
      const messageText = `${customerLabel} abriu um atendimento no robô.`;

      const notification = await createUserNotification({
        userId,
        type: "support_opened",
        title,
        message: messageText,
        metadata: { whatsappId: updatedThread.whatsappId, customerName: nextCustomerName ?? null },
      });

      emitUserNotificationCreated({ userId, notification });
    } catch (notifyError) {
      console.error("[support] Falha ao notificar abertura de suporte", notifyError);
    }
  }

  const describeMessageType = (type: string) => {
    const normalized = type.toLowerCase();
    switch (normalized) {
      case "image":
        return "Enviou uma imagem.";
      case "video":
        return "Enviou um vídeo.";
      case "audio":
        return "Enviou um áudio.";
      case "document":
        return "Enviou um documento.";
      case "sticker":
        return "Enviou um sticker.";
      default:
        return "Nova mensagem.";
    }
  };

  try {
    const {
      sendPushNotificationToUser,
      ANDROID_NOTIFICATION_CHANNEL_ID,
    } = await import("./push-notifications");

    const payloadRecord =
      options.payload && typeof options.payload === "object"
        ? (options.payload as Record<string, unknown>)
        : null;
    const messageOrigin =
      payloadRecord && typeof payloadRecord.origin === "string"
        ? payloadRecord.origin
        : null;

    const baseText =
      (options.text && options.text.trim()) ||
      (typeof preview === "string" && preview.trim()) ||
      (message.text && message.text.trim()) ||
      "";
    const messageDescription = baseText || describeMessageType(message.messageType);

    const pushSenderUserId = normalizedSenderUserId != null ? String(normalizedSenderUserId) : null;
    if (direction === "outbound") {
      if (messageOrigin === "admin_panel") {
        const title = customerLabel || "Equipe de suporte";
        await sendPushNotificationToUser(userId, {
          title,
          body: messageDescription,
          data: {
            type: "support_message",
            whatsappId: normalizedWhatsappId,
            direction: "outbound",
            senderRole: normalizedSenderRole,
            ...(pushSenderUserId ? { senderUserId: pushSenderUserId } : {}),
            ...(isAdminThread ? { isAdminThread: "true" } : {}),
            targetUrl: "/dashboard/user/conversas",
          },
          android: { channelId: ANDROID_NOTIFICATION_CHANNEL_ID },
        });
      }
    } else if (direction === "inbound") {
      const title = customerLabel || "Novo atendimento";
      await sendPushNotificationToUser(userId, {
        title,
        body: messageDescription,
        data: {
          type: "support_message",
          whatsappId: normalizedWhatsappId,
          direction: "inbound",
          senderRole: normalizedSenderRole,
          ...(pushSenderUserId ? { senderUserId: pushSenderUserId } : {}),
          ...(isAdminThread ? { isAdminThread: "true" } : {}),
          targetUrl: "/dashboard/user/conversas",
        },
        android: { channelId: ANDROID_NOTIFICATION_CHANNEL_ID },
      });
    }
  } catch (pushError) {
    console.error("[support] Falha ao enviar push da mensagem", pushError);
  }

  return { message, thread: updatedThread };
};

export const deleteSupportThread = async (userId: number, whatsappId: string): Promise<boolean> => {
  await ensureSupportTables();
  const db = getDb();
  const { canonical: normalized } = await resolveCanonicalWhatsappId(whatsappId);

  const [result] = await db.query<ResultSetHeader>(
    `DELETE FROM user_support_threads WHERE user_id = ? AND whatsapp_id = ? LIMIT 1`,
    [userId, normalized],
  );

  return (result.affectedRows ?? 0) > 0;
};

export const mergeSupportThreadAlias = async (
  userId: number,
  sourceWhatsappId: string,
  targetWhatsappId: string,
  options: { customerName?: string | null; profileName?: string | null } = {},
): Promise<void> => {
  await ensureSupportTables();
  const db = getDb();

  const sourceThread = await getSupportThreadByWhatsapp(userId, sourceWhatsappId);
  if (!sourceThread) {
    return;
  }

  const targetThread = await getSupportThreadByWhatsapp(userId, targetWhatsappId);

  const { canonical: normalizedTarget } = await resolveCanonicalWhatsappId(targetWhatsappId);

  if (!targetThread) {
    await db.query(
      `
        UPDATE user_support_threads
        SET whatsapp_id = ?,
            customer_name = COALESCE(?, customer_name),
            profile_name = COALESCE(?, profile_name)
        WHERE id = ?
      `,
      [normalizedTarget, options.customerName ?? sourceThread.customerName, options.profileName ?? sourceThread.profileName, sourceThread.id],
    );
    return;
  }

  if (targetThread.id === sourceThread.id) {
    return;
  }

  await db.query(
    `UPDATE user_support_messages SET thread_id = ? WHERE thread_id = ?`,
    [targetThread.id, sourceThread.id],
  );

  const latestTimestamp = (() => {
    const candidates = [targetThread.lastMessageAt, sourceThread.lastMessageAt]
      .filter((value): value is Date => value instanceof Date);
    if (!candidates.length) return targetThread.lastMessageAt;
    const newest = candidates.reduce((acc, current) => (current > acc ? current : acc));
    return newest;
  })();

  const latestPreview = (() => {
    if (!sourceThread.lastMessageAt) return targetThread.lastMessagePreview;
    if (!targetThread.lastMessageAt) return sourceThread.lastMessagePreview;
    return sourceThread.lastMessageAt > targetThread.lastMessageAt
      ? sourceThread.lastMessagePreview
      : targetThread.lastMessagePreview;
  })();

  const mergedStatus =
    sourceThread.status === "open" || targetThread.status === "open" ? "open" : "closed";
  const mergedHandlingMode =
    sourceThread.handlingMode === "human" || targetThread.handlingMode === "human"
      ? "human"
      : "bot";

  const reminderCandidates = [targetThread.reminderSentAt, sourceThread.reminderSentAt]
    .filter((value): value is Date => value instanceof Date);
  const mergedReminder = reminderCandidates.length
    ? reminderCandidates.reduce((acc, current) => (current > acc ? current : acc))
    : null;

  await db.query(
    `
      UPDATE user_support_threads
      SET status = ?,
          handling_mode = ?,
          last_message_preview = ?,
          last_message_at = ?,
          reminder_sent_at = ?,
          customer_name = COALESCE(?, customer_name),
          profile_name = COALESCE(?, profile_name)
      WHERE id = ?
    `,
    [
      mergedStatus,
      mergedHandlingMode,
      latestPreview,
      latestTimestamp,
      mergedReminder,
      options.customerName ?? sourceThread.customerName ?? targetThread.customerName,
      options.profileName ?? sourceThread.profileName ?? targetThread.profileName,
      targetThread.id,
    ],
  );

  await db.query(`DELETE FROM user_support_threads WHERE id = ?`, [sourceThread.id]);
};

export const listSupportThreads = async (userId: number) => {
  await ensureSupportTables();
  const db = getDb();
  const [rows] = await db.query<SupportThreadRow[]>(
    `
      SELECT
        threads.*,
        (
          SELECT COUNT(*)
          FROM user_support_messages AS messages
          WHERE messages.thread_id = threads.id
            AND messages.sender_role = 'admin'
            AND messages.timestamp > COALESCE(threads.user_last_read_at, '1970-01-01')
        ) AS unread_count
      FROM user_support_threads AS threads
      WHERE threads.user_id = ?
      ORDER BY threads.status = 'open' DESC, COALESCE(threads.last_message_at, threads.created_at) DESC
    `,
    [userId],
  );

  return rows.map(mapThreadRow);
};

export const listAllSupportThreadsWithUsers = async (): Promise<SupportThreadWithUser[]> => {
  await ensureSupportTables();
  const db = getDb();
  const [rows] = await db.query<SupportThreadWithUserRow[]>(
    `
      SELECT
        threads.*,
        (
          SELECT COUNT(*)
          FROM user_support_messages AS messages
          WHERE messages.thread_id = threads.id
            AND messages.sender_role <> 'admin'
            AND messages.timestamp > COALESCE(threads.admin_last_read_at, '1970-01-01')
        ) AS unread_count,
        users.name AS user_name,
        users.email AS user_email,
        users.whatsapp_number AS user_whatsapp,
        users.avatar_path AS user_avatar_path,
        users.is_active AS user_is_active,
        EXISTS (
          SELECT 1
          FROM user_plan_subscriptions active_subscription
          WHERE active_subscription.user_id = users.id
            AND active_subscription.status = 'active'
            AND (
              active_subscription.current_period_end IS NULL
              OR active_subscription.current_period_end > NOW()
            )
        ) AS has_active_subscription
      FROM user_support_threads AS threads
      INNER JOIN users ON users.id = threads.user_id
      ORDER BY threads.status = 'open' DESC,
        COALESCE(threads.last_message_at, threads.updated_at, threads.created_at) DESC
    `,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows.map((row) => ({
    thread: mapThreadRow(row),
    user: {
      id: Number(row.user_id),
      name: row.user_name ?? "",
      email: row.user_email ?? null,
      whatsappNumber: row.user_whatsapp ?? null,
      avatarUrl: normalizeAvatarUrl(row.user_avatar_path ?? null),
      isActive: Boolean(row.user_is_active),
      hasActiveSubscription: Boolean(row.has_active_subscription),
    },
  }));
};

export const getSupportThreadByWhatsapp = async (
  userId: number,
  whatsappId: string,
): Promise<SupportThread | null> => {
  await ensureSupportTables();
  const db = getDb();
  const { canonical: normalizedWhatsappId } = await resolveCanonicalWhatsappId(whatsappId);
  const [rows] = await db.query<SupportMessageRow[]>(
    `SELECT * FROM user_support_threads WHERE user_id = ? AND whatsapp_id = ? LIMIT 1`,
    [userId, normalizedWhatsappId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapThreadRow(rows[0]);
};

export const getSupportMessages = async (threadId: number) => {
  const db = getDb();
  const [rows] = await db.query<SupportMessageRow[]>(
    `SELECT * FROM user_support_messages WHERE thread_id = ? ORDER BY created_at ASC`,
    [threadId],
  );

  return rows.map(mapMessageRow);
};

export const markSupportThreadRead = async (
  userId: number,
  whatsappId: string,
  reader: "user" | "admin",
): Promise<void> => {
  await ensureSupportTables();
  const db = getDb();
  const { canonical: normalized } = await resolveCanonicalWhatsappId(whatsappId);
  const column = reader === "admin" ? "admin_last_read_at" : "user_last_read_at";
  await db.query(
    `
      UPDATE user_support_threads
      SET ${column} = NOW()
      WHERE user_id = ? AND whatsapp_id = ?
      LIMIT 1
    `,
    [userId, normalized],
  );
};

export const closeSupportThread = async (userId: number, whatsappId: string) => {
  await ensureSupportTables();
  const db = getDb();
  const { canonical: normalizedWhatsappId } = await resolveCanonicalWhatsappId(whatsappId);
  await db.query(
    `UPDATE user_support_threads
      SET status = 'closed', handling_mode = 'bot', reminder_sent_at = NULL
      WHERE user_id = ? AND whatsapp_id = ?`,
    [userId, normalizedWhatsappId],
  );
};

export const reopenSupportThread = async (userId: number, whatsappId: string) => {
  await ensureSupportTables();
  const db = getDb();
  const { canonical: normalizedWhatsappId } = await resolveCanonicalWhatsappId(whatsappId);
  await db.query(
    `UPDATE user_support_threads SET status = 'open' WHERE user_id = ? AND whatsapp_id = ?`,
    [userId, normalizedWhatsappId],
  );
};

export const setSupportHandlingMode = async (
  userId: number,
  whatsappId: string,
  mode: "bot" | "human",
): Promise<SupportThread | null> => {
  await ensureSupportTables();
  const db = getDb();
  const { canonical: normalized } = await resolveCanonicalWhatsappId(whatsappId);

  if (mode === "human") {
    // Ativar humanizado reabre o atendimento e mantém qualquer lembrete anterior
    await db.query(
      `
        UPDATE user_support_threads
        SET handling_mode = 'human', status = 'open'
        WHERE user_id = ? AND whatsapp_id = ?
      `,
      [userId, normalized],
    );
  } else {
    // Voltando para automático limpa lembrete pendente; status permanece como está
    await db.query(
      `
        UPDATE user_support_threads
        SET handling_mode = 'bot', reminder_sent_at = NULL
        WHERE user_id = ? AND whatsapp_id = ?
      `,
      [userId, normalized],
    );
  }

  return getSupportThreadByWhatsapp(userId, normalized);
};

export const markSupportReminderSent = async (
  userId: number,
  whatsappId: string,
) => {
  await ensureSupportTables();
  const db = getDb();
  const { canonical: normalizedWhatsappId } = await resolveCanonicalWhatsappId(whatsappId);
  await db.query(
    `
      UPDATE user_support_threads
      SET reminder_sent_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND whatsapp_id = ?
    `,
    [userId, normalizedWhatsappId],
  );
};

export const getMinutesLeftIn24hWindow = async (userId: number, whatsappId: string) => {
  const { canonical: normalizedWhatsappId } = await resolveCanonicalWhatsappId(whatsappId);
  await ensureCustomerTable();
  const customer = await findCustomerByPhoneForUser(userId, normalizedWhatsappId);
  if (customer?.lastInteraction) {
    const last = new Date(customer.lastInteraction).getTime();
    const diff = Date.now() - last;
    const minutesLeft = Math.max(0, Math.floor((DAY_IN_MS - diff) / 60000));
    return { within24h: minutesLeft > 0, minutesLeft } as const;
  }

  await ensureSupportTables();
  const db = getDb();
  const [rows] = await db.query<Array<{ timestamp: Date | string }>>(
    `
      SELECT timestamp
      FROM user_support_messages
      WHERE user_id = ? AND whatsapp_id = ? AND direction = 'inbound'
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    [userId, normalizedWhatsappId],
  );

  if (Array.isArray(rows) && rows.length > 0) {
    const raw = rows[0].timestamp;
    const last = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
    if (Number.isFinite(last)) {
      const diff = Date.now() - last;
      const minutesLeft = Math.max(0, Math.floor((DAY_IN_MS - diff) / 60000));
      return { within24h: minutesLeft > 0, minutesLeft } as const;
    }
  }

  return { within24h: false, minutesLeft: 0 } as const;
};

export const buildSupportThreadSummary = async (
  userId: number,
  thread: SupportThread,
): Promise<SupportThreadSummary> => {
  // Threads internas com administrador (painel web) não seguem a janela de 24h da Meta
  const adminRow = await getAdminWebhookRow().catch(() => null);
  const adminDigits = (adminRow?.phone_number || "").toString().replace(/\D+/g, "");
  const isAdminThread =
    thread.whatsappId === "__admin__" ||
    (adminDigits && thread.whatsappId.replace(/\D+/g, "") === adminDigits);

  const base = serializeSupportThread(thread);

  if (isAdminThread) {
    return {
      ...base,
      within24h: true,
      minutesLeft24h: 9999,
      isAdminThread: true,
    };
  }

  const { within24h, minutesLeft } = await getMinutesLeftIn24hWindow(userId, thread.whatsappId);

  return {
    ...base,
    within24h,
    minutesLeft24h: minutesLeft,
    isAdminThread: false,
  };
};
