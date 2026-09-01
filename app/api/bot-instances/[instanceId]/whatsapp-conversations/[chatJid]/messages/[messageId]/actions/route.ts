import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { handleMessageUpsert } from "lib/bot-events/message-handler";
import { BotInstanceError, refreshInstanceStatus } from "lib/bot-instances";
import { deleteMessageForEveryone, pinMessageInChat, sendInteractiveResponse, sendPollVoteMessage, sendReactionMessage } from "lib/wuzapi";
import { resolveChatConversationAccess } from "lib/whatsapp-conversation-access";
import {
  applyWhatsappPollVoteForUser,
  deleteWhatsappConversationMessageForUser,
  getWhatsappConversationMessageForUser,
  normalizeWhatsappChatJid,
  listWhatsappMessageReceipts,
  openWhatsappConversationViewOnce,
  setWhatsappConversationMessageRevealDeletedForUser,
} from "lib/whatsapp-conversations";
import type { BotInstance } from "types/bot-instances";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string; messageId: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isGroupJid = (value: string): boolean => value.toLowerCase().endsWith("@g.us");

const isStoredInteractivePrompt = (media: Record<string, unknown> | null | undefined): boolean => {
  if (!media) return false;
  const type = String(media.kind ?? media.mediaType ?? media.type ?? "").toLowerCase();
  return /(interactive|button|list|template)/.test(type) && !type.includes("response");
};

