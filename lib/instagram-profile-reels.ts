import path from "node:path";
import crypto from "node:crypto";

import { redisGetJson, redisKey, redisSetJson } from "lib/redis";

type InflactReel = Record<string, any>;

type InflactReelsResponse = {
  status?: string;
  message?: string;
  data?: {
    reels?: InflactReel[];
    hasNextPage?: boolean;
    cursor?: string | null;
    avgViews?: number | null;
    avgLikes?: number | null;
    avgComments?: number | null;
  };
};

export type InstagramProfileReel = {
  id: string;
  shortcode: string;
  permalink: string;
  sourceUrl: string;
  mediaType: "video";
  caption: string | null;
  thumbnail: string | null;
  videoUrl: string | null;
  downloadUrl: string | null;
  createdAt: string | null;
  width: number | null;
  height: number | null;
  likeCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  playCount: number | null;
  owner: {
    id: string | null;
    username: string | null;
    fullName: string | null;
    profilePictureUrl: string | null;
  };
};

export type InstagramProfileReelsResult = {
  username: string;
  reels: InstagramProfileReel[];
  count: number;
  pagesFetched: number;
  hasMore: boolean;
  nextCursor: string | null;
  stats: {
    averageViews: number | null;
    averageLikes: number | null;
    averageComments: number | null;
  };
};

const loadInflactHelper = () => {
  const req = eval("require") as NodeRequire;
  const helperPath = path.join(process.cwd(), "helper", "inflact-viewer.js");
  return req(helperPath) as {
    fetchInflactProfileReels?: (
      username: string,
      options?: { cursor?: string; forceRefresh?: boolean },
    ) => Promise<InflactReelsResponse>;
  };
};

export const normalizeInstagramUsername = (input: string): string => {
  let value = input.trim();
  if (!value) throw new Error("Informe o perfil do Instagram.");
  if (/^https?:\/\//i.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("URL de perfil do Instagram inválida.");
    }
    if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) {
      throw new Error("Informe um perfil válido do Instagram.");
    }
    value = parsed.pathname.split("/").filter(Boolean)[0] || "";
  }
  value = value.replace(/^@+/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(value)) {
    throw new Error("Username do Instagram inválido.");
  }
  return value;
};

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanUrl = (value: unknown): string | null =>
  typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;

const cleanText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const toIsoDate = (value: unknown): string | null => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeReel = (raw: InflactReel): InstagramProfileReel | null => {
  const shortcode = cleanText(raw.shortCode ?? raw.shortcode);
  if (!shortcode || !/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
  const permalink = `https://www.instagram.com/reel/${shortcode}/`;
  return {
    id: cleanText(raw.id) || shortcode,
    shortcode,
    permalink,
    sourceUrl: permalink,
    mediaType: "video",
    caption: cleanText(raw.description),
    thumbnail: cleanUrl(raw.imageUrl),
    videoUrl: cleanUrl(raw.videoUrl),
    downloadUrl: cleanUrl(raw.downloadUrl),
    createdAt: toIsoDate(raw.createdAt),
    width: finiteNumber(raw.dimensions?.width),
    height: finiteNumber(raw.dimensions?.height),
    likeCount: finiteNumber(raw.likeCount),
    commentCount: finiteNumber(raw.commentCount),
    viewCount: finiteNumber(raw.videoViewCount),
    playCount: finiteNumber(raw.playCount),
    owner: {
      id: cleanText(raw.owner?.id ?? raw.ownerId),
      username: cleanText(raw.owner?.username),
      fullName: cleanText(raw.owner?.fullName),
      profilePictureUrl: cleanUrl(raw.owner?.profilePicUrl),
    },
  };
};

export const resolveInstagramProfileReels = async (
  profile: string,
  options: {
    cursor?: string | null;
    limit?: number;
    maxPages?: number;
    forceRefresh?: boolean;
  } = {},
): Promise<InstagramProfileReelsResult> => {
  const username = normalizeInstagramUsername(profile);
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 24), 1200));
  const maxPages = Math.max(1, Math.min(Math.trunc(options.maxPages ?? Math.ceil(limit / 12)), 100));
  const cursorFingerprint = crypto
    .createHash("sha256")
    .update(options.cursor?.trim() || "first-page")
    .digest("hex")
    .slice(0, 20);
  const cacheKey = redisKey(
    "cache",
    "instagram-profile-reels",
    username,
    cursorFingerprint,
    limit,
    maxPages,
  );
  if (options.forceRefresh !== true) {
    const cached = await redisGetJson<InstagramProfileReelsResult>(cacheKey);
    if (cached) return cached;
  }
  const helper = loadInflactHelper();
  if (typeof helper.fetchInflactProfileReels !== "function") {
    throw new Error("Resolvedor de Reels temporariamente indisponível.");
  }

  const byShortcode = new Map<string, InstagramProfileReel>();
  let cursor = options.cursor?.trim() || "";
  let hasMore = true;
  let pagesFetched = 0;
  let averageViews: number | null = null;
  let averageLikes: number | null = null;
  let averageComments: number | null = null;

  while (hasMore && pagesFetched < maxPages && byShortcode.size < limit) {
    const response = await helper.fetchInflactProfileReels(username, {
      cursor,
      forceRefresh: options.forceRefresh === true && pagesFetched === 0,
    });
    if (response?.status !== "success" || !response.data) {
      throw new Error(response?.message || "Não foi possível consultar os Reels desse perfil.");
    }
    const data = response.data;
    pagesFetched += 1;
    averageViews ??= finiteNumber(data.avgViews);
    averageLikes ??= finiteNumber(data.avgLikes);
    averageComments ??= finiteNumber(data.avgComments);
    for (const raw of Array.isArray(data.reels) ? data.reels : []) {
      const reel = normalizeReel(raw);
      if (reel && !byShortcode.has(reel.shortcode)) byShortcode.set(reel.shortcode, reel);
      if (byShortcode.size >= limit) break;
    }
    const nextCursor = cleanText(data.cursor) || "";
    hasMore = data.hasNextPage === true && Boolean(nextCursor) && nextCursor !== cursor;
    cursor = nextCursor;
  }

  const reels = [...byShortcode.values()].slice(0, limit);
  const result: InstagramProfileReelsResult = {
    username,
    reels,
    count: reels.length,
    pagesFetched,
    hasMore,
    nextCursor: hasMore ? cursor : null,
    stats: { averageViews, averageLikes, averageComments },
  };
  await redisSetJson(cacheKey, result, 5 * 60 * 1000);
  return result;
};
