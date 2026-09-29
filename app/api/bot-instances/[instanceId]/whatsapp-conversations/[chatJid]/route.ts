import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, getInstanceForUser } from "lib/bot-instances";
import { getGroupInfo, leaveGroup, runChatAction, type WuzapiChatAction } from "lib/wuzapi";
import {
  clearWhatsappConversationMessagesForUser,
  deleteWhatsappConversationThreadForUser,
  getWhatsappChatType,
  markWhatsappConversationThreadReadAndNotifyForUser,
  normalizeWhatsappChatJid,
  getWhatsappConversationThread,
  setWhatsappConversationArchivedForUser,
  setWhatsappConversationPinnedForUser,
  upsertWhatsappConversation,
} from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

type ConversationAction = WuzapiChatAction | "read" | "leave";

const parseChatAction = (value: unknown): ConversationAction | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["read", "mark-read", "markread", "lida", "lido"].includes(normalized)) return "read";
  if (["leave", "leave-group", "sair", "sair-grupo", "sairdogrupo"].includes(normalized)) return "leave";
  if (["archive", "unarchive", "pin", "unpin", "clear", "delete"].includes(normalized)) {
    return normalized as WuzapiChatAction;
  }
  if (["limpar", "clean"].includes(normalized)) return "clear";
  if (["apagar", "delete-chat", "deleteconversation"].includes(normalized)) return "delete";
  if (["fixar"].includes(normalized)) return "pin";
  if (["desfixar"].includes(normalized)) return "unpin";
  if (["arquivar"].includes(normalized)) return "archive";
  if (["desarquivar"].includes(normalized)) return "unarchive";
  return null;
};

const runRemoteChatAction = async (instance: Awaited<ReturnType<typeof getInstanceForUser>>, chatJid: string, action: WuzapiChatAction) => {
  if (!instance?.serverBaseUrl || !instance.token) {
    throw new Error("Instância sem servidor conectado para executar ação no WhatsApp.");
  }
  await runChatAction(
    { baseUrl: instance.serverBaseUrl, token: instance.token },
    { chatId: chatJid, action },
  );
};

const runRemoteLeaveGroup = async (instance: Awaited<ReturnType<typeof getInstanceForUser>>, groupJid: string) => {
  if (!instance?.serverBaseUrl || !instance.token) {
    throw new Error("Instância sem servidor conectado para sair do grupo.");
  }
  if (getWhatsappChatType(groupJid) !== "group") {
    throw new Error("A ação sair só pode ser usada em grupos.");
  }
  await leaveGroup(
    { baseUrl: instance.serverBaseUrl, token: instance.token },
    { groupJid },
  );
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const nestedGroupRecord = (value: unknown): Record<string, unknown> => {
  const root = record(value);
  const nested = root.data ?? root.Data ?? root.group ?? root.Group;
  return record(nested && typeof nested === "object" ? nested : value);
};

const boolValue = (...values: unknown[]): boolean | null => {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
    }
  }
  return null;
};

const textValue = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

const digits = (value: unknown): string =>
  String(value ?? "").replace(/\D/g, "");

const participantIsAdmin = (value: unknown, instanceDigits: string): boolean => {
  const item = record(value);
  const jid = textValue(
    item.jid, item.JID, item.id, item.ID, item.phone, item.Phone,
    item.user, item.User, item.participant, item.Participant,
  );
  const role = textValue(item.admin, item.Admin, item.role, item.Role, item.rank, item.Rank)
    ?.toLowerCase();
  const explicit = boolValue(item.isAdmin, item.IsAdmin, item.is_admin, item.IsOwner, item.isOwner);
  if (explicit === true) return digits(jid) === instanceDigits || !jid;
  if (role && ["admin", "superadmin", "super-admin", "owner"].includes(role)) {
    return digits(jid) === instanceDigits || !jid;
  }
  return false;
};

/** Refreshes only the permission flags when a conversation is opened.
 * The list endpoint is intentionally cached for a fast first paint; this
 * endpoint must never reuse that snapshot for the composer lock state.
 */
