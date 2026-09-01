import { createHash } from "crypto";

const aws4 = require("aws4") as {
  sign: (
    request: {
      host: string;
      path: string;
      service: string;
      region: string;
      method: string;
      headers?: Record<string, string>;
      body?: Buffer;
    },
    credentials: { accessKeyId: string; secretAccessKey: string },
  ) => { headers?: Record<string, string> };
};

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type CachedMedia = {
  buffer: Buffer;
  contentType: string;
};

const getR2Config = (): R2Config | null => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
};

const r2ObjectUrl = (config: R2Config, key: string) => {
  const encodedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return new URL(
    `/${config.bucket}/${encodedKey}`,
    `https://${config.accountId}.r2.cloudflarestorage.com`,
  );
};

const signR2Request = (
  config: R2Config,
  method: "GET" | "PUT" | "DELETE",
  key: string,
  headers: Record<string, string> = {},
  body?: Buffer,
) => {
  const url = r2ObjectUrl(config, key);
  const signed = aws4.sign(
    {
      host: url.host,
      path: `${url.pathname}${url.search}`,
      service: "s3",
      region: "auto",
      method,
      headers: {
        host: url.host,
        ...headers,
      },
      body,
    },
    {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  );
  return {
    url: url.toString(),
    headers: signed.headers ?? {},
  };
};

export const buildWhatsappMediaCacheKey = (params: {
  userId?: number | null;
  instanceId: number;
  chatJid: string;
  messageKey: string;
  mimeType?: string | null;
}) => {
  const digest = createHash("sha256")
    .update(`${params.instanceId}|${params.chatJid}|${params.messageKey}`)
    .digest("hex");
  const extension = mediaExtension(params.mimeType);
  const userSegment =
    Number.isFinite(Number(params.userId)) && Number(params.userId) > 0
      ? `users/${Number(params.userId)}/`
      : "";
  return `${userSegment}whatsapp-media/${params.instanceId}/${digest}${extension}`;
};

export const buildLegacyWhatsappMediaCacheKey = (params: {
  instanceId: number;
  chatJid: string;
  messageKey: string;
  mimeType?: string | null;
}) => buildWhatsappMediaCacheKey({ ...params, userId: null });

export const buildWhatsappAvatarCacheKey = (params: {
  userId: number;
  instanceId: number;
  chatJid: string;
  version?: string | null;
}) => {
  const digest = createHash("sha256")
    .update(
      `${params.instanceId}|${params.chatJid.trim().toLowerCase()}|${params.version?.trim() ?? ""}`,
    )
    .digest("hex");
  return `users/${params.userId}/whatsapp-avatars/${params.instanceId}/${digest}`;
};

export const buildExternalAvatarCacheKey = (params: {
  userId: number;
  url: string;
}) => {
  const digest = createHash("sha256").update(params.url.trim()).digest("hex");
  return `users/${params.userId}/external-avatars/${digest}`;
};

const mediaExtension = (mimeType?: string | null) => {
  const normalized = mimeType?.toLowerCase().split(";")[0].trim();
  switch (normalized) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "video/mp4":
      return ".mp4";
    case "audio/ogg":
      return ".ogg";
    case "audio/mpeg":
      return ".mp3";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
};

export const getCachedMediaFromR2 = async (
  key: string,
): Promise<CachedMedia | null> => {
  const config = getR2Config();
  if (!config) return null;

  const signed = signR2Request(config, "GET", key);
  const response = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    console.warn("[r2-media-cache] get failed", {
      status: response.status,
      key,
    });
    return null;
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType:
      response.headers.get("content-type") || "application/octet-stream",
  };
};

export const putCachedMediaInR2 = async (
  key: string,
  buffer: Buffer,
  contentType: string,
  options: { cacheControl?: string } = {},
): Promise<boolean> => {
  const config = getR2Config();
  if (!config || buffer.length === 0) return false;

  const signed = signR2Request(
    config,
    "PUT",
    key,
    {
      "content-type": contentType || "application/octet-stream",
      "cache-control":
        options.cacheControl || "private, max-age=31536000, immutable",
    },
    buffer,
  );
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: new Uint8Array(buffer),
  });
  if (!response.ok) {
    console.warn("[r2-media-cache] put failed", {
      status: response.status,
      key,
    });
    return false;
  }
  return true;
};

export const deleteCachedMediaFromR2 = async (key: string): Promise<void> => {
  const config = getR2Config();
  if (!config) return;
  const signed = signR2Request(config, "DELETE", key);
  const response = await fetch(signed.url, {
    method: "DELETE",
    headers: signed.headers,
  });
  if (!response.ok && response.status !== 404) {
    console.warn("[r2-media-cache] delete failed", {
      status: response.status,
      key,
    });
  }
};
