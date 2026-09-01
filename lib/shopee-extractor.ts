const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
} as const;

const SCRIPT_JSON_RE =
  /<script[^>]*type="application\/(?:json|ld\+json)"[^>]*>([\s\S]*?)<\/script>/gi;
const NEXT_DATA_RE =
  /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
const UNIVERSAL_LINK_CONFIG_RE = /var\s+CONFIG\s*=\s*(\{[\s\S]*?\})\s*;/i;
const OG_URL_RE =
  /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i;
const HTTP_URL_RE = /httpUrl\s*:\s*"([^"]+)"/i;

const RAW_VIDEO_PATTERNS = [
  /(?:https?:\\?\/\\?\/[^"'<>\s]+(?:\.mp4|\.m3u8|\.mov|\.webm)[^"'<>\s]*)/gi,
  /(?:(?:https?:)?\/\/[^"'<>\s]+(?:\.mp4|\.m3u8|\.mov|\.webm)[^"'<>\s]*)/gi,
  /"(?:video_url|videoUrl|play_url|playUrl|master_url|masterUrl|hls_url|hlsUrl|mp4_url|mp4Url)"\s*:\s*"([^"]+)"/gi,
] as const;

const PREFERRED_VIDEO_KEY_HINTS = [
  "nowatermark",
  "no_watermark",
  "originvideo",
  "originalvideo",
  "rawvideo",
  "playurl",
  "play_url",
  "videourl",
  "video_url",
] as const;

type GenericRecord = Record<string, unknown>;

export type ShopeeExtractorLinkedProduct = {
  itemId: string | null;
  shopId: string | null;
  name: string | null;
  productUrl: string | null;
};

export type ShopeeExtractorResult = {
  url: string;
  cover: string | null;
  caption: string | null;
  title: string | null;
  author: string | null;
  sourceUrl: string;
  seoUrl: string | null;
  watermarkUrl: string | null;
  linkedProduct: ShopeeExtractorLinkedProduct | null;
  linkedProducts: ShopeeExtractorLinkedProduct[];
  metadata: Record<string, unknown>;
};

const toRecord = (value: unknown): GenericRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as GenericRecord)
    : {};

const toArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
};

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readInteger = (value: unknown): number | null => {
  const parsed = readNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
};

const decodeUrlEscapes = (value: string): string =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\x2F/gi, "/")
    .replace(/\\x3A/gi, ":");

const dedupe = <T,>(items: T[]): T[] => {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
};

const scoreVideoUrl = (value: string): number => {
  const lower = value.toLowerCase();
  let score = 0;
  if (lower.includes(".mp4")) {
    score += 5;
  }
  if (lower.includes("watermark")) {
    score -= 30;
  }
  if (
    lower.includes(".1600562") ||
    lower.includes(".1600318") ||
    lower.includes("1080") ||
    lower.includes("v1080p")
  ) {
    score += 18;
  } else if (
    lower.includes(".1600316") ||
    lower.includes(".1600671") ||
    lower.includes("540") ||
    lower.includes("v540p")
  ) {
    score += 12;
  } else if (
    lower.includes(".1600315") ||
    lower.includes("360") ||
    lower.includes("v360p")
  ) {
    score += 8;
  }
  return score;
};

const prioritizeVideoUrls = (items: string[]): string[] => {
  const unique = dedupe(items);
  return unique.sort((left, right) => {
    const diff = scoreVideoUrl(right) - scoreVideoUrl(left);
    if (diff !== 0) {
      return diff;
    }
    return unique.indexOf(left) - unique.indexOf(right);
  });
};

