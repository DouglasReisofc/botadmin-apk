import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { deleteStatusUpdate } from "lib/wuzapi";
import {
  deleteWhatsappConversationMessageForUser,
  recordWhatsappRealtimeEvent,
} from "lib/whatsapp-conversations";
import { publishWhatsappRealtimeEvent } from "lib/whatsapp-realtime-bus";

type RouteContext = {
  params: Promise<{ instanceId: string; messageId: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(params.instanceId);
    const messageId = decodeURIComponent(params.messageId || "").trim();
    if (!instanceId || !messageId) {
      return NextResponse.json({ message: "Status inválido." }, { status: 400 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    let warning: string | null = null;
    try {
      await deleteStatusUpdate(
        {
          baseUrl: instance.serverBaseUrl,
          token: instance.token,
        },
        { id: messageId },
      );
    } catch (error) {
      warning = error instanceof Error ? error.message : "Erro ao apagar status no WhatsApp.";
    }

    await deleteWhatsappConversationMessageForUser(user.id, instance.id, "status@broadcast", messageId);

    try {
      const event = await recordWhatsappRealtimeEvent({
        userId: user.id,
        instanceId: instance.id,
        chatJid: "status@broadcast",
        eventType: "status.update",
        messageId,
        payload: {
          eventType: "status.deleted",
          action: "deleted",
          deletedMessageId: messageId,
          status: {
            id: messageId,
            messageId,
            action: "deleted",
            fromMe: true,
          },
        },
      });
      if (event) {
        publishWhatsappRealtimeEvent(event);
      }
    } catch (publishError) {
      console.warn("Failed to publish WhatsApp status delete event", publishError);
    }

    return NextResponse.json({
      message: warning
        ? `Status removido do app com aviso: ${warning}`
        : "Status removido com sucesso.",
      deletedMessageId: messageId,
      warning,
    });
  } catch (error) {
    console.error("Failed to delete WhatsApp status", error);
    return NextResponse.json(
      { message: "Não foi possível apagar o status." },
      { status: 500 },
    );
  }
}
