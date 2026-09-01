import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, getInstanceForUser } from "lib/bot-instances";
import {
  acceptWhatsappCall,
  attachWhatsappCallWebRTC,
  endWhatsappCall,
  listWhatsappCalls,
  rejectWhatsappCall,
  startWhatsappCall,
} from "lib/wuzapi";
import {
  getWhatsappChatPhone,
  getWhatsappChatType,
  listWhatsappConversationThreads,
  normalizeWhatsappChatJid,
  type WhatsappConversationThread,
} from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const readString = (record: Record<string, unknown> | null | undefined, ...keys: string[]): string | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

const readObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const normalizeSdpOffer = (value: string | null | undefined) => {
  const normalized = (value ?? "").replace(/\r?\n/g, "\r\n").trim();
  return normalized ? `${normalized}\r\n` : "";
};

const looksLikeWebRtcDataOffer = (sdp: string) => {
  if (!/^v=0\r?\n/i.test(sdp)) return false;
  if (!/\r?\nm=application\s/i.test(sdp)) return false;
  return /webrtc-datachannel|udp\/dtls\/sctp|dtls\/sctp|a=sctp-port/i.test(sdp);
};

const sanitizeSdpAnswer = (value: string | null | undefined) => {
  const normalized = (value ?? "").replace(/\r?\n/g, "\n").trim();
  if (!normalized) return "";
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "a=end-of-candidates");
  return lines.length ? `${lines.join("\r\n")}\r\n` : "";
};

const inferCallId = (payload: unknown): string | null => {
  const root = readObject(payload);
  const nested = readObject(root?.call) ?? readObject(root?.data) ?? readObject(root?.result);
  return (
    readString(root, "callId", "CallID", "id", "ID") ??
    readString(nested, "callId", "CallID", "id", "ID")
  );
};

const isMissingWhatsappCallError = (error: unknown): boolean => {
  const details = [
    error instanceof Error ? error.message : null,
    readObject(error)?.message,
    readObject(error)?.response ? JSON.stringify(readObject(error)?.response) : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return details.includes("no such call") || details.includes("call not found") || details.includes("chamada") && details.includes("finalizada");
};

const alreadyEndedResponse = (action: string, chatJid: string | null, callId: string) =>
  NextResponse.json({
    ok: true,
    action,
    chatJid,
    callId,
    alreadyEnded: true,
    message: "Chamada já finalizada.",
  });

const collectCallRecords = (value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    for (const item of value) collectCallRecords(item, output);
    return output;
  }
  const record = readObject(value);
  if (!record) return output;
  if (readString(record, "callId", "CallID", "id", "ID", "CallId")) {
    output.push(record);
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectCallRecords(nested, output);
  }
  return output;
};

type CallIdentityCandidate = {
  key: string;
  value: string;
};

const technicalKeyPattern = /(call_?id|message_?id|sdp|offer|answer|timestamp|created|updated|expires)/i;
const identityKeyPattern = /(jid|waid|phone|number|caller|from|to|creator|participant|sender|chat|remote|contact|user|lid)/i;
const nameKeyPattern = /(display_?name|push_?name|caller_?name|contact_?name|notify_?name|short_?name|name|title)/i;

const digitsOnly = (value: unknown): string => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\D+/g, "");
};

const normalizeComparableText = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const looksLikeLidIdentity = (candidate: CallIdentityCandidate): boolean => {
  const key = candidate.key.toLowerCase();
  const value = candidate.value.toLowerCase();
  return key.includes("lid") || value.includes("@lid") || value.endsWith(".lid");
};

const isExplicitPhoneCandidate = (candidate: CallIdentityCandidate): boolean =>
  /(phone|number|waid)/i.test(candidate.key) && !looksLikeLidIdentity(candidate);

const isPhoneLikeCallCandidate = (candidate: CallIdentityCandidate): boolean => {
  if (looksLikeLidIdentity(candidate)) return false;
  if (isExplicitPhoneCandidate(candidate)) return true;
  const value = candidate.value.trim();
  const key = candidate.key.toLowerCase();
  return (
    /@(?:s\.whatsapp\.net|c\.us)$/i.test(value) ||
    value.startsWith("+") ||
    /(?:caller|from|to|participant|sender|contact|user|chat|remote|creator)/i.test(key)
  );
};

