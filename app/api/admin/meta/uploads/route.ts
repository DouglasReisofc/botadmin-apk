import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import { uploadTemplateMedia } from "lib/admin-meta-media";
import type { TemplateMediaKind } from "types/admin-meta-templates";

const SUPPORTED_MEDIA_KINDS: TemplateMediaKind[] = ["image", "video", "document"];

const sanitizeKind = (value: unknown): TemplateMediaKind | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_MEDIA_KINDS.find((kind) => kind === normalized) ?? null;
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const kind = sanitizeKind(formData.get("kind"));

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Envie um arquivo para continuar." }, { status: 400 });
    }

    if (!kind) {
      return NextResponse.json({ message: "Tipo de mídia inválido." }, { status: 400 });
    }

    const webhook = await getAdminWebhookRow();

    const media = await uploadTemplateMedia(webhook, file, kind);

    return NextResponse.json({
      message: "Arquivo enviado com sucesso.",
      media,
    });
  } catch (error) {
    console.error("Failed to upload Meta template media", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível enviar o arquivo no momento.",
      },
      { status: 500 },
    );
  }
}
