import mime from "mime-types";
import axios from "axios";
import path from "path";
import fs from "fs";
import sharp from "sharp";

import { getAppBaseUrl } from "lib/meta";
import { sendInteractiveButtons, sendMediaMessage, sendTextMessage } from "lib/wuzapi";
import type { WuzapiClient } from "lib/wuzapi";
import { downloadSpotifyTrack } from "lib/spotify-downloader";
import { downloadMegaFileToPublic } from "lib/mega-downloader";
import { buildTempDownloadUrl } from "lib/temp-downloads";
import type { PinterestDownloadEntry } from "lib/pinterest";
import { searchMercadoLivre, type MercadoLivreProduct } from "lib/apis/mercadolivre";
import { generateAffiliateMlLinksForUserWithAdminFallback } from "lib/affiliate-ml-resolver";
import { resolveAffiliateMlLinkForUserByItemId } from "lib/affiliate-ml-links";

export type AutoDownloadPlatform =
  | "instagram"
  | "tiktok"
  | "douyin"
  | "kwai"
  | "shopee"
  | "mercadolivre"
  | "facebook"
  | "youtube"
  | "pinterest"
  | "threads"
  | "mediafire"
  | "freepik"
  | "envato"
  | "mega"
  | "spotify"
  | "twitter"
  | "soundcloud"
  | "bandcamp"
  | "twitch"
  | "rumble"
  | "odysee"
  | "twitterspaces"
  | "mixcloud"
  | "dailymotion";

