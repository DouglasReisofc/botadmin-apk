import axios, { type AxiosInstance } from "axios";
import crypto from "crypto";
import FormData from "form-data";

type TempMailMessageEntry = {
  storage?: {
    region?: string;
    key?: string;
  };
};

type NananaReferenceInput =
  | { kind: "url"; url: string }
  | { kind: "buffer"; buffer: Buffer; filename?: string | null; mimeType?: string | null };

export type NananaGenerateParams = {
  prompt: string;
  references: NananaReferenceInput[];
  allowTransparentFallback?: boolean;
  timeoutMs?: number;
};

export type NananaGenerateResult = {
  requestId: string;
  uploadedImageUrls: string[];
  imageUrls: string[];
  rawResult: Record<string, unknown>;
};

const NANANA_BASE_URL = (process.env.NANANA_BASE_URL || "https://nanana.app").replace(/\/+$/, "");
const AKUNLAMA_BASE_URL = "https://akunlama.com";
const DEFAULT_FP_SIGN_SECRET = "GOAT";
const REQUEST_TIMEOUT_MS = 35_000;
const OTP_WAIT_TIMEOUT_MS = 180_000;
const OTP_WAIT_INTERVAL_MS = 5_000;
const RESULT_POLL_INTERVAL_MS = 2_000;
const RESULT_POLL_TIMEOUT_MS = 180_000;
const RESULT_POST_COMPLETE_RETRY_COUNT = 5;
const RESULT_POST_COMPLETE_RETRY_DELAY_MS = 1_500;
const SESSION_TTL_MS = 25 * 60_000;
const MAX_REFERENCE_UPLOADS = 6;
const MAX_REMOTE_IMAGE_BYTES = 18 * 1024 * 1024;
const TRANSPARENT_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z7l8AAAAASUVORK5CYII=",
  "base64",
);

type CachedSession = {
  fpId: string;
  cookie: string;
  expiresAt: number;
};

type NananaHttpError = Error & {
  status?: number;
  code?: string;
  responseData?: unknown;
};

const cachedSessions = new Map<string, CachedSession>();
const inflightSessionPromises = new Map<string, Promise<CachedSession>>();
let cachedFallbackVisitorId: string | null = null;

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const firstNonEmptyString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const getFallbackVisitorId = (): string => {
  if (cachedFallbackVisitorId) return cachedFallbackVisitorId;
  cachedFallbackVisitorId = `fallback-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  return cachedFallbackVisitorId;
};

const createRandomVisitorId = (): string => `fallback-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

const toBase64Url = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const createSignedFpIdFromVisitor = (visitorId: string): string => {
  const normalizedVisitor = visitorId.trim();
  if (!normalizedVisitor) {
    throw new Error("NANANA_VISITOR_ID invalido para gerar x-fp-id.");
  }
  const fpSecret = (process.env.NANANA_FP_SIGN_SECRET || DEFAULT_FP_SIGN_SECRET).trim() || DEFAULT_FP_SIGN_SECRET;
  const signature = crypto.createHmac("sha256", fpSecret).update(normalizedVisitor).digest("hex");
  return toBase64Url(`${normalizedVisitor}.${signature}`);
};

const resolveNananaFpId = (): string => {
  const explicitFpId = process.env.NANANA_FP_ID?.trim();
  if (explicitFpId) {
    return explicitFpId;
  }
  const visitorId = process.env.NANANA_VISITOR_ID?.trim() || getFallbackVisitorId();
  return createSignedFpIdFromVisitor(visitorId);
};

const createFreshFallbackFpId = (): string => createSignedFpIdFromVisitor(createRandomVisitorId());

const extractHttpUrlsFromAny = (payload: unknown): string[] => {
  const found = new Set<string>();
  const stack: unknown[] = [payload];
  const seen = new Set<unknown>();

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        found.add(trimmed);
      }
      continue;
    }

    if (typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }

    for (const entry of Object.values(current as Record<string, unknown>)) {
      stack.push(entry);
    }
  }

  return Array.from(found);
};

