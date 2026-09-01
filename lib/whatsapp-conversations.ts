import { ResultSetHeader, RowDataPacket } from "mysql2";
import { createHash } from "node:crypto";

import { ensureBotInstanceTable, ensureUserTable, getDb } from "lib/db";
import { isPostgresDatabaseProvider } from "lib/db/postgres-compat";
import {
  ANDROID_REALTIME_MESSAGES_CHANNEL_ID,
  sendPushNotificationToUser,
} from "lib/push-notifications";
import { publishWhatsappRealtimeEvent } from "lib/whatsapp-realtime-bus";
import { ensureUserMediaStorageTables } from "lib/user-media-storage";
import type { NormalizedMessage } from "lib/bot-events/types";
import type { BotInstance } from "types/bot-instances";

export type WhatsappChatType =
  "contact" | "group" | "community" | "channel" | "broadcast" | "unknown";
export type WhatsappMessageDirection = "inbound" | "outbound";

export type WhatsappConversationThread = {
  id: number;
  userId: number;
  instanceId: number;
  chatJid: string;
  chatType: WhatsappChatType;
  title: string | null;
  phone: string | null;
  avatarUrl: string | null;
  groupDescription?: string | null;
  participantsCount?: number | null;
  linkedGroupId?: number | null;
  inviteLink?: string | null;
  announceOnly?: boolean | null;
  instanceIsAdmin?: boolean | null;
  mentionable?: boolean | null;
  canSendMessages?: boolean | null;
  readOnlyReason?: string | null;
  channelRole?: string | null;
  directorySource?: "messages" | "contacts" | "groups" | "channels" | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageDirection: WhatsappMessageDirection | null;
  lastMessageSenderName: string | null;
  lastMessageSenderJid: string | null;
  unreadCount: number;
  archived: boolean;
  pinned: boolean;
  muted: boolean;
  deletedInInstance: boolean;
  deletedInInstanceAt: string | null;
  deletedInInstanceAction: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WhatsappConversationMessage = {
  id: number;
  conversationId: number;
  userId: number;
  instanceId: number;
  chatJid: string;
  messageId: string | null;
  clientMessageId?: string | null;
  direction: WhatsappMessageDirection;
  senderJid: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  messageType: string;
  text: string | null;
  media: Record<string, unknown> | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  size?: number | null;
  duration?: number | null;
  thumbnailUrl?: string | null;
  isAnimated?: boolean;
  deletedAt: string | null;
  deletedByJid: string | null;
  deletedByName: string | null;
  deletedPlaceholder: string | null;
  revealDeletedContent: boolean;
  timestamp: string;
  createdAt: string;
  deliveryState?: "sent" | "delivered" | "read";
  receiptSummary?: {
    recipientCount: number;
    deliveredCount: number;
    readCount: number;
  };
  receipts?: WhatsappMessageReceipt[];
};

export type WhatsappMessageReceipt = {
  recipientJid: string;
  recipientName: string | null;
  state: "delivered" | "read";
  deliveredAt: string | null;
  readAt: string | null;
};

export type WhatsappConversationMessagePage = {
  messages: WhatsappConversationMessage[];
  hasMore: boolean;
  oldestCursor: string | null;
};

export type WhatsappHistorySyncAnchor = {
  chatJid: string;
  messageId: string;
  fromMe: boolean;
  timestamp: string;
};

type ThreadRow = RowDataPacket & {
  id: number;
  user_id: number;
  instance_id: number;
  chat_jid: string;
  chat_type: string;
  title: string | null;
  phone: string | null;
  avatar_url: string | null;
  group_description?: string | null;
  participants_count?: number | null;
  linked_group_id?: number | null;
  invite_link?: string | null;
  announce_only?: number | boolean | null;
  instance_is_admin?: number | boolean | null;
  mentionable?: number | boolean | null;
  can_send_messages?: number | boolean | null;
  read_only_reason?: string | null;
  channel_role?: string | null;
  directory_source?: string | null;
  last_message_preview: string | null;
  last_message_at: Date | string | null;
  last_message_direction?: string | null;
  last_message_sender_name?: string | null;
  last_message_sender_jid?: string | null;
  unread_count: number | null;
  archived?: number | boolean | null;
  pinned?: number | boolean | null;
  muted?: number | boolean | null;
  deleted_in_instance?: number | boolean | null;
  deleted_in_instance_at?: Date | string | null;
  deleted_in_instance_action?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MessageRow = RowDataPacket & {
  id: number;
  conversation_id: number;
  user_id: number;
  instance_id: number;
  chat_jid: string;
  message_id: string | null;
  direction: string;
  sender_jid: string | null;
  sender_name: string | null;
  sender_avatar_url: string | null;
  message_type: string | null;
  text: string | null;
  media_json: string | null;
  raw_json?: string | null;
  deleted_at?: Date | string | null;
  deleted_by_jid?: string | null;
  deleted_by_name?: string | null;
  deleted_placeholder?: string | null;
  reveal_deleted_content?: number | boolean | null;
  timestamp: Date | string;
  created_at: Date | string;
  client_message_id?: string | null;
  receipt_recipient_count?: number | null;
  receipt_delivered_count?: number | null;
  receipt_read_count?: number | null;
};

export type WhatsappConversationStoredMessage = WhatsappConversationMessage & {
  raw: Record<string, unknown> | null;
};

export type WhatsappRealtimeEventType =
  | "conversation.message.upserted"
  | "status.update"
  | "chat.action"
  | "message.action"
  | "message.receipt"
  | "presence.update"
  | "history.sync"
  | "call.update"
  | "instance.status"
  | "group.plan.updated"
  | "user.plan.updated";

export type WhatsappRealtimeEvent = {
  id: number;
  userId: number;
  instanceId: number;
  chatJid: string;
  eventType: WhatsappRealtimeEventType;
  messageId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type WhatsappStatusViewer = {
  jid: string;
  name: string | null;
  avatarUrl: string | null;
  viewedAt: string | null;
};

export type WhatsappReceivedStatus = {
  id: number;
  instanceId: number;
  messageId: string | null;
  authorJid: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  type: string;
  text: string | null;
  caption: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  fontStyle: string | null;
  allowReshare: boolean | null;
  timestamp: string;
  expiresAt: string;
};

type RealtimeEventRow = RowDataPacket & {
  id: number;
  user_id: number;
  instance_id: number;
  chat_jid: string;
  event_type: string;
  message_id: string | null;
  payload_json: string | null;
  created_at: Date | string;
};

const ensurePostgresWhatsappConversationIndexes = async () => {
  if (!isPostgresDatabaseProvider()) {
    return;
  }

  const db = getDb();
  const statements = [
    `
      CREATE INDEX IF NOT EXISTS idx_bot_whatsapp_messages_user_chat_latest
      ON bot_whatsapp_messages (user_id, instance_id, chat_jid, timestamp DESC, id DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_bot_whatsapp_realtime_chat_event_id
      ON bot_whatsapp_realtime_events (user_id, instance_id, chat_jid, event_type, id)
      WHERE payload_json IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_bot_whatsapp_realtime_user_instance_event_latest
      ON bot_whatsapp_realtime_events (user_id, instance_id, event_type, id DESC)
      WHERE payload_json IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_bot_whatsapp_realtime_user_event_latest
      ON bot_whatsapp_realtime_events (user_id, event_type, id DESC)
      WHERE payload_json IS NOT NULL
    `,
  ];

  for (const statement of statements) {
    await db.query(statement);
  }
};

type StoredRealtimeMessageEventRow = RowDataPacket & {
  id: number;
  user_id: number;
  instance_id: number;
  chat_jid: string;
  message_id: string | null;
  payload_json: string | null;
  created_at: Date | string;
};

let ensureTask: Promise<void> | null = null;

const toIso = (value: Date | string | null): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const parseJson = (value: string | null): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const isEmptyStoredJsonValue = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim().length === 0);

const mergeStoredMessageJsonValue = (
  existing: unknown,
  incoming: unknown,
  key = "",
): unknown => {
  if (isEmptyStoredJsonValue(incoming)) return existing ?? null;
  if (isEmptyStoredJsonValue(existing)) return incoming;

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    if (incoming.length === 0 && existing.length > 0) {
      return existing;
    }
    return incoming.map((entry, index) =>
      index < existing.length
        ? mergeStoredMessageJsonValue(existing[index], entry, key)
        : entry,
    );
  }

  if (
    existing &&
    incoming &&
    typeof existing === "object" &&
    typeof incoming === "object" &&
    !Array.isArray(existing) &&
    !Array.isArray(incoming)
  ) {
    const previous = existing as Record<string, unknown>;
    const next = incoming as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...previous };
    for (const [entryKey, entryValue] of Object.entries(next)) {
      merged[entryKey] = mergeStoredMessageJsonValue(
        previous[entryKey],
        entryValue,
        entryKey,
      );
    }
    return merged;
  }

  if (
    /^(?:type|messagetype)$/i.test(key) &&
    typeof existing === "string" &&
    typeof incoming === "string" &&
    /^(?:unknown|media)$/i.test(incoming.trim()) &&
    !/^(?:unknown|media)$/i.test(existing.trim())
  ) {
    return existing;
  }

  return incoming;
};

const mergeStoredMessageJsonRecord = (
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  const merged = mergeStoredMessageJsonValue(existing, incoming);
  return merged && typeof merged === "object" && !Array.isArray(merged)
    ? (merged as Record<string, unknown>)
    : null;
};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const isLikelyWhatsappGroupDigits = (value: string | null | undefined) =>
  /^120363\d{6,}$/.test((value ?? "").replace(/\D+/g, ""));

const MAX_TRANSPORT_TEXT_LENGTH = 24_000;
const MAX_INLINE_MEDIA_STRING_LENGTH = 8_000;
const WHATSAPP_CONVERSATION_MESSAGE_PAGE_MAX = 2_000;
const INLINE_MEDIA_KEY_PATTERN =
  /(dataurl|data_url|base64|thumbnail|jpegthumbnail|media|file|image|video|audio|sticker|body)/i;

const isInlinePayloadString = (value: string, key = "") => {
  const trimmed = value.trim();
  if (/^data:[^,]+;base64,/i.test(trimmed)) return true;
  return (
    trimmed.length >= MAX_INLINE_MEDIA_STRING_LENGTH &&
    INLINE_MEDIA_KEY_PATTERN.test(key) &&
    /^[A-Za-z0-9+/=\r\n\s]+$/.test(trimmed)
  );
};

