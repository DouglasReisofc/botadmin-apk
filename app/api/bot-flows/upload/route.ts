import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { userPlanAllowsFlows } from "lib/plans";
import { resolveUploadedFileUrl, saveUploadedFile } from "lib/uploads";

const inferMediaType = (file: File): "image" | "video" | "audio" | "document" => {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (!(await userPlanAllowsFlows(user.id))) {
      return NextResponse.json(
        { message: "Seu plano atual não libera o construtor de fluxos." },
        { status: 402 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("media") ?? formData.get("upload");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Selecione um arquivo válido." }, { status: 400 });
    }

    const mediaType = inferMediaType(file);
    const storedPath = await saveUploadedFile(file, `bot-flows/${user.id}`);

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
    console.error("Failed to upload flow media", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a mídia do fluxo." },
      { status: 500 },
    );
  }
}
