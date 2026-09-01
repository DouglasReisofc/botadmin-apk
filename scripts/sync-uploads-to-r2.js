#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const aws4 = require("aws4");

const cwd = path.resolve(__dirname, "..");

const loadEnv = () => {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) {
      process.env[match[1]] = value;
    }
  }
};

loadEnv();

const config = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
};

const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) {
  console.error(`Missing R2 config: ${missing.join(", ")}`);
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="));
const concurrency = Math.max(1, Math.min(16, concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 4));

const roots = [
  path.join(cwd, "public", "uploads"),
  path.join(cwd, "storage", "uploads"),
].filter((root) => fs.existsSync(root));

const contentTypeFromExtension = (filePath) => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".avif": return "image/avif";
    case ".bmp": return "image/bmp";
    case ".gif": return "image/gif";
    case ".ico": return "image/x-icon";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mp3": return "audio/mpeg";
    case ".ogg": return "audio/ogg";
    case ".pdf": return "application/pdf";
    case ".apk": return "application/vnd.android.package-archive";
    case ".zip": return "application/zip";
    default: return "application/octet-stream";
  }
};

const encodeKey = (key) => key.split("/").map(encodeURIComponent).join("/");

const sign = (method, key, headers = {}, body) => {
  const encodedKey = encodeKey(key);
  const url = new URL(`/${config.bucket}/${encodedKey}`, `https://${config.accountId}.r2.cloudflarestorage.com`);
  const signed = aws4.sign(
    {
      host: url.host,
      path: url.pathname,
      service: "s3",
      region: "auto",
      method,
      headers: { host: url.host, ...headers },
      body,
    },
    {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  );
  return { url: url.toString(), headers: signed.headers || {} };
};

async function* walk(root) {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

const headObject = async (key) => {
  const signed = sign("HEAD", key);
  const response = await fetch(signed.url, { method: "HEAD", headers: signed.headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`HEAD ${key} failed with ${response.status}`);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength != null) {
    return Number(contentLength || 0);
  }

  const getSigned = sign("GET", key);
  const getResponse = await fetch(getSigned.url, { method: "GET", headers: getSigned.headers });
  if (!getResponse.ok) {
    throw new Error(`GET ${key} failed with ${getResponse.status}`);
  }
  return Buffer.from(await getResponse.arrayBuffer()).length;
};

const putObject = async (key, filePath, size) => {
  const body = await fs.promises.readFile(filePath);
  const signed = sign(
    "PUT",
    key,
    {
      "content-type": contentTypeFromExtension(filePath),
      "content-length": String(size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-amz-meta-source-sha1": crypto.createHash("sha1").update(body).digest("hex"),
    },
    body,
  );
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    throw new Error(`PUT ${key} failed with ${response.status}`);
  }
  return size;
};

let uploaded = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;
let index = 0;
let files = [];

const worker = async () => {
  while (index < files.length) {
    const current = files[index++];
    const stats = await fs.promises.stat(current.filePath);
    try {
      if (dryRun) {
        console.log(`[dry] ${current.key} ${stats.size} bytes`);
        skipped += 1;
        continue;
      }
      if (!force) {
        const remoteSize = await headObject(current.key);
        if (remoteSize === stats.size) {
          skipped += 1;
          continue;
        }
      }
      await putObject(current.key, current.filePath, stats.size);
      uploaded += 1;
      bytes += stats.size;
      if (uploaded % 25 === 0) {
        console.log(`uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`[failed] ${current.key}: ${error.message}`);
    }
  }
};

const main = async () => {
  files = [];
  for (const root of roots) {
    for await (const filePath of walk(root)) {
      const relative = path.relative(root, filePath).replace(/\\/g, "/");
      files.push({ filePath, key: `uploads/${relative}` });
      if (files.length >= limit) break;
    }
    if (files.length >= limit) break;
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, () => worker()));
  console.log(JSON.stringify({ dryRun, total: files.length, uploaded, skipped, failed, bytes }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
