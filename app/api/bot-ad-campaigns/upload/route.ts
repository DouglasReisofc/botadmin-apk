import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveUploadedFile,
} from "lib/uploads";

const ALLOWED_MEDIA_TYPES = new Set(["image", "video", "audio", "document"]);

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("media") ?? formData.get("upload");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Selecione um arquivo válido." }, { status: 400 });
    }

    const rawMediaType = formData.get("mediaType");
    const mediaType =
      typeof rawMediaType === "string" ? rawMediaType.trim().toLowerCase() : "document";
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return NextResponse.json({ message: "Tipo de mídia inválido." }, { status: 400 });
    }

    const previousPathRaw = formData.get("previousPath");
    const previousPath = typeof previousPathRaw === "string" ? previousPathRaw.trim() : "";

    const storedPath = await saveUploadedFile(file, `bot-ad-campaigns/${user.id}`);

    if (previousPath) {
      await deleteUploadedFile(previousPath).catch(() => undefined);
    }

    return NextResponse.json({
      message: "Mídia enviada com sucesso.",
      media: {
        mediaType,
        path: storedPath,
        url: resolveUploadedFileUrl(storedPath),
        fileName: file.name,
        mimeType: file.type || null,
      },
    });
  } catch (error) {
    console.error("Failed to upload campaign media", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a mídia do anúncio." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const mediaPath = typeof body?.path === "string" ? body.path.trim() : "";
  const expectedPrefix = `uploads/bot-ad-campaigns/${user.id}/`;
  const normalized = mediaPath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized.startsWith(expectedPrefix)) {
    return NextResponse.json({ message: "Caminho de mídia inválido." }, { status: 400 });
  }
  await deleteUploadedFile(normalized);
  return NextResponse.json({ message: "Mídia temporária removida." });
}
