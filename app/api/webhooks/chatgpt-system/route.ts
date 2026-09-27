import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getBotInterageRuntimeConfig } from "lib/admin-botinterage-config";
import {
  claimBotInterageSystemJob,
  completeBotInterageSystemJob,
  getBotInterageSystemConversation,
  getBotInterageSystemJob,
  isBotInterageSystemJobSuperseded,
  botInterageGroupConversationKey,
  saveBotInterageSystemConversation,
  submitBotInterageSystemAskJob,
} from "lib/botinterage-system";
import {
  isNaturalBotAdminMcpRequest,
  executeBotAdminMcpTool,
  recordBotInterageContextEvent,
  resolveBotAdminMcpContext,
} from "lib/chatgpt-phone";
import { createBotInterageChatCompletion } from "lib/apis/botinterage";
import { getInstanceForUser } from "lib/bot-instances";
import { getGroupSettings } from "lib/bot-group-settings";
import { getBotInterageTtsRuntimeConfig } from "lib/admin-botinterage-tts-config";
import {
  acknowledgeInternalBotFailure,
  dispatchInternalGroupAutomationMessage,
} from "lib/internal-groups";
import { saveBufferAsUploadedFile } from "lib/uploads";
import {
  sendMediaMessage,
  sendReactionMessage,
  sendTextMessage,
  type WuzapiClient,
} from "lib/wuzapi";

