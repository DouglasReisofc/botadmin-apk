import axios from "axios";
import FormData from "form-data";
import path from "path";

export type TelegraphUploadParams = {
  buffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
  timeoutMs?: number;
};

export type TelegraphUploadResult = {
  url: string;
  src: string;
};

const TELEGRAPH_UPLOAD_URL = "https://telegra.ph/upload";
const DEFAULT_TIMEOUT_MS = 60_000;

const normalizeSrc = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.startsWith("/")) return null;
  return `https://telegra.ph${trimmed}`;
};

const pickExtensionFromMime = (mimeType: string | null | undefined): string => {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  if (normalized.includes("png")) return ".png";
  if (normalized.includes("webp")) return ".webp";
  if (normalized.includes("gif")) return ".gif";
  if (normalized.includes("mp4")) return ".mp4";
  if (normalized.includes("heic")) return ".heic";
  return ".bin";
};

const normalizeFileName = (fileName: string | null | undefined, mimeType: string | null | undefined): string => {
  const cleaned = (fileName || "").trim().replace(/[^\w.\-]+/g, "_");
  if (!cleaned) {
    return `upload_${Date.now()}${pickExtensionFromMime(mimeType)}`;
  }

  const ext = path.extname(cleaned);
  if (ext) return cleaned;
  return `${cleaned}${pickExtensionFromMime(mimeType)}`;
};

export const uploadBufferToTelegraph = async (params: TelegraphUploadParams): Promise<TelegraphUploadResult> => {
  if (!Buffer.isBuffer(params.buffer) || params.buffer.length === 0) {
    throw new Error("Arquivo inválido para upload.");
  }

  const form = new FormData();
  const mimeType = (params.mimeType || "").trim() || "application/octet-stream";
  const fileName = normalizeFileName(params.fileName, mimeType);

  form.append("file", params.buffer, {
    filename: fileName,
    contentType: mimeType,
  });

  const response = await axios.post(TELEGRAPH_UPLOAD_URL, form, {
    headers: {
      ...form.getHeaders(),
      "User-Agent": "Mozilla/5.0 (BotAdmin Telegraph Upload)",
    },
    timeout: Number.isFinite(params.timeoutMs) && (params.timeoutMs as number) > 0
      ? Number(params.timeoutMs)
      : DEFAULT_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const rawData = response.data;
    const detailFromString =
      typeof rawData === "string"
        ? rawData.replace(/^"+|"+$/g, "").trim()
        : null;
    const detailFromObject =
      rawData && typeof rawData === "object" && typeof (rawData as any).error === "string"
        ? String((rawData as any).error).trim()
        : null;
    const detail = detailFromString || detailFromObject;
    throw new Error(
      detail
        ? `Falha no upload para telegra.ph (${response.status}): ${detail}`
        : `Falha no upload para telegra.ph (${response.status}).`,
    );
  }

  if (!Array.isArray(response.data) || response.data.length === 0) {
    throw new Error("Resposta inesperada do telegra.ph.");
  }

  const firstEntry = response.data[0] as Record<string, unknown>;
  const srcValue = typeof firstEntry?.src === "string" ? firstEntry.src : null;
  const fullUrl = normalizeSrc(srcValue);

  if (!srcValue || !fullUrl) {
    const errorMessage =
      typeof firstEntry?.error === "string"
        ? firstEntry.error.trim()
        : "Telegra.ph não retornou a URL do arquivo.";
    throw new Error(errorMessage || "Telegra.ph não retornou a URL do arquivo.");
  }

  return {
    url: fullUrl,
    src: srcValue,
  };
};
