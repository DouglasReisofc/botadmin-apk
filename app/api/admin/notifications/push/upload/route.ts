import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveUploadedFile,
} from "lib/uploads";

const ALLOWED_MIME_PREFIXES = ["image/"];

const ensureAdmin = async () => {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    throw new Error("Acesso negado.");
  }
};

const buildMimeType = (file: File, storedPath: string): string | null => {
  if (file.type) {
    return file.type;
  }
  if (storedPath.toLowerCase().endsWith(".webp")) {
    return "image/webp";
  }
  if (storedPath.toLowerCase().endsWith(".png")) {
    return "image/png";
  }
  if (storedPath.toLowerCase().endsWith(".jpg") || storedPath.toLowerCase().endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return null;
};

export async function POST(request: NextRequest) {
  try {
    await ensureAdmin();

    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("media") ?? formData.get("upload");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Selecione um arquivo válido." }, { status: 400 });
    }

    const mime = (file.type ?? "").toLowerCase();
    if (!ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
      return NextResponse.json({ message: "Envie apenas arquivos de imagem." }, { status: 400 });
    }

    const previousPathRaw = formData.get("previousPath");
    const previousPath =
      typeof previousPathRaw === "string" && previousPathRaw.trim().length > 0
        ? previousPathRaw.trim()
        : "";

    const storedPath = await saveUploadedFile(file, "notifications/push", { convertToWebp: true });
    if (previousPath) {
      await deleteUploadedFile(previousPath).catch(() => {});
    }

    const segments = storedPath.split("/");
    const storedFileName = segments[segments.length - 1] ?? file.name;

    return NextResponse.json({
      message: "Mídia enviada com sucesso.",
      media: {
        path: storedPath,
        url: resolveUploadedFileUrl(storedPath),
        fileName: storedFileName,
        mimeType: buildMimeType(file, storedPath),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Acesso negado.") {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    console.error("Failed to upload push notification media", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a mídia." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureAdmin();
    const body = await request.json().catch(() => null);
    const path = body && typeof body.path === "string" ? body.path.trim() : "";
    if (!path) {
      return NextResponse.json({ message: "Informe o caminho da mídia." }, { status: 400 });
    }
    await deleteUploadedFile(path).catch(() => {});
    return NextResponse.json({ message: "Mídia removida." });
  } catch (error) {
    if (error instanceof Error && error.message === "Acesso negado.") {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    console.error("Failed to delete push notification media", error);
    return NextResponse.json({ message: "Não foi possível remover a mídia." }, { status: 500 });
  }
}