const sanitizeTransportString = (value: string, key = "") => {
  if (isInlinePayloadString(value, key)) return null;
  if (value.length <= MAX_TRANSPORT_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_TRANSPORT_TEXT_LENGTH)}...`;
};

const sanitizeTransportValue = (
  value: unknown,
  key = "",
  depth = 0,
): unknown => {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return sanitizeTransportString(value, key);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 12) return null;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeTransportValue(entry, key, depth + 1));
  }
  if (typeof value !== "object") return null;

  const next: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const sanitized = sanitizeTransportValue(entryValue, entryKey, depth + 1);
    if (sanitized !== undefined) {
      next[entryKey] = sanitized;
    }
  }
  return next;
};

const sanitizeAvatarUrlForTransport = (value: string | null | undefined) => {
  if (!value) return null;
  if (value.length > 4096 || isInlinePayloadString(value, "avatarUrl"))
    return null;
  return value;
};

const hasNestedInteractiveHeaderMedia = (
  value: unknown,
  depth = 0,
): boolean => {
  if (!value || typeof value !== "object" || depth > 10) return false;
  if (Array.isArray(value)) {
    return value.some((entry) =>
      hasNestedInteractiveHeaderMedia(entry, depth + 1),
    );
  }
  const record = value as Record<string, unknown>;
  const header = payloadRecord(record.headerMedia ?? record.HeaderMedia);
  if (
    firstString(
      header.sourceUrl,
      header.SourceUrl,
      header.url,
      header.URL,
      header.mediaUrl,
      header.MediaUrl,
      header.directPath,
      header.DirectPath,
      header.mediaKey,
      header.MediaKey,
    )
  ) {
    return true;
  }
  return Object.values(record).some((entry) =>
    hasNestedInteractiveHeaderMedia(entry, depth + 1),
  );
};

const isWhatsappCdnAvatarUrl = (value: string | null | undefined) =>
  /^https:\/\/pps\.whatsapp\.net\//i.test((value ?? "").trim());

const conversationAvatarUrlForTransport = (
  thread: WhatsappConversationThread,
) => {
  const avatarUrl = sanitizeAvatarUrlForTransport(thread.avatarUrl);
  if (!avatarUrl || !isWhatsappCdnAvatarUrl(avatarUrl)) return avatarUrl;
  return `/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${encodeURIComponent(thread.chatJid)}/avatar?url=${encodeURIComponent(avatarUrl)}`;
};

const conversationAvatarUrlForPush = (
  thread: WhatsappConversationThread,
) => {
  const avatarUrl = sanitizeAvatarUrlForTransport(thread.avatarUrl);
  if (!avatarUrl) return null;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;

  const baseUrl =
    process.env.INTERNAL_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NOTIFICATIONS_APP_URL?.trim() ||
    process.env.BASE_URL?.trim() ||
    "https://botadmin.shop";
  return `${baseUrl.replace(/\/+$/, "")}/${avatarUrl.replace(/^\/+/, "")}`;
};

export const sanitizeWhatsappConversationThreadForTransport = (
  thread: WhatsappConversationThread,
): WhatsappConversationThread => ({
  ...thread,
  avatarUrl: conversationAvatarUrlForTransport(thread),
});

export const sanitizeWhatsappConversationMessageForTransport = (
  message: WhatsappConversationMessage,
): WhatsappConversationMessage => {
  const media = message.media;
  const sanitizedMedia = sanitizeTransportValue(media, "media") as Record<
    string,
    unknown
  > | null;
  if (sanitizedMedia && hasNestedInteractiveHeaderMedia(media)) {
    const messageKey = message.messageId ?? String(message.id);
    sanitizedMedia.mediaProxyUrl =
      `/api/bot-instances/${message.instanceId}/whatsapp-conversations/${encodeURIComponent(message.chatJid)}/messages/${encodeURIComponent(messageKey)}/media`;
  }
  return {
    ...message,
    senderAvatarUrl: sanitizeAvatarUrlForTransport(message.senderAvatarUrl),
    media: sanitizedMedia,
    mediaUrl:
      firstStringFromRecord(
        media,
        "publicUrl",
        "localUrl",
        "mediaUrl",
        "MediaUrl",
        "url",
        "URL",
      ) ?? null,
    mimeType:
      firstStringFromRecord(
        media,
        "mimeType",
        "MimeType",
        "mimetype",
        "Mimetype",
      ) ?? null,
    fileName:
      firstStringFromRecord(
        media,
        "filename",
        "Filename",
        "fileName",
        "FileName",
        "name",
        "Name",
      ) ?? null,
    size:
      firstNumberFromRecord(
        media,
        "fileLength",
        "FileLength",
        "size",
        "Size",
        "bytes",
        "Bytes",
      ) ?? null,
    duration:
      firstNumberFromRecord(
        media,
        "seconds",
        "Seconds",
        "duration",
        "Duration",
      ) ?? null,
    thumbnailUrl:
      firstStringFromRecord(sanitizedMedia, "thumbnailUrl", "previewUrl") ??
      null,
    isAnimated: Boolean(
      media?.isAnimated ??
      media?.IsAnimated ??
      media?.animated ??
      media?.gifPlayback,
    ),
  };
};

export const sanitizeWhatsappRealtimePayloadForTransport = (
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
  const sanitized = sanitizeTransportValue(payload ?? null, "payload");
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : null;
};

export const sanitizeWhatsappRealtimeEventForTransport = (
  event: WhatsappRealtimeEvent,
): WhatsappRealtimeEvent => ({
  ...event,
  payload: sanitizeWhatsappRealtimePayloadForTransport(event.payload),
});

export const normalizeWhatsappChatJid = (value: string): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;

  const lowered = trimmed.toLowerCase();
  if (lowered === "status@broadcast" || lowered.endsWith("@broadcast")) {
    return lowered;
  }

  if (lowered.endsWith("@g.us")) {
    return lowered;
  }

  if (lowered.endsWith("@c.us")) {
    const digits = lowered.slice(0, -5).replace(/\D+/g, "");
    if (isLikelyWhatsappGroupDigits(digits)) return `${digits}@g.us`;
    return digits ? `${digits}@s.whatsapp.net` : null;
  }

  if (lowered.endsWith("@whatsapp.net")) {
    const digits = lowered.slice(0, -13).replace(/\D+/g, "");
    if (isLikelyWhatsappGroupDigits(digits)) return `${digits}@g.us`;
    return digits ? `${digits}@s.whatsapp.net` : lowered;
  }

  if (lowered.includes("@")) {
    return lowered;
  }

  const digits = trimmed.replace(/\D+/g, "");
  if (isLikelyWhatsappGroupDigits(digits)) return `${digits}@g.us`;
  return digits ? `${digits}@s.whatsapp.net` : null;
};

export const getWhatsappChatType = (chatJid: string): WhatsappChatType => {
  const lowered = chatJid.toLowerCase();
  if (lowered.endsWith("@g.us")) return "group";
  if (lowered.endsWith("@newsletter")) return "channel";
  if (lowered === "status@broadcast" || lowered.endsWith("@broadcast"))
    return "broadcast";
  if (lowered.endsWith("@s.whatsapp.net") || lowered.endsWith("@c.us"))
    return "contact";
  return "unknown";
};

export const isWhatsappStatusChatJid = (
  chatJid: string | null | undefined,
): boolean => {
  if (!chatJid) return false;
  const lowered = String(chatJid).trim().toLowerCase();
  return (
    lowered === "status@broadcast" ||
    lowered === "status@status" ||
    lowered.endsWith("@broadcast")
  );
};

export const getWhatsappChatPhone = (chatJid: string): string | null => {
  if (getWhatsappChatType(chatJid) !== "contact") return null;
  const local = chatJid.split("@")[0] ?? "";
  const digits = local.replace(/\D+/g, "");
  return digits || null;
};

const normalizeMessageTimestamp = (
  timestamp?: number | string | Date | null,
): Date => {
  if (timestamp instanceof Date) {
    return timestamp;
  }
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return new Date(
      timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000,
    );
  }
  if (typeof timestamp === "string" && timestamp.trim()) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    const numeric = Number(timestamp);
    if (Number.isFinite(numeric)) {
      return new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000);
    }
  }
  return new Date();
};

const mapThreadRow = (row: ThreadRow): WhatsappConversationThread => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  instanceId: Number(row.instance_id),
  chatJid: row.chat_jid,
  chatType:
    row.chat_type === "contact" ||
    row.chat_type === "group" ||
    row.chat_type === "community" ||
    row.chat_type === "broadcast" ||
    row.chat_type === "channel"
      ? row.chat_type
      : "unknown",
  title: row.title ?? null,
  phone: row.phone ?? null,
  avatarUrl: row.avatar_url ?? null,
  groupDescription: row.group_description ?? null,
  participantsCount:
    row.participants_count === null || row.participants_count === undefined
      ? null
      : Number(row.participants_count),
  linkedGroupId:
    row.linked_group_id === null || row.linked_group_id === undefined
      ? null
      : Number(row.linked_group_id),
  inviteLink: row.invite_link ?? null,
  announceOnly:
    row.announce_only === null || row.announce_only === undefined
      ? null
      : row.announce_only === true || Number(row.announce_only) === 1,
  instanceIsAdmin:
    row.instance_is_admin === null || row.instance_is_admin === undefined
      ? null
      : row.instance_is_admin === true || Number(row.instance_is_admin) === 1,
  mentionable:
    row.mentionable === null || row.mentionable === undefined
      ? null
      : row.mentionable === true || Number(row.mentionable) === 1,
  canSendMessages:
    row.can_send_messages === null || row.can_send_messages === undefined
      ? null
      : row.can_send_messages === true || Number(row.can_send_messages) === 1,
  readOnlyReason: row.read_only_reason ?? null,
  channelRole: row.channel_role ?? null,
  directorySource:
    row.directory_source === "messages" ||
    row.directory_source === "contacts" ||
    row.directory_source === "groups" ||
    row.directory_source === "channels"
      ? row.directory_source
      : null,
  lastMessagePreview: row.last_message_preview ?? null,
  lastMessageAt: toIso(row.last_message_at),
  lastMessageDirection:
    row.last_message_direction === "inbound" ||
    row.last_message_direction === "outbound"
      ? row.last_message_direction
      : null,
  lastMessageSenderName: row.last_message_sender_name ?? null,
  lastMessageSenderJid: row.last_message_sender_jid ?? null,
  unreadCount: Number(row.unread_count ?? 0),
  archived: row.archived === true || Number(row.archived ?? 0) === 1,
  pinned: row.pinned === true || Number(row.pinned ?? 0) === 1,
  muted: row.muted === true || Number(row.muted ?? 0) === 1,
  deletedInInstance:
    row.deleted_in_instance === true ||
    Number(row.deleted_in_instance ?? 0) === 1,
  deletedInInstanceAt: toIso(row.deleted_in_instance_at ?? null),
  deletedInInstanceAction: row.deleted_in_instance_action ?? null,
  createdAt: toIso(row.created_at)!,
  updatedAt: toIso(row.updated_at)!,
});

const recoverStoredMediaFromRaw = (
  row: MessageRow,
  raw: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  if (!raw) return null;
  return extractMediaFromNormalizedMessage({
    id: row.message_id,
    chatId: row.chat_jid,
    senderJid: row.sender_jid,
    fromMe: row.direction === "outbound",
    text: row.text ?? null,
    caption: row.text ?? null,
    messageType: row.message_type ?? null,
    participant: row.sender_jid,
    links: [],
    raw,
  });
};

const mergeRecoveredMedia = (
  stored: Record<string, unknown> | null,
  recovered: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  if (!stored) return recovered;
  if (!recovered) return stored;
  const merged = { ...recovered, ...stored };
  for (const key of [
    "mediaUrl",
    "publicUrl",
    "localUrl",
    "url",
    "directPath",
    "mediaKey",
    "thumbnailUrl",
    "thumbnail",
    "mimeType",
    "fileName",
    "filename",
    "headerMedia",
  ]) {
    const storedValue = stored[key];
    if (
      (storedValue === null || storedValue === undefined || storedValue === "") &&
      recovered[key] !== undefined
    ) {
      merged[key] = recovered[key];
    }
  }
  return merged;
};

const mapMessageRow = (row: MessageRow): WhatsappConversationMessage => {
  const raw = parseJson(row.raw_json ?? null);
  const storedMedia = mergeRecoveredMedia(
    parseJson(row.media_json),
    recoverStoredMediaFromRaw(row, raw),
  );
  const media = enrichStoredQuotedMedia(
    enrichStoredInteractiveMedia(
      storedMedia,
      raw,
      row.message_type || "text",
      row.text ?? null,
    ),
    raw,
  );
  const recoveredText =
    firstString(
      row.text,
      media?.caption,
      media?.Caption,
      media?.body,
      media?.Body,
      media?.text,
      media?.Text,
      media?.description,
      media?.Description,
    ) ?? null;
  const messageType = resolveStoredWhatsappMessageType({
    explicitType: row.message_type,
    media,
    text: recoveredText,
  });

  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    userId: Number(row.user_id),
    instanceId: Number(row.instance_id),
    chatJid: row.chat_jid,
    messageId: row.message_id ?? null,
    clientMessageId: row.client_message_id ?? null,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    senderJid: row.sender_jid ?? null,
    senderName: row.sender_name ?? null,
    senderAvatarUrl: row.sender_avatar_url ?? null,
    messageType,
    text: recoveredText,
    media,
    deletedAt: toIso(row.deleted_at ?? null),
    deletedByJid: row.deleted_by_jid ?? null,
    deletedByName: row.deleted_by_name ?? null,
    deletedPlaceholder: row.deleted_placeholder ?? null,
    revealDeletedContent:
      row.reveal_deleted_content === true ||
      Number(row.reveal_deleted_content ?? 0) === 1,
    timestamp: toIso(row.timestamp)!,
    createdAt: toIso(row.created_at)!,
    deliveryState: Number(row.receipt_read_count ?? 0) > 0
      ? "read"
      : Number(row.receipt_delivered_count ?? 0) > 0
        ? "delivered"
        : "sent",
    receiptSummary: {
      recipientCount: Number(row.receipt_recipient_count ?? 0),
      deliveredCount: Number(row.receipt_delivered_count ?? 0),
      readCount: Number(row.receipt_read_count ?? 0),
    },
  };
};

const mapMessageRowWithRaw = (
  row: MessageRow,
): WhatsappConversationStoredMessage => ({
  ...mapMessageRow(row),
  raw: parseJson(row.raw_json ?? null),
});

const mapRealtimeEventRow = (row: RealtimeEventRow): WhatsappRealtimeEvent => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  instanceId: Number(row.instance_id),
  chatJid: row.chat_jid,
  eventType:
    row.event_type === "conversation.message.upserted" ||
    row.event_type === "status.update" ||
    row.event_type === "chat.action" ||
    row.event_type === "message.action" ||
    row.event_type === "message.receipt" ||
    row.event_type === "instance.status" ||
    row.event_type === "group.plan.updated" ||
    row.event_type === "user.plan.updated"
      ? row.event_type
      : "conversation.message.upserted",
  messageId: row.message_id ?? null,
  payload: sanitizeWhatsappRealtimePayloadForTransport(
    parseJson(row.payload_json ?? null),
  ),
  createdAt: toIso(row.created_at)!,
});

export const ensureWhatsappConversationTables = async () => {
  if (ensureTask) {
    return ensureTask;
  }

  ensureTask = (async () => {
    await ensureUserTable();
    await ensureBotInstanceTable();
    const db = getDb();

    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_whatsapp_conversations (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        chat_jid VARCHAR(191) NOT NULL,
        chat_type ENUM('contact','group','community','channel','broadcast','unknown') NOT NULL DEFAULT 'unknown',
        title VARCHAR(255) NULL,
        phone VARCHAR(64) NULL,
        avatar_url TEXT NULL,
        group_description TEXT NULL,
        participants_count INT NULL,
        linked_group_id BIGINT NULL,
        invite_link TEXT NULL,
        announce_only TINYINT(1) NULL,
        instance_is_admin TINYINT(1) NULL,
        mentionable TINYINT(1) NULL,
        can_send_messages TINYINT(1) NULL,
        read_only_reason VARCHAR(255) NULL,
        channel_role VARCHAR(32) NULL,
        directory_source VARCHAR(32) NULL,
        last_message_preview TEXT NULL,
        last_message_at DATETIME NULL,
        unread_count INT NOT NULL DEFAULT 0,
        archived TINYINT(1) NOT NULL DEFAULT 0,
        pinned TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bot_whatsapp_conversation (user_id, instance_id, chat_jid),
        INDEX idx_bot_whatsapp_conversations_user_updated (user_id, instance_id, updated_at),
        INDEX idx_bot_whatsapp_conversations_last_message (user_id, instance_id, last_message_at),
        CONSTRAINT fk_bot_whatsapp_conversations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_whatsapp_conversations_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await db
      .query(
        `
      ALTER TABLE bot_whatsapp_conversations
      MODIFY chat_type ENUM('contact','group','community','channel','broadcast','unknown') NOT NULL DEFAULT 'unknown'
    `,
      )
      .catch(() => undefined);

    await db
      .query(
        `
      ALTER TABLE bot_whatsapp_conversations
      ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0
    `,
      )
      .catch(() => undefined);

    await db
      .query(
        `
      ALTER TABLE bot_whatsapp_conversations
      ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0
    `,
      )
      .catch(() => undefined);

    const ensureConversationColumn = async (
      column: string,
      definition: string,
    ) => {
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM bot_whatsapp_conversations LIKE ?",
        [column],
      );
      if (Array.isArray(rows) && rows.length > 0) {
        return;
      }
      await db.query(
        `ALTER TABLE bot_whatsapp_conversations ADD COLUMN ${definition}`,
      );
    };

    await ensureConversationColumn(
      "deleted_in_instance",
      "deleted_in_instance TINYINT(1) NOT NULL DEFAULT 0 AFTER pinned",
    );
    await ensureConversationColumn(
      "deleted_in_instance_at",
      "deleted_in_instance_at DATETIME NULL AFTER deleted_in_instance",
    );
    await ensureConversationColumn(
      "deleted_in_instance_action",
      "deleted_in_instance_action VARCHAR(64) NULL AFTER deleted_in_instance_at",
    );
    await ensureConversationColumn(
      "group_description",
      "group_description TEXT NULL",
    );
    await ensureConversationColumn(
      "participants_count",
      "participants_count INT NULL",
    );
    await ensureConversationColumn(
      "linked_group_id",
      "linked_group_id BIGINT NULL",
    );
    await ensureConversationColumn("invite_link", "invite_link TEXT NULL");
    await ensureConversationColumn(
      "announce_only",
      "announce_only TINYINT(1) NULL",
    );
    await ensureConversationColumn(
      "instance_is_admin",
      "instance_is_admin TINYINT(1) NULL",
    );
    await ensureConversationColumn(
      "mentionable",
      "mentionable TINYINT(1) NULL",
    );
    await ensureConversationColumn(
      "can_send_messages",
      "can_send_messages TINYINT(1) NULL",
    );
    await ensureConversationColumn(
      "read_only_reason",
      "read_only_reason VARCHAR(255) NULL",
    );
    await ensureConversationColumn(
      "channel_role",
      "channel_role VARCHAR(32) NULL",
    );
    await ensureConversationColumn(
      "directory_source",
      "directory_source VARCHAR(32) NULL",
    );

    await db.query(`
	      CREATE TABLE IF NOT EXISTS bot_whatsapp_messages (
	        id BIGINT AUTO_INCREMENT PRIMARY KEY,
	        conversation_id BIGINT NOT NULL,
	        user_id INT NOT NULL,
	        instance_id INT NOT NULL,
	        chat_jid VARCHAR(191) NOT NULL,
	        message_id VARCHAR(191) NULL,
	        direction ENUM('inbound','outbound') NOT NULL,
	        sender_jid VARCHAR(191) NULL,
	        sender_name VARCHAR(255) NULL,
	        sender_avatar_url MEDIUMTEXT NULL,
	        message_type VARCHAR(64) NOT NULL DEFAULT 'text',
	        text TEXT NULL,
	        media_json LONGTEXT NULL,
	        raw_json LONGTEXT NULL,
        timestamp DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bot_whatsapp_message (instance_id, chat_jid, message_id),
        INDEX idx_bot_whatsapp_messages_thread_time (conversation_id, timestamp),
        INDEX idx_bot_whatsapp_messages_user_chat (user_id, instance_id, chat_jid, timestamp),
        CONSTRAINT fk_bot_whatsapp_messages_thread FOREIGN KEY (conversation_id) REFERENCES bot_whatsapp_conversations(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_whatsapp_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_whatsapp_messages_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE
	      ) ENGINE=InnoDB;
	    `);

    const ensureMessageColumn = async (column: string, definition: string) => {
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM bot_whatsapp_messages LIKE ?",
        [column],
      );
      if (Array.isArray(rows) && rows.length > 0) {
        return;
      }
      await db.query(
        `ALTER TABLE bot_whatsapp_messages ADD COLUMN ${definition}`,
      );
    };

    await ensureMessageColumn(
      "sender_avatar_url",
      "sender_avatar_url MEDIUMTEXT NULL AFTER sender_name",
    );
    await ensureMessageColumn(
      "deleted_at",
      "deleted_at DATETIME NULL AFTER raw_json",
    );
    await ensureMessageColumn(
      "deleted_by_jid",
      "deleted_by_jid VARCHAR(191) NULL AFTER deleted_at",
    );
    await ensureMessageColumn(
      "deleted_by_name",
      "deleted_by_name VARCHAR(255) NULL AFTER deleted_by_jid",
    );
    await ensureMessageColumn(
      "deleted_placeholder",
      "deleted_placeholder VARCHAR(255) NULL AFTER deleted_by_name",
    );
    await ensureMessageColumn(
      "reveal_deleted_content",
      "reveal_deleted_content TINYINT(1) NOT NULL DEFAULT 0 AFTER deleted_placeholder",
    );
    await ensureMessageColumn(
      "client_message_id",
      "client_message_id VARCHAR(96) NULL AFTER message_id",
    );
    await db.query(
      "CREATE INDEX idx_bot_whatsapp_messages_client_id ON bot_whatsapp_messages (user_id, instance_id, chat_jid, client_message_id)",
    ).catch(() => undefined);
    await db.query(
      "CREATE UNIQUE INDEX uq_bot_whatsapp_messages_client_id ON bot_whatsapp_messages (user_id, instance_id, chat_jid, client_message_id)",
    ).catch(() => undefined);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_whatsapp_message_receipts (
        message_id BIGINT NOT NULL,
        recipient_jid VARCHAR(191) NOT NULL,
        recipient_name VARCHAR(255) NULL,
        state VARCHAR(16) NOT NULL DEFAULT 'delivered',
        delivered_at DATETIME NULL,
        read_at DATETIME NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, recipient_jid),
        KEY idx_bot_whatsapp_receipts_state (message_id, state),
        CONSTRAINT fk_bot_whatsapp_receipt_message FOREIGN KEY (message_id) REFERENCES bot_whatsapp_messages(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_whatsapp_message_views (
        message_id BIGINT NOT NULL,
        user_id INT NOT NULL,
        opened_at DATETIME NOT NULL,
        PRIMARY KEY (message_id, user_id),
        KEY idx_bot_whatsapp_views_user (user_id, opened_at),
        CONSTRAINT fk_bot_whatsapp_view_message FOREIGN KEY (message_id) REFERENCES bot_whatsapp_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_whatsapp_view_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_whatsapp_realtime_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        chat_jid VARCHAR(191) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        message_id VARCHAR(191) NULL,
        payload_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bot_whatsapp_realtime_user_sequence (user_id, id),
        INDEX idx_bot_whatsapp_realtime_chat_sequence (user_id, instance_id, chat_jid, id),
        INDEX idx_bot_whatsapp_realtime_created (created_at),
        CONSTRAINT fk_bot_whatsapp_realtime_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_whatsapp_realtime_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_whatsapp_conversation_notifications (
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        chat_jid VARCHAR(191) NOT NULL,
        muted TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, instance_id, chat_jid),
        INDEX idx_bot_whatsapp_conversation_notifications_muted (user_id, muted),
        CONSTRAINT fk_bot_whatsapp_conversation_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_whatsapp_conversation_notifications_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await ensurePostgresWhatsappConversationIndexes();
  })().catch((error) => {
    ensureTask = null;
    throw error;
  });

  return ensureTask;
};

export const recordWhatsappRealtimeEvent = async (params: {
  userId: number;
  instanceId: number;
  chatJid: string;
  eventType: WhatsappRealtimeEventType;
  messageId?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<WhatsappRealtimeEvent | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(params.chatJid);
  if (!chatJid) return null;

  const db = getDb();
  const payload = sanitizeWhatsappRealtimePayloadForTransport(
    params.payload ?? null,
  );
  const [insert] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_whatsapp_realtime_events
        (user_id, instance_id, chat_jid, event_type, message_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      params.userId,
      params.instanceId,
      chatJid,
      params.eventType,
      params.messageId ?? null,
      payload ? JSON.stringify(payload) : null,
    ],
  );

  const [rows] = await db.query<RealtimeEventRow[]>(
    "SELECT * FROM bot_whatsapp_realtime_events WHERE id = ? LIMIT 1",
    [Number(insert.insertId)],
  );

  return rows[0] ? mapRealtimeEventRow(rows[0]) : null;
};

export const recordWhatsappMessageReceipt = async (params: {
  userId: number;
  instanceId: number;
  chatJid: string;
  messageId: string;
  recipientJid?: string | null;
  recipientName?: string | null;
  state: "delivered" | "read";
  at?: Date | string | null;
}) => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(params.chatJid);
  const messageId = params.messageId?.trim();
  if (!chatJid || !messageId) return false;
  const db = getDb();
  const [messages] = await db.query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bot_whatsapp_messages
     WHERE user_id = ? AND instance_id = ? AND chat_jid = ? AND message_id = ?
     LIMIT 1`,
    [params.userId, params.instanceId, chatJid, messageId],
  );
  const internalId = Number(messages?.[0]?.id ?? 0);
  if (!internalId) return false;
  const recipientJid = (params.recipientJid?.trim() || chatJid).slice(0, 191);
  const at = params.at ? new Date(params.at) : new Date();
  const timestamp = Number.isNaN(at.getTime()) ? new Date() : at;
  await db.query(
    `INSERT INTO bot_whatsapp_message_receipts
      (message_id, recipient_jid, recipient_name, state, delivered_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       recipient_name = COALESCE(VALUES(recipient_name), recipient_name),
       state = CASE WHEN state = 'read' OR VALUES(state) = 'read' THEN 'read' ELSE 'delivered' END,
       delivered_at = COALESCE(delivered_at, VALUES(delivered_at)),
       read_at = CASE WHEN VALUES(state) = 'read' THEN COALESCE(read_at, VALUES(read_at)) ELSE read_at END,
       updated_at = NOW()`,
    [
      internalId,
      recipientJid,
      params.recipientName?.trim() || null,
      params.state,
      timestamp,
      params.state === "read" ? timestamp : null,
    ],
  );
  return true;
};