export const normalizeCandidateUrl = (
  raw: string,
  baseUrl?: string | null,
): string | null => {
  const trimmed = String(raw || "").trim().replace(/^['"]+|['",]+$/g, "");
  if (!trimmed) {
    return null;
  }

  let value = decodeUrlEscapes(trimmed);
  if (value.startsWith("//")) {
    value = `https:${value}`;
  } else if (value.startsWith("/") && baseUrl) {
    try {
      value = new URL(value, baseUrl).toString();
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/[",'`]+$/g, "");
  } catch {
    return null;
  }
};

const looksLikeVideoUrl = (value: string): boolean => {
  const lower = value.toLowerCase();
  if (
    lower.includes(".mp4") ||
    lower.includes(".m3u8") ||
    lower.includes(".mov") ||
    lower.includes(".webm")
  ) {
    return true;
  }
  if (lower.includes("mime=video") || lower.includes("type=video")) {
    return true;
  }
  return lower.includes("video") && (lower.includes("shopee") || lower.includes("susercontent"));
};

const isNonMediaPageUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.toLowerCase();
    return (
      pathname.includes("/share-video/") &&
      !pathname.includes(".mp4") &&
      !pathname.includes(".m3u8") &&
      !pathname.includes(".mov") &&
      !pathname.includes(".webm")
    );
  } catch {
    return false;
  }
};

export const normalizeCookieTextToHeader = (
  cookieText?: string | null,
): string | null => {
  if (typeof cookieText !== "string") {
    return null;
  }
  const raw = cookieText.replace(/\r\n/g, "\n").trim();
  if (!raw) {
    return null;
  }

  const cookies = new Map<string, string>();
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const looksLikeNetscape = lines.some(
    (line) =>
      line.startsWith("# Netscape") ||
      line.startsWith("#HttpOnly_") ||
      line.includes("\t"),
  );

  if (looksLikeNetscape) {
    for (const line of lines) {
      let current = line;
      if (current.startsWith("#HttpOnly_")) {
        current = current.slice("#HttpOnly_".length);
      } else if (current.startsWith("#")) {
        continue;
      }
      const parts = current.split("\t");
      if (parts.length !== 7) {
        continue;
      }
      const name = parts[5]?.trim();
      const value = parts[6]?.trim() ?? "";
      if (!name) {
        continue;
      }
      cookies.set(name.toLowerCase(), `${name}=${value}`);
    }
    if (cookies.size > 0) {
      return Array.from(cookies.values()).join("; ");
    }
  }

  for (const chunk of raw.replace(/^cookie\s*:\s*/i, "").split(";")) {
    const entry = chunk.trim();
    if (!entry) {
      continue;
    }
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    cookies.set(name.toLowerCase(), `${name}=${value}`);
  }

  return cookies.size > 0 ? Array.from(cookies.values()).join("; ") : null;
};

const buildRequestHeaders = (params: {
  cookieHeader?: string | null;
  referer?: string | null;
  accept?: string | null;
}): HeadersInit => {
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
  };
  if (params.accept) {
    headers.accept = params.accept;
  }
  if (params.referer) {
    headers.referer = params.referer;
  }
  if (params.cookieHeader) {
    headers.cookie = params.cookieHeader;
  }
  return headers;
};

const fetchTextWithRedirects = async (
  targetUrl: string,
  options: {
    cookieHeader?: string | null;
    referer?: string | null;
    timeoutMs: number;
    accept?: string | null;
  },
): Promise<{ url: string; text: string }> => {
  let currentUrl = targetUrl;
  let currentReferer = options.referer ?? null;

  for (let redirectCount = 0; redirectCount < 6; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        headers: buildRequestHeaders({
          cookieHeader: options.cookieHeader,
          referer: currentReferer,
          accept: options.accept ?? null,
        }),
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });

      const location = response.headers.get("location");
      if (
        response.status >= 300 &&
        response.status < 400 &&
        location
      ) {
        currentReferer = currentUrl;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(`Shopee retornou HTTP ${response.status}.`);
      }

      return {
        url: currentUrl,
        text: await response.text(),
      };
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") {
        throw new Error("Tempo esgotado ao consultar a Shopee.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Muitos redirecionamentos ao abrir a Shopee.");
};

