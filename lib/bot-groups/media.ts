import { promises as fs } from "fs";
import path from "path";
import mime from "mime-types";

import { ARCHIVE_UPLOAD_ROOT, UPLOADS_STORAGE_ROOT, resolveUploadedFileUrl } from "lib/uploads";
import { getPublicAppBaseUrl } from "lib/meta";
import type { BotGroupWelcomeAttachment } from "types/bot-groups";

export type ResolvedGroupMedia = {
  media: Buffer | string;
  mimeType?: string;
  fileName?: string | null;
};

type MediaReference = {
  url?: string | null;
  path?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
};

const STORAGE_ROOTS = [UPLOADS_STORAGE_ROOT, ARCHIVE_UPLOAD_ROOT]
  .filter((entry): entry is string => Boolean(entry))
  .map((entry) => entry.replace(/\/+$/, ""));

const asAbsoluteMediaUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^(?:https?:|data:)/i.test(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.replace(/^\/+/, "");
  const candidate = resolveUploadedFileUrl(normalized);
  if (/^(?:https?:|data:)/i.test(candidate)) {
    return candidate;
  }
  return `${getPublicAppBaseUrl()}${candidate.startsWith("/") ? "" : "/"}${candidate}`;
};

const normalizePathCandidates = (rawPath: string): string[] => {
  const normalized = rawPath.replace(/\\/g, "/");
  const withoutLeadingSlash = normalized.replace(/^\/+/, "");
  const withoutUploadsPrefix = withoutLeadingSlash.startsWith("uploads/")
    ? withoutLeadingSlash.slice("uploads/".length)
    : withoutLeadingSlash;

  const candidates = new Set<string>();

  if (path.isAbsolute(normalized)) {
    candidates.add(normalized);
  }

  for (const root of STORAGE_ROOTS) {
    const direct = path.resolve(root, withoutLeadingSlash);
    if (direct.startsWith(root)) {
      candidates.add(direct);
    }
    const relative = path.resolve(root, withoutUploadsPrefix);
    if (relative.startsWith(root)) {
      candidates.add(relative);
    }
  }

  return Array.from(candidates);
};

export const resolveMediaReference = async (
  reference: MediaReference,
): Promise<ResolvedGroupMedia | null> => {
  const resolveLocalPath = async (rawValue: string): Promise<ResolvedGroupMedia | null> => {
    const candidates = normalizePathCandidates(rawValue);
    for (const candidate of candidates) {
      try {
        const stats = await fs.stat(candidate);
        if (!stats.isFile()) {
          continue;
        }
        const buffer = await fs.readFile(candidate);
        const inferredMime =
          reference.mimeType ??
          (mime.lookup(candidate) ? String(mime.lookup(candidate)) : undefined) ??
          undefined;
        const resolvedFileName = reference.fileName ?? path.basename(candidate);
        return {
          media: buffer,
          mimeType: inferredMime,
          fileName: resolvedFileName,
        };
      } catch {
        /* try next candidate */
      }
    }
    return null;
  };

  const rawPath = typeof reference.path === "string" ? reference.path.trim() : "";
  if (rawPath && !/^https?:\/\//i.test(rawPath)) {
    const resolvedLocal = await resolveLocalPath(rawPath);
    if (resolvedLocal) {
      return resolvedLocal;
    }
  }

  const url = typeof reference.url === "string" ? reference.url.trim() : "";
  if (url) {
    const urlLooksLikeInternalUpload =
      !/^(?:https?:|data:)/i.test(url) ||
      /^https?:\/\/[^/]+\/uploads\//i.test(url);
    if (urlLooksLikeInternalUpload) {
      const uploadPath = (() => {
        if (/^https?:\/\//i.test(url)) {
          try {
            const parsed = new URL(url);
            return parsed.pathname.replace(/^\/+/, "");
          } catch {
            return url;
          }
        }
        return url;
      })();
      const resolvedLocal = await resolveLocalPath(uploadPath);
      if (resolvedLocal) {
        return resolvedLocal;
      }
    }
    return {
      media: asAbsoluteMediaUrl(url),
      mimeType: reference.mimeType ?? undefined,
      fileName: reference.fileName ?? null,
    };
  }

  if (!rawPath) {
    return null;
  }

  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
    return {
      media: rawPath,
      mimeType: reference.mimeType ?? undefined,
      fileName: reference.fileName ?? null,
    };
  }

  const fallbackUrl = asAbsoluteMediaUrl(rawPath);
  return {
    media: fallbackUrl,
    mimeType: reference.mimeType ?? undefined,
    fileName: reference.fileName ?? null,
  };
};

export const resolveWelcomeAttachmentMedia = async (
  attachment: BotGroupWelcomeAttachment,
): Promise<ResolvedGroupMedia | null> => {
  return resolveMediaReference({
    url: attachment.url,
    path: attachment.path,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
  });
};
