import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureBotGroupTable, ensureUserTable, getDb } from "lib/db";
import { getGroupByIdForUser, syncGroupInfo } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import { addGroupParticipants } from "lib/wuzapi";
import { enqueueGroupParticipantImportJobSignal } from "lib/queues";

const TABLE_NAME = "bot_group_participant_import_jobs";
const MIN_DIGITS_LENGTH = 8;
const DEFAULT_DELAY_MS = 6500;
const DEFAULT_JITTER_MS = 3000;
const DEFAULT_BATCH_SIZE = 2;
const DEFAULT_MAX_MEMBERS = 0;
const MIN_DELAY_MS = 1200;
const MAX_DELAY_MS = 60_000;
const MAX_JITTER_MS = 30_000;
const MAX_BATCH_SIZE = 5;
const MAX_MEMBERS_LIMIT = 5000;
const RESYNC_EVERY_BATCHES = 8;
const JOB_SCAN_BATCH = 12;
const JOB_SCAN_INTERVAL_MS = 7000;
const MAX_ERROR_LENGTH = 500;

export type GroupParticipantImportJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export type GroupParticipantImportJobSummary = {
  id: number;
  userId: number;
  targetGroupId: number;
  targetGroupName: string | null;
  sourceGroupId: number;
  sourceGroupName: string | null;
  targetInstanceId: number;
  status: GroupParticipantImportJobStatus;
  cancelRequested: boolean;
  excludeAdmins: boolean;
  delayMs: number;
  jitterMs: number;
  batchSize: number;
  maxMembers: number;
  sourceTotal: number;
  totalCandidates: number;
  pendingCount: number;
  processedCount: number;
  addedCount: number;
  failedCount: number;
  ignoredAdmins: number;
  ignoredInvalid: number;
  ignoredAlreadyInTarget: number;
  ignoredOwnInstance: number;
  queueTrimmedCount: number;
  progressPercent: number;
  lastError: string | null;
  lastMessage: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
};

export class GroupParticipantImportJobError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GroupParticipantImportJobError";
    this.status = status;
  }
}

type GroupParticipantImportJobRow = RowDataPacket & {
  id: number;
  user_id: number;
  target_group_id: number;
  target_group_name: string | null;
  source_group_id: number;
  source_group_name: string | null;
  target_instance_id: number;
  status: GroupParticipantImportJobStatus;
  cancel_requested: number | boolean;
  exclude_admins: number | boolean;
  delay_ms: number;
  jitter_ms: number;
  batch_size: number;
  max_members: number;
  source_total: number;
  total_candidates: number;
  pending_queue_json: string | null;
  processed_count: number;
  added_count: number;
  failed_count: number;
  ignored_admins: number;
  ignored_invalid: number;
  ignored_already_in_target: number;
  ignored_own_instance: number;
  queue_trimmed_count: number;
  last_error: string | null;
  last_message: string | null;
  created_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  updated_at: Date | string | null;
};

type StartJobPayload = {
  userId: number;
  targetGroupId: number;
  sourceGroupId: number;
  excludeAdmins?: unknown;
  delayMs?: unknown;
  jitterMs?: unknown;
  batchSize?: unknown;
  maxMembers?: unknown;
};

const ACTIVE_STATUS_SET = new Set<GroupParticipantImportJobStatus>([
  "queued",
  "running",
  "paused",
  "cancelling",
]);

const RUNNABLE_STATUS_SET = new Set<GroupParticipantImportJobStatus>([
  "queued",
  "running",
  "cancelling",
]);

const TERMINAL_STATUS_SET = new Set<GroupParticipantImportJobStatus>([
  "completed",
  "cancelled",
  "failed",
]);

const ensureTasks = new Map<string, Promise<void>>();
const ensureDone = new Set<string>();

const runtime = globalThis as typeof globalThis & {
  __groupParticipantImportRunningJobIds?: Set<number>;
  __groupParticipantImportDispatcherStarted?: boolean;
};

const runningJobIds = runtime.__groupParticipantImportRunningJobIds ?? new Set<number>();
runtime.__groupParticipantImportRunningJobIds = runningJobIds;

let dispatcherStarted = runtime.__groupParticipantImportDispatcherStarted ?? false;

const runEnsure = (key: string, ensureFn: () => Promise<void>): Promise<void> => {
  if (ensureDone.has(key)) return Promise.resolve();
  const active = ensureTasks.get(key);
  if (active) return active;
  const task = ensureFn()
    .then(() => {
      ensureDone.add(key);
      ensureTasks.delete(key);
    })
    .catch((error) => {
      ensureTasks.delete(key);
      throw error;
    });
  ensureTasks.set(key, task);
  return task;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const toTimestampMs = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const toBool = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return fallback;
};

const normalizeJobStatus = (value: unknown): GroupParticipantImportJobStatus | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "queued" ||
    normalized === "running" ||
    normalized === "paused" ||
    normalized === "cancelling" ||
    normalized === "completed" ||
    normalized === "cancelled" ||
    normalized === "failed"
  ) {
    return normalized;
  }
  return null;
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const normalizeOptionalMaxMembers = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_MEMBERS;
  if (parsed <= 0) return 0;
  return Math.max(1, Math.min(MAX_MEMBERS_LIMIT, Math.floor(parsed)));
};

