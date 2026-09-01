import { randomBytes } from "node:crypto";

import { getInstanceForUser } from "lib/bot-instances";
import type { WhatsappReceivedStatus } from "lib/whatsapp-conversations";
import { getChatMessage, requestChatHistorySync } from "lib/wuzapi";

type StatusSyncResult = {
  requested: boolean;
  throttled: boolean;
};

const runtime = globalThis as typeof globalThis & {
  __whatsappStatusSyncAt?: Map<string, number>;
  __whatsappStatusSyncInflight?: Map<string, Promise<StatusSyncResult>>;
  __whatsappStatusPreviewCache?: Map<string, StatusPreviewCacheEntry>;
};

type StatusPreviewCacheEntry = {
  expiresAt: number;
  type: string | null;
  mimeType: string | null;
  text: string | null;
  caption: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  fontStyle: string | null;
  allowReshare: boolean | null;
  hasMedia: boolean;
};

const syncAt = runtime.__whatsappStatusSyncAt ?? new Map<string, number>();
const inflight =
  runtime.__whatsappStatusSyncInflight ??
  new Map<string, Promise<StatusSyncResult>>();
runtime.__whatsappStatusSyncAt = syncAt;
runtime.__whatsappStatusSyncInflight = inflight;
const previewCache =
  runtime.__whatsappStatusPreviewCache ??
  new Map<string, StatusPreviewCacheEntry>();
runtime.__whatsappStatusPreviewCache = previewCache;

const STATUS_SYNC_TTL_MS = 45_000;

/**
 * Requests the latest status history directly from the paired primary device.
 * This is an on-demand WhatsApp history sync initiated when the status screen
 * opens; it does not install a timer, heartbeat, or recurring background job.
 */
