import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, getInstanceForUser } from "lib/bot-instances";
import { rejectWhatsappCall } from "lib/wuzapi";
import { normalizeWhatsappChatJid } from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const readString = (record: Record<string, unknown> | null, ...keys: string[]): string | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

const isMissingWhatsappCallError = (error: unknown): boolean => {
  const record = error && typeof error === "object" && !Array.isArray(error) ? error as Record<string, unknown> : null;
  const details = [
    error instanceof Error ? error.message : null,
    record?.response ? JSON.stringify(record.response) : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return details.includes("no such call") || details.includes("call not found");
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(params.instanceId);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const callId = readString(body, "callId", "CallID", "id", "ID");
    const rawChatJid = readString(body, "chatJid", "from", "From", "to", "To", "chat", "Chat");
    const chatJid = rawChatJid ? normalizeWhatsappChatJid(rawChatJid) : null;
    const callCreator = readString(body, "callCreator", "CallCreator", "creator", "Creator");

    if (!callId || !chatJid) {
      return NextResponse.json({ message: "Dados da chamada inválidos." }, { status: 400 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }
    if (!instance.serverBaseUrl || !instance.token) {
      return NextResponse.json({ message: "Instância sem servidor conectado." }, { status: 409 });
    }

    await rejectWhatsappCall(
      { baseUrl: instance.serverBaseUrl, token: instance.token },
      { callId, chatJid, callCreator },
    ).catch((error) => {
      if (isMissingWhatsappCallError(error)) return null;
      throw error;
    });

    return NextResponse.json({ ok: true, action: "reject", callId, chatJid });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to reject WhatsApp call", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível rejeitar a chamada." },
      { status: 500 },
    );
  }
}
