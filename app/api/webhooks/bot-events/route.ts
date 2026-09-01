import "lib/runtime/ensure-web-streams";
import { NextRequest, NextResponse } from "next/server";

import { BotEventError, processWuzapiWebhook } from "lib/bot-events";
import { logBotEventsDebug } from "lib/bot-events/debug";
import {
  enqueueWebhookTask,
  getWebhookQueueStats,
  type WebhookQueuePriority,
} from "lib/bot-events/webhook-queue";
import { normalizeWebhookPayload } from "lib/bot-events/normalize";
import { createHash } from "crypto";

export const runtime = "nodejs";

const EXPECTED_BOT_EVENT_ERROR_STATUSES = new Set([401, 404]);
const EXPECTED_ERROR_LOG_INTERVAL_MS = 5 * 60 * 1000;
const expectedBotEventErrorLogTimes = new Map<string, number>();

const WEBHOOK_EVENT_PRIORITIES: Record<string, WebhookQueuePriority> = {
  "message.upsert": "high",
  "call.update": "high",
  "chat.action": "high",
  "message.action": "high",
  "group.info": "normal",
  "group.update": "normal",
  "group.joined": "normal",
  "group.picture": "normal",
  "privacy.settings": "normal",
  "pushname.setting": "normal",
  "messages.update": "low",
  "presence.update": "low",
  "history.sync": "low",
  "instance.status": "low",
  "status.update": "low",
};

const buildWebhookDedupeKey = (
  material: string,
  routingToken: string | null,
  event: string,
): string =>
  createHash("sha256")
    .update(routingToken ?? "no-token")
    .update("\0")
    .update(event)
    .update("\0")
    .update(material)
    .digest("hex");

const hashWebhookBody = (rawBody: string): string =>
  createHash("sha256").update(rawBody).digest("hex");

