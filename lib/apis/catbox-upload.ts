import axios from "axios";
import FormData from "form-data";
import path from "path";

export type CatboxUploadParams = {
  buffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
  timeoutMs?: number;
};

export type CatboxUploadResult = {
  url: string;
};

const CATBOX_UPLOAD_URL = "https://catbox.moe/user/api.php";
const DEFAULT_TIMEOUT_MS = 60_000;

const pickExtensionFromMime = (mimeType: string | null | undefined): string => {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  if (normalized.includes("png")) return ".png";
  if (normalized.includes("webp")) return ".webp";
  if (normalized.includes("gif")) return ".gif";
  if (normalized.includes("mp4")) return ".mp4";
  if (normalized.includes("mp3")) return ".mp3";
  if (normalized.includes("ogg")) return ".ogg";
  if (normalized.includes("pdf")) return ".pdf";
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

const normalizeCatboxResponse = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim();
  }
  if (value == null) {
    return "";
  }
  return String(value).trim();
};

export const uploadBufferToCatbox = async (params: CatboxUploadParams): Promise<CatboxUploadResult> => {
  if (!Buffer.isBuffer(params.buffer) || params.buffer.length === 0) {
    throw new Error("Arquivo inválido para upload.");
  }

  const mimeType = (params.mimeType || "").trim() || "application/octet-stream";
  const fileName = normalizeFileName(params.fileName, mimeType);
  const userhash = (process.env.CATBOX_USERHASH || "").trim();

  const form = new FormData();
  form.append("reqtype", "fileupload");
  if (userhash) {
    form.append("userhash", userhash);
  }
  form.append("fileToUpload", params.buffer, {
    filename: fileName,
    contentType: mimeType,
  });

  const response = await axios.post(CATBOX_UPLOAD_URL, form, {
    headers: {
      ...form.getHeaders(),
      "User-Agent": "Mozilla/5.0 (BotAdmin Catbox Upload)",
    },
    timeout:
      Number.isFinite(params.timeoutMs) && (params.timeoutMs as number) > 0
        ? Number(params.timeoutMs)
        : DEFAULT_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
    responseType: "text",
  });

  const body = normalizeCatboxResponse(response.data);
  if (/^https?:\/\/\S+$/i.test(body)) {
    return { url: body };
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      body
        ? `Falha no upload para Catbox (${response.status}): ${body}`
        : `Falha no upload para Catbox (${response.status}).`,
    );
  }

  if (!body) {
    throw new Error("Catbox retornou uma resposta vazia.");
  }
  if (body.toUpperCase().startsWith("ERROR")) {
    throw new Error(body);
  }
  throw new Error(`Resposta inesperada do Catbox: ${body}`);
};