const isUsablePhoneDigits = (digits: string): boolean => digits.length >= 10 && digits.length <= 16;

const collectCallIdentityCandidates = (
  value: unknown,
  output: CallIdentityCandidate[] = [],
  path: string[] = [],
  depth = 0,
): CallIdentityCandidate[] => {
  if (depth > 5 || value == null) return output;

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (!text) return output;
    const key = path[path.length - 1] ?? "";
    if (
      text.includes("@") ||
      (identityKeyPattern.test(key) && !technicalKeyPattern.test(key))
    ) {
      output.push({ key, value: text });
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectCallIdentityCandidates(item, output, path, depth + 1);
    return output;
  }

  const record = readObject(value);
  if (!record) return output;
  for (const [key, nested] of Object.entries(record)) {
    collectCallIdentityCandidates(nested, output, [...path, key], depth + 1);
  }
  return output;
};

const collectCallNameCandidates = (
  value: unknown,
  output: string[] = [],
  path: string[] = [],
  depth = 0,
): string[] => {
  if (depth > 5 || value == null) return output;

  if (typeof value === "string" || typeof value === "number") {
    const key = path[path.length - 1] ?? "";
    const text = String(value).trim();
    if (text && nameKeyPattern.test(key) && !technicalKeyPattern.test(key)) {
      output.push(text);
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectCallNameCandidates(item, output, path, depth + 1);
    return output;
  }

  const record = readObject(value);
  if (!record) return output;
  for (const [key, nested] of Object.entries(record)) {
    collectCallNameCandidates(nested, output, [...path, key], depth + 1);
  }
  return output;
};

const looksLikeTechnicalLabel = (value: string | null | undefined): boolean => {
  const text = (value ?? "").trim();
  if (!text) return true;
  if (text.length < 16) return false;
  if (/^[A-Fa-f0-9:_-]+$/.test(text)) return true;
  if (text.length >= 20 && /^[A-Za-z0-9_-]+$/.test(text) && !/\s/.test(text)) return true;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  return text.length >= 22 && digits > 0 && letters > 8;
};

const threadDisplayName = (thread: WhatsappConversationThread | null): string | null => {
  const title = thread?.title?.trim();
  if (!title || looksLikeTechnicalLabel(title)) return null;
  const normalizedJid = thread?.chatJid?.trim().toLowerCase();
  if (normalizedJid && title.toLowerCase() === normalizedJid) return null;
  return title;
};

const indexConversationThreads = (threads: WhatsappConversationThread[]) => {
  const byJid = new Map<string, WhatsappConversationThread>();
  const byPhone = new Map<string, WhatsappConversationThread>();
  const byTitle = new Map<string, WhatsappConversationThread>();

  for (const thread of threads) {
    const normalizedJid = normalizeWhatsappChatJid(thread.chatJid);
    if (normalizedJid) byJid.set(normalizedJid, thread);
    byJid.set(thread.chatJid.toLowerCase(), thread);

    const phone = digitsOnly(thread.phone) || getWhatsappChatPhone(thread.chatJid) || "";
    if (isUsablePhoneDigits(phone)) byPhone.set(phone, thread);

    const title = normalizeComparableText(thread.title);
    if (title && title !== "conversa" && title !== "contato sem nome") byTitle.set(title, thread);
  }

  return { byJid, byPhone, byTitle };
};

const resolveCallThread = (
  record: Record<string, unknown>,
  index: ReturnType<typeof indexConversationThreads>,
): WhatsappConversationThread | null => {
  const candidates = collectCallIdentityCandidates(record);
  const nameCandidates = collectCallNameCandidates(record)
    .map(normalizeComparableText)
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalizedJid = normalizeWhatsappChatJid(candidate.value);
    if (!normalizedJid) continue;
    const byJid = index.byJid.get(normalizedJid) ?? index.byJid.get(candidate.value.toLowerCase());
    if (byJid) return byJid;
  }

  for (const candidate of candidates) {
    if (looksLikeLidIdentity(candidate)) continue;
    const normalizedJid = normalizeWhatsappChatJid(candidate.value);
    const digits = digitsOnly(candidate.value);
    const fromContactJid = normalizedJid ? getWhatsappChatType(normalizedJid) === "contact" : false;
    if (!isUsablePhoneDigits(digits) || (!fromContactJid && !isPhoneLikeCallCandidate(candidate))) continue;
    const byPhone = index.byPhone.get(digits);
    if (byPhone) return byPhone;
  }

  for (const name of nameCandidates) {
    const byTitle = index.byTitle.get(name);
    if (byTitle) return byTitle;
  }

  return null;
};