const extractBalancedJsonBlob = (
  text: string,
  startIndex: number,
): { value: string; nextIndex: number } | null => {
  const starter = text[startIndex];
  if (!starter || (starter !== "{" && starter !== "[")) {
    return null;
  }

  const stack: string[] = [starter];
  let inString: string | null = null;
  let escaped = false;

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const current = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\") {
        escaped = true;
        continue;
      }
      if (current === inString) {
        inString = null;
      }
      continue;
    }

    if (current === "'" || current === '"') {
      inString = current;
      continue;
    }
    if (current === "{" || current === "[") {
      stack.push(current);
      continue;
    }
    if (current === "}" || current === "]") {
      const opener = stack.pop();
      const validPair =
        (opener === "{" && current === "}") ||
        (opener === "[" && current === "]");
      if (!validPair) {
        return null;
      }
      if (stack.length === 0) {
        return {
          value: text.slice(startIndex, index + 1),
          nextIndex: index + 1,
        };
      }
    }
  }

  return null;
};

const extractStateBlobs = (htmlText: string): string[] => {
  const blobs: string[] = [];
  for (const variableName of [
    "__INITIAL_STATE__",
    "__PRELOADED_STATE__",
    "__NEXT_DATA__",
    "__NUXT__",
  ]) {
    const pattern = new RegExp(`${variableName}\\s*=\\s*`, "gi");
    let match = pattern.exec(htmlText);
    while (match) {
      let index = match.index + match[0].length;
      while (index < htmlText.length && /\s/.test(htmlText[index] ?? "")) {
        index += 1;
      }
      const blob = extractBalancedJsonBlob(htmlText, index);
      if (blob) {
        blobs.push(blob.value);
      }
      match = pattern.exec(htmlText);
    }
  }
  return blobs;
};

export const extractNextData = (htmlText: string): Record<string, unknown> => {
  const match = NEXT_DATA_RE.exec(htmlText);
  if (!match?.[1]) {
    return {};
  }
  try {
    return toRecord(JSON.parse(match[1]));
  } catch {
    return {};
  }
};

const extractUniversalLinkConfig = (
  htmlText: string,
): Record<string, unknown> => {
  const match = UNIVERSAL_LINK_CONFIG_RE.exec(htmlText);
  if (!match?.[1]) {
    return {};
  }

  const normalized = decodeUrlEscapes(match[1]);
  try {
    return toRecord(JSON.parse(normalized));
  } catch {
    const httpMatch = HTTP_URL_RE.exec(match[1]);
    if (!httpMatch?.[1]) {
      return {};
    }
    return { httpUrl: httpMatch[1] };
  }
};

export const extractShareTarget = (
  pageUrl: string,
  htmlText = "",
): string | null => {
  try {
    const parsed = new URL(pageUrl);
    if (parsed.hostname.includes("sv.shopee")) {
      return parsed.toString();
    }
    const redir = parsed.searchParams.get("redir");
    if (redir && redir.includes("sv.shopee")) {
      return normalizeCandidateUrl(redir, parsed.toString()) ?? redir;
    }
  } catch {
    return null;
  }

  const config = extractUniversalLinkConfig(htmlText);
  const httpUrl = readString(config.httpUrl);
  if (httpUrl && httpUrl.includes("sv.shopee")) {
    return normalizeCandidateUrl(httpUrl, pageUrl) ?? httpUrl;
  }

  const ogMatch = OG_URL_RE.exec(htmlText);
  if (ogMatch?.[1]?.includes("sv.shopee")) {
    return normalizeCandidateUrl(ogMatch[1], pageUrl) ?? ogMatch[1];
  }

  const nextData = extractNextData(htmlText);
  const query = toRecord(nextData.query);
  const postId = readString(query.postId);
  return postId ? `https://sv.shopee.com.br/share-video/${postId}` : null;
};

const resolvePageUrl = async (
  pageUrl: string,
  options: { cookieHeader?: string | null; timeoutMs: number },
): Promise<{ url: string; text: string }> => {
  const page = await fetchTextWithRedirects(pageUrl, {
    cookieHeader: options.cookieHeader,
    timeoutMs: options.timeoutMs,
  });

  const resolved = extractShareTarget(page.url, page.text);
  if (resolved && resolved !== page.url) {
    return fetchTextWithRedirects(resolved, {
      cookieHeader: options.cookieHeader,
      timeoutMs: options.timeoutMs,
      referer: page.url,
    });
  }
  return page;
};

