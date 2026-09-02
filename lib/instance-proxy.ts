import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { RowDataPacket } from "mysql2";
import { SocksProxyAgent } from "socks-proxy-agent";

import { ensureBotInstanceProxyTable, ensurePartnerProgramTables, getDb } from "lib/db";
import { decryptWwPanelSecret, encryptWwPanelSecret } from "lib/wwpanel";

export type InstanceProxyProtocol = "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h";

export type InstanceProxyPublicConfig = {
  enabled: boolean;
  protocol: InstanceProxyProtocol;
  host: string | null;
  port: number | null;
  hasUsername: boolean;
  hasPassword: boolean;
  source: "customer" | "partner" | "admin";
  resolvedIp: string | null;
  countryCode: string | null;
  countryName: string | null;
  regionName: string | null;
  cityName: string | null;
  timezoneName: string | null;
  ispName: string | null;
  latencyMs: number | null;
  checkedAt: string | null;
  appliedAt: string | null;
  lastError: string | null;
};

export type InstanceProxyInput = {
  enabled: boolean;
  proxyUrl?: unknown;
  protocol?: unknown;
  host?: unknown;
  port?: unknown;
  username?: unknown;
  password?: unknown;
  preserveUsername?: boolean;
  preservePassword?: boolean;
  source?: "customer" | "partner" | "admin";
};

type ProxyRow = RowDataPacket & {
  instance_id: number;
  enabled: number;
  protocol: string;
  host: string | null;
  port: number | null;
  username_encrypted: string | null;
  password_encrypted: string | null;
  source: string;
  resolved_ip: string | null;
  country_code: string | null;
  country_name: string | null;
  region_name: string | null;
  city_name: string | null;
  timezone_name: string | null;
  isp_name: string | null;
  latency_ms: number | null;
  checked_at: Date | string | null;
  applied_at: Date | string | null;
  last_error: string | null;
};

type NormalizedProxy = {
  enabled: boolean;
  protocol: InstanceProxyProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  source: "customer" | "partner" | "admin";
};

const dateValue = (value: Date | string | null) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const publicConfig = (row?: ProxyRow | null): InstanceProxyPublicConfig => ({
  enabled: row?.enabled === 1,
  protocol: ["http", "https", "socks4", "socks4a", "socks5", "socks5h"].includes(row?.protocol || "")
    ? row!.protocol as InstanceProxyProtocol
    : "socks5",
  host: row?.host || null,
  port: row?.port || null,
  hasUsername: Boolean(row?.username_encrypted),
  hasPassword: Boolean(row?.password_encrypted),
  source: row?.source === "partner" || row?.source === "admin" ? row.source : "customer",
  resolvedIp: row?.resolved_ip || null,
  countryCode: row?.country_code || null,
  countryName: row?.country_name || null,
  regionName: row?.region_name || null,
  cityName: row?.city_name || null,
  timezoneName: row?.timezone_name || null,
  ispName: row?.isp_name || null,
  latencyMs: row?.latency_ms ?? null,
  checkedAt: dateValue(row?.checked_at ?? null),
  appliedAt: dateValue(row?.applied_at ?? null),
  lastError: row?.last_error || null,
});

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const readRow = async (instanceId: number): Promise<ProxyRow | null> => {
  await ensureBotInstanceProxyTable();
  const [rows] = await getDb().query<ProxyRow[]>(
    "SELECT * FROM bot_instance_proxies WHERE instance_id = ? LIMIT 1",
    [instanceId],
  );
  return rows[0] ?? null;
};

export const getInstanceProxyConfig = async (instanceId: number) =>
  publicConfig(await readRow(instanceId));

const normalizeProtocol = (value: unknown): InstanceProxyProtocol => {
  const protocol = text(value, 16).toLowerCase().replace(/:$/, "");
  if (["http", "https", "socks4", "socks4a", "socks5", "socks5h"].includes(protocol)) {
    return protocol as InstanceProxyProtocol;
  }
  throw new Error("Protocolo inválido. Use HTTP/HTTPS, SOCKS4 ou SOCKS5.");
};

