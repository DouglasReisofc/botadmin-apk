import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveUploadedFile,
} from "lib/uploads";

const ALLOWED_MEDIA_TYPES = new Set(["image", "video", "audio", "document"]);

const inferMediaType = (file: File, explicit?: string | null): "image" | "video" | "audio" | "document" => {
  const normalized = explicit?.trim().toLowerCase();
  if (normalized && ALLOWED_MEDIA_TYPES.has(normalized as any)) {
    return normalized as "image" | "video" | "audio" | "document";
  }
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

const ensureUserPathSafety = (userId: number, relativePath: string): boolean => {
  const normalized = relativePath.replace(/^\/+/g, "").replace(/\\/g, "/");
  return normalized.startsWith(`uploads/users/${userId}/raffles`);
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
      return NextResponse.json({ message: "Selecione um arquivo válido." }, { status: 400 });
    }

    const rawType = formData.get("mediaType") || formData.get("type");
    const mediaType = inferMediaType(file, typeof rawType === "string" ? rawType : null);

    const previousPathRaw = formData.get("previousPath") || formData.get("previous" );
    const previousPath = typeof previousPathRaw === "string" ? previousPathRaw.trim() : "";

    const folder = `users/${user.id}/raffles`;
    const storedPath = await saveUploadedFile(file, folder);

    if (previousPath && ensureUserPathSafety(user.id, previousPath)) {
      await deleteUploadedFile(previousPath).catch(() => {});
    }

    return NextResponse.json({
      message: "Mídia enviada com sucesso.",
      media: {
        path: storedPath,
        url: resolveUploadedFileUrl(storedPath),
        fileName: file.name,
        mimeType: file.type || null,
        mediaType,
      },
    });
  } catch (error) {
    console.error("Failed to upload raffle media", error);
    return NextResponse.json({ message: "Não foi possível enviar a mídia." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pathParam = searchParams.get("path") ?? searchParams.get("media") ?? "";
    if (!pathParam || !ensureUserPathSafety(user.id, pathParam)) {
      return NextResponse.json({ message: "Arquivo inválido." }, { status: 400 });
    }

    await deleteUploadedFile(pathParam).catch(() => {});

    return NextResponse.json({ message: "Mídia removida." });
  } catch (error) {
    console.error("Failed to delete raffle media", error);
    return NextResponse.json({ message: "Não foi possível remover a mídia." }, { status: 500 });
  }
}

