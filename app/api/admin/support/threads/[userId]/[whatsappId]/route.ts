import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { cacheAdminOperationalUserAvatar } from "lib/admin-operational-instance";
import {
  getSupportThreadByWhatsapp,
  getSupportMessages,
  markSupportThreadRead,
  serializeSupportMessage,
  buildSupportThreadSummary,
  setSupportHandlingMode,
  closeSupportThread,
  reopenSupportThread,
  deleteSupportThread,
} from "lib/support";
import { getSessionUserById } from "lib/users";
import { emitSupportThreadDeleted, emitSupportThreadUpdate } from "lib/realtime";

type SupportThreadRouteContext = {
  params: { userId: string; whatsappId: string } | Promise<{ userId: string; whatsappId: string }>;
};

const parseParams = (params: { userId: string; whatsappId: string }) => {
  const userId = Number.parseInt(params.userId, 10);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error("Parâmetros inválidos.");
  }

  const whatsappId = params.whatsappId?.trim();
  if (!whatsappId) {
    throw new Error("Parâmetros inválidos.");
  }

  return { userId, whatsappId };
};

const resolveParams = async (context: SupportThreadRouteContext) => parseParams(await context.params);

export async function GET(
  _request: Request,
  context: SupportThreadRouteContext,
) {
  try {
    const session = await getCurrentUser();
    if (!session) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const { userId, whatsappId } = await resolveParams(context);
    const thread = await getSupportThreadByWhatsapp(userId, whatsappId);
    if (!thread) {
      return NextResponse.json({ message: "Atendimento não encontrado." }, { status: 404 });
    }

    const owner = await getSessionUserById(userId);
    const refreshedAvatarUrl = owner
      ? await cacheAdminOperationalUserAvatar(userId, owner.whatsappNumber || whatsappId).catch(() => null)
      : null;
    const messages = await getSupportMessages(thread.id);

    const serializedMessages = messages.map(serializeSupportMessage);
    await markSupportThreadRead(userId, thread.whatsappId, "admin");
    const summary = await buildSupportThreadSummary(userId, thread);

    return NextResponse.json({
      user: owner
        ? {
            id: owner.id,
            name: owner.name,
            email: owner.email,
            whatsappNumber: owner.whatsappNumber,
            avatarUrl: refreshedAvatarUrl || owner.avatarUrl || null,
          }
        : null,
      thread: summary,
      messages: serializedMessages,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Parâmetros inválidos.") {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    console.error("[admin-support] Falha ao carregar atendimento", error);
    return NextResponse.json({ message: "Erro ao carregar atendimento." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: SupportThreadRouteContext,
) {
  try {
    const session = await getCurrentUser();
    if (!session) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const { userId, whatsappId } = await resolveParams(context);
    const deleted = await deleteSupportThread(userId, whatsappId);
    if (!deleted) {
      return NextResponse.json({ message: "Atendimento não encontrado." }, { status: 404 });
    }

    emitSupportThreadDeleted({ userId, whatsappId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Parâmetros inválidos.") {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    console.error("[admin-support] Falha ao remover atendimento", error);
    return NextResponse.json({ message: "Erro ao remover atendimento." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: SupportThreadRouteContext,
) {
  try {
    const session = await getCurrentUser();
    if (!session) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const { userId, whatsappId } = await resolveParams(context);
    const body = await request.json().catch(() => null);
    const handlingMode = body?.handlingMode === "human" ? "human" : body?.handlingMode === "bot" ? "bot" : null;
    if (!handlingMode) {
      return NextResponse.json({ message: "Modo inválido." }, { status: 400 });
    }

    const updatedThread = await setSupportHandlingMode(userId, whatsappId, handlingMode);
    if (!updatedThread) {
      return NextResponse.json({ message: "Atendimento não encontrado." }, { status: 404 });
    }

    const summary = await buildSupportThreadSummary(userId, updatedThread);
    emitSupportThreadUpdate({ userId, thread: summary });

    return NextResponse.json({ ok: true, thread: summary });
  } catch (error) {
    if (error instanceof Error && error.message === "Parâmetros inválidos.") {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    console.error("[admin-support] Falha ao atualizar modo de atendimento", error);
    return NextResponse.json({ message: "Erro ao atualizar atendimento." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: SupportThreadRouteContext,
) {
  try {
    const session = await getCurrentUser();
    if (!session) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const { userId, whatsappId } = await resolveParams(context);
    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

    if (action === "close") {
      await closeSupportThread(userId, whatsappId);
    } else if (action === "reopen") {
      await reopenSupportThread(userId, whatsappId);
    } else {
      return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
    }

    const thread = await getSupportThreadByWhatsapp(userId, whatsappId);
    if (!thread) {
      return NextResponse.json({ message: "Atendimento não encontrado." }, { status: 404 });
    }

    const summary = await buildSupportThreadSummary(userId, thread);
    emitSupportThreadUpdate({ userId, thread: summary });

    return NextResponse.json({ ok: true, thread: summary });
  } catch (error) {
    if (error instanceof Error && error.message === "Parâmetros inválidos.") {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    console.error("[admin-support] Falha ao atualizar status do atendimento", error);
    return NextResponse.json({ message: "Erro ao atualizar status do atendimento." }, { status: 500 });
  }
}
