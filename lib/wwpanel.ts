import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

export const WWPANEL_API_BASE = "https://mcapi.knewcms.com:2087";

export const WWPANEL_PLANS = [
  { id: 2, name: "Essencial 2 IPTV + 1 P2P" },
  { id: 5, name: "Premium 1 IPTV + 2 Nexus" },
  { id: 10, name: "Whot" },
  { id: 11, name: "Ultra 1 Krator+" },
] as const;

export const WWPANEL_ADDONS = [
  { id: 7, name: "Nexus" },
  { id: 8, name: "IPTV e P2P" },
  { id: 9, name: "Whot" },
  { id: 12, name: "Krator" },
] as const;

export const WWPANEL_IPTV_PACKAGES = [
  { id: 30, name: "Brasil" },
  { id: 70, name: "Brasil (+18)" },
  { id: 101, name: "Brasil sem 4K" },
  { id: 102, name: "Brasil sem 4K (+18)" },
  { id: 104, name: "Brasil sem Cinema" },
  { id: 105, name: "Brasil sem Cinema (+18)" },
  { id: 108, name: "Brasil sem jogos e adultos" },
  { id: 97, name: "Brasil + Canais Internacionais" },
  { id: 96, name: "Brasil + Canais Internacionais (+18)" },
  { id: 33, name: "Portugal + Brasil" },
  { id: 84, name: "Portugal + Brasil (+18)" },
  { id: 68, name: "Latinos" },
  { id: 74, name: "Latinos (+18)" },
  { id: 109, name: "Internacional - Restream" },
  { id: 69, name: "Completo" },
  { id: 95, name: "Completo (+18)" },
  { id: 111, name: "Lite" },
  { id: 71, name: "Câmeras" },
  { id: 103, name: "Sem conteúdo" },
] as const;

export const WWPANEL_P2P_PACKAGES = [
  { id: "64399dca5ea59e8a1de2b083", name: "Brasil" },
  { id: "646d1492db22a7b1bc518941", name: "Brasil (+18)" },
  { id: "64399ddfc8f60489be2e8fc5", name: "Portugal" },
  { id: "646d14bc06e850b151d4675e", name: "Portugal (+18)" },
  { id: "69d5f7fdfd4fa0024094975", name: "Brasil + Portugal" },
  { id: "667a0f479ab1ca5452bf15ad", name: "Completo" },
  { id: "5da17892133a1d61888029aa", name: "Completo (+18)" },
  { id: "64681d659455040ee6ff4c52", name: "Câmeras" },
  { id: "64b9ce3689aaac1f86acb99b", name: "Sem conteúdo" },
] as const;

export const WWPANEL_IPTV_APPS = [
  "BrasilIPTV",
  "EasyPlayer",
  "IPTVPlus",
  "IPTVNextPlayer",
  "IPTVPlayerio",
  "IPTVProPlayer",
  "IPTVStarPlayer",
  "IPlayer",
  "OttPlayer",
  "TVVision",
  "TiviPlayerIPTV",
  "IPTV4K",
] as const;

export const WWPANEL_XSTREAM_APPS = [
  "Wapp",
  "WTV Player",
  "XCloud",
  "Kplay",
] as const;

export const WWPANEL_APPS = [
  ...WWPANEL_IPTV_APPS,
  ...WWPANEL_XSTREAM_APPS,
] as const;

export type WwPanelAppName = (typeof WWPANEL_APPS)[number];

export const isWwPanelAppName = (value: string): value is WwPanelAppName =>
  (WWPANEL_APPS as readonly string[]).includes(value);

export const wwPanelAppUsesXstream = (value: WwPanelAppName) =>
  (WWPANEL_XSTREAM_APPS as readonly string[]).includes(value);

type JsonRecord = Record<string, unknown>;

export type WwPanelCreateClientInput = {
  isTrial: 0 | 1;
  whatsapp?: string;
  country: string;
  days?: number;
  months?: number;
  planId: number;
  package_p2p: string;
  package_iptv: number;
  access_iptv: number;
  access_nexus: number;
  addons?: number[];
  notes?: string;
};

export type WwPanelClient = {
  id: string;
  username: string;
  password: string;
  expDate: string | null;
  status: number | null;
  isTrial: boolean;
  whatsapp: string | null;
  country: string | null;
  raw: JsonRecord;
};

