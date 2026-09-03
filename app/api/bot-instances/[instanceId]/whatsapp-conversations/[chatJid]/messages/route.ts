import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, refreshInstanceStatus } from "lib/bot-instances";
import { listGroupsForUser } from "lib/bot-groups";
import { resolveChatConversationAccess } from "lib/whatsapp-conversation-access";
import { evaluatePlanGuard } from "lib/plan-guard";
import {
  getGroupInfo,
  getUserAvatar,
  getUserChannel,
  sendInteractiveButtons,
  sendMediaMessage,
  sendStickerMessage,
  sendTextMessage,
  sendWhatsAppForm,
  type InteractiveButton,
  type SendMediaPayload,
  type SendWhatsAppFormParams,
  type WhatsAppFormField,
  type WuzapiClient,
} from "lib/wuzapi";
import {
  getWhatsappConversationThread,
  getWhatsappConversationMessageByClientIdForUser,
  getWhatsappChatPhone,
  getWhatsappChatType,
  listKnownWhatsappSenderIdentitiesForUser,
  listWhatsappConversationMessagePage,
  markWhatsappConversationThreadReadAndNotifyForUser,
  normalizeWhatsappChatJid,
  recordWhatsappConversationMessage,
  restoreWhatsappConversationMessagesFromRealtimeEvents,
  sanitizeWhatsappConversationMessageForTransport,
  sanitizeWhatsappConversationThreadForTransport,
  updateWhatsappMessageSenderAvatarForUser,
  upsertWhatsappConversation,
  type WhatsappConversationMessage,
} from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string }>;
};

type OutgoingMediaPayload = {
  mediaType: SendMediaPayload["mediaType"] | "sticker";
  mimeType: string;
  filename: string;
  caption: string | null;
  source?: string | null;
  url?: string | null;
  thumbnail?: string | null;
  isAnimated?: boolean;
  viewOnce?: boolean;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseLimit = (request: Request): number => {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get("limit");
    // Default to a recent window (WhatsApp-style), not a huge dump.
    const parsed = raw ? Number.parseInt(raw, 10) : 80;
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 80;
  } catch {
    return 80;
  }
};

const parseWarmFlag = (request: Request): boolean => {
  try {
    const url = new URL(request.url);
    const raw = (
      url.searchParams.get("warm") ||
      url.searchParams.get("prefetch") ||
      ""
    )
      .trim()
      .toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  } catch {
    return false;
  }
};

const parseBeforeCursor = (request: Request): string | null => {
  try {
    const url = new URL(request.url);
    return url.searchParams.get("before")?.trim() || null;
  } catch {
    return null;
  }
};

const inferMediaType = (mimeType: string): SendMediaPayload["mediaType"] => {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return "document";
};

const isGiphyAnimatedGifMedia = (
  source: string | null | undefined,
  isAnimated: boolean,
  mimeType: string,
) =>
  source === "giphy" &&
  isAnimated &&
  mimeType.trim().toLowerCase().startsWith("image/gif");

const filenameForWhatsappGifTransport = (filename: string) => {
  const safe = filename.trim() || `giphy-${Date.now()}.gif`;
  return safe.replace(/\.[a-z0-9]+$/i, ".mp4");
};

const getAvatarRenderableUrl = (
  avatar: Awaited<ReturnType<typeof getUserAvatar>>,
) => avatar?.url || null;

const parseBooleanFlag = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "on" ||
    normalized === "yes"
  );
};

const normalizeMentionTarget = (value: unknown) => {
  if (typeof value !== "string") return null;
  const jid = normalizeWhatsappChatJid(value);
  return jid && getWhatsappChatType(jid) === "contact" ? jid : null;
};

const parseJsonMaybe = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const firstTrimmedString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
};

const normalizePanelButtonType = (
  type: string,
  options: { url: string; copyCode: string },
): InteractiveButton["type"] => {
  const normalized = type.trim().toLowerCase();
  if (
    ["copy", "copiar", "cta_copy", "copy_code", "clipboard"].includes(
      normalized,
    )
  ) {
    return "cta_copy";
  }
  if (
    ["link", "url", "cta_url", "open_url", "abrir_link"].includes(normalized)
  ) {
    return "cta_url";
  }
  if (options.copyCode) return "cta_copy";
  return "cta_url";
};