const sanitizeError = (value: unknown): string | null => {
  const message =
    value instanceof Error ? value.message : typeof value === "string" ? value : String(value ?? "");
  const normalized = message.trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_ERROR_LENGTH);
};

const sanitizeDigits = (value: string): string => value.replace(/\D/g, "").trim();

const normalizeIdentityDigits = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.includes("@")) {
    const [localPart] = normalized.split("@");
    return sanitizeDigits((localPart ?? "").split(":")[0] ?? "");
  }
  return sanitizeDigits(normalized.split(":")[0] ?? "");
};

const hasPhoneDigitsMatch = (left: string, right: string): boolean => {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= MIN_DIGITS_LENGTH && right.length >= MIN_DIGITS_LENGTH) {
    return left.endsWith(right) || right.endsWith(left);
  }
  return false;
};

const parsePendingQueue = (value: string | null | undefined): string[] => {
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => sanitizeDigits(String(entry ?? "")))
      .filter((digits) => digits.length >= MIN_DIGITS_LENGTH);
  } catch {
    return [];
  }
};

const serializePendingQueue = (queue: string[]): string => {
  return JSON.stringify(
    queue
      .map((entry) => sanitizeDigits(String(entry ?? "")))
      .filter((digits) => digits.length >= MIN_DIGITS_LENGTH),
  );
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const randomDelay = (baseDelayMs: number, jitterMs: number): number => {
  const boundedBase = Math.max(MIN_DELAY_MS, baseDelayMs);
  if (jitterMs <= 0) return boundedBase;
  const delta = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
  return Math.max(MIN_DELAY_MS, boundedBase + delta);
};

const randomCadenceDelay = (baseDelayMs: number, jitterMs: number): number => {
  const base = randomDelay(baseDelayMs, jitterMs);
  if (Math.random() < 0.16) {
    const multiplier = 1.2 + Math.random() * 0.9;
    return Math.min(MAX_DELAY_MS, Math.floor(base * multiplier));
  }
  return base;
};

const randomBatchSize = (maxBatchSize: number): number => {
  const bounded = Math.max(1, maxBatchSize);
  if (bounded <= 1) return 1;
  return 1 + Math.floor(Math.random() * bounded);
};

const computeProgressPercent = (processedCount: number, totalCandidates: number): number => {
  if (!Number.isFinite(totalCandidates) || totalCandidates <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((processedCount / totalCandidates) * 100)));
};

const mapJobRow = (row: GroupParticipantImportJobRow): GroupParticipantImportJobSummary => {
  const pendingQueue = parsePendingQueue(row.pending_queue_json);
  const totalCandidates = Math.max(0, Number(row.total_candidates || 0));
  const processedCount = Math.max(0, Number(row.processed_count || 0));
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    targetGroupId: Number(row.target_group_id),
    targetGroupName: row.target_group_name ?? null,
    sourceGroupId: Number(row.source_group_id),
    sourceGroupName: row.source_group_name ?? null,
    targetInstanceId: Number(row.target_instance_id),
    status: row.status,
    cancelRequested: toBool(row.cancel_requested, false),
    excludeAdmins: toBool(row.exclude_admins, true),
    delayMs: Math.max(MIN_DELAY_MS, Number(row.delay_ms || DEFAULT_DELAY_MS)),
    jitterMs: Math.max(0, Number(row.jitter_ms || DEFAULT_JITTER_MS)),
    batchSize: Math.max(1, Number(row.batch_size || DEFAULT_BATCH_SIZE)),
    maxMembers: Math.max(0, Number(row.max_members || DEFAULT_MAX_MEMBERS)),
    sourceTotal: Math.max(0, Number(row.source_total || 0)),
    totalCandidates,
    pendingCount: pendingQueue.length,
    processedCount,
    addedCount: Math.max(0, Number(row.added_count || 0)),
    failedCount: Math.max(0, Number(row.failed_count || 0)),
    ignoredAdmins: Math.max(0, Number(row.ignored_admins || 0)),
    ignoredInvalid: Math.max(0, Number(row.ignored_invalid || 0)),
    ignoredAlreadyInTarget: Math.max(0, Number(row.ignored_already_in_target || 0)),
    ignoredOwnInstance: Math.max(0, Number(row.ignored_own_instance || 0)),
    queueTrimmedCount: Math.max(0, Number(row.queue_trimmed_count || 0)),
    progressPercent: computeProgressPercent(processedCount, totalCandidates),
    lastError: row.last_error ?? null,
    lastMessage: row.last_message ?? null,
    createdAt: toIso(row.created_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    updatedAt: toIso(row.updated_at),
  };
};

