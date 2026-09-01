const SISREG_BASE_URL = "https://consultasisreg.manaus.am.gov.br";
const SISREG_INERTIA_VERSION = "eeefaa557bfccba6bbb55c15dd7c7cdb";
const SISREG_DEFAULT_PARAMETER = "Consulta com Código de Solicitação";

type CookieJar = Record<string, string>;

const SISREG_DEFAULT_HEADERS = {
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
} as const;

const readSetCookieHeaders = (headers: Headers): string[] => {
  const anyHeaders = headers as Headers & {
    raw?: () => Record<string, string[]>;
    getSetCookie?: () => string[];
  };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  if (typeof anyHeaders.raw === "function") {
    const raw = anyHeaders.raw();
    if (raw && Array.isArray(raw["set-cookie"])) {
      return raw["set-cookie"];
    }
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
};

const updateCookieJar = (headers: Headers, jar: CookieJar): void => {
  const cookies = readSetCookieHeaders(headers);
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const name = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1);
    if (!name) continue;
    jar[name] = value;
  }
};

const buildCookieHeader = (jar: CookieJar): string =>
  Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");

const decodeHtmlEntities = (input: string): string =>
  input
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/");

export const normalizeSisregString = (input: string): string =>
  input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]+/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const extractSisregUnits = (html: string): string[] => {
  const match = html.match(/<div id="app" data-page="([^"]+)"/);
  if (!match) {
    return [];
  }
  try {
    const decoded = decodeHtmlEntities(match[1]);
    const payload = JSON.parse(decoded) as { props?: { unidades?: Array<{ sms_unidade_solicitante?: string }> } };
    if (!payload?.props?.unidades) {
      return [];
    }
    return payload.props.unidades
      .map((entry) => (typeof entry?.sms_unidade_solicitante === "string" ? entry.sms_unidade_solicitante.trim() : ""))
      .filter((entry) => entry.length > 0);
  } catch (error) {
    console.error("[sisreg] Falha ao decodificar unidades", { error });
    return [];
  }
};

const resolveSisregUnitName = (units: string[], input: string): string | null => {
  if (!input) {
    return null;
  }
  const normalizedUnits = units.map((unit) => ({
    original: unit,
    normalized: normalizeSisregString(unit),
  }));
  const normalizedInput = normalizeSisregString(input);
  if (!normalizedInput) {
    return null;
  }
  const exact = normalizedUnits.find((entry) => entry.normalized === normalizedInput);
  if (exact) {
    return exact.original;
  }
  const tokens = normalizedInput.split(" ").filter(Boolean);
  if (!tokens.length) {
    return null;
  }
  let bestMatch: { original: string; score: number; length: number } | null = null;
  for (const entry of normalizedUnits) {
    const score = tokens.reduce((acc, token) => (entry.normalized.includes(token) ? acc + 1 : acc), 0);
    if (score === 0) continue;
    if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && entry.original.length < bestMatch.length)) {
      bestMatch = { original: entry.original, score, length: entry.original.length };
    }
  }
  return bestMatch?.original ?? null;
};

export type SisregQueryResult = { status: string; unit: string };

