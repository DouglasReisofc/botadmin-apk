import { RowDataPacket } from "mysql2";

import { getInstanceForUser } from "lib/bot-instances";
import { ensureBotInstanceTable, ensureUserTable, getDb } from "lib/db";
import { getUserBasicByEmail } from "lib/users";
import {
  getWhatsappChatPhone,
  getWhatsappChatType,
  normalizeWhatsappChatJid,
  type WhatsappChatType,
} from "lib/whatsapp-conversations";

export class WhatsappConversationShareError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WhatsappConversationShareError";
    this.status = status;
  }
}

export type WhatsappConversationShare = {
  id: number;
  instanceId: number;
  ownerUserId: number;
  sharedUserId: number;
  chatJid: string;
  chatType: WhatsappChatType;
  title: string | null;
  phone: string | null;
  avatarUrl: string | null;
  linkedGroupId: number | null;
  name: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

type WhatsappConversationShareRow = RowDataPacket & {
  id: number;
  instance_id: number;
  owner_user_id: number;
  shared_user_id: number;
  chat_jid: string;
  chat_type: string | null;
  title: string | null;
  phone: string | null;
  avatar_url: string | null;
  linked_group_id: number | null;
  shared_user_name: string | null;
  shared_user_email: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

let ensureTask: Promise<void> | null = null;

const toIso = (value: Date | string | null): string => {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const normalizeChatType = (value: unknown, chatJid: string): WhatsappChatType => {
  if (
    value === "contact" ||
    value === "group" ||
    value === "community" ||
    value === "channel" ||
    value === "broadcast" ||
    value === "unknown"
  ) {
    return value;
  }
  return getWhatsappChatType(chatJid);
};

const mapShareRow = (row: WhatsappConversationShareRow): WhatsappConversationShare => {
  const chatJid = row.chat_jid;
  return {
    id: Number(row.id),
    instanceId: Number(row.instance_id),
    ownerUserId: Number(row.owner_user_id),
    sharedUserId: Number(row.shared_user_id),
    chatJid,
    chatType: normalizeChatType(row.chat_type, chatJid),
    title: row.title ?? null,
    phone: row.phone ?? null,
    avatarUrl: row.avatar_url ?? null,
    linkedGroupId: row.linked_group_id === null || row.linked_group_id === undefined
      ? null
      : Number(row.linked_group_id),
    name: row.shared_user_name || row.shared_user_email || `Usuário #${row.shared_user_id}`,
    email: row.shared_user_email ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
};

export const ensureWhatsappConversationShareTable = async () => {
  if (ensureTask) return ensureTask;

  ensureTask = (async () => {
    await ensureUserTable();
    await ensureBotInstanceTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_whatsapp_conversation_shares (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        instance_id INT NOT NULL,
        owner_user_id INT NOT NULL,
        shared_user_id INT NOT NULL,
        chat_jid VARCHAR(191) NOT NULL,
        chat_type ENUM('contact','group','channel','broadcast','unknown') NOT NULL DEFAULT 'unknown',
        title VARCHAR(255) NULL,
        phone VARCHAR(64) NULL,
        avatar_url MEDIUMTEXT NULL,
        linked_group_id INT NULL,
        role ENUM('admin') NOT NULL DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bot_whatsapp_conversation_shares_chat_user (instance_id, chat_jid, shared_user_id),
        KEY idx_bot_whatsapp_conversation_shares_shared_user (shared_user_id),
        KEY idx_bot_whatsapp_conversation_shares_owner (owner_user_id),
        KEY idx_bot_whatsapp_conversation_shares_chat (instance_id, chat_jid),
        CONSTRAINT fk_bot_whatsapp_conversation_shares_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_whatsapp_conversation_shares_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_whatsapp_conversation_shares_shared FOREIGN KEY (shared_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  })().catch((error) => {
    ensureTask = null;
    throw error;
  });

  return ensureTask;
};

const selectShares = async (where: string, values: unknown[]): Promise<WhatsappConversationShare[]> => {
  await ensureWhatsappConversationShareTable();
  const db = getDb();
  const [rows] = await db.query<WhatsappConversationShareRow[]>(
    `
      SELECT
        wcs.*,
        u.name AS shared_user_name,
        u.email AS shared_user_email
      FROM bot_whatsapp_conversation_shares wcs
      INNER JOIN users u ON u.id = wcs.shared_user_id
      ${where}
      ORDER BY u.name ASC, u.email ASC
    `,
    values,
  );
  return Array.isArray(rows) ? rows.map(mapShareRow) : [];
};

export const listConversationSharesForOwner = async (
  ownerUserId: number,
  instanceId: number,
  chatJidRaw: string,
): Promise<WhatsappConversationShare[]> => {
  const instance = await getInstanceForUser(ownerUserId, instanceId);
  if (!instance) {
    throw new WhatsappConversationShareError("Instância não encontrada.", 404);
  }
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) {
    throw new WhatsappConversationShareError("Conversa inválida.", 400);
  }
  return selectShares(
    "WHERE wcs.owner_user_id = ? AND wcs.instance_id = ? AND wcs.chat_jid = ?",
    [ownerUserId, instance.id, chatJid],
  );
};

export const updateConversationSharesForOwner = async (
  ownerUserId: number,
  params: {
    instanceId: number;
    chatJid: string;
    chatType?: WhatsappChatType | string | null;
    title?: string | null;
    phone?: string | null;
    avatarUrl?: string | null;
    linkedGroupId?: number | null;
    emails: string[];
  },
): Promise<{ shares: WhatsappConversationShare[]; notFound: string[]; skipped: string[] }> => {
  const instance = await getInstanceForUser(ownerUserId, params.instanceId);
  if (!instance) {
    throw new WhatsappConversationShareError("Instância não encontrada.", 404);
  }
  const chatJid = normalizeWhatsappChatJid(params.chatJid);
  if (!chatJid) {
    throw new WhatsappConversationShareError("Conversa inválida.", 400);
  }

  await ensureWhatsappConversationShareTable();
  const normalizedEmails = Array.from(
    new Set(
      params.emails
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const sharedUserIds: number[] = [];
  const notFound: string[] = [];
  const skipped: string[] = [];
  for (const email of normalizedEmails) {
    const targetUser = await getUserBasicByEmail(email);
    if (!targetUser) {
      notFound.push(email);
      continue;
    }
    if (targetUser.id === ownerUserId) {
      skipped.push(email);
      continue;
    }
    sharedUserIds.push(targetUser.id);
  }

  const uniqueUserIds = Array.from(new Set(sharedUserIds));
  const chatType = normalizeChatType(params.chatType, chatJid);
  const phone = params.phone?.trim() || getWhatsappChatPhone(chatJid);
  const title = params.title?.trim() || null;
  const avatarUrl = params.avatarUrl?.trim() || null;
  const linkedGroupId = Number.isFinite(Number(params.linkedGroupId)) && Number(params.linkedGroupId) > 0
    ? Number(params.linkedGroupId)
    : null;
  const db = getDb();

  if (uniqueUserIds.length > 0) {
    await Promise.all(
      uniqueUserIds.map((sharedUserId) =>
        db.query(
          `
            INSERT INTO bot_whatsapp_conversation_shares
              (instance_id, owner_user_id, shared_user_id, chat_jid, chat_type, title, phone, avatar_url, linked_group_id, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')
            ON DUPLICATE KEY UPDATE
              owner_user_id = VALUES(owner_user_id),
              chat_type = VALUES(chat_type),
              title = VALUES(title),
              phone = VALUES(phone),
              avatar_url = VALUES(avatar_url),
              linked_group_id = VALUES(linked_group_id),
              role = 'admin',
              updated_at = NOW()
          `,
          [instance.id, ownerUserId, sharedUserId, chatJid, chatType, title, phone, avatarUrl, linkedGroupId],
        ),
      ),
    );
  }

  await db.query(
    `
      DELETE FROM bot_whatsapp_conversation_shares
      WHERE owner_user_id = ?
        AND instance_id = ?
        AND chat_jid = ?
        ${uniqueUserIds.length > 0 ? "AND shared_user_id NOT IN (?)" : ""}
    `,
    uniqueUserIds.length > 0
      ? [ownerUserId, instance.id, chatJid, uniqueUserIds]
      : [ownerUserId, instance.id, chatJid],
  );

  const shares = await listConversationSharesForOwner(ownerUserId, instance.id, chatJid);
  return { shares, notFound, skipped };
};

export const listSharedConversationsForUser = async (
  userId: number,
): Promise<WhatsappConversationShare[]> =>
  selectShares("WHERE wcs.shared_user_id = ?", [userId]);

export const getConversationShareAccessForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
): Promise<WhatsappConversationShare | null> => {
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return null;
  await ensureWhatsappConversationShareTable();
  const db = getDb();
  const [rows] = await db.query<WhatsappConversationShareRow[]>(
    `
      SELECT
        wcs.*,
        u.name AS shared_user_name,
        u.email AS shared_user_email
      FROM bot_whatsapp_conversation_shares wcs
      INNER JOIN users u ON u.id = wcs.shared_user_id
      WHERE wcs.shared_user_id = ? AND wcs.instance_id = ? AND wcs.chat_jid = ?
      LIMIT 1
    `,
    [userId, instanceId, chatJid],
  );
  return Array.isArray(rows) && rows[0] ? mapShareRow(rows[0]) : null;
};
