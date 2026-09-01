import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";

import { getCurrentUser } from "lib/auth";
import { ensureBotInstanceProxyTable, ensurePartnerProgramTables, getDb } from "lib/db";
import {
  applyConfiguredProxyToRemote,
  getInstanceProxyConfig,
  saveAndTestInstanceProxy,
} from "lib/instance-proxy";
import { getPartnerAccess, ResellerProgramError, writePartnerAudit } from "lib/reseller-program";

type ManagedInstance = RowDataPacket & {
  id: number;
  name: string;
  phone: string | null;
  user_id: number;
  customer_name: string;
  customer_email: string;
  session_status: string | null;
  server_base_url: string;
  token: string;
};

const connected = (status: unknown) => {
  const value = String(status ?? "").toLowerCase();
  return value.includes("conect") && !value.includes("desconect");
};

const scopeSql = (role: string) => role === "owner"
  ? { sql: "", params: [] as unknown[] }
  : {
      sql: `AND (l.reseller_user_id = ? OR l.reseller_user_id IN
        (SELECT user_id FROM admin_panel_members WHERE invited_by = ? AND status = 'active'))`,
      params: [] as unknown[],
    };

const instancesFor = async (actorUserId: number, onlyInstanceId?: number) => {
  await ensurePartnerProgramTables();
  await ensureBotInstanceProxyTable();
  const access = await getPartnerAccess(actorUserId);
  if (!access?.permissions.manage_customers) {
    throw new ResellerProgramError("Sem permissão para gerenciar proxies de clientes.", 403);
  }
  const scope = scopeSql(access.role);
  if (access.role !== "owner") scope.params.push(actorUserId, actorUserId);
  const instanceFilter = onlyInstanceId ? "AND bi.id = ?" : "";
  if (onlyInstanceId) scope.params.push(onlyInstanceId);
  const [rows] = await getDb().query<ManagedInstance[]>(
    `SELECT DISTINCT bi.id, bi.name, bi.phone, bi.user_id, bi.session_status,
            bi.token, bs.base_url AS server_base_url,
            u.name AS customer_name, u.email AS customer_email
       FROM reseller_customer_links l
       JOIN users u ON u.id = l.customer_user_id
       JOIN bot_instances bi ON bi.user_id = l.customer_user_id
       JOIN bot_servers bs ON bs.id = bi.server_id
      WHERE l.status = 'active' ${scope.sql} ${instanceFilter}
      ORDER BY u.name, bi.name`,
    scope.params,
  );
  return rows;
};

const fail = (error: unknown) => {
  if (error instanceof ResellerProgramError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { message: error instanceof Error ? error.message : "Não foi possível gerenciar os proxies." },
    { status: 400 },
  );
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const instances = await instancesFor(user.id);
    return NextResponse.json({
      instances: await Promise.all(instances.map(async (row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        customerId: row.user_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        connected: connected(row.session_status),
        proxy: await getInstanceProxyConfig(row.id),
      }))),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const instanceId = Number(body?.instanceId);
    if (!Number.isInteger(instanceId) || instanceId <= 0) {
      return NextResponse.json({ message: "Perfil inválido." }, { status: 400 });
    }
    const [instance] = await instancesFor(user.id, instanceId);
    if (!instance) throw new ResellerProgramError("Perfil fora da sua carteira de clientes.", 403);
    const proxy = await saveAndTestInstanceProxy(instanceId, {
      enabled: body?.enabled === true,
      proxyUrl: body?.proxyUrl,
      protocol: body?.protocol,
      host: body?.host,
      port: body?.port,
      username: body?.username,
      password: body?.password,
      preserveUsername: body?.preserveUsername === true,
      preservePassword: body?.preservePassword === true,
      source: "partner",
    });
    const isConnected = connected(instance.session_status);
    if (!isConnected) {
      await applyConfiguredProxyToRemote({
        instanceId,
        serverBaseUrl: instance.server_base_url,
        token: instance.token,
      });
    }
    await writePartnerAudit({
      actorUserId: user.id,
      action: "customer_proxy_updated",
      targetType: "bot_instance",
      targetId: instanceId,
      after: { enabled: proxy.enabled, protocol: proxy.protocol, host: proxy.host, port: proxy.port },
    });
    return NextResponse.json({
      message: isConnected
        ? "Proxy salvo. O cliente deverá reconectar o perfil para aplicar."
        : "Proxy testado, salvo e preparado para a conexão.",
      proxy,
      requiresReconnect: isConnected,
    });
  } catch (error) {
    return fail(error);
  }
}
