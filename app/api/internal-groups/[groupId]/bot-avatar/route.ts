import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getInternalGroupBotAvatarAccess,
  InternalGroupError,
  updateInternalGroupBotAvatar,
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
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

const failure = (error: unknown) => {
  if (error instanceof InternalGroupError || error instanceof SubscriptionPlanError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  console.error("[internal-groups] bot avatar failed", error);
  return NextResponse.json({ message: "Não foi possível atualizar a foto do robô." }, { status: 500 });
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
    const avatar = await getInternalGroupBotAvatarAccess(groupId, user.id);
    const headers = new Headers({
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    const file = await localFile(avatar.path);
    if (file) {
      headers.set("Content-Length", String(file.stat.size));
      return new Response(
        Readable.toWeb(createReadStream(file.candidate)) as ReadableStream,
        { headers },
      );
    }
    const object = await getR2UploadObject(avatar.path);
    if (!object) return NextResponse.json({ message: "Foto não encontrada." }, { status: 404 });
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
    if (file.size > MAX_AVATAR_BYTES) {
      throw new InternalGroupError("A foto deve ter no máximo 8 MB.", 413);
    }
    const stored = await saveUploadedFile(file, `internal-groups/${groupId}/bot-avatar`, {
      image: { maxWidth: 1024, maxHeight: 1024, fit: "cover", format: "webp", quality: 88 },
    });
    const result = await updateInternalGroupBotAvatar(groupId, user.id, stored);
    if (result.previousAvatarPath) {
      await deleteUploadedFile(result.previousAvatarPath).catch(() => {});
    }
    emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "group.updated" });
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
    const result = await updateInternalGroupBotAvatar(groupId, user.id, null);
    if (result.previousAvatarPath) {
      await deleteUploadedFile(result.previousAvatarPath).catch(() => {});
    }
    emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "group.updated" });
    for (const messageId of result.systemMessageIds) {
      emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId });
    }
    return NextResponse.json({ group: result.group });
  } catch (error) {
    return failure(error);
  }
}
