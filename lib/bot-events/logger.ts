import { formatDateTime } from "lib/format";
import { getCachedGroupByRemoteId } from "lib/bot-events/cache";
import { normalizeJid } from "lib/whatsapp";
import type { BotEventContext, NormalizedWebhookPayload } from "./types";
import { BOT_EVENTS_RAW_LOGS } from "./debug";

const VERBOSE = (() => {
  const v = (process.env.WEBHOOK_VERBOSE_LOGS || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
})();

const ACTIVITY_LOGS_ENABLED = (() => {
  const value = (process.env.BOT_EVENT_ACTIVITY_LOGS || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return VERBOSE || BOT_EVENTS_RAW_LOGS;
})();

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    } else if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
};

const truncate = (value: string, max = 80) => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
};

const maskIdentifier = (jid: string | null | undefined): string => {
  if (!jid) {
    return "-";
  }

  const trimmed = jid.trim();
  if (!trimmed) {
    return "-";
  }
  if (trimmed === "-") {
    return "-";
  }

  const [local, domain] = trimmed.split("@");
  if (!local) {
    return trimmed;
  }

  const digits = local.replace(/\D+/g, "");
  if (!digits) {
    return `${local.slice(0, Math.min(4, local.length))}…${domain ? `@${domain}` : ""}`;
  }

  const prefix = digits.slice(0, Math.min(3, digits.length));
  const suffix = digits.slice(-2);
  return `${prefix}***${suffix}${domain ? `@${domain}` : ""}`;
};

const renderBox = (title: string, rows: Array<{ label: string; value: string | null }>) => {
  const filtered = rows.filter((row) => row.value && row.value.trim().length > 0);
  if (filtered.length === 0) {
    return;
  }

  const labelWidth = Math.max(...filtered.map((row) => row.label.length));
  const formatted = filtered.map((row) => {
    const label = row.label.padEnd(labelWidth, " ");
    return `${label}: ${row.value}`;
  });

  const contentWidth = Math.max(...formatted.map((line) => line.length));
  const horizontal = "─".repeat(contentWidth + 2);
  const normalizedTitle = title.toUpperCase();
  const titlePadding = Math.max(0, contentWidth - normalizedTitle.length);
  const left = Math.floor(titlePadding / 2);
  const right = contentWidth - normalizedTitle.length - left;

  console.log(`\x1b[36m╭─${horizontal}─╮`);
  console.log(`│ ${" ".repeat(left)}${normalizedTitle}${" ".repeat(right)} │`);
  for (const line of formatted) {
    const extra = contentWidth - line.length;
    console.log(`│ ${line}${" ".repeat(extra)} │`);
  }
  console.log(`╰─${horizontal}─╯\x1b[0m`);
};

const extractMessageDetails = (message: Record<string, unknown>) => {
  const candidates = [
    toRecord(message.extendedTextMessage ?? {}),
    toRecord(message.conversation ? { text: message.conversation } : {}),
    toRecord(message.imageMessage ?? {}),
    toRecord(message.videoMessage ?? {}),
    toRecord(message.documentMessage ?? {}),
    toRecord(message.audioMessage ?? {}),
    toRecord(message.stickerMessage ?? {}),
    toRecord(message.buttonsResponseMessage ?? {}),
    toRecord(message.listResponseMessage ?? {}),
    toRecord(message.templateButtonReplyMessage ?? {}),
    toRecord(message.contactsArrayMessage ?? {}),
  ];

  let type: string | null = null;
  let mimeType: string | null = null;
  let preview: string | null = null;

  if (typeof message.conversation === "string" && message.conversation.trim()) {
    preview = message.conversation.trim();
    type = "text";
  }

  const ext = toRecord(message.extendedTextMessage);
  if (!preview) {
    const text = firstString(ext.text, ext.caption);
    if (text) {
      preview = text;
      type = "text";
    }
  }

  const orderedKeys = [
    "imageMessage",
    "videoMessage",
    "documentMessage",
    "audioMessage",
    "stickerMessage",
  ] as const;

  for (const key of orderedKeys) {
    if (message[key]) {
      type = key.replace("Message", "").toLowerCase();
      const entry = toRecord(message[key]);
      mimeType = firstString(entry.mimetype, entry.mimeType, entry.MimeType, entry.mediaType);
      if (!preview) {
        preview = firstString(entry.caption, entry.text, entry.body);
      }
      break;
    }
  }

  if (!preview) {
    for (const candidate of candidates) {
      const text = firstString(candidate.text, candidate.caption, candidate.body, candidate.title);
      if (text) {
        preview = text;
        break;
      }
    }
  }

  return {
    type: type ?? "text",
    mimeType: mimeType ?? null,
    preview: preview ? truncate(preview) : null,
  };
};

