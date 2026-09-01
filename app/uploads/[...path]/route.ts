import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";

import { getR2UploadObject, headR2UploadObject, isR2UploadsEnabled } from "lib/r2-uploads";
import { ARCHIVE_UPLOAD_ROOT, UPLOADS_STORAGE_ROOT } from "lib/uploads";

export const runtime = "nodejs";

const UPLOAD_ROOTS = [UPLOADS_STORAGE_ROOT, ARCHIVE_UPLOAD_ROOT].filter(Boolean);

const getMimeType = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".apk":
      return "application/vnd.android.package-archive";
    case ".ipa":
      return "application/octet-stream";
    case ".msi":
      return "application/x-msi";
    case ".exe":
      return "application/x-msdownload";
    case ".zip":
      return "application/zip";
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
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
};

const findExistingFile = async (relativePath: string) => {
  for (const root of UPLOAD_ROOTS) {
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(root)) {
      continue;
    }

    try {
      const stats = await fs.stat(absolutePath);
      if (stats.isFile()) {
        return { absolutePath, stats } as const;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return null;
};

const LONG_CACHE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".m4a",
  ".mp3",
  ".ogg",
  ".png",
  ".svg",
  ".webm",
  ".webp",
]);

const hasVersionedFileName = (filePath: string) => {
  const name = path.basename(filePath);
  return /^\d{10,}-[a-f0-9]{12,}\./i.test(name) || /-[a-f0-9]{12,}\./i.test(name);
};

const getCacheControl = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if (LONG_CACHE_EXTENSIONS.has(ext) && hasVersionedFileName(filePath)) {
    return "public, max-age=31536000, immutable";
  }
  if (LONG_CACHE_EXTENSIONS.has(ext)) {
    return "public, max-age=86400, stale-while-revalidate=604800";
  }
  return "private, max-age=0, must-revalidate";
};

const buildHeaders = (filePath: string, size: number, lastModified: Date, contentType?: string) => {
  const headers = new Headers();
  headers.set("Content-Type", contentType || getMimeType(filePath));
  headers.set("Content-Length", size.toString());
  headers.set("Cache-Control", getCacheControl(filePath));
  headers.set("Last-Modified", lastModified.toUTCString());
  headers.set("Accept-Ranges", "none");
  const ext = path.extname(filePath).toLowerCase();
  const attachmentExts = new Set([".apk", ".ipa", ".msi", ".exe", ".zip"]);
  const disposition = attachmentExts.has(ext) ?
    `attachment; filename="${path.basename(filePath)}"` :
    "inline";
  headers.set("Content-Disposition", disposition);
  headers.set("Cross-Origin-Resource-Policy", "same-site");
  return headers;
};

const normalizeSegments = (segments: string[]) => {
  return segments
    .map((segment) => decodeURIComponent(segment))
    .map((segment) => segment.replace(/\\+/g, "/"))
    .join("/");
};

const ensureValidPath = (relativePath: string) => {
  if (!relativePath || relativePath.includes("..")) {
    throw new Error("Caminho inválido.");
  }
};

const toWebStream = (filePath: string) => {
  const nodeStream = createReadStream(filePath);
  return Readable.toWeb(nodeStream) as unknown as ReadableStream;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: rawSegments } = await context.params;
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
      return NextResponse.json({ message: "Caminho inválido." }, { status: 400 });
    }

    const relativePath = normalizeSegments(rawSegments);
    ensureValidPath(relativePath);
    // Mídias dos grupos internos exigem sessão e vínculo ativo com o grupo.
    // Elas só podem sair pela rota autenticada /api/internal-groups/:id/media/:id.
    if (relativePath.startsWith("internal-groups/")) {
      return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
    }

    const file = await findExistingFile(relativePath);
    if (!file && !isR2UploadsEnabled()) {
      return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
    }

    if (file) {
      const headers = buildHeaders(file.absolutePath, file.stats.size, file.stats.mtime);
      const body = toWebStream(file.absolutePath);
      return new Response(body, { headers });
    }

    const object = await getR2UploadObject(relativePath);
    if (!object) {
      return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
    }

    const headers = buildHeaders(
      relativePath,
      object.size,
      object.lastModified ?? new Date(),
      object.contentType,
    );
    return new Response(new Uint8Array(object.buffer), { headers });
  } catch (error) {
    console.error("Failed to serve upload", error);
    return NextResponse.json({ message: "Erro ao carregar arquivo." }, { status: 500 });
  }
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: rawSegments } = await context.params;
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
      return NextResponse.json({ message: "Caminho inválido." }, { status: 400 });
    }

    const relativePath = normalizeSegments(rawSegments);
    ensureValidPath(relativePath);

    const file = await findExistingFile(relativePath);
    if (!file && !isR2UploadsEnabled()) {
      return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
    }

    if (file) {
      const headers = buildHeaders(file.absolutePath, file.stats.size, file.stats.mtime);
      return new Response(null, { headers });
    }

    const object = await headR2UploadObject(relativePath);
    if (!object) {
      return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
    }

    const headers = buildHeaders(
      relativePath,
      object.size,
      object.lastModified ?? new Date(),
      object.contentType,
    );
    return new Response(null, { headers });
  } catch (error) {
    console.error("Failed to resolve upload metadata", error);
    return NextResponse.json({ message: "Erro ao carregar arquivo." }, { status: 500 });
  }
}