export const listWhatsappMessageReceipts = async (params: {
  userId: number;
  instanceId: number;
  chatJid: string;
  messageKey: string;
}) => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(params.chatJid);
  if (!chatJid) return [] as WhatsappMessageReceipt[];
  const key = params.messageKey.trim();
  const numericId = Number.parseInt(key, 10);
  const hasNumericId = Number.isFinite(numericId) && numericId > 0;
  const db = getDb();
  const [rows] = await db.query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bot_whatsapp_messages
     WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
       AND (message_id = ?${hasNumericId ? " OR id = ?" : ""}) LIMIT 1`,
    hasNumericId
      ? [params.userId, params.instanceId, chatJid, key, numericId]
      : [params.userId, params.instanceId, chatJid, key],
  );
  const id = Number(rows?.[0]?.id ?? 0);
  if (!id) return [] as WhatsappMessageReceipt[];
  const [receipts] = await db.query<(RowDataPacket & {
    recipient_jid: string;
    recipient_name: string | null;
    state: string;
    delivered_at: Date | string | null;
    read_at: Date | string | null;
  })[]>(
    `SELECT recipient_jid, recipient_name, state, delivered_at, read_at
     FROM bot_whatsapp_message_receipts WHERE message_id = ? ORDER BY recipient_name, recipient_jid`,
    [id],
  );
  return (receipts ?? []).map((row) => ({
    recipientJid: row.recipient_jid,
    recipientName: row.recipient_name || row.recipient_jid,
    state: row.state === "read" ? "read" : "delivered",
    deliveredAt: toIso(row.delivered_at),
    readAt: toIso(row.read_at),
  }));
};

const resolveWhatsappMessageRecordId = async (params: {
  userId: number;
  instanceId: number;
  chatJid: string;
  messageKey: string;
}) => {
  const key = params.messageKey.trim();
  const numericId = Number.parseInt(key, 10);
  const hasNumericId = Number.isFinite(numericId) && numericId > 0;
  const [rows] = await getDb().query<(RowDataPacket & {
    id: number;
    direction: string;
    media_json: string | null;
    raw_json: string | null;
    message_id: string | null;
  })[]>(
    `SELECT id, direction, media_json, raw_json, message_id
     FROM bot_whatsapp_messages
     WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
       AND (message_id = ?${hasNumericId ? " OR id = ?" : ""}) LIMIT 1`,
    hasNumericId
      ? [params.userId, params.instanceId, params.chatJid, key, numericId]
      : [params.userId, params.instanceId, params.chatJid, key],
  );
  return rows?.[0] ?? null;
};

const recordContainsViewOnce = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(recordContainsViewOnce);
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (/^view[_-]?once$/i.test(key) && (item === true || item === 1 || item === "1" || String(item).toLowerCase() === "true")) {
      return true;
    }
    if (item && typeof item === "object" && recordContainsViewOnce(item)) return true;
  }
  return false;
};

export const openWhatsappConversationViewOnce = async (params: {
  userId: number;
  instanceId: number;
  chatJid: string;
  messageKey: string;
}) => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(params.chatJid);
  if (!chatJid) throw new Error("Conversa inválida.");
  const row = await resolveWhatsappMessageRecordId({ ...params, chatJid });
  if (!row) throw new Error("Mensagem não encontrada.");
  if (!recordContainsViewOnce(parseJson(row.media_json)) && !recordContainsViewOnce(parseJson(row.raw_json))) {
    throw new Error("Esta mídia não é de visualização única.");
  }
  // The sender can review their local copy. Recipients are limited to one
  // explicit open; range requests are allowed by the media route for a short
  // playback window after this marker is written.
  if (row.direction === "outbound") return { opened: true, sender: true };
  const [existing] = await getDb().query<RowDataPacket[]>(
    `SELECT opened_at FROM bot_whatsapp_message_views WHERE message_id = ? AND user_id = ? LIMIT 1`,
    [row.id, params.userId],
  );
  if (existing?.[0]) {
    throw Object.assign(new Error("Esta mídia de visualização única já foi aberta."), {
      status: 410,
      code: "VIEW_ONCE_OPENED",
    });
  }
  await getDb().query(
    `INSERT INTO bot_whatsapp_message_views (message_id, user_id, opened_at) VALUES (?, ?, NOW())`,
    [row.id, params.userId],
  );
  return { opened: true, sender: false };
};

export const getWhatsappViewOnceAccess = async (params: {
  userId: number;
  instanceId: number;
  chatJid: string;
  messageKey: string;
}) => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(params.chatJid);
  if (!chatJid) return { viewOnce: false, allowed: false, status: 404 as const };
  const row = await resolveWhatsappMessageRecordId({ ...params, chatJid });
  if (!row) return { viewOnce: false, allowed: false, status: 404 as const };
  const viewOnce = recordContainsViewOnce(parseJson(row.media_json)) || recordContainsViewOnce(parseJson(row.raw_json));
  if (!viewOnce || row.direction === "outbound") return { viewOnce, allowed: true, status: 200 as const };
  const [views] = await getDb().query<(RowDataPacket & { opened_at: Date | string })[]>(
    `SELECT opened_at FROM bot_whatsapp_message_views WHERE message_id = ? AND user_id = ? LIMIT 1`,
    [row.id, params.userId],
  );
  if (!views?.[0]) return { viewOnce: true, allowed: false, status: 403 as const };
  const openedAt = new Date(views[0].opened_at).getTime();
  if (!Number.isFinite(openedAt) || Date.now() - openedAt > 10 * 60 * 1000) {
    return { viewOnce: true, allowed: false, status: 410 as const };
  }
  return { viewOnce: true, allowed: true, status: 200 as const };
};

export const listWhatsappRealtimeEvents = async (
  userId: number,
  options: {
    after?: number | string | null;
    limit?: number | string | null;
    instanceId?: number | string | null;
    chatJid?: string | null;
  } = {},
): Promise<WhatsappRealtimeEvent[]> => {
  await ensureWhatsappConversationTables();
  const after = Math.max(
    0,
    Number.parseInt(String(options.after ?? "0"), 10) || 0,
  );
  const limit = Math.min(
    Math.max(Number.parseInt(String(options.limit ?? "200"), 10) || 200, 1),
    500,
  );
  const filters = ["user_id = ?", "id > ?"];
  const params: unknown[] = [userId, after];
  const instanceId = Number.parseInt(String(options.instanceId ?? ""), 10);
  if (Number.isFinite(instanceId) && instanceId > 0) {
    filters.push("instance_id = ?");
    params.push(instanceId);
  }
  const chatJid =
    typeof options.chatJid === "string"
      ? normalizeWhatsappChatJid(options.chatJid)
      : null;
  if (chatJid) {
    filters.push("chat_jid = ?");
    params.push(chatJid);
  }
  params.push(limit);

  const db = getDb();
  const [rows] = await db.query<RealtimeEventRow[]>(
    `
      SELECT *
      FROM bot_whatsapp_realtime_events
      WHERE ${filters.join(" AND ")}
      ORDER BY id ASC
      LIMIT ?
    `,
    params,
  );
  return rows.map(mapRealtimeEventRow);
};

const firstPayloadString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return null;
};

const payloadRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const payloadBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const parsePayloadDate = (value: unknown): Date | null => {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 1_000_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return direct;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const date = new Date(
        numeric > 1_000_000_000_000 ? numeric : numeric * 1000,
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  return null;
};

const truncatePayloadString = (
  value: unknown,
  maxLength: number,
): string | null => {
  const text = firstPayloadString(value);
  return text ? text.slice(0, maxLength) : null;
};

export const listWhatsappStatusViewersForUser = async (
  userId: number,
  instanceId: number,
  messageId: string,
): Promise<WhatsappStatusViewer[]> => {
  await ensureWhatsappConversationTables();
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId || !Number.isFinite(instanceId) || instanceId <= 0)
    return [];

  const db = getDb();
  const [rows] = await db.query<RealtimeEventRow[]>(
    `
      SELECT *
      FROM bot_whatsapp_realtime_events
      WHERE user_id = ?
        AND instance_id = ?
        AND chat_jid = 'status@broadcast'
        AND event_type = 'status.update'
      ORDER BY id DESC
      LIMIT 1000
    `,
    [userId, instanceId],
  );

  const viewers = new Map<string, WhatsappStatusViewer>();
  for (const row of rows) {
    const payload = parseJson(row.payload_json);
    const status = payloadRecord(payload?.status);
    const raw = payloadRecord(payload?.raw);
    const receipt = payloadRecord(payload?.receipt ?? raw.receipt);
    const viewer = payloadRecord(
      status.viewer ?? receipt.messageSender ?? raw.viewer,
    );
    const action = firstPayloadString(
      status.action,
      payload?.action,
      raw.eventType,
    );
    const ids = [
      status.id,
      status.messageId,
      ...(Array.isArray(status.messageIds) ? status.messageIds : []),
      ...(Array.isArray(receipt.messageIds) ? receipt.messageIds : []),
    ]
      .map((value) => firstPayloadString(value))
      .filter(Boolean);
    if (!ids.includes(normalizedMessageId)) continue;
    if (action && action !== "viewed" && action !== "status.viewed") continue;
    const jid = firstPayloadString(
      status.viewerJid,
      viewer.jid,
      viewer.id,
      receipt.messageSenderJid,
    );
    if (!jid) continue;
    viewers.set(jid, {
      jid,
      name: firstPayloadString(
        viewer.name,
        viewer.pushName,
        viewer.fullName,
        viewer.shortName,
      ),
      avatarUrl: firstPayloadString(
        viewer.avatarUrl,
        viewer.profilePictureUrl,
        viewer.pictureUrl,
      ),
      viewedAt:
        firstPayloadString(status.timestamp, payload?.createdAt) ??
        toIso(row.created_at),
    });
  }
  return Array.from(viewers.values());
};

export const getLatestWhatsappRealtimeSequence = async (
  userId: number,
): Promise<number> => {
  await ensureWhatsappConversationTables();
  const db = getDb();
  const [rows] = await db.query<
    (RowDataPacket & { latest_id: number | null })[]
  >(
    `
      SELECT MAX(id) AS latest_id
      FROM bot_whatsapp_realtime_events
      WHERE user_id = ?
    `,
    [userId],
  );
  return Number(rows[0]?.latest_id ?? 0);
};

const buildMessagePreview = (params: {
  text?: string | null;
  media?: Record<string, unknown> | null;
  messageType?: string | null;
}) => {
  const text = params.text?.trim();
  if (text) return text.slice(0, 500);

  const caption = firstString(params.media?.caption, params.media?.Caption);
  if (caption) return caption.slice(0, 500);

  const type = String(
    params.messageType ||
      params.media?.mediaType ||
      params.media?.type ||
      "mensagem",
  )
    .replace(/message$/i, "")
    .toLowerCase();

  if (type.includes("image")) return "Imagem";
  if (type.includes("video")) return "Video";
  if (type.includes("audio") || type.includes("ptt")) return "Audio";
  if (type.includes("document")) return "Documento";
  if (type.includes("sticker")) return "Sticker";
  if (type.includes("list")) return "Lista";
  if (type.includes("button") || type.includes("interactive")) return "Botões";
  if (type.includes("contact") || type.includes("vcard")) return "Contato";
  if (type.includes("location")) return "Localização";
  if (type.includes("poll")) return "Enquete";
  if (type.includes("reaction")) return "Reação";
  if (type.includes("undecryptable") || type.includes("unavailable"))
    return "Mensagem indisponível";
  return "Mensagem";
};

const normalizeStoredWhatsappMessageType = (value?: string | null): string => {
  const type = String(value ?? "")
    .trim()
    .replace(/message$/i, "")
    .toLowerCase();
  if (!type) return "text";
  if (type === "unknown" || type === "unsupported") return type;
  if (type === "picture" || type === "photo") return "image";
  if (type === "voice" || type === "ptt") return "audio";
  if (type === "doc") return "document";
  if (type.includes("undecryptable") || type.includes("unavailable"))
    return "undecryptable";
  if (type.includes("reaction")) return "reaction";
  if (type.includes("sticker")) return "sticker";
  if (type.includes("image")) return "image";
  if (type.includes("video") || type.includes("ptv")) return "video";
  if (type.includes("audio") || type.includes("ptt")) return "audio";
  if (type.includes("document") || type.includes("file")) return "document";
  if (type.includes("list")) return "list";
  if (
    type.includes("button") ||
    type.includes("interactive") ||
    type.includes("template")
  )
    return "interactive";
  if (type.includes("contact") || type.includes("vcard")) return "contact";
  if (type.includes("location")) return "location";
  if (type.includes("poll")) return "poll";
  return type;
};

const resolveStoredWhatsappMessageType = (params: {
  explicitType?: string | null;
  media?: Record<string, unknown> | null;
  text?: string | null;
}) => {
  const explicit = normalizeStoredWhatsappMessageType(params.explicitType);
  const mediaType = normalizeStoredWhatsappMessageType(
    firstString(
      params.media?.mediaType,
      params.media?.type,
      params.media?.kind,
    ) ?? null,
  );
  if (explicit === "unknown" || explicit === "unsupported") {
    if (
      mediaType &&
      mediaType !== "text" &&
      mediaType !== "unknown" &&
      mediaType !== "unsupported"
    ) {
      return mediaType;
    }
    if (params.text?.trim()) return "text";
    return explicit;
  }
  if (
    explicit === "text" &&
    mediaType &&
    mediaType !== "text" &&
    mediaType !== "unknown" &&
    mediaType !== "unsupported"
  ) {
    return mediaType;
  }
  return explicit || mediaType || "text";
};

const compactPushText = (
  value: string | null | undefined,
  maxLength = 180,
): string => {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Nova mensagem";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
};

const getConversationPushTitle = (
  thread: WhatsappConversationThread,
  options: {
    senderName?: string | null;
    senderJid?: string | null;
  },
): string => {
  const threadTitle = thread.title?.trim();
  if (threadTitle) return threadTitle;

  const senderName = options.senderName?.trim();
  if (senderName) return senderName;

  const phone = thread.phone?.trim();
  if (phone) return phone;

  const senderPhone = options.senderJid?.split("@")[0]?.trim();
  if (senderPhone) return senderPhone;

  return "Nova mensagem";
};

const getConversationPushBody = (
  thread: WhatsappConversationThread,
  preview: string,
  options: {
    senderName?: string | null;
  },
): string => {
  const text = compactPushText(preview);
  if (thread.chatType !== "group" && thread.chatType !== "community") {
    return text;
  }

  const senderName = options.senderName?.trim();
  if (!senderName) return text;

  const body = `${senderName}: ${text}`;
  return compactPushText(body, 220);
};

export const upsertWhatsappConversation = async (options: {
  userId: number;
  instanceId: number;
  chatJid: string;
  chatType?: WhatsappChatType;
  title?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  groupDescription?: string | null;
  participantsCount?: number | null;
  linkedGroupId?: number | null;
  inviteLink?: string | null;
  announceOnly?: boolean | null;
  instanceIsAdmin?: boolean | null;
  mentionable?: boolean | null;
  canSendMessages?: boolean | null;
  readOnlyReason?: string | null;
  channelRole?: string | null;
  directorySource?: WhatsappConversationThread["directorySource"];
  lastMessagePreview?: string | null;
  lastMessageAt?: Date | null;
}): Promise<WhatsappConversationThread | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(options.chatJid);
  if (!chatJid) return null;

  const chatType = options.chatType ?? getWhatsappChatType(chatJid);
  const storedChatType = chatType;
  const phone = options.phone ?? getWhatsappChatPhone(chatJid);
  const db = getDb();

  const [insert] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_whatsapp_conversations
        (
          user_id, instance_id, chat_jid, chat_type, title, phone, avatar_url,
          group_description, participants_count, linked_group_id, invite_link,
          announce_only, instance_is_admin, mentionable, can_send_messages,
          read_only_reason, channel_role, directory_source,
          last_message_preview, last_message_at
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        chat_type = CASE
          WHEN chat_type = 'community' AND VALUES(chat_type) = 'group' THEN chat_type
          ELSE VALUES(chat_type)
        END,
        title = COALESCE(NULLIF(VALUES(title), ''), title),
        phone = COALESCE(NULLIF(VALUES(phone), ''), phone),
        avatar_url = COALESCE(NULLIF(VALUES(avatar_url), ''), avatar_url),
        group_description = COALESCE(VALUES(group_description), group_description),
        participants_count = COALESCE(VALUES(participants_count), participants_count),
        linked_group_id = COALESCE(VALUES(linked_group_id), linked_group_id),
        invite_link = COALESCE(NULLIF(VALUES(invite_link), ''), invite_link),
        announce_only = COALESCE(VALUES(announce_only), announce_only),
        instance_is_admin = COALESCE(VALUES(instance_is_admin), instance_is_admin),
        mentionable = COALESCE(VALUES(mentionable), mentionable),
        can_send_messages = COALESCE(VALUES(can_send_messages), can_send_messages),
        read_only_reason = CASE
          WHEN VALUES(can_send_messages) = 1 THEN NULL
          ELSE COALESCE(NULLIF(VALUES(read_only_reason), ''), read_only_reason)
        END,
        channel_role = COALESCE(NULLIF(VALUES(channel_role), ''), channel_role),
        directory_source = COALESCE(NULLIF(VALUES(directory_source), ''), directory_source),
        last_message_preview = CASE
          WHEN VALUES(last_message_at) IS NULL THEN COALESCE(last_message_preview, VALUES(last_message_preview))
          WHEN last_message_at IS NULL OR VALUES(last_message_at) >= last_message_at
            THEN COALESCE(VALUES(last_message_preview), last_message_preview)
          ELSE last_message_preview
        END,
        last_message_at = CASE
          WHEN VALUES(last_message_at) IS NULL THEN last_message_at
          WHEN last_message_at IS NULL OR VALUES(last_message_at) >= last_message_at THEN VALUES(last_message_at)
          ELSE last_message_at
        END,
        deleted_in_instance = CASE
          WHEN VALUES(last_message_at) IS NOT NULL
            AND (last_message_at IS NULL OR VALUES(last_message_at) >= last_message_at)
            THEN 0
          ELSE deleted_in_instance
        END,
        deleted_in_instance_at = CASE
          WHEN VALUES(last_message_at) IS NOT NULL
            AND (last_message_at IS NULL OR VALUES(last_message_at) >= last_message_at)
            THEN NULL
          ELSE deleted_in_instance_at
        END,
        deleted_in_instance_action = CASE
          WHEN VALUES(last_message_at) IS NOT NULL
            AND (last_message_at IS NULL OR VALUES(last_message_at) >= last_message_at)
            THEN NULL
          ELSE deleted_in_instance_action
        END,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      options.userId,
      options.instanceId,
      chatJid,
      storedChatType,
      options.title ?? null,
      phone,
      options.avatarUrl ?? null,
      options.groupDescription ?? null,
      options.participantsCount ?? null,
      options.linkedGroupId ?? null,
      options.inviteLink ?? null,
      options.announceOnly == null ? null : options.announceOnly ? 1 : 0,
      options.instanceIsAdmin == null ? null : options.instanceIsAdmin ? 1 : 0,
      options.mentionable == null ? null : options.mentionable ? 1 : 0,
      options.canSendMessages == null
        ? null
        : options.canSendMessages
          ? 1
          : 0,
      options.readOnlyReason ?? null,
      options.channelRole ?? null,
      options.directorySource ?? null,
      options.lastMessagePreview ?? null,
      options.lastMessageAt ?? null,
    ],
  );

  const [rows] = await db.query<ThreadRow[]>(
    "SELECT * FROM bot_whatsapp_conversations WHERE id = ? LIMIT 1",
    [Number(insert.insertId)],
  );

  return rows[0] ? mapThreadRow(rows[0]) : null;
};

export const recordWhatsappConversationMessage = async (options: {
  userId: number;
  instanceId: number;
  chatJid: string;
  messageId?: string | null;
  clientMessageId?: string | null;
  direction: WhatsappMessageDirection;
  senderJid?: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  messageType?: string | null;
  text?: string | null;
  media?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
  timestamp?: number | string | Date | null;
  title?: string | null;
  avatarUrl?: string | null;
}): Promise<{
  thread: WhatsappConversationThread;
  message: WhatsappConversationMessage;
  isNewMessage: boolean;
} | null> => {
  const chatJid = normalizeWhatsappChatJid(options.chatJid);
  if (!chatJid) return null;

  const timestamp = normalizeMessageTimestamp(options.timestamp);
  const text = options.text?.trim() || null;
  const messageType = resolveStoredWhatsappMessageType({
    explicitType:
      options.messageType?.trim() ||
      String(options.media?.mediaType ?? options.media?.type ?? "") ||
      (options.media ? "media" : "text"),
    media: options.media ?? null,
    text,
  });
  const preview = buildMessagePreview({
    text,
    media: options.media ?? null,
    messageType,
  });

  const thread = await upsertWhatsappConversation({
    userId: options.userId,
    instanceId: options.instanceId,
    chatJid,
    chatType: getWhatsappChatType(chatJid),
    title: options.title ?? null,
    avatarUrl: options.avatarUrl ?? null,
    lastMessagePreview: preview,
    lastMessageAt: timestamp,
  });
  if (!thread) return null;

  const db = getDb();
  const normalizedMessageId = options.messageId?.trim() || null;
  const clientMessageId = options.clientMessageId?.trim().slice(0, 96) || null;

  let existingMessageRecordId: number | null = null;
  let existingMedia: Record<string, unknown> | null = null;
  let existingRaw: Record<string, unknown> | null = null;
  let existingMessageType: string | null = null;
  if (normalizedMessageId) {
    const [existingRows] = await db.query<
      (RowDataPacket & {
        id: number;
        media_json: string | null;
        raw_json: string | null;
        message_type: string | null;
      })[]
    >(
      `
        SELECT id, media_json, raw_json, message_type
        FROM bot_whatsapp_messages
        WHERE user_id = ?
          AND instance_id = ?
          AND chat_jid = ?
          AND message_id = ?
        LIMIT 1
      `,
      [options.userId, options.instanceId, chatJid, normalizedMessageId],
    );
    existingMessageRecordId = existingRows[0]?.id
      ? Number(existingRows[0].id)
      : null;
    existingMedia = parseJson(existingRows[0]?.media_json ?? null);
    existingRaw = parseJson(existingRows[0]?.raw_json ?? null);
    existingMessageType = existingRows[0]?.message_type ?? null;
  }
  if (!existingMessageRecordId && clientMessageId) {
    const [existingRows] = await db.query<(RowDataPacket & {
      id: number;
      message_id: string | null;
      media_json: string | null;
      raw_json: string | null;
      message_type: string | null;
    })[]>(
      `SELECT id, message_id, media_json, raw_json, message_type
       FROM bot_whatsapp_messages
       WHERE user_id = ? AND instance_id = ? AND chat_jid = ? AND client_message_id = ?
       LIMIT 1`,
      [options.userId, options.instanceId, chatJid, clientMessageId],
    );
    existingMessageRecordId = existingRows[0]?.id ? Number(existingRows[0].id) : null;
    existingMedia = parseJson(existingRows[0]?.media_json ?? null);
    existingRaw = parseJson(existingRows[0]?.raw_json ?? null);
    existingMessageType = existingRows[0]?.message_type ?? null;
  }

  const mergedMedia = mergeStoredMessageJsonRecord(
    existingMedia,
    options.media ?? null,
  );
  const mergedRaw = mergeStoredMessageJsonRecord(
    existingRaw,
    options.raw ?? null,
  );
  const storedMessageType =
    existingMessageType &&
    /^(?:unknown|media)$/i.test(messageType) &&
    !/^(?:unknown|media)$/i.test(existingMessageType)
      ? existingMessageType
      : messageType;
  const rawJson = mergedRaw ? JSON.stringify(mergedRaw) : null;
  const mediaJson = mergedMedia ? JSON.stringify(mergedMedia) : null;

  const [insert] = await db.query<ResultSetHeader>(
    `
	      INSERT INTO bot_whatsapp_messages
	        (conversation_id, user_id, instance_id, chat_jid, message_id, client_message_id, direction, sender_jid, sender_name, sender_avatar_url, message_type, text, media_json, raw_json, timestamp)
	      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	      ON DUPLICATE KEY UPDATE
	        id = LAST_INSERT_ID(id),
	        message_id = COALESCE(VALUES(message_id), message_id),
	        client_message_id = COALESCE(VALUES(client_message_id), client_message_id),
	        text = COALESCE(VALUES(text), text),
	        media_json = COALESCE(VALUES(media_json), media_json),
	        raw_json = COALESCE(VALUES(raw_json), raw_json),
	        message_type = COALESCE(NULLIF(VALUES(message_type), ''), message_type),
	        sender_name = COALESCE(NULLIF(VALUES(sender_name), ''), sender_name),
	        sender_avatar_url = COALESCE(NULLIF(VALUES(sender_avatar_url), ''), sender_avatar_url),
	        timestamp = VALUES(timestamp)
	    `,
    [
      thread.id,
      options.userId,
      options.instanceId,
      chatJid,
      normalizedMessageId,
      clientMessageId,
      options.direction,
      options.senderJid || null,
      options.senderName || null,
      options.senderAvatarUrl || null,
      storedMessageType,
      text,
      mediaJson,
      rawJson,
      timestamp,
    ],
  );

  const selectedMessageId = Number(
    insert.insertId || existingMessageRecordId || 0,
  );
  const [rows] =
    selectedMessageId > 0
      ? await db.query<MessageRow[]>(
          "SELECT * FROM bot_whatsapp_messages WHERE id = ? LIMIT 1",
          [selectedMessageId],
        )
      : normalizedMessageId
        ? await db.query<MessageRow[]>(
            `
            SELECT *
            FROM bot_whatsapp_messages
            WHERE user_id = ?
              AND instance_id = ?
              AND chat_jid = ?
              AND message_id = ?
            LIMIT 1
          `,
            [options.userId, options.instanceId, chatJid, normalizedMessageId],
          )
        : await db.query<MessageRow[]>(
            `
            SELECT *
            FROM bot_whatsapp_messages
            WHERE conversation_id = ?
              AND user_id = ?
              AND instance_id = ?
              AND chat_jid = ?
            ORDER BY id DESC
            LIMIT 1
          `,
            [thread.id, options.userId, options.instanceId, chatJid],
          );
  if (!rows[0]) return null;

  const isNewMessage = normalizedMessageId
    ? existingMessageRecordId === null
    : Number(insert.affectedRows ?? 0) === 1;
  const isStatusThread = isWhatsappStatusChatJid(chatJid);
  const shouldIncrementUnread =
    isNewMessage && options.direction === "inbound" && !isStatusThread;
  const shouldResetUnread =
    isNewMessage && options.direction === "outbound" && !isStatusThread;
  const nextThread = shouldIncrementUnread
    ? { ...thread, unreadCount: thread.unreadCount + 1 }
    : shouldResetUnread
      ? { ...thread, unreadCount: 0 }
      : thread;

  if (shouldIncrementUnread) {
    await db.query(
      `
        UPDATE bot_whatsapp_conversations
        SET unread_count = unread_count + 1
        WHERE id = ?
      `,
      [thread.id],
    );
  } else if (shouldResetUnread && thread.unreadCount > 0) {
    await db.query(
      `
        UPDATE bot_whatsapp_conversations
        SET unread_count = 0
        WHERE id = ?
      `,
      [thread.id],
    );
  }

  const message = mapMessageRow(rows[0]);
  if (!isStatusThread) {
    try {
      const event = await recordWhatsappRealtimeEvent({
        userId: options.userId,
        instanceId: options.instanceId,
        chatJid,
        eventType: "conversation.message.upserted",
        messageId: message.messageId ?? String(message.id),
        payload: {
          thread: nextThread,
          message,
        },
      });
      if (event) {
        publishWhatsappRealtimeEvent(event);
      }
    } catch (error) {
      console.warn("[whatsapp-realtime] failed to publish conversation event", {
        userId: options.userId,
        instanceId: options.instanceId,
        chatJid,
        messageId: message.messageId,
        error,
      });
    }
  }

  if (shouldIncrementUnread && !isStatusThread) {
    void (async () => {
      const muted = await isWhatsappConversationNotificationsMutedForUser(
        options.userId,
        options.instanceId,
        chatJid,
      );
      if (muted) return;

      const pushTitle = getConversationPushTitle(nextThread, {
        senderName: options.senderName,
        senderJid: options.senderJid,
      });
      const pushBody = getConversationPushBody(nextThread, preview, {
        senderName: options.senderName,
      });
      const senderPhone = options.senderJid?.split("@")[0]?.replace(/\D+/g, "") || null;
      const pushAvatarUrl = conversationAvatarUrlForPush(nextThread);

      await sendPushNotificationToUser(options.userId, {
        title: pushTitle,
        body: pushBody,
        data: {
          type: "whatsapp_message",
          notificationId: message.messageId ?? String(message.id),
          notification_id: message.messageId ?? String(message.id),
          storebot_notification_id: `whatsapp-message-${options.instanceId}-${chatJid}`,
          instanceId: String(options.instanceId),
          instance_id: String(options.instanceId),
          chatJid,
          chat_jid: chatJid,
          chatTitle: nextThread.title,
          chat_title: nextThread.title,
          chatType: nextThread.chatType,
          chat_type: nextThread.chatType,
          avatarUrl: pushAvatarUrl,
          avatar_url: pushAvatarUrl,
          conversationId: String(nextThread.id),
          conversation_id: String(nextThread.id),
          messageId: message.messageId ?? String(message.id),
          message_id: message.messageId ?? String(message.id),
          senderName: options.senderName ?? null,
          sender_name: options.senderName ?? null,
          senderJid: options.senderJid ?? null,
          sender_jid: options.senderJid ?? null,
          senderPhone,
          sender_phone: senderPhone,
          messagePreview: preview,
          message_preview: preview,
          direction: options.direction,
          targetUrl: "/dashboard/user/conversas",
        },
        android: {
          channelId: ANDROID_REALTIME_MESSAGES_CHANNEL_ID,
        },
      });
    })().catch((error) => {
      console.warn("[whatsapp-push] failed to notify conversation message", {
        userId: options.userId,
        instanceId: options.instanceId,
        chatJid,
        messageId: message.messageId,
        error,
      });
    });
  }

  return { thread: nextThread, message, isNewMessage };
};

export const updateWhatsappMessageSenderAvatarForUser = async (
  userId: number,
  instanceId: number,
  senderJidRaw: string,
  avatarUrl: string | null | undefined,
): Promise<void> => {
  const senderJid = normalizeWhatsappChatJid(senderJidRaw);
  const normalizedAvatar =
    typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl.trim() : null;
  if (!senderJid || !normalizedAvatar) {
    return;
  }

  await ensureWhatsappConversationTables();
  const db = getDb();
  await db.query(
    `
      UPDATE bot_whatsapp_messages
      SET sender_avatar_url = ?
      WHERE user_id = ?
        AND instance_id = ?
        AND sender_jid = ?
        AND (sender_avatar_url IS NULL OR sender_avatar_url = '')
    `,
    [normalizedAvatar, userId, instanceId, senderJid],
  );

  if (getWhatsappChatType(senderJid) === "contact") {
    await upsertWhatsappConversation({
      userId,
      instanceId,
      chatJid: senderJid,
      chatType: "contact",
      phone: getWhatsappChatPhone(senderJid),
      avatarUrl: normalizedAvatar,
    });
  }
};

export type WhatsappCachedSenderIdentity = {
  senderJid: string;
  senderName: string | null;
  senderAvatarUrl: string | null;
};

const isUsefulWhatsappIdentityName = (
  value: string | null | undefined,
  senderJid: string,
): value is string => {
  const text = value?.trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  if (
    lowered === "null" ||
    lowered.includes("@s.whatsapp.net") ||
    lowered.includes("@c.us") ||
    lowered.includes("@g.us") ||
    lowered.includes("@newsletter")
  ) {
    return false;
  }

  const digits = text.replace(/\D+/g, "");
  const senderDigits = getWhatsappChatPhone(senderJid) ?? "";
  if (
    digits.length >= 8 &&
    senderDigits.length >= 8 &&
    (digits === senderDigits ||
      digits.endsWith(senderDigits) ||
      senderDigits.endsWith(digits))
  ) {
    return false;
  }

  return !/^\+?[\d\s().-]{8,}$/.test(text);
};

const mergeCachedSenderIdentity = (
  identities: Map<string, WhatsappCachedSenderIdentity>,
  senderJid: string,
  values: { senderName?: string | null; senderAvatarUrl?: string | null },
) => {
  const normalizedSenderJid = normalizeWhatsappChatJid(senderJid);
  if (!normalizedSenderJid || getWhatsappChatType(normalizedSenderJid) !== "contact") {
    return;
  }

  const current = identities.get(normalizedSenderJid) ?? {
    senderJid: normalizedSenderJid,
    senderName: null,
    senderAvatarUrl: null,
  };
  const nextName =
    current.senderName ??
    (isUsefulWhatsappIdentityName(values.senderName ?? null, normalizedSenderJid)
      ? values.senderName!.trim()
      : null);
  const nextAvatar =
    current.senderAvatarUrl ??
    (typeof values.senderAvatarUrl === "string" && values.senderAvatarUrl.trim()
      ? values.senderAvatarUrl.trim()
      : null);

  if (nextName || nextAvatar) {
    identities.set(normalizedSenderJid, {
      senderJid: normalizedSenderJid,
      senderName: nextName,
      senderAvatarUrl: nextAvatar,
    });
  }
};

export const listKnownWhatsappSenderIdentitiesForUser = async (
  userId: number,
  instanceId: number,
  senderJidsRaw: string[],
): Promise<Map<string, WhatsappCachedSenderIdentity>> => {
  await ensureWhatsappConversationTables();
  const senderJids = Array.from(
    new Set(
      senderJidsRaw
        .map((jid) => normalizeWhatsappChatJid(jid))
        .filter(
          (jid): jid is string =>
            Boolean(jid) && getWhatsappChatType(jid!) === "contact",
        ),
    ),
  ).slice(0, 250);

  const identities = new Map<string, WhatsappCachedSenderIdentity>();
  if (senderJids.length === 0) return identities;

  const db = getDb();
  const placeholders = senderJids.map(() => "?").join(", ");

  const [conversationRows] = await db.query<
    (RowDataPacket & {
      chat_jid: string;
      title: string | null;
      avatar_url: string | null;
    })[]
  >(
    `
      SELECT chat_jid, title, avatar_url
      FROM bot_whatsapp_conversations
      WHERE user_id = ?
        AND instance_id = ?
        AND chat_jid IN (${placeholders})
    `,
    [userId, instanceId, ...senderJids],
  );

  for (const row of conversationRows) {
    mergeCachedSenderIdentity(identities, row.chat_jid, {
      senderName: row.title,
      senderAvatarUrl: row.avatar_url,
    });
  }

  const [messageRows] = await db.query<
    (RowDataPacket & {
      sender_jid: string;
      sender_name: string | null;
      sender_avatar_url: string | null;
    })[]
  >(
    `
      SELECT sender_jid, sender_name, sender_avatar_url
      FROM bot_whatsapp_messages
      WHERE user_id = ?
        AND instance_id = ?
        AND sender_jid IN (${placeholders})
        AND (
          (sender_name IS NOT NULL AND sender_name <> '')
          OR (sender_avatar_url IS NOT NULL AND sender_avatar_url <> '')
        )
      ORDER BY timestamp DESC, id DESC
      LIMIT 1000
    `,
    [userId, instanceId, ...senderJids],
  );

  for (const row of messageRows) {
    mergeCachedSenderIdentity(identities, row.sender_jid, {
      senderName: row.sender_name,
      senderAvatarUrl: row.sender_avatar_url,
    });
    if (identities.size >= senderJids.length) {
      const allComplete = senderJids.every((jid) => {
        const identity = identities.get(jid);
        return Boolean(identity?.senderName && identity.senderAvatarUrl);
      });
      if (allComplete) break;
    }
  }

  return identities;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const firstRecord = (...values: unknown[]): Record<string, unknown> | null => {
  for (const value of values) {
    const record = toRecord(value);
    if (record) return record;
  }
  return null;
};

const collectRecords = (
  roots: unknown[],
  limit = 700,
): Record<string, unknown>[] => {
  const records: Record<string, unknown>[] = [];
  const stack = [...roots];
  const seen = new Set<unknown>();

  while (stack.length && records.length < limit) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const record = node as Record<string, unknown>;
    records.push(record);
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }

  return records;
};

const findNestedRecord = (
  records: Record<string, unknown>[],
  keys: string[],
): Record<string, unknown> | null => {
  const loweredKeys = keys.map((key) => key.toLowerCase());
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (loweredKeys.includes(key.toLowerCase())) {
        const nested = toRecord(value);
        if (nested) return nested;
      }
    }
  }
  return null;
};

const firstStringFromRecord = (
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
) => {
  if (!record) return null;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const lowered = key.toLowerCase();
    for (const [entryKey, value] of Object.entries(record)) {
      if (
        entryKey.toLowerCase() === lowered &&
        typeof value === "string" &&
        value.trim()
      ) {
        return value.trim();
      }
    }
  }
  return null;
};

const normalizeMediaByteString = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Buffer.isBuffer(value))
    return value.length > 0 ? value.toString("base64") : null;
  if (value instanceof Uint8Array)
    return value.length > 0 ? Buffer.from(value).toString("base64") : null;
  if (
    Array.isArray(value) &&
    value.every(
      (entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255,
    )
  ) {
    return value.length > 0
      ? Buffer.from(value as number[]).toString("base64")
      : null;
  }
  const record = toRecord(value);
  const data = record?.data ?? record?.Data;
  if (
    Array.isArray(data) &&
    data.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
  ) {
    return data.length > 0
      ? Buffer.from(data as number[]).toString("base64")
      : null;
  }
  return null;
};

const firstMediaByteStringFromRecord = (
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
) => {
  if (!record) return null;
  for (const key of keys) {
    const direct = normalizeMediaByteString(record[key]);
    if (direct) return direct;
    const lowered = key.toLowerCase();
    for (const [entryKey, value] of Object.entries(record)) {
      if (entryKey.toLowerCase() === lowered) {
        const normalized = normalizeMediaByteString(value);
        if (normalized) return normalized;
      }
    }
  }
  return null;
};

const firstNumberFromRecord = (
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
) => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (
      typeof value === "string" &&
      value.trim() &&
      Number.isFinite(Number(value))
    )
      return Number(value);
  }
  return null;
};

const parseVcardPhoneNumber = (vcard?: string | null): string | null => {
  if (!vcard) return null;
  const telLine = vcard
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(?:item\d+\.)?tel(?:[;:])/i.test(line));
  if (!telLine) return null;
  const raw = telLine.includes(":")
    ? telLine.slice(telLine.indexOf(":") + 1)
    : telLine;
  const normalized = raw.replace(/[^\d+]+/g, "");
  return normalized || null;
};

const contactEntryFromRecord = (
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
  if (!record) return null;
  const vcard = firstStringFromRecord(
    record,
    "vcard",
    "Vcard",
    "vCard",
    "VCARD",
  );
  const phoneNumber =
    firstStringFromRecord(
      record,
      "phoneNumber",
      "PhoneNumber",
      "phone",
      "Phone",
      "waId",
      "WaId",
      "jid",
      "Jid",
    ) ?? parseVcardPhoneNumber(vcard);
  const displayName =
    firstStringFromRecord(
      record,
      "displayName",
      "DisplayName",
      "name",
      "Name",
      "fullName",
      "FullName",
    ) ?? phoneNumber;

  if (!displayName && !phoneNumber && !vcard) return null;
  const contact: Record<string, unknown> = {
    displayName: displayName ?? "Contato",
    phoneNumber,
    vcard,
  };
  for (const key of Object.keys(contact)) {
    if (
      contact[key] === null ||
      contact[key] === undefined ||
      contact[key] === ""
    ) {
      delete contact[key];
    }
  }
  return contact;
};

const collectContactEntries = (
  contactNode: Record<string, unknown>,
): Record<string, unknown>[] => {
  const entries = new Map<string, Record<string, unknown>>();
  const add = (record: Record<string, unknown> | null) => {
    if (!record) return;
    const key = String(
      record.phoneNumber ?? record.vcard ?? record.displayName ?? "",
    ).toLowerCase();
    if (!key || entries.has(key)) return;
    entries.set(key, record);
  };

  add(contactEntryFromRecord(contactNode));
  const explicitCollections = [
    contactNode.contacts,
    contactNode.Contacts,
    contactNode.contact,
    contactNode.Contact,
    contactNode.items,
    contactNode.Items,
  ];
  for (const collection of explicitCollections) {
    if (Array.isArray(collection)) {
      for (const item of collection)
        add(contactEntryFromRecord(toRecord(item)));
    } else {
      add(contactEntryFromRecord(toRecord(collection)));
    }
  }
  for (const record of collectRecords([contactNode], 120)) {
    if (record === contactNode) continue;
    if (
      firstStringFromRecord(
        record,
        "vcard",
        "Vcard",
        "displayName",
        "DisplayName",
        "phoneNumber",
        "PhoneNumber",
      )
    ) {
      add(contactEntryFromRecord(record));
    }
  }
  return Array.from(entries.values());
};

const firstCopyCodeFromValue = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstCopyCodeFromValue(item);
      if (nested) return nested;
    }
    return null;
  }
  const record = toRecord(value);
  if (!record) return null;
  const direct = firstStringFromRecord(
    record,
    "copyCode",
    "copy_code",
    "clipboardText",
    "clipboard_text",
    "copyText",
    "copy_text",
  );
  if (direct) return direct;
  const pix = firstRecord(record.pix_static_code, record.pixStaticCode);
  if (pix) {
    const pixCode = firstStringFromRecord(
      pix,
      "key",
      "copyCode",
      "copy_code",
      "payload",
      "code",
    );
    if (pixCode) return pixCode;
  }
  for (const nested of Object.values(record)) {
    const result = firstCopyCodeFromValue(nested);
    if (result) return result;
  }
  return null;
};

const normalizePollOptions = (value: unknown): Record<string, unknown>[] => {
  let source: unknown = value;
  if (!Array.isArray(source)) {
    const record = toRecord(source) ?? {};
    source =
      record.options ??
      record.Options ??
      record.pollOptions ??
      record.PollOptions ??
      record.selectableOptions ??
      record.SelectableOptions ??
      record.values ??
      record.Values ??
      record.choices ??
      record.Choices;
  }
  if (!Array.isArray(source)) return [];
  const options: Record<string, unknown>[] = [];
  source.forEach((option, index) => {
    const record = toRecord(option);
    if (!record) {
      if (typeof option === "string" && option.trim()) {
        const title = option.trim();
        options.push({
          id: String(index + 1),
          title,
          name: title,
          votes: 0,
          voteCount: 0,
        });
      }
      return;
    }
    const title = firstStringFromRecord(
      record,
      "title",
      "Title",
      "name",
      "Name",
      "optionName",
      "OptionName",
      "text",
      "Text",
    );
    if (!title) return;
    const voters =
      record.voters ??
      record.Voters ??
      record.selectedVoters ??
      record.SelectedVoters;
    const voteCount =
      firstNumberFromRecord(
        record,
        "voteCount",
        "VoteCount",
        "votes",
        "Votes",
        "count",
        "Count",
      ) ?? (Array.isArray(voters) ? voters.length : 0);
    options.push({
      id:
        firstStringFromRecord(
          record,
          "id",
          "Id",
          "hash",
          "Hash",
          "optionHash",
          "OptionHash",
        ) ?? String(index + 1),
      title,
      name: title,
      voters: Array.isArray(voters) ? voters : undefined,
      votes: voteCount,
      voteCount,
      selected: record.selected === true || record.Selected === true,
    });
  });
  return options;
};

const normalizeStructuredEventMedia = (
  eventMedia: Record<string, unknown>,
  rawType: string,
  message: NormalizedMessage,
): Record<string, unknown> | null => {
  const type = rawType.replace(/message$/i, "").toLowerCase();
  if (type.includes("contact") || type.includes("vcard")) {
    const contacts = collectContactEntries(eventMedia);
    const firstContact = contacts[0] ?? contactEntryFromRecord(eventMedia);
    const displayName =
      firstStringFromRecord(
        firstContact,
        "displayName",
        "DisplayName",
        "name",
        "Name",
      ) ??
      firstStringFromRecord(
        eventMedia,
        "displayName",
        "DisplayName",
        "title",
        "Title",
        "name",
        "Name",
      ) ??
      "Contato";
    const phoneNumber =
      firstStringFromRecord(
        firstContact,
        "phoneNumber",
        "PhoneNumber",
        "phone",
        "Phone",
      ) ??
      parseVcardPhoneNumber(
        firstStringFromRecord(firstContact, "vcard", "Vcard"),
      );
    return {
      ...eventMedia,
      mediaType: "contact",
      kind: "contact",
      title: contacts.length > 1 ? `${contacts.length} contatos` : displayName,
      subtitle:
        phoneNumber ??
        (contacts.length > 1
          ? `${contacts.length} contatos compartilhados`
          : undefined),
      displayName,
      phoneNumber,
      vcard:
        firstStringFromRecord(firstContact, "vcard", "Vcard") ??
        firstStringFromRecord(eventMedia, "vcard", "Vcard"),
      contacts: contacts.length > 0 ? contacts : undefined,
      caption: firstString(
        message.text,
        message.caption,
        firstStringFromRecord(eventMedia, "caption", "Caption"),
      ),
    };
  }
  if (type.includes("location")) {
    const latitude = firstNumberFromRecord(
      eventMedia,
      "latitude",
      "degreesLatitude",
      "DegreesLatitude",
    );
    const longitude = firstNumberFromRecord(
      eventMedia,
      "longitude",
      "degreesLongitude",
      "DegreesLongitude",
    );
    const isLive =
      eventMedia.isLive === true ||
      eventMedia.liveLocation === true ||
      String(eventMedia.locationType ?? "").toLowerCase() === "live";
    const locationType = isLive ? "live" : "static";
    const mapUrl =
      firstStringFromRecord(eventMedia, "mapUrl", "MapUrl", "url", "URL") ??
      (latitude !== null && longitude !== null
        ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
        : null);
    return {
      ...eventMedia,
      mediaType: "location",
      kind: "location",
      locationType,
      isLive,
      liveLocation: isLive,
      title:
        firstStringFromRecord(
          eventMedia,
          "title",
          "Title",
          "name",
          "Name",
          "address",
          "Address",
        ) ?? (isLive ? "Localização ao vivo" : "Localização"),
      address: firstStringFromRecord(eventMedia, "address", "Address"),
      latitude,
      longitude,
      degreesLatitude: latitude,
      degreesLongitude: longitude,
      mapUrl,
      accuracyInMeters: firstNumberFromRecord(
        eventMedia,
        "accuracyInMeters",
        "AccuracyInMeters",
      ),
      speedInMps: firstNumberFromRecord(eventMedia, "speedInMps", "SpeedInMps"),
      headingDegrees: firstNumberFromRecord(
        eventMedia,
        "headingDegrees",
        "degreesClockwiseFromMagneticNorth",
        "DegreesClockwiseFromMagneticNorth",
      ),
      sequenceNumber: firstNumberFromRecord(
        eventMedia,
        "sequenceNumber",
        "SequenceNumber",
      ),
      timeOffset: firstNumberFromRecord(eventMedia, "timeOffset", "TimeOffset"),
      caption: firstString(
        message.text,
        message.caption,
        firstStringFromRecord(
          eventMedia,
          "caption",
          "Caption",
          "comment",
          "Comment",
        ),
      ),
    };
  }
  if (type.includes("poll")) {
    const options = normalizePollOptions(eventMedia);
    return {
      ...eventMedia,
      mediaType: "poll",
      kind: "poll",
      title:
        firstStringFromRecord(
          eventMedia,
          "title",
          "Title",
          "name",
          "Name",
          "question",
          "Question",
          "text",
          "Text",
          "body",
          "Body",
        ) ?? "Enquete",
      name: firstStringFromRecord(
        eventMedia,
        "name",
        "Name",
        "title",
        "Title",
        "question",
        "Question",
      ),
      options,
      selectableOptionsCount: firstNumberFromRecord(
        eventMedia,
        "selectableOptionsCount",
        "SelectableOptionsCount",
        "selectableCount",
        "SelectableCount",
      ),
      caption: firstString(message.text, message.caption),
    };
  }
  if (/(interactive|button|buttons|list|template)/.test(type)) {
    return {
      ...eventMedia,
      mediaType: type.includes("list")
        ? "list"
        : type.includes("button")
          ? "buttons"
          : type,
      kind: "interactive",
      caption: firstString(
        message.text,
        message.caption,
        firstStringFromRecord(eventMedia, "caption", "Caption"),
      ),
    };
  }
  return null;
};

type InteractiveCardDescriptor = Record<string, unknown> & {
  title: string | null;
  body: string | null;
  footer: string | null;
  buttonText: string | null;
  buttons: Record<string, unknown>[];
  sections: Record<string, unknown>[];
  lists: unknown[];
};

const buildWhatsappDirectUrl = (directPath: string | null) => {
  if (!directPath) return null;
  if (/^https?:\/\//i.test(directPath)) return directPath;
  return `https://mmg.whatsapp.net${directPath.startsWith("/") ? "" : "/"}${directPath}`;
};

