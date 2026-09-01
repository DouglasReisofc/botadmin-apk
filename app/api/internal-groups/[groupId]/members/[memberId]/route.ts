import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { InternalGroupError, updateInternalGroupMember } from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";
import { SubscriptionPlanError } from "lib/plans";

type Context = { params: Promise<{ groupId: string; memberId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const params = await context.params;
    const groupId = Number(params.groupId);
    const memberId = Number(params.memberId);
    const body = await request.json().catch(() => ({}));
    const action = body?.action as "promote" | "demote" | "remove" | "ban" | "leave";
    if (!["promote", "demote", "remove", "ban", "leave"].includes(action)) {
      return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
    }
    const result = await updateInternalGroupMember(groupId, user.id, memberId, action);
    emitInternalGroupEvent({
      groupId,
      actorUserId: user.id,
      targetUserId: memberId,
      action,
      type: "member.updated",
    });
    for (const messageId of [...result.systemMessageIds, ...result.automationMessageIds]) {
      emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InternalGroupError || error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[internal-groups] member action failed", error);
    return NextResponse.json({ message: "Não foi possível atualizar o membro." }, { status: 500 });
  }
}
