import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupAccessForUser } from "lib/bot-groups";
import { convertToStickerWebp } from "lib/sticker";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveBufferAsUploadedFile,
  saveUploadedFile,
} from "lib/uploads";

const ALLOWED_MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await context.params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("media") ?? formData.get("upload");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Selecione um arquivo válido." }, { status: 400 });
    }

    const rawMediaType = formData.get("mediaType") ?? formData.get("type");
    const mediaType = typeof rawMediaType === "string" ? rawMediaType.trim().toLowerCase() : "document";
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return NextResponse.json({ message: "Tipo de mídia inválido." }, { status: 400 });
    }

    const previousPathRaw = formData.get("previousPath");
    const previousPath = typeof previousPathRaw === "string" ? previousPathRaw.trim() : "";

    const folder = `bot-groups/${groupId}/welcome`;
    let storedPath: string;
    let mimeType: string | null = file.type || null;
    let storedFileName = file.name;

    if (mediaType === "sticker") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const converted = await convertToStickerWebp({
        kind: "buffer",
        buffer,
        fileName: file.name,
        mimeType: file.type || null,
      });

      storedPath = await saveBufferAsUploadedFile(converted.buffer, folder, {
        fixedFileName: file.name,
        forceExtension: ".webp",
      });
      mimeType = converted.mimeType;
      const parts = storedPath.split("/");
      storedFileName = parts[parts.length - 1] || storedFileName;
    } else {
      storedPath = await saveUploadedFile(file, folder);
    }

    if (previousPath) {
      await deleteUploadedFile(previousPath).catch(() => {});
    }

    return NextResponse.json({
      message: "Arquivo enviado com sucesso.",
      media: {
        path: storedPath,
        url: resolveUploadedFileUrl(storedPath),
        fileName: storedFileName,
        mimeType,
      },
    });
  } catch (error) {
    console.error("Failed to upload welcome attachment", error);
    return NextResponse.json(
      { message: "Não foi possível enviar o anexo de boas-vindas." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await context.params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    const payload = await request.json().catch(() => ({} as Record<string, unknown>));
    const path = typeof payload.path === "string" ? payload.path.trim() : "";
    if (!path) {
      return NextResponse.json({ message: "Caminho inválido." }, { status: 400 });
    }

    await deleteUploadedFile(path).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete welcome attachment", error);
    return NextResponse.json({ message: "Falha ao excluir o anexo." }, { status: 500 });
  }
}
