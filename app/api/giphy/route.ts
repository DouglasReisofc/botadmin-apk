import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";

const FALLBACK_GIPHY_API_KEY = "6oGlvXuJ37AsujJ57qWUPkCnz0FISGyT";
const GIPHY_API_BASE = "https://api.giphy.com/v1";

type GiphyImage = {
  url?: string;
  webp?: string;
  mp4?: string;
  width?: string | number;
  height?: string | number;
};

type GiphyItem = {
  id?: string;
  title?: string;
  type?: string;
  images?: Record<string, GiphyImage | undefined>;
};

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
};

const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") continue;
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeType = (value: string | null) =>
  value === "stickers" || value === "sticker" ? "stickers" : "gifs";

const normalizeLimit = (value: string | null) => {
  const parsed = value ? Number.parseInt(value, 10) : 24;
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(parsed, 1), 48);
};

const normalizeOffset = (value: string | null) => {
  const parsed = value ? Number.parseInt(value, 10) : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(parsed, 0);
};

const normalizeGiphyItem = (item: GiphyItem, type: "gifs" | "stickers") => {
  const images = item.images ?? {};
  const original = images.original ?? {};
  const fixedWidth = images.fixed_width ?? {};
  const fixedWidthSmall = images.fixed_width_small ?? {};
  const downsized = images.downsized ?? {};
  const downsizedMedium = images.downsized_medium ?? {};
  const previewGif = images.preview_gif ?? {};
  const previewWebp = images.preview_webp ?? {};
  const preview = images.preview ?? {};
  const gifUrl = firstString(
    original.url,
    downsized.url,
    downsizedMedium.url,
    fixedWidth.url,
    fixedWidthSmall.url,
    previewGif.url,
  );

  const previewUrl = firstString(
    fixedWidthSmall.webp,
    fixedWidthSmall.url,
    previewWebp.url,
    previewGif.url,
    fixedWidth.webp,
    fixedWidth.url,
    original.webp,
    original.url,
  );
  const originalUrl =
    type === "stickers"
      ? firstString(
          original.webp,
          fixedWidth.webp,
          fixedWidthSmall.webp,
          previewWebp.url,
          gifUrl,
        )
      : gifUrl;
  const mp4Url = firstString(
    original.mp4,
    downsized.mp4,
    preview.mp4,
  );
  const webpUrl = firstString(
    original.webp,
    fixedWidth.webp,
    fixedWidthSmall.webp,
    previewWebp.url,
  );

  return {
    id: firstString(item.id) || `${type}-${Date.now()}`,
    title: firstString(item.title) || (type === "stickers" ? "Figurinha GIPHY" : "GIF GIPHY"),
    type,
    previewUrl,
    originalUrl,
    mp4Url,
    webpUrl,
    width: firstNumber(original.width, fixedWidth.width, fixedWidthSmall.width),
    height: firstNumber(original.height, fixedWidth.height, fixedWidthSmall.height),
    source: "giphy",
  };
};

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const apiKey =
    process.env.GIPHY_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GIPHY_API_KEY?.trim() ||
    FALLBACK_GIPHY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ message: "Chave GIPHY não configurada." }, { status: 500 });
  }

  const url = new URL(request.url);
  const type = normalizeType(url.searchParams.get("type"));
  const upstreamType = type === "stickers" ? "gifs" : type;
  const query = url.searchParams.get("q")?.trim() ?? "";
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const offset = normalizeOffset(url.searchParams.get("offset"));
  const endpoint = query ? "search" : "trending";
  const upstream = new URL(`${GIPHY_API_BASE}/${upstreamType}/${endpoint}`);
  upstream.searchParams.set("api_key", apiKey);
  upstream.searchParams.set("limit", String(limit));
  upstream.searchParams.set("offset", String(offset));
  upstream.searchParams.set("rating", "pg-13");
  if (query) {
    upstream.searchParams.set("q", query);
    upstream.searchParams.set("lang", "pt");
  }

  const response = await fetch(upstream, {
    headers: { Accept: "application/json" },
    next: { revalidate: 300 },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const rawMessage =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.meta?.msg === "string"
          ? payload.meta.msg
          : "Não foi possível consultar o GIPHY.";
    const upstreamMessage = /unauthorized/i.test(rawMessage)
      ? "Chave GIPHY não autorizada. Confira a chave em GIPHY_API_KEY."
      : rawMessage;
    return NextResponse.json({ message: upstreamMessage }, { status: response.status });
  }

  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const items = entries
    .map((entry) => normalizeGiphyItem(entry as GiphyItem, type))
    .filter((item) =>
      item.previewUrl &&
      (type === "stickers"
        ? Boolean(item.webpUrl || item.originalUrl || item.mp4Url)
        : Boolean(item.originalUrl)),
    );

  return NextResponse.json(
    {
      ok: true,
      type,
      query,
      limit,
      offset,
      items,
      pagination: payload?.pagination ?? null,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=120, stale-while-revalidate=300",
      },
    },
  );
}
