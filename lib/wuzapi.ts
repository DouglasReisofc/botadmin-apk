import "lib/runtime/ensure-web-streams";
import {
  deriveStickerPackId,
  STICKER_PACK_AUTHOR,
  STICKER_PACK_ID,
  STICKER_PACK_NAME,
} from "lib/sticker";
import { normalizeJid, stripJidDevice } from "lib/whatsapp";
import { recordWhatsappConversationMessage } from "lib/whatsapp-conversations";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { redisGetJson, redisKey, redisSetJson } from "lib/redis";

type SerializableBody = Record<string, unknown> | Array<unknown>;

type RequestInitExtra = Omit<RequestInit, "body"> & {
  expectedStatus?: number;
  body?: RequestInit["body"] | SerializableBody;
};

export type WuzapiClient = {
  baseUrl: string;
  token: string;
  conversation?: {
    userId: number;
    instanceId: number;
    instanceName?: string | null;
    instancePhone?: string | null;
  };
};

type LidPhoneCacheEntry = {
  expiresAt: number;
  phoneDigits: string | null;
};

const LID_PHONE_CACHE = new Map<string, LidPhoneCacheEntry>();
const LID_PHONE_CACHE_TTL_MS = 10 * 60_000;
const LID_PHONE_MISS_TTL_MS = 30_000;

export type ChatMessageLookupResult = {
  ID?: string;
  Chat?: string;
  Sender?: string;
  Message?: Record<string, unknown>;
  Media?: Record<string, unknown>;
};

export type SendMediaPayload = {
  to: string;
  media: Buffer | string;
  mediaType: "image" | "video" | "audio" | "document";
  caption?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  quoted?: { stanzaId: string; participant?: string | null } | null;
  mentions?: string[] | null;
  mentionAll?: boolean | null;
  useExternalUrl?: boolean | null;
  gifPlayback?: boolean | null;
  isAnimated?: boolean | null;
  viewOnce?: boolean | null;
};

export type StickerPackItem = {
  sticker: string;
  fileName?: string | null;
  mimeType?: string | null;
  emojis?: string[] | null;
  accessibilityLabel?: string | null;
  isLottie?: boolean | null;
};

export type SendStickerPackPayload = {
  to: string;
  stickers: StickerPackItem[];
  pack?: string | null;
  author?: string | null;
  packId?: string | null;
  caption?: string | null;
  description?: string | null;
  quoted?: { stanzaId: string; participant?: string | null } | null;
  mentions?: string[] | null;
  mentionAll?: boolean | null;
};

export type InteractiveButton = {
  id: string;
  text: string;
  type?: "quick_reply" | "cta_url" | "cta_copy" | "cta_call" | "single_select";
  url?: string | null;
  merchantUrl?: string | null;
  phoneNumber?: string | null;
  copyCode?: string | null;
  payload?: Record<string, unknown> | null;
  payloadJson?: string | null;
};

export type InteractiveHeaderMedia = {
  type: "image" | "video" | "document";
  media: Buffer | string;
  mimeType?: string | null;
  fileName?: string | null;
  sourceUrl?: string | null;
};

export type SendInteractiveButtonsParams = {
  to: string;
  title: string;
  body?: string | null;
  footer?: string | null;
  buttons: InteractiveButton[];
  quoted?: { stanzaId: string; participant?: string | null } | null;
  headerMedia?: InteractiveHeaderMedia | null;
  buttonType?: "native" | "legacy";
  mentions?: string[] | null;
};

export type WhatsAppFormField = {
  key: string;
  label: string;
  type?: "text" | "text_input" | "text_area" | "email" | "phone" | "number";
  required?: boolean;
  placeholder?: string | null;
};

export type SendWhatsAppFormParams = {
  to: string;
  body: string;
  title?: string | null;
  footer?: string | null;
  cta?: string | null;
  flowId: string;
  flowToken?: string | null;
  screen?: string | null;
  mode?: "draft" | "published" | null;
  flowMetadata?: Record<string, unknown> | null;
  fields: WhatsAppFormField[];
  data?: Record<string, unknown> | null;
  quoted?: { stanzaId: string; participant?: string | null } | null;
  mentions?: string[] | null;
};

export type SendInteractiveResponseParams = {
  to: string;
  responseType: "button" | "list" | "flow";
  selectedId: string;
  selectedText: string;
  description?: string | null;
  nativeName?: string | null;
  version?: number | null;
  params?: Record<string, unknown> | null;
  quoted?: {
    stanzaId: string;
    participant?: string | null;
    sourceInteractive?: Record<string, unknown> | null;
  } | null;
};

export type ListMessageRow = {
  title: string;
  description?: string | null;
  rowId?: string | null;
  id?: string | null;
  header?: string | null;
};

export type ListMessageSection = {
  title: string;
  rows: ListMessageRow[];
  highlightLabel?: string | null;
};

export type ListMessageButton = {
  id?: string | null;
  text?: string | null;
  buttonText?: string | null;
  type?: "quick_reply" | "cta_url" | "cta_copy" | "cta_call";
  url?: string | null;
  phoneNumber?: string | null;
  copyCode?: string | null;
};

export type ListMessageMedia = {
  type: "image" | "video" | "document";
  media: Buffer | string;
  mimeType?: string | null;
  fileName?: string | null;
  sourceUrl?: string | null;
};

export type ListMessageList = {
  buttonText: string;
  sections: ListMessageSection[];
};

export type ListMessageCard = {
  title?: string | null;
  description?: string | null;
  footerText?: string | null;
  buttonText?: string | null;
  sections?: ListMessageSection[];
  lists?: ListMessageList[];
  buttons?: ListMessageButton[];
  media?: ListMessageMedia | null;
};

// Keep the list inside one carousel card. This exact envelope renders on both
// Android and iPhone; cleanflow removes fields that make some clients discard it.
export const DEFAULT_LIST_MESSAGE_TRANSPORT =
  "carousel_card_image_notitle_subtext_nocaption_noctx_cleanflow_annot_bizinteractive";

export type SendListMessageParams = {
  to: string;
  title: string;
  description: string;
  buttonText?: string | null;
  footerText?: string | null;
  sections?: ListMessageSection[];
  lists?: ListMessageList[];
  buttons?: ListMessageButton[];
  cards?: ListMessageCard[];
  media?: ListMessageMedia | null;
  transport?:
    | typeof DEFAULT_LIST_MESSAGE_TRANSPORT
    | "carousel_no_card_header"
    | "carousel"
    | "sendlist"
    | "evolution"
    | string;
};

const sanitizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const getInternalAppBaseUrl = (): string | null => {
  const raw = process.env.INTERNAL_APP_URL?.trim();
  if (!raw) {
    return null;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, "");
  }
  return `http://${raw.replace(/\/+$/, "")}`;
};

const getPublicAppBaseUrls = (): string[] => {
  const values = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_CAP_SERVER_URL,
    process.env.NOTIFICATIONS_APP_URL,
  ];
  const urls: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    urls.push(trimmed.replace(/\/+$/, ""));
  }
  return Array.from(new Set(urls));
};

const resolveOwnAppFetchUrl = (input: string): string => {
  const internalBaseUrl = getInternalAppBaseUrl();
  if (!internalBaseUrl) {
    return input;
  }

  const trimmed = input.trim();
  if (/^\/?(?:uploads|storage\/uploads)\//i.test(trimmed)) {
    const pathname = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return new URL(pathname, `${internalBaseUrl}/`).toString();
  }

  try {
    const target = new URL(trimmed);
    const publicCandidates = getPublicAppBaseUrls();
    for (const candidate of publicCandidates) {
      try {
        const publicUrl = new URL(candidate);
        if (target.host === publicUrl.host) {
          return new URL(
            `${target.pathname}${target.search}${target.hash}`,
            `${internalBaseUrl}/`,
          ).toString();
        }
      } catch {
        /* ignore invalid public candidate */
      }
    }
  } catch {
    return trimmed;
  }

  return trimmed;
};

const buildHeaders = (token: string, initHeaders?: HeadersInit): Headers => {
  const headers = new Headers(initHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("accept", "application/json");
  headers.set("token", token);
  return headers;
};

const readRequestTimeoutMs = (
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
};

const WUZAPI_REQUEST_TIMEOUT_MS = readRequestTimeoutMs(
  process.env.WUZAPI_REQUEST_TIMEOUT_MS,
  45_000,
  5_000,
  300_000,
);
const WUZAPI_MEDIA_DOWNLOAD_TIMEOUT_MS = readRequestTimeoutMs(
  process.env.WUZAPI_MEDIA_DOWNLOAD_TIMEOUT_MS,
  20_000,
  5_000,
  120_000,
);

type NormalizedRecipient = {
  raw: string;
  phone: string;
  phoneDigits: string;
  jid: string | null;
  domain: string | null;
};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const normalizeRecipientAddress = (value: string): NormalizedRecipient => {
  const raw = typeof value === "string" ? value.trim() : "";
  const digits = raw.replace(/\D+/g, "");
  const atIndex = raw.indexOf("@");
  const domain = atIndex >= 0 ? raw.slice(atIndex + 1).toLowerCase() : null;

  let phone = raw;
  if (!raw) {
    phone = "";
  } else if (!domain) {
    phone = digits || raw;
  } else if (
    domain === "c.us" ||
    domain === "s.whatsapp.net" ||
    domain === "whatsapp.net"
  ) {
    phone = digits || raw;
  }

  let jid: string | null = null;
  if (!raw) {
    jid = null;
  } else if (!domain) {
    jid = digits ? `${digits}@s.whatsapp.net` : null;
  } else if (
    domain === "c.us" ||
    domain === "s.whatsapp.net" ||
    domain === "whatsapp.net"
  ) {
    jid = digits ? `${digits}@s.whatsapp.net` : raw;
  } else {
    jid = raw;
  }

  return {
    raw,
    phone,
    phoneDigits: digits,
    jid,
    domain,
  };
};

const applyRecipientToPayload = (
  payload: Record<string, unknown>,
  to: string,
): NormalizedRecipient => {
  const normalized = normalizeRecipientAddress(to);
  const phoneValue = normalized.phone || normalized.raw || "";
  payload.Phone = phoneValue;
  payload.phone = phoneValue;
  if (normalized.jid && normalized.jid !== phoneValue) {
    payload.JID = normalized.jid;
    payload.jid = normalized.jid;
  }
  return normalized;
};

const cloneJsonSafe = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return value as Record<string, unknown>;
  }
};

const normalizeOutgoingSenderJid = (
  phone: string | null | undefined,
): string | null => {
  const digits = typeof phone === "string" ? phone.replace(/\D+/g, "") : "";
  return digits ? `${digits}@s.whatsapp.net` : null;
};

const toButtonDescriptor = (
  button: Record<string, unknown>,
): Record<string, unknown> => ({
  id: firstString(button.ButtonId, button.buttonId, button.id, button.Id) ?? "",
  title:
    firstString(
      button.ButtonText,
      button.buttonText,
      button.DisplayText,
      button.displayText,
      button.text,
      button.title,
      button.buttonText,
    ) ?? "Botão",
  description:
    firstString(
      button.Description,
      button.description,
      button.Subtitle,
      button.subtitle,
    ) ?? "",
  type: firstString(button.Type, button.type, button.name, button.Name) ?? "",
  url:
    firstString(
      button.Url,
      button.url,
      button.MerchantUrl,
      button.merchantUrl,
    ) ?? "",
  phoneNumber: firstString(button.PhoneNumber, button.phoneNumber) ?? "",
  copyCode: firstString(button.CopyCode, button.copyCode) ?? "",
});

const toListSectionDescriptor = (
  section: Record<string, unknown>,
): Record<string, unknown> => {
  const rows = Array.isArray(section.rows)
    ? section.rows
        .map((row) =>
          row && typeof row === "object" && !Array.isArray(row)
            ? (row as Record<string, unknown>)
            : null,
        )
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          id: firstString(row.id, row.Id, row.rowId, row.RowId) ?? "",
          rowId: firstString(row.rowId, row.RowId, row.id, row.Id) ?? "",
          title:
            firstString(row.title, row.Title, row.name, row.Name) ?? "Item",
          description: firstString(row.description, row.Description) ?? "",
        }))
    : [];
  return {
    title:
      firstString(section.title, section.Title, section.name, section.Name) ??
      "Opções",
    rows,
  };
};

const toListSectionsDescriptor = (
  sections: unknown,
): Record<string, unknown>[] =>
  Array.isArray(sections)
    ? sections
        .map((section) =>
          section && typeof section === "object" && !Array.isArray(section)
            ? toListSectionDescriptor(section as Record<string, unknown>)
            : null,
        )
        .filter((section): section is Record<string, unknown> =>
          Boolean(section),
        )
    : [];

const recordOutgoingConversationMessage = async (
  client: WuzapiClient,
  params: {
    to: string;
    messageId: string | null;
    messageType: string;
    text?: string | null;
    media?: Record<string, unknown> | null;
    raw?: Record<string, unknown> | null;
  },
) => {
  const conversation = client.conversation;
  if (!conversation?.userId || !conversation?.instanceId) return;

  const recipient = normalizeRecipientAddress(params.to);
  const chatJid = recipient.jid ?? recipient.raw;
  if (!chatJid) return;

  try {
    await recordWhatsappConversationMessage({
      userId: conversation.userId,
      instanceId: conversation.instanceId,
      chatJid,
      messageId: params.messageId,
      direction: "outbound",
      senderJid: normalizeOutgoingSenderJid(conversation.instancePhone),
      senderName: conversation.instanceName ?? "Bot",
      messageType: params.messageType,
      text: params.text ?? null,
      media: params.media ?? null,
      raw: params.raw ?? null,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error(
      "[whatsapp-conversations] Falha ao registrar mensagem enviada pelo bot",
      {
        userId: conversation.userId,
        instanceId: conversation.instanceId,
        chatJid,
        messageId: params.messageId,
        messageType: params.messageType,
        error,
      },
    );
  }
};

const requestWuzapi = async <T = unknown>(
  client: WuzapiClient,
  path: string,
  init: RequestInitExtra = {},
): Promise<T> => {
  const base = sanitizeBaseUrl(client.baseUrl);
  const url = path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const { expectedStatus, headers, body, ...rest } = init;
  const requestInit: RequestInit = {
    ...rest,
    headers: buildHeaders(client.token, headers),
    signal: rest.signal ?? AbortSignal.timeout(WUZAPI_REQUEST_TIMEOUT_MS),
  };

  const hasStructuredBody =
    body !== undefined &&
    body !== null &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(body as ArrayBufferView) &&
    !(body instanceof ReadableStream);

  if (hasStructuredBody) {
    requestInit.body = JSON.stringify(body);
  } else {
    requestInit.body = body as BodyInit | null | undefined;
  }

  const response = await fetch(url, requestInit);
  const expected = expectedStatus ?? (response.ok ? response.status : 200);

  let payload: unknown = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      payload = await response.text();
    } catch {
      payload = null;
    }
  }

  if (response.status !== expected || !response.ok) {
    const message =
      (payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : response.statusText) || "Falha na comunicação com a Wuzapi.";
    const error = new Error(message);
    (error as { response?: unknown }).response = payload;
    (error as { status?: number }).status = response.status;
    throw error;
  }

  return payload as T;
};