const normalizeMediaDescriptorType = (value: string | null | undefined) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/message$/i, "");
  if (!normalized) return null;
  if (normalized === "picture") return "image";
  if (normalized === "ptt") return "audio";
  if (["image", "video", "audio", "document", "sticker"].includes(normalized))
    return normalized;
  return /(image|video|audio|document|sticker)/.test(normalized)
    ? normalized
    : null;
};

const hasDownloadableMediaMetadata = (
  record: Record<string, unknown> | null | undefined,
) =>
  Boolean(
    record &&
    (firstStringFromRecord(
      record,
      "directPath",
      "DirectPath",
      "direct_path",
      "directpath",
      "url",
      "URL",
      "Url",
      "mediaUrl",
      "MediaUrl",
    ) ||
      firstMediaByteStringFromRecord(
        record,
        "mediaKey",
        "MediaKey",
        "media_key",
      ) ||
      firstStringFromRecord(
        record,
        "data",
        "Data",
        "base64",
        "Base64",
        "media",
        "Media",
      )),
  );

const isProbablyBase64 = (value: string) =>
  value.length > 40 && /^[A-Za-z0-9+/=_-]+$/.test(value.replace(/\s+/g, ""));

const getThumbnailDataUrl = (
  record: Record<string, unknown> | null,
  fallbackMime: string,
) => {
  const thumbnail = firstStringFromRecord(
    record,
    "JPEGThumbnail",
    "jpegThumbnail",
    "PNGThumbnail",
    "pngThumbnail",
    "thumbnail",
    "Thumbnail",
    "thumb",
  );
  if (!thumbnail) return null;
  if (/^data:/i.test(thumbnail)) return thumbnail;
  if (!isProbablyBase64(thumbnail)) return null;
  const mimeType =
    firstStringFromRecord(
      record,
      "mimetype",
      "Mimetype",
      "mimeType",
      "MimeType",
    ) ?? fallbackMime;
  return `data:${mimeType};base64,${thumbnail.replace(/\s+/g, "")}`;
};

