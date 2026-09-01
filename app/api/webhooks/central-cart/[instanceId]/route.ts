import { NextResponse } from "next/server";

import {
  getBotStoreByInstance,
  processCentralCartWebhook,
  verifyCentralCartWebhook,
} from "lib/bot-store";

type RouteContext = { params: Promise<{ instanceId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { instanceId: rawInstanceId } = await context.params;
    const instanceId = Number(rawInstanceId);
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      return NextResponse.json({ message: "Perfil inválido." }, { status: 400 });
    }
    const store = await getBotStoreByInstance(Math.floor(instanceId));
    if (!store?.centralCart.connected) {
      return NextResponse.json({ message: "Integração não encontrada." }, { status: 404 });
    }
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    if (!verifyCentralCartWebhook(request, rawBody, payload, store)) {
      return NextResponse.json({ message: "Assinatura inválida." }, { status: 401 });
    }
    const event = String(payload.event || payload.type || "").trim();
    const data =
      payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : payload;
    if (!event) {
      return NextResponse.json({ message: "Evento inválido." }, { status: 400 });
    }
    const result = await processCentralCartWebhook({
      store,
      eventId: String(payload.id || request.headers.get("x-event-id") || "").trim(),
      event,
      data,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[central-cart] Falha no webhook", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Falha no webhook." },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "BotAdmin Central Cart webhook" });
}

export const dynamic = "force-dynamic";