export const querySisregStatus = async (code: string, unitInput: string): Promise<SisregQueryResult> => {
  const jar: CookieJar = {};

  const initialRes = await fetch(SISREG_BASE_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      ...SISREG_DEFAULT_HEADERS,
    },
  });
  updateCookieJar(initialRes.headers, jar);
  const initialHtml = await initialRes.text();
  const units = extractSisregUnits(initialHtml);

  const resolvedUnit =
    unitInput && units.length > 0 ? resolveSisregUnitName(units, unitInput) : units.length === 1 ? units[0] : null;
  if (!resolvedUnit) {
    throw new Error("Não foi possível identificar a unidade informada. Verifique o nome e tente novamente.");
  }

  const xsrfCookie = jar["XSRF-TOKEN"];
  if (!xsrfCookie) {
    throw new Error("Não foi possível iniciar a sessão com o SisReg. Tente novamente mais tarde.");
  }

  const postHeaders = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-Inertia": "true",
    "X-Inertia-Version": SISREG_INERTIA_VERSION,
    "X-XSRF-TOKEN": decodeURIComponent(xsrfCookie),
    Cookie: buildCookieHeader(jar),
    Referer: `${SISREG_BASE_URL}/`,
    Origin: SISREG_BASE_URL,
    ...SISREG_DEFAULT_HEADERS,
  };

  const payload = {
    nome: "",
    codigo: code,
    unidade: resolvedUnit,
    parameter: SISREG_DEFAULT_PARAMETER,
  };

  const postRes = await fetch(`${SISREG_BASE_URL}/consulta`, {
    method: "POST",
    headers: postHeaders,
    redirect: "manual",
    body: JSON.stringify(payload),
  });
  updateCookieJar(postRes.headers, jar);

  if (![302, 303, 307, 308].includes(postRes.status)) {
    throw new Error("O SisReg rejeitou a consulta neste momento. Tente novamente em instantes.");
  }

  const location = postRes.headers.get("location") ?? "/";
  const followURL = new URL(location, SISREG_BASE_URL).toString();

  const followRes = await fetch(followURL, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      "X-Inertia": "true",
      "X-Inertia-Version": SISREG_INERTIA_VERSION,
      Cookie: buildCookieHeader(jar),
      ...SISREG_DEFAULT_HEADERS,
    },
  });
  updateCookieJar(followRes.headers, jar);

  if (!followRes.ok) {
    throw new Error("Não foi possível obter o retorno do SisReg após a consulta.");
  }

  const data = await followRes.json().catch(() => null);
  if (!data || typeof data !== "object") {
    throw new Error("Não consegui interpretar a resposta do SisReg.");
  }

  const props = (data as { props?: unknown }).props as { errors?: Record<string, unknown> } | undefined;
  const errors = props?.errors ?? {};

  const messageCandidates = [
    errors.pending,
    errors.erro,
    errors.error,
    errors.message,
  ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

  const statusMessage =
    messageCandidates[0]?.trim() ?? "Status não informado pelo SisReg. Verifique manualmente no portal oficial.";

  return { status: statusMessage, unit: resolvedUnit };
};

const SISREG_APPROVAL_KEYWORDS = [
  "APROVADO",
  "APROVADA",
  "APROVACAO CONFIRMADA",
  "AUTORIZADO",
  "AUTORIZADA",
  "AUTORIZACAO DISPONIVEL",
  "AGENDAMENTO CONFIRMADO",
  "LIBERADO",
  "LIBERADA",
  "ENCAMINHADO",
  "ENCAMINHADA",
];
const SISREG_PENDING_KEYWORDS = [
  "AGUARDANDO",
  "AGUARDAR",
  "PENDENTE",
  "PENDENCIA",
  "ANALISE",
  "ANALISES",
  "EM ANALISE",
  "EMANALISE",
  "SEM AUTORIZACAO",
  "VERIFIQUE",
  "AGUARDANDO AUTORIZACAO",
  "AGUARDANDO AUTORIZACAO!",
];
const SISREG_APPROVAL_PATTERNS = SISREG_APPROVAL_KEYWORDS.map((keyword) =>
  normalizeSisregString(keyword),
);
const SISREG_PENDING_PATTERNS = SISREG_PENDING_KEYWORDS.map((keyword) =>
  normalizeSisregString(keyword),
);

export const isSisregStatusApproved = (status: string | null | undefined): boolean => {
  if (!status || typeof status !== "string") {
    return false;
  }
  const normalized = normalizeSisregString(status);
  if (!normalized) {
    return false;
  }
  if (SISREG_PENDING_PATTERNS.some((pattern) => pattern && normalized.includes(pattern))) {
    return false;
  }
  return SISREG_APPROVAL_PATTERNS.some((pattern) => pattern && normalized.includes(pattern));
};

export const sanitizeSisregUnitInput = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

export const SISREG_INTERVAL_MINUTES_MIN = 15;
export const SISREG_INTERVAL_MINUTES_MAX = 24 * 60;
