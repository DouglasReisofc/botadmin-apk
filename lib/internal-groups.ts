import crypto from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureBotGroupTable, getDb } from "lib/db";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import { getPublicAppBaseUrl } from "lib/meta";
import { assertUserHasActivePanelEntitlement } from "lib/plans";
import { resolveUploadedFileUrl, saveBufferAsUploadedFile } from "lib/uploads";
import { getOrCreateUserApiKey } from "lib/user-api-keys";
import { ytDlpSearch, ytSearch, type YtSearchItem } from "lib/apis/yt";
import { createBotInterageChatCompletion } from "lib/apis/botinterage";
import { getBotInterageRuntimeConfig } from "lib/admin-botinterage-config";
import {
  isLikelyChatGptPhoneMediaRequest,
} from "lib/chatgpt-phone";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";
import type { BotGroupSettings, BotGroupWelcomeConfig } from "types/bot-groups";

export type InternalGroupRole = "owner" | "admin" | "member";
export type InternalGroupMemberStatus = "active" | "removed" | "banned";

export class InternalGroupError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string,
  ) {
    super(message);
    this.name = "InternalGroupError";
  }
}

type MembershipRow = RowDataPacket & {
  group_id: number;
  user_id: number;
  role: InternalGroupRole;
  status: InternalGroupMemberStatus;
  last_read_message_id: number | null;
  is_pinned: number | boolean;
  is_archived: number | boolean;
  is_muted: number | boolean;
};

