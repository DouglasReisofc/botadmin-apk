import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { sendTextMessage, type WuzapiClient } from "lib/wuzapi";

type Context = { params: Promise<{ instanceId: string }> };

type BroadcastRecipient = {
  jid?: unknown;
  phone?: unknown;
  name?: unknown;
};

const toWhatsappJid = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const local = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  const digits = local.replace(/\D+/g, "");
  return digits.length >= 8 && digits.length <= 18 ? `${digits}@s.whatsapp.net` : null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: rawId } = await context.params;
    const instanceId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }
    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance?.serverBaseUrl || !instance.token) {
      return NextResponse.json({ message: "Instância não disponível para transmissão." }, { status: 409 });
    }
    const body = await request.json().catch(() => null) as {
      text?: unknown;
      recipients?: BroadcastRecipient[];
    } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return NextResponse.json({ message: "Digite a mensagem da transmissão." }, { status: 400 });
    if (text.length > 4096) return NextResponse.json({ message: "A mensagem pode ter no máximo 4096 caracteres." }, { status: 400 });
    const recipients = Array.isArray(body?.recipients) ? body.recipients : [];
    const unique = new Map<string, { jid: string; name: string }>();
    for (const recipient of recipients) {
      const jid = toWhatsappJid(recipient?.jid) ?? toWhatsappJid(recipient?.phone);
      if (!jid) continue;
      const name = typeof recipient?.name === "string" ? recipient.name.trim().slice(0, 120) : "";
      unique.set(jid, { jid, name });
      if (unique.size >= 200) break;
    }
    if (unique.size === 0) {
      return NextResponse.json({ message: "Selecione ou adicione pelo menos um contato válido." }, { status: 400 });
    }

    const client: WuzapiClient = { baseUrl: instance.serverBaseUrl.replace(/\/+$/, ""), token: instance.token };
    const sent: Array<{ jid: string; name: string }> = [];
    const failed: Array<{ jid: string; name: string; error: string }> = [];
    for (const recipient of unique.values()) {
      try {
        await sendTextMessage(client, { to: recipient.jid, body: text });
        sent.push(recipient);
      } catch (error) {
        failed.push({
          ...recipient,
          error: error instanceof Error ? error.message : "Falha no envio.",
        });
      }
      // Keeps the instance responsive while avoiding a burst that could make
      // a normal WhatsApp session look offline to the rest of the panel.
      if (sent.length + failed.length < unique.size) await sleep(180);
    }
    return NextResponse.json({
      message: `${sent.length} contato(s) receberam a transmissão.${failed.length ? ` ${failed.length} falharam.` : ""}`,
      total: unique.size,
      sent: sent.length,
      failed,
    });
  } catch (error) {
    console.error("Failed to broadcast to contacts", error);
    return NextResponse.json({ message: "Não foi possível concluir a transmissão." }, { status: 500 });
  }
}