const requestWuzapiBinary = async (
  client: WuzapiClient,
  path: string,
  init: RequestInitExtra = {},
): Promise<Buffer> => {
  const base = sanitizeBaseUrl(client.baseUrl);
  const url = path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const { headers, body, ...rest } = init;
  const requestInit: RequestInit = {
    ...rest,
    headers: buildHeaders(client.token, headers),
    signal: rest.signal ?? AbortSignal.timeout(WUZAPI_REQUEST_TIMEOUT_MS),
  };
  const hasStructuredBody =
    body &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams);
  requestInit.body = hasStructuredBody ? JSON.stringify(body) : (body as any);
  const response = await fetch(url, requestInit);
  const contentType = response.headers.get("content-type") || "";
  // Se a API retornar JSON com base64, converte para Buffer
  if (
    contentType.includes("application/json") ||
    contentType.includes("text/plain") ||
    contentType.startsWith("text/")
  ) {
    const text = await response.text().catch(() => "");
    try {
      const json = JSON.parse(text) as Record<string, unknown>;

      // Procura profundamente por um campo base64 útil (Data/base64/buffer)
      const visited = new Set<unknown>();
      const findBase64Deep = (node: unknown): string | null => {
        if (typeof node === "string") {
          const s = node.trim();
          if (!s) return null;
          if (s.startsWith("data:")) return s;
          if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 100) return s;
          if (
            (s.startsWith("{") && s.endsWith("}")) ||
            (s.startsWith("[") && s.endsWith("]"))
          ) {
            try {
              return findBase64Deep(JSON.parse(s));
            } catch {
              return null;
            }
          }
          return null;
        }
        if (!node || typeof node !== "object") return null;
        if (visited.has(node)) return null;
        visited.add(node);
        const obj = node as Record<string, unknown>;
        const keys = Object.keys(obj);
        for (const k of keys) {
          const v = obj[k];
          if (typeof v === "string") {
            const s = v.trim();
            if (!s) continue;
            // Aceita data URI ou base64 plausível
            if (s.startsWith("data:")) return s;
            if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 100) return s;
          }
        }
        for (const v of Object.values(obj)) {
          const found = findBase64Deep(v);
          if (found) return found;
        }
        return null;
      };

      // Preferência: caminhos comuns
      const directCandidates: unknown[] = [
        (json as any).Data,
        (json as any).data,
        (json as any).buffer,
        (json as any).Buffer,
        (json as any).base64,
        (json as any).Base64,
      ];
      let b64: string | undefined;
      for (const c of directCandidates) {
        if (typeof c === "string" && c.trim()) {
          b64 = c.trim();
          break;
        }
      }
      if (!b64) {
        const deep = findBase64Deep((json as any).data) || findBase64Deep(json);
        if (deep) b64 = deep;
      }
      if (b64) {
        const dataUriMatch = /^data:[^,]*;base64,([\s\S]*)$/i.exec(b64);
        const cleaned = dataUriMatch ? dataUriMatch[1] : b64;
        return Buffer.from(cleaned, "base64");
      }

      // Se veio um erro estruturado, propaga
      if (
        json &&
        typeof json === "object" &&
        typeof (json as { error?: unknown }).error === "string"
      ) {
        const err = new Error((json as { error: string }).error);
        (err as any).status = response.status;
        throw err;
      }

      // Fallback: se texto parecer base64 puro, tenta decodificar
      const trimmed = text.trim();
      if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 100) {
        try {
          return Buffer.from(trimmed, "base64");
        } catch {
          /* ignore */
        }
      }
    } catch {
      // Não era JSON; tenta base64 puro
      const trimmed = (text || "").trim();
      if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 100) {
        try {
          return Buffer.from(trimmed, "base64");
        } catch {
          /* ignore */
        }
      }
    }
    if (!response.ok) {
      const err = new Error(
        text || `Falha na comunicação (${response.status})`,
      );
      (err as any).status = response.status;
      throw err;
    }
    throw new Error("Resposta da Wuzapi não contém mídia base64 válida.");
  }

  // Conteúdo binário direto
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(text || `Falha na comunicação (${response.status})`);
    (err as any).status = response.status;
    throw err;
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const markMessageRead = async (
  client: WuzapiClient,
  params: { chatId: string; messageId?: string; sender?: string | null },
) => {
  await requestWuzapi(client, "/chat/markread", {
    method: "POST",
    body: {
      Chat: params.chatId,
      Id: params.messageId ? [params.messageId] : [],
      Sender: params.sender ?? undefined,
    },
  });
};

export const sendChatPresence = async (
  client: WuzapiClient,
  params: { to: string; state: "composing" | "paused"; media?: "audio" | null },
) => {
  const payload: Record<string, unknown> = {
    Phone: params.to,
    State: params.state,
  };
  if (params.media) {
    payload.Media = params.media;
  }
  await requestWuzapi(client, "/chat/presence", {
    method: "POST",
    body: payload,
  });
};

export const subscribeUserPresence = async (
  client: WuzapiClient,
  params: { contacts: string[] },
): Promise<unknown> => {
  const contacts = params.contacts
    .map((contact) => (typeof contact === "string" ? contact.trim() : ""))
    .filter(Boolean);

  if (!contacts.length) {
    return { Subscribed: [], Failed: [], Invalid: [] };
  }

  return requestWuzapi(client, "/user/presence/subscribe", {
    method: "POST",
    body: {
      Contacts: contacts,
      JIDs: contacts,
      Phones: contacts,
    },
  });
};

export const downloadViewOnce = async (
  client: WuzapiClient,
  params: { chatId: string; messageId: string },
): Promise<{ buffer: Buffer; mimeType: string; fileName?: string | null }> => {
  const payload = { Chat: params.chatId, MessageID: params.messageId } as const;
  // Usa requestWuzapi para obter JSON e preservar metadados
  const json = await requestWuzapi<Record<string, unknown>>(
    client,
    "/chat/downloadviewonce",
    {
      method: "POST",
      body: payload,
    },
  );

  const obj = json && typeof json === "object" ? json : {};
  const dataNode = (obj as any).data || obj;
  let base64: string | null = null;
  let mime: string | null = null;
  let fileName: string | null = null;

  if (dataNode && typeof dataNode === "object") {
    base64 =
      typeof (dataNode as any).Data === "string"
        ? (dataNode as any).Data
        : typeof (dataNode as any).data === "string"
          ? (dataNode as any).data
          : null;
    mime =
      typeof (dataNode as any).Mimetype === "string"
        ? (dataNode as any).Mimetype
        : typeof (dataNode as any).mimetype === "string"
          ? (dataNode as any).mimetype
          : null;
    fileName =
      typeof (dataNode as any).FileName === "string"
        ? (dataNode as any).FileName
        : typeof (dataNode as any).fileName === "string"
          ? (dataNode as any).fileName
          : null;
  }

  if (base64) {
    const trimmed = base64.trim();
    const cleaned = trimmed.startsWith("data:")
      ? trimmed.replace(/^data:[^;]+;base64,/, "")
      : trimmed;
    const buffer = Buffer.from(cleaned, "base64");
    return { buffer, mimeType: mime || "application/octet-stream", fileName };
  }

  // Fallback para binário simples
  const buf = await requestWuzapiBinary(client, "/chat/downloadviewonce", {
    method: "POST",
    body: payload,
  });
  return { buffer: buf, mimeType: "application/octet-stream", fileName: null };
};

export const deleteMessageForEveryone = async (
  client: WuzapiClient,
  params: { chatId: string; messageId: string; participant?: string | null },
) => {
  const payload: Record<string, unknown> = {
    Id: params.messageId,
  };
  applyRecipientToPayload(payload, params.chatId);
  if (params.participant) {
    const trimmed = String(params.participant).trim();
    if (trimmed) {
      const hasExplicitDomain = trimmed.includes("@");
      const normalized = hasExplicitDomain ? "" : normalizeJid(trimmed);
      payload.Participant = normalized || stripJidDevice(trimmed) || trimmed;
    }
  }

  await requestWuzapi(client, "/chat/delete", {
    method: "POST",
    body: payload,
  });
};

export const pinMessageInChat = async (
  client: WuzapiClient,
  params: {
    chatId: string;
    messageId: string;
    participant?: string | null;
    fromMe?: boolean;
  },
) => {
  const payload: Record<string, unknown> = {
    Id: params.messageId,
    FromMe: Boolean(params.fromMe),
  };
  applyRecipientToPayload(payload, params.chatId);
  if (params.participant) {
    const trimmed = String(params.participant).trim();
    if (trimmed) {
      const normalized = normalizeJid(trimmed);
      payload.Participant = normalized || trimmed;
    }
  }

  await requestWuzapi(client, "/chat/message/pin", {
    method: "POST",
    body: payload,
  });
};

export type WuzapiChatAction =
  "archive" | "unarchive" | "pin" | "unpin" | "clear" | "delete";

const CHAT_ACTION_ENDPOINTS: Record<WuzapiChatAction, string> = {
  archive: "/chat/archive",
  unarchive: "/chat/unarchive",
  pin: "/chat/pin",
  unpin: "/chat/unpin",
  clear: "/chat/clear",
  delete: "/chat/delete-chat",
};

export const runChatAction = async (
  client: WuzapiClient,
  params: { chatId: string; action: WuzapiChatAction },
) => {
  const endpoint = CHAT_ACTION_ENDPOINTS[params.action];
  await requestWuzapi(client, endpoint, {
    method: "POST",
    body: {
      Chat: params.chatId,
      JID: params.chatId,
    },
  });
};

export const rejectWhatsappCall = async (
  client: WuzapiClient,
  params: { callId: string; chatJid: string; callCreator?: string | null },
) => {
  const payload: Record<string, unknown> = {
    CallID: params.callId,
    ID: params.callId,
    From: params.chatJid,
    To: params.chatJid,
    Chat: params.chatJid,
  };
  if (params.callCreator?.trim()) {
    payload.CallCreator = params.callCreator.trim();
    payload.Creator = params.callCreator.trim();
  }

  return requestWuzapi(client, "/call/reject", {
    method: "POST",
    body: payload,
  });
};

export type WhatsappCallActionPayload = Record<string, unknown>;

export const startWhatsappCall = async (
  client: WuzapiClient,
  params: { chatJid: string; phone?: string | null; video?: boolean | null },
): Promise<WhatsappCallActionPayload> => {
  const payload: Record<string, unknown> = {
    To: params.chatJid,
    to: params.chatJid,
    Chat: params.chatJid,
    chat: params.chatJid,
    Video: Boolean(params.video),
    video: Boolean(params.video),
  };
  const normalized = applyRecipientToPayload(
    payload,
    params.phone?.trim() || params.chatJid,
  );
  if (normalized.jid) {
    payload.JID = normalized.jid;
    payload.jid = normalized.jid;
  }
  if (params.phone?.trim()) {
    payload.Phone = params.phone.trim();
    payload.phone = params.phone.trim();
  }

  return requestWuzapi(client, "/call/start", {
    method: "POST",
    body: payload,
  });
};

export const acceptWhatsappCall = async (
  client: WuzapiClient,
  params: {
    callId: string;
    chatJid?: string | null;
    callCreator?: string | null;
  },
): Promise<WhatsappCallActionPayload> => {
  const payload: Record<string, unknown> = {
    CallID: params.callId,
    callId: params.callId,
    ID: params.callId,
    id: params.callId,
  };
  if (params.chatJid?.trim()) {
    payload.From = params.chatJid.trim();
    payload.To = params.chatJid.trim();
    payload.Chat = params.chatJid.trim();
    payload.chat = params.chatJid.trim();
  }
  if (params.callCreator?.trim()) {
    payload.CallCreator = params.callCreator.trim();
    payload.Creator = params.callCreator.trim();
  }

  try {
    return await requestWuzapi(
      client,
      `/call/${encodeURIComponent(params.callId)}/accept`,
      {
        method: "POST",
        body: payload,
      },
    );
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status && status !== 404 && status !== 405) throw error;
    return requestWuzapi(client, "/call/accept", {
      method: "POST",
      body: payload,
    });
  }
};

export const endWhatsappCall = async (
  client: WuzapiClient,
  params: { callId: string; chatJid?: string | null },
): Promise<WhatsappCallActionPayload> => {
  const payload: Record<string, unknown> = {
    CallID: params.callId,
    callId: params.callId,
    ID: params.callId,
    id: params.callId,
  };
  if (params.chatJid?.trim()) {
    payload.Chat = params.chatJid.trim();
    payload.chat = params.chatJid.trim();
  }

  return requestWuzapi(client, `/call/${encodeURIComponent(params.callId)}`, {
    method: "DELETE",
    body: payload,
  });
};

export const attachWhatsappCallWebRTC = async (
  client: WuzapiClient,
  params: { callId: string; sdpOffer: string },
): Promise<WhatsappCallActionPayload> =>
  requestWuzapi(client, "/call/webrtc", {
    method: "POST",
    body: {
      CallID: params.callId,
      callId: params.callId,
      ID: params.callId,
      id: params.callId,
      sdp_offer: params.sdpOffer,
      SDPOffer: params.sdpOffer,
      sdpOffer: params.sdpOffer,
      sdp: params.sdpOffer,
      SDP: params.sdpOffer,
      offer: params.sdpOffer,
      Offer: params.sdpOffer,
    },
  });

export const listWhatsappCalls = async (
  client: WuzapiClient,
): Promise<WhatsappCallActionPayload> =>
  requestWuzapi(client, "/call/status", {
    method: "GET",
  });

const updateGroupParticipants = async (
  client: WuzapiClient,
  params: {
    groupJid: string;
    participants: string[];
    action: "remove" | "promote" | "demote" | "add";
  },
) => {
  const digitsOnly = (v: string) => v.replace(/\D/g, "");
  const phones = params.participants
    .map((p) => digitsOnly(p))
    .filter((p) => p.length > 0);
  // Tentativa 1: campo Phone (números) — conforme documentação
  try {
    await requestWuzapi(client, "/group/updateparticipants", {
      method: "POST",
      body: {
        GroupJID: params.groupJid,
        Phone: phones,
        Action: params.action,
      },
    });
    return;
  } catch (_error) {
    // Tentativa 2: alguns servidores aceitam JIDs no campo Participants
    const toJid = (p: string): string =>
      /@/.test(p) ? p : `${digitsOnly(p)}@s.whatsapp.net`;
    const jids = params.participants.map(toJid);
    try {
      await requestWuzapi(client, "/group/updateparticipants", {
        method: "POST",
        body: {
          GroupJID: params.groupJid,
          Participants: jids,
          Action: params.action,
        },
      });
      return;
    } catch (err2) {
      // Propaga último erro para diagnóstico
      throw err2;
    }
  }
};

export const addGroupParticipants = async (
  client: WuzapiClient,
  params: { groupJid: string; participants: string[] },
) => {
  await updateGroupParticipants(client, {
    groupJid: params.groupJid,
    participants: params.participants,
    action: "add",
  });
};

export const removeGroupParticipant = async (
  client: WuzapiClient,
  params: { groupJid: string; participant: string },
) => {
  await updateGroupParticipants(client, {
    groupJid: params.groupJid,
    participants: [params.participant],
    action: "remove",
  });
};

export const promoteGroupParticipant = async (
  client: WuzapiClient,
  params: { groupJid: string; participant: string },
) => {
  await updateGroupParticipants(client, {
    groupJid: params.groupJid,
    participants: [params.participant],
    action: "promote",
  });
};

export const demoteGroupParticipant = async (
  client: WuzapiClient,
  params: { groupJid: string; participant: string },
) => {
  await updateGroupParticipants(client, {
    groupJid: params.groupJid,
    participants: [params.participant],
    action: "demote",
  });
};

export const createGroup = async <T = unknown>(
  client: WuzapiClient,
  params: { name: string; participants: string[] },
): Promise<T> => {
  const name = params.name.trim();
  const participants = params.participants
    .map((participant) => participant.trim())
    .filter(
      (participant, index, array) =>
        participant.length > 0 && array.indexOf(participant) === index,
    );
  if (!name) {
    throw new Error("Informe o nome do grupo.");
  }
  if (participants.length === 0) {
    throw new Error("Informe ao menos um participante.");
  }
  return requestWuzapi<T>(client, "/group/create", {
    method: "POST",
    body: {
      Name: name,
      Participants: participants,
    },
  });
};

export const leaveGroup = async (
  client: WuzapiClient,
  params: { groupJid: string },
): Promise<void> => {
  await requestWuzapi(client, "/group/leave", {
    method: "POST",
    body: {
      GroupJID: params.groupJid,
    },
  });
};

export const getGroupInfo = async <T = unknown>(
  client: WuzapiClient,
  groupJid: string,
): Promise<T> =>
  requestWuzapi<T>(
    client,
    `/group/info?groupJID=${encodeURIComponent(groupJid)}`,
    {
      method: "GET",
      expectedStatus: 200,
    },
  );

const extractInviteLink = (payload: unknown): string | null => {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed.includes("chat.whatsapp.com/") ? trimmed : null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const nested = record.data ?? record.Data;
  const candidates = [
    record.inviteLink,
    record.invite_link,
    record.InviteLink,
    record.link,
    record.Link,
    record.url,
    record.URL,
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate.trim().includes("chat.whatsapp.com/")
    ) {
      return candidate.trim();
    }
  }

  return nested && nested !== payload ? extractInviteLink(nested) : null;
};

export const getGroupInviteLink = async (
  client: WuzapiClient,
  params: { groupJid: string; reset?: boolean },
): Promise<string> => {
  const groupJid = params.groupJid.trim();
  if (!groupJid) {
    throw new Error("Informe o ID do grupo.");
  }

  const search = new URLSearchParams({
    groupJID: groupJid,
    reset: params.reset ? "true" : "false",
  });
  const payload = await requestWuzapi<unknown>(
    client,
    `/group/invitelink?${search.toString()}`,
    {
      method: "GET",
      expectedStatus: 200,
    },
  );
  const inviteLink = extractInviteLink(payload);
  if (!inviteLink) {
    throw new Error(
      "A API não retornou um link de convite válido para o grupo.",
    );
  }
  return inviteLink;
};

export const setGroupName = async (
  client: WuzapiClient,
  params: { groupJid: string; name: string },
) => {
  await requestWuzapi(client, "/group/name", {
    method: "POST",
    body: {
      GroupJID: params.groupJid,
      Name: params.name,
    },
  });
};

export const setGroupTopic = async (
  client: WuzapiClient,
  params: { groupJid: string; topic: string },
) => {
  await requestWuzapi(client, "/group/topic", {
    method: "POST",
    body: {
      GroupJID: params.groupJid,
      Topic: params.topic,
    },
  });
};

export const setMessagesAdminsOnly = async (
  client: WuzapiClient,
  params: { groupJid: string; onlyAdmins: boolean },
) => {
  await requestWuzapi(client, "/group/announce", {
    method: "POST",
    body: {
      GroupJID: params.groupJid,
      Announce: params.onlyAdmins,
    },
  });
};

