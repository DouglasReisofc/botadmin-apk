import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { InternalGroupError, joinInternalGroupByToken } from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token : "";
    const result = await joinInternalGroupByToken(user.id, token);
    emitInternalGroupEvent({
      groupId: result.group.id,
      actorUserId: user.id,
      targetUserId: user.id,
      action: "join",
      type: "member.updated",
    });
    for (const messageId of [result.systemMessageId, ...result.automationMessageIds]) {
      if (messageId) {
        emitInternalGroupEvent({
          groupId: result.group.id,
          actorUserId: user.id,
          type: "message.created",
          messageId,
        });
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InternalGroupError) {
      return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
    }
    console.error("[internal-groups] join failed", error);
    return NextResponse.json({ message: "Não foi possível entrar no grupo." }, { status: 500 });
  }
}
