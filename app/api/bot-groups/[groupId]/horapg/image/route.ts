import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import { saveUploadedFile } from "lib/uploads";

const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024;

const ensureAuthorizedGroup = async (groupId: number) => {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  }

  const group = await getGroupByIdForUser(user.id, groupId);
  if (!group) {
    return { error: NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 }) };
  }

  return { userId: user.id, group };
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const { groupId: rawGroupId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  const auth = await ensureAuthorizedGroup(groupId);
  if ("error" in auth) {
    return auth.error;
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image") ?? formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Selecione uma imagem válida." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ message: "Envie um arquivo de imagem." }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json(
        { message: "A imagem deve ter no máximo 3MB." },
        { status: 413 },
      );
    }

    const storedPath = await saveUploadedFile(file, `bot-groups/${groupId}/horapg`, {
      fixedFileName: "horapg-image",
      convertToWebp: true,
    });

    const updated = await upsertGroupSettings(groupId, {
      horapgConfig: {
        imagePath: storedPath,
        imageUrl: null,
      },
    });

    return NextResponse.json({
      message: "Imagem atualizada com sucesso.",
      config: updated.horapgConfig,
    });
  } catch (error) {
    console.error("Failed to upload horapg image", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a imagem agora." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const { groupId: rawGroupId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  const auth = await ensureAuthorizedGroup(groupId);
  if ("error" in auth) {
    return auth.error;
  }

  try {
    const settings = await getGroupSettings(groupId);
    if (!settings.horapgConfig.imagePath && !settings.horapgConfig.imageUrl) {
      return NextResponse.json({
        message: "Nenhuma imagem personalizada está configurada.",
      });
    }

    const updated = await upsertGroupSettings(groupId, {
      horapgConfig: { imagePath: null },
    });

    return NextResponse.json({
      message: "Imagem personalizada removida com sucesso.",
      config: updated.horapgConfig,
    });
  } catch (error) {
    console.error("Failed to remove horapg image", error);
    return NextResponse.json(
      { message: "Não foi possível remover a imagem agora." },
      { status: 500 },
    );
  }
}