export const AUTO_DOWNLOAD_DOMAINS: Record<AutoDownloadPlatform, string[]> = {
  instagram: ["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am"],
  tiktok: ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  douyin: ["douyin.com", "v.douyin.com", "www.douyin.com", "iesdouyin.com", "ixigua.com"],
  kwai: ["kwai.com", "kwai-video.com", "kuaishou.com", "k.kwai.com"],
  shopee: ["shopee.com", "shopee.com.br", "sv.shopee.com.br", "shp.ee"],
  mercadolivre: ["mercadolivre.com.br", "mercadolibre.com", "meli.la"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch", "fb.com"],
  youtube: ["youtube.com", "youtu.be"],
  pinterest: ["pinterest.com", "pin.it", "pinimg.com"],
  threads: ["threads.net", "threads.com"],
  mediafire: ["mediafire.com"],
  freepik: ["freepik.com"],
  envato: ["elements.envato.com"],
  mega: ["mega.nz", "mega.co.nz"],
  spotify: ["spotify.com"],
  twitter: ["twitter.com", "x.com"],
  soundcloud: ["soundcloud.com", "snd.sc"],
  bandcamp: ["bandcamp.com"],
  twitch: ["twitch.tv", "clips.twitch.tv", "m.twitch.tv"],
  rumble: ["rumble.com"],
  odysee: ["odysee.com", "lbry.tv"],
  twitterspaces: ["twitter.com", "x.com"],
  mixcloud: ["mixcloud.com"],
  dailymotion: ["dailymotion.com", "dai.ly"],
};

type AutoDownloaderOptions = {
  client: WuzapiClient;
  chatId: string;
  link: string;
  quoted?: { stanzaId: string; participant?: string };
  apiKey?: string | null;
  preferNativeButtons?: boolean;
  userId?: number | null;
};

const JSON_HEADERS = { accept: "application/json" };
const GENERIC_BINARY_MIMES = new Set(["application/octet-stream", "binary/octet-stream"]);

const readAutodownloaderTimeoutMs = (
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
};

// A CDN assinado pode ficar pendurado indefinidamente quando o token expira.
// Nunca deixe esse fetch ocupar a fila de webhooks sem limite.
const AUTODOWNLOADER_FETCH_TIMEOUT_MS = readAutodownloaderTimeoutMs(
  process.env.AUTODOWNLOADER_FETCH_TIMEOUT_MS,
  30_000,
  5_000,
  120_000,
);
const AUTODOWNLOADER_RESOLVER_TIMEOUT_MS = readAutodownloaderTimeoutMs(
  process.env.AUTODOWNLOADER_RESOLVER_TIMEOUT_MS,
  120_000,
  15_000,
  300_000,
);

// URLs assinadas do CDN do Kwai podem ser acessíveis no navegador, mas o
// fetch remoto do EasyZap nem sempre consegue recuperá-las. Estes cabeçalhos
// permitem baixar a mídia no BotAdmin e encaminhá-la como arquivo binário.
const KWAI_MEDIA_HEADERS: Record<string, string> = {
  accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  referer: "https://www.kwai.com/",
};

const MB = 1024 * 1024;
const DEFAULT_VIDEO_INLINE_LIMIT = 60 * MB;
const DEFAULT_AUTODOWNLOADER_MAX = 2 * 1024 * MB; // 2 GB

const resolveVideoInlineLimit = () => {
  const raw = process.env.AUTODOWNLOADER_VIDEO_INLINE_LIMIT_BYTES?.trim();
  if (!raw) return DEFAULT_VIDEO_INLINE_LIMIT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VIDEO_INLINE_LIMIT;
};

const resolveAutoDownloaderMaxBytes = () => {
  const raw = process.env.AUTODOWNLOADER_MAX_BYTES?.trim();
  if (!raw) return DEFAULT_AUTODOWNLOADER_MAX;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTODOWNLOADER_MAX;
};

const fetchContentLength = async (url: string): Promise<number | null> => {
  try {
    const resp = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!resp.ok) {
      return null;
    }
    const len = resp.headers.get("content-length");
    if (len) {
      const parsed = Number.parseInt(len, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
};

const formatHumanSize = (bytes: number | null): string => {
  if (bytes === null || Number.isNaN(bytes) || bytes < 0) {
    return "desconhecido";
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
};

const getInternalApiKey = (): string | null => {
  const candidates = [
    process.env.INTERNAL_API_KEY,
    process.env.BOTADMIN_INTERNAL_API_KEY,
    process.env.USER_API_FALLBACK_KEY,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
};

const getRestInternalBaseUrl = (): string => {
  const explicit = process.env.REST_INTERNAL_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const port = process.env.PORT?.trim() || "4322";
  return `http://127.0.0.1:${port}`;
};

type FileTypeModule = {
  fileTypeFromBuffer?: (buffer: Uint8Array) => Promise<{ mime: string; ext: string } | undefined>;
  fromBuffer?: (buffer: Uint8Array) => Promise<{ mime: string; ext: string } | undefined>;
};

let fileTypeDetectorPromise: Promise<FileTypeModule | null> | null = null;

const resolveFileTypeModule = (mod: unknown): FileTypeModule | null => {
  if (!mod) return null;
  if (typeof mod === "function" || typeof mod === "object") {
    const normalized = (mod as { default?: unknown }).default ?? mod;
    if (normalized && (typeof normalized === "function" || typeof normalized === "object")) {
      return normalized as FileTypeModule;
    }
  }
  return null;
};

const loadFileTypeDetector = async (): Promise<FileTypeModule | null> => {
  if (fileTypeDetectorPromise) {
    return fileTypeDetectorPromise;
  }

  fileTypeDetectorPromise = (async () => {
    try {
      const req = eval("require") as NodeRequire;
      const mod = req("file-type");
      const resolved = resolveFileTypeModule(mod);
      if (resolved) {
        return resolved;
      }
    } catch {
      /* ignore require failures */
    }

    try {
      const mod = await import("file-type");
      const resolved = resolveFileTypeModule(mod);
      if (resolved) {
        return resolved;
      }
    } catch {
      /* ignore dynamic import failures */
    }

    return null;
  })();

  const moduleResult = await fileTypeDetectorPromise;
  if (!moduleResult) {
    fileTypeDetectorPromise = null;
  }
  return moduleResult;
};

const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)(?:$|[?#&])/i;
const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|webp|gif|avif)(?:$|[?#&])/i;

const urlMatchesPattern = (url: string, pattern: RegExp): boolean => {
  const hasMatchingExtension = (value: string): boolean => pattern.test(value);

  if (hasMatchingExtension(url)) {
    return true;
  }
  try {
    const decoded = decodeURIComponent(url);
    if (decoded !== url && hasMatchingExtension(decoded)) {
      return true;
    }
  } catch {
    /* ignore decode errors */
  }
  try {
    const parsed = new URL(url);
    if (hasMatchingExtension(parsed.pathname)) {
      return true;
    }
    try {
      const decodedPath = decodeURIComponent(parsed.pathname);
      if (decodedPath !== parsed.pathname && hasMatchingExtension(decodedPath)) {
        return true;
      }
    } catch {
      /* ignore path decode errors */
    }
    for (const value of parsed.searchParams.values()) {
      if (hasMatchingExtension(value)) {
        return true;
      }
      try {
        const decodedValue = decodeURIComponent(value);
        if (decodedValue !== value && hasMatchingExtension(decodedValue)) {
          return true;
        }
      } catch {
        /* ignore param decode errors */
      }
    }
  } catch {
    /* ignore parsing errors */
  }
  return false;
};

const looksLikeVideoUrl = (url: string): boolean => urlMatchesPattern(url, VIDEO_EXTENSION_PATTERN);

const looksLikeImageUrl = (url: string): boolean => urlMatchesPattern(url, IMAGE_EXTENSION_PATTERN);

const normalizeContentType = (value: string | null | undefined): string | null => {
  const normalized = (value || "").split(";")[0]?.trim().toLowerCase();
  return normalized || null;
};

const detectMimeFromUrl = (url: string, fallback: string): string => {
  const lookupResult = mime.lookup(url);
  if (typeof lookupResult === "string" && lookupResult.trim()) {
    return lookupResult;
  }
  return fallback;
};

const inferRemoteMediaKind = (
  url: string,
  mimeType: string | null | undefined,
  descriptor = "",
  preferVideo = false,
): "image" | "video" | null => {
  const normalizedMime = normalizeContentType(mimeType);
  if (normalizedMime?.startsWith("video/")) {
    return "video";
  }
  if (normalizedMime?.startsWith("image/")) {
    return "image";
  }

  const normalizedDescriptor = descriptor.toLowerCase();
  if (/(^|[^a-z0-9])(video|mp4|mov|m4v|webm|3gp)([^a-z0-9]|$)/i.test(normalizedDescriptor)) {
    return "video";
  }
  if (/(^|[^a-z0-9])(image|photo|jpg|jpeg|png|webp|gif|avif)([^a-z0-9]|$)/i.test(normalizedDescriptor)) {
    return "image";
  }
  if (looksLikeVideoUrl(url)) {
    return "video";
  }
  if (looksLikeImageUrl(url)) {
    return "image";
  }
  return preferVideo ? "video" : null;
};

const sanitizeFileName = (value: string, fallback = "file"): string => {
  const trimmed = value.replace(/[^\w\s.-]+/g, "").replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : fallback;
};

type AffiliateOfferProductSnapshot = {
  title: string | null;
  description: string | null;
  finalUrl: string;
  imageUrl: string | null;
  priceFormatted: string | null;
  oldPriceFormatted: string | null;
  installmentsFormatted: string | null;
  soldText: string | null;
  stockText: string | null;
  shippingText: string | null;
  conditionText: string | null;
  sellerText: string | null;
  ratingText?: string | null;
};

const normalizeAutoDownloaderUserId = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
};

const cleanText = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
};

const resolveConditionLabel = (value: string | null | undefined): string | null => {
  const normalized = cleanText(value);
  if (!normalized) return null;
  if (normalized.toLowerCase() === "new") return "Novo";
  if (normalized.toLowerCase() === "used") return "Usado";
  return normalized;
};

const toSafeIntegerText = (value: number | null | undefined): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? String(normalized) : null;
};

const buildAffiliateOfferBody = (
  providerLabel: string,
  product: AffiliateOfferProductSnapshot,
): string => {
  const lines = [`🛒 *${providerLabel}*`];

  const title = cleanText(product.title);
  const description = cleanText(product.description);
  if (title) {
    lines.push(`📦 *${title}*`);
  }
  if (description && description !== title) {
    lines.push(`📝 ${description}`);
  }
  if (cleanText(product.priceFormatted)) {
    lines.push(`💰 ${cleanText(product.priceFormatted)}`);
  }
  if (
    cleanText(product.oldPriceFormatted) &&
    cleanText(product.oldPriceFormatted) !== cleanText(product.priceFormatted)
  ) {
    lines.push(`💸 Antes: ${cleanText(product.oldPriceFormatted)}`);
  }
  if (cleanText(product.installmentsFormatted)) {
    lines.push(`💳 ${cleanText(product.installmentsFormatted)}`);
  }
  if (cleanText(product.conditionText)) {
    lines.push(`📌 Condição: ${cleanText(product.conditionText)}`);
  }
  if (cleanText(product.soldText)) {
    lines.push(`📈 Vendidos: ${cleanText(product.soldText)}`);
  }
  if (cleanText(product.stockText)) {
    lines.push(`📦 Estoque: ${cleanText(product.stockText)}`);
  }
  if (cleanText(product.shippingText)) {
    lines.push(`🚚 ${cleanText(product.shippingText)}`);
  }
  if (cleanText(product.sellerText)) {
    lines.push(`🏪 ${cleanText(product.sellerText)}`);
  }
  if (cleanText(product.ratingText)) {
    lines.push(`⭐ ${cleanText(product.ratingText)}`);
  }

  lines.push("", `🔗 ${product.finalUrl}`);
  return lines.filter(Boolean).join("\n");
};

const sendAffiliateOfferMessage = async (
  client: WuzapiClient,
  options: {
    chatId: string;
    providerLabel: string;
    finalUrl: string;
    imageUrl: string | null;
    body: string;
    quoted?: { stanzaId: string; participant?: string };
    preferNativeButtons?: boolean;
  },
): Promise<void> => {
  const { chatId, providerLabel, finalUrl, imageUrl, body, quoted, preferNativeButtons } = options;
  const buttonLabel = "Acessar oferta 🔥";
  const footerText = "Abra no botão ou copie o link da legenda.";

  if (preferNativeButtons) {
    try {
      await sendInteractiveButtons(client, {
        to: chatId,
        title: providerLabel,
        body,
        footer: footerText,
        quoted,
        buttonType: "native",
        headerMedia: imageUrl
          ? {
              type: "image",
              media: imageUrl,
              mimeType: "image/jpeg",
            }
          : null,
        buttons: [
          {
            id: `autodownloader_affiliate_${providerLabel.toLowerCase().replace(/\s+/g, "_")}_open`,
            text: buttonLabel,
            type: "cta_url",
            url: finalUrl,
          },
        ],
      });
      return;
    } catch (error) {
      console.warn("[autodownloader] Falha ao enviar botões de oferta afiliada", {
        error,
        providerLabel,
        finalUrl,
      });
    }
  }

  if (imageUrl) {
    try {
      await sendMediaMessage(client, {
        to: chatId,
        media: imageUrl,
        mediaType: "image",
        mimeType: "image/jpeg",
        filename: sanitizeFileName(`${providerLabel.toLowerCase()}-oferta`, "oferta") + ".jpg",
        caption: body,
        quoted,
      });
      return;
    } catch (error) {
      console.warn("[autodownloader] Falha ao enviar mídia da oferta afiliada", {
        error,
        providerLabel,
        imageUrl,
      });
    }
  }

  await sendTextMessage(client, {
    to: chatId,
    body,
    quoted,
  });
};

const sendVideoCallToAction = async (
  client: WuzapiClient,
  options: {
    chatId: string;
    title: string;
    body?: string | null;
    finalUrl: string;
    imageUrl?: string | null;
    videoUrl?: string | null;
    videoFilename?: string | null;
    videoMimeType?: string | null;
    buttonText?: string | null;
    quoted?: { stanzaId: string; participant?: string };
    preferNativeButtons?: boolean;
  },
): Promise<boolean> => {
  const {
    chatId,
    title,
    body,
    finalUrl,
    imageUrl,
    videoUrl,
    videoFilename,
    videoMimeType,
    buttonText,
    quoted,
    preferNativeButtons,
  } = options;
  const resolvedBody = cleanText(body) || `🔗 ${finalUrl}`;
  const resolvedButtonText = cleanText(buttonText) || "Abrir link";

  if (preferNativeButtons) {
    try {
      await sendInteractiveButtons(client, {
        to: chatId,
        title,
        body: resolvedBody,
        footer: "Toque no botao para abrir o produto.",
        quoted,
        buttonType: "native",
        headerMedia: videoUrl
          ? {
              type: "video",
              media: videoUrl,
              mimeType: videoMimeType || "video/mp4",
              fileName: videoFilename || "video.mp4",
            }
          : imageUrl
          ? {
              type: "image",
              media: imageUrl,
              mimeType: "image/jpeg",
            }
          : null,
        buttons: [
          {
            id: `autodownloader_cta_${Date.now()}`,
            text: resolvedButtonText,
            type: "cta_url",
            url: finalUrl,
          },
        ],
      });
      return true;
    } catch (error) {
      console.warn("[autodownloader] Falha ao enviar CTA do video", {
        error,
        finalUrl,
      });
      return false;
    }
  }

  await sendTextMessage(client, {
    to: chatId,
    body: [resolvedBody, `🔗 ${finalUrl}`].filter(Boolean).join("\n\n"),
    quoted,
  });
  return true;
};

const resolvePinterestUrl = async (link: string): Promise<string> => {
  if (!/pin\.it\//i.test(link)) {
    return link;
  }
  try {
    const baseHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    } as const;

    const first = await axios.get(link, {
      headers: baseHeaders,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    let next = first.headers?.location || null;
    if (!next) {
      return link;
    }
    if (!/^https?:\/\//i.test(next)) {
      next = new URL(next, link).toString();
    }

    let cookiesHeader: string | undefined;
    const setCookie = first.headers?.["set-cookie"];
    if (Array.isArray(setCookie) && setCookie.length > 0) {
      cookiesHeader = setCookie.map((entry) => entry.split(";")[0]).join("; ");
    }

    if (/api\.pinterest\.com\/url_shortener/i.test(next)) {
      const second = await axios.get(next, {
        headers: cookiesHeader ? { ...baseHeaders, Cookie: cookiesHeader } : baseHeaders,
        maxRedirects: 0,
        validateStatus: () => true,
      });
      const secondLocation = second.headers?.location;
      if (secondLocation) {
        next = /^https?:\/\//i.test(secondLocation)
          ? secondLocation
          : new URL(secondLocation, next).toString();
      }
    }

    return next;
  } catch (error) {
    console.warn("[autodownloader] Falha ao resolver pin.it", { error });
  }
  return link;
};

const detectSpecialPlatform = (url: URL): AutoDownloadPlatform | null => {
  const host = url.hostname.toLowerCase();
  if ((host === "twitter.com" || host === "x.com") && /\/spaces\//i.test(url.pathname)) {
    return "twitterspaces";
  }
  return null;
};

const detectPlatform = (link: string): AutoDownloadPlatform | null => {
  try {
    const url = new URL(link);
    const special = detectSpecialPlatform(url);
    if (special) {
      return special;
    }
    const host = url.hostname.toLowerCase();
    for (const [platform, domains] of Object.entries(AUTO_DOWNLOAD_DOMAINS) as [
      AutoDownloadPlatform,
      string[],
    ][]) {
      if (
        domains.some((domain) => {
          const lowered = domain.toLowerCase();
          return (
            host === lowered ||
            host.endsWith(`.${lowered}`) ||
            host.includes(lowered.replace(/^\*\./, ""))
          );
        })
      ) {
        return platform;
      }
    }
  } catch {
    /* ignore invalid URLs */
  }
  return null;
};

export const isSupportedAutoDownloadLink = (
  link: string,
  platform: AutoDownloadPlatform,
): boolean => {
  try {
    const host = new URL(link).hostname.toLowerCase();
    const domains = AUTO_DOWNLOAD_DOMAINS[platform] ?? [];
    return domains.some((domain) => {
      const lowered = domain.toLowerCase();
      return (
        host === lowered || host.endsWith(`.${lowered}`) || host.includes(lowered.replace(/^\*\./, ""))
      );
    });
  } catch {
    return false;
  }
};

const resolveAbsoluteUrl = (value: string): string => {
  if (!value) {
    return value;
  }
  let url = value.trim();
  if (url.startsWith("//")) {
    url = `https:${url}`;
  }
  if (!/^https?:\/\//i.test(url)) {
    try {
      url = new URL(url, "https://www.pinterest.com").toString();
    } catch {
      /* ignore resolution errors */
    }
  }
  return url;
};

type CheerioModule = typeof import("cheerio");

let cheerioCache: CheerioModule | null = null;

const loadCheerio = async (): Promise<CheerioModule> => {
  if (cheerioCache) {
    return cheerioCache;
  }

  const mod = await import("cheerio");
  cheerioCache = ((mod as CheerioModule & { default?: CheerioModule }).load
    ? mod
    : (mod as CheerioModule & { default?: CheerioModule }).default) as CheerioModule;
  return cheerioCache;
};

type SavePinResult = {
  title: string | null;
  results: Array<{ type: string; format: string; downloadLink: string }>;
};

type PinterestRestResult = {
  title: string | null;
  description: string | null;
  downloads: PinterestDownloadEntry[];
};

const decodeForceSaveLink = (raw: string): string => {
  if (raw.startsWith("force-save.php?url=")) {
    const encoded = raw.replace(/^force-save\.php\?url=/, "");
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded) return decoded;
    } catch {
      /* ignore decode errors */
    }
  }
  return raw;
};

const scrapePinterestWithSavePin = async (link: string): Promise<SavePinResult | null> => {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.savepin.app/pinterest/",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const timeouts = [20000, 35000, 50000] as const;
  const cheerio = await loadCheerio();
  let fallbackResult: SavePinResult | null = null;
  let lastError: unknown = null;

  const attempt = async (targetUrl: string): Promise<SavePinResult | null> => {
    const requestUrl = new URL("https://www.savepin.app/download.php");
    requestUrl.searchParams.set("url", targetUrl);
    requestUrl.searchParams.set("lang", "en");
    requestUrl.searchParams.set("type", "redirect");

    for (const timeout of timeouts) {
      try {
        const response = await axios.get<string>(requestUrl.toString(), {
          headers,
          timeout,
          responseType: "text",
          maxRedirects: 5,
        });
        const html = response.data ?? "";
        if (!html.trim()) {
          return null;
        }

        const $ = cheerio.load(html);
        const results: SavePinResult["results"] = [];

        $("td.video-quality").each((_, element) => {
          const row = $(element).closest("tr");
          if (!row || row.length === 0) {
            return;
          }
          const type = $(element).text().trim() || "Media";
          const formatCell = $(element).next();
          const format = formatCell.text().trim() || "";
          const anchor =
            row.find('a#submiturl[href]').first() ||
            row.find('a.button.is-success[href]').first() ||
            row.find('a[href*="force-save.php"]').first();
          const href = anchor.attr("href");
          if (!href) {
            return;
          }
          let downloadLink = decodeForceSaveLink(href.trim());
          downloadLink = resolveAbsoluteUrl(downloadLink);
          results.push({ type, format, downloadLink });
        });

        if (results.length === 0) {
          const directImage = $(".image-container img[src]").first().attr("src");
          if (directImage) {
            const resolved = resolveAbsoluteUrl(directImage.trim());
            results.push({ type: "Image", format: "jpg", downloadLink: resolved });
          }
        }

        const title = $("h1").first().text().trim() || null;
        return { title, results };
      } catch (error) {
        lastError = error;
        if (!axios.isAxiosError(error) || error.code !== "ECONNABORTED") {
          throw error;
        }
      }
    }
    return null;
  };

  const candidates: string[] = [link];
  if (/pin\.it\//i.test(link)) {
    try {
      const resolved = await resolvePinterestUrl(link);
      if (resolved && !candidates.includes(resolved)) {
        candidates.unshift(resolved);
      }
    } catch {
      /* ignore */
    }
  }

  for (const candidate of candidates) {
    const result = await attempt(candidate);
    if (result && result.results.length > 0) {
      return result;
    }
    if (result && !fallbackResult) {
      fallbackResult = result;
    }
  }

  if (fallbackResult) {
    return fallbackResult;
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  return null;
};

const fetchPinterestRestResult = async (
  link: string,
  apiKey?: string | null,
): Promise<PinterestRestResult | null> => {
  try {
    const data = await fetchJson(
      `/api/rest/pinterest?url=${encodeURIComponent(link)}&version=v2`,
      apiKey,
    );
    const result = data?.resultado;
    if (!result) {
      return null;
    }
    const downloads = Array.isArray(result.downloads) ? result.downloads : [];
    if (!downloads.length) {
      return null;
    }
    const title =
      typeof result.pin?.title === "string"
        ? result.pin.title
        : typeof result.title === "string"
          ? result.title
          : null;
    const description =
      typeof result.pin?.description === "string" ? result.pin.description : null;
    return { title, description, downloads };
  } catch (error) {
    console.warn("[autodownloader] Pinterest v2 request failed", { error, link });
    return null;
  }
};

const isPinterestDownloadVideo = (entry?: PinterestDownloadEntry | null): boolean => {
  if (!entry) return false;
  const mediaUrl = typeof entry.url === "string" ? entry.url.trim() : "";
  const format = (entry.format || "").toLowerCase();
  const type = (entry.type || "").toLowerCase();
  return type === "video" || format.includes("mp4") || looksLikeVideoUrl(mediaUrl);
};

type SavePinResultEntry = Awaited<ReturnType<typeof scrapePinterestWithSavePin>> extends infer T
  ? T extends { results: Array<infer R> }
    ? R
    : never
  : never;

const isSavePinResultVideo = (entry: SavePinResultEntry): boolean => {
  const mediaUrl = resolveAbsoluteUrl(entry.downloadLink?.trim() || "");
  const descriptor = `${entry.format || ""} ${entry.type || ""}`.toLowerCase();
  return /\.mp4($|\?)/i.test(mediaUrl) || descriptor.includes("mp4") || descriptor.includes("video");
};

const sendPinterestDownloads = async (
  client: WuzapiClient,
  chatId: string,
  payload: PinterestRestResult,
  quoted?: { stanzaId: string; participant?: string },
): Promise<boolean> => {
  const uniqueDownloads = payload.downloads
    .filter(
      (entry, index, array) =>
        typeof entry?.url === "string" &&
        entry.url.trim().length > 0 &&
        !entry.isHls &&
        (entry.format ?? "").toLowerCase() !== "m3u8" &&
        array.findIndex((candidate) => candidate?.url === entry?.url) === index,
    )
    .sort((a, b) => Number(isPinterestDownloadVideo(b)) - Number(isPinterestDownloadVideo(a)));
  if (!uniqueDownloads.length) {
    return false;
  }

  const captionParts: string[] = [];
  if (payload.title) {
    captionParts.push(payload.title);
  }
  if (payload.description && payload.description !== payload.title) {
    captionParts.push(payload.description);
  }
  const caption = captionParts.join("\n\n").trim() || "Pinterest";
  const baseFilename = sanitizeFileName(payload.title || "pinterest", "pinterest");

  let sent = false;
  let captionSent = false;

  for (let index = 0; index < uniqueDownloads.length; index += 1) {
    const entry = uniqueDownloads[index];
    const mediaUrl = entry.url.trim();
    const format = (entry.format || "").toLowerCase();
    const quality = entry.quality ? entry.quality.toString() : null;
    const isVideo = isPinterestDownloadVideo(entry);
    const extension = format.includes("png")
      ? "png"
      : format.includes("gif")
        ? "gif"
        : isVideo
          ? "mp4"
          : "jpg";
    const mimeType =
      extension === "png"
        ? "image/png"
        : extension === "gif"
          ? "image/gif"
          : isVideo
            ? "video/mp4"
            : "image/jpeg";
    const qualitySlug = quality ? sanitizeFileName(quality, "").replace(/\s+/g, "_") : "";
    const filenameParts = [baseFilename];
    if (qualitySlug) {
      filenameParts.push(qualitySlug);
    }
    filenameParts.push(String(Date.now()));
    const filename = `${filenameParts.filter(Boolean).join("_")}.${extension}`;

    try {
      await sendRemoteMedia(client, {
        chatId,
        url: mediaUrl,
        mediaType: isVideo ? "video" : "image",
        mimeType,
        filename,
        caption: captionSent ? undefined : caption,
        quoted,
      });
      captionSent = true;
      sent = true;
    } catch (error) {
      console.warn("[autodownloader] Falha ao enviar Pinterest v2", { error, mediaUrl });
    }
  }

  return sent;
};

const fetchJson = async (path: string, apiKey?: string | null): Promise<any> => {
  const baseUrl = path.startsWith("/api/rest/")
    ? getRestInternalBaseUrl()
    : getAppBaseUrl();
  const url = new URL(path, baseUrl);
  const headers: Record<string, string> = { ...JSON_HEADERS };
  const authKey = apiKey?.trim() || getInternalApiKey();
  if (authKey) {
    headers["x-api-key"] = authKey;
  }
  const resp = await fetchWithTimeout(url.toString(), { headers }, AUTODOWNLOADER_RESOLVER_TIMEOUT_MS);
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  if (!resp.ok) {
    const message =
      data?.message ||
      data?.mensagem ||
      `AutoDownloader request failed (${resp.status} ${resp.statusText})`;
    throw new Error(message);
  }
  return data;
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs = AUTODOWNLOADER_FETCH_TIMEOUT_MS,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fetchContentTypeWithHeaders = async (
  url: string,
  headers: Record<string, string>,
): Promise<string | null> => {
  try {
    const headResp = await fetchWithTimeout(
      url,
      { method: "HEAD", headers, redirect: "follow" },
      AUTODOWNLOADER_FETCH_TIMEOUT_MS,
    );
    if (!headResp.ok) {
      return null;
    }
    return normalizeContentType(headResp.headers.get("content-type"));
  } catch {
    return null;
  }
};

const downloadWithHeaders = async (
  url: string,
  headers: Record<string, string>,
): Promise<{ buffer: Buffer; mimeType: string }> => {
  // Baixe em uma única requisição. O HEAD de alguns CDNs do Instagram não
  // termina e deixava o evento preso antes mesmo de tentar enviar a mídia.
  const resp = await fetchWithTimeout(
    url,
    { headers, redirect: "follow" },
    AUTODOWNLOADER_FETCH_TIMEOUT_MS,
  );
  if (!resp.ok) {
    throw new Error(`Falha ao baixar mídia (${resp.status})`);
  }
  let contentType: string | null = resp.headers.get("content-type");
  const contentLength = Number(resp.headers.get("content-length") || 0);
  const maxBytes = resolveAutoDownloaderMaxBytes();
  if (contentLength > 0 && contentLength > maxBytes) {
    throw new Error(`Mídia excede o limite permitido (${formatHumanSize(maxBytes)}).`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw new Error("A mídia retornou um arquivo vazio.");
  }
  if (buffer.length > maxBytes) {
    throw new Error(`Mídia excede o limite permitido (${formatHumanSize(maxBytes)}).`);
  }

  const normalizedResponseType = normalizeContentType(contentType);
  const preview = buffer.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  if (
    normalizedResponseType === "text/html" ||
    normalizedResponseType === "application/json" ||
    preview.startsWith("<!doctype html") ||
    preview.startsWith("<html") ||
    preview.startsWith("{\"error")
  ) {
    throw new Error("O provedor retornou uma página de bloqueio em vez da mídia.");
  }

  const normalizedContentType = (contentType || "").split(";")[0]?.trim().toLowerCase();
  let detectedMime: string | null = null;
  if (!normalizedContentType || GENERIC_BINARY_MIMES.has(normalizedContentType)) {
    const detector = await loadFileTypeDetector();
    if (detector) {
      try {
        const result =
          (await detector.fileTypeFromBuffer?.(buffer)) ||
          (await detector.fromBuffer?.(buffer));
        if (result?.mime) {
          detectedMime = result.mime;
        }
      } catch {
        /* ignore detection errors */
      }
    }
  }

  const mimeType = detectedMime || contentType || detectMimeFromUrl(url, "application/octet-stream");
  return { buffer, mimeType };
};

const sendBufferMedia = async (
  client: WuzapiClient,
  options: {
    chatId: string;
    buffer: Buffer;
    mimeType: string;
    mediaType: "image" | "video" | "audio" | "document";
    filename: string;
    caption?: string;
    quoted?: { stanzaId: string; participant?: string };
  },
): Promise<void> => {
  const { chatId, buffer, mimeType, mediaType, filename, caption, quoted } = options;
  await sendMediaMessage(client, {
    to: chatId,
    media: buffer,
    mediaType,
    mimeType,
    filename,
    caption,
    quoted,
  });
};

const sendRemoteMedia = async (
  client: WuzapiClient,
  options: {
    chatId: string;
    url: string;
    mediaType: "image" | "video" | "audio" | "document";
    mimeType: string;
    filename: string;
    caption?: string;
    quoted?: { stanzaId: string; participant?: string };
  },
): Promise<void> => {
  const { chatId, url, mediaType, mimeType, filename, caption, quoted } = options;
  const normalizedMime = (mimeType || "").toLowerCase();
  const isVideoContent = normalizedMime.startsWith("video/");
  const needsMp4Conversion = isVideoContent && !normalizedMime.startsWith("video/mp4");
  const isVideoDocument = mediaType === "document" && isVideoContent;

  const shouldForceDownload = (mediaType === "video" && needsMp4Conversion) || (isVideoDocument && needsMp4Conversion);

  const finalMimeType = shouldForceDownload ? "video/mp4" : mimeType;
  const finalFilename =
    shouldForceDownload && filename && !/\.mp4(?:$|\?)/i.test(filename)
      ? `${filename.replace(/\.[^.]+$/, "") || "video"}.mp4`
      : filename;

  await sendMediaMessage(client, {
    to: chatId,
    media: url,
    mediaType,
    mimeType: finalMimeType,
    filename: finalFilename,
    caption,
    quoted,
    useExternalUrl: !shouldForceDownload,
  });
};

const handleInstagram = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
): Promise<boolean> => {
  const data = await fetchJson(`/api/rest/instagram?url=${encodeURIComponent(link)}`, apiKey);
  const urls: string[] = Array.isArray(data?.resultado?.urls) ? data.resultado.urls : [];
  if (!urls.length) {
    return false;
  }
  const downloads: Array<Record<string, any>> = Array.isArray(data?.resultado?.downloads)
    ? data.resultado.downloads
    : [];
  const preferVideo = data?.resultado?.isVideo === true || /\/(?:reel|tv)\//i.test(link);

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "*/*",
    Referer: "https://www.instagram.com/",
    Origin: "https://www.instagram.com",
  };

  console.info("[autodownloader] Instagram resolvido", {
    link,
    urls: urls.length,
    downloads: downloads.length,
    preferVideo,
  });

  const findDownloadEntry = (mediaUrl: string): Record<string, any> | null =>
    downloads.find((entry) => typeof entry?.url === "string" && entry.url.trim() === mediaUrl) ?? null;

  const buildDownloadDescriptor = (entry: Record<string, any> | null): string =>
    [
      entry?.mediaType,
      entry?.type,
      entry?.format,
      entry?.quality,
      entry?.label,
      entry?.mimeType,
    ]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ");

  let sent = false;
  for (let i = 0; i < urls.length; i += 1) {
    const mediaUrl = urls[i];
    // O autodownloader deve publicar somente a mídia. Legendas e metadados
    // ficam no histórico do link original e não poluem o grupo.
    const captionPayload = undefined;
    const downloadEntry = findDownloadEntry(mediaUrl);
    const descriptor = buildDownloadDescriptor(downloadEntry);

    let downloadResult: { buffer: Buffer; mimeType: string } | null = null;
    try {
      downloadResult = await downloadWithHeaders(mediaUrl, headers);
    } catch (error) {
      console.warn("[autodownloader] Falha ao baixar mídia do Instagram", {
        error,
        mediaUrl,
      });
    }

    if (downloadResult) {
      try {
        const bufferMimeType =
          normalizeContentType(downloadResult.mimeType) ??
          detectMimeFromUrl(mediaUrl, preferVideo ? "video/mp4" : "image/jpeg");
        const bufferKind = inferRemoteMediaKind(mediaUrl, bufferMimeType, descriptor, preferVideo);
        const shouldSendVideo = bufferKind === "video";
        const extension = shouldSendVideo
          ? "mp4"
          : mime.extension(bufferMimeType) || mime.extension(mediaUrl) || "jpg";
        const filename = `instagram_${Date.now()}_${i + 1}.${extension}`;
        console.info("[autodownloader] Instagram mídia baixada", {
          mediaUrl,
          bytes: downloadResult.buffer.length,
          mimeType: bufferMimeType,
          mediaType: shouldSendVideo ? "video" : "image",
        });
        await sendBufferMedia(client, {
          chatId,
          buffer: downloadResult.buffer,
          mimeType: shouldSendVideo ? "video/mp4" : bufferMimeType,
          mediaType: shouldSendVideo ? "video" : "image",
          filename: shouldSendVideo ? filename.replace(/\.[^.]+$/, ".mp4") : filename,
          caption: captionPayload,
          quoted,
        });
        sent = true;
        console.info("[autodownloader] Instagram mídia enviada", {
          chatId,
          mediaType: shouldSendVideo ? "video" : "image",
          bytes: downloadResult.buffer.length,
        });
        continue;
      } catch (error) {
        console.warn("[autodownloader] Falha ao enviar mídia do Instagram", {
          error,
          mediaUrl,
        });
      }
    }

    const headMimeType = await fetchContentTypeWithHeaders(mediaUrl, headers);
    const baseMimeType = headMimeType ?? detectMimeFromUrl(mediaUrl, "application/octet-stream");
    const inferredKind = inferRemoteMediaKind(mediaUrl, baseMimeType, descriptor, preferVideo);
    const isVideo = inferredKind === "video";
    const effectiveMimeType = isVideo ? "video/mp4" : baseMimeType;
    const ext = mime.extension(baseMimeType) || (isVideo ? "mp4" : "jpg");
    const filename = `instagram_${Date.now()}_${i + 1}.${ext}`;

    try {
      const fallbackKind = inferRemoteMediaKind(mediaUrl, baseMimeType, descriptor, isVideo);
      const fallbackIsVideo = fallbackKind === "video";
      await sendRemoteMedia(client, {
        chatId,
        url: mediaUrl,
        mediaType: fallbackIsVideo ? "video" : "image",
        mimeType: fallbackIsVideo ? "video/mp4" : effectiveMimeType,
        filename: fallbackIsVideo ? filename.replace(/\.[^.]+$/, ".mp4") : filename,
        caption: captionPayload,
        quoted,
      });
      sent = true;
    } catch (fallbackError) {
      console.error("[autodownloader] Falha no fallback remoto do Instagram", {
        error: fallbackError,
        mediaUrl,
      });
    }
  }
  if (!sent) {
    console.error("[autodownloader] Instagram não pôde ser enviado após todos os fallbacks", {
      link,
      urls: urls.length,
    });
  }
  return sent;
};

const searchMercadoLivreWithFallback = async (
  link: string,
  userId?: number | null,
): Promise<Awaited<ReturnType<typeof searchMercadoLivre>>> => {
  const normalizedUserId = normalizeAutoDownloaderUserId(userId);
  if (normalizedUserId) {
    try {
      return await searchMercadoLivre(link, { userId: normalizedUserId, limit: 1 });
    } catch (error) {
      console.warn("[autodownloader] Mercado Livre com conta do usuário falhou; fallback para conta padrão", {
        error,
        link,
        userId: normalizedUserId,
      });
    }
  }
  return searchMercadoLivre(link, { limit: 1 });
};

const handleMercadoLivreAffiliateProduct = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  userId?: number | null,
  preferNativeButtons?: boolean,
): Promise<boolean> => {
  const normalizedUserId = normalizeAutoDownloaderUserId(userId);
  const result = await searchMercadoLivreWithFallback(link, normalizedUserId);
  const product = (Array.isArray(result?.produtos) ? result.produtos[0] : null) as MercadoLivreProduct | null;
  const itemId = cleanText(product?.id);
  if (!product || !itemId) {
    return false;
  }

  let finalUrl =
    (normalizedUserId
      ? (await resolveAffiliateMlLinkForUserByItemId(normalizedUserId, itemId))?.affiliateUrl ?? null
      : null) ||
    null;

  if (!finalUrl) {
    try {
      const generated = await generateAffiliateMlLinksForUserWithAdminFallback(
        normalizedUserId,
        [cleanText(product.url) || link],
      );
      finalUrl = generated.links[0]?.shortUrl || null;
    } catch (error) {
      console.warn("[autodownloader] Falha ao gerar link afiliado do Mercado Livre", {
        error,
        link,
        itemId,
      });
    }
  }

  finalUrl = finalUrl || cleanText(product.url) || link;
  const sellerText =
    cleanText(product.vendedor?.nickname) ||
    (typeof product.vendedor?.id === "number" && Number.isFinite(product.vendedor.id)
      ? `ID ${product.vendedor.id}`
      : null);
  const body = buildAffiliateOfferBody("Mercado Livre", {
    title: product.titulo,
    description: product.descricaoCurta,
    finalUrl,
    imageUrl: cleanText(product.imagem),
    priceFormatted: product.precoFormatado,
    oldPriceFormatted: product.precoAntigoFormatado,
    installmentsFormatted: product.precoParcelado,
    soldText: toSafeIntegerText(product.vendidos),
    stockText: toSafeIntegerText(product.estoque),
    shippingText: product.freteGratis ? "Frete grátis" : cleanText(product.freteTexto),
    conditionText: resolveConditionLabel(product.condicao),
    sellerText,
  });

  await sendAffiliateOfferMessage(client, {
    chatId,
    providerLabel: "Mercado Livre",
    finalUrl,
    imageUrl: cleanText(product.imagem),
    body,
    quoted,
    preferNativeButtons,
  });
  return true;
};

const handleTikTok = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
): Promise<boolean> => {
  const data = await fetchJson(`/api/rest/tiktok?url=${encodeURIComponent(link)}`, apiKey);
  const result = data?.resultado;
  if (!result) {
    return false;
  }

  if (result.type === "images" && Array.isArray(result.items) && result.items.length) {
    const caption = result.title ? `🎞️ ${result.title}` : undefined;
    let sent = false;
    for (let i = 0; i < result.items.length; i += 1) {
      const mediaUrl = result.items[i];
      try {
        await sendRemoteMedia(client, {
          chatId,
          url: mediaUrl,
          mediaType: "image",
          mimeType: "image/jpeg",
          filename: `tiktok_${Date.now()}_${i + 1}.jpg`,
          caption: i === 0 ? caption : undefined,
          quoted,
        });
        sent = true;
      } catch (error) {
        console.warn("[autodownloader] Falha ao enviar imagem do TikTok", { error, mediaUrl });
      }
    }
    return sent;
  }

  const videoUrl =
    result.url || result.download || result.hdplay || result.play || data?.data?.download;
  if (!videoUrl) {
    return false;
  }

  const captionParts: string[] = [];
  if (result.title) captionParts.push(`🎬 ${result.title}`);
  if (result.author) captionParts.push(`👤 ${result.author}`);
  const caption = captionParts.join("\n") || undefined;

  try {
    await sendRemoteMedia(client, {
      chatId,
      url: videoUrl,
      mediaType: "video",
      mimeType: "video/mp4",
      filename: `tiktok_${Date.now()}.mp4`,
      caption,
      quoted,
    });
    return true;
  } catch (error) {
    console.error("[autodownloader] Falha ao enviar vídeo do TikTok", { error });
    return false;
  }
};

const handleGenericVideoEndpoint = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  endpoint: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
  options: {
    preferNativeButtons?: boolean;
    ctaTitle?: string | null;
  } = {},
): Promise<boolean> => {
  const data = await fetchJson(`${endpoint}?url=${encodeURIComponent(link)}`, apiKey);
  const result = data?.resultado ?? data?.result ?? data?.data ?? data;
  const resolvedUrl =
    (typeof result?.url === "string" && result.url.trim()) ||
    (typeof result?.videoUrl === "string" && result.videoUrl.trim()) ||
    (typeof result?.download === "string" && result.download.trim()) ||
    (typeof result?.hdplay === "string" && result.hdplay.trim()) ||
    (typeof result?.play === "string" && result.play.trim()) ||
    "";
  if (!resolvedUrl) {
    return false;
  }

  const captionParts: string[] = [];
  if (result.title) captionParts.push(`🎬 ${result.title}`);
  if (result.author) captionParts.push(`👤 ${result.author}`);
  const extraCaption = typeof result.caption === "string" ? result.caption.trim() : "";
  if (extraCaption) {
    captionParts.push(extraCaption);
  }
  const fallbackCaption = captionParts.join("\n") || undefined;
  const affiliateUrl = cleanText(result.affiliateUrl);
  const messageBody = cleanText(result.messageBody) || fallbackCaption || "";
  const captionWithAffiliate =
    cleanText(result.captionWithAffiliate) ||
    (affiliateUrl ? [messageBody, `🔗 ${affiliateUrl}`].filter(Boolean).join("\n\n") : messageBody) ||
    undefined;
  const filename = `${result.title ? result.title.replace(/\s+/g, "_") : "video"}_${Date.now()}.mp4`;
  const isKwaiEndpoint = endpoint.replace(/\/+$/, "").endsWith("/kwai");
  const shouldUseVideoHeaderCta =
    Boolean(options.preferNativeButtons) &&
    Boolean(affiliateUrl) &&
    Boolean(result.useVideoHeaderCta);
  const contentLength = await fetchContentLength(resolvedUrl);
  const sendAsDocument = contentLength !== null && contentLength > resolveVideoInlineLimit();

  if (shouldUseVideoHeaderCta) {
    const sentInteractive = await sendVideoCallToAction(client, {
      chatId,
      title:
        cleanText(result.affiliateTitle) ||
        cleanText(options.ctaTitle) ||
        cleanText(result.title) ||
        "Shopee",
      body: messageBody,
      finalUrl: affiliateUrl || "",
      imageUrl: cleanText(result.affiliateImageUrl) || cleanText(result.thumbnail),
      videoUrl: resolvedUrl,
      videoFilename: filename,
      videoMimeType: "video/mp4",
      buttonText: cleanText(result.affiliateButtonText) || "Ver produto",
      quoted,
      preferNativeButtons: options.preferNativeButtons,
    });
    if (sentInteractive) {
      return true;
    }
  }

  const mediaCaption =
    options.preferNativeButtons && affiliateUrl
      ? messageBody || fallbackCaption
      : captionWithAffiliate || fallbackCaption;

  const sendKwaiFromBuffer = async (): Promise<void> => {
    const downloaded = await downloadWithHeaders(resolvedUrl, KWAI_MEDIA_HEADERS);
    if (!downloaded.buffer.length) {
      throw new Error("O resolvedor do Kwai retornou um arquivo vazio.");
    }
    await sendBufferMedia(client, {
      chatId,
      buffer: downloaded.buffer,
      mediaType: sendAsDocument ? "document" : "video",
      // O CDN do Kwai pode responder como application/octet-stream, embora o
      // conteúdo seja MP4. Forçamos o MIME de vídeo para o player do WhatsApp.
      mimeType: "video/mp4",
      filename,
      caption: mediaCaption,
      quoted,
    });
  };

  try {
    // Prioriza o buffer para o Kwai porque a URL assinada do CDN pode ser
    // rejeitada quando o EasyZap tenta buscá-la por conta própria. Se o
    // download local falhar, ainda preservamos o fallback remoto.
    if (isKwaiEndpoint) {
      try {
        await sendKwaiFromBuffer();
      } catch (bufferError) {
        console.warn("[autodownloader] Download local do Kwai falhou; tentando URL remota", {
          error: bufferError,
          link,
        });
        await sendRemoteMedia(client, {
          chatId,
          url: resolvedUrl,
          mediaType: sendAsDocument ? "document" : "video",
          mimeType: "video/mp4",
          filename,
          caption: mediaCaption,
          quoted,
        });
      }
    } else {
      await sendRemoteMedia(client, {
        chatId,
        url: resolvedUrl,
        mediaType: sendAsDocument ? "document" : "video",
        mimeType: "video/mp4",
        filename,
        caption: mediaCaption,
        quoted,
      });
    }
    if (affiliateUrl && options.preferNativeButtons && !shouldUseVideoHeaderCta) {
      await sendVideoCallToAction(client, {
        chatId,
        title:
          cleanText(result.affiliateTitle) ||
          cleanText(options.ctaTitle) ||
          cleanText(result.title) ||
          "Shopee",
        body: cleanText(result.affiliateBody) || messageBody,
        finalUrl: affiliateUrl,
        imageUrl: cleanText(result.affiliateImageUrl) || cleanText(result.thumbnail),
        buttonText: cleanText(result.affiliateButtonText) || "Ver produto",
        quoted,
        preferNativeButtons: options.preferNativeButtons,
      });
    }
    return true;
  } catch (error) {
    console.error("[autodownloader] Falha ao enviar vídeo", { error, endpoint });
    return false;
  }
};

const handleGenericAudioEndpoint = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  endpoint: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
): Promise<boolean> => {
  const data = await fetchJson(`${endpoint}?url=${encodeURIComponent(link)}`, apiKey);
  const result = data?.resultado;
  if (!result?.url) {
    return false;
  }

  const captionParts: string[] = [];
  if (result.title) captionParts.push(`🎵 ${result.title}`);
  if (result.author) captionParts.push(`👤 ${result.author}`);
  const caption = captionParts.join("\n") || undefined;
  const format = typeof result.format === "string" ? result.format : "audio/mpeg";
  const extension = format.includes("mp4") ? "m4a" : format.includes("webm") ? "webm" : "mp3";

  try {
    await sendRemoteMedia(client, {
      chatId,
      url: result.url,
      mediaType: "audio",
      mimeType: format,
      filename: `${(result.title || "audio").replace(/\s+/g, "_")}_${Date.now()}.${extension}`,
      caption,
      quoted,
    });
    return true;
  } catch (error) {
    console.error("[autodownloader] Falha ao enviar áudio", { error, endpoint });
    return false;
  }
};

