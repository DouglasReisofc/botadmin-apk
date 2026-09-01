import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { upsertUsefulLinkBanner } from "lib/useful-links";

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

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const formData = await request.formData();
    const title = readString(formData, "title", { required: true, maxLength: 160 });
    const subtitle = readString(formData, "subtitle", { maxLength: 255 }) || null;
    const linkUrl = readString(formData, "linkUrl", { maxLength: 500 }) || null;
    const order = readNumber(formData, "order", 0);
    const isActive = readBoolean(formData, "isActive", true);

    const file = formData.get("media");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Envie a imagem ou GIF do banner." }, { status: 400 });
    }

    const banner = await upsertUsefulLinkBanner({
      title,
      subtitle,
      linkUrl,
      order,
      isActive,
      file,
    });

    return NextResponse.json({
      message: "Banner adicionado com sucesso.",
      banner,
    });
  } catch (error) {
    console.error("Failed to create useful link banner", error);
    const message =
      error instanceof Error ? error.message : "Não foi possível salvar o banner.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
