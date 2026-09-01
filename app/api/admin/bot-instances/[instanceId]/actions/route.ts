import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  getInstanceById,
  performInstanceAction,
} from "lib/bot-instances";
import type { BotInstanceAction } from "types/bot-instances";

type AdminInstanceActionRouteContext = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const resolveInstanceId = async (
  context: AdminInstanceActionRouteContext,
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
  request: Request,
  context: AdminInstanceActionRouteContext,
) {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const instance = await getInstanceById(instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { action } = body as Record<string, unknown>;
    if (typeof action !== "string") {
      return NextResponse.json({ message: "Informe a ação desejada." }, { status: 400 });
    }

    const normalizedAction = action.trim().toLowerCase() as BotInstanceAction;
    const allowedActions: BotInstanceAction[] = ["connect", "logout", "restart"];
    if (!allowedActions.includes(normalizedAction)) {
      return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
    }

    await performInstanceAction(instance.userId, instanceId, normalizedAction);

    return NextResponse.json({ message: "Ação executada com sucesso." });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to execute admin instance action", error);
    return NextResponse.json(
      { message: "Não foi possível executar a ação solicitada." },
      { status: 500 },
    );
  }
}
