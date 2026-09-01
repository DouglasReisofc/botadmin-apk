import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import {
  listConversationSharesForOwner,
  updateConversationSharesForOwner,
  WhatsappConversationShareError,
} from "lib/whatsapp-conversation-shares";
import {
  getWhatsappChatPhone,
  getWhatsappChatType,
  getWhatsappConversationThread,
  normalizeWhatsappChatJid,
} from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string; chatJid: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseEmails = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
      .flatMap((entry) => entry.split(/[\n,;]+/))
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  }
  return [];
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

    const shares = await listConversationSharesForOwner(user.id, instanceId, chatJid);
    return NextResponse.json({ shares });
  } catch (error) {
    if (error instanceof WhatsappConversationShareError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to list conversation shares", error);
    return NextResponse.json(
      { message: "Não foi possível carregar compartilhamentos da conversa." },
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

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const existingThread = await getWhatsappConversationThread(user.id, instance.id, chatJid);
    const title = typeof body?.title === "string" && body.title.trim()
      ? body.title.trim()
      : existingThread?.title ?? null;
    const avatarUrl = typeof body?.avatarUrl === "string" && body.avatarUrl.trim()
      ? body.avatarUrl.trim()
      : existingThread?.avatarUrl ?? null;
    const phone = typeof body?.phone === "string" && body.phone.trim()
      ? body.phone.trim()
      : existingThread?.phone ?? getWhatsappChatPhone(chatJid);
    const result = await updateConversationSharesForOwner(user.id, {
      instanceId: instance.id,
      chatJid,
      chatType: existingThread?.chatType ?? getWhatsappChatType(chatJid),
      title,
      phone,
      avatarUrl,
      linkedGroupId: existingThread?.linkedGroupId ?? null,
      emails: parseEmails((body as Record<string, unknown> | null)?.emails),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WhatsappConversationShareError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to update conversation shares", error);
    return NextResponse.json(
      { message: "Não foi possível salvar compartilhamento da conversa." },
      { status: 500 },
    );
  }
}
