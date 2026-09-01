import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";

import {
  deleteR2UploadObject,
  deleteR2UploadPrefix,
  isR2UploadsEnabled,
  putR2UploadObject,
  shouldKeepLocalUploadCopy,
} from "lib/r2-uploads";

// Primary uploads root now defaults to public/uploads for durability on production hosts.
// You can override via env var UPLOADS_ROOT if desired.
const ENV_UPLOADS_ROOT = (process.env.UPLOADS_ROOT || "").trim();
export const UPLOADS_STORAGE_ROOT = ENV_UPLOADS_ROOT
  ? path.resolve(process.cwd(), ENV_UPLOADS_ROOT)
  : path.resolve(process.cwd(), "public", "uploads");

// Keep reading from archived storage/uploads to preserve existing files.
export const ARCHIVE_UPLOAD_ROOT = path.resolve(process.cwd(), "storage", "uploads");
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";

const ensureFolder = async (folder: string) => {
  const folderPath = path.resolve(UPLOADS_STORAGE_ROOT, folder);
  if (!folderPath.startsWith(UPLOADS_STORAGE_ROOT)) {
    throw new Error("Invalid upload destination");
  }

  await fs.mkdir(folderPath, { recursive: true });
  return folderPath;
};

const shouldConvertToWebp = (mime: string) => {
  if (!mime.startsWith("image/")) {
    return false;
  }

  const normalized = mime.toLowerCase();
  if (normalized === "image/svg+xml" || normalized === "image/gif") {
    return false;
  }

  // Preserve PNG/JPEG/WebP in original format when requested
  if (normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp") {
    return false;
  }

  return true;
};

type SaveUploadedFileOptions = {
  convertToWebp?: boolean;
  image?: {
    maxWidth?: number;
    maxHeight?: number;
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
    format?: "webp" | "png" | "jpeg" | "original";
    quality?: number;
  };
  // When provided, the stored filename will use this base name.
  // If it does not include an extension, one will be added based on the
  // conversion/forceExtension logic below.
  fixedFileName?: string;
  // Force the final extension (e.g. ".png"), converting the image when possible
  // so the bytes actually match the extension provided.
  forceExtension?: string | null;
};