export const requestWhatsappStatusSync = async (
  userId: number,
  instanceId: number,
  options?: { force?: boolean; count?: number },
): Promise<StatusSyncResult> => {
  if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(instanceId) || instanceId <= 0) {
    return { requested: false, throttled: false };
  }
  const key = `${userId}:${instanceId}`;
  const now = Date.now();
  if (!options?.force && now - (syncAt.get(key) ?? 0) < STATUS_SYNC_TTL_MS) {
    return { requested: false, throttled: true };
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<StatusSyncResult> => {
    const instance = await getInstanceForUser(userId, instanceId);
    if (!instance?.token || !instance.serverBaseUrl) {
      return { requested: false, throttled: false };
    }
    await requestChatHistorySync(
      {
        baseUrl: instance.serverBaseUrl,
        token: instance.token,
        conversation: {
          userId,
          instanceId,
          instanceName: instance.name,
          instancePhone: instance.phone,
        },
      },
      {
        chatJid: "status@broadcast",
        // The protocol returns messages immediately before this boundary. A
        // fresh synthetic boundary asks the primary device for the newest set,
        // including updates whose webhook was missed by BotAdmin.
        oldestMessageId: randomBytes(10).toString("hex").toUpperCase(),
        oldestMessageFromMe: false,
        oldestMessageTimestampMs: Date.now() + 60_000,
        count: Math.min(Math.max(options?.count ?? 100, 1), 100),
      },
    );
    syncAt.set(key, Date.now());
    return { requested: true, throttled: false };
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
};

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const firstBoolean = (...values: unknown[]): boolean | null => {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
};

const argbColor = (value: unknown): string | null => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return `#${(Math.trunc(parsed) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
};

const resolveLookupPreview = (
  lookup: Awaited<ReturnType<typeof getChatMessage>>,
): Omit<StatusPreviewCacheEntry, "expiresAt"> => {
  const media = recordValue(lookup?.Media);
  const message = recordValue(lookup?.Message);
  const image = recordValue(message.imageMessage);
  const video = recordValue(message.videoMessage ?? message.ptvMessage);
  const audio = recordValue(message.audioMessage);
  const document = recordValue(message.documentMessage ?? message.documentWithCaptionMessage);
  const sticker = recordValue(message.stickerMessage);
  const extended = recordValue(message.extendedTextMessage);
  const content = Object.keys(extended).length > 0
    ? extended
    : Object.keys(image).length > 0
      ? image
      : Object.keys(video).length > 0
        ? video
        : Object.keys(audio).length > 0
          ? audio
          : document;
  const context = recordValue(content.contextInfo);
  const audience = recordValue(context.statusAudienceMetadata);
  const mimeType = firstText(media.mimetype, media.mimeType);
  const rawType = firstText(media.type, mimeType);
  const type = rawType?.toLowerCase().includes("video") || Object.keys(video).length > 0
    ? "video"
    : rawType?.toLowerCase().includes("image") || Object.keys(image).length > 0
      ? "image"
      : rawType?.toLowerCase().includes("audio") || Object.keys(audio).length > 0
        ? "audio"
        : rawType?.toLowerCase().includes("document") || Object.keys(document).length > 0
          ? "document"
          : rawType?.toLowerCase().includes("sticker") || Object.keys(sticker).length > 0
            ? "sticker"
            : firstText(message.conversation, extended.text)
              ? "text"
              : null;
  return {
    type,
    mimeType,
    text: firstText(message.conversation, extended.text),
    caption: firstText(image.caption, video.caption, document.caption, media.caption),
    backgroundColor: argbColor(extended.backgroundArgb),
    textColor: argbColor(extended.textArgb),
    fontStyle: firstText(extended.font),
    allowReshare: firstBoolean(
      content.allowReshare,
      content.allow_reshare,
      context.allowReshare,
      audience.allowReshare,
    ),
    hasMedia: ["image", "video", "audio", "document", "sticker"].includes(type ?? ""),
  };
};

export const resolveWhatsappStatusPreviews = async (
  userId: number,
  instanceId: number,
  statuses: WhatsappReceivedStatus[],
): Promise<WhatsappReceivedStatus[]> => {
  const unresolved = statuses
    .filter(
      (status) =>
        status.messageId &&
        (status.type === "unknown" ||
          (!status.mediaUrl && !status.text && !status.caption) ||
          ((status.type === "text" || Boolean(status.text)) &&
            (!status.backgroundColor || !status.textColor || !status.fontStyle))),
    )
    .slice(0, 40);
  if (unresolved.length === 0) return statuses;
  const instance = await getInstanceForUser(userId, instanceId);
  if (!instance?.serverBaseUrl || !instance.token) return statuses;
  const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
  const resolved = new Map<number, StatusPreviewCacheEntry>();

  for (let offset = 0; offset < unresolved.length; offset += 4) {
    await Promise.all(
      unresolved.slice(offset, offset + 4).map(async (status) => {
        const cacheKey = `${instanceId}:${status.messageId}`;
        const cached = previewCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          resolved.set(status.id, cached);
          return;
        }
        try {
          const lookup = await getChatMessage(client, {
            chatId: "status@broadcast",
            messageId: status.messageId!,
            sender: status.authorJid,
          });
          const preview = resolveLookupPreview(lookup);
          const entry: StatusPreviewCacheEntry = {
            ...preview,
            expiresAt: Date.now() + (preview.type ? 5 * 60_000 : 30_000),
          };
          previewCache.set(cacheKey, entry);
          resolved.set(status.id, entry);
        } catch (error) {
          console.warn("[bot-status] failed to resolve status preview", {
            instanceId,
            messageId: status.messageId,
            error,
          });
        }
      }),
    );
  }

  return statuses
    .map((status) => {
      const preview = resolved.get(status.id);
      if (!preview) return status;
      return {
        ...status,
        type: preview.type ?? status.type,
        mimeType: status.mimeType ?? preview.mimeType,
        text: status.text ?? preview.text,
        caption: status.caption ?? preview.caption,
        backgroundColor: status.backgroundColor ?? preview.backgroundColor,
        textColor: status.textColor ?? preview.textColor,
        fontStyle: status.fontStyle ?? preview.fontStyle,
        allowReshare: status.allowReshare ?? preview.allowReshare,
        mediaUrl:
          status.mediaUrl ??
          (preview.hasMedia && status.messageId
            ? `/api/bot-instances/${instanceId}/whatsapp-conversations/${encodeURIComponent("status@broadcast")}/messages/${encodeURIComponent(status.messageId)}/media`
            : null),
      };
    })
    .filter(
      (status) =>
        status.type !== "unknown" ||
        Boolean(status.mediaUrl || status.text || status.caption),
    );
};
