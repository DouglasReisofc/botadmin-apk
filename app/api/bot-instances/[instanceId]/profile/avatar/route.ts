import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, getInstanceProfileForUser } from "lib/bot-instances";
import {
  buildWhatsappAvatarCacheKey,
  getCachedMediaFromR2,
  putCachedMediaInR2,
} from "lib/r2-media-cache";

const parseInstanceId = (value: string | undefined): number | null => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ instanceId: string }> | { instanceId: string } },
) {
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
    if (!instanceId) {
      return NextResponse.json(
        { message: "Perfil inválido." },
        { status: 404 },
      );
    }

    const profile = await getInstanceProfileForUser(user.id, instanceId);
    const rawUrl = profile.avatarUrl?.trim();
    const avatarUrl = rawUrl ? new URL(rawUrl) : null;
    if (!avatarUrl || !["http:", "https:"].includes(avatarUrl.protocol)) {
      return NextResponse.json(
        { message: "Foto indisponível." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const cacheKey = buildWhatsappAvatarCacheKey({
      userId: user.id,
      instanceId,
      chatJid: "__profile__",
      version: avatarUrl.toString(),
    });
    const force = new URL(request.url).searchParams.get("force") === "1";
    if (!force) {
      const cached = await getCachedMediaFromR2(cacheKey).catch(() => null);
      if (
        cached?.buffer.length &&
        cached.contentType.toLowerCase().startsWith("image/")
      ) {
        return new NextResponse(new Uint8Array(cached.buffer), {
          status: 200,
          headers: {
            "Content-Type": cached.contentType,
            "Cache-Control":
              "private, max-age=900, stale-while-revalidate=3600",
            Vary: "Cookie",
            "X-Avatar-Source": "r2",
          },
        });
      }
    }

    const upstream = await fetch(avatarUrl, {
      cache: "no-store",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": request.headers.get("user-agent") ?? "BotAdmin/1.0",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { message: "Foto indisponível." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return NextResponse.json(
        { message: "Foto indisponível." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json(
        { message: "Foto indisponível." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    await putCachedMediaInR2(cacheKey, buffer, contentType, {
      cacheControl: "private, max-age=86400",
    }).catch(() => false);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=900, stale-while-revalidate=3600",
        Vary: "Cookie",
        "X-Avatar-Source": "whatsapp",
      },
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to load instance profile avatar", error);
    return NextResponse.json(
      { message: "Foto indisponível." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}
