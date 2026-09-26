export type BotInterageChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export type BotInterageChatOptions = {
  baseUrl: string;
  token: string;
  model: string;
  messages: BotInterageChatMessage[];
  tools?: BotInterageToolDefinition[];
  temperature?: number;
  timeoutMs?: number;
};

export type BotInterageToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type BotInterageToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type BotInterageChatErrorInfo = {
  type:
    | "invalid_auth"
    | "rate_limit"
    | "quota_exceeded"
    | "invalid_request"
    | "network"
    | "unavailable"
    | "unknown";
  status?: number;
  message?: string;
};

export type BotInterageChatResult = {
  content: string | null;
  toolCalls?: BotInterageToolCall[];
  /** Structured files/media returned by providers that support artifacts. */
  artifacts?: BotInterageArtifact[];
  error?: BotInterageChatErrorInfo;
};

export type BotInterageArtifact = {
  url?: string | null;
  path?: string | null;
  base64?: string | null;
  dataUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  name?: string | null;
};

export type BotInterageAudioTranscriptionOptions = {
  baseUrl: string;
  token: string;
  audioBase64: string;
  mimeType?: string;
  filename?: string;
  language?: string;
  timeoutMs?: number;
};

export type BotInterageAudioTranscriptionResult = {
  text: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  error?: BotInterageChatErrorInfo;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEMPERATURE = 0;

const trimUrl = (value: string) => value.replace(/\/+$/, "");

const botInterageV1Endpoint = (baseUrl: string, path: string): string => {
  const base = trimUrl(baseUrl);
  return base.endsWith("/v1") ? `${base}${path}` : `${base}/v1${path}`;
};

const extractTextContent = (payload: any): string | null => {
  const direct = payload?.choices?.[0]?.message?.content ?? payload?.message?.content;
  if (typeof direct === "string") {
    const trimmed = direct.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(direct)) {
    const joined = direct
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n")
      .trim();
    return joined.length > 0 ? joined : null;
  }

  const fallback = payload?.response;
  if (typeof fallback === "string") {
    const trimmed = fallback.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
};

const parseToolArguments = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
};

const extractToolCalls = (payload: any): BotInterageToolCall[] => {
  const calls = payload?.choices?.[0]?.message?.tool_calls ?? payload?.message?.tool_calls;
  if (!Array.isArray(calls)) {
    return [];
  }

  return calls
    .map((call: any): BotInterageToolCall | null => {
      const name = call?.function?.name;
      if (typeof name !== "string" || !name.trim()) {
        return null;
      }
      return {
        id: typeof call?.id === "string" && call.id.trim() ? call.id.trim() : `tool_call_${Math.random().toString(36).slice(2)}`,
        name: name.trim(),
        arguments: parseToolArguments(call?.function?.arguments),
      };
    })
    .filter((call): call is BotInterageToolCall => call !== null);
};

const extractArtifacts = (payload: any): BotInterageArtifact[] => {
  const found: BotInterageArtifact[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const source = ["dataUrl", "data_url", "base64", "b64_json", "url", "path"]
      .map((key) => typeof record[key] === "string" ? String(record[key]).trim() : "")
      .find(Boolean);
    const mimeType = typeof record.mimeType === "string"
      ? record.mimeType
      : typeof record.mime_type === "string"
        ? record.mime_type
        : typeof record.mime === "string" ? record.mime : null;
    const fileName = typeof record.fileName === "string"
      ? record.fileName
      : typeof record.filename === "string"
        ? record.filename
        : typeof record.name === "string" ? record.name : null;
    if (source && (mimeType || fileName || /\.(?:pdf|docx?|xlsx?|csv|txt|png|jpe?g|webp|gif|mp4|webm|mp3|wav)(?:[?#]|$)/i.test(source))) {
      const artifact: BotInterageArtifact = {
        url: typeof record.url === "string" ? record.url : null,
        path: typeof record.path === "string" ? record.path : null,
        base64: typeof record.base64 === "string" ? record.base64 : typeof record.b64_json === "string" ? record.b64_json : null,
        dataUrl: typeof record.dataUrl === "string" ? record.dataUrl : typeof record.data_url === "string" ? record.data_url : null,
        mimeType,
        fileName,
        name: typeof record.name === "string" ? record.name : null,
      };
      const key = `${artifact.mimeType || ""}:${artifact.fileName || artifact.name || ""}:${source.slice(0, 240)}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push(artifact);
      }
    }
    for (const key of ["artifacts", "attachments", "files", "file", "media", "images", "videos", "audio", "outputs", "output", "result", "response", "data", "content"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  };
  visit(payload);
  return found;
};

const parseErrorResponse = async (response: Response): Promise<BotInterageChatErrorInfo> => {
  let rawText = "";
  let parsed: any = null;

  try {
    rawText = await response.text();
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    /* ignore */
  }

  const message =
    parsed?.error?.message ||
    parsed?.message ||
    rawText ||
    response.statusText ||
    "Erro desconhecido ao consultar a API privada do BotInterage.";

  if (response.status === 401 || response.status === 403) {
    return { type: "invalid_auth", status: response.status, message };
  }

  if (response.status === 429) {
    return { type: "rate_limit", status: response.status, message };
  }

  if (response.status === 402) {
    return { type: "quota_exceeded", status: response.status, message };
  }

  if (response.status >= 500) {
    return { type: "unavailable", status: response.status, message };
  }

  return { type: "invalid_request", status: response.status, message };
};

export const createBotInterageChatCompletion = async (
  options: BotInterageChatOptions,
): Promise<BotInterageChatResult> => {
  const baseUrl = trimUrl(options.baseUrl || "");
  const token = (options.token || "").trim();
  const model = (options.model || "").trim();

  if (!baseUrl || !token || !model) {
    return {
      content: null,
      error: {
        type: "invalid_request",
        message: "Configuração da API privada do BotInterage incompleta.",
      },
    };
  }

  const endpoint = botInterageV1Endpoint(baseUrl, "/chat/completions");
  let lastError: BotInterageChatErrorInfo | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: options.messages,
          ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
          stream: false,
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        }),
      });
      if (response.ok) {
        const payload: any = await response.json().catch(() => null);
        return {
          content: extractTextContent(payload),
          toolCalls: extractToolCalls(payload),
          artifacts: extractArtifacts(payload),
        };
      }
      const parsed = await parseErrorResponse(response);
      lastError = parsed;
      const retryable = parsed.type === "unavailable" || parsed.type === "rate_limit";
      if (!retryable || attempt === 2) return { content: null, error: parsed };
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    } catch (error) {
      lastError = {
        type: "network",
        message: error instanceof Error ? error.message : "Falha de rede na API do BotInterage.",
      };
      if (attempt === 2) return { content: null, error: lastError };
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  return { content: null, error: lastError ?? { type: "unknown", message: "Falha na API do BotInterage." } };
};

/**
 * Envia uma nota de voz ao módulo ChatGPT Sistema. O módulo cria um job próprio
 * e esta função só acompanha o estado dele; assim o consumidor do WhatsApp não
 * fica preso esperando a transcrição terminar.
 */
export const transcribeBotInterageAudio = async (
  options: BotInterageAudioTranscriptionOptions,
): Promise<BotInterageAudioTranscriptionResult> => {
  const baseUrl = trimUrl(options.baseUrl || "");
  const token = (options.token || "").trim();
  const audioBase64 = (options.audioBase64 || "").trim();
  if (!baseUrl || !token || !audioBase64) {
    return {
      text: null,
      error: {
        type: "invalid_request",
        message: "Configuração ou áudio da transcrição está incompleto.",
      },
    };
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `botinterage-audio-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
  const extractResult = (payload: any): BotInterageAudioTranscriptionResult => {
    const text = typeof payload?.text === "string"
      ? payload.text.trim()
      : typeof payload?.answer === "string"
        ? payload.answer.trim()
        : typeof payload?.result?.text === "string"
          ? payload.result.text.trim()
          : typeof payload?.result?.answer === "string"
            ? payload.result.answer.trim()
            : "";
    return {
      text: text || null,
      conversationId:
        payload?.conversation_id ?? payload?.conversationId ?? payload?.result?.conversation_id ?? null,
      messageId: payload?.message_id ?? payload?.messageId ?? payload?.result?.message_id ?? null,
    };
  };

  try {
    const response = await fetch(`${botInterageV1Endpoint(baseUrl, "/audio/transcriptions")}?async=true`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        audio_base64: audioBase64,
        mime_type: options.mimeType || "audio/ogg",
        filename: options.filename || "whatsapp-audio.ogg",
        ...(options.language?.trim() ? { language: options.language.trim() } : {}),
      }),
    });
    if (!response.ok) {
      return { text: null, error: await parseErrorResponse(response) };
    }
    let payload: any = await response.json().catch(() => null);
    const immediate = extractResult(payload);
    if (immediate.text) return immediate;

    const jobId = typeof payload?.job_id === "string" ? payload.job_id.trim() : "";
    if (!jobId) {
      return {
        text: null,
        error: { type: "invalid_request", message: "O módulo não retornou a transcrição nem o identificador do job." },
      };
    }

    const jobEndpoint = botInterageV1Endpoint(baseUrl, `/jobs/${encodeURIComponent(jobId)}`);
    while (!controller.signal.aborted) {
      await new Promise<void>((resolve) => setTimeout(resolve, 750));
      const jobResponse = await fetch(jobEndpoint, {
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
        signal: controller.signal,
      });
      if (!jobResponse.ok) return { text: null, error: await parseErrorResponse(jobResponse) };
      payload = await jobResponse.json().catch(() => null);
      const status = String(payload?.status || "").toLowerCase();
      const result = extractResult(payload);
      if (status === "completed" || status === "complete" || status === "succeeded") {
        return result.text
          ? result
          : { text: null, error: { type: "unknown", message: "A transcrição terminou sem texto." } };
      }
      if (status === "failed" || status === "cancelled" || status === "canceled" || status === "expired") {
        return {
          text: null,
          error: {
            type: "unavailable",
            message: String(payload?.error?.message || payload?.error_message || "O job de transcrição não foi concluído."),
          },
        };
      }
    }
    return { text: null, error: { type: "network", message: "Tempo limite da transcrição excedido." } };
  } catch (error) {
    return {
      text: null,
      error: {
        type: "network",
        message: error instanceof Error ? error.message : "Falha de rede ao transcrever o áudio.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};