const handleFacebook = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
): Promise<boolean> => {
  let data: any = null;
  try {
    data = await fetchJson(`/api/rest/facebook?url=${encodeURIComponent(link)}`, apiKey);
  } catch (error) {
    console.warn("[autodownloader] Facebook dedicado falhou; tentando fallback globalvideo", {
      error,
      link,
    });
    return await handleGenericVideoEndpoint(
      client,
      chatId,
      link,
      "/api/rest/globalvideo",
      quoted,
      apiKey,
    ).catch((fallbackError) => {
      console.warn("[autodownloader] Fallback globalvideo do Facebook falhou", {
        error: fallbackError,
        link,
      });
      return false;
    });
  }
  const metadata =
    (data?.resultado?.metadata && typeof data.resultado.metadata === "object"
      ? data.resultado.metadata
      : null) ||
    (data?.raw?.metadata && typeof data.raw.metadata === "object" ? data.raw.metadata : null);
  const downloads: Array<{ url: string; quality?: string | null; label?: string | null; requiresRender?: boolean }> =
    Array.isArray(metadata?.downloads) ? metadata.downloads : [];
  let urls: string[] = Array.isArray(data?.resultado?.urls) ? data.resultado.urls : [];
  if (!urls.length && downloads.length) {
    urls = downloads.filter((entry) => entry && entry.url && !entry.requiresRender).map((entry) => entry.url);
  }
  if (!urls.length) {
    return false;
  }

  const captionParts: string[] = [];
  const metaTitle = typeof metadata?.title === "string" ? metadata.title.trim() : "";
  const metaCaption = typeof metadata?.caption === "string" ? metadata.caption.trim() : "";
  const metaDescription = typeof metadata?.description === "string" ? metadata.description.trim() : "";
  const metaAuthor = typeof metadata?.author === "string" ? metadata.author.trim() : "";
  if (metaTitle) {
    captionParts.push(`📘 ${metaTitle}`);
  }
  if (metaAuthor) {
    captionParts.push(`👤 ${metaAuthor}`);
  }
  if (metaCaption && metaCaption !== metaTitle) {
    captionParts.push(metaCaption);
  } else if (metaDescription && metaDescription !== metaTitle) {
    captionParts.push(metaDescription);
  }
  const caption = captionParts.length ? captionParts.join("\n\n") : "📘 Facebook";
  const baseFilename = sanitizeFileName(metaTitle || metaAuthor || "facebook", "facebook");

  let sent = false;
  for (let i = 0; i < urls.length; i += 1) {
    const mediaUrl = urls[i];
    const downloadMeta =
      downloads.find((entry) => entry?.url === mediaUrl && !entry?.requiresRender) ?? null;
    const qualityLabel =
      downloadMeta?.quality?.trim() || downloadMeta?.label?.trim() || (urls.length > 1 ? `parte ${i + 1}` : "");
    const qualitySlug = qualityLabel ? sanitizeFileName(qualityLabel, "").replace(/\s+/g, "_") : "";
    const filenameParts = [baseFilename];
    if (qualitySlug) {
      filenameParts.push(qualitySlug);
    }
    filenameParts.push(String(Date.now()));
    const filename = `${filenameParts.filter(Boolean).join("_")}.mp4`;

    try {
      await sendRemoteMedia(client, {
        chatId,
        url: mediaUrl,
        mediaType: "video",
        mimeType: "video/mp4",
        filename,
        caption: i === 0 ? caption : undefined,
        quoted,
      });
      sent = true;
    } catch (error) {
      console.warn("[autodownloader] Falha ao enviar mídia do Facebook", { error, mediaUrl });
    }
  }
  return sent;
};

