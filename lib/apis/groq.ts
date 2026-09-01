import crypto from "node:crypto";

export type GroqChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GroqChatOptions = {
  apiKeys: string[];
  messages: GroqChatMessage[];
  model?: string;
  models?: string[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type GroqChatErrorInfo = {
  type:
    | "no_keys"
    | "rate_limit"
    | "quota_exceeded"
    | "invalid_auth"
    | "invalid_request"
    | "network"
    | "unknown";
  status?: number;
  message?: string;
  key?: string;
  model?: string;
  retryAfterSeconds?: number | null;
};

export type GroqChatResult = {
  content: string | null;
  error?: GroqChatErrorInfo;
};

const DEFAULT_MODEL = "llama-3.1-8b-instant";
const MODEL_FALLBACKS = [
  "llama-3.1-70b-versatile",
];
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_TEMPERATURE = 0.8;
const DEFAULT_MAX_TOKENS = 400;

const sanitizeKeys = (keys: string[]): string[] =>
  keys
    .map((key) => (typeof key === "string" ? key.trim() : ""))
    .filter((key) => key.length > 0);

const uniqueShuffle = (values: string[]): string[] => {
  const shuffled = [...new Set(values)];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const resolveApiKeys = (keys: string[]): string[] => {
  const sanitized = sanitizeKeys(keys);
  const fallback = process.env.GROQ_FALLBACK_KEY?.trim();
  if (fallback) {
    sanitized.push(fallback);
  }
  return uniqueShuffle(sanitized);
};

export const pickGroqKey = (keys: string[]): string | null => {
  const resolved = resolveApiKeys(keys);
  return resolved.length > 0 ? resolved[0] : null;
};

const maskApiKey = (key: string): string =>
  key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key;

const parseErrorResponse = async (
  response: Response,
  model: string,
  key: string,
): Promise<GroqChatErrorInfo> => {
  let bodyText = "";
  let parsed: any = null;
  try {
    bodyText = await response.text();
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    /* ignore */
  }

  const message =
    parsed?.error?.message ||
    parsed?.message ||
    bodyText ||
    response.statusText ||
    "Erro desconhecido ao chamar a API da Groq.";

  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

  if (response.status === 429 || parsed?.error?.code === "rate_limit_exceeded") {
    return {
      type: "rate_limit",
      status: response.status,
      message,
      key: maskApiKey(key),
      model,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    };
  }

  if (response.status === 402 || parsed?.error?.code === "quota_exceeded") {
    return {
      type: "quota_exceeded",
      status: response.status,
      message,
      key: maskApiKey(key),
      model,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      type: "invalid_auth",
      status: response.status,
      message,
      key: maskApiKey(key),
      model,
    };
  }

  return {
    type: "invalid_request",
    status: response.status,
    message,
    key: maskApiKey(key),
    model,
  };
};

const requestCompletionWithKey = async (
  key: string,
  model: string,
  options: GroqChatOptions,
): Promise<GroqChatResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: false,
      }),
    });

    if (!response.ok) {
      return { content: null, error: await parseErrorResponse(response, model, key) };
    }

    const payload: any = await response.json().catch(() => null);
    const content: string | undefined = payload?.choices?.[0]?.message?.content;
    return { content: typeof content === "string" ? content.trim() : null };
  } finally {
    clearTimeout(timeout);
  }
};

export const createGroqChatCompletion = async (
  options: GroqChatOptions,
): Promise<GroqChatResult> => {
  const keys = resolveApiKeys(options.apiKeys);
  if (keys.length === 0) {
    return {
      content: null,
      error: { type: "no_keys", message: "Nenhuma chave Groq configurada." },
    };
  }

  const modelCandidates = Array.from(
    new Set(
      [
        ...(Array.isArray(options.models) ? options.models : []),
        options.model ?? DEFAULT_MODEL,
        ...MODEL_FALLBACKS,
      ].filter((value): value is string => Boolean(value && value.trim())),
    ),
  );

  let lastError: GroqChatErrorInfo | undefined;

  for (const key of keys) {
    for (const model of modelCandidates) {
      const result = await requestCompletionWithKey(key, model, options);
      if (result.content) {
        return { content: result.content };
      }

      if (result.error) {
        lastError = result.error;
        console.error("[groq] chat completion error", {
          ...result.error,
        });

        if (result.error.type === "rate_limit" || result.error.type === "quota_exceeded") {
          break;
        }
      }
    }
  }

  return { content: null, error: lastError ?? { type: "unknown" } };
};

export type GroqModelInfo = {
  id: string;
  description?: string | null;
  ownedBy?: string | null;
  active?: boolean;
};

export const listGroqModels = async (
  keys: string[],
): Promise<{ models: GroqModelInfo[]; error?: GroqChatErrorInfo; rateLimitRemaining?: number | null }> => {
  const resolved = resolveApiKeys(keys);
  if (resolved.length === 0) {
    return {
      models: [],
      error: { type: "no_keys", message: "Nenhuma chave Groq configurada." },
    };
  }

  let lastError: GroqChatErrorInfo | undefined;

  for (const key of resolved) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (!response.ok) {
        const errorInfo = await parseErrorResponse(response, "models", key);
        if (errorInfo.type === "rate_limit" || errorInfo.type === "quota_exceeded") {
          return { models: [], error: errorInfo, rateLimitRemaining: 0 };
        }
        lastError = errorInfo;
        console.error("[groq] models fetch error", errorInfo);
        continue;
      }

      const payload: any = await response.json().catch(() => null);
      const list: any[] = Array.isArray(payload?.data) ? payload.data : [];
      const rateHeader = response.headers.get("x-ratelimit-remaining");
      const rateLimitRemaining = rateHeader ? Number.parseInt(rateHeader, 10) : null;

      const models: GroqModelInfo[] = list
        .map((entry) => {
          const id = typeof entry?.id === "string" ? entry.id.trim() : "";
          if (!id) {
            return null;
          }
          const description =
            typeof entry?.description === "string"
              ? entry.description.trim()
              : typeof entry?.meta?.description === "string"
                ? entry.meta.description.trim()
                : null;
          const ownedBy =
            typeof entry?.owned_by === "string"
              ? entry.owned_by.trim()
              : typeof entry?.owner === "string"
                ? entry.owner.trim()
                : null;
          const active =
            typeof entry?.active === "boolean"
              ? entry.active
              : typeof entry?.status === "string"
                ? entry.status.toLowerCase() === "active"
                : undefined;
          return { id, description, ownedBy, active } satisfies GroqModelInfo;
        })
        .filter((entry): entry is GroqModelInfo => Boolean(entry));

      return {
        models,
        rateLimitRemaining: Number.isFinite(rateLimitRemaining) ? Number(rateLimitRemaining) : null,
      };
    } catch (error) {
      lastError = {
        type: "network",
        message: error instanceof Error ? error.message : "Falha ao consultar modelos Groq.",
        key: maskApiKey(key),
        model: "models",
      };
      console.error("[groq] models fetch error", lastError);
    }
  }

  return {
    models: [],
    error: lastError ?? { type: "unknown", message: "Não foi possível listar os modelos Groq." },
  };
};
