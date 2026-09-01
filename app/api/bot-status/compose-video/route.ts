import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { composeStatusVideo } from "lib/media/status-video-compose";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveBufferAsUploadedFile,
} from "lib/uploads";

const textValue = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const form = await request.formData();
    const source = form.get("video");
    const overlay = form.get("overlay");
    if (!(source instanceof File) || source.size === 0) {
      return NextResponse.json({ message: "Selecione um vídeo válido." }, { status: 400 });
    }
    if (!(overlay instanceof File) || overlay.size === 0) {
      return NextResponse.json({ message: "A composição do editor está vazia." }, { status: 400 });
    }
    if (source.size > 180 * 1024 * 1024) {
      return NextResponse.json({ message: "O vídeo ultrapassa o limite de 180 MB." }, { status: 413 });
    }

    const buffer = await composeStatusVideo({
      video: Buffer.from(await source.arrayBuffer()),
      overlay: Buffer.from(await overlay.arrayBuffer()),
      fileName: source.name,
      mimeType: source.type,
      backgroundColor: textValue(form, "backgroundColor"),
      mediaScale: Number.parseFloat(textValue(form, "mediaScale")),
      mediaX: Number.parseFloat(textValue(form, "mediaX")),
      mediaY: Number.parseFloat(textValue(form, "mediaY")),
      mediaRotation: Number.parseFloat(textValue(form, "mediaRotation")),
    });
    const storedPath = await saveBufferAsUploadedFile(
      buffer,
      `bot-ad-campaigns/${user.id}`,
      { fixedFileName: `status-editor-${Date.now()}.mp4`, forceExtension: ".mp4" },
    );
    const previousPath = textValue(form, "previousPath");
    if (previousPath) await deleteUploadedFile(previousPath).catch(() => undefined);

    return NextResponse.json({
      message: "Vídeo composto com sucesso.",
      media: {
        mediaType: "video",
        path: storedPath,
        url: resolveUploadedFileUrl(storedPath),
        fileName: pathName(storedPath),
        mimeType: "video/mp4",
      },
    });
  } catch (error) {
    console.error("Failed to compose status video", error);
    return NextResponse.json(
      { message: "Não foi possível montar o vídeo do status." },
      { status: 500 },
    );
  }
}

const pathName = (value: string) => value.split("/").pop() || "status.mp4";