const handlePinterest = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
): Promise<boolean> => {
  const restResult = await fetchPinterestRestResult(link, apiKey);
  const restHasVideo =
    restResult?.downloads.some((entry) => isPinterestDownloadVideo(entry)) ?? false;
  if (restResult && restHasVideo) {
    const delivered = await sendPinterestDownloads(client, chatId, restResult, quoted);
    if (delivered) {
      return true;
    }
  }

  const scrape = await scrapePinterestWithSavePin(link).catch((error) => {
    console.error("[autodownloader] savepin scrape failed", { link, error });
    return null;
  });

  const normalizedLink = await resolvePinterestUrl(link);
  const tryGlobalVideoFallback = async () =>
    handleGenericVideoEndpoint(
      client,
      chatId,
      normalizedLink,
      "/api/rest/globalvideo",
      quoted,
      apiKey,
    ).catch(() => false);

  if (!scrape || scrape.results.length === 0) {
    const fallback = await tryGlobalVideoFallback();
    if (fallback) {
      return true;
    }
    return restResult ? sendPinterestDownloads(client, chatId, restResult, quoted) : false;
  }

  const scrapeHasVideo = scrape.results.some((entry) => isSavePinResultVideo(entry));
  if (!scrapeHasVideo && !restHasVideo) {
    const fallback = await tryGlobalVideoFallback();
    if (fallback) {
      return true;
    }
  }

  const scrapeResults = scrapeHasVideo
    ? scrape.results.filter((entry) => isSavePinResultVideo(entry))
    : scrape.results;

  if (!scrapeResults.length) {
    const normalizedLink = await resolvePinterestUrl(link);
    const fallback = await handleGenericVideoEndpoint(
      client,
      chatId,
      normalizedLink,
      "/api/rest/globalvideo",
      quoted,
      apiKey,
    ).catch(() => false);
    return fallback;
  }

  let sent = false;
  let captionSent = false;
  const title = scrape.title || "Pinterest";

  for (const [index, entry] of scrapeResults.entries()) {
    let mediaUrl = entry.downloadLink?.trim();
    if (!mediaUrl) {
      continue;
    }
    mediaUrl = resolveAbsoluteUrl(mediaUrl);
    const descriptor = `${entry.format || ""} ${entry.type || ""}`.toLowerCase();
    const forcedVideo =
      /\.mp4($|\?)/i.test(mediaUrl) || descriptor.includes("mp4") || descriptor.includes("video");
    let mimeType = detectMimeFromUrl(mediaUrl, forcedVideo ? "video/mp4" : "image/jpeg");
    if (!mimeType || mimeType === "application/octet-stream") {
      mimeType = forcedVideo ? "video/mp4" : "image/jpeg";
    }

    const mediaType: "video" | "image" =
      forcedVideo || mimeType.toLowerCase().startsWith("video/") ? "video" : "image";
    const extension =
      mime.extension(mimeType) ||
      (forcedVideo ? "mp4" : descriptor.includes("gif") ? "gif" : "jpg");

    try {
      await sendRemoteMedia(client, {
        chatId,
        url: mediaUrl,
        mediaType,
        mimeType,
        filename: `pinterest_${Date.now()}_${index + 1}.${extension}`,
        caption: !captionSent ? title : undefined,
        quoted,
      });
      sent = true;
      captionSent = true;
    } catch (error) {
      console.warn("[autodownloader] Falha ao enviar Pinterest", { error, mediaUrl });
    }
  }

  return sent;
};

