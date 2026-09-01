import { randomUUID } from "node:crypto";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePrefix =
  rawBasePath && rawBasePath !== "/" ? (rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`) : "";

export const AUTODOWN_WS_PATH = `${basePrefix}/ws/autodown`;
export const AUTODOWN_DEFAULT_TIMEOUT_MS = 180000;
const AUTODOWN_AUTH_TOKEN = process.env.AUTODOWN_WS_TOKEN?.trim() || null;

export type AutoDownSite = "envato" | "freepik" | "chatgpt" | "canva";
export type AutoDownJobStatus = "success" | "error";

export type AutoDownJob = {
  id: string;
  url: string;
  site: AutoDownSite;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AutoDownJobResult = {
  jobId: string;
  clientId: string;
  status: AutoDownJobStatus;
  site: AutoDownSite | null;
  requestedUrl: string | null;
  directLink: string | null;
  previewUrl: string | null;
  filename: string | null;
  mime: string | null;
  message: string | null;
  completedAt: string;
  metadata: Record<string, unknown> | null;
};

type Waiter = {
  resolve: (result: AutoDownJobResult) => void;
  reject: (error: Error) => void;
};

type AutoDownState = {
  pending: AutoDownJob[];
  inFlight: Map<string, AutoDownJob>;
  inFlightStartedAt: Map<string, string>;
  completed: Map<string, AutoDownJobResult>;
  results: AutoDownJobResult[];
  clients: Map<string, { send: (payload: string) => void; close: (code?: number, data?: string) => void }>;
  waiters: Map<string, Waiter>;
  nativeWorkers: Map<string, Record<string, unknown>>;
  monitorEvents: Array<Record<string, unknown>>;
};

const runtime = globalThis as typeof globalThis & {
  __botadmAutoDownState?: AutoDownState;
};

const createState = (): AutoDownState => ({
  pending: [],
  inFlight: new Map(),
  inFlightStartedAt: new Map(),
  completed: new Map(),
  results: [],
  clients: new Map(),
  waiters: new Map(),
  nativeWorkers: new Map(),
  monitorEvents: [],
});

const state = runtime.__botadmAutoDownState ?? createState();
state.inFlightStartedAt ??= new Map();
runtime.__botadmAutoDownState = state;

const nowIso = () => new Date().toISOString();

const readPositiveIntEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
};

const AUTODOWN_INFLIGHT_TIMEOUT_MS = readPositiveIntEnv(
  "AUTODOWN_INFLIGHT_TIMEOUT_MS",
  4 * 60 * 1000,
);
const AUTODOWN_CHATGPT_INFLIGHT_TIMEOUT_MS = readPositiveIntEnv(
  "AUTODOWN_CHATGPT_INFLIGHT_TIMEOUT_MS",
  11 * 60 * 1000,
);

export const getAutoDownWebSocketPath = () => AUTODOWN_WS_PATH;

export const isAutoDownAuthConfigured = () => Boolean(AUTODOWN_AUTH_TOKEN);

export const isAutoDownAuthTokenValid = (token: unknown) => {
  if (!AUTODOWN_AUTH_TOKEN) {
    return true;
  }
  return typeof token === "string" && token.trim() === AUTODOWN_AUTH_TOKEN;
};

const DEFAULT_NATIVE_TOKEN = "WvOCTEU8-Z7oY1PdbYjHf9_TpJTvV26g";
const AUTODOWN_NATIVE_TOKEN =
  process.env.AUTODOWN_NATIVE_TOKEN?.trim() ||
  process.env.AUTODOWN_WS_TOKEN?.trim() ||
  DEFAULT_NATIVE_TOKEN;

export const isAutoDownNativeAuthTokenValid = (token: unknown) => {
  if (!AUTODOWN_NATIVE_TOKEN) {
    return true;
  }
  return typeof token === "string" && token.trim() === AUTODOWN_NATIVE_TOKEN;
};

export const detectAutoDownSite = (url: string): AutoDownSite | null => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "elements.envato.com" || hostname.endsWith(".elements.envato.com")) {
      return "envato";
    }
    if (hostname === "freepik.com" || hostname === "www.freepik.com" || hostname.endsWith(".freepik.com")) {
      return "freepik";
    }
  } catch {
    return null;
  }
  return null;
};

export const normalizeAutoDownUrl = (rawUrl: unknown): string | null => {
  const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!value) {
    return null;
  }

  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return detectAutoDownSite(normalized) ? normalized : null;
};

const snapshotInFlight = () =>
  Object.fromEntries(
    [...state.inFlight.entries()].map(([clientId, job]) => [
      clientId,
      {
        id: job.id,
        url: job.url,
        site: job.site,
        metadata: job.metadata,
        createdAt: job.createdAt,
        inFlightSince: state.inFlightStartedAt.get(clientId) ?? null,
      },
    ]),
  );

const getInFlightTimeoutMs = (job: AutoDownJob): number =>
  job.site === "chatgpt" ? AUTODOWN_CHATGPT_INFLIGHT_TIMEOUT_MS : AUTODOWN_INFLIGHT_TIMEOUT_MS;

const buildErrorResult = (
  clientId: string,
  job: AutoDownJob,
  message: string,
): AutoDownJobResult => ({
  jobId: job.id,
  clientId,
  status: "error",
  site: job.site,
  requestedUrl: job.url,
  directLink: null,
  previewUrl: null,
  filename: null,
  mime: null,
  message,
  completedAt: nowIso(),
  metadata: null,
});

const completeAutoDownJobAsError = (clientId: string, job: AutoDownJob, message: string) => {
  if (state.completed.has(job.id)) {
    return;
  }
  const result = buildErrorResult(clientId, job, message);
  state.completed.set(job.id, result);
  state.results.push(result);
  const waiter = state.waiters.get(job.id);
  if (waiter) {
    state.waiters.delete(job.id);
    waiter.resolve(result);
  }
};

const expireStaleInFlightForClient = (clientId: string) => {
  const job = state.inFlight.get(clientId);
  if (!job) {
    state.inFlightStartedAt.delete(clientId);
    return;
  }
  const startedAtMs = Date.parse(state.inFlightStartedAt.get(clientId) ?? job.createdAt);
  if (!Number.isFinite(startedAtMs)) {
    state.inFlightStartedAt.set(clientId, nowIso());
    return;
  }
  if (Date.now() - startedAtMs <= getInFlightTimeoutMs(job)) {
    return;
  }
  state.inFlight.delete(clientId);
  state.inFlightStartedAt.delete(clientId);
  state.pending = state.pending.filter((pendingJob) => pendingJob.id !== job.id);
  completeAutoDownJobAsError(
    clientId,
    job,
    "Tempo limite aguardando retorno do worker nativo.",
  );
};

const expireAllStaleInFlight = () => {
  for (const clientId of state.inFlight.keys()) {
    expireStaleInFlightForClient(clientId);
  }
};

const sendJson = (clientId: string, payload: Record<string, unknown>) => {
  const client = state.clients.get(clientId);
  if (!client) {
    return false;
  }

  try {
    client.send(JSON.stringify(payload));
    return true;
  } catch {
    state.clients.delete(clientId);
    return false;
  }
};

const createJob = (url: string, metadata: Record<string, unknown> = {}): AutoDownJob => ({
  id: randomUUID(),
  url,
  site: detectAutoDownSite(url) as AutoDownSite,
  metadata,
  createdAt: nowIso(),
});

const createNativeJob = (input: {
  id?: string | null;
  url: string;
  site?: AutoDownSite | null;
  metadata?: Record<string, unknown> | null;
}): AutoDownJob => ({
  id: readString(input.id) || randomUUID(),
  url: input.url,
  site: input.site || (detectAutoDownSite(input.url) as AutoDownSite) || "freepik",
  metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  createdAt: nowIso(),
});

export const getAutoDownStateSnapshot = () => {
  expireAllStaleInFlight();
  return {
    pendingJobs: state.pending.length,
    connectedClients: [...state.clients.keys()],
    nativeWorkers: [...state.nativeWorkers.values()],
    inFlight: snapshotInFlight(),
    resultsCount: state.results.length,
    monitorEventsCount: state.monitorEvents.length,
    websocketPath: AUTODOWN_WS_PATH,
    requiresAuthToken: isAutoDownAuthConfigured(),
    nativeAuthRequired: Boolean(AUTODOWN_NATIVE_TOKEN),
  };
};

export const resetAutoDownState = () => {
  state.pending = [];
  state.inFlight.clear();
  state.inFlightStartedAt.clear();
  state.completed.clear();
  state.results = [];
};

export const enqueueAutoDownJob = (url: string, metadata: Record<string, unknown> = {}) => {
  const job = createJob(url, metadata);
  state.pending.push(job);
  dispatchAllAutoDownClients();
  return job;
};

export const enqueueAutoDownNativeJob = (input: {
  id?: string | null;
  url: string;
  site?: AutoDownSite | null;
  metadata?: Record<string, unknown> | null;
}) => {
  const job = createNativeJob(input);
  state.completed.delete(job.id);
  state.pending.push(job);
  dispatchAllAutoDownClients();
  return job;
};

const removeAutoDownJobFromQueues = (jobId: string) => {
  state.pending = state.pending.filter((job) => job.id !== jobId);
  for (const [clientId, job] of state.inFlight.entries()) {
    if (job.id === jobId) {
      state.inFlight.delete(clientId);
      state.inFlightStartedAt.delete(clientId);
    }
  }
};

const waitForAutoDownJobResult = (jobId: string, timeoutMs = AUTODOWN_DEFAULT_TIMEOUT_MS) =>
  new Promise<AutoDownJobResult>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      state.waiters.delete(jobId);
      removeAutoDownJobFromQueues(jobId);
      reject(new Error("Tempo limite aguardando retorno da extensao."));
    }, timeoutMs);

    state.waiters.set(jobId, {
      resolve: (result) => {
        clearTimeout(timeoutId);
        state.waiters.delete(jobId);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        state.waiters.delete(jobId);
        reject(error);
      },
    });
  });

export const enqueueAutoDownJobAndWait = async (
  url: string,
  metadata: Record<string, unknown> = {},
  timeoutMs = AUTODOWN_DEFAULT_TIMEOUT_MS,
) => {
  const job = enqueueAutoDownJob(url, metadata);
  const result = await waitForAutoDownJobResult(job.id, timeoutMs);

  return {
    ok: result.status === "success",
    site: result.site,
    job,
    result,
  };
};

export const enqueueAutoDownNativeJobAndWait = async (
  input: {
    id?: string | null;
    url: string;
    site?: AutoDownSite | null;
    metadata?: Record<string, unknown> | null;
  },
  timeoutMs = AUTODOWN_DEFAULT_TIMEOUT_MS,
) => {
  const job = enqueueAutoDownNativeJob(input);
  const result = await waitForAutoDownJobResult(job.id, timeoutMs);

  return {
    ok: result.status === "success",
    site: result.site,
    job,
    result,
  };
};

export const registerAutoDownClient = (
  clientId: string,
  client: { send: (payload: string) => void; close: (code?: number, data?: string) => void },
) => {
  state.clients.set(clientId, client);
  return sendJson(clientId, {
    type: "hello_ack",
    client_id: clientId,
    queue_size: state.pending.length,
    server_time: nowIso(),
    websocket_path: AUTODOWN_WS_PATH,
    auth_required: isAutoDownAuthConfigured(),
  });
};

export const dispatchNextAutoDownJob = (clientId: string) => {
  expireStaleInFlightForClient(clientId);
  const client = state.clients.get(clientId);
  if (!client || state.inFlight.has(clientId) || state.pending.length === 0) {
    return false;
  }

  const job = state.pending.shift();
  if (!job) {
    return false;
  }

  state.inFlight.set(clientId, job);
  state.inFlightStartedAt.set(clientId, nowIso());
  return sendJson(clientId, {
    type: "job",
    job: {
      id: job.id,
      url: job.url,
      site: job.site,
      metadata: job.metadata,
      created_at: job.createdAt,
    },
    queue_size: state.pending.length,
  });
};

export const dispatchAllAutoDownClients = () => {
  for (const clientId of state.clients.keys()) {
    dispatchNextAutoDownJob(clientId);
  }
};

export const requeueAutoDownInFlight = (clientId: string) => {
  const job = state.inFlight.get(clientId);
  if (!job) {
    return;
  }

  state.inFlight.delete(clientId);
  state.inFlightStartedAt.delete(clientId);
  if (!state.completed.has(job.id)) {
    state.pending.unshift(job);
  }
};

export const unregisterAutoDownClient = (clientId: string) => {
  state.clients.delete(clientId);
  requeueAutoDownInFlight(clientId);
};

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readNestedString = (record: Record<string, unknown> | null, ...keys: string[]): string | null => {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

const resolveResultLinkInfo = (message: Record<string, unknown>): Record<string, unknown> | null => {
  const raw = message.link_info;
  if (typeof raw === "string") {
    try {
      return readRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return readRecord(raw);
};

export const submitAutoDownJobResult = (clientId: string, message: Record<string, unknown>) => {
  const jobId = readString(message.job_id);
  if (!jobId) {
    return {
      ok: false,
      error: "job_result sem job_id",
    };
  }

  const currentJob = state.inFlight.get(clientId);
  if (currentJob && currentJob.id === jobId) {
    state.inFlight.delete(clientId);
    state.inFlightStartedAt.delete(clientId);
  } else {
    state.pending = state.pending.filter((job) => job.id !== jobId);
  }

  const linkInfo = resolveResultLinkInfo(message);
  const selected = readRecord(linkInfo?.selected);
  const metadata: Record<string, unknown> = {};
  if (linkInfo) {
    metadata.link_info = linkInfo;
  }
  const requestedAssetType = readString(message.requested_asset_type);
  if (requestedAssetType) {
    metadata.requested_asset_type = requestedAssetType;
  }
  if (message.session_cookies) {
    metadata.session_cookies = message.session_cookies;
  }
  if (message.session_local_storage) {
    metadata.session_local_storage = message.session_local_storage;
  }

  const result: AutoDownJobResult = {
    jobId,
    clientId: readString(message.client_id) || clientId,
    status: readString(message.status) === "error" ? "error" : "success",
    site: (readString(message.site) as AutoDownSite | null) || currentJob?.site || null,
    requestedUrl: readString(message.requested_url) || currentJob?.url || null,
    directLink: readString(message.direct_link),
    previewUrl: readString(message.preview_url),
    filename:
      readString(message.filename) ||
      readNestedString(linkInfo, "embedded_file_name", "file_name", "filename") ||
      readNestedString(selected, "filename", "file_name"),
    mime:
      readString(message.mime) ||
      readString(message.mime_type) ||
      readString(message.content_type) ||
      readNestedString(linkInfo, "embedded_content_type", "content_type", "mime_type", "mime"),
    message: readString(message.message),
    completedAt: readString(message.completed_at) || nowIso(),
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };

  state.completed.set(jobId, result);
  state.results.push(result);

  const waiter = state.waiters.get(jobId);
  if (waiter) {
    waiter.resolve(result);
  }

  sendJson(clientId, {
    type: "job_ack",
    job_id: jobId,
    pending_jobs: state.pending.length,
  });

  dispatchNextAutoDownJob(clientId);

  return {
    ok: true,
    result,
  };
};

export const pullAutoDownNativeJob = (input: {
  clientId: string;
  deviceId?: string | null;
  label?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  androidVersion?: string | null;
  sdk?: string | null;
  version?: string | null;
  slots?: number | null;
  monitorNetwork?: boolean | null;
  monitorDom?: boolean | null;
}) => {
  const clientId = input.clientId.trim();
  expireStaleInFlightForClient(clientId);
  state.nativeWorkers.set(clientId, {
    clientId,
    deviceId: input.deviceId ?? null,
    label: input.label ?? null,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    androidVersion: input.androidVersion ?? null,
    sdk: input.sdk ?? null,
    version: input.version ?? null,
    slots: input.slots ?? null,
    monitorNetwork: input.monitorNetwork ?? null,
    monitorDom: input.monitorDom ?? null,
    lastSeenAt: nowIso(),
  });

  if (state.inFlight.has(clientId) || state.pending.length === 0) {
    return null;
  }

  const job = state.pending.shift() ?? null;
  if (!job) {
    return null;
  }
  state.inFlight.set(clientId, job);
  state.inFlightStartedAt.set(clientId, nowIso());
  return job;
};

export const submitAutoDownNativeJobResult = (message: Record<string, unknown>) => {
  const clientId = readString(message.client_id) || "native-cromite";
  return submitAutoDownJobResult(clientId, message);
};

export const recordAutoDownNativeMonitorEvents = (message: Record<string, unknown>) => {
  const events = Array.isArray(message.events) ? message.events : [];
  const now = nowIso();
  for (const event of events.slice(0, 120)) {
    state.monitorEvents.push({
      clientId: readString(message.client_id),
      deviceId: readString(message.device_id),
      label: readString(message.label),
      tabId: message.tab_id ?? null,
      tabUrl: readString(message.tab_url),
      event,
      receivedAt: now,
    });
  }
  if (state.monitorEvents.length > 1000) {
    state.monitorEvents.splice(0, state.monitorEvents.length - 1000);
  }
  return { accepted: events.length };
};

export const buildAutoDownNativeAdaptersBundle = () => {
  const adapters = [
    {
      site: "freepik",
      enabled: true,
      host_contains: ["freepik.com"],
      direct_url_patterns: [
        "downloadscdn\\d*\\.freepik\\.com",
        "downloadscdn\\.freepik\\.com",
        "cdn-icons-png\\.freepik\\.com",
        "cdn-icons\\.freepik\\.com",
        "[?&]filename=",
      ],
      direct_file_extensions: [
        "zip",
        "rar",
        "7z",
        "psd",
        "ai",
        "eps",
        "svg",
        "png",
        "jpg",
        "jpeg",
        "webp",
      ],
      image_request_path_contains: [
        "/sticker/",
        "/premium-ai-image/",
        "/free-photo/",
        "/photo/",
        "/icon/",
      ],
    },
    {
      site: "envato",
      enabled: true,
      host_contains: [
        "app.envato.com",
        "elements.envato.com",
        "envato.com",
        "cloudfront.net",
        "amazonaws.com",
        "envatousercontent.com",
      ],
      direct_url_patterns: [
        "elements\\.envato\\.com/download",
        "/downloads/",
        "envato-elements-production",
        "cloudfront",
        "amazonaws",
        "envatousercontent",
      ],
      direct_file_extensions: [
        "zip",
        "rar",
        "7z",
        "psd",
        "ai",
        "eps",
        "svg",
        "mp4",
        "mov",
        "mkv",
        "ttf",
        "otf",
        "woff",
        "woff2",
      ],
      image_request_path_contains: [],
    },
    {
      site: "canva",
      enabled: true,
      host_contains: [
        "canva.com",
        "canvausercontent.com",
        "media-public.canva.com",
        "media-private.canva.com",
        "media-transformation.canva.com",
      ],
      direct_url_patterns: [
        "media-(?:public|private)\\.canva\\.com",
        "media-transformation\\.canva\\.com",
        "\\.canvausercontent\\.com",
        "/download/",
        "/downloads/",
        "/export(?:[/?#]|$)",
        "[?&]format=(?:png|jpe?g|webp|pdf)",
      ],
      direct_file_extensions: ["png", "jpg", "jpeg", "webp", "svg", "pdf", "zip", "mp4"],
      image_request_path_contains: ["/background-remover", "/remove-background"],
    },
    {
      site: "chatgpt",
      enabled: true,
      host_contains: [
        "chatgpt.com",
        "files.oaiusercontent.com",
        "persistent.oaistatic.com",
        "oaistatic.com",
        "openaicdn.com",
      ],
      direct_url_patterns: [
        "chatgpt\\.com/backend-api/estuary/content",
        "files\\.oaiusercontent\\.com",
        "persistent\\.oaistatic\\.com",
      ],
      direct_file_extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
      image_request_path_contains: ["/?temporary-chat=true", "/c/"],
    },
  ];
  const bundle = {
    version: "botadmin-native-1",
    adapters,
    rules: adapters,
  };
  return {
    bundle,
    bundle_json: JSON.stringify(bundle),
    signature: "",
  };
};
