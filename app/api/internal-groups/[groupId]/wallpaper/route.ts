import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getInternalGroupWallpaperAccess,
  InternalGroupError,
  updateInternalGroupWallpaper,
} from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";
import { SubscriptionPlanError } from "lib/plans";
import { getR2UploadObject } from "lib/r2-uploads";
import {
  ARCHIVE_UPLOAD_ROOT,
  deleteUploadedFile,
  saveUploadedFile,
  UPLOADS_STORAGE_ROOT,
} from "lib/uploads";

export const runtime = "nodejs";
type Context = { params: Promise<{ groupId: string }> };
const MAX_WALLPAPER_BYTES = 15 * 1024 * 1024;

const failure = (error: unknown) => {
  if (error instanceof InternalGroupError || error instanceof SubscriptionPlanError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  console.error("[internal-groups] wallpaper failed", error);
  return NextResponse.json(
    { message: "Não foi possível atualizar o papel de parede." },
    { status: 500 },
  );
};

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

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const wallpaper = await getInternalGroupWallpaperAccess(groupId, user.id);
    const headers = new Headers({
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    const file = await localFile(wallpaper.path);
    if (file) {
      headers.set("Content-Length", String(file.stat.size));
      return new Response(
        Readable.toWeb(createReadStream(file.candidate)) as ReadableStream,
        { headers },
      );
    }
    const object = await getR2UploadObject(wallpaper.path);
    if (!object) {
      return NextResponse.json({ message: "Papel de parede não encontrado." }, { status: 404 });
    }
    headers.set("Content-Length", String(object.size));
    return new Response(new Uint8Array(object.buffer), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0 || !file.type.startsWith("image/")) {
      throw new InternalGroupError("Selecione uma imagem válida.");
    }
    if (file.size > MAX_WALLPAPER_BYTES) {
      throw new InternalGroupError("O papel de parede deve ter no máximo 15 MB.", 413);
    }
    const stored = await saveUploadedFile(file, `internal-groups/${groupId}/wallpaper`, {
      image: { maxWidth: 2560, maxHeight: 2560, fit: "inside", format: "webp", quality: 86 },
    });
    const result = await updateInternalGroupWallpaper(groupId, user.id, stored);
    if (result.previousWallpaperPath) {
      await deleteUploadedFile(result.previousWallpaperPath).catch(() => {});
    }
    emitInternalGroupEvent({
      groupId,
      actorUserId: user.id,
      action: "wallpaper.updated",
      type: "group.updated",
    });
    for (const messageId of result.systemMessageIds) {
      emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId });
    }
    return NextResponse.json({ group: result.group });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const result = await updateInternalGroupWallpaper(groupId, user.id, null);
    if (result.previousWallpaperPath) {
      await deleteUploadedFile(result.previousWallpaperPath).catch(() => {});
    }
    emitInternalGroupEvent({
      groupId,
      actorUserId: user.id,
      action: "wallpaper.removed",
      type: "group.updated",
    });
    for (const messageId of result.systemMessageIds) {
      emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId });
    }
    return NextResponse.json({ group: result.group });
  } catch (error) {
    return failure(error);
  }
}