type GroupRow = RowDataPacket & {
  id: number;
  bot_group_id: number | null;
  owner_user_id: number;
  name: string;
  description: string | null;
  avatar_path: string | null;
  wallpaper_path: string | null;
  bot_name: string | null;
  bot_avatar_path: string | null;
  is_active: number | boolean;
  invite_version: number;
  invite_token: string | null;
  invite_slug: string | null;
  bot_enabled: number | boolean;
  admins_only: number | boolean;
  members_can_add: number | boolean;
  approval_required: number | boolean;
  admins_can_edit: number | boolean;
  members_can_start_pv: number | boolean;
  welcome_enabled: number | boolean;
  welcome_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MessageRow = RowDataPacket & {
  id: number;
  group_id: number;
  sender_user_id: number;
  sender_kind: string | null;
  bot_display_name: string | null;
  bot_avatar_path: string | null;
  message_type: string;
  body: string | null;
  media_path: string | null;
  media_mime_type: string | null;
  media_file_name: string | null;
  media_size: number | null;
  interactive_payload: string | null;
  mentioned_user_ids: string | null;
  reply_to_message_id: number | null;
  is_pinned: number | boolean;
  view_once: number | boolean;
  deleted_by_user_id: number | null;
  deleted_at: Date | string | null;
  edited_at: Date | string | null;
  created_at: Date | string;
  sender_name?: string | null;
  sender_avatar_path?: string | null;
  reply_body?: string | null;
  reply_sender_name?: string | null;
  deleted_by_name?: string | null;
  client_message_id?: string | null;
};

let ensureTask: Promise<void> | null = null;

export const ensureInternalGroupTables = async () => {
  if (ensureTask) return ensureTask;
  ensureTask = (async () => {
    const db = getDb();
    await ensureBotGroupTable();
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bot_group_id INT NULL,
        owner_user_id INT NOT NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        avatar_path VARCHAR(500) NULL,
        wallpaper_path VARCHAR(500) NULL,
        invite_token_hash CHAR(64) NOT NULL,
        invite_version INT NOT NULL DEFAULT 1,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_internal_groups_invite_hash (invite_token_hash),
        UNIQUE KEY uq_internal_groups_bot_group (bot_group_id),
        KEY idx_internal_groups_owner (owner_user_id),
        CONSTRAINT fk_internal_groups_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    const ensureColumn = async (
      table: string,
      column: string,
      definition: string,
    ) => {
      const [rows] = await db.query<RowDataPacket[]>(
        `SHOW COLUMNS FROM ${table} LIKE ?`,
        [column],
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        await db.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
      }
    };
    await ensureColumn(
      "internal_groups",
      "bot_group_id",
      "bot_group_id INT NULL AFTER id",
    );
    const [botGroupIndexRows] = await db.query<RowDataPacket[]>(
      "SHOW INDEX FROM internal_groups WHERE Key_name = 'uq_internal_groups_bot_group'",
    );
    if (!Array.isArray(botGroupIndexRows) || botGroupIndexRows.length === 0) {
      await db.query(
        "ALTER TABLE internal_groups ADD UNIQUE KEY uq_internal_groups_bot_group (bot_group_id)",
      );
    }
    await ensureColumn(
      "internal_groups",
      "bot_enabled",
      "bot_enabled TINYINT(1) NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      "internal_groups",
      "wallpaper_path",
      "wallpaper_path VARCHAR(500) NULL AFTER avatar_path",
    );
    await ensureColumn("internal_groups", "invite_token", "invite_token VARCHAR(256) NULL AFTER invite_token_hash");
    await ensureColumn("internal_groups", "invite_slug", "invite_slug VARCHAR(80) NULL AFTER invite_token");
    const [inviteSlugIndexRows] = await db.query<RowDataPacket[]>(
      "SHOW INDEX FROM internal_groups WHERE Key_name = 'uq_internal_groups_invite_slug'",
    );
    if (!Array.isArray(inviteSlugIndexRows) || inviteSlugIndexRows.length === 0) {
      await db.query(
        "ALTER TABLE internal_groups ADD UNIQUE KEY uq_internal_groups_invite_slug (invite_slug)",
      );
    }
    await ensureColumn(
      "internal_groups",
      "admins_only",
      "admins_only TINYINT(1) NOT NULL DEFAULT 0",
    );
    await ensureColumn("internal_groups", "members_can_add", "members_can_add TINYINT(1) NOT NULL DEFAULT 1");
    await ensureColumn("internal_groups", "approval_required", "approval_required TINYINT(1) NOT NULL DEFAULT 0");
    await ensureColumn("internal_groups", "admins_can_edit", "admins_can_edit TINYINT(1) NOT NULL DEFAULT 1");
    await ensureColumn("internal_groups", "members_can_start_pv", "members_can_start_pv TINYINT(1) NOT NULL DEFAULT 1");
    await ensureColumn(
      "internal_groups",
      "welcome_enabled",
      "welcome_enabled TINYINT(1) NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      "internal_groups",
      "welcome_message",
      "welcome_message TEXT NULL",
    );
    await ensureColumn(
      "internal_groups",
      "bot_name",
      "bot_name VARCHAR(120) NULL",
    );
    await ensureColumn(
      "internal_groups",
      "bot_avatar_path",
      "bot_avatar_path VARCHAR(500) NULL",
    );
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_group_members (
        group_id INT NOT NULL,
        user_id INT NOT NULL,
        role VARCHAR(16) NOT NULL DEFAULT 'member',
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        last_read_message_id BIGINT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id),
        KEY idx_internal_group_members_user (user_id, status),
        CONSTRAINT fk_internal_group_members_group FOREIGN KEY (group_id) REFERENCES internal_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_internal_group_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await ensureColumn(
      "internal_group_members",
      "is_pinned",
      "is_pinned TINYINT(1) NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      "internal_group_members",
      "is_archived",
      "is_archived TINYINT(1) NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      "internal_group_members",
      "is_muted",
      "is_muted TINYINT(1) NOT NULL DEFAULT 0",
    );
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_group_messages (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        sender_user_id INT NOT NULL,
        message_type VARCHAR(20) NOT NULL DEFAULT 'text',
        body TEXT NULL,
        media_path VARCHAR(700) NULL,
        media_mime_type VARCHAR(120) NULL,
        media_file_name VARCHAR(255) NULL,
        media_size BIGINT NULL,
        reply_to_message_id BIGINT NULL,
        deleted_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_internal_group_messages_group (group_id, id),
        KEY idx_internal_group_messages_sender (sender_user_id),
        CONSTRAINT fk_internal_group_messages_group FOREIGN KEY (group_id) REFERENCES internal_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_internal_group_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_group_message_reactions (
        message_id BIGINT NOT NULL,
        user_id INT NOT NULL,
        emoji VARCHAR(32) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id),
        CONSTRAINT fk_internal_group_reaction_message FOREIGN KEY (message_id) REFERENCES internal_group_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_internal_group_reaction_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_group_sweepstakes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        poll_message_id BIGINT NULL,
        question VARCHAR(240) NOT NULL,
        participants JSON NULL,
        winners JSON NULL,
        max_participants INT NOT NULL,
        winners_count INT NOT NULL DEFAULT 1,
        status ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
        expires_at DATETIME NOT NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        concluded_at DATETIME NULL,
        KEY idx_internal_sweepstakes_group (group_id, status),
        CONSTRAINT fk_internal_sweepstakes_group FOREIGN KEY (group_id) REFERENCES internal_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_internal_sweepstakes_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_group_bot_reactions (
        message_id BIGINT NOT NULL PRIMARY KEY,
        emoji VARCHAR(32) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_internal_group_bot_reaction_message
          FOREIGN KEY (message_id) REFERENCES internal_group_messages(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await ensureColumn(
      "internal_group_messages",
      "sender_kind",
      "sender_kind VARCHAR(16) NOT NULL DEFAULT 'user'",
    );
    await ensureColumn(
      "internal_group_messages",
      "bot_display_name",
      "bot_display_name VARCHAR(120) NULL",
    );
    await ensureColumn(
      "internal_group_messages",
      "bot_avatar_path",
      "bot_avatar_path VARCHAR(500) NULL",
    );
    await ensureColumn(
      "internal_group_messages",
      "edited_at",
      "edited_at DATETIME NULL AFTER deleted_at",
    );
    await ensureColumn(
      "internal_group_messages",
      "is_pinned",
      "is_pinned TINYINT(1) NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      "internal_group_messages",
      "interactive_payload",
      "interactive_payload TEXT NULL",
    );
    await ensureColumn(
      "internal_group_messages",
      "view_once",
      "view_once TINYINT(1) NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      "internal_group_messages",
      "deleted_by_user_id",
      "deleted_by_user_id INT NULL",
    );
    await ensureColumn(
      "internal_group_messages",
      "mentioned_user_ids",
      "mentioned_user_ids TEXT NULL",
    );
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_group_message_views (
        message_id BIGINT NOT NULL,
        user_id INT NOT NULL,
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id),
        CONSTRAINT fk_internal_group_view_message FOREIGN KEY (message_id) REFERENCES internal_group_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_internal_group_view_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_group_message_receipts (
        message_id BIGINT NOT NULL,
        user_id INT NOT NULL,
        state VARCHAR(16) NOT NULL DEFAULT 'delivered',
        delivered_at DATETIME NULL,
        read_at DATETIME NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id),
        KEY idx_internal_group_receipts_user (user_id, state),
        CONSTRAINT fk_internal_group_receipt_message FOREIGN KEY (message_id) REFERENCES internal_group_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_internal_group_receipt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await ensureColumn(
      "internal_group_messages",
      "client_message_id",
      "client_message_id VARCHAR(96) NULL",
    );
    await db.query(
      "CREATE INDEX idx_internal_group_messages_client_id ON internal_group_messages (group_id, sender_user_id, client_message_id)",
    ).catch(() => undefined);
    await db.query(
      "CREATE UNIQUE INDEX uq_internal_group_messages_client_id ON internal_group_messages (group_id, sender_user_id, client_message_id)",
    ).catch(() => undefined);
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_group_bot_infractions (
        group_id INT NOT NULL,
        user_id INT NOT NULL,
        reason VARCHAR(40) NOT NULL,
        count INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id, reason),
        CONSTRAINT fk_internal_group_bot_infraction_group FOREIGN KEY (group_id) REFERENCES internal_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_internal_group_bot_infraction_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  })().catch((error) => {
    ensureTask = null;
    throw error;
  });
  return ensureTask;
};

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const parseJsonColumn = <T>(value: unknown, fallback: T): T => {
  if (Array.isArray(value) || (value && typeof value === "object")) return value as T;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed as T;
  } catch (_) {
    return fallback;
  }
};

const toSqlDateTime = (date: Date) =>
  date.toISOString().slice(0, 19).replace("T", " ");

const iso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const tokenHash = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

const newInviteToken = () => crypto.randomBytes(32).toString("base64url");

const internalGroupInviteUrl = (token: string) =>
  new URL(`/g/${encodeURIComponent(token)}`, getPublicAppBaseUrl()).toString();

const avatarUrl = (path: string | null | undefined) =>
  path ? resolveUploadedFileUrl(path) : null;

const internalBotName = (row: Pick<GroupRow, "bot_name">) =>
  cleanText(row.bot_name, 120) || "Robô BotAdmin";

const internalBotAvatarUrl = (
  groupId: number,
  path: string | null | undefined,
  version?: Date | string | null,
) => {
  if (!path) return null;
  const fileVersion = path.split(/[\\/]/).filter(Boolean).pop() ?? "bot-avatar";
  const cacheVersion = encodeURIComponent(`${iso(version) ?? ""}:${fileVersion}`);
  return `/api/internal-groups/${groupId}/bot-avatar?v=${cacheVersion}`;
};

const getMembership = async (groupId: number, userId: number) => {
  await ensureInternalGroupTables();
  const [rows] = await getDb().query<MembershipRow[]>(
    `SELECT * FROM internal_group_members WHERE group_id = ? AND user_id = ? LIMIT 1`,
    [groupId, userId],
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
};

export const assertInternalGroupMember = async (groupId: number, userId: number) => {
  const membership = await getMembership(groupId, userId);
  if (!membership || membership.status !== "active") {
    throw new InternalGroupError("Você não participa deste grupo BotAdmin.", 403, "NOT_MEMBER");
  }
  return membership;
};

export const getInternalGroupManagerByBotGroupId = async (
  botGroupId: number,
  userId: number,
) => {
  await ensureInternalGroupTables();
  const [rows] = await getDb().query<(RowDataPacket & {
    group_id: number;
    owner_user_id: number;
    role: InternalGroupRole;
  })[]>(
    `SELECT g.id AS group_id, g.owner_user_id, m.role
     FROM internal_groups g
     INNER JOIN internal_group_members m
       ON m.group_id = g.id AND m.user_id = ? AND m.status = 'active'
     WHERE g.bot_group_id = ? AND g.is_active = 1
       AND m.role IN ('owner', 'admin')
     LIMIT 1`,
    [userId, botGroupId],
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return row
    ? {
        internalGroupId: Number(row.group_id),
        ownerUserId: Number(row.owner_user_id),
        role: row.role,
      }
    : null;
};

const assertManager = async (groupId: number, userId: number) => {
  const membership = await assertInternalGroupMember(groupId, userId);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new InternalGroupError("Apenas administradores podem realizar esta ação.", 403);
  }
  await assertUserHasActivePanelEntitlement(userId);
  return membership;
};

type ReactionPayload = {
  emoji: string;
  senderName: string;
  senderJid: string;
  fromMe: boolean;
  timestamp: string | null;
};

type ReceiptPayload = {
  userId: number;
  userName: string;
  avatarUrl: string | null;
  state: "delivered" | "read";
  deliveredAt: string | null;
  readAt: string | null;
};

type ReceiptSummary = {
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
};

const serializeMessage = (
  row: MessageRow,
  currentUserId: number,
  reactions: ReactionPayload[] = [],
  options: {
    canViewDeleted?: boolean;
    viewOnceOpened?: boolean;
    receiptSummary?: ReceiptSummary;
    receipts?: ReceiptPayload[];
    pollParticipants?: Array<Record<string, unknown>>;
  } = {},
) => {
  const isBot = row.sender_kind === "bot";
  const deleted = Boolean(row.deleted_at);
  const canViewDeleted = deleted && options.canViewDeleted === true;
  const exposeContent = !deleted || canViewDeleted;
  const viewOnce = Boolean(row.view_once);
  const viewOnceOpened = viewOnce && (
    Number(row.sender_user_id) === currentUserId || options.viewOnceOpened === true
  );
  let mentionedUserIds: number[] = [];
  if (row.mentioned_user_ids) {
    try {
      const parsed = JSON.parse(row.mentioned_user_ids);
      if (Array.isArray(parsed)) {
        mentionedUserIds = parsed
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0);
      }
    } catch (_) {}
  }
  return ({
  id: Number(row.id),
  clientMessageId: row.client_message_id ?? null,
  groupId: Number(row.group_id),
  senderId: Number(row.sender_user_id),
  senderName: isBot
    ? cleanText(row.bot_display_name, 120) || "Robô BotAdmin"
    : row.sender_name ?? "Membro BotAdmin",
  senderAvatarUrl: isBot
    ? internalBotAvatarUrl(Number(row.group_id), row.bot_avatar_path, row.created_at)
    : avatarUrl(row.sender_avatar_path),
  isBot,
  type: exposeContent ? row.message_type : "deleted",
  text: exposeContent ? row.body : null,
  mediaUrl: !exposeContent || !row.media_path
    ? null
    : `/api/internal-groups/${row.group_id}/media/${row.id}`,
  // Public command thumbnails remain available as a second source if the
  // authenticated proxy cannot load the provider image.
  mediaSourceUrl: exposeContent
    && !viewOnce
    && row.message_type === "image"
    && /^https?:\/\//i.test(row.media_path ?? "")
    ? row.media_path
    : null,
  mediaMimeType: exposeContent ? row.media_mime_type : null,
  mediaFileName: exposeContent ? row.media_file_name : null,
  mediaSize: exposeContent ? Number(row.media_size ?? 0) : null,
  replyTo: row.reply_to_message_id
    ? {
        id: Number(row.reply_to_message_id),
        text: row.reply_body,
        senderName: row.reply_sender_name,
      }
    : null,
  isMine: !isBot && Number(row.sender_user_id) === currentUserId,
  deleted,
  deletedByName: deleted ? row.deleted_by_name ?? null : null,
  editedAt: row.edited_at ? iso(row.edited_at) : null,
  canRevealDeleted: canViewDeleted,
  viewOnce,
  viewOnceOpened,
  mentionedUserIds,
  mentionsMe: mentionedUserIds.includes(currentUserId),
  reactions,
  deliveryState: Number(row.sender_user_id) === currentUserId
    ? (options.receiptSummary?.readCount ? "read"
      : options.receiptSummary?.deliveredCount ? "delivered" : "sent")
    : null,
  receiptSummary: options.receiptSummary ?? {
    recipientCount: 0,
    deliveredCount: 0,
    readCount: 0,
  },
  receipts: options.receipts ?? [],
  createdAt: iso(row.created_at),
  pinned: Boolean(row.is_pinned),
  buttons: (() => {
    if (deleted || !row.interactive_payload) return [];
    try {
      const parsed = JSON.parse(row.interactive_payload);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  })(),
  pollOptions: (() => {
    if (deleted || row.message_type !== "poll" || !row.interactive_payload) return [];
    try {
      const parsed = JSON.parse(row.interactive_payload);
      if (!Array.isArray(parsed)) return [];
      const participants = options.pollParticipants ?? [];
      return parsed
        .map((option: Record<string, unknown>) => ({
          id: cleanText(option.id, 80),
          title: cleanText(option.title, 180),
          voteCount: option.id === "join" ? participants.length : 0,
          voterNames: option.id === "join"
            ? participants
              .map((participant) => cleanText(participant.displayName, 120))
              .filter(Boolean)
            : [],
        }))
        .filter((option: { id: string; title: string }) => option.id && option.title);
    } catch (_) {
      return [];
    }
  })(),
  });
};

export const setInternalGroupMessagePinned = async (
  groupId: number,
  messageId: number,
  userId: number,
  pinned: boolean,
) => {
  await assertManager(groupId, userId);
  await getDb().query(
    "UPDATE internal_group_messages SET is_pinned = ? WHERE id = ? AND group_id = ?",
    [pinned ? 1 : 0, messageId, groupId],
  );
  return { pinned };
};

/**
 * Removes only the most recent messages authored by a participant.  This is
 * intentionally separate from updateInternalGroupMember so the moderation
 * dialog can offer cleanup without accidentally banning/removing the member.
 */
export const deleteRecentInternalGroupParticipantMessages = async (
  groupId: number,
  actorUserId: number,
  participantUserId: number,
  limit = 10,
) => {
  await assertManager(groupId, actorUserId);
  if (!Number.isInteger(participantUserId) || participantUserId <= 0) {
    throw new InternalGroupError("Membro inválido.", 400);
  }
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const [rows] = await getDb().query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM internal_group_messages
      WHERE group_id = ? AND sender_user_id = ? AND sender_kind = 'user'
        AND deleted_at IS NULL
      ORDER BY id DESC LIMIT ${safeLimit}`,
    [groupId, participantUserId],
  );
  const messageIds = (rows ?? [])
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!messageIds.length) return { messageIds: [] as number[] };
  const placeholders = messageIds.map(() => "?").join(", ");
  await getDb().query(
    `UPDATE internal_group_messages
      SET deleted_at = NOW(), deleted_by_user_id = ?
      WHERE group_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
    [actorUserId, groupId, ...messageIds],
  );
  await getDb().query(
    "UPDATE internal_groups SET updated_at = NOW() WHERE id = ?",
    [groupId],
  );
  return { messageIds };
};

const internalGroupAvatarUrl = (row: GroupRow) => {
  if (!row.avatar_path) return null;
  const fileVersion = row.avatar_path.split(/[\\/]/).filter(Boolean).pop() ?? "avatar";
  const version = encodeURIComponent(`${iso(row.updated_at) ?? ""}:${fileVersion}`);
  return `/api/internal-groups/${row.id}/avatar?v=${version}`;
};

const internalGroupWallpaperUrl = (row: GroupRow) => {
  if (!row.wallpaper_path) return null;
  const fileVersion = row.wallpaper_path.split(/[\\/]/).filter(Boolean).pop() ?? "wallpaper";
  const version = encodeURIComponent(`${iso(row.updated_at) ?? ""}:${fileVersion}`);
  return `/api/internal-groups/${row.id}/wallpaper?v=${version}`;
};

const loadInternalUserName = async (userId: number) => {
  const [rows] = await getDb().query<(RowDataPacket & { name: string })[]>(
    "SELECT name FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  return rows?.[0]?.name?.trim() || "Membro BotAdmin";
};

const insertInternalSystemMessage = async (
  groupId: number,
  actorUserId: number,
  text: string,
) => {
  const body = cleanText(text, 4000);
  if (!body) return null;
  const [result] = await getDb().query<ResultSetHeader>(
    `INSERT INTO internal_group_messages
      (group_id, sender_user_id, message_type, body)
     VALUES (?, ?, 'system', ?)`,
    [groupId, actorUserId, body],
  );
  await getDb().query(
    "UPDATE internal_groups SET updated_at = NOW() WHERE id = ?",
    [groupId],
  );
  return Number(result.insertId);
};

export const listInternalGroupIdsForUser = async (userId: number) => {
  await ensureInternalGroupTables();
  const [rows] = await getDb().query<(RowDataPacket & { group_id: number })[]>(
    `SELECT group_id FROM internal_group_members
      WHERE user_id = ? AND status = 'active'`,
    [userId],
  );
  return new Set(rows.map((row) => Number(row.group_id)));
};

const loadGroupRow = async (groupId: number) => {
  await ensureInternalGroupTables();
  const [rows] = await getDb().query<GroupRow[]>(
    `SELECT * FROM internal_groups WHERE id = ? LIMIT 1`,
    [groupId],
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
};

const ensureInternalSettingsGroup = async (row: GroupRow): Promise<number> => {
  const db = getDb();
  const currentId = Number(row.bot_group_id ?? 0);
  if (currentId > 0) {
    const [existing] = await db.query<RowDataPacket[]>(
      "SELECT id FROM bot_groups WHERE id = ? LIMIT 1",
      [currentId],
    );
    if (Array.isArray(existing) && existing.length > 0) return currentId;
  }

  const remoteId = `botadmin-internal:${row.id}`;
  const [existingRows] = await db.query<RowDataPacket[]>(
    "SELECT id FROM bot_groups WHERE remote_id = ? AND user_id = ? LIMIT 1",
    [remoteId, row.owner_user_id],
  );
  let botGroupId = Number(existingRows?.[0]?.id ?? 0);
  if (botGroupId <= 0) {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO bot_groups
        (user_id, instance_id, slot, remote_id, name, description, image_url, status, participants, metadata)
       VALUES (?, NULL, 0, ?, ?, ?, ?, ?, '[]', ?)`,
      [
        row.owner_user_id,
        remoteId,
        row.name,
        row.description,
        internalGroupAvatarUrl(row),
        row.bot_enabled ? "active" : "disabled",
        JSON.stringify({
          internalGroupId: Number(row.id),
          internalGroup: true,
          hiddenFromWhatsappGroups: true,
        }),
      ],
    );
    botGroupId = Number(result.insertId);
  }
  await db.query(
    "UPDATE internal_groups SET bot_group_id = ? WHERE id = ?",
    [botGroupId, row.id],
  );
  row.bot_group_id = botGroupId;
  return botGroupId;
};

const syncInternalSettingsGroup = async (row: GroupRow) => {
  const botGroupId = await ensureInternalSettingsGroup(row);
  await getDb().query(
    `UPDATE bot_groups
     SET name = ?, description = ?, image_url = ?, status = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      row.name,
      row.description,
      internalGroupAvatarUrl(row),
      row.bot_enabled ? "active" : "disabled",
      botGroupId,
    ],
  );
  return botGroupId;
};

const renderInternalGroupTemplate = (
  template: string,
  input: { memberName: string; groupName: string; memberId: number; prefix: string },
) => {
  const now = new Date();
  const replacements: Record<string, string> = {
    nome: input.memberName,
    pushname: input.memberName,
    usuario: input.memberName,
    numero: String(input.memberId),
    grupo: input.groupName,
    nomegrupo: input.groupName,
    data: now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    hora: now.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    }),
    prefixo: input.prefix,
    prefix: input.prefix,
  };
  return template
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
      replacements[key.toLowerCase()] ?? _match,
    )
    .replace(/\{\s*(nome|grupo)\s*\}/gi, (_match, key: string) =>
      replacements[key.toLowerCase()] ?? _match,
    )
    .trim();
};

const mediaTypeForConfig = (config: BotGroupWelcomeConfig) => {
  if (config.asSticker) return "sticker";
  const ref = `${config.mediaPath ?? ""} ${config.mediaUrl ?? ""}`.toLowerCase();
  if (/\.(mp4|mov|webm)(?:$|[?#])/.test(ref)) return "video";
  if (/\.(mp3|ogg|opus|m4a|wav)(?:$|[?#])/.test(ref)) return "audio";
  if (/\.(pdf|docx?|xlsx?|zip|rar)(?:$|[?#])/.test(ref)) return "document";
  return "image";
};

const insertInternalBotMessage = async (
  group: GroupRow,
  body: string | null,
  config?: BotGroupWelcomeConfig | null,
) => {
  const mediaPath = config?.mediaPath?.trim() || config?.mediaUrl?.trim() || null;
  const type = mediaPath ? mediaTypeForConfig(config!) : "text";
  const [result] = await getDb().query<ResultSetHeader>(
    `INSERT INTO internal_group_messages
      (group_id, sender_user_id, sender_kind, bot_display_name, bot_avatar_path,
       message_type, body, media_path, media_mime_type, media_file_name)
     VALUES (?, ?, 'bot', ?, ?, ?, ?, ?, ?, ?)`,
    [
      group.id,
      group.owner_user_id,
      internalBotName(group),
      group.bot_avatar_path,
      type,
      body,
      mediaPath,
      type === "sticker" ? "image/webp" : null,
      mediaPath?.split(/[/?#]/).filter(Boolean).pop() ?? null,
    ],
  );
  await getDb().query("UPDATE internal_groups SET updated_at = NOW() WHERE id = ?", [group.id]);
  return Number(result.insertId);
};

const emitInternalMembershipAutomation = async (
  group: GroupRow,
  memberId: number,
  kind: "welcome" | "farewell",
) => {
  if (!group.bot_enabled) return null;
  const settingsId = await syncInternalSettingsGroup(group);
  const settings = await getGroupSettings(settingsId);
  const config = kind === "welcome" ? settings.welcomeConfig : settings.farewellConfig;
  const toggle = kind === "welcome" ? "bemvindo" : "despedida";
  if (!config.enabled && settings.commandToggles[toggle] !== true) return null;
  const [users] = await getDb().query<(RowDataPacket & {
    name: string;
    avatar_path: string | null;
  })[]>(
    "SELECT name, avatar_path FROM users WHERE id = ? LIMIT 1",
    [memberId],
  );
  const memberName = users?.[0]?.name?.trim() || "Membro BotAdmin";
  const caption = renderInternalGroupTemplate(config.caption, {
    memberName,
    groupName: group.name,
    memberId,
    prefix: settings.commandPrefixes[0]?.trim() || "!",
  });
  const effectiveConfig = config.useParticipantProfilePhoto && users?.[0]?.avatar_path
    ? { ...config, mediaPath: users[0].avatar_path, mediaUrl: null, asSticker: false }
    : config;
  const buttonText = config.replyButtons?.enabled && config.replyButtons.buttons.length
    ? config.replyButtons.buttons
        .map((button) => `• ${button.label}${button.command ? ` — ${button.command}${button.args ? ` ${button.args}` : ""}` : ""}`)
        .join("\n")
    : "";
  const firstId = await insertInternalBotMessage(
    group,
    [caption, buttonText].filter(Boolean).join("\n\n") || null,
    effectiveConfig,
  );
  for (const attachment of config.attachments ?? []) {
    if (attachment.kind === "vcard") {
      await insertInternalAutomationMessage(
        group,
        `👤 ${attachment.name}\n${attachment.vcard}`,
      );
      continue;
    }
    await insertInternalAutomationMessage(group, null, {
      mediaType: attachment.kind,
      path: attachment.path,
      url: attachment.url,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      caption: attachment.caption,
    });
  }
  return firstId;
};

const serializeGroupForUser = async (row: GroupRow, userId: number, membership: MembershipRow) => {
  const db = getDb();
  // Convites antigos foram criados antes de o token em claro ser persistido.
  // Gere um token compatível automaticamente para que o administrador nunca
  // veja “Link privado indisponível”. O hash continua sendo a chave de busca.
  if (!row.invite_token) {
    const token = newInviteToken();
    await db.query(
      `UPDATE internal_groups SET invite_token_hash = ?, invite_token = ?, updated_at = NOW() WHERE id = ? AND invite_token IS NULL`,
      [tokenHash(token), token, row.id],
    );
    row.invite_token = token;
  }
  const botGroupId = await syncInternalSettingsGroup(row);
  const [memberRows] = await db.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM internal_group_members WHERE group_id = ? AND status = 'active'`,
    [row.id],
  );
  const [lastRows] = await db.query<MessageRow[]>(
    `
      SELECT m.*, u.name AS sender_name, u.avatar_path AS sender_avatar_path
      FROM internal_group_messages m
      INNER JOIN users u ON u.id = m.sender_user_id
      WHERE m.group_id = ?
      ORDER BY m.id DESC
      LIMIT 1
    `,
    [row.id],
  );
  const [unreadRows] = await db.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM internal_group_messages
      WHERE group_id = ? AND id > ?
        AND (sender_kind = 'bot' OR sender_user_id <> ?)`,
    [row.id, Number(membership.last_read_message_id ?? 0), userId],
  );
  const [mentionRows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM internal_group_messages
      WHERE group_id = ? AND id > ?
        AND (sender_kind = 'bot' OR sender_user_id <> ?)
        AND mentioned_user_ids LIKE ?
      LIMIT 1`,
    [
      row.id,
      Number(membership.last_read_message_id ?? 0),
      userId,
      `%"${userId}"%`,
    ],
  );
  const last = Array.isArray(lastRows) && lastRows.length ? lastRows[0] : null;
  return {
    id: Number(row.id),
    botGroupId,
    name: row.name,
    description: row.description,
    avatarUrl: internalGroupAvatarUrl(row),
    wallpaperUrl: internalGroupWallpaperUrl(row),
    botName: internalBotName(row),
    botAvatarUrl: internalBotAvatarUrl(row.id, row.bot_avatar_path, row.updated_at),
    role: membership.role,
    isOwner: membership.role === "owner",
    canManage: membership.role === "owner" || membership.role === "admin",
    botEnabled: Boolean(row.bot_enabled),
    adminsOnly: Boolean(row.admins_only),
    membersCanSend: !Boolean(row.admins_only),
    membersCanAdd: row.members_can_add !== false && Number(row.members_can_add) !== 0,
    approvalRequired: Boolean(row.approval_required),
    adminsCanEdit: row.admins_can_edit !== false && Number(row.admins_can_edit) !== 0,
    membersCanStartPv: row.members_can_start_pv !== false && Number(row.members_can_start_pv) !== 0,
    inviteUrl: membership.role === "owner" || membership.role === "admin"
      ? (row.invite_slug
          ? internalGroupInviteUrl(row.invite_slug)
          : row.invite_token
            ? internalGroupInviteUrl(row.invite_token)
            : null)
      : null,
    welcomeEnabled: Boolean(row.welcome_enabled),
    welcomeMessage: row.welcome_message,
    pinned: Boolean(membership.is_pinned),
    archived: Boolean(membership.is_archived),
    muted: Boolean(membership.is_muted),
    isActive: Boolean(row.is_active),
    memberCount: Number(memberRows?.[0]?.total ?? 0) + 1,
    unreadCount: Number(unreadRows?.[0]?.total ?? 0),
    hasUnreadMention: Array.isArray(mentionRows) && mentionRows.length > 0,
    lastMessage: last ? serializeMessage(last, userId) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
};

export const listInternalGroupsForUser = async (userId: number) => {
  await ensureInternalGroupTables();
  const [rows] = await getDb().query<(GroupRow & MembershipRow)[]>(
    `
      SELECT g.*, m.role, m.status, m.last_read_message_id, m.is_pinned,
             m.is_archived, m.is_muted, m.group_id, m.user_id
      FROM internal_group_members m
      INNER JOIN internal_groups g ON g.id = m.group_id
      WHERE m.user_id = ? AND m.status = 'active' AND g.is_active = 1
      ORDER BY m.is_pinned DESC, m.is_archived ASC, g.updated_at DESC, g.id DESC
    `,
    [userId],
  );
  return Promise.all(rows.map((row) => serializeGroupForUser(row, userId, row)));
};

/** Dados públicos mínimos usados pelo preview de compartilhamento do convite. */
export const getInternalGroupInvitePreview = async (rawToken: string) => {
  await ensureInternalGroupTables();
  const token = cleanText(rawToken, 256);
  if (!token) return null;
  const [rows] = await getDb().query<GroupRow[]>(
    `SELECT * FROM internal_groups WHERE (invite_token_hash = ? OR invite_slug = ?) AND is_active = 1 LIMIT 1`,
    [tokenHash(token), token.toLowerCase()],
  );
  const group = rows?.[0];
  if (!group) return null;
  return {
    name: group.name,
    description: group.description,
    // A URL pública é necessária para os crawlers de WhatsApp/Telegram e
    // redes sociais montarem o card sem sessão autenticada.
    // Convites são públicos e o endpoint autenticado de avatar não pode ser
    // usado por crawlers nem pelo visitante antes do login. O token assinado
    // na própria URL limita o acesso ao avatar deste convite.
    avatarUrl: group.avatar_path
      ? `/api/internal-groups/invite/avatar?token=${encodeURIComponent(token)}`
      : null,
    memberCount: Number((await getDb().query<RowDataPacket[]>(
      `SELECT user_id FROM internal_group_members WHERE group_id = ? AND status = 'active'`,
      [group.id],
    ))[0]?.length ?? 0),
    inviteUrl: internalGroupInviteUrl(token),
  };
};

/** Resolve a foto do grupo para o endpoint público do convite. */
export const getInternalGroupInviteAvatarAccess = async (rawToken: string) => {
  await ensureInternalGroupTables();
  const token = cleanText(rawToken, 256);
  if (!token) return null;
  const [rows] = await getDb().query<Pick<GroupRow, "avatar_path">[]>(
    `SELECT avatar_path FROM internal_groups
      WHERE (invite_token_hash = ? OR invite_slug = ?) AND is_active = 1
      LIMIT 1`,
    [tokenHash(token), token.toLowerCase()],
  );
  const group = rows?.[0];
  return group?.avatar_path ? { path: group.avatar_path } : null;
};

export const createInternalGroup = async (
  userId: number,
  input: { name?: unknown; description?: unknown },
) => {
  await assertUserHasActivePanelEntitlement(userId);
  await ensureInternalGroupTables();
  const name = cleanText(input.name, 120);
  if (name.length < 2) throw new InternalGroupError("Informe um nome para o grupo.");
  const description = cleanText(input.description, 500) || null;
  const token = newInviteToken();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO internal_groups (owner_user_id, name, description, invite_token_hash, invite_token) VALUES (?, ?, ?, ?, ?)`,
    [userId, name, description, tokenHash(token), token],
  );
  const groupId = Number(result.insertId);
  await db.query(
    `INSERT INTO internal_group_members (group_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
    [groupId, userId],
  );
  const row = await loadGroupRow(groupId);
  const membership = await getMembership(groupId, userId);
  if (!row || !membership) throw new InternalGroupError("Não foi possível criar o grupo.", 500);
  return {
    group: await serializeGroupForUser(row, userId, membership),
    inviteToken: token,
    inviteUrl: internalGroupInviteUrl(token),
  };
};

export const joinInternalGroupByToken = async (userId: number, rawToken: string) => {
  await ensureInternalGroupTables();
  const token = cleanText(rawToken, 256);
  if (!token) throw new InternalGroupError("Convite inválido.", 404);
  const [rows] = await getDb().query<GroupRow[]>(
    `SELECT * FROM internal_groups WHERE (invite_token_hash = ? OR invite_slug = ?) AND is_active = 1 LIMIT 1`,
    [tokenHash(token), token.toLowerCase()],
  );
  const group = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!group) throw new InternalGroupError("Este convite não existe ou foi revogado.", 404, "INVITE_INVALID");

  const existing = await getMembership(group.id, userId);
  const shouldWelcome = !existing || existing.status !== "active";
  if (existing?.status === "banned") {
    throw new InternalGroupError("Você foi bloqueado neste grupo.", 403, "MEMBER_BANNED");
  }
  if (existing) {
    await getDb().query(
      `UPDATE internal_group_members SET status = 'active', updated_at = NOW() WHERE group_id = ? AND user_id = ?`,
      [group.id, userId],
    );
  } else {
    await getDb().query(
      `INSERT INTO internal_group_members (group_id, user_id, role, status) VALUES (?, ?, 'member', 'active')`,
      [group.id, userId],
    );
  }
  const membership = await getMembership(group.id, userId);
  const systemMessageId = shouldWelcome
    ? await insertInternalSystemMessage(
        group.id,
        userId,
        `${await loadInternalUserName(userId)} entrou pelo link de convite.`,
      )
    : null;
  const automationMessageId = shouldWelcome
    ? await emitInternalMembershipAutomation(group, userId, "welcome")
    : null;
  const updatedGroup = await loadGroupRow(group.id);
  return {
    group: await serializeGroupForUser(updatedGroup ?? group, userId, membership!),
    systemMessageId,
    automationMessageIds: automationMessageId ? [automationMessageId] : [],
  };
};

export const rotateInternalGroupInvite = async (groupId: number, userId: number) => {
  await assertManager(groupId, userId);
  const token = newInviteToken();
  await getDb().query(
    `UPDATE internal_groups SET invite_token_hash = ?, invite_token = ?, invite_slug = NULL, invite_version = invite_version + 1, updated_at = NOW() WHERE id = ?`,
    [tokenHash(token), token, groupId],
  );
  const systemMessageId = await insertInternalSystemMessage(
    groupId,
    userId,
    `${await loadInternalUserName(userId)} redefiniu o link de convite do grupo.`,
  );
  return {
    inviteToken: token,
    inviteUrl: internalGroupInviteUrl(token),
    systemMessageIds: systemMessageId ? [systemMessageId] : [],
  };
};

export const getInternalGroupForUser = async (groupId: number, userId: number) => {
  const membership = await assertInternalGroupMember(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group || !group.is_active) throw new InternalGroupError("Grupo não encontrado.", 404);
  const [members] = await getDb().query<(RowDataPacket & {
    user_id: number;
    role: InternalGroupRole;
    status: InternalGroupMemberStatus;
    joined_at: Date | string;
    name: string;
    avatar_path: string | null;
  })[]>(
    `
      SELECT m.user_id, m.role, m.status, m.joined_at, u.name, u.avatar_path
      FROM internal_group_members m
      INNER JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? AND m.status = 'active'
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name ASC
    `,
    [groupId],
  );
  return {
    group: await serializeGroupForUser(group, userId, membership),
    members: [
      {
        userId: -Number(group.id),
        name: internalBotName(group),
        avatarUrl: internalBotAvatarUrl(group.id, group.bot_avatar_path, group.updated_at),
        role: "bot",
        joinedAt: iso(group.created_at),
        isMe: false,
        isBot: true,
      },
      ...members.map((member) => ({
        userId: Number(member.user_id),
        name: member.name,
        avatarUrl: avatarUrl(member.avatar_path),
        role: member.role,
        joinedAt: iso(member.joined_at),
        isMe: Number(member.user_id) === userId,
        isBot: false,
      })),
    ],
  };
};

export const updateInternalGroup = async (
  groupId: number,
  userId: number,
  input: {
    name?: unknown;
    description?: unknown;
    isActive?: unknown;
    botEnabled?: unknown;
    botName?: unknown;
    welcomeEnabled?: unknown;
    welcomeMessage?: unknown;
    membersCanSend?: unknown;
    membersCanAdd?: unknown;
    approvalRequired?: unknown;
    adminsCanEdit?: unknown;
    membersCanStartPv?: unknown;
    inviteSlug?: unknown;
  },
) => {
  const manager = await assertManager(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
  if (input.isActive === false && manager.role !== "owner") {
    throw new InternalGroupError("Apenas o proprietário pode encerrar o grupo.", 403);
  }
  const name = input.name === undefined ? group.name : cleanText(input.name, 120);
  if (name.length < 2) throw new InternalGroupError("Informe um nome para o grupo.");
  const description = input.description === undefined
    ? group.description
    : cleanText(input.description, 500) || null;
  const active = input.isActive === undefined ? Boolean(group.is_active) : input.isActive === true;
  const botEnabled = input.botEnabled === undefined
    ? Boolean(group.bot_enabled)
    : input.botEnabled === true;
  const botName = input.botName === undefined
    ? internalBotName(group)
    : cleanText(input.botName, 120);
  if (botName.length < 2) {
    throw new InternalGroupError("Informe um nome válido para o robô.");
  }
  const welcomeEnabled = input.welcomeEnabled === undefined
    ? Boolean(group.welcome_enabled)
    : input.welcomeEnabled === true;
  const welcomeMessage = input.welcomeMessage === undefined
    ? group.welcome_message
    : cleanText(input.welcomeMessage, 4000) || null;
  const membersCanSend = input.membersCanSend === undefined
    ? !Boolean(group.admins_only)
    : input.membersCanSend === true;
  const adminsOnly = !membersCanSend;
  const membersCanAdd = input.membersCanAdd === undefined
    ? (group.members_can_add !== false && Number(group.members_can_add) !== 0)
    : input.membersCanAdd === true;
  const approvalRequired = input.approvalRequired === undefined
    ? Boolean(group.approval_required)
    : input.approvalRequired === true;
  const adminsCanEdit = input.adminsCanEdit === undefined
    ? (group.admins_can_edit !== false && Number(group.admins_can_edit) !== 0)
    : input.adminsCanEdit === true;
  const membersCanStartPv = input.membersCanStartPv === undefined
    ? (group.members_can_start_pv !== false && Number(group.members_can_start_pv) !== 0)
    : input.membersCanStartPv === true;
  let inviteSlug = group.invite_slug;
  if (input.inviteSlug !== undefined) {
    const requestedSlug = cleanText(input.inviteSlug, 80)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (requestedSlug.length < 3) {
      throw new InternalGroupError("O link personalizado deve ter pelo menos 3 caracteres.");
    }
    const [existingSlug] = await getDb().query<RowDataPacket[]>(
      "SELECT id FROM internal_groups WHERE invite_slug = ? AND id <> ? LIMIT 1",
      [requestedSlug, groupId],
    );
    if (existingSlug.length) {
      throw new InternalGroupError("Este link personalizado já está sendo usado.", 409);
    }
    inviteSlug = requestedSlug;
  }
  await getDb().query(
    `UPDATE internal_groups SET name = ?, description = ?, is_active = ?, bot_enabled = ?,
      bot_name = ?, welcome_enabled = ?, welcome_message = ?, admins_only = ?,
      members_can_add = ?, approval_required = ?, admins_can_edit = ?, members_can_start_pv = ?,
      invite_slug = ?, updated_at = NOW() WHERE id = ?`,
    [name, description, active ? 1 : 0, botEnabled ? 1 : 0, botName,
      welcomeEnabled ? 1 : 0, welcomeMessage, adminsOnly ? 1 : 0,
      membersCanAdd ? 1 : 0, approvalRequired ? 1 : 0, adminsCanEdit ? 1 : 0,
      membersCanStartPv ? 1 : 0, inviteSlug, groupId],
  );
  const actorName = await loadInternalUserName(userId);
  const systemMessageIds: number[] = [];
  if (name !== group.name) {
    const id = await insertInternalSystemMessage(
      groupId,
      userId,
      `${actorName} mudou o nome do grupo de “${group.name}” para “${name}”.`,
    );
    if (id) systemMessageIds.push(id);
  }
  if (description !== group.description) {
    const id = await insertInternalSystemMessage(
      groupId,
      userId,
      description
        ? `${actorName} alterou a descrição do grupo.`
        : `${actorName} removeu a descrição do grupo.`,
    );
    if (id) systemMessageIds.push(id);
  }
  if (active !== Boolean(group.is_active)) {
    const id = await insertInternalSystemMessage(
      groupId,
      userId,
      active
        ? `${actorName} reabriu o grupo.`
        : `${actorName} encerrou o grupo.`,
    );
    if (id) systemMessageIds.push(id);
  }
  if (botName !== internalBotName(group)) {
    await getDb().query(
      `UPDATE internal_group_messages
       SET bot_display_name = ?
       WHERE group_id = ? AND sender_kind = 'bot'`,
      [botName, groupId],
    );
    const id = await insertInternalSystemMessage(
      groupId,
      userId,
      `${actorName} alterou o nome do robô do grupo para “${botName}”.`,
    );
    if (id) systemMessageIds.push(id);
  }
  const updated = await loadGroupRow(groupId);
  return {
    group: await serializeGroupForUser(updated!, userId, manager),
    systemMessageIds,
  };
};

export const updateInternalGroupAvatar = async (
  groupId: number,
  userId: number,
  avatarPath: string | null,
) => {
  const manager = await assertManager(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
  await getDb().query(
    `UPDATE internal_groups SET avatar_path = ?, updated_at = NOW() WHERE id = ?`,
    [avatarPath, groupId],
  );
  const systemMessageId = await insertInternalSystemMessage(
    groupId,
    userId,
    avatarPath
      ? `${await loadInternalUserName(userId)} alterou a foto do grupo.`
      : `${await loadInternalUserName(userId)} removeu a foto do grupo.`,
  );
  const updated = await loadGroupRow(groupId);
  return {
    group: await serializeGroupForUser(updated!, userId, manager),
    previousAvatarPath: group.avatar_path,
    systemMessageIds: systemMessageId ? [systemMessageId] : [],
  };
};

export const updateInternalGroupWallpaper = async (
  groupId: number,
  userId: number,
  wallpaperPath: string | null,
) => {
  const manager = await assertManager(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
  await getDb().query(
    `UPDATE internal_groups SET wallpaper_path = ?, updated_at = NOW() WHERE id = ?`,
    [wallpaperPath, groupId],
  );
  const actorName = await loadInternalUserName(userId);
  const systemMessageId = await insertInternalSystemMessage(
    groupId,
    userId,
    wallpaperPath
      ? `${actorName} alterou o papel de parede do grupo.`
      : `${actorName} restaurou o papel de parede padrão do grupo.`,
  );
  const updated = await loadGroupRow(groupId);
  return {
    group: await serializeGroupForUser(updated!, userId, manager),
    previousWallpaperPath: group.wallpaper_path,
    systemMessageIds: systemMessageId ? [systemMessageId] : [],
  };
};

export const updateInternalGroupBotAvatar = async (
  groupId: number,
  userId: number,
  avatarPath: string | null,
) => {
  const manager = await assertManager(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
  await getDb().query(
    `UPDATE internal_groups SET bot_avatar_path = ?, updated_at = NOW() WHERE id = ?`,
    [avatarPath, groupId],
  );
  await getDb().query(
    `UPDATE internal_group_messages
     SET bot_avatar_path = ?
     WHERE group_id = ? AND sender_kind = 'bot'`,
    [avatarPath, groupId],
  );
  const systemMessageId = await insertInternalSystemMessage(
    groupId,
    userId,
    avatarPath
      ? `${await loadInternalUserName(userId)} alterou a foto do robô do grupo.`
      : `${await loadInternalUserName(userId)} removeu a foto do robô do grupo.`,
  );
  const updated = await loadGroupRow(groupId);
  return {
    group: await serializeGroupForUser(updated!, userId, manager),
    previousAvatarPath: group.bot_avatar_path,
    systemMessageIds: systemMessageId ? [systemMessageId] : [],
  };
};

export const runInternalGroupConversationAction = async (
  groupId: number,
  userId: number,
  action: string,
  data: Record<string, unknown> = {},
) => {
  const membership = await assertInternalGroupMember(groupId, userId);
  if (action === "pin" || action === "unpin") {
    await getDb().query(
      `UPDATE internal_group_members SET is_pinned = ? WHERE group_id = ? AND user_id = ?`,
      [action === "pin" ? 1 : 0, groupId, userId],
    );
    return { message: action === "pin" ? "Conversa fixada." : "Conversa desfixada." };
  }
  if (action === "archive" || action === "unarchive") {
    await getDb().query(
      `UPDATE internal_group_members SET is_archived = ? WHERE group_id = ? AND user_id = ?`,
      [action === "archive" ? 1 : 0, groupId, userId],
    );
    return { message: action === "archive" ? "Conversa arquivada." : "Conversa desarquivada." };
  }
  if (action === "mute" || action === "unmute") {
    await getDb().query(
      `UPDATE internal_group_members SET is_muted = ? WHERE group_id = ? AND user_id = ?`,
      [action === "mute" ? 1 : 0, groupId, userId],
    );
    return { message: action === "mute" ? "Notificações silenciadas." : "Notificações ativadas." };
  }
  if (action === "leave") {
    if (membership.role === "owner") {
      throw new InternalGroupError(
        "Escolha um administrador para receber a propriedade antes de sair.",
        400,
        "OWNER_TRANSFER_REQUIRED",
      );
    }
    const group = await loadGroupRow(groupId);
    await getDb().query(
      `UPDATE internal_group_members SET status = 'removed' WHERE group_id = ? AND user_id = ?`,
      [groupId, userId],
    );
    const systemMessageId = await insertInternalSystemMessage(
      groupId,
      userId,
      `${await loadInternalUserName(userId)} saiu do grupo.`,
    );
    const automationMessageId = group
      ? await emitInternalMembershipAutomation(group, userId, "farewell")
      : null;
    return {
      action: "leave",
      message: "Você saiu do grupo BotAdmin.",
      systemMessageIds: systemMessageId ? [systemMessageId] : [],
      automationMessageIds: automationMessageId ? [automationMessageId] : [],
    };
  }
  if (action === "transfer-and-leave") {
    if (membership.role !== "owner") {
      throw new InternalGroupError("Apenas o proprietário pode transferir o grupo.", 403);
    }
    const newOwnerUserId = Math.max(0, Number(data.newOwnerUserId ?? 0));
    const target = await getMembership(groupId, newOwnerUserId);
    if (!target || target.status !== "active" || target.role !== "admin") {
      throw new InternalGroupError(
        "Selecione um administrador ativo para receber o grupo.",
        400,
        "ADMIN_REQUIRED",
      );
    }
    const group = await loadGroupRow(groupId);
    if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
    const db = getDb();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE internal_group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?`,
        [groupId, newOwnerUserId],
      );
      await connection.query(
        `UPDATE internal_group_members SET role = 'member', status = 'removed' WHERE group_id = ? AND user_id = ?`,
        [groupId, userId],
      );
      await connection.query(
        `UPDATE internal_groups SET owner_user_id = ?, updated_at = NOW() WHERE id = ?`,
        [newOwnerUserId, groupId],
      );
      if (Number(group.bot_group_id ?? 0) > 0) {
        await connection.query(
          `UPDATE bot_groups SET user_id = ?, updated_at = NOW() WHERE id = ?`,
          [newOwnerUserId, group.bot_group_id],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const actorName = await loadInternalUserName(userId);
    const newOwnerName = await loadInternalUserName(newOwnerUserId);
    const systemMessageId = await insertInternalSystemMessage(
      groupId,
      userId,
      `${actorName} transferiu a propriedade do grupo para ${newOwnerName} e saiu.`,
    );
    const updatedGroup = await loadGroupRow(groupId);
    const automationMessageId = updatedGroup
      ? await emitInternalMembershipAutomation(updatedGroup, userId, "farewell")
      : null;
    return {
      action: "transfer-and-leave",
      message: `Grupo transferido para ${newOwnerName}. Você saiu com segurança.`,
      newOwnerUserId,
      systemMessageIds: systemMessageId ? [systemMessageId] : [],
      automationMessageIds: automationMessageId ? [automationMessageId] : [],
    };
  }
  if (action === "clear") {
    if (membership.role !== "owner" && membership.role !== "admin") {
      throw new InternalGroupError(
        "Apenas administradores podem limpar o histórico de todos.",
        403,
      );
    }
    await getDb().query(`DELETE FROM internal_group_messages WHERE group_id = ?`, [groupId]);
    await getDb().query(
      `UPDATE internal_group_members SET last_read_message_id = NULL WHERE group_id = ?`,
      [groupId],
    );
    await getDb().query(`UPDATE internal_groups SET updated_at = NOW() WHERE id = ?`, [groupId]);
    return {
      action: "clear",
      cleared: true,
      message: "Todas as mensagens do grupo foram apagadas para todos.",
      systemMessageIds: [],
      automationMessageIds: [],
    };
  }
  if (action === "delete") {
    if (membership.role !== "owner") {
      throw new InternalGroupError(
        "Somente o proprietário pode apagar definitivamente o grupo.",
        403,
      );
    }
    const group = await loadGroupRow(groupId);
    if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
    const db = getDb();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      if (Number(group.bot_group_id ?? 0) > 0) {
        await connection.query(`DELETE FROM bot_groups WHERE id = ?`, [group.bot_group_id]);
      }
      await connection.query(`DELETE FROM internal_groups WHERE id = ?`, [groupId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return {
      action: "delete",
      deleted: true,
      cleanupPaths: [group.avatar_path, group.bot_avatar_path, group.wallpaper_path].filter(Boolean),
      message: "O grupo BotAdmin foi apagado definitivamente.",
      systemMessageIds: [],
      automationMessageIds: [],
    };
  }
  throw new InternalGroupError("Ação de conversa inválida.");
};

export const listInternalGroupMessages = async (
  groupId: number,
  userId: number,
  options: { after?: number; before?: number; limit?: number } = {},
) => {
  const membership = await assertInternalGroupMember(groupId, userId);
  const canViewDeleted = membership.role === "owner" || membership.role === "admin";
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 60)));
  const after = Math.max(0, Math.floor(options.after ?? 0));
  const before = Math.max(0, Math.floor(options.before ?? 0));
  const params: unknown[] = [groupId];
  let cursor = "";
  if (after > 0) {
    cursor = "AND m.id > ?";
    params.push(after);
  } else if (before > 0) {
    cursor = "AND m.id < ?";
    params.push(before);
  }
  params.push(limit);
  const [rows] = await getDb().query<MessageRow[]>(
    `
      SELECT m.*, u.name AS sender_name, u.avatar_path AS sender_avatar_path,
             reply.body AS reply_body,
             CASE WHEN reply.sender_kind = 'bot'
               THEN COALESCE(reply.bot_display_name, 'Robô BotAdmin')
               ELSE reply_user.name END AS reply_sender_name,
             deleted_by.name AS deleted_by_name
      FROM internal_group_messages m
      INNER JOIN users u ON u.id = m.sender_user_id
      LEFT JOIN internal_group_messages reply ON reply.id = m.reply_to_message_id AND reply.group_id = m.group_id
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_user_id
      LEFT JOIN users deleted_by ON deleted_by.id = m.deleted_by_user_id
      WHERE m.group_id = ? ${cursor}
      ORDER BY m.id ${after > 0 ? "ASC" : "DESC"}
      LIMIT ?
    `,
    params,
  );
  const ordered = after > 0 ? rows : [...rows].reverse();
  const reactionMap = new Map<number, ReactionPayload[]>();
  const openedViewOnceIds = new Set<number>();
  const receiptMap = new Map<number, ReceiptSummary>();
  const pollParticipantsMap = new Map<number, Array<Record<string, unknown>>>();
  if (ordered.length > 0) {
    const ids = ordered.map((row) => Number(row.id));
    const placeholders = ids.map(() => "?").join(",");
    const [pollRows] = await getDb().query<(RowDataPacket & {
      poll_message_id: number;
      participants: unknown;
    })[]>(
      `SELECT poll_message_id, participants
         FROM internal_group_sweepstakes
        WHERE poll_message_id IN (${placeholders})`,
      ids,
    );
    for (const poll of pollRows ?? []) {
      pollParticipantsMap.set(
        Number(poll.poll_message_id),
        parseJsonColumn<Array<Record<string, unknown>>>(poll.participants, []),
      );
    }
    const [reactionRows] = await getDb().query<(RowDataPacket & {
      message_id: number;
      user_id: number;
      emoji: string;
      created_at: Date | string;
      sender_name: string;
    })[]>(
      `SELECT r.message_id, r.user_id, r.emoji, r.created_at, u.name AS sender_name
       FROM internal_group_message_reactions r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.message_id IN (${placeholders})
       ORDER BY r.created_at ASC`,
      ids,
    );
    for (const reaction of reactionRows) {
      const messageId = Number(reaction.message_id);
      const bucket = reactionMap.get(messageId) ?? [];
      bucket.push({
        emoji: reaction.emoji,
        senderName: reaction.sender_name,
        senderJid: `botadmin-user:${reaction.user_id}`,
        fromMe: Number(reaction.user_id) === userId,
        timestamp: iso(reaction.created_at),
      });
      reactionMap.set(messageId, bucket);
    }
    const [botReactionRows] = await getDb().query<(RowDataPacket & {
      message_id: number;
      group_id: number;
      emoji: string;
      created_at: Date | string;
      sender_name: string;
    })[]>(
      `SELECT r.message_id, m.group_id, r.emoji, r.created_at,
              COALESCE(NULLIF(g.bot_name, ''), 'Robô BotAdmin') AS sender_name
         FROM internal_group_bot_reactions r
         INNER JOIN internal_group_messages m ON m.id = r.message_id
         INNER JOIN internal_groups g ON g.id = m.group_id
        WHERE r.message_id IN (${placeholders})
        ORDER BY r.created_at ASC`,
      ids,
    );
    for (const reaction of botReactionRows) {
      const messageId = Number(reaction.message_id);
      const bucket = reactionMap.get(messageId) ?? [];
      bucket.push({
        emoji: reaction.emoji,
        senderName: reaction.sender_name,
        senderJid: `botadmin-bot:${reaction.group_id}`,
        fromMe: false,
        timestamp: iso(reaction.created_at),
      });
      reactionMap.set(messageId, bucket);
    }
    const [viewRows] = await getDb().query<(RowDataPacket & { message_id: number })[]>(
      `SELECT message_id FROM internal_group_message_views
       WHERE user_id = ? AND message_id IN (${placeholders})`,
      [userId, ...ids],
    );
    for (const view of viewRows ?? []) openedViewOnceIds.add(Number(view.message_id));
    const [receiptRows] = await getDb().query<(RowDataPacket & {
      message_id: number;
      state: string;
    })[]>(
      `SELECT message_id, state
       FROM internal_group_message_receipts
       WHERE message_id IN (${placeholders})`,
      ids,
    );
    for (const receipt of receiptRows ?? []) {
      const id = Number(receipt.message_id);
      const summary = receiptMap.get(id) ?? {
        recipientCount: 0,
        deliveredCount: 0,
        readCount: 0,
      };
      summary.recipientCount += 1;
      if (receipt.state === "delivered" || receipt.state === "read") {
        summary.deliveredCount += 1;
      }
      if (receipt.state === "read") summary.readCount += 1;
      receiptMap.set(id, summary);
    }
  }
  return {
    messages: ordered.map((row) =>
      serializeMessage(row, userId, reactionMap.get(Number(row.id)) ?? [], {
        canViewDeleted,
        viewOnceOpened: openedViewOnceIds.has(Number(row.id)),
        receiptSummary: receiptMap.get(Number(row.id)),
        pollParticipants: pollParticipantsMap.get(Number(row.id)),
      }),
    ),
    hasMore: rows.length >= limit,
    latestId: ordered.length ? Number(ordered[ordered.length - 1].id) : after,
    oldestId: ordered.length ? Number(ordered[0].id) : null,
  };
};

type InternalSweepstakeRow = RowDataPacket & {
  id: number;
  group_id: number;
  poll_message_id: number | null;
  question: string;
  participants: unknown;
  winners: unknown;
  max_participants: number;
  winners_count: number;
  status: string;
  expires_at: Date | string;
  created_by: number;
  created_at: Date | string;
  concluded_at: Date | string | null;
};

const mapInternalSweepstake = (row: InternalSweepstakeRow) => ({
  id: Number(row.id),
  groupId: Number(row.group_id),
  pollMessageId: row.poll_message_id == null ? null : String(row.poll_message_id),
  question: row.question,
  participants: parseJsonColumn<Array<Record<string, unknown>>>(row.participants, []),
  winners: parseJsonColumn<Array<Record<string, unknown>>>(row.winners, []),
  maxParticipants: Number(row.max_participants),
  winnersCount: Number(row.winners_count),
  status: row.status,
  expiresAt: new Date(row.expires_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
  concludedAt: row.concluded_at ? new Date(row.concluded_at).toISOString() : null,
});

export const listInternalGroupSweepstakes = async (groupId: number, userId: number) => {
  await assertInternalGroupMember(groupId, userId);
  await ensureInternalGroupTables();
  const [rows] = await getDb().query<InternalSweepstakeRow[]>(
    `SELECT * FROM internal_group_sweepstakes WHERE group_id = ? ORDER BY id DESC LIMIT 100`,
    [groupId],
  );
  return {
    active: rows.filter((row) => row.status === "active" && new Date(row.expires_at).getTime() > Date.now()).map(mapInternalSweepstake),
    history: rows.filter((row) => row.status !== "active" || new Date(row.expires_at).getTime() <= Date.now()).map(mapInternalSweepstake),
  };
};

export const createInternalGroupSweepstake = async (
  groupId: number,
  userId: number,
  input: { question: string; durationValue: number; durationUnit: string; maxParticipants: number; winnersCount: number },
) => {
  const membership = await assertManager(groupId, userId);
  await ensureInternalGroupTables();
  const question = cleanText(input.question, 240);
  const durationValue = Math.max(1, Math.floor(Number(input.durationValue)));
  const unit = input.durationUnit === "h" ? 60 * 60 * 1000 : input.durationUnit === "d" ? 24 * 60 * 60 * 1000 : 60 * 1000;
  const maxParticipants = Math.max(1, Math.floor(Number(input.maxParticipants)));
  const winnersCount = Math.max(1, Math.floor(Number(input.winnersCount)));
  if (!question || winnersCount > maxParticipants) throw new InternalGroupError("Dados do sorteio inválidos.");
  const expiresAt = new Date(Date.now() + durationValue * unit);
  const [existing] = await getDb().query<InternalSweepstakeRow[]>(
    `SELECT * FROM internal_group_sweepstakes WHERE group_id = ? AND status = 'active' LIMIT 1`, [groupId],
  );
  if (existing?.[0]) throw new InternalGroupError("Já existe um sorteio ativo neste grupo.", 409);
  const [insert] = await getDb().query<ResultSetHeader>(
    `INSERT INTO internal_group_sweepstakes (group_id, question, participants, winners, max_participants, winners_count, status, expires_at, created_by) VALUES (?, ?, '[]', '[]', ?, ?, 'active', ?, ?)`,
    [groupId, question, maxParticipants, winnersCount, toSqlDateTime(expiresAt), userId],
  );
  const sweepstakeId = Number(insert.insertId);
  const group = await loadGroupRow(groupId);
  if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
  const buttons = [{ id: "join", title: "Participar ✅", payload: { sweepstakeId } }];
  const messageId = await insertInternalAutomationMessage(
    group,
    `🎟️ SORTEIO: ${question}`,
    null,
    buttons,
    null,
    [],
    "poll",
  );
  await getDb().query(`UPDATE internal_group_sweepstakes SET poll_message_id = ? WHERE id = ?`, [messageId, sweepstakeId]);
  return { sweepstakeId, messageId, active: (await listInternalGroupSweepstakes(groupId, userId)).active };
};

export const finalizeInternalGroupSweepstake = async (groupId: number, userId: number, sweepstakeId: number) => {
  await assertManager(groupId, userId);
  await ensureInternalGroupTables();
  const [rows] = await getDb().query<InternalSweepstakeRow[]>(`SELECT * FROM internal_group_sweepstakes WHERE id = ? AND group_id = ? AND status = 'active' LIMIT 1`, [sweepstakeId, groupId]);
  if (!rows?.[0]) throw new InternalGroupError("Sorteio não encontrado ou já encerrado.", 404);
  const row = rows[0];
  const participants = parseJsonColumn<Array<Record<string, unknown>>>(row.participants, []);
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const winners = shuffled.slice(0, Number(row.winners_count));
  await getDb().query(`UPDATE internal_group_sweepstakes SET winners = ?, status = 'completed', concluded_at = NOW() WHERE id = ?`, [JSON.stringify(winners), sweepstakeId]);
  const group = await loadGroupRow(groupId);
  if (group) {
    const names = winners.map((winner) => `@${winner.displayName ?? winner.userId}`).join(", ") || "nenhum participante";
    const ids = winners.map((winner) => Number(winner.userId)).filter((id) => id > 0);
    const messageId = await insertInternalAutomationMessage(group, `🏆 Resultado do sorteio *${row.question}*\nGanhador(es): ${names}`, null, undefined, null, ids);
    emitInternalGroupEvent({ groupId, actorUserId: userId, type: "message.created", messageId });
  }
  return listInternalGroupSweepstakes(groupId, userId);
};

export const cancelInternalGroupSweepstake = async (groupId: number, userId: number, sweepstakeId: number) => {
  await assertManager(groupId, userId);
  await ensureInternalGroupTables();
  await getDb().query(`UPDATE internal_group_sweepstakes SET status = 'cancelled', concluded_at = NOW() WHERE id = ? AND group_id = ? AND status = 'active'`, [sweepstakeId, groupId]);
  return listInternalGroupSweepstakes(groupId, userId);
};

export const addInternalGroupSweepstakeParticipant = async (
  groupId: number,
  userId: number,
  sweepstakeId: number,
  participantUserId: number,
) => {
  await assertManager(groupId, userId);
  await ensureInternalGroupTables();
  const [memberRows] = await getDb().query<RowDataPacket[]>(
    `SELECT user_id FROM internal_group_members
      WHERE group_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
    [groupId, participantUserId],
  );
  if (!memberRows?.[0]) throw new InternalGroupError("O usuário não é membro ativo deste grupo.", 404);
  const [rows] = await getDb().query<InternalSweepstakeRow[]>(
    `SELECT * FROM internal_group_sweepstakes
      WHERE id = ? AND group_id = ? AND status = 'active' LIMIT 1`,
    [sweepstakeId, groupId],
  );
  const row = rows?.[0];
  if (!row) throw new InternalGroupError("Este sorteio não está mais ativo.", 409);
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new InternalGroupError("O prazo deste sorteio terminou.", 409);
  const participants = parseJsonColumn<Array<Record<string, unknown>>>(row.participants, []);
  if (participants.some((entry) => Number(entry.userId) === participantUserId)) {
    return listInternalGroupSweepstakes(groupId, userId);
  }
  if (participants.length >= Number(row.max_participants)) throw new InternalGroupError("O limite de participantes já foi atingido.", 409);
  participants.push({ userId: participantUserId, displayName: await loadInternalUserName(participantUserId), joinedAt: new Date().toISOString(), addedBy: userId });
  await getDb().query(
    `UPDATE internal_group_sweepstakes SET participants = ?, updated_at = NOW() WHERE id = ? AND status = 'active'`,
    [JSON.stringify(participants), sweepstakeId],
  );
  emitInternalGroupEvent({
    groupId,
    actorUserId: userId,
    type: "message.created",
    messageId: row.poll_message_id,
    action: "sweepstake.participant.added",
  });
  return listInternalGroupSweepstakes(groupId, userId);
};

export const runInternalGroupMessageAction = async (
  groupId: number,
  messageId: number,
  userId: number,
  action: string,
  data: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  await assertInternalGroupMember(groupId, userId);
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT id, interactive_payload, sender_kind, sender_user_id, message_type,
            media_path, deleted_at
       FROM internal_group_messages
      WHERE id = ? AND group_id = ? LIMIT 1`,
    [messageId, groupId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new InternalGroupError("Mensagem não encontrada.", 404);
  }
  if (action === "edit") {
    const row = rows[0] as RowDataPacket & {
      sender_kind?: string | null;
      sender_user_id?: number;
      message_type?: string | null;
      media_path?: string | null;
      deleted_at?: Date | string | null;
    };
    if (row.sender_kind === "bot" || Number(row.sender_user_id) !== userId) {
      throw new InternalGroupError("Você só pode editar suas próprias mensagens.", 403);
    }
    if (row.deleted_at) {
      throw new InternalGroupError("Uma mensagem apagada não pode ser editada.", 409);
    }
    const text = cleanText(data.text, 4000);
    const isTextOnly = !row.media_path && (row.message_type ?? "text") === "text";
    if (isTextOnly && !text) {
      throw new InternalGroupError("A mensagem não pode ficar vazia.");
    }
    await getDb().query(
      `UPDATE internal_group_messages
          SET body = ?, edited_at = NOW()
        WHERE id = ? AND group_id = ?`,
      [text || null, messageId, groupId],
    );
    await getDb().query(
      "UPDATE internal_groups SET updated_at = NOW() WHERE id = ?",
      [groupId],
    );
    return { message: "Mensagem editada.", messageId };
  }
  if (action === "react") {
    const emoji = cleanText(data.emoji, 32);
    if (!emoji) {
      await getDb().query(
        `DELETE FROM internal_group_message_reactions WHERE message_id = ? AND user_id = ?`,
        [messageId, userId],
      );
      return { message: "Reação removida." };
    }
    await getDb().query(
      `INSERT INTO internal_group_message_reactions (message_id, user_id, emoji)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), updated_at = NOW()`,
      [messageId, userId, emoji],
    );
    return { message: "Reação adicionada." };
  }
  if (action === "poll_vote") {
    const optionId = cleanText(data.optionId ?? data.option_id ?? data.id, 80).toLowerCase();
    if (optionId !== "join" && optionId !== "participar") {
      throw new InternalGroupError("Opção da enquete inválida.");
    }
    const [sweepRows] = await getDb().query<RowDataPacket[]>(
      `SELECT * FROM internal_group_sweepstakes WHERE group_id = ? AND poll_message_id = ? AND status = 'active' LIMIT 1`,
      [groupId, messageId],
    );
    const sweep = sweepRows?.[0] as (RowDataPacket & { participants?: unknown; max_participants?: number; expires_at?: Date | string }) | undefined;
    if (!sweep) throw new InternalGroupError("Este sorteio não está mais ativo.", 409);
    if (new Date(sweep.expires_at ?? 0).getTime() <= Date.now()) {
      throw new InternalGroupError("O prazo deste sorteio terminou.", 409);
    }
    const participants = parseJsonColumn<Array<Record<string, unknown>>>(sweep.participants, []);
    if (participants.some((entry) => Number(entry.userId) === userId)) {
      return { message: "Você já está participando deste sorteio.", sweepstakeId: Number(sweep.id) };
    }
    if (Number(sweep.max_participants ?? 0) > 0 && participants.length >= Number(sweep.max_participants)) {
      throw new InternalGroupError("O limite de participantes já foi atingido.", 409);
    }
    participants.push({ userId, displayName: await loadInternalUserName(userId), joinedAt: new Date().toISOString() });
    await getDb().query(
      `UPDATE internal_group_sweepstakes SET participants = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(participants), Number(sweep.id)],
    );
    emitInternalGroupEvent({
      groupId,
      actorUserId: userId,
      type: "message.created",
      messageId,
      action: "sweepstake.participant.joined",
    });
    return { message: "Participação registrada. Boa sorte!", sweepstakeId: Number(sweep.id) };
  }
  if (action === "star" || action === "unstar" || action === "favorite") {
    return { message: action === "unstar" ? "Favorito removido." : "Mensagem favoritada." };
  }
  // Reply/CTA buttons in an internal BotAdmin group are delivered by the
  // Flutter client as `interactive_reply`.  Treat the selected button as an
  // actual action instead of falling through to the generic invalid-action
  // error.  Media menus reuse the same endpoint and dispatch to the existing
  // download handler so MP3/MP4 buttons behave exactly like the WhatsApp
  // webhook path.
  if (action === "interactive_reply") {
    const row = rows[0] as RowDataPacket & {
      interactive_payload?: string | null;
      sender_kind?: string | null;
    };
    let payload: any[] = [];
    if (row.interactive_payload) {
      try {
        const parsed = JSON.parse(row.interactive_payload);
        payload = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        payload = [];
      }
    }
    const selectedId = cleanText(
      data.selectedId ?? data.id ?? data.buttonId,
      80,
    ).toLowerCase();
    const selected = payload.find(
      (button: any) => String(button?.id ?? "").toLowerCase() === selectedId,
    );
    const selectedPayload = selected?.payload;
    const selectedFormat = cleanText(
      data.format ?? selectedPayload?.format,
      8,
    ).toLowerCase();
    if (selectedFormat === "mp3" || selectedFormat === "mp4") {
      const responseText = cleanText(
        data.selectedText ?? selected?.title,
        4000,
      ) || (selectedFormat === "mp3" ? "Baixar MP3" : "Baixar MP4");
      // Registra primeiro a escolha do membro. Assim o chat exibe o balão de
      // resposta imediatamente, como um clique de botão nativo do WhatsApp,
      // enquanto o robô conclui o download.
      const response = await createInternalGroupMessage(groupId, userId, {
        text: responseText,
        messageType: "text",
        replyToMessageId: messageId,
      });
      const responseId = Number((response as any)?.message?.id ?? 0);
      const download = await runInternalGroupMessageAction(groupId, messageId, userId, "play_format", {
        ...data,
        format: selectedFormat,
        requestMessageId: responseId,
      });
      const downloadMessageId = Number((download as any)?.messageId ?? 0);
      return {
        message: (download as any)?.message ?? "Formato selecionado.",
        selectedId: selectedId || selectedFormat,
        messageId: responseId > 0 ? responseId : undefined,
        botMessageIds: downloadMessageId > 0 ? [downloadMessageId] : [],
      };
    }
    if (!selected && selectedId) {
      throw new InternalGroupError("Essa opção não está mais disponível.", 400);
    }
    // A reply button is a real chat response (the same behaviour as a
    // WhatsApp quick-reply callback), not only a toast.  Persist it as the
    // member's message and run the normal BotAdmin automation pipeline so
    // configured commands/auto-responses can answer it immediately.
    const responseText = cleanText(
      data.selectedText ?? data.title ?? selected?.payload?.text ?? selected?.title,
      4000,
    );
    if (!responseText) throw new InternalGroupError("Resposta interativa inválida.", 400);
    const response = await createInternalGroupMessage(groupId, userId, {
      text: responseText,
      messageType: "text",
      replyToMessageId: messageId,
    });
    const responseId = Number((response as any)?.message?.id ?? 0);
    const botMessageIds = responseId > 0
      ? await processInternalGroupBotMessage(groupId, responseId, userId)
      : [];
    return {
      message: `Resposta registrada: ${responseText}.`,
      selectedId: selectedId || null,
      messageId: responseId > 0 ? responseId : undefined,
      botMessageIds,
    };
  }
  if (action === "play_format") {
    const row = rows[0] as RowDataPacket & { interactive_payload?: string | null; sender_kind?: string | null };
    if (row.sender_kind !== "bot" || !row.interactive_payload) {
      throw new InternalGroupError("Este menu de mídia não está mais disponível.", 400);
    }
    let payload: any = null;
    try { payload = JSON.parse(row.interactive_payload); } catch (_) { payload = null; }
    const requested = cleanText(data.format, 8).toLowerCase();
    const kind = requested === "mp4" ? "ytmp4" : requested === "mp3" ? "ytmp3" : "";
    const selected = Array.isArray(payload)
      ? payload.find((button: any) => button?.id === requested)
      : payload;
    const query = typeof selected?.payload?.query === "string"
      ? selected.payload.query
      : typeof selected?.query === "string" ? selected.query : "";
    if (!kind || !query) throw new InternalGroupError("Escolha MP3 ou MP4.");
    const group = await loadGroupRow(groupId);
    if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
    const requestMessageId = Math.max(0, Number(data.requestMessageId ?? 0)) || null;
    try {
      const media = await resolveInternalYoutubeDownload(
        kind,
        query,
        userId,
        groupId,
      );
      const createdId = await insertInternalAutomationMessage(
        group,
        null,
        media,
        undefined,
        requestMessageId,
        [userId],
      );
      return { message: "Download concluído.", messageId: createdId };
    } catch (error) {
      const createdId = await insertInternalAutomationMessage(
        group,
        error instanceof Error
          ? `Não consegui concluir o download: ${error.message}`
          : "Não consegui concluir o download.",
        undefined,
        undefined,
        requestMessageId,
        [userId],
      );
      return { message: "Não foi possível concluir o download.", messageId: createdId };
    }
  }
  throw new InternalGroupError("Ação de mensagem inválida.");
};

const normalizeAutomationText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const insertInternalAutomationMessage = async (
  group: GroupRow,
  text: string | null,
  media?: {
    mediaType?: string | null;
    path?: string | null;
    url?: string | null;
    thumbnail?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    caption?: string | null;
  } | null,
  buttons?: Array<{ id: string; title: string; payload?: Record<string, unknown> }>,
  replyToMessageId?: number | null,
  mentionedUserIds: number[] = [],
  messageType = "text",
) => {
  const mediaPath = media?.path?.trim() || media?.url?.trim() || null;
  const body = [text?.trim(), media?.caption?.trim()].filter(Boolean).join("\n") || null;
  const [result] = await getDb().query<ResultSetHeader>(
    `INSERT INTO internal_group_messages
      (group_id, sender_user_id, sender_kind, bot_display_name, bot_avatar_path,
       message_type, body, media_path, media_mime_type, media_file_name, interactive_payload,
       reply_to_message_id, mentioned_user_ids)
     VALUES (?, ?, 'bot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      group.id,
      group.owner_user_id,
      internalBotName(group),
      group.bot_avatar_path,
      mediaPath ? media?.mediaType || "document" : messageType,
      body,
      mediaPath,
      media?.mimeType ?? null,
      media?.fileName ?? mediaPath?.split(/[/?#]/).filter(Boolean).pop() ?? null,
      buttons?.length ? JSON.stringify(buttons) : null,
      replyToMessageId ?? null,
      mentionedUserIds.length
        ? JSON.stringify([...new Set(mentionedUserIds)].map(String))
        : null,
    ],
  );
  await getDb().query("UPDATE internal_groups SET updated_at = NOW() WHERE id = ?", [group.id]);
  return Number(result.insertId);
};

const acknowledgeInternalBotInteraction = async (
  group: GroupRow,
  messageId: number,
  actorUserId: number,
  emoji: "💬" | "🧠",
) => {
  await getDb().query(
    `INSERT INTO internal_group_bot_reactions (message_id, emoji)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), updated_at = NOW()`,
    [messageId, emoji],
  );
  emitInternalGroupEvent({
    groupId: Number(group.id),
    actorUserId,
    type: "message.created",
    messageId,
    action: emoji === "🧠" ? "botinterage.accepted" : "command.accepted",
  });
};

export const dispatchInternalGroupAutomationMessage = async (
  botGroupId: number,
  text: string | null,
  media?: Parameters<typeof insertInternalAutomationMessage>[2],
  delivery?: {
    replyToMessageId?: number | null;
    mentionedUserIds?: number[];
  },
) => {
  await ensureInternalGroupTables();
  const [rows] = await getDb().query<GroupRow[]>(
    "SELECT * FROM internal_groups WHERE bot_group_id = ? AND is_active = 1 AND bot_enabled = 1 LIMIT 1",
    [botGroupId],
  );
  const group = rows?.[0];
  if (!group) return null;
  const messageId = await insertInternalAutomationMessage(
    group,
    text,
    media,
    undefined,
    delivery?.replyToMessageId ?? null,
    delivery?.mentionedUserIds ?? [],
  );
  emitInternalGroupEvent({
    groupId: Number(group.id),
    actorUserId: Number(group.owner_user_id),
    type: "message.created",
    messageId,
    action: "botinterage.delivered",
  });
  return messageId;
};

export const setInternalGroupAdminsOnly = async (
  botGroupId: number,
  adminsOnly: boolean,
) => {
  await ensureInternalGroupTables();
  const [result] = await getDb().query<ResultSetHeader>(
    `UPDATE internal_groups
     SET admins_only = ?, updated_at = NOW()
     WHERE bot_group_id = ? AND is_active = 1 AND bot_enabled = 1`,
    [adminsOnly ? 1 : 0, botGroupId],
  );
  return result.affectedRows > 0;
};

const internalBotToggleKeys = new Set([
  "autoresposta", "botinterage", "vozbotinterage", "ouviraudiobotinterage",
  "lerimagem", "autosticker", "autodownloader", "bemvindo", "despedida",
  "antisticker", "antimage", "antvideo", "antaudio", "antdoc", "antvcard",
  "moderacaocomia", "antilink", "antilinkgp", "antipalavras", "banextremo",
  "bangringos", "antinsfwimagem", "proibirnsfw", "soadm", "brincadeiras",
  "linkmembro",
]);

// Shortcuts advertised by the activation screen must work even when an old
// group has no custom alias map persisted yet.
const internalBuiltInCommandAliases: Record<string, string> = {
  s: "autosticker",
};

const internalMediaModerationKey = (messageType: string) => {
  if (messageType === "sticker") return "antisticker";
  if (messageType === "image") return "antimage";
  if (messageType === "video") return "antvideo";
  if (messageType === "audio") return "antaudio";
  if (messageType === "document") return "antdoc";
  if (messageType === "vcard") return "antvcard";
  return null;
};

const applyInternalModeration = async (input: {
  group: GroupRow;
  settings: BotGroupSettings;
  messageId: number;
  memberId: number;
  reason: string;
  label: string;
}) => {
  const key = input.reason as keyof typeof input.settings.moderationActions;
  const configured = input.settings.moderationActions[key];
  const action = {
    deleteMessage: configured?.deleteMessage ?? true,
    registerInfraction: configured?.registerInfraction ?? true,
    banUser: configured?.banUser ?? false,
    maxInfractions: configured?.maxInfractions ?? input.settings.maxInfractions ?? 3,
  };
  if (action.deleteMessage) {
    await getDb().query(
      "UPDATE internal_group_messages SET deleted_at = NOW() WHERE id = ? AND group_id = ?",
      [input.messageId, input.group.id],
    );
  }
  let count = 0;
  if (action.registerInfraction) {
    await getDb().query(
      `INSERT INTO internal_group_bot_infractions (group_id, user_id, reason, count)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE count = count + 1, updated_at = NOW()`,
      [input.group.id, input.memberId, input.reason],
    );
    const [rows] = await getDb().query<(RowDataPacket & { count: number })[]>(
      "SELECT count FROM internal_group_bot_infractions WHERE group_id = ? AND user_id = ? AND reason = ?",
      [input.group.id, input.memberId, input.reason],
    );
    count = Number(rows?.[0]?.count ?? 0);
  }
  const shouldBan = action.banUser || (action.registerInfraction && count >= Math.max(1, Number(action.maxInfractions)));
  if (shouldBan) {
    await getDb().query(
      "UPDATE internal_group_members SET status = 'banned' WHERE group_id = ? AND user_id = ?",
      [input.group.id, input.memberId],
    );
  }
  const suffix = shouldBan
    ? "O membro foi removido e bloqueado do grupo."
    : action.registerInfraction
      ? `Infração ${count}/${Math.max(1, Number(action.maxInfractions))}.`
      : "A mensagem foi moderada.";
  return insertInternalAutomationMessage(
    input.group,
    `⚠️ ${input.label}\n${suffix}`,
  );
};

const callInternalGroupAi = async (
  settings: BotGroupSettings,
  memberName: string,
  text: string,
  context: {
    group: GroupRow;
    settingsId: number;
    memberId: number;
    messageId: number;
  },
) => {
  type GeneratedMedia = NonNullable<Parameters<typeof insertInternalAutomationMessage>[2]>;
  type AiResult = {
    content: string | null;
    deferredMedia: boolean;
    media: GeneratedMedia[];
  };
  const provider = settings.aiProvider;
  let baseUrl = "";
  let token = "";
  let model = settings.aiModel?.trim() || "";

  if (provider === "chatgpt_system") {
    // Internal BotAdmin groups do not pass through WhatsApp's webhook, but
    // BotInterage must still use the same managed provider configured by the
    // administrator. The old branch treated every non-OpenAI provider as
    // Groq, so ChatGPT Sistema silently returned null for these groups.
    const runtime = await getBotInterageRuntimeConfig();
    if (!runtime.enabled || !runtime.baseUrl || !runtime.token) {
      return { content: null, deferredMedia: false, media: [] } satisfies AiResult;
    }
    baseUrl = runtime.baseUrl;
    token = runtime.token;
    model = model || runtime.model || "auto";
    if (isLikelyChatGptPhoneMediaRequest(text)) {
      const normalizedBase = baseUrl.replace(/\/+$/, "");
      const endpoint = `${normalizedBase.endsWith("/v1") ? normalizedBase : `${normalizedBase}/v1`}/images/generations`;
      const generationResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          prompt: text,
          model: "auto",
          provider: "chatgpt",
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const payload = await generationResponse.json().catch(() => null) as any;
      const images = Array.isArray(payload?.images) ? payload.images.slice(0, 4) : [];
      if (!generationResponse.ok || images.length === 0) {
        throw new Error(
          cleanText(payload?.error ?? payload?.message, 500) ||
          `A API de imagem retornou HTTP ${generationResponse.status}.`,
        );
      }
      const media: GeneratedMedia[] = [];
      let firstTitle: string | null = null;
      for (let index = 0; index < images.length; index += 1) {
        const generated = images[index];
        const imageUrl = typeof generated?.url === "string" ? generated.url.trim() : "";
        if (!imageUrl) continue;
        const imageResponse = await fetch(imageUrl, {
          headers: { Accept: "image/*" },
          signal: AbortSignal.timeout(60_000),
        });
        if (!imageResponse.ok) {
          throw new Error(`Falha ao baixar a imagem gerada: HTTP ${imageResponse.status}.`);
        }
        const downloaded = Buffer.from(await imageResponse.arrayBuffer());
        if (downloaded.byteLength === 0 || downloaded.byteLength > 25 * 1024 * 1024) {
          throw new Error("A imagem gerada está vazia ou excede 25 MB.");
        }
        const mimeType = (imageResponse.headers.get("content-type") || "image/png")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const mediaType = mimeType.startsWith("image/")
          ? "image"
          : mimeType.startsWith("video/")
            ? "video"
            : mimeType.startsWith("audio/")
              ? "audio"
              : "document";
        const extension = mimeType.includes("jpeg")
          ? ".jpg"
          : mimeType.includes("webp")
            ? ".webp"
            : mimeType.includes("gif")
              ? ".gif"
              : ".png";
        const fileName = `botinterage-${context.messageId}-${index + 1}${extension}`;
        const storedPath = await saveBufferAsUploadedFile(
          downloaded,
          `internal-groups/${context.group.id}/botinterage`,
          { fixedFileName: fileName },
        );
        firstTitle ??= cleanText(generated?.title, 180) || null;
        media.push({
          mediaType,
          path: storedPath,
          mimeType,
          fileName,
        });
      }
      if (media.length === 0) throw new Error("A geração terminou sem imagem utilizável.");
      return {
        content: firstTitle,
        deferredMedia: false,
        media,
      } satisfies AiResult;
    }
  } else if (provider === "openai") {
    baseUrl = "https://api.openai.com";
    token = settings.openAiApiKey?.trim() || "";
    model = model || "gpt-4o-mini";
  } else {
    baseUrl = "https://api.groq.com/openai";
    token = settings.groqKeys.find((entry) => entry.trim())?.trim() || "";
    model = model || "llama-3.1-8b-instant";
  }
  if (!token || !baseUrl || !model) {
    return { content: null, deferredMedia: false, media: [] } satisfies AiResult;
  }

  const result = await createBotInterageChatCompletion({
    baseUrl,
    token,
    model,
    messages: [
      {
        role: "system",
        content: settings.aiPrompt || "Responda de forma útil e direta em português do Brasil.",
      },
      { role: "user", content: `[${memberName}]: ${text}` },
    ],
    temperature: 0.7,
  });
  return {
    content: result.content?.trim() || null,
    deferredMedia: false,
    media: [],
  } satisfies AiResult;
};

const resolveInternalYoutubeDownload = async (
  kind: "ytmp3" | "ytmp4",
  query: string,
  userId: number,
  groupId: number,
) => {
  const value = query.trim();
  if (!value) throw new InternalGroupError(`Use ${kind === "ytmp3" ? "!play" : "!video"} seguido do nome ou link.`);
  const base = process.env.REST_INTERNAL_BASE_URL?.trim() ||
    `http://127.0.0.1:${process.env.PORT?.trim() || "4322"}`;
  const url = new URL(kind === "ytmp3" ? "/api/rest/ytmp3" : "/api/rest/ytmp4", base);
  url.searchParams.set("q", value);
  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = [
    (await getOrCreateUserApiKey(userId).catch(() => null))?.apiKey,
    process.env.INTERNAL_API_KEY,
    process.env.BOTADMIN_INTERNAL_API_KEY,
    process.env.USER_API_FALLBACK_KEY,
  ].find((entry) => entry?.trim())?.trim();
  if (apiKey) headers["x-api-key"] = apiKey;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as any;
  const result = payload?.resultado ?? payload?.result;
  if (!response.ok || typeof result?.url !== "string" || !result.url.trim()) {
    throw new Error(payload?.message || payload?.mensagem || "Não consegui baixar essa mídia.");
  }
  const title = cleanText(result.title, 180) || (kind === "ytmp3" ? "Música" : "Vídeo");
  const author = cleanText(result.author, 120);
  const mimeType = cleanText(result.format, 120) || (kind === "ytmp3" ? "audio/mpeg" : "video/mp4");
  const extension = kind === "ytmp3" ? "mp3" : "mp4";
  const safeTitle = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const transientUrl = result.url.trim();

  // `/api/playaudio/:id` is backed by the downloader's temporary directory.
  // Persist MP3 bytes as soon as the download finishes so a process restart,
  // blue/green switch or temp cleanup can never turn an old chat message into
  // a dead grey card. The protected group-media endpoint will subsequently
  // serve this R2/local upload with Range support.
  let storedPath: string | null = null;
  if (kind === "ytmp3") {
    const source = await fetch(transientUrl, {
      headers: { accept: "audio/*,application/octet-stream;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(180_000),
    });
    if (!source.ok) {
      throw new Error(
        source.status === 404
          ? "O áudio temporário expirou antes de ser salvo. Tente novamente."
          : `Não consegui persistir o áudio (HTTP ${source.status}).`,
      );
    }
    const declaredSize = Number(source.headers.get("content-length") || 0);
    const maxAudioBytes = 80 * 1024 * 1024;
    if (declaredSize > maxAudioBytes) {
      throw new Error("O áudio excede o limite de 80 MB do grupo.");
    }
    const bytes = Buffer.from(await source.arrayBuffer());
    if (bytes.byteLength < 1024) {
      throw new Error("O arquivo de áudio retornado está incompleto.");
    }
    if (bytes.byteLength > maxAudioBytes) {
      throw new Error("O áudio excede o limite de 80 MB do grupo.");
    }
    storedPath = await saveBufferAsUploadedFile(
      bytes,
      `internal-groups/${groupId}/downloads`,
      {
        fixedFileName: `${crypto.randomUUID()}-${safeTitle || "audio"}.mp3`,
      },
    );
  }
  return {
    mediaType: kind === "ytmp3" ? "audio" : "video",
    ...(storedPath ? { path: storedPath } : { url: transientUrl }),
    thumbnail: typeof result.thumbnail === "string" ? result.thumbnail.trim() : null,
    mimeType,
    fileName: `${safeTitle || kind}.${extension}`,
    caption: [title, author].filter(Boolean).join(" — "),
  };
};

const youtubeThumbnailFromQuery = (value: string) => {
  const match = value.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/))([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i,
  );
  return match?.[1]
    ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`
    : null;
};

const resolvePlayPreview = async (query: string): Promise<YtSearchItem | null> => {
  const sources = [ytSearch(query, 1), ytDlpSearch(query, 1)];
  return new Promise((resolve) => {
    let pending = sources.length;
    let settled = false;
    const finish = (result: YtSearchItem | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => finish(null), 20_500);
    for (const source of sources) {
      source
        .then((items) => {
          const first = items.find((item) => {
            const id = item.id?.trim();
            const url = item.url?.trim();
            return Boolean(
              /^[A-Za-z0-9_-]{11}$/.test(id) &&
              /^https?:\/\//i.test(url) &&
              (item.thumbnail?.trim() || youtubeThumbnailFromQuery(url)),
            );
          });
          if (first) return finish(first);
          pending -= 1;
          if (pending <= 0) finish(null);
        })
        .catch(() => {
          pending -= 1;
          if (pending <= 0) finish(null);
        });
    }
  });
};

const resolveInternalCommandTarget = async (
  groupId: number,
  message: MessageRow,
  args: string[],
) => {
  if (Number(message.reply_to_message_id ?? 0) > 0) {
    const [rows] = await getDb().query<(RowDataPacket & {
      sender_user_id: number;
      sender_kind: string;
    })[]>(
      `SELECT sender_user_id, sender_kind FROM internal_group_messages
       WHERE id = ? AND group_id = ? LIMIT 1`,
      [message.reply_to_message_id, groupId],
    );
    if (rows?.[0] && rows[0].sender_kind !== "bot") {
      return Number(rows[0].sender_user_id);
    }
  }
  const rawTarget = args.join(" ").trim();
  const numeric = rawTarget.match(/\d+/)?.[0];
  if (numeric && !rawTarget.includes("@")) {
    const numericId = Number(numeric);
    if (numericId > 0) return numericId;
  }
  // Comandos digitados no chat normalmente chegam como !ban @Nome. Antes
  // apenas IDs numéricos eram aceitos, então a menção visual nunca era
  // resolvida. Busca o membro ativo por nome (exato, início e depois trecho)
  // usando a mesma normalização dos comandos, tolerando acentos.
  const mention = rawTarget.match(/@([^\n,;]+)/)?.[1]?.trim();
  const targetName = normalizeAutomationText(mention || rawTarget.replace(/^@/, ""));
  if (!targetName) return null;
  const [rows] = await getDb().query<(RowDataPacket & { user_id: number; name: string })[]>(
    `SELECT m.user_id, u.name
       FROM internal_group_members m
       INNER JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? AND m.status = 'active'`,
    [groupId],
  );
  const candidates = (rows ?? [])
    .map((row) => ({
      id: Number(row.user_id),
      normalized: normalizeAutomationText(row.name ?? ""),
    }))
    .filter((row) => row.id > 0 && row.normalized);
  return (
    candidates.find((row) => row.normalized === targetName)?.id ??
    candidates.find((row) => row.normalized.startsWith(targetName))?.id ??
    candidates.find((row) => row.normalized.includes(targetName))?.id ??
    null
  );
};

export const processInternalGroupBotMessage = async (
  groupId: number,
  messageId: number,
  memberId: number,
) => {
  const group = await loadGroupRow(groupId);
  if (!group?.bot_enabled) return [] as number[];
  const membership = await getMembership(groupId, memberId);
  if (!membership || membership.status !== "active") return [] as number[];
  const [messages] = await getDb().query<MessageRow[]>(
    "SELECT * FROM internal_group_messages WHERE id = ? AND group_id = ? AND deleted_at IS NULL LIMIT 1",
    [messageId, groupId],
  );
  const message = messages?.[0];
  if (!message) return [] as number[];
  const settingsId = await syncInternalSettingsGroup(group);
  const settings = await getGroupSettings(settingsId);
  const created: number[] = [];
  const isAdmin = membership.role === "owner" || membership.role === "admin";
  const text = message.body?.trim() || "";
  const normalized = normalizeAutomationText(text);

  const mediaKey = internalMediaModerationKey(message.message_type);
  if (!isAdmin && mediaKey && settings.commandToggles[mediaKey] === true) {
    created.push(await applyInternalModeration({
      group, settings, messageId, memberId, reason: mediaKey,
      label: `A proteção ${mediaKey} removeu uma mídia não permitida.`,
    }));
    return created;
  }

  const links = text.match(/(?:https?:\/\/|www\.)[^\s]+/gi) ?? [];
  const groupInvite = links.some((link) => /chat\.whatsapp\.com|\/g\//i.test(link));
  const allowed = (link: string) => settings.allowedLinks.some((item) =>
    normalizeAutomationText(link).includes(normalizeAutomationText(item)),
  );
  if (!isAdmin && links.some((link) => !allowed(link))) {
    const reason = groupInvite && settings.commandToggles.antilinkgp
      ? "antilinkgp"
      : settings.commandToggles.antilink || settings.antilink
        ? "antilink"
        : null;
    if (reason) {
      created.push(await applyInternalModeration({
        group, settings, messageId, memberId, reason,
        label: reason === "antilinkgp" ? "Links de convite não são permitidos." : "Links não são permitidos.",
      }));
      return created;
    }
  }

  if (!isAdmin && (settings.commandToggles.antipalavras || settings.featureFlags.antipalavras)) {
    const hit = settings.bannedWords.find((word) => {
      const token = normalizeAutomationText(word);
      return token && (` ${normalized} `).includes(` ${token} `);
    });
    if (hit) {
      created.push(await applyInternalModeration({
        group, settings, messageId, memberId, reason: "antipalavras",
        label: "Uma palavra proibida foi detectada.",
      }));
      return created;
    }
  }

  const prefixes = settings.commandPrefixes.length ? settings.commandPrefixes : ["!"];
  const prefix = prefixes.find((entry) => text.startsWith(entry));
  const commandText = prefix
    ? text.substring(prefix.length).trim()
    : settings.allowCommandsWithoutPrefix
      ? text
      : "";
  const [rawCommand = "", ...args] = commandText.split(/\s+/);
  const command = normalizeAutomationText(rawCommand);
  const canonical = Object.entries(settings.commandAliases ?? {}).find(([, aliases]) =>
    aliases.some((alias) => normalizeAutomationText(alias) === command),
  )?.[0] ?? internalBuiltInCommandAliases[command] ?? command;
  const commandReply = async (
    replyText: string | null,
    media?: Parameters<typeof insertInternalAutomationMessage>[2],
    buttons?: Parameters<typeof insertInternalAutomationMessage>[3],
  ) => {
    return insertInternalAutomationMessage(
      group,
      replyText,
      media,
      buttons,
      messageId,
      [memberId],
    );
  };
  let interactionAcknowledged = false;
  const acknowledge = async (emoji: "💬" | "🧠") => {
    if (interactionAcknowledged) return;
    interactionAcknowledged = true;
    await acknowledgeInternalBotInteraction(group, messageId, memberId, emoji);
  };

  if (["ban", "banir", "kick", "expulsar", "promover", "promote", "rebaixar", "demote"].includes(canonical)) {
    await acknowledge("💬");
    if (!isAdmin) {
      created.push(await commandReply("Apenas administradores podem moderar membros."));
      return created;
    }
    const targetUserId = await resolveInternalCommandTarget(groupId, message, args);
    const target = targetUserId ? await getMembership(groupId, targetUserId) : null;
    if (!target || target.status !== "active") {
      created.push(await commandReply(
        "Responda à mensagem do membro ou informe o ID dele depois do comando.",
      ));
      return created;
    }
    if (target.role === "owner" || targetUserId === memberId) {
      created.push(await commandReply("Essa ação não pode ser aplicada a esse membro."));
      return created;
    }
    const targetName = await loadInternalUserName(targetUserId!);
    const actorName = await loadInternalUserName(memberId);
    if (["promover", "promote", "rebaixar", "demote"].includes(canonical)) {
      if (membership.role !== "owner") {
        created.push(await commandReply("Somente o proprietário define administradores."));
        return created;
      }
      const promoting = canonical === "promover" || canonical === "promote";
      await getDb().query(
        `UPDATE internal_group_members SET role = ? WHERE group_id = ? AND user_id = ?`,
        [promoting ? "admin" : "member", groupId, targetUserId],
      );
      const systemMessageId = await insertInternalSystemMessage(
        groupId,
        memberId,
        promoting
          ? `${actorName} tornou ${targetName} administrador(a) do grupo.`
          : `${actorName} removeu ${targetName} da função de administrador(a).`,
      );
      if (systemMessageId) created.push(systemMessageId);
      return created;
    }
    const banning = canonical === "ban" || canonical === "banir";
    await getDb().query(
      `UPDATE internal_group_members SET status = ? WHERE group_id = ? AND user_id = ?`,
      [banning ? "banned" : "removed", groupId, targetUserId],
    );
    const systemMessageId = await insertInternalSystemMessage(
      groupId,
      memberId,
      banning
        ? `${actorName} baniu ${targetName} do grupo.`
        : `${actorName} removeu ${targetName} do grupo.`,
    );
    if (systemMessageId) created.push(systemMessageId);
    const farewellMessageId = await emitInternalMembershipAutomation(
      group,
      targetUserId!,
      "farewell",
    );
    if (farewellMessageId) created.push(farewellMessageId);
    return created;
  }

  if (["play", "musica", "music", "mp3", "ytmp3", "video", "mp4", "ytmp4"].includes(canonical)) {
    await acknowledge("💬");
    const query = args.join(" ").trim();
    if (!query) {
      created.push(await commandReply("Use !play seguido do nome ou link da música/vídeo."));
      return created;
    }
    // Resolve capa e metadados do mesmo resultado. A mensagem do usuario ja
    // foi persistida/emitida antes deste processamento, portanto essa busca
    // nao bloqueia o balao local do comando.
    let resolvedQuery = query;
    let previewTitle = query;
    let previewAuthor = "";
    let previewDuration = "";
    let thumbnail = youtubeThumbnailFromQuery(query);
    const first = await resolvePlayPreview(query);
    if (first) {
      resolvedQuery = first.url || query;
      previewTitle = first.title || query;
      previewAuthor = first.author || "";
      previewDuration = first.duration || "";
      thumbnail = first.thumbnail || youtubeThumbnailFromQuery(first.url) || thumbnail;
    }
    if (!thumbnail) {
      created.push(await commandReply(
        "Não consegui localizar esse vídeo agora. Tente informar o título completo ou o link do YouTube.",
      ));
      return created;
    }
    const previewBody = [
      `🎵 ${previewTitle}`,
      previewAuthor ? `👤 ${previewAuthor}` : "",
      previewDuration ? `⏱ ${previewDuration}` : "",
      "🌐 YouTube",
    ].filter(Boolean).join("\n");
    created.push(await commandReply(
      previewBody,
      thumbnail
        ? {
            mediaType: "image",
            url: thumbnail,
            mimeType: "image/jpeg",
            fileName: "preview.jpg",
          }
        : null,
      [
        { id: "mp3", title: "Baixar MP3", payload: { format: "mp3", query: resolvedQuery } },
        { id: "mp4", title: "Baixar MP4", payload: { format: "mp4", query: resolvedQuery } },
      ],
    ));
    return created;
  }

  if (canonical && internalBotToggleKeys.has(canonical)) {
    await acknowledge("💬");
    if (!isAdmin) {
      created.push(await commandReply("Apenas administradores podem alterar as ativações do robô."));
      return created;
    }
    const current = settings.commandToggles[canonical as keyof typeof settings.commandToggles] === true;
    await upsertGroupSettings(settingsId, {
      commandToggles: {
        ...settings.commandToggles,
        [canonical]: !current,
      },
    });
    created.push(await commandReply(
      `${canonical} ${current ? "desativado" : "ativado"} neste grupo BotAdmin.`,
    ));
    return created;
  }

  if (["menu", "ajuda", "comandos", "inicio"].includes(canonical)) {
    await acknowledge("💬");
    const configured = settings.menuTexts.main.filter((entry) => entry.trim()).join("\n");
    const active = Object.entries(settings.commandToggles)
      .filter(([, enabled]) => enabled)
      .map(([key]) => `${prefixes[0] || "!"}${key}`)
      .join(" · ");
    created.push(await commandReply(
      configured || `Menu BotAdmin\n${active || "Nenhuma ativação ligada."}`,
    ));
    return created;
  }
  if (["regras", "regra"].includes(canonical) && settings.rulesMessage) {
    await acknowledge("💬");
    created.push(await commandReply(settings.rulesMessage.text, settings.rulesMessage.media));
    return created;
  }
  if (["tabela", "tab"].includes(canonical) && settings.tableMessage) {
    await acknowledge("💬");
    created.push(await commandReply(settings.tableMessage.text, settings.tableMessage.media));
    return created;
  }
  if (["admins", "admin"].includes(canonical)) {
    await acknowledge("💬");
    const [admins] = await getDb().query<(RowDataPacket & { name: string; role: string })[]>(
      `SELECT u.name, m.role FROM internal_group_members m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ? AND m.status = 'active' AND m.role IN ('owner','admin')
       ORDER BY FIELD(m.role, 'owner', 'admin'), u.name`,
      [groupId],
    );
    created.push(await commandReply(`Administradores\n${admins.map((item) => `• ${item.name}`).join("\n")}`));
    return created;
  }
  if (canonical === "ping") {
    await acknowledge("💬");
    created.push(await commandReply("🏓 Pong! Robô BotAdmin online."));
    return created;
  }

  if (settings.commandToggles.autoresposta) {
    const match = settings.autoResponses.find((entry) =>
      entry.matchAnyMessage || entry.triggers.some((trigger) => {
        const normalizedTrigger = normalizeAutomationText(trigger);
        return entry.matchMode === "contains"
          ? normalized.includes(normalizedTrigger)
          : normalized === normalizedTrigger;
      }),
    );
    if (match) {
      await acknowledge("💬");
      created.push(await commandReply(
        match.responseText,
        match.responseMedia,
      ));
      return created;
    }
  }

  if (settings.commandToggles.botinterage && text) {
    await acknowledge("🧠");
    const [users] = await getDb().query<(RowDataPacket & { name: string })[]>(
      "SELECT name FROM users WHERE id = ? LIMIT 1",
      [memberId],
    );
    const answer = await callInternalGroupAi(
      settings,
      users?.[0]?.name || "Membro",
      text,
      { group, settingsId, memberId, messageId },
    ).catch((error) => {
      console.error("[internal-groups] BotInterage failed", {
        groupId,
        messageId,
        error,
      });
      return { content: null, deferredMedia: false, media: [] };
    });
    if (answer.media.length > 0) {
      for (let index = 0; index < answer.media.length; index += 1) {
        created.push(await commandReply(index === 0 ? answer.content : null, answer.media[index]));
      }
    } else if (answer.content) {
      created.push(await commandReply(answer.content));
    }
    if (!answer.content && answer.media.length === 0 && !answer.deferredMedia) {
      created.push(await commandReply("⚠️ Não consegui concluir agora. Tente novamente em instantes."));
    }
  }
  return created;
};

export const createInternalGroupMessage = async (
  groupId: number,
  userId: number,
  input: {
    text?: unknown;
    messageType?: string;
    mediaPath?: string | null;
    mediaMimeType?: string | null;
    mediaFileName?: string | null;
    mediaSize?: number | null;
    replyToMessageId?: unknown;
    viewOnce?: unknown;
    mentionAll?: unknown;
    mentions?: unknown;
    clientMessageId?: unknown;
  },
) => {
  const membership = await assertInternalGroupMember(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group) throw new InternalGroupError("Grupo não encontrado.", 404);
  if (
    group.admins_only &&
    membership.role !== "owner" &&
    membership.role !== "admin"
  ) {
    throw new InternalGroupError(
      "Somente administradores podem enviar mensagens neste horário.",
      403,
      "ADMINS_ONLY",
    );
  }
  const text = cleanText(input.text, 4000) || null;
  const clientMessageId = cleanText(input.clientMessageId, 96) || null;
  const messageType = input.messageType ?? "text";
  const viewOnce = input.viewOnce === true || input.viewOnce === "true" || input.viewOnce === 1 || input.viewOnce === "1";
  if (viewOnce && !["image", "video", "audio"].includes(messageType)) {
    throw new InternalGroupError("A visualização única está disponível para foto, vídeo e áudio.");
  }
  if (!text && !input.mediaPath) throw new InternalGroupError("Digite uma mensagem ou selecione uma mídia.");
  const replyId = Math.max(0, Number(input.replyToMessageId ?? 0)) || null;
  let repliedUserId: number | null = null;
  if (replyId) {
    const [replyRows] = await getDb().query<(RowDataPacket & { sender_user_id: number; sender_kind: string })[]>(
      `SELECT id, sender_user_id, sender_kind
        FROM internal_group_messages WHERE id = ? AND group_id = ? LIMIT 1`,
      [replyId, groupId],
    );
    if (!Array.isArray(replyRows) || !replyRows.length) throw new InternalGroupError("Mensagem respondida não encontrada.", 404);
    if (replyRows[0].sender_kind !== "bot") {
      repliedUserId = Number(replyRows[0].sender_user_id) || null;
    }
  }
  if (clientMessageId) {
    const [existing] = await getDb().query<MessageRow[]>(
      `SELECT m.*, u.name AS sender_name, u.avatar_path AS sender_avatar_path
       FROM internal_group_messages m
       INNER JOIN users u ON u.id = m.sender_user_id
       WHERE m.group_id = ? AND m.sender_user_id = ? AND m.client_message_id = ?
       LIMIT 1`,
      [groupId, userId, clientMessageId],
    );
    if (existing?.[0]) {
      return { message: serializeMessage(existing[0], userId), idempotent: true };
    }
  }
  const mentionAll = input.mentionAll === true || input.mentionAll === "true" || input.mentionAll === 1 || input.mentionAll === "1";
  const requestedMentionIds = Array.isArray(input.mentions)
    ? input.mentions
        .map((value) => String(value).match(/(?:botadmin-user:)?(\d+)/)?.[1])
        .map((value) => Number(value ?? 0))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [];
  let mentionedUserIds: number[] = [];
  if (mentionAll || requestedMentionIds.length > 0 || repliedUserId) {
    const [activeMembers] = await getDb().query<(RowDataPacket & { user_id: number })[]>(
      `SELECT user_id FROM internal_group_members
        WHERE group_id = ? AND status = 'active'`,
      [groupId],
    );
    const activeIds = new Set((activeMembers ?? []).map((row) => Number(row.user_id)));
    mentionedUserIds = (mentionAll
      ? [...activeIds]
      : [...requestedMentionIds, ...(repliedUserId ? [repliedUserId] : [])]
          .filter((id) => activeIds.has(id)))
      .filter((id) => id !== userId);
  }
  let insertedId = 0;
  try {
    const [result] = await getDb().query<ResultSetHeader>(
      `
        INSERT INTO internal_group_messages
          (group_id, sender_user_id, message_type, body, media_path, media_mime_type, media_file_name, media_size, reply_to_message_id, view_once, mentioned_user_ids, client_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [groupId, userId, messageType, text, input.mediaPath ?? null, input.mediaMimeType ?? null,
        input.mediaFileName ?? null, input.mediaSize ?? null, replyId, viewOnce ? 1 : 0,
        mentionedUserIds.length ? JSON.stringify([...new Set(mentionedUserIds)].map(String)) : null,
        clientMessageId],
    );
    insertedId = Number(result.insertId);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (clientMessageId && code === "ER_DUP_ENTRY") {
      const [existing] = await getDb().query<MessageRow[]>(
        `SELECT m.*, u.name AS sender_name, u.avatar_path AS sender_avatar_path
         FROM internal_group_messages m
         INNER JOIN users u ON u.id = m.sender_user_id
         WHERE m.group_id = ? AND m.sender_user_id = ? AND m.client_message_id = ?
         LIMIT 1`,
        [groupId, userId, clientMessageId],
      );
      if (existing?.[0]) {
        return { message: serializeMessage(existing[0], userId), idempotent: true };
      }
    }
    throw error;
  }
  await getDb().query(`UPDATE internal_groups SET updated_at = NOW() WHERE id = ?`, [groupId]);
  const [rows] = await getDb().query<MessageRow[]>(
    `
      SELECT m.*, u.name AS sender_name, u.avatar_path AS sender_avatar_path,
             reply.body AS reply_body,
             CASE WHEN reply.sender_kind = 'bot'
               THEN COALESCE(reply.bot_display_name, 'Robô BotAdmin')
               ELSE reply_user.name END AS reply_sender_name
      FROM internal_group_messages m
      INNER JOIN users u ON u.id = m.sender_user_id
      LEFT JOIN internal_group_messages reply ON reply.id = m.reply_to_message_id
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_user_id
      WHERE m.id = ? LIMIT 1
    `,
    [insertedId],
  );
  return { message: serializeMessage(rows[0], userId), idempotent: false };
};

export const markInternalGroupRead = async (groupId: number, userId: number, messageId: number) => {
  await assertInternalGroupMember(groupId, userId);
  if (!Number.isFinite(messageId) || messageId <= 0) return;
  await getDb().query(
    `UPDATE internal_group_members SET last_read_message_id = CASE WHEN COALESCE(last_read_message_id, 0) < ? THEN ? ELSE last_read_message_id END WHERE group_id = ? AND user_id = ?`,
    [messageId, messageId, groupId, userId],
  );
  const [unread] = await getDb().query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM internal_group_messages
     WHERE group_id = ? AND id <= ? AND sender_user_id <> ? AND deleted_at IS NULL
     ORDER BY id DESC LIMIT 200`,
    [groupId, messageId, userId],
  );
  await recordInternalGroupReceipts(
    groupId,
    userId,
    (unread ?? []).map((row) => ({ messageId: Number(row.id), state: "read" as const })),
  );
};

export const recordInternalGroupReceipts = async (
  groupId: number,
  userId: number,
  entries: Array<{ messageId: number; state: "delivered" | "read" }>,
) => {
  await assertInternalGroupMember(groupId, userId);
  const normalized = entries
    .map((entry) => ({
      messageId: Number(entry.messageId),
      state: entry.state === "read" ? "read" : "delivered",
    }))
    .filter((entry) => Number.isInteger(entry.messageId) && entry.messageId > 0)
    .slice(0, 200);
  if (!normalized.length) return { updated: 0 };
  let updated = 0;
  for (const entry of normalized) {
    const [messageRows] = await getDb().query<(RowDataPacket & {
      sender_user_id: number;
      receipt_state: string | null;
    })[]>(
      `SELECT m.id, m.sender_user_id, r.state AS receipt_state
       FROM internal_group_messages m
       LEFT JOIN internal_group_message_receipts r
         ON r.message_id = m.id AND r.user_id = ?
       WHERE m.id = ? AND m.group_id = ? LIMIT 1`,
      [userId, entry.messageId, groupId],
    );
    if (!messageRows?.[0] || Number(messageRows[0].sender_user_id) === userId) continue;
    const previousState = messageRows[0].receipt_state;
    if (previousState === "read" || previousState === entry.state) continue;
    await getDb().query(
      `INSERT INTO internal_group_message_receipts
        (message_id, user_id, state, delivered_at, read_at)
       VALUES (?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         state = CASE WHEN state = 'read' OR VALUES(state) = 'read' THEN 'read' ELSE 'delivered' END,
         delivered_at = COALESCE(delivered_at, VALUES(delivered_at)),
         read_at = CASE WHEN VALUES(state) = 'read' THEN COALESCE(read_at, VALUES(read_at)) ELSE read_at END,
         updated_at = NOW()`,
      [entry.messageId, userId, entry.state, entry.state === "read" ? new Date() : null],
    );
    updated += 1;
    emitInternalGroupEvent({
      groupId,
      actorUserId: userId,
      type: "message.receipt",
      messageId: entry.messageId,
      action: entry.state,
    });
  }
  return { updated };
};

export const listInternalGroupMessageReceipts = async (
  groupId: number,
  messageId: number,
  userId: number,
) => {
  await assertInternalGroupMember(groupId, userId);
  const [messageRows] = await getDb().query<RowDataPacket[]>(
    `SELECT sender_user_id FROM internal_group_messages WHERE id = ? AND group_id = ? LIMIT 1`,
    [messageId, groupId],
  );
  if (!messageRows?.[0]) throw new InternalGroupError("Mensagem não encontrada.", 404);
  const membership = await getMembership(groupId, userId);
  if (Number(messageRows[0].sender_user_id) !== userId && membership?.role !== "owner" && membership?.role !== "admin") {
    throw new InternalGroupError("Os detalhes desta mensagem ficam disponíveis para o remetente e administradores.", 403);
  }
  const [rows] = await getDb().query<(RowDataPacket & {
    user_id: number;
    name: string;
    avatar_path: string | null;
    state: string;
    delivered_at: Date | string | null;
    read_at: Date | string | null;
  })[]>(
    `SELECT r.user_id, u.name, u.avatar_path, r.state, r.delivered_at, r.read_at
     FROM internal_group_message_receipts r
     INNER JOIN users u ON u.id = r.user_id
     WHERE r.message_id = ? ORDER BY u.name ASC`,
    [messageId],
  );
  return (rows ?? []).map((row) => ({
    userId: Number(row.user_id),
    name: row.name,
    avatarUrl: avatarUrl(row.avatar_path),
    state: row.state === "read" ? "read" : "delivered",
    deliveredAt: iso(row.delivered_at),
    readAt: iso(row.read_at),
  }));
};

export const deleteInternalGroupMessage = async (groupId: number, messageId: number, userId: number) => {
  const membership = await assertInternalGroupMember(groupId, userId);
  const [rows] = await getDb().query<MessageRow[]>(
    `SELECT * FROM internal_group_messages WHERE id = ? AND group_id = ? LIMIT 1`,
    [messageId, groupId],
  );
  const message = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!message) throw new InternalGroupError("Mensagem não encontrada.", 404);
  if (Number(message.sender_user_id) !== userId && membership.role === "member") {
    throw new InternalGroupError("Você não pode apagar esta mensagem.", 403);
  }
  await getDb().query(
    `UPDATE internal_group_messages
        SET deleted_at = COALESCE(deleted_at, NOW()), deleted_by_user_id = COALESCE(deleted_by_user_id, ?)
      WHERE id = ?`,
    [userId, messageId],
  );
  // O arquivo e o conteúdo são preservados para a auditoria dos
  // administradores. Membros comuns recebem somente o marcador "apagada".
  return { mediaPath: null };
};

export const openInternalGroupViewOnce = async (
  groupId: number,
  messageId: number,
  userId: number,
) => {
  await assertInternalGroupMember(groupId, userId);
  const [rows] = await getDb().query<MessageRow[]>(
    `SELECT * FROM internal_group_messages
      WHERE id = ? AND group_id = ? AND deleted_at IS NULL LIMIT 1`,
    [messageId, groupId],
  );
  const message = rows?.[0];
  if (!message?.media_path || !message.view_once) {
    throw new InternalGroupError("Esta mídia não é de visualização única.", 400);
  }
  // O remetente pode rever a própria cópia. A limitação de uma abertura
  // continua valendo individualmente para cada destinatário.
  const [existing] = await getDb().query<RowDataPacket[]>(
    `SELECT message_id FROM internal_group_message_views
      WHERE message_id = ? AND user_id = ? LIMIT 1`,
    [messageId, userId],
  );
  if (Array.isArray(existing) && existing.length > 0) {
    throw new InternalGroupError("Esta mídia de visualização única já foi aberta.", 410, "VIEW_ONCE_OPENED");
  }
  await getDb().query(
    `INSERT INTO internal_group_message_views (message_id, user_id, opened_at)
     VALUES (?, ?, NOW())`,
    [messageId, userId],
  );
  return { message: "Mídia de visualização única aberta." };
};

export const updateInternalGroupMember = async (
  groupId: number,
  actorUserId: number,
  memberUserId: number,
  action: "promote" | "demote" | "remove" | "ban" | "leave",
) => {
  const actor = await assertInternalGroupMember(groupId, actorUserId);
  const actorName = await loadInternalUserName(actorUserId);
  const memberName = actorUserId === memberUserId
    ? actorName
    : await loadInternalUserName(memberUserId);
  if (action === "leave" && actorUserId === memberUserId) {
    if (actor.role === "owner") throw new InternalGroupError("Transfira a propriedade antes de sair.");
    await getDb().query(`UPDATE internal_group_members SET status = 'removed' WHERE group_id = ? AND user_id = ?`, [groupId, actorUserId]);
    const group = await loadGroupRow(groupId);
    const systemMessageId = await insertInternalSystemMessage(
      groupId,
      actorUserId,
      `${actorName} saiu do grupo.`,
    );
    const automationMessageId = group
      ? await emitInternalMembershipAutomation(group, actorUserId, "farewell")
      : null;
    return {
      systemMessageIds: systemMessageId ? [systemMessageId] : [],
      automationMessageIds: automationMessageId ? [automationMessageId] : [],
    };
  }
  await assertManager(groupId, actorUserId);
  const target = await getMembership(groupId, memberUserId);
  if (!target || target.status !== "active") throw new InternalGroupError("Membro não encontrado.", 404);
  if (target.role === "owner") throw new InternalGroupError("O proprietário não pode ser alterado.", 403);
  if (actor.role === "admin" && target.role === "admin") throw new InternalGroupError("Somente o proprietário pode alterar outro administrador.", 403);
  if ((action === "promote" || action === "demote") && actor.role !== "owner") {
    throw new InternalGroupError("Somente o proprietário pode definir administradores.", 403);
  }
  if (action === "promote" || action === "demote") {
    await getDb().query(`UPDATE internal_group_members SET role = ? WHERE group_id = ? AND user_id = ?`, [action === "promote" ? "admin" : "member", groupId, memberUserId]);
    const systemMessageId = await insertInternalSystemMessage(
      groupId,
      actorUserId,
      action === "promote"
        ? `${actorName} tornou ${memberName} administrador(a) do grupo.`
        : `${actorName} removeu ${memberName} da função de administrador(a).`,
    );
    return {
      systemMessageIds: systemMessageId ? [systemMessageId] : [],
      automationMessageIds: [],
    };
  } else {
    await getDb().query(`UPDATE internal_group_members SET status = ? WHERE group_id = ? AND user_id = ?`, [action === "ban" ? "banned" : "removed", groupId, memberUserId]);
    const group = await loadGroupRow(groupId);
    const systemMessageId = await insertInternalSystemMessage(
      groupId,
      actorUserId,
      action === "ban"
        ? `${actorName} baniu ${memberName} do grupo.`
        : `${actorName} removeu ${memberName} do grupo.`,
    );
    const automationMessageId = group
      ? await emitInternalMembershipAutomation(group, memberUserId, "farewell")
      : null;
    return {
      systemMessageIds: systemMessageId ? [systemMessageId] : [],
      automationMessageIds: automationMessageId ? [automationMessageId] : [],
    };
  }
};

export const getInternalGroupMediaAccess = async (groupId: number, messageId: number, userId: number) => {
  const membership = await assertInternalGroupMember(groupId, userId);
  const [rows] = await getDb().query<MessageRow[]>(
    `SELECT * FROM internal_group_messages WHERE id = ? AND group_id = ? LIMIT 1`,
    [messageId, groupId],
  );
  const message = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!message?.media_path) throw new InternalGroupError("Mídia não encontrada.", 404);
  const deletedAudit = Boolean(message.deleted_at) && (
    membership.role === "owner" || membership.role === "admin"
  );
  if (message.deleted_at && !deletedAudit) {
    throw new InternalGroupError("Mídia não encontrada.", 404);
  }
  if (message.view_once && !deletedAudit) {
    if (Number(message.sender_user_id) === userId) {
      return {
        path: message.media_path,
        mimeType: message.media_mime_type ?? "application/octet-stream",
        fileName: message.media_file_name ?? `arquivo-${message.id}`,
        viewOnce: true,
      };
    }
    const [views] = await getDb().query<(RowDataPacket & { opened_at: Date | string })[]>(
      `SELECT opened_at FROM internal_group_message_views
        WHERE message_id = ? AND user_id = ? LIMIT 1`,
      [messageId, userId],
    );
    const openedAt = views?.[0]?.opened_at ? new Date(views[0].opened_at).getTime() : 0;
    // Players fazem mais de uma requisição/range. Uma janela curta após o
    // gesto explícito permite a reprodução sem transformar o URL em acesso
    // permanente.
    if (!openedAt || Date.now() - openedAt > 10 * 60 * 1000) {
      throw new InternalGroupError(
        openedAt
          ? "Esta mídia de visualização única já foi aberta."
          : "Abra esta mídia pela conversa.",
        openedAt ? 410 : 403,
        openedAt ? "VIEW_ONCE_OPENED" : "VIEW_ONCE_REQUIRED",
      );
    }
  }
  return {
    path: message.media_path,
    mimeType: message.media_mime_type ?? "application/octet-stream",
    fileName: message.media_file_name ?? `arquivo-${message.id}`,
    viewOnce: Boolean(message.view_once),
  };
};

export const getInternalGroupAvatarAccess = async (groupId: number, userId: number) => {
  await assertInternalGroupMember(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group?.avatar_path) {
    throw new InternalGroupError("Foto do grupo não encontrada.", 404);
  }
  return { path: group.avatar_path };
};

export const getInternalGroupWallpaperAccess = async (groupId: number, userId: number) => {
  await assertInternalGroupMember(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group?.wallpaper_path) {
    throw new InternalGroupError("Papel de parede do grupo não encontrado.", 404);
  }
  return { path: group.wallpaper_path };
};

export const getInternalGroupBotAvatarAccess = async (groupId: number, userId: number) => {
  await assertInternalGroupMember(groupId, userId);
  const group = await loadGroupRow(groupId);
  if (!group?.bot_avatar_path) {
    throw new InternalGroupError("Foto do robô não encontrada.", 404);
  }
  return { path: group.bot_avatar_path };
};
