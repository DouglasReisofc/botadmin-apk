import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  registerPushSubscription,
  unregisterPushSubscription,
  PushPlatform,
} from "lib/push-notifications";

const normalizePlatform = (value: unknown): PushPlatform => {
  if (value === "android" || value === "ios" || value === "web") {
    return value;
  }
  throw new Error("Plataforma de push invalida.");
};

export async function POST(request: Request) {
  const sessionUser = await getCurrentUser();

  if (!sessionUser) {
    return NextResponse.json({ message: "Nao autenticado." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Payload invalido." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  const platformRaw = payload.platform ?? "";
  const deviceId = typeof payload.deviceId === "string" ? payload.deviceId.trim() : null;

  if (!token) {
    return NextResponse.json({ message: "Informe o token de push." }, { status: 400 });
  }

  let platform: PushPlatform;
  try {
    platform = normalizePlatform(platformRaw);
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 });
  }

  try {
    await registerPushSubscription(sessionUser.id, { token, platform, deviceId });
    return NextResponse.json({ message: "Token registrado com sucesso." });
  } catch (error) {
    console.error("Falha ao registrar push token", error);
    return NextResponse.json({ message: "Nao foi possivel registrar o token." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const sessionUser = await getCurrentUser();

  if (!sessionUser) {
    return NextResponse.json({ message: "Nao autenticado." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";

  if (!token) {
    return NextResponse.json({ message: "Informe o token de push." }, { status: 400 });
  }

  try {
    await unregisterPushSubscription(token);
    return NextResponse.json({ message: "Token removido." });
  } catch (error) {
    console.error("Falha ao remover push token", error);
    return NextResponse.json({ message: "Nao foi possivel remover o token." }, { status: 500 });
  }
}
