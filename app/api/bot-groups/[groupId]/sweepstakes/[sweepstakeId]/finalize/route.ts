import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import {
  buildSweepstakeAnnouncement,
  finalizeSweepstake,
  getSweepstakeForGroup,
  listSweepstakesForGroup,
  pickSweepstakeWinners,
} from "lib/bot-sweepstakes";
import { sendTextMessage } from "lib/wuzapi";

const shouldNotify = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (value === null) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "não", "nao", "off"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "yes", "sim", "on"].includes(normalized)) {
      return true;
    }
  }
  return true;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string; sweepstakeId: string }> },
) {
  const { groupId: rawGroupId, sweepstakeId: rawSweepstakeId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  const sweepstakeId = Number.parseInt(rawSweepstakeId, 10);

  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  if (!Number.isFinite(sweepstakeId) || sweepstakeId <= 0) {
    return NextResponse.json({ message: "Sorteio inválido." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const group = await getGroupByIdForUser(user.id, groupId);
  if (!group) {
    return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
  }

  if (!group.remoteId) {
    return NextResponse.json({ message: "Sincronize o grupo com o WhatsApp antes de finalizar sorteios." }, { status: 409 });
  }

  const instance = await getInstanceForUser(user.id, group.instanceId);
  if (!instance) {
    return NextResponse.json({ message: "Instância vinculada ao grupo não encontrada." }, { status: 404 });
  }

  const sweepstake = await getSweepstakeForGroup(instance.id, group.remoteId, sweepstakeId);
  if (!sweepstake) {
    return NextResponse.json({ message: "Sorteio não encontrado." }, { status: 404 });
  }

  if (sweepstake.status !== "active") {
    return NextResponse.json({ message: "Este sorteio já foi encerrado." }, { status: 409 });
  }

  let notify = true;
  try {
    const body = await request.json();
    if (body && typeof body === "object") {
      notify = shouldNotify((body as Record<string, unknown>).notify ?? (body as Record<string, unknown>).announce);
    }
  } catch {
    // Ignora corpo ausente ou inválido e utiliza padrão notify = true
  }

  const winners = pickSweepstakeWinners(sweepstake.participants, sweepstake.winnersCount);
  const concludedAt = new Date();

  if (notify && instance.serverBaseUrl && instance.token) {
    const announcement = buildSweepstakeAnnouncement(sweepstake, winners);
    try {
      await sendTextMessage(
        { baseUrl: instance.serverBaseUrl, token: instance.token },
        {
          to: sweepstake.groupJid,
          body: announcement.body,
          mentions: announcement.mentions,
        },
      );
    } catch (error) {
      console.error("Failed to announce sweepstake result via panel", { sweepstakeId, error });
    }
  }

  const existingMetadata = (sweepstake.metadata && typeof sweepstake.metadata === "object")
    ? { ...sweepstake.metadata }
    : {};

  const metadata = {
    ...existingMetadata,
    participantsCount: sweepstake.participants.length,
    winnersCount: winners.length,
    finalizedBy: `user:${user.id}`,
    finalizedAt: concludedAt.toISOString(),
    announcedViaPanel: notify,
  };

  await finalizeSweepstake(sweepstake.id, {
    status: "completed",
    winners,
    concludedAt,
    metadata,
  });

  try {
    const list = await listSweepstakesForGroup(instance.id, sweepstake.groupJid);
    return NextResponse.json({
      message: "Sorteio finalizado com sucesso.",
      active: list.active,
      history: list.history,
    });
  } catch (error) {
    console.error("Failed to refresh sweepstakes after finalize", { sweepstakeId, error });
    return NextResponse.json(
      { message: "Sorteio finalizado, mas houve falha ao atualizar a lista." },
      { status: 207 },
    );
  }
}
