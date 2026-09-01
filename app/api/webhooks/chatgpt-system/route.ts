import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getBotInterageRuntimeConfig } from "lib/admin-botinterage-config";
import {
  claimBotInterageSystemJob,
  completeBotInterageSystemJob,
  getBotInterageSystemConversation,
  getBotInterageSystemJob,
  saveBotInterageSystemConversation,
} from "lib/botinterage-system";
import { recordBotInterageContextEvent } from "lib/chatgpt-phone";
import { getInstanceForUser } from "lib/bot-instances";
import { dispatchInternalGroupAutomationMessage } from "lib/internal-groups";
import { saveBufferAsUploadedFile } from "lib/uploads";
import { sendMediaMessage, sendTextMessage, type WuzapiClient } from "lib/wuzapi";

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
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
    if (attempt < 2) await wait(500 * (attempt + 1));
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

  try {
    const failedResult = asRecord(data?.result);
    const jobType = getString(data, "type") || getString(failedResult, "type");
    const isAudioJob = jobType === "audio_ask" || jobType === "audio_transcription" ||
      jobType === "native_audio_ask" || jobType === "native_audio_transcription";
    const isMediaAnalysisJob = jobType === "ask";
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
      return sendTextMessage(client!, { to: job.chatId, body, quoted });
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
      return sendMediaMessage(client!, {
        to: job.chatId,
        media: image.buffer,
        mediaType: "image",
        mimeType: image.mimeType,
        filename: image.filename,
        caption,
        quoted: quoteOriginal ? quoted : undefined,
      });
    };

    if (event === "job.failed") {
      const result = asRecord(data?.result);
      const error = getString(result, "error") ||
        (isAudioJob
          ? "O processamento do áudio falhou."
          : isMediaAnalysisJob
            ? "A análise da mídia falhou."
            : "A geração de imagem falhou.");
      const transcription = getString(result, "transcription") || getString(result, "text");
      const terminalText = getExactString(result, "answer") || getExactString(result, "text");
      const recoverableAudioTimeout = isAudioJob && Boolean(transcription) &&
        /timeout|timed out|sockettimeoutexception/i.test(error);

      // Image generation can outlive the native audio request. In that case
      // ChatGPT has already understood the voice note, but its streaming call
      // times out before the generated asset is indexed. Recover only images
      // created after this job so an older conversation image is never resent.
      if (recoverableAudioTimeout) {
        const conversation = await getBotInterageSystemConversation(
          job.groupId,
          job.senderJid,
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
      const body = terminalText || (isAudioJob && transcription
        ? "⚠️ Entendi o áudio, mas não consegui concluir o pedido agora. Tente novamente em instantes."
        : isAudioJob
          ? "⚠️ Não consegui entender esse áudio agora. Envie novamente em instantes."
          : isMediaAnalysisJob
            ? "⚠️ Não consegui concluir a análise desse vídeo agora. Tente novamente em instantes."
            : "⚠️ Não consegui gerar a imagem agora. Tente novamente em instantes.");
      const messageId = await sendJobText(body);
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
        senderJid: job.senderJid,
        conversationId,
        messageId,
      });
    }

    const answer = getExactString(result, "answer") || getExactString(result, "text");
    let imageUrls = collectImageUrls(result);
    // Only reconcile the Library when the terminal payload is truly empty.
    // If ChatGPT returned a policy explanation, fetching here could resend an
    // older image from the same conversation and corrupt the response.
    if (imageUrls.length === 0 && !answer && conversationId) {
      imageUrls = await refreshConversationImages(conversationId, job.createdAt);
    }
    if (!answer && imageUrls.length === 0) {
      throw new Error("Job concluído sem texto nem mídia.");
    }

    const images = imageUrls.length > 0
      ? await prepareGeneratedImages({ imageUrls, conversationId, createdAfter: job.createdAt })
      : [];
    let firstSentMessageId: string | null = null;
    let firstMediaMessageId: string | null = null;

    if (answer) {
      const sentMessageId = await sendJobText(answer);
      firstSentMessageId = sentMessageId;
      await recordBotInterageContextEvent({
        groupId: job.groupId,
        userId: job.userId,
        instanceId: job.instanceId,
        groupRemoteId: job.chatId,
        senderJid: job.senderJid,
        whatsappMessageId: sentMessageId,
        role: "assistant",
        content: answer,
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

    if (imageUrls.length > 0) {
      await recordBotInterageContextEvent({
        groupId: job.groupId,
        userId: job.userId,
        instanceId: job.instanceId,
        groupRemoteId: job.chatId,
        senderJid: job.senderJid,
        whatsappMessageId: firstMediaMessageId,
        role: "assistant",
        content: answer || "Mídia gerada pelo ChatGPT.",
        contentType: "media",
        media: { imageUrls },
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
      responseMode: answer && images.length > 0 ? "text_and_media" : answer ? "text" : "media",
      mediaCount: images.length,
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
