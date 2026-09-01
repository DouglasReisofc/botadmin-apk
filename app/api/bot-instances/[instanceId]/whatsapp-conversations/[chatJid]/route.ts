import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, getInstanceForUser } from "lib/bot-instances";
import { leaveGroup, runChatAction, type WuzapiChatAction } from "lib/wuzapi";
import {
  clearWhatsappConversationMessagesForUser,
  deleteWhatsappConversationThreadForUser,
  getWhatsappChatType,
  markWhatsappConversationThreadReadAndNotifyForUser,
  normalizeWhatsappChatJid,
  setWhatsappConversationArchivedForUser,
  setWhatsappConversationPinnedForUser,
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
