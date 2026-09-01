import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  InternalGroupError,
  openInternalGroupViewOnce,
  runInternalGroupMessageAction,
} from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";

type Context = {
  params: Promise<{ groupId: string; messageId: string }>;
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const params = await context.params;
    const groupId = Number(params.groupId);
    const messageId = Number(params.messageId);
    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";
    if (action === "open_view_once") {
      return NextResponse.json({
        ok: true,
        ...(await openInternalGroupViewOnce(groupId, messageId, user.id)),
      });
    }
    const result = await runInternalGroupMessageAction(
      groupId,
      messageId,
      user.id,
      action,
      body ?? {},
    );
    emitInternalGroupEvent({
      groupId,
      actorUserId: user.id,
      type: "message.created",
      messageId: typeof result.messageId === "number" ? result.messageId : messageId,
    });
    const botMessageIds = Array.isArray((result as any)?.botMessageIds)
      ? (result as any).botMessageIds
      : [];
    for (const botMessageId of botMessageIds) {
      if (typeof botMessageId !== "number" || botMessageId <= 0) continue;
      emitInternalGroupEvent({
        groupId,
        actorUserId: user.id,
        type: "message.created",
        messageId: botMessageId,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof InternalGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[internal-groups] message action failed", error);
    return NextResponse.json({ message: "Não foi possível executar a ação." }, { status: 500 });
  }
}
