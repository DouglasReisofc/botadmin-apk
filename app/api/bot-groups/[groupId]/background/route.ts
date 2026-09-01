import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotGroupError,
  removeGroupMenuBackgroundForUser,
  updateGroupMenuBackgroundForUser,
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
    const file = formData.get("background") ?? formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Selecione uma imagem válida." }, { status: 400 });
    }

    const group = await updateGroupMenuBackgroundForUser(user.id, groupId, file);
    return NextResponse.json({
      message: "Fundo do menu atualizado com sucesso.",
      group,
    });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to update group menu background", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o fundo do menu." },
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

    const group = await removeGroupMenuBackgroundForUser(user.id, groupId);
    return NextResponse.json({
      message: "Fundo do menu removido com sucesso.",
      group,
    });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to remove group menu background", error);
    return NextResponse.json(
      { message: "Não foi possível remover o fundo do menu." },
      { status: 500 },
    );
  }
}