const handleThreads = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
): Promise<boolean> => {
  const data = await fetchJson(`/api/rest/threads?url=${encodeURIComponent(link)}`, apiKey);
  const urls: string[] = Array.isArray(data?.resultado?.media_urls)
    ? data.resultado.media_urls
    : [];
  if (!urls.length) {
    return false;
  }

  const user = data?.resultado?.user;
  const captionParts: string[] = [];
  if (user?.full_name || user?.username) {
    const badge = user?.verified ? " ✅" : "";
    captionParts.push(
      `${user.full_name || ""} (@${user.username || ""})${badge}`.trim().replace(/\s+/g, " "),
    );
  }
  if (typeof data?.resultado?.followers === "number") {
    captionParts.push(`👥 ${data.resultado.followers} seguidores`);
  }
  if (typeof data?.resultado?.like_count === "number") {
    captionParts.push(`❤️ ${data.resultado.like_count} likes`);
  }
  if (data?.resultado?.caption) {
    captionParts.push(`\n${data.resultado.caption}`);
  }
  const caption = captionParts.join("\n").trim() || undefined;

  let sent = false;
  for (let i = 0; i < urls.length; i += 1) {
    const mediaUrl = urls[i];
    const isVideo = looksLikeVideoUrl(mediaUrl);
    try {
      await sendRemoteMedia(client, {
        chatId,
        url: mediaUrl,
        mediaType: isVideo ? "video" : "image",
        mimeType: isVideo ? "video/mp4" : "image/jpeg",
        filename: `threads_${Date.now()}_${i + 1}.${isVideo ? "mp4" : "jpg"}`,
        caption: i === 0 ? caption : undefined,
        quoted,
      });
      sent = true;
    } catch (error) {
      console.warn("[autodownloader] Falha ao enviar Threads", { error, mediaUrl });
    }
  }
  return sent;
};