export const collectVideoUrlsFromJson = (
  data: unknown,
  baseUrl: string,
): string[] => {
  const results: string[] = [];
  const scores = new Map<string, number>();
  const stack: Array<{ key: string; value: unknown }> = [{ key: "", value: data }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const { key, value } = current;
    if (Array.isArray(value)) {
      for (const entry of value) {
        stack.push({ key, value: entry });
      }
      continue;
    }
    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value as GenericRecord)) {
        stack.push({ key: childKey, value: childValue });
      }
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }

    const candidate = normalizeCandidateUrl(value, baseUrl);
    if (!candidate || isNonMediaPageUrl(candidate)) {
      continue;
    }
    if (!looksLikeVideoUrl(candidate) && !key.toLowerCase().includes("video")) {
      continue;
    }

    const keyLower = key.toLowerCase();
    let score = scoreVideoUrl(candidate);
    if (PREFERRED_VIDEO_KEY_HINTS.some((hint) => keyLower.includes(hint))) {
      score += 20;
    }

    results.push(candidate);
    scores.set(candidate, Math.max(scores.get(candidate) ?? Number.NEGATIVE_INFINITY, score));
  }

  const unique = dedupe(results);
  return unique.sort((left, right) => {
    const diff = (scores.get(right) ?? 0) - (scores.get(left) ?? 0);
    if (diff !== 0) {
      return diff;
    }
    return unique.indexOf(left) - unique.indexOf(right);
  });
};

const extractVideoUrlsFromHtml = (
  htmlText: string,
  baseUrl: string,
): string[] => {
  const results: string[] = [];

  for (const pattern of RAW_VIDEO_PATTERNS) {
    const matches = htmlText.match(pattern) ?? [];
    for (const raw of matches) {
      const candidate = normalizeCandidateUrl(raw, baseUrl);
      if (
        candidate &&
        looksLikeVideoUrl(candidate) &&
        !isNonMediaPageUrl(candidate)
      ) {
        results.push(candidate);
      }
    }
  }

  SCRIPT_JSON_RE.lastIndex = 0;
  let scriptMatch = SCRIPT_JSON_RE.exec(htmlText);
  while (scriptMatch) {
    const body = scriptMatch[1]?.trim();
    if (!body) {
      scriptMatch = SCRIPT_JSON_RE.exec(htmlText);
      continue;
    }
    try {
      results.push(...collectVideoUrlsFromJson(JSON.parse(body), baseUrl));
    } catch {
      // ignore malformed scripts
    }
    scriptMatch = SCRIPT_JSON_RE.exec(htmlText);
  }

  for (const stateBlob of extractStateBlobs(htmlText)) {
    try {
      results.push(...collectVideoUrlsFromJson(JSON.parse(stateBlob), baseUrl));
    } catch {
      // ignore malformed state blobs
    }
  }

  return dedupe(results);
};

export const buildSeoVideoUrl = (
  pageUrl: string,
  nextData: Record<string, unknown>,
): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }

  const query = toRecord(nextData.query);
  const props = toRecord(nextData.props);
  const pageProps = toRecord(props.pageProps);
  const mediaInfo = toRecord(pageProps.mediaInfo);
  const userInfo = toRecord(mediaInfo.userInfo);
  const userDetail = toRecord(pageProps.userDetail);

  const postId = readString(query.postId);
  const username =
    readString(userInfo.videoUserName) ?? readString(userDetail.videoUserName);

  return postId && username
    ? `${parsed.protocol}//${parsed.host}/web/@${username}/video/${postId}`
    : null;
};

export const extractTimelineItem = (
  nextData: Record<string, unknown>,
): Record<string, unknown> => {
  const props = toRecord(nextData.props);
  const pageProps = toRecord(props.pageProps);
  const timelineVideo = toRecord(pageProps.timelineVideo);
  const first = toArray(timelineVideo.list)[0];
  return toRecord(first);
};