const ensureJobsTable = async () =>
  runEnsure("group-participant-import-jobs-table", async () => {
    await ensureUserTable();
    await ensureBotGroupTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        target_group_id INT NOT NULL,
        target_group_name VARCHAR(255) NULL,
        source_group_id INT NOT NULL,
        source_group_name VARCHAR(255) NULL,
        target_instance_id INT NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'queued',
        cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
        exclude_admins TINYINT(1) NOT NULL DEFAULT 1,
        delay_ms INT NOT NULL DEFAULT 6500,
        jitter_ms INT NOT NULL DEFAULT 3000,
        batch_size INT NOT NULL DEFAULT 2,
        max_members INT NOT NULL DEFAULT 0,
        source_total INT NOT NULL DEFAULT 0,
        total_candidates INT NOT NULL DEFAULT 0,
        pending_queue_json LONGTEXT NULL,
        processed_count INT NOT NULL DEFAULT 0,
        added_count INT NOT NULL DEFAULT 0,
        failed_count INT NOT NULL DEFAULT 0,
        ignored_admins INT NOT NULL DEFAULT 0,
        ignored_invalid INT NOT NULL DEFAULT 0,
        ignored_already_in_target INT NOT NULL DEFAULT 0,
        ignored_own_instance INT NOT NULL DEFAULT 0,
        queue_trimmed_count INT NOT NULL DEFAULT 0,
        last_error VARCHAR(500) NULL,
        last_message VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME NULL,
        finished_at DATETIME NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_group_participant_import_user_target (user_id, target_group_id, created_at),
        KEY idx_group_participant_import_status (status, updated_at),
        CONSTRAINT fk_group_participant_import_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [rows] = await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${TABLE_NAME} LIKE ?`, [column]);
      if (!Array.isArray(rows) || rows.length === 0) {
        await db.query(`ALTER TABLE ${TABLE_NAME} ADD COLUMN ${definition};`);
      }
    };

    await ensureColumn("pending_queue_json", "pending_queue_json LONGTEXT NULL AFTER total_candidates");
    await ensureColumn("source_total", "source_total INT NOT NULL DEFAULT 0 AFTER max_members");
    await ensureColumn("cancel_requested", "cancel_requested TINYINT(1) NOT NULL DEFAULT 0 AFTER status");
    await ensureColumn("last_error", "last_error VARCHAR(500) NULL AFTER queue_trimmed_count");
    await ensureColumn("last_message", "last_message VARCHAR(500) NULL AFTER last_error");
    await ensureColumn("started_at", "started_at DATETIME NULL AFTER created_at");
    await ensureColumn("finished_at", "finished_at DATETIME NULL AFTER started_at");
  });

const loadJobRowById = async (jobId: number): Promise<GroupParticipantImportJobRow | null> => {
  await ensureJobsTable();
  const db = getDb();
  const [rows] = await db.query<GroupParticipantImportJobRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE id = ?
      LIMIT 1
    `,
    [jobId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
};

const loadJobRowByIdForUser = async (
  userId: number,
  jobId: number,
): Promise<GroupParticipantImportJobRow | null> => {
  await ensureJobsTable();
  const db = getDb();
  const [rows] = await db.query<GroupParticipantImportJobRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [jobId, userId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
};

const loadActiveJobRowForTarget = async (
  userId: number,
  targetGroupId: number,
): Promise<GroupParticipantImportJobRow | null> => {
  await ensureJobsTable();
  const db = getDb();
  const [rows] = await db.query<GroupParticipantImportJobRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ?
        AND target_group_id = ?
        AND status IN ('queued', 'running', 'paused', 'cancelling')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId, targetGroupId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
};

export const getLatestGroupParticipantImportJobForTarget = async (
  userId: number,
  targetGroupId: number,
): Promise<GroupParticipantImportJobSummary | null> => {
  await ensureJobsTable();
  const db = getDb();
  const [rows] = await db.query<GroupParticipantImportJobRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND target_group_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId, targetGroupId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapJobRow(rows[0]);
};

const markJobFailed = async (jobId: number, error: unknown): Promise<void> => {
  const db = getDb();
  const message = sanitizeError(error) || "Falha ao executar importação de membros.";
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        status = 'failed',
        last_error = ?,
        last_message = 'Importação encerrada com falha.',
        finished_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [message, jobId],
  );
};

const markJobCancelled = async (
  jobId: number,
  pendingQueue: string[],
  message = "Importação cancelada pelo administrador.",
): Promise<void> => {
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        status = 'cancelled',
        last_message = ?,
        pending_queue_json = ?,
        finished_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [message.slice(0, 500), serializePendingQueue(pendingQueue), jobId],
  );
};

const markJobCompleted = async (
  jobId: number,
  message: string,
): Promise<void> => {
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        status = 'completed',
        last_message = ?,
        pending_queue_json = '[]',
        finished_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [message.slice(0, 500), jobId],
  );
};

const updateJobProgress = async (params: {
  jobId: number;
  status: GroupParticipantImportJobStatus;
  pendingQueue: string[];
  processedCount: number;
  addedCount: number;
  failedCount: number;
  ignoredAlreadyInTarget: number;
  lastMessage: string;
}): Promise<void> => {
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        status = ?,
        pending_queue_json = ?,
        processed_count = ?,
        added_count = ?,
        failed_count = ?,
        ignored_already_in_target = ?,
        last_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      params.status,
      serializePendingQueue(params.pendingQueue),
      params.processedCount,
      params.addedCount,
      params.failedCount,
      params.ignoredAlreadyInTarget,
      params.lastMessage.slice(0, 500),
      params.jobId,
    ],
  );
};

