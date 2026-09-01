import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteUsefulLinkBanner, upsertUsefulLinkBanner } from "lib/useful-links";

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

const resolveBannerId = async (
  params: Promise<{ bannerId: string }>,
  request: NextRequest,
): Promise<number | null> => {
  const resolvedParams = await Promise.resolve(params);
  const fromParams = parsePositiveId(resolvedParams?.bannerId);
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
  const { required = false, maxLength = 255 } = options;
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
  context: { params: Promise<{ bannerId: string }> },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const bannerId = await resolveBannerId(context.params, request);
    if (!bannerId) {
      return NextResponse.json({ message: "Identificador inválido." }, { status: 400 });
    }

    const formData = await request.formData();
    const title = readString(formData, "title", { required: true, maxLength: 160 });
    const subtitle = readString(formData, "subtitle", { maxLength: 255 }) || null;
    const linkUrl = readString(formData, "linkUrl", { maxLength: 500 }) || null;
    const order = readNumber(formData, "order", 0);
    const isActive = readBoolean(formData, "isActive", true);

    const file = formData.get("media");
    if (file && !(file instanceof File)) {
      return NextResponse.json({ message: "Arquivo de imagem inválido." }, { status: 400 });
    }

    const banner = await upsertUsefulLinkBanner({
      id: bannerId,
      title,
      subtitle,
      linkUrl,
      order,
      isActive,
      file: file instanceof File && file.size > 0 ? file : undefined,
    });

    return NextResponse.json({
      message: "Banner atualizado com sucesso.",
      banner,
    });
  } catch (error) {
    console.error("Failed to update useful link banner", error);
    const message =
      error instanceof Error ? error.message : "Não foi possível salvar o banner.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ bannerId: string }> },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const bannerId = await resolveBannerId(context.params, request);
    if (!bannerId) {
      return NextResponse.json({ message: "Identificador inválido." }, { status: 400 });
    }

    await deleteUsefulLinkBanner(bannerId);
    return NextResponse.json({ message: "Banner removido." });
  } catch (error) {
    console.error("Failed to delete useful link banner", error);
    return NextResponse.json(
      { message: "Não foi possível remover o banner." },
      { status: 500 },
    );
  }
}
