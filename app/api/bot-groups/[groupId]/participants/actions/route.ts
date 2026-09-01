import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { invalidateGroupSettingsCache } from "lib/bot-events/cache";
import { getGroupAccessForUser, getGroupByIdForUser, syncGroupInfo } from "lib/bot-groups";
import {
  getGroupSettings,
  registerGroupInfraction,
  resetGroupInfractions,
  upsertGroupSettings,
} from "lib/bot-group-settings";
import { BotInstanceError, getInstanceForUser, refreshInstanceStatus } from "lib/bot-instances";
import {
  addGroupParticipants,
  deleteMessageForEveryone,
  demoteGroupParticipant,
  promoteGroupParticipant,
  removeGroupParticipant,
} from "lib/wuzapi";
import {
  deleteWhatsappConversationMessageForUser,
  listWhatsappConversationMessages,
} from "lib/whatsapp-conversations";
import type { BotGroup, BotGroupParticipant } from "types/bot-groups";

type ParticipantAction = "add" | "promote" | "demote" | "remove" | "resetInfractions" | "warn" | "blacklist";

const normalizeAction = (value: unknown): ParticipantAction | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (normalized === "add" || normalized === "adicionar") return "add";
  if (normalized === "promote" || normalized === "promover") return "promote";
  if (normalized === "demote" || normalized === "rebaixar") return "demote";
  if (normalized === "remove" || normalized === "ban" || normalized === "banir" || normalized === "kick") {
    return "remove";
  }
  if (normalized === "warn" || normalized === "adv" || normalized === "advertir" || normalized === "advertencia" || normalized === "advertência") {
    return "warn";
  }
  if (normalized === "blacklist" || normalized === "addblacklist" || normalized === "adicionarblacklist" || normalized === "listanegra") {
    return "blacklist";
  }
  if (normalized === "resetinfractions" || normalized === "resetarinfrações" || normalized === "resetarinfracoes") {
    return "resetInfractions";
  }
  return null;
};

const digitsOnly = (value: string | null | undefined) => String(value ?? "").replace(/\D+/g, "");

const normalizeParticipantInput = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) return trimmed;
  const digits = digitsOnly(trimmed);
  return digits.length >= 5 ? `${digits}@s.whatsapp.net` : null;
};

const matchesDigits = (left: string | null | undefined, right: string | null | undefined) => {
  const leftDigits = digitsOnly(left);
  const rightDigits = digitsOnly(right);
  if (!leftDigits || !rightDigits) return false;
  return leftDigits === rightDigits || leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits);
};

const findParticipant = (group: BotGroup, participantJid: string): BotGroupParticipant | null =>
  (group.participants ?? []).find((participant) => matchesDigits(participant.id, participantJid)) ?? null;

const instanceHasAdminPermission = (group: BotGroup, instancePhone: string | null | undefined) => {
  const instanceDigits = digitsOnly(instancePhone);
  if (!instanceDigits) return true;
  if (matchesDigits(group.owner, instanceDigits)) return true;

  const participants = Array.isArray(group.participants) ? group.participants : [];
  if (participants.length === 0) return true;

  const hasKnownAdmin = participants.some((participant) => participant.admin && participant.admin !== "member");
  if (!hasKnownAdmin && !group.owner) return true;

  return participants.some((participant) => (
    participant.admin !== "member" && matchesDigits(participant.id, instanceDigits)
  ));
};

const addParticipantToBlacklist = async (groupId: number, participantJid: string) => {
  const digits = digitsOnly(participantJid);
  if (digits.length < 5) return false;

  const settings = await getGroupSettings(groupId);
  const current = Array.isArray(settings.blacklist) ? settings.blacklist : [];
  if (current.includes(digits)) return false;

  await upsertGroupSettings(groupId, {
    blacklist: Array.from(new Set([...current, digits])),
  });
  invalidateGroupSettingsCache(groupId);
  return true;
};

