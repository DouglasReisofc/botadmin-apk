import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";

import { getInternalGroupInviteAvatarAccess } from "lib/internal-groups";
import { getR2UploadObject } from "lib/r2-uploads";
import { ARCHIVE_UPLOAD_ROOT, UPLOADS_STORAGE_ROOT } from "lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const findLocalFile = async (storedPath: string) => {
  const normalized = storedPath.replace(/^uploads\//, "").replace(/\\/g, "/");
  for (const root of [UPLOADS_STORAGE_ROOT, ARCHIVE_UPLOAD_ROOT]) {
    const candidate = path.resolve(root, normalized);
    if (!candidate.startsWith(root)) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return { candidate, stat };
    } catch {}
  }
  return null;
};

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
    const avatar = await getInternalGroupInviteAvatarAccess(token);
    if (!avatar) {
      return NextResponse.json({ message: "Foto do grupo não encontrada." }, { status: 404 });
    }

    const headers = new Headers({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    const file = await findLocalFile(avatar.path);
    if (file) {
      headers.set("Content-Length", String(file.stat.size));
      return new Response(
        Readable.toWeb(createReadStream(file.candidate)) as ReadableStream,
        { headers },
      );
    }
    const object = await getR2UploadObject(avatar.path);
    if (!object) {
      return NextResponse.json({ message: "Foto do grupo não encontrada." }, { status: 404 });
    }
    headers.set("Content-Length", String(object.size));
    if (object.contentType) headers.set("Content-Type", object.contentType);
    return new Response(new Uint8Array(object.buffer), { headers });
  } catch (error) {
    console.error("[internal-groups] public invite avatar failed", error);
    return NextResponse.json({ message: "Não foi possível carregar a foto." }, { status: 404 });
  }
}
