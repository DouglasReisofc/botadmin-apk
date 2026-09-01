import { Queue } from "bullmq";

import { getRedisPrefix, isRedisEnabled } from "lib/redis";

type QueueName = "group-participant-import" | "chatgpt-phone";

declare global {
  var __botadmBullQueues: Map<string, Queue> | undefined;
}

const DEFAULT_REDIS_URL = "redis://127.0.0.1:7779/0";

const parseRedisConnection = () => {
  const url = new URL((process.env.REDIS_URL ?? DEFAULT_REDIS_URL).trim() || DEFAULT_REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) || 0 : 0,
  };
};

const queues = () => {
  if (!globalThis.__botadmBullQueues) {
    globalThis.__botadmBullQueues = new Map();
  }
  return globalThis.__botadmBullQueues;
};

const safeJobId = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-");

export const getQueue = (name: QueueName) => {
  if (!isRedisEnabled()) return null;
  const fullName = `${getRedisPrefix()}:${name}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
  const existing = queues().get(fullName);
  if (existing) return existing;
  const queue = new Queue(fullName, {
    connection: parseRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: 500,
      removeOnFail: 1000,
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
    },
  });
  queues().set(fullName, queue);
  return queue;
};

export const enqueueGroupParticipantImportJobSignal = async (jobId: number) => {
  const queue = getQueue("group-participant-import");
  if (!queue) return;
  try {
    await queue.add("job-created", { jobId }, { jobId: safeJobId(`group-participant-import-${jobId}`) });
  } catch (error) {
    console.warn("[queue] failed to signal group participant import job", { jobId, error });
  }
};

export const enqueueChatGptPhoneJobSignal = async (jobId: string) => {
  const queue = getQueue("chatgpt-phone");
  if (!queue) return;
  try {
    await queue.add("job-created", { jobId }, { jobId: safeJobId(`chatgpt-phone-${jobId}`) });
  } catch (error) {
    console.warn("[queue] failed to signal chatgpt phone job", { jobId, error });
  }
};

export const closeQueues = async () => {
  const activeQueues = [...queues().values()];
  await Promise.all(activeQueues.map((queue) => queue.close().catch(() => {})));
  queues().clear();
};