const parseMmsData = (value: unknown): Record<string, unknown> => {
  const text = readString(value);
  if (!text) {
    return {};
  }
  try {
    return toRecord(JSON.parse(text));
  } catch {
    return {};
  }
};

export const collectVideoUrlsFromTimelineItem = (
  item: Record<string, unknown>,
  baseUrl: string,
): string[] => {
  const content = toRecord(item.content);
  const video = toRecord(content.video);
  const candidates: string[] = [];

  for (const key of ["url", "watermarkVideoUrl", "preloadUrl"]) {
    const candidate = normalizeCandidateUrl(String(video[key] ?? ""), baseUrl);
    if (candidate && looksLikeVideoUrl(candidate)) {
      candidates.push(candidate);
    }
  }

  for (const formatEntry of toArray(video.formats)) {
    const format = toRecord(formatEntry);
    const candidate = normalizeCandidateUrl(String(format.url ?? ""), baseUrl);
    if (candidate && looksLikeVideoUrl(candidate)) {
      candidates.push(candidate);
    }
  }

  candidates.push(...collectVideoUrlsFromJson(parseMmsData(video.mmsData), baseUrl));
  return dedupe(candidates);
};

const extractVideoMetadata = (
  nextData: Record<string, unknown>,
  pageUrl: string,
): Record<string, unknown> => {
  const props = toRecord(nextData.props);
  const pageProps = toRecord(props.pageProps);
  const mediaInfo = toRecord(pageProps.mediaInfo);
  const videoInfo = toRecord(mediaInfo.video);
  const countInfo = toRecord(mediaInfo.count);
  const userInfo = toRecord(mediaInfo.userInfo);
  const userDetail = toRecord(pageProps.userDetail);
  const query = toRecord(nextData.query);
  const durationMs = readNumber(videoInfo.duration) ?? 0;

  return {
    page_url: pageUrl,
    post_id: readString(query.postId) ?? "",
    share_user_id: readString(query.shareUserId) ?? "",
    creator_username:
      readString(userInfo.videoUserName) ??
      readString(userDetail.videoUserName) ??
      "",
    creator_avatar: readString(userInfo.videoUserAvatar) ?? "",
    caption: readString(videoInfo.caption) ?? "",
    hashtags: toArray(videoInfo.hashtagContent).filter(
      (entry): entry is string => typeof entry === "string",
    ),
    duration_ms: durationMs,
    duration_sec: Number((durationMs / 1000).toFixed(1)),
    like_count: readInteger(countInfo.likeCount) ?? 0,
    comment_count: readInteger(countInfo.commentCount) ?? 0,
    cover_url:
      normalizeCandidateUrl(String(videoInfo.watermarkCoverUrl ?? ""), pageUrl) ??
      readString(videoInfo.watermarkCoverUrl) ??
      "",
    share_image_url:
      normalizeCandidateUrl(
        String(videoInfo.watermarkShareImageUrl ?? ""),
        pageUrl,
      ) ??
      readString(videoInfo.watermarkShareImageUrl) ??
      "",
    video_url:
      normalizeCandidateUrl(String(videoInfo.watermarkVideoUrl ?? ""), pageUrl) ??
      readString(videoInfo.watermarkVideoUrl) ??
      "",
    watermark_video_url:
      normalizeCandidateUrl(String(videoInfo.watermarkVideoUrl ?? ""), pageUrl) ??
      readString(videoInfo.watermarkVideoUrl) ??
      "",
    linked_items: toArray(pageProps.linkedItems).map(toRecord),
    product_list: toArray(pageProps.productList).map(toRecord),
    shop_info: toRecord(pageProps.shopInfo),
  };
};

