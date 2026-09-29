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
import { deleteMessageForEveryone, sendMediaMessage, sendTextMessage } from "lib/wuzapi";
import { normalizeJid } from "lib/whatsapp";
import { deleteWhatsappConversationMessageForUser } from "lib/whatsapp-conversations";

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

const renderWinnerMessage = (
  template: string,
  winner: { jid: string; displayName: string | null },
  sweepstake: { question: string; participants: unknown[] },
  winnersCount: number,
): string => {
  const phone = normalizeJid(winner.jid);
  const pushname = winner.displayName?.trim() || phone || "participante";
  return template
    .replace(/\{\{\s*pushname\s*\}\}/gi, pushname)
    .replace(/\{\{\s*numero\s*\}\}/gi, phone)
    .replace(/\{\{\s*jid\s*\}\}/gi, winner.jid)
    .replace(/\{\{\s*premio\s*\}\}/gi, sweepstake.question)
    .replace(/\{\{\s*participantes\s*\}\}/gi, String(sweepstake.participants.length))
    .replace(/\{\{\s*ganhadores\s*\}\}/gi, String(winnersCount))
    .trim();
};

const resolveWinnerMediaUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://botadmin.shop/${raw.replace(/^\/+/, "")}`;
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

  const botPhone = String(instance.phone || "").replace(/\D+/g, "");
  const eligibleParticipants = sweepstake.participants.filter((participant) =>
    !botPhone || normalizeJid(participant.jid).replace(/\D+/g, "") !== botPhone,
  );
  const winners = pickSweepstakeWinners(eligibleParticipants, sweepstake.winnersCount);
  const concludedAt = new Date();
  const metadataRecord = sweepstake.metadata && typeof sweepstake.metadata === "object"
    ? sweepstake.metadata as Record<string, unknown>
    : {};

  if (notify && instance.serverBaseUrl && instance.token) {
    const configuredTemplate = typeof metadataRecord.winnerMessageTemplate === "string"
      ? metadataRecord.winnerMessageTemplate.trim()
      : "";
    // A winner template/media is only meaningful when there is a winner. The
    // zero-participant result is always a plain text status, never a winner
    // card/image with an empty announcement.
    const announcement = winners.length > 0
      ? configuredTemplate
        ? {
            body: winners.map((winner) => renderWinnerMessage(configuredTemplate, winner, sweepstake, winners.length)).join("\n\n"),
            mentions: winners.map((winner) => winner.jid).filter((jid) => /@(s\.whatsapp\.net|c\.us)$/i.test(jid)),
          }
        : buildSweepstakeAnnouncement(sweepstake, winners)
      : buildSweepstakeAnnouncement(sweepstake, []);
    const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
    const winnerMediaUrl = resolveWinnerMediaUrl(metadataRecord.winnerMediaUrl);
    try {
      if (winnerMediaUrl && winners.length > 0) {
        await sendMediaMessage(client, {
          to: sweepstake.groupJid,
          media: winnerMediaUrl,
          mediaType: "image",
          mimeType: "image/png",
          filename: "parabens-voce-venceu.png",
          caption: announcement.body,
          mentions: announcement.mentions,
          useExternalUrl: true,
        });
      } else {
        await sendTextMessage(client, {
          to: sweepstake.groupJid,
          body: announcement.body,
          mentions: announcement.mentions,
        });
      }
    } catch (error) {
      console.error("Failed to announce sweepstake result via panel", { sweepstakeId, error });
    }
  }

  // The poll is only an interaction surface. Once the draw is closed, remove
  // it from WhatsApp and from the BotAdmin conversation so only the result
  // announcement remains visible.
  if (instance.serverBaseUrl && instance.token && sweepstake.pollMessageId) {
    try {
      await deleteMessageForEveryone(
        { baseUrl: instance.serverBaseUrl, token: instance.token },
        {
          chatId: sweepstake.groupJid,
          messageId: sweepstake.pollMessageId,
          participant: instance.phone ? `${normalizeJid(instance.phone)}@s.whatsapp.net` : undefined,
          fromMe: true,
        },
      );
    } catch (error) {
      console.warn("Failed to delete finished sweepstake poll from WhatsApp", { sweepstakeId, error });
    }
  }
  await deleteWhatsappConversationMessageForUser(
    user.id,
    instance.id,
    sweepstake.groupJid,
    sweepstake.pollMessageId,
  ).catch((error) => {
    console.warn("Failed to delete finished sweepstake poll from BotAdmin chat", { sweepstakeId, error });
  });

  const existingMetadata = { ...metadataRecord };

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
