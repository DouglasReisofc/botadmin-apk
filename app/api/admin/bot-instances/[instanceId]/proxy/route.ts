import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceById, performInstanceAction } from "lib/bot-instances";
import {
  applyConfiguredProxyToRemote,
  getInstanceProxyConfig,
  saveAndTestInstanceProxy,
  testInstanceProxy,
} from "lib/instance-proxy";

type Context = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const resolveId = async (context: Context) => {
  const params = await Promise.resolve(context.params);
  const id = Number.parseInt(params?.instanceId || "", 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const connected = (value: unknown) => {
  const status = String(value ?? "").toLowerCase();
  return /connected|conectado|conectada|online|pairing/.test(status) && !/desconect|logged.?out/.test(status);
};

const bodyOf = async (request: Request) => {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" ? body as Record<string, unknown> : null;
};

const proxyInput = (body: Record<string, unknown>) => ({
  enabled: body.enabled === true || body.enabled === 1 || body.enabled === "true",
  proxyUrl: body.proxyUrl ?? body.proxy_url,
  protocol: body.protocol,
  host: body.host,
  port: body.port,
  username: body.username,
  password: body.password,
  preserveUsername: body.preserveUsername === true,
  preservePassword: body.preservePassword === true,
  source: "admin" as const,
});

const fail = (error: unknown, fallback: string) => NextResponse.json(
  { message: error instanceof Error ? error.message : fallback },
  { status: 400 },
);

const load = async (context: Context) => {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  if (user.role !== "admin") return { response: NextResponse.json({ message: "Acesso restrito." }, { status: 403 }) };
  const instanceId = await resolveId(context);
  if (!instanceId) return { response: NextResponse.json({ message: "Instância inválida." }, { status: 400 }) };
  const instance = await getInstanceById(instanceId);
  if (!instance) return { response: NextResponse.json({ message: "Instância não encontrada." }, { status: 404 }) };
  return { user, instance, instanceId };
};

export async function GET(_request: Request, context: Context) {
  try {
    const loaded = await load(context);
    if (loaded.response) return loaded.response;
    return NextResponse.json({
      proxy: await getInstanceProxyConfig(loaded.instanceId),
      connected: connected(loaded.instance.sessionStatus),
      instance: {
        id: loaded.instance.id,
        name: loaded.instance.name,
        phone: loaded.instance.phone,
        userName: loaded.instance.userName,
        userEmail: loaded.instance.userEmail,
        sessionStatus: loaded.instance.sessionStatus,
      },
    });
  } catch (error) {
    return fail(error, "Não foi possível carregar o proxy da instância.");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const loaded = await load(context);
    if (loaded.response) return loaded.response;
    const body = await bodyOf(request);
    if (!body) return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    const check = await testInstanceProxy(loaded.instanceId, proxyInput(body));
    return NextResponse.json({
      ok: true,
      check,
      message: check ? "Proxy válido para navegação e WhatsApp Web." : "Proxy desativado.",
    });
  } catch (error) {
    return fail(error, "Não foi possível testar o proxy.");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const loaded = await load(context);
    if (loaded.response) return loaded.response;
    const body = await bodyOf(request);
    if (!body) return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    const proxy = await saveAndTestInstanceProxy(loaded.instanceId, proxyInput(body));
    const wasConnected = connected(loaded.instance.sessionStatus);
    if (wasConnected) {
      // Disconnect/connect keeps the device credentials. Never call logout here.
      // The administrator may be managing a customer's instance. The action
      // service checks ownership, therefore use the instance owner rather than
      // the administrator actor (the authorization was already enforced above).
      await performInstanceAction(loaded.instance.userId, loaded.instanceId, "restart");
    } else {
      await applyConfiguredProxyToRemote({
        instanceId: loaded.instanceId,
        serverBaseUrl: loaded.instance.serverBaseUrl,
        token: loaded.instance.token,
      });
    }
    return NextResponse.json({
      ok: true,
      proxy: await getInstanceProxyConfig(loaded.instanceId),
      connected: wasConnected,
      applied: true,
      requiresReconnect: false,
      message: wasConnected
        ? "Proxy salvo e aplicado com reinício seguro da conexão."
        : "Proxy salvo e aplicado à próxima conexão.",
    });
  } catch (error) {
    return fail(error, "Não foi possível salvar o proxy da instância.");
  }
}
