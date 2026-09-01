import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const FALLBACK_ROOTS = [
  path.join(process.cwd(), "resources", "favicons"),
  PUBLIC_ROOT,
];

export const servePublicFile = async (relativePath: string, contentType: string) => {
  const normalized = relativePath.replace(/^\/+/, "");
  for (const root of FALLBACK_ROOTS) {
    const absolute = path.join(root, normalized);
    try {
      const data = await readFile(absolute);
      return new NextResponse(data, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (_error) {
      // try next root
      continue;
    }
  }

  console.error(`Static asset not found: ${relativePath}`);
  return new NextResponse("Not found", { status: 404 });
};
