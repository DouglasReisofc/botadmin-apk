import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteUsefulLink, upsertUsefulLink } from "lib/useful-links";

const parsePositiveId = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const resolveLinkId = async (
  params: Promise<{ linkId: string }>,
  request: NextRequest,
): Promise<number | null> => {
  const resolvedParams = await Promise.resolve(params);
  const fromParams = parsePositiveId(resolvedParams?.linkId);
  if (fromParams) {
    return fromParams;
  }

  const path = new URL(request.url).pathname.split("/").filter(Boolean);
  const fromPath = parsePositiveId(path[path.length - 1] ?? null);
  return fromPath;
};

const readString = (
  formData: FormData,
  name: string,
  options: { required?: boolean; maxLength?: number } = {},
): string => {
  const { required = false, maxLength = 500 } = options;
  const rawValue = formData.get(name);

  if (rawValue === null) {
    if (required) {
      throw new Error(`Campo obrigatório ausente: ${name}`);
    }
    return "";
  }

  if (typeof rawValue !== "string") {
    throw new Error(`Valor inválido recebido para ${name}`);
  }

  const trimmed = rawValue.trim();

  if (!trimmed && required) {
    throw new Error(`Campo obrigatório ausente: ${name}`);
  }

  if (maxLength > 0 && trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }

  return trimmed;
};

const readNumber = (formData: FormData, name: string, fallback = 0): number => {
  const rawValue = formData.get(name);
  if (rawValue === null || rawValue === "") {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
};

const readBoolean = (formData: FormData, name: string, fallback = true): boolean => {
  const value = formData.get(name);
  if (value === null) {
    return fallback;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "on", "yes"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "off", "no"].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
};

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ linkId: string }> },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const linkId = await resolveLinkId(context.params, request);
    if (!linkId) {
      return NextResponse.json({ message: "Identificador inválido." }, { status: 400 });
    }

    const formData = await request.formData();
    const title = readString(formData, "title", { required: true, maxLength: 160 });
    const description = readString(formData, "description", { maxLength: 2000 }) || null;
    const url = readString(formData, "url", { required: true, maxLength: 500 });
    const buttonLabel = readString(formData, "buttonLabel", { required: true, maxLength: 80 });
    const icon = readString(formData, "icon", { maxLength: 80 }) || null;
    const order = readNumber(formData, "order", 0);
    const isActive = readBoolean(formData, "isActive", true);
    const removeImage = readBoolean(formData, "removeImage", false);

    const image = formData.get("image");
    if (image && !(image instanceof File)) {
      return NextResponse.json({ message: "Arquivo de imagem inválido." }, { status: 400 });
    }

    if (removeImage && image instanceof File && image.size > 0) {
      return NextResponse.json(
        { message: "Envie uma imagem ou solicite a remoção da atual, não ambos." },
        { status: 400 },
      );
    }

    const link = await upsertUsefulLink({
      id: linkId,
      title,
      description,
      url,
      buttonLabel,
      icon,
      order,
      isActive,
      file: image instanceof File ? image : null,
      removeImage,
    });

    return NextResponse.json({
      message: "Link atualizado com sucesso.",
      link,
    });
  } catch (error) {
    console.error("Failed to update useful link", error);
    const message =
      error instanceof Error ? error.message : "Não foi possível salvar o link útil.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ linkId: string }> },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const linkId = await resolveLinkId(context.params, request);
    if (!linkId) {
      return NextResponse.json({ message: "Identificador inválido." }, { status: 400 });
    }

    await deleteUsefulLink(linkId);
    return NextResponse.json({ message: "Link removido." });
  } catch (error) {
    console.error("Failed to delete useful link", error);
    return NextResponse.json(
      { message: "Não foi possível remover o link útil." },
      { status: 500 },
    );
  }
}