const normalizeHost = (value: unknown) => {
  const raw = text(value, 255);
  if (!raw) throw new Error("Informe o endereço do proxy.");
  if (/[/@?#\s]/.test(raw)) {
    throw new Error("Informe somente o host ou IP do proxy, sem protocolo ou caminho.");
  }
  return raw.replace(/^\[|\]$/g, "");
};

const normalizePort = (value: unknown) => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Porta do proxy inválida.");
  }
  return port;
};

const decrypted = (value: string | null | undefined) => {
  if (!value) return "";
  return decryptWwPanelSecret(value);
};

const normalizeInput = async (
  instanceId: number,
  input: InstanceProxyInput,
): Promise<NormalizedProxy> => {
  const current = await readRow(instanceId);
  const enabled = input.enabled === true;
  let urlParts: URL | null = null;
  const rawProxyUrl = text(input.proxyUrl, 2_000);
  if (enabled && rawProxyUrl) {
    try {
      urlParts = new URL(rawProxyUrl);
    } catch {
      throw new Error("URL de proxy inválida.");
    }
    if (!["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(urlParts.protocol)) {
      throw new Error("Protocolo inválido. Use HTTP/HTTPS, SOCKS4 ou SOCKS5.");
    }
  }
  const protocol = enabled ? normalizeProtocol(urlParts?.protocol || input.protocol) : "socks5";
  const host = enabled ? normalizeHost(urlParts?.hostname || input.host) : "";
  const port = enabled ? normalizePort(urlParts?.port || input.port) : 0;
  const suppliedUsername = text(input.username ?? urlParts?.username, 255);
  const suppliedPassword = text(input.password ?? urlParts?.password, 1_000);
  const username = input.preserveUsername && !suppliedUsername
    ? decrypted(current?.username_encrypted)
    : suppliedUsername;
  const password = input.preservePassword && !suppliedPassword
    ? decrypted(current?.password_encrypted)
    : suppliedPassword;
  if ((protocol === "socks4" || protocol === "socks4a") && password) {
    throw new Error("SOCKS4/4A aceita apenas usuário. Para autenticação com senha, use SOCKS5.");
  }
  if (password && !username) {
    throw new Error("Informe também o usuário do proxy.");
  }
  return {
    enabled,
    protocol,
    host,
    port,
    username,
    password,
    source: input.source === "partner" || input.source === "admin" ? input.source : "customer",
  };
};

const hostForUrl = (host: string) => host.includes(":") ? `[${host}]` : host;

const proxyUrl = (proxy: NormalizedProxy) => {
  const credentials = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : "";
  return `${proxy.protocol}://${credentials}${hostForUrl(proxy.host)}:${proxy.port}`;
};

type ProxyCheck = {
  resolvedIp: string;
  countryCode: string | null;
  countryName: string | null;
  regionName: string | null;
  cityName: string | null;
  timezoneName: string | null;
  ispName: string | null;
  latencyMs: number;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const optionalText = (value: unknown, max = 255) => {
  const valueText = text(value, max);
  return valueText || null;
};

const testNormalizedProxy = async (proxy: NormalizedProxy): Promise<ProxyCheck> => {
  const url = proxyUrl(proxy);
  const agent = proxy.protocol.startsWith("socks")
    ? new SocksProxyAgent(url)
    : new HttpsProxyAgent(url);
  const started = Date.now();
  const response = await axios.get("https://ipwho.is/", {
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
    timeout: 12_000,
    maxRedirects: 2,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  const body = record(response.data);
  const ip = text(body.ip, 64);
  if (!ip || body.success === false) {
    throw new Error(optionalText(body.message, 300) || "O proxy não retornou um IP público válido.");
  }

  // A generic IP lookup only proves that the proxy is online. Several proxy
  // providers block WhatsApp specifically while still allowing normal web
  // traffic. Validate the exact HTTPS tunnel required by the WhatsApp
  // websocket before accepting and persisting the proxy for an instance.
  try {
    await axios.head("https://web.whatsapp.com/", {
      httpAgent: agent,
      httpsAgent: agent,
      proxy: false,
      timeout: 12_000,
      maxRedirects: 2,
      validateStatus: (status) => status >= 200 && status < 400,
    });
  } catch {
    throw new Error(
      "O proxy está online, mas não permite conexão com o WhatsApp Web (web.whatsapp.com:443).",
    );
  }

  const timezone = record(body.timezone);
  const connection = record(body.connection);
  return {
    resolvedIp: ip,
    countryCode: optionalText(body.country_code, 8),
    countryName: optionalText(body.country, 120),
    regionName: optionalText(body.region, 160),
    cityName: optionalText(body.city, 160),
    timezoneName: optionalText(timezone.id, 80),
    ispName: optionalText(connection.isp, 255),
    latencyMs: Math.max(1, Date.now() - started),
  };
};

export const testInstanceProxy = async (
  instanceId: number,
  input: InstanceProxyInput,
) => {
  const proxy = await normalizeInput(instanceId, input);
  if (!proxy.enabled) {
    return null;
  }
  return testNormalizedProxy(proxy);
};

export const saveAndTestInstanceProxy = async (
  instanceId: number,
  input: InstanceProxyInput,
): Promise<InstanceProxyPublicConfig> => {
  const proxy = await normalizeInput(instanceId, input);
  let check: ProxyCheck | null = null;
  if (proxy.enabled) {
    try {
      check = await testNormalizedProxy(proxy);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível conectar usando este proxy.";
      throw new Error(`Proxy recusado: ${message}`);
    }

    // A proxy is a network identity, not merely a transport protocol. Reusing
    // the same host/port between active WhatsApp sessions defeats the
    // per-instance isolation policy (and can accidentally put several
    // accounts behind one IP). Check this immediately before persisting so a
    // concurrent profile edit cannot silently share the endpoint.
    await ensureBotInstanceProxyTable();
    const [assignedRows] = await getDb().query<RowDataPacket[]>(
      `SELECT p.instance_id, i.name AS instance_name
         FROM bot_instance_proxies p
         LEFT JOIN bot_instances i ON i.id = p.instance_id
        WHERE p.enabled = 1
          AND p.instance_id <> ?
          AND LOWER(p.host) = LOWER(?)
          AND p.port = ?
        LIMIT 1`,
      [instanceId, proxy.host, proxy.port],
    );
    if (assignedRows.length > 0) {
      const assigned = assignedRows[0];
      const label = text(assigned.instance_name, `#${assigned.instance_id}`);
      throw new Error(
        `Este proxy já está atribuído à instância ${label}. Use outro IP/porta para manter uma rota exclusiva por perfil.`,
      );
    }
  }
  await ensureBotInstanceProxyTable();
  await getDb().query(
    `INSERT INTO bot_instance_proxies
      (instance_id, enabled, protocol, host, port, username_encrypted, password_encrypted,
       source, resolved_ip, country_code, country_name, region_name, city_name, timezone_name,
       isp_name, latency_ms, checked_at, applied_at, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), protocol = VALUES(protocol),
       host = VALUES(host), port = VALUES(port), username_encrypted = VALUES(username_encrypted),
       password_encrypted = VALUES(password_encrypted), source = VALUES(source),
       resolved_ip = VALUES(resolved_ip), country_code = VALUES(country_code),
       country_name = VALUES(country_name), region_name = VALUES(region_name),
       city_name = VALUES(city_name), timezone_name = VALUES(timezone_name), isp_name = VALUES(isp_name),
       latency_ms = VALUES(latency_ms), checked_at = VALUES(checked_at), applied_at = NULL, last_error = NULL`,
    [
      instanceId,
      proxy.enabled ? 1 : 0,
      proxy.protocol,
      proxy.host || null,
      proxy.port || null,
      proxy.username ? encryptWwPanelSecret(proxy.username) : null,
      proxy.password ? encryptWwPanelSecret(proxy.password) : null,
      proxy.source,
      check?.resolvedIp ?? null,
      check?.countryCode ?? null,
      check?.countryName ?? null,
      check?.regionName ?? null,
      check?.cityName ?? null,
      check?.timezoneName ?? null,
      check?.ispName ?? null,
      check?.latencyMs ?? null,
      check ? new Date() : null,
    ],
  );
  return getInstanceProxyConfig(instanceId);
};

export const applyConfiguredProxyToRemote = async (options: {
  instanceId: number;
  serverBaseUrl: string;
  token: string;
}) => {
  const row = await readRow(options.instanceId);
  if (!row) return;
  const enabled = row.enabled === 1;
  const normalized: NormalizedProxy = {
    enabled,
    protocol: ["http", "https", "socks4", "socks4a", "socks5", "socks5h"].includes(row.protocol)
      ? row.protocol as InstanceProxyProtocol
      : "socks5",
    host: row.host || "",
    port: row.port || 0,
    username: decrypted(row.username_encrypted),
    password: decrypted(row.password_encrypted),
    source: row.source === "partner" || row.source === "admin" ? row.source : "customer",
  };
  const response = await fetch(
    `${options.serverBaseUrl.replace(/\/+$/, "")}/session/proxy`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        token: options.token,
      },
      body: JSON.stringify({
        enable: enabled,
        proxy_url: enabled ? proxyUrl(normalized) : "",
        webhook_use_proxy: false,
      }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const message = optionalText(payload?.message ?? payload?.error ?? payload?.data, 400)
      || `A API do WhatsApp recusou o proxy (${response.status}).`;
    await getDb().query(
      "UPDATE bot_instance_proxies SET last_error = ?, applied_at = NULL WHERE instance_id = ?",
      [message, options.instanceId],
    );
    throw new Error(message);
  }
  await getDb().query(
    "UPDATE bot_instance_proxies SET applied_at = NOW(), last_error = NULL WHERE instance_id = ?",
    [options.instanceId],
  );
};

export const getCustomerProxySalesPolicy = async (userId: number) => {
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT f.proxy_sales_mode, f.proxy_monthly_price, f.allow_customer_proxy,
            f.proxy_sales_instructions, u.name AS seller_name
       FROM reseller_customer_links l
       JOIN users u ON u.id = l.reseller_user_id
       LEFT JOIN partner_financial_settings f ON f.user_id = l.reseller_user_id
      WHERE l.customer_user_id = ? AND l.status = 'active'
      ORDER BY l.updated_at DESC LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  const mode = row?.proxy_sales_mode === "automatic" ? "automatic" : "manual";
  return {
    mode,
    monthlyPrice: Math.max(0, Number(row?.proxy_monthly_price ?? 0)),
    allowCustomerProxy: row ? row.allow_customer_proxy !== 0 : true,
    instructions: optionalText(row?.proxy_sales_instructions, 1_000),
    sellerName: optionalText(row?.seller_name, 160),
  };
};

export const resolveProxyCheckoutAdjustment = async (
  userId: number,
  context?: Record<string, unknown> | null,
) => {
  let proxyEnabled = context?.proxyEnabled === true || context?.proxy_enabled === true;
  const instanceId = Number(context?.instanceId ?? context?.instance_id);
  if (!proxyEnabled && Number.isInteger(instanceId) && instanceId > 0) {
    await ensureBotInstanceProxyTable();
    const [rows] = await getDb().query<RowDataPacket[]>(
      `SELECT 1
         FROM bot_instance_proxies p
         JOIN bot_instances i ON i.id = p.instance_id
        WHERE p.instance_id = ? AND i.user_id = ? AND p.enabled = 1
        LIMIT 1`,
      [instanceId, userId],
    );
    proxyEnabled = rows.length > 0;
  }
  if (!proxyEnabled) {
    return { amount: 0, label: null as string | null };
  }
  const policy = await getCustomerProxySalesPolicy(userId);
  if (policy.mode !== "automatic" || !policy.allowCustomerProxy || policy.monthlyPrice <= 0) {
    return { amount: 0, label: null as string | null };
  }
  return {
    amount: Math.round(policy.monthlyPrice * 100) / 100,
    label: `Proxy gerenciado${policy.sellerName ? ` · ${policy.sellerName}` : ""}`,
  };
};