const buildCandidateQueue = (params: {
  sourceParticipants: Array<{ id: string; admin: "member" | "admin" | "superadmin" }>;
  targetParticipants: Array<{ id: string }>;
  instancePhone: string | null | undefined;
  excludeAdmins: boolean;
  maxMembers: number;
}): {
  queue: string[];
  sourceTotal: number;
  ignoredAdmins: number;
  ignoredInvalid: number;
  ignoredAlreadyInTarget: number;
  ignoredOwnInstance: number;
  queueTrimmedCount: number;
  knownTargetDigits: string[];
} => {
  const sourceParticipants = Array.isArray(params.sourceParticipants) ? params.sourceParticipants : [];
  const targetParticipants = Array.isArray(params.targetParticipants) ? params.targetParticipants : [];
  const knownTargetDigits = targetParticipants
    .map((participant) => normalizeIdentityDigits(participant.id))
    .filter((digits) => digits.length >= MIN_DIGITS_LENGTH);
  const instanceDigits = sanitizeDigits(params.instancePhone ?? "");

  const queue: string[] = [];
  const seenSourceDigits = new Set<string>();
  let ignoredAdmins = 0;
  let ignoredInvalid = 0;
  let ignoredAlreadyInTarget = 0;
  let ignoredOwnInstance = 0;

  for (const participant of sourceParticipants) {
    if (!participant || typeof participant !== "object") continue;
    if (params.excludeAdmins && participant.admin !== "member") {
      ignoredAdmins += 1;
      continue;
    }

    const digits = normalizeIdentityDigits(String(participant.id ?? ""));
    if (digits.length < MIN_DIGITS_LENGTH) {
      ignoredInvalid += 1;
      continue;
    }
    if (instanceDigits && hasPhoneDigitsMatch(digits, instanceDigits)) {
      ignoredOwnInstance += 1;
      continue;
    }
    if (knownTargetDigits.some((targetDigits) => hasPhoneDigitsMatch(digits, targetDigits))) {
      ignoredAlreadyInTarget += 1;
      continue;
    }
    if (seenSourceDigits.has(digits)) {
      continue;
    }
    seenSourceDigits.add(digits);
    queue.push(digits);
  }

  const limitedQueue =
    params.maxMembers > 0 ? queue.slice(0, params.maxMembers) : queue;
  const queueTrimmedCount = Math.max(0, queue.length - limitedQueue.length);

  return {
    queue: limitedQueue,
    sourceTotal: sourceParticipants.length,
    ignoredAdmins,
    ignoredInvalid,
    ignoredAlreadyInTarget,
    ignoredOwnInstance,
    queueTrimmedCount,
    knownTargetDigits,
  };
};