const normalizeOutgoingButtons = (raw: unknown): InteractiveButton[] => {
  const parsed = parseJsonMaybe(raw);
  const entries = Array.isArray(parsed) ? parsed : [];
  const buttons: InteractiveButton[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const text = firstTrimmedString(
      record.text,
      record.label,
      record.title,
      record.buttonText,
    );
    const url = firstTrimmedString(record.url, record.href, record.link);
    const copyCode = firstTrimmedString(
      record.copyCode,
      record.copy_code,
      record.clipboardText,
      record.copyText,
      record.value,
    );
    if (!text && !url && !copyCode) continue;
    if (!text) {
      throw new Error("Informe o texto de todos os botões.");
    }
    if (text.length > 25) {
      throw new Error("O texto de cada botão deve ter até 25 caracteres.");
    }

    const type = normalizePanelButtonType(firstTrimmedString(record.type), {
      url,
      copyCode,
    });
    if (type === "cta_url") {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error("Informe uma URL http ou https para o botão de link.");
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Informe uma URL http ou https para o botão de link.");
      }
    }
    if (type === "cta_copy" && !copyCode) {
      throw new Error("Informe o conteúdo para copiar no botão.");
    }

    buttons.push({
      id:
        firstTrimmedString(record.id, record.buttonId) ||
        `panel_btn_${Date.now()}_${buttons.length}`,
      text,
      type,
      url: type === "cta_url" ? url : null,
      copyCode: type === "cta_copy" ? copyCode : null,
    });
    if (buttons.length >= 3) break;
  }

  return buttons;
};

type OutgoingFormPayload = Omit<
  SendWhatsAppFormParams,
  "to" | "quoted" | "mentions"
>;

const normalizeOutgoingForm = (
  raw: unknown,
  fallbackBody: string,
): OutgoingFormPayload | null => {
  const parsed = parseJsonMaybe(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const record = parsed as Record<string, unknown>;
  const rawFields = Array.isArray(record.fields)
    ? record.fields
    : Array.isArray(record.Fields)
      ? record.Fields
      : [];
  if (rawFields.length > 20) {
    throw new Error("O formulário aceita até 20 campos personalizados.");
  }

  const allowedTypes = new Set<WhatsAppFormField["type"]>([
    "text",
    "text_input",
    "text_area",
    "email",
    "phone",
    "number",
  ]);
  const fields: WhatsAppFormField[] = rawFields.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`O campo ${index + 1} é inválido.`);
    }
    const field = entry as Record<string, unknown>;
    const key = firstTrimmedString(field.key, field.id, field.name);
    const label = firstTrimmedString(
      field.label,
      field.title,
      field.name,
      field.key,
    );
    if (!key || !label) {
      throw new Error(`O campo ${index + 1} precisa de chave e título.`);
    }
    const rawType = firstTrimmedString(field.type)
      .toLowerCase()
      .replace(/[- ]/g, "_");
    const type = allowedTypes.has(rawType as WhatsAppFormField["type"])
      ? (rawType as WhatsAppFormField["type"])
      : "text";
    return {
      key,
      label,
      type,
      required: parseBooleanFlag(field.required),
      placeholder: firstTrimmedString(field.placeholder) || null,
    };
  });

  const body = firstTrimmedString(record.body, record.text, fallbackBody);
  if (!body) {
    throw new Error("Informe o texto que acompanha o formulário.");
  }
  const rawData = record.data ?? record.Data;
  const data =
    rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : null;
  const flowId = firstTrimmedString(record.flowId, record.flow_id);
  if (!flowId) {
    throw new Error(
      "Informe um flowId publicado e autorizado para esta conta do WhatsApp Business.",
    );
  }
  const rawFlowMetadata = record.flowMetadata ?? record.flow_metadata;
  const flowMetadata =
    rawFlowMetadata &&
    typeof rawFlowMetadata === "object" &&
    !Array.isArray(rawFlowMetadata)
      ? (rawFlowMetadata as Record<string, unknown>)
      : null;
  const rawMode = firstTrimmedString(record.mode).toLowerCase();
  return {
    body,
    title: firstTrimmedString(record.title, record.header) || null,
    footer: firstTrimmedString(record.footer) || null,
    cta:
      firstTrimmedString(record.cta, record.buttonText, record.buttonLabel) ||
      null,
    flowId,
    flowToken: firstTrimmedString(record.flowToken, record.flow_token) || null,
    screen: firstTrimmedString(record.screen) || null,
    mode: rawMode === "draft" ? "draft" : "published",
    flowMetadata,
    fields,
    data,
  };
};

