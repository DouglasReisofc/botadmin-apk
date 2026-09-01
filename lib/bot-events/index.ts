import { startAdminCampaignDispatcher } from "lib/admin-campaign-dispatcher";
import { startAdsDispatcher } from "lib/bot-ads-dispatcher";
import { startAntiInactivityDispatcher } from "lib/bot-anti-inactivity-dispatcher";
import { startHorapgDispatcher } from "lib/bot-horapg-dispatcher";
import { startSisregWatcherDispatcher } from "lib/sisreg-watcher-dispatcher";
import { startScheduleDispatcher } from "lib/bot-group-schedule-dispatcher";
import { startAffiliateMlGroupDispatcher } from "lib/affiliate-ml-group-dispatcher";
import { startAffiliateMlProductsAutoSyncDispatcher } from "lib/affiliate-ml-products-auto-sync-dispatcher";
import { startAffiliateShopeeGroupDispatcher } from "lib/affiliate-shopee-group-dispatcher";
import { startAffiliateShopeeProductsAutoSyncDispatcher } from "lib/affiliate-shopee-products-auto-sync-dispatcher";
import { startGroupParticipantImportDispatcher } from "lib/group-participant-import-jobs";
import { startWhatsappHistoryCleanupDispatcher } from "lib/whatsapp-history-cleanup-dispatcher";
import "lib/bot-sweepstakes-dispatcher";
import {
  getCachedInstanceByToken,
  invalidateInstanceByTokenCache,
} from "lib/bot-events/cache";
import type { BotEventContext, NormalizedWebhookPayload } from "./types";
import { normalizeWebhookPayload } from "./normalize";
import { handleMessageUpsert } from "./message-handler";
import { handleGroupEvent } from "./group-handler";
import { logWebhookEvent } from "./logger";
import { getDb } from "lib/db";
import { getAdminSiteSettings } from "lib/admin-site";
import { getAppBaseUrl } from "lib/meta";
import {
  confirmSignupWhatsappVerificationFromMessage,
  SignupWhatsappVerificationError,
} from "lib/signup-whatsapp-verification";
import {
  sendInteractiveButtons,
  sendTextMessage,
  type InteractiveButton,
  type WuzapiClient,
} from "lib/wuzapi";
import {
  clearWhatsappConversationMessagesForUser,
  deleteWhatsappConversationMessageForUser,
  deleteWhatsappConversationThreadForUser,
  getWhatsappConversationThread,
  markWhatsappConversationMessageDeletedForUser,
  markWhatsappConversationThreadDeletedInInstanceForUser,
  recordWhatsappConversationMessage,
  recordWhatsappMessageReceipt,
  recordWhatsappRealtimeEvent,
  setWhatsappConversationArchivedForUser,
  setWhatsappConversationPinnedForUser,
} from "lib/whatsapp-conversations";
import { publishWhatsappRealtimeEvent } from "lib/whatsapp-realtime-bus";
import { getInstanceSettings } from "lib/bot-instance-settings";
import {
  ANDROID_REALTIME_MESSAGES_CHANNEL_ID,
  sendPushNotificationToUser,
} from "lib/push-notifications";

export class BotEventError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BotEventError";
    this.status = status;
  }
}

const ALLOWED_EVENTS = new Set([
  "message.upsert",
  "chat.action",
  "message.action",
  "messages.update",
  "presence.update",
  "call.update",
  "history.sync",
  "instance.status",
  "status.update",
  "group.info",
  "group.update",
  "group.joined",
  "group.picture",
  "privacy.settings",
  "pushname.setting",
]);

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
};

const normalizePhoneDigits = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const digits = String(value).replace(/\D+/g, "");
  return digits.length >= 10 && digits.length <= 16 ? digits : null;
};

const firstBoolean = (...values: unknown[]): boolean | null => {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "sim"].includes(normalized)) return true;
      if (["false", "0", "no", "nao", "não"].includes(normalized)) return false;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value !== 0;
    }
  }
  return null;
};

const buildWuzapiClient = (context: BotEventContext): WuzapiClient => ({
  baseUrl: context.instance.serverBaseUrl,
  token: context.instance.token,
  conversation: {
    userId: context.instance.userId,
    instanceId: context.instance.id,
    instanceName: context.instance.name,
    instancePhone: context.instance.phone,
  },
});

const buildAbsoluteAppUrl = (path: string) => {
  const baseUrl = getAppBaseUrl().replace(/\/+$/, "");
  try {
    return new URL(path, `${baseUrl}/`).toString();
  } catch {
    return baseUrl || path;
  }
};

const getPrimaryOfficialGroupUrl = async (): Promise<string | null> => {
  try {
    const site = await getAdminSiteSettings();
    const activeGroup = site.officialGroups?.find(
      (group) => group.isActive && group.inviteLink,
    );
    return (
      activeGroup?.inviteLink?.trim() ||
      site.officialGroupInviteLink?.trim() ||
      null
    );
  } catch (error) {
    console.warn(
      "[bot-events] falha ao carregar grupo oficial para cadastro",
      error,
    );
    return null;
  }
};

