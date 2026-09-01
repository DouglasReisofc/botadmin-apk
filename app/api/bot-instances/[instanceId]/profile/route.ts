import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  getInstanceProfileForUser,
  updateInstanceProfileForUser,
} from "lib/bot-instances";

const resolveInstanceId = (params: { instanceId?: string }, request: Request): number | null => {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const direct = parse(params.instanceId);
  if (direct !== null) {
    return direct;
  }

  const path = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = path.lastIndexOf("bot-instances");
  if (idx >= 0 && path[idx + 1]) {
    const parsed = parse(path[idx + 1]);
    if (parsed !== null) {
      return parsed;
    }
  }

  const fallback = path.length >= 2 ? path[path.length - 2] : null;
  return parse(fallback);
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "sim", "on"].includes(normalized);
  }
  return false;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ instanceId: string }> | { instanceId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(context.params);
    const instanceId = resolveInstanceId(resolvedParams, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const profile = await getInstanceProfileForUser(user.id, instanceId);
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to load bot instance profile", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o perfil da instância." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ instanceId: string }> | { instanceId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(context.params);
    const instanceId = resolveInstanceId(resolvedParams, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    const payload: {
      displayName?: string;
      pushName?: string;
      statusText?: string;
      imageDataUrl?: string;
      removePhoto?: boolean;
    } = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const displayName = formData.get("displayName");
      const pushName = formData.get("pushName");
      const statusText = formData.get("statusText");
      const removePhoto = formData.get("removePhoto");
      const photo = formData.get("photo");

      if (typeof displayName === "string") payload.displayName = displayName;
      if (typeof pushName === "string") payload.pushName = pushName;
      if (typeof statusText === "string") payload.statusText = statusText;
      payload.removePhoto = parseBoolean(removePhoto);

      if (photo instanceof File && photo.size > 0) {
        if (!photo.type.startsWith("image/")) {
          return NextResponse.json({ message: "Envie um arquivo de imagem válido." }, { status: 400 });
        }
        const buffer = Buffer.from(await photo.arrayBuffer());
        const base64 = buffer.toString("base64");
        payload.imageDataUrl = `data:${photo.type || "image/jpeg"};base64,${base64}`;
      }
    } else {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
      }
      const data = body as Record<string, unknown>;
      if (typeof data.displayName === "string") payload.displayName = data.displayName;
      if (typeof data.pushName === "string") payload.pushName = data.pushName;
      if (typeof data.statusText === "string") payload.statusText = data.statusText;
      if (typeof data.imageDataUrl === "string") payload.imageDataUrl = data.imageDataUrl;
      payload.removePhoto = parseBoolean(data.removePhoto);
    }

    const hasChanges =
      payload.displayName !== undefined ||
      payload.pushName !== undefined ||
      payload.statusText !== undefined ||
      payload.imageDataUrl !== undefined ||
      payload.removePhoto === true;

    if (!hasChanges) {
      return NextResponse.json({ message: "Nenhuma alteração informada." }, { status: 400 });
    }

    const result = await updateInstanceProfileForUser(user.id, instanceId, payload);
    return NextResponse.json({
      message: "Perfil da instância atualizado.",
      instance: result.instance,
      profile: result.profile,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to update bot instance profile", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o perfil da instância." },
      { status: 500 },
    );
  }
}
