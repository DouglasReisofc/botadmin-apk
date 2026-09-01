const TIKWM_ENDPOINT = "https://www.tikwm.com/api/";
const TIKTOK_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36";
const TIKWM_CDN = "https://www.tikwm.com";

export const TIKTOK_URL_REGEX = /(?:https?:\/\/)?(?:(?:www|m)\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i;

export const isTikTokUrl = (value?: string | null): boolean =>
  Boolean(value && TIKTOK_URL_REGEX.test(value));

const trimTrailingPunctuation = (value: string): string =>
  value.replace(/[)\].,'"»”’››>—–…•·]+$/gu, "");

export const normalizeTikTokInput = (input: string): string => trimTrailingPunctuation(input.trim());

export const sanitizeTikTokInput = (input: string): string => {
  let sanitized = normalizeTikTokInput(input)
    .replace(/\?share=copy$/i, "")
    .replace(/\?lang=[a-z-]+$/i, "");
  try {
    const parsed = new URL(sanitized);
    const dropParams = new Set([
      "_r",
      "share",
      "lang",
      "is_copy_url",
      "is_from_webapp",
      "sender_device",
      "sender_web_id",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ]);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (dropParams.has(key)) {
        parsed.searchParams.delete(key);
      }
    }
    sanitized = parsed.toString();
  } catch {}
  return sanitized;
};

const absolutize = (value?: string | null) => {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `${TIKWM_CDN}${value}`;
};

export const buildTikTokVariants = (input: string): string[] => {
  const variants: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    variants.push(trimmed);
  };

  push(input);
  const sanitized = sanitizeTikTokInput(input);
  push(sanitized);

  try {
    const parsed = new URL(sanitized);
    const pathname = parsed.pathname;
    const slugMatch = pathname.match(/\/t\/([a-z0-9]+)/i);
    if (slugMatch) {
      const slug = slugMatch[1];
      const upper = slug.toUpperCase();
      if (upper !== slug) {
        const clone = new URL(parsed.toString());
        clone.pathname = pathname.replace(slug, upper);
        push(clone.toString());
      }
    }

    const withoutTrailingSlash = `${parsed.origin}${pathname.replace(/\/+$/, "")}${parsed.search}${parsed.hash}`;
    push(withoutTrailingSlash);
    const withTrailingSlash = `${parsed.origin}${pathname.replace(/\/?$/, "/")}${parsed.search}${parsed.hash}`;
    push(withTrailingSlash);
  } catch {}

  return variants;
};

const fetchTikwm = async (url: string) => {
  const params = new URLSearchParams({ url, count: "12", cursor: "0", web: "1", hd: "1" });
  const response = await fetch(TIKWM_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "sec-ch-ua": '"Chromium";v="107", " Not A;Brand";v="99", "Google Chrome";v="107"',
      "x-requested-with": "XMLHttpRequest",
      origin: "https://www.tikwm.com",
      referer: "https://www.tikwm.com/",
      "user-agent": TIKTOK_USER_AGENT,
      pragma: "no-cache",
      "cache-control": "no-cache",
    },
    body: params,
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }
  const json = await response.json().catch(() => null);
  if (!json || json.code !== 0) {
    return null;
  }
  return json;
};

const fetchTikwmWithRetry = async (url: string, attempts = 3) => {
  let last: any = null;
  for (let index = 0; index < attempts; index += 1) {
    const result = await fetchTikwm(url).catch(() => null);
    if (result?.data) {
      return result;
    }
    last = result;
    const msg = result?.msg ?? "";
    if (msg.includes("Free Api Limit") || msg.includes("Too many requests")) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      continue;
    }
    break;
  }
  return last;
};

type TikTokNormalizedVideo = {
  type: "video";
  title: string;
  author: string;
  duration: number;
  url: string | null;
  thumbnail: string | null;
  music: string | null;
};

type TikTokNormalizedImages = {
  type: "images";
  title: string;
  author: string;
  duration: number;
  items: string[];
};

export type TikTokNormalizedContent = TikTokNormalizedVideo | TikTokNormalizedImages;

