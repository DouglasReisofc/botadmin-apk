import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, refreshInstanceStatus } from "lib/bot-instances";
import { getInstanceSettings } from "lib/bot-instance-settings";
import {
  buildLegacyWhatsappMediaCacheKey,
  buildWhatsappMediaCacheKey,
  getCachedMediaFromR2,
  putCachedMediaInR2,
} from "lib/r2-media-cache";
import { downloadChatMedia, getChatMessage } from "lib/wuzapi";
import { resolveChatConversationAccess } from "lib/whatsapp-conversation-access";
import {
  getAdminMediaStorageSummary,
  getUserMediaStorageSummary,
  recordUserMediaStorageObject,
} from "lib/user-media-storage";
import {
  getWhatsappConversationMessageForUser,
  getWhatsappViewOnceAccess,
  normalizeWhatsappChatJid,
  updateWhatsappConversationMessageMediaForUser,
} from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string; messageId: string }>;
};

type EphemeralMedia = { buffer: Buffer; mimeType: string; expiresAt: number };
const ephemeralMediaCache = new Map<string, EphemeralMedia>();
const EPHEMERAL_MEDIA_TTL_MS = 10 * 60 * 1000;
const EPHEMERAL_MEDIA_MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const EPHEMERAL_MEDIA_MAX_BYTES = 64 * 1024 * 1024;
let ephemeralMediaBytes = 0;

const readEphemeralMedia = (key: string) => {
  const entry = ephemeralMediaCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    ephemeralMediaCache.delete(key);
    ephemeralMediaBytes = Math.max(0, ephemeralMediaBytes - entry.buffer.length);
    return null;
  }
  return entry;
};