const enrichCallRecord = (
  record: Record<string, unknown>,
  index: ReturnType<typeof indexConversationThreads>,
): Record<string, unknown> => {
  const thread = resolveCallThread(record, index);
  const candidates = collectCallIdentityCandidates(record);
  const explicitPhone =
    candidates
      .filter(isPhoneLikeCallCandidate)
      .map((candidate) => digitsOnly(candidate.value))
      .find(isUsablePhoneDigits) ?? null;
  const explicitName =
    collectCallNameCandidates(record).find((name) => name.trim() && !looksLikeTechnicalLabel(name)) ?? null;
  const threadPhoneCandidate = thread?.phone?.trim() || (thread ? getWhatsappChatPhone(thread.chatJid) : null);
  const threadPhone = threadPhoneCandidate && isUsablePhoneDigits(digitsOnly(threadPhoneCandidate))
    ? threadPhoneCandidate
    : null;
  const displayName = threadDisplayName(thread) ?? explicitName;
  const phone = threadPhone || explicitPhone;
  const chatJid = thread?.chatJid ?? readString(record, "chatJid", "chat_jid", "remoteJid", "remote_jid");

  return {
    ...record,
    ...(chatJid ? { chatJid } : {}),
    ...(displayName ? { displayName } : {}),
    ...(phone ? { phone } : {}),
    ...(thread?.avatarUrl ? { avatarUrl: thread.avatarUrl } : {}),
    ...(thread
      ? {
          resolvedConversation: {
            chatJid: thread.chatJid,
            title: thread.title,
            phone: thread.phone,
            avatarUrl: thread.avatarUrl,
            chatType: thread.chatType,
          },
        }
      : {}),
  };
};

const getAuthorizedInstance = async (rawInstanceId: string) => {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json({ message: "Não autenticado." }, { status: 401 }),
      instance: null,
    };
  }

  const instanceId = parseInstanceId(rawInstanceId);
  if (!instanceId) {
    return {
      response: NextResponse.json({ message: "Instância inválida." }, { status: 400 }),
      instance: null,
    };
  }

  const instance = await getInstanceForUser(user.id, instanceId);
  if (!instance) {
    return {
      response: NextResponse.json({ message: "Instância não encontrada." }, { status: 404 }),
      instance: null,
    };
  }
  if (!instance.serverBaseUrl || !instance.token) {
    return {
      response: NextResponse.json({ message: "Instância sem servidor conectado." }, { status: 409 }),
      instance: null,
    };
  }

  return { response: null, instance };
};