const looksLikeImageUrl = (value: string): boolean => {
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\.(?:png|jpe?g|webp|gif|bmp|svg)(?:[?#].*)?$/i.test(value)) return true;
  if (/image|img|photo|picture|render|media/i.test(value)) return true;
  return false;
};

const extractBestImageUrls = (payload: unknown): string[] => {
  const all = extractHttpUrlsFromAny(payload);
  if (!all.length) return [];
  const imageLike = all.filter((entry) => looksLikeImageUrl(entry));
  return (imageLike.length ? imageLike : all).slice(0, 6);
};

const inferFileNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const raw = parsed.pathname.split("/").filter(Boolean).pop() || "";
    const cleaned = raw.replace(/[^a-z0-9._-]+/gi, "_");
    if (cleaned) return cleaned;
  } catch {
    // ignore
  }
  return `ref_${Date.now()}.jpg`;
};

const normalizeHttpUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim().replace(/[)\],.;!?]+$/g, "");
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const createNananaHttpError = (status: number, message: string, responseData?: unknown): NananaHttpError => {
  const error = new Error(message) as NananaHttpError;
  error.status = status;
  error.code = "NANANA_HTTP_STATUS";
  if (responseData !== undefined) {
    error.responseData = responseData;
  }
  return error;
};

const getErrorStatus = (error: unknown): number | null => {
  const status = Number((error as NananaHttpError | null)?.status ?? NaN);
  return Number.isFinite(status) ? status : null;
};

const getErrorPayloadMessage = (error: unknown): string | null => {
  const payload = toRecord((error as NananaHttpError | null)?.responseData);
  return firstNonEmptyString(payload.error, payload.message, payload.code);
};

const isUserIdentificationError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  const payloadMessage = (getErrorPayloadMessage(error) || "").toLowerCase();
  return status === 400 && payloadMessage.includes("user identification required");
};

const isInsufficientCreditsError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  const payloadMessage = (getErrorPayloadMessage(error) || "").toLowerCase();
  return status === 402 || payloadMessage.includes("insufficient credits");
};

const isInvalidEmailError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status !== 400) return false;
  const payload = toRecord((error as NananaHttpError | null)?.responseData);
  const code = firstNonEmptyString(payload.code, payload.error, payload.message);
  return (code || "").toLowerCase().includes("invalid_email");
};

const shouldRetryWithFreshSession = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status === null) return false;
  return status === 401 || status === 403 || status === 429;
};

const invalidateCachedSession = (): void => {
  cachedSessions.clear();
  inflightSessionPromises.clear();
};

const invalidateCachedSessionForFpId = (fpId: string): void => {
  cachedSessions.delete(fpId);
  inflightSessionPromises.delete(fpId);
};

const defaultNananaHeaders = () => ({
  accept: "*/*",
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: NANANA_BASE_URL,
  referer: `${NANANA_BASE_URL}/en`,
  "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
});

class TempMailScraper {
  private readonly axios: AxiosInstance;
  private readonly recipient: string;

  constructor() {
    this.axios = axios.create({
      baseURL: AKUNLAMA_BASE_URL,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        referer: "https://akunlama.com/",
        "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      },
      validateStatus: () => true,
    });
    this.recipient = crypto.randomBytes(8).toString("hex").slice(0, 10);
  }

  getEmail(): string {
    return `${this.recipient}@akunlama.com`;
  }

  private extractCode(html: string): string | null {
    const match = html.match(/(\d{6})/);
    return match ? match[1] : null;
  }

  private async listInbox(): Promise<TempMailMessageEntry[]> {
    const response = await this.axios.get("/api/list", {
      params: { recipient: this.recipient },
      headers: {
        referer: `https://akunlama.com/inbox/${this.recipient}/list`,
      },
    });

    if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
      return [];
    }
    return response.data as TempMailMessageEntry[];
  }

  private async readHtml(entry: TempMailMessageEntry): Promise<string | null> {
    const region = entry.storage?.region;
    const key = entry.storage?.key;
    if (!region || !key) return null;

    const response = await this.axios.get("/api/getHtml", {
      params: { region, key },
      headers: {
        referer: `https://akunlama.com/inbox/${this.recipient}/message/${region}/${key}`,
      },
    });
    if (response.status < 200 || response.status >= 300) return null;
    return typeof response.data === "string" ? response.data : null;
  }

  async waitForCode(timeoutMs = OTP_WAIT_TIMEOUT_MS): Promise<string> {
    const startedAt = Date.now();
    const seenKeys = new Set<string>();

    while (Date.now() - startedAt < timeoutMs) {
      const inbox = await this.listInbox().catch(() => []);
      for (const entry of inbox) {
        const key = `${entry.storage?.region || ""}:${entry.storage?.key || ""}`;
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        const html = await this.readHtml(entry);
        if (!html) continue;
        const code = this.extractCode(html);
        if (code) return code;
      }
      await sleep(OTP_WAIT_INTERVAL_MS);
    }

    throw new Error("Tempo esgotado aguardando o codigo OTP do Nanana.");
  }
}

