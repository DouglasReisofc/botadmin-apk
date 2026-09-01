import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { convertToStickerWebp } from "lib/sticker";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveBufferAsUploadedFile,
  saveUploadedFile,
} from "lib/uploads";

const ALLOWED_MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

type UploadRouteContext = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const resolveInstanceId = async (
  context: UploadRouteContext,
  request: Request,
): Promise<number | null> => {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const params = await Promise.resolve(context.params);
  const direct = parse(params?.instanceId);
  if (direct !== null) {
    return direct;
  }

  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const idx = path.lastIndexOf("bot-instances");
    if (idx >= 0 && path[idx + 1]) {
      return parse(path[idx + 1]);
    }
  } catch {
    return null;
  }

  return null;
};

export async function POST(
  request: NextRequest,
  context: UploadRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
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
    const previousPath =
      typeof previousPathRaw === "string" && previousPathRaw.trim().length > 0
        ? previousPathRaw.trim()
        : "";

    const folder = `bot-instances/${instance.id}/auto-responses`;
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
      message: "Mídia enviada com sucesso.",
      media: {
        path: storedPath,
        url: resolveUploadedFileUrl(storedPath),
        fileName: storedFileName,
        mimeType,
      },
    });
  } catch (error) {
    console.error("Failed to upload instance autoresponse media", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a mídia da autoresposta." },
      { status: 500 },
    );
  }
}
