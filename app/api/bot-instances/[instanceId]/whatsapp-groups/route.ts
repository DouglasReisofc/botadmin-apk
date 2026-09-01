import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, getInstanceForUser } from "lib/bot-instances";
import { createGroup } from "lib/wuzapi";

type Context = {
  params: Promise<{ instanceId: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeParticipants = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
};

const extractCreatedGroupJid = (payload: unknown): string | null => {
  if (typeof payload === "string") {
    const match = payload.match(/\b\d{5,}@g\.us\b/i);
    return match ? match[0] : null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.JID,
    record.jid,
    record.ID,
    record.id,
    record.GroupJID,
    record.groupJID,
    record.groupJid,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.includes("@g.us")) {
      return candidate.trim();
    }
  }
  for (const nested of [record.Group, record.group, record.Data, record.data, record.Info, record.info]) {
    const jid = extractCreatedGroupJid(nested);
    if (jid) return jid;
  }
  return null;
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

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }
    if (!instance.serverBaseUrl || !instance.token) {
      return NextResponse.json({ message: "Instância sem servidor conectado." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const participants = normalizeParticipants(payload.participants);
    if (!name) {
      return NextResponse.json({ message: "Informe o nome do grupo." }, { status: 400 });
    }
    if (participants.length === 0) {
      return NextResponse.json({ message: "Informe ao menos um participante." }, { status: 400 });
    }

    const result = await createGroup(
      { baseUrl: instance.serverBaseUrl, token: instance.token },
      { name, participants },
    );
    return NextResponse.json({
      ok: true,
      groupJid: extractCreatedGroupJid(result),
      result,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to create WhatsApp group", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível criar o grupo." },
      { status: 500 },
    );
  }
}