const loadRuntimeState = async (jobId: number): Promise<{
  cancelRequested: boolean;
  status: GroupParticipantImportJobStatus | null;
  delayMs: number;
  jitterMs: number;
  batchSize: number;
}> => {
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT cancel_requested, status, delay_ms, jitter_ms, batch_size
      FROM ${TABLE_NAME}
      WHERE id = ?
      LIMIT 1
    `,
    [jobId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      cancelRequested: true,
      status: null,
      delayMs: DEFAULT_DELAY_MS,
      jitterMs: DEFAULT_JITTER_MS,
      batchSize: DEFAULT_BATCH_SIZE,
    };
  }

  return {
    cancelRequested: toBool(rows[0].cancel_requested, false),
    status: normalizeJobStatus(rows[0].status),
    delayMs: clampInt(rows[0].delay_ms, MIN_DELAY_MS, MAX_DELAY_MS, DEFAULT_DELAY_MS),
    jitterMs: clampInt(rows[0].jitter_ms, 0, MAX_JITTER_MS, DEFAULT_JITTER_MS),
    batchSize: clampInt(rows[0].batch_size, 1, MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE),
  };
};

const runGroupParticipantImportJob = async (jobId: number): Promise<void> => {
  await ensureJobsTable();
  const db = getDb();
  let job = await loadJobRowById(jobId);
  if (!job || TERMINAL_STATUS_SET.has(job.status)) {
    return;
  }

  try {
    if (job.status === "queued" || job.status === "cancelling") {
      await db.query(
        `
          UPDATE ${TABLE_NAME}
          SET
            status = ?,
            started_at = COALESCE(started_at, NOW()),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [job.cancel_requested ? "cancelling" : "running", jobId],
      );
      job = await loadJobRowById(jobId);
    }

    if (!job) return;
    if (job.cancel_requested) {
      await markJobCancelled(jobId, parsePendingQueue(job.pending_queue_json));
      return;
    }

    const userId = Number(job.user_id);
    const targetGroupId = Number(job.target_group_id);
    const sourceGroupId = Number(job.source_group_id);

    await Promise.all([
      syncGroupInfo(userId, targetGroupId, { force: true }).catch(() => {}),
      syncGroupInfo(userId, sourceGroupId, { force: true }).catch(() => {}),
    ]);

    let targetGroup = await getGroupByIdForUser(userId, targetGroupId);
    const sourceGroup = await getGroupByIdForUser(userId, sourceGroupId);
    if (!targetGroup || !sourceGroup) {
      throw new GroupParticipantImportJobError("Grupo de origem/destino não encontrado.", 404);
    }
    if (!targetGroup.remoteId) {
      throw new GroupParticipantImportJobError(
        "Sincronize o grupo de destino antes de transferir membros.",
        409,
      );
    }
    if (targetGroup.instanceId <= 0) {
      throw new GroupParticipantImportJobError(
        "O grupo de destino precisa estar vinculado a uma conexão ativa.",
        409,
      );
    }
    const instance = await getInstanceForUser(userId, targetGroup.instanceId);
    if (!instance?.serverBaseUrl || !instance?.token) {
      throw new GroupParticipantImportJobError("Instância da automação indisponível para este grupo.", 409);
    }

    let pendingQueue = parsePendingQueue(job.pending_queue_json);
    let knownTargetDigits: string[] = [];
    let sourceTotal = Number(job.source_total || 0);
    let totalCandidates = Number(job.total_candidates || 0);
    let processedCount = Number(job.processed_count || 0);
    let addedCount = Number(job.added_count || 0);
    let failedCount = Number(job.failed_count || 0);
    let ignoredAlreadyInTarget = Number(job.ignored_already_in_target || 0);

    if (pendingQueue.length === 0 && totalCandidates <= 0) {
      const sourceParticipants = Array.isArray(sourceGroup.participants)
        ? sourceGroup.participants
        : [];
      const targetParticipants = Array.isArray(targetGroup.participants)
        ? targetGroup.participants
        : [];

      const candidateSetup = buildCandidateQueue({
        sourceParticipants,
        targetParticipants,
        instancePhone: instance.phone,
        excludeAdmins: toBool(job.exclude_admins, true),
        maxMembers: Number(job.max_members || 0),
      });
      pendingQueue = candidateSetup.queue;
      knownTargetDigits = [...candidateSetup.knownTargetDigits];
      sourceTotal = candidateSetup.sourceTotal;
      totalCandidates = pendingQueue.length;
      processedCount = 0;
      addedCount = 0;
      failedCount = 0;
      ignoredAlreadyInTarget = candidateSetup.ignoredAlreadyInTarget;

      await db.query(
        `
          UPDATE ${TABLE_NAME}
          SET
            source_total = ?,
            total_candidates = ?,
            pending_queue_json = ?,
            processed_count = 0,
            added_count = 0,
            failed_count = 0,
            ignored_admins = ?,
            ignored_invalid = ?,
            ignored_already_in_target = ?,
            ignored_own_instance = ?,
            queue_trimmed_count = ?,
            last_message = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          sourceTotal,
          totalCandidates,
          serializePendingQueue(pendingQueue),
          candidateSetup.ignoredAdmins,
          candidateSetup.ignoredInvalid,
          candidateSetup.ignoredAlreadyInTarget,
          candidateSetup.ignoredOwnInstance,
          candidateSetup.queueTrimmedCount,
          "Fila de importação preparada e em processamento.",
          jobId,
        ],
      );
    } else {
      knownTargetDigits = (Array.isArray(targetGroup.participants) ? targetGroup.participants : [])
        .map((participant) => normalizeIdentityDigits(participant.id))
        .filter((digits) => digits.length >= MIN_DIGITS_LENGTH);
    }

    if (pendingQueue.length === 0) {
      await markJobCompleted(jobId, "Nenhum membro elegível para adicionar ao grupo de destino.");
      return;
    }

    const client = {
      baseUrl: instance.serverBaseUrl,
      token: instance.token,
    };
    let cycle = 0;

    while (pendingQueue.length > 0) {
      let runtimeState = await loadRuntimeState(jobId);
      if (runtimeState.cancelRequested) {
        await markJobCancelled(jobId, pendingQueue);
        return;
      }
      if (runtimeState.status === "paused") {
        await updateJobProgress({
          jobId,
          status: "paused",
          pendingQueue,
          processedCount,
          addedCount,
          failedCount,
          ignoredAlreadyInTarget,
          lastMessage: "Processo pausado pelo administrador.",
        });
        while (runtimeState.status === "paused") {
          await sleep(1200);
          runtimeState = await loadRuntimeState(jobId);
          if (runtimeState.cancelRequested || runtimeState.status === "cancelled") {
            await markJobCancelled(jobId, pendingQueue);
            return;
          }
        }
      }
      if (runtimeState.cancelRequested) {
        await markJobCancelled(jobId, pendingQueue);
        return;
      }
      const delayMs = runtimeState.delayMs;
      const jitterMs = runtimeState.jitterMs;
      const batchSize = runtimeState.batchSize;

      cycle += 1;
      if (cycle % RESYNC_EVERY_BATCHES === 0) {
        await syncGroupInfo(userId, targetGroupId, { force: true }).catch(() => {});
        targetGroup = await getGroupByIdForUser(userId, targetGroupId);
        if (targetGroup) {
          knownTargetDigits = (Array.isArray(targetGroup.participants) ? targetGroup.participants : [])
            .map((participant) => normalizeIdentityDigits(participant.id))
            .filter((digits) => digits.length >= MIN_DIGITS_LENGTH);
        }
      }

      const dynamicBatchSize = randomBatchSize(batchSize);
      const rawBatch = pendingQueue.splice(0, dynamicBatchSize);
      const attemptBatch: string[] = [];
      for (const participantDigits of rawBatch) {
        if (knownTargetDigits.some((targetDigits) => hasPhoneDigitsMatch(participantDigits, targetDigits))) {
          ignoredAlreadyInTarget += 1;
          processedCount += 1;
          continue;
        }
        attemptBatch.push(participantDigits);
      }

      if (attemptBatch.length > 0) {
        try {
          await addGroupParticipants(client, {
            groupJid: targetGroup!.remoteId,
            participants: attemptBatch,
          });
          for (const participantDigits of attemptBatch) {
            knownTargetDigits.push(participantDigits);
            processedCount += 1;
            addedCount += 1;
          }
        } catch {
          for (let index = 0; index < attemptBatch.length; index += 1) {
            const participantDigits = attemptBatch[index]!;
            const perItemRuntimeState = await loadRuntimeState(jobId);
            if (perItemRuntimeState.cancelRequested || perItemRuntimeState.status === "cancelled") {
              const remainingInCurrentBatch = attemptBatch.slice(index);
              pendingQueue = [...remainingInCurrentBatch, ...pendingQueue];
              await markJobCancelled(jobId, pendingQueue);
              return;
            }
            if (perItemRuntimeState.status === "paused") {
              const remainingInCurrentBatch = attemptBatch.slice(index);
              pendingQueue = [...remainingInCurrentBatch, ...pendingQueue];
              await updateJobProgress({
                jobId,
                status: "paused",
                pendingQueue,
                processedCount,
                addedCount,
                failedCount,
                ignoredAlreadyInTarget,
                lastMessage: "Processo pausado pelo administrador.",
              });
              break;
            }

            if (knownTargetDigits.some((targetDigits) => hasPhoneDigitsMatch(participantDigits, targetDigits))) {
              ignoredAlreadyInTarget += 1;
              processedCount += 1;
              continue;
            }

            try {
              await addGroupParticipants(client, {
                groupJid: targetGroup!.remoteId,
                participants: [participantDigits],
              });
              knownTargetDigits.push(participantDigits);
              addedCount += 1;
            } catch {
              failedCount += 1;
            }
            processedCount += 1;

            if (index < attemptBatch.length - 1) {
              await sleep(
                randomDelay(
                  Math.max(MIN_DELAY_MS, Math.floor(delayMs * 0.45)),
                  Math.max(300, Math.floor(jitterMs / 2)),
                ),
              );
            }
          }
        }
      }

      const progressRuntimeState = await loadRuntimeState(jobId);
      const status: GroupParticipantImportJobStatus =
        progressRuntimeState.cancelRequested
          ? "cancelling"
          : progressRuntimeState.status === "paused"
            ? "paused"
            : "running";
      await updateJobProgress({
        jobId,
        status,
        pendingQueue,
        processedCount,
        addedCount,
        failedCount,
        ignoredAlreadyInTarget,
        lastMessage: `Processando adição de membros... ${processedCount}/${Math.max(
          totalCandidates,
          processedCount,
        )}`,
      });

      if (pendingQueue.length > 0) {
        await sleep(randomCadenceDelay(delayMs, jitterMs));
      }
    }

    await syncGroupInfo(userId, targetGroupId, { force: true }).catch(() => {});
    const message =
      failedCount > 0
        ? `Processo concluído com ressalvas. ${addedCount} adicionado(s), ${failedCount} com falha.`
        : `Processo concluído. ${addedCount} membro(s) adicionado(s).`;
    await markJobCompleted(jobId, message);
  } catch (error) {
    await markJobFailed(jobId, error);
  }
};

const runJobInBackground = (jobId: number): void => {
  if (!Number.isFinite(jobId) || jobId <= 0) return;
  const normalizedJobId = Math.floor(jobId);
  if (runningJobIds.has(normalizedJobId)) return;
  runningJobIds.add(normalizedJobId);
  void runGroupParticipantImportJob(normalizedJobId).finally(() => {
    runningJobIds.delete(normalizedJobId);
  });
};

const scanAndStartPendingJobs = async (): Promise<void> => {
  await ensureJobsTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT id
      FROM ${TABLE_NAME}
      WHERE status IN ('queued', 'running', 'cancelling')
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `,
    [JOB_SCAN_BATCH],
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    const jobId = Number(row.id);
    if (!Number.isFinite(jobId) || jobId <= 0) continue;
    runJobInBackground(Math.floor(jobId));
  }
};

