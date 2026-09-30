import { getDb } from "lib/db";
import { deleteMessageForEveryone, type WuzapiClient } from "lib/wuzapi";
import {
  redisKey,
  redisSetIfAbsent,
  redisZAdd,
  redisZRangeByScore,
  redisZRem,
} from "lib/redis";

type DeleteRetry = {
  userId: number;
  instanceId: number;
  chatId: string;
  messageId: string;
  participantCandidates: Array<string | null | undefined>;
  reason: string;
  attempts: number;
  createdAt: string;
};

const QUEUE = redisKey("moderation", "message-delete-retries");
const MAX_ATTEMPTS = 12;
const MAX_AGE_MS = 24 * 60 * 60_000;
const retryDelay = (attempt: number) => Math.min(15 * 60_000, 2_000 * (2 ** Math.min(attempt, 8)));

const memberFor = (job: DeleteRetry) => JSON.stringify(job);

export const enqueueModerationDeleteRetry = async (input: Omit<DeleteRetry, "attempts" | "createdAt">) => {
  if (!input.messageId || !input.chatId.endsWith("@g.us")) return;
  const job: DeleteRetry = { ...input, attempts: 0, createdAt: new Date().toISOString() };
  await redisZAdd(QUEUE, Date.now() + 2_000, memberFor(job));
};

const tryDelete = async (client: WuzapiClient, job: DeleteRetry) => {
  const candidates = Array.from(new Set(job.participantCandidates.filter(Boolean).map(String)));
  for (const participant of [...candidates, null]) {
    try {
      await deleteMessageForEveryone(client, {
        chatId: job.chatId,
        messageId: job.messageId,
        participant,
        fromMe: false,
      });
      return true;
    } catch {
      // Try the next participant representation; WuzAPI differs by provider.
    }
  }
  return false;
};

export const runModerationDeleteRetryCycle = async () => {
  const members = await redisZRangeByScore(QUEUE, Date.now(), 25);
  for (const member of members) {
    let job: DeleteRetry;
    try { job = JSON.parse(member) as DeleteRetry; } catch { await redisZRem(QUEUE, member); continue; }
    if (!job.messageId || Date.now() - Date.parse(job.createdAt) > MAX_AGE_MS || job.attempts >= MAX_ATTEMPTS) {
      await redisZRem(QUEUE, member);
      continue;
    }
    const lockKey = redisKey("moderation", "message-delete-lock", job.instanceId, job.messageId);
    const locked = await redisSetIfAbsent(lockKey, process.pid.toString(), 30_000);
    if (locked !== true) continue;
    try {
      const [rows] = await getDb().query<Array<{ base_url: string | null; token: string | null; session_status: string | null }>>(
        "SELECT base_url, token, session_status FROM bot_instances WHERE id = ? LIMIT 1", [job.instanceId],
      );
      const row = rows[0];
      if (row?.base_url && row.token && String(row.session_status).toLowerCase() === "conectado") {
        const deleted = await tryDelete({ baseUrl: row.base_url, token: row.token }, job);
        if (deleted) {
          await redisZRem(QUEUE, member);
          console.info("[moderation-delete-queue] mensagem removida", { instanceId: job.instanceId, messageId: job.messageId, reason: job.reason });
          continue;
        }
      }
      const next = { ...job, attempts: job.attempts + 1 };
      await redisZRem(QUEUE, member);
      await redisZAdd(QUEUE, Date.now() + retryDelay(next.attempts), memberFor(next));
      console.warn("[moderation-delete-queue] nova tentativa agendada", { instanceId: job.instanceId, messageId: job.messageId, attempt: next.attempts });
    } finally {
      // The short lock expires automatically; no persistent failure marker is left.
    }
  }
};

let started = false;
export const startModerationDeleteRetryDispatcher = () => {
  if (started) return;
  started = true;
  void runModerationDeleteRetryCycle();
  const timer = setInterval(() => void runModerationDeleteRetryCycle(), 5_000);
  timer.unref?.();
};