const localizeWhatsappInteractiveText = (value: string | null | undefined) => {
  const text = value?.trim() ?? "";
  switch (text.toUpperCase()) {
    case "__LOCALIZE:FLOWS_COMPLETE_FORM_BUTTON_TITLE":
    case "FLOWS_COMPLETE_FORM_BUTTON_TITLE":
      return "Preencher formulário";
    case "__LOCALIZE:FLOWS_SUBMIT_BUTTON_TITLE":
    case "FLOWS_SUBMIT_BUTTON_TITLE":
      return "Enviar";
    default:
      return text;
  }
};

const collectButtonItems = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = toRecord(entry);
      const buttonText = firstRecord(record?.buttonText, record?.ButtonText);
      const nativeParams = firstStringFromRecord(
        record,
        "buttonParamsJson",
        "ButtonParamsJson",
      );
      let parsedParams: Record<string, unknown> | null = null;
      if (nativeParams) {
        try {
          parsedParams = JSON.parse(nativeParams);
        } catch {
          parsedParams = null;
        }
      }
      const paramsTitle = firstStringFromRecord(
        parsedParams,
        "display_text",
        "title",
        "text",
        "name",
        "flow_cta",
        "flowCta",
      );
      const paramsId = firstStringFromRecord(
        parsedParams,
        "id",
        "row_id",
        "button_id",
      );
      const copyCode =
        firstStringFromRecord(
          record,
          "copyCode",
          "copy_code",
          "clipboardText",
          "clipboard_text",
        ) ??
        firstCopyCodeFromValue(parsedParams) ??
        firstCopyCodeFromValue(record);
      const rawButtonType = firstStringFromRecord(
        record,
        "type",
        "Type",
        "buttonType",
        "button_type",
      );
      const normalizedButtonType = (rawButtonType ?? "")
        .trim()
        .toLowerCase()
        .replace(/[- ]/g, "_");
      const isCtaButton = new Set([
        "cta_url",
        "url",
        "link",
        "cta_copy",
        "copy",
        "copy_code",
        "phone",
        "call",
      ]).has(normalizedButtonType);
      const isReplyButton = !isCtaButton;
      const flowId = firstStringFromRecord(parsedParams, "flow_id", "flowId");
      const isFlowButton =
        Boolean(flowId) ||
        normalizedButtonType === "galaxy_message" ||
        parsedParams?.form_type === "template";
      const buttonType = isFlowButton
        ? "flow"
        : isReplyButton
          ? "reply"
          : rawButtonType;
      const directUrl =
        firstStringFromRecord(record, "url", "URL", "href") ??
        firstStringFromRecord(parsedParams, "url", "URL", "href");
      const looseUrl =
        firstStringFromRecord(record, "link", "merchant_url", "merchantUrl") ??
        firstStringFromRecord(
          parsedParams,
          "link",
          "merchant_url",
          "merchantUrl",
        );
      const url = isReplyButton
        ? null
        : directUrl ??
          (looseUrl && /^https?:\/\//i.test(looseUrl) ? looseUrl : null);
      const rawTitle =
        firstStringFromRecord(
          buttonText,
          "displayText",
          "DisplayText",
          "text",
          "Text",
        ) ??
        firstStringFromRecord(
          record,
          "displayText",
          "DisplayText",
          "title",
          "Title",
          "text",
          "Text",
          "label",
          "Label",
        ) ??
        paramsTitle ??
        (copyCode ? "Copiar chave Pix" : null) ??
        "Botão";
      const title = localizeWhatsappInteractiveText(rawTitle);
      const flowActionPayload = firstRecord(
        parsedParams?.flow_action_payload,
        parsedParams?.flowActionPayload,
      );
      const flowData = firstRecord(
        flowActionPayload?.data,
        flowActionPayload?.Data,
      );
      return record
        ? ({
            id:
              firstStringFromRecord(
                record,
                "buttonId",
                "ButtonId",
                "id",
                "Id",
                "payload",
                "rowId",
                "RowId",
              ) ?? paramsId,
            title,
            description: firstStringFromRecord(
              record,
              "description",
              "Description",
              "subtitle",
              "Subtitle",
            ),
            type: buttonType,
            copyCode,
            clipboardText: copyCode,
            url,
            params: parsedParams ?? undefined,
            isFlow: isFlowButton || undefined,
            flow: isFlowButton
              ? {
                  id: flowId,
                  flowId,
                  token: firstStringFromRecord(
                    parsedParams,
                    "flow_token",
                    "flowToken",
                  ),
                  action: firstStringFromRecord(
                    parsedParams,
                    "flow_action",
                    "flowAction",
                  ),
                  screen: firstStringFromRecord(
                    flowActionPayload,
                    "screen",
                    "Screen",
                  ),
                  formType: firstStringFromRecord(
                    parsedParams,
                    "form_type",
                    "formType",
                  ),
                  messageVersion: firstStringFromRecord(
                    parsedParams,
                    "flow_message_version",
                    "flowMessageVersion",
                  ),
                  cta: title,
                  data: flowData ?? undefined,
                  actionPayload: flowActionPayload ?? undefined,
                }
              : undefined,
          } as Record<string, unknown>)
        : null;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
};

const collectListSections = (
  value: unknown,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((section) => {
      const record = toRecord(section);
      if (!record) return null;
      const rowsValue = record.rows ?? record.Rows;
      const rows = Array.isArray(rowsValue)
        ? rowsValue
            .map((row) => {
              const rowRecord = toRecord(row);
              if (!rowRecord) return null;
              return {
                id: firstStringFromRecord(
                  rowRecord,
                  "rowId",
                  "RowId",
                  "id",
                  "Id",
                ),
                title:
                  firstStringFromRecord(
                    rowRecord,
                    "title",
                    "Title",
                    "name",
                    "Name",
                  ) ?? "Item",
                description: firstStringFromRecord(
                  rowRecord,
                  "description",
                  "Description",
                ),
              } as Record<string, unknown>;
            })
            .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        : [];
      return {
        title: firstStringFromRecord(record, "title", "Title") ?? "Opções",
        rows,
      } as Record<string, unknown>;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
};

const buildMediaDescriptor = (
  node: Record<string, unknown>,
  mediaType: string,
  message: NormalizedMessage,
  fallbackMime: string,
) => {
  const directPath = firstStringFromRecord(
    node,
    "directPath",
    "DirectPath",
    "direct_path",
    "directpath",
  );
  const url =
    firstStringFromRecord(
      node,
      "url",
      "URL",
      "Url",
      "mediaUrl",
      "MediaUrl",
      "mediaURL",
      "sourceUrl",
      "SourceUrl",
      "link",
      "Link",
    ) ?? buildWhatsappDirectUrl(directPath);
  const mimeType =
    firstStringFromRecord(
      node,
      "mimetype",
      "Mimetype",
      "mimeType",
      "MimeType",
      "mime_type",
      "contentType",
      "ContentType",
    ) ?? fallbackMime;
  const filename = firstStringFromRecord(
    node,
    "fileName",
    "FileName",
    "filename",
    "Filename",
    "name",
    "Name",
  );
  const caption = firstString(
    message.caption,
    firstStringFromRecord(
      node,
      "caption",
      "Caption",
      "text",
      "Text",
      "body",
      "Body",
    ),
  );
  const thumbnail = getThumbnailDataUrl(
    node,
    mediaType === "sticker" ? "image/webp" : "image/jpeg",
  );
  const data = firstStringFromRecord(
    node,
    "data",
    "Data",
    "base64",
    "Base64",
    "media",
    "Media",
  );
  const dataUrl =
    data && (/^data:/i.test(data) || isProbablyBase64(data))
      ? /^data:/i.test(data)
        ? data
        : `data:${mimeType};base64,${data.replace(/\s+/g, "")}`
      : null;

  const descriptor: Record<string, unknown> = {
    mediaType,
    kind: mediaType,
    url,
    mediaId: firstStringFromRecord(node, "id", "Id", "mediaId", "MediaId"),
    directPath,
    mimeType,
    filename,
    caption,
    dataUrl: dataUrl ?? null,
    thumbnailUrl: thumbnail,
    mediaKey: firstMediaByteStringFromRecord(
      node,
      "mediaKey",
      "MediaKey",
      "media_key",
    ),
    fileEncSHA256: firstMediaByteStringFromRecord(
      node,
      "fileEncSHA256",
      "FileEncSHA256",
      "fileEncSha256",
      "FileEncSha256",
      "file_enc_sha256",
    ),
    fileSHA256: firstMediaByteStringFromRecord(
      node,
      "fileSHA256",
      "FileSHA256",
      "fileSha256",
      "FileSha256",
      "file_sha256",
    ),
    fileLength: firstNumberFromRecord(
      node,
      "fileLength",
      "FileLength",
      "file_length",
      "size",
      "Size",
    ),
    seconds: firstNumberFromRecord(
      node,
      "seconds",
      "Seconds",
      "duration",
      "Duration",
    ),
    isAnimated: Boolean(node.isAnimated ?? node.IsAnimated),
  };

  for (const key of Object.keys(descriptor)) {
    if (
      descriptor[key] === null ||
      descriptor[key] === undefined ||
      descriptor[key] === ""
    ) {
      delete descriptor[key];
    }
  }

  return descriptor;
};

const describeQuotedMessageNode = (
  node: Record<string, unknown> | null,
): string | null => {
  if (!node) return null;
  const text = firstStringFromRecord(
    node,
    "conversation",
    "text",
    "Text",
    "caption",
    "Caption",
    "body",
    "Body",
    "selectedDisplayText",
    "SelectedDisplayText",
    "title",
    "Title",
    "name",
    "Name",
  );
  if (text) return text;

  const mediaDescriptors: Array<[string[], string]> = [
    [["stickerMessage", "StickerMessage", "sticker"], "Figurinha"],
    [["imageMessage", "ImageMessage", "image"], "Imagem"],
    [["videoMessage", "VideoMessage", "video", "ptvMessage"], "Video"],
    [["audioMessage", "AudioMessage", "audio"], "Audio"],
    [["documentMessage", "DocumentMessage", "document"], "Documento"],
    [["contactMessage", "ContactMessage", "contactsArrayMessage"], "Contato"],
    [
      ["locationMessage", "LocationMessage", "liveLocationMessage"],
      "Localizacao",
    ],
    [
      ["pollCreationMessage", "pollCreationMessageV2", "pollCreationMessageV3"],
      "Enquete",
    ],
  ];
  const records = collectRecords([node], 220);
  for (const [keys, label] of mediaDescriptors) {
    if (findNestedRecord(records, keys)) return label;
  }
  return null;
};

const extractQuotedDescriptor = (
  raw: Record<string, unknown> | null,
  media: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  if (!raw && !media) return null;
  const roots = [
    media?.quoted,
    media?.reply,
    media?.contextInfo,
    raw?.quoted,
    raw?.reply,
    raw?.contextInfo,
    raw?.ContextInfo,
    raw?.message,
    toRecord(raw?.message)?.extendedTextMessage,
    toRecord(raw?.message)?.imageMessage,
    toRecord(raw?.message)?.videoMessage,
    toRecord(raw?.message)?.stickerMessage,
    toRecord(raw?.message)?.documentMessage,
    raw?.RawMessage,
    toRecord(raw?.RawMessage)?.message,
    raw?.Message,
    toRecord(raw?.Message)?.message,
  ];
  const records = collectRecords(roots, 260);
  const contextInfo =
    records.find(
      (record) =>
        firstStringFromRecord(
          record,
          "stanzaId",
          "quotedMessageId",
          "quotedStanzaId",
          "participant",
        ) ||
        toRecord(record.quotedMessage) ||
        toRecord(record.QuotedMessage),
    ) ?? null;
  const directQuoted = firstRecord(
    media?.quoted,
    media?.reply,
    raw?.quoted,
    raw?.reply,
  );
  const quotedMessage = firstRecord(
    directQuoted?.quotedMessage,
    directQuoted?.message,
    contextInfo?.quotedMessage,
    contextInfo?.QuotedMessage,
    contextInfo?.message,
  );
  const stanzaId =
    firstStringFromRecord(
      directQuoted,
      "stanzaId",
      "id",
      "messageId",
      "quotedMessageId",
    ) ??
    firstStringFromRecord(
      contextInfo,
      "stanzaId",
      "quotedMessageId",
      "quotedStanzaId",
    );
  const participant =
    firstStringFromRecord(
      directQuoted,
      "participant",
      "senderJid",
      "remoteJid",
    ) ??
    firstStringFromRecord(
      contextInfo,
      "participant",
      "participantJid",
      "remoteJid",
    );
  const title =
    firstStringFromRecord(
      directQuoted,
      "title",
      "senderName",
      "name",
      "pushName",
    ) ??
    firstStringFromRecord(
      contextInfo,
      "participantName",
      "senderName",
      "pushName",
      "name",
    ) ??
    participant;
  const text =
    firstStringFromRecord(directQuoted, "text", "caption", "body", "preview") ??
    describeQuotedMessageNode(quotedMessage);
  if (!stanzaId && !participant && !title && !text) return null;
  const descriptor: Record<string, unknown> = {
    stanzaId,
    participant,
    title,
    text,
    messageType: quotedMessage
      ? (firstStringFromRecord(
          quotedMessage,
          "messageType",
          "type",
          "mediaType",
        ) ?? describeQuotedMessageNode(quotedMessage))
      : undefined,
  };
  for (const key of Object.keys(descriptor)) {
    if (
      descriptor[key] === null ||
      descriptor[key] === undefined ||
      descriptor[key] === ""
    ) {
      delete descriptor[key];
    }
  }
  return Object.keys(descriptor).length > 0 ? descriptor : null;
};

const enrichStoredQuotedMedia = (
  media: Record<string, unknown> | null,
  raw: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  const quoted = extractQuotedDescriptor(raw, media);
  if (!quoted) return media;
  return {
    ...(media ?? {}),
    quoted: {
      ...(toRecord(media?.quoted) ?? {}),
      ...quoted,
    },
  };
};

const interactiveMediaFallbackMime = (mediaType: string) => {
  if (mediaType === "image") return "image/jpeg";
  if (mediaType === "video") return "video/mp4";
  if (mediaType === "document") return "application/octet-stream";
  return "application/octet-stream";
};

const normalizeInteractiveMediaType = (
  value: unknown,
): "image" | "video" | "document" | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "image" || normalized === "picture") return "image";
  if (normalized === "video") return "video";
  if (normalized === "document" || normalized === "file") return "document";
  return null;
};

const buildInteractiveHeaderMediaDescriptor = (
  candidates: Array<unknown>,
  message: NormalizedMessage,
): Record<string, unknown> | null => {
  for (const candidate of candidates) {
    const record = toRecord(candidate);
    if (!record) continue;
    const explicitType = normalizeInteractiveMediaType(
      firstStringFromRecord(
        record,
        "type",
        "Type",
        "mediaType",
        "MediaType",
        "kind",
        "Kind",
      ),
    );
    const mediaType =
      explicitType ??
      (firstRecord(record.image, record.Image) ? "image" : null) ??
      (firstRecord(record.video, record.Video) ? "video" : null) ??
      (firstRecord(record.document, record.Document) ? "document" : null);
    if (!mediaType) continue;

    const mediaNode =
      firstRecord(
        record[mediaType],
        record[mediaType[0].toUpperCase() + mediaType.slice(1)],
        record.media,
        record.Media,
      ) ?? record;
    const descriptor = buildMediaDescriptor(
      mediaNode,
      mediaType,
      message,
      interactiveMediaFallbackMime(mediaType),
    );

    const hasRenderableMedia =
      descriptor.url ||
      descriptor.dataUrl ||
      descriptor.sourceUrl ||
      descriptor.directPath ||
      descriptor.mediaKey ||
      descriptor.mediaId ||
      descriptor.thumbnailUrl;
    if (hasRenderableMedia) {
      return descriptor;
    }
  }
  return null;
};

const buildInteractiveHeaderDescriptor = (
  normalizedInteractive: Record<string, unknown>,
  requestRecord: Record<string, unknown> | null,
  message: NormalizedMessage,
) => {
  const headerRecord = firstRecord(
    normalizedInteractive.header,
    normalizedInteractive.Header,
  );
  const headerText =
    firstStringFromRecord(headerRecord, "title", "Title", "text", "Text") ??
    firstStringFromRecord(normalizedInteractive, "headerText", "HeaderText");
  const media = buildInteractiveHeaderMediaDescriptor(
    [
      headerRecord,
      normalizedInteractive.headerMedia,
      normalizedInteractive.HeaderMedia,
      normalizedInteractive.media,
      normalizedInteractive.Media,
      requestRecord?.HeaderMedia,
      requestRecord?.headerMedia,
      requestRecord?.media,
      requestRecord?.Media,
    ],
    message,
  );

  const header: Record<string, unknown> | null = headerRecord
    ? {
        type:
          firstStringFromRecord(headerRecord, "type", "Type") ??
          (media ? media.mediaType : "text"),
        text: headerText,
      }
    : headerText || media
      ? {
          type: media ? media.mediaType : "text",
          text: headerText,
        }
      : null;

  return { header, headerMedia: media };
};