export const setGroupLocked = async (
  client: WuzapiClient,
  params: { groupJid: string; locked: boolean },
) => {
  await requestWuzapi(client, "/group/locked", {
    method: "POST",
    body: {
      GroupJID: params.groupJid,
      Locked: params.locked,
    },
  });
};

export const setGroupEphemeral = async (
  client: WuzapiClient,
  params: { groupJid: string; duration: string },
) => {
  await requestWuzapi(client, "/group/ephemeral", {
    method: "POST",
    body: {
      GroupJID: params.groupJid,
      Duration: params.duration,
    },
  });
};

export const getGroupInviteInfo = async <T = unknown>(
  client: WuzapiClient,
  inviteCode: string,
): Promise<T> => {
  const code = inviteCode.trim();
  if (!code) {
    throw new Error("Informe o código de convite do grupo.");
  }
  return requestWuzapi<T>(client, "/group/inviteinfo", {
    method: "POST",
    body: {
      Code: code,
    },
  });
};

export const joinGroupWithInviteLink = async (
  client: WuzapiClient,
  inviteCode: string,
): Promise<void> => {
  const code = inviteCode.trim();
  if (!code) {
    throw new Error("Informe o código de convite do grupo.");
  }
  await requestWuzapi(client, "/group/join", {
    method: "POST",
    body: {
      Code: code,
    },
  });
};

export type UserAvatarResult = {
  url: string | null;
  dataUrl: string | null;
  mimeType: string | null;
};

type AvatarCacheRecord = {
  result: UserAvatarResult | null;
};

type LocalAvatarCacheEntry = AvatarCacheRecord & {
  expiresAt: number;
};

const AVATAR_CACHE_TTL_MS = Number.isFinite(
  Number(process.env.WUZAPI_AVATAR_CACHE_TTL_MS),
)
  ? Math.max(60_000, Math.floor(Number(process.env.WUZAPI_AVATAR_CACHE_TTL_MS)))
  : 6 * 60 * 60 * 1000;
const AVATAR_NEGATIVE_CACHE_TTL_MS = Number.isFinite(
  Number(process.env.WUZAPI_AVATAR_NEGATIVE_CACHE_TTL_MS),
)
  ? Math.max(
      30_000,
      Math.floor(Number(process.env.WUZAPI_AVATAR_NEGATIVE_CACHE_TTL_MS)),
    )
  : 60 * 60 * 1000;
const AVATAR_RATE_BACKOFF_MS = Number.isFinite(
  Number(process.env.WUZAPI_AVATAR_RATE_BACKOFF_MS),
)
  ? Math.max(
      60_000,
      Math.floor(Number(process.env.WUZAPI_AVATAR_RATE_BACKOFF_MS)),
    )
  : 15 * 60 * 1000;
const AVATAR_MIN_INTERVAL_MS = Number.isFinite(
  Number(process.env.WUZAPI_AVATAR_MIN_INTERVAL_MS),
)
  ? Math.max(0, Math.floor(Number(process.env.WUZAPI_AVATAR_MIN_INTERVAL_MS)))
  : 800;
const MAX_CACHED_DATA_URL_LENGTH = 200_000;

const localAvatarCache = new Map<string, LocalAvatarCacheEntry>();
const avatarInflight = new Map<string, Promise<UserAvatarResult | null>>();
const avatarServerBackoff = new Map<string, number>();
const avatarServerQueues = new Map<string, Promise<void>>();
const avatarServerLastRequestAt = new Map<string, number>();

const hashAvatarPart = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);

const buildAvatarKeys = (
  client: WuzapiClient,
  contact: string,
  preview: boolean,
) => {
  const base = sanitizeBaseUrl(client.baseUrl);
  const serverHash = hashAvatarPart(`${base}|${client.token}`);
  const contactHash = hashAvatarPart(
    `${contact.trim().toLowerCase()}|${preview ? "1" : "0"}`,
  );
  return {
    cacheKey: redisKey("cache", "wuzapi-avatar", serverHash, contactHash),
    backoffKey: redisKey("backoff", "wuzapi-avatar", serverHash),
    localKey: `${serverHash}:${contactHash}`,
    serverKey: serverHash,
  };
};

const nowMs = () => Date.now();

const normalizeAvatarForCache = (
  result: UserAvatarResult | null,
): UserAvatarResult | null => {
  if (!result) return null;
  return {
    url: result.url ?? null,
    dataUrl:
      result.dataUrl && result.dataUrl.length <= MAX_CACHED_DATA_URL_LENGTH
        ? result.dataUrl
        : null,
    mimeType: result.mimeType ?? null,
  };
};

const getLocalAvatarCache = (key: string): AvatarCacheRecord | null => {
  const entry = localAvatarCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) {
    localAvatarCache.delete(key);
    return null;
  }
  return { result: entry.result };
};

const setLocalAvatarCache = (
  key: string,
  record: AvatarCacheRecord,
  ttlMs: number,
) => {
  localAvatarCache.set(key, {
    ...record,
    expiresAt: nowMs() + ttlMs,
  });
};

const getAvatarBackoff = async (
  localServerKey: string,
  redisBackoffKey: string,
): Promise<number> => {
  const localUntil = avatarServerBackoff.get(localServerKey) ?? 0;
  if (localUntil > nowMs()) return localUntil;
  if (localUntil) avatarServerBackoff.delete(localServerKey);

  const shared = await redisGetJson<{ until: number }>(redisBackoffKey);
  const sharedUntil = Number(shared?.until ?? 0);
  if (Number.isFinite(sharedUntil) && sharedUntil > nowMs()) {
    avatarServerBackoff.set(localServerKey, sharedUntil);
    return sharedUntil;
  }
  return 0;
};

const setAvatarBackoff = async (
  localServerKey: string,
  redisBackoffKey: string,
) => {
  const until = nowMs() + AVATAR_RATE_BACKOFF_MS;
  avatarServerBackoff.set(localServerKey, until);
  await redisSetJson(redisBackoffKey, { until }, AVATAR_RATE_BACKOFF_MS);
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForAvatarRequestSlot = async (serverKey: string) => {
  if (AVATAR_MIN_INTERVAL_MS <= 0) return;
  const previous = avatarServerQueues.get(serverKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const last = avatarServerLastRequestAt.get(serverKey) ?? 0;
      const delay = Math.max(0, AVATAR_MIN_INTERVAL_MS - (nowMs() - last));
      if (delay > 0) {
        await wait(delay);
      }
      avatarServerLastRequestAt.set(serverKey, nowMs());
    });
  avatarServerQueues.set(
    serverKey,
    next.finally(() => {
      if (avatarServerQueues.get(serverKey) === next) {
        avatarServerQueues.delete(serverKey);
      }
    }),
  );
  await next;
};

const isAvatarRateLimitError = (error: unknown) => {
  const status = Number((error as { status?: number })?.status ?? 0);
  const responseError =
    typeof (error as { response?: { error?: unknown } })?.response?.error ===
    "string"
      ? String((error as { response?: { error?: unknown } }).response?.error)
      : "";
  const message = error instanceof Error ? error.message : "";
  const combined = `${message} ${responseError}`.toLowerCase();
  return (
    status === 429 ||
    combined.includes("rate-overlimit") ||
    combined.includes("rate overlimit")
  );
};

export type UserContact = {
  jid: string;
  phone: string;
  name: string;
  shortName: string | null;
  pushName: string | null;
  avatarUrl: string | null;
};

export type WhatsappCheckUser = {
  query: string;
  isInWhatsapp: boolean;
  jid: string | null;
  verifiedName: string | null;
};

export type UserChannel = {
  jid: string;
  name: string;
  description: string | null;
  inviteCode: string | null;
  inviteLink: string | null;
  subscribersCount: number | null;
  avatarUrl: string | null;
  viewerRole: string | null;
  viewerMute: string | null;
  canSendMessages: boolean;
};

const unwrapAvatarPayload = (
  payload: unknown,
): Record<string, unknown> | null => {
  if (!payload) {
    return null;
  }
  if (typeof payload === "string") {
    return { url: payload };
  }
  if (typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const nested = record.data ?? record.Data;
  if (nested && typeof nested === "object") {
    return nested as Record<string, unknown>;
  }
  if (typeof nested === "string" && nested.trim()) {
    return { url: nested };
  }
  return record;
};

const isLikelyBase64 = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length < 100) {
    return false;
  }
  return /^[A-Za-z0-9+/=]+$/.test(trimmed);
};

const buildDataUrl = (base64Raw: string, mimeType: string | null): string => {
  const cleaned = base64Raw
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s+/g, "");
  const mt = mimeType && mimeType.includes("/") ? mimeType : "image/jpeg";
  return `data:${mt};base64,${cleaned}`;
};

export const getUserAvatar = async (
  client: WuzapiClient,
  params: { contact: string; preview?: boolean; forceRefresh?: boolean },
): Promise<UserAvatarResult | null> => {
  const contact = params.contact.trim();
  if (!contact) return null;
  const preview = params.preview ?? false;
  const forceRefresh = params.forceRefresh === true;
  const keys = buildAvatarKeys(client, contact, preview);
  if (!forceRefresh) {
    const cachedLocal = getLocalAvatarCache(keys.localKey);
    if (cachedLocal) {
      return cachedLocal.result;
    }

    const sharedCached = await redisGetJson<AvatarCacheRecord>(keys.cacheKey);
    if (sharedCached) {
      setLocalAvatarCache(
        keys.localKey,
        sharedCached,
        sharedCached.result
          ? AVATAR_CACHE_TTL_MS
          : AVATAR_NEGATIVE_CACHE_TTL_MS,
      );
      return sharedCached.result;
    }
  }

  const backoffUntil = await getAvatarBackoff(keys.serverKey, keys.backoffKey);
  if (backoffUntil > nowMs()) {
    const negative = { result: null };
    setLocalAvatarCache(
      keys.localKey,
      negative,
      Math.min(
        AVATAR_NEGATIVE_CACHE_TTL_MS,
        Math.max(1_000, backoffUntil - nowMs()),
      ),
    );
    return null;
  }

  const existingInflight = avatarInflight.get(keys.localKey);
  if (existingInflight && !forceRefresh) {
    return existingInflight;
  }

  const task = (async (): Promise<UserAvatarResult | null> => {
    await waitForAvatarRequestSlot(keys.serverKey);

    const payload: Record<string, unknown> = {
      Preview: preview,
    };
    applyRecipientToPayload(payload, contact);
    try {
      const response = await requestWuzapi<Record<string, unknown>>(
        client,
        "/user/avatar",
        {
          method: "POST",
          body: payload,
        },
      );
      const node = unwrapAvatarPayload(response);
      if (!node) {
        return null;
      }
      const mimeType =
        firstString(
          node.mimetype,
          node.Mimetype,
          node.mimeType,
          node.ContentType,
          node.contentType,
        ) ?? null;
      const urlCandidate = firstString(
        node.url,
        node.Url,
        node.avatar,
        node.Avatar,
        node.picture,
        node.Picture,
        node.previewUrl,
        node.PreviewUrl,
      );
      const base64Candidate = firstString(
        node.base64,
        node.Base64,
        node.data,
        node.Data,
        node.buffer,
        node.Buffer,
      );
      let httpUrl: string | null = null;
      let dataUrl: string | null = null;
      if (urlCandidate) {
        if (/^https?:\/\//i.test(urlCandidate)) {
          httpUrl = urlCandidate;
        } else if (urlCandidate.startsWith("data:")) {
          dataUrl = urlCandidate;
        } else if (isLikelyBase64(urlCandidate)) {
          dataUrl = buildDataUrl(urlCandidate, mimeType);
        }
      }
      if (!dataUrl && base64Candidate) {
        dataUrl = buildDataUrl(base64Candidate, mimeType);
      }
      const result = {
        url: httpUrl,
        dataUrl,
        mimeType,
      };
      const normalizedResult = normalizeAvatarForCache(result);
      const record = { result: normalizedResult };
      const ttlMs = normalizedResult
        ? AVATAR_CACHE_TTL_MS
        : AVATAR_NEGATIVE_CACHE_TTL_MS;
      setLocalAvatarCache(keys.localKey, record, ttlMs);
      await redisSetJson(keys.cacheKey, record, ttlMs);
      return result;
    } catch (error) {
      const status = (error as { status?: number }).status;
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof (error as { response?: { error?: unknown } })?.response
                ?.error === "string"
            ? String(
                (error as { response?: { error?: unknown } }).response?.error,
              )
            : "";
      const expectedMissingAvatar =
        status === 404 ||
        /hidden their profile picture|does not have a profile picture/i.test(
          errorMessage,
        );

      if (expectedMissingAvatar) {
        const record = { result: null };
        setLocalAvatarCache(
          keys.localKey,
          record,
          AVATAR_NEGATIVE_CACHE_TTL_MS,
        );
        await redisSetJson(keys.cacheKey, record, AVATAR_NEGATIVE_CACHE_TTL_MS);
        return null;
      }
      if (isAvatarRateLimitError(error)) {
        await setAvatarBackoff(keys.serverKey, keys.backoffKey);
        const record = { result: null };
        setLocalAvatarCache(
          keys.localKey,
          record,
          AVATAR_NEGATIVE_CACHE_TTL_MS,
        );
        await redisSetJson(keys.cacheKey, record, AVATAR_NEGATIVE_CACHE_TTL_MS);
        return null;
      }
      console.warn("[wuzapi] getUserAvatar failed", { error });
      return null;
    }
  })();

  avatarInflight.set(keys.localKey, task);
  try {
    return await task;
  } finally {
    avatarInflight.delete(keys.localKey);
  }
};

const normalizeContactJid = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const lowered = trimmed.toLowerCase();
    if (lowered.endsWith("@c.us")) {
      const localPart = lowered.slice(0, -5).replace(/\D+/g, "");
      return localPart ? `${localPart}@s.whatsapp.net` : null;
    }
    if (lowered.endsWith("@whatsapp.net")) {
      const localPart = lowered.slice(0, -13).replace(/\D+/g, "");
      return localPart ? `${localPart}@s.whatsapp.net` : null;
    }
    return lowered;
  }
  const digits = trimmed.replace(/\D+/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
};

const isLikelyContactMapKey = (value: string): boolean => {
  const key = value.trim().toLowerCase();
  if (!key) {
    return false;
  }
  return (
    key.endsWith("@s.whatsapp.net") ||
    key.endsWith("@c.us") ||
    key.endsWith("@whatsapp.net")
  );
};

const extractContactsFromMapRecord = (
  record: Record<string, unknown>,
): unknown[] => {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return [];
  }

  let contactLikeKeys = 0;
  const mapped: unknown[] = [];
  for (const [key, value] of entries) {
    if (!isLikelyContactMapKey(key)) {
      continue;
    }
    contactLikeKeys += 1;
    if (!value || typeof value !== "object") {
      continue;
    }
    const contactRecord = value as Record<string, unknown>;
    mapped.push({
      jid: key,
      ...contactRecord,
    });
  }

  if (contactLikeKeys === 0) {
    return [];
  }
  return mapped;
};

const extractContactsPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.contacts,
    record.Contacts,
    record.data,
    record.Data,
    record.result,
    record.Result,
    record.items,
    record.Items,
    record.list,
    record.List,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const mappedContacts = extractContactsFromMapRecord(
        candidate as Record<string, unknown>,
      );
      if (mappedContacts.length > 0) {
        return mappedContacts;
      }
      const nested = candidate as Record<string, unknown>;
      const nestedCandidates = [
        nested.contacts,
        nested.Contacts,
        nested.items,
        nested.Items,
        nested.list,
        nested.List,
        nested.data,
        nested.Data,
      ];
      for (const nestedCandidate of nestedCandidates) {
        if (Array.isArray(nestedCandidate)) {
          return nestedCandidate;
        }
        if (nestedCandidate && typeof nestedCandidate === "object") {
          const nestedMappedContacts = extractContactsFromMapRecord(
            nestedCandidate as Record<string, unknown>,
          );
          if (nestedMappedContacts.length > 0) {
            return nestedMappedContacts;
          }
        }
      }
    }
  }

  return [];
};

const normalizeContactEntry = (entry: unknown): UserContact | null => {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;

  const rawJid = firstString(
    record.jid,
    record.JID,
    record.id,
    record.ID,
    record.contact,
    record.Contact,
    record.user,
    record.User,
    record.phone,
    record.Phone,
    record.phoneNumber,
    record.PhoneNumber,
    record.waId,
    record.wa_id,
    record.WAID,
    record.Waid,
    record._serialized,
  );
  const jid = normalizeContactJid(rawJid);
  if (!jid || jid.endsWith("@g.us")) {
    return null;
  }

  const localPart = jid.split("@")[0] ?? "";
  const digits = localPart.replace(/\D+/g, "");
  const shortName = firstString(
    record.shortName,
    record.ShortName,
    record.short_name,
  );
  const pushName = firstString(
    record.pushName,
    record.PushName,
    record.notify,
    record.Notify,
  );
  const name =
    firstString(
      record.name,
      record.Name,
      record.fullName,
      record.FullName,
      record.verifiedName,
      record.VerifiedName,
      shortName,
      pushName,
    ) ?? digits;
  const avatarUrl = firstString(
    record.avatarUrl,
    record.avatar_url,
    record.pictureUrl,
    record.picture_url,
    record.profilePic,
    record.profilePicUrl,
    record.profilePictureUrl,
    record.photo,
    record.image,
    record.previewUrl,
  );

  return {
    jid,
    phone: digits || localPart,
    name,
    shortName,
    pushName,
    avatarUrl,
  };
};

const extractWhatsappCheckUsersPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.Users,
    record.users,
    record.data,
    record.Data,
    record.result,
    record.Result,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedCandidates = [
        nested.Users,
        nested.users,
        nested.data,
        nested.Data,
        nested.result,
        nested.Result,
      ];
      for (const nestedCandidate of nestedCandidates) {
        if (Array.isArray(nestedCandidate)) {
          return nestedCandidate;
        }
      }
    }
  }

  return [];
};

const normalizeWhatsappCheckUser = (
  entry: unknown,
): WhatsappCheckUser | null => {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const query =
    firstString(record.Query, record.query, record.Phone, record.phone) ?? "";
  const isInWhatsappRaw =
    record.IsInWhatsapp ??
    record.isInWhatsapp ??
    record.is_in_whatsapp ??
    record.exists ??
    record.Exists;
  const isInWhatsapp =
    isInWhatsappRaw === true ||
    isInWhatsappRaw === 1 ||
    (typeof isInWhatsappRaw === "string" &&
      ["true", "1", "yes", "sim"].includes(isInWhatsappRaw.toLowerCase()));
  const jid = firstString(record.JID, record.jid, record.id, record.ID);
  const verifiedName = firstString(
    record.VerifiedName,
    record.verifiedName,
    record.name,
    record.Name,
  );

  return {
    query,
    isInWhatsapp,
    jid: jid?.trim() || null,
    verifiedName: verifiedName?.trim() || null,
  };
};

export const checkWhatsappUsers = async (
  client: WuzapiClient,
  phones: string[],
): Promise<WhatsappCheckUser[]> => {
  const cleanedPhones = phones
    .map((phone) => phone.replace(/\D+/g, ""))
    .filter((phone) => phone.length > 0);
  if (cleanedPhones.length === 0) {
    return [];
  }
  const response = await requestWuzapi<unknown>(client, "/user/check", {
    method: "POST",
    expectedStatus: 200,
    body: { Phone: cleanedPhones },
  });
  return extractWhatsappCheckUsersPayload(response)
    .map(normalizeWhatsappCheckUser)
    .filter((user): user is WhatsappCheckUser => Boolean(user));
};

const collectResolvedLidPhonePairs = (
  value: unknown,
  output: Map<string, string>,
  depth = 0,
): void => {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      trimmed.length < 1_000_000
    ) {
      try {
        collectResolvedLidPhonePairs(JSON.parse(trimmed), output, depth + 1);
      } catch {
        // Not a nested JSON envelope.
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectResolvedLidPhonePairs(entry, output, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const phoneJid = firstString(
    record.PNJID,
    record.pnJid,
    record.pnJID,
    record.PhoneNumber,
    record.phoneNumber,
  );
  const lidJid = firstString(
    record.LIDJID,
    record.lidJid,
    record.lidJID,
    record.LID,
    record.lid,
  );
  const phoneDigits = normalizeJid(phoneJid);
  const lidDigits = normalizeJid(lidJid);
  if (phoneDigits && lidDigits) {
    output.set(lidDigits, phoneDigits);
  }

  for (const child of Object.values(record)) {
    collectResolvedLidPhonePairs(child, output, depth + 1);
  }
};

export const resolveWhatsappLidsToPhones = async (
  client: WuzapiClient,
  lids: string[],
): Promise<Map<string, string>> => {
  const requested = new Map<string, string>();
  for (const lid of lids) {
    const digits = normalizeJid(lid);
    if (!digits) continue;
    requested.set(digits, `${digits}@lid`);
  }
  if (requested.size === 0) return new Map<string, string>();

  const clientKey = createHash("sha256")
    .update(`${sanitizeBaseUrl(client.baseUrl)}\n${client.token}`)
    .digest("hex")
    .slice(0, 20);
  const now = Date.now();
  const resolved = new Map<string, string>();
  const pending: string[] = [];

  for (const [lidDigits, lidJid] of requested) {
    const cached = LID_PHONE_CACHE.get(`${clientKey}:${lidDigits}`);
    if (cached && cached.expiresAt > now) {
      if (cached.phoneDigits) resolved.set(lidDigits, cached.phoneDigits);
      continue;
    }
    pending.push(lidJid);
  }

  if (pending.length > 0) {
    const response = await requestWuzapi<unknown>(client, "/user/info", {
      method: "POST",
      expectedStatus: 200,
      body: { Phone: pending },
    });
    const fresh = new Map<string, string>();
    collectResolvedLidPhonePairs(response, fresh);
    for (const lidJid of pending) {
      const lidDigits = normalizeJid(lidJid);
      if (!lidDigits) continue;
      const phoneDigits = fresh.get(lidDigits) ?? null;
      LID_PHONE_CACHE.set(`${clientKey}:${lidDigits}`, {
        phoneDigits,
        expiresAt:
          Date.now() +
          (phoneDigits ? LID_PHONE_CACHE_TTL_MS : LID_PHONE_MISS_TTL_MS),
      });
      if (phoneDigits) resolved.set(lidDigits, phoneDigits);
    }
  }

  return resolved;
};

export const listUserContacts = async (
  client: WuzapiClient,
): Promise<UserContact[]> => {
  const response = await requestWuzapi<unknown>(client, "/user/contacts", {
    method: "GET",
    expectedStatus: 200,
  });
  const rawContacts = extractContactsPayload(response);
  const seen = new Set<string>();
  const contacts: UserContact[] = [];

  for (const rawContact of rawContacts) {
    const normalized = normalizeContactEntry(rawContact);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized.jid)) {
      continue;
    }
    seen.add(normalized.jid);
    contacts.push(normalized);
  }

  return contacts.sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR"),
  );
};

const normalizeChannelJid = (value: string | null): string | null => {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed) return null;
  if (trimmed.endsWith("@newsletter")) return trimmed;
  const digits = trimmed.replace(/\D+/g, "");
  return digits ? `${digits}@newsletter` : null;
};

const extractChannelsPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.Newsletter,
    record.newsletter,
    record.channels,
    record.Channels,
    record.items,
    record.Items,
    record.data,
    record.Data,
    record.result,
    record.Result,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedCandidates = [
        nested.Newsletter,
        nested.newsletter,
        nested.channels,
        nested.Channels,
        nested.items,
        nested.Items,
        nested.data,
        nested.Data,
      ];
      for (const nestedCandidate of nestedCandidates) {
        if (Array.isArray(nestedCandidate)) return nestedCandidate;
      }
    }
  }

  return [];
};

const readNestedText = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return firstString(
    record.text,
    record.Text,
    record.name,
    record.Name,
    record.value,
    record.Value,
  );
};

const readNestedUrl = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return firstString(
    record.url,
    record.URL,
    record.href,
    record.Href,
    record.directPath,
    record.DirectPath,
  );
};

const normalizeChannelEntry = (entry: unknown): UserChannel | null => {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const threadMeta = (record.thread_metadata ??
    record.ThreadMetadata ??
    record.threadMeta) as Record<string, unknown> | undefined;
  const picture = record.picture ??
    record.Picture ??
    threadMeta?.picture ??
    threadMeta?.Picture;
  const preview = record.preview ??
    record.Preview ??
    threadMeta?.preview ??
    threadMeta?.Preview;
  const pictureHd = record.picture_hd ??
    record.pictureHD ??
    record.PictureHD;
  const viewerMeta = (record.viewer_metadata ??
    record.ViewerMetadata ??
    record.viewerMeta) as Record<string, unknown> | undefined;

  const jid = normalizeChannelJid(
    firstString(
      record.id,
      record.ID,
      record.jid,
      record.JID,
      record.channel,
      record.Channel,
    ),
  );
  if (!jid) return null;

  const name =
    firstString(record.name, record.Name) ??
    readNestedText(threadMeta?.name ?? threadMeta?.Name) ??
    jid;
  const description =
    firstString(record.description, record.Description) ??
    readNestedText(threadMeta?.description ?? threadMeta?.Description);
  const subscribersRaw =
    record.subscribers_count ??
    record.subscribersCount ??
    threadMeta?.subscribers_count ??
    threadMeta?.subscribersCount;
  const subscribersCount = Number(subscribersRaw);
  const avatarUrl = firstString(
    record.picture_hd_url,
    record.pictureHDUrl,
    record.PictureHDURL,
    readNestedUrl(pictureHd),
    record.picture_url,
    record.pictureUrl,
    record.PictureURL,
    readNestedUrl(picture),
    record.preview_url,
    record.previewUrl,
    readNestedUrl(preview),
  );
  const viewerRole = firstString(
    record.viewer_role,
    record.viewerRole,
    viewerMeta?.role,
    viewerMeta?.Role,
  )?.toLowerCase() ?? null;
  const explicitCanSend =
    record.can_send_messages ??
    record.canSendMessages ??
    record.CanSendMessages;
  const canSendMessages =
    typeof explicitCanSend === "boolean"
      ? explicitCanSend
      : explicitCanSend === 1 ||
        explicitCanSend === "1" ||
        String(explicitCanSend ?? "").trim().toLowerCase() === "true"
        ? true
        : viewerRole === "admin" || viewerRole === "owner";

  return {
    jid,
    name,
    description,
    inviteCode: firstString(
      record.invite_code,
      record.inviteCode,
      threadMeta?.invite,
      threadMeta?.Invite,
    ),
    inviteLink: firstString(
      record.invite_link,
      record.inviteLink,
      record.link,
      record.Link,
    ),
    subscribersCount: Number.isFinite(subscribersCount)
      ? subscribersCount
      : null,
    avatarUrl,
    viewerRole,
    viewerMute: firstString(
      record.viewer_mute,
      record.viewerMute,
      viewerMeta?.mute,
      viewerMeta?.Mute,
    ),
    canSendMessages,
  };
};

export const listUserChannels = async (
  client: WuzapiClient,
): Promise<UserChannel[]> => {
  const response = await requestWuzapi<unknown>(
    client,
    "/newsletter/list?full=true&pictureHD=true",
    {
      method: "GET",
      expectedStatus: 200,
    },
  );
  const rawChannels = extractChannelsPayload(response);
  const seen = new Set<string>();
  const channels: UserChannel[] = [];

  for (const rawChannel of rawChannels) {
    const normalized = normalizeChannelEntry(rawChannel);
    if (!normalized || seen.has(normalized.jid)) continue;
    seen.add(normalized.jid);
    channels.push(normalized);
  }

  return channels.sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR"),
  );
};

export const getUserChannel = async (
  client: WuzapiClient,
  channelJid: string,
): Promise<UserChannel | null> => {
  const response = await requestWuzapi<unknown>(
    client,
    `/newsletter/info?channel=${encodeURIComponent(channelJid)}&pictureHD=false`,
    {
      method: "GET",
      expectedStatus: 200,
    },
  );
  if (!response || typeof response !== "object") {
    return null;
  }
  const envelope = response as Record<string, unknown>;
  return normalizeChannelEntry(
    envelope.data ?? envelope.Data ?? envelope.info ?? envelope.Info ?? response,
  );
};

export const sendReactionMessage = async (
  client: WuzapiClient,
  params: { chatId: string; messageId: string; emoji: string },
) => {
  // Preferência: endpoint documentado /chat/react com Body
  try {
    const payload: Record<string, unknown> = {
      Id: params.messageId,
      Body: params.emoji,
    };
    applyRecipientToPayload(payload, params.chatId);
    await requestWuzapi(client, "/chat/react", {
      method: "POST",
      body: payload,
    });
    return;
  } catch (_err) {
    // Fallback para variantes antigas
    try {
      const payload: Record<string, unknown> = {
        Id: params.messageId,
        Reaction: params.emoji,
        Emoji: params.emoji,
      };
      applyRecipientToPayload(payload, params.chatId);
      await requestWuzapi(client, "/chat/send/reaction", {
        method: "POST",
        body: payload,
      });
    } catch {
      /* swallow */
    }
  }
};

export const sendInteractiveResponse = async (
  client: WuzapiClient,
  params: SendInteractiveResponseParams,
): Promise<string | null> => {
  const selectedId = params.selectedId.trim();
  const selectedText = params.selectedText.trim() || selectedId;
  if (!selectedId) {
    throw new Error("Interactive response selectedId is required.");
  }

  const responseType =
    params.responseType === "list"
      ? "list"
      : params.responseType === "flow"
        ? "flow"
        : "button";
  const nativeName =
    params.nativeName?.trim() ||
    (responseType === "list"
      ? "menu_options"
      : responseType === "flow"
        ? "galaxy_message"
        : "quick_reply");
  const payload: Record<string, unknown> = {
    Type: responseType,
    type: responseType,
    ResponseType: responseType,
    responseType,
    SelectedId: selectedId,
    selectedId,
    SelectedText: selectedText,
    selectedText,
    Title: selectedText,
    title: selectedText,
    Payload: selectedId,
    payload: selectedId,
    NativeName: nativeName,
    nativeName,
    Name: nativeName,
    name: nativeName,
    Version: Math.max(1, Math.trunc(params.version ?? 1)),
    version: Math.max(1, Math.trunc(params.version ?? 1)),
  };
  if (responseType === "list") {
    payload.SelectedRowId = selectedId;
    payload.selectedRowId = selectedId;
    payload.RowId = selectedId;
    payload.rowId = selectedId;
    payload.params = {
      kind: "list",
      type: "single_select",
      id: selectedId,
      selectedId,
      selectedRowId: selectedId,
      rowId: selectedId,
      display_text: selectedText,
      displayText: selectedText,
      title: selectedText,
      text: selectedText,
      description: params.description?.trim() || undefined,
    };
  } else {
    payload.SelectedButtonId = selectedId;
    payload.selectedButtonId = selectedId;
    payload.ButtonId = selectedId;
    payload.buttonId = selectedId;
    payload.params = {
      kind: responseType === "flow" ? "flow" : "button",
      type: responseType === "flow" ? nativeName : "quick_reply",
      id: selectedId,
      selectedId,
      selectedButtonId: selectedId,
      buttonId: selectedId,
      display_text: selectedText,
      displayText: selectedText,
      title: selectedText,
      text: selectedText,
      ...(params.params ?? {}),
    };
  }
  if (responseType === "list" && params.params) {
    payload.params = {
      ...(payload.params as Record<string, unknown>),
      ...params.params,
    };
  }
  if (params.description?.trim()) {
    payload.Description = params.description.trim();
    payload.description = params.description.trim();
  }
  applyRecipientToPayload(payload, params.to);
  if (params.quoted?.stanzaId) {
    payload.QuotedMessageId = params.quoted.stanzaId;
    payload.quotedMessageId = params.quoted.stanzaId;
    if (params.quoted.participant) {
      payload.QuotedParticipant = params.quoted.participant;
      payload.quotedParticipant = params.quoted.participant;
    }
    payload.ContextInfo = {
      StanzaID: params.quoted.stanzaId,
      StanzaId: params.quoted.stanzaId,
      Participant: params.quoted.participant ?? undefined,
    };
    if (params.quoted.sourceInteractive) {
      payload.SourceInteractive = params.quoted.sourceInteractive;
      payload.sourceInteractive = params.quoted.sourceInteractive;
    }
  }

  const response = await requestWuzapi<any>(
    client,
    "/chat/send/interactive-response",
    {
      method: "POST",
      body: payload,
    },
  );
  const messageId = extractMessageId(response);
  const mediaType =
    responseType === "list"
      ? "list_response"
      : responseType === "flow"
        ? "flow_response"
        : "button_response";
  const description = params.description?.trim() || undefined;
  const media = {
    mediaType,
    kind: "interactive_response",
    type: responseType,
    title: selectedText,
    body: selectedText,
    caption: selectedText,
    selectedId,
    selectedRowId: responseType === "list" ? selectedId : undefined,
    selectedButtonId: responseType === "button" ? selectedId : undefined,
    description,
    buttonResponse: {
      kind:
        responseType === "list"
          ? "list"
          : responseType === "flow"
            ? "flow"
            : "native_flow",
      type:
        responseType === "list"
          ? "single_select"
          : responseType === "flow"
            ? nativeName
            : "quick_reply",
      id: selectedId,
      selectedId,
      selectedRowId: responseType === "list" ? selectedId : undefined,
      buttonId: selectedId,
      text: selectedText,
      title: selectedText,
      description,
      params: params.params ?? undefined,
    },
  };
  await recordOutgoingConversationMessage(client, {
    to: params.to,
    messageId,
    messageType: mediaType,
    text: selectedText,
    media,
    raw: {
      request: cloneJsonSafe(payload),
      response: cloneJsonSafe(response),
    },
  });
  return messageId;
};

