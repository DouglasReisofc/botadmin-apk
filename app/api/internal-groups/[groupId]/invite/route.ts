import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { InternalGroupError, rotateInternalGroupInvite } from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";
import { getPublicAppBaseUrl } from "lib/meta";
import { SubscriptionPlanError } from "lib/plans";

type Context = { params: Promise<{ groupId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const result = await rotateInternalGroupInvite(groupId, user.id);
    emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "group.updated" });
    for (const messageId of result.systemMessageIds) {
      emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId });
    }
    const rawInviteUrl = result.inviteUrl?.trim() || "";
    let parsedInviteUrl: URL | null = null;
    try {
      parsedInviteUrl = rawInviteUrl ? new URL(rawInviteUrl) : null;
    } catch {
      parsedInviteUrl = null;
    }
    const host = parsedInviteUrl?.hostname?.toLowerCase();
    let inviteUrl: string;
    const isSafeHttp = parsedInviteUrl &&
      (parsedInviteUrl.protocol === "http:" || parsedInviteUrl.protocol === "https:") &&
      Boolean(parsedInviteUrl.hostname) &&
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      host !== "0.0.0.0" &&
      host !== "::1";
    if (!isSafeHttp) {
      const relative = parsedInviteUrl && parsedInviteUrl.protocol !== "localhost:" && parsedInviteUrl.pathname
        ? `${parsedInviteUrl.pathname}${parsedInviteUrl.search}${parsedInviteUrl.hash}`
        : rawInviteUrl.replace(/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?/i, "");
      const path = relative.startsWith("/") ? relative : `/${relative}`;
      inviteUrl = new URL(path, getPublicAppBaseUrl()).toString();
    } else {
      inviteUrl = parsedInviteUrl.toString();
    }
    return NextResponse.json({ ...result, inviteUrl });
  } catch (error) {
    if (error instanceof InternalGroupError || error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[internal-groups] invite rotation failed", error);
    return NextResponse.json({ message: "Não foi possível gerar o convite." }, { status: 500 });
  }
}
