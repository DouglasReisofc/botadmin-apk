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

export type R2UploadObject = {
  buffer: Buffer;
  contentType: string;
  size: number;
  lastModified: Date | null;
};

export type R2UploadHead = {
  contentType: string;
  size: number;
  lastModified: Date | null;
};

const truthy = new Set(["1", "true", "yes", "on", "r2", "cloudflare-r2"]);

export const isR2UploadsEnabled = () => {
  const explicit = process.env.UPLOADS_STORAGE_DRIVER
    ?? process.env.UPLOADS_BACKEND
    ?? process.env.UPLOADS_USE_R2;
  return truthy.has((explicit ?? "").trim().toLowerCase()) && Boolean(getR2Config());
};

export const shouldKeepLocalUploadCopy = () => {
  const explicit = process.env.UPLOADS_KEEP_LOCAL_COPY ?? process.env.UPLOADS_LOCAL_COPY;
  if (explicit == null || explicit.trim() === "") {
    return !isR2UploadsEnabled();
  }
  return truthy.has(explicit.trim().toLowerCase());
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

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

const r2Url = (config: R2Config, key = "", search = "") => {
  const suffix = key ? `/${encodeKey(key)}` : "";
  return new URL(`/${config.bucket}${suffix}${search}`, `https://${config.accountId}.r2.cloudflarestorage.com`);
};

const signR2Request = (
  config: R2Config,
  method: "GET" | "HEAD" | "PUT" | "DELETE",
  key: string,
  headers: Record<string, string> = {},
  body?: Buffer,
  search = "",
) => {
  const url = r2Url(config, key, search);
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

export const normalizeUploadObjectKey = (relativePath: string) => {
  const normalized = relativePath.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid R2 upload key");
  }
  return normalized.startsWith("uploads/") ? normalized : `uploads/${normalized}`;
};

const parseLastModified = (value: string | null) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const putR2UploadObject = async (
  relativePath: string,
  buffer: Buffer,
  contentType = "application/octet-stream",
  cacheControl = "public, max-age=31536000, immutable",
) => {
  const config = getR2Config();
  if (!config || buffer.length === 0) {
    return false;
  }
  const key = normalizeUploadObjectKey(relativePath);
  const signed = signR2Request(
    config,
    "PUT",
    key,
    {
      "content-type": contentType || "application/octet-stream",
      "content-length": String(buffer.length),
      "cache-control": cacheControl,
    },
    buffer,
  );
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: new Uint8Array(buffer),
  });
  if (!response.ok) {
    console.warn("[r2-uploads] put failed", { status: response.status, key });
    return false;
  }
  return true;
};

export const getR2UploadObject = async (relativePath: string): Promise<R2UploadObject | null> => {
  const config = getR2Config();
  if (!config) {
    return null;
  }
  const key = normalizeUploadObjectKey(relativePath);
  const signed = signR2Request(config, "GET", key);
  const response = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    console.warn("[r2-uploads] get failed", { status: response.status, key });
    return null;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    size: Number(response.headers.get("content-length") || buffer.length),
    lastModified: parseLastModified(response.headers.get("last-modified")),
  };
};

export const headR2UploadObject = async (relativePath: string): Promise<R2UploadHead | null> => {
  const config = getR2Config();
  if (!config) {
    return null;
  }
  const key = normalizeUploadObjectKey(relativePath);
  const signed = signR2Request(config, "HEAD", key);
  const response = await fetch(signed.url, {
    method: "HEAD",
    headers: signed.headers,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    console.warn("[r2-uploads] head failed", { status: response.status, key });
    return null;
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const lastModified = parseLastModified(response.headers.get("last-modified"));
  const contentLength = response.headers.get("content-length");
  if (contentLength != null) {
    return {
      contentType,
      size: Number(contentLength || 0),
      lastModified,
    };
  }

  const object = await getR2UploadObject(relativePath);
  return object
    ? {
        contentType: object.contentType || contentType,
        size: object.size,
        lastModified: object.lastModified ?? lastModified,
      }
    : null;
};

export const deleteR2UploadObject = async (relativePath?: string | null) => {
  if (!relativePath || !isR2UploadsEnabled()) {
    return;
  }
  const config = getR2Config();
  if (!config) {
    return;
  }
  const key = normalizeUploadObjectKey(relativePath);
  const signed = signR2Request(config, "DELETE", key);
  const response = await fetch(signed.url, {
    method: "DELETE",
    headers: signed.headers,
  });
  if (!response.ok && response.status !== 404) {
    console.warn("[r2-uploads] delete failed", { status: response.status, key });
  }
};

const listR2KeysByPrefix = async (prefix: string) => {
  const config = getR2Config();
  if (!config) {
    return [];
  }

  const keys: string[] = [];
  let continuationToken: string | null = null;
  do {
    const params = new URLSearchParams({
      "list-type": "2",
      prefix,
    });
    if (continuationToken) {
      params.set("continuation-token", continuationToken);
    }
    const signed = signR2Request(config, "GET", "", {}, undefined, `?${params.toString()}`);
    const response = await fetch(signed.url, {
      method: "GET",
      headers: signed.headers,
    });
    if (!response.ok) {
      console.warn("[r2-uploads] list failed", { status: response.status, prefix });
      return keys;
    }

    const xml = await response.text();
    for (const match of xml.matchAll(/<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<\/Contents>/g)) {
      const key = decodeXml(match[1]);
      if (key) {
        keys.push(key);
      }
    }
    const nextToken = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
    continuationToken = nextToken?.[1] ? decodeXml(nextToken[1]) : null;
  } while (continuationToken);

  return keys;
};

const decodeXml = (value: string) => value
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

export const deleteR2UploadPrefix = async (relativePath?: string | null) => {
  if (!relativePath || !isR2UploadsEnabled()) {
    return;
  }
  const prefix = `${normalizeUploadObjectKey(relativePath).replace(/\/?$/, "/")}`;
  const keys = await listR2KeysByPrefix(prefix);
  await Promise.all(keys.map((key) => deleteR2UploadObject(key)));
};