const buildInteractiveDescriptor = (
  records: Record<string, unknown>[],
  message: NormalizedMessage,
): Record<string, unknown> | null => {
  const rawRecord = toRecord(message.raw);
  const requestRecord = firstRecord(rawRecord?.request, rawRecord?.Request);
  const requestListMessage = firstRecord(
    requestRecord?.listMessage,
    requestRecord?.ListMessage,
  );
  const requestInteractive = firstRecord(
    requestRecord?.interactive,
    requestRecord?.Interactive,
  );
  const normalizedInteractive = firstRecord(
    message.raw?.message && toRecord(message.raw.message)?.interactive,
    message.raw?.eventMessage &&
      toRecord(message.raw.eventMessage)?.interactive,
    message.raw?.media,
    message.raw?.Media,
    requestInteractive,
    requestListMessage,
    requestRecord,
  );
  if (normalizedInteractive) {
    const { header, headerMedia } = buildInteractiveHeaderDescriptor(
      normalizedInteractive,
      requestRecord,
      message,
    );
    const sections = [
      ...collectListSections(
        normalizedInteractive.sections ?? normalizedInteractive.Sections,
      ),
      ...collectListSections(
        normalizedInteractive.rows ?? normalizedInteractive.Rows,
      ),
    ];
    const lists = Array.isArray(
      normalizedInteractive.lists ?? normalizedInteractive.Lists,
    )
      ? ((normalizedInteractive.lists ??
          normalizedInteractive.Lists) as unknown[])
      : [];
    for (const list of lists) {
      const listRecord = toRecord(list);
      if (!listRecord) continue;
      sections.push(
        ...collectListSections(listRecord.sections ?? listRecord.Sections),
      );
    }
    const cards = Array.isArray(
      normalizedInteractive.cards ?? normalizedInteractive.Cards,
    )
      ? ((normalizedInteractive.cards ??
          normalizedInteractive.Cards) as unknown[])
      : [];
    const normalizedCards: InteractiveCardDescriptor[] = cards
      .map((card): InteractiveCardDescriptor | null => {
        const cardRecord = toRecord(card);
        if (!cardRecord) return null;
        const cardSections = [
          ...collectListSections(cardRecord.sections ?? cardRecord.Sections),
        ];
        const cardLists = Array.isArray(cardRecord.lists ?? cardRecord.Lists)
          ? ((cardRecord.lists ?? cardRecord.Lists) as unknown[])
          : [];
        for (const list of cardLists) {
          const listRecord = toRecord(list);
          if (!listRecord) continue;
          cardSections.push(
            ...collectListSections(listRecord.sections ?? listRecord.Sections),
          );
        }
        return {
          title: firstStringFromRecord(cardRecord, "title", "Title"),
          body: firstStringFromRecord(
            cardRecord,
            "body",
            "Body",
            "description",
            "Description",
            "text",
            "Text",
            "caption",
            "Caption",
          ),
          footer: firstStringFromRecord(
            cardRecord,
            "footer",
            "Footer",
            "footerText",
            "FooterText",
          ),
          buttonText: firstStringFromRecord(
            cardRecord,
            "buttonText",
            "ButtonText",
          ),
          buttons: collectButtonItems(cardRecord.buttons ?? cardRecord.Buttons),
          sections: cardSections,
          lists: cardLists,
        };
      })
      .filter((entry): entry is InteractiveCardDescriptor => Boolean(entry));
    for (const card of normalizedCards) {
      sections.push(...collectListSections(card.sections));
    }
    const buttons = collectButtonItems(
      normalizedInteractive.buttons ?? normalizedInteractive.Buttons,
    );
    const hasLists =
      sections.length > 0 ||
      lists.length > 0 ||
      normalizedCards.some(
        (card) => Array.isArray(card.sections) && card.sections.length > 0,
      );
    return {
      mediaType: hasLists
        ? "list"
        : buttons.length > 0
          ? "buttons"
          : "interactive",
      kind: "interactive",
      type: firstStringFromRecord(normalizedInteractive, "type", "Type"),
      header,
      headerMedia,
      title:
        firstStringFromRecord(normalizedInteractive, "title", "Title") ??
        firstStringFromRecord(
          firstRecord(
            normalizedInteractive.header,
            normalizedInteractive.Header,
          ),
          "title",
          "Title",
          "text",
          "Text",
        ),
      body:
        firstStringFromRecord(
          normalizedInteractive,
          "body",
          "Body",
          "description",
          "Description",
          "text",
          "Text",
        ) ?? firstString(message.text, message.caption),
      footer: firstStringFromRecord(
        normalizedInteractive,
        "footer",
        "Footer",
        "footerText",
        "FooterText",
      ),
      buttonText: firstStringFromRecord(
        normalizedInteractive,
        "buttonText",
        "ButtonText",
      ),
      buttons,
      sections,
      cards: normalizedCards,
      caption: firstString(message.text, message.caption),
    };
  }

  const listNode = findNestedRecord(records, [
    "listMessage",
    "ListMessage",
    "list",
  ]);
  if (listNode) {
    return {
      mediaType: "list",
      kind: "interactive",
      title: firstStringFromRecord(listNode, "title", "Title"),
      body: firstStringFromRecord(
        listNode,
        "description",
        "Description",
        "text",
        "Text",
        "body",
        "Body",
      ),
      footer: firstStringFromRecord(
        listNode,
        "footerText",
        "FooterText",
        "footer",
        "Footer",
      ),
      buttonText: firstStringFromRecord(listNode, "buttonText", "ButtonText"),
      sections: collectListSections(listNode.sections ?? listNode.Sections),
      caption: firstString(message.text, message.caption),
    };
  }

  const buttonsNode = findNestedRecord(records, [
    "buttonsMessage",
    "ButtonsMessage",
  ]);
  if (buttonsNode) {
    return {
      mediaType: "buttons",
      kind: "interactive",
      title: firstStringFromRecord(
        buttonsNode,
        "title",
        "Title",
        "header",
        "Header",
      ),
      body: firstStringFromRecord(
        buttonsNode,
        "contentText",
        "ContentText",
        "body",
        "Body",
        "text",
        "Text",
      ),
      footer: firstStringFromRecord(
        buttonsNode,
        "footerText",
        "FooterText",
        "footer",
        "Footer",
      ),
      buttons: collectButtonItems(buttonsNode.buttons ?? buttonsNode.Buttons),
      caption: firstString(message.text, message.caption),
    };
  }

  const interactiveNode = findNestedRecord(records, [
    "interactiveMessage",
    "InteractiveMessage",
  ]);
  if (interactiveNode) {
    const bodyRecord = firstRecord(interactiveNode.body, interactiveNode.Body);
    const footerRecord = firstRecord(
      interactiveNode.footer,
      interactiveNode.Footer,
    );
    const headerRecord = firstRecord(
      interactiveNode.header,
      interactiveNode.Header,
    );
    const nativeFlow = firstRecord(
      interactiveNode.nativeFlowMessage,
      interactiveNode.NativeFlowMessage,
    );
    return {
      mediaType: "interactive",
      kind: "interactive",
      title: firstStringFromRecord(
        headerRecord,
        "title",
        "Title",
        "text",
        "Text",
      ),
      body:
        firstStringFromRecord(bodyRecord, "text", "Text") ??
        firstString(message.text, message.caption),
      footer: firstStringFromRecord(footerRecord, "text", "Text"),
      buttons: collectButtonItems(nativeFlow?.buttons ?? nativeFlow?.Buttons),
      caption: firstString(message.text, message.caption),
    };
  }

  const templateNode = findNestedRecord(records, [
    "templateMessage",
    "TemplateMessage",
  ]);
  const hydratedTemplate = firstRecord(
    templateNode?.hydratedTemplate,
    templateNode?.HydratedTemplate,
  );
  if (templateNode || hydratedTemplate) {
    const node = hydratedTemplate ?? templateNode!;
    return {
      mediaType: "template",
      kind: "interactive",
      title: firstStringFromRecord(node, "title", "Title"),
      body: firstStringFromRecord(
        node,
        "hydratedContentText",
        "contentText",
        "body",
        "Body",
        "text",
        "Text",
      ),
      footer: firstStringFromRecord(
        node,
        "hydratedFooterText",
        "footerText",
        "FooterText",
        "footer",
        "Footer",
      ),
      buttons: collectButtonItems(
        node.hydratedButtons ??
          node.HydratedButtons ??
          node.buttons ??
          node.Buttons,
      ),
      caption: firstString(message.text, message.caption),
    };
  }

  const buttonResponse = findNestedRecord(records, [
    "buttonsResponseMessage",
    "ButtonsResponseMessage",
    "templateButtonReplyMessage",
  ]);
  if (buttonResponse || message.buttonResponse) {
    return {
      mediaType: "button_response",
      kind: "interactive_response",
      title:
        firstStringFromRecord(
          buttonResponse,
          "selectedDisplayText",
          "SelectedDisplayText",
          "displayText",
          "DisplayText",
          "text",
          "Text",
        ) ??
        message.buttonResponse?.text ??
        "Resposta de botão",
      selectedId:
        firstStringFromRecord(
          buttonResponse,
          "selectedButtonId",
          "SelectedButtonId",
          "id",
          "Id",
        ) ?? message.buttonResponse?.id,
      caption: firstString(message.text, message.caption),
    };
  }

  const listResponse = findNestedRecord(records, [
    "listResponseMessage",
    "ListResponseMessage",
  ]);
  if (listResponse) {
    const row = firstRecord(
      listResponse.singleSelectReply,
      listResponse.SingleSelectReply,
    );
    return {
      mediaType: "list_response",
      kind: "interactive_response",
      title:
        firstStringFromRecord(
          listResponse,
          "title",
          "Title",
          "description",
          "Description",
        ) ??
        firstStringFromRecord(row, "selectedRowId", "SelectedRowId") ??
        "Resposta de lista",
      selectedId: firstStringFromRecord(
        row,
        "selectedRowId",
        "SelectedRowId",
        "id",
        "Id",
      ),
      caption: firstString(message.text, message.caption),
    };
  }

  const contactNode = findNestedRecord(records, [
    "contactMessage",
    "ContactMessage",
    "contactsArrayMessage",
    "ContactsArrayMessage",
  ]);
  if (contactNode) {
    const contacts = collectContactEntries(contactNode);
    const firstContact = contacts[0] ?? contactEntryFromRecord(contactNode);
    const displayName =
      firstStringFromRecord(
        firstContact,
        "displayName",
        "DisplayName",
        "name",
        "Name",
      ) ??
      firstStringFromRecord(
        contactNode,
        "displayName",
        "DisplayName",
        "name",
        "Name",
      );
    const phoneNumber =
      firstStringFromRecord(
        firstContact,
        "phoneNumber",
        "PhoneNumber",
        "phone",
        "Phone",
      ) ??
      parseVcardPhoneNumber(
        firstStringFromRecord(firstContact, "vcard", "Vcard"),
      );
    return {
      mediaType: "contact",
      kind: "contact",
      title:
        contacts.length > 1
          ? `${contacts.length} contatos`
          : (displayName ?? "Contato"),
      subtitle:
        phoneNumber ??
        (contacts.length > 1
          ? `${contacts.length} contatos compartilhados`
          : undefined),
      displayName: displayName ?? undefined,
      phoneNumber: phoneNumber ?? undefined,
      vcard: firstStringFromRecord(firstContact, "vcard", "Vcard"),
      contacts,
      caption: firstString(message.text, message.caption),
    };
  }

  const locationNode = findNestedRecord(records, [
    "locationMessage",
    "LocationMessage",
    "liveLocationMessage",
  ]);
  if (locationNode) {
    return {
      mediaType: "location",
      kind: "location",
      title:
        firstStringFromRecord(
          locationNode,
          "name",
          "Name",
          "address",
          "Address",
        ) ?? "Localização",
      latitude: firstNumberFromRecord(
        locationNode,
        "degreesLatitude",
        "DegreesLatitude",
        "latitude",
        "Latitude",
      ),
      longitude: firstNumberFromRecord(
        locationNode,
        "degreesLongitude",
        "DegreesLongitude",
        "longitude",
        "Longitude",
      ),
      caption: firstString(message.text, message.caption),
    };
  }

  return null;
};

const enrichStoredInteractiveMedia = (
  media: Record<string, unknown> | null,
  raw: Record<string, unknown> | null,
  messageType: string,
  text: string | null,
): Record<string, unknown> | null => {
  if (!raw || media?.headerMedia) return media;
  const type = String(
    media?.kind ?? media?.mediaType ?? media?.type ?? messageType,
  ).toLowerCase();
  if (!/(interactive|button|list|template)/.test(type)) return media;

  const roots = [
    raw,
    raw.eventMedia,
    raw.Media,
    raw.media,
    raw.RawMessage,
    toRecord(raw.RawMessage)?.message,
    raw.Message,
    toRecord(raw.Message)?.message,
    raw.message,
    toRecord(raw.message)?.message,
    raw.request,
    toRecord(raw.request)?.listMessage,
    toRecord(raw.request)?.interactive,
  ];
  const rebuilt = buildInteractiveDescriptor(collectRecords(roots), {
    id: null,
    chatId: null,
    senderJid: null,
    fromMe: false,
    text,
    caption: firstString(media?.caption),
    messageType,
    participant: null,
    links: [],
    raw,
  } as NormalizedMessage);
  if (!rebuilt) return media;
  return {
    ...rebuilt,
    ...(media ?? {}),
    header: media?.header ?? rebuilt.header,
    headerMedia: media?.headerMedia ?? rebuilt.headerMedia,
    buttons:
      Array.isArray(media?.buttons) && media.buttons.length > 0
        ? media?.buttons
        : rebuilt.buttons,
    sections:
      Array.isArray(media?.sections) && media.sections.length > 0
        ? media?.sections
        : rebuilt.sections,
    cards:
      Array.isArray(media?.cards) && media.cards.length > 0
        ? media?.cards
        : rebuilt.cards,
  };
};

const extractMediaFromNormalizedMessage = (
  message: NormalizedMessage,
): Record<string, unknown> | null => {
  const raw = message.raw ?? {};
  const roots = [
    raw,
    raw.eventMedia,
    raw.Media,
    raw.media,
    raw.RawMessage,
    toRecord(raw.RawMessage)?.message,
    raw.Message,
    toRecord(raw.Message)?.message,
    raw.message,
    toRecord(raw.message)?.message,
  ];
  const records = collectRecords(roots);
  const mediaType = String(message.messageType ?? "").toLowerCase();
  const hasMediaType =
    /(image|video|audio|document|sticker|media|ptt|contact|vcard|location|poll)/.test(
      mediaType,
    );
  const hasInteractiveType = /(list|button|template|interactive|poll)/.test(
    mediaType,
  );
  const caption = firstString(message.caption);
  const directMedia = firstRecord(raw.eventMedia, raw.Media, raw.media);
  if (mediaType.includes("reaction")) {
    const reaction = firstRecord(
      raw.reaction,
      raw.Reaction,
      (toRecord(raw.eventMessage) ?? {}).reaction,
      (toRecord(raw.message) ?? {}).reaction,
    );
    return {
      mediaType: "reaction",
      kind: "reaction",
      emoji:
        firstStringFromRecord(
          reaction,
          "emoji",
          "text",
          "reaction",
          "Reaction",
        ) ?? firstString(message.text, message.caption),
      targetMessageId: firstStringFromRecord(
        reaction,
        "targetMessageId",
        "messageId",
        "id",
      ),
      participant: firstStringFromRecord(
        reaction,
        "participant",
        "senderJid",
        "actorJid",
      ),
      caption: firstString(message.text, message.caption),
    };
  }
  if (
    mediaType.includes("undecryptable") ||
    mediaType.includes("unavailable")
  ) {
    const unavailable = firstRecord(raw.message, raw.eventMessage, raw);
    return {
      mediaType: "undecryptable",
      kind: "system",
      title: "Mensagem indisponível",
      caption:
        firstString(message.caption, message.text) ??
        "O WhatsApp não disponibilizou o conteúdo desta mensagem.",
      viewOnce: unavailable?.viewOnce === true,
      unavailable: unavailable?.unavailable === true,
      requestSent: unavailable?.requestSent === true,
      requestState: unavailable?.requestState,
    };
  }
  const directMediaType = normalizeMediaDescriptorType(
    firstStringFromRecord(
      directMedia,
      "mediaType",
      "MediaType",
      "type",
      "Type",
      "kind",
      "Kind",
    ) ?? message.messageType,
  );
  if (
    directMedia &&
    directMediaType &&
    hasDownloadableMediaMetadata(directMedia)
  ) {
    return buildMediaDescriptor(
      directMedia,
      directMediaType,
      message,
      directMediaType === "sticker" ? "image/webp" : "application/octet-stream",
    );
  }

  const mediaSpecs: Array<{
    keys: string[];
    mediaType: string;
    mimeType: string;
  }> = [
    {
      keys: ["imageMessage", "ImageMessage", "image"],
      mediaType: "image",
      mimeType: "image/jpeg",
    },
    {
      keys: ["videoMessage", "VideoMessage", "video", "ptvMessage"],
      mediaType: "video",
      mimeType: "video/mp4",
    },
    {
      keys: ["audioMessage", "AudioMessage", "audio"],
      mediaType: "audio",
      mimeType: "audio/ogg",
    },
    {
      keys: ["stickerMessage", "StickerMessage", "sticker"],
      mediaType: "sticker",
      mimeType: "image/webp",
    },
    {
      keys: ["documentMessage", "DocumentMessage", "document"],
      mediaType: "document",
      mimeType: "application/octet-stream",
    },
  ];

  for (const spec of mediaSpecs) {
    const node = findNestedRecord(records, spec.keys);
    if (node) {
      return buildMediaDescriptor(node, spec.mediaType, message, spec.mimeType);
    }
  }

  const eventMedia = firstRecord(
    raw.eventMedia,
    raw.Media,
    raw.media,
    raw.poll,
    raw.Poll,
    raw.pollCreationMessage,
    raw.PollCreationMessage,
    raw.pollCreationMessageV2,
    raw.pollCreationMessageV3,
  );
  if (eventMedia) {
    const rawType =
      firstStringFromRecord(
        eventMedia,
        "mediaType",
        "MediaType",
        "type",
        "Type",
      ) ??
      message.messageType ??
      "media";
    const structured = normalizeStructuredEventMedia(
      eventMedia,
      rawType,
      message,
    );
    if (structured) return structured;
    return buildMediaDescriptor(
      eventMedia,
      rawType.replace(/message$/i, "").toLowerCase(),
      message,
      "application/octet-stream",
    );
  }

  const interactive = buildInteractiveDescriptor(records, message);
  if (interactive || hasInteractiveType) {
    return (
      interactive ?? {
        mediaType: message.messageType ?? "interactive",
        kind: "interactive",
        caption: firstString(message.text, message.caption),
      }
    );
  }

  if (!hasMediaType && !caption) return null;
  return {
    mediaType: message.messageType ?? "media",
    caption,
  };
};

const messageRawRecord = (message: NormalizedMessage): Record<string, unknown> =>
  message.raw && typeof message.raw === "object" ? message.raw : {};

const firstIdentityAvatar = (...records: Array<Record<string, unknown> | null>) => {
  for (const record of records) {
    const value = firstStringFromRecord(
      record,
      "avatarUrl",
      "avatar_url",
      "profilePicUrl",
      "profile_pic_url",
      "profilePictureUrl",
      "profile_picture_url",
      "pictureUrl",
      "picture_url",
      "previewUrl",
      "photo",
      "image",
      "avatar",
    );
    if (value) return value;
  }
  return null;
};

const resolveConversationIdentityFromMessage = (
  message: NormalizedMessage,
  chatJid: string,
): { title: string | null; avatarUrl: string | null } => {
  const raw = messageRawRecord(message);
  const rawMessage = firstRecord(raw.RawMessage, raw.Message, raw.message);
  const normalized = firstRecord(raw.normalized, raw.Normalized);
  const eventSender = firstRecord(
    raw.eventSender,
    raw.sender,
    raw.Sender,
    raw.contact,
    raw.Contact,
    raw.author,
    raw.Author,
  );
  const eventChat = firstRecord(raw.eventChat, raw.chat, raw.Chat);
  const eventChatParticipant = firstRecord(
    eventChat?.participant,
    eventChat?.Participant,
  );
  const info = firstRecord(raw.Info, raw.info, rawMessage?.Info, rawMessage?.info);
  const chatType = getWhatsappChatType(chatJid);

  if (chatType === "group") {
    const title =
      firstStringFromRecord(
        eventChat,
        "subject",
        "Subject",
        "name",
        "Name",
        "title",
        "Title",
        "displayName",
        "DisplayName",
      ) ??
      firstStringFromRecord(
        normalized,
        "chatName",
        "groupName",
        "conversationName",
      );
    const avatarUrl = firstIdentityAvatar(eventChat, normalized);
    return { title, avatarUrl };
  }

  if (chatType !== "contact") {
    return { title: null, avatarUrl: null };
  }

  const fromMeTitle =
    firstStringFromRecord(
      eventChat,
      "name",
      "Name",
      "title",
      "Title",
      "displayName",
      "DisplayName",
      "pushName",
      "PushName",
      "notifyName",
      "NotifyName",
    ) ??
    firstStringFromRecord(
      normalized,
      "contactName",
      "chatName",
      "displayName",
      "pushName",
      "notifyName",
      "name",
    );
  const inboundTitle = firstString(
    message.senderName,
    message.displayName,
    message.pushName,
    firstStringFromRecord(
      normalized,
      "displayName",
      "DisplayName",
      "pushName",
      "PushName",
      "notifyName",
      "NotifyName",
      "name",
      "Name",
    ),
    firstStringFromRecord(
      eventSender,
      "name",
      "Name",
      "displayName",
      "DisplayName",
      "pushName",
      "PushName",
      "notifyName",
      "NotifyName",
    ),
    firstStringFromRecord(
      eventChatParticipant,
      "name",
      "Name",
      "displayName",
      "DisplayName",
      "pushName",
      "PushName",
      "notifyName",
      "NotifyName",
    ),
    firstStringFromRecord(
      info,
      "pushName",
      "PushName",
      "notifyName",
      "NotifyName",
      "displayName",
      "DisplayName",
    ),
  );

  return {
    title: message.fromMe ? fromMeTitle : inboundTitle,
    avatarUrl: firstIdentityAvatar(
      eventSender,
      eventChatParticipant,
      eventChat,
      normalized,
      info,
    ),
  };
};

export const recordWhatsappMessageFromNormalized = async (options: {
  instance: BotInstance;
  message: NormalizedMessage;
}) => {
  const { instance, message } = options;
  if (!message.chatId) return null;

  const chatJid = normalizeWhatsappChatJid(message.chatId);
  if (!chatJid) return null;
  const identity = resolveConversationIdentityFromMessage(message, chatJid);
  const text = firstString(message.text, message.caption);
  const media = extractMediaFromNormalizedMessage(message);
  const messageType = resolveStoredWhatsappMessageType({
    explicitType: message.messageType,
    media,
    text,
  });

  return recordWhatsappConversationMessage({
    userId: instance.userId,
    instanceId: instance.id,
    chatJid,
    messageId: message.id,
    direction: message.fromMe ? "outbound" : "inbound",
    senderJid: message.fromMe
      ? `${instance.phone}@s.whatsapp.net`
      : (message.senderJid ?? message.participant),
    senderName: message.fromMe
      ? instance.name
      : firstString(message.senderName, message.displayName, message.pushName),
    senderAvatarUrl: message.fromMe ? null : identity.avatarUrl,
    messageType,
    text,
    media,
    raw: message.raw,
    timestamp: message.timestamp,
    title: identity.title,
    avatarUrl: identity.avatarUrl,
  });
};

export const listWhatsappConversationThreads = async (
  userId: number,
  instanceId: number,
): Promise<WhatsappConversationThread[]> => {
  await ensureWhatsappConversationTables();
  const db = getDb();
  const [rows] = await db.query<ThreadRow[]>(
    `
      SELECT
        c.*,
        (
          SELECT m.direction
          FROM bot_whatsapp_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.timestamp DESC, m.id DESC
          LIMIT 1
        ) AS last_message_direction,
        (
          SELECT m.sender_name
          FROM bot_whatsapp_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.timestamp DESC, m.id DESC
          LIMIT 1
        ) AS last_message_sender_name,
        (
          SELECT m.sender_jid
          FROM bot_whatsapp_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.timestamp DESC, m.id DESC
          LIMIT 1
        ) AS last_message_sender_jid,
        COALESCE(n.muted, 0) AS muted
      FROM bot_whatsapp_conversations c
      LEFT JOIN bot_whatsapp_conversation_notifications n
        ON n.user_id = c.user_id
       AND n.instance_id = c.instance_id
       AND n.chat_jid = c.chat_jid
      WHERE c.user_id = ?
        AND c.instance_id = ?
        AND c.chat_type <> 'broadcast'
        AND c.chat_jid NOT LIKE '%@broadcast'
        AND c.chat_jid <> 'status@broadcast'
      ORDER BY
        CASE WHEN c.last_message_at IS NULL THEN 1 ELSE 0 END ASC,
        c.last_message_at DESC,
        c.updated_at DESC,
        c.id DESC
    `,
    [userId, instanceId],
  );
  return rows.map(mapThreadRow);
};

export const listWhatsappHistorySyncAnchors = async (
  userId: number,
  instanceId: number,
): Promise<WhatsappHistorySyncAnchor[]> => {
  await ensureWhatsappConversationTables();
  const db = getDb();
  const [rows] = await db.query<
    Array<RowDataPacket & {
      chat_jid: string;
      message_id: string;
      direction: string;
      timestamp: Date | string;
    }>
  >(
    `
      SELECT c.chat_jid, m.message_id, m.direction, m.timestamp
      FROM bot_whatsapp_conversations c
      JOIN bot_whatsapp_messages m
        ON m.id = (
          SELECT m2.id
          FROM bot_whatsapp_messages m2
          WHERE m2.conversation_id = c.id
            AND m2.message_id IS NOT NULL
            AND m2.message_id <> ''
          ORDER BY m2.timestamp ASC, m2.id ASC
          LIMIT 1
        )
      WHERE c.user_id = ?
        AND c.instance_id = ?
        AND c.chat_type <> 'broadcast'
        AND c.chat_jid NOT LIKE '%@broadcast'
        AND c.chat_jid <> 'status@broadcast'
      ORDER BY m.timestamp ASC, m.id ASC
    `,
    [userId, instanceId],
  );
  return rows.map((row) => ({
    chatJid: row.chat_jid,
    messageId: row.message_id,
    fromMe: row.direction === "outbound",
    timestamp: normalizeMessageTimestamp(row.timestamp).toISOString(),
  }));
};

