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
  renderSweepstakeWinnerMessage,
} from "lib/bot-sweepstakes";
import { resolveWhatsappLidProfiles, resolveWhatsappLidsToPhones, sendMediaMessage, sendTextMessage } from "lib/wuzapi";
import { normalizeJid } from "lib/whatsapp";
import { cleanupSweepstakePoll } from "lib/sweepstake-poll-cleanup";

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

  // WhatsApp may report poll voters with a LID. Resolve it before building the
  // announcement so both the visible @mention and the persisted winner use a
  // readable phone JID.
  const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
  const lidWinners = winners.filter((winner) =>
    winner.jid.toLowerCase().endsWith("@lid") || /^\d{14,}$/.test(winner.jid),
  );
  const lidPhones = lidWinners.length && client.baseUrl && client.token
    ? await resolveWhatsappLidsToPhones(client, lidWinners.map((winner) => winner.jid)).catch(() => new Map<string, string>())
    : new Map<string, string>();
  const lidProfiles = lidWinners.length && client.baseUrl && client.token
    ? await resolveWhatsappLidProfiles(client, lidWinners.map((winner) => winner.jid)).catch(() => new Map())
    : new Map();
  const resolvedWinners = winners.map((winner) => {
    const isLid = winner.jid.toLowerCase().endsWith("@lid") || /^\d{14,}$/.test(winner.jid);
    const key = normalizeJid(winner.jid);
    const phone = isLid ? lidPhones.get(key) ?? lidProfiles.get(key)?.phone ?? null : normalizeJid(winner.jid);
    const groupMember = (group.participants ?? []).find((member) =>
      [member.id, member.phone].some((value) =>
        typeof value === "string" && (value === winner.jid || (phone && normalizeJid(value) === phone)),
      ),
    );
    const memberPhone = groupMember?.phone && !/@lid$/i.test(groupMember.phone)
      ? normalizeJid(groupMember.phone)
      : phone;
    const displayName = [groupMember?.name, groupMember?.displayName, groupMember?.pushName, lidProfiles.get(key)?.name, winner.displayName]
      .find((value) => typeof value === "string" && value.trim() && !/@lid\b/i.test(value));
    return { ...winner, jid: memberPhone ? `${memberPhone}@s.whatsapp.net` : winner.jid, displayName: displayName?.trim() || null };
  });

  if (notify && instance.serverBaseUrl && instance.token) {
    const configuredTemplate = typeof metadataRecord.winnerMessageTemplate === "string"
      ? metadataRecord.winnerMessageTemplate.trim()
      : "";
    // A winner template/media is only meaningful when there is a winner. The
    // zero-participant result is always a plain text status, never a winner
    // card/image with an empty announcement.
    const announcement = resolvedWinners.length > 0
      ? configuredTemplate
        ? {
            body: resolvedWinners.map((winner) => renderSweepstakeWinnerMessage(configuredTemplate, winner, sweepstake, resolvedWinners.length)).join("\n\n"),
            mentions: resolvedWinners.map((winner) => winner.jid).filter((jid) => /@(s\.whatsapp\.net|c\.us)$/i.test(jid)),
          }
        : buildSweepstakeAnnouncement(sweepstake, resolvedWinners)
      : buildSweepstakeAnnouncement(sweepstake, []);
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
  let cleanupPending = false;
  await cleanupSweepstakePoll({ baseUrl: instance.serverBaseUrl, token: instance.token }, {
    userId: user.id, instanceId: instance.id, groupJid: sweepstake.groupJid,
    pollMessageId: sweepstake.pollMessageId, phone: instance.phone || "",
  }).catch((error) => { cleanupPending = true; console.warn("Sweepstake poll cleanup pending", { sweepstakeId, error }); });

  const existingMetadata = { ...metadataRecord };

  const metadata = {
    ...existingMetadata,
    participantsCount: sweepstake.participants.length,
    winnersCount: winners.length,
    finalizedBy: `user:${user.id}`,
    finalizedAt: concludedAt.toISOString(),
    announcedViaPanel: notify,
    cleanupPending,
  };

  await finalizeSweepstake(sweepstake.id, {
    status: "completed",
    winners: resolvedWinners,
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
