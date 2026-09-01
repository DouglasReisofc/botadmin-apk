import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLUTTER_PUBLIC_ROOT = path.join(
  process.cwd(),
  "public",
  "dashboard",
  "user",
);

const getMimeType = (filePath: string) => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".otf":
      return "font/otf";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
};

const cacheControlFor = (filePath: string) => {
  const name = path.basename(filePath);
  if (
    /^main\.dart\.[a-z0-9-]+\.js$/i.test(name) ||
    /^flutter_bootstrap\.[a-z0-9-]+\.js$/i.test(name)
  ) {
    return "public, max-age=31536000, immutable";
  }
  if (
    name === "flutter_bootstrap.js" ||
    name === "flutter_service_worker.js" ||
    name === "main.dart.js" ||
    name === "index.html" ||
    name === "version.json"
  ) {
    return "no-store, no-cache, max-age=0, must-revalidate";
  }
  return "public, max-age=3600, must-revalidate";
};

const resolveAssetPath = (segments: string[]) => {
  const relativePath = segments
    .map((segment) => decodeURIComponent(segment))
    .join("/");
  if (!relativePath || relativePath.includes("\0")) {
    return null;
  }

  const absolutePath = path.resolve(FLUTTER_PUBLIC_ROOT, relativePath);
  if (
    absolutePath !== FLUTTER_PUBLIC_ROOT &&
    !absolutePath.startsWith(`${FLUTTER_PUBLIC_ROOT}${path.sep}`)
  ) {
    return null;
  }
  return absolutePath;
};

const toWebStream = (filePath: string) => {
  return Readable.toWeb(
    createReadStream(filePath),
  ) as unknown as ReadableStream;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ asset: string[] }> },
) {
  const { asset } = await context.params;
  if (!Array.isArray(asset) || asset.length === 0) {
    return NextResponse.json({ message: "Arquivo invalido." }, { status: 400 });
  }

  const absolutePath = resolveAssetPath(asset);
  if (!absolutePath) {
    return NextResponse.json({ message: "Arquivo invalido." }, { status: 400 });
  }

  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      return NextResponse.json(
        { message: "Arquivo nao encontrado." },
        { status: 404 },
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": getMimeType(absolutePath),
      "Content-Length": stats.size.toString(),
      "Last-Modified": stats.mtime.toUTCString(),
      "Cache-Control": cacheControlFor(absolutePath),
      "CDN-Cache-Control": cacheControlFor(absolutePath),
      "Surrogate-Control": cacheControlFor(absolutePath),
      "X-Content-Type-Options": "nosniff",
    };

    if (path.basename(absolutePath) === "flutter_service_worker.js") {
      headers["Service-Worker-Allowed"] = "/dashboard/user/";
    }

    return new Response(toWebStream(absolutePath), {
      headers,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { message: "Arquivo nao encontrado." },
        { status: 404 },
      );
    }
    throw error;
  }
}
