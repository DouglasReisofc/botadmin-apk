import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getOrCreateUserApiKey,
  rotateUserApiKey,
  setUserApiKey,
} from "lib/user-api-keys";

const serialize = (record: Awaited<ReturnType<typeof getOrCreateUserApiKey>>) => ({
  apiKey: record.apiKey,
  dailyQuota: record.dailyQuota,
  requestsUsed: record.requestsUsed,
  remaining: Math.max(0, record.dailyQuota - record.requestsUsed),
  resetAt: record.resetAt ? record.resetAt.toISOString() : null,
  rotationLockedUntil: record.rotationLockedUntil ? record.rotationLockedUntil.toISOString() : null,
  updatedAt: record.updatedAt.toISOString(),
});

export async function GET() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const apiKey = await getOrCreateUserApiKey(sessionUser.id);
  return NextResponse.json(serialize(apiKey));
}

export async function POST(request: Request) {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    const body = await request.json();
    if (body && typeof body === "object") {
      payload = body as Record<string, unknown>;
    }
  } catch {
    /* ignore invalid JSON; fall back to defaults */
  }

  const actionRaw = payload.action;
  const action = typeof actionRaw === "string" ? actionRaw.trim().toLowerCase() : "rotate";

  if (action === "rotate") {
    try {
      const rotated = await rotateUserApiKey(sessionUser.id);
      return NextResponse.json(
        {
          message: "Nova chave de API gerada com sucesso.",
          ...serialize(rotated),
        },
        { status: 200 },
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível gerar uma nova chave agora.";
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  if (action === "set_custom") {
    const candidate = typeof payload.apiKey === "string" ? payload.apiKey : typeof payload.key === "string" ? payload.key : "";
    try {
      const updated = await setUserApiKey(sessionUser.id, candidate);
      return NextResponse.json(
        {
          message: "Chave personalizada aplicada com sucesso.",
          ...serialize(updated),
        },
        { status: 200 },
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Não foi possível atualizar a chave personalizada.";
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
}