const cleanText = (value: unknown, max = 4_000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const encryptionKey = () => {
  const secret = (
    process.env.WWPANEL_ENCRYPTION_KEY ||
    process.env.MOBILE_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    ""
  ).trim();
  if (!secret) {
    throw new Error("A chave de criptografia do WWPanel não está configurada.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
};

export const encryptWwPanelSecret = (value: string) => {
  const plain = cleanText(value, 16_000);
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
};

export const decryptWwPanelSecret = (value: string | null | undefined) => {
  const encoded = cleanText(value, 32_000);
  if (!encoded) return "";
  const payload = Buffer.from(encoded, "base64");
  if (payload.length < 29) throw new Error("Credencial WWPanel inválida.");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
};

const parseResponse = async (response: Response) => {
  if (response.status === 204) return {};
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { message: raw.slice(0, 500) };
  }
};

const errorMessage = (status: number, payload: unknown) => {
  const record = asRecord(payload);
  return (
    cleanText(record.message, 500) ||
    cleanText(record.error, 500) ||
    `WWPanel retornou HTTP ${status}.`
  );
};

export const wwPanelRequest = async <T>(
  apiKey: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<T> => {
  const key = cleanText(apiKey, 16_000);
  if (!key) throw new Error("Informe a API key do WWPanel.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${WWPANEL_API_BASE}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = await parseResponse(response);
    if (!response.ok) throw new Error(errorMessage(response.status, payload));
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("WWPanel demorou para responder.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const sanitizeWwPanelAccount = (payload: unknown): JsonRecord => {
  const outer = asRecord(payload);
  const source =
    Object.keys(asRecord(outer.response)).length > 0
      ? asRecord(outer.response)
      : outer;

  return {
    id: source.id ?? null,
    username: cleanText(source.username ?? source.name, 255) || null,
    credits: Number.isFinite(Number(source.credits ?? source.credit))
      ? Number(source.credits ?? source.credit)
      : null,
    status: Number.isFinite(Number(source.status))
      ? Number(source.status)
      : null,
    country: cleanText(source.country, 100) || null,
    recharge: cleanText(source.recharge, 255) || null,
  };
};

export const getWwPanelAccount = async (apiKey: string) =>
  sanitizeWwPanelAccount(
    await wwPanelRequest<JsonRecord>(apiKey, "/users/logged"),
  );

const normalizeClient = (payload: unknown): WwPanelClient => {
  const outer = asRecord(payload);
  const source =
    Object.keys(asRecord(outer.response)).length > 0
      ? asRecord(outer.response)
      : outer;
  const id = String(source.id ?? source.id_user ?? "").trim();
  const username = cleanText(source.username, 255);
  const password = cleanText(source.password, 255);
  if (!id || !username || !password) {
    throw new Error("WWPanel não retornou as credenciais completas do cliente.");
  }
  return {
    id,
    username,
    password,
    expDate:
      cleanText(source.expDate ?? source.exp_date, 255) || null,
    status: Number.isFinite(Number(source.status))
      ? Number(source.status)
      : null,
    isTrial: Number(source.isTrial ?? source.is_trial ?? 0) === 1,
    whatsapp: cleanText(source.whatsapp, 64) || null,
    country: cleanText(source.country, 100) || null,
    raw: source,
  };
};

export const createWwPanelClient = async (
  apiKey: string,
  input: WwPanelCreateClientInput,
) =>
  normalizeClient(
    await wwPanelRequest<unknown>(apiKey, "/lines/v2", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );

export const createWwPanelTrial = async (
  apiKey: string,
  input: {
    testDuration: number;
    package_iptv: number;
    package_p2p: string;
    krator_package?: string;
    notes?: string;
  },
) =>
  normalizeClient(
    await wwPanelRequest<unknown>(apiKey, "/lines/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );

export const activateWwPanelTrial = async (
  apiKey: string,
  clientId: string,
  input: {
    days?: number;
    months?: number;
    planId: number;
    whatsapp: string;
    country: string;
    package_iptv: number;
    package_p2p: string;
    access_iptv: number;
    access_nexus: number;
  },
) =>
  normalizeClient(
    await wwPanelRequest<unknown>(
      apiKey,
      `/lines/v2/active/${encodeURIComponent(clientId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    ),
  );

export const extendWwPanelClient = async (
  apiKey: string,
  clientId: string,
  period: { days?: number; months?: number },
) =>
  normalizeClient(
    await wwPanelRequest<unknown>(
      apiKey,
      `/lines/v2/extend/${encodeURIComponent(clientId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(period),
      },
    ),
  );

export const editWwPanelClient = async (
  apiKey: string,
  clientId: string,
  input: {
    password: string;
    whatsapp: string;
    country: string;
    notes?: string;
    sale_value?: number;
  },
) =>
  wwPanelRequest<JsonRecord>(
    apiKey,
    `/lines/${encodeURIComponent(clientId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );

export const manageWwPanelClientPlan = async (
  apiKey: string,
  clientId: string,
  input: {
    planId: number;
    access: number;
    access_nexus: number;
    package_p2p: string;
    package_iptv: number;
    addons?: number[];
    serviceId?: string;
    krator_package?: string;
  },
) =>
  wwPanelRequest<JsonRecord>(
    apiKey,
    `/lines/manage-plan/${encodeURIComponent(clientId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );

export const recreateWwPanelClient = async (
  apiKey: string,
  clientId: string,
  password: string,
) =>
  normalizeClient(
    await wwPanelRequest<unknown>(
      apiKey,
      `/lines/recreate/${encodeURIComponent(clientId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ password }),
      },
    ),
  );

export const deleteWwPanelClient = async (
  apiKey: string,
  clientId: string,
) =>
  wwPanelRequest<JsonRecord>(
    apiKey,
    `/lines/${encodeURIComponent(clientId)}`,
    { method: "DELETE" },
  );

export const activateWwPanelApp = async (
  apiKey: string,
  input: {
    clientId: string;
    nameApp: WwPanelAppName;
    mac: string;
    namePlaylist: string;
  },
) =>
  wwPanelRequest<JsonRecord>(
    apiKey,
    wwPanelAppUsesXstream(input.nameApp)
      ? "/lines/active/app/xstream"
      : "/lines/active/app",
    {
      method: "POST",
      body: JSON.stringify({
        nameApp: input.nameApp,
        mac: input.mac,
        namePlaylist: input.namePlaylist,
        id_user: Number(input.clientId),
      }),
    },
  );

export const wwPanelPublicCatalog = () => ({
  plans: WWPANEL_PLANS,
  addons: WWPANEL_ADDONS,
  iptvPackages: WWPANEL_IPTV_PACKAGES,
  p2pPackages: WWPANEL_P2P_PACKAGES,
  apps: WWPANEL_APPS,
  appTypes: Object.fromEntries(
    WWPANEL_APPS.map((app) => [
      app,
      wwPanelAppUsesXstream(app) ? "xstream" : "iptv",
    ]),
  ),
});
