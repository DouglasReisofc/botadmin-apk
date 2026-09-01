import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupAccessForUser, getGroupByIdForUser, syncGroupInfo } from "lib/bot-groups";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const url = new URL(request.url);
    const refresh = url.searchParams.get("refresh");
    const forceRefresh = refresh === "1" || refresh === "true";

    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }
    const ownerUserId = access.ownerUserId;

    // The group list already persists participants. Return that snapshot
    // immediately when available; the previous implementation waited for a
    // remote group-info request before rendering the modal every time.
    let group = await getGroupByIdForUser(ownerUserId, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    if (forceRefresh || group.participants.length === 0) {
      await syncGroupInfo(
        ownerUserId,
        groupId,
        forceRefresh ? { force: true } : { maxAgeMs: 5 * 60_000 },
      ).catch(() => {});
      group = await getGroupByIdForUser(ownerUserId, groupId) ?? group;
    }

    const participants = Array.isArray(group.participants) ? group.participants : [];
    return NextResponse.json({ participants, refreshed: forceRefresh });
  } catch (error) {
    console.error("Failed to load group participants", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os participantes do grupo." },
      { status: 500 },
    );
  }
}