const refreshGroupThread = async (userId: number, instance: Awaited<ReturnType<typeof getInstanceForUser>>, current: Awaited<ReturnType<typeof getWhatsappConversationThread>>, chatJid: string) => {
  if (!current || getWhatsappChatType(chatJid) !== "group" || !instance?.serverBaseUrl || !instance.token) return current;
  const info = await getGroupInfo<Record<string, unknown>>(
    { baseUrl: instance.serverBaseUrl, token: instance.token },
    chatJid,
  );
  const data = nestedGroupRecord(info);
  const announceOnly = boolValue(
    data.IsAnnounce, data.isAnnounce, data.announce, data.Announce,
    data.adminsOnly, data.AdminOnly, data.onlyAdmins,
  );
  if (announceOnly === null) return current;
  const instanceDigits = digits(instance.phone);
  const owner = textValue(data.OwnerJID, data.ownerJid, data.owner, data.Owner, data.superadmin, data.SuperAdmin);
  const rawParticipants = data.Participants ?? data.participants ?? data.Members ?? data.members;
  const participants = Array.isArray(rawParticipants) ? rawParticipants : [];
  const hasParticipantContext = Boolean(owner || participants.length);
  const instanceIsAdmin = announceOnly
    ? (owner ? digits(owner) === instanceDigits : false) ||
      participants.some((item) => participantIsAdmin(item, instanceDigits))
    : true;
  const canSendMessages = !announceOnly || instanceIsAdmin;
  await upsertWhatsappConversation({
    userId,
    instanceId: instance.id,
    chatJid,
    chatType: current.chatType,
    title: current.title,
    phone: current.phone,
    avatarUrl: current.avatarUrl,
    groupDescription: current.groupDescription,
    participantsCount: participants.length || current.participantsCount,
    linkedGroupId: current.linkedGroupId,
    inviteLink: current.inviteLink,
    announceOnly,
    instanceIsAdmin,
    mentionable: announceOnly ? (hasParticipantContext ? instanceIsAdmin : true) : true,
    canSendMessages,
    readOnlyReason: canSendMessages ? null : "Somente administradores podem enviar mensagens.",
    directorySource: "groups",
  });
  return getWhatsappConversationThread(userId, instance.id, chatJid);
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const params = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(params.instanceId);
    const chatJid = normalizeWhatsappChatJid(decodeURIComponent(params.chatJid));
    if (!instanceId || !chatJid) return NextResponse.json({ message: "Conversa inválida." }, { status: 400 });
    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    const current = await getWhatsappConversationThread(user.id, instance.id, chatJid);
    const thread = await refreshGroupThread(user.id, instance, current, chatJid);
    return NextResponse.json({ thread }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof BotInstanceError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error("Failed to refresh WhatsApp conversation permissions", error);
    return NextResponse.json({ message: "Não foi possível atualizar as permissões da conversa." }, { status: 502 });
  }
}

const persistLocalChatAction = async (userId: number, instanceId: number, chatJid: string, action: ConversationAction) => {
  if (action === "read") {
    await markWhatsappConversationThreadReadAndNotifyForUser(userId, instanceId, chatJid);
    return null;
  }
  if (action === "archive") {
    return setWhatsappConversationArchivedForUser(userId, instanceId, chatJid, true);
  }
  if (action === "unarchive") {
    return setWhatsappConversationArchivedForUser(userId, instanceId, chatJid, false);
  }
  if (action === "pin") {
    return setWhatsappConversationPinnedForUser(userId, instanceId, chatJid, true);
  }
  if (action === "unpin") {
    return setWhatsappConversationPinnedForUser(userId, instanceId, chatJid, false);
  }
  if (action === "clear") {
    await clearWhatsappConversationMessagesForUser(userId, instanceId, chatJid);
    return null;
  }
  if (action === "delete") {
    await deleteWhatsappConversationThreadForUser(userId, instanceId, chatJid);
    return null;
  }
  if (action === "leave") {
    await deleteWhatsappConversationThreadForUser(userId, instanceId, chatJid);
  }
  return null;
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
    if (!instanceId || !chatJid) {
      return NextResponse.json({ message: "Conversa inválida." }, { status: 400 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const action = parseChatAction((body as Record<string, unknown> | null)?.action);
    if (!action) {
      return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
    }

    if (action === "leave") {
      await runRemoteLeaveGroup(instance, chatJid);
    } else if (action !== "read") {
      await runRemoteChatAction(instance, chatJid, action);
    }
    const thread = await persistLocalChatAction(user.id, instance.id, chatJid, action);
    return NextResponse.json({ ok: true, action, thread });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to run WhatsApp conversation action", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível executar a ação da conversa." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(params.instanceId);
    const chatJid = normalizeWhatsappChatJid(decodeURIComponent(params.chatJid));
    if (!instanceId || !chatJid) {
      return NextResponse.json({ message: "Conversa inválida." }, { status: 400 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    const action: WuzapiChatAction = getWhatsappChatType(chatJid) === "group" ? "clear" : "delete";
    await runRemoteChatAction(instance, chatJid, action);
    await persistLocalChatAction(user.id, instance.id, chatJid, action);
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to delete WhatsApp conversation thread", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível apagar a conversa." },
      { status: 500 },
    );
  }
}
