import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  buildExternalAvatarCacheKey,
  getCachedMediaFromR2,
  putCachedMediaInR2,
} from "lib/r2-media-cache";

const ALLOWED_HOSTS = new Set(["pps.whatsapp.net"]);

const parseAvatarUrl = (value: string | null): URL | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
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

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const avatarUrl = parseAvatarUrl(request.nextUrl.searchParams.get("url"));
  if (!avatarUrl) {
    return NextResponse.json(
      { message: "URL de avatar inválida." },
      { status: 400 },
    );
  }

  const cacheKey = buildExternalAvatarCacheKey({
    userId: user.id,
    url: avatarUrl.toString(),
  });
  const cached = await getCachedMediaFromR2(cacheKey).catch(() => null);
  if (
    cached?.buffer.length &&
    cached.contentType.toLowerCase().startsWith("image/")
  ) {
    return new NextResponse(new Uint8Array(cached.buffer), {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
        Vary: "Cookie",
        "X-Avatar-Source": "r2",
      },
    });
  }

  const upstream = await fetch(avatarUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: "https://web.whatsapp.com/",
    },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return fallbackAvatarResponse();
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return fallbackAvatarResponse();
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.length === 0) return fallbackAvatarResponse();
  await putCachedMediaInR2(cacheKey, buffer, contentType, {
    cacheControl: "private, max-age=86400",
  }).catch(() => false);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
      Vary: "Cookie",
      "X-Avatar-Source": "whatsapp",
    },
  });
}