const handleMediafire = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
): Promise<boolean> => {
  const data = await fetchJson(`/api/rest/mediafire?url=${encodeURIComponent(link)}`, apiKey);
  const info = data?.info;
  if (!info?.download_url) {
    return false;
  }

  const fileName = info.filename || `mediafire_${Date.now()}`;
  const mimeType = info.mimetype || detectMimeFromUrl(fileName, "application/octet-stream");

  try {
    await sendRemoteMedia(client, {
      chatId,
      url: info.download_url,
      mediaType: "document",
      mimeType,
      filename: fileName,
      caption: info.filename || undefined,
      quoted,
    });
    return true;
  } catch (error) {
    console.error("[autodownloader] Falha ao enviar arquivo Mediafire", { error });
    return false;
  }
};

type RestFileDownloadOptions = {
  endpoint: string;
  fallbackFilename: string;
  logLabel: string;
};

const handleRestFileDownload = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
  options: RestFileDownloadOptions,
): Promise<boolean> => {
  const data = await fetchJson(`${options.endpoint}?url=${encodeURIComponent(link)}`, apiKey);
  const result = data?.resultado;
  const downloadUrl =
    typeof result?.url === "string" ? result.url : typeof result?.link === "string" ? result.link : null;
  if (!downloadUrl) {
    return false;
  }
  const filename =
    (typeof result?.filename === "string" && result.filename.trim()) ||
    sanitizeFileName(
      (() => {
        try {
          const parsed = new URL(downloadUrl);
          return (
            parsed.searchParams.get("filename") ||
            parsed.searchParams.get("filename*") ||
            parsed.pathname.split("/").pop() ||
            options.fallbackFilename
          );
        } catch {
          return options.fallbackFilename;
        }
      })(),
      options.fallbackFilename,
    );

  const stdout =
    typeof result?.stdout === "string" && result.stdout.trim().length > 0
      ? result.stdout.trim()
      : null;
  const declaredMime =
    typeof result?.mime === "string" && result.mime.trim().length > 0 ? result.mime.trim() : null;
  const detectedMime =
    declaredMime ?? detectMimeFromUrl(filename || downloadUrl, "application/octet-stream");
  let mediaType: "document" | "image" | "video" | "audio" = "document";
  if (detectedMime.startsWith("image/")) {
    mediaType = "image";
  } else if (detectedMime.startsWith("video/")) {
    mediaType = "video";
  } else if (detectedMime.startsWith("audio/")) {
    mediaType = "audio";
  }

  try {
    const maxBytes = resolveAutoDownloaderMaxBytes();
    const inlineVideoLimit = resolveVideoInlineLimit();
    const contentLength = await fetchContentLength(downloadUrl);

    if (contentLength !== null && contentLength > maxBytes) {
      const fallbackParts = [
        `⚠️ O arquivo retornado ultrapassa o limite permitido (${formatHumanSize(contentLength)} > ${formatHumanSize(maxBytes)}).`,
        filename ? `• Arquivo: ${filename}` : null,
        `• Link: ${downloadUrl}`,
        stdout,
      ].filter(Boolean);
      await sendTextMessage(client, {
        to: chatId,
        body: fallbackParts.join("\n"),
        quoted,
      });
      return true;
    }

    if (mediaType === "video" && contentLength !== null && contentLength > inlineVideoLimit) {
      mediaType = "document";
    }

    await sendRemoteMedia(client, {
      chatId,
      url: downloadUrl,
      mediaType,
      mimeType: detectedMime,
      filename,
      caption: undefined,
      quoted,
    });
    return true;
  } catch (error) {
    console.error(`[autodownloader] Falha ao enviar arquivo do ${options.logLabel}`, { error });
    try {
      const fallbackParts = [
        "📎 Não consegui enviar o arquivo automaticamente, seguem os dados:",
        filename ? `• Arquivo: ${filename}` : null,
        `• Link: ${downloadUrl}`,
        stdout,
      ].filter(Boolean);
      await sendTextMessage(client, {
        to: chatId,
        body: fallbackParts.join("\n"),
        quoted,
      });
      return true;
    } catch (sendError) {
      console.error(`[autodownloader] Falha ao enviar fallback do ${options.logLabel}`, {
        sendError,
      });
      return false;
    }
  }
};

