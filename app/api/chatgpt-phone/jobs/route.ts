import { NextRequest, NextResponse } from "next/server";

import {
  createAndRunBotInterageChatGptPhoneJob,
  createChatGptPhoneJob,
  isLikelyChatGptPhoneMediaRequest,
  runChatGptPhoneJob,
} from "lib/chatgpt-phone";

export const runtime = "nodejs";

const getBearerToken = (req: NextRequest): string | null => {
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  return req.headers.get("x-botadmin-mcp-token")?.trim() || null;
};

const isLocalRequest = (req: NextRequest): boolean => {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host.startsWith("[::1]:");
};

const authorize = (req: NextRequest): NextResponse | null => {
  const expected = process.env.BOTADMIN_MCP_TOKEN?.trim();
  if (!expected) {
    if (isLocalRequest(req)) {
      return null;
    }
    return NextResponse.json(
      { message: "Configure BOTADMIN_MCP_TOKEN antes de expor esta rota." },
      { status: 503 },
    );
  }
  if (getBearerToken(req) === expected) {
    return null;
  }
  return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
};

const toPositiveInt = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.trunc(numeric);
};

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const DEFAULT_TEXT_TIMEOUT_MS = 240_000;
const DEFAULT_MEDIA_TIMEOUT_MS = 900_000;

const hasRequestAttachments = (value: unknown): boolean =>
  Array.isArray(value) && value.some((item) => item && typeof item === "object");

export async function POST(req: NextRequest) {
  const unauthorized = authorize(req);
  if (unauthorized) {
    return unauthorized;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Payload JSON inválido." }, { status: 400 });
  }

  const message = toStringOrNull(body.message) ?? toStringOrNull(body.prompt);
  const groupId = toPositiveInt(body.groupId);
  if (!message) {
    return NextResponse.json({ message: "Informe message ou prompt." }, { status: 400 });
  }

  const runNow = body.runNow !== false;
  const useBotInterageContext = body.useBotInterageContext !== false && groupId !== null;
  const defaultTimeoutMs =
    hasRequestAttachments(body.attachments) || isLikelyChatGptPhoneMediaRequest(message)
      ? DEFAULT_MEDIA_TIMEOUT_MS
      : DEFAULT_TEXT_TIMEOUT_MS;

  try {
    if (useBotInterageContext && runNow) {
      const job = await createAndRunBotInterageChatGptPhoneJob({
        userId: toPositiveInt(body.userId) ?? 0,
        groupId,
        instanceId: toPositiveInt(body.instanceId) ?? 0,
        groupRemoteId: toStringOrNull(body.groupRemoteId) ?? "",
        groupName: toStringOrNull(body.groupName),
        senderJid: toStringOrNull(body.senderJid),
        senderName: toStringOrNull(body.senderName),
        whatsappMessageId: toStringOrNull(body.whatsappMessageId),
        message,
        attachments: Array.isArray(body.attachments) ? (body.attachments as never[]) : undefined,
      });
      return NextResponse.json({ ok: job.status === "succeeded", job }, { status: 201 });
    }

    const job = await createChatGptPhoneJob({
      userId: toPositiveInt(body.userId),
      groupId,
      instanceId: toPositiveInt(body.instanceId),
      groupRemoteId: toStringOrNull(body.groupRemoteId),
      senderJid: toStringOrNull(body.senderJid),
      senderName: toStringOrNull(body.senderName),
      whatsappMessageId: toStringOrNull(body.whatsappMessageId),
      prompt: message,
      context: body.context ?? null,
      request: {
        message,
        timeoutMs: toPositiveInt(body.timeoutMs) ?? defaultTimeoutMs,
        settleMs: toPositiveInt(body.settleMs) ?? 3_000,
        newChat: body.newChat !== false,
        executor: "native-cromite",
        resultSource: "database",
        ...(toStringOrNull(body.conversationId)
          ? { conversationId: toStringOrNull(body.conversationId) }
          : {}),
        ...(toStringOrNull(body.conversation_id)
          ? { conversation_id: toStringOrNull(body.conversation_id) }
          : {}),
        ...(toStringOrNull(body.conversationKey)
          ? { conversationKey: toStringOrNull(body.conversationKey) }
          : {}),
        ...(typeof body.temporaryChat === "boolean" ? { temporaryChat: body.temporaryChat } : {}),
        ...(typeof body.temporary_chat === "boolean" ? { temporary_chat: body.temporary_chat } : {}),
        ...(Array.isArray(body.attachments) ? { attachments: body.attachments } : {}),
      },
    });

    const finalJob = runNow
      ? await runChatGptPhoneJob(job.jobId, {
          timeoutMs: toPositiveInt(body.timeoutMs) ?? defaultTimeoutMs,
          settleMs: toPositiveInt(body.settleMs),
          newChat: body.newChat === undefined ? undefined : body.newChat !== false,
        })
      : job;

    return NextResponse.json({ ok: finalJob.status === "succeeded", job: finalJob }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível gerar agora.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