export const extractVideoMetadataFromTimelineItem = (
  item: Record<string, unknown>,
  pageUrl: string,
): Record<string, unknown> => {
  const meta = toRecord(item.meta);
  const content = toRecord(item.content);
  const video = toRecord(content.video);
  const music = toRecord(content.music);
  const countInfo = toRecord(meta.countInfo);
  const products = toRecord(content.products);
  const hashtagDetails = toArray(content.hashtags).map(toRecord);
  const caption = readString(content.caption) ?? "";
  const durationMs = readNumber(video.duration) ?? 0;

  const hashtagNames = hashtagDetails
    .map((entry) => {
      const start = readInteger(entry.start);
      const length = readInteger(entry.length);
      if (start === null || length === null || length <= 0) {
        return null;
      }
      const token = caption.slice(start, start + length).replace(/^#/, "").trim();
      return token || null;
    })
    .filter((entry): entry is string => Boolean(entry));

  return {
    page_url: pageUrl,
    post_id: readString(meta.postId) ?? "",
    share_user_id:
      readString(meta.userId) ??
      (readInteger(meta.userId) !== null ? String(readInteger(meta.userId)) : "") ??
      "",
    creator_username: readString(meta.userName) ?? "",
    creator_avatar: readString(meta.avatar) ?? "",
    creator_nickname: readString(meta.shopeeNickName) ?? "",
    caption,
    hashtags: hashtagNames,
    hashtag_details: hashtagDetails,
    duration_ms: durationMs,
    duration_sec: Number((durationMs / 1000).toFixed(1)),
    like_count: readInteger(countInfo.likes) ?? 0,
    comment_count: readInteger(countInfo.comments) ?? 0,
    view_count: readInteger(countInfo.views) ?? 0,
    cover_url:
      normalizeCandidateUrl(
        String(video.cover ?? video.watermarkCoverUrl ?? ""),
        pageUrl,
      ) ?? "",
    share_image_url:
      normalizeCandidateUrl(String(video.cover ?? ""), pageUrl) ?? "",
    video_url:
      normalizeCandidateUrl(
        String(video.url ?? video.watermarkVideoUrl ?? ""),
        pageUrl,
      ) ?? "",
    watermark_video_url:
      normalizeCandidateUrl(String(video.watermarkVideoUrl ?? ""), pageUrl) ?? "",
    linked_products: products,
    linked_items: toArray(products.items).map(toRecord),
    product_list: toArray(products.enhancedItemList).map(toRecord),
    shop_info: {
      shop_id: readInteger(meta.shopId) ?? 0,
      shop_name: readString(meta.shopName) ?? "",
    },
    timeline_meta: meta,
    timeline_video: video,
    music,
    mms_data: parseMmsData(video.mmsData),
  };
};

const buildProductUrl = (
  shopId: string | null,
  itemId: string | null,
): string | null => {
  if (!shopId || !itemId) {
    return null;
  }
  return `https://shopee.com.br/product/${shopId}/${itemId}`;
};

const buildLinkedProducts = (
  metadata: Record<string, unknown>,
): ShopeeExtractorLinkedProduct[] => {
  const productEntries = [
    ...toArray(metadata.product_list),
    ...toArray(metadata.linked_items),
  ];
  const products = new Map<string, ShopeeExtractorLinkedProduct>();

  for (const entry of productEntries) {
    const record = toRecord(entry);
    const itemIdRaw =
      readString(record.itemId) ??
      (readInteger(record.itemId) !== null ? String(readInteger(record.itemId)) : null) ??
      readString(record.item_id);
    const shopIdRaw =
      readString(record.shopId) ??
      (readInteger(record.shopId) !== null ? String(readInteger(record.shopId)) : null) ??
      readString(record.shop_id);
    const itemId = itemIdRaw?.trim() ?? null;
    const shopId = shopIdRaw?.trim() ?? null;
    if (!itemId && !shopId) {
      continue;
    }

    const key = `${shopId ?? "unknown"}:${itemId ?? "unknown"}`;
    const current = products.get(key);
    products.set(key, {
      itemId,
      shopId,
      name:
        normalizeText(record.name) ??
        normalizeText(record.title) ??
        normalizeText(record.productName) ??
        current?.name ??
        null,
      productUrl:
        normalizeCandidateUrl(String(record.itemUrl ?? record.productUrl ?? ""), null) ??
        current?.productUrl ??
        buildProductUrl(shopId, itemId),
    });
  }

  return Array.from(products.values());
};

const mergeMetadata = (
  baseMetadata: Record<string, unknown>,
  timelineMetadata: Record<string, unknown>,
  pageUrl: string,
  seoUrl: string | null,
  videoCandidates: string[],
  linkedProducts: ShopeeExtractorLinkedProduct[],
): Record<string, unknown> => ({
  ...baseMetadata,
  ...timelineMetadata,
  page_url: pageUrl,
  seo_url: seoUrl,
  linked_products_list: linkedProducts,
  video_candidates: videoCandidates,
});

const normalizeTitle = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length <= 120
    ? normalized
    : `${normalized.slice(0, 117).trim()}...`;
};

