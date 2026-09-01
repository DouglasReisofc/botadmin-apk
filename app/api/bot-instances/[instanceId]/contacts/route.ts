import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, getInstanceForUser, refreshInstanceStatus } from "lib/bot-instances";
import { listUserContacts } from "lib/wuzapi";

type Context = { params: Promise<{ instanceId: string }> };

type ContactsCacheEntry = {
  contacts: Awaited<ReturnType<typeof listUserContacts>>;
  cachedAt: number;
};

const CONTACTS_CACHE_TTL_MS = 5 * 60_000;
const contactsCache = new Map<string, ContactsCacheEntry>();

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(resolvedParams.instanceId);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }
    if (!instance.serverBaseUrl) {
      return NextResponse.json({ message: "Servidor da instância não configurado." }, { status: 500 });
    }

    const url = new URL(request.url);
    const forceRefresh = ["1", "true", "yes"].includes(
      (url.searchParams.get("refresh") ?? "").toLowerCase(),
    );
    const cacheKey = `${user.id}:${instanceId}`;
    const cached = contactsCache.get(cacheKey);
    if (!forceRefresh && cached && Date.now() - cached.cachedAt < CONTACTS_CACHE_TTL_MS) {
      return NextResponse.json({
        contacts: cached.contacts,
        cached: true,
        cachedAt: new Date(cached.cachedAt).toISOString(),
      });
    }

    // A status already marked as connected is enough to start the directory
    // request. Refreshing it on every opening added one extra round trip to
    // the "Nova conversa" panel and made the contact list feel blocked.
    const sessionStatus = instance.sessionStatus === "conectado"
      ? instance.sessionStatus
      : await refreshInstanceStatus(user.id, instanceId);
    if (sessionStatus !== "conectado") {
      return NextResponse.json({ message: "Conecte a instância antes de carregar contatos." }, { status: 409 });
    }

    const contacts = await listUserContacts({
      baseUrl: instance.serverBaseUrl,
      token: instance.token,
    });
    contactsCache.set(cacheKey, { contacts, cachedAt: Date.now() });
    return NextResponse.json({ contacts, cached: false });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const status = (error as { status?: unknown })?.status;
    if (typeof status === "number" && status === 401) {
      return NextResponse.json(
        { message: "Token da instância inválido. Reconecte a instância e tente novamente." },
        { status: 401 },
      );
    }
    console.error("Failed to list instance contacts", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os contatos da instância." },
      { status: 500 },
    );
  }
}