export const countWhatsappConversationMessages = async (
  userId: number,
  instanceId: number,
): Promise<number> => {
  await ensureWhatsappConversationTables();
  const db = getDb();
  const [rows] = await db.query<Array<RowDataPacket & { total: number | string }>>(
    `
      SELECT COUNT(*) AS total
      FROM bot_whatsapp_messages
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );
  return Math.max(0, Number(rows[0]?.total ?? 0));
};

export const getWhatsappConversationThread = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
): Promise<WhatsappConversationThread | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return null;
  const db = getDb();
  const [rows] = await db.query<ThreadRow[]>(
    `
      SELECT c.*, COALESCE(n.muted, 0) AS muted
      FROM bot_whatsapp_conversations c
      LEFT JOIN bot_whatsapp_conversation_notifications n
        ON n.user_id = c.user_id
       AND n.instance_id = c.instance_id
       AND n.chat_jid = c.chat_jid
      WHERE c.user_id = ? AND c.instance_id = ? AND c.chat_jid = ?
      LIMIT 1
    `,
    [userId, instanceId, chatJid],
  );
  return rows[0] ? mapThreadRow(rows[0]) : null;
};

const threadPayloadFromRealtimeEvent = (row: StoredRealtimeMessageEventRow) => {
  const payload = parseJson(row.payload_json ?? null);
  const thread = payloadRecord(payload?.thread);
  const message = payloadRecord(payload?.message);
  const chatJid = normalizeWhatsappChatJid(
    firstPayloadString(thread.chatJid, message.chatJid, row.chat_jid) ?? "",
  );
  if (!chatJid) return null;

  const explicitChatType = firstPayloadString(thread.chatType);
  const chatType =
    explicitChatType === "contact" ||
    explicitChatType === "group" ||
    explicitChatType === "community" ||
    explicitChatType === "channel" ||
    explicitChatType === "broadcast" ||
    explicitChatType === "unknown"
      ? explicitChatType
      : getWhatsappChatType(chatJid);

  return {
    chatJid,
    chatType,
    title: firstPayloadString(thread.title),
    phone: firstPayloadString(thread.phone) ?? getWhatsappChatPhone(chatJid),
    avatarUrl: firstPayloadString(thread.avatarUrl),
    lastMessagePreview: firstPayloadString(
      thread.lastMessagePreview,
      message.text,
    ),
    lastMessageAt:
      parsePayloadDate(thread.lastMessageAt) ??
      parsePayloadDate(message.timestamp) ??
      parsePayloadDate(row.created_at),
  };
};

export const restoreWhatsappConversationThreadsFromRealtimeEvents = async (
  userId: number,
  instanceId: number,
  options: { limit?: number } = {},
): Promise<number> => {
  await ensureWhatsappConversationTables();
  const limit = Math.min(Math.max(Number(options.limit ?? 5000), 1), 10_000);
  const db = getDb();
  const [rows] = await db.query<StoredRealtimeMessageEventRow[]>(
    `
      SELECT e.*
      FROM bot_whatsapp_realtime_events e
      WHERE e.user_id = ?
        AND e.instance_id = ?
        AND e.event_type = 'conversation.message.upserted'
        AND e.payload_json IS NOT NULL
      ORDER BY e.id DESC
      LIMIT ?
    `,
    [userId, instanceId, limit],
  );

  const candidates = new Map<
    string,
    ReturnType<typeof threadPayloadFromRealtimeEvent>
  >();
  for (const row of rows) {
    const candidate = threadPayloadFromRealtimeEvent(row);
    if (!candidate) continue;
    const current = candidates.get(candidate.chatJid);
    const currentTime = current?.lastMessageAt?.getTime() ?? 0;
    const candidateTime = candidate.lastMessageAt?.getTime() ?? 0;
    if (!current || candidateTime >= currentTime) {
      candidates.set(candidate.chatJid, candidate);
    }
  }

  let restored = 0;
  for (const candidate of candidates.values()) {
    if (!candidate) continue;
    await upsertWhatsappConversation({
      userId,
      instanceId,
      chatJid: candidate.chatJid,
      chatType: candidate.chatType,
      title: candidate.title,
      phone: candidate.phone,
      avatarUrl: candidate.avatarUrl,
      lastMessagePreview: candidate.lastMessagePreview,
      lastMessageAt: candidate.lastMessageAt,
    });
    restored += 1;
  }

  return restored;
};

const realtimeMessagePayload = (row: StoredRealtimeMessageEventRow) => {
  const payload = parseJson(row.payload_json ?? null);
  const message = payloadRecord(payload?.message);
  if (Object.keys(message).length === 0) return null;
  const chatJid = normalizeWhatsappChatJid(
    firstPayloadString(message.chatJid, row.chat_jid) ?? "",
  );
  const messageId = firstPayloadString(message.messageId, row.message_id);
  if (!chatJid || !messageId) return null;

  const media = payloadRecord(message.media);
  const hasMedia = Object.keys(media).length > 0;
  const text = firstPayloadString(message.text);
  const explicitType = firstPayloadString(message.messageType, message.type);
  const mediaType = firstPayloadString(media.mediaType, media.type);
  const messageType = (
    explicitType ||
    mediaType ||
    (hasMedia ? "media" : text ? "text" : "unknown")
  ).slice(0, 64);

  return {
    chatJid,
    messageId,
    direction:
      firstPayloadString(message.direction) === "outbound"
        ? "outbound"
        : "inbound",
    senderJid: firstPayloadString(message.senderJid),
    senderName: truncatePayloadString(message.senderName, 255),
    senderAvatarUrl: firstPayloadString(message.senderAvatarUrl),
    messageType,
    text,
    media: hasMedia ? media : null,
    deletedAt: parsePayloadDate(message.deletedAt),
    deletedByJid: firstPayloadString(message.deletedByJid),
    deletedByName: truncatePayloadString(message.deletedByName, 255),
    deletedPlaceholder: truncatePayloadString(message.deletedPlaceholder, 255),
    revealDeletedContent: payloadBoolean(message.revealDeletedContent) ? 1 : 0,
    timestamp:
      parsePayloadDate(message.timestamp) ??
      parsePayloadDate(row.created_at) ??
      new Date(),
    createdAt:
      parsePayloadDate(message.createdAt) ??
      parsePayloadDate(row.created_at) ??
      new Date(),
    raw: {
      restoredFromRealtimeEvent: true,
      eventId: row.id,
      message,
    },
  };
};

export const restoreWhatsappConversationMessagesFromRealtimeEvents = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  options: { limit?: number } = {},
): Promise<number> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return 0;
  const limit = Math.min(Math.max(Number(options.limit ?? 5000), 1), 10_000);
  const db = getDb();
  const [rows] = await db.query<StoredRealtimeMessageEventRow[]>(
    `
      SELECT e.*
      FROM bot_whatsapp_realtime_events e
      LEFT JOIN bot_whatsapp_messages m
        ON m.user_id = e.user_id
       AND m.instance_id = e.instance_id
       AND m.chat_jid = e.chat_jid
       AND m.message_id = e.message_id
      WHERE e.user_id = ?
        AND e.instance_id = ?
        AND e.chat_jid = ?
        AND e.event_type = 'conversation.message.upserted'
        AND e.payload_json IS NOT NULL
        AND m.id IS NULL
      ORDER BY e.id ASC
      LIMIT ?
    `,
    [userId, instanceId, chatJid, limit],
  );
  if (rows.length === 0) return 0;

  let thread = await getWhatsappConversationThread(userId, instanceId, chatJid);
  if (!thread) {
    const candidate = rows
      .map(threadPayloadFromRealtimeEvent)
      .find((entry) => entry?.chatJid === chatJid);
    await upsertWhatsappConversation({
      userId,
      instanceId,
      chatJid,
      chatType: candidate?.chatType ?? getWhatsappChatType(chatJid),
      title: candidate?.title ?? null,
      phone: candidate?.phone ?? getWhatsappChatPhone(chatJid),
      avatarUrl: candidate?.avatarUrl ?? null,
      lastMessagePreview: candidate?.lastMessagePreview ?? null,
      lastMessageAt: candidate?.lastMessageAt ?? null,
    });
    thread = await getWhatsappConversationThread(userId, instanceId, chatJid);
  }
  if (!thread) return 0;

  const seen = new Set<string>();
  let restored = 0;
  for (const row of rows) {
    const message = realtimeMessagePayload(row);
    if (!message || message.chatJid !== chatJid) continue;
    const uniqueKey = `${message.chatJid}:${message.messageId}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const [result] = await db.query<ResultSetHeader>(
      `
        INSERT INTO bot_whatsapp_messages
          (conversation_id, user_id, instance_id, chat_jid, message_id, direction, sender_jid, sender_name, sender_avatar_url, message_type, text, media_json, raw_json, deleted_at, deleted_by_jid, deleted_by_name, deleted_placeholder, reveal_deleted_content, timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          conversation_id = VALUES(conversation_id),
          user_id = VALUES(user_id),
          direction = VALUES(direction),
          sender_jid = COALESCE(VALUES(sender_jid), sender_jid),
          sender_name = COALESCE(VALUES(sender_name), sender_name),
          sender_avatar_url = COALESCE(VALUES(sender_avatar_url), sender_avatar_url),
          message_type = COALESCE(NULLIF(VALUES(message_type), ''), message_type),
          text = COALESCE(VALUES(text), text),
          media_json = COALESCE(VALUES(media_json), media_json),
          raw_json = COALESCE(raw_json, VALUES(raw_json)),
          deleted_at = COALESCE(VALUES(deleted_at), deleted_at),
          deleted_by_jid = COALESCE(VALUES(deleted_by_jid), deleted_by_jid),
          deleted_by_name = COALESCE(VALUES(deleted_by_name), deleted_by_name),
          deleted_placeholder = COALESCE(VALUES(deleted_placeholder), deleted_placeholder),
          reveal_deleted_content = GREATEST(reveal_deleted_content, VALUES(reveal_deleted_content)),
          timestamp = VALUES(timestamp)
      `,
      [
        thread.id,
        userId,
        instanceId,
        chatJid,
        message.messageId,
        message.direction,
        message.senderJid,
        message.senderName,
        message.senderAvatarUrl,
        message.messageType,
        message.text,
        message.media ? JSON.stringify(message.media) : null,
        JSON.stringify(message.raw),
        message.deletedAt,
        message.deletedByJid,
        message.deletedByName,
        message.deletedPlaceholder,
        message.revealDeletedContent,
        message.timestamp,
        message.createdAt,
      ],
    );
    if (Number(result.affectedRows ?? 0) > 0) {
      restored += 1;
    }
  }

  return restored;
};

export const setWhatsappConversationArchivedForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  archived: boolean,
): Promise<WhatsappConversationThread | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return null;
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_whatsapp_conversations
        (user_id, instance_id, chat_jid, chat_type, title, phone, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        archived = VALUES(archived),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      instanceId,
      chatJid,
      getWhatsappChatType(chatJid),
      chatJid.split("@")[0] ?? chatJid,
      getWhatsappChatPhone(chatJid),
      archived ? 1 : 0,
    ],
  );
  return getWhatsappConversationThread(userId, instanceId, chatJid);
};

export const setWhatsappConversationPinnedForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  pinned: boolean,
): Promise<WhatsappConversationThread | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return null;
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_whatsapp_conversations
        (user_id, instance_id, chat_jid, chat_type, title, phone, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        pinned = VALUES(pinned),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      instanceId,
      chatJid,
      getWhatsappChatType(chatJid),
      chatJid.split("@")[0] ?? chatJid,
      getWhatsappChatPhone(chatJid),
      pinned ? 1 : 0,
    ],
  );
  return getWhatsappConversationThread(userId, instanceId, chatJid);
};

export const setWhatsappConversationNotificationsMutedForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  muted: boolean,
): Promise<boolean> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return false;
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_whatsapp_conversation_notifications
        (user_id, instance_id, chat_jid, muted)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        muted = VALUES(muted),
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, instanceId, chatJid, muted ? 1 : 0],
  );
  return true;
};

export const isWhatsappConversationNotificationsMutedForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
): Promise<boolean> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return false;
  const db = getDb();
  const [rows] = await db.query<(RowDataPacket & { muted: number | null })[]>(
    `
      SELECT muted
      FROM bot_whatsapp_conversation_notifications
      WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
      LIMIT 1
    `,
    [userId, instanceId, chatJid],
  );
  return Number(rows[0]?.muted ?? 0) === 1;
};

export const markWhatsappConversationThreadReadForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
): Promise<boolean> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return false;
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE bot_whatsapp_conversations
      SET unread_count = 0
      WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
    `,
    [userId, instanceId, chatJid],
  );
  return Number(result.affectedRows ?? 0) > 0;
};

export const markWhatsappConversationThreadReadAndNotifyForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
): Promise<boolean> => {
  const changed = await markWhatsappConversationThreadReadForUser(
    userId,
    instanceId,
    chatJidRaw,
  );
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return false;
  if (!changed) return false;

  const thread = await getWhatsappConversationThread(
    userId,
    instanceId,
    chatJid,
  );
  const event = await recordWhatsappRealtimeEvent({
    userId,
    instanceId,
    chatJid,
    eventType: "chat.action",
    payload: {
      read: true,
      thread: thread ? { ...thread, unreadCount: 0 } : null,
    },
  });
  if (event) publishWhatsappRealtimeEvent(event);
  return true;
};

export const listWhatsappConversationMessages = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  options: { limit?: number } = {},
): Promise<WhatsappConversationMessage[]> => {
  const page = await listWhatsappConversationMessagePage(
    userId,
    instanceId,
    chatJidRaw,
    options,
  );
  return page.messages;
};

export const listWhatsappConversationMessagePage = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  options: { limit?: number; before?: string | null } = {},
): Promise<WhatsappConversationMessagePage> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return { messages: [], hasMore: false, oldestCursor: null };
  const limit = Math.min(
    Math.max(Number(options.limit ?? 500), 1),
    WHATSAPP_CONVERSATION_MESSAGE_PAGE_MAX,
  );
  const rawBefore =
    typeof options.before === "string" ? options.before.trim() : "";
  const cursorSeparator = rawBefore.lastIndexOf("|");
  const beforeTimestampRaw =
    cursorSeparator > 0 ? rawBefore.slice(0, cursorSeparator) : rawBefore;
  const beforeIdRaw =
    cursorSeparator > 0 ? rawBefore.slice(cursorSeparator + 1) : "";
  const before = beforeTimestampRaw
    ? normalizeMessageTimestamp(beforeTimestampRaw)
    : null;
  const beforeId = Number.parseInt(beforeIdRaw, 10);
  const hasBeforeId = Number.isFinite(beforeId) && beforeId > 0;
  const hasBefore = Boolean(before && !Number.isNaN(before.getTime()));
  const db = getDb();
  const [rows] = await db.query<MessageRow[]>(
    `
      SELECT *
      FROM (
        SELECT m.*,
          (SELECT COUNT(*) FROM bot_whatsapp_message_receipts r WHERE r.message_id = m.id) AS receipt_recipient_count,
          (SELECT COUNT(*) FROM bot_whatsapp_message_receipts r WHERE r.message_id = m.id AND r.state IN ('delivered','read')) AS receipt_delivered_count,
          (SELECT COUNT(*) FROM bot_whatsapp_message_receipts r WHERE r.message_id = m.id AND r.state = 'read') AS receipt_read_count
        FROM bot_whatsapp_messages m
        WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
          ${hasBefore ? (hasBeforeId ? "AND (timestamp < ? OR (timestamp = ? AND id < ?))" : "AND timestamp < ?") : ""}
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      ) AS recent_messages
      ORDER BY timestamp ASC, id ASC
    `,
    hasBefore
      ? hasBeforeId
        ? [userId, instanceId, chatJid, before, before, beforeId, limit + 1]
        : [userId, instanceId, chatJid, before, limit + 1]
      : [userId, instanceId, chatJid, limit + 1],
  );
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(1) : rows;
  const oldest = pageRows[0] ?? null;
  return {
    messages: pageRows.map(mapMessageRow),
    hasMore,
    oldestCursor: oldest ? `${toIso(oldest.timestamp)}|${oldest.id}` : null,
  };
};

export const getWhatsappConversationMessageForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  messageKey: string,
): Promise<WhatsappConversationStoredMessage | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  const normalizedKey = typeof messageKey === "string" ? messageKey.trim() : "";
  if (!chatJid || !normalizedKey) return null;
  const numericId = Number.parseInt(normalizedKey, 10);
  const db = getDb();
  const [rows] = await db.query<MessageRow[]>(
    `
      SELECT *
      FROM bot_whatsapp_messages
      WHERE user_id = ?
        AND instance_id = ?
        AND chat_jid = ?
        AND (
          message_id = ?
          ${Number.isFinite(numericId) && numericId > 0 ? "OR id = ?" : ""}
        )
      ORDER BY id DESC
      LIMIT 1
    `,
    Number.isFinite(numericId) && numericId > 0
      ? [userId, instanceId, chatJid, normalizedKey, numericId]
      : [userId, instanceId, chatJid, normalizedKey],
  );
  return rows[0] ? mapMessageRowWithRaw(rows[0]) : null;
};

export const getWhatsappConversationMessageByClientIdForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  clientMessageId: string,
): Promise<WhatsappConversationStoredMessage | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  const normalizedClientId = clientMessageId.trim().slice(0, 96);
  if (!chatJid || !normalizedClientId) return null;
  const [rows] = await getDb().query<MessageRow[]>(
    `SELECT * FROM bot_whatsapp_messages
     WHERE user_id = ? AND instance_id = ? AND chat_jid = ? AND client_message_id = ?
     ORDER BY id DESC LIMIT 1`,
    [userId, instanceId, chatJid, normalizedClientId],
  );
  return rows[0] ? mapMessageRowWithRaw(rows[0]) : null;
};

export const updateWhatsappConversationMessageMediaForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  messageKey: string,
  media: Record<string, unknown>,
): Promise<boolean> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  const normalizedKey = typeof messageKey === "string" ? messageKey.trim() : "";
  if (!chatJid || !normalizedKey) return false;
  const numericId = Number.parseInt(normalizedKey, 10);
  const hasNumericId = Number.isFinite(numericId) && numericId > 0;
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE bot_whatsapp_messages
      SET media_json = ?
      WHERE user_id = ?
        AND instance_id = ?
        AND chat_jid = ?
        AND (
          message_id = ?
          ${hasNumericId ? "OR id = ?" : ""}
        )
    `,
    hasNumericId
      ? [
          JSON.stringify(media ?? {}),
          userId,
          instanceId,
          chatJid,
          normalizedKey,
          numericId,
        ]
      : [
          JSON.stringify(media ?? {}),
          userId,
          instanceId,
          chatJid,
          normalizedKey,
        ],
  );
  return result.affectedRows > 0;
};

const addHours = (value: Date | string, hours: number): Date => {
  const base = value instanceof Date ? value : new Date(value);
  const timestamp = Number.isNaN(base.getTime()) ? Date.now() : base.getTime();
  return new Date(timestamp + hours * 60 * 60 * 1000);
};

const firstStatusString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return null;
};

const firstStatusBoolean = (...values: unknown[]): boolean | null => {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
};