export const isShopeeUrl = (value: string): boolean => {
  const lower = value.toLowerCase();
  return (
    lower.includes("shopee.") ||
    lower.includes("shp.ee") ||
    lower.includes("sv.shopee")
  );
};

export const extractShopeeVideo = async (
  targetUrl: string,
  options?: { timeoutMs?: number; cookieText?: string | null },
): Promise<ShopeeExtractorResult> => {
  const trimmed = targetUrl.trim();
  if (!trimmed) {
    throw new Error("URL vazia.");
  }

  const timeoutMs = options?.timeoutMs ?? 20_000;
  const cookieHeader = normalizeCookieTextToHeader(options?.cookieText ?? null);
  const page = await resolvePageUrl(trimmed, {
    cookieHeader,
    timeoutMs,
  });

  const nextData = extractNextData(page.text);
  const baseMetadata = extractVideoMetadata(nextData, page.url);
  let timelineItem = extractTimelineItem(nextData);
  let seoUrl = buildSeoVideoUrl(page.url, nextData);

  if (Object.keys(timelineItem).length === 0 && seoUrl) {
    try {
      const seoPage = await fetchTextWithRedirects(seoUrl, {
        cookieHeader,
        referer: page.url,
        timeoutMs,
      });
      const seoNextData = extractNextData(seoPage.text);
      const resolvedTimelineItem = extractTimelineItem(seoNextData);
      if (Object.keys(resolvedTimelineItem).length > 0) {
        timelineItem = resolvedTimelineItem;
      }
    } catch {
      // fallback to share HTML parsing only
    }
  }

  const timelineMetadata =
    Object.keys(timelineItem).length > 0
      ? extractVideoMetadataFromTimelineItem(timelineItem, seoUrl ?? page.url)
      : {};
  const videoCandidates = prioritizeVideoUrls([
    ...(Object.keys(timelineItem).length > 0
      ? collectVideoUrlsFromTimelineItem(timelineItem, seoUrl ?? page.url)
      : []),
    ...collectVideoUrlsFromJson(nextData, page.url),
    ...extractVideoUrlsFromHtml(page.text, page.url),
  ]);

  if (videoCandidates.length === 0) {
    throw new Error("Shopee nao retornou URL de video valida.");
  }

  const linkedProducts = buildLinkedProducts({
    ...baseMetadata,
    ...timelineMetadata,
  });
  const metadata = mergeMetadata(
    baseMetadata,
    timelineMetadata,
    page.url,
    seoUrl,
    videoCandidates,
    linkedProducts,
  );

  const caption =
    normalizeText(metadata.caption) ??
    normalizeText(linkedProducts[0]?.name) ??
    null;
  const author = normalizeText(metadata.creator_username) ?? null;
  const cover =
    normalizeCandidateUrl(String(metadata.cover_url ?? ""), page.url) ??
    normalizeCandidateUrl(String(metadata.share_image_url ?? ""), page.url) ??
    null;
  const watermarkUrl =
    normalizeCandidateUrl(String(metadata.watermark_video_url ?? ""), page.url) ??
    normalizeCandidateUrl(String(metadata.video_url ?? ""), page.url) ??
    null;

  return {
    url: videoCandidates[0] ?? "",
    cover,
    caption,
    title: normalizeTitle(caption),
    author,
    sourceUrl: page.url,
    seoUrl,
    watermarkUrl,
    linkedProduct: linkedProducts[0] ?? null,
    linkedProducts,
    metadata,
  };
};