export async function GET(_request: Request, context: Context) {
  try {
    const params = await Promise.resolve(context.params);
    const { response, instance } = await getAuthorizedInstance(params.instanceId);
    if (response || !instance) return response;

    const calls = await listWhatsappCalls({ baseUrl: instance.serverBaseUrl!, token: instance.token! });
    const activeCalls = collectCallRecords(calls);
    const conversationIndex = indexConversationThreads(
      await listWhatsappConversationThreads(instance.userId, instance.id).catch((error) => {
        console.warn("[whatsapp-calls] failed to index conversations for call identity", error);
        return [];
      }),
    );
    return NextResponse.json({
      ok: true,
      calls,
      activeCalls: activeCalls.map((call) => enrichCallRecord(call, conversationIndex)),
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to list WhatsApp calls", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível listar chamadas." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const params = await Promise.resolve(context.params);
    const { response, instance } = await getAuthorizedInstance(params.instanceId);
    if (response || !instance) return response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = (readString(body, "action") ?? "start").toLowerCase();
    const rawChatJid = readString(body, "chatJid", "to", "To", "chat", "Chat", "from", "From");
    const chatJid = rawChatJid ? normalizeWhatsappChatJid(rawChatJid) : null;
    const callId = readString(body, "callId", "CallID", "id", "ID");
    const callCreator = readString(body, "callCreator", "CallCreator", "creator", "Creator");
    const sdpOffer = normalizeSdpOffer(readString(body, "sdpOffer", "sdp_offer", "SDPOffer", "sdp", "SDP", "offer", "Offer"));
    const client = { baseUrl: instance.serverBaseUrl!, token: instance.token! };

    if (action === "start") {
      if (!chatJid) {
        return NextResponse.json({ message: "Conversa inválida para iniciar chamada." }, { status: 400 });
      }
      const chatType = getWhatsappChatType(chatJid);
      if (chatType === "group" || chatType === "channel" || chatType === "broadcast") {
        return NextResponse.json({ message: "Chamadas pelo painel estão liberadas apenas para conversas privadas." }, { status: 400 });
      }
      const result = await startWhatsappCall(client, {
        chatJid,
        phone: readString(body, "phone", "Phone"),
        video: body?.video === true || body?.Video === true,
      });
      return NextResponse.json({ ok: true, action: "start", chatJid, callId: inferCallId(result), call: result });
    }

    if (!callId) {
      return NextResponse.json({ message: "ID da chamada inválido." }, { status: 400 });
    }

    if (action === "accept" || action === "answer" || action === "atender") {
      const result = await acceptWhatsappCall(client, { callId, chatJid, callCreator }).catch((error) => {
        if (isMissingWhatsappCallError(error)) return null;
        throw error;
      });
      if (!result) return alreadyEndedResponse("end", chatJid, callId);
      return NextResponse.json({ ok: true, action: "accept", chatJid, callId, call: result });
    }

    if (action === "webrtc" || action === "audio") {
      if (!looksLikeWebRtcDataOffer(sdpOffer)) {
        return NextResponse.json({ message: "SDP da chamada inválido." }, { status: 400 });
      }
      const result = await attachWhatsappCallWebRTC(client, { callId, sdpOffer }).catch((error) => {
        if (isMissingWhatsappCallError(error)) return null;
        throw error;
      });
      if (!result) return alreadyEndedResponse("end", chatJid, callId);
      const root = readObject(result);
      const nested = readObject(root?.data) ?? readObject(root?.result) ?? readObject(root?.call);
      const sdpAnswer = sanitizeSdpAnswer(
        readString(root, "sdp_answer", "SDPAnswer", "sdpAnswer") ??
          readString(nested, "sdp_answer", "SDPAnswer", "sdpAnswer"),
      );
      return NextResponse.json({ ok: true, action: "webrtc", chatJid, callId, sdpAnswer, call: result });
    }

    if (action === "end" || action === "terminate" || action === "hangup" || action === "encerrar") {
      const result = await endWhatsappCall(client, { callId, chatJid }).catch((error) => {
        if (isMissingWhatsappCallError(error)) return null;
        throw error;
      });
      if (!result) return alreadyEndedResponse("end", chatJid, callId);
      return NextResponse.json({ ok: true, action: "end", chatJid, callId, call: result });
    }

    if (action === "reject" || action === "recusar") {
      if (!chatJid) {
        return NextResponse.json({ message: "Conversa inválida para rejeitar chamada." }, { status: 400 });
      }
      const result = await rejectWhatsappCall(client, { callId, chatJid, callCreator }).catch((error) => {
        if (isMissingWhatsappCallError(error)) return null;
        throw error;
      });
      if (!result) return alreadyEndedResponse("reject", chatJid, callId);
      return NextResponse.json({ ok: true, action: "reject", chatJid, callId, call: result });
    }

    return NextResponse.json({ message: "Ação de chamada inválida." }, { status: 400 });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to execute WhatsApp call action", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível executar a ação da chamada." },
      { status: 500 },
    );
  }
}
