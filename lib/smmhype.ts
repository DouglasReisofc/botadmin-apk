import {
  decryptWwPanelSecret,
  encryptWwPanelSecret,
} from "lib/wwpanel";

export const SMMHYPE_API_BASE = "https://smmhype.com/api/v2";
export const SMM_FX_API_URL =
  "https://api.frankfurter.dev/v2/rate/USD/BRL";

type JsonRecord = Record<string, unknown>;

export type SmmService = {
  service: number;
  name: string;
  type: string;
  category: string;
  rate: number;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
  dripfeed: boolean;
  raw: JsonRecord;
};

export type SmmBalance = {
  balance: number;
  currency: string;
};

export type SmmOrderStatus = {
  charge: number | null;
  startCount: string | null;
  status: string;
  remains: string | null;
  currency: string | null;
  raw: JsonRecord;
};

export type SmmAddOrderInput = {
  service: number;
  link: string;
  quantity?: number;
  runs?: number;
  interval?: number;
  keywords?: string;
  comments?: string;
  usernames?: string;
  hashtag?: string;
  username?: string;
  answerNumber?: number;
  groups?: string;
  min?: number;
  max?: number;
  posts?: number;
  oldPosts?: number;
  delay?: number;
  expiry?: string;
  country?: string;
  device?: string;
  trafficType?: number;
  googleKeyword?: string;
  referringUrl?: string;
};

const cleanText = (value: unknown, max = 20_000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const numeric = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanValue = (value: unknown) =>
  value === true ||
  value === 1 ||
  value === "1" ||
  cleanText(value, 20).toLowerCase() === "true";

const parseResponse = async (response: Response) => {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { error: raw.slice(0, 1_000) };
  }
};

const providerError = (payload: unknown) => {
  const record = asRecord(payload);
  return (
    cleanText(record.error, 1_000) ||
    (cleanText(record.status, 100).toLowerCase() === "error"
      ? cleanText(record.message, 1_000) || "O painel SMM retornou um erro."
      : "")
  );
};

