import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, syncInstanceWebhookAdmin } from "lib/bot-instances";

type AdminWebhookRouteContext = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const resolveInstanceId = async (
  context: AdminWebhookRouteContext,
  request: Request,
): Promise<number | null> => {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const params = await Promise.resolve(context.params);
  const direct = parse(params?.instanceId);
  if (direct !== null) {
    return direct;
  }

  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const idx = path.lastIndexOf("bot-instances");
    if (idx >= 0 && path[idx + 1]) {
      return parse(path[idx + 1]);
    }
  } catch {
    return null;
  }

  return null;
};

const extractOptionalPayload = async (request: Request): Promise<{
  webhookUrl?: string;
  events?: string[];
}> => {
  try {
    const data = await request.json();
    if (!data || typeof data !== "object") {
      return {};
    }

    const webhookUrl =
      typeof (data as Record<string, unknown>).webhookUrl === "string"
        ? (data as Record<string, unknown>).webhookUrl?.trim()
        : undefined;

    const eventsRaw = (data as Record<string, unknown>).events;
    const events =
      Array.isArray(eventsRaw) && eventsRaw.length > 0
        ? eventsRaw.map((event) => (typeof event === "string" ? event : "")).filter(Boolean)
        : undefined;

    return { webhookUrl, events };
  } catch {
    return {};
  }
};

const syncWebhook = async (request: Request, context: AdminWebhookRouteContext) => {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const payload = await extractOptionalPayload(request);
    const instance = await syncInstanceWebhookAdmin(instanceId, payload);

    return NextResponse.json({
      message: "Webhook sincronizado com sucesso.",
      instance,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to sync instance webhook (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível sincronizar o webhook da instância." },
      { status: 500 },
    );
  }
};

export async function POST(request: Request, context: AdminWebhookRouteContext) {
  return syncWebhook(request, context);
}

export async function PUT(request: Request, context: AdminWebhookRouteContext) {
  return syncWebhook(request, context);
}
