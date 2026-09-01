import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteInternalGroupMessage, InternalGroupError, setInternalGroupMessagePinned } from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";
import { deleteUploadedFile } from "lib/uploads";

type Context = { params: Promise<{ groupId: string; messageId: string }> };

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const params = await context.params;
    const groupId = Number(params.groupId);
    const messageId = Number(params.messageId);
    const result = await deleteInternalGroupMessage(groupId, messageId, user.id);
    if (result.mediaPath) await deleteUploadedFile(result.mediaPath).catch(() => {});
    emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.deleted", messageId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InternalGroupError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error("[internal-groups] delete message failed", error);
    return NextResponse.json({ message: "Não foi possível apagar a mensagem." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const params = await context.params;
    const groupId = Number(params.groupId);
    const messageId = Number(params.messageId);
    const body = await request.json().catch(() => ({}));
    const result = await setInternalGroupMessagePinned(groupId, messageId, user.id, body?.pinned === true);
    emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.pinned", messageId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InternalGroupError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Não foi possível fixar a mensagem." }, { status: 500 });
  }
}
