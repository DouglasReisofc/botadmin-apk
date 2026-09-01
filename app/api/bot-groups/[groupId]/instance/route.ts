import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotGroupError, linkGroupToInstanceForUser } from "lib/bot-groups";

type GroupInstanceContext = { params: Promise<{ groupId: string }> | { groupId: string } };

const resolveGroupId = async (context: GroupInstanceContext, request: Request): Promise<number | null> => {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const params = await Promise.resolve(context.params);
  const direct = parse(params?.groupId);
  if (direct !== null) return direct;

  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const idx = path.lastIndexOf("bot-groups");
    if (idx >= 0 && path[idx + 1]) {
      return parse(path[idx + 1]);
    }
  } catch {
    return null;
  }

  return null;
};

export async function PATCH(request: Request, context: GroupInstanceContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const groupId = await resolveGroupId(context, request);
    if (!groupId) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { instanceId } = body as Record<string, unknown>;
    if (instanceId === undefined) {
      return NextResponse.json({ message: "Informe a instância de destino." }, { status: 400 });
    }

    const updated = await linkGroupToInstanceForUser(user.id, groupId, Number(instanceId));
    return NextResponse.json({ message: "Grupo vinculado com sucesso.", group: updated });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }
    console.error("Failed to link group to instance", error);
    return NextResponse.json(
      { message: "Não foi possível vincular o grupo à instância." },
      { status: 500 },
    );
  }
}