export const smmRequest = async <T>(
  apiKey: string,
  action: string,
  payload: Record<string, string | number | undefined> = {},
  apiBase = SMMHYPE_API_BASE,
): Promise<T> => {
  const key = cleanText(apiKey, 16_000);
  if (!key) throw new Error("Informe a API key do painel SMM.");
  const url = cleanText(apiBase, 2_000) || SMMHYPE_API_BASE;
  const body = new URLSearchParams({ key, action });
  for (const [name, value] of Object.entries(payload)) {
    if (value === undefined || value === "") continue;
    body.set(name, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await parseResponse(response);
    const error = providerError(result);
    if (!response.ok || error) {
      throw new Error(error || `Painel SMM retornou HTTP ${response.status}.`);
    }
    return result as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("O painel SMM demorou para responder.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const getSmmBalance = async (
  apiKey: string,
  apiBase = SMMHYPE_API_BASE,
): Promise<SmmBalance> => {
  const result = asRecord(
    await smmRequest<unknown>(apiKey, "balance", {}, apiBase),
  );
  const balance = numeric(result.balance, Number.NaN);
  if (!Number.isFinite(balance)) {
    throw new Error("O painel SMM retornou um saldo inválido.");
  }
  return {
    balance,
    currency: cleanText(result.currency, 12).toUpperCase() || "USD",
  };
};

export const getSmmServices = async (
  apiKey: string,
  apiBase = SMMHYPE_API_BASE,
): Promise<SmmService[]> => {
  const result = await smmRequest<unknown>(apiKey, "services", {}, apiBase);
  if (!Array.isArray(result)) {
    throw new Error("O painel SMM retornou um catálogo inválido.");
  }
  return result
    .map((entry) => {
      const raw = asRecord(entry);
      return {
        service: Math.floor(numeric(raw.service)),
        name: cleanText(raw.name, 500),
        type: cleanText(raw.type, 100) || "Default",
        category: cleanText(raw.category, 500) || "Outros",
        rate: Math.max(0, numeric(raw.rate)),
        min: Math.max(0, Math.floor(numeric(raw.min))),
        max: Math.max(0, Math.floor(numeric(raw.max))),
        refill: booleanValue(raw.refill),
        cancel: booleanValue(raw.cancel),
        dripfeed: booleanValue(raw.dripfeed),
        raw,
      } satisfies SmmService;
    })
    .filter(
      (service) =>
        service.service > 0 &&
        service.name.length > 0 &&
        service.max >= service.min,
    );
};

const addOrderPayload = (input: SmmAddOrderInput) => ({
  service: input.service,
  link: input.link,
  quantity: input.quantity,
  runs: input.runs,
  interval: input.interval,
  keywords: input.keywords,
  comments: input.comments,
  usernames: input.usernames,
  hashtag: input.hashtag,
  username: input.username,
  answer_number: input.answerNumber,
  groups: input.groups,
  min: input.min,
  max: input.max,
  posts: input.posts,
  old_posts: input.oldPosts,
  delay: input.delay,
  expiry: input.expiry,
  country: input.country,
  device: input.device,
  type_of_traffic: input.trafficType,
  google_keyword: input.googleKeyword,
  referring_url: input.referringUrl,
});

export const addSmmOrder = async (
  apiKey: string,
  input: SmmAddOrderInput,
  apiBase = SMMHYPE_API_BASE,
) => {
  const result = asRecord(
    await smmRequest<unknown>(apiKey, "add", addOrderPayload(input), apiBase),
  );
  const order = cleanText(result.order, 160);
  if (!order) throw new Error("O painel SMM não retornou o ID do pedido.");
  return { order, raw: result };
};

export const getSmmOrderStatus = async (
  apiKey: string,
  order: string,
  apiBase = SMMHYPE_API_BASE,
): Promise<SmmOrderStatus> => {
  const result = asRecord(
    await smmRequest<unknown>(
      apiKey,
      "status",
      { order: cleanText(order, 160) },
      apiBase,
    ),
  );
  return {
    charge: Number.isFinite(Number(result.charge))
      ? Number(result.charge)
      : null,
    startCount: cleanText(result.start_count, 160) || null,
    status: cleanText(result.status, 100) || "Unknown",
    remains: cleanText(result.remains, 160) || null,
    currency: cleanText(result.currency, 12).toUpperCase() || null,
    raw: result,
  };
};

export const requestSmmRefill = async (
  apiKey: string,
  order: string,
  apiBase = SMMHYPE_API_BASE,
) => {
  const result = asRecord(
    await smmRequest<unknown>(
      apiKey,
      "refill",
      { order: cleanText(order, 160) },
      apiBase,
    ),
  );
  const refill = cleanText(result.refill, 160);
  if (!refill) throw new Error("O painel SMM não retornou o ID da reposição.");
  return { refill, raw: result };
};

export const getSmmRefillStatus = async (
  apiKey: string,
  refill: string,
  apiBase = SMMHYPE_API_BASE,
) =>
  asRecord(
    await smmRequest<unknown>(
      apiKey,
      "refill_status",
      { refill: cleanText(refill, 160) },
      apiBase,
    ),
  );

export const cancelSmmOrders = async (
  apiKey: string,
  orders: string[],
  apiBase = SMMHYPE_API_BASE,
) =>
  smmRequest<unknown>(
    apiKey,
    "cancel",
    {
      orders: orders
        .map((order) => cleanText(order, 160))
        .filter(Boolean)
        .slice(0, 100)
        .join(","),
    },
    apiBase,
  );

export const fetchUsdBrlRate = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(SMM_FX_API_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = asRecord(await parseResponse(response));
    const rate = numeric(payload.rate, Number.NaN);
    if (!response.ok || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("Cotação USD/BRL indisponível.");
    }
    return {
      rate,
      date: cleanText(payload.date, 40) || new Date().toISOString().slice(0, 10),
    };
  } finally {
    clearTimeout(timer);
  }
};

export const smmServiceUsesFixedPrice = (type: string) =>
  ["package", "custom comments package"].includes(
    cleanText(type, 100).toLowerCase(),
  );

export const smmServiceQuantityFromInput = (
  service: Pick<SmmService, "type" | "min">,
  input: SmmAddOrderInput,
) => {
  const type = cleanText(service.type, 100).toLowerCase();
  if (smmServiceUsesFixedPrice(type)) return 1;
  if (type.includes("comments") && input.comments) {
    return Math.max(
      1,
      input.comments.split(/\r?\n/).filter((line) => line.trim()).length,
    );
  }
  if (type === "mentions custom list" && input.usernames) {
    return Math.max(
      1,
      input.usernames.split(/\r?\n/).filter((line) => line.trim()).length,
    );
  }
  if (type === "subscriptions") {
    return Math.max(1, Number(input.max || input.min || service.min || 1));
  }
  return Math.max(1, Number(input.quantity || service.min || 1));
};

export const calculateSmmPrice = (input: {
  providerRate: number;
  serviceType: string;
  quantity: number;
  usdBrlRate: number;
  markupPercent: number;
  fixedMarkupCents: number;
  minimumProfitCents: number;
  customSaleRateCents?: number | null;
}) => {
  const quantity = Math.max(1, Number(input.quantity || 1));
  const fixed = smmServiceUsesFixedPrice(input.serviceType);
  const providerCostUsd = fixed
    ? Math.max(0, input.providerRate)
    : (Math.max(0, input.providerRate) * quantity) / 1_000;
  const providerCostCents = Math.max(
    1,
    Math.ceil(providerCostUsd * Math.max(0.01, input.usdBrlRate) * 100),
  );
  if (
    input.customSaleRateCents != null &&
    Number(input.customSaleRateCents) > 0
  ) {
    const customTotal = fixed
      ? Number(input.customSaleRateCents)
      : (Number(input.customSaleRateCents) * quantity) / 1_000;
    return {
      providerCostUsd,
      providerCostCents,
      totalCents: Math.max(providerCostCents, Math.ceil(customTotal)),
    };
  }
  const percentage = Math.max(0, input.markupPercent) / 100;
  const calculated =
    providerCostCents * (1 + percentage) +
    Math.max(0, input.fixedMarkupCents);
  return {
    providerCostUsd,
    providerCostCents,
    totalCents: Math.max(
      providerCostCents + Math.max(0, input.minimumProfitCents),
      Math.ceil(calculated),
    ),
  };
};

export const encryptSmmSecret = encryptWwPanelSecret;
export const decryptSmmSecret = decryptWwPanelSecret;