const contentTypeFromExtension = (extension: string) => {
  switch (extension.toLowerCase()) {
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".pdf":
      return "application/pdf";
    case ".apk":
      return "application/vnd.android.package-archive";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
};

const writeUploadObject = async (relativePath: string, buffer: Buffer, contentType: string) => {
  if (!isR2UploadsEnabled()) {
    return false;
  }
  try {
    return await putR2UploadObject(relativePath, buffer, contentType);
  } catch (error) {
    console.error("[uploads] failed to write object to R2, falling back to local disk", error);
    return false;
  }
};

const writeLocalUploadObject = async (folder: string, filename: string, buffer: Buffer) => {
  const folderPath = await ensureFolder(folder);
  const destination = path.join(folderPath, filename);
  await fs.writeFile(destination, buffer);
};

export const saveUploadedFile = async (
  file: File,
  folder: string,
  options?: SaveUploadedFileOptions,
) => {
  if (!(file instanceof File)) {
    throw new Error("Invalid file payload");
  }

  const originalBuffer: Buffer = Buffer.from(await file.arrayBuffer());
  const extension = (path.extname(file.name) || "").toLowerCase();
  const safeExtension = extension.replace(/[^a-z0-9.]/g, "");
  const mimeType = (file.type || "").toLowerCase();
  let targetExtension = safeExtension;
  let buffer: Buffer = originalBuffer;

  const allowConversion = options?.convertToWebp !== false;

  // Forced extension takes precedence (convert when possible)
  const forceExt = options?.forceExtension?.trim() || null;
  const imageOptions = options?.image;
  const isImage = mimeType.startsWith("image/");
  const isVectorOrAnimated =
    mimeType === "image/svg+xml" ||
    mimeType === "image/gif" ||
    safeExtension === ".svg" ||
    safeExtension === ".gif";
  const quality = Math.max(40, Math.min(95, imageOptions?.quality ?? 82));

  try {
    if (imageOptions && isImage && !isVectorOrAnimated) {
      let pipeline = sharp(originalBuffer).rotate();
      if (imageOptions.maxWidth || imageOptions.maxHeight) {
        pipeline = pipeline.resize({
          width: imageOptions.maxWidth,
          height: imageOptions.maxHeight,
          fit: imageOptions.fit ?? "inside",
          withoutEnlargement: true,
        });
      }

      const targetFormat = imageOptions.format ?? "webp";
      if (targetFormat === "png") {
        buffer = await pipeline.png({ compressionLevel: 9, quality }).toBuffer();
        targetExtension = ".png";
      } else if (targetFormat === "jpeg") {
        buffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
        targetExtension = ".jpg";
      } else if (targetFormat === "original") {
        if (safeExtension === ".png") {
          buffer = await pipeline.png({ compressionLevel: 9, quality }).toBuffer();
          targetExtension = ".png";
        } else if (safeExtension === ".jpg" || safeExtension === ".jpeg") {
          buffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
          targetExtension = ".jpg";
        } else {
          buffer = await pipeline.webp({ quality }).toBuffer();
          targetExtension = ".webp";
        }
      } else {
        buffer = await pipeline.webp({ quality }).toBuffer();
        targetExtension = ".webp";
      }
    } else if (forceExt && forceExt.toLowerCase() === ".png") {
      buffer = await sharp(originalBuffer).png({ quality: 92 }).toBuffer();
      targetExtension = ".png";
    } else if (allowConversion && shouldConvertToWebp(mimeType)) {
      buffer = await sharp(originalBuffer).webp({ quality: 92 }).toBuffer();
      targetExtension = ".webp";
    } else if (!targetExtension) {
      targetExtension = mimeType.startsWith("image/") ? ".webp" : ".bin";
    }
  } catch (error) {
    console.error("Failed to convert uploaded image", error);
    targetExtension = safeExtension || ".bin";
    buffer = originalBuffer;
  }

  if (!targetExtension.startsWith(".")) {
    targetExtension = `.${targetExtension}`;
  }

  let filename: string;
  const requested = options?.fixedFileName?.trim();
  if (requested) {
    const hasExt = /\.[a-z0-9]+$/i.test(requested);
    filename = hasExt ? requested : `${requested}${targetExtension}`;
  } else {
    const uniqueId = crypto.randomBytes(8).toString("hex");
    filename = `${Date.now()}-${uniqueId}${targetExtension}`;
  }

  const relativePath = path.posix.join("uploads", folder.replace(/\\/g, "/"), filename);
  const contentType = mimeType || contentTypeFromExtension(targetExtension);
  const storedInR2 = await writeUploadObject(relativePath, buffer, contentType);

  if (!storedInR2 || shouldKeepLocalUploadCopy()) {
    await writeLocalUploadObject(folder, filename, buffer);
  }

  return relativePath;
};

const sanitizeFileBase = (value: string) => value.replace(/[^a-z0-9-_]/gi, "_");

type SaveBufferOptions = {
  fixedFileName?: string | null;
  forceExtension?: string | null;
};

export const saveBufferAsUploadedFile = async (
  buffer: Buffer,
  folder: string,
  options?: SaveBufferOptions,
) => {
  const requested = options?.fixedFileName?.trim() || "";
  const providedExt = path.extname(requested);
  const forceExt = options?.forceExtension?.trim() || "";

  let extension = forceExt || providedExt;
  if (!extension) {
    extension = ".bin";
  }
  if (!extension.startsWith(".")) {
    extension = `.${extension}`;
  }

  const baseName = requested
    ? sanitizeFileBase(requested.slice(0, requested.length - providedExt.length) || "arquivo")
    : `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;

  const filename = `${baseName}${extension}`;
  const relativePath = path.posix.join("uploads", folder.replace(/\\/g, "/"), filename);
  const storedInR2 = await writeUploadObject(relativePath, buffer, contentTypeFromExtension(extension));

  if (!storedInR2 || shouldKeepLocalUploadCopy()) {
    await writeLocalUploadObject(folder, filename, buffer);
  }

  return relativePath;
};

export const resolveUploadedFileUrl = (relativePath: string) => {
  const normalized = relativePath.replace(/^\/+/, "");
  const prefix = BASE_PATH && BASE_PATH !== "/"
    ? (BASE_PATH.startsWith("/") ? BASE_PATH : `/${BASE_PATH}`)
    : "";

  const combined = `${prefix ? prefix : ""}/${normalized}`;
  return combined.replace(/\\/g, "/");
};

export const deleteUploadedFile = async (relativePath?: string | null) => {
  if (!relativePath) {
    return;
  }

  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized.startsWith("uploads/")) {
    return;
  }

  await deleteR2UploadObject(normalized).catch((error) => {
    console.warn("[uploads] failed to delete R2 object", error);
  });

  const relative = normalized.slice("uploads/".length);
  const candidateRoots = [UPLOADS_STORAGE_ROOT, ARCHIVE_UPLOAD_ROOT];

  for (const root of candidateRoots) {
    if (!root) {
      continue;
    }

    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root)) {
      continue;
    }

    try {
      await fs.unlink(absolute);
      return;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
};

export const deleteUploadedFolder = async (relativePath?: string | null) => {
  if (!relativePath) {
    return;
  }

  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized.startsWith("uploads/")) {
    return;
  }

  await deleteR2UploadPrefix(normalized).catch((error) => {
    console.warn("[uploads] failed to delete R2 folder", error);
  });

  const relative = normalized.slice("uploads/".length);
  const absolute = path.resolve(UPLOADS_STORAGE_ROOT, relative);
  if (!absolute.startsWith(UPLOADS_STORAGE_ROOT)) {
    return;
  }

  try {
    await fs.rm(absolute, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
};
