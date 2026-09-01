import {
  buildPinterestDownloads,
  fetchPinterestPinV2,
  type PinterestApiResponse,
  type PinterestDownloadEntry,
} from "./pinterest";

export const PINTEREST_URL_REGEX = /(?:https?:\/\/)?(?:[a-z]+\.)?(?:pinterest\.com|pin\.it|pinimg\.com)/i;
export const isPinterestUrl = (value?: string | null) => (value ? PINTEREST_URL_REGEX.test(value) : false);

const CACHE_TTL_MS = 5 * 60 * 1000;

type PinterestResolverPayload = {
  normalized: PinterestNormalizedPreview;
  response: PinterestApiResponse;
  downloads: PinterestDownloadEntry[];
};

const pinterestCache = new Map<string, { expiresAt: number; promise: Promise<PinterestResolverPayload> }>();

const sanitizeUrl = (value: string) => value.trim();

const getCachedPinterest = (url: string) => {
  const entry = pinterestCache.get(url);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    pinterestCache.delete(url);
    return null;
  }
  return entry.promise;
};

const setCachedPinterest = (url: string, promise: Promise<PinterestResolverPayload>) => {
  const expiresAt = Date.now() + CACHE_TTL_MS;
  pinterestCache.set(url, { expiresAt, promise });
  setTimeout(() => {
    const current = pinterestCache.get(url);
    if (current && current.promise === promise) {
      pinterestCache.delete(url);
    }
  }, CACHE_TTL_MS + 500);
};

type PinterestDownloadSelection = {
  kind: "image" | "video";
  entry: PinterestDownloadEntry;
};

const selectPinterestDownload = (
  downloads: PinterestDownloadEntry[],
  preferredKind?: "image" | "video",
): PinterestDownloadSelection | null => {
  if (!downloads || downloads.length === 0) {
    return null;
  }
  const hasVideo = downloads.some((entry) => entry.type === "video");
  const desiredKind = preferredKind ?? (hasVideo ? "video" : "image");
  const collect = (kind: "image" | "video") => downloads.filter((entry) => entry.type === kind);

  const candidates = collect(desiredKind);
  const nonHls = candidates.find((entry) => !entry.isHls && entry.format !== "m3u8");
  if (nonHls) {
    return { kind: desiredKind, entry: nonHls };
  }
  if (candidates[0]) {
    return { kind: desiredKind, entry: candidates[0] };
  }

  const fallbackKind = desiredKind === "video" ? "image" : "video";
  const fallbackCandidates = collect(fallbackKind);
  const fallbackNonHls = fallbackCandidates.find((entry) => !entry.isHls && entry.format !== "m3u8");
  if (fallbackNonHls) {
    return { kind: fallbackKind, entry: fallbackNonHls };
  }
  if (fallbackCandidates[0]) {
    return { kind: fallbackKind, entry: fallbackCandidates[0] };
  }
  return null;
};

export type PinterestNormalizedPreview = {
  kind: "image" | "video";
  url: string | null;
  thumbnail: string | null;
  title: string | null;
};

export const resolvePinterest = async (rawUrl: string): Promise<PinterestResolverPayload> => {
  const target = sanitizeUrl(rawUrl);
  const cached = getCachedPinterest(target);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    const response = await fetchPinterestPinV2(target);
    const downloads = buildPinterestDownloads(response.pin);
    const selection = selectPinterestDownload(downloads);
    const normalized: PinterestNormalizedPreview = {
      kind: selection?.kind ?? "image",
      url: selection?.entry?.url ?? response.pin.image?.url ?? response.pin.video?.url ?? null,
      thumbnail: response.pin.video?.thumbnail ?? response.pin.image?.url ?? selection?.entry?.url ?? null,
      title: response.pin.title ?? response.pin.description ?? null,
    };
    return {
      normalized,
      response,
      downloads,
    };
  })();
  setCachedPinterest(target, promise);
  return promise;
};

export type PinterestMediaResolution = {
  kind: "image" | "video";
  url: string;
  mimeType?: string;
  title?: string | null;
  thumbnail?: string | null;
};

export const resolvePinterestMedia = async (
  rawUrl: string,
  preferredKind?: "image" | "video",
): Promise<PinterestMediaResolution> => {
  const base = await resolvePinterest(rawUrl);
  const selection = selectPinterestDownload(base.downloads, preferredKind);
  if (!selection?.entry?.url) {
    throw new Error("O Pinterest não retornou nenhum arquivo utilizável.");
  }
  if (selection.entry.isHls || selection.entry.format === "m3u8") {
    throw new Error("O Pinterest retornou apenas links HLS, que não são suportados nesta campanha.");
  }
  const inferredMime = selection.entry.format === "mp4" ? "video/mp4" : selection.entry.format === "png"
    ? "image/png"
    : "image/jpeg";
  return {
    kind: selection.kind,
    url: selection.entry.url,
    mimeType: inferredMime,
    title: base.response.pin.title ?? base.response.pin.description ?? null,
    thumbnail: base.response.pin.video?.thumbnail ?? base.response.pin.image?.url ?? null,
  };
};