export const startGroupParticipantImportDispatcher = (): void => {
  if (dispatcherStarted) return;
  dispatcherStarted = true;
  runtime.__groupParticipantImportDispatcherStarted = true;
  void scanAndStartPendingJobs();
  const timer = setInterval(() => {
    void scanAndStartPendingJobs();
  }, JOB_SCAN_INTERVAL_MS);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
};

export const startGroupParticipantImportJobForUser = async (
  payload: StartJobPayload,
): Promise<{ job: GroupParticipantImportJobSummary; alreadyRunning: boolean }> => {
  await ensureJobsTable();

  const userId = Number(payload.userId);
  const targetGroupId = Number(payload.targetGroupId);
  const sourceGroupId = Number(payload.sourceGroupId);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new GroupParticipantImportJobError("Usuário inválido.", 401);
  }
  if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) {
    throw new GroupParticipantImportJobError("Grupo de destino inválido.");
  }
  if (!Number.isFinite(sourceGroupId) || sourceGroupId <= 0) {
    throw new GroupParticipantImportJobError("Grupo de origem inválido.");
  }
  if (targetGroupId === sourceGroupId) {
    throw new GroupParticipantImportJobError("O grupo de origem não pode ser o mesmo grupo de destino.");
  }

  let activeJob = await loadActiveJobRowForTarget(userId, targetGroupId);
  if (activeJob) {
    const cancelRequested = toBool(activeJob.cancel_requested, false);
    const updatedAtMs = toTimestampMs(activeJob.updated_at);
    const nowMs = Date.now();
    const activeAgeMs = updatedAtMs === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - updatedAtMs);
    const looksStuckCancelling =
      activeJob.status === "cancelling" &&
      (cancelRequested || activeAgeMs >= 30_000);

    if (looksStuckCancelling) {
      await markJobCancelled(
        activeJob.id,
        deserializePendingQueue(activeJob.pending_queue_json),
        "Importação anterior cancelada para iniciar nova execução.",
      );
      activeJob = null;
    }
  }

  if (activeJob) {
    if (RUNNABLE_STATUS_SET.has(activeJob.status)) {
      runJobInBackground(activeJob.id);
    }
    return {
      job: mapJobRow(activeJob),
      alreadyRunning: true,
    };
  }

  await Promise.all([
    syncGroupInfo(userId, targetGroupId, { force: true }).catch(() => {}),
    syncGroupInfo(userId, sourceGroupId, { force: true }).catch(() => {}),
  ]);

  const targetGroup = await getGroupByIdForUser(userId, targetGroupId);
  if (!targetGroup) {
    throw new GroupParticipantImportJobError("Grupo de destino não encontrado.", 404);
  }
  const sourceGroup = await getGroupByIdForUser(userId, sourceGroupId);
  if (!sourceGroup) {
    throw new GroupParticipantImportJobError("Grupo de origem não encontrado.", 404);
  }
  if (!targetGroup.remoteId) {
    throw new GroupParticipantImportJobError(
      "Sincronize o grupo de destino antes de transferir membros.",
      409,
    );
  }
  if (targetGroup.instanceId <= 0) {
    throw new GroupParticipantImportJobError(
      "O grupo de destino precisa estar vinculado a uma conexão ativa.",
      409,
    );
  }
  const instance = await getInstanceForUser(userId, targetGroup.instanceId);
  if (!instance?.serverBaseUrl || !instance?.token) {
    throw new GroupParticipantImportJobError("Instância da automação indisponível para este grupo.", 409);
  }

  const excludeAdmins = payload.excludeAdmins !== false;
  const delayMs = clampInt(payload.delayMs, MIN_DELAY_MS, MAX_DELAY_MS, DEFAULT_DELAY_MS);
  const jitterMs = clampInt(payload.jitterMs, 0, MAX_JITTER_MS, DEFAULT_JITTER_MS);
  const batchSize = clampInt(payload.batchSize, 1, MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const maxMembers = normalizeOptionalMaxMembers(payload.maxMembers);
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_NAME} (
        user_id,
        target_group_id,
        target_group_name,
        source_group_id,
        source_group_name,
        target_instance_id,
        status,
        cancel_requested,
        exclude_admins,
        delay_ms,
        jitter_ms,
        batch_size,
        max_members,
        last_message
      )
      VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      targetGroup.id,
      targetGroup.name ?? null,
      sourceGroup.id,
      sourceGroup.name ?? null,
      targetGroup.instanceId,
      excludeAdmins ? 1 : 0,
      delayMs,
      jitterMs,
      batchSize,
      maxMembers,
      "Fila criada e aguardando processamento.",
    ],
  );
  const job = await loadJobRowByIdForUser(userId, Number(result.insertId));
  if (!job) {
    throw new GroupParticipantImportJobError("Não foi possível iniciar a importação de membros agora.", 500);
  }
  void enqueueGroupParticipantImportJobSignal(job.id);
  runJobInBackground(job.id);
  return { job: mapJobRow(job), alreadyRunning: false };
};

