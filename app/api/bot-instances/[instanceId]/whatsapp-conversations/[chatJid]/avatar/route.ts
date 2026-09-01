import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError } from "lib/bot-instances";
import {
  buildWhatsappAvatarCacheKey,
  getCachedMediaFromR2,
  putCachedMediaInR2,
  type CachedMedia,
} from "lib/r2-media-cache";
import { resolveChatConversationAccess } from "lib/whatsapp-conversation-access";
import {
  getWhatsappChatPhone,
  getWhatsappChatType,
  normalizeWhatsappChatJid,
  upsertWhatsappConversation,
} from "lib/whatsapp-conversations";
import { getUserAvatar, getUserChannel } from "lib/wuzapi";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseWhatsappAvatarUrl = (value: string | null): URL | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname.toLowerCase() !== "pps.whatsapp.net") return null;
    return url;
  } catch {
    return null;
  }
};

const fetchWhatsappAvatar = async (url: URL): Promise<CachedMedia | null> => {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: "https://web.whatsapp.com/",
    },
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok || !response.body) return null;
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) return null;
  return { buffer, contentType };
};

const imageResponse = (
  media: CachedMedia,
  source: "r2" | "whatsapp" | "inline",
) =>
  new NextResponse(new Uint8Array(media.buffer), {
    status: 200,
    headers: {
      "Content-Type": media.contentType,
      "Cache-Control": "private, max-age=900, stale-while-revalidate=3600",
      Vary: "Cookie",
      "X-Avatar-Source": source,
    },
  });

const dataUrlMedia = (
  dataUrl: string,
  mimeType: string | null,
): CachedMedia | null => {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  const contentType = match[1] || mimeType || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) return null;
  const buffer = Buffer.from(match[2], "base64");
  return buffer.length > 0 ? { buffer, contentType } : null;
};

const fallbackAvatarResponse = () => {
  return NextResponse.json(
    { message: "Foto indisponível." },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Avatar-Fallback": "1",
      },
    },
  );
};

const readCachedAvatar = async (key: string): Promise<CachedMedia | null> => {
  const cached = await getCachedMediaFromR2(key).catch(() => null);
  if (
    !cached?.buffer.length ||
    !cached.contentType.toLowerCase().startsWith("image/")
  ) {
    return null;
  }
  return cached;
};

const persistCachedAvatar = async (key: string, media: CachedMedia) => {
  await putCachedMediaInR2(key, media.buffer, media.contentType, {
    cacheControl: "private, max-age=86400",
  }).catch(() => false);
};

export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "Não autenticado." },
        { status: 401 },
      );
    }

    const params = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(params.instanceId);
    const chatJid = normalizeWhatsappChatJid(
      decodeURIComponent(params.chatJid),
    );
    if (!instanceId || !chatJid) {
      return NextResponse.json(
        { message: "Conversa inválida." },
        { status: 400 },
      );
    }

    const access = await resolveChatConversationAccess(
      user.id,
      instanceId,
      chatJid,
    );
    if (!access) {
      return NextResponse.json(
        { message: "Conversa não encontrada." },
        { status: 404 },
      );
    }

    const currentUrl = parseWhatsappAvatarUrl(
      request.nextUrl.searchParams.get("url"),
    );
    const force = request.nextUrl.searchParams.get("force") === "1";
    const cacheKey = buildWhatsappAvatarCacheKey({
      userId: access.storageUserId,
      instanceId,
      chatJid,
      version: currentUrl?.toString() ?? null,
    });
    if (!force) {
      const cached = await readCachedAvatar(cacheKey);
      if (cached) return imageResponse(cached, "r2");
    }
    if (currentUrl && !force) {
      const current = await fetchWhatsappAvatar(currentUrl);
      if (current) {
        await persistCachedAvatar(cacheKey, current);
        return imageResponse(current, "whatsapp");
      }
    }

    const instance = access.instance;
    if (!instance.serverBaseUrl || !instance.token) {
      return NextResponse.json(
        { message: "Instância sem servidor conectado." },
        { status: 409 },
      );
    }

    const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
    const channel = chatJid.endsWith("@newsletter")
      ? await getUserChannel(client, chatJid).catch(() => null)
      : null;
    const channelAvatarUrl = channel?.avatarUrl?.trim() || null;
    const avatar = channelAvatarUrl
      ? { url: channelAvatarUrl, dataUrl: null, mimeType: null }
      : await getUserAvatar(
          client,
          { contact: chatJid, preview: true, forceRefresh: true },
        );
    if (!avatar) {
      return fallbackAvatarResponse();
    }

    if (avatar.url) {
      await upsertWhatsappConversation({
        userId: access.storageUserId,
        instanceId: instance.id,
        chatJid,
        chatType: getWhatsappChatType(chatJid),
        phone: getWhatsappChatPhone(chatJid),
        avatarUrl: avatar.url,
      }).catch((error) => {
        console.warn("[whatsapp-avatar] failed to persist refreshed avatar", {
          instanceId: instance.id,
          chatJid,
          error,
        });
      });

      const refreshed = parseWhatsappAvatarUrl(avatar.url);
      if (refreshed) {
        const image = await fetchWhatsappAvatar(refreshed);
        if (image) {
          const refreshedKey = buildWhatsappAvatarCacheKey({
            userId: access.storageUserId,
            instanceId,
            chatJid,
            version: refreshed.toString(),
          });
          await persistCachedAvatar(refreshedKey, image);
          return imageResponse(image, "whatsapp");
        }
      }
    }

    if (avatar.dataUrl) {
      const media = dataUrlMedia(avatar.dataUrl, avatar.mimeType);
      if (media) {
        await persistCachedAvatar(cacheKey, media);
        return imageResponse(media, "inline");
      }
    }

    return fallbackAvatarResponse();
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }
    console.error(
      "[whatsapp-avatar] failed to load conversation avatar",
      error,
    );
    return fallbackAvatarResponse();
  }
}
