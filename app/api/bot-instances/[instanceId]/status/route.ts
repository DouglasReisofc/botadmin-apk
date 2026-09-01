import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  refreshInstanceStatus,
} from "lib/bot-instances";

type StatusRouteContext = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const resolveInstanceId = async (
  context: StatusRouteContext,
  request: Request,
): Promise<number | null> => {
  const tryParse = (value?: string | null) => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const params = await Promise.resolve(context.params);
  const direct = tryParse(params?.instanceId);
  if (direct !== null) {
    return direct;
  }

  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const idx = path.lastIndexOf("bot-instances");
    if (idx >= 0 && path[idx + 1]) {
      const parsed = tryParse(path[idx + 1]);
      if (parsed !== null) {
        return parsed;
      }
    }
  } catch {
    return null;
  }

  return null;
};

export async function GET(
  request: Request,
  context: StatusRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const status = await refreshInstanceStatus(user.id, instanceId);
    return NextResponse.json({ status });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to refresh bot instance status", error);
    return NextResponse.json(
      { message: "Não foi possível obter o status da instância." },
      { status: 500 },
    );
  }
}
