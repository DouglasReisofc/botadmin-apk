import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createInternalGroup, InternalGroupError, listInternalGroupsForUser } from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";
import { getPublicAppBaseUrl } from "lib/meta";
import { SubscriptionPlanError } from "lib/plans";

export const dynamic = "force-dynamic";

const errorResponse = (error: unknown) => {
  if (error instanceof InternalGroupError || error instanceof SubscriptionPlanError) {
    return NextResponse.json(
      { message: error.message, code: error instanceof InternalGroupError ? error.code : "PLAN_REQUIRED" },
      { status: error.status },
    );
  }
  console.error("[internal-groups] request failed", error);
  return NextResponse.json({ message: "Não foi possível concluir a operação." }, { status: 500 });
};

const publicInviteUrl = (raw: unknown) => {
  const fallback = getPublicAppBaseUrl();
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
    // A stored development URL is absolute, so URL(value, fallback) would
    // keep localhost. Rebuild it from the path/query against the public host.
    const relative = parsed && parsed.protocol !== "localhost:" && parsed.pathname
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : value.replace(/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?/i, "");
    return new URL(relative.startsWith("/") ? relative : `/${relative}`, fallback).toString();
  }
  return parsed.toString();
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groups = await listInternalGroupsForUser(user.id);
    return NextResponse.json({
      groups: groups.map((group) => ({ ...group, inviteUrl: publicInviteUrl(group.inviteUrl) })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = await createInternalGroup(user.id, body ?? {});
    emitInternalGroupEvent({
      groupId: result.group.id,
      actorUserId: user.id,
      targetUserId: user.id,
      action: "join",
      type: "member.updated",
    });
    return NextResponse.json({
      ...result,
      inviteUrl: publicInviteUrl(result.inviteUrl),
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
