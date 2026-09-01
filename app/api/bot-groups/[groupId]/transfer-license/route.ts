import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotGroupError, transferGroupLicenseForUser } from "lib/bot-groups";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await context.params;
    const sourceGroupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(sourceGroupId) || sourceGroupId <= 0) {
      return NextResponse.json({ message: "Grupo de origem inválido." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const targetGroupId = Number.parseInt(String(record.targetGroupId ?? record.target_group_id ?? ""), 10);
    if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) {
      return NextResponse.json({ message: "Selecione o grupo que receberá a assinatura." }, { status: 400 });
    }

    const result = await transferGroupLicenseForUser(user.id, sourceGroupId, targetGroupId);
    return NextResponse.json({
      message: "Assinatura transferida com sucesso.",
      sourceGroup: result.sourceGroup,
      targetGroup: result.targetGroup,
    });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("[bot-groups/transfer-license] failed", error);
    return NextResponse.json(
      { message: "Não foi possível transferir a assinatura agora." },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
