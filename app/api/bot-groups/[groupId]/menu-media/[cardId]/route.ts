import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupAccessForUser } from "lib/bot-groups";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import { deleteUploadedFile, saveUploadedFile } from "lib/uploads";
import type { BotGroupMenuCardKind } from "types/bot-groups";

const CARD_IDS = new Set<BotGroupMenuCardKind>([
  "main",
  "admin",
  "downloads",
  "fun",
]);

const resolveContext = async (
  rawGroupId: string,
  rawCardId: string,
) => {
  const user = await getCurrentUser();
  if (!user) {
    return {
      error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }),
    };
  }
  const groupId = Number.parseInt(rawGroupId, 10);
  const cardId = rawCardId.trim().toLowerCase() as BotGroupMenuCardKind;
  if (!Number.isFinite(groupId) || groupId <= 0 || !CARD_IDS.has(cardId)) {
    return {
      error: NextResponse.json(
        { message: "Grupo ou card inválido." },
        { status: 400 },
      ),
    };
  }
  const access = await getGroupAccessForUser(user.id, groupId);
  if (!access) {
    return {
      error: NextResponse.json(
        { message: "Grupo não encontrado." },
        { status: 404 },
      ),
    };
  }
  return { groupId, cardId };
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string; cardId: string }> },
) {
  const params = await context.params;
  const resolved = await resolveContext(params.groupId, params.cardId);
  if ("error" in resolved) {
    return resolved.error;
  }

  try {
    const formData = await request.formData();
    const file = formData.get("media") ?? formData.get("image");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json(
        { message: "Selecione uma imagem válida." },
        { status: 400 },
      );
    }

    const settings = await getGroupSettings(resolved.groupId);
    const currentCard = settings.menuCarousel.cards.find(
      (card) => card.kind === resolved.cardId,
    );
    const previousPath = currentCard?.imagePath ?? null;
    const storedPath = await saveUploadedFile(
      file,
      `bot-groups/${resolved.groupId}/menus`,
      {
        fixedFileName: `menu-${resolved.cardId}`,
        convertToWebp: true,
      },
    );
    const cards = settings.menuCarousel.cards.map((card) =>
      card.kind === resolved.cardId
        ? { ...card, imagePath: storedPath, imageUrl: null }
        : card,
    );
    const updated = await upsertGroupSettings(resolved.groupId, {
      menuCarousel: { cards },
    });
    if (previousPath && previousPath !== storedPath) {
      await deleteUploadedFile(previousPath).catch(() => undefined);
    }
    return NextResponse.json({
      message: "Imagem do menu atualizada.",
      settings: updated,
    });
  } catch (error) {
    console.error("Failed to upload menu card media", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a imagem do menu." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string; cardId: string }> },
) {
  const params = await context.params;
  const resolved = await resolveContext(params.groupId, params.cardId);
  if ("error" in resolved) {
    return resolved.error;
  }

  try {
    const settings = await getGroupSettings(resolved.groupId);
    const currentCard = settings.menuCarousel.cards.find(
      (card) => card.kind === resolved.cardId,
    );
    const cards = settings.menuCarousel.cards.map((card) =>
      card.kind === resolved.cardId
        ? { ...card, imagePath: null, imageUrl: null }
        : card,
    );
    const updated = await upsertGroupSettings(resolved.groupId, {
      menuCarousel: { cards },
    });
    if (currentCard?.imagePath) {
      await deleteUploadedFile(currentCard.imagePath).catch(() => undefined);
    }
    return NextResponse.json({
      message: "Imagem do menu removida.",
      settings: updated,
    });
  } catch (error) {
    console.error("Failed to delete menu card media", error);
    return NextResponse.json(
      { message: "Não foi possível remover a imagem do menu." },
      { status: 500 },
    );
  }
}
