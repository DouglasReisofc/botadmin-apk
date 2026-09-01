import { after, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createInternalGroupMessage, InternalGroupError, listInternalGroupMessages, processInternalGroupBotMessage } from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";
import { deleteUploadedFile, saveUploadedFile } from "lib/uploads";

export const runtime = "nodejs";
type Context = { params: Promise<{ groupId: string }> };
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const mediaType = (mime: string) => {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

const failure = (error: unknown) => {
  if (error instanceof InternalGroupError) {
    return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
  }
  console.error("[internal-groups] messages request failed", error);
  return NextResponse.json({ message: "Não foi possível processar a mensagem." }, { status: 500 });
};

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const url = new URL(request.url);
    return NextResponse.json(await listInternalGroupMessages(groupId, user.id, {
      after: Number(url.searchParams.get("after") ?? 0),
      before: Number(url.searchParams.get("before") ?? 0),
      limit: Number(url.searchParams.get("limit") ?? 60),
    }));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const contentType = request.headers.get("content-type") ?? "";
    let input: Parameters<typeof createInternalGroupMessage>[2];
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size <= 0) throw new InternalGroupError("Selecione uma mídia válida.");
      if (file.size > MAX_MEDIA_BYTES) throw new InternalGroupError("A mídia deve ter no máximo 25 MB.", 413);
      const mime = file.type?.trim().toLowerCase() || "application/octet-stream";
      const asSticker = form.get("asSticker")?.toString() === "true";
      const rawMentions = form.get("mentions")?.toString() ?? "";
      let mentions: unknown[] = [];
      if (rawMentions) {
        try {
          const parsed = JSON.parse(rawMentions);
          mentions = Array.isArray(parsed) ? parsed : [];
        } catch (_) {}
      }
      if (asSticker && !mime.startsWith("image/")) {
        throw new InternalGroupError("Apenas imagens podem ser enviadas como figurinha.");
      }
      const storedPath = await saveUploadedFile(file, `internal-groups/${groupId}`, { convertToWebp: false });
      input = {
        text: form.get("text"),
        messageType: asSticker ? "sticker" : mediaType(mime),
        mediaPath: storedPath,
        mediaMimeType: mime,
        mediaFileName: file.name,
        mediaSize: file.size,
        replyToMessageId: form.get("replyToMessageId"),
        viewOnce: form.get("viewOnce"),
        mentionAll: form.get("mentionAll"),
        mentions,
        clientMessageId: form.get("clientMessageId"),
      };
    } else {
      const body = await request.json().catch(() => ({}));
      input = {
        text: body?.text,
        messageType: typeof body?.messageType === "string" ? body.messageType : undefined,
        replyToMessageId: body?.replyToMessageId,
        viewOnce: body?.viewOnce,
        mentionAll: body?.mentionAll,
        mentions: body?.mentions,
        clientMessageId: body?.clientMessageId,
      };
    }
    const result = await createInternalGroupMessage(groupId, user.id, input);
    if (result.idempotent) {
      if (input.mediaPath) await deleteUploadedFile(input.mediaPath).catch(() => {});
      return NextResponse.json(result);
    }
    // Confirma a mensagem do membro antes de executar comandos. Buscas como
    // !play podem depender de serviços externos e nunca devem segurar o balão
    // do usuário nem a confirmação HTTP do envio.
    emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId: result.message.id });
    after(async () => {
      try {
        const botMessages = await processInternalGroupBotMessage(
          groupId,
          result.message.id,
          user.id,
        );
        for (const botMessageId of botMessages) {
          emitInternalGroupEvent({
            groupId,
            actorUserId: user.id,
            type: "message.created",
            messageId: botMessageId,
          });
        }
      } catch (error) {
        console.error("[internal-groups] command processing failed", {
          groupId,
          messageId: result.message.id,
          error,
        });
      }
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
