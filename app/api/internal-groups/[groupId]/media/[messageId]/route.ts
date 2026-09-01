import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInternalGroupMediaAccess, InternalGroupError } from "lib/internal-groups";
import { getR2UploadObject } from "lib/r2-uploads";
import { ARCHIVE_UPLOAD_ROOT, UPLOADS_STORAGE_ROOT } from "lib/uploads";

export const runtime = "nodejs";
type Context = { params: Promise<{ groupId: string; messageId: string }> };

const localFile = async (storedPath: string) => {
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

const byteRange = (value: string | null, size: number) => {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || size <= 0) return false as const;
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return false as const;

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix) || suffix <= 0) return false as const;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return false as const;
  }
  return { start, end: Math.min(end, size - 1) };
};

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const params = await context.params;
    const media = await getInternalGroupMediaAccess(Number(params.groupId), Number(params.messageId), user.id);
    if (/^https?:\/\//i.test(media.path)) {
      const upstreamHeaders = new Headers({ accept: "*/*" });
      const range = request.headers.get("range");
      if (range) upstreamHeaders.set("range", range);
      const upstream = await fetch(media.path, {
        headers: upstreamHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (!upstream.ok && upstream.status !== 206) {
        return NextResponse.json(
          { message: "A mídia externa não está disponível neste momento." },
          { status: upstream.status === 404 ? 404 : 502 },
        );
      }
      const headers = new Headers({
        "Content-Type": upstream.headers.get("content-type") || media.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`,
        "Cache-Control": media.viewOnce ? "private, no-store" : "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      for (const key of ["content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(key);
        if (value) headers.set(key, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    const headers = new Headers({
      "Content-Type": media.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`,
      "Cache-Control": media.viewOnce ? "private, no-store" : "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    });
    const requestedRange = request.headers.get("range");
    const file = await localFile(media.path);
    if (file) {
      const range = byteRange(requestedRange, file.stat.size);
      if (range === false) {
        headers.set("Content-Range", `bytes */${file.stat.size}`);
        return new Response(null, { status: 416, headers });
      }
      if (range) {
        headers.set(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${file.stat.size}`,
        );
        headers.set("Content-Length", String(range.end - range.start + 1));
        return new Response(
          Readable.toWeb(
            createReadStream(file.candidate, {
              start: range.start,
              end: range.end,
            }),
          ) as ReadableStream,
          { status: 206, headers },
        );
      }
      headers.set("Content-Length", String(file.stat.size));
      return new Response(
        Readable.toWeb(createReadStream(file.candidate)) as ReadableStream,
        { headers },
      );
    }
    const object = await getR2UploadObject(media.path);
    if (!object) return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
    const range = byteRange(requestedRange, object.size);
    if (range === false) {
      headers.set("Content-Range", `bytes */${object.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${object.size}`,
      );
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(
        new Uint8Array(object.buffer.subarray(range.start, range.end + 1)),
        { status: 206, headers },
      );
    }
    headers.set("Content-Length", String(object.size));
    return new Response(new Uint8Array(object.buffer), { headers });
  } catch (error) {
    if (error instanceof InternalGroupError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error("[internal-groups] protected media failed", error);
    return NextResponse.json({ message: "Não foi possível carregar a mídia." }, { status: 500 });
  }
}