const extractAdminSystemSignupMessage = (
  normalized: NormalizedWebhookPayload,
) => {
  const data = toRecord(normalized.data);
  const raw = toRecord(normalized.raw);
  const normalizedRecord = toRecord(
    data.normalized ?? data.Normalized ?? raw.normalized ?? raw.Normalized,
  );
  const eventChat = toRecord(data.chat ?? raw.chat);
  const eventSender = toRecord(data.sender ?? raw.sender);
  const eventMessage = toRecord(data.message ?? raw.message);
  const message = toRecord(
    data.Message ?? data.message ?? raw.Message ?? raw.message,
  );
  const key = toRecord(data.key ?? message.key ?? raw.key);
  const info = toRecord(data.Info ?? data.info ?? raw.Info ?? raw.info);
  const rawMessage = toRecord(
    message.message ??
      data.RawMessage ??
      data.rawMessage ??
      raw.RawMessage ??
      raw.rawMessage ??
      {},
  );

  const text =
    firstString(
      data.text,
      data.body,
      eventMessage.text,
      eventMessage.body,
      message.text,
      message.body,
      message.conversation,
      data.conversation,
      rawMessage.conversation,
      rawMessage.text,
      toRecord(rawMessage.extendedTextMessage).text,
      toRecord(toRecord(rawMessage.message).extendedTextMessage).text,
      toRecord(toRecord(rawMessage.deviceSentMessage).message).conversation,
      toRecord(toRecord(rawMessage.deviceSentMessage).message).text,
      toRecord(toRecord(rawMessage.deviceSentMessage).message).body,
      toRecord(
        toRecord(toRecord(rawMessage.deviceSentMessage).message)
          .extendedTextMessage,
      ).text,
    ) ?? null;

  const chatJid =
    firstString(
      data.chatId,
      data.chat,
      data.remoteJid,
      normalizedRecord.remoteJid,
      normalizedRecord.chatId,
      normalizedRecord.remote,
      normalizedRecord.remoteId,
      eventChat.id,
      eventChat.jid,
      eventChat.remoteJid,
      eventMessage.chatId,
      eventMessage.remoteJid,
      key.remoteJid,
      info.ChatNormalized,
      info.chatNormalized,
      info.Chat,
      info.chat,
      rawMessage.remoteJid,
      toRecord(rawMessage.deviceSentMessage).destinationJID,
      toRecord(rawMessage.deviceSentMessage).DestinationJID,
      toRecord(rawMessage.deviceSentMessage).chatId,
      toRecord(rawMessage.deviceSentMessage).chat,
    ) ?? null;

  const senderJid =
    firstString(
      data.sender,
      data.Sender,
      data.author,
      data.Author,
      data.participant,
      data.Participant,
      normalizedRecord.senderJid,
      normalizedRecord.sender,
      normalizedRecord.participant,
      normalizedRecord.participantJid,
      eventSender.id,
      eventSender.jid,
      eventSender.phone,
      eventSender.phoneNumber,
      eventSender.lid,
      eventMessage.senderJid,
      eventMessage.sender,
      eventMessage.participant,
      eventChat.participantJid,
      toRecord(eventChat.participant).jid,
      toRecord(eventChat.participant).phone,
      key.participant,
      key.Participant,
      info.SenderNormalized,
      info.senderNormalized,
      info.ParticipantNormalized,
      info.participantNormalized,
      info.SenderAlt,
      info.senderAlt,
      info.Sender,
      info.sender,
    ) ?? null;

  const fromMe =
    firstBoolean(
      data.fromMe,
      data.isFromMe,
      eventMessage.fromMe,
      eventSender.fromMe,
      message.fromMe,
      rawMessage.fromMe,
      key.fromMe,
      key.FromMe,
      info.IsFromMe,
      info.isFromMe,
      normalizedRecord.fromMe,
      normalizedRecord.isFromMe,
    ) ?? false;

  const directChatDigits =
    chatJid && !/@g\.us\b/i.test(chatJid)
      ? normalizePhoneDigits(chatJid)
      : null;
  const senderDigits =
    normalizePhoneDigits(senderJid) ??
    normalizePhoneDigits(eventSender.phoneNumber) ??
    normalizePhoneDigits(eventSender.phone) ??
    directChatDigits;

  const recipientJid =
    chatJid && /@/.test(chatJid) && !/@g\.us\b/i.test(chatJid)
      ? chatJid
      : senderDigits
        ? `${senderDigits}@s.whatsapp.net`
        : null;

  return {
    text,
    chatJid,
    senderDigits,
    recipientJid,
    fromMe,
  };
};

const sendSignupButtonsWithFallback = async (
  client: WuzapiClient,
  params: {
    to: string;
    title: string;
    body: string;
    buttons: InteractiveButton[];
    fallbackLines: string[];
  },
) => {
  try {
    await sendInteractiveButtons(client, {
      to: params.to,
      title: params.title,
      body: params.body,
      footer: "botadmin.shop",
      buttonType: "native",
      buttons: params.buttons,
    });
    return;
  } catch (error) {
    console.warn(
      "[bot-events] falha ao enviar botões de cadastro, usando texto",
      error,
    );
  }

  await sendTextMessage(client, {
    to: params.to,
    body: [params.body, ...params.fallbackLines].filter(Boolean).join("\n\n"),
  });
};

const sendAdminSignupCompletionMessage = async (
  client: WuzapiClient,
  to: string,
) => {
  const groupUrl = await getPrimaryOfficialGroupUrl();
  const siteUrl = buildAbsoluteAppUrl("/sign-in");
  const buttons: InteractiveButton[] = [];
  const fallbackLines: string[] = [];

  if (groupUrl) {
    buttons.push({
      id: "signup-official-group",
      text: "Entrar no grupo",
      type: "cta_url",
      url: groupUrl,
    });
    fallbackLines.push(`Grupo oficial: ${groupUrl}`);
  }

  buttons.push({
    id: "signup-back-site",
    text: "Voltar ao site",
    type: "cta_url",
    url: siteUrl,
  });
  fallbackLines.push(`Voltar ao site: ${siteUrl}`);

  await sendSignupButtonsWithFallback(client, {
    to,
    title: "Cadastro confirmado",
    body: "✅ Cadastro concluído com sucesso.\n\nSeu WhatsApp foi confirmado. Volte ao site para continuar no painel do BotAdmin.",
    buttons,
    fallbackLines,
  });
};

const sendAdminSignupRecoveryMessage = async (
  client: WuzapiClient,
  to: string,
  message: string,
) => {
  const recoveryUrl = buildAbsoluteAppUrl("/forgot-password");
  await sendSignupButtonsWithFallback(client, {
    to,
    title: "Recuperar acesso",
    body: `⚠️ ${message}\n\nUse a recuperação para entrar na conta vinculada a este WhatsApp.`,
    buttons: [
      {
        id: "signup-recover-account",
        text: "Recuperar acesso",
        type: "cta_url",
        url: recoveryUrl,
      },
    ],
    fallbackLines: [`Recuperar acesso: ${recoveryUrl}`],
  });
};