const statusArgbColor = (...values: unknown[]): string | null => {
  for (const value of values) {
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;
    if (!Number.isFinite(parsed)) continue;
    return `#${(Math.trunc(parsed) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
  }
  return null;
};

const normalizeStatusMediaType = (value: string | null | undefined) => {
  const lowered = (value || "").trim().toLowerCase();
  if (lowered.includes("image")) return "image";
  if (lowered.includes("video")) return "video";
  if (lowered.includes("audio")) return "audio";
  if (lowered.includes("sticker")) return "sticker";
  if (lowered.includes("document")) return "document";
  if (lowered) return lowered;
  return "text";
};

const detectStatusMediaTypeFromPayload = (
  value: unknown,
  depth = 0,
): string | null => {
  if (!value || typeof value !== "object" || depth > 5) return null;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (lowered.includes("imagemessage") || lowered === "image") return "image";
    if (lowered.includes("videomessage") || lowered === "video") return "video";
    if (lowered.includes("audiomessage") || lowered === "audio") return "audio";
    if (lowered.includes("stickermessage") || lowered === "sticker") return "sticker";
    if (lowered.includes("documentmessage") || lowered === "document") return "document";
    const detected = detectStatusMediaTypeFromPayload(nested, depth + 1);
    if (detected) return detected;
  }
  return null;
};

const buildStatusMediaUrl = (
  instanceId: number,
  message: WhatsappConversationMessage,
  media: Record<string, unknown> | null,
  normalizedType: string,
) => {
  const hasEmbeddedMedia =
    media !== null &&
    firstStatusString(
      media?.dataUrl,
      media?.url,
      media?.mediaUrl,
      media?.MediaUrl,
      media?.directPath,
      media?.DirectPath,
      media?.mediaKey,
      media?.MediaKey,
    ) !== null;
  // Some Wuzapi status webhooks only persist status.type. The protected media
  // route can recover the payload lazily with getChatMessage, so expose it for
  // every media status even when media_json has no direct URL/key yet.
  const hasMediaType = ["image", "video", "audio", "sticker", "document"]
    .includes(normalizedType);
  if (!hasEmbeddedMedia && !hasMediaType) return null;
  const key = message.messageId ?? String(message.id);
  return `/api/bot-instances/${instanceId}/whatsapp-conversations/${encodeURIComponent("status@broadcast")}/messages/${encodeURIComponent(key)}/media`;
};

export const listActiveWhatsappReceivedStatusesForUser = async (
  userId: number,
  instanceId: number | null,
  options: { limit?: number; maxAgeHours?: number } = {},
): Promise<WhatsappReceivedStatus[]> => {
  await ensureWhatsappConversationTables();
  const limit = Math.min(Math.max(Number(options.limit ?? 80), 1), 200);
  const maxAgeHours = Math.min(
    Math.max(Number(options.maxAgeHours ?? 24), 1),
    168,
  );
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const params: unknown[] = [userId, "status@broadcast", cutoff];
  let instanceFilter = "";
  if (
    typeof instanceId === "number" &&
    Number.isFinite(instanceId) &&
    instanceId > 0
  ) {
    instanceFilter = "AND instance_id = ?";
    params.push(instanceId);
  }
  params.push(limit);

  const db = getDb();
  const [rows] = await db.query<MessageRow[]>(
    `
      SELECT *
      FROM bot_whatsapp_messages
      WHERE user_id = ?
        AND chat_jid = ?
        AND deleted_at IS NULL
        AND timestamp >= ?
        ${instanceFilter}
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `,
    params,
  );

  return rows.map((row) => {
    const message = mapMessageRow(row);
    const raw = parseJson(row.raw_json ?? null);
    const media = message.media ?? null;
    const status = payloadRecord(media?.status ?? raw?.status);
    const statusStyle = payloadRecord(status.style ?? status.textStyle ?? raw?.statusStyle);
    const author = payloadRecord(status.author ?? raw?.sender ?? raw?.author);
    const caption = firstStatusString(
      status.caption,
      media?.caption,
      raw?.message && payloadRecord(raw.message).caption,
    );
    const text = firstStatusString(
      row.text,
      status.text,
      raw?.message && payloadRecord(raw.message).text,
    );
    const mimeType = firstStatusString(
      media?.mimeType,
      media?.mimetype,
      status.mimeType,
    );
    const meaningfulRowType = normalizeStatusMediaType(row.message_type);
    const type = normalizeStatusMediaType(
      firstStatusString(
        status.type,
        mimeType,
        media?.type,
        media?.mediaType,
        detectStatusMediaTypeFromPayload(raw),
        meaningfulRowType === "unknown" ? null : meaningfulRowType,
      ),
    );
    const timestamp = toIso(row.timestamp) ?? new Date().toISOString();
    const authorJid = firstStatusString(
      status.authorJid,
      author.jid,
      author.id,
      row.sender_jid,
    );
    const storedAvatar = firstStatusString(
      author.avatarUrl,
      author.profilePictureUrl,
      row.sender_avatar_url,
    );
    return {
      id: Number(row.id),
      instanceId: Number(row.instance_id),
      messageId: row.message_id ?? null,
      authorJid,
      authorName: firstStatusString(
        author.name,
        status.pushName,
        row.sender_name,
      ),
      authorAvatarUrl:
        storedAvatar ??
        (authorJid
          ? `/api/bot-instances/${Number(row.instance_id)}/whatsapp-conversations/${encodeURIComponent(authorJid)}/avatar`
          : null),
      type,
      text,
      caption,
      mediaUrl: buildStatusMediaUrl(Number(row.instance_id), message, media, type),
      mimeType,
      backgroundColor: statusArgbColor(
        status.backgroundArgb,
        status.backgroundColor,
        statusStyle.backgroundArgb,
        statusStyle.backgroundColor,
      ),
      textColor: statusArgbColor(
        status.textArgb,
        status.textColor,
        statusStyle.textArgb,
        statusStyle.textColor,
      ),
      fontStyle: firstStatusString(status.font, status.fontStyle, statusStyle.font),
      allowReshare: firstStatusBoolean(
        status.allowReshare,
        status.allow_reshare,
        statusStyle.allowReshare,
      ),
      timestamp,
      expiresAt: addHours(row.timestamp, 24).toISOString(),
    };
  });
};

export const cleanupExpiredWhatsappStatusMessages = async (
  maxAgeHours = 24,
): Promise<number> => {
  await ensureWhatsappConversationTables();
  const safeHours = Math.min(Math.max(Number(maxAgeHours), 1), 168);
  const cutoff = new Date(Date.now() - safeHours * 60 * 60 * 1000);
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      DELETE FROM bot_whatsapp_messages
      WHERE chat_jid = 'status@broadcast'
        AND timestamp < ?
    `,
    [cutoff],
  );
  return Number(result.affectedRows ?? 0);
};

const normalizePollVoteHash = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/.test(trimmed)) return trimmed;
  const compact = trimmed.replace(/^sha256:/i, "").replace(/\s+/g, "");
  if (/^[0-9a-f]{64}$/.test(compact)) return compact;
  return trimmed;
};

const hashPollOptionTitle = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  return createHash("sha256").update(value.trim()).digest("hex");
};

const pollOptionIdentity = (option: Record<string, unknown>): string | null =>
  normalizePollVoteHash(
    firstStringFromRecord(
      option,
      "id",
      "Id",
      "hash",
      "Hash",
      "optionHash",
      "OptionHash",
    ),
  ) ??
  hashPollOptionTitle(
    firstStringFromRecord(
      option,
      "title",
      "Title",
      "name",
      "Name",
      "optionName",
      "OptionName",
    ),
  );

const pollVoterKey = (value: unknown): string | null => {
  const normalized =
    typeof value === "string" ? normalizeWhatsappChatJid(value) : null;
  return normalized ?? firstString(value);
};

const addPollVoter = (target: Set<string>, value: unknown) => {
  const normalized = pollVoterKey(value);
  if (normalized) target.add(normalized);
};

export const applyWhatsappPollVoteForUser = async (params: {
  userId: number;
  instanceId: number;
  chatJid: string;
  pollMessageId: string;
  voterJid: string;
  selectedOptionHashes: string[];
  selectedOptionTitles?: string[];
  voterName?: string | null;
  ownJid?: string | null;
  timestamp?: Date | number | string | null;
}): Promise<WhatsappConversationMessage | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(params.chatJid);
  const pollMessageId =
    typeof params.pollMessageId === "string" ? params.pollMessageId.trim() : "";
  const voterJid = pollVoterKey(params.voterJid);
  const ownJid = pollVoterKey(params.ownJid) ?? voterJid;
  if (!chatJid || !pollMessageId || !voterJid) return null;

  const db = getDb();
  const [rows] = await db.query<MessageRow[]>(
    `
      SELECT *
      FROM bot_whatsapp_messages
      WHERE user_id = ?
        AND instance_id = ?
        AND chat_jid = ?
        AND message_id = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [params.userId, params.instanceId, chatJid, pollMessageId],
  );
  const row = rows[0];
  if (!row) return null;

  const media = parseJson(row.media_json) ?? {};
  const mediaRecord = toRecord(media) ?? {};
  const optionsSource = normalizePollOptions(mediaRecord);
  if (optionsSource.length === 0) return null;

  const selectedHashes = new Set(
    [
      ...(params.selectedOptionHashes ?? []),
      ...(params.selectedOptionTitles ?? []).map(hashPollOptionTitle),
    ]
      .map(normalizePollVoteHash)
      .filter((value): value is string => Boolean(value)),
  );
  if (selectedHashes.size === 0) return null;

  const selectableCount =
    firstNumberFromRecord(
      mediaRecord,
      "selectableOptionsCount",
      "SelectableOptionsCount",
      "selectableCount",
      "SelectableCount",
    ) ?? 1;
  const existingVotesRecord =
    toRecord(mediaRecord.pollVotes ?? mediaRecord.PollVotes) ?? {};
  const votesByVoter = new Map<string, Set<string>>();

  for (const [rawVoter, rawSelection] of Object.entries(existingVotesRecord)) {
    const normalizedVoter = pollVoterKey(rawVoter);
    if (!normalizedVoter) continue;
    const selected = Array.isArray(rawSelection)
      ? rawSelection
      : [rawSelection];
    const hashed = selected
      .map(normalizePollVoteHash)
      .filter((value): value is string => Boolean(value));
    if (hashed.length > 0) votesByVoter.set(normalizedVoter, new Set(hashed));
  }

  optionsSource.forEach((option) => {
    const identity = pollOptionIdentity(option);
    if (!identity) return;
    const voters =
      option.voters ??
      option.Voters ??
      option.selectedVoters ??
      option.SelectedVoters;
    if (!Array.isArray(voters)) return;
    voters.forEach((entry) => {
      const normalizedVoter = pollVoterKey(entry);
      if (!normalizedVoter) return;
      const selected = votesByVoter.get(normalizedVoter) ?? new Set<string>();
      selected.add(identity);
      votesByVoter.set(normalizedVoter, selected);
    });
  });

  const normalizedSelected = Array.from(selectedHashes);
  votesByVoter.set(
    voterJid,
    new Set(
      selectableCount <= 1
        ? normalizedSelected.slice(0, 1)
        : normalizedSelected,
    ),
  );

  const voterNamesRecord =
    toRecord(mediaRecord.pollVoterNames ?? mediaRecord.PollVoterNames) ?? {};
  if (params.voterName?.trim()) {
    voterNamesRecord[voterJid] = params.voterName.trim();
  }

  const nextOptions = optionsSource.map((option) => {
    const identity = pollOptionIdentity(option);
    const voters = new Set<string>();
    if (identity) {
      for (const [rawVoter, selections] of votesByVoter.entries()) {
        if (selections.has(identity)) voters.add(rawVoter);
      }
    }
    const title =
      firstStringFromRecord(
        option,
        "title",
        "Title",
        "name",
        "Name",
        "optionName",
        "OptionName",
      ) ?? "";
    const id =
      identity ??
      firstStringFromRecord(option, "id", "Id", "hash", "Hash") ??
      title;
    return {
      ...option,
      id,
      hash: identity ?? option.hash,
      title,
      name: title,
      voters: Array.from(voters),
      votes: voters.size,
      voteCount: voters.size,
      selected: ownJid ? voters.has(ownJid) : false,
    };
  });

  const nextPollVotes = Object.fromEntries(
    Array.from(votesByVoter.entries()).map(([voter, selections]) => [
      voter,
      Array.from(selections),
    ]),
  );
  const timestamp = params.timestamp
    ? normalizeMessageTimestamp(params.timestamp)
    : new Date();
  const nextMedia = {
    ...mediaRecord,
    mediaType: "poll",
    kind: "poll",
    options: nextOptions,
    pollOptions: nextOptions,
    pollVotes: nextPollVotes,
    pollVoterNames: voterNamesRecord,
    totalVotes: nextOptions.reduce(
      (sum, option) => sum + Number(option.voteCount ?? option.votes ?? 0),
      0,
    ),
    lastVoteAt: timestamp.toISOString(),
    lastVoterJid: voterJid,
    lastVoterName: params.voterName ?? null,
  };

  await db.query(
    `
      UPDATE bot_whatsapp_messages
      SET media_json = ?
      WHERE id = ?
    `,
    [JSON.stringify(nextMedia), row.id],
  );

  const [updatedRows] = await db.query<MessageRow[]>(
    "SELECT * FROM bot_whatsapp_messages WHERE id = ? LIMIT 1",
    [row.id],
  );
  if (!updatedRows[0]) return null;
  const message = mapMessageRow(updatedRows[0]);
  const thread = await getWhatsappConversationThread(
    params.userId,
    params.instanceId,
    chatJid,
  );
  try {
    const event = await recordWhatsappRealtimeEvent({
      userId: params.userId,
      instanceId: params.instanceId,
      chatJid,
      eventType: "conversation.message.upserted",
      messageId: message.messageId ?? pollMessageId,
      payload: {
        thread,
        message,
        action: "poll.vote",
      },
    });
    if (event) publishWhatsappRealtimeEvent(event);
  } catch (error) {
    console.warn("[whatsapp-realtime] failed to publish poll vote event", {
      userId: params.userId,
      instanceId: params.instanceId,
      chatJid,
      pollMessageId,
      error,
    });
  }
  return message;
};

const refreshWhatsappConversationLastMessageForUser = async (
  userId: number,
  instanceId: number,
  chatJid: string,
) => {
  const db = getDb();
  const [rows] = await db.query<MessageRow[]>(
    `
      SELECT *
      FROM bot_whatsapp_messages
      WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    `,
    [userId, instanceId, chatJid],
  );
  const latest = rows[0];

  if (!latest) {
    await db.query(
      `
        UPDATE bot_whatsapp_conversations
        SET last_message_preview = NULL,
            last_message_at = NULL,
            unread_count = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
      `,
      [userId, instanceId, chatJid],
    );
    return;
  }

  const preview = latest.deleted_at
    ? latest.deleted_placeholder || "Mensagem apagada"
    : buildMessagePreview({
        text: latest.text,
        media: parseJson(latest.media_json),
        messageType: latest.message_type,
      });
  await db.query(
    `
      UPDATE bot_whatsapp_conversations
      SET last_message_preview = ?,
          last_message_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
    `,
    [preview, latest.timestamp, userId, instanceId, chatJid],
  );
};

export const markWhatsappConversationMessageDeletedForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  messageKey: string,
  options: {
    deletedByJid?: string | null;
    deletedByName?: string | null;
    placeholder?: string | null;
    revealDeletedContent?: boolean;
  } = {},
): Promise<WhatsappConversationMessage | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  const normalizedKey = typeof messageKey === "string" ? messageKey.trim() : "";
  if (!chatJid || !normalizedKey) return null;
  const numericId = Number.parseInt(normalizedKey, 10);
  const db = getDb();
  const placeholder = options.placeholder?.trim() || "Mensagem apagada";
  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE bot_whatsapp_messages
      SET deleted_at = COALESCE(deleted_at, NOW()),
          deleted_by_jid = COALESCE(?, deleted_by_jid),
          deleted_by_name = COALESCE(NULLIF(?, ''), deleted_by_name),
          deleted_placeholder = ?,
          reveal_deleted_content = ?
      WHERE user_id = ?
        AND instance_id = ?
        AND chat_jid = ?
        AND (
          message_id = ?
          ${Number.isFinite(numericId) && numericId > 0 ? "OR id = ?" : ""}
        )
    `,
    Number.isFinite(numericId) && numericId > 0
      ? [
          options.deletedByJid ?? null,
          options.deletedByName ?? null,
          placeholder,
          options.revealDeletedContent === true ? 1 : 0,
          userId,
          instanceId,
          chatJid,
          normalizedKey,
          numericId,
        ]
      : [
          options.deletedByJid ?? null,
          options.deletedByName ?? null,
          placeholder,
          options.revealDeletedContent === true ? 1 : 0,
          userId,
          instanceId,
          chatJid,
          normalizedKey,
        ],
  );

  if (Number(result.affectedRows ?? 0) <= 0) {
    return null;
  }

  await refreshWhatsappConversationLastMessageForUser(
    userId,
    instanceId,
    chatJid,
  );
  const stored = await getWhatsappConversationMessageForUser(
    userId,
    instanceId,
    chatJid,
    normalizedKey,
  );
  return stored;
};

export const setWhatsappConversationMessageRevealDeletedForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  messageKey: string,
  revealDeletedContent: boolean,
): Promise<WhatsappConversationMessage | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  const normalizedKey = typeof messageKey === "string" ? messageKey.trim() : "";
  if (!chatJid || !normalizedKey) return null;
  const numericId = Number.parseInt(normalizedKey, 10);
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE bot_whatsapp_messages
      SET reveal_deleted_content = ?
      WHERE user_id = ?
        AND instance_id = ?
        AND chat_jid = ?
        AND deleted_at IS NOT NULL
        AND (
          message_id = ?
          ${Number.isFinite(numericId) && numericId > 0 ? "OR id = ?" : ""}
        )
    `,
    Number.isFinite(numericId) && numericId > 0
      ? [
          revealDeletedContent ? 1 : 0,
          userId,
          instanceId,
          chatJid,
          normalizedKey,
          numericId,
        ]
      : [
          revealDeletedContent ? 1 : 0,
          userId,
          instanceId,
          chatJid,
          normalizedKey,
        ],
  );

  if (Number(result.affectedRows ?? 0) <= 0) {
    return null;
  }

  await refreshWhatsappConversationLastMessageForUser(
    userId,
    instanceId,
    chatJid,
  );
  return getWhatsappConversationMessageForUser(
    userId,
    instanceId,
    chatJid,
    normalizedKey,
  );
};

export const markWhatsappConversationThreadDeletedInInstanceForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  options: {
    action?: string | null;
    title?: string | null;
  } = {},
): Promise<WhatsappConversationThread | null> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return null;
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_whatsapp_conversations
        (user_id, instance_id, chat_jid, chat_type, title, phone, deleted_in_instance, deleted_in_instance_at, deleted_in_instance_action)
      VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), ?)
      ON DUPLICATE KEY UPDATE
        deleted_in_instance = 1,
        deleted_in_instance_at = NOW(),
        deleted_in_instance_action = VALUES(deleted_in_instance_action),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      instanceId,
      chatJid,
      getWhatsappChatType(chatJid),
      options.title?.trim() || chatJid.split("@")[0] || chatJid,
      getWhatsappChatPhone(chatJid),
      options.action?.trim() || "delete",
    ],
  );
  return getWhatsappConversationThread(userId, instanceId, chatJid);
};

export const deleteWhatsappConversationMessageForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
  messageKey: string,
): Promise<boolean> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  const normalizedKey = typeof messageKey === "string" ? messageKey.trim() : "";
  if (!chatJid || !normalizedKey) return false;
  const numericId = Number.parseInt(normalizedKey, 10);
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      DELETE FROM bot_whatsapp_messages
      WHERE user_id = ?
        AND instance_id = ?
        AND chat_jid = ?
        AND (
          message_id = ?
          ${Number.isFinite(numericId) && numericId > 0 ? "OR id = ?" : ""}
        )
    `,
    Number.isFinite(numericId) && numericId > 0
      ? [userId, instanceId, chatJid, normalizedKey, numericId]
      : [userId, instanceId, chatJid, normalizedKey],
  );
  const deleted = Number(result.affectedRows ?? 0) > 0;
  if (deleted) {
    await refreshWhatsappConversationLastMessageForUser(
      userId,
      instanceId,
      chatJid,
    );
  }
  return deleted;
};

export const deleteWhatsappConversationThreadForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
): Promise<boolean> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return false;
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      DELETE FROM bot_whatsapp_conversations
      WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
    `,
    [userId, instanceId, chatJid],
  );
  return Number(result.affectedRows ?? 0) > 0;
};

export const clearWhatsappConversationMessagesForUser = async (
  userId: number,
  instanceId: number,
  chatJidRaw: string,
): Promise<boolean> => {
  await ensureWhatsappConversationTables();
  const chatJid = normalizeWhatsappChatJid(chatJidRaw);
  if (!chatJid) return false;
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      DELETE FROM bot_whatsapp_messages
      WHERE user_id = ? AND instance_id = ? AND chat_jid = ?
    `,
    [userId, instanceId, chatJid],
  );
  await refreshWhatsappConversationLastMessageForUser(
    userId,
    instanceId,
    chatJid,
  );
  return Number(result.affectedRows ?? 0) > 0;
};

export const deleteWhatsappConversationsForInstance = async (
  userId: number,
  instanceId: number,
): Promise<{
  messagesDeleted: number;
  threadsDeleted: number;
  eventsDeleted: number;
  notificationsDeleted: number;
}> => {
  if (
    !Number.isFinite(userId) ||
    userId <= 0 ||
    !Number.isFinite(instanceId) ||
    instanceId <= 0
  ) {
    return {
      messagesDeleted: 0,
      threadsDeleted: 0,
      eventsDeleted: 0,
      notificationsDeleted: 0,
    };
  }

  await ensureWhatsappConversationTables();
  const db = getDb();
  const [messagesResult] = await db.query<ResultSetHeader>(
    `
      DELETE FROM bot_whatsapp_messages
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );
  const [eventsResult] = await db.query<ResultSetHeader>(
    `
      DELETE FROM bot_whatsapp_realtime_events
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );
  const [notificationsResult] = await db.query<ResultSetHeader>(
    `
      DELETE FROM bot_whatsapp_conversation_notifications
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );
  const [threadsResult] = await db.query<ResultSetHeader>(
    `
      DELETE FROM bot_whatsapp_conversations
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );

  return {
    messagesDeleted: Number(messagesResult.affectedRows ?? 0),
    threadsDeleted: Number(threadsResult.affectedRows ?? 0),
    eventsDeleted: Number(eventsResult.affectedRows ?? 0),
    notificationsDeleted: Number(notificationsResult.affectedRows ?? 0),
  };
};

export const cleanupExpiredFreeWhatsappConversationHistory = async (
  maxAgeHours = 24 * 365 * 10,
): Promise<{
  messagesDeleted: number;
  threadsDeleted: number;
  eventsDeleted: number;
}> => {
  await ensureWhatsappConversationTables();
  await ensureUserMediaStorageTables();
  const db = getDb();
  const safeHours = Math.max(1, Math.floor(Number(maxAgeHours) || 24));
  const cutoffExpr = `DATE_SUB(NOW(), INTERVAL ${safeHours} HOUR)`;

  const [messagesResult] = await db.query<ResultSetHeader>(
    `
      DELETE m
      FROM bot_whatsapp_messages m
      WHERE m.timestamp < ${cutoffExpr}
        AND NOT EXISTS (
          SELECT 1
          FROM user_media_storage_entitlements e
          WHERE e.user_id = m.user_id
            AND e.expires_at > NOW()
        )
    `,
  );

  const [eventsResult] = await db.query<ResultSetHeader>(
    `
      DELETE e
      FROM bot_whatsapp_realtime_events e
      WHERE e.created_at < ${cutoffExpr}
        AND NOT EXISTS (
          SELECT 1
          FROM user_media_storage_entitlements s
          WHERE s.user_id = e.user_id
            AND s.expires_at > NOW()
        )
    `,
  );

  const [threadsResult] = await db.query<ResultSetHeader>(
    `
      DELETE c
      FROM bot_whatsapp_conversations c
      LEFT JOIN bot_whatsapp_messages m
        ON m.user_id = c.user_id
       AND m.instance_id = c.instance_id
       AND m.chat_jid = c.chat_jid
      WHERE m.id IS NULL
        AND COALESCE(c.last_message_at, c.updated_at) < ${cutoffExpr}
        AND NOT EXISTS (
          SELECT 1
          FROM user_media_storage_entitlements e
          WHERE e.user_id = c.user_id
            AND e.expires_at > NOW()
        )
    `,
  );

  return {
    messagesDeleted: Number(messagesResult.affectedRows ?? 0),
    threadsDeleted: Number(threadsResult.affectedRows ?? 0),
    eventsDeleted: Number(eventsResult.affectedRows ?? 0),
  };
};
