import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotGroupError, listDiscoverableGroupsForInstance } from "lib/bot-groups";

type Context = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(resolvedParams.instanceId);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }

    const groups = await listDiscoverableGroupsForInstance(user.id, instanceId);
    return NextResponse.json({ groups });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to list discoverable groups", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os grupos da instância." },
      { status: 500 },
    );
  }
}
