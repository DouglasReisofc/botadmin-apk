import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupAccessForUser } from "lib/bot-groups";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import { deleteUploadedFile, saveUploadedFile } from "lib/uploads";

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

    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("media") ?? formData.get("file") ?? formData.get("upload");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Selecione um arquivo válido." }, { status: 400 });
    }

    const currentSettings = await getGroupSettings(groupId);
    const previousPath = currentSettings.farewellConfig.mediaPath ?? null;

    const storedPath = await saveUploadedFile(file, `bot-groups/${groupId}/farewell`, {
      fixedFileName: "farewell-media",
      convertToWebp: false,
    });

    const settings = await upsertGroupSettings(groupId, {
      farewellConfig: {
        mediaPath: storedPath,
        mediaUrl: null,
      },
    });

    if (previousPath && previousPath !== storedPath) {
      await deleteUploadedFile(previousPath).catch(() => {});
    }

    return NextResponse.json({
      message: "Mídia de saída atualizada com sucesso.",
      settings,
    });
  } catch (error) {
    console.error("Failed to upload farewell media", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a mídia de saída." },
      { status: 500 },
    );
  }
}
