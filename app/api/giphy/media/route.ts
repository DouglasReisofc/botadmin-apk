import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";

const MAX_GIPHY_MEDIA_BYTES = 18 * 1024 * 1024;

const isAllowedGiphyHost = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return normalized === "giphy.com" || normalized.endsWith(".giphy.com");
};

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url")?.trim() ?? "";
  let mediaUrl: URL;
  try {
    mediaUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ message: "URL GIPHY inválida." }, { status: 400 });
  }

  if (mediaUrl.protocol !== "https:" || !isAllowedGiphyHost(mediaUrl.hostname)) {
    return NextResponse.json({ message: "Origem GIPHY não permitida." }, { status: 400 });
  }

  const upstream = await fetch(mediaUrl, {
    headers: { Accept: "image/*,video/*,*/*" },
    cache: "force-cache",
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { message: "Não foi possível baixar a mídia do GIPHY." },
      { status: upstream.status },
    );
  }

  const contentLength = Number.parseInt(upstream.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_GIPHY_MEDIA_BYTES) {
    return NextResponse.json({ message: "Mídia GIPHY muito grande." }, { status: 413 });
  }

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength > MAX_GIPHY_MEDIA_BYTES) {
    return NextResponse.json({ message: "Mídia GIPHY muito grande." }, { status: 413 });
  }

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