const handleFreepik = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
): Promise<boolean> => {
  return handleRestFileDownload(client, chatId, link, quoted, apiKey, {
    endpoint: "/api/rest/freepik",
    fallbackFilename: "freepik.zip",
    logLabel: "Freepik",
  });
};

const sendEnvatoPreview = async (
  client: WuzapiClient,
  chatId: string,
  previewUrl: string | null,
  caption: string | null,
  quoted?: { stanzaId: string; participant?: string },
): Promise<boolean> => {
  if (!previewUrl) {
    return false;
  }
  const previewMime = detectMimeFromUrl(previewUrl, "image/jpeg");
  const previewExt = mime.extension(previewMime) || "jpg";
  const previewFilename = `${sanitizeFileName(caption || "envato_preview", "envato_preview")}.${previewExt}`;
  try {
    await sendRemoteMedia(client, {
      chatId,
      url: previewUrl,
      mediaType: "image",
      mimeType: previewMime,
      filename: previewFilename,
      caption: caption || undefined,
      quoted,
    });
    return true;
  } catch (error) {
    console.warn("[autodownloader] Falha ao enviar preview do Envato", { error, previewUrl });
    return false;
  }
};

const handleEnvato = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  apiKey?: string | null,
  preferNativeButtons?: boolean,
): Promise<boolean> => {
  let data: any;
  try {
    data = await fetchJson(`/api/rest/envato?url=${encodeURIComponent(link)}`, apiKey);
  } catch (error) {
    console.warn("[autodownloader] Envato downloader indisponível", { error, link });
    return false;
  }
  const result = data?.resultado;
  const downloadUrl =
    typeof result?.url === "string" ? result.url : typeof result?.link === "string" ? result.link : null;
  if (!downloadUrl) {
    return false;
  }

  const resolvedFilename =
    (typeof result?.filename === "string" && result.filename.trim()) ||
    sanitizeFileName(
      (() => {
        try {
          const parsed = new URL(downloadUrl);
          return (
            parsed.searchParams.get("filename") ||
            parsed.searchParams.get("filename*") ||
            parsed.pathname.split("/").pop() ||
            "envato.zip"
          );
        } catch {
          return "envato.zip";
        }
      })(),
      "envato.zip",
    );
  const declaredMime =
    typeof result?.mime === "string" && result.mime.trim().length > 0 ? result.mime.trim() : null;
  const previewUrl =
    typeof result?.preview === "string" && result.preview.trim().length > 0 ? result.preview.trim() : null;
  const stdout =
    typeof result?.stdout === "string" && result.stdout.trim().length > 0 ? result.stdout.trim() : null;

  const expiryNotice = "⚠️ O link expira em 1 minuto.";
  const preferButtons = Boolean(preferNativeButtons);

  if (preferButtons) {
    const headerMedia =
      previewUrl && previewUrl.trim()
        ? ({ type: "image", media: previewUrl } as const)
        : undefined;
    const interactiveBody = [
      resolvedFilename ? `Arquivo: ${resolvedFilename}` : null,
      declaredMime ? `Formato: ${declaredMime}` : null,
      expiryNotice,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await sendInteractiveButtons(client, {
        to: chatId,
        title: "Envato Elements",
        body: interactiveBody || "Clique no botão abaixo para baixar.",
        buttonType: "native",
        buttons: [
          {
            id: `envato_${Date.now()}`,
            text: "Baixar agora",
            type: "cta_url",
            url: downloadUrl,
          },
        ],
        headerMedia,
        quoted,
      });
      return true;
    } catch (error) {
      console.error("[autodownloader] Falha ao enviar botões do Envato", { error });
    }
  }

  const downloadInfo = [
    "📎 Envato Elements pronto!",
    resolvedFilename ? `• Arquivo: ${resolvedFilename}` : null,
    declaredMime ? `• MIME: ${declaredMime}` : null,
    expiryNotice,
    `• Download: ${downloadUrl}`,
    stdout,
  ]
    .filter(Boolean)
    .join("\n");

  const sentPreview = await sendEnvatoPreview(client, chatId, previewUrl, downloadInfo, quoted);
  if (sentPreview) {
    return true;
  }

  try {
    await sendTextMessage(client, {
      to: chatId,
      body: downloadInfo,
      quoted,
    });
    return true;
  } catch (sendError) {
    console.error("[autodownloader] Falha ao enviar link do Envato", { sendError });
    return false;
  }
};

