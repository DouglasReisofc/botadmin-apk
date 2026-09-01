import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { clearGroupActivityEntries, listGroupActivityEntries } from "lib/bot-group-activity";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await context.params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const group = await getGroupByIdForUser(user.id, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 80;

    const entries = await listGroupActivityEntries({
      groupId: group.id,
      groupRemoteId: group.remoteId,
      limit,
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Failed to load group activity entries", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o histórico de ações." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await context.params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const group = await getGroupByIdForUser(user.id, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    const removed = await clearGroupActivityEntries({
      groupId: group.id,
      groupRemoteId: group.remoteId,
    });

    return NextResponse.json({ removed });
  } catch (error) {
    console.error("Failed to clear group activity entries", error);
    return NextResponse.json(
      { message: "Não foi possível limpar o histórico do grupo." },
      { status: 500 },
    );
  }
}
