import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, refreshInstanceStatus } from "lib/bot-instances";
import {
  deleteMessageForEveryone,
  demoteGroupParticipant,
  promoteGroupParticipant,
  removeGroupParticipant,
} from "lib/wuzapi";
import { resolveChatConversationAccess } from "lib/whatsapp-conversation-access";
import {
  deleteWhatsappConversationMessageForUser,
  getWhatsappChatType,
  listWhatsappConversationMessages,
  normalizeWhatsappChatJid,
} from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string }>;
};

type ParticipantAction = "promote" | "demote" | "remove";

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

const normalizeAction = (value: unknown): ParticipantAction | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (normalized === "promote" || normalized === "promover") return "promote";
  if (normalized === "demote" || normalized === "rebaixar") return "demote";
  if (normalized === "remove" || normalized === "ban" || normalized === "banir" || normalized === "kick") {
    return "remove";
  }
  return null;
};

const matchesDigits = (left: string | null | undefined, right: string | null | undefined) => {
  const leftDigits = digitsOnly(left);
  const rightDigits = digitsOnly(right);
  if (!leftDigits || !rightDigits) return false;
  return leftDigits === rightDigits || leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits);
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
      console.warn("[conversation-participants-actions] falha ao apagar mensagem recente", {
        chatJid: options.chatJid,
        messageId: message.messageId,
        participant: options.participantJid,
        error,
      });
    }
  }
  return { deleted, failed };
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(params.instanceId);
    const chatJid = normalizeWhatsappChatJid(decodeURIComponent(params.chatJid));
    if (!instanceId || !chatJid || getWhatsappChatType(chatJid) !== "group") {
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

    const access = await resolveChatConversationAccess(user.id, instanceId, chatJid);
    if (!access) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }
    const { instance, storageUserId } = access;
    if (!instance.serverBaseUrl) {
      return NextResponse.json({ message: "Servidor da instância não configurado." }, { status: 500 });
    }
    if (digitsOnly(instance.phone) && matchesDigits(instance.phone, participantJid)) {
      return NextResponse.json({ message: "Não é possível moderar o número da própria instância." }, { status: 400 });
    }

    const status = await refreshInstanceStatus(storageUserId, instance.id);
    if (status !== "conectado") {
      return NextResponse.json({ message: "Conecte a instância antes de moderar participantes." }, { status: 409 });
    }

    const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
    const deleteRecentMessages = Boolean((body as Record<string, unknown> | null)?.deleteRecentMessages);
    let messageCleanup: { deleted: string[]; failed: string[] } | null = null;

    if (action === "promote") {
      await promoteGroupParticipant(client, { groupJid: chatJid, participant: participantJid });
    } else if (action === "demote") {
      await demoteGroupParticipant(client, { groupJid: chatJid, participant: participantJid });
    } else {
      if (deleteRecentMessages) {
        messageCleanup = await deleteRecentParticipantMessages({
          userId: storageUserId,
          instanceId: instance.id,
          chatJid,
          participantJid,
          client,
        });
      }
      await removeGroupParticipant(client, { groupJid: chatJid, participant: participantJid });
    }

    const cleanupMessage = messageCleanup
      ? ` ${messageCleanup.deleted.length} mensagem(ns) recente(s) apagada(s)${
        messageCleanup.failed.length > 0 ? `; ${messageCleanup.failed.length} falhou(ram)` : ""
      }.`
      : "";
    const message =
      action === "remove"
        ? `Participante removido.${cleanupMessage}`
        : action === "promote"
          ? "Participante promovido a admin."
          : "Participante rebaixado.";

    return NextResponse.json({ ok: true, action, messageCleanup, message });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to run conversation participant action", error);
    return NextResponse.json(
      { message: "Não foi possível executar a ação no participante." },
      { status: 500 },
    );
  }
}