const handleMega = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
  _apiKey?: string | null,
): Promise<boolean> => {
  let megaResult;
  try {
    megaResult = await downloadMegaFileToPublic(link);
  } catch (error) {
    console.error("[autodownloader] Falha ao baixar arquivo do Mega", { error, link });
    return false;
  }

  const fileName =
    typeof megaResult.filename === "string" && megaResult.filename.trim()
      ? megaResult.filename
      : `mega_${Date.now()}`;
  const mimeType =
    typeof megaResult.mimeType === "string" && megaResult.mimeType.trim()
      ? megaResult.mimeType
      : detectMimeFromUrl(fileName, "application/octet-stream");
  const normalizedMime = mimeType.toLowerCase();
  let mediaType: "document" | "video" | "audio" | "image" = "document";
  if (normalizedMime.startsWith("video/")) {
    mediaType = "video";
  } else if (normalizedMime.startsWith("audio/")) {
    mediaType = "audio";
  } else if (normalizedMime.startsWith("image/")) {
    mediaType = "image";
  }
  let effectiveMimeType = mimeType;
  const shouldForceDocument =
    mediaType === "video" &&
    typeof megaResult.size === "number" &&
    megaResult.size > resolveVideoInlineLimit();
  const deliveryMediaType: "document" | "video" | "audio" | "image" = shouldForceDocument
    ? "document"
    : mediaType;

  const downloadUrl = buildTempDownloadUrl(megaResult.filename);

  let buffer: Buffer | null = null;
  try {
    buffer = await fs.promises.readFile(megaResult.filePath);
  } catch (error) {
    console.warn("[autodownloader] Não consegui ler o arquivo local do Mega", {
      error,
      path: megaResult.filePath,
    });
  }

  if (
    buffer &&
    mediaType === "image" &&
    (normalizedMime === "image/webp" || normalizedMime === "image/x-webp")
  ) {
    try {
      const converted = await sharp(buffer).png().toBuffer();
      buffer = converted;
      effectiveMimeType = "image/png";
      try {
        await fs.promises.writeFile(megaResult.filePath, converted);
      } catch (error) {
        console.warn("[autodownloader] Não consegui atualizar arquivo convertido do Mega", {
          error,
          path: megaResult.filePath,
        });
      }
    } catch (error) {
      console.warn("[autodownloader] Falha ao converter imagem WebP do Mega; mantendo original", {
        error,
      });
    }
  }

  if (buffer && deliveryMediaType !== "document") {
    try {
      await sendBufferMedia(client, {
        chatId,
        buffer,
        mimeType: effectiveMimeType,
        mediaType: deliveryMediaType,
        filename: fileName,
        caption: fileName,
        quoted,
      });
      try {
        await fs.promises.rm(megaResult.filePath);
      } catch {
        /* ignore */
      }
      return true;
    } catch (bufferError) {
      console.warn("[autodownloader] Falha ao enviar buffer do Mega, tentando URL pública", {
        error: bufferError,
      });
    }
  }

  try {
    await sendRemoteMedia(client, {
      chatId,
      url: downloadUrl,
      mediaType: deliveryMediaType,
      mimeType: effectiveMimeType,
      filename: fileName,
      caption: fileName,
      quoted,
    });
    return true;
  } catch (error) {
    console.error("[autodownloader] Falha ao enviar arquivo Mega", { error });
    try {
      await sendRemoteMedia(client, {
        chatId,
        url: downloadUrl,
        mediaType: "document",
        mimeType: "application/octet-stream",
        filename: fileName,
        caption: fileName,
        quoted,
      });
      return true;
    } catch (fallbackError) {
      console.error("[autodownloader] Falha no fallback do Mega como documento", {
        error: fallbackError,
      });
    }
    return false;
  }
};

const handleSpotify = async (
  client: WuzapiClient,
  chatId: string,
  link: string,
  quoted?: { stanzaId: string; participant?: string },
): Promise<boolean> => {
  try {
    const info = await downloadSpotifyTrack(link);
    const caption = info.artist ? `${info.title} — ${info.artist}` : info.title;
    const filename = `${sanitizeFileName(info.title, "spotify")}.m4a`;

    await sendRemoteMedia(client, {
      chatId,
      url: info.downloadUrl,
      mediaType: "audio",
      mimeType: "audio/mp4",
      filename,
      caption,
      quoted,
    });
    return true;
  } catch (error) {
    console.error("[autodownloader] Falha ao enviar áudio Spotify", { error });
    return false;
  }
};

export const findFirstSupportedLink = (links: string[]): string | null => {
  for (const link of links) {
    if (detectPlatform(link)) {
      return link;
    }
  }
  return null;
};

export const processAutoDownloader = async ({
  client,
  chatId,
  link,
  quoted,
  apiKey,
  preferNativeButtons,
  userId,
}: AutoDownloaderOptions): Promise<boolean> => {
  if (!link) {
    return false;
  }

  const platform = detectPlatform(link);
  if (!platform) {
    return false;
  }

  try {
    console.info("[autodownloader] processando link", { platform, link });
    switch (platform) {
      case "instagram":
        return await handleInstagram(client, chatId, link, quoted, apiKey);
      case "tiktok":
        return await handleTikTok(client, chatId, link, quoted, apiKey);
      case "douyin":
        return await handleGenericVideoEndpoint(client, chatId, link, "/api/rest/douyin", quoted, apiKey);
      case "kwai":
        return await handleGenericVideoEndpoint(client, chatId, link, "/api/rest/kwai", quoted, apiKey);
      case "shopee":
        return await handleGenericVideoEndpoint(
          client,
          chatId,
          link,
          "/api/rest/globalvideo",
          quoted,
          apiKey,
          { preferNativeButtons, ctaTitle: "Shopee" },
        );
      case "mercadolivre":
        return await handleMercadoLivreAffiliateProduct(
          client,
          chatId,
          link,
          quoted,
          userId,
          preferNativeButtons,
        );
      case "youtube":
        return await handleGenericVideoEndpoint(
          client,
          chatId,
          link,
          "/api/rest/ytmp4",
          quoted,
          apiKey,
        );
      case "facebook":
        return await handleFacebook(client, chatId, link, quoted, apiKey);
      case "pinterest":
        return await handlePinterest(client, chatId, link, quoted, apiKey);
      case "threads":
        return await handleThreads(client, chatId, link, quoted, apiKey);
      case "mediafire":
        return await handleMediafire(client, chatId, link, quoted, apiKey);
      case "freepik":
        return await handleFreepik(client, chatId, link, quoted, apiKey);
      case "envato":
        return await handleEnvato(client, chatId, link, quoted, apiKey, preferNativeButtons);
      case "mega":
        return await handleMega(client, chatId, link, quoted, apiKey);
      case "spotify":
        return await handleSpotify(client, chatId, link, quoted);
      case "twitter":
        return await handleGenericVideoEndpoint(
          client,
          chatId,
          link,
          "/api/rest/globalvideo",
          quoted,
          apiKey,
        );
      case "soundcloud":
        return await handleGenericAudioEndpoint(client, chatId, link, "/api/rest/soundcloud", quoted, apiKey);
      case "bandcamp":
        return await handleGenericAudioEndpoint(client, chatId, link, "/api/rest/bandcamp", quoted, apiKey);
      case "mixcloud":
        return await handleGenericAudioEndpoint(client, chatId, link, "/api/rest/mixcloud", quoted, apiKey);
      case "twitterspaces":
        return await handleGenericAudioEndpoint(
          client,
          chatId,
          link,
          "/api/rest/twitterspaces",
          quoted,
          apiKey,
        );
      case "twitch":
        return await handleGenericVideoEndpoint(client, chatId, link, "/api/rest/twitch", quoted, apiKey);
      case "rumble":
        return await handleGenericVideoEndpoint(client, chatId, link, "/api/rest/rumble", quoted, apiKey);
      case "odysee":
        return await handleGenericVideoEndpoint(client, chatId, link, "/api/rest/odysee", quoted, apiKey);
      case "dailymotion":
        return await handleGenericVideoEndpoint(
          client,
          chatId,
          link,
          "/api/rest/dailymotion",
          quoted,
          apiKey,
        );
      default:
        return false;
    }
  } catch (error) {
    console.error("[autodownloader] Erro ao processar link", { link, platform, error });
    return false;
  }
};