const deleteRecentParticipantMessages = async (options: {
  userId: number;
  instanceId: number;
  chatJid: string;
  participantJid: string;
  client: { baseUrl: string; token: string };
}) => {
  const messages = await listWhatsappConversationMessages(
    options.userId,
    options.instanceId,
    options.chatJid,
    { limit: 300 },
  );
  const participantDigits = digitsOnly(options.participantJid);
  const candidates = messages
    .filter((message) => (
      message.direction === "inbound" &&
      message.messageId &&
      participantDigits &&
      matchesDigits(message.senderJid, participantDigits)
    ))
    .slice(-10);

  const deleted: string[] = [];
  const failed: string[] = [];
  for (const message of candidates) {
    if (!message.messageId) continue;
    try {
      await deleteMessageForEveryone(options.client, {
        chatId: options.chatJid,
        messageId: message.messageId,
        participant: message.senderJid,
      });
      await deleteWhatsappConversationMessageForUser(
        options.userId,
        options.instanceId,
        options.chatJid,
        message.messageId,
      );
      deleted.push(message.messageId);
    } catch (error) {
      failed.push(message.messageId);
      console.warn("[participants-actions] falha ao apagar mensagem recente", {
        chatJid: options.chatJid,
        messageId: message.messageId,
        participant: options.participantJid,
        error,
      });
    }
  }

  return { deleted, failed };
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const action = normalizeAction((body as Record<string, unknown> | null)?.action);
    const participantJid = normalizeParticipantInput(
      (body as Record<string, unknown> | null)?.participantJid ??
        (body as Record<string, unknown> | null)?.participant ??
        (body as Record<string, unknown> | null)?.phone,
    );

    if (!action) {
      return NextResponse.json({ message: "Ação de participante inválida." }, { status: 400 });
    }
    if (!participantJid) {
      return NextResponse.json({ message: "Informe um participante válido." }, { status: 400 });
    }

    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }
    const ownerUserId = access.ownerUserId;
    const group = access.group;

    if (action === "resetInfractions") {
      if (group.status !== "active") {
        return NextResponse.json(
          { message: "Ative o robô no grupo antes de resetar infrações." },
          { status: 409 },
        );
      }
      await resetGroupInfractions(group.id, digitsOnly(participantJid) || participantJid);
      return NextResponse.json({ ok: true, action });
    }

    const removeAfterBlacklist = Boolean((body as Record<string, unknown> | null)?.removeAfterBlacklist);
    if (action === "blacklist" && !removeAfterBlacklist) {
      const added = await addParticipantToBlacklist(group.id, participantJid);
      return NextResponse.json({
        ok: true,
        action,
        message: added
          ? "Participante adicionado à blacklist."
          : "Participante já estava na blacklist.",
      });
    }

    if (!group.remoteId) {
      return NextResponse.json(
        { message: "Grupo ainda não está sincronizado. Tente novamente em instantes." },
        { status: 409 },
      );
    }

    const instance = await getInstanceForUser(ownerUserId, group.instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada para este grupo." }, { status: 404 });
    }
    if (!instance.serverBaseUrl) {
      return NextResponse.json({ message: "Servidor da instância não configurado." }, { status: 500 });
    }

    if (digitsOnly(instance.phone) && matchesDigits(instance.phone, participantJid)) {
      return NextResponse.json({ message: "Não é possível moderar o número da própria instância." }, { status: 400 });
    }

    if (!instanceHasAdminPermission(group, instance.phone)) {
      return NextResponse.json(
        { message: "A instância não é administradora deste grupo." },
        { status: 403 },
      );
    }

    const participant = findParticipant(group, participantJid);
    if (participant?.admin === "superadmin" && (action === "demote" || action === "remove" || (action === "blacklist" && removeAfterBlacklist))) {
      return NextResponse.json(
        { message: "O proprietário do grupo não pode ser removido, rebaixado ou removido via blacklist por aqui." },
        { status: 409 },
      );
    }

    const status = await refreshInstanceStatus(ownerUserId, instance.id);
    if (status !== "conectado") {
      return NextResponse.json({ message: "Conecte a instância antes de moderar participantes." }, { status: 409 });
    }

    const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
    const addToBlacklist = Boolean((body as Record<string, unknown> | null)?.addToBlacklist);
    const deleteRecentMessages = Boolean((body as Record<string, unknown> | null)?.deleteRecentMessages);
    let messageCleanup: { deleted: string[]; failed: string[] } | null = null;
    let warningResult: { count: number; limit: number; remaining: number; removed: boolean } | null = null;

    if (action === "add") {
      await addGroupParticipants(client, { groupJid: group.remoteId, participants: [participantJid] });
    } else if (action === "promote") {
      await promoteGroupParticipant(client, { groupJid: group.remoteId, participant: participantJid });
    } else if (action === "demote") {
      await demoteGroupParticipant(client, { groupJid: group.remoteId, participant: participantJid });
    } else if (action === "warn") {
      if (group.status !== "active") {
        return NextResponse.json(
          { message: "Ative o robô no grupo antes de aplicar advertências." },
          { status: 409 },
        );
      }
      const settings = await getGroupSettings(group.id);
      const limitRaw = Number.parseInt(String(settings.maxInfractions ?? 3), 10);
      const infractionLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20) : 3;
      const resetDaysRaw = Number(settings.antispamConfig?.infractionResetDays ?? 7);
      const resetAfterDays = Number.isFinite(resetDaysRaw) && resetDaysRaw > 0
        ? Math.min(365, Math.floor(resetDaysRaw))
        : 7;
      const participantDigits = digitsOnly(participantJid) || participantJid;
      const infraction = await registerGroupInfraction({
        groupId: group.id,
        memberJid: participantDigits,
        reason: "manual_warning",
        resetAfterDays,
      });
      const remaining = infractionLimit - infraction.count;
      warningResult = {
        count: infraction.count,
        limit: infractionLimit,
        remaining: Math.max(0, remaining),
        removed: false,
      };
      if (remaining <= 0 && participant?.admin !== "superadmin") {
        await removeGroupParticipant(client, { groupJid: group.remoteId, participant: participantJid });
        await resetGroupInfractions(group.id, participantDigits).catch(() => {});
        warningResult.removed = true;
      }
    } else if (action === "blacklist") {
      const added = await addParticipantToBlacklist(group.id, participantJid);
      if (deleteRecentMessages) {
        messageCleanup = await deleteRecentParticipantMessages({
          userId: ownerUserId,
          instanceId: instance.id,
          chatJid: group.remoteId,
          participantJid,
          client,
        });
      }
      await removeGroupParticipant(client, { groupJid: group.remoteId, participant: participantJid });
      await resetGroupInfractions(group.id, digitsOnly(participantJid) || participantJid).catch(() => {});
      if (!added) {
        console.info("[participants-actions] participante já estava na blacklist", {
          groupId: group.id,
          participantJid,
        });
      }
    } else if (action === "remove") {
      if (addToBlacklist) {
        await addParticipantToBlacklist(group.id, participantJid);
      }
      if (deleteRecentMessages) {
        messageCleanup = await deleteRecentParticipantMessages({
          userId: ownerUserId,
          instanceId: instance.id,
          chatJid: group.remoteId,
          participantJid,
          client,
        });
      }
      await removeGroupParticipant(client, { groupJid: group.remoteId, participant: participantJid });
      await resetGroupInfractions(group.id, digitsOnly(participantJid) || participantJid).catch(() => {});
    }

    await syncGroupInfo(ownerUserId, group.id, { force: true }).catch(() => {});
    const updatedGroup = await getGroupByIdForUser(ownerUserId, group.id);
    const cleanupMessage = messageCleanup
      ? ` ${messageCleanup.deleted.length} mensagem(ns) recente(s) apagada(s)${
        messageCleanup.failed.length > 0 ? `; ${messageCleanup.failed.length} falhou(ram)` : ""
      }.`
      : "";
    let actionMessage = "Ação aplicada.";
    if (action === "remove") {
      actionMessage = `Participante removido.${cleanupMessage}`;
    } else if (action === "blacklist") {
      actionMessage = `Participante adicionado à blacklist e removido.${cleanupMessage}`;
    } else if (action === "warn" && warningResult) {
      actionMessage = warningResult.removed
        ? `Advertência aplicada (${warningResult.count}/${warningResult.limit}) e participante removido por atingir o limite.`
        : `Advertência aplicada. Infrações: ${warningResult.count}/${warningResult.limit}. Restam ${warningResult.remaining}.`;
    } else if (action === "promote") {
      actionMessage = "Participante promovido a admin.";
    } else if (action === "demote") {
      actionMessage = "Participante rebaixado.";
    } else if (action === "add") {
      actionMessage = "Participante adicionado.";
    }

    return NextResponse.json({
      ok: true,
      action,
      group: access.isShared && updatedGroup
        ? { ...updatedGroup, accessRole: "shared_admin" }
        : updatedGroup ?? group,
      participants: updatedGroup?.participants ?? group.participants ?? [],
      messageCleanup,
      message: actionMessage,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to run group participant action", error);
    return NextResponse.json(
      { message: "Não foi possível executar a ação no participante." },
      { status: 500 },
    );
  }
}