const buildOutgoingFormMediaPayload = (form: OutgoingFormPayload) => {
  const visibilityKeys: Record<string, string> = {
    full_name: "full_name_visible",
    phone_number: "phone_number_visible",
    email: "email_visible",
    cpf_or_cnpj: "cpf_or_cnpj_visible",
    delivery_address: "delivery_address_visible",
    citizenship_card: "citizenship_card_visible",
  };
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
    "endereço": "delivery_address",
    document: "citizenship_card",
    documento: "citizenship_card",
  };
  const data: Record<string, unknown> = { ...(form.data ?? {}) };
  const customFields: Array<Record<string, unknown>> = [];
  for (const field of form.fields) {
    const rawKey = field.key.trim().toLowerCase().replace(/[- ]/g, "_");
    const key = aliases[rawKey] ?? rawKey;
    const visibilityKey = visibilityKeys[key];
    if (visibilityKey) {
      data[visibilityKey] = true;
      continue;
    }
    customFields.push({
      type: field.type === "text"
        ? "TEXT_INPUT"
        : (field.type || "text_input").toUpperCase().replace(/[- ]/g, "_"),
      label: field.label,
    });
  }
  if (customFields.length > 0) {
    data.custom_fields = customFields;
  }

  const params: Record<string, unknown> = {
    mode: form.mode || "published",
    flow_message_version: "3",
    flow_id: form.flowId,
    flow_cta: form.cta || "Abrir formulário",
    flow_action: "navigate",
  };
  if (form.flowToken) params.flow_token = form.flowToken;
  if (form.screen || Object.keys(data).length > 0) {
    params.flow_action_payload = {
      ...(form.screen ? { screen: form.screen } : {}),
      ...(Object.keys(data).length > 0 ? { data } : {}),
    };
  }
  if (form.flowMetadata && Object.keys(form.flowMetadata).length > 0) {
    params.flow_metadata = form.flowMetadata;
  }
  const cta = form.cta || "Preencher formulário";
  return {
    mediaType: "buttons",
    kind: "interactive",
    type: "native_flow",
    interactiveType: "flow",
    title: form.title,
    body: form.body,
    caption: form.body,
    footer: form.footer,
    messageVersion: 3,
    messageParamsJson: "{}",
    fields: form.fields,
    buttons: [
      {
        name: "galaxy_message",
        type: "galaxy_message",
        title: cta,
        displayText: cta,
        buttonParamsJson: JSON.stringify(params),
        params,
        isFlow: true,
        flow: {
          id: params.flow_id,
          flowId: params.flow_id,
          token: params.flow_token,
          action: params.flow_action,
          screen: (
            params.flow_action_payload as { screen?: string } | undefined
          )?.screen,
          messageVersion: params.flow_message_version,
          cta,
          data,
          actionPayload: params.flow_action_payload,
        },
      },
    ],
  };
};

const ownInstanceJid = (phone: string | null | undefined) => {
  const digits = (phone || "").replace(/\D+/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
};

const collectMentionTargets = (
  rawTargets: unknown[],
  instancePhone: string | null | undefined,
) => {
  const ownJid = ownInstanceJid(instancePhone);
  const seen = new Set<string>();
  for (const rawTarget of rawTargets) {
    const jid = normalizeMentionTarget(rawTarget);
    if (!jid || jid === ownJid) continue;
    seen.add(jid);
  }
  return Array.from(seen);
};

const participantIdFromRecord = (record: Record<string, unknown>) => {
  const candidates = [
    record.id,
    record.ID,
    record.jid,
    record.JID,
    record.phone,
    record.Phone,
    record.participant,
    record.Participant,
    record.user,
    record.User,
  ];
  const found = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );
  return typeof found === "string" ? found.trim() : null;
};

const extractParticipantIds = (payload: unknown) => {
  const result: unknown[] = [];

  const collectFromArray = (entries: unknown[]) => {
    for (const entry of entries) {
      if (typeof entry === "string") {
        result.push(entry);
        continue;
      }
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const id = participantIdFromRecord(entry as Record<string, unknown>);
        if (id) result.push(id);
      }
    }
  };

  const visit = (value: unknown, depth = 0) => {
    if (!value || depth > 3) return;
    if (Array.isArray(value)) {
      collectFromArray(value);
      return;
    }
    if (typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (
        /^(participants|members|users)$/i.test(key) &&
        Array.isArray(record[key])
      ) {
        collectFromArray(record[key] as unknown[]);
      }
      if (/(@s\.whatsapp\.net|@c\.us)$/i.test(key)) {
        result.push(key);
      }
    }

    visit(
      record.data ?? record.Data ?? record.result ?? record.Result,
      depth + 1,
    );
  };

  visit(payload);
  return result;
};

const resolveMentionTargets = async (options: {
  userId: number;
  instanceId: number;
  instancePhone: string | null | undefined;
  chatJid: string;
  mentionAll: boolean;
  rawMentions: unknown[];
  client?: WuzapiClient | null;
}) => {
  if (getWhatsappChatType(options.chatJid) !== "group") {
    return [];
  }

  const explicitTargets = collectMentionTargets(
    options.rawMentions,
    options.instancePhone,
  );
  if (explicitTargets.length > 0 || !options.mentionAll) {
    return explicitTargets;
  }

  const groups = await listGroupsForUser(options.userId);
  const group = groups.find(
    (entry) =>
      entry.instanceId === options.instanceId &&
      normalizeWhatsappChatJid(entry.remoteId) === options.chatJid,
  );
  const savedTargets = collectMentionTargets(
    group?.participants.map((participant) => participant.id) ?? [],
    options.instancePhone,
  );
  if (savedTargets.length > 0 || !options.client) {
    return savedTargets;
  }

  const liveInfo = await getGroupInfo<unknown>(
    options.client,
    options.chatJid,
  ).catch((error) => {
    console.warn(
      "[whatsapp-conversations] failed to load group participants for mentions",
      {
        chatJid: options.chatJid,
        error,
      },
    );
    return null;
  });
  return collectMentionTargets(
    extractParticipantIds(liveInfo),
    options.instancePhone,
  );
};

