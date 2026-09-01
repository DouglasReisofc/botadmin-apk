import os from "os";

const parseNumber = (value: string | undefined | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const CPU_COUNT = (() => {
  try {
    const cpus = os.cpus();
    return Array.isArray(cpus) && cpus.length > 0 ? cpus.length : 4;
  } catch {
    return 4;
  }
})();

const DEFAULT_CONCURRENCY = Math.max(8, Math.min(32, CPU_COUNT * 2));
const MAX_CONCURRENT_WEBHOOKS = parseNumber(process.env.BOT_EVENT_CONCURRENCY, DEFAULT_CONCURRENCY);
const MAX_CONCURRENT_PER_INSTANCE = Math.min(
  MAX_CONCURRENT_WEBHOOKS,
  parseNumber(process.env.BOT_EVENT_INSTANCE_CONCURRENCY, 2),
);
const MAX_QUEUE_SIZE_PER_INSTANCE = parseNumber(
  process.env.BOT_EVENT_INSTANCE_QUEUE_LIMIT ?? process.env.BOT_EVENT_QUEUE_LIMIT,
  512,
);
const JOB_ALERT_TIMEOUT_MS = parseNumber(process.env.BOT_EVENT_JOB_ALERT_TIMEOUT_MS, 180_000);
const DEFAULT_ISOLATION_KEY = "__unscoped__";

export type WebhookQueuePriority = "high" | "normal" | "low";

type QueueEntry = {
  id: number;
  task: () => Promise<void>;
  priority: WebhookQueuePriority;
  dedupeKey: string | null;
  isolationKey: string;
};

type InstanceQueue = {
  activeCount: number;
  waitingQueues: Record<WebhookQueuePriority, QueueEntry[]>;
};

type EnqueueWebhookTaskOptions = {
  priority?: WebhookQueuePriority;
  dedupeKey?: string | null;
  isolationKey?: string | null;
};

type RecentQueueEntry = {
  id: number;
  expiresAt: number;
};

const DEDUPE_TTL_MS = parseNumber(process.env.BOT_EVENT_QUEUE_DEDUPE_TTL_MS, 5 * 60_000);
const DEDUPE_MAX_ENTRIES = parseNumber(process.env.BOT_EVENT_QUEUE_DEDUPE_MAX, 20_000);

let activeCount = 0;
let nextJobId = 0;
let acceptedCount = 0;
let processedCount = 0;
let failedCount = 0;
let droppedCount = 0;
let deduplicatedCount = 0;
let evictedLowPriorityCount = 0;
let nextInstanceIndex = 0;

const instanceQueues = new Map<string, InstanceQueue>();
const instanceOrder: string[] = [];
const recentEntries = new Map<string, RecentQueueEntry>();

const createInstanceQueue = (): InstanceQueue => ({
  activeCount: 0,
  waitingQueues: { high: [], normal: [], low: [] },
});

const getInstanceQueue = (isolationKey: string): InstanceQueue => {
  const existing = instanceQueues.get(isolationKey);
  if (existing) return existing;
  const created = createInstanceQueue();
  instanceQueues.set(isolationKey, created);
  instanceOrder.push(isolationKey);
  return created;
};

const getInstanceWaitingCount = (queue: InstanceQueue) =>
  queue.waitingQueues.high.length + queue.waitingQueues.normal.length + queue.waitingQueues.low.length;

const getWaitingCount = () => {
  let total = 0;
  for (const queue of instanceQueues.values()) total += getInstanceWaitingCount(queue);
  return total;
};

const pruneRecentEntries = (now = Date.now()) => {
  if (recentEntries.size < DEDUPE_MAX_ENTRIES) return;
  for (const [key, entry] of recentEntries) {
    if (entry.expiresAt <= now || recentEntries.size >= DEDUPE_MAX_ENTRIES) {
      recentEntries.delete(key);
    }
  }
};

const takeFromInstance = (queue: InstanceQueue): QueueEntry | undefined =>
  queue.waitingQueues.high.shift() ??
  queue.waitingQueues.normal.shift() ??
  queue.waitingQueues.low.shift();

const takeNextEntry = (): { entry: QueueEntry; queue: InstanceQueue } | undefined => {
  const instanceCount = instanceOrder.length;
  if (instanceCount === 0) return undefined;

  for (let checked = 0; checked < instanceCount; checked += 1) {
    if (nextInstanceIndex >= instanceOrder.length) nextInstanceIndex = 0;
    const isolationKey = instanceOrder[nextInstanceIndex];
    nextInstanceIndex = (nextInstanceIndex + 1) % instanceOrder.length;
    const queue = instanceQueues.get(isolationKey);
    if (!queue || queue.activeCount >= MAX_CONCURRENT_PER_INSTANCE) continue;
    const entry = takeFromInstance(queue);
    if (entry) return { entry, queue };
  }

  return undefined;
};

const evictForPriority = (queue: InstanceQueue, priority: WebhookQueuePriority): boolean => {
  const candidates: WebhookQueuePriority[] =
    priority === "high" ? ["low", "normal"] : priority === "normal" ? ["low"] : [];
  for (const candidate of candidates) {
    const evicted = queue.waitingQueues[candidate].pop();
    if (!evicted) continue;
    if (evicted.dedupeKey) recentEntries.delete(evicted.dedupeKey);
    droppedCount += 1;
    evictedLowPriorityCount += 1;
    return true;
  }
  return false;
};

const runEntry = (entry: QueueEntry, queue: InstanceQueue) => {
  activeCount += 1;
  queue.activeCount += 1;
  let alertTimer: NodeJS.Timeout | undefined;
  const startedAt = Date.now();

  if (JOB_ALERT_TIMEOUT_MS > 0) {
    alertTimer = setTimeout(() => {
      console.log("[bot-events queue] job still running", {
        id: entry.id,
        runtimeMs: Date.now() - startedAt,
        queue: getWebhookQueueStats(entry.isolationKey),
      });
    }, JOB_ALERT_TIMEOUT_MS);
    alertTimer.unref?.();
  }

  Promise.resolve()
    .then(() => entry.task())
    .then(() => {
      processedCount += 1;
    })
    .catch((error) => {
      failedCount += 1;
      console.error("[bot-events queue] job failed", {
        id: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      if (alertTimer) clearTimeout(alertTimer);
      activeCount = Math.max(0, activeCount - 1);
      queue.activeCount = Math.max(0, queue.activeCount - 1);
      scheduleNext();
    });
};

const scheduleNext = () => {
  while (activeCount < MAX_CONCURRENT_WEBHOOKS) {
    const next = takeNextEntry();
    if (!next) return;
    runEntry(next.entry, next.queue);
  }
};

export const enqueueWebhookTask = (
  task: () => Promise<void>,
  options: EnqueueWebhookTaskOptions = {},
) => {
  const priority = options.priority ?? "normal";
  const dedupeKey = options.dedupeKey?.trim() || null;
  const isolationKey = options.isolationKey?.trim() || DEFAULT_ISOLATION_KEY;
  const queue = getInstanceQueue(isolationKey);
  const now = Date.now();

  if (dedupeKey) {
    const recent = recentEntries.get(dedupeKey);
    if (recent && recent.expiresAt > now) {
      deduplicatedCount += 1;
      return { id: recent.id, deduplicated: true };
    }
    if (recent) recentEntries.delete(dedupeKey);
  }

  if (
    getInstanceWaitingCount(queue) >= MAX_QUEUE_SIZE_PER_INSTANCE &&
    !evictForPriority(queue, priority)
  ) {
    droppedCount += 1;
    throw new Error("BOT_EVENT_INSTANCE_QUEUE_FULL");
  }

  const entry: QueueEntry = {
    id: ++nextJobId,
    task,
    priority,
    dedupeKey,
    isolationKey,
  };

  queue.waitingQueues[priority].push(entry);
  if (dedupeKey) {
    pruneRecentEntries(now);
    recentEntries.set(dedupeKey, { id: entry.id, expiresAt: now + DEDUPE_TTL_MS });
  }
  acceptedCount += 1;
  scheduleNext();
  return { id: entry.id, deduplicated: false };
};

export const getWebhookQueueStats = (isolationKey?: string | null) => {
  const scopedKey = isolationKey?.trim() || null;
  const scoped = scopedKey ? instanceQueues.get(scopedKey) : undefined;
  let waitingHigh = 0;
  let waitingNormal = 0;
  let waitingLow = 0;
  let maxInstanceWaiting = 0;
  for (const queue of instanceQueues.values()) {
    waitingHigh += queue.waitingQueues.high.length;
    waitingNormal += queue.waitingQueues.normal.length;
    waitingLow += queue.waitingQueues.low.length;
    maxInstanceWaiting = Math.max(maxInstanceWaiting, getInstanceWaitingCount(queue));
  }

  return {
    active: activeCount,
    waiting: getWaitingCount(),
    waitingHigh,
    waitingNormal,
    waitingLow,
    maxConcurrent: MAX_CONCURRENT_WEBHOOKS,
    maxConcurrentPerInstance: MAX_CONCURRENT_PER_INSTANCE,
    maxQueue: MAX_QUEUE_SIZE_PER_INSTANCE,
    maxQueuePerInstance: MAX_QUEUE_SIZE_PER_INSTANCE,
    instances: instanceQueues.size,
    maxInstanceWaiting,
    accepted: acceptedCount,
    processed: processedCount,
    failed: failedCount,
    dropped: droppedCount,
    deduplicated: deduplicatedCount,
    evictedLowPriority: evictedLowPriorityCount,
    instance: scoped
      ? {
          active: scoped.activeCount,
          waiting: getInstanceWaitingCount(scoped),
          waitingHigh: scoped.waitingQueues.high.length,
          waitingNormal: scoped.waitingQueues.normal.length,
          waitingLow: scoped.waitingQueues.low.length,
        }
      : null,
  };
};
