import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInternalGroupForUser, InternalGroupError, runInternalGroupConversationAction, updateInternalGroup } from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";
import { SubscriptionPlanError } from "lib/plans";
import { deleteUploadedFile } from "lib/uploads";
import { getPublicAppBaseUrl } from "lib/meta";

type Context = { params: Promise<{ groupId: string }> };
const idFrom = async (context: Context) => Number((await context.params).groupId);
const failure = (error: unknown) => {
  if (error instanceof InternalGroupError || error instanceof SubscriptionPlanError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  console.error("[internal-groups] group request failed", error);
  return NextResponse.json({ message: "Não foi possível carregar o grupo." }, { status: 500 });
};

const publicInviteUrl = (raw: unknown) => {
  const value = typeof raw === "string" ? raw.trim() : "";
  let parsed: URL | null = null;
  try {
    parsed = value ? new URL(value) : null;
  } catch {
    parsed = null;
  }
  const host = parsed?.hostname?.toLowerCase();
  const isSafeHttp = parsed &&
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    Boolean(parsed.hostname) &&
    host !== "localhost" &&
    host !== "127.0.0.1" &&
    host !== "0.0.0.0" &&
    host !== "::1";
  if (!isSafeHttp) {
    if (!value) return null;
    const relative = parsed && parsed.protocol !== "localhost:" && parsed.pathname
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : value.replace(/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?/i, "");
    const path = relative.startsWith("/") ? relative : `/${relative}`;
    return new URL(path, getPublicAppBaseUrl()).toString();
  }
  return parsed.toString();
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const result = await getInternalGroupForUser(await idFrom(context), user.id);
    return NextResponse.json({
      ...result,
      group: { ...result.group, inviteUrl: publicInviteUrl(result.group.inviteUrl) },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = await idFrom(context);
    const body = await request.json().catch(() => ({}));
    if (typeof body?.action === "string") {
      const result = await runInternalGroupConversationAction(
        groupId,
        user.id,
        body.action,
        body ?? {},
      );
      if (result.action === "clear") {
        emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "messages.cleared" });
      } else if (result.action === "delete") {
        const cleanupPaths = "cleanupPaths" in result && Array.isArray(result.cleanupPaths)
          ? result.cleanupPaths
          : [];
        for (const storedPath of cleanupPaths) {
          if (typeof storedPath === "string" && storedPath) {
            await deleteUploadedFile(storedPath).catch(() => {});
          }
        }
        emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "group.deleted" });
      } else if (result.action === "leave" || result.action === "transfer-and-leave") {
        emitInternalGroupEvent({
          groupId,
          actorUserId: user.id,
          targetUserId: user.id,
          action: "leave",
          type: "member.updated",
        });
        emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "group.updated" });
      } else {
        emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "group.updated" });
      }
      const systemMessageIds = "systemMessageIds" in result && Array.isArray(result.systemMessageIds)
        ? result.systemMessageIds
        : [];
      const automationMessageIds = "automationMessageIds" in result && Array.isArray(result.automationMessageIds)
        ? result.automationMessageIds
        : [];
      for (const messageId of [...systemMessageIds, ...automationMessageIds]) {
        emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId });
      }
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await updateInternalGroup(groupId, user.id, body ?? {});
    emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "group.updated" });
    for (const messageId of result.systemMessageIds) {
      emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId });
    }
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}