const hydrateSenderAvatars = async (
  messages: WhatsappConversationMessage[],
  options: {
    userId: number;
    instanceId: number;
    serverBaseUrl: string | null;
    token: string;
    sessionStatus: string | null;
  },
): Promise<WhatsappConversationMessage[]> => {
  if (
    messages.length === 0 ||
    !options.serverBaseUrl ||
    options.sessionStatus !== "conectado"
  ) {
    return messages;
  }

  const missingSenderJids = Array.from(
    new Set(
      messages
        .filter(
          (message) =>
            message.direction === "inbound" &&
            !message.senderAvatarUrl &&
            message.senderJid &&
            getWhatsappChatType(message.senderJid) === "contact",
        )
        .map((message) => normalizeWhatsappChatJid(message.senderJid || ""))
        .filter((jid): jid is string => Boolean(jid)),
    ),
  ).slice(0, 8);

  if (missingSenderJids.length === 0) {
    return messages;
  }

  const client = { baseUrl: options.serverBaseUrl, token: options.token };
  const hydrated = new Map<string, string>();
  for (const senderJid of missingSenderJids) {
    const avatarUrl = getAvatarRenderableUrl(
      await getUserAvatar(client, { contact: senderJid, preview: true }),
    );
    if (!avatarUrl) {
      continue;
    }
    hydrated.set(senderJid, avatarUrl);
    await updateWhatsappMessageSenderAvatarForUser(
      options.userId,
      options.instanceId,
      senderJid,
      avatarUrl,
    ).catch((error) => {
      console.warn("[whatsapp-conversations] failed to cache sender avatar", {
        senderJid,
        error,
      });
    });
  }

  if (hydrated.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    if (message.senderAvatarUrl || !message.senderJid) {
      return message;
    }
    const senderJid = normalizeWhatsappChatJid(message.senderJid);
    const avatarUrl = senderJid ? hydrated.get(senderJid) : null;
    return avatarUrl ? { ...message, senderAvatarUrl: avatarUrl } : message;
  });
};

const isPhoneLikeSenderName = (
  value: string | null | undefined,
  senderJid: string | null | undefined,
) => {
  const nameDigits = String(value ?? "").replace(/\D+/g, "");
  const senderDigits = getWhatsappChatPhone(senderJid ?? "") ?? "";
  return Boolean(
    nameDigits.length >= 8 &&
    senderDigits.length >= 8 &&
    (nameDigits === senderDigits ||
      nameDigits.endsWith(senderDigits) ||
      senderDigits.endsWith(nameDigits)),
  );
};

