import { NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import sharp from "sharp";

import { getCurrentUser } from "lib/auth";
import {
  recordSupportMessage,
  buildSupportThreadSummary,
  serializeSupportMessage,
  setSupportHandlingMode,
  getMinutesLeftIn24hWindow,
} from "lib/support";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  sendMediaMessage,
  sendTextMessage,
  getAppBaseUrl,
} from "lib/meta";
import { resolveUploadedFileUrl, UPLOADS_STORAGE_ROOT } from "lib/uploads";
import { emitSupportMessageEvent, emitSupportThreadUpdate } from "lib/realtime";

const inferMediaType = (inputType: string, fallback: string):
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker" => {
  const normalized = inputType.toLowerCase();
  if (normalized.startsWith("image")) return "image";
  if (normalized.startsWith("video")) return "video";
  if (normalized.startsWith("audio")) return "audio";
  if (normalized === "sticker") return "sticker";
  if (normalized === "document") return "document";
  if (fallback === "image/webp") return "image";
  if (fallback.startsWith("image/")) return "image";
  if (fallback.startsWith("video/")) return "video";
  if (fallback.startsWith("audio/")) return "audio";
  return "document";
};

export async function POST(request: Request) {
  try {
    const session = await getCurrentUser();
    if (!session) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json(
        { message: "Conteúdo inválido. Envie os dados via multipart/form-data." },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const userIdRaw = (formData.get("userId") || "").toString().trim();
    const targetUserId = Number.parseInt(userIdRaw, 10);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return NextResponse.json({ message: "Usuário inválido." }, { status: 400 });
    }

    const toRaw = (formData.get("to") || "").toString().trim();
    if (!toRaw) {
      return NextResponse.json({ message: "Informe o destinatário." }, { status: 400 });
    }

    const mode = (formData.get("mode") || "text").toString();
    const text = (formData.get("text") || "").toString().trim();
    const adminWebhookRow = await getAdminWebhookRow().catch(() => null);
    const adminDigits = (adminWebhookRow?.phone_number || "").toString().replace(/\D+/g, "");
    const toDigits = toRaw.replace(/\D+/g, "");
    const to = adminDigits && toDigits === adminDigits ? adminDigits : toRaw;
    const isAdminSupport = to === adminDigits || to === "__admin__";

    const windowInfo = isAdminSupport
      ? { within24h: true }
      : await getMinutesLeftIn24hWindow(targetUserId, to);
    const webhookRow = isAdminSupport ? null : adminWebhookRow;
    const phoneNumberId = webhookRow?.phone_number_id?.trim() ?? "";
    const accessToken = webhookRow?.access_token?.trim() ?? "";
    const canSendViaMeta = !isAdminSupport && windowInfo.within24h && phoneNumberId && accessToken;

    if (!isAdminSupport && (!phoneNumberId || !accessToken)) {
      return NextResponse.json(
        { message: "Configure o Phone Number ID e Access Token do bot administrativo." },
        { status: 400 },
      );
    }

    const webhook = phoneNumberId && accessToken ? { phone_number_id: phoneNumberId, access_token: accessToken } : null;

    const finalizeDispatch = async (
      record: Awaited<ReturnType<typeof recordSupportMessage>>,
      options: { skipHumanize?: boolean } = {},
    ) => {
      const summaryThread = options.skipHumanize
        ? record.thread
        : (await setSupportHandlingMode(targetUserId, to, "human")) ?? record.thread;
      const serializedMessage = serializeSupportMessage(record.message);
      const summary = await buildSupportThreadSummary(targetUserId, summaryThread);
      emitSupportMessageEvent({
        userId: targetUserId,
        whatsappId: summaryThread.whatsappId,
        message: serializedMessage,
      });
      emitSupportThreadUpdate({ userId: targetUserId, thread: summary });
      return NextResponse.json({ ok: true, message: serializedMessage, thread: summary });
    };

    if (isAdminSupport) {
      if (mode === "text") {
        const record = await recordSupportMessage({
          userId: targetUserId,
          whatsappId: to,
          direction: "inbound", // do ponto de vista do usuário, mensagem recebida do admin
          messageType: "text",
          text,
          senderUserId: session.id,
          senderRole: "admin",
        });
        return finalizeDispatch(record, { skipHumanize: true });
      }

      if (mode === "media") {
        const file = formData.get("file");
        if (!(file instanceof File) || file.size === 0) {
          return NextResponse.json({ message: "Envie um arquivo válido." }, { status: 400 });
        }
        const explicitType = (formData.get("mediaType") || "").toString();
        const mediaType = inferMediaType(explicitType, file.type);
        const caption = (formData.get("caption") || "").toString().trim() || null;

        const baseBuffer = Buffer.from(await file.arrayBuffer());
        let workingBuffer = baseBuffer;
        let mimeType = typeof file.type === "string" && file.type.trim() ? file.type.trim() : "";
        let effectiveMediaType = mediaType;
        let filename = file.name && file.name.trim() ? file.name.trim() : `media-${Date.now()}`;

        if (mediaType === "image") {
          if (mimeType === "image/webp") {
            workingBuffer = await sharp(workingBuffer).jpeg({ quality: 88 }).toBuffer();
            mimeType = "image/jpeg";
            filename = filename.replace(/\.webp$/i, ".jpg");
          }
        }
        if (mediaType === "sticker" && mimeType !== "image/webp") {
          effectiveMediaType = "image";
        }

        const storageRoot = path.resolve(UPLOADS_STORAGE_ROOT, "support");
        await fs.mkdir(storageRoot, { recursive: true });
        const extension = (() => {
          const ext = path.extname(filename).toLowerCase();
          if (ext) return ext;
          if (mimeType === "image/jpeg") return ".jpg";
          if (mimeType === "image/png") return ".png";
          if (mimeType === "image/webp") return ".webp";
          if (mimeType === "application/pdf") return ".pdf";
          return "";
        })();
        const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extension}`;
        const absoluteDiskPath = path.join(storageRoot, uniqueName);
        await fs.writeFile(absoluteDiskPath, workingBuffer);

        const relativePath = path.posix.join("uploads", "support", uniqueName);
        const publicPath = resolveUploadedFileUrl(relativePath).replace(/^\/+/, "");
        const baseUrl = getAppBaseUrl();
        const absoluteUrl = new URL(publicPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

        const record = await recordSupportMessage({
          userId: targetUserId,
          whatsappId: to,
          direction: "inbound",
          messageType: effectiveMediaType,
          text: caption,
          senderUserId: session.id,
          senderRole: "admin",
          payload: {
            mediaType: effectiveMediaType,
            mimeType,
            filename: uniqueName,
            storagePath: relativePath,
            mediaUrl: absoluteUrl,
            caption,
          },
        });
        return finalizeDispatch(record, { skipHumanize: true });
      }

      return NextResponse.json({ message: "Modo de envio não suportado." }, { status: 400 });
    }

    if (mode === "text") {
      if (!text) {
        return NextResponse.json({ message: "Digite a mensagem de texto." }, { status: 400 });
      }

      await setSupportHandlingMode(targetUserId, to, "human");
      if (canSendViaMeta && webhook) {
        await sendTextMessage({ webhook, to, text });
      }
      const metaDeliveryFlag = isAdminSupport
        ? null
        : canSendViaMeta
          ? null
          : phoneNumberId && accessToken
            ? "window_closed"
            : "credentials_missing";

      const payload: Record<string, unknown> = { origin: "admin_panel" };
      if (metaDeliveryFlag) {
        payload.metaDelivery = metaDeliveryFlag;
      }

      const record = await recordSupportMessage({
        userId: targetUserId,
        whatsappId: to,
        direction: "outbound",
        messageType: "text",
        text,
        payload,
        senderUserId: session.id,
        senderRole: "admin",
      });
      return finalizeDispatch(record);
    }

    if (mode === "media") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ message: "Envie um arquivo válido." }, { status: 400 });
      }
      const explicitType = (formData.get("mediaType") || "").toString();
      const mediaType = inferMediaType(explicitType, file.type);
      const caption = (formData.get("caption") || "").toString().trim() || null;

      if (mediaType === "image" && !file.type.startsWith("image/")) {
        return NextResponse.json({ message: "Envie um arquivo de imagem válido." }, { status: 400 });
      }

      const baseBuffer = Buffer.from(await file.arrayBuffer());
      let workingBuffer = baseBuffer;
      let mimeType = typeof file.type === "string" && file.type.trim() ? file.type.trim() : "";
      let effectiveMediaType = mediaType;
      let filename = file.name && file.name.trim() ? file.name.trim() : `media-${Date.now()}`;

      if (mediaType === "image") {
        if (mimeType === "image/webp") {
          workingBuffer = await sharp(workingBuffer).jpeg({ quality: 88 }).toBuffer();
          mimeType = "image/jpeg";
          filename = filename.replace(/\.webp$/i, ".jpg");
        } else if (mimeType && !mimeType.startsWith("image/")) {
          return NextResponse.json({ message: "Formato de imagem não suportado." }, { status: 400 });
        }
      }

      if (mediaType === "sticker" && mimeType !== "image/webp") {
        effectiveMediaType = "image";
      }

      const storageRoot = path.resolve(UPLOADS_STORAGE_ROOT, "support");
      await fs.mkdir(storageRoot, { recursive: true });
      const extension = (() => {
        const ext = path.extname(filename).toLowerCase();
        if (ext) {
          return ext;
        }
        if (mimeType === "image/jpeg") return ".jpg";
        if (mimeType === "image/png") return ".png";
        if (mimeType === "image/webp") return ".webp";
        if (mimeType === "application/pdf") return ".pdf";
        return "";
      })();
      const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extension}`;
      const absoluteDiskPath = path.join(storageRoot, uniqueName);
      await fs.writeFile(absoluteDiskPath, workingBuffer);

      const relativePath = path.posix.join("uploads", "support", uniqueName);
      const publicPath = resolveUploadedFileUrl(relativePath).replace(/^\/+/, "");
      const baseUrl = getAppBaseUrl();
      const absoluteUrl = new URL(publicPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

      try {
        if (canSendViaMeta && webhook) {
          await sendMediaMessage({
            webhook,
            to,
            mediaType: effectiveMediaType,
            mediaUrl: absoluteUrl,
            caption,
            filename: effectiveMediaType === "document" ? filename : undefined,
          });
        }

        const metaDeliveryFlag = isAdminSupport
          ? null
          : canSendViaMeta
            ? null
            : phoneNumberId && accessToken
              ? "window_closed"
              : "credentials_missing";

        const payload: Record<string, unknown> = {
          mediaType: effectiveMediaType,
          mimeType,
          filename: uniqueName,
          storagePath: relativePath,
          mediaUrl: absoluteUrl,
          caption,
          origin: "admin_panel",
        };
        if (metaDeliveryFlag) {
          payload.metaDelivery = metaDeliveryFlag;
        }

        const record = await recordSupportMessage({
          userId: targetUserId,
          whatsappId: to,
          direction: "outbound",
          messageType: effectiveMediaType,
          text: caption,
          payload,
          senderUserId: session.id,
          senderRole: "admin",
        });

        return finalizeDispatch(record);
      } catch (error) {
        await fs.unlink(absoluteDiskPath).catch(() => {});
        throw error;
      }
    }

    return NextResponse.json({ message: "Modo de envio não suportado." }, { status: 400 });
  } catch (error) {
    console.error("[admin-support] Falha ao enviar mensagem", error);
    return NextResponse.json({ message: "Erro ao enviar mensagem." }, { status: 500 });
  }
}