const normalizeTikwmData = (data: any) => {
  const images = Array.isArray(data?.images)
    ? data.images
        .map((img: any) => {
          if (!img) return null;
          const value = typeof img === "string" ? img : img?.url;
          return value ? absolutize(value) : null;
        })
        .filter((value: string | null): value is string => Boolean(value))
    : [];

  const apiPayload = {
    code: 0,
    msg: "success",
    data: {
      ...data,
      play: absolutize(data?.play),
      hdplay: absolutize(data?.hdplay),
      wmplay: absolutize(data?.wmplay),
      download: absolutize(data?.download || data?.hdplay || data?.play),
      cover: absolutize(data?.cover),
      music: absolutize(data?.music),
      images,
    },
  };

  const normalized: TikTokNormalizedContent =
    images.length > 0
      ? {
          type: "images",
          title: data?.title || "",
          author: data?.author?.nickname || "",
          duration: data?.duration || 0,
          items: images,
        }
      : {
          type: "video",
          title: data?.title || "",
          author: data?.author?.nickname || "",
          duration: data?.duration || 0,
          url: absolutize(data?.hdplay || data?.play || data?.download),
          thumbnail: absolutize(data?.cover),
          music: absolutize(data?.music),
        };

  return { apiPayload, normalized };
};

export type TikTokResolverDebug = {
  raw: string;
  exact: string;
  sanitized: string;
  variants: string[];
  attempts: { candidate: string; success: boolean }[];
  resolved?: string;
};

export type TikTokResolverSuccess = {
  normalized: TikTokNormalizedContent;
  apiPayload: { code: number; msg: string; data: any };
  raw: any;
  resolvedVariant: string;
};

export type TikTokResolverResult =
  | { success: true; result: TikTokResolverSuccess; debug: TikTokResolverDebug }
  | { success: false; error: string; debug: TikTokResolverDebug };

export const resolveTikTok = async (rawInput: string): Promise<TikTokResolverResult> => {
  const exact = normalizeTikTokInput(rawInput);
  const sanitized = sanitizeTikTokInput(exact);
  const variants = buildTikTokVariants(exact);
  const debug: TikTokResolverDebug = {
    raw: rawInput,
    exact,
    sanitized,
    variants,
    attempts: [],
  };

  let lastResponse: any = null;
  for (const candidate of variants) {
    const response = await fetchTikwmWithRetry(candidate).catch(() => null);
    debug.attempts.push({ candidate, success: Boolean(response?.data) });
    lastResponse = response;
    if (response?.data) {
      const { apiPayload, normalized } = normalizeTikwmData(response.data);
      debug.resolved = candidate;
      return {
        success: true,
        result: {
          normalized,
          apiPayload,
          raw: response,
          resolvedVariant: candidate,
        },
        debug,
      };
    }
  }

  const errorMessage = lastResponse?.msg || "Falha ao processar link no TikWM.";
  return { success: false, error: errorMessage, debug };
};

const detectExtension = (value: string | null | undefined, fallback: string): string => {
  if (value) {
    try {
      const parsed = new URL(value);
      const match = parsed.pathname.match(/\.([a-z0-9]{2,4})$/i);
      if (match) {
        return match[1].toLowerCase();
      }
    } catch {}
    const fallbackMatch = value.match(/\.([a-z0-9]{2,4})(?:\?|#|$)/i);
    if (fallbackMatch) {
      return fallbackMatch[1].toLowerCase();
    }
  }
  return fallback;
};

const guessMimeFromExtension = (extension: string): string | undefined => {
  const ext = extension.toLowerCase();
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "pdf") return "application/pdf";
  return undefined;
};

const buildFileNameFromTitle = (title: string | null | undefined, extension: string): string => {
  const normalizedExt = extension.replace(/^\.+/, "").trim() || "mp4";
  const normalizedTitle = (title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const base = normalizedTitle || "midia";
  return `${base}.${normalizedExt}`;
};

export type TikTokMediaResolution = {
  url: string;
  type: "video" | "image";
  mimeType?: string;
  fileName?: string;
  title?: string;
  thumbnail?: string | null;
};

export const resolveTikTokMedia = async (rawInput: string): Promise<TikTokMediaResolution | null> => {
  const resolved = await resolveTikTok(rawInput);
  if (!resolved.success) {
    return null;
  }
  const { normalized } = resolved.result;
  if (normalized.type === "video" && normalized.url) {
    const extension = detectExtension(normalized.url, "mp4");
    return {
      url: normalized.url,
      type: "video",
      mimeType: guessMimeFromExtension(extension),
      fileName: buildFileNameFromTitle(normalized.title, extension),
      title: normalized.title,
      thumbnail: normalized.thumbnail ?? null,
    };
  }
  if (normalized.type === "images" && normalized.items.length > 0) {
    const first = normalized.items[0];
    const extension = detectExtension(first, "jpg");
    return {
      url: first,
      type: "image",
      mimeType: guessMimeFromExtension(extension),
      fileName: buildFileNameFromTitle(normalized.title, extension),
      title: normalized.title,
      thumbnail: first,
    };
  }
  return null;
};
