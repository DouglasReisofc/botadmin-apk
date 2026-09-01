import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteFieldTutorial, upsertFieldTutorial } from "lib/tutorials";

const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 8000;

const sanitizeString = (value: unknown, maxLength: number, required = false) => {
  if (typeof value !== "string") {
    return required ? null : "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return required ? null : "";
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

export async function PUT(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const slug = params.slug?.trim();
    if (!slug) {
      return NextResponse.json({ message: "Slug inválido." }, { status: 400 });
    }

    const formData = await request.formData();
    const title = sanitizeString(formData.get("title"), MAX_TITLE_LENGTH, true);
    const description = sanitizeString(
      formData.get("description"),
      MAX_DESCRIPTION_LENGTH,
      true,
    );

    if (!title || !description) {
      return NextResponse.json(
        { message: "Preencha título e descrição do tutorial." },
        { status: 400 },
      );
    }

    const media = formData.get("media");
    const removeMedia = formData.get("removeMedia") === "true";
    const mediaTypeRaw = sanitizeString(formData.get("mediaType"), 10);
    const mediaType = mediaTypeRaw === "video" ? "video" : mediaTypeRaw === "image" ? "image" : null;

    if (removeMedia && media instanceof File && media.size > 0) {
      return NextResponse.json(
        { message: "Envie um arquivo ou solicite a remoção da mídia, não ambos." },
        { status: 400 },
      );
    }

    const tutorial = await upsertFieldTutorial({
      slug,
      title,
      description,
      mediaFile: media instanceof File ? media : undefined,
      mediaType,
      removeMedia,
    });

    return NextResponse.json({
      message: "Tutorial atualizado com sucesso.",
      tutorial,
    });
  } catch (error) {
    console.error("Failed to update tutorial", error);
    return NextResponse.json(
      { message: "Não foi possível salvar o tutorial." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const slug = params.slug?.trim();
    if (!slug) {
      return NextResponse.json({ message: "Slug inválido." }, { status: 400 });
    }

    await deleteFieldTutorial(slug);
    return NextResponse.json({ message: "Tutorial removido." });
  } catch (error) {
    console.error("Failed to delete tutorial", error);
    return NextResponse.json(
      { message: "Não foi possível remover o tutorial." },
      { status: 500 },
    );
  }
}
