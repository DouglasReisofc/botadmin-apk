import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, refreshInstanceStatus } from "lib/bot-instances";
import { requestChatHistorySync } from "lib/wuzapi";
import { resolveChatConversationAccess } from "lib/whatsapp-conversation-access";
import {
  listWhatsappConversationMessagePage,
  normalizeWhatsappChatJid,
} from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string }>;
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const params = await context.params;
    const instanceId = Number.parseInt(params.instanceId, 10);
    const chatJid = normalizeWhatsappChatJid(
      decodeURIComponent(params.chatJid),
    );
    if (!Number.isFinite(instanceId) || instanceId <= 0 || !chatJid) {
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
    const status = await refreshInstanceStatus(
      access.storageUserId,
      access.instance.id,
    );
    if (status !== "conectado") {
      return NextResponse.json(
        { message: "Conecte a instância para sincronizar o histórico." },
        { status: 409 },
      );
    }

    const page = await listWhatsappConversationMessagePage(
      access.storageUserId,
      access.instance.id,
      chatJid,
      { limit: 500 },
    );
    const oldest = page.messages.find(
      (message) => Boolean(message.messageId) && Boolean(message.timestamp),
    );
    if (!oldest?.messageId) {
      return NextResponse.json(
        { message: "Ainda não há uma mensagem de referência nesta conversa." },
        { status: 409 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      count?: unknown;
    } | null;
    const requestedCount = Number(body?.count ?? 50);
    const count = Number.isFinite(requestedCount)
      ? Math.min(Math.max(Math.trunc(requestedCount), 1), 100)
      : 50;
    const data = await requestChatHistorySync(
      {
        baseUrl: access.instance.serverBaseUrl,
        token: access.instance.token,
      },
      {
        chatJid,
        oldestMessageId: oldest.messageId,
        oldestMessageFromMe: oldest.direction === "outbound",
        oldestMessageTimestampMs: new Date(oldest.timestamp).getTime(),
        count,
      },
    );

    return NextResponse.json(
      {
        message:
          "Sincronização solicitada. As mensagens serão mescladas sem duplicação.",
        data,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to request WhatsApp history sync", error);
    return NextResponse.json(
      { message: "Não foi possível solicitar o histórico agora." },
      { status: 500 },
    );
  }
}