export const downloadChatMedia = async (
  client: WuzapiClient,
  params: {
    chatId: string;
    directPath?: string | null;
    mediaKey?: string | null;
    fileEncSHA256?: string | null;
    fileSHA256?: string | null;
    fileLength?: number | string | null;
    url?: string | null;
    mimeType?: string | null;
    mediaType?: string | null;
    fileName?: string | null;
    forceDocument?: boolean | null;
  },
): Promise<Buffer> => {
  // Seleciona endpoint específico conforme documentação para preservar qualidade
  const mt = (params.mimeType || "").toLowerCase();
  const mediaType = (params.mediaType || "").toLowerCase();
  const fileName = (params.fileName || "").toLowerCase();
  const isAnimatedGif =
    mt === "image/gif" ||
    mediaType.includes("gif") ||
    /\.gif(?:$|[?#])/.test(fileName);
  let endpoint = "/chat/downloaddocument";
  if (params.forceDocument) {
    endpoint = "/chat/downloaddocument";
  } else if (isAnimatedGif) {
    endpoint = "/chat/downloaddocument";
  } else if (
    mediaType === "sticker" ||
    mt === "application/was" ||
    mt.startsWith("image/")
  ) {
    endpoint = "/chat/downloadimage";
  } else if (mt.startsWith("video/")) {
    endpoint = "/chat/downloadvideo";
  } else if (mt.startsWith("audio/")) {
    endpoint = "/chat/downloadaudio";
  }

  // Monta payload com campos esperados pela doc (respeitando capitalização)
  const payload: Record<string, unknown> = {};
  if (params.directPath) payload.DirectPath = params.directPath;
  if (params.mediaKey) payload.MediaKey = params.mediaKey;
  if (params.mimeType) payload.Mimetype = params.mimeType;
  if (params.fileEncSHA256) payload.FileEncSHA256 = params.fileEncSHA256;
  if (params.fileSHA256) payload.FileSHA256 = params.fileSHA256;
  if (params.fileLength !== undefined && params.fileLength !== null) {
    const n = Number(params.fileLength);
    if (Number.isFinite(n) && n > 0) payload.FileLength = n;
  }
  // Só inclua Url se faltarem metadados para decriptação
  const hasDecryptMeta = Boolean(payload.DirectPath && payload.MediaKey);
  if (!hasDecryptMeta && params.url) payload.Url = params.url;

  // Nunca inclua identificadores do chat aqui (endpoint não requer),
  // para evitar qualquer comportamento de fallback incorreto no servidor.

  const requestWithRetry = async (targetEndpoint: string): Promise<Buffer> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await requestWuzapiBinary(client, targetEndpoint, {
          method: "POST",
          body: payload,
          signal: AbortSignal.timeout(WUZAPI_MEDIA_DOWNLOAD_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error;
        if (attempt < 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, 450 + attempt * 750),
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Falha ao baixar mídia do WhatsApp.");
  };

  try {
    return await requestWithRetry(endpoint);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAnimatedGif && !params.forceDocument) {
      let lastGifError: unknown = err;
      for (const fallbackEndpoint of ["/chat/downloadvideo"]) {
        if (fallbackEndpoint === endpoint) {
          continue;
        }
        try {
          return await requestWithRetry(fallbackEndpoint);
        } catch (fallbackError) {
          lastGifError = fallbackError;
        }
      }
      throw lastGifError instanceof Error ? lastGifError : err;
    }
    // Fallback: se falhou com endpoint específico e não forçamos documento, tenta como documento.
    // Erros de HMAC costumam ser transitórios ou específicos da descriptografia da mídia;
    // trocar para documento nesses casos apenas mascara a causa e normalmente falha também.
    if (
      !params.forceDocument &&
      endpoint !== "/chat/downloaddocument" &&
      !/invalid media hmac/i.test(message)
    ) {
      return await requestWithRetry("/chat/downloaddocument");
    }
    throw err;
  }
};

export const getChatMessage = async (
  client: WuzapiClient,
  params: {
    chatId: string;
    messageId: string;
    sender?: string | null;
  },
): Promise<ChatMessageLookupResult | null> => {
  const body: Record<string, unknown> = {
    Chat: params.chatId,
    ID: params.messageId,
  };
  if (params.sender) {
    body.Sender = params.sender;
  }
  try {
    const payload = await requestWuzapi<
      | ChatMessageLookupResult
      | { data?: ChatMessageLookupResult; Data?: ChatMessageLookupResult }
    >(client, "/chat/message", {
      method: "POST",
      body,
    });
    const wrapped =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const data = wrapped.data ?? wrapped.Data;
    if (data && typeof data === "object") {
      return data as ChatMessageLookupResult;
    }
    return payload as ChatMessageLookupResult;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || (status === 400 && !params.sender)) {
      return null;
    }
    throw error;
  }
};

export const requestChatHistorySync = async (
  client: WuzapiClient,
  params: {
    chatJid: string;
    oldestMessageId: string;
    oldestMessageFromMe: boolean;
    oldestMessageTimestampMs: number;
    count?: number;
  },
): Promise<Record<string, unknown>> => {
  return requestWuzapi<Record<string, unknown>>(client, "/chat/history/sync", {
    method: "POST",
    expectedStatus: 202,
    body: {
      chatJid: params.chatJid,
      oldestMessageId: params.oldestMessageId,
      oldestMessageFromMe: params.oldestMessageFromMe,
      oldestMessageTimestampMs: params.oldestMessageTimestampMs,
      count: Math.min(Math.max(params.count ?? 50, 1), 100),
    },
  });
};

export type FullHistoryResyncStatus = {
  requestId?: string;
  status: "idle" | "requested" | "receiving" | "completed" | "failed" | string;
  responseCode?: string;
  progress?: number;
  chunks?: number;
  conversations?: number;
  messages?: number;
  forwarded?: number;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  error?: string;
};

export const requestFullHistoryResync = async (
  client: WuzapiClient,
): Promise<Record<string, unknown>> =>
  requestWuzapi<Record<string, unknown>>(client, "/chat/history/resync", {
    method: "POST",
    expectedStatus: 202,
  });

export const getFullHistoryResyncStatus = async (
  client: WuzapiClient,
): Promise<Record<string, unknown>> =>
  requestWuzapi<Record<string, unknown>>(client, "/chat/history/resync", {
    method: "GET",
  });

const normalizePhotoData = (
  media: Buffer | string,
  mimeType?: string,
): string => {
  if (typeof media === "string") {
    const trimmed = media.trim();
    if (trimmed.startsWith("data:")) {
      return trimmed;
    }
    const resolvedMime =
      mimeType && mimeType.trim()
        ? mimeType.trim().toLowerCase()
        : "image/jpeg";
    return `data:${resolvedMime};base64,${trimmed}`;
  }

  const resolvedMime =
    mimeType && mimeType.trim() ? mimeType.trim().toLowerCase() : "image/jpeg";
  const base64 = media.toString("base64");
  return `data:${resolvedMime};base64,${base64}`;
};

const bufferToDataUrl = (data: Buffer, mimeType?: string | null): string => {
  const mt =
    mimeType && mimeType.includes("/") ? mimeType : "application/octet-stream";
  return `data:${mt};base64,${data.toString("base64")}`;
};

const _serializeMediaInput = (
  media: Buffer | string,
  mimeType?: string | null,
): string => {
  if (Buffer.isBuffer(media)) {
    return bufferToDataUrl(media, mimeType);
  }
  const trimmed = media.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (isLikelyBase64(trimmed)) {
    try {
      return bufferToDataUrl(Buffer.from(trimmed, "base64"), mimeType);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
};

const normalizeMentionTargetForEasyZap = (
  value: string | null | undefined,
): string | null => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  const withoutDevice = stripJidDevice(raw).trim();
  const lowered = withoutDevice.toLowerCase();
  if (
    ["@all", "all", "@todos", "todos", "@everyone", "everyone"].includes(
      lowered,
    )
  ) {
    return lowered;
  }

  if (withoutDevice.includes("@")) {
    return withoutDevice;
  }

  const digits = withoutDevice.replace(/\D+/g, "");
  return digits || null;
};

const normalizeMentionTargetsForEasyZap = (
  values: Array<string | null | undefined> | null | undefined,
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const normalized = normalizeMentionTargetForEasyZap(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

export const setGroupPhoto = async (
  client: WuzapiClient,
  params: { groupJid: string; media: Buffer | string; mimeType?: string },
) => {
  await requestWuzapi(client, "/group/photo", {
    method: "POST",
    body: {
      GroupJID: params.groupJid,
      Image: normalizePhotoData(params.media, params.mimeType),
    },
  });
};

export const removeGroupPhoto = async (
  client: WuzapiClient,
  params: { groupJid: string },
) => {
  await requestWuzapi(client, "/group/photo/remove", {
    method: "POST",
    body: {
      GroupJID: params.groupJid,
    },
  });
};

export const sendTextMessage = async (
  client: WuzapiClient,
  params: {
    to: string;
    body: string;
    mentions?: string[];
    mentionAll?: boolean | null;
    quoted?: { stanzaId: string; participant?: string | null };
  },
): Promise<string | null> => {
  const normalizedBody = params.body.replace(/\\n/g, "\n");
  const isChannel = params.to.trim().toLowerCase().endsWith("@newsletter");
  if (isChannel) {
    const channelPayload = {
      Channel: params.to.trim(),
      Body: normalizedBody,
    };
    const response = await requestWuzapi<any>(
      client,
      "/channel/send/text",
      {
        method: "POST",
        body: channelPayload,
      },
    );
    const messageId = extractMessageId(response);
    await recordOutgoingConversationMessage(client, {
      to: params.to,
      messageId,
      messageType: "text",
      text: normalizedBody,
      raw: {
        request: cloneJsonSafe(channelPayload),
        response: cloneJsonSafe(response),
      },
    });
    return messageId;
  }
  const payload: Record<string, unknown> = {
    Body: normalizedBody,
    body: normalizedBody,
  };
  applyRecipientToPayload(payload, params.to);

  const mentionList = normalizeMentionTargetsForEasyZap(params.mentions);
  if (mentionList.length > 0) {
    payload.Mentions = mentionList;
    payload.mentions = mentionList;
  }
  if (params.mentionAll) {
    payload.MentionAll = true;
    payload.mentionAll = true;
  }

  if (params.quoted?.stanzaId) {
    payload.ContextInfo = {
      StanzaId: params.quoted.stanzaId,
      Participant: params.quoted.participant ?? undefined,
    };
  }

  const response = await requestWuzapi<any>(client, "/chat/send/text", {
    method: "POST",
    body: payload,
  });
  const messageId = extractMessageId(response);
  await recordOutgoingConversationMessage(client, {
    to: params.to,
    messageId,
    messageType: "text",
    text: normalizedBody,
    raw: {
      request: cloneJsonSafe(payload),
      response: cloneJsonSafe(response),
    },
  });
  return messageId;
};

export const sendInteractiveButtons = async (
  client: WuzapiClient,
  params: SendInteractiveButtonsParams,
): Promise<string | null> => {
  if (!Array.isArray(params.buttons) || params.buttons.length === 0) {
    throw new Error("At least one button is required.");
  }
  if (params.buttons.length > 3) {
    throw new Error("WhatsApp allows up to 3 buttons.");
  }

  const footerValue = (params.footer ?? "").replace(/\\n/g, "\n");
  const rawBody =
    typeof params.body === "string" && params.body.trim().length > 0
      ? params.body
      : (params.title ?? "Selecione uma opção abaixo.");
  const bodyValue = rawBody.replace(/\\n/g, "\n");
  const footerText = footerValue;
  const titleValue =
    typeof params.title === "string" && params.title.trim().length > 0
      ? params.title.replace(/\\n/g, "\n").trim()
      : "\u200B";

  const requiresNativeFlow = params.buttons.some(
    (button) =>
      button.type === "cta_url" ||
      button.type === "cta_call" ||
      button.type === "cta_copy" ||
      button.type === "single_select" ||
      Boolean(
        button.url ||
        button.merchantUrl ||
        button.phoneNumber ||
        button.copyCode ||
        button.payload ||
        button.payloadJson,
      ),
  );
  const requestedButtonType = params.buttonType ?? "legacy";
  const buttonType = requiresNativeFlow
    ? "native"
    : requestedButtonType === "native"
      ? "native"
      : "legacy";
  const includePayloadParams = buttonType === "native";

  const buttonsPayload = params.buttons.map((button) => {
    const record: Record<string, unknown> = {
      ButtonId: button.id,
      ButtonText: button.text,
      DisplayText: button.text,
    };
    record.buttonId = button.id;
    record.buttonText = button.text;
    record.displayText = button.text;
    if (
      button.type &&
      (button.type !== "quick_reply" || buttonType === "native")
    ) {
      record.Type = button.type;
      record.type = button.type;
    }
    if (button.url) {
      record.Url = button.url;
      record.url = button.url;
    }
    if (button.merchantUrl) {
      record.MerchantUrl = button.merchantUrl;
      record.merchantUrl = button.merchantUrl;
    }
    if (button.phoneNumber) {
      record.PhoneNumber = button.phoneNumber;
      record.phoneNumber = button.phoneNumber;
    }
    if (button.copyCode) {
      record.CopyCode = button.copyCode;
      record.copyCode = button.copyCode;
    }
    if (includePayloadParams) {
      if (button.payload && Object.keys(button.payload).length > 0) {
        try {
          const serialized = JSON.stringify(button.payload);
          record.ButtonParamsJson = serialized;
          record.buttonParamsJson = serialized;
        } catch {
          record.ButtonParamsJson = JSON.stringify({ payload: button.payload });
          record.buttonParamsJson = JSON.stringify({ payload: button.payload });
        }
      }
      if (button.payloadJson && button.payloadJson.trim().length > 0) {
        const trimmedPayload = button.payloadJson.trim();
        record.ButtonParamsJson = trimmedPayload;
        record.buttonParamsJson = trimmedPayload;
      }
    }
    return record;
  });

  const payload: Record<string, unknown> = {
    Title: titleValue,
    title: titleValue,
    Body: bodyValue,
    body: bodyValue,
    FooterText: footerText,
    Footer: footerText,
    footer: footerText,
    Buttons: buttonsPayload,
    buttons: buttonsPayload,
  };

  const buttonTypeFinal = buttonType;
  if (buttonTypeFinal) {
    payload.ButtonType = buttonTypeFinal;
    payload.buttonType = buttonTypeFinal;
  }
  if (buttonTypeFinal === "native") {
    payload.NativeFlow = true;
    payload.nativeFlow = true;
  }

  applyRecipientToPayload(payload, params.to);

  if (params.mentions?.length) {
    const mentionList = normalizeMentionTargetsForEasyZap(params.mentions);
    if (mentionList.length > 0) {
      payload.Mentions = mentionList;
      payload.mentions = mentionList;
    }
  }

  if (params.quoted?.stanzaId) {
    payload.ContextInfo = {
      StanzaId: params.quoted.stanzaId,
      Participant: params.quoted.participant ?? undefined,
    };
  }
  let headerMediaDescriptor: Record<string, unknown> | undefined;
  if (params.headerMedia) {
    const mediaType =
      params.headerMedia.type === "video"
        ? "video"
        : params.headerMedia.type === "document"
          ? "document"
          : "image";
    const normalizedMedia = await ensureMediaData(
      params.headerMedia.media,
      params.headerMedia.mimeType ??
        (mediaType === "image"
          ? "image/jpeg"
          : mediaType === "video"
            ? "video/mp4"
            : "application/octet-stream"),
      mediaType,
    );
    const headerPayload: Record<string, unknown> = {
      type: mediaType,
      media: normalizedMedia,
      Type: mediaType,
      Media: normalizedMedia,
    };
    if (params.headerMedia.mimeType) {
      headerPayload.mimeType = params.headerMedia.mimeType;
      headerPayload.MimeType = params.headerMedia.mimeType;
    }
    if (params.headerMedia.fileName) {
      headerPayload.fileName = params.headerMedia.fileName;
      headerPayload.FileName = params.headerMedia.fileName;
    }
    headerMediaDescriptor = toInteractiveHeaderMediaDescriptor(
      headerPayload,
      params.headerMedia.sourceUrl ?? params.headerMedia.media,
    );
    payload.HeaderMedia = headerPayload;
    payload.headerMedia = headerPayload;
  }

  const response = await requestWuzapi<any>(client, "/chat/send/buttons", {
    method: "POST",
    body: payload,
  });

  const messageId = extractMessageId(response);
  await recordOutgoingConversationMessage(client, {
    to: params.to,
    messageId,
    messageType: "buttons",
    media: {
      mediaType: "buttons",
      kind: "interactive",
      title: params.title,
      body: bodyValue,
      caption: bodyValue,
      footer: footerText,
      buttons: buttonsPayload.map(toButtonDescriptor),
      buttonType: buttonTypeFinal,
      headerMedia: headerMediaDescriptor,
    },
    raw: {
      request: cloneJsonSafe(payload),
      response: cloneJsonSafe(response),
    },
  });
  return messageId;
};

const DEFAULT_WHATSAPP_FORM_CTA = "Abrir formulário";

const normalizeWhatsAppFormFieldKey = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/[- ]/g, "_");
  const aliases: Record<string, string> = {
    name: "full_name",
    nome: "full_name",
    fullname: "full_name",
    nome_completo: "full_name",
    phone: "phone_number",
    telefone: "phone_number",
    celular: "phone_number",
    whatsapp: "phone_number",
    cpf: "cpf_or_cnpj",
    cnpj: "cpf_or_cnpj",
    cpf_cnpj: "cpf_or_cnpj",
    address: "delivery_address",
    endereco: "delivery_address",
    endereço: "delivery_address",
    document: "citizenship_card",
    documento: "citizenship_card",
  };
  return aliases[normalized] ?? normalized;
};

const normalizeWhatsAppFormFieldType = (
  value: WhatsAppFormField["type"] | undefined,
) => {
  const normalized = (value || "text_input")
    .toUpperCase()
    .replace(/[- ]/g, "_");
  return ["TEXT_INPUT", "TEXT_AREA", "EMAIL", "PHONE", "NUMBER"].includes(
    normalized,
  )
    ? normalized
    : "TEXT_INPUT";
};

const buildWhatsAppFormButtonParams = (params: SendWhatsAppFormParams) => {
  const flowId = params.flowId.trim();
  const data: Record<string, unknown> = { ...(params.data ?? {}) };
  const visibilityKeys: Record<string, string> = {
    full_name: "full_name_visible",
    phone_number: "phone_number_visible",
    email: "email_visible",
    cpf_or_cnpj: "cpf_or_cnpj_visible",
    delivery_address: "delivery_address_visible",
    citizenship_card: "citizenship_card_visible",
  };
  const customFields: Array<Record<string, unknown>> = [];
  for (const field of params.fields) {
    const key = normalizeWhatsAppFormFieldKey(field.key);
    const visibilityKey = visibilityKeys[key];
    if (visibilityKey) {
      data[visibilityKey] = true;
      continue;
    }
    customFields.push({
      type: normalizeWhatsAppFormFieldType(field.type),
      label: field.label,
    });
  }
  if (customFields.length > 0) {
    data.custom_fields = customFields;
  }

  const buttonParams: Record<string, unknown> = {
    mode: params.mode || "published",
    flow_message_version: "3",
    flow_id: flowId,
    flow_cta: params.cta?.trim() || DEFAULT_WHATSAPP_FORM_CTA,
    flow_action: "navigate",
  };
  const flowToken = params.flowToken?.trim();
  if (flowToken) {
    buttonParams.flow_token = flowToken;
  }
  const screen = params.screen?.trim();
  if (screen || Object.keys(data).length > 0) {
    buttonParams.flow_action_payload = {
      ...(screen ? { screen } : {}),
      ...(Object.keys(data).length > 0 ? { data } : {}),
    };
  }
  if (params.flowMetadata && Object.keys(params.flowMetadata).length > 0) {
    buttonParams.flow_metadata = params.flowMetadata;
  }
  return buttonParams;
};

export const sendWhatsAppForm = async (
  client: WuzapiClient,
  params: SendWhatsAppFormParams,
): Promise<string | null> => {
  const body = params.body.replace(/\\n/g, "\n").trim();
  if (!body) {
    throw new Error("O texto do formulário é obrigatório.");
  }
  if (!params.flowId.trim()) {
    throw new Error(
      "Informe um flowId publicado e autorizado para esta conta do WhatsApp Business.",
    );
  }
  if (!Array.isArray(params.fields)) {
    throw new Error("Os campos do formulário são inválidos.");
  }

  const normalizedFields = params.fields.map((field, index) => {
    const key = field.key?.trim();
    const label = field.label?.trim();
    if (!key || !label) {
      throw new Error(`O campo ${index + 1} precisa de chave e título.`);
    }
    return {
      key,
      label,
      type: field.type || "text",
      required: field.required ?? false,
      placeholder: field.placeholder?.trim() || undefined,
    };
  });
  const buttonParams = buildWhatsAppFormButtonParams({
    ...params,
    fields: normalizedFields,
  });
  const payload: Record<string, unknown> = {
    Title: params.title?.trim() || "",
    title: params.title?.trim() || "",
    Body: body,
    body,
    Footer: params.footer?.trim() || "",
    footer: params.footer?.trim() || "",
    CTA: params.cta?.trim() || "",
    cta: params.cta?.trim() || "",
    FlowId: params.flowId.trim(),
    flowId: params.flowId.trim(),
    FlowToken: params.flowToken?.trim() || "",
    flowToken: params.flowToken?.trim() || "",
    Screen: params.screen?.trim() || "",
    screen: params.screen?.trim() || "",
    Mode: params.mode || "published",
    mode: params.mode || "published",
    FlowMetadata: params.flowMetadata ?? {},
    flowMetadata: params.flowMetadata ?? {},
    Fields: normalizedFields,
    fields: normalizedFields,
    Data: params.data ?? {},
    data: params.data ?? {},
    MessageVersion: 3,
    messageVersion: 3,
    FlowVersion: "4",
    flowVersion: "4",
  };
  applyRecipientToPayload(payload, params.to);

  const mentionList = normalizeMentionTargetsForEasyZap(params.mentions);
  if (mentionList.length > 0) {
    payload.Mentions = mentionList;
    payload.mentions = mentionList;
  }
  if (params.quoted?.stanzaId) {
    payload.ContextInfo = {
      StanzaId: params.quoted.stanzaId,
      Participant: params.quoted.participant ?? undefined,
    };
  }

  const response = await requestWuzapi<any>(client, "/chat/send/form", {
    method: "POST",
    body: payload,
  });
  const messageId = extractMessageId(response);
  const cta = params.cta?.trim() || "Preencher formulário";
  await recordOutgoingConversationMessage(client, {
    to: params.to,
    messageId,
    messageType: "interactive",
    text: body,
    media: {
      mediaType: "buttons",
      kind: "interactive",
      type: "native_flow",
      interactiveType: "flow",
      title: params.title?.trim() || null,
      body,
      caption: body,
      footer: params.footer?.trim() || null,
      messageVersion: 3,
      messageParamsJson: "{}",
      buttons: [
        {
          name: "galaxy_message",
          type: "galaxy_message",
          title: cta,
          displayText: cta,
          buttonParamsJson: JSON.stringify(buttonParams),
          params: buttonParams,
          isFlow: true,
          flow: {
            id: buttonParams.flow_id,
            flowId: buttonParams.flow_id,
            token: buttonParams.flow_token,
            action: buttonParams.flow_action,
            screen: (
              buttonParams.flow_action_payload as { screen?: string } | undefined
            )?.screen,
            messageVersion: buttonParams.flow_message_version,
            cta,
            data: (
              buttonParams.flow_action_payload as
                | { data?: Record<string, unknown> }
                | undefined
            )?.data,
            actionPayload: buttonParams.flow_action_payload,
          },
        },
      ],
      fields: normalizedFields,
    },
    raw: {
      request: cloneJsonSafe(payload),
      response: cloneJsonSafe(response),
    },
  });
  return messageId;
};

const toInteractiveHeaderMediaDescriptor = (
  media: Record<string, unknown> | undefined,
  originalMedia?: Buffer | string | null,
): Record<string, unknown> | undefined => {
  if (!media) return undefined;
  const rawType =
    firstString(
      media.mediaType,
      media.MediaType,
      media.type,
      media.Type,
      media.kind,
      media.Kind,
    ) ?? "image";
  const normalizedType =
    rawType.toLowerCase() === "video"
      ? "video"
      : rawType.toLowerCase() === "document" || rawType.toLowerCase() === "file"
        ? "document"
        : "image";
  const originalReference =
    typeof originalMedia === "string" && originalMedia.trim()
      ? originalMedia.trim()
      : null;
  const mediaValue = firstString(
    originalReference,
    media.sourceUrl,
    media.SourceUrl,
    media.dataUrl,
    media.DataUrl,
    media.url,
    media.URL,
    media.mediaUrl,
    media.MediaUrl,
    media.link,
    media.Link,
    media.media,
    media.Media,
  );
  const mimeType = firstString(
    media.mimeType,
    media.MimeType,
    media.mimetype,
    media.Mimetype,
  );
  const fileName = firstString(
    media.fileName,
    media.FileName,
    media.filename,
    media.Filename,
    media.name,
    media.Name,
  );
  const descriptor: Record<string, unknown> = {
    mediaType: normalizedType,
    kind: normalizedType,
    type: normalizedType,
  };
  if (
    originalReference &&
    (/^https?:\/\//i.test(originalReference) ||
      /^\/?(?:uploads|storage\/uploads)\//i.test(originalReference))
  ) {
    descriptor.sourceUrl = originalReference;
  }
  if (mediaValue) {
    if (
      /^https?:\/\//i.test(mediaValue) ||
      /^\/?(?:uploads|storage\/uploads)\//i.test(mediaValue)
    ) {
      descriptor.url = mediaValue;
    } else if (/^data:/i.test(mediaValue)) {
      descriptor.dataUrl = mediaValue;
    } else {
      descriptor.media = mediaValue;
    }
  }
  if (mimeType) {
    descriptor.mimeType = mimeType;
  }
  if (fileName) {
    descriptor.fileName = fileName;
    descriptor.filename = fileName;
  }
  return descriptor;
};

const normalizeListMedia = async (
  media: ListMessageMedia | null | undefined,
): Promise<Record<string, unknown> | undefined> => {
  if (!media) {
    return undefined;
  }
  const mediaType =
    media.type === "video"
      ? "video"
      : media.type === "document"
        ? "document"
        : "image";
  const fallbackMime =
    media.mimeType ??
    (mediaType === "image"
      ? "image/jpeg"
      : mediaType === "video"
        ? "video/mp4"
        : "application/octet-stream");
  const normalizedMedia = await ensureMediaData(
    media.media,
    fallbackMime,
    mediaType,
  );
  const payload: Record<string, unknown> = {
    type: mediaType,
    media: normalizedMedia,
  };
  if (media.mimeType) {
    payload.mimeType = media.mimeType;
  }
  if (media.fileName) {
    payload.fileName = media.fileName;
  }
  return payload;
};

const normalizeListSections = (
  sections: ListMessageSection[] | null | undefined,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(sections)) {
    return [];
  }
  return sections
    .map((section) => {
      const title =
        typeof section.title === "string" ? section.title.trim() : "";
      const rows = Array.isArray(section.rows)
        ? section.rows
            .map((row) => {
              const rowTitle =
                typeof row.title === "string" ? row.title.trim() : "";
              if (!rowTitle) {
                return null;
              }
              const rowId =
                (typeof row.rowId === "string" && row.rowId.trim()) ||
                (typeof row.id === "string" && row.id.trim()) ||
                rowTitle;
              const record: Record<string, unknown> = {
                title: rowTitle,
                rowId,
              };
              if (typeof row.header === "string" && row.header.trim()) {
                record.header = row.header.trim();
              }
              if (
                typeof row.description === "string" &&
                row.description.trim()
              ) {
                record.description = row.description.trim();
              }
              return record;
            })
            .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        : [];
      if (!title || rows.length === 0) {
        return null;
      }
      const record: {
        title: string;
        rows: Array<Record<string, unknown>>;
        highlightLabel?: string;
      } = { title, rows };
      if (
        typeof section.highlightLabel === "string" &&
        section.highlightLabel.trim()
      ) {
        record.highlightLabel = section.highlightLabel.trim();
      }
      return record;
    })
    .filter(
      (
        entry,
      ): entry is {
        title: string;
        rows: Array<Record<string, unknown>>;
        highlightLabel?: string;
      } => Boolean(entry),
    )
    .map((entry) => entry as Record<string, unknown>);
};

const normalizeListButtons = (
  buttons: ListMessageButton[] | null | undefined,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(buttons)) {
    return [];
  }
  return buttons
    .map((button) => {
      const buttonText =
        (typeof button.buttonText === "string" && button.buttonText.trim()) ||
        (typeof button.text === "string" && button.text.trim()) ||
        "";
      if (!buttonText) {
        return null;
      }
      const record: Record<string, unknown> = {
        type: button.type ?? "quick_reply",
        buttonText,
      };
      if (button.id && button.id.trim()) {
        record.id = button.id.trim();
      }
      if (button.url && button.url.trim()) {
        record.url = button.url.trim();
      }
      if (button.phoneNumber && button.phoneNumber.trim()) {
        record.phoneNumber = button.phoneNumber.trim();
      }
      if (button.copyCode && button.copyCode.trim()) {
        record.copyCode = button.copyCode.trim();
      }
      return record;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
};

export const sendListMessage = async (
  client: WuzapiClient,
  params: SendListMessageParams,
): Promise<string | null> => {
  const title = params.title.trim();
  const description = params.description.replace(/\\n/g, "\n").trim();
  if (!title) {
    throw new Error("List message title is required.");
  }
  if (!description && (!params.cards || params.cards.length === 0)) {
    throw new Error("List message description is required.");
  }

  const requestedSections = normalizeListSections(params.sections);
  const lists = Array.isArray(params.lists)
    ? (params.lists
        .map((list) => {
          const buttonText =
            typeof list.buttonText === "string" ? list.buttonText.trim() : "";
          const listSections = normalizeListSections(list.sections);
          if (!buttonText || listSections.length === 0) {
            return null;
          }
          return { buttonText, sections: listSections };
        })
        .filter(Boolean) as Array<Record<string, unknown>>)
    : [];
  // The carousel transport still requires a valid root section in EasyZap.
  // Promote the first list without removing the carousel lists themselves.
  const sections =
    requestedSections.length > 0
      ? requestedSections
      : ((lists[0]?.sections as Array<Record<string, unknown>> | undefined) ??
        []);
  const buttons = normalizeListButtons(params.buttons);
  const media = await normalizeListMedia(params.media);
  const headerMediaDescriptor = toInteractiveHeaderMediaDescriptor(
    media,
    params.media?.sourceUrl ?? params.media?.media,
  );

  const cards = Array.isArray(params.cards)
    ? await Promise.all(
        params.cards.map(async (card) => {
          const cardSections = normalizeListSections(card.sections);
          const cardLists = Array.isArray(card.lists)
            ? (card.lists
                .map((list) => {
                  const buttonText =
                    typeof list.buttonText === "string"
                      ? list.buttonText.trim()
                      : "";
                  const listSections = normalizeListSections(list.sections);
                  if (!buttonText || listSections.length === 0) {
                    return null;
                  }
                  return { buttonText, sections: listSections };
                })
                .filter(Boolean) as Array<Record<string, unknown>>)
            : [];
          const cardButtons = normalizeListButtons(card.buttons);
          const cardMedia = await normalizeListMedia(card.media);
          const record: Record<string, unknown> = {};
          if (card.title && card.title.trim()) record.title = card.title.trim();
          if (card.description && card.description.trim())
            record.description = card.description.trim();
          if (card.footerText && card.footerText.trim())
            record.footerText = card.footerText.trim();
          if (card.buttonText && card.buttonText.trim())
            record.buttonText = card.buttonText.trim();
          if (cardSections.length > 0) record.sections = cardSections;
          if (cardLists.length > 0) record.lists = cardLists;
          if (cardButtons.length > 0) record.buttons = cardButtons;
          if (cardMedia) record.media = cardMedia;
          return Object.keys(record).length > 0
            ? {
                record,
                originalMedia:
                  card.media?.sourceUrl ?? card.media?.media ?? null,
              }
            : null;
        }),
      )
    : [];

  const listMessage: Record<string, unknown> = {
    title,
    description: description || title,
    buttonText: params.buttonText?.trim() || "Ver opções",
  };
  if (params.footerText && params.footerText.trim()) {
    listMessage.footerText = params.footerText.trim();
  }
  if (sections.length > 0) {
    listMessage.sections = sections;
  }
  if (lists.length > 0) {
    listMessage.lists = lists;
  }
  if (buttons.length > 0) {
    listMessage.buttons = buttons;
  }
  if (media) {
    listMessage.media = media;
  }
  const validCards = cards.filter(
    (
      entry,
    ): entry is {
      record: Record<string, unknown>;
      originalMedia: Buffer | string | null;
    } => Boolean(entry),
  );
  if (validCards.length > 0) {
    listMessage.cards = validCards.map((entry) => entry.record);
  }

  const payload: Record<string, unknown> = {
    transport: params.transport ?? DEFAULT_LIST_MESSAGE_TRANSPORT,
    listMessage,
  };
  applyRecipientToPayload(payload, params.to);

  const response = await requestWuzapi<any>(client, "/chat/send/list", {
    method: "POST",
    body: payload,
  });

  const messageId = extractMessageId(response);
  const rootSections = [
    ...toListSectionsDescriptor(listMessage.sections),
    ...lists.flatMap((list) =>
      list && typeof list === "object" && !Array.isArray(list)
        ? toListSectionsDescriptor((list as Record<string, unknown>).sections)
        : [],
    ),
  ];
  const cardDescriptors = validCards.map((card) => {
    const cardRecord = cloneJsonSafe(card.record) ?? card.record;
    const cardLists = Array.isArray(cardRecord.lists) ? cardRecord.lists : [];
    const cardHeaderMedia = toInteractiveHeaderMediaDescriptor(
      cardRecord.media &&
        typeof cardRecord.media === "object" &&
        !Array.isArray(cardRecord.media)
        ? (cardRecord.media as Record<string, unknown>)
        : undefined,
      card.originalMedia,
    );
    return {
      ...cardRecord,
      headerMedia: cardHeaderMedia,
      body:
        firstString(cardRecord.description, cardRecord.body, cardRecord.text) ??
        "",
      caption:
        firstString(
          cardRecord.description,
          cardRecord.body,
          cardRecord.text,
          cardRecord.title,
        ) ?? "",
      sections: [
        ...toListSectionsDescriptor(cardRecord.sections),
        ...cardLists.flatMap((list) =>
          list && typeof list === "object" && !Array.isArray(list)
            ? toListSectionsDescriptor(
                (list as Record<string, unknown>).sections,
              )
            : [],
        ),
      ],
      buttons: Array.isArray(cardRecord.buttons)
        ? cardRecord.buttons
            .map((button) =>
              button && typeof button === "object" && !Array.isArray(button)
                ? toButtonDescriptor(button as Record<string, unknown>)
                : null,
            )
            .filter((button): button is Record<string, unknown> =>
              Boolean(button),
            )
        : [],
    };
  });
  await recordOutgoingConversationMessage(client, {
    to: params.to,
    messageId,
    messageType: "list",
    media: {
      mediaType: "list",
      kind: "interactive",
      title,
      body: description || title,
      caption: description || title,
      footer: params.footerText?.trim() || "",
      buttonText: listMessage.buttonText,
      sections: rootSections,
      buttons: buttons.map(toButtonDescriptor),
      cards: cardDescriptors,
      headerMedia: headerMediaDescriptor,
    },
    raw: {
      request: cloneJsonSafe(payload),
      response: cloneJsonSafe(response),
    },
  });
  return messageId;
};

export type SendPollPayload = {
  to: string;
  question: string;
  options: string[];
  mentions?: string[];
  selectableOptionsCount?: number;
  pollId?: string;
};

export type SendPollResult = {
  messageId: string | null;
  pollId: string;
  poll?: {
    name?: string;
    options?: Array<{ hash: string; name: string }>;
    selectableOptionsCount?: number;
  };
  raw: unknown;
};

export const sendPollMessage = async (
  client: WuzapiClient,
  params: SendPollPayload,
): Promise<SendPollResult> => {
  const pollId =
    params.pollId?.trim() && params.pollId.trim().length >= 6
      ? params.pollId.trim()
      : randomBytes(10).toString("hex").toUpperCase();

  const trimmedOptions = params.options
    .map((option) => (typeof option === "string" ? option.trim() : ""))
    .filter((option) => option.length > 0);

  if (trimmedOptions.length < 2) {
    throw new Error("Poll requires at least two options.");
  }

  const payload: Record<string, unknown> = {
    Group: params.to,
    Header: params.question,
    Options: trimmedOptions,
    Id: pollId,
  };

  if (
    typeof params.selectableOptionsCount === "number" &&
    Number.isFinite(params.selectableOptionsCount) &&
    params.selectableOptionsCount > 0
  ) {
    payload.SelectableOptionsCount = Math.floor(params.selectableOptionsCount);
  }

  if (params.mentions?.length) {
    const mentionList = normalizeMentionTargetsForEasyZap(params.mentions);
    if (mentionList.length > 0) {
      payload.Mentions = mentionList;
    }
  }

  const response = await requestWuzapi<any>(client, "/chat/send/poll", {
    method: "POST",
    body: payload,
  });

  const messageId = extractMessageId(response);
  const responsePoll = response?.data?.Poll ?? response?.Poll ?? undefined;
  const resolvedPollId = String(
    response?.data?.Id ??
      response?.Id ??
      response?.data?.pollId ??
      response?.pollId ??
      pollId,
  );

  return {
    messageId,
    pollId: resolvedPollId,
    poll: responsePoll,
    raw: response,
  };
};

export const sendPollVoteMessage = async (
  client: WuzapiClient,
  params: {
    chatId: string;
    pollMessageId: string;
    options: string[];
    senderJid?: string | null;
    fromMe?: boolean;
  },
) => {
  const selectedOptions = params.options
    .map((option) => (typeof option === "string" ? option.trim() : ""))
    .filter((option) => option.length > 0);
  if (selectedOptions.length === 0) {
    throw new Error("Poll vote requires at least one option.");
  }

  const payload: Record<string, unknown> = {
    chat: params.chatId,
    Chat: params.chatId,
    PollMessageId: params.pollMessageId,
    Id: params.pollMessageId,
    SelectedOptions: selectedOptions,
    Options: selectedOptions,
    FromMe: Boolean(params.fromMe),
  };
  applyRecipientToPayload(payload, params.chatId);
  if (params.senderJid) {
    const trimmedSender = String(params.senderJid).trim();
    const normalized = trimmedSender.includes("@")
      ? trimmedSender
      : normalizeJid(trimmedSender) || trimmedSender;
    payload.Sender = normalized;
    payload.Participant = normalized;
  }

  return requestWuzapi<unknown>(client, "/chat/send/poll-vote", {
    method: "POST",
    body: payload,
  });
};

export type SendStatusResponse = {
  Details?: string;
  Timestamp?: number | string;
  Id?: string;
  Type?: string;
};

export type SetStatusPrivacyParams = {
  mode: "contacts" | "whitelist" | "blacklist";
  list?: string[] | null;
};

const normalizeStatusResponse = (response: unknown): SendStatusResponse => {
  if (!response || typeof response !== "object") {
    return {};
  }
  const maybeData = (response as { data?: unknown }).data;
  if (maybeData && typeof maybeData === "object" && !Array.isArray(maybeData)) {
    const data = maybeData as SendStatusResponse;
    return {
      Details: data.Details ?? (response as SendStatusResponse).Details,
      Timestamp: data.Timestamp ?? (response as SendStatusResponse).Timestamp,
      Id: data.Id ?? (response as SendStatusResponse).Id,
      Type: data.Type ?? (response as SendStatusResponse).Type,
    };
  }
  return response as SendStatusResponse;
};

export const sendStatusUpdate = async (
  client: WuzapiClient,
  payload: {
    type: "text" | "image" | "video";
    text?: string | null;
    image?: Buffer | string | null;
    video?: Buffer | string | null;
    caption?: string | null;
    mimeType?: string | null;
    jpegThumbnail?: Buffer | string | null;
    id?: string | null;
    mentions?: string[] | null;
    allowReshare?: boolean | null;
  },
): Promise<SendStatusResponse> => {
  const body: Record<string, unknown> = {
    type: payload.type,
  };

  if (payload.id) {
    body.id = payload.id;
  }

  if (Array.isArray(payload.mentions) && payload.mentions.length > 0) {
    const mentionList = payload.mentions
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        if (entry.includes("@")) {
          const lowered = entry.toLowerCase();
          if (lowered.endsWith("@c.us")) {
            return `${lowered.slice(0, -5)}@s.whatsapp.net`;
          }
          return lowered;
        }
        const digits = entry.replace(/\D+/g, "");
        return digits ? `${digits}@s.whatsapp.net` : "";
      })
      .filter((entry) => entry.length > 0);
    if (mentionList.length > 0) {
      body.mentions = mentionList;
      body.Mentions = mentionList;
    }
  }

  if (typeof payload.allowReshare === "boolean") {
    body.allow_reshare = payload.allowReshare;
    body.allowReshare = payload.allowReshare;
  }

  if (payload.type === "text") {
    if (!payload.text || !payload.text.trim()) {
      throw new Error("Informe o texto do status.");
    }
    body.text = payload.text.trim();
  } else if (payload.type === "image") {
    if (!payload.image) {
      throw new Error("Informe a imagem do status.");
    }
    const mediaValue =
      typeof payload.image === "string"
        ? (normalizeMediaInputUrl(payload.image) ?? payload.image)
        : bufferToDataUrl(payload.image, payload.mimeType ?? "image/jpeg");
    body.image = mediaValue;
    if (payload.caption) {
      body.caption = payload.caption;
    }
    if (payload.mimeType) {
      body.mime_type = payload.mimeType;
    }
  } else if (payload.type === "video") {
    if (!payload.video) {
      throw new Error("Informe o vídeo do status.");
    }
    const mediaValue =
      typeof payload.video === "string"
        ? (normalizeMediaInputUrl(payload.video) ?? payload.video)
        : bufferToDataUrl(payload.video, payload.mimeType ?? "video/mp4");
    body.video = mediaValue;
    if (payload.caption) {
      body.caption = payload.caption;
    }
    if (payload.mimeType) {
      body.mime_type = payload.mimeType;
    }
    if (payload.jpegThumbnail) {
      body.jpeg_thumbnail =
        typeof payload.jpegThumbnail === "string"
          ? payload.jpegThumbnail
          : bufferToDataUrl(payload.jpegThumbnail, "image/jpeg");
    }
  }

  const response = await requestWuzapi<
    SendStatusResponse | { data?: SendStatusResponse }
  >(client, "/status/send", {
    method: "POST",
    body,
  });
  return normalizeStatusResponse(response);
};

export const deleteStatusUpdate = async (
  client: WuzapiClient,
  params: { id: string },
): Promise<void> => {
  await requestWuzapi(client, "/status/delete", {
    method: "POST",
    body: { id: params.id },
  });
};

export const setStatusPrivacy = async (
  client: WuzapiClient,
  params: SetStatusPrivacyParams,
): Promise<void> => {
  const list =
    Array.isArray(params.list) && params.list.length > 0
      ? params.list
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : [];

  await requestWuzapi(client, "/status/privacy", {
    method: "POST",
    body: {
      mode: params.mode,
      list,
    },
  });
};

const sanitizeFileName = (
  value: string | null | undefined,
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const safe = value.trim().replace(/[\\/:*?"<>|\s]+/g, "_");
  return safe.length > 0 ? safe : undefined;
};

async function tryConvertBufferToMp4Data(
  buffer: Buffer,
  inputExtension = "bin",
): Promise<string | null> {
  try {
    const safeExtension =
      inputExtension.replace(/[^a-z0-9]+/gi, "").slice(0, 8) || "bin";
    const nonce = `${Date.now()}_${randomBytes(4).toString("hex")}`;
    const inPath = path.join(tmpdir(), `wz_in_${nonce}.${safeExtension}`);
    const outPath = path.join(tmpdir(), `wz_out_${Date.now()}.mp4`);
    await writeFile(inPath, buffer);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-y",
        "-i",
        inPath,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-profile:v",
        "baseline",
        "-level",
        "3.0",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outPath,
      ]);
      ff.on("error", reject);
      ff.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}`));
      });
    });
    const data = await readFile(outPath);
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
    return `data:video/mp4;base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

async function tryConvertVideoUrlToMp4Data(
  url: string,
): Promise<string | null> {
  try {
    const resp = await fetch(resolveOwnAppFetchUrl(url));
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return await tryConvertBufferToMp4Data(buf, "gif");
  } catch {
    return null;
  }
}

const sanitizeDataMime = (
  mimeType: string,
  mediaType: SendMediaPayload["mediaType"],
): string => {
  const raw = (mimeType || "").toLowerCase().trim();
  const base = raw.split(";")[0].split(/\s+/)[0];

  const enforce = (fallback: string, prefix: string) => {
    if (base && base.includes("/") && base.startsWith(prefix)) {
      return base;
    }
    return fallback;
  };

  if (mediaType === "image") {
    return enforce("image/jpeg", "image/");
  }
  if (mediaType === "video") {
    return enforce("video/mp4", "video/");
  }
  if (mediaType === "audio") {
    // Preferimos mp3/mpeg para compatibilidade (evita ogg)
    return enforce("audio/mpeg", "audio/");
  }
  if (mediaType === "document") {
    if (base && base.includes("/")) {
      return base;
    }
    return "application/octet-stream";
  }
  return base && base.includes("/") ? base : "application/octet-stream";
};

const readLocalUploadMedia = async (input: string): Promise<Buffer | null> => {
  const pathname = (() => {
    const withoutQuery = input.split(/[?#]/, 1)[0]?.trim() ?? "";
    if (!withoutQuery) {
      return "";
    }
    try {
      return decodeURIComponent(withoutQuery);
    } catch {
      return withoutQuery;
    }
  })();
  const normalized = pathname.replace(/\\/g, "/").replace(/^\/+/, "");
  const relative = normalized.startsWith("uploads/")
    ? normalized.slice("uploads/".length)
    : normalized.startsWith("public/uploads/")
      ? normalized.slice("public/uploads/".length)
      : normalized.startsWith("storage/uploads/")
        ? normalized.slice("storage/uploads/".length)
        : "";
  if (!relative || relative.includes("..")) {
    return null;
  }

  const roots = [
    path.resolve(process.cwd(), "public", "uploads"),
    path.resolve(process.cwd(), "storage", "uploads"),
  ];
  for (const root of roots) {
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      continue;
    }
    try {
      return await readFile(filePath);
    } catch {
      // tenta o próximo local de armazenamento
    }
  }
  return null;
};

const ensureMediaData = async (
  media: Buffer | string,
  mimeType: string,
  mediaType: SendMediaPayload["mediaType"],
): Promise<string> => {
  const normalizedMime = (mimeType || "").toLowerCase();
  const treatAsVideo =
    mediaType === "video" ||
    (mediaType === "document" && normalizedMime.startsWith("video/"));
  const treatAsAudio =
    mediaType === "audio" ||
    (mediaType === "document" && normalizedMime.startsWith("audio/"));
  const baseMime = treatAsVideo
    ? "video/mp4"
    : treatAsAudio
      ? mimeType || "audio/mpeg"
      : mimeType;
  const mt = sanitizeDataMime(baseMime, mediaType);
  const dataUrlMime =
    mediaType === "document" ? "application/octet-stream" : mt;
  const makeDataUrl = (rawBase64: string) =>
    `data:${dataUrlMime};base64,${rawBase64.replace(/\s+/g, "")}`;

  if (typeof media === "string") {
    const trimmed = media.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("data:")) {
      const cleaned = trimmed
        .replace(/^data:[^;]+;base64,/, "")
        .replace(/\s+/g, "");
      if (treatAsVideo && !normalizedMime.startsWith("video/")) {
        const converted = await tryConvertBufferToMp4Data(
          Buffer.from(cleaned, "base64"),
          "gif",
        );
        if (converted) return converted;
      }
      return makeDataUrl(cleaned);
    }
    if (/^https?:\/\//i.test(trimmed)) {
      if (treatAsAudio) {
        const resp = await fetch(resolveOwnAppFetchUrl(trimmed));
        const buf = Buffer.from(await resp.arrayBuffer());
        return makeDataUrl(buf.toString("base64"));
      }
      if (treatAsVideo) {
        const mp4 = await tryConvertVideoUrlToMp4Data(trimmed);
        if (mp4) {
          const cleaned = mp4.replace(/^data:[^;]+;base64,/, "");
          return makeDataUrl(cleaned);
        }
      }
      return trimmed;
    }
    const localUploadData = await readLocalUploadMedia(trimmed);
    if (localUploadData) {
      return makeDataUrl(localUploadData.toString("base64"));
    }
    if (/^\/?(?:uploads|storage\/uploads)\//i.test(trimmed)) {
      const response = await fetch(resolveOwnAppFetchUrl(trimmed));
      if (!response.ok) {
        throw new Error(
          `Não foi possível recuperar a mídia armazenada (${response.status}).`,
        );
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        throw new Error("A mídia armazenada está vazia.");
      }
      return makeDataUrl(buffer.toString("base64"));
    }
    return makeDataUrl(trimmed);
  }

  if (treatAsVideo && !normalizedMime.startsWith("video/")) {
    const extension = normalizedMime.includes("gif")
      ? "gif"
      : normalizedMime.includes("webp")
        ? "webp"
        : normalizedMime.includes("png")
          ? "png"
          : normalizedMime.includes("jpeg") || normalizedMime.includes("jpg")
            ? "jpg"
            : "bin";
    const converted = await tryConvertBufferToMp4Data(media, extension);
    if (converted) return converted;
  }

  return makeDataUrl(media.toString("base64"));
};

const decodeDataUrlBuffer = (value: string): Buffer | null => {
  const match = /^data:[^;]+;base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  try {
    return Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  } catch {
    return null;
  }
};

const loadStickerBufferForFinalization = async (
  media: Buffer | string,
): Promise<Buffer | null> => {
  if (Buffer.isBuffer(media)) {
    return media;
  }

  const trimmed = media.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("data:")) {
    return decodeDataUrlBuffer(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const response = await fetch(resolveOwnAppFetchUrl(trimmed));
      if (!response.ok) {
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  const localUploadData = await readLocalUploadMedia(trimmed);
  if (localUploadData) {
    return localUploadData;
  }

  if (
    /^[a-z0-9+/=\s]+$/i.test(trimmed) &&
    trimmed.replace(/\s+/g, "").length > 80
  ) {
    try {
      return Buffer.from(trimmed.replace(/\s+/g, ""), "base64");
    } catch {
      return null;
    }
  }

  return null;
};

const stickerFileNameForMimeType = (mimeType: string): string => {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.includes("mp4") || normalized.startsWith("video/"))
    return "sticker-source.mp4";
  if (normalized.includes("gif")) return "sticker-source.gif";
  if (normalized.includes("png")) return "sticker-source.png";
  if (normalized.includes("jpeg") || normalized.includes("jpg"))
    return "sticker-source.jpg";
  if (normalized.includes("webp")) return "sticker-source.webp";
  return "sticker-source.bin";
};

const ensureStickerData = async (
  media: Buffer | string,
  mimeType: string,
  params: {
    pack?: string | null;
    author?: string | null;
    packId?: string | null;
    emojis?: string[] | null;
  },
): Promise<string> => {
  const sourceBuffer = await loadStickerBufferForFinalization(media);
  if (sourceBuffer && sourceBuffer.length > 0) {
    try {
      const { ensureStickerWebp, finalizeStickerWebp } =
        await import("lib/sticker");
      const normalizedMime = mimeType.trim().toLowerCase();
      const isWebp =
        normalizedMime.includes("webp") ||
        (sourceBuffer.length >= 12 &&
          sourceBuffer.subarray(0, 4).toString("ascii") === "RIFF" &&
          sourceBuffer.subarray(8, 12).toString("ascii") === "WEBP");
      const finalized = isWebp
        ? await finalizeStickerWebp(sourceBuffer, {
            pack: params.pack,
            author: params.author,
            packId: params.packId,
            emojis: params.emojis,
          })
        : (
            await ensureStickerWebp(
              {
                kind: "buffer",
                buffer: sourceBuffer,
                fileName: stickerFileNameForMimeType(normalizedMime),
                mimeType,
              },
              {
                pack: params.pack,
                author: params.author,
                packId: params.packId,
                emojis: params.emojis,
              },
            )
          ).buffer;
      return `data:image/webp;base64,${finalized.toString("base64")}`;
    } catch (error) {
      console.warn(
        "[wuzapi] Falha ao finalizar metadata do sticker; enviando payload original",
        { error },
      );
    }
  }

  const stickerSource =
    typeof media === "string" ? normalizeMediaInputUrl(media) : media;
  const ensureType = mimeType.startsWith("video/") ? "video" : "image";
  return ensureMediaData(
    stickerSource,
    mimeType,
    ensureType as SendMediaPayload["mediaType"],
  );
};

const MEDIA_ENDPOINTS: Record<
  SendMediaPayload["mediaType"],
  {
    path: string;
    field: string;
    supportsCaption: boolean;
    requiresFileName: boolean;
  }
> = {
  image: {
    path: "/chat/send/image",
    field: "Image",
    supportsCaption: true,
    requiresFileName: false,
  },
  video: {
    path: "/chat/send/video",
    field: "Video",
    supportsCaption: true,
    requiresFileName: true,
  },
  audio: {
    path: "/chat/send/audio",
    field: "Audio",
    supportsCaption: false,
    requiresFileName: true,
  },
  document: {
    path: "/chat/send/document",
    field: "Document",
    supportsCaption: true,
    requiresFileName: true,
  },
};

const getPublicBaseUrl = (): string | null => {
  const candidates = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_CAP_SERVER_URL,
    process.env.NOTIFICATIONS_APP_URL,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed.replace(/\/+$/, "");
    }
  }
  return null;
};

const validateOwnAudioUrl = async (input: string): Promise<void> => {
  const base = getPublicBaseUrl();
  if (!base) return;

  let target: URL;
  let origin: URL;
  try {
    target = new URL(input);
    origin = new URL(base);
  } catch {
    return;
  }

  // Providers externos podem não implementar HEAD; valide somente o endpoint
  // local, onde um 404/JSON não pode ser enviado como se fosse áudio.
  if (
    target.origin !== origin.origin ||
    !/^\/api\/(?:rest\/)?playaudio\//.test(target.pathname)
  ) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(target, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Arquivo de áudio indisponível (HTTP ${response.status}).`,
      );
    }
    const size = Number(
      response.headers.get("x-content-length") ||
        response.headers.get("content-length") ||
        0,
    );
    if (size > 0 && size < 1_024) {
      throw new Error("Arquivo de áudio incompleto.");
    }
    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();
    if (
      contentType.includes("application/json") ||
      contentType.startsWith("text/")
    ) {
      throw new Error("A fonte retornou um erro no lugar do áudio.");
    }
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeMediaInputUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("data:") || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) {
    return trimmed;
  }
  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${baseUrl}${normalizedPath}`;
};

const extractMessageId = (resp: any): string | null => {
  const cand = [
    resp?.data?.Id,
    resp?.Id,
    resp?.data?.id,
    resp?.id,
    resp?.data?.MessageID,
    resp?.MessageID,
    resp?.data?.MessageId,
    resp?.MessageId,
    resp?.data?.messageId,
    resp?.messageId,
    resp?.data?.Key?.Id,
    resp?.Key?.Id,
    resp?.data?.key?.id,
    resp?.key?.id,
  ];
  const found = cand.find(Boolean);
  if (!found) return null;
  return String(found).replace(/^me:/, "");
};

export const sendMediaMessage = async (
  client: WuzapiClient,
  params: SendMediaPayload,
): Promise<string | null> => {
  const endpoint = MEDIA_ENDPOINTS[params.mediaType];
  if (!endpoint) {
    throw new Error(`Unsupported media type: ${params.mediaType}`);
  }

  const defaultMime =
    params.mediaType === "image"
      ? "image/jpeg"
      : params.mediaType === "audio"
        ? "audio/mpeg"
        : params.mediaType === "video"
          ? "video/mp4"
          : "application/octet-stream";
  const sourceMimeType = params.mimeType?.trim() || defaultMime;
  const mimeType = sanitizeDataMime(sourceMimeType, params.mediaType);
  const payload: Record<string, unknown> = {
    MimeType: mimeType,
    mimeType,
  };
  applyRecipientToPayload(payload, params.to);

  const fileName = sanitizeFileName(params.filename);
  if (endpoint.requiresFileName && fileName) {
    payload.FileName = fileName;
    payload.fileName = fileName;
  }

  if (
    endpoint.supportsCaption &&
    typeof params.caption === "string" &&
    params.caption.trim()
  ) {
    payload.Caption = params.caption.trim();
    payload.caption = params.caption.trim();
  }

  if (
    typeof params.durationSeconds === "number" &&
    Number.isFinite(params.durationSeconds)
  ) {
    const secs = Math.max(0, Math.round(params.durationSeconds));
    payload.Duration = secs;
    payload.duration = secs;
  }

  const gifPlayback =
    Boolean(params.gifPlayback || params.isAnimated) &&
    (params.mediaType === "video" || params.mediaType === "image");
  if (gifPlayback) {
    payload.GifPlayback = true;
    payload.gifPlayback = true;
    payload.IsGif = true;
    payload.isGif = true;
    payload.IsAnimated = true;
    payload.isAnimated = true;
  }
  if (params.viewOnce) {
    payload.ViewOnce = true;
    payload.viewOnce = true;
    payload.IsViewOnce = true;
    payload.isViewOnce = true;
  }

  if (params.quoted?.stanzaId) {
    payload.ContextInfo = {
      StanzaId: params.quoted.stanzaId,
      Participant: params.quoted.participant ?? undefined,
    };
  }

  if (Array.isArray(params.mentions) && params.mentions.length > 0) {
    const mentionList = normalizeMentionTargetsForEasyZap(params.mentions);
    if (mentionList.length > 0) {
      payload.Mentions = mentionList;
    }
  }
  if (params.mentionAll) {
    payload.MentionAll = true;
    payload.mentionAll = true;
  }

  const mediaSource =
    typeof params.media === "string"
      ? normalizeMediaInputUrl(params.media)
      : params.media;
  const shouldUseExternalUrl =
    Boolean(params.useExternalUrl) &&
    typeof mediaSource === "string" &&
    /^https?:\/\//i.test(mediaSource);

  if (
    shouldUseExternalUrl &&
    (params.mediaType === "audio" || params.mediaType === "document")
  ) {
    await validateOwnAudioUrl(mediaSource as string);
  }

  const mediaData = shouldUseExternalUrl
    ? (mediaSource as string)
    : await ensureMediaData(mediaSource, sourceMimeType, params.mediaType);
  payload[endpoint.field] = mediaData;
  payload[endpoint.field.toLowerCase()] = mediaData;

  const resp = await requestWuzapi<any>(client, endpoint.path, {
    method: "POST",
    body: payload,
  });
  const messageId = extractMessageId(resp);
  await recordOutgoingConversationMessage(client, {
    to: params.to,
    messageId,
    messageType: params.mediaType,
    media: {
      mediaType: params.mediaType,
      kind: params.mediaType,
      mimeType,
      filename: fileName ?? null,
      caption: params.caption?.trim() || null,
      url:
        typeof mediaSource === "string" && /^https?:\/\//i.test(mediaSource)
          ? mediaSource
          : null,
      isAnimated: gifPlayback || Boolean(params.isAnimated),
      viewOnce: Boolean(params.viewOnce),
      gifPlayback,
    },
    raw: {
      request: cloneJsonSafe({
        ...payload,
        [endpoint.field]: undefined,
        [endpoint.field.toLowerCase()]: undefined,
      }),
      response: cloneJsonSafe(resp),
    },
  });
  return messageId;
};

const DEFAULT_STICKER_PACK = STICKER_PACK_NAME;
const DEFAULT_STICKER_AUTHOR = STICKER_PACK_AUTHOR;
const DEFAULT_STICKER_PACK_ID = STICKER_PACK_ID;

export const sendStickerPackMessage = async (
  client: WuzapiClient,
  params: SendStickerPackPayload,
): Promise<string | null> => {
  const pack = params.pack?.trim() || DEFAULT_STICKER_PACK;
  const author = params.author?.trim() || DEFAULT_STICKER_AUTHOR;
  const packId = params.packId?.trim() || deriveStickerPackId(pack);
  const stickers = params.stickers.reduce<Record<string, unknown>[]>(
    (acc, item, index) => {
      const source = item.sticker?.trim();
      if (!source) return acc;
      const normalizedSource = normalizeMediaInputUrl(source);
      const cleanEmojis = Array.isArray(item.emojis)
        ? item.emojis.filter(
            (emoji) => typeof emoji === "string" && emoji.trim(),
          )
        : undefined;
      const fileName =
        sanitizeFileName(item.fileName) ||
        `sticker-${String(index + 1).padStart(2, "0")}.webp`;
      acc.push({
        Sticker: normalizedSource,
        sticker: normalizedSource,
        FileName: fileName,
        fileName,
        MimeType: item.mimeType?.trim() || "image/webp",
        mimeType: item.mimeType?.trim() || "image/webp",
        Emojis: cleanEmojis,
        emojis: cleanEmojis,
        AccessibilityLabel: item.accessibilityLabel?.trim() || undefined,
        accessibilityLabel: item.accessibilityLabel?.trim() || undefined,
        IsLottie: Boolean(item.isLottie),
        isLottie: Boolean(item.isLottie),
      });
      return acc;
    },
    [],
  );

  if (stickers.length === 0) {
    throw new Error("Sticker pack sem figurinhas.");
  }

  const payload: Record<string, unknown> = {
    Pack: pack,
    pack,
    PackName: pack,
    packName: pack,
    Author: author,
    author,
    PackAuthor: author,
    packAuthor: author,
    PackID: packId,
    packId,
    Stickers: stickers,
    stickers,
  };
  applyRecipientToPayload(payload, params.to);

  if (typeof params.caption === "string" && params.caption.trim()) {
    payload.Caption = params.caption.trim();
    payload.caption = params.caption.trim();
  }
  if (typeof params.description === "string" && params.description.trim()) {
    payload.Description = params.description.trim();
    payload.description = params.description.trim();
  }
  if (params.quoted?.stanzaId) {
    payload.ContextInfo = {
      StanzaId: params.quoted.stanzaId,
      Participant: params.quoted.participant ?? undefined,
    };
  }
  if (Array.isArray(params.mentions) && params.mentions.length > 0) {
    const mentionList = normalizeMentionTargetsForEasyZap(params.mentions);
    if (mentionList.length > 0) {
      payload.Mentions = mentionList;
    }
  }
  if (params.mentionAll) {
    payload.MentionAll = true;
    payload.mentionAll = true;
  }

  const resp = await requestWuzapi<any>(client, "/chat/send/sticker-pack", {
    method: "POST",
    body: payload,
  });
  const messageId = extractMessageId(resp);
  await recordOutgoingConversationMessage(client, {
    to: params.to,
    messageId,
    messageType: "sticker_pack",
    media: {
      mediaType: "sticker_pack",
      kind: "sticker_pack",
      pack,
      author,
      packId,
      stickers: stickers.map((item) => ({
        fileName: item.fileName ?? item.FileName ?? null,
        mimeType: item.mimeType ?? item.MimeType ?? null,
        url:
          typeof item.sticker === "string" && /^https?:\/\//i.test(item.sticker)
            ? item.sticker
            : null,
      })),
    },
    raw: {
      request: cloneJsonSafe(payload),
      response: cloneJsonSafe(resp),
    },
  });
  return messageId;
};

export const sendStickerMessage = async (
  client: WuzapiClient,
  params: {
    to: string;
    sticker: Buffer | string;
    mimeType?: string | null;
    quoted?: { stanzaId: string; participant?: string | null } | null;
    mentions?: string[] | null;
    mentionAll?: boolean | null;
    pack?: string | null;
    author?: string | null;
    packId?: string | null;
    emojis?: string[] | null;
  },
): Promise<string | null> => {
  const mimeType = params.mimeType?.trim() || "image/webp";
  const pack = params.pack?.trim() || DEFAULT_STICKER_PACK;
  const author = params.author?.trim() || DEFAULT_STICKER_AUTHOR;
  const packId = params.packId?.trim() || deriveStickerPackId(pack);
  const stickerSource =
    typeof params.sticker === "string"
      ? normalizeMediaInputUrl(params.sticker)
      : params.sticker;
  const stickerData = await ensureStickerData(stickerSource, mimeType, {
    pack,
    author,
    packId,
    emojis: params.emojis,
  });

  const payload: Record<string, unknown> = {
    Sticker: stickerData,
  };
  applyRecipientToPayload(payload, params.to);

  if (params.quoted?.stanzaId) {
    payload.ContextInfo = {
      StanzaId: params.quoted.stanzaId,
      Participant: params.quoted.participant ?? undefined,
    };
  }

  if (Array.isArray(params.mentions) && params.mentions.length > 0) {
    const mentionList = normalizeMentionTargetsForEasyZap(params.mentions);
    if (mentionList.length > 0) {
      payload.Mentions = mentionList;
    }
  }
  if (params.mentionAll) {
    payload.MentionAll = true;
    payload.mentionAll = true;
  }

  payload.Pack = pack;
  payload.Author = author;
  payload.PackId = packId;
  if (Array.isArray(params.emojis) && params.emojis.length > 0) {
    payload.Emojis = params.emojis.filter(
      (emoji) => typeof emoji === "string" && emoji.trim(),
    );
  }

  const resp = await requestWuzapi<any>(client, "/chat/send/sticker", {
    method: "POST",
    body: payload,
  });
  const messageId = extractMessageId(resp);
  await recordOutgoingConversationMessage(client, {
    to: params.to,
    messageId,
    messageType: "sticker",
    media: {
      mediaType: "sticker",
      kind: "sticker",
      mimeType,
      pack,
      author,
      packId,
      url:
        typeof stickerSource === "string" && /^https?:\/\//i.test(stickerSource)
          ? stickerSource
          : null,
    },
    raw: {
      request: cloneJsonSafe({ ...payload, Sticker: undefined }),
      response: cloneJsonSafe(resp),
    },
  });
  return messageId;
};

export const sendContactMessage = async (
  client: WuzapiClient,
  params: {
    to: string;
    name: string;
    vcard: string;
    quoted?: { stanzaId: string; participant?: string | null } | null;
    mentions?: string[] | null;
  },
): Promise<void> => {
  const payload: Record<string, unknown> = {
    Name: params.name,
    Vcard: params.vcard,
  };
  applyRecipientToPayload(payload, params.to);

  if (params.quoted?.stanzaId) {
    payload.ContextInfo = {
      StanzaId: params.quoted.stanzaId,
      Participant: params.quoted.participant ?? undefined,
    };
  }

  if (Array.isArray(params.mentions) && params.mentions.length > 0) {
    const mentionList = normalizeMentionTargetsForEasyZap(params.mentions);
    if (mentionList.length > 0) {
      payload.Mentions = mentionList;
    }
  }

  await requestWuzapi(client, "/chat/send/contact", {
    method: "POST",
    body: payload,
  });
};