export const logWebhookEvent = async (
  context: BotEventContext,
  payload: NormalizedWebhookPayload,
) => {
  if (!ACTIVITY_LOGS_ENABLED) {
    return;
  }

  const data = toRecord(payload.data);
  const info = toRecord(data.Info);
  const normalized = toRecord(data.normalized);
  const eventChat = toRecord(data.chat);
  const eventSender = toRecord(data.sender);
  const eventMessage = toRecord(data.message);
  const rawMessage =
    data.Message && typeof data.Message === "object"
      ? (data.Message as Record<string, unknown>)
      : toRecord((data as Record<string, unknown>).message);

  const instanceLabel = `${context.instance.name} (${context.instance.phone})`;
  const instanceExpiry = (() => {
    if (!context.instance.expiresAt) {
      return "Sem vencimento";
    }
    const expires = new Date(context.instance.expiresAt);
    if (Number.isNaN(expires.getTime())) {
      return "Vencimento inválido";
    }
    return expires.getTime() > Date.now()
      ? `Válido até ${formatDateTime(expires.toISOString())}`
      : `VENCIDO em ${formatDateTime(expires.toISOString())}`;
  })();

  const chatId =
    firstString(
      normalized.remoteJid,
      normalized.groupId,
      eventChat.id,
      eventChat.jid,
      eventMessage.chatId,
      info.Chat,
      info.chat,
      data.chat as string,
      data.chatId as string,
    ) ?? "-";
  const senderJid = normalizeJid(
    firstString(
      normalized.senderJid,
      normalized.participant,
      eventSender.id,
      eventSender.jid,
      eventSender.phone,
      eventSender.lid,
      eventChat.participantJid,
      toRecord(eventChat.participant).jid,
      data.participant,
      info.ParticipantNormalized,
      info.Sender,
      info.sender,
      data.sender as string,
      (toRecord(data.key ?? {})).participant,
    ) ?? "",
  );

  const pushName =
    firstString(
      info.PushName,
      info.pushname,
      normalized.displayName,
      eventSender.name,
      eventSender.pushName,
      eventSender.displayName,
      data.pushName as string,
      data.name as string,
    ) ?? "-";

  const isGroup =
    Boolean(info.IsGroup === true || info.isGroup === true) ||
    (typeof chatId === "string" && chatId.endsWith("@g.us"));

  let groupName =
    firstString(
      info.GroupName,
      info.groupName,
      info.DisplayName,
      info.displayName,
      data.groupName as string,
    ) ?? null;

  if (isGroup && (!groupName || groupName === pushName)) {
    try {
      const cached = await getCachedGroupByRemoteId(context.instance.id, chatId);
      if (cached?.name) {
        groupName = cached.name;
      }
    } catch {
      /* ignore lookup failures */
    }
  }

  const messageDetails =
    payload.event === "message.upsert" ? extractMessageDetails(rawMessage) : null;

  const messageTimestamp =
    firstString(info.Timestamp, info.timestamp, data.timestamp as string) ?? null;

  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Evento", value: payload.event },
    { label: "Instância", value: instanceLabel },
    { label: "Plano", value: instanceExpiry },
    { label: isGroup ? "Grupo" : "Contato", value: chatId || "-" },
    { label: "PushName", value: pushName },
    { label: "Remetente", value: senderJid ? maskIdentifier(`@${senderJid}`) : "-" },
  ];

  if (messageTimestamp) {
    rows.push({ label: "Recebido", value: formatDateTime(messageTimestamp) });
  }

  if (messageDetails) {
    rows.push({ label: "Tipo", value: messageDetails.type });
    rows.push({ label: "MIME", value: messageDetails.mimeType });
    rows.push({ label: "Prévia", value: messageDetails.preview });
  }

  renderBox("WebHook", rows);

  if (VERBOSE || BOT_EVENTS_RAW_LOGS) {
    try {
      const rawDump = JSON.stringify(payload.raw ?? payload, null, 2);
      console.log("[RAW PAYLOAD]", rawDump);
    } catch (_error) {
      console.log("[RAW PAYLOAD] <não serializável>");
    }

    try {
      const dataDump = JSON.stringify(payload.data ?? null, null, 2);
      console.log("[DATA]", dataDump);
    } catch (_error) {
      console.log("[DATA] <não serializável>");
    }
  }
};