const writeEphemeralMedia = (key: string, buffer: Buffer, mimeType: string) => {
  if (buffer.length > EPHEMERAL_MEDIA_MAX_ENTRY_BYTES) return;
  const previous = ephemeralMediaCache.get(key);
  if (previous) ephemeralMediaBytes = Math.max(0, ephemeralMediaBytes - previous.buffer.length);
  while (ephemeralMediaBytes + buffer.length > EPHEMERAL_MEDIA_MAX_BYTES && ephemeralMediaCache.size > 0) {
    const oldestKey = ephemeralMediaCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = ephemeralMediaCache.get(oldestKey);
    ephemeralMediaCache.delete(oldestKey);
    ephemeralMediaBytes = Math.max(0, ephemeralMediaBytes - (oldest?.buffer.length ?? 0));
  }
  ephemeralMediaCache.set(key, { buffer, mimeType, expiresAt: Date.now() + EPHEMERAL_MEDIA_TTL_MS });
  ephemeralMediaBytes += buffer.length;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const mediaString = (media: Record<string, unknown> | null | undefined, ...keys: string[]) => {
  if (!media) return null;
  for (const key of keys) {
    const value = media[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const normalizeMediaByteString = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Buffer.isBuffer(value)) return value.length > 0 ? value.toString("base64") : null;
  if (value instanceof Uint8Array) return value.length > 0 ? Buffer.from(value).toString("base64") : null;
  if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return value.length > 0 ? Buffer.from(value as number[]).toString("base64") : null;
  }
  const record = toRecord(value);
  const data = record?.data ?? record?.Data;
  if (Array.isArray(data) && data.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return data.length > 0 ? Buffer.from(data as number[]).toString("base64") : null;
  }
  return null;
};

const mediaByteString = (media: Record<string, unknown> | null | undefined, ...keys: string[]) => {
  if (!media) return null;
  for (const key of keys) {
    const direct = normalizeMediaByteString(media[key]);
    if (direct) return direct;
    const lowered = key.toLowerCase();
    for (const [entryKey, value] of Object.entries(media)) {
      if (entryKey.toLowerCase() === lowered) {
        const normalized = normalizeMediaByteString(value);
        if (normalized) return normalized;
      }
    }
  }
  return null;
};

const mediaNumber = (media: Record<string, unknown> | null | undefined, ...keys: string[]) => {
  if (!media) return null;
  for (const key of keys) {
    const value = media[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};

const inferMediaKind = (...values: unknown[]): "image" | "video" | "audio" | "document" | "sticker" | "" => {
  const source = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  if (!source) return "";
  if (/(sticker|webp|application\/was)/i.test(source)) return "sticker";
  if (/(audio|ptt|opus|oga|ogg|mp3|m4a|wav|aac)/i.test(source)) return "audio";
  if (/(video|ptv|gif|mp4|m4v|mov|3gp|webm)/i.test(source)) return "video";
  if (/(image|photo|jpeg|jpg|png|webp)/i.test(source)) return "image";
  if (/(document|file|pdf|docx?|xlsx?|zip)/i.test(source)) return "document";
  return "";
};

const inferMimeType = (current: string, kind: string, ...values: unknown[]) => {
  const normalized = current.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return current;
  const source = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  if (kind === "audio") {
    if (source.includes(".mp3") || source.includes("mpeg")) return "audio/mpeg";
    if (source.includes(".m4a") || source.includes("audio/mp4")) return "audio/mp4";
    if (source.includes(".wav")) return "audio/wav";
    return "audio/ogg";
  }
  if (kind === "video") {
    if (source.includes(".webm")) return "video/webm";
    if (source.includes(".mov")) return "video/quicktime";
    return "video/mp4";
  }
  if (kind === "image" || kind === "sticker") {
    if (source.includes(".png")) return "image/png";
    if (source.includes(".webp") || kind === "sticker") return "image/webp";
    if (source.includes(".gif")) return "image/gif";
    return "image/jpeg";
  }
  return current || "application/octet-stream";
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getLookupMediaRecord = (lookup: unknown): Record<string, unknown> | null => {
  const root = toRecord(lookup);
  if (!root) return null;
  const direct = toRecord(root.Media ?? root.media);
  if (direct) return direct;
  const stack: unknown[] = [root.Message, root.message, root];
  const seen = new Set<unknown>();
  const mediaKeys = [
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "stickerMessage",
    "documentMessage",
    "ptvMessage",
    "image",
    "video",
    "audio",
    "sticker",
    "document",
    "media",
    "Media",
  ];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    for (const key of mediaKeys) {
      const candidate = toRecord(record[key]);
      if (candidate && (mediaString(candidate, "directPath", "DirectPath", "url", "URL", "Url") || mediaByteString(candidate, "mediaKey", "MediaKey"))) {
        return candidate;
      }
    }
    if (mediaString(record, "directPath", "DirectPath", "url", "URL", "Url") || mediaByteString(record, "mediaKey", "MediaKey")) {
      return record;
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
};

const safeDecodeURIComponent = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const candidatePublicUploadUrl = (candidate: string | null | undefined): string | null => {
  if (!candidate) return null;
  const cleanCandidate = candidate.trim();
  if (!cleanCandidate) return null;
  const publicRoot = resolve(process.cwd(), "public");
  const pathOnly = cleanCandidate.split(/[?#]/)[0] ?? "";
  if (!pathOnly.startsWith("/uploads/")) return null;
  const relativePath = safeDecodeURIComponent(pathOnly).replace(/^\/+/, "");
  const absolutePath = resolve(publicRoot, relativePath);
  if (absolutePath === publicRoot || !absolutePath.startsWith(`${publicRoot}${sep}`)) return null;
  return existsSync(absolutePath) ? pathOnly : null;
};

const resolveLocalPublicMediaUrl = (media: Record<string, unknown> | null | undefined): string | null => {
  if (!media) return null;
  const candidates: string[] = [];
  for (const key of ["url", "mediaUrl", "MediaUrl", "URL", "publicUrl", "localUrl", "path", "filePath"]) {
    const value = mediaString(media, key);
    if (!value) continue;
    if (value.startsWith("/uploads/")) {
      candidates.push(value);
      continue;
    }
    const marker = "/public/uploads/";
    const markerIndex = value.indexOf(marker);
    if (markerIndex >= 0) {
      candidates.push(value.slice(markerIndex + "/public".length));
    }
  }

  const filename = mediaString(media, "filename", "fileName", "FileName");
  if (filename) {
    const safeFilename = basename(filename.replace(/\\/g, "/")).trim();
    if (safeFilename && safeFilename !== "." && safeFilename !== "..") {
      const encodedFilename = encodeURIComponent(safeFilename);
      candidates.push(
        `/uploads/admin/bot/${encodedFilename}`,
        `/uploads/bot/${encodedFilename}`,
        `/uploads/${encodedFilename}`,
      );
    }
  }

  for (const candidate of candidates) {
    const publicUrl = candidatePublicUploadUrl(candidate);
    if (publicUrl) return publicUrl;
  }
  return null;
};

const bufferFromDataUrl = (value: string) => {
  const match = value.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
};

const isPlainRemoteMediaUrl = (value: string | null | undefined) => {
  if (!value) return false;
  if (/mmg\.whatsapp\.net/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const downloadPlainRemoteMedia = async (
  value: string,
  fallbackMimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> => {
  const response = await fetch(value, {
    headers: {
      Accept: "*/*",
      "User-Agent": "BotAdmin/FlutterMediaProxy",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar mídia pública (${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType && contentType !== "application/octet-stream" ? contentType : fallbackMimeType,
  };
};

const mediaResponse = (
  buffer: Buffer | Uint8Array,
  params: {
    mimeType: string;
    filename?: string | null;
    cache: "data-url" | "r2" | "origin";
  },
  request?: Request,
) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const headers: Record<string, string> = {
    "Content-Type": params.mimeType || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control":
      params.cache === "r2"
        ? "private, max-age=31536000, immutable"
        : "private, max-age=300",
    "X-BotAdmin-Media-Cache": params.cache,
  };
  if (params.filename) {
    headers["Content-Disposition"] = `inline; filename="${params.filename.replace(/"/g, "")}"`;
  }
  const size = bytes.byteLength;
  const range = request?.headers.get("range")?.trim();
  if (range && size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
    if (match) {
      const rawStart = match[1] ?? "";
      const rawEnd = match[2] ?? "";
      let start = rawStart ? Number.parseInt(rawStart, 10) : 0;
      let end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
      if (!rawStart && rawEnd) {
        const suffixLength = Number.parseInt(rawEnd, 10);
        start = Number.isFinite(suffixLength) ? Math.max(size - suffixLength, 0) : 0;
        end = size - 1;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
        return new Response(null, {
          status: 416,
          headers: {
            ...headers,
            "Content-Range": `bytes */${size}`,
            "Content-Length": "0",
          },
        });
      }
      end = Math.min(end, size - 1);
      const chunk = Uint8Array.from(bytes.slice(start, end + 1));
      return new Response(chunk.buffer, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(chunk.byteLength),
        },
      });
    }
  }
  const responseBytes = Uint8Array.from(bytes);
  return new Response(responseBytes.buffer, {
    headers: {
      ...headers,
      "Content-Length": String(size),
    },
  });
};

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(params.instanceId);
    const chatJid = normalizeWhatsappChatJid(decodeURIComponent(params.chatJid));
    const messageKey = decodeURIComponent(params.messageId || "").trim();
    if (!instanceId || !chatJid || !messageKey) {
      return NextResponse.json({ message: "Mídia inválida." }, { status: 400 });
    }
    const urlParams = new URL(request.url).searchParams;
    const forceRefresh = ["1", "true", "yes", "on"].includes(
      (urlParams.get("refresh") || urlParams.get("force") || "").trim().toLowerCase(),
    );

    const access = await resolveChatConversationAccess(user.id, instanceId, chatJid);
    if (!access) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }
    const { instance, storageUserId } = access;

    const stored = await getWhatsappConversationMessageForUser(storageUserId, instance.id, chatJid, messageKey);
    if (!stored) {
      return NextResponse.json({ message: "Mídia não encontrada." }, { status: 404 });
    }
    const viewOnceAccess = await getWhatsappViewOnceAccess({
      userId: storageUserId,
      instanceId: instance.id,
      chatJid,
      messageKey,
    });
    if (!viewOnceAccess.allowed) {
      return NextResponse.json(
        { message: viewOnceAccess.status === 410 ? "Esta mídia de visualização única já foi aberta." : "Abra esta mídia pela conversa." },
        { status: viewOnceAccess.status },
      );
    }
    const storedMedia: Record<string, unknown> = stored.media ?? {};
    const nestedInteractiveMedia = getLookupMediaRecord(storedMedia);
    let media: Record<string, unknown> = nestedInteractiveMedia
      ? { ...storedMedia, ...nestedInteractiveMedia }
      : storedMedia;

    const dataUrl = mediaString(media, "dataUrl");
    if (dataUrl?.startsWith("data:")) {
      const parsed = bufferFromDataUrl(dataUrl);
      if (parsed) {
        return mediaResponse(parsed.buffer, {
          mimeType: parsed.mimeType,
          filename: mediaString(media, "filename", "fileName", "FileName"),
          cache: "data-url",
        }, request);
      }
    }

    let url = mediaString(media, "url", "mediaUrl", "MediaUrl", "URL");
    let directPath = mediaString(media, "directPath", "DirectPath");
    let mediaKey = mediaByteString(media, "mediaKey", "MediaKey");
    let mimeType = mediaString(media, "mimeType", "MimeType", "mimetype", "Mimetype") ?? "application/octet-stream";
    let filename = mediaString(media, "filename", "fileName", "FileName") ?? "whatsapp-media";
    let inferredKind = inferMediaKind(
      media.mediaType,
      media.kind,
      media.type,
      stored.messageType,
      mimeType,
      filename,
      url,
    );
    mimeType = inferMimeType(mimeType, inferredKind, stored.messageType, filename, url);
    let cacheKey = buildWhatsappMediaCacheKey({
      userId: storageUserId,
      instanceId: instance.id,
      chatJid,
      messageKey: stored.messageId ?? messageKey,
      mimeType,
    });
    let legacyCacheKey = buildLegacyWhatsappMediaCacheKey({
      instanceId: instance.id,
      chatJid,
      messageKey: stored.messageId ?? messageKey,
      mimeType,
    });

    const refreshDerivedMediaFields = () => {
      url = mediaString(media, "url", "mediaUrl", "MediaUrl", "URL");
      directPath = mediaString(media, "directPath", "DirectPath");
      mediaKey = mediaByteString(media, "mediaKey", "MediaKey");
      mimeType = mediaString(media, "mimeType", "MimeType", "mimetype", "Mimetype") ?? mimeType;
      filename = mediaString(media, "filename", "fileName", "FileName") ?? filename;
      inferredKind = inferMediaKind(
        media.mediaType,
        media.kind,
        media.type,
        stored.messageType,
        mimeType,
        filename,
        url,
      );
      mimeType = inferMimeType(mimeType, inferredKind, stored.messageType, filename, url);
      cacheKey = buildWhatsappMediaCacheKey({
        userId: storageUserId,
        instanceId: instance.id,
        chatJid,
        messageKey: stored.messageId ?? messageKey,
        mimeType,
      });
      legacyCacheKey = buildLegacyWhatsappMediaCacheKey({
        instanceId: instance.id,
        chatJid,
        messageKey: stored.messageId ?? messageKey,
        mimeType,
      });
    };

    const mergeMediaState = async (nextMedia: Record<string, unknown> | null | undefined): Promise<boolean> => {
      if (!nextMedia || Object.keys(nextMedia).length === 0) return false;
      const before = JSON.stringify(media);
      media = { ...media, ...nextMedia };
      refreshDerivedMediaFields();
      const changed = JSON.stringify(media) !== before;
      if (changed) {
        await updateWhatsappConversationMessageMediaForUser(
          storageUserId,
          instance.id,
          chatJid,
          stored.messageId ?? messageKey,
          media,
        ).catch((updateError) => {
          console.warn("Failed to update WhatsApp message media metadata", updateError);
        });
      }
      return changed;
    };

    const redirectToResolvedMediaUrl = async (options: { allowExternal?: boolean } = {}) => {
      if (options.allowExternal && url && !/mmg\.whatsapp\.net/i.test(url) && !directPath && !mediaKey) {
        return NextResponse.redirect(new URL(url, request.url));
      }
      const localPublicUrl = resolveLocalPublicMediaUrl(media);
      if (!localPublicUrl || directPath || mediaKey) return null;
      if (url !== localPublicUrl) {
        await mergeMediaState({ url: localPublicUrl });
      }
      return NextResponse.redirect(new URL(localPublicUrl, request.url));
    };

    const mediaRedirect = forceRefresh ? null : await redirectToResolvedMediaUrl();
    if (mediaRedirect) return mediaRedirect;

    const initialCacheKey = cacheKey;
    const cachedMedia = forceRefresh
      ? null
      : (await getCachedMediaFromR2(cacheKey))
        ?? (legacyCacheKey !== cacheKey ? await getCachedMediaFromR2(legacyCacheKey) : null);
    if (cachedMedia) {
      return mediaResponse(cachedMedia.buffer, {
        mimeType: cachedMedia.contentType || mimeType,
        filename,
        cache: "r2",
      }, request);
    }

    // A short-lived process cache prevents repeatedly downloading the same
    // media while a user scrolls or opens a conversation in two tabs. It is
    // deliberately bounded and is not a replacement for the durable R2 plan.
    const ephemeralKey = `${storageUserId}:${instance.id}:${chatJid}:${stored.messageId ?? messageKey}`;
    if (!forceRefresh) {
      const cachedEphemeral = readEphemeralMedia(ephemeralKey);
      if (cachedEphemeral) {
        return mediaResponse(cachedEphemeral.buffer, {
          mimeType: cachedEphemeral.mimeType,
          filename,
          cache: "origin",
        }, request);
      }
    }

    if (!instance.serverBaseUrl) {
      return NextResponse.json({ message: "Servidor da instância não configurado." }, { status: 500 });
    }

    const sessionStatus = await refreshInstanceStatus(storageUserId, instance.id);
    if (sessionStatus !== "conectado") {
      return NextResponse.json({ message: "Conecte a instância para baixar a mídia." }, { status: 409 });
    }

    const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
    let easyZapLookupAttempted = false;
    const refreshMediaFromEasyZap = async (): Promise<boolean> => {
      if (easyZapLookupAttempted) return false;
      easyZapLookupAttempted = true;
      try {
        const lookup = await getChatMessage(client, {
          chatId: chatJid,
          messageId: stored.messageId ?? messageKey,
          sender: stored.senderJid,
        });
        const lookupMedia = getLookupMediaRecord(lookup);
        return lookupMedia ? mergeMediaState(lookupMedia) : false;
      } catch (lookupError) {
        console.warn("Failed to refresh WhatsApp media metadata from EasyZap", lookupError);
        return false;
      }
    };

    if (forceRefresh) {
      await refreshMediaFromEasyZap();
      const refreshedRedirect = await redirectToResolvedMediaUrl();
      if (refreshedRedirect) return refreshedRedirect;
    }

    if (!directPath || !mediaKey) {
      await refreshMediaFromEasyZap();
      const refreshedRedirect = await redirectToResolvedMediaUrl();
      if (refreshedRedirect) return refreshedRedirect;
    }

    if (cacheKey !== initialCacheKey) {
      const updatedCachedMedia = await getCachedMediaFromR2(cacheKey)
        ?? (legacyCacheKey !== cacheKey ? await getCachedMediaFromR2(legacyCacheKey) : null);
      if (updatedCachedMedia) {
        return mediaResponse(updatedCachedMedia.buffer, {
          mimeType: updatedCachedMedia.contentType || mimeType,
          filename,
          cache: "r2",
        }, request);
      }
    }

    if (!directPath && !mediaKey && !url) {
      await refreshMediaFromEasyZap();
      const refreshedRedirect = await redirectToResolvedMediaUrl({ allowExternal: true });
      if (refreshedRedirect) return refreshedRedirect;
    }

    if (!directPath && !mediaKey && !url) {
      return NextResponse.json(
        { message: "A EasyZap não retornou os metadados dessa mídia." },
        { status: 404 },
      );
    }

    if (!directPath && !mediaKey && isPlainRemoteMediaUrl(url)) {
      const remote = await downloadPlainRemoteMedia(url!, mimeType);
      return mediaResponse(remote.buffer, {
        mimeType: remote.mimeType,
        filename,
        cache: "origin",
      }, request);
    }

    const buildDownloadRequest = () => ({
      chatId: chatJid,
      directPath,
      mediaKey,
      url,
      mimeType,
      mediaType: String(media.mediaType ?? media.kind ?? media.type ?? inferredKind ?? stored.messageType ?? ""),
      fileEncSHA256: mediaByteString(media, "fileEncSHA256", "FileEncSHA256", "fileEncSha256"),
      fileSHA256: mediaByteString(media, "fileSHA256", "FileSHA256", "fileSha256"),
      fileLength: mediaNumber(media, "fileLength", "FileLength"),
      forceDocument: String(media.mediaType ?? media.kind ?? "").toLowerCase().includes("document"),
    });

    let buffer: Buffer;
    try {
      buffer = await downloadChatMedia(client, buildDownloadRequest());
    } catch (downloadError) {
      const refreshed = await refreshMediaFromEasyZap();
      const refreshedRedirect = await redirectToResolvedMediaUrl();
      if (refreshedRedirect) return refreshedRedirect;
      if (!refreshed || (!directPath && !mediaKey && !url)) {
        throw downloadError;
      }
      buffer = await downloadChatMedia(client, buildDownloadRequest());
    }

    const [settings, storageSummary] = await Promise.all([
      getInstanceSettings(instance.id).catch(() => null),
      (user.role === "admin" && storageUserId === user.id
        ? getAdminMediaStorageSummary(storageUserId)
        : getUserMediaStorageSummary(storageUserId)
      ).catch(() => null),
    ]);
    const canPersistInR2 =
      settings?.commandToggles.persistentMediaStorage === true &&
      storageSummary?.hasActivePlan === true &&
      storageSummary.quotaBytes > 0 &&
      storageSummary.remainingBytes >= buffer.length;
    const cachedInR2 = canPersistInR2
      ? await putCachedMediaInR2(cacheKey, buffer, mimeType).catch((cacheError) => {
          console.warn("Failed to persist WhatsApp media in R2", cacheError);
          return false;
        })
      : false;
    if (cachedInR2) {
      await recordUserMediaStorageObject({
        userId: storageUserId,
        objectKey: cacheKey,
        bytes: buffer.length,
        contentType: mimeType,
        instanceId: instance.id,
        chatJid,
        messageKey: stored.messageId ?? messageKey,
      }).catch((storageError) => {
        console.warn("Failed to update WhatsApp media storage usage", storageError);
      });
    }

    writeEphemeralMedia(ephemeralKey, buffer, mimeType);

    return mediaResponse(buffer, {
      mimeType,
      filename,
      cache: "origin",
    }, request);
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to load WhatsApp message media", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a mídia." },
      { status: 500 },
    );
  }
}
