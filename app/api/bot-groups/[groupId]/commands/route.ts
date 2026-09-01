import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { upsertGroupSettings } from "lib/bot-group-settings";

// Lista de toggles válidos (espelha BotGroupCommandToggles)
const COMMAND_TOGGLE_KEYS = new Set([
  "autoresposta",
  "botinterage",
  "vozbotinterage",
  "ouviraudiobotinterage",
  "lerimagem",
  "autosticker",
  "autodownloader",
  "bemvindo",
  "despedida",
  "antisticker",
  "antimage",
  "antvideo",
  "antaudio",
  "antdoc",
  "antvcard",
  // Legados (são armazenados, mesmo que não usados nessa UI nova)
  "moderacaocomia",
  "antilink",
  "antilinkgp",
  "antipalavras",
  "banextremo",
  "bangringos",
  "antinsfwimagem",
  "proibirnsfw",
  "soadm",
  "brincadeiras",
  "linkmembro",
]);

export async function PATCH(
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

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const command = typeof body.command === "string" ? body.command.trim() : "";
    const value =
      body.value === true || body.value === "true" || body.value === 1 || body.value === "1";

    if (!COMMAND_TOGGLE_KEYS.has(command)) {
      return NextResponse.json({ message: "Comando inválido." }, { status: 400 });
    }

    const settings = await upsertGroupSettings(groupId, {
      commandToggles: { [command]: value } as Record<string, boolean>,
    });

    return NextResponse.json({
      message: "Toggle atualizado com sucesso.",
      toggles: settings.commandToggles,
    });
  } catch (error) {
    console.error("Failed to toggle bot group command", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as ativações do grupo." },
      { status: 500 },
    );
  }
}