const firstStringValue = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const recordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const dispatchInteractiveSelectionToBot = async (params: {
  instance: BotInstance;
  chatJid: string;
  responseMessageId: string | null;
  sourceMessageId: string;
  selectedId: string;
  selectedText: string;
  description: string | null;
  responseType: "button" | "list" | "flow";
  senderJid: string | null;
  sourceParticipant: string | null;
}) => {
  if (!isGroupJid(params.chatJid) || !params.selectedId.trim()) return;

  const senderJid = params.senderJid || params.sourceParticipant || (
    params.instance.phone ? `${params.instance.phone}@s.whatsapp.net` : null
  );
  if (!senderJid) return;

  const paramsPayload: Record<string, unknown> = {
    id: params.selectedId,
    selectedId: params.selectedId,
    buttonId: params.selectedId,
    display_text: params.selectedText,
    displayText: params.selectedText,
    title: params.selectedText,
    text: params.selectedText,
  };
  if (params.responseType === "list") {
    paramsPayload.rowId = params.selectedId;
    paramsPayload.selectedRowId = params.selectedId;
  } else {
    paramsPayload.selectedButtonId = params.selectedId;
  }
  if (params.description) {
    paramsPayload.description = params.description;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const eventId = params.responseMessageId || `app-interactive-${Date.now()}`;
  await handleMessageUpsert(
    { instance: params.instance },
    {
      raw: {
        source: "botadmin_android_interactive_bridge",
        id: eventId,
        chatId: params.chatJid,
        sender: senderJid,
        fromMe: false,
        type: params.responseType === "list"
          ? "list_response"
          : params.responseType === "flow"
            ? "interactive_response"
            : "button_response",
        buttonResponse: {
          kind: "native_flow",
          id: params.selectedId,
          text: params.selectedText,
          params: paramsPayload,
        },
      },
      type: "message",
      event: "message",
      token: params.instance.token ?? null,
      instance: {
        id: params.instance.id,
        name: params.instance.name,
        phone: params.instance.phone,
      },
      data: {
        id: eventId,
        chatId: params.chatJid,
        sender: senderJid,
        participant: senderJid,
        fromMe: false,
        type: params.responseType === "list"
          ? "list_response"
          : params.responseType === "flow"
            ? "interactive_response"
            : "button_response",
        text: params.selectedText,
        timestamp,
        buttonResponse: {
          kind: "native_flow",
          id: params.selectedId,
          text: params.selectedText,
          params: paramsPayload,
        },
        contextInfo: {
          stanzaID: params.sourceMessageId,
          stanzaId: params.sourceMessageId,
          participant: params.sourceParticipant ?? undefined,
        },
      },
    },
  );
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
    const messageKey = decodeURIComponent(params.messageId || "").trim();
    if (!instanceId || !chatJid || !messageKey) {
      return NextResponse.json({ message: "Mensagem inválida." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
    if (!["info", "open_view_once", "delete", "pin", "react", "interactive_reply", "poll_vote", "reveal_deleted", "hide_deleted"].includes(action)) {
      return NextResponse.json({ message: "Ação não suportada pela EasyZap nesta tela." }, { status: 400 });
    }

    const access = await resolveChatConversationAccess(user.id, instanceId, chatJid);
    if (!access) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }
    const { instance, storageUserId } = access;

    const stored = await getWhatsappConversationMessageForUser(storageUserId, instance.id, chatJid, messageKey);
    const messageId = stored?.messageId || messageKey;
    if (!messageId) {
      return NextResponse.json({ message: "Mensagem sem ID do WhatsApp." }, { status: 400 });
    }

    if (action === "info") {
      if (stored?.direction !== "outbound") {
        return NextResponse.json({ message: "Os recibos completos ficam disponíveis para mensagens enviadas por você." }, { status: 403 });
      }
      return NextResponse.json({ ok: true, receipts: await listWhatsappMessageReceipts({
        userId: storageUserId,
        instanceId: instance.id,
        chatJid,
        messageKey,
      }) });
    }

    if (action === "open_view_once") {
      try {
        return NextResponse.json({
          ok: true,
          action,
          ...(await openWhatsappConversationViewOnce({
            userId: storageUserId,
            instanceId: instance.id,
            chatJid,
            messageKey,
          })),
        });
      } catch (error) {
        const status = Number((error as { status?: unknown })?.status);
        return NextResponse.json(
          { message: error instanceof Error ? error.message : "Não foi possível abrir esta mídia." },
          { status: Number.isInteger(status) && status >= 400 ? status : 400 },
        );
      }
    }

    if (action === "reveal_deleted" || action === "hide_deleted") {
      const updatedMessage = await setWhatsappConversationMessageRevealDeletedForUser(
        storageUserId,
        instance.id,
        chatJid,
        messageKey,
        action === "reveal_deleted",
      );
      if (!updatedMessage) {
        return NextResponse.json(
          { message: "Mensagem apagada não encontrada no histórico local." },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        action,
        message: updatedMessage,
      });
    }

    if (!instance.serverBaseUrl) {
      return NextResponse.json({ message: "Servidor da instância não configurado." }, { status: 500 });
    }

    const sessionStatus = await refreshInstanceStatus(storageUserId, instance.id);
    if (sessionStatus !== "conectado") {
      return NextResponse.json({ message: "Conecte a instância antes de agir na mensagem." }, { status: 409 });
    }

    const client = {
      baseUrl: instance.serverBaseUrl,
      token: instance.token,
      conversation: {
        userId: storageUserId,
        instanceId: instance.id,
        instanceName: instance.name,
        instancePhone: instance.phone,
      },
    };

    if (action === "delete") {
      const participant = typeof body?.participant === "string" && body.participant.trim()
        ? body.participant.trim()
        : stored?.senderJid ?? null;
      await deleteMessageForEveryone(client, { chatId: chatJid, messageId, participant });
      await deleteWhatsappConversationMessageForUser(storageUserId, instance.id, chatJid, messageKey);
      return NextResponse.json({ ok: true, action: "delete" });
    }

    if (action === "pin") {
      const fromMe = stored?.direction === "outbound";
      const participant = fromMe
        ? null
        : typeof body?.participant === "string" && body.participant.trim()
          ? body.participant.trim()
          : stored?.senderJid ?? null;
      await pinMessageInChat(client, {
        chatId: chatJid,
        messageId,
        participant,
        fromMe,
      });
      return NextResponse.json({ ok: true, action: "pin" });
    }

    if (action === "interactive_reply") {
      const requestedResponseType =
        typeof body?.responseType === "string"
          ? body.responseType.trim().toLowerCase()
          : "";
      const responseType =
        requestedResponseType === "list"
          ? "list"
          : requestedResponseType === "flow"
            ? "flow"
            : "button";
      const selectedId = typeof body?.selectedId === "string" && body.selectedId.trim()
        ? body.selectedId.trim()
        : typeof body?.payload === "string" && body.payload.trim()
          ? body.payload.trim()
          : "";
      const selectedText = typeof body?.selectedText === "string" && body.selectedText.trim()
        ? body.selectedText.trim()
        : typeof body?.title === "string" && body.title.trim()
          ? body.title.trim()
          : selectedId;
      const description = typeof body?.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
      const nativeName =
        typeof body?.nativeName === "string" && body.nativeName.trim()
          ? body.nativeName.trim()
          : responseType === "flow"
            ? "galaxy_message"
            : null;
      const responseParams =
        body?.params && typeof body.params === "object" && !Array.isArray(body.params)
          ? body.params as Record<string, unknown>
          : null;
      const responseVersion =
        typeof body?.version === "number" && Number.isFinite(body.version)
          ? Math.max(1, Math.trunc(body.version))
          : null;
      if (!selectedId) {
        return NextResponse.json({ message: "Seleção interativa inválida." }, { status: 400 });
      }

      const quotedParticipant = typeof body?.participant === "string" && body.participant.trim()
        ? body.participant.trim()
        : stored?.senderJid || (stored?.direction === "outbound" && instance.phone ? `${instance.phone}@s.whatsapp.net` : null);
      const responseMessageId = await sendInteractiveResponse(client, {
        to: chatJid,
        responseType,
        selectedId,
        selectedText,
        description,
        nativeName,
        version: responseVersion,
        params: responseParams,
        quoted: {
          stanzaId: messageId,
          participant: quotedParticipant,
          sourceInteractive: stored?.media ?? null,
        },
      });
      if (stored?.direction === "outbound" && isStoredInteractivePrompt(stored.media)) {
        await dispatchInteractiveSelectionToBot({
          instance,
          chatJid,
          responseMessageId,
          sourceMessageId: messageId,
          selectedId,
          selectedText,
          description,
          responseType,
          senderJid: quotedParticipant,
          sourceParticipant: stored.senderJid,
        }).catch((error) => {
          console.error("[whatsapp-conversations] Falha ao despachar seleção interativa do app", {
            userId: storageUserId,
            instanceId: instance.id,
            chatJid,
            messageId,
            responseMessageId,
            selectedId,
            error,
          });
        });
      }
      const responseMessage = responseMessageId
        ? await getWhatsappConversationMessageForUser(storageUserId, instance.id, chatJid, responseMessageId)
        : null;
      return NextResponse.json({
        ok: true,
        action: "interactive_reply",
        responseType,
        selectedId,
        selectedText,
        message: responseMessage,
      });
    }

    if (action === "poll_vote") {
      const media = stored?.media && typeof stored.media === "object" ? stored.media as Record<string, unknown> : null;
      const options = Array.isArray(media?.options)
        ? media?.options as Record<string, unknown>[]
        : Array.isArray(media?.pollOptions)
          ? media?.pollOptions as Record<string, unknown>[]
          : [];
      const selectedOptionId = typeof body?.optionId === "string" && body.optionId.trim()
        ? body.optionId.trim()
        : typeof body?.selectedOptionId === "string" && body.selectedOptionId.trim()
          ? body.selectedOptionId.trim()
          : "";
      const selectedOptionTitle = typeof body?.optionTitle === "string" && body.optionTitle.trim()
        ? body.optionTitle.trim()
        : typeof body?.selectedOption === "string" && body.selectedOption.trim()
          ? body.selectedOption.trim()
          : typeof body?.title === "string" && body.title.trim()
            ? body.title.trim()
            : "";
      const selectedOption = options.find((option) => {
        const candidates = [
          option.id,
          option.Id,
          option.hash,
          option.Hash,
          option.optionHash,
          option.OptionHash,
          option.title,
          option.Title,
          option.name,
          option.Name,
        ]
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean);
        return candidates.includes(selectedOptionId) || candidates.includes(selectedOptionTitle);
      });
      const selectedTitle =
        selectedOptionTitle ||
        (typeof selectedOption?.title === "string" ? selectedOption.title : "") ||
        (typeof selectedOption?.name === "string" ? selectedOption.name : "");
      const selectedHash =
        selectedOptionId ||
        (typeof selectedOption?.id === "string" ? selectedOption.id : "") ||
        (typeof selectedOption?.hash === "string" ? selectedOption.hash : "") ||
        (typeof selectedOption?.optionHash === "string" ? selectedOption.optionHash : "");
      if (!selectedTitle) {
        return NextResponse.json({ message: "Opção da enquete inválida." }, { status: 400 });
      }

      const pollFromMe = stored?.direction === "outbound";
      const rawRecord = recordValue(stored?.raw);
      const rawSender = recordValue(rawRecord?.sender ?? rawRecord?.Sender);
      const pollSenderJid = pollFromMe
        ? instance.phone ? `${instance.phone}@s.whatsapp.net` : null
        : firstStringValue(
          rawSender?.originalJid,
          rawSender?.OriginalJid,
          rawSender?.originalJID,
          rawSender?.lid,
          rawSender?.Lid,
          rawSender?.jid,
          rawSender?.Jid,
          stored?.senderJid,
        );
      try {
        await sendPollVoteMessage(client, {
          chatId: chatJid,
          pollMessageId: messageId,
          options: [selectedTitle],
          senderJid: pollSenderJid,
          fromMe: pollFromMe,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error ?? "");
        console.warn("[whatsapp-conversations] remote poll vote failed", {
          userId: storageUserId,
          instanceId: instance.id,
          chatJid,
          messageId,
          sender: pollSenderJid,
          error: messageText,
        });
        return NextResponse.json(
          {
            message: /original message secret key not found|message secret/i.test(messageText)
              ? "Não foi possível votar nesta enquete pelo WhatsApp porque a instância não possui mais a chave original da enquete."
              : "Não foi possível votar nesta enquete pelo WhatsApp.",
            details: messageText,
          },
          { status: 409 },
        );
      }

      const voterJid = instance.phone ? `${instance.phone}@s.whatsapp.net` : pollSenderJid ?? "";
      const updatedMessage = await applyWhatsappPollVoteForUser({
        userId: storageUserId,
        instanceId: instance.id,
        chatJid,
        pollMessageId: messageId,
        voterJid,
        selectedOptionHashes: selectedHash ? [selectedHash] : [],
        selectedOptionTitles: [selectedTitle],
        voterName: instance.name,
        ownJid: instance.phone ? `${instance.phone}@s.whatsapp.net` : null,
        timestamp: new Date(),
      });
      return NextResponse.json({
        ok: true,
        action: "poll_vote",
        remoteVoteSent: true,
        optionId: selectedHash || selectedTitle,
        optionTitle: selectedTitle,
        message: updatedMessage,
      });
    }

    const emoji = typeof body?.emoji === "string" && body.emoji.trim() ? body.emoji.trim() : "👍";
    await sendReactionMessage(client, { chatId: chatJid, messageId, emoji });
    return NextResponse.json({ ok: true, action: "react", emoji });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to run WhatsApp message action", error);
    return NextResponse.json(
      { message: "Não foi possível executar a ação na mensagem." },
      { status: 500 },
    );
  }
}
