/**
 * Short-lived cache for media sent by the dashboard.
 *
 * WhatsApp does not return a durable CDN URL for every outgoing sticker.  In
 * that case the conversation row is still useful, but the media endpoint has
 * no bytes to serve after the optimistic preview expires.  Keeping the
 * original bytes for a bounded period lets the sender (and the same account
 * in another tab) reopen the sticker without turning the message into a
 * broken document card.  This cache is intentionally bounded; durable media
 * retention remains the responsibility of the configured R2 storage path.
 */

type OutgoingMediaEntry = {
  buffer: Buffer;
  mimeType: string;
  filename: string | null;
  expiresAt: number;
};

export type OutgoingMediaCacheKey = {
  userId: string;
  instanceId: number;
  chatJid: string;
  messageId: string;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 256;

const entries = new Map<string, OutgoingMediaEntry>();
let totalBytes = 0;

const keyFor = ({ userId, instanceId, chatJid, messageId }: OutgoingMediaCacheKey) =>
  [userId, instanceId, chatJid, messageId]
    .map((part) => String(part).trim())
    .join("\u001f");

const remove = (key: string) => {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  totalBytes = Math.max(0, totalBytes - entry.buffer.length);
};

const prune = (now = Date.now()) => {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) remove(key);
  }
  while (entries.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    remove(oldestKey);
  }
};

export const cacheOutgoingWhatsappMedia = ({
  key,
  buffer,
  mimeType,
  filename,
}: {
  key: OutgoingMediaCacheKey;
  buffer: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}): void => {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return;
  if (buffer.length > MAX_ENTRY_BYTES) return;

  const normalizedMime =
    typeof mimeType === "string" && mimeType.trim()
      ? mimeType.trim().toLowerCase()
      : "image/webp";
  const normalizedFilename =
    typeof filename === "string" && filename.trim() ? filename.trim() : null;
  const cacheKey = keyFor(key);
  remove(cacheKey);
  entries.set(cacheKey, {
    // Copy the Buffer so callers can safely release or reuse their upload
    // buffer after this request finishes.
    buffer: Buffer.from(buffer),
    mimeType: normalizedMime,
    filename: normalizedFilename,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  totalBytes += buffer.length;
  prune();
};

export const getOutgoingWhatsappMedia = (
  key: OutgoingMediaCacheKey,
): { buffer: Buffer; mimeType: string; filename: string | null } | null => {
  const cacheKey = keyFor(key);
  const entry = entries.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    remove(cacheKey);
    return null;
  }
  // Move hot entries to the end so eviction behaves like a small LRU cache.
  entries.delete(cacheKey);
  entries.set(cacheKey, entry);
  return entry;
};

export const clearOutgoingWhatsappMedia = (key: OutgoingMediaCacheKey): void => {
  remove(keyFor(key));
};