export const requestCancelGroupParticipantImportJobForUser = async (params: {
  userId: number;
  targetGroupId: number;
  jobId?: number | null;
}): Promise<GroupParticipantImportJobSummary | null> => {
  await ensureJobsTable();
  const userId = Number(params.userId);
  const targetGroupId = Number(params.targetGroupId);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) return null;

  const jobRow =
    Number.isFinite(params.jobId) && params.jobId && params.jobId > 0
      ? await loadJobRowByIdForUser(userId, Math.floor(Number(params.jobId)))
      : await loadActiveJobRowForTarget(userId, targetGroupId);
  if (!jobRow) return null;
  if (!ACTIVE_STATUS_SET.has(jobRow.status)) {
    return mapJobRow(jobRow);
  }

  const db = getDb();
  if (jobRow.status === "queued") {
    await db.query(
      `
        UPDATE ${TABLE_NAME}
        SET
          cancel_requested = 1,
          status = 'cancelled',
          last_message = 'Importação cancelada antes do início.',
          finished_at = NOW(),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [jobRow.id, userId],
    );
  } else {
    await db.query(
      `
        UPDATE ${TABLE_NAME}
        SET
          cancel_requested = 1,
          status = 'cancelling',
          last_message = 'Cancelamento solicitado. Finalizando lote atual...',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [jobRow.id, userId],
    );
    runJobInBackground(jobRow.id);
  }

  const updated = await loadJobRowByIdForUser(userId, jobRow.id);
  return updated ? mapJobRow(updated) : null;
};

