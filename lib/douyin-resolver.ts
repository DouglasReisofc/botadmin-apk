import { createDecipheriv, createHash } from "node:crypto";

const DOUYIN_URL_REGEX =
  /(?:https?:\/\/)?(?:(?:www|m|v)\.)?(?:douyin\.com|iesdouyin\.com|ixigua\.com)/i;

const XIGUA_AES_PASSPHRASE = "xigua.fe.web_mobile";

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,pt-BR;q=0.7",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
};

export type DouyinResolvedVideo = {
  provider: "douyin";
  id: string | null;
  title: string;
  author: string;
  url: string;
  durationSeconds: number;
  thumbnail: string;
  source: string;
  pageUrl: string;
  format: "video/mp4";
};

export const isDouyinUrl = (value?: string | null): boolean =>
  Boolean(value && DOUYIN_URL_REGEX.test(value));

const trimTrailingPunctuation = (value: string): string =>
  value.replace(/[)\].,'"»”’››>—–…•·]+$/gu, "");

export const normalizeDouyinInput = (input: string): string =>
  trimTrailingPunctuation(input.trim());

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const absolutizeUrl = (value: string): string => {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  return value;
};

const evpBytesToKey = (
  password: string,
  salt: Buffer,
  keyLength: number,
  ivLength: number,
): { key: Buffer; iv: Buffer } => {
  let previous = Buffer.alloc(0);
  let derived = Buffer.alloc(0);
  while (derived.length < keyLength + ivLength) {
    previous = createHash("md5")
      .update(Buffer.concat([previous, Buffer.from(password, "utf8"), salt]))
      .digest();
    derived = Buffer.concat([derived, previous]);
  }
  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength),
  };
};

export const decryptXiguaVideoUrl = (value: string): string => {
  const encrypted = Buffer.from(Array.from(value).reverse().join(""), "base64");
  if (encrypted.subarray(0, 8).toString("utf8") !== "Salted__") {
    throw new Error("Payload de vídeo Douyin inválido.");
  }

  const salt = encrypted.subarray(8, 16);
  const ciphertext = encrypted.subarray(16);
  const { key, iv } = evpBytesToKey(XIGUA_AES_PASSPHRASE, salt, 32, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};

const extractSsrData = (html: string): any | null => {
  const match = html.match(/window\._SSR_DATA\s*=\s*({[\s\S]*?})<\/script>/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
};

const findVideoResult = (value: unknown, depth = 0): Record<string, any> | null => {
  if (!value || typeof value !== "object" || depth > 8) return null;
  const record = value as Record<string, any>;

  if (record.videoData?.result?.url) {
    return record.videoData.result;
  }
  if (record.result?.url && (record.result.gid || record.result.video_id)) {
    return record.result;
  }
  if (record.url && (record.gid || record.video_id)) {
    return record;
  }

  for (const child of Object.values(record)) {
    const found = findVideoResult(child, depth + 1);
    if (found) return found;
  }
  return null;
};

const fetchDouyinPage = async (url: string): Promise<{ html: string; pageUrl: string }> => {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Douyin HTTP ${response.status}`);
  }
  return {
    html: await response.text(),
    pageUrl: response.url || url,
  };
};

export const resolveDouyinVideo = async (input: string): Promise<DouyinResolvedVideo> => {
  const source = normalizeDouyinInput(input);
  if (!source || !/^https?:\/\//i.test(source)) {
    throw new Error("Forneça uma URL Douyin válida.");
  }
  if (!isDouyinUrl(source)) {
    throw new Error("Este resolvedor aceita apenas links Douyin/Xigua.");
  }

  const { html, pageUrl } = await fetchDouyinPage(source);
  const ssr = extractSsrData(html);
  const video = findVideoResult(ssr);
  if (!video) {
    throw new Error("Não foi possível localizar os dados do vídeo Douyin.");
  }

  const encryptedUrl = cleanText(video.url);
  const directUrl = /^https?:\/\//i.test(encryptedUrl)
    ? encryptedUrl
    : decryptXiguaVideoUrl(encryptedUrl);
  if (!/^https?:\/\//i.test(directUrl)) {
    throw new Error("Douyin não retornou um link de vídeo válido.");
  }

  const mediaUser = video.media_user ?? {};
  return {
    provider: "douyin",
    id: cleanText(video.gid || video.video_id) || null,
    title: cleanText(video.title),
    author: cleanText(mediaUser.screen_name || mediaUser.nickname || mediaUser.name),
    url: absolutizeUrl(directUrl),
    durationSeconds: Number(video.duration || 0) || 0,
    thumbnail: absolutizeUrl(cleanText(video.cover_image_url || video.cover || video.thumbnail)),
    source,
    pageUrl,
    format: "video/mp4",
  };
};