class NananaClient {
  private readonly axios: AxiosInstance;
  private cookieString = "";
  private fpId = "";

  constructor(options?: { fpId?: string | null; sessionCookie?: string | null }) {
    this.axios = axios.create({
      baseURL: NANANA_BASE_URL,
      timeout: REQUEST_TIMEOUT_MS,
      headers: defaultNananaHeaders(),
      withCredentials: true,
      validateStatus: () => true,
      maxContentLength: 64 * 1024 * 1024,
      maxBodyLength: 64 * 1024 * 1024,
    });
    if (options?.fpId && options.fpId.trim()) {
      this.fpId = options.fpId.trim();
    }
    if (options?.sessionCookie && options.sessionCookie.trim()) {
      this.cookieString = options.sessionCookie.trim();
    }
  }

  withFpId(fpId: string): this {
    this.fpId = fpId.trim();
    return this;
  }

  withSessionCookie(cookie: string): this {
    this.cookieString = cookie.trim();
    return this;
  }

  private requestHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...(extra || {}),
    };
    if (this.fpId) {
      headers["x-fp-id"] = this.fpId;
    }
    if (this.cookieString) {
      headers.Cookie = this.cookieString;
    }
    return headers;
  }

  private extractSessionCookieFromResponse(response: { headers?: Record<string, unknown> }): string | null {
    const setCookieRaw = (response.headers?.["set-cookie"] ?? response.headers?.["Set-Cookie"]) as
      | string[]
      | string
      | undefined;
    const setCookies = Array.isArray(setCookieRaw) ? setCookieRaw : typeof setCookieRaw === "string" ? [setCookieRaw] : [];
    for (const cookie of setCookies) {
      const first = cookie.split(";")[0]?.trim();
      if (first?.startsWith("__Secure-better-auth.session_token=")) {
        return first;
      }
    }
    return null;
  }

  async authenticateWithEmailOtp(email: string, otp: string): Promise<string> {
    const response = await this.axios.post("/api/auth/sign-in/email-otp", { email, otp }, { headers: this.requestHeaders() });
    if (response.status < 200 || response.status >= 300) {
      throw createNananaHttpError(
        response.status,
        `Falha ao validar OTP no Nanana (${response.status}).`,
        response.data,
      );
    }
    const cookie = this.extractSessionCookieFromResponse(response);
    if (!cookie) {
      throw new Error("Nanana nao retornou cookie de sessao.");
    }
    this.cookieString = cookie;
    return cookie;
  }

  async sendOtp(email: string): Promise<void> {
    const response = await this.axios.post(
      "/api/auth/email-otp/send-verification-otp",
      {
        email,
        type: "sign-in",
      },
      {
        headers: this.requestHeaders(),
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw createNananaHttpError(
        response.status,
        `Falha ao solicitar OTP no Nanana (${response.status}).`,
        response.data,
      );
    }
  }

  async uploadImageBuffer(buffer: Buffer, options?: { filename?: string | null; mimeType?: string | null }): Promise<string> {
    if (!buffer.length) {
      throw new Error("Buffer de imagem vazio para upload.");
    }

    const form = new FormData();
    form.append("image", buffer, {
      filename: options?.filename || `reference_${Date.now()}.jpg`,
      contentType: options?.mimeType || "image/jpeg",
    });

    const response = await this.axios.post("/api/upload-img", form, {
      headers: {
        ...form.getHeaders(),
        ...this.requestHeaders(),
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw createNananaHttpError(
        response.status,
        `Falha no upload de imagem para Nanana (${response.status}).`,
        response.data,
      );
    }

    const dataRecord = toRecord(response.data);
    const uploadUrl = firstNonEmptyString(
      dataRecord.url,
      toRecord(dataRecord.data).url,
      toRecord(dataRecord.result).url,
    );
    const normalized = normalizeHttpUrl(uploadUrl);
    if (!normalized) {
      throw new Error("Nanana nao retornou URL de upload valida.");
    }
    return normalized;
  }

  async uploadImageUrl(url: string): Promise<string> {
    const normalizedUrl = normalizeHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("URL de referencia invalida.");
    }

    const response = await axios.get(normalizedUrl, {
      responseType: "arraybuffer",
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      maxContentLength: MAX_REMOTE_IMAGE_BYTES,
      maxBodyLength: MAX_REMOTE_IMAGE_BYTES,
      headers: {
        accept: "image/*,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw createNananaHttpError(
        response.status,
        `Falha ao baixar imagem de referencia (${response.status}).`,
        response.data,
      );
    }

    const contentType = firstNonEmptyString(response.headers["content-type"]) || "image/jpeg";
    if (!/^image\//i.test(contentType)) {
      throw new Error("A URL informada nao retornou uma imagem valida.");
    }

    const buffer = Buffer.from(response.data as ArrayBuffer);
    return this.uploadImageBuffer(buffer, {
      filename: inferFileNameFromUrl(normalizedUrl),
      mimeType: contentType,
    });
  }

  async generateImage(prompt: string, imageUrls: string[]): Promise<string> {
    const response = await this.axios.post(
      "/api/image-to-image",
      { prompt, image_urls: imageUrls },
      {
        headers: this.requestHeaders({
          "content-type": "application/json",
        }),
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw createNananaHttpError(
        response.status,
        `Falha ao iniciar geracao no Nanana (${response.status}).`,
        response.data,
      );
    }

    const dataRecord = toRecord(response.data);
    const requestId = firstNonEmptyString(
      dataRecord.request_id,
      dataRecord.requestId,
      toRecord(dataRecord.data).request_id,
      toRecord(dataRecord.data).requestId,
      toRecord(dataRecord.result).request_id,
      toRecord(dataRecord.result).requestId,
    );
    if (!requestId) {
      throw new Error("Nanana nao retornou request_id.");
    }
    return requestId;
  }

  async getResult(requestId: string): Promise<Record<string, unknown>> {
    const response = await this.axios.post(
      "/api/get-result",
      { requestId, type: "image-to-image" },
      {
        headers: this.requestHeaders({
          "content-type": "application/json",
        }),
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw createNananaHttpError(
        response.status,
        `Falha ao consultar resultado no Nanana (${response.status}).`,
        response.data,
      );
    }
    return toRecord(response.data);
  }

  async getCredits(): Promise<{ balance: number; hasLoggedIn: boolean } | null> {
    const response = await this.axios.get("/api/credits", {
      headers: this.requestHeaders(),
    });
    if (response.status < 200 || response.status >= 300) {
      return null;
    }
    const payload = toRecord(response.data);
    const balanceRaw = Number(payload.balance);
    const hasLoggedIn = Boolean(payload.hasLoggedIn);
    return {
      balance: Number.isFinite(balanceRaw) ? balanceRaw : 0,
      hasLoggedIn,
    };
  }

  async pollUntilComplete(requestId: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = await this.getResult(requestId);
      const completed = Boolean(
        result.completed ??
          toRecord(result.data).completed ??
          toRecord(result.result).completed ??
          (typeof result.status === "string" && result.status.toLowerCase() === "completed") ??
          (typeof toRecord(result.data).status === "string" &&
            String(toRecord(result.data).status).toLowerCase() === "completed"),
      );
      if (completed) {
        return result;
      }
      await sleep(RESULT_POLL_INTERVAL_MS);
    }
    throw new Error("Tempo esgotado aguardando a imagem no Nanana.");
  }
}

const createSessionWithOtp = async (fpId: string): Promise<CachedSession> => {
  const tempMail = new TempMailScraper();
  const client = new NananaClient({ fpId });
  const email = tempMail.getEmail();

  await client.sendOtp(email);
  const otp = await tempMail.waitForCode();
  const cookie = await client.authenticateWithEmailOtp(email, otp);

  return {
    fpId,
    cookie,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
};

const ensureSession = async (fpId: string): Promise<CachedSession> => {
  const now = Date.now();
  const cachedSession = cachedSessions.get(fpId);
  if (cachedSession && cachedSession.expiresAt > now) {
    return cachedSession;
  }
  const inflightSessionPromise = inflightSessionPromises.get(fpId);
  if (inflightSessionPromise) {
    return inflightSessionPromise;
  }

  const createdPromise = (async () => {
    const created = await createSessionWithOtp(fpId);
    cachedSessions.set(fpId, created);
    return created;
  })();
  inflightSessionPromises.set(fpId, createdPromise);

  try {
    return await createdPromise;
  } finally {
    inflightSessionPromises.delete(fpId);
  }
};

const ensureValidPrompt = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < 4) {
    throw new Error("Prompt muito curto para gerar imagem.");
  }
  return normalized;
};

const dedupeReferences = (references: NananaReferenceInput[]): NananaReferenceInput[] => {
  const unique: NananaReferenceInput[] = [];
  const seenUrls = new Set<string>();
  let bufferCount = 0;

  for (const ref of references) {
    if (ref.kind === "url") {
      const normalized = normalizeHttpUrl(ref.url);
      if (!normalized || seenUrls.has(normalized)) continue;
      seenUrls.add(normalized);
      unique.push({ kind: "url", url: normalized });
      continue;
    }
    if (!Buffer.isBuffer(ref.buffer) || ref.buffer.length === 0) continue;
    if (bufferCount >= MAX_REFERENCE_UPLOADS) continue;
    bufferCount += 1;
    unique.push(ref);
  }

  return unique.slice(0, MAX_REFERENCE_UPLOADS);
};

const resolveEffectiveTimeout = (timeoutMs: unknown): number => {
  const parsed = Number(timeoutMs);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return RESULT_POLL_TIMEOUT_MS;
  }
  return parsed;
};

const envFlagEnabled = (value: string | undefined): boolean => {
  const normalized = (value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const shouldUseOtpFallback = (): boolean => envFlagEnabled(process.env.NANANA_USE_OTP_AUTH);

const shouldUsePublicImageFallback = (): boolean =>
  !/^(0|false|no|off)$/i.test((process.env.NANANA_ENABLE_PUBLIC_IMAGE_FALLBACK || "").trim());

const shouldUseAilabsFallback = (): boolean =>
  !/^(0|false|no|off)$/i.test((process.env.NANANA_ENABLE_AILABS_FALLBACK || "").trim());

const resolveSessionCookieFromEnv = (): string | null =>
  firstNonEmptyString(process.env.NANANA_SESSION_COOKIE, process.env.NANANA_AUTH_COOKIE);

const parseEnvList = (value: string | undefined): string[] => {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
      }
    } catch {
      // fall back to delimiter parsing
    }
  }
  return trimmed
    .split(/\s*(?:\|\|\||\r?\n)\s*/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseSimpleEnvList = (value: string | undefined): string[] =>
  parseEnvList(value)
    .flatMap((entry) => entry.split(/\s*,\s*/g))
    .map((entry) => entry.trim())
    .filter(Boolean);

const parsePositiveIntEnv = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
};

type NananaAccountCandidate = {
  label: string;
  fpId: string;
  sessionCookie: string | null;
  otp: boolean;
};

const buildAccountCandidates = (): NananaAccountCandidate[] => {
  const candidates: NananaAccountCandidate[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: NananaAccountCandidate): void => {
    const key = `${candidate.otp ? "otp" : "direct"}:${candidate.fpId}:${candidate.sessionCookie || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const primaryFpId = resolveNananaFpId();
  addCandidate({
    label: "env-primary",
    fpId: primaryFpId,
    sessionCookie: resolveSessionCookieFromEnv(),
    otp: false,
  });

  const fpIds = parseSimpleEnvList(process.env.NANANA_FP_IDS);
  const visitorIds = parseSimpleEnvList(process.env.NANANA_VISITOR_IDS);
  const sessionCookies = [
    ...parseEnvList(process.env.NANANA_SESSION_COOKIES),
    ...parseEnvList(process.env.NANANA_AUTH_COOKIES),
  ];
  const accountCount = Math.max(fpIds.length, visitorIds.length, sessionCookies.length);
  for (let index = 0; index < accountCount; index += 1) {
    const fpId = fpIds[index] || (visitorIds[index] ? createSignedFpIdFromVisitor(visitorIds[index]) : primaryFpId);
    addCandidate({
      label: `env-account-${index + 1}`,
      fpId,
      sessionCookie: sessionCookies[index] || null,
      otp: false,
    });
  }

  if (shouldUseOtpFallback()) {
    const otpAttempts = parsePositiveIntEnv(process.env.NANANA_OTP_ACCOUNT_ATTEMPTS, 3, 10);
    for (let index = 0; index < otpAttempts; index += 1) {
      addCandidate({
        label: `otp-account-${index + 1}`,
        fpId: createFreshFallbackFpId(),
        sessionCookie: null,
        otp: true,
      });
    }
  }

  return candidates;
};

const shouldTryNextAccount = (error: unknown): boolean =>
  isInsufficientCreditsError(error) ||
  isUserIdentificationError(error) ||
  isInvalidEmailError(error) ||
  shouldRetryWithFreshSession(error);

const generateWithPublicImageFallback = async (
  prompt: string,
  references: NananaReferenceInput[],
): Promise<NananaGenerateResult> => {
  const referenceUrls = references
    .filter((reference): reference is { kind: "url"; url: string } => reference.kind === "url")
    .map((reference) => reference.url)
    .slice(0, 3);
  const promptWithRefs = referenceUrls.length
    ? `${prompt} | visual references: ${referenceUrls.join(" ")}`
    : prompt;
  const seed = crypto.createHash("sha256").update(`${promptWithRefs}:${Date.now()}`).digest("hex").slice(0, 8);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptWithRefs)}?width=768&height=768&nologo=true&safe=true&seed=${parseInt(seed, 16)}`;

  return {
    requestId: `pollinations-${Date.now()}`,
    uploadedImageUrls: [],
    imageUrls: [imageUrl],
    rawResult: {
      provider: "pollinations",
      ignoredBufferReferences: references.filter((reference) => reference.kind === "buffer").length,
    },
  };
};

const generateWithAilabsFallback = async (prompt: string): Promise<NananaGenerateResult> => {
  const imported = await import("../integrations/apis/funcoes/ailabs.js");
  const aiLabs = (imported.default || imported) as {
    text2img?: (prompt: string) => Promise<{
      success?: boolean;
      code?: number;
      result?: { url?: string; error?: string };
    }>;
  };
  if (typeof aiLabs.text2img !== "function") {
    throw new Error("Fallback AILabs indisponivel.");
  }
  const response = await aiLabs.text2img(prompt);
  const imageUrl = normalizeHttpUrl(response?.result?.url);
  if (!response?.success || !imageUrl) {
    throw new Error(response?.result?.error || "Fallback AILabs nao retornou imagem.");
  }

  return {
    requestId: `ailabs-${Date.now()}`,
    uploadedImageUrls: [],
    imageUrls: [imageUrl],
    rawResult: {
      provider: "ailabs",
      code: response.code ?? null,
    },
  };
};

const normalizeThrowError = (error: unknown, fallbackMessage: string): Error =>
  error instanceof Error ? error : new Error(fallbackMessage);

const mapProviderError = async (error: unknown, client: NananaClient): Promise<Error> => {
  if (isInsufficientCreditsError(error)) {
    const credits = await client.getCredits().catch(() => null);
    const balanceLabel = credits ? String(Math.max(0, Number(credits.balance || 0))) : "?";
    const loginLabel = credits ? (credits.hasLoggedIn ? "conta conectada" : "sem login") : "estado desconhecido";
    return new Error(
      `Nanana sem creditos para gerar imagem (saldo: ${balanceLabel}; ${loginLabel}). Configure NANANA_FP_ID/NANANA_SESSION_COOKIE de uma conta com creditos.`,
    );
  }

  if (isUserIdentificationError(error)) {
    return new Error(
      "Nanana recusou identificacao da requisicao (x-fp-id). Configure NANANA_FP_ID valido ou NANANA_SESSION_COOKIE.",
    );
  }

  if (isInvalidEmailError(error)) {
    return new Error(
      "Nanana bloqueou OTP por dominio de email temporario. Use NANANA_SESSION_COOKIE ou NANANA_FP_ID de uma conta valida.",
    );
  }

  return normalizeThrowError(error, "Falha desconhecida ao gerar imagem no Nanana.");
};

const runGenerationWithClient = async (
  client: NananaClient,
  prompt: string,
  references: NananaReferenceInput[],
  timeoutMs: number,
): Promise<NananaGenerateResult> => {
  const uploadedImageUrls: string[] = [];

  for (const reference of references) {
    if (reference.kind === "url") {
      const uploadedUrl = await client.uploadImageUrl(reference.url);
      uploadedImageUrls.push(uploadedUrl);
      continue;
    }
    const uploadedUrl = await client.uploadImageBuffer(reference.buffer, {
      filename: reference.filename ?? undefined,
      mimeType: reference.mimeType ?? undefined,
    });
    uploadedImageUrls.push(uploadedUrl);
  }

  if (!uploadedImageUrls.length) {
    throw new Error("Nao foi possivel preparar as referencias para o Nanana.");
  }

  const requestId = await client.generateImage(prompt, uploadedImageUrls);
  const rawResult = await client.pollUntilComplete(requestId, timeoutMs);
  let resolvedResult = rawResult;
  let imageUrls = extractBestImageUrls(resolvedResult);
  if (!imageUrls.length) {
    for (let retry = 0; retry < RESULT_POST_COMPLETE_RETRY_COUNT; retry += 1) {
      await sleep(RESULT_POST_COMPLETE_RETRY_DELAY_MS * (retry + 1));
      try {
        const refreshed = await client.getResult(requestId);
        if (refreshed && Object.keys(refreshed).length > 0) {
          resolvedResult = refreshed;
          imageUrls = extractBestImageUrls(resolvedResult);
          if (imageUrls.length) {
            break;
          }
        }
      } catch {
        // keep trying within the retry window
      }
    }
  }

  if (!imageUrls.length) {
    throw new Error(`Nanana concluiu sem retornar URL da imagem gerada (requestId: ${requestId}).`);
  }

  return {
    requestId,
    uploadedImageUrls,
    imageUrls,
    rawResult: resolvedResult,
  };
};

export const generateNananaImage = async (params: NananaGenerateParams): Promise<NananaGenerateResult> => {
  const prompt = ensureValidPrompt(params.prompt);
  let references = dedupeReferences(Array.isArray(params.references) ? params.references : []);

  if (!references.length && params.allowTransparentFallback !== false) {
    references = [
      {
        kind: "buffer",
        buffer: TRANSPARENT_PNG_BUFFER,
        filename: "transparent-base.png",
        mimeType: "image/png",
      },
    ];
  }

  if (!references.length) {
    throw new Error("Nenhuma referencia de imagem foi informada.");
  }

  const timeoutMs = resolveEffectiveTimeout(params.timeoutMs);
  const candidates = buildAccountCandidates();
  let lastError: unknown = null;
  let lastClient: NananaClient | null = null;

  for (const candidate of candidates) {
    let client = new NananaClient({ fpId: candidate.fpId, sessionCookie: candidate.sessionCookie });
    try {
      if (candidate.otp) {
        const session = await ensureSession(candidate.fpId);
        client = new NananaClient({ fpId: candidate.fpId, sessionCookie: session.cookie });
      }
      lastClient = client;
      return await runGenerationWithClient(client, prompt, references, timeoutMs);
    } catch (error) {
      lastError = error;
      lastClient = client;
      if (candidate.otp) {
        invalidateCachedSessionForFpId(candidate.fpId);
      }
      if (shouldTryNextAccount(error)) {
        await sleep(800);
        continue;
      }
      break;
    }
  }

  if (shouldUseAilabsFallback()) {
    try {
      return await generateWithAilabsFallback(prompt);
    } catch (fallbackError) {
      if (!lastError) {
        lastError = fallbackError;
      }
    }
  }

  if (shouldUsePublicImageFallback()) {
    try {
      return await generateWithPublicImageFallback(prompt, references);
    } catch (fallbackError) {
      if (!lastError) {
        lastError = fallbackError;
      }
    }
  }

  throw await mapProviderError(lastError, lastClient || new NananaClient({ fpId: resolveNananaFpId() }));
};

export const __internal = {
  normalizeHttpUrl,
  extractBestImageUrls,
  looksLikeImageUrl,
};