export const requestPauseGroupParticipantImportJobForUser = async (params: {
  userId: number;
  targetGroupId: number;
  jobId?: number | null;
}): Promise<GroupParticipantImportJobSummary | null> => {
  await ensureJobsTable();
  const userId = Number(params.userId);
  const targetGroupId = Number(params.targetGroupId);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) return null;

  const jobRow =
    Number.isFinite(params.jobId) && params.jobId && params.jobId > 0
      ? await loadJobRowByIdForUser(userId, Math.floor(Number(params.jobId)))
      : await loadActiveJobRowForTarget(userId, targetGroupId);
  if (!jobRow) return null;
  if (TERMINAL_STATUS_SET.has(jobRow.status)) {
    return mapJobRow(jobRow);
  }
  if (jobRow.status === "paused") {
    return mapJobRow(jobRow);
  }

  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        cancel_requested = 0,
        status = 'paused',
        last_message = 'Processo pausado pelo administrador.',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [jobRow.id, userId],
  );

  const updated = await loadJobRowByIdForUser(userId, jobRow.id);
  return updated ? mapJobRow(updated) : null;
};

export const requestResumeGroupParticipantImportJobForUser = async (params: {
  userId: number;
  targetGroupId: number;
  jobId?: number | null;
}): Promise<GroupParticipantImportJobSummary | null> => {
  await ensureJobsTable();
  const userId = Number(params.userId);
  const targetGroupId = Number(params.targetGroupId);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) return null;

  const jobRow =
    Number.isFinite(params.jobId) && params.jobId && params.jobId > 0
      ? await loadJobRowByIdForUser(userId, Math.floor(Number(params.jobId)))
      : await loadActiveJobRowForTarget(userId, targetGroupId);
  if (!jobRow) return null;
  if (TERMINAL_STATUS_SET.has(jobRow.status)) {
    return mapJobRow(jobRow);
  }

  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        cancel_requested = 0,
        status = 'running',
        started_at = COALESCE(started_at, NOW()),
        last_message = 'Processo retomado pelo administrador.',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [jobRow.id, userId],
  );
  runJobInBackground(jobRow.id);

  const updated = await loadJobRowByIdForUser(userId, jobRow.id);
  return updated ? mapJobRow(updated) : null;
};

export const updateGroupParticipantImportJobSettingsForUser = async (params: {
  userId: number;
  targetGroupId: number;
  jobId?: number | null;
  delayMs?: unknown;
  jitterMs?: unknown;
  batchSize?: unknown;
}): Promise<GroupParticipantImportJobSummary | null> => {
  await ensureJobsTable();
  const userId = Number(params.userId);
  const targetGroupId = Number(params.targetGroupId);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) return null;

  const jobRow =
    Number.isFinite(params.jobId) && params.jobId && params.jobId > 0
      ? await loadJobRowByIdForUser(userId, Math.floor(Number(params.jobId)))
      : await loadActiveJobRowForTarget(userId, targetGroupId);
  if (!jobRow) return null;
  if (TERMINAL_STATUS_SET.has(jobRow.status)) {
    return mapJobRow(jobRow);
  }

  const delayMs = clampInt(params.delayMs, MIN_DELAY_MS, MAX_DELAY_MS, Number(jobRow.delay_ms || DEFAULT_DELAY_MS));
  const jitterMs = clampInt(params.jitterMs, 0, MAX_JITTER_MS, Number(jobRow.jitter_ms || DEFAULT_JITTER_MS));
  const batchSize = clampInt(params.batchSize, 1, MAX_BATCH_SIZE, Number(jobRow.batch_size || DEFAULT_BATCH_SIZE));

  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        delay_ms = ?,
        jitter_ms = ?,
        batch_size = ?,
        last_message = 'Ritmo atualizado pelo administrador.',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [delayMs, jitterMs, batchSize, jobRow.id, userId],
  );

  if (RUNNABLE_STATUS_SET.has(jobRow.status)) {
    runJobInBackground(jobRow.id);
  }

  const updated = await loadJobRowByIdForUser(userId, jobRow.id);
  return updated ? mapJobRow(updated) : null;
};
