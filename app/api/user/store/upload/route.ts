import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { resolveUploadedFileUrl, saveUploadedFile } from "lib/uploads";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "Não autenticado." },
        { status: 401 },
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json(
        { message: "Selecione um arquivo válido." },
        { status: 400 },
      );
    }
    const kind = String(form.get("kind") || "image")
      .trim()
      .toLowerCase();
    const folder = `users/${user.id}/store/${kind === "delivery" ? "delivery" : "images"}`;
    const storedPath = await saveUploadedFile(file, folder, {
      ...(kind === "image"
        ? {
            image: {
              maxWidth: 1200,
              maxHeight: 1200,
              fit: "inside" as const,
              format: "webp" as const,
              quality: 84,
            },
          }
        : {}),
    });
    return NextResponse.json({
      file: {
        path: storedPath,
        url: resolveUploadedFileUrl(storedPath),
        fileName: file.name,
        mimeType: file.type || null,
        size: file.size,
      },
    });
  } catch (error) {
    console.error("[bot-store] Falha no upload", error);
    return NextResponse.json(
      { message: "Não foi possível enviar o arquivo." },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
