import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  getSupportThreadByWhatsapp,
  getSupportMessages,
  markSupportThreadRead,
  buildSupportThreadSummary,
  serializeSupportMessage,
  serializeSupportThread,
  closeSupportThread,
  setSupportHandlingMode,
} from "lib/support";
import { emitSupportThreadUpdate } from "lib/realtime";

export async function GET(
  _request: Request,
  context: { params: Promise<{ whatsappId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { whatsappId } = await context.params;
    const thread = await getSupportThreadByWhatsapp(user.id, whatsappId);
    if (!thread) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    const messagesRaw = await getSupportMessages(thread.id);
    const messages = messagesRaw.map(serializeSupportMessage);
    await markSupportThreadRead(user.id, thread.whatsappId, "user");
    const summary = await buildSupportThreadSummary(user.id, thread);
    const adminRow = await getAdminWebhookRow();
    const adminPhone = adminRow?.phone_number?.trim() || null;
    const adminDigits = (adminPhone || "").replace(/\D+/g, "");
    const isInternalAdminThread =
      thread.whatsappId === "__admin__" ||
      (adminDigits && thread.whatsappId.replace(/\D+/g, "") === adminDigits);
    if (adminPhone && isInternalAdminThread) {
      summary.displayWhatsappId = adminPhone;
    }

    return NextResponse.json({
      thread: (() => {
        const serialized = serializeSupportThread(thread);
        if (adminPhone && isInternalAdminThread) {
          serialized.displayWhatsappId = adminPhone;
        }
        return serialized;
      })(),
      messages,
      within24h: summary.within24h,
      minutesLeft24h: summary.minutesLeft24h,
    });
  } catch (error) {
    console.error("Failed to load support conversation", error);
    return NextResponse.json({ message: "Erro ao carregar conversa." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ whatsappId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { whatsappId } = await context.params;
    const payload = await request.json().catch(() => null);
    if (!payload || payload.action !== "close") {
      return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
    }

    await closeSupportThread(user.id, whatsappId);

    const thread = await getSupportThreadByWhatsapp(user.id, whatsappId);
    let summary = null;
    if (thread) {
      summary = await buildSupportThreadSummary(user.id, thread);
      emitSupportThreadUpdate({ userId: user.id, thread: summary });
    }

    return NextResponse.json({ ok: true, thread: summary });
  } catch (error) {
    console.error("Failed to close support conversation", error);
    return NextResponse.json({ message: "Erro ao encerrar conversa." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: { whatsappId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { whatsappId } = context.params;
    const body = await request.json().catch(() => null);

    if (!body || (body.handlingMode !== "bot" && body.handlingMode !== "human")) {
      return NextResponse.json({ message: "Informe um modo válido: bot ou human." }, { status: 400 });
    }

    const updatedThread = await setSupportHandlingMode(user.id, whatsappId, body.handlingMode);

    if (!updatedThread) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    const summary = await buildSupportThreadSummary(user.id, updatedThread);
    emitSupportThreadUpdate({ userId: user.id, thread: summary });

    return NextResponse.json({ ok: true, thread: summary });
  } catch (error) {
    console.error("Failed to atualizar modo de atendimento", error);
    return NextResponse.json({ message: "Erro ao atualizar configuração de atendimento." }, { status: 500 });
  }
}
