import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteUploadedFile, resolveUploadedFileUrl, saveUploadedFile } from "lib/uploads";

const MAX_MEDIA_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["image", "video", "audio", "document"]);

const resolveMediaType = (file: File, rawType: FormDataEntryValue | null) => {
  if (typeof rawType === "string" && ALLOWED_MEDIA_TYPES.has(rawType.trim().toLowerCase())) {
    return rawType.trim().toLowerCase() as "image" | "video" | "audio" | "document";
  }
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
};

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("media") ?? formData.get("upload");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Selecione uma mídia válida." }, { status: 400 });
    }
    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      return NextResponse.json({ message: "A mídia deve ter no máximo 25 MB." }, { status: 400 });
    }

    const mediaType = resolveMediaType(file, formData.get("mediaType") ?? formData.get("type"));
    const storedPath = await saveUploadedFile(file, `bot-resale/affiliate/${user.id}`, {
      convertToWebp: mediaType === "image" ? false : undefined,
    });

    return NextResponse.json({
      message: "Mídia adicionada aos anúncios.",
      media: {
        id: randomUUID(),
        path: storedPath,
        url: resolveUploadedFileUrl(storedPath),
        mediaType,
        mimeType: file.type || null,
        fileName: file.name || null,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[bot-resale/affiliate/media] POST failed", error);
    return NextResponse.json(
      { message: "Não foi possível salvar a mídia agora." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const path = typeof body.path === "string" ? body.path.trim() : "";
    if (!path || !path.includes(`/bot-resale/affiliate/${user.id}/`)) {
      return NextResponse.json({ message: "Mídia inválida." }, { status: 400 });
    }
    await deleteUploadedFile(path).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[bot-resale/affiliate/media] DELETE failed", error);
    return NextResponse.json(
      { message: "Não foi possível remover a mídia agora." },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
