import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteRecentInternalGroupParticipantMessages,
  InternalGroupError,
  updateInternalGroupMember,
} from "lib/internal-groups";
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
    const action = body?.action as "promote" | "demote" | "remove" | "remove_clean" | "ban" | "leave" | "delete_recent";
    if (!["promote", "demote", "remove", "remove_clean", "ban", "leave", "delete_recent"].includes(action)) {
      return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
    }
    if (action === "delete_recent" || action === "remove_clean") {
      const result = await deleteRecentInternalGroupParticipantMessages(
        groupId,
        user.id,
        memberId,
      );
      for (const messageId of result.messageIds) {
        emitInternalGroupEvent({
          groupId,
          actorUserId: user.id,
          type: "message.deleted",
          messageId,
        });
      }
      if (action === "remove_clean") {
        const memberResult = await updateInternalGroupMember(
          groupId,
          user.id,
          memberId,
          "remove",
        );
        for (const messageId of [
          ...memberResult.systemMessageIds,
          ...memberResult.automationMessageIds,
        ]) {
          emitInternalGroupEvent({
            groupId,
            actorUserId: user.id,
            type: "message.created",
            messageId,
          });
        }
      }
      return NextResponse.json({ ok: true, action, ...result });
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
