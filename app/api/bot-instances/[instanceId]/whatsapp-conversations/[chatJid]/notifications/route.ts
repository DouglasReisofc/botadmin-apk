import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { resolveChatConversationAccess } from "lib/whatsapp-conversation-access";
import {
  getWhatsappConversationThread,
  normalizeWhatsappChatJid,
  setWhatsappConversationNotificationsMutedForUser,
} from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseMuted = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "muted", "silenciado"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "unmuted", "reativado"].includes(normalized)) return false;
  return null;
};

export async function GET(_request: Request, context: Context) {
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

    const access = await resolveChatConversationAccess(user.id, instanceId, chatJid);
    if (!access) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    const thread = await getWhatsappConversationThread(access.storageUserId, access.instance.id, chatJid);
    return NextResponse.json({ muted: Boolean(thread?.muted) });
  } catch (error) {
    console.error("Failed to load WhatsApp conversation notification settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar notificações da conversa." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: Context) {
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

    const access = await resolveChatConversationAccess(user.id, instanceId, chatJid);
    if (!access || !access.isOwnerInstance) {
      return NextResponse.json({ message: "Sem permissão para alterar notificações desta conversa." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const muted = parseMuted((body as Record<string, unknown> | null)?.muted);
    if (muted === null) {
      return NextResponse.json({ message: "Estado de notificação inválido." }, { status: 400 });
    }

    await setWhatsappConversationNotificationsMutedForUser(access.storageUserId, access.instance.id, chatJid, muted);
    return NextResponse.json({ muted });
  } catch (error) {
    console.error("Failed to update WhatsApp conversation notification settings", error);
    return NextResponse.json(
      { message: "Não foi possível alterar notificações da conversa." },
      { status: 500 },
    );
  }
}
