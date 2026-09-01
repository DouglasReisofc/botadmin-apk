import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotGroupError,
  getGroupAccessForUser,
  removeGroupPhotoForUser,
  updateGroupPhotoForUser,
} from "lib/bot-groups";

export async function POST(
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

    const formData = await request.formData();
    const file = formData.get("photo") ?? formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Selecione uma imagem válida." }, { status: 400 });
    }

    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }
    const group = await updateGroupPhotoForUser(access.ownerUserId, groupId, file);
    return NextResponse.json({
      message: "Foto do grupo atualizada com sucesso.",
      group: access.isShared ? { ...group, accessRole: "shared_admin" } : group,
    });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to update group photo", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a foto do grupo." },
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

    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }
    const group = await removeGroupPhotoForUser(access.ownerUserId, groupId);
    return NextResponse.json({
      message: "Foto do grupo removida com sucesso.",
      group: access.isShared ? { ...group, accessRole: "shared_admin" } : group,
    });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to remove group photo", error);
    return NextResponse.json(
      { message: "Não foi possível remover a foto do grupo." },
      { status: 500 },
    );
  }
}