export const runtime = "nodejs";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const secureEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const verifySignature = (params: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
}): boolean => {
  if (!params.timestamp || !params.signature || !params.signature.startsWith("v1=")) {
    return false;
  }
  const timestamp = Number.parseInt(params.timestamp, 10);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }
  const expected = createHmac("sha256", params.secret)
    .update(`${params.timestamp}.${params.rawBody}`)
    .digest("hex");
  return secureEqual(params.signature.slice(3), expected);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const collectImageUrls = (value: unknown, depth = 0): string[] => {
  if (depth > 4 || value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectImageUrls(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return [];
  const urls: string[] = [];
  for (const key of ["url", "image_url", "download_url", "signed_url"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && /^https:\/\//i.test(candidate.trim())) {
      urls.push(candidate.trim());
    }
  }
  for (const key of ["images", "image", "data", "items", "result", "artifacts"]) {
    urls.push(...collectImageUrls(record[key], depth + 1));
  }
  return Array.from(new Set(urls));
};

type GeneratedMediaDescriptor = {
  url?: string;
  base64?: string;
  textContent?: string;
  mimeType?: string;
  fileName?: string;
};

const MEDIA_URL_KEYS = [
  "url", "image_url", "download_url", "signed_url", "content_url", "contentUrl",
  "original_content_url", "originalContentUrl", "original_url", "originalUrl",
  "file_url", "fileUrl", "media_url", "mediaUrl",
];

const MEDIA_BASE64_KEYS = ["data_url", "dataUrl", "b64_json", "base64"];

const collectGeneratedMedia = (value: unknown, depth = 0): GeneratedMediaDescriptor[] => {
  if (depth > 8 || value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectGeneratedMedia(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return [];
  const url = MEDIA_URL_KEYS
    .map((key) => record[key])
    .find((candidate): candidate is string =>
      typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim()),
    )?.trim();
  const base64 = MEDIA_BASE64_KEYS
    .map((key) => record[key])
    .find((candidate): candidate is string =>
      typeof candidate === "string" &&
      (candidate.trim().startsWith("data:") || candidate.trim().length > 100),
    )?.trim();
  const explicitTextContent = ["html", "html_content", "htmlContent", "text_content", "textContent", "content"]
    .map((key) => record[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  const mimeType = ["mime_type", "mimeType", "content_type", "contentType", "media_type", "mediaType", "type"]
    .map((key) => record[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
    ?.trim();
  const fileName = ["file_name", "fileName", "filename", "name", "title"]
    .map((key) => record[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
    ?.trim();
  const looksLikeHtml = /(^\s*<!doctype\s+html\b|^\s*<html[\s>]|^\s*<head[\s>]|^\s*<body[\s>])/i.test(explicitTextContent || "");
  const htmlFile = /\.html?$/i.test(fileName || "") || /text\/html/i.test(mimeType || "") || looksLikeHtml;
  const own = (url || base64 || (htmlFile && explicitTextContent)) && (mimeType || fileName || url || base64 || explicitTextContent)
    ? [{ url, base64, textContent: htmlFile ? explicitTextContent : undefined, mimeType: htmlFile ? (mimeType || "text/html") : mimeType, fileName: htmlFile ? (fileName || `botinterage-${Date.now()}.html`) : fileName }]
    : [];
  const nested = Object.entries(record)
    .filter(([key]) => !MEDIA_BASE64_KEYS.includes(key))
    .flatMap(([, child]) => collectGeneratedMedia(child, depth + 1));
  const seen = new Set<string>();
  return [...own, ...nested].filter((entry) => {
    const identity = entry.url || entry.base64?.slice(0, 96) || "";
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const normalizeMediaMime = (mimeType?: string, fileName?: string): string => {
  const declared = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;
  const name = String(fileName || "").toLowerCase();
  if (/\.gif(?:$|[?#])/.test(name)) return "image/gif";
  if (/\.(?:jpe?g)(?:$|[?#])/.test(name)) return "image/jpeg";
  if (/\.png(?:$|[?#])/.test(name)) return "image/png";
  if (/\.webp(?:$|[?#])/.test(name)) return "image/webp";
  if (/\.mp4(?:$|[?#])/.test(name)) return "video/mp4";
  if (/\.(?:mp3|mpeg)(?:$|[?#])/.test(name)) return "audio/mpeg";
  if (/\.pdf(?:$|[?#])/.test(name)) return "application/pdf";
  if (/\.html?(?:$|[?#])/.test(name)) return "text/html";
  return declared || "application/octet-stream";
};

const mediaTypeForMime = (mimeType: string): "image" | "video" | "audio" | "document" => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
};

const extractInlineHtml = (value: string | null): string | null => {
  if (!value) return null;
  const match = value.match(/^\s*(?:```html?\s*)?((?:<!doctype\s+html\b|<html[\s>])[^]*?)(?:\s*```)?\s*$/i);
  return match?.[1]?.trim() || null;
};

const getString = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

// Answers are user-visible ChatGPT output. Preserve their whitespace/content;
// trimming is used only to decide whether the value is empty.
const getExactString = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const refreshConversationImages = async (
  conversationId: string,
  createdAfter?: Date | null,
): Promise<string[]> => {
  const config = await getBotInterageRuntimeConfig();
  if (!config.baseUrl || !config.token) return [];
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const prefix = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const endpoint = `${prefix}/conversations/${encodeURIComponent(conversationId)}/images?limit=5`;
  // The native client can index the generated asset a few seconds after the
  // assistant stream has already completed. Keep this reconciliation window
  // bounded, but long enough to catch the artifact before the library/API
  // evicts or hides its temporary reference.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (!createdAfter) return collectImageUrls(payload);
        const items = asRecord(payload)?.items;
        if (!Array.isArray(items)) return [];
        const cutoffSeconds = createdAfter.getTime() / 1_000 - 5;
        return Array.from(new Set(items.flatMap((entry) => {
          const image = asRecord(entry);
          if (!image) return [];
          const createdAt = Number(image.created_at ?? image.createdAt ?? 0);
          if (Number.isFinite(createdAt) && createdAt > 0 && createdAt < cutoffSeconds) {
            return [];
          }
          return collectImageUrls(image);
        })));
      }
      if (!TRANSIENT_HTTP_STATUSES.has(response.status)) return [];
      await response.arrayBuffer().catch(() => undefined);
    } catch {
      // A próxima tentativa também cobre falha de DNS, túnel e timeout.
    }
    if (attempt < 7) await wait(Math.min(1_500, 500 * (attempt + 1)));
  }
  return [];
};

const downloadImage = async (
  url: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "image/*", "User-Agent": "BotAdmin/1.0" },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Falha ao baixar imagem: HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error("Imagem excede 25 MB.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error("Imagem vazia ou maior que 25 MB.");
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    const extension = mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("jpeg")
        ? "jpg"
        : "png";
    return { buffer, mimeType, filename: `chatgpt-${Date.now()}.${extension}` };
  } finally {
    clearTimeout(timeout);
  }
};

const downloadImageWithRetry = async (
  url: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await downloadImage(url);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(750 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao baixar imagem gerada.");
};

const downloadGeneratedMedia = async (
  descriptor: GeneratedMediaDescriptor,
  authorizationToken?: string | null,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> => {
  const rawBase64 = descriptor.base64?.trim() || "";
  const rawTextContent = descriptor.textContent ?? "";
  if (rawTextContent) {
    const mimeType = normalizeMediaMime(descriptor.mimeType || "text/html", descriptor.fileName || "arquivo.html");
    return {
      buffer: Buffer.from(rawTextContent, "utf8"),
      mimeType,
      filename: descriptor.fileName || `botinterage-${Date.now()}.html`,
    };
  }
  if (rawBase64) {
    const dataMatch = rawBase64.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]+)$/i);
    const mimeType = normalizeMediaMime(dataMatch?.[1] || descriptor.mimeType, descriptor.fileName);
    const encoded = dataMatch?.[2] || rawBase64;
    const buffer = Buffer.from(encoded.replace(/\s+/g, ""), dataMatch?.[2] ? "base64" : "base64");
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error("Arquivo gerado vazio ou maior que 25 MB.");
    return {
      buffer,
      mimeType,
      filename: descriptor.fileName || `botinterage-${Date.now()}.${mimeType.split("/")[1] || "bin"}`,
    };
  }
  if (!descriptor.url) throw new Error("Artefato sem URL ou conteúdo.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(descriptor.url, {
      signal: controller.signal,
      headers: {
        Accept: "*/*",
        "User-Agent": "BotAdmin/1.0",
        ...(authorizationToken ? { Authorization: `Bearer ${authorizationToken}` } : {}),
        ...(authorizationToken ? { "x-api-key": authorizationToken } : {}),
        ...(authorizationToken ? { "x-api-token": authorizationToken } : {}),
      },
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Falha ao baixar artefato: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error("Arquivo gerado vazio ou maior que 25 MB.");
    const mimeType = normalizeMediaMime(response.headers.get("content-type") || descriptor.mimeType, descriptor.fileName || descriptor.url);
    let filename = descriptor.fileName || "";
    if (!filename) {
      try { filename = new URL(descriptor.url).pathname.split("/").filter(Boolean).pop() || ""; } catch { /* ignore */ }
    }
    if (!filename) filename = `botinterage-${Date.now()}.${mimeType.split("/")[1] || "bin"}`;
    return { buffer, mimeType, filename };
  } finally {
    clearTimeout(timeout);
  }
};

const downloadGeneratedMediaWithRetry = async (
  descriptor: GeneratedMediaDescriptor,
  authorizationTokens: Array<string | null | undefined> = [],
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> => {
  let lastError: unknown = null;
  const tokens = Array.from(new Set(authorizationTokens.filter((token): token is string => Boolean(token?.trim())).map((token) => token.trim())));
  for (const token of [...tokens, null]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await downloadGeneratedMedia(descriptor, token); }
      catch (error) {
        lastError = error;
        if (attempt < 2) await wait(750 * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao baixar artefato gerado.");
};

const prepareGeneratedImages = async (params: {
  imageUrls: string[];
  conversationId: string | null;
  createdAfter?: Date | null;
}): Promise<Array<{ buffer: Buffer; mimeType: string; filename: string }>> => {
  const firstUrls = params.imageUrls.slice(0, 4);
  try {
    return await Promise.all(firstUrls.map(downloadImageWithRetry));
  } catch (initialError) {
    if (!params.conversationId) throw initialError;
    const refreshedUrls = await refreshConversationImages(
      params.conversationId,
      params.createdAfter,
    );
    if (refreshedUrls.length === 0) throw initialError;
    return await Promise.all(refreshedUrls.slice(0, 4).map(downloadImageWithRetry));
  }
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const config = await getBotInterageRuntimeConfig();
  if (!config.webhookSecret) {
    return NextResponse.json({ message: "Webhook não configurado." }, { status: 503 });
  }
  if (
    !verifySignature({
      rawBody,
      timestamp: request.headers.get("x-webhook-timestamp"),
      signature: request.headers.get("x-webhook-signature"),
      secret: config.webhookSecret,
    })
  ) {
    return NextResponse.json({ message: "Assinatura inválida." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
  }

  const event = getString(payload, "event");
  const eventId = getString(payload, "event_id") || request.headers.get("x-event-id") || "";
  if (event === "webhook.test") {
    return NextResponse.json({ ok: true, event });
  }
  if (event !== "job.completed" && event !== "job.failed") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const data = asRecord(payload.data);
  const jobId = getString(data, "job_id");
  if (!jobId || !eventId) {
    return NextResponse.json({ message: "Evento sem job_id/event_id." }, { status: 400 });
  }

  const claim = await claimBotInterageSystemJob({ jobId, eventId });
  if (claim === "missing") {
    return NextResponse.json({ message: "Job ainda não correlacionado." }, { status: 503 });
  }
  if (claim === "busy") {
    return NextResponse.json({ message: "Job em processamento." }, { status: 409 });
  }
  if (claim === "delivered") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const job = await getBotInterageSystemJob(jobId);
  if (!job) {
    return NextResponse.json({ message: "Job não encontrado." }, { status: 503 });
  }
  if (await isBotInterageSystemJobSuperseded(jobId)) {
    await completeBotInterageSystemJob({
      jobId,
      status: "failed",
      error: "Resposta descartada porque existe uma solicitação mais nova para este grupo.",
    });
    return NextResponse.json({ ok: true, superseded: true });
  }

  try {
    const failedResult = asRecord(data?.result);
    const jobType = getString(data, "type") || getString(failedResult, "type");
    const isAudioJob = jobType === "audio_ask" || jobType === "audio_transcription" ||
      jobType === "native_audio_ask" || jobType === "native_audio_transcription";
    // `/v1/ask` is the general multimodal BotInterage contract. It is not an
    // image or video-only job: the result may contain text and any artifacts
    // returned by the assistant.
    const isInternalDelivery = Boolean(job.internalGroupId);
    const internalMemberId = Number(job.senderJid.match(/^botadmin-user:(\d+)$/)?.[1] ?? 0) || null;
    let client: WuzapiClient | null = null;
    let quoted: { stanzaId: string; participant: string } | undefined;
    if (!isInternalDelivery) {
      const instance = await getInstanceForUser(job.userId, job.instanceId);
      if (!instance?.serverBaseUrl || !instance.token) {
        throw new Error("Perfil do WhatsApp indisponível.");
      }
      client = {
        baseUrl: instance.serverBaseUrl.replace(/\/+$/, ""),
        token: instance.token,
        conversation: {
          userId: job.userId,
          instanceId: job.instanceId,
          instanceName: instance.name,
          instancePhone: instance.phone,
        },
      };
      quoted = job.whatsappMessageId
        ? { stanzaId: job.whatsappMessageId, participant: job.senderJid }
        : undefined;
    }

    const sendJobText = async (body: string): Promise<string> => {
      if (isInternalDelivery) {
        const messageId = await dispatchInternalGroupAutomationMessage(
          job.groupId,
          body,
          undefined,
          {
            replyToMessageId: job.internalMessageId,
            mentionedUserIds: internalMemberId ? [internalMemberId] : [],
          },
        );
        if (!messageId) throw new Error("Grupo BotAdmin não está disponível para receber a resposta.");
        return String(messageId);
      }
      // Jobs returned by the native audio/multimodal module bypass the regular
      // message-handler voice branch. Respect the group voice toggle here too,
      // otherwise an enabled BotInterage voice silently falls back to text.
      try {
        const settings = await getGroupSettings(job.groupId);
        const voiceEnabled =
          settings.commandToggles.vozbotinterage === true ||
          settings.featureFlags.botInterageVoice === true;
        const ttsRuntime = voiceEnabled ? await getBotInterageTtsRuntimeConfig() : null;
        const voiceId = settings.aiVoice?.trim() || ttsRuntime?.defaultVoiceId?.trim() || "";
        if (client && voiceEnabled && ttsRuntime?.enabled && ttsRuntime.baseUrl && ttsRuntime.token && voiceId) {
          const base = new URL(ttsRuntime.baseUrl);
          const path = base.pathname.replace(/\/+$/, "");
          base.pathname = path.endsWith("/v1/tts") ? path : `${path || ""}/v1/tts`;
          base.search = "";
          const response = await fetch(base.toString(), {
            method: "POST",
            headers: {
              accept: "audio/mpeg,audio/wav,application/octet-stream",
              authorization: `Bearer ${ttsRuntime.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ text: body, voice_id: voiceId, format: "mp3", streaming: false }),
            signal: AbortSignal.timeout(30_000),
          });
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > 0) {
              const messageId = await sendMediaMessage(client, {
                to: job.chatId,
                media: buffer,
                mediaType: "audio",
                mimeType: response.headers.get("content-type")?.split(";")[0] || "audio/mpeg",
                filename: `botinterage-${Date.now()}.mp3`,
                quoted,
              });
              if (messageId) {
                console.info("[botinterage-system-webhook] resposta TTS enviada", {
                  groupId: job.groupId,
                  jobId,
                  voiceId,
                });
                return messageId;
              }
            }
          } else {
            console.warn("[botinterage-system-webhook] TTS retornou erro; usando texto", {
              groupId: job.groupId,
              jobId,
              status: response.status,
            });
          }
        }
      } catch (error) {
        console.warn("[botinterage-system-webhook] falha no TTS; usando texto", {
          groupId: job.groupId,
          jobId,
          error,
        });
      }
      const messageId = await sendTextMessage(client!, { to: job.chatId, body, quoted });
      if (!messageId) throw new Error("WhatsApp não retornou o ID da resposta de texto.");
      return messageId;
    };

    const sendJobImage = async (
      image: { buffer: Buffer; mimeType: string; filename: string },
      caption?: string,
      quoteOriginal = false,
    ): Promise<string> => {
      if (isInternalDelivery) {
        const storedPath = await saveBufferAsUploadedFile(
          image.buffer,
          `internal-groups/${job.internalGroupId}/botinterage`,
          { fixedFileName: image.filename },
        );
        const messageId = await dispatchInternalGroupAutomationMessage(
          job.groupId,
          null,
          {
            mediaType: "image",
            path: storedPath,
            mimeType: image.mimeType,
            fileName: image.filename,
            caption: caption ?? null,
          },
          {
            replyToMessageId: quoteOriginal ? job.internalMessageId : null,
            mentionedUserIds: internalMemberId ? [internalMemberId] : [],
          },
        );
        if (!messageId) throw new Error("Grupo BotAdmin não está disponível para receber a imagem.");
        return String(messageId);
      }
      const messageId = await sendMediaMessage(client!, {
        to: job.chatId,
        media: image.buffer,
        mediaType: "image",
        mimeType: image.mimeType,
        filename: image.filename,
        caption,
        quoted: quoteOriginal ? quoted : undefined,
      });
      if (!messageId) throw new Error("WhatsApp não retornou o ID da imagem gerada.");
      return messageId;
    };

    const sendJobMedia = async (
      media: { buffer: Buffer; mimeType: string; filename: string },
      caption?: string,
      quoteOriginal = false,
    ): Promise<string> => {
      const mediaType = mediaTypeForMime(media.mimeType);
      const isGif = media.mimeType === "image/gif" || /\.gif$/i.test(media.filename);
      if (isInternalDelivery) {
        const storedPath = await saveBufferAsUploadedFile(
          media.buffer,
          `internal-groups/${job.internalGroupId}/botinterage`,
          { fixedFileName: media.filename },
        );
        const messageId = await dispatchInternalGroupAutomationMessage(
          job.groupId,
          null,
          {
            mediaType,
            path: storedPath,
            mimeType: media.mimeType,
            fileName: media.filename,
            caption: caption ?? null,
          },
          {
            replyToMessageId: quoteOriginal ? job.internalMessageId : null,
            mentionedUserIds: internalMemberId ? [internalMemberId] : [],
          },
        );
        if (!messageId) throw new Error("Grupo BotAdmin não está disponível para receber o arquivo.");
        return String(messageId);
      }
      const messageId = await sendMediaMessage(client!, {
        to: job.chatId,
        media: media.buffer,
        mediaType,
        mimeType: media.mimeType,
        filename: media.filename,
        caption,
        gifPlayback: isGif,
        isAnimated: isGif,
        quoted: quoteOriginal ? quoted : undefined,
      });
      if (!messageId) throw new Error("WhatsApp não retornou o ID do arquivo gerado.");
      return messageId;
    };

    const handleAudioBotAdminToolRequest = async (transcription: string): Promise<boolean> => {
      const raffleIntent = /\b(?:sorteio|enquete|ganhador(?:es)?|pr[eê]mio|participar|pix)\b/i.test(transcription);
      if (!isAudioJob || !raffleIntent || !transcription.trim() || isInternalDelivery) return false;
      const runtime = await getBotInterageRuntimeConfig().catch(() => null);
      if (!runtime?.enabled || !runtime.token) return false;
      const tools = [{
        type: "function" as const,
        function: {
          name: "botadmin_create_group_sweepstake",
          description: "Cria um sorteio real por enquete no grupo atual. Use somente quando um administrador pedir explicitamente. Premio, data/hora de encerramento e quantidade de ganhadores são obrigatórios; se faltar algum, peça antes de chamar.",
          parameters: {
            type: "object",
            properties: {
              prize: { type: "string" },
              endsAt: { type: "string", description: "ISO 8601 com fuso horário" },
              winnersCount: { type: "integer", minimum: 1, maximum: 50 },
              maxParticipants: { type: "integer", minimum: 1, maximum: 10000 },
              mentionAll: { type: "boolean" },
            },
            required: ["prize", "endsAt", "winnersCount"],
            additionalProperties: false,
          },
        },
      }];
      const first = await createBotInterageChatCompletion({
        baseUrl: runtime.baseUrl,
        token: runtime.token,
        model: runtime.model,
        messages: [
          { role: "system", content: "Você é o BotAdmin no WhatsApp. Interprete a transcrição atual. Se o administrador pedir um sorteio, use a ferramenta nativa; não escreva apenas um modelo de mensagem. Se faltarem dados obrigatórios, responda pedindo-os sem chamar a ferramenta." },
          { role: "user", content: transcription },
        ],
        tools,
        toolChoice: { type: "function", function: { name: "botadmin_create_group_sweepstake" } },
        timeoutMs: 60_000,
      });
      const calls = (first.toolCalls ?? []).filter((call) => call.name === "botadmin_create_group_sweepstake");
      if (calls.length === 0) return false;
      const toolMessages = [];
      for (const call of calls) {
        const result = await executeBotAdminMcpTool(call.name, {
          ...call.arguments,
          groupId: job.groupId,
          groupRemoteId: job.chatId,
          senderJid: job.senderJid,
          requestMessageId: job.whatsappMessageId || job.jobId,
        }).catch((error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        toolMessages.push({ role: "tool" as const, tool_call_id: call.id, content: JSON.stringify(result) });
      }
      const second = await createBotInterageChatCompletion({
        baseUrl: runtime.baseUrl,
        token: runtime.token,
        model: runtime.model,
        messages: [
          { role: "system", content: "Responda em português de forma curta e confirme o resultado real da ferramenta. Não invente publicação." },
          { role: "user", content: transcription },
          { role: "assistant", content: first.content ?? "", tool_calls: calls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) },
          ...toolMessages,
        ],
        tools,
        timeoutMs: 60_000,
      });
      const answer = second.content?.trim() || "Solicitação processada pelo BotAdmin.";
      const messageId = await sendJobText(answer);
      await completeBotInterageSystemJob({ jobId, status: "delivered", messageId });
      return true;
    };

    if (event === "job.failed") {
      const result = asRecord(data?.result);
      const error = getString(result, "error") ||
        (isAudioJob
          ? "O processamento do áudio falhou."
          : "O processamento do BotInterage falhou.");
      const transcription = getString(result, "transcription") || getString(result, "text");
      const terminalText = getExactString(result, "answer") || getExactString(result, "text");
      const recoverableAudioTimeout = isAudioJob && Boolean(transcription) &&
        /timeout|timed out|sockettimeoutexception/i.test(error);
      const recoverableAskTimeout = !isAudioJob &&
        /timeout|timed out|sockettimeoutexception/i.test(error);

      // Image generation can outlive the native audio request. In that case
      // ChatGPT has already understood the voice note, but its streaming call
      // times out before the generated asset is indexed. Recover only images
      // created after this job so an older conversation image is never resent.
      if (recoverableAudioTimeout) {
        const conversation = await getBotInterageSystemConversation(
          job.groupId,
          botInterageGroupConversationKey(job.groupId),
        );
        const recoveredUrls = conversation?.conversationId
          ? await refreshConversationImages(conversation.conversationId, job.createdAt)
          : [];
        if (recoveredUrls.length > 0) {
          const images = await prepareGeneratedImages({
            imageUrls: recoveredUrls,
            conversationId: conversation?.conversationId ?? null,
            createdAfter: job.createdAt,
          });
          let firstSentMessageId: string | null = null;
          for (const [index, image] of images.entries()) {
            const sentMessageId = await sendJobImage(
              image,
              index === 0 ? "🧠 Imagem criada a partir da sua nota de voz." : undefined,
              index === 0,
            );
            firstSentMessageId ??= sentMessageId;
          }
          await completeBotInterageSystemJob({
            jobId,
            status: "delivered",
            messageId: firstSentMessageId,
          });
          return NextResponse.json({
            ok: true,
            delivered: true,
            recovered_after_audio_timeout: true,
          });
        }

        // Ask the module webhook dispatcher to retry while ChatGPT finishes
        // indexing the image. Do not tell the user the audio was unintelligible.
        if (Date.now() - job.createdAt.getTime() < 3 * 60 * 1_000) {
          await completeBotInterageSystemJob({
            jobId,
            status: "accepted",
            error: `Áudio transcrito; aguardando artefato após timeout: ${error}`,
          });
          return NextResponse.json(
            { message: "Áudio entendido; imagem ainda sendo indexada." },
            { status: 503 },
          );
        }
      }
      // A normal BotInterage turn can also be persisted by ChatGPT after the
      // native SSE socket times out (PDFs, files and long answers are the
      // common cases). Keep the webhook idempotent and ask the module to
      // retry delivery instead of posting a misleading failure bubble while
      // the persisted turn is still settling.
      if (recoverableAskTimeout && Date.now() - job.createdAt.getTime() < 3 * 60 * 1_000) {
        await completeBotInterageSystemJob({
          jobId,
          status: "accepted",
          error: `Resposta persistida; aguardando entrega após timeout: ${error}`,
        });
        return NextResponse.json(
          { message: "Resposta ainda sendo processada; nova tentativa agendada." },
          { status: 503 },
        );
      }
      // A provider may classify the generation itself as failed while still
      // returning a complete user-facing explanation (policy refusal, quota
      // notice or a safe alternative). That text is a valid assistant reply
      // and must not be discarded with the transport error.
      if (terminalText) {
        const messageId = await sendJobText(terminalText);
        await completeBotInterageSystemJob({
          jobId,
          status: "delivered",
          messageId,
        });
        return NextResponse.json({
          ok: true,
          delivered: true,
          recovered_terminal_text: true,
        });
      }
      // Do not pollute the conversation with a generic error bubble. The
      // requester already receives the 🧠 acknowledgement; a terminal
      // failure is represented only by a blocked reaction on the original
      // message, so the chat remains a natural conversation.
      if (client && job.whatsappMessageId) {
        await sendReactionMessage(client, {
          chatId: job.chatId,
          messageId: job.whatsappMessageId,
          emoji: "🚫",
        }).catch(() => undefined);
      }
      if (isInternalDelivery && job.internalMessageId) {
        await acknowledgeInternalBotFailure(job.groupId, job.internalMessageId).catch(() => false);
      }
      const messageId = job.whatsappMessageId || null;
      await completeBotInterageSystemJob({
        jobId,
        status: "failed",
        messageId,
        error,
      });
      return NextResponse.json({ ok: true, failed: true });
    }

    const result = asRecord(data?.result);
    const conversationId = getString(result, "conversation_id");
    const messageId = getString(result, "message_id");
    if (conversationId) {
      await saveBotInterageSystemConversation({
        groupId: job.groupId,
        senderJid: botInterageGroupConversationKey(job.groupId),
        conversationId,
        messageId,
      });
    }

    const transcription = isAudioJob ? getExactString(result, "transcription") : null;
    // Em jobs de áudio, `text` pode ser apenas a transcrição. Ela não é uma
    // resposta para o grupo: deve entrar como mensagem normal do usuário e
    // seguir para o assistente. Só entregue texto quando o provedor declarar
    // uma resposta de fato.
    const answer = getExactString(result, "answer") ||
      getExactString(result, "assistant_answer") ||
      getExactString(result, "response") ||
      (isAudioJob ? null : getExactString(result, "text"));
    const nativeAudioAnswerNeedsFollowUp = Boolean(
      isAudioJob &&
      transcription &&
      (isNaturalBotAdminMcpRequest(transcription) ||
        !answer ||
        /(?:não|nao)\s+(?:tenho|consigo|recebi|vejo|acesso)|envie\s+o\s+áudio|envie\s+o\s+audio|não\s+foi\s+poss[ií]vel\s+(?:acessar|ler|ouvir)|informações?\s+de\s+grupos?|administradores?\s+.*(?:não|nao)\s+(?:fica|está|esta)/i.test(
          answer,
        )),
    );
    if (isAudioJob && transcription && await handleAudioBotAdminToolRequest(transcription)) {
      return NextResponse.json({ ok: true, delivered: true, type: jobType, botadmin_tool: true });
    }
    if (isAudioJob && transcription && nativeAudioAnswerNeedsFollowUp) {
      await recordBotInterageContextEvent({
        groupId: job.groupId,
        userId: job.userId,
        instanceId: job.instanceId,
        groupRemoteId: job.chatId,
        senderJid: job.senderJid,
        whatsappMessageId: job.whatsappMessageId,
        role: "user",
        content: transcription,
        contentType: "audio_transcription",
        jobId,
      });
      const mcpContext = await resolveBotAdminMcpContext({
        message: transcription,
        groupId: job.groupId,
        groupRemoteId: job.chatId,
        senderJid: job.senderJid,
      }).catch(() => "");
      // Consultas factuais do grupo são ferramentas nativas do robô, não uma
      // pergunta comum para o modelo decidir se consegue responder. Para
      // contagem de membros, entregue o valor autorizado pelo MCP diretamente
      // e evite que o ChatGPT diga que não tem acesso ao grupo.
      if (/\b(?:quantos?|quantas?|numero|total|quantidade)\b.{0,80}\b(?:pessoas?|membros?|participantes?)\b|\b(?:pessoas?|membros?|participantes?)\b.{0,50}\b(?:quantos?|quantas?|numero|total|quantidade)\b/i.test(transcription)) {
        const countMatch = mcpContext.match(/"participantCount"\s*:\s*(\d+)/i);
        if (countMatch) {
          const participantCount = Number(countMatch[1]);
          const messageId = await sendJobText(
            `Este grupo tem ${participantCount} ${participantCount === 1 ? "membro" : "membros"}.`,
          );
          await completeBotInterageSystemJob({
            jobId,
            status: "delivered",
            messageId,
          });
          return NextResponse.json({
            ok: true,
            delivered: true,
            type: jobType,
            transcription_forwarded: true,
            mcp_tool: "botadmin_get_group_profile",
            participant_count: participantCount,
          });
        }
      }
      const followUpPrompt = [
        "Atenda exclusivamente à transcrição desta nota de voz como a solicitação atual.",
        "A resposta nativa não conseguiu usar o contexto do grupo; não diga que não recebeu áudio.",
        mcpContext,
        transcription,
      ]
        .filter(Boolean)
        .join("\n\n");
      const followUp = await submitBotInterageSystemAskJob({
        groupId: job.groupId,
        userId: job.userId,
        instanceId: job.instanceId,
        chatId: job.chatId,
        senderJid: job.senderJid,
        whatsappMessageId: job.whatsappMessageId,
        internalGroupId: job.internalGroupId,
        internalMessageId: job.internalMessageId,
        // Sem prefixos nem texto de interface: a IA recebe exatamente o que
        // foi entendido no áudio e responde como em uma mensagem normal.
        prompt: followUpPrompt,
      });
      await completeBotInterageSystemJob({
        jobId,
        status: "delivered",
        messageId: job.whatsappMessageId || null,
      });
      return NextResponse.json({
        ok: true,
        delivered: true,
        type: jobType,
        transcription_forwarded: true,
        follow_up_job_id: followUp.jobId,
      });
    }
    const artifactDescriptors = collectGeneratedMedia(result)
      .filter((entry) => entry.url || entry.base64 || entry.textContent)
      .slice(0, 8);
    const inlineHtml = extractInlineHtml(answer);
    if (inlineHtml && !artifactDescriptors.some((entry) => entry.textContent === inlineHtml)) {
      artifactDescriptors.push({
        textContent: inlineHtml,
        mimeType: "text/html",
        fileName: `botinterage-${Date.now()}.html`,
      });
    }
    let imageUrls = collectImageUrls(result);
    // Only reconcile the Library when the terminal payload is truly empty.
    // If ChatGPT returned a policy explanation, fetching here could resend an
    // older image from the same conversation and corrupt the response.
    if (imageUrls.length === 0 && !answer && conversationId) {
      imageUrls = await refreshConversationImages(conversationId, job.createdAt);
    }
    if (!answer && imageUrls.length === 0 && artifactDescriptors.length === 0) {
      throw new Error("Job concluído sem texto nem mídia.");
    }

    const images = imageUrls.length > 0
      ? await prepareGeneratedImages({ imageUrls, conversationId, createdAfter: job.createdAt })
      : [];
    const runtimeConfig = await getBotInterageRuntimeConfig();
    const generatedArtifactTokens = [
      runtimeConfig.token,
      process.env.CHATGPT_PHONE_WORKER_TOKEN,
      process.env.CHATGPT_PHONE_API_TOKEN,
    ];
    const generatedFiles = await Promise.all(
      artifactDescriptors
        .filter((entry) => !entry.url || !imageUrls.includes(entry.url))
        .map((entry) => downloadGeneratedMediaWithRetry(entry, generatedArtifactTokens)),
    );
    let firstSentMessageId: string | null = null;
    let firstMediaMessageId: string | null = null;

    const answerLooksLikePath = Boolean(answer && /(?:^|\s)(?:file:\/\/|\/tmp\/|\/data\/|\/storage\/|[A-Za-z]:\\)[^\s]+$/i.test(answer.trim()));
    const visibleAnswer = (answerLooksLikePath || Boolean(inlineHtml)) && (images.length > 0 || generatedFiles.length > 0)
      ? null
      : answer;

    if (visibleAnswer) {
      const sentMessageId = await sendJobText(visibleAnswer);
      firstSentMessageId = sentMessageId;
      await recordBotInterageContextEvent({
        groupId: job.groupId,
        userId: job.userId,
        instanceId: job.instanceId,
        groupRemoteId: job.chatId,
        senderJid: job.senderJid,
        whatsappMessageId: sentMessageId,
        role: "assistant",
        content: visibleAnswer,
        contentType: "text",
        jobId,
      }).catch((error) => {
        console.warn("[botinterage-system-webhook] texto não entrou no histórico", {
          jobId,
          error,
        });
      });
    }

    for (const [index, image] of images.entries()) {
      const sentMessageId = await sendJobImage(
        image,
        undefined,
        index === 0 && !answer,
      );
      firstSentMessageId ??= sentMessageId;
      firstMediaMessageId ??= sentMessageId;
    }

    for (const [index, media] of generatedFiles.entries()) {
      const sentMessageId = await sendJobMedia(
        media,
        index === 0 && !visibleAnswer && images.length === 0 ? "📎 Arquivo gerado pelo BotInterage." : undefined,
        index === 0 && !visibleAnswer && images.length === 0,
      );
      firstSentMessageId ??= sentMessageId;
      firstMediaMessageId ??= sentMessageId;
    }

    if (imageUrls.length > 0 || generatedFiles.length > 0) {
      await recordBotInterageContextEvent({
        groupId: job.groupId,
        userId: job.userId,
        instanceId: job.instanceId,
        groupRemoteId: job.chatId,
        senderJid: job.senderJid,
        whatsappMessageId: firstMediaMessageId,
        role: "assistant",
        content: visibleAnswer || "Arquivo gerado pelo ChatGPT.",
        contentType: "media",
        media: {
          imageUrls,
          files: generatedFiles.map((entry) => ({ filename: entry.filename, mimeType: entry.mimeType })),
        },
        jobId,
      }).catch((error) => {
        console.warn("[botinterage-system-webhook] mídia não entrou no histórico", {
          jobId,
          error,
        });
      });
    }

    await completeBotInterageSystemJob({
      jobId,
      status: "delivered",
      messageId: firstSentMessageId,
    });
    return NextResponse.json({
      ok: true,
      delivered: true,
      type: jobType,
      responseMode: visibleAnswer && (images.length > 0 || generatedFiles.length > 0)
        ? "text_and_media"
        : visibleAnswer ? "text" : "media",
      mediaCount: images.length + generatedFiles.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[botinterage-system-webhook] Falha ao entregar job", {
      jobId,
      eventId,
      error,
    });
    await completeBotInterageSystemJob({
      jobId,
      status: "accepted",
      error: message,
    });
    return NextResponse.json({ message: "Entrega pendente para nova tentativa." }, { status: 503 });
  }
}
