import { promises as fs } from "fs";
import path from "path";

import { getR2UploadObject, isR2UploadsEnabled } from "lib/r2-uploads";
import { ARCHIVE_UPLOAD_ROOT, UPLOADS_STORAGE_ROOT } from "lib/uploads";

const CANDIDATE_ROOTS = [
  UPLOADS_STORAGE_ROOT,
  ARCHIVE_UPLOAD_ROOT,
  path.resolve(process.cwd(), "storage", "uploads"),
  path.resolve(process.cwd(), "public"),
];

const sanitizeRelativePath = (input: string): string | null => {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const normalized = trimmed.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("uploads/")) {
    return normalized.slice("uploads/".length);
  }

  if (normalized.startsWith("storage/uploads/")) {
    return normalized.slice("storage/uploads/".length);
  }

  return normalized;
};

export const resolveStoredMediaBuffer = async (relativePath?: string | null): Promise<Buffer | null> => {
  if (!relativePath) {
    return null;
  }

  if (path.isAbsolute(relativePath) && !/^https?:\/\//i.test(relativePath)) {
    try {
      return await fs.readFile(relativePath);
    } catch {
      // ignore, fallback to sanitized search below
    }
  }

  const sanitized = sanitizeRelativePath(relativePath);
  if (!sanitized) {
    return null;
  }

  for (const root of CANDIDATE_ROOTS) {
    if (!root) {
      continue;
    }
    const absolute = path.resolve(root, sanitized);
    if (!absolute.startsWith(root)) {
      continue;
    }
    try {
      return await fs.readFile(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  if (isR2UploadsEnabled()) {
    const object = await getR2UploadObject(sanitized).catch((error) => {
      console.warn("[media-storage] failed to read R2 media", error);
      return null;
    });
    if (object) {
      return object.buffer;
    }
  }

  return null;
};

export default resolveStoredMediaBuffer;
