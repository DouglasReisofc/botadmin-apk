const DEFAULT_PINTEREST_API_URL = (() => {
  const raw = (process.env.PINTEREST_V2_URL || "").trim();
  if (raw) {
    try {
      return new URL(raw).toString();
    } catch {
      /* ignore invalid */
    }
  }
  return "https://cookies.botadmin.shop/api/pinterest/pin";
})();

export type PinterestApiVideoVariant = {
  quality?: string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  thumbnail?: string | null;
};

export type PinterestApiVideo = {
  url?: string | null;
  hls?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  duration?: number | null;
  thumbnail?: string | null;
  captions?: Array<{ locale?: string | null; url?: string | null }> | null;
  variants?: PinterestApiVideoVariant[] | null;
};

export type PinterestApiImage = {
  url?: string | null;
  width?: number | null;
  height?: number | null;
};

export type PinterestApiPin = {
  inputUrl?: string | null;
  resolvedUrl?: string | null;
  canonicalUrl?: string | null;
  pinId?: string | null;
  title?: string | null;
  description?: string | null;
  boardUrl?: string | null;
  pinnerUrl?: string | null;
  mediaType?: string | null;
  sourceUrl?: string | null;
  repins?: number | null;
  image?: PinterestApiImage | null;
  video?: PinterestApiVideo | null;
  oembed?: Record<string, unknown> | null;
};

export type PinterestApiResponse = {
  fetchedAt: string;
  pin: PinterestApiPin;
};

export type PinterestDownloadEntry = {
  type: string;
  format: string | null;
  url: string;
  quality: string | null;
  width?: number | null;
  height?: number | null;
  isHls?: boolean;
};

const PINTEREST_PAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const toNullableString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const buildQualityLabel = (width?: number | null, height?: number | null): string | null => {
  if (Number.isFinite(width) && Number.isFinite(height) && width && height) {
    return `${width}x${height}`;
  }
  return null;
};

export const fetchPinterestPinV2 = async (pinUrl: string): Promise<PinterestApiResponse> => {
  const target = pinUrl.trim();
  if (!target) {
    throw new Error("Informe a URL do pin.");
  }

  const apiUrl = new URL(DEFAULT_PINTEREST_API_URL);
  apiUrl.searchParams.set("url", target);

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Falha ao consultar o serviço de pins (${response.status}). ${body || "Sem detalhes."}`,
    );
  }

  const payload = (await response.json()) as PinterestApiResponse;
  if (!payload || typeof payload !== "object" || !payload.pin) {
    throw new Error("Resposta inesperada do serviço de pins.");
  }

  return payload;
};

export const fetchPinterestPageVideoDownloads = async (
  pinUrl: string,
): Promise<PinterestDownloadEntry[]> => {
  const target = pinUrl.trim();
  if (!target) return [];

  const response = await fetch(target, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "User-Agent": PINTEREST_PAGE_USER_AGENT,
    },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return [];

  const html = (await response.text())
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");
  const matches = html.match(/https:\/\/[^\s"'<>\\]*pinimg\.com\/videos\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?/gi) ?? [];
  const uniqueUrls = [...new Set(matches.map((value) => value.replace(/[),.;]+$/, "")))];

  const qualityScore = (url: string): number => {
    const quality = Number(url.match(/\/(\d{3,4})p\//i)?.[1] || 0);
    const codecPenalty = /hevc|h265/i.test(url) ? 100 : 0;
    return quality - codecPenalty;
  };

  return uniqueUrls
    .sort((left, right) => qualityScore(right) - qualityScore(left))
    .map((url) => {
      const quality = url.match(/\/(\d{3,4}p)\//i)?.[1]?.toUpperCase() || "MP4";
      return {
        type: "video",
        format: "mp4",
        url,
        quality,
      } satisfies PinterestDownloadEntry;
    });
};

export const buildPinterestDownloads = (pin: PinterestApiPin): PinterestDownloadEntry[] => {
  const downloads: PinterestDownloadEntry[] = [];
  const register = (entry: PinterestDownloadEntry) => {
    if (!entry.url) {
      return;
    }
    downloads.push(entry);
  };

  if (pin.video) {
    const { video } = pin;
    if (video.url) {
      register({
        type: "video",
        format: "mp4",
        url: video.url,
        quality: buildQualityLabel(video.width, video.height),
        width: video.width ?? null,
        height: video.height ?? null,
      });
    }
    if (video.hls) {
      register({
        type: "video",
        format: "m3u8",
        url: video.hls,
        quality: "HLS",
        isHls: true,
        width: video.width ?? null,
        height: video.height ?? null,
      });
    }
    if (Array.isArray(video.variants)) {
      for (const variant of video.variants) {
        const variantUrl = toNullableString(variant?.url);
        if (!variantUrl) {
          continue;
        }
        const quality = toNullableString(variant?.quality) ?? buildQualityLabel(variant?.width, variant?.height);
        const isHls =
          Boolean(variant?.quality && variant.quality.toLowerCase().includes("hls")) ||
          variantUrl.toLowerCase().endsWith(".m3u8");
        register({
          type: "video",
          format: isHls ? "m3u8" : "mp4",
          url: variantUrl,
          quality,
          width: variant?.width ?? null,
          height: variant?.height ?? null,
          isHls,
        });
      }
    }
  }

  if (pin.image?.url) {
    register({
      type: "image",
      format: "jpg",
      url: pin.image.url,
      quality: buildQualityLabel(pin.image.width, pin.image.height),
      width: pin.image.width ?? null,
      height: pin.image.height ?? null,
    });
  }

  return downloads;
};
