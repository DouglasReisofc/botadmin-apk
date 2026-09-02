import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotGroupError,
  createGroupForUser,
  createGroupForUserFromRemoteId,
  listExternalLinkedGroupRemoteIdsForUser,
  listGroupsForUser,
} from "lib/bot-groups";
import { publishBotGroupRealtimeUpdate } from "lib/bot-group-realtime";
import { SubscriptionPlanError } from "lib/plans";

const collectRemoteIdsFromRequest = (request: Request) => {
  const url = new URL(request.url);
  const repeatedRemoteIds = url.searchParams.getAll("remoteId");
  const packedRemoteIds = (url.searchParams.get("remoteIds") ?? "")
    .split(/[\s,;]+/)
    .map((remoteId) => remoteId.trim())
    .filter(Boolean);

  return Array.from(new Set([...repeatedRemoteIds, ...packedRemoteIds].map((remoteId) => remoteId.trim()).filter(Boolean)))
    .slice(0, 200);
};

const getBotGroupErrorDetails = (details: unknown): Record<string, unknown> | null =>
  details && typeof details === "object" && !Array.isArray(details)
    ? details as Record<string, unknown>
    : null;

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const groups = await listGroupsForUser(user.id, { includeParticipants: false, includeShared: true });
    const remoteIds = collectRemoteIdsFromRequest(request);
    const externalLinks = remoteIds.length > 0
      ? await listExternalLinkedGroupRemoteIdsForUser(user.id, remoteIds)
      : [];
    return NextResponse.json({ groups, externalLinks });
  } catch (error) {
    console.error("Failed to list bot groups", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os grupos." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let currentUserId: number | null = null;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    currentUserId = user.id;

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { instanceId, invite, remoteId } = payload as {
      instanceId?: unknown;
      invite?: unknown;
      remoteId?: unknown;
    };

    const normalizedInstanceId = Number(instanceId);
    const hasRemoteId = typeof remoteId === "string" && remoteId.trim().length > 0;
    const group = hasRemoteId
      ? await createGroupForUserFromRemoteId(user.id, {
          instanceId: normalizedInstanceId,
          remoteId: remoteId.trim(),
        })
      : await createGroupForUser(user.id, {
          instanceId: normalizedInstanceId,
          invite: typeof invite === "string" ? invite : "",
        });

    void publishBotGroupRealtimeUpdate(
      [user.id],
      group,
      "bot.group.linked",
    );

    return NextResponse.json(
      {
        message: "Grupo vinculado com sucesso.",
        group,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BotGroupError) {
      const details = getBotGroupErrorDetails(error.details);
      const linkedToOtherUser =
        error.status === 409 &&
        details &&
        currentUserId !== null &&
        Number(details.userId) !== Number(currentUserId) &&
        typeof details.remoteId === "string" &&
        details.remoteId.trim().length > 0;

      return NextResponse.json(
        {
          message: linkedToOtherUser ? "Grupo já vinculado a outro usuário." : error.message,
          code: linkedToOtherUser ? "GROUP_LINKED_TO_OTHER_USER" : undefined,
          remoteId: linkedToOtherUser ? details.remoteId : undefined,
        },
        { status: error.status ?? 400 },
      );
    }

    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to create bot group", error);
    return NextResponse.json(
      { message: "Não foi possível vincular o grupo ao bot." },
      { status: 500 },
    );
  }
}