const firstNonEmptyString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const parseEventTime = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    }
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveWebhookOccurredAt = (
  normalized: ReturnType<typeof normalizeWebhookPayload>,
): number | null => {
  const message = toRecord(normalized.data.message);
  const candidates = [
    normalized.raw.occurredAt,
    normalized.raw.occurred_at,
    normalized.raw.timestamp,
    normalized.data.occurredAt,
    normalized.data.occurred_at,
    normalized.data.timestamp,
    message.timestamp,
    message.occurredAt,
  ];
  for (const candidate of candidates) {
    const parsed = parseEventTime(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

const resolveWebhookEventIdentity = (
  normalized: ReturnType<typeof normalizeWebhookPayload>,
): string | null =>
  firstNonEmptyString(
    normalized.raw.eventId,
    normalized.raw.eventID,
    normalized.raw.event_id,
    normalized.data.eventId,
    normalized.data.eventID,
    normalized.data.event_id,
  );

const resolveWebhookIsolationKey = (
  normalized: ReturnType<typeof normalizeWebhookPayload>,
  requestToken: string | null,
): string =>
  firstNonEmptyString(
    requestToken,
    normalized.token,
    normalized.instance?.id,
    normalized.instance?.Id,
    normalized.instance?.instanceId,
  ) ?? "anonymous-webhook";

const resolveWebhookPriority = (
  normalized: ReturnType<typeof normalizeWebhookPayload>,
): WebhookQueuePriority => {
  const basePriority = WEBHOOK_EVENT_PRIORITIES[normalized.event] ?? "low";
  if (normalized.event !== "message.upsert") {
    return basePriority;
  }

  return isHistoricalReplayWebhook(normalized) ? "low" : "high";
};

const isTruthyWebhookFlag = (value: unknown): boolean =>
  value === true ||
  value === 1 ||
  (typeof value === "string" && ["1", "true", "yes"].includes(value.trim().toLowerCase()));

const isHistoricalReplayWebhook = (
  normalized: ReturnType<typeof normalizeWebhookPayload>,
): boolean => {
  if (normalized.event !== "message.upsert") return false;

  const rawMessage = toRecord(normalized.raw.message);
  const dataMessage = toRecord(normalized.data.message);
  if (
    [
      normalized.raw.historySync,
      normalized.raw.history_sync,
      normalized.data.historySync,
      normalized.data.history_sync,
      rawMessage.historySync,
      rawMessage.history_sync,
      dataMessage.historySync,
      dataMessage.history_sync,
    ].some(isTruthyWebhookFlag)
  ) {
    return true;
  }

  const sourceEvent = firstNonEmptyString(
    normalized.raw.eventType,
    normalized.raw.event_type,
    normalized.data.eventType,
    normalized.data.event_type,
  )?.toLowerCase();
  const explicitHistoryEvent =
    sourceEvent === "history.sync" ||
    sourceEvent === "messages.history" ||
    sourceEvent === "messaging-history.set";
  const occurredAt = resolveWebhookOccurredAt(normalized);
  const staleBefore = Date.now() - 5 * 60_000;

  // Some providers flatten a HistorySync chunk into message.received and omit
  // its explicit flag. Age remains a safe fallback for queue priority only;
  // historical messages are persisted and never discarded.
  return explicitHistoryEvent || (occurredAt !== null && occurredAt < staleBefore);
};

const shouldLogExpectedBotEventError = (status: number, message: string, sourceIp: string): boolean => {
  const now = Date.now();
  if (expectedBotEventErrorLogTimes.size > 500) {
    expectedBotEventErrorLogTimes.clear();
  }
  const key = `${status}:${message}:${sourceIp}`;
  const lastLoggedAt = expectedBotEventErrorLogTimes.get(key) ?? 0;
  if (now - lastLoggedAt < EXPECTED_ERROR_LOG_INTERVAL_MS) {
    return false;
  }
  expectedBotEventErrorLogTimes.set(key, now);
  return true;
};

const getWebhookTokenFromRequest = (req: NextRequest): string | null => {
  const candidates = [
    req.headers.get("token"),
    req.headers.get("x-api-key"),
    req.headers.get("x-instance-api-key"),
    req.headers.get("x-botadmin-instance-token"),
    req.nextUrl.searchParams.get("token"),
    req.nextUrl.searchParams.get("apiKey"),
    req.nextUrl.searchParams.get("apikey"),
  ];
  const authorization = req.headers.get("authorization");
  if (authorization) {
    candidates.push(authorization.replace(/^bearer\s+/i, ""));
  }
  const found = candidates.find((entry) => typeof entry === "string" && entry.trim().length > 0);
  return found ? found.trim() : null;
};

export async function POST(req: NextRequest) {
  const receivedAt = new Date().toISOString();
  const requestToken = getWebhookTokenFromRequest(req);
  const sourceIp =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for") ||
    // @ts-expect-error - NextRequest may not expose ip in all runtimes
    (req as any).ip ||
    "unknown";

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (error) {
    console.error("[bot-events webhook] failed to read body", { error });
  }

  logBotEventsDebug("[bot-events webhook] received", {
    receivedAt,
    method: req.method,
    path: req.nextUrl.pathname,
    search: req.nextUrl.search,
    sourceIp,
    contentLength: req.headers.get("content-length") ?? rawBody.length ?? null,
  });

  if (!rawBody) {
    console.warn("[bot-events webhook] empty body");
    return NextResponse.json({ ok: true });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    console.error("[bot-events webhook] invalid JSON body", { error });
    return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizeWebhookPayload(payload);
  const priority = resolveWebhookPriority(normalized);
  const historicalReplay = isHistoricalReplayWebhook(normalized);
  const routingToken = requestToken ?? normalized.token;
  const isolationKey = resolveWebhookIsolationKey(normalized, requestToken);

  const eventIdentity = resolveWebhookEventIdentity(normalized);
  const dedupeKey = buildWebhookDedupeKey(
    eventIdentity
      ? `event-id:${eventIdentity}:body:${hashWebhookBody(rawBody)}`
      : `raw:${rawBody}`,
    routingToken,
    normalized.event,
  );
  const queuedAt = Date.now();
  try {
    let queueId = 0;
    const queued = enqueueWebhookTask(async () => {
      const startedAt = Date.now();
      try {
        await processWuzapiWebhook(payload, routingToken ? { token: routingToken } : {});
        logBotEventsDebug("[bot-events webhook] processed async", {
          queueId,
          waitMs: Math.max(0, startedAt - queuedAt),
          durationMs: Date.now() - startedAt,
          queue: getWebhookQueueStats(isolationKey),
        });
      } catch (error) {
        if (error instanceof BotEventError) {
          if (EXPECTED_BOT_EVENT_ERROR_STATUSES.has(error.status)) {
            if (shouldLogExpectedBotEventError(error.status, error.message, sourceIp)) {
              console.log("[bot-events webhook] ignored expected bot event", {
                queueId,
                status: error.status,
                message: error.message,
                receivedAt,
                sourceIp,
                queue: getWebhookQueueStats(isolationKey),
              });
            }
          } else {
            console.error("[bot-events webhook] bot event error (async)", {
              queueId,
              status: error.status,
              message: error.message,
              receivedAt,
              sourceIp,
              queue: getWebhookQueueStats(isolationKey),
            });
          }
          return;
        }

        console.error("[bot-events webhook] unexpected error (async)", {
          queueId,
          error,
          receivedAt,
          sourceIp,
          queue: getWebhookQueueStats(isolationKey),
        });
      }
    }, { priority, dedupeKey, isolationKey });
    queueId = queued.id;

    const acceptedAt = Date.now();
    return NextResponse.json(
      {
        ok: true,
        accepted: true,
        deduplicated: queued.deduplicated,
        queueId,
        priority,
        queuedMs: Math.max(0, acceptedAt - queuedAt),
        queue: getWebhookQueueStats(isolationKey),
      },
      { status: 202 },
    );
  } catch (error) {
    if (historicalReplay) {
      // Do not acknowledge a historical item that was not queued. EasyZap
      // serializes replays and retries 503 responses, providing lossless
      // backpressure while live messages retain queue priority.
      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          message: "Fila de histórico ocupada. Reenvie este item.",
          priority,
          queue: getWebhookQueueStats(isolationKey),
        },
        { status: 503 },
      );
    }
    if (priority === "low") {
      // Presença, recibos e sincronizações antigas não podem provocar uma
      // tempestade de retentativas no EasyZap quando a fila está ocupada.
      // A fila já contabiliza o descarte; confirme o recebimento e preserve
      // capacidade para mensagens e comandos ao vivo.
      return NextResponse.json(
        {
          ok: true,
          accepted: true,
          dropped: true,
          reason: "low_priority_backpressure",
          priority,
          queue: getWebhookQueueStats(isolationKey),
        },
        { status: 202 },
      );
    }
    console.error("[bot-events webhook] busy", {
      error: error instanceof Error ? error.message : String(error),
      queue: getWebhookQueueStats(isolationKey),
    });
    return NextResponse.json(
      { ok: false, message: "Servidor ocupado. Tente novamente em instantes." },
      { status: 503 },
    );
  }

}

export async function GET() {
  return new Response("ok");
}
