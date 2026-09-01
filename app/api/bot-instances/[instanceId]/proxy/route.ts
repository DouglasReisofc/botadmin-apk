import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import {
  applyConfiguredProxyToRemote,
  getCustomerProxySalesPolicy,
  getInstanceProxyConfig,
  saveAndTestInstanceProxy,
  testInstanceProxy,
} from "lib/instance-proxy";

type Context = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const instanceIdFrom = async (context: Context) => {
  const params = await Promise.resolve(context.params);
  const id = Number.parseInt(params?.instanceId || "", 10);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const asBoolean = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";

const isConnected = (status: unknown) => {
  const value = String(status ?? "").toLowerCase();
  return value.includes("conect") && !value.includes("desconect");
};

const proxyInput = (body: Record<string, unknown>) => ({
  enabled: asBoolean(body.enabled),
  proxyUrl: body.proxyUrl ?? body.proxy_url,
  protocol: body.protocol,
  host: body.host,
  port: body.port,
  username: body.username,
  password: body.password,
  preserveUsername: asBoolean(body.preserveUsername),
  preservePassword: asBoolean(body.preservePassword),
  source: "customer" as const,
});

const fail = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ message }, { status: 400 });
};

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const instanceId = await instanceIdFrom(context);
    if (!instanceId) return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    return NextResponse.json({
      proxy: await getInstanceProxyConfig(instanceId),
      policy: await getCustomerProxySalesPolicy(user.id),
      connected: isConnected(instance.sessionStatus),
    });
  } catch (error) {
    return fail(error, "Não foi possível carregar a configuração do proxy.");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const instanceId = await instanceIdFrom(context);
    if (!instanceId) return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    const policy = await getCustomerProxySalesPolicy(user.id);
    if (!policy.allowCustomerProxy) return NextResponse.json({ message: "Seu master não liberou proxy personalizado para este cliente." }, { status: 403 });
    const check = await testInstanceProxy(instanceId, proxyInput(body as Record<string, unknown>));
    return NextResponse.json({
      ok: true,
      check: check ? { ...check } : null,
      message: check ? "Proxy acessível e IP público confirmado." : "Proxy desativado.",
    });
  } catch (error) {
    return fail(error, "Não foi possível testar o proxy.");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const instanceId = await instanceIdFrom(context);
    if (!instanceId) return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    const policy = await getCustomerProxySalesPolicy(user.id);
    if (!policy.allowCustomerProxy) return NextResponse.json({ message: "Seu master não liberou proxy personalizado para este cliente." }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    const config = await saveAndTestInstanceProxy(instanceId, proxyInput(body as Record<string, unknown>));
    const connected = isConnected(instance.sessionStatus);
    let applied = false;
    if (!connected) {
      await applyConfiguredProxyToRemote({
        instanceId,
        serverBaseUrl: instance.serverBaseUrl,
        token: instance.token,
      });
      applied = true;
    }
    return NextResponse.json({
      message: connected
        ? "Proxy salvo. Desconecte e reconecte o perfil para aplicar a nova rota."
        : "Proxy salvo e aplicado à próxima conexão.",
      proxy: await getInstanceProxyConfig(instanceId),
      policy,
      connected,
      applied,
      requiresReconnect: connected,
    });
  } catch (error) {
    return fail(error, "Não foi possível salvar o proxy.");
  }
}
