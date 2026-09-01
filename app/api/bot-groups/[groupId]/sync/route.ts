import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser, BotGroupError } from "lib/bot-groups";
import { syncGroupInfo } from "lib/bot-groups";

const truthyParam = (value: string | null): boolean => {
  if (!value) return false;
  return ["1", "true", "yes", "sim", "on"].includes(value.trim().toLowerCase());
};

export async function POST(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await context.params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const force = truthyParam(req.nextUrl.searchParams.get("force"));
    await syncGroupInfo(
      user.id,
      groupId,
      force
        ? { force: true, minAttemptIntervalMs: 30_000 }
        : { maxAgeMs: 30 * 60_000, minAttemptIntervalMs: 10 * 60_000 },
    );
    const group = await getGroupByIdForUser(user.id, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ message: "Sincronizado.", group });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }
    console.error("[api] Failed to sync group info", error);
    return NextResponse.json({ message: "Falha ao sincronizar informações do grupo." }, { status: 502 });
  }
}

export const GET = POST;
