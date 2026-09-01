import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  deleteDisconnectedInstanceForUser,
  getInstanceById,
} from "lib/bot-instances";

type AdminInstancePurgeRouteContext = {
  params: Promise<{ instanceId: string }> | { instanceId: string };
};

const resolveInstanceId = async (
  context: AdminInstancePurgeRouteContext,
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
  context: AdminInstancePurgeRouteContext,
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

    const cleanup = await deleteDisconnectedInstanceForUser(instance.userId, instanceId);

    return NextResponse.json({
      message:
        "Instância removida do painel e do servidor. O perfil do usuário foi preservado para reconexão.",
      cleanup,
      instanceId,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to purge bot instance session (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível limpar a sessão da instância." },
      { status: 500 },
    );
  }
}