const applyCachedSenderIdentities = async (
  messages: WhatsappConversationMessage[],
  options: {
    userId: number;
    instanceId: number;
  },
) => {
  const senderJids = Array.from(
    new Set(
      messages
        .flatMap((message) => [
          ...(message.direction === "inbound" && message.senderJid
            ? [message.senderJid]
            : []),
          ...(message.mentionedJids ?? []),
        ])
        .map((jid) => normalizeWhatsappChatJid(jid))
        .filter(
          (senderJid): senderJid is string =>
            Boolean(senderJid) && getWhatsappChatType(senderJid!) === "contact",
        ),
    ),
  );
  if (senderJids.length === 0) return messages;

  const identities = await listKnownWhatsappSenderIdentitiesForUser(
    options.userId,
    options.instanceId,
    senderJids,
  );
  if (identities.size === 0) return messages;

  return messages.map((message) => {
    const normalizedSenderJid = message.senderJid
      ? normalizeWhatsappChatJid(message.senderJid)
      : null;
    const identity = normalizedSenderJid
      ? identities.get(normalizedSenderJid)
      : null;
    const mentionTargets = (message.mentionedJids ?? []).map((jid) => {
      const normalized = normalizeWhatsappChatJid(jid) || jid;
      const mentionIdentity = identities.get(normalized);
      const existing = message.mentionTargets?.find(
        (target) => normalizeWhatsappChatJid(target.jid) === normalized,
      );
      return {
        jid: normalized,
        name: mentionIdentity?.senderName || existing?.name || null,
      };
    });
    if (!identity) {
      return mentionTargets.length ? { ...message, mentionTargets } : message;
    }

    const shouldUseName = Boolean(
      identity.senderName &&
      (!message.senderName ||
        isPhoneLikeSenderName(message.senderName, message.senderJid)),
    );
    const shouldUseAvatar = Boolean(
      identity.senderAvatarUrl && !message.senderAvatarUrl,
    );
    if (!shouldUseName && !shouldUseAvatar) return message;

    return {
      ...message,
      senderName: shouldUseName ? identity.senderName : message.senderName,
      senderAvatarUrl: shouldUseAvatar
        ? identity.senderAvatarUrl
        : message.senderAvatarUrl,
      mentionTargets: mentionTargets.length
        ? mentionTargets
        : message.mentionTargets,
    };
  });
};

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "Não autenticado." },
        { status: 401 },
      );
    }

    const resolvedParams = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(resolvedParams.instanceId);
    const chatJid = normalizeWhatsappChatJid(
      decodeURIComponent(resolvedParams.chatJid),
    );
    if (!instanceId || !chatJid) {
      return NextResponse.json(
        { message: "Conversa inválida." },
        { status: 400 },
      );
    }

    const access = await resolveChatConversationAccess(
      user.id,
      instanceId,
      chatJid,
    );
    if (!access) {
      return NextResponse.json(
        { message: "Instância não encontrada." },
        { status: 404 },
      );
    }
    const { instance, storageUserId, isOwnerInstance } = access;
    const profileViolation = await evaluatePlanGuard({
      userId: instance.userId,
      instance,
    });
    if (profileViolation?.type === "instance") {
      return NextResponse.json(
        {
          code: "PROFILE_EXPIRED",
          message: "Renove este perfil para abrir as conversas.",
          expiresAt: instance.expiresAt,
        },
        { status: 402 },
      );
    }

    const warm = parseWarmFlag(request);
    const existingThread = await getWhatsappConversationThread(
      storageUserId,
      instance.id,
      chatJid,
    );
    const thread =
      existingThread ??
      (await upsertWhatsappConversation({
        userId: storageUserId,
        instanceId: instance.id,
        chatJid,
        chatType: getWhatsappChatType(chatJid),
        phone: getWhatsappChatPhone(chatJid),
      }));

    // Full open path may restore from realtime; warm/prefetch stays DB-only and fast.
    if (!warm) {
      await restoreWhatsappConversationMessagesFromRealtimeEvents(
        storageUserId,
        instance.id,
        chatJid,
      ).catch((error) => {
        console.warn(
          "[whatsapp-conversations] failed to restore messages from realtime events",
          {
            userId: storageUserId,
            instanceId: instance.id,
            chatJid,
            error,
          },
        );
      });
    }

    const messagePage = await listWhatsappConversationMessagePage(
      storageUserId,
      instance.id,
      chatJid,
      {
        limit: parseLimit(request),
        before: parseBeforeCursor(request),
      },
    );
    const cachedMessages = await applyCachedSenderIdentities(
      messagePage.messages,
      {
        userId: storageUserId,
        instanceId: instance.id,
      },
    );

    // Fast path used by Flutter prefetch/cache warmup: return recent messages only.
    // Skip slow side-effects so the UI can open chats instantly from cache.
    if (warm) {
      return NextResponse.json({
        thread: thread
          ? sanitizeWhatsappConversationThreadForTransport(thread)
          : thread,
        messages: cachedMessages.map(
          sanitizeWhatsappConversationMessageForTransport,
        ),
        hasMore: messagePage.hasMore,
        oldestCursor: messagePage.oldestCursor,
        warm: true,
      });
    }

    const sessionStatus = await refreshInstanceStatus(
      storageUserId,
      instance.id,
    ).catch(() => instance.sessionStatus);
    const hydratedMessages = await hydrateSenderAvatars(cachedMessages, {
      userId: storageUserId,
      instanceId: instance.id,
      serverBaseUrl: instance.serverBaseUrl,
      token: instance.token,
      sessionStatus,
    });
    if (isOwnerInstance) {
      await markWhatsappConversationThreadReadAndNotifyForUser(
        storageUserId,
        instance.id,
        chatJid,
      );
    }

    return NextResponse.json({
      thread: thread
        ? sanitizeWhatsappConversationThreadForTransport({
            ...thread,
            unreadCount: 0,
          })
        : thread,
      messages: hydratedMessages.map(
        sanitizeWhatsappConversationMessageForTransport,
      ),
      hasMore: messagePage.hasMore,
      oldestCursor: messagePage.oldestCursor,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to load WhatsApp conversation messages", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as mensagens." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "Não autenticado." },
        { status: 401 },
      );
    }

    const resolvedParams = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(resolvedParams.instanceId);
    const chatJid = normalizeWhatsappChatJid(
      decodeURIComponent(resolvedParams.chatJid),
    );
    if (!instanceId || !chatJid) {
      return NextResponse.json(
        { message: "Conversa inválida." },
        { status: 400 },
      );
    }

    const contentType =
      request.headers.get("content-type")?.toLowerCase() ?? "";
    let text = "";
    let file: File | null = null;
    let quoted: { stanzaId: string; participant?: string | null } | null = null;
    let mentionAll = false;
    let asSticker = false;
    let mediaSource: string | null = null;
    let mediaUrl: string | null = null;
    let mediaThumbnail: string | null = null;
    let mediaIsAnimated = false;
    let viewOnce = false;
    let rawMentions: unknown[] = [];
    let rawButtons: unknown = [];
    let rawForm: unknown = null;
    let clientMessageId: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      text =
        typeof formData.get("text") === "string"
          ? String(formData.get("text")).trim()
          : "";
      const rawFile = formData.get("file");
      file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;
      mentionAll = parseBooleanFlag(formData.get("mentionAll"));
      asSticker =
        parseBooleanFlag(formData.get("asSticker")) ||
        String(formData.get("mediaKind") ?? "")
          .trim()
          .toLowerCase() === "sticker";
      mediaSource =
        typeof formData.get("mediaSource") === "string"
          ? String(formData.get("mediaSource")).trim() || null
          : null;
      mediaUrl =
        typeof formData.get("mediaUrl") === "string"
          ? String(formData.get("mediaUrl")).trim() || null
          : null;
      mediaThumbnail =
        typeof formData.get("mediaThumbnail") === "string"
          ? String(formData.get("mediaThumbnail")).trim() || null
          : null;
      mediaIsAnimated = parseBooleanFlag(formData.get("isAnimated"));
      viewOnce = parseBooleanFlag(formData.get("viewOnce"));
      rawMentions = formData.getAll("mentions");
      rawButtons = parseJsonMaybe(formData.get("buttons"));
      rawForm = parseJsonMaybe(formData.get("form"));
      clientMessageId = typeof formData.get("clientMessageId") === "string"
        ? String(formData.get("clientMessageId")).trim().slice(0, 96) || null
        : null;
      const quotedMessageId =
        typeof formData.get("quotedMessageId") === "string"
          ? String(formData.get("quotedMessageId")).trim()
          : "";
      if (quotedMessageId) {
        quoted = {
          stanzaId: quotedMessageId,
          participant:
            typeof formData.get("quotedParticipant") === "string"
              ? String(formData.get("quotedParticipant")).trim() || null
              : null,
        };
      }
    } else {
      const body = await request.json().catch(() => null);
      text = typeof body?.text === "string" ? body.text.trim() : "";
      mentionAll = parseBooleanFlag(body?.mentionAll);
      asSticker =
        parseBooleanFlag(body?.asSticker) ||
        String(body?.mediaKind ?? "")
          .trim()
          .toLowerCase() === "sticker";
      mediaSource =
        typeof body?.mediaSource === "string"
          ? body.mediaSource.trim() || null
          : null;
      mediaUrl =
        typeof body?.mediaUrl === "string"
          ? body.mediaUrl.trim() || null
          : null;
      mediaThumbnail =
        typeof body?.mediaThumbnail === "string"
          ? body.mediaThumbnail.trim() || null
          : null;
      mediaIsAnimated = parseBooleanFlag(body?.isAnimated);
      viewOnce = parseBooleanFlag(body?.viewOnce);
      rawMentions = Array.isArray(body?.mentions)
        ? body.mentions
        : typeof body?.mentions === "string"
          ? body.mentions.split(/[\s,;]+/).filter(Boolean)
          : [];
      rawButtons = body?.buttons ?? body?.interactiveButtons ?? [];
      rawForm = body?.form ?? body?.whatsappForm ?? null;
      clientMessageId = typeof body?.clientMessageId === "string"
        ? body.clientMessageId.trim().slice(0, 96) || null
        : null;
      const quotedMessageId =
        typeof body?.quoted?.stanzaId === "string"
          ? body.quoted.stanzaId.trim()
          : typeof body?.quotedMessageId === "string"
            ? body.quotedMessageId.trim()
            : "";
      if (quotedMessageId) {
        quoted = {
          stanzaId: quotedMessageId,
          participant:
            typeof body?.quoted?.participant === "string"
              ? body.quoted.participant.trim() || null
              : typeof body?.quotedParticipant === "string"
                ? body.quotedParticipant.trim() || null
                : null,
        };
      }
    }

    let outgoingForm: OutgoingFormPayload | null = null;
    try {
      outgoingForm = normalizeOutgoingForm(rawForm, text);
    } catch (error) {
      return NextResponse.json(
        {
          message:
            error instanceof Error ? error.message : "Formulário inválido.",
        },
        { status: 400 },
      );
    }

    if (!text && !file && !outgoingForm) {
      return NextResponse.json(
        { message: "Digite a mensagem ou selecione um arquivo." },
        { status: 400 },
      );
    }

    let interactiveButtons: InteractiveButton[] = [];
    try {
      interactiveButtons = normalizeOutgoingButtons(rawButtons);
    } catch (error) {
      return NextResponse.json(
        {
          message: error instanceof Error ? error.message : "Botões inválidos.",
        },
        { status: 400 },
      );
    }
    if (asSticker && interactiveButtons.length > 0) {
      return NextResponse.json(
        { message: "Figurinhas não aceitam botões interativos." },
        { status: 400 },
      );
    }
    if (outgoingForm && (file || interactiveButtons.length > 0 || asSticker)) {
      return NextResponse.json(
        {
          message:
            "Envie o formulário sem arquivo, figurinha ou botões adicionais.",
        },
        { status: 400 },
      );
    }

    const access = await resolveChatConversationAccess(
      user.id,
      instanceId,
      chatJid,
    );
    if (!access) {
      return NextResponse.json(
        { message: "Instância não encontrada." },
        { status: 404 },
      );
    }
    const { instance, storageUserId } = access;
    if (clientMessageId) {
      const existing = await getWhatsappConversationMessageByClientIdForUser(
        storageUserId,
        instance.id,
        chatJid,
        clientMessageId,
      );
      if (existing) {
        const existingThread = await getWhatsappConversationThread(
          storageUserId,
          instance.id,
          chatJid,
        );
        return NextResponse.json({
          ok: true,
          idempotent: true,
          thread: existingThread
            ? sanitizeWhatsappConversationThreadForTransport(existingThread)
            : null,
          message: sanitizeWhatsappConversationMessageForTransport(existing),
        });
      }
    }
    const profileViolation = await evaluatePlanGuard({
      userId: instance.userId,
      instance,
    });
    if (profileViolation?.type === "instance") {
      return NextResponse.json(
        {
          code: "PROFILE_EXPIRED",
          message: "Renove este perfil para enviar mensagens.",
          expiresAt: instance.expiresAt,
        },
        { status: 402 },
      );
    }
    if (!instance.serverBaseUrl) {
      return NextResponse.json(
        { message: "Servidor da instância não configurado." },
        { status: 500 },
      );
    }

    const sessionStatus = await refreshInstanceStatus(
      storageUserId,
      instance.id,
    );
    if (sessionStatus !== "conectado") {
      return NextResponse.json(
        { message: "Conecte a instância antes de enviar mensagens." },
        { status: 409 },
      );
    }

    const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
    const storedThread = await getWhatsappConversationThread(
      storageUserId,
      instance.id,
      chatJid,
    );
    const chatType = storedThread?.chatType ?? getWhatsappChatType(chatJid);
    const isChannel = chatType === "channel" || chatJid.endsWith("@newsletter");

    if (isChannel) {
      const liveChannel = await getUserChannel(client, chatJid).catch(
        (error) => {
          console.warn(
            "[whatsapp-conversations] failed to refresh channel permission before send",
            { chatJid, error },
          );
          return null;
        },
      );
      const canSendMessages =
        liveChannel?.canSendMessages ?? storedThread?.canSendMessages ?? false;
      const readOnlyReason = canSendMessages
        ? null
        : "Somente administradores do canal podem publicar.";

      await upsertWhatsappConversation({
        userId: storageUserId,
        instanceId: instance.id,
        chatJid,
        chatType: "channel",
        title: liveChannel?.name ?? null,
        avatarUrl: liveChannel?.avatarUrl ?? null,
        groupDescription: liveChannel?.description ?? null,
        participantsCount: liveChannel?.subscribersCount ?? null,
        inviteLink: liveChannel?.inviteLink ?? null,
        announceOnly: true,
        instanceIsAdmin: canSendMessages,
        mentionable: false,
        canSendMessages,
        readOnlyReason,
        channelRole: liveChannel?.viewerRole ?? storedThread?.channelRole ?? null,
        directorySource: "channels",
      });

      if (!canSendMessages) {
        return NextResponse.json(
          { message: readOnlyReason },
          { status: 403 },
        );
      }
      if (outgoingForm || interactiveButtons.length > 0) {
        return NextResponse.json(
          {
            message:
              "Canais aceitam texto e mídia; botões e formulários não são compatíveis.",
          },
          { status: 400 },
        );
      }
    } else if (storedThread?.canSendMessages === false) {
      return NextResponse.json(
        {
          message:
            storedThread.readOnlyReason ||
            "Você não tem permissão para enviar mensagens nesta conversa.",
        },
        { status: 403 },
      );
    }

    const mentionTargets = await resolveMentionTargets({
      userId: storageUserId,
      instanceId: instance.id,
      instancePhone: instance.phone,
      chatJid,
      mentionAll,
      rawMentions,
      client,
    });
    const outgoingText = outgoingForm?.body ?? text;
    const fileMimeType = file?.type || "application/octet-stream";
    const sendGiphyGifAsWhatsappVideo = file
      ? isGiphyAnimatedGifMedia(mediaSource, mediaIsAnimated, fileMimeType)
      : false;
    const mediaPayload: OutgoingMediaPayload | null = file
      ? {
          mediaType: asSticker
            ? "sticker"
            : sendGiphyGifAsWhatsappVideo
              ? "video"
              : inferMediaType(fileMimeType),
          mimeType: sendGiphyGifAsWhatsappVideo ? "image/gif" : fileMimeType,
          filename: sendGiphyGifAsWhatsappVideo
            ? filenameForWhatsappGifTransport(
                file.name || `giphy-${Date.now()}.gif`,
              )
            : file.name || `arquivo-${Date.now()}`,
          caption: outgoingText || null,
          source: mediaSource,
          url: mediaUrl,
          thumbnail: mediaThumbnail,
          isAnimated: mediaIsAnimated,
          viewOnce,
        }
      : null;
    const mediaBuffer = file ? Buffer.from(await file.arrayBuffer()) : null;
    const hasInteractiveButtons = interactiveButtons.length > 0;
    const interactiveTitle = instance.name?.trim() || "BotAdmin";
    const interactiveBody =
      outgoingText || mediaPayload?.filename || "Selecione uma opção abaixo.";

    const messageId = outgoingForm
      ? await sendWhatsAppForm(client, {
          to: chatJid,
          ...outgoingForm,
          mentions: mentionTargets.length > 0 ? mentionTargets : undefined,
          quoted: quoted ?? undefined,
        })
      : hasInteractiveButtons
        ? await sendInteractiveButtons(client, {
            to: chatJid,
            title: interactiveTitle,
            body: interactiveBody,
            buttons: interactiveButtons,
            buttonType: "native",
            mentions: mentionTargets.length > 0 ? mentionTargets : undefined,
            quoted: quoted ?? undefined,
            headerMedia:
              mediaBuffer && mediaPayload
                ? {
                    type:
                      mediaPayload.mediaType === "image" ||
                      mediaPayload.mediaType === "video"
                        ? mediaPayload.mediaType
                        : "document",
                    media: mediaBuffer,
                    mimeType: mediaPayload.mimeType,
                    fileName: mediaPayload.filename,
                    sourceUrl:
                      mediaPayload.url ??
                      (typeof mediaSource === "string" ? mediaSource : null),
                  }
                : undefined,
          })
        : file
          ? asSticker
            ? await sendStickerMessage(client, {
                to: chatJid,
                sticker: mediaBuffer!,
                mimeType: mediaPayload!.mimeType,
                quoted: quoted ?? undefined,
                mentions:
                  mentionTargets.length > 0 ? mentionTargets : undefined,
                pack: "BotAdmin",
                author: "botadmin.shop",
              })
            : await sendMediaMessage(client, {
                to: chatJid,
                media: mediaBuffer!,
                mediaType: mediaPayload!
                  .mediaType as SendMediaPayload["mediaType"],
                caption: mediaPayload!.caption,
                filename: mediaPayload!.filename,
                mimeType: mediaPayload!.mimeType,
                mentions:
                  mentionTargets.length > 0 ? mentionTargets : undefined,
                quoted: quoted ?? undefined,
                isAnimated: mediaPayload!.isAnimated,
                gifPlayback:
                  mediaPayload!.source === "giphy" && mediaPayload!.isAnimated,
                viewOnce,
              })
          : await sendTextMessage(client, {
              to: chatJid,
              body: outgoingText,
              mentions: mentionTargets.length > 0 ? mentionTargets : undefined,
              quoted: quoted ?? undefined,
            });

    const formMediaPayload = outgoingForm
      ? buildOutgoingFormMediaPayload(outgoingForm)
      : null;
    const interactiveMediaPayload = hasInteractiveButtons
      ? {
          mediaType: "buttons",
          kind: "interactive",
          title: interactiveTitle,
          body: interactiveBody,
          caption: interactiveBody,
          footer: null,
          buttons: interactiveButtons.map((button) => ({
            id: button.id,
            buttonId: button.id,
            text: button.text,
            title: button.text,
            buttonText: button.text,
            displayText: button.text,
            type: button.type,
            url: button.type === "cta_url" ? (button.url ?? null) : null,
            copyCode:
              button.type === "cta_copy" ? (button.copyCode ?? null) : null,
          })),
          buttonType: "native",
          headerMedia: mediaPayload
            ? {
                type:
                  mediaPayload.mediaType === "image" ||
                  mediaPayload.mediaType === "video"
                    ? mediaPayload.mediaType
                    : "document",
                mimeType: mediaPayload.mimeType,
                fileName: mediaPayload.filename,
                url:
                  mediaPayload.url ??
                  (typeof mediaSource === "string" ? mediaSource : null),
                sourceUrl:
                  mediaPayload.url ??
                  (typeof mediaSource === "string" ? mediaSource : null),
                thumbnailUrl: mediaPayload.thumbnail,
              }
            : null,
        }
      : null;

    const result = await recordWhatsappConversationMessage({
      userId: storageUserId,
      instanceId: instance.id,
      chatJid,
      messageId,
      clientMessageId,
      direction: "outbound",
      senderJid: `${instance.phone}@s.whatsapp.net`,
      senderName: instance.name,
      messageType: outgoingForm
        ? "interactive"
        : hasInteractiveButtons
          ? "buttons"
          : (mediaPayload?.mediaType ?? "text"),
      text: outgoingText || null,
      media: formMediaPayload ?? interactiveMediaPayload ?? mediaPayload,
      timestamp: new Date(),
      title:
        getWhatsappChatType(chatJid) === "contact"
          ? getWhatsappChatPhone(chatJid)
          : null,
    });

    if (!result) {
      return NextResponse.json(
        {
          message:
            "Mensagem enviada, mas não foi possível sincronizar o histórico local.",
        },
        { status: 202 },
      );
    }

    return NextResponse.json({
      ok: true,
      thread: sanitizeWhatsappConversationThreadForTransport(result.thread),
      message: sanitizeWhatsappConversationMessageForTransport(result.message),
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }
    const status = (error as { status?: unknown })?.status;
    if (typeof status === "number" && status === 401) {
      return NextResponse.json(
        { message: "Token da instância inválido. Reconecte a instância." },
        { status: 401 },
      );
    }
    console.error("Failed to send WhatsApp panel message", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a mensagem." },
      { status: 500 },
    );
  }
}