const maybeHandleAdminSystemSignupConfirmation = async (
  context: BotEventContext,
  normalized: NormalizedWebhookPayload,
): Promise<boolean> => {
  if (context.instance.purpose !== "admin_system") {
    return false;
  }

  const message = extractAdminSystemSignupMessage(normalized);
  if (message.fromMe || !message.text) {
    return false;
  }

  const match = message.text.toUpperCase().match(/\bSB[-\s]?([0-9]{6})\b/);
  if (!match) {
    return false;
  }

  const client = buildWuzapiClient(context);
  const to = message.recipientJid;
  if (!to) {
    console.warn(
      "[bot-events] código de cadastro recebido sem remetente resolvível",
      {
        instanceId: context.instance.id,
        chatJid: message.chatJid,
      },
    );
    return true;
  }

  if (!message.senderDigits) {
    await sendTextMessage(client, {
      to,
      body: "Não consegui identificar o WhatsApp que enviou o código. Tente novamente pelo número que será usado no cadastro.",
    });
    return true;
  }

  try {
    const confirmed = await confirmSignupWhatsappVerificationFromMessage({
      code: match[1],
      senderDigits: message.senderDigits,
    });

    if (confirmed) {
      await sendAdminSignupCompletionMessage(client, to);
    } else {
      await sendTextMessage(client, {
        to,
        body: "Não encontrei esse código de confirmação. Gere um novo cadastro no site e tente novamente.",
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof SignupWhatsappVerificationError
        ? error.message
        : "Não foi possível confirmar este cadastro agora. Fale com o suporte.";
    if (
      error instanceof SignupWhatsappVerificationError &&
      (error.status === 409 || errorMessage.toLowerCase().includes("vinculado"))
    ) {
      await sendAdminSignupRecoveryMessage(client, to, errorMessage);
    } else {
      await sendTextMessage(client, { to, body: errorMessage });
    }
  }

  return true;
};

const resolveSessionStatus = (
  normalized: ReturnType<typeof normalizeWebhookPayload>,
):
  | "conectado"
  | "desconectado"
  | "aguardando_qr"
  | "aguardando_pareamento"
  | "inicializando"
  | null => {
  const raw = toRecord(normalized.raw);
  const session = toRecord(raw.session);
  const event = firstString(
    raw.eventType,
    raw.type,
    session.type,
    session.event,
    normalized.type,
  )
    ?.toLowerCase()
    .replace(/[\s_-]+/g, ".");

  if (!event) return null;
  if (
    [
      "connected",
      "pair.success",
      "pairsuccess",
      "keepalive.restored",
      "pushname.setting",
    ].includes(event)
  ) {
    return "conectado";
  }
  if (event === "qr") {
    return "aguardando_qr";
  }
  if (event === "pair.error" || event === "pairerror") {
    return "aguardando_pareamento";
  }
  if (
    [
      "disconnected",
      "logged.out",
      "loggedout",
      "connect.failure",
      "connectfailure",
      "keepalive.timeout",
      "client.outdated",
      "clientoutdated",
      "temporary.ban",
      "temporaryban",
      "stream.error",
      "streamerror",
      "stream.replaced",
      "streamreplaced",
    ].includes(event)
  ) {
    return "desconectado";
  }
  return null;
};

const handleInstanceStatusEvent = async (
  context: BotEventContext,
  normalized: ReturnType<typeof normalizeWebhookPayload>,
) => {
  const nextStatus = resolveSessionStatus(normalized);
  if (!nextStatus) {
    return;
  }

  if (context.instance.desiredSessionState === "disconnected") {
    const db = getDb();
    await db.query(
      `
        UPDATE bot_instances
        SET session_status = 'desconectado', last_status_sync = NOW(), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [context.instance.id],
    );
    invalidateInstanceByTokenCache(context.instance.token);
    return;
  }

  const raw = toRecord(normalized.raw);
  const instancePayload = toRecord(raw.instance);
  const session = toRecord(raw.session);
  const connectedPhone = normalizePhoneDigits(
    firstString(
      instancePayload.phone,
      instancePayload.user,
      instancePayload.whatsappJid,
      toRecord(instancePayload.self).phone,
      toRecord(instancePayload.self).user,
      session.phone,
      session.jid,
    ),
  );

  const db = getDb();
  const sourceEvent =
    firstString(raw.eventType, raw.type, normalized.type)
      ?.toLowerCase()
      .replace(/[\s_-]+/g, ".") ?? "";
  const loggedOut = sourceEvent === "logged.out" || sourceEvent === "loggedout";
  if (
    nextStatus === "conectado" &&
    connectedPhone &&
    connectedPhone !== context.instance.phone
  ) {
    await db.query(
      `
        UPDATE bot_instances
        SET session_status = ?, phone = ?,
            desired_session_state = CASE WHEN ? THEN 'disconnected' ELSE desired_session_state END,
            last_status_sync = NOW(), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [nextStatus, connectedPhone, loggedOut, context.instance.id],
    );
  } else {
    await db.query(
      `
        UPDATE bot_instances
        SET session_status = ?,
            desired_session_state = CASE WHEN ? THEN 'disconnected' ELSE desired_session_state END,
            last_status_sync = NOW(), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [nextStatus, loggedOut, context.instance.id],
    );
  }

  invalidateInstanceByTokenCache(context.instance.token);

  const event = await recordWhatsappRealtimeEvent({
    userId: context.instance.userId,
    instanceId: context.instance.id,
    chatJid: `instance-${context.instance.id}@botadmin.local`,
    eventType: "instance.status",
    messageId: null,
    payload: {
      status: nextStatus,
      instanceId: context.instance.id,
      phone: connectedPhone ?? context.instance.phone ?? null,
      sourceEventType: firstString(raw.eventType, raw.type, normalized.type),
      session,
      instance: {
        id: context.instance.id,
        name: context.instance.name,
        phone: connectedPhone ?? context.instance.phone ?? null,
      },
    },
  });

};

const handleStatusUpdate = async (
  context: BotEventContext,
  normalized: ReturnType<typeof normalizeWebhookPayload>,
) => {
  const data = toRecord(normalized.data);
  const raw = toRecord(normalized.raw);
  const status = toRecord(data.status ?? raw.status);
  const message = toRecord(data.message ?? raw.message);
  const media = toRecord(data.media ?? raw.media);

  const chatJid = "status@broadcast";
  const messageId = firstString(
    status.id,
    status.messageId,
    status.targetMessageId,
    message.id,
    data.messageId,
    raw.messageId,
  );
  const action = firstString(
    status.action,
    data.action,
    raw.action,
    normalized.type === "status.deleted" ? "deleted" : null,
    normalized.type === "status.created" ? "created" : null,
  );
  const statusText = firstString(
    status.text,
    status.caption,
    message.text,
    message.caption,
  );
  const author = toRecord(status.author ?? message.author ?? raw.author);
  const authorJid = firstString(
    status.authorJid,
    author.jid,
    author.id,
    author.originalJid,
    message.senderJid,
  );
  const authorName = firstString(
    author.name,
    status.pushName,
    message.senderName,
    message.pushName,
  );
  const fromMe =
    status.fromMe === true || message.fromMe === true || raw.fromMe === true;
  const statusType =
    firstString(
      status.type,
      message.messageType,
      media.type,
      media.mediaType,
    ) ?? "status";
  const timestamp =
    firstString(status.timestamp, message.timestamp, raw.timestamp) ??
    new Date().toISOString();

  let conversationRecord: Awaited<
    ReturnType<typeof recordWhatsappConversationMessage>
  > | null = null;
  if (action === "created" || normalized.type === "status.created") {
    conversationRecord = await recordWhatsappConversationMessage({
      userId: context.instance.userId,
      instanceId: context.instance.id,
      chatJid: "status@broadcast",
      messageId,
      direction: fromMe ? "outbound" : "inbound",
      senderJid: authorJid,
      senderName: authorName ?? (fromMe ? context.instance.name : null),
      messageType: statusType,
      text: statusText,
      media: {
        ...media,
        status,
      },
      raw,
      timestamp,
      title: authorName ?? firstString(authorJid, status.authorJid) ?? "Status",
    });
  } else if (
    (action === "deleted" || normalized.type === "status.deleted") &&
    messageId
  ) {
    await deleteWhatsappConversationMessageForUser(
      context.instance.userId,
      context.instance.id,
      "status@broadcast",
      messageId,
    );
  }

  const event = await recordWhatsappRealtimeEvent({
    userId: context.instance.userId,
    instanceId: context.instance.id,
    chatJid,
    eventType: "status.update",
    messageId,
    payload: {
      eventType:
        firstString(raw.eventType, data.eventType, normalized.type) ??
        normalized.type,
      action,
      deletedMessageId:
        action === "deleted" || normalized.type === "status.deleted"
          ? messageId
          : null,
      status,
      message,
      media,
      thread: conversationRecord?.thread ?? null,
      visibleMessage: conversationRecord?.message ?? null,
      raw,
    },
  });

  if (event) {
    publishWhatsappRealtimeEvent(event);
  }
};

const resolveCallAction = (
  normalized: ReturnType<typeof normalizeWebhookPayload>,
): string => {
  const data = toRecord(normalized.data);
  const raw = toRecord(normalized.raw);
  const source =
    firstString(
      data.action,
      raw.action,
      data.eventType,
      raw.eventType,
      data.type,
      raw.type,
      normalized.type,
    )
      ?.toLowerCase()
      .replace(/[\s_-]+/g, ".") ?? "";

  if (source.includes("offer.notice")) return "notice";
  if (source.includes("offer")) return "offer";
  if (source.includes("accept")) return "accept";
  if (source.includes("reject") || source.includes("decline")) return "reject";
  if (source.includes("terminate") || source.includes("end"))
    return "terminate";
  if (source.includes("relay")) return "relay";
  return "update";
};

const callDisplayName = (
  call: Record<string, unknown>,
  chatJid: string | null,
): string => {
  const explicit = firstString(
    call.name,
    call.pushName,
    call.senderName,
    call.displayName,
    call.phone,
    call.user,
  );
  if (explicit) return explicit;
  const digits = chatJid?.replace(/\D+/g, "");
  return digits || chatJid || "Contato";
};

const handleCallEvent = async (
  context: BotEventContext,
  normalized: ReturnType<typeof normalizeWebhookPayload>,
) => {
  const data = toRecord(normalized.data);
  const raw = toRecord(normalized.raw);
  const nestedEvent = toRecord(raw.event ?? data.event);
  const call = Object.keys(nestedEvent).length > 0 ? nestedEvent : data;
  const action = resolveCallAction(normalized);
  const callId = firstString(
    call.id,
    call.ID,
    call.callId,
    call.CallID,
    call["call-id"],
    data.callId,
    raw.callId,
    raw.CallID,
  );
  const chatJid = firstString(
    call.from,
    call.From,
    call.chatJid,
    call.Chat,
    call.to,
    call.To,
    data.from,
    raw.from,
    data.chatJid,
    raw.chatJid,
    `instance-${context.instance.id}@botadmin.local`,
  );
  const callCreator = firstString(
    call.creator,
    call.callCreator,
    call.CallCreator,
    call["call-creator"],
    data.creator,
    raw.creator,
  );
  const timestamp =
    firstString(
      call.timestamp,
      call.Timestamp,
      data.timestamp,
      raw.timestamp,
    ) ?? new Date().toISOString();
  const reason = firstString(call.reason, call.Reason, data.reason, raw.reason);

  const event = await recordWhatsappRealtimeEvent({
    userId: context.instance.userId,
    instanceId: context.instance.id,
    chatJid: chatJid!,
    eventType: "call.update",
    messageId: callId,
    payload: {
      action,
      callId,
      from: chatJid,
      callCreator,
      timestamp,
      reason,
      platform: firstString(
        call.platform,
        call.Platform,
        call.remotePlatform,
        call.RemotePlatform,
      ),
      version: firstString(
        call.version,
        call.Version,
        call.remoteVersion,
        call.RemoteVersion,
      ),
      call,
      raw,
    },
  });

  if (event) {
    publishWhatsappRealtimeEvent(event);
  }

  if (action === "offer" && callId) {
    const title = "Chamada recebida";
    const body = `${callDisplayName(call, chatJid)} está ligando pela instância ${context.instance.name}.`;
    void sendPushNotificationToUser(context.instance.userId, {
      title,
      body,
      data: {
        type: "whatsapp_call",
        notificationId: `whatsapp-call-${context.instance.id}`,
        notification_id: `whatsapp-call-${context.instance.id}`,
        storebot_notification_id: `whatsapp-call-${context.instance.id}`,
        instanceId: String(context.instance.id),
        instance_id: String(context.instance.id),
        chatJid,
        chat_jid: chatJid,
        callId,
        call_id: callId,
        callCreator,
        call_creator: callCreator,
        callAction: action,
        call_action: action,
        targetUrl: "/dashboard/user/conversas",
      },
      android: {
        channelId: ANDROID_REALTIME_MESSAGES_CHANNEL_ID,
      },
    }).catch((error) => {
      console.warn("[whatsapp-push] failed to notify call event", {
        userId: context.instance.userId,
        instanceId: context.instance.id,
        callId,
        error,
      });
    });
  }
};

const resolveChatAction = (
  normalized: ReturnType<typeof normalizeWebhookPayload>,
): string | null => {
  const normalizedType = normalized.type.toLowerCase();
  if (normalizedType === "chat.archived") return "archive";
  if (normalizedType === "chat.unarchived") return "unarchive";
  if (normalizedType === "chat.pinned") return "pin";
  if (normalizedType === "chat.unpinned") return "unpin";
  if (normalizedType === "chat.cleared") return "clear";
  if (normalizedType === "chat.deleted") return "delete";
  const data = toRecord(normalized.data);
  const raw = toRecord(normalized.raw);
  const rawEventType = firstString(
    data.eventType,
    raw.eventType,
    data.type,
    raw.type,
  )?.toLowerCase();
  if (rawEventType === "chat.archived") return "archive";
  if (rawEventType === "chat.unarchived") return "unarchive";
  if (rawEventType === "chat.pinned") return "pin";
  if (rawEventType === "chat.unpinned") return "unpin";
  if (rawEventType === "chat.cleared") return "clear";
  if (rawEventType === "chat.deleted") return "delete";
  const chatAction = toRecord(data.chatAction ?? raw.chatAction);
  return firstString(chatAction.action, data.action, raw.action);
};

const handleChatActionEvent = async (
  context: BotEventContext,
  normalized: ReturnType<typeof normalizeWebhookPayload>,
) => {
  const data = toRecord(normalized.data);
  const raw = toRecord(normalized.raw);
  const chat = toRecord(data.chat ?? raw.chat);
  const chatAction = toRecord(data.chatAction ?? raw.chatAction);
  const chatJid = firstString(
    chatAction.chatJid,
    chat.jid,
    chat.id,
    data.chatJid,
    raw.chatJid,
  );
  if (!chatJid) return;

  const action = resolveChatAction(normalized)
    ?.toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!action) return;

  const settings = await getInstanceSettings(context.instance.id);
  const keepDeletedChatsInHistory =
    settings.commandToggles.keepDeletedChatsInHistory ||
    settings.commandToggles.recoverDeletedMessages;
  let thread = await getWhatsappConversationThread(
    context.instance.userId,
    context.instance.id,
    chatJid,
  );
  if (action === "archive" || action === "unarchive") {
    const archived = action === "archive" || chatAction.archived === true;
    thread = await setWhatsappConversationArchivedForUser(
      context.instance.userId,
      context.instance.id,
      chatJid,
      archived,
    );
  } else if (action === "pin" || action === "unpin") {
    const pinned = action === "pin" || chatAction.pinned === true;
    thread = await setWhatsappConversationPinnedForUser(
      context.instance.userId,
      context.instance.id,
      chatJid,
      pinned,
    );
  } else if (action === "clear") {
    await clearWhatsappConversationMessagesForUser(
      context.instance.userId,
      context.instance.id,
      chatJid,
    );
    if (keepDeletedChatsInHistory) {
      thread = await markWhatsappConversationThreadDeletedInInstanceForUser(
        context.instance.userId,
        context.instance.id,
        chatJid,
        {
          action: "clear",
          title: firstString(
            chat.title,
            chat.name,
            chatAction.title,
            chatAction.name,
          ),
        },
      );
    } else {
      thread = await getWhatsappConversationThread(
        context.instance.userId,
        context.instance.id,
        chatJid,
      );
    }
  } else if (action === "delete") {
    if (keepDeletedChatsInHistory) {
      thread = await markWhatsappConversationThreadDeletedInInstanceForUser(
        context.instance.userId,
        context.instance.id,
        chatJid,
        {
          action: "delete",
          title: firstString(
            chat.title,
            chat.name,
            chatAction.title,
            chatAction.name,
          ),
        },
      );
    } else {
      await deleteWhatsappConversationThreadForUser(
        context.instance.userId,
        context.instance.id,
        chatJid,
      );
      thread = null;
    }
  }

  const event = await recordWhatsappRealtimeEvent({
    userId: context.instance.userId,
    instanceId: context.instance.id,
    chatJid,
    eventType: "chat.action",
    messageId: null,
    payload: {
      action,
      archived:
        action === "archive"
          ? true
          : action === "unarchive"
            ? false
            : (chatAction.archived ?? null),
      pinned:
        action === "pin"
          ? true
          : action === "unpin"
            ? false
            : (chatAction.pinned ?? null),
      clearMessages: action === "clear",
      deleteThread: action === "delete" && !keepDeletedChatsInHistory,
      deletedInInstance:
        (action === "delete" || action === "clear") &&
        keepDeletedChatsInHistory,
      keptHistory:
        (action === "delete" || action === "clear") &&
        keepDeletedChatsInHistory,
      chat,
      chatAction,
      thread,
      raw,
    },
  });

  if (event) {
    publishWhatsappRealtimeEvent(event);
  }
};

const handleMessageActionEvent = async (
  context: BotEventContext,
  normalized: ReturnType<typeof normalizeWebhookPayload>,
) => {
  const data = toRecord(normalized.data);
  const raw = toRecord(normalized.raw);
  const chat = toRecord(data.chat ?? raw.chat);
  const messageAction = toRecord(data.messageAction ?? raw.messageAction);
  const chatJid = firstString(
    messageAction.chatJid,
    chat.jid,
    chat.id,
    data.chatJid,
    raw.chatJid,
  );
  const messageId = firstString(
    messageAction.messageId,
    data.messageId,
    raw.messageId,
  );
  if (!chatJid || !messageId) return;

  const settings = await getInstanceSettings(context.instance.id);
  const shouldRecoverDeletedMessages =
    settings.commandToggles.recoverDeletedMessages;
  const deletedByJid = firstString(
    messageAction.deletedByJid,
    messageAction.senderJid,
    messageAction.participant,
    messageAction.actorJid,
    data.deletedByJid,
    raw.deletedByJid,
  );
  const deletedByName = firstString(
    messageAction.deletedByName,
    messageAction.senderName,
    messageAction.actorName,
    data.deletedByName,
    raw.deletedByName,
  );
  const placeholder =
    firstString(messageAction.placeholder, data.placeholder, raw.placeholder) ??
    "Mensagem apagada";
  const visibleMessage = shouldRecoverDeletedMessages
    ? await markWhatsappConversationMessageDeletedForUser(
        context.instance.userId,
        context.instance.id,
        chatJid,
        messageId,
        {
          deletedByJid,
          deletedByName,
          placeholder,
          revealDeletedContent: false,
        },
      )
    : null;

  if (!shouldRecoverDeletedMessages) {
    await deleteWhatsappConversationMessageForUser(
      context.instance.userId,
      context.instance.id,
      chatJid,
      messageId,
    );
  }

  const thread = await getWhatsappConversationThread(
    context.instance.userId,
    context.instance.id,
    chatJid,
  );
  const event = await recordWhatsappRealtimeEvent({
    userId: context.instance.userId,
    instanceId: context.instance.id,
    chatJid,
    eventType: "message.action",
    messageId,
    payload: {
      action: "delete",
      deletedMessageId: messageId,
      revealDeletedContent: false,
      visibleMessage,
      chat,
      messageAction,
      thread,
      raw,
    },
  });

  if (event) {
    publishWhatsappRealtimeEvent(event);
  }
};

const isActivePresenceState = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return ["available", "online"].includes(normalized);
};

const isInactivePresenceState = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return ["offline", "unavailable"].includes(normalized);
};

const presenceDisplayName = (sender: Record<string, unknown>): string =>
  firstString(
    sender.name,
    sender.pushName,
    sender.verifiedName,
    sender.phone,
    sender.user,
    sender.jid,
    sender.id,
  ) ?? "Contato";

const activePresenceNotificationKeys = new Set<string>();
const presenceNotificationSeenAt = new Map<string, number>();
const PRESENCE_NOTIFICATION_STATE_TTL_MS = 10 * 60 * 1000;
const PRESENCE_NOTIFICATION_DEBUG =
  process.env.BOTADMIN_PRESENCE_NOTIFY_DEBUG === "1";

const shouldSendPresenceNotification = (key: string): boolean => {
  const now = Date.now();
  if (activePresenceNotificationKeys.has(key)) return false;

  activePresenceNotificationKeys.add(key);
  presenceNotificationSeenAt.set(key, now);

  if (presenceNotificationSeenAt.size > 5000) {
    const cutoff = now - PRESENCE_NOTIFICATION_STATE_TTL_MS;
    for (const [entryKey, timestamp] of presenceNotificationSeenAt.entries()) {
      if (timestamp < cutoff) {
        presenceNotificationSeenAt.delete(entryKey);
        activePresenceNotificationKeys.delete(entryKey);
      }
    }
  }
  return true;
};

const markPresenceNotificationOffline = (key: string) => {
  activePresenceNotificationKeys.delete(key);
  presenceNotificationSeenAt.delete(key);
};

type OnlinePresenceMonitorTarget = {
  userId: number;
  monitorJids: string[] | null;
};

const normalizePresenceJidCandidates = (
  ...values: Array<string | null | undefined>
): Set<string> => {
  const candidates = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim().toLowerCase();
    if (!trimmed) continue;
    candidates.add(trimmed);
    const digits = trimmed.replace(/\D+/g, "");
    if (digits.length >= 5) {
      candidates.add(digits);
      candidates.add(`${digits}@s.whatsapp.net`);
    }
    if (trimmed.includes("@")) {
      const [localPart, domainPart] = trimmed.split("@");
      const local = localPart.split(":")[0]?.replace(/[^\w.-]+/g, "") ?? "";
      const domain = domainPart?.replace(/[^\w.-]+/g, "") ?? "";
      if (local && domain) {
        candidates.add(`${local}@${domain}`);
        const localDigits = local.replace(/\D+/g, "");
        if (localDigits.length >= 5) {
          candidates.add(localDigits);
          candidates.add(`${localDigits}@s.whatsapp.net`);
        }
      }
    }
  }
  return candidates;
};

const matchesPresenceMonitorList = (
  monitorJids: string[] | null | undefined,
  senderJid: string | null,
  senderPhone: string | null,
): boolean => {
  if (!monitorJids || monitorJids.length === 0) {
    return true;
  }
  const candidates = normalizePresenceJidCandidates(senderJid, senderPhone);
  return monitorJids.some((jid) => {
    for (const candidate of normalizePresenceJidCandidates(jid)) {
      if (candidates.has(candidate)) return true;
    }
    return false;
  });
};

const parsePresenceMonitorTargetRow = (
  row: any,
): OnlinePresenceMonitorTarget | null => {
  const raw = row.command_toggles;
  const parsed =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        })()
      : raw && typeof raw === "object"
        ? raw
        : {};
  if (parsed.notifyOnlinePresence !== true) {
    return null;
  }
  const monitorJids = Array.isArray(parsed.onlinePresenceMonitorJids)
    ? parsed.onlinePresenceMonitorJids
        .map((value: unknown) => String(value))
        .filter(Boolean)
    : null;
  const userId = Number(row.user_id);
  return Number.isFinite(userId) && userId > 0 ? { userId, monitorJids } : null;
};

const listUsersWithOnlinePresenceMonitor = async (): Promise<
  OnlinePresenceMonitorTarget[]
> => {
  const db = getDb();
  const [rows] = await db.query<any[]>(
    `
      SELECT bi.user_id
        , bis.command_toggles
      FROM bot_instance_settings bis
      JOIN bot_instances bi ON bi.id = bis.instance_id
      JOIN push_subscriptions ps ON ps.user_id = bi.user_id
      WHERE ps.platform = 'android'
        AND CAST(bis.command_toggles AS TEXT) LIKE ?
    `,
    ["%notifyOnlinePresence%"],
  );
  return Array.isArray(rows)
    ? rows
        .map(parsePresenceMonitorTargetRow)
        .filter((target): target is OnlinePresenceMonitorTarget =>
          Boolean(target),
        )
    : [];
};

const maybeNotifyOnlinePresence = async (
  context: BotEventContext,
  params: {
    chatJid: string;
    action: string | null;
    chat: Record<string, unknown>;
    sender: Record<string, unknown>;
  },
) => {
  const isActive = isActivePresenceState(params.action);
  const isInactive = isInactivePresenceState(params.action);
  if (!isActive && !isInactive) return;

  const settings = await getInstanceSettings(context.instance.id);
  const senderJid = firstString(
    params.sender.jid,
    params.sender.id,
    params.chat.participantJid,
  );
  const senderPhone = firstString(params.sender.phone, params.sender.user);
  const targetUserIds = new Map<number, string[] | null>();
  if (
    settings.commandToggles.notifyOnlinePresence &&
    matchesPresenceMonitorList(
      settings.commandToggles.onlinePresenceMonitorJids,
      senderJid,
      senderPhone,
    )
  ) {
    targetUserIds.set(
      context.instance.userId,
      settings.commandToggles.onlinePresenceMonitorJids,
    );
  }
  const monitorUsers = await listUsersWithOnlinePresenceMonitor();
  for (const target of monitorUsers) {
    if (
      matchesPresenceMonitorList(target.monitorJids, senderJid, senderPhone)
    ) {
      targetUserIds.set(target.userId, target.monitorJids);
    } else if (PRESENCE_NOTIFICATION_DEBUG) {
      console.info(
        "[whatsapp-push] online presence skipped by contact filter",
        {
          userId: target.userId,
          instanceId: context.instance.id,
          chatJid: params.chatJid,
          senderJid,
          senderPhone,
          monitorCount: target.monitorJids?.length ?? 0,
        },
      );
    }
  }
  if (!targetUserIds.size) return;

  const contactName = presenceDisplayName(params.sender);
  const chatTitle = firstString(
    params.chat.name,
    params.chat.title,
    params.chat.subject,
  );
  const title = contactName || senderPhone || "Contato online";
  const body =
    chatTitle && params.chatJid.toLowerCase().endsWith("@g.us")
      ? `Ficou online em ${chatTitle}.`
      : "Ficou online agora.";

  for (const userId of targetUserIds.keys()) {
    const cooldownKey = `${userId}:${context.instance.id}:${params.chatJid}:${senderJid ?? senderPhone ?? contactName}`;
    if (isInactive) {
      markPresenceNotificationOffline(cooldownKey);
      continue;
    }
    if (!shouldSendPresenceNotification(cooldownKey)) continue;
    if (PRESENCE_NOTIFICATION_DEBUG) {
      console.info("[whatsapp-push] sending online presence notification", {
        userId,
        instanceId: context.instance.id,
        chatJid: params.chatJid,
        senderJid,
        senderPhone,
        title,
      });
    }
    await sendPushNotificationToUser(userId, {
      title,
      body,
      data: {
        type: "whatsapp_presence_online",
        notificationId: "presence-online",
        notification_id: "presence-online",
        storebot_notification_id: "presence-online",
        contactName: title,
        contact_name: title,
        storebot_contact_name: title,
        instanceId: String(context.instance.id),
        instance_id: String(context.instance.id),
        chatJid: params.chatJid,
        chat_jid: params.chatJid,
        senderJid,
        sender_jid: senderJid,
        senderPhone,
        sender_phone: senderPhone,
        presenceState: params.action,
        presence_state: params.action,
        targetUrl: "/dashboard/user/conversas",
      },
      android: {
        channelId: ANDROID_REALTIME_MESSAGES_CHANNEL_ID,
      },
    });
  }
};

const handleRealtimeOnlyEvent = async (
  context: BotEventContext,
  normalized: ReturnType<typeof normalizeWebhookPayload>,
) => {
  const data = toRecord(normalized.data);
  const raw = toRecord(normalized.raw);
  const chat = toRecord(data.chat ?? raw.chat);
  const receipt = toRecord(data.receipt ?? raw.receipt);
  const receiptKey = toRecord(receipt.key ?? receipt.messageKey ?? receipt.message);
  const dataKey = toRecord(data.key ?? data.messageKey ?? data.message);
  const rawKey = toRecord(raw.key ?? raw.messageKey ?? raw.message);
  const presence = toRecord(data.presence ?? raw.presence);
  const history = toRecord(data.history ?? raw.history);
  const sender = toRecord(data.sender ?? raw.sender);
  const chatJid = firstString(
    receipt.chatJid,
    presence.chatJid,
    history.chatJid,
    chat.jid,
    chat.id,
    data.chatJid,
    raw.chatJid,
    sender.jid,
    sender.id,
    `instance-${context.instance.id}@botadmin.local`,
  )!;
  const messageId = firstString(
    receipt.messageId,
    receipt.id,
    receiptKey?.id,
    receiptKey?.messageId,
    Array.isArray(receipt.messageIds) ? receipt.messageIds[0] : null,
    data.messageId,
    data.id,
    dataKey?.id,
    dataKey?.messageId,
    raw.messageId,
    raw.id,
    rawKey?.id,
    rawKey?.messageId,
  );
  const eventType =
    normalized.event === "messages.update"
      ? "message.receipt"
      : normalized.event === "presence.update"
        ? "presence.update"
        : "history.sync";

  const event = await recordWhatsappRealtimeEvent({
    userId: context.instance.userId,
    instanceId: context.instance.id,
    chatJid,
    eventType,
    messageId,
    payload: {
      action: firstString(
        data.action,
        raw.action,
        receipt.state,
        presence.state,
        normalized.type,
      ),
      chat,
      sender,
      receipt,
      presence,
      history,
      raw,
    },
  });

  // Persist delivery/read receipts separately from the raw realtime event.
  // Webhook providers use slightly different field names, so accept all
  // common aliases and keep the transition monotonic (delivered -> read).
  if (eventType === "message.receipt" && messageId) {
    const stateRaw = firstString(
      data.action,
      data.state,
      data.status,
      raw.action,
      raw.state,
      raw.status,
      receipt.state,
      receipt.status,
      receipt.type,
    )?.toLowerCase();
    const state = stateRaw === "read" || stateRaw === "played" || stateRaw === "seen" || stateRaw === "4" || stateRaw === "5"
      ? "read"
      : stateRaw === "delivered" || stateRaw === "delivery" || stateRaw === "received" || stateRaw === "2" || stateRaw === "3"
        ? "delivered"
        : null;
    if (state) {
      const recipientJid = firstString(
        receipt.participant,
        receipt.recipient,
        receipt.recipientJid,
        receipt.remoteJid,
        data.participant,
        data.recipient,
        data.recipientJid,
        raw.participant,
        raw.recipient,
        raw.recipientJid,
      );
      await recordWhatsappMessageReceipt({
        userId: context.instance.userId,
        instanceId: context.instance.id,
        chatJid,
        messageId,
        recipientJid,
        recipientName: firstString(
          receipt.name,
          receipt.pushName,
          data.participantName,
          data.recipientName,
        ),
        state,
        at: firstString(
          receipt.timestamp,
          receipt.at,
          data.timestamp,
          data.at,
          raw.timestamp,
        ),
      }).catch((error) => {
        console.warn("[whatsapp-receipts] failed to persist receipt", {
          messageId,
          chatJid,
          error,
        });
      });
    }
  }

  // Publish only after the normalized receipt is durable. This guarantees
  // that the client refresh triggered by the event already sees the new tick.
  if (event) {
    publishWhatsappRealtimeEvent(event);
  }

  if (eventType === "presence.update") {
    void maybeNotifyOnlinePresence(context, {
      chatJid,
      action: firstString(
        data.action,
        raw.action,
        presence.state,
        normalized.type,
      ),
      chat,
      sender,
    }).catch((error) => {
      console.warn("[whatsapp-push] failed to notify online presence", {
        userId: context.instance.userId,
        instanceId: context.instance.id,
        chatJid,
        error,
      });
    });
  }
};

export const processWuzapiWebhook = async (
  rawPayload: unknown,
  options: { token?: string } = {},
) => {
  startAdsDispatcher();
  startAdminCampaignDispatcher();
  startAntiInactivityDispatcher();
  startHorapgDispatcher();
  startScheduleDispatcher();
  startAffiliateMlGroupDispatcher();
  startAffiliateMlProductsAutoSyncDispatcher();
  startAffiliateShopeeGroupDispatcher();
  startAffiliateShopeeProductsAutoSyncDispatcher();
  startGroupParticipantImportDispatcher();
  startSisregWatcherDispatcher();
  startWhatsappHistoryCleanupDispatcher();
  const normalized = normalizeWebhookPayload(rawPayload);

  if (!ALLOWED_EVENTS.has(normalized.event)) {
    return;
  }

  const tokenCandidates = Array.from(
    new Set(
      [options.token, normalized.token].filter((token): token is string =>
        Boolean(token?.trim()),
      ),
    ),
  );

  if (tokenCandidates.length === 0) {
    throw new BotEventError("Token do webhook não fornecido.", 401);
  }

  let instance = null;
  for (const token of tokenCandidates) {
    instance = await getCachedInstanceByToken(token);
    if (instance) {
      break;
    }
  }

  if (!instance) {
    throw new BotEventError(
      "Instância não encontrada para o token informado.",
      404,
    );
  }

  const context: BotEventContext = { instance };

  await logWebhookEvent(context, normalized);

  // Preserve the local history while a profile is intentionally offline, but
  // do not ingest new messages/actions until the owner starts pairing again.
  if (
    instance.desiredSessionState === "disconnected" &&
    normalized.event !== "instance.status"
  ) {
    return;
  }

  switch (normalized.event) {
    case "message.upsert":
      if (await maybeHandleAdminSystemSignupConfirmation(context, normalized)) {
        break;
      }
      await handleMessageUpsert(context, normalized);
      break;
    case "chat.action":
      await handleChatActionEvent(context, normalized);
      break;
    case "message.action":
      await handleMessageActionEvent(context, normalized);
      break;
    case "messages.update":
    case "presence.update":
    case "history.sync":
      await handleRealtimeOnlyEvent(context, normalized);
      break;
    case "call.update":
      await handleCallEvent(context, normalized);
      break;
    case "instance.status":
      await handleInstanceStatusEvent(context, normalized);
      break;
    case "status.update":
      await handleStatusUpdate(context, normalized);
      break;
    case "group.update":
    case "group.info":
    case "group.picture":
    case "group.joined":
      await handleGroupEvent(context, normalized);
      break;
    default:
      break;
  }
};
