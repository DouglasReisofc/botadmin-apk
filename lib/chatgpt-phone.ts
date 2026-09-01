import { execFile as execFileCallback } from "child_process";
import { randomUUID } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";

import {
  enqueueAutoDownNativeJobAndWait,
  type AutoDownJobResult,
} from "lib/autodown";
import { ensureBotGroupTable, getDb } from "lib/db";
import { convertMediaBufferToChatGptWav } from "lib/media/audio";
import { enqueueChatGptPhoneJobSignal } from "lib/queues";

const execFile = promisify(execFileCallback);

export type BotInterageContextRole = "user" | "assistant" | "system" | "tool";

export type BotInterageContextEvent = {
  id: number;
  groupId: number | null;
  userId: number | null;
  instanceId: number | null;
  groupRemoteId: string | null;
  groupName: string | null;
  senderJid: string | null;
  senderName: string | null;
  whatsappMessageId: string | null;
  role: BotInterageContextRole;
  content: string;
  contentType: string;
  media: unknown;
  jobId: string | null;
  createdAt: string;
};

export type ChatGptPhoneArtifact = {
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  path?: string | null;
  url?: string | null;
  base64?: string | null;
  dataUrl?: string | null;
  fileName?: string | null;
  name?: string | null;
};

type MaterializedPayload = {
  responseText: string | null;
  resultType: string;
  artifacts: ChatGptPhoneArtifact[];
};

export type ChatGptPhoneInputAttachment = {
  name?: string | null;
  fileName?: string | null;
  mimeType: string;
  base64: string;
};

export type ChatGptPhoneJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout";

export type ChatGptPhoneJob = {
  jobId: string;
  status: ChatGptPhoneJobStatus;
  userId: number | null;
  groupId: number | null;
  instanceId: number | null;
  groupRemoteId: string | null;
  senderJid: string | null;
  senderName: string | null;
  whatsappMessageId: string | null;
  prompt: string;
  context: unknown;
  request: Record<string, unknown> | null;
  responseText: string | null;
  resultType: string | null;
  artifacts: ChatGptPhoneArtifact[];
  phoneApiUrl: string | null;
  phoneConversationId: string | null;
  phoneMessageId: string | null;
  phoneInterceptKey: string | null;
  workerId: string | null;
  claimedAt: string | null;
  heartbeatAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

type ContextEventRow = RowDataPacket & {
  id: number;
  group_id: number | null;
  user_id: number | null;
  instance_id: number | null;
  group_remote_id: string | null;
  group_name: string | null;
  sender_jid: string | null;
  sender_name: string | null;
  whatsapp_message_id: string | null;
  role: BotInterageContextRole;
  content: string | null;
  content_type: string | null;
  media_json: string | null;
  job_id: string | null;
  created_at: Date | string;
};

type JobRow = RowDataPacket & {
  job_id: string;
  status: ChatGptPhoneJobStatus;
  user_id: number | null;
  group_id: number | null;
  instance_id: number | null;
  group_remote_id: string | null;
  sender_jid: string | null;
  sender_name: string | null;
  whatsapp_message_id: string | null;
  prompt: string | null;
  context_json: string | null;
  request_json: string | null;
  response_text: string | null;
  result_type: string | null;
  artifacts_json: string | null;
  phone_api_url: string | null;
  phone_conversation_id: string | null;
  phone_message_id: string | null;
  phone_intercept_key: string | null;
  worker_id: string | null;
  claimed_at: Date | string | null;
  heartbeat_at: Date | string | null;
  error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
};

type GroupLookupRow = RowDataPacket & {
  id: number;
  user_id: number;
  instance_id: number | null;
  remote_id: string;
  name: string;
};

const MAX_CONTEXT_LIMIT = 80;
const DEFAULT_CONTEXT_LIMIT = 12;
const DEFAULT_PHONE_TIMEOUT_MS = 240_000;
const DEFAULT_PHONE_MEDIA_TIMEOUT_MS = (() => {
  const value = Number(process.env.CHATGPT_PHONE_MEDIA_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 180_000;
})();
const DEFAULT_PHONE_FILE_TIMEOUT_MS = (() => {
  const value = Number(process.env.CHATGPT_PHONE_FILE_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : Math.max(DEFAULT_PHONE_MEDIA_TIMEOUT_MS, 360_000);
})();
const DEFAULT_SETTLE_MS = 3_000;
const DEFAULT_TEXT_SETTLE_MS = (() => {
  const value = Number(process.env.CHATGPT_PHONE_TEXT_SETTLE_MS);
  return Number.isFinite(value) && value > 0 ? value : 1_000;
})();
const DEFAULT_RELAY_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MCP_TEXT_GRACE_MS = 12_000;
const DEFAULT_MCP_MEDIA_GRACE_MS = 25_000;
const DEFAULT_MCP_TIMEOUT_GRACE_MS = 30_000;
const DIRECT_PHONE_BUSY_TTL_MS = 10 * 60_000;
const GENERIC_GENERATION_FAILURE = "Não foi possível gerar agora. Tente novamente em instantes.";

let ensureTablesPromise: Promise<void> | null = null;
let activeDirectPhoneJob: { jobId: string; startedAt: number } | null = null;

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    return value as T;
  }
  if (!value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toIso = (value: Date | string | null): string | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

const normalizeLimit = (value: unknown, fallback = DEFAULT_CONTEXT_LIMIT): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(MAX_CONTEXT_LIMIT, Math.trunc(numeric)));
};

const trimOptional = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asPlainRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const sanitizePhoneBaseUrl = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed.replace(/\/+$/, "")}`;
  }
  return trimmed.replace(/\/+$/, "");
};

export const getChatGptPhoneApiUrl = (): string | null =>
  sanitizePhoneBaseUrl(process.env.CHATGPT_PHONE_API_URL);

const directPhoneNoQueueEnabled = (): boolean =>
  process.env.CHATGPT_PHONE_NO_QUEUE?.trim().toLowerCase() !== "false";

const acquireDirectPhoneSlot = (jobId: string): boolean => {
  if (!directPhoneNoQueueEnabled()) {
    return true;
  }
  if (
    activeDirectPhoneJob &&
    activeDirectPhoneJob.jobId !== jobId &&
    Date.now() - activeDirectPhoneJob.startedAt < DIRECT_PHONE_BUSY_TTL_MS
  ) {
    return false;
  }
  activeDirectPhoneJob = { jobId, startedAt: Date.now() };
  return true;
};

const releaseDirectPhoneSlot = (jobId: string): void => {
  if (activeDirectPhoneJob?.jobId === jobId) {
    activeDirectPhoneJob = null;
  }
};

const relayNoQueueBusy = async (jobId: string): Promise<boolean> => {
  if (!directPhoneNoQueueEnabled()) {
    return false;
  }
  const db = getDb();
  const [rows] = await db.query<Array<RowDataPacket & { busy: number }>>(
    `
      SELECT COUNT(*) AS busy
      FROM chatgpt_phone_jobs current_job
      JOIN chatgpt_phone_jobs other_job
        ON other_job.job_id <> current_job.job_id
       AND other_job.status IN ('queued', 'running')
       AND (other_job.phone_api_url IS NULL OR other_job.phone_api_url = '')
       AND (
         other_job.created_at < current_job.created_at
         OR (other_job.created_at = current_job.created_at AND other_job.job_id < current_job.job_id)
       )
      WHERE current_job.job_id = ?
      LIMIT 1
    `,
    [jobId],
  );
  return Number(rows[0]?.busy ?? 0) > 0;
};

const isRetryableCurrentChatFailure = (message?: string | null): boolean => {
  const normalized = (message ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return [
    "conversa excluida",
    "conversa foi excluida",
    "chat excluido",
    "chat deleted",
    "conversation deleted",
    "conversation was deleted",
    "conversation not found",
    "inicie um novo chat",
    "start a new chat",
    "aguardando reenvio",
    "composer",
    "edittext",
    "send button",
    "not found",
  ].some((term) => normalized.includes(term));
};

const isEchoedPromptFailure = (message: unknown, prompt: unknown): boolean => {
  const failureText = trimOptional(message);
  const promptText = trimOptional(prompt);
  return !!failureText && !!promptText && failureText === promptText;
};

export const ensureChatGptPhoneTables = async (): Promise<void> => {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      const db = getDb();
      await ensureBotGroupTable();
      await db.query(`
        CREATE TABLE IF NOT EXISTS botinterage_context_events (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          group_id INT NULL,
          user_id INT NULL,
          instance_id INT NULL,
          group_remote_id VARCHAR(128) NULL,
          group_name VARCHAR(255) NULL,
          sender_jid VARCHAR(128) NULL,
          sender_name VARCHAR(255) NULL,
          whatsapp_message_id VARCHAR(255) NULL,
          role ENUM('user','assistant','system','tool') NOT NULL,
          content MEDIUMTEXT NOT NULL,
          content_type VARCHAR(40) NOT NULL DEFAULT 'text',
          media_json JSON NULL,
          job_id CHAR(36) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          KEY idx_botinterage_context_group_time (group_id, created_at),
          KEY idx_botinterage_context_remote_time (group_remote_id, created_at),
          KEY idx_botinterage_context_sender_time (sender_jid, created_at),
          KEY idx_botinterage_context_job (job_id),
          KEY idx_botinterage_context_message (whatsapp_message_id),
          CONSTRAINT fk_botinterage_context_group
            FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS chatgpt_phone_jobs (
          job_id CHAR(36) PRIMARY KEY,
          status ENUM('queued','running','succeeded','failed','timeout') NOT NULL DEFAULT 'queued',
          user_id INT NULL,
          group_id INT NULL,
          instance_id INT NULL,
          group_remote_id VARCHAR(128) NULL,
          sender_jid VARCHAR(128) NULL,
          sender_name VARCHAR(255) NULL,
          whatsapp_message_id VARCHAR(255) NULL,
          prompt MEDIUMTEXT NOT NULL,
          context_json JSON NULL,
          request_json JSON NULL,
          response_text MEDIUMTEXT NULL,
          result_type VARCHAR(40) NULL,
          artifacts_json JSON NULL,
          phone_api_url VARCHAR(500) NULL,
          phone_conversation_id VARCHAR(255) NULL,
          phone_message_id VARCHAR(255) NULL,
          phone_intercept_key VARCHAR(255) NULL,
          worker_id VARCHAR(120) NULL,
          claimed_at DATETIME(3) NULL,
          heartbeat_at DATETIME(3) NULL,
          error_message TEXT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          started_at DATETIME(3) NULL,
          completed_at DATETIME(3) NULL,
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          KEY idx_chatgpt_phone_jobs_group_time (group_id, created_at),
          KEY idx_chatgpt_phone_jobs_remote_time (group_remote_id, created_at),
          KEY idx_chatgpt_phone_jobs_sender_time (sender_jid, created_at),
          KEY idx_chatgpt_phone_jobs_message (whatsapp_message_id),
          KEY idx_chatgpt_phone_jobs_status_time (status, created_at),
          KEY idx_chatgpt_phone_jobs_worker_time (worker_id, updated_at),
          CONSTRAINT fk_chatgpt_phone_jobs_group
            FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
      `);

      const ensureJobColumn = async (column: string, definition: string) => {
        const [existing] = await db.query<RowDataPacket[]>(
          "SHOW COLUMNS FROM chatgpt_phone_jobs LIKE ?",
          [column],
        );
        if (!Array.isArray(existing) || existing.length === 0) {
          await db.query(`ALTER TABLE chatgpt_phone_jobs ADD COLUMN ${definition}`);
        }
      };

      const ensureJobIndex = async (index: string, definition: string) => {
        const [existing] = await db.query<RowDataPacket[]>(
          "SHOW INDEX FROM chatgpt_phone_jobs WHERE Key_name = ?",
          [index],
        );
        if (!Array.isArray(existing) || existing.length === 0) {
          await db.query(`ALTER TABLE chatgpt_phone_jobs ADD ${definition}`);
        }
      };

      await ensureJobColumn("worker_id", "worker_id VARCHAR(120) NULL AFTER phone_intercept_key");
      await ensureJobColumn("claimed_at", "claimed_at DATETIME(3) NULL AFTER worker_id");
      await ensureJobColumn("heartbeat_at", "heartbeat_at DATETIME(3) NULL AFTER claimed_at");
      await ensureJobIndex(
        "idx_chatgpt_phone_jobs_worker_time",
        "KEY idx_chatgpt_phone_jobs_worker_time (worker_id, updated_at)",
      );
    })().catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });
  }

  await ensureTablesPromise;
};

const contextRowToEvent = (row: ContextEventRow): BotInterageContextEvent => ({
  id: Number(row.id),
  groupId: row.group_id === null ? null : Number(row.group_id),
  userId: row.user_id === null ? null : Number(row.user_id),
  instanceId: row.instance_id === null ? null : Number(row.instance_id),
  groupRemoteId: row.group_remote_id,
  groupName: row.group_name,
  senderJid: row.sender_jid,
  senderName: row.sender_name,
  whatsappMessageId: row.whatsapp_message_id,
  role: row.role,
  content: row.content ?? "",
  contentType: row.content_type ?? "text",
  media: parseJson(row.media_json, null),
  jobId: row.job_id,
  createdAt: toIso(row.created_at) ?? new Date().toISOString(),
});

const jobRowToJob = (row: JobRow): ChatGptPhoneJob => ({
  jobId: row.job_id,
  status: row.status,
  userId: row.user_id === null ? null : Number(row.user_id),
  groupId: row.group_id === null ? null : Number(row.group_id),
  instanceId: row.instance_id === null ? null : Number(row.instance_id),
  groupRemoteId: row.group_remote_id,
  senderJid: row.sender_jid,
  senderName: row.sender_name,
  whatsappMessageId: row.whatsapp_message_id,
  prompt: row.prompt ?? "",
  context: parseJson(row.context_json, null),
  request: parseJson<Record<string, unknown> | null>(row.request_json, null),
  responseText: row.response_text,
  resultType: row.result_type,
  artifacts: parseJson<ChatGptPhoneArtifact[]>(row.artifacts_json, []),
  phoneApiUrl: row.phone_api_url,
  phoneConversationId: row.phone_conversation_id,
  phoneMessageId: row.phone_message_id,
  phoneInterceptKey: row.phone_intercept_key,
  workerId: row.worker_id,
  claimedAt: toIso(row.claimed_at),
  heartbeatAt: toIso(row.heartbeat_at),
  errorMessage: row.error_message,
  createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  startedAt: toIso(row.started_at),
  completedAt: toIso(row.completed_at),
  updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
});

const resolveGroup = async ({
  groupId,
  groupRemoteId,
}: {
  groupId?: number | null;
  groupRemoteId?: string | null;
}): Promise<GroupLookupRow | null> => {
  await ensureChatGptPhoneTables();
  const db = getDb();
  if (typeof groupId === "number" && Number.isFinite(groupId) && groupId > 0) {
    const [rows] = await db.query<GroupLookupRow[]>(
      "SELECT id, user_id, instance_id, remote_id, name FROM bot_groups WHERE id = ? LIMIT 1",
      [groupId],
    );
    return rows[0] ?? null;
  }

  const remote = trimOptional(groupRemoteId);
  if (!remote) {
    return null;
  }

  const [rows] = await db.query<GroupLookupRow[]>(
    "SELECT id, user_id, instance_id, remote_id, name FROM bot_groups WHERE remote_id = ? LIMIT 1",
    [remote],
  );
  return rows[0] ?? null;
};

export const recordBotInterageContextEvent = async (input: {
  groupId?: number | null;
  userId?: number | null;
  instanceId?: number | null;
  groupRemoteId?: string | null;
  groupName?: string | null;
  senderJid?: string | null;
  senderName?: string | null;
  whatsappMessageId?: string | null;
  role: BotInterageContextRole;
  content: string;
  contentType?: string | null;
  media?: unknown;
  jobId?: string | null;
}): Promise<BotInterageContextEvent> => {
  await ensureChatGptPhoneTables();
  const group = await resolveGroup({
    groupId: input.groupId ?? null,
    groupRemoteId: input.groupRemoteId ?? null,
  });
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO botinterage_context_events (
        group_id,
        user_id,
        instance_id,
        group_remote_id,
        group_name,
        sender_jid,
        sender_name,
        whatsapp_message_id,
        role,
        content,
        content_type,
        media_json,
        job_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      group?.id ?? input.groupId ?? null,
      group?.user_id ?? input.userId ?? null,
      group?.instance_id ?? input.instanceId ?? null,
      group?.remote_id ?? input.groupRemoteId ?? null,
      group?.name ?? input.groupName ?? null,
      trimOptional(input.senderJid),
      trimOptional(input.senderName),
      trimOptional(input.whatsappMessageId),
      input.role,
      input.content,
      trimOptional(input.contentType) ?? "text",
      input.media === undefined ? null : JSON.stringify(input.media),
      trimOptional(input.jobId),
    ],
  );

  const [rows] = await db.query<ContextEventRow[]>(
    "SELECT * FROM botinterage_context_events WHERE id = ? LIMIT 1",
    [result.insertId],
  );
  return contextRowToEvent(rows[0]);
};

export const listBotInterageContextEvents = async (input: {
  groupId?: number | null;
  groupRemoteId?: string | null;
  senderJid?: string | null;
  limit?: number | null;
}): Promise<BotInterageContextEvent[]> => {
  await ensureChatGptPhoneTables();
  const group = await resolveGroup({
    groupId: input.groupId ?? null,
    groupRemoteId: input.groupRemoteId ?? null,
  });
  const limit = normalizeLimit(input.limit);
  const where: string[] = [];
  const params: unknown[] = [];

  if (group?.id) {
    where.push("group_id = ?");
    params.push(group.id);
  } else if (input.groupRemoteId) {
    where.push("group_remote_id = ?");
    params.push(input.groupRemoteId);
  }

  const sender = trimOptional(input.senderJid);
  if (sender) {
    where.push("sender_jid = ?");
    params.push(sender);
  }

  if (where.length === 0) {
    throw new Error("Informe groupId ou groupRemoteId para consultar o contexto.");
  }

  params.push(limit);
  const db = getDb();
  const [rows] = await db.query<ContextEventRow[]>(
    `
      SELECT *
      FROM botinterage_context_events
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    params,
  );

  return rows.map(contextRowToEvent).reverse();
};

const escapeSqlLike = (value: string): string =>
  value.replace(/[!%_]/g, (match) => `!${match}`);

export const isBotInterageAssistantWhatsappMessage = async (input: {
  groupId?: number | null;
  groupRemoteId?: string | null;
  messageId?: string | null;
}): Promise<boolean> => {
  const messageId = trimOptional(input.messageId);
  if (!messageId) {
    return false;
  }

  await ensureChatGptPhoneTables();
  const group = await resolveGroup({
    groupId: input.groupId ?? null,
    groupRemoteId: input.groupRemoteId ?? null,
  });
  const where: string[] = ["role = 'assistant'"];
  const params: unknown[] = [];

  if (group?.id) {
    where.push("group_id = ?");
    params.push(group.id);
  } else if (input.groupRemoteId) {
    where.push("group_remote_id = ?");
    params.push(input.groupRemoteId);
  } else {
    return false;
  }

  params.push(messageId, `%${escapeSqlLike(messageId)}%`);
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT id
      FROM botinterage_context_events
      WHERE ${where.join(" AND ")}
        AND (
          whatsapp_message_id = ?
          OR media_json LIKE ? ESCAPE '!'
        )
      LIMIT 1
    `,
    params,
  );

  return rows.length > 0;
};

export const getChatGptPhoneJob = async (jobId: string): Promise<ChatGptPhoneJob | null> => {
  await ensureChatGptPhoneTables();
  const db = getDb();
  const [rows] = await db.query<JobRow[]>(
    "SELECT * FROM chatgpt_phone_jobs WHERE job_id = ? LIMIT 1",
    [jobId],
  );
  return rows[0] ? jobRowToJob(rows[0]) : null;
};

export const createChatGptPhoneJob = async (input: {
  jobId?: string | null;
  userId?: number | null;
  groupId?: number | null;
  instanceId?: number | null;
  groupRemoteId?: string | null;
  senderJid?: string | null;
  senderName?: string | null;
  whatsappMessageId?: string | null;
  prompt: string;
  context?: unknown;
  request?: Record<string, unknown> | null;
  phoneApiUrl?: string | null;
}): Promise<ChatGptPhoneJob> => {
  await ensureChatGptPhoneTables();
  const group = await resolveGroup({
    groupId: input.groupId ?? null,
    groupRemoteId: input.groupRemoteId ?? null,
  });
  const jobId = trimOptional(input.jobId) ?? randomUUID();
  const db = getDb();

  await db.query(
    `
      INSERT INTO chatgpt_phone_jobs (
        job_id,
        status,
        user_id,
        group_id,
        instance_id,
        group_remote_id,
        sender_jid,
        sender_name,
        whatsapp_message_id,
        prompt,
        context_json,
        request_json,
        phone_api_url
      )
      VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      jobId,
      group?.user_id ?? input.userId ?? null,
      group?.id ?? input.groupId ?? null,
      group?.instance_id ?? input.instanceId ?? null,
      group?.remote_id ?? input.groupRemoteId ?? null,
      trimOptional(input.senderJid),
      trimOptional(input.senderName),
      trimOptional(input.whatsappMessageId),
      input.prompt,
      input.context === undefined ? null : JSON.stringify(input.context),
      input.request ? JSON.stringify(input.request) : null,
      sanitizePhoneBaseUrl(input.phoneApiUrl) ?? getChatGptPhoneApiUrl(),
    ],
  );

  const job = await getChatGptPhoneJob(jobId);
  if (!job) {
    throw new Error("Falha ao criar job do ChatGPT Phone.");
  }
  void enqueueChatGptPhoneJobSignal(job.jobId);
  return job;
};

const updateJob = async (
  jobId: string,
  fields: {
    status?: ChatGptPhoneJobStatus;
    responseText?: string | null;
    resultType?: string | null;
    artifacts?: ChatGptPhoneArtifact[] | null;
    phoneConversationId?: string | null;
    phoneMessageId?: string | null;
    phoneInterceptKey?: string | null;
    workerId?: string | null;
    errorMessage?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    claimedAt?: Date | null;
    heartbeatAt?: Date | null;
  },
): Promise<ChatGptPhoneJob> => {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.status) {
    sets.push("status = ?");
    params.push(fields.status);
  }
  if ("responseText" in fields) {
    sets.push("response_text = ?");
    params.push(fields.responseText ?? null);
  }
  if ("resultType" in fields) {
    sets.push("result_type = ?");
    params.push(fields.resultType ?? null);
  }
  if ("artifacts" in fields) {
    sets.push("artifacts_json = ?");
    params.push(fields.artifacts ? JSON.stringify(fields.artifacts) : null);
  }
  if ("phoneConversationId" in fields) {
    sets.push("phone_conversation_id = ?");
    params.push(fields.phoneConversationId ?? null);
  }
  if ("phoneMessageId" in fields) {
    sets.push("phone_message_id = ?");
    params.push(fields.phoneMessageId ?? null);
  }
  if ("phoneInterceptKey" in fields) {
    sets.push("phone_intercept_key = ?");
    params.push(fields.phoneInterceptKey ?? null);
  }
  if ("workerId" in fields) {
    sets.push("worker_id = ?");
    params.push(fields.workerId ?? null);
  }
  if ("errorMessage" in fields) {
    sets.push("error_message = ?");
    params.push(fields.errorMessage ?? null);
  }
  if ("startedAt" in fields) {
    sets.push("started_at = ?");
    params.push(fields.startedAt ?? null);
  }
  if ("completedAt" in fields) {
    sets.push("completed_at = ?");
    params.push(fields.completedAt ?? null);
  }
  if ("claimedAt" in fields) {
    sets.push("claimed_at = ?");
    params.push(fields.claimedAt ?? null);
  }
  if ("heartbeatAt" in fields) {
    sets.push("heartbeat_at = ?");
    params.push(fields.heartbeatAt ?? null);
  }

  if (sets.length === 0) {
    const job = await getChatGptPhoneJob(jobId);
    if (!job) {
      throw new Error("Job do ChatGPT Phone não encontrado.");
    }
    return job;
  }

  params.push(jobId);
  const db = getDb();
  await db.query(`UPDATE chatgpt_phone_jobs SET ${sets.join(", ")} WHERE job_id = ? LIMIT 1`, params);
  const job = await getChatGptPhoneJob(jobId);
  if (!job) {
    throw new Error("Job do ChatGPT Phone não encontrado após atualização.");
  }
  return job;
};

export const markChatGptPhoneJobRunning = async (input: {
  jobId: string;
  remoteJobId: string;
  provider?: string | null;
}): Promise<ChatGptPhoneJob> => {
  const now = new Date();
  return updateJob(input.jobId, {
    status: "running",
    phoneMessageId: trimOptional(input.remoteJobId),
    workerId: input.provider ? `headless:${input.provider}` : "headless",
    errorMessage: null,
    startedAt: now,
    heartbeatAt: now,
  });
};

const extractArtifacts = (payload: Record<string, unknown> | null): ChatGptPhoneArtifact[] => {
  const raw = payload?.artifacts;
  if (!Array.isArray(raw)) {
    return [];
  }
  const artifacts: ChatGptPhoneArtifact[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    artifacts.push({
      mimeType: trimOptional(record.mimeType) ?? trimOptional(record.mime_type),
      width: typeof record.width === "number" ? record.width : null,
      height: typeof record.height === "number" ? record.height : null,
      path: trimOptional(record.path),
      url: trimOptional(record.url),
      base64: trimOptional(record.base64),
      dataUrl: trimOptional(record.dataUrl) ?? trimOptional(record.data_url),
      fileName: trimOptional(record.fileName) ?? trimOptional(record.filename),
      name: trimOptional(record.name),
    });
  }
  return artifacts;
};

const normalizePdfText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

const escapePdfText = (value: string): string =>
  normalizePdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const wrapPdfLine = (line: string, maxChars: number): string[] => {
  const normalized = normalizePdfText(line);
  if (!normalized) {
    return [""];
  }
  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [""];
};

const buildTextPdfBuffer = (input: { title: string; body: string }): Buffer => {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 48;
  const startY = 790;
  const lineHeight = 14;
  const maxLinesPerPage = 51;
  const title = normalizePdfText(input.title || "Documento BotAdmin").slice(0, 120) || "Documento BotAdmin";
  const body = normalizePdfText(input.body || title);
  const contentLines = [
    ...wrapPdfLine(title, 58),
    "",
    ...body
      .split(/\r?\n/)
      .flatMap((line) => wrapPdfLine(line, 84)),
  ];
  const pages: string[][] = [];
  for (let index = 0; index < contentLines.length; index += maxLinesPerPage) {
    pages.push(contentLines.slice(index, index + maxLinesPerPage));
  }
  if (!pages.length) {
    pages.push([title]);
  }

  const objects: string[] = [];
  const pageRefs: number[] = [];
  const fontObjectNumber = 3 + pages.length * 2;
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = "";

  pages.forEach((pageLines, index) => {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    pageRefs.push(pageObjectNumber);
    const streamLines = [
      "BT",
      `/F1 11 Tf`,
      `${lineHeight} TL`,
      `${marginX} ${startY} Td`,
    ];
    pageLines.forEach((line, lineIndex) => {
      if (lineIndex === 0 && index === 0) {
        streamLines.push("/F1 16 Tf");
        streamLines.push(`(${escapePdfText(line)}) Tj`);
        streamLines.push("/F1 11 Tf");
        streamLines.push("T*");
        return;
      }
      streamLines.push(`(${escapePdfText(line)}) Tj`);
      streamLines.push("T*");
    });
    streamLines.push("ET");
    const stream = streamLines.join("\n");
    objects[pageObjectNumber - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber - 1] =
      `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`;
  });

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[fontObjectNumber - 1] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "binary");
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
};

const inferDocumentTitle = (prompt?: string | null, responseText?: string | null): string => {
  const promptText = String(prompt || "");
  const titleMatch =
    promptText.match(/\bt[ií]tulo\s+["“']?([^"“”'\n.]{3,90})/i) ||
    promptText.match(/\btitle\s+["“']?([^"“”'\n.]{3,90})/i);
  const titleFromPrompt = titleMatch?.[1]
    ?.replace(/\s+(?:e\s+)?(?:uma|um|o|a)?\s*(?:linha|frase|texto|conteudo|conteúdo|corpo)\b.*$/i, "")
    .replace(/\s+(?:com|contendo|dizendo)\b.*$/i, "")
    .trim();
  const responseLine = String(responseText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return normalizePdfText(titleFromPrompt || responseLine || "Documento BotAdmin").slice(0, 90) || "Documento BotAdmin";
};

const safeDocumentFileName = (title: string): string => {
  const base = normalizePdfText(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "documento-botadmin"}.pdf`;
};

const fallbackDocumentBodyFromPrompt = (prompt?: string | null, title?: string | null): string => {
  const promptText = String(prompt || "");
  const lineMatch =
    promptText.match(/\blinha\s+(?:dizendo|com|contendo)\s+["“']?([^"“”'\n.]{2,160})/i) ||
    promptText.match(/\bfrase\s+["“']?([^"“”'\n.]{2,160})/i);
  return [title || "Documento BotAdmin", lineMatch?.[1] || promptText]
    .map((line) => normalizePdfText(line))
    .filter(Boolean)
    .join("\n\n");
};

const looksLikeOnlyGeneratedFileName = (value?: string | null): boolean => {
  const text = normalizePdfText(String(value || ""));
  return Boolean(text) && /^[\w .-]{1,120}\.(?:pdf|docx?|xlsx?|csv|txt)$/i.test(text);
};

const materializeGeneratedDocumentArtifacts = (
  job: Pick<ChatGptPhoneJob, "prompt" | "request"> | null | undefined,
  responseText: string | null,
  resultType: string,
  artifacts: ChatGptPhoneArtifact[],
): MaterializedPayload => {
  const artifactMode = trimOptional(job?.request?.artifactMode);
  const wantsPdf =
    artifactMode === "pdf" ||
    isLikelyChatGptPhoneDocumentRequest(String(job?.prompt || ""));
  if (!wantsPdf || artifacts.length > 0) {
    return { responseText, resultType, artifacts };
  }

  const title = inferDocumentTitle(job?.prompt, responseText);
  const body = looksLikeOnlyGeneratedFileName(responseText)
    ? fallbackDocumentBodyFromPrompt(job?.prompt, title)
    : normalizePdfText(responseText || "") || fallbackDocumentBodyFromPrompt(job?.prompt, title);
  if (!body) {
    return { responseText, resultType, artifacts };
  }

  const buffer = buildTextPdfBuffer({ title, body });
  return {
    responseText: "📄 PDF gerado com sucesso.",
    resultType: "media",
    artifacts: [
      {
        mimeType: "application/pdf",
        base64: buffer.toString("base64"),
        fileName: safeDocumentFileName(title),
        name: title,
      },
    ],
  };
};

const callPhoneMessageEndpoint = async (
  phoneApiUrl: string,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const token = trimOptional(process.env.CHATGPT_PHONE_API_TOKEN);
  const response = await fetch(`${phoneApiUrl}/chatgpt/message`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  const payload = text ? parseJson<Record<string, unknown> | null>(text, null) : null;
  if (!response.ok) {
    const message =
      trimOptional(payload?.error) ??
      trimOptional(payload?.message) ??
      (text.slice(0, 500) || `ChatGPT Phone respondeu HTTP ${response.status}.`);
    throw new Error(message);
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("ChatGPT Phone retornou uma resposta inválida.");
  }
  return payload;
};

const chatGptCromiteExecutorEnabled = (): boolean =>
  process.env.CHATGPT_CROMITE_EXECUTOR_ENABLED?.trim().toLowerCase() !== "false";

let chatGptCromiteImportPromise: Promise<{
  sendMessage: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}> | null = null;

const getChatGptCromiteExecutor = async (): Promise<{
  sendMessage: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}> => {
  if (!chatGptCromiteImportPromise) {
    const moduleUrl =
      trimOptional(process.env.CHATGPT_CROMITE_EXECUTOR_MODULE) ??
      "file:///root/chatgpt-cromite-automator/src/server.js";
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<unknown>;
    chatGptCromiteImportPromise = dynamicImport(moduleUrl).then((module) => {
      const executor = module as {
        sendMessage?: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
      };
      if (typeof executor.sendMessage !== "function") {
        throw new Error("Executor Cromite do ChatGPT não exporta sendMessage.");
      }
      return { sendMessage: executor.sendMessage };
    });
  }
  return chatGptCromiteImportPromise;
};

const callCromiteMessageExecutor = async (
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const executor = await getChatGptCromiteExecutor();
  return executor.sendMessage(request);
};

const getChatGptDispatchMode = (): string =>
  process.env.CHATGPT_PHONE_DISPATCH_MODE?.trim().toLowerCase() || "";

const shouldUseNativeCromiteQueue = (): boolean => {
  const mode = getChatGptDispatchMode();
  return mode === "native" || mode === "cromite-native" || mode === "botadmin-native";
};

const shouldUseDirectCromiteImport = (): boolean =>
  chatGptCromiteExecutorEnabled() && getChatGptDispatchMode() === "cromite-direct";

const asRecord = asPlainRecord;

const readNestedTrimmed = (record: Record<string, unknown> | null, ...keys: string[]): string | null => {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = trimOptional(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

const getNativeResultLinkInfo = (result: AutoDownJobResult): Record<string, unknown> | null => {
  const metadata = asRecord(result.metadata);
  return asRecord(metadata?.link_info);
};

export const buildChatGptPayloadFromNativeResult = (result: AutoDownJobResult): Record<string, unknown> => {
  const linkInfo = getNativeResultLinkInfo(result);
  const selected = asRecord(linkInfo?.selected);
  const embeddedBase64 = readNestedTrimmed(linkInfo, "embedded_file_base64");
  const embeddedMime =
    result.mime ||
    readNestedTrimmed(linkInfo, "embedded_content_type", "content_type", "mime_type", "mime") ||
    "image/png";
  const embeddedName =
    result.filename ||
    readNestedTrimmed(linkInfo, "embedded_file_name", "file_name", "filename") ||
    readNestedTrimmed(selected, "filename", "file_name") ||
    `chatgpt-${result.jobId}.png`;
  const directUrl =
    result.directLink ||
    result.previewUrl ||
    readNestedTrimmed(selected, "direct", "direct_link", "preview", "preview_url");
  const conversationId =
    readNestedTrimmed(linkInfo, "conversation_id", "conversationId") ??
    readNestedTrimmed(selected, "conversation_id", "conversationId");
  const artifacts: ChatGptPhoneArtifact[] = [];

  if (embeddedBase64) {
    artifacts.push({
      base64: embeddedBase64,
      mimeType: embeddedMime,
      fileName: embeddedName,
    });
  } else if (directUrl) {
    artifacts.push({
      url: directUrl,
      mimeType: embeddedMime,
      fileName: embeddedName,
    });
  }

  const ok = result.status !== "error";
  return {
    ok,
    result: artifacts.length > 0 ? null : result.message || null,
    resultType: artifacts.length > 0 ? "media" : "text",
    artifacts,
    conversationId,
    workerId: result.clientId,
    error: ok ? null : "Não foi possível gerar agora.",
  };
};

export const isRetryableChatGptNativeErrorResult = (result: AutoDownJobResult): boolean => {
  if (result.status !== "error") {
    return false;
  }
  if (result.site && result.site !== "chatgpt") {
    return false;
  }
  const normalized = stripAccents(result.message ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return /\b(tempo|timeout|aguardando|captura|capture|retorno|worker|extensao|extension|link)\b/.test(
    normalized,
  );
};

const waitForExternalCompletionAfterNativeIssue = async (
  jobId: string,
  externalCompletionPromise: Promise<ChatGptPhoneJob | null>,
  details: Record<string, unknown>,
): Promise<ChatGptPhoneJob | null> => {
  console.warn("[chatgpt-phone] retorno nativo temporario; aguardando resultado direto do Cromite", {
    jobId,
    ...details,
  });
  const externalJob = await externalCompletionPromise;
  if (externalJob?.status === "succeeded") {
    return externalJob;
  }
  return null;
};

const firstNativeInputAttachment = (request: Record<string, unknown>): ChatGptPhoneInputAttachment | null => {
  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  for (const attachment of attachments) {
    const record = asRecord(attachment);
    const base64 = trimOptional(record?.base64);
    const mimeType = trimOptional(record?.mimeType) ?? trimOptional(record?.mime_type);
    if (base64 && mimeType) {
      return {
        base64,
        mimeType,
        name: trimOptional(record?.name) ?? trimOptional(record?.fileName) ?? trimOptional(record?.filename),
      };
    }
  }
  return null;
};

const isReusableChatGptConversationId = (value: string | null | undefined): value is string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length < 16 || trimmed.length > 128) {
    return false;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return false;
  }
  if (/^(test|debug|codex|sim|fake|mock|dummy)/i.test(trimmed)) {
    return false;
  }
  return true;
};

const resolveReusableChatGptConversationId = async (
  job: ChatGptPhoneJob,
  request: Record<string, unknown>,
): Promise<string | null> => {
  const explicit =
    trimOptional(request.conversationId) ??
    trimOptional(request.conversation_id) ??
    trimOptional(job.phoneConversationId);
  if (isReusableChatGptConversationId(explicit)) {
    return explicit;
  }
  if (explicit) {
    console.warn("[chatgpt-phone] conversation_id inválido ignorado", {
      jobId: job.jobId,
      conversationId: explicit,
    });
  }
  if (request.newChat !== false) {
    return null;
  }

  await ensureChatGptPhoneTables();
  const db = getDb();
  if (job.groupId) {
    const [rows] = await db.query<Array<RowDataPacket & { phone_conversation_id: string | null }>>(
      `
        SELECT phone_conversation_id
        FROM chatgpt_phone_jobs
        WHERE group_id = ?
          AND job_id <> ?
          AND status = 'succeeded'
          AND phone_conversation_id IS NOT NULL
          AND phone_conversation_id <> ''
        ORDER BY completed_at DESC, updated_at DESC
        LIMIT 1
      `,
      [job.groupId, job.jobId],
    );
    const found = trimOptional(rows[0]?.phone_conversation_id);
    if (isReusableChatGptConversationId(found)) {
      return found;
    }
    if (found) {
      console.warn("[chatgpt-phone] conversation_id salvo inválido ignorado", {
        jobId: job.jobId,
        groupId: job.groupId,
        conversationId: found,
      });
    }
  }

  const conversationKey = trimOptional(request.conversationKey);
  if (conversationKey) {
    const [rows] = await db.query<Array<RowDataPacket & { phone_conversation_id: string | null }>>(
      `
        SELECT phone_conversation_id
        FROM chatgpt_phone_jobs
        WHERE job_id <> ?
          AND status = 'succeeded'
          AND phone_conversation_id IS NOT NULL
          AND phone_conversation_id <> ''
          AND request_json LIKE ?
        ORDER BY completed_at DESC, updated_at DESC
        LIMIT 1
      `,
      [job.jobId, `%${conversationKey.replace(/[\\%_]/g, "\\$&")}%`],
    );
    const found = trimOptional(rows[0]?.phone_conversation_id);
    if (isReusableChatGptConversationId(found)) {
      return found;
    }
    if (found) {
      console.warn("[chatgpt-phone] conversation_id salvo inválido ignorado", {
        jobId: job.jobId,
        conversationKey,
        conversationId: found,
      });
    }
    return null;
  }

  return null;
};

const requestRequiresMcpCompletion = (request: Record<string, unknown>): boolean => {
  if (request.requireMcpCompletion === false || request.mcpCompletionRequired === false) {
    return false;
  }
  const resultSource = trimOptional(request.resultSource)?.toLowerCase();
  if (resultSource === "mcp" || resultSource === "botadmin_mcp") {
    return true;
  }
  if (request.requireMcpCompletion === true || request.mcpCompletionRequired === true) {
    return true;
  }
  return (trimOptional(request.message) ?? "").includes("resultChannel=botadmin_mcp");
};

const extractBotAdminJobUserPrompt = (message: string | null): string | null => {
  if (!message) {
    return null;
  }
  const marker = "\nmessage:\n";
  const markerIndex = message.indexOf(marker);
  if (markerIndex < 0) {
    return trimOptional(message);
  }
  return trimOptional(message.slice(markerIndex + marker.length));
};

const isUsableNativeTextFallback = (text: string | null): boolean => {
  if (!text) {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 6) {
    return false;
  }
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(normalized)) {
    return false;
  }
  if (normalized.length >= 16) {
    return true;
  }
  return /[.!?…]$/.test(normalized) || /^ok\b/i.test(normalized);
};

const looksLikeBotAdminJobPromptEcho = (text: string | null): boolean => {
  const normalized = stripAccents(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("botadmin_job") ||
    normalized.startsWith("botadmin_context") ||
    (normalized.includes("jobid=") && normalized.includes("accesscode=")) ||
    normalized.includes("resultchannel=botadmin_mcp") ||
    normalized.includes("mcp_required=") ||
    normalized.includes("mcp_context_hint=") ||
    normalized.includes("response_marker=") ||
    normalized.includes("reply_rule=") ||
    normalized.includes("final_text_call=") ||
    normalized.includes("search_final=")
  );
};

const buildMcpSafeFallbackFromNativePayload = (
  request: Record<string, unknown>,
  nativePayload: Record<string, unknown>,
): Record<string, unknown> | null => {
  if (nativePayload.ok === false) {
    return null;
  }
  if (requestRequiresMcpCompletion(request)) {
    return null;
  }

  const artifacts = Array.isArray(nativePayload.artifacts) ? nativePayload.artifacts : [];
  const resultType = trimOptional(nativePayload.resultType)?.toLowerCase();
  if (resultType === "media" || artifacts.length > 0) {
    const originalPrompt = extractBotAdminJobUserPrompt(trimOptional(request.message));
    const promptBlock = originalPrompt ? `\n\nPrompt:\n${originalPrompt}` : "";
    return {
      ok: true,
      resultType: "text",
      result: `🧠 Imagem gerada com sucesso.${promptBlock}`,
      artifacts: [],
      conversationId: trimOptional(nativePayload.conversationId),
      workerId: trimOptional(nativePayload.workerId),
    };
  }

  const responseText =
    trimOptional(nativePayload.result) ??
    trimOptional(nativePayload.response) ??
    trimOptional(nativePayload.text);
  if (looksLikeBotAdminJobPromptEcho(responseText)) {
    return null;
  }
  if (!isUsableNativeTextFallback(responseText)) {
    return null;
  }

  return {
    ...nativePayload,
    resultType: "text",
    result: responseText,
    artifacts: [],
  };
};

const readPositiveEnvMs = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
};

const readPositiveEnvInt = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
};

const getNativePayloadText = (payload: Record<string, unknown>): string | null =>
  trimOptional(payload.result) ??
  trimOptional(payload.response) ??
  trimOptional(payload.text);

const getExpectedResponseMarker = (request: Record<string, unknown> | null | undefined): string | null =>
  trimOptional(request?.responseMarker) ?? trimOptional(request?.response_marker);

const stripExpectedResponseMarker = (
  text: string | null,
  marker: string | null,
): { text: string | null; found: boolean } => {
  const raw = trimOptional(text);
  const expected = trimOptional(marker);
  if (!raw || !expected) {
    return { text: raw, found: !expected };
  }
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerPattern = new RegExp(`^\\s*${escaped}(?:\\s|:|-|—|–|$)+`, "i");
  if (!markerPattern.test(raw)) {
    return { text: raw, found: false };
  }
  const stripped = raw.replace(markerPattern, "").replace(/^\s+/, "").trim();
  return { text: stripped || null, found: true };
};

const stripAnyLeadingRouteMarker = (
  text: string | null,
): { text: string | null; found: boolean; marker: string | null } => {
  const raw = trimOptional(text);
  if (!raw) {
    return { text: raw, found: false, marker: null };
  }
  const match = raw.match(/^\s*(R[0-9A-F]{8})(?:\s|:|-|—|–|$)+/i);
  if (!match?.[1]) {
    return { text: raw, found: false, marker: null };
  }
  const stripped = raw.replace(/^\s*R[0-9A-F]{8}(?:\s|:|-|—|–|$)+/i, "").replace(/^\s+/, "").trim();
  return { text: stripped || null, found: true, marker: match[1].toUpperCase() };
};

const normalizePayloadForExpectedMarker = (
  payload: Record<string, unknown>,
  request: Record<string, unknown> | null | undefined,
): {
  payload: Record<string, unknown>;
  missingMarker: boolean;
  responsePreview: string | null;
} => {
  const marker = getExpectedResponseMarker(request);
  if (!marker) {
    return { payload, missingMarker: false, responsePreview: getNativePayloadText(payload)?.slice(0, 120) ?? null };
  }

  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const resultType = trimOptional(payload.resultType)?.toLowerCase();
  const responseText = getNativePayloadText(payload);
  if (resultType === "media" || artifacts.length > 0) {
    const stripped = stripExpectedResponseMarker(responseText, marker);
    return {
      payload: stripped.found
        ? {
            ...payload,
            result: stripped.text,
            response: undefined,
            text: undefined,
          }
        : payload,
      missingMarker: false,
      responsePreview: stripped.text?.slice(0, 120) ?? null,
    };
  }

  const stripped = stripExpectedResponseMarker(responseText, marker);
  if (!stripped.found) {
    if (payload.markerMismatchAccepted === true) {
      const fallback = stripAnyLeadingRouteMarker(responseText);
      if (fallback.found) {
        console.warn("[chatgpt-phone] aceitando resposta com marcador trocado em turno novo", {
          expectedMarker: marker,
          receivedMarker: fallback.marker,
          responsePreview: fallback.text?.slice(0, 120) ?? null,
        });
        return {
          payload: {
            ...payload,
            resultType: "text",
            result: fallback.text,
            response: undefined,
            text: undefined,
            markerMismatchAccepted: undefined,
          },
          missingMarker: false,
          responsePreview: fallback.text?.slice(0, 120) ?? null,
        };
      }
    }
    return {
      payload,
      missingMarker: true,
      responsePreview: responseText?.slice(0, 120) ?? null,
    };
  }

  return {
    payload: {
      ...payload,
      resultType: "text",
      result: stripped.text,
      response: undefined,
      text: undefined,
    },
    missingMarker: false,
    responsePreview: stripped.text?.slice(0, 120) ?? null,
  };
};

const parseAudioImagePromptMarker = (text?: string | null): string | null => {
  const raw = trimOptional(text);
  if (!raw) {
    return null;
  }
  const match = raw.match(/(?:^|\n)\s*BOTADMIN_AUDIO_IMAGE_PROMPT\s*:\s*([\s\S]+)$/i);
  const prompt = trimOptional(match?.[1]);
  if (!prompt) {
    return null;
  }
  const cleaned = prompt
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length >= 6 ? cleaned.slice(0, 4000) : null;
};

const isAudioUnclearMarker = (text?: string | null): boolean =>
  /^BOTADMIN_AUDIO_UNCLEAR\b/i.test(trimOptional(text) ?? "");

const getNativeCromiteMaxAttempts = (): number =>
  Math.max(1, Math.min(readPositiveEnvInt("CHATGPT_PHONE_NATIVE_MAX_ATTEMPTS", 3), 5));

const getNativeCromiteRetryDelayMs = (): number =>
  Math.max(1_000, Math.min(readPositiveEnvMs("CHATGPT_PHONE_NATIVE_RETRY_DELAY_MS", 4_000), 20_000));

const shouldRetryIncompleteNativePayload = (
  payload: Record<string, unknown>,
): { retry: boolean; reason: string; responsePreview: string | null } => {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const resultType = trimOptional(payload.resultType)?.toLowerCase();
  if (resultType === "media" || artifacts.length > 0) {
    return { retry: false, reason: "", responsePreview: null };
  }

  const responseText = getNativePayloadText(payload);
  const responsePreview = responseText?.slice(0, 120) ?? null;
  if (looksLikeBotAdminJobPromptEcho(responseText)) {
    return { retry: true, reason: "prompt_echo", responsePreview };
  }
  if (payload.ok !== false && !isUsableNativeTextFallback(responseText)) {
    return { retry: true, reason: "text_incomplete", responsePreview };
  }

  return { retry: false, reason: "", responsePreview };
};

const getMcpGraceMs = (nativePayload: Record<string, unknown> | null): number => {
  const artifacts = Array.isArray(nativePayload?.artifacts) ? nativePayload.artifacts : [];
  const resultType = trimOptional(nativePayload?.resultType)?.toLowerCase();
  const fallback =
    resultType === "media" || artifacts.length > 0
      ? DEFAULT_MCP_MEDIA_GRACE_MS
      : DEFAULT_MCP_TEXT_GRACE_MS;
  return readPositiveEnvMs("CHATGPT_PHONE_MCP_GRACE_MS", fallback);
};

const getMcpTimeoutGraceMs = (): number =>
  readPositiveEnvMs("CHATGPT_PHONE_MCP_TIMEOUT_GRACE_MS", DEFAULT_MCP_TIMEOUT_GRACE_MS);

const waitForFinalChatGptPhoneJobNoTimeoutUpdate = async (
  jobId: string,
  timeoutMs: number,
  intervalMs = DEFAULT_RELAY_POLL_INTERVAL_MS,
): Promise<ChatGptPhoneJob | null> => {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() <= deadline) {
    const job = await getChatGptPhoneJob(jobId);
    if (!job) {
      throw new Error("Job do ChatGPT Phone não encontrado durante espera MCP.");
    }
    if (isFinalJobStatus(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, intervalMs)));
  }
  return null;
};

const runChatGptPhoneJobViaNativeCromite = async (
  jobId: string,
  request: Record<string, unknown>,
  timeoutMs: number,
): Promise<ChatGptPhoneJob> => {
  await updateJob(jobId, {
    status: "running",
    startedAt: new Date(),
    errorMessage: null,
  });
  const currentJob = await getChatGptPhoneJob(jobId);
  if (!currentJob) {
    throw new Error("Job do ChatGPT Phone não encontrado.");
  }

  try {
    const inputAttachment = firstNativeInputAttachment(request);
    const wantsMediaOutput =
      Boolean(inputAttachment) || isLikelyChatGptPhoneMediaRequest(trimOptional(request.message) ?? "");
    const effectiveTimeoutMs = wantsMediaOutput
      ? Math.max(timeoutMs, DEFAULT_PHONE_MEDIA_TIMEOUT_MS)
      : timeoutMs;
    const nativeAttempt = Math.max(1, Number(request.__nativeAttempt ?? 1) || 1);
    const nativeMaxAttempts = getNativeCromiteMaxAttempts();
    const nativeAttemptStartedAt = Date.now();
    const reusableConversationId = await resolveReusableChatGptConversationId(currentJob, request);
    const chatgptMetadata: Record<string, unknown> = {
      prompt: trimOptional(request.message) ?? "",
      file_name_hint: `chatgpt-${jobId}.png`,
      temporary_chat: request.temporaryChat === true || request.temporary_chat === true,
      fallback_to_regular_chat: true,
      force_image_output: wantsMediaOutput,
      native_attempt: nativeAttempt,
      ...(reusableConversationId ? { conversation_id: reusableConversationId } : {}),
    };
    if (inputAttachment) {
      chatgptMetadata.input_image_base64 = inputAttachment.base64;
      chatgptMetadata.input_image_content_type = inputAttachment.mimeType;
      chatgptMetadata.input_image_name =
        inputAttachment.name || `whatsapp-reference-${jobId}.${inputAttachment.mimeType.split("/")[1] || "bin"}`;
    }

    const nativeResultPromise = enqueueAutoDownNativeJobAndWait(
      {
        id: jobId,
        url: reusableConversationId
          ? `https://chatgpt.com/c/${encodeURIComponent(reusableConversationId)}`
          : "https://chatgpt.com/",
        site: "chatgpt",
        metadata: {
          source: "chatgpt-phone",
          chatgpt: chatgptMetadata,
        },
      },
      effectiveTimeoutMs,
    );
    const requiresMcpCompletion = requestRequiresMcpCompletion(request);
    const externalCompletionPromise = (
      requiresMcpCompletion
        ? waitForFinalChatGptPhoneJobNoTimeoutUpdate(
            jobId,
            effectiveTimeoutMs + getMcpTimeoutGraceMs(),
          )
        : waitForChatGptPhoneJob(jobId, {
            timeoutMs: effectiveTimeoutMs,
            intervalMs: 1_000,
          })
    ).then((job) => (job && isFinalJobStatus(job.status) ? job : null));
    const nativeOutcomePromise = nativeResultPromise
      .then((result) => ({ source: "native" as const, result }))
      .catch((error) => ({ source: "native-error" as const, error }));
    const nativeResultOrExternalJob = await Promise.race([
      nativeOutcomePromise,
      externalCompletionPromise.then((job) => ({ source: "external" as const, job })),
    ]);

    const retryNativeAttempt = async (
      reason: string,
      details: Record<string, unknown>,
    ): Promise<ChatGptPhoneJob | null> => {
      const retryDelayMs = getNativeCromiteRetryDelayMs();
      const shortExternalJob = await waitForFinalChatGptPhoneJobNoTimeoutUpdate(
        jobId,
        retryDelayMs,
        1_000,
      ).catch(() => null);
      if (shortExternalJob?.status === "succeeded") {
        return shortExternalJob;
      }
      const elapsedMs = Date.now() - nativeAttemptStartedAt;
      const remainingTimeoutMs = Math.max(0, effectiveTimeoutMs - elapsedMs);
      if (nativeAttempt >= nativeMaxAttempts || remainingTimeoutMs < 15_000) {
        console.warn("[chatgpt-phone] retorno nativo incompleto sem nova tentativa", {
          jobId,
          reason,
          nativeAttempt,
          nativeMaxAttempts,
          remainingTimeoutMs,
          ...details,
        });
        return null;
      }
      console.warn("[chatgpt-phone] retorno nativo incompleto; reenfileirando Cromite", {
        jobId,
        reason,
        nativeAttempt,
        nextAttempt: nativeAttempt + 1,
        nativeMaxAttempts,
        remainingTimeoutMs,
        ...details,
      });
      return runChatGptPhoneJobViaNativeCromite(
        jobId,
        {
          ...request,
          __nativeAttempt: nativeAttempt + 1,
        },
        remainingTimeoutMs,
      );
    };

    if (nativeResultOrExternalJob.source === "external" && nativeResultOrExternalJob.job) {
      nativeResultPromise.catch(() => undefined);
      return nativeResultOrExternalJob.job;
    }

    if (requiresMcpCompletion) {
      let safeFallbackPayload: Record<string, unknown> | null = null;
      let nativePayloadForGrace: Record<string, unknown> | null = null;
      if (nativeResultOrExternalJob.source === "native-error") {
        console.warn("[chatgpt-phone] native cromite falhou; aguardando conclusao MCP", {
          jobId,
          message:
            nativeResultOrExternalJob.error instanceof Error
              ? nativeResultOrExternalJob.error.message
              : String(nativeResultOrExternalJob.error),
        });
      } else {
        const nativePayload = buildChatGptPayloadFromNativeResult(nativeResultOrExternalJob.result.result);
        const markerNormalizedPayload = normalizePayloadForExpectedMarker(nativePayload, request);
        nativePayloadForGrace = markerNormalizedPayload.payload;
        safeFallbackPayload = markerNormalizedPayload.missingMarker
          ? null
          : buildMcpSafeFallbackFromNativePayload(request, markerNormalizedPayload.payload);
        console.info("[chatgpt-phone] resultado visual do Cromite ignorado; aguardando MCP", {
          jobId,
          resultType: markerNormalizedPayload.payload.resultType,
          responsePreview: markerNormalizedPayload.responsePreview,
          artifactCount: Array.isArray(markerNormalizedPayload.payload.artifacts)
            ? markerNormalizedPayload.payload.artifacts.length
            : 0,
          missingMarker: markerNormalizedPayload.missingMarker,
          fallbackEligible: Boolean(safeFallbackPayload),
        });
      }
      const externalJob = safeFallbackPayload
        ? await waitForFinalChatGptPhoneJobNoTimeoutUpdate(
            jobId,
            getMcpGraceMs(nativePayloadForGrace),
          )
        : await externalCompletionPromise;
      if (externalJob?.status === "succeeded") {
        return externalJob;
      }
      if (safeFallbackPayload) {
        console.info("[chatgpt-phone] MCP nao concluiu; usando fallback seguro do Cromite", {
          jobId,
          resultType: trimOptional(safeFallbackPayload.resultType),
          responsePreview: trimOptional(safeFallbackPayload.result)?.slice(0, 120) ?? null,
        });
        return updateChatGptPhoneJobFromExecutorPayload(
          jobId,
          safeFallbackPayload,
          GENERIC_GENERATION_FAILURE,
        );
      }
      if (externalJob) {
        return externalJob;
      }
      return updateJob(jobId, {
        status: "timeout",
        errorMessage: GENERIC_GENERATION_FAILURE,
        completedAt: new Date(),
      });
    }

    if (nativeResultOrExternalJob.source === "native-error") {
      const externalJob = await waitForExternalCompletionAfterNativeIssue(
        jobId,
        externalCompletionPromise,
        {
          source: "native-error",
          message:
            nativeResultOrExternalJob.error instanceof Error
              ? nativeResultOrExternalJob.error.message
              : String(nativeResultOrExternalJob.error),
        },
      );
      if (externalJob) {
        return externalJob;
      }
      throw nativeResultOrExternalJob.error;
    }

    const nativeResult = nativeResultOrExternalJob.result;

    const nativePayload = buildChatGptPayloadFromNativeResult(nativeResult.result);
    const markerNormalizedPayload = normalizePayloadForExpectedMarker(nativePayload, request);
    const checkedNativePayload = markerNormalizedPayload.payload;
    if (isRetryableChatGptNativeErrorResult(nativeResult.result)) {
      const retryJob = await retryNativeAttempt("native_error", {
        nativeStatus: nativeResult.result.status,
        nativeMessage: nativeResult.result.message,
        workerId: nativeResult.result.clientId,
      });
      if (retryJob) {
        return retryJob;
      }
      const externalJob = await waitForExternalCompletionAfterNativeIssue(
        jobId,
        externalCompletionPromise,
        {
          source: "native-result",
          nativeStatus: nativeResult.result.status,
          nativeMessage: nativeResult.result.message,
          workerId: nativeResult.result.clientId,
        },
      );
      if (externalJob) {
        return externalJob;
      }
      return updateJob(jobId, {
        status: "timeout",
        responseText: null,
        resultType: "text",
        artifacts: [],
        errorMessage: GENERIC_GENERATION_FAILURE,
        completedAt: new Date(),
      });
    }
    if (markerNormalizedPayload.missingMarker) {
      const retryJob = await retryNativeAttempt("missing_response_marker", {
        nativeStatus: nativeResult.result.status,
        responsePreview: markerNormalizedPayload.responsePreview,
        workerId: nativeResult.result.clientId,
      });
      if (retryJob) {
        return retryJob;
      }
      const externalJob = await waitForExternalCompletionAfterNativeIssue(
        jobId,
        externalCompletionPromise,
        {
          source: "native-missing-marker",
          nativeStatus: nativeResult.result.status,
          responsePreview: markerNormalizedPayload.responsePreview,
          workerId: nativeResult.result.clientId,
        },
      );
      if (externalJob) {
        return externalJob;
      }
      return updateJob(jobId, {
        status: "timeout",
        responseText: null,
        resultType: "text",
        artifacts: [],
        errorMessage: GENERIC_GENERATION_FAILURE,
        completedAt: new Date(),
      });
    }
    const incompleteNativePayload = shouldRetryIncompleteNativePayload(checkedNativePayload);
    if (incompleteNativePayload.retry) {
      const retryJob = await retryNativeAttempt(incompleteNativePayload.reason, {
        nativeStatus: nativeResult.result.status,
        responsePreview: incompleteNativePayload.responsePreview,
        workerId: nativeResult.result.clientId,
      });
      if (retryJob) {
        return retryJob;
      }
      const externalJob = await waitForExternalCompletionAfterNativeIssue(
        jobId,
        externalCompletionPromise,
        {
          source: "native-incomplete",
          nativeStatus: nativeResult.result.status,
          reason: incompleteNativePayload.reason,
          responsePreview: incompleteNativePayload.responsePreview,
          workerId: nativeResult.result.clientId,
        },
      );
      if (externalJob) {
        return externalJob;
      }
    }
    try {
      return await updateChatGptPhoneJobFromExecutorPayload(
        jobId,
        nativePayload,
        GENERIC_GENERATION_FAILURE,
      );
    } catch (updateError) {
      const firstArtifact = Array.isArray(nativePayload.artifacts)
        ? (nativePayload.artifacts[0] as Record<string, unknown> | undefined)
        : undefined;
      console.error("[chatgpt-phone] falha ao persistir resultado native cromite", {
        jobId,
        status: nativeResult.result.status,
        resultType: nativePayload.resultType,
        artifactCount: Array.isArray(nativePayload.artifacts) ? nativePayload.artifacts.length : 0,
        firstArtifactBase64Length:
          typeof firstArtifact?.base64 === "string" ? firstArtifact.base64.length : 0,
        firstArtifactHasUrl: typeof firstArtifact?.url === "string" && firstArtifact.url.length > 0,
        message: updateError instanceof Error ? updateError.message : String(updateError),
      });
      throw updateError;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : GENERIC_GENERATION_FAILURE;
    console.error("[chatgpt-phone] native cromite job failed", {
      jobId,
      message,
      stack: error instanceof Error ? error.stack : null,
    });
    const status = /timeout|aborted|tempo/i.test(message) ? "timeout" : "failed";
    return updateJob(jobId, {
      status,
      errorMessage: GENERIC_GENERATION_FAILURE,
      completedAt: new Date(),
    });
  }
};

const isFinalJobStatus = (status: ChatGptPhoneJobStatus): boolean =>
  status === "succeeded" || status === "failed" || status === "timeout";

export const waitForChatGptPhoneJob = async (
  jobId: string,
  options: {
    timeoutMs?: number | null;
    intervalMs?: number | null;
  } = {},
): Promise<ChatGptPhoneJob> => {
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs ?? DEFAULT_PHONE_TIMEOUT_MS));
  const intervalMs = Math.max(250, Number(options.intervalMs ?? DEFAULT_RELAY_POLL_INTERVAL_MS));
  const deadline = Date.now() + timeoutMs;
  let lastJob = await getChatGptPhoneJob(jobId);
  if (!lastJob) {
    throw new Error("Job do ChatGPT Phone não encontrado.");
  }

  while (Date.now() < deadline) {
    if (isFinalJobStatus(lastJob.status)) {
      return lastJob;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const next = await getChatGptPhoneJob(jobId);
    if (!next) {
      throw new Error("Job do ChatGPT Phone não encontrado durante espera.");
    }
    lastJob = next;
  }

  if (!isFinalJobStatus(lastJob.status)) {
    return updateJob(jobId, {
      status: "timeout",
      errorMessage: GENERIC_GENERATION_FAILURE,
      completedAt: new Date(),
    });
  }

  return lastJob;
};

export const claimNextChatGptPhoneJob = async (input: {
  workerId: string;
  waitMs?: number | null;
}): Promise<ChatGptPhoneJob | null> => {
  await ensureChatGptPhoneTables();
  const workerId = trimOptional(input.workerId) ?? "chatgpt-phone-worker";
  const waitMs = Math.max(0, Math.min(Number(input.waitMs ?? 25_000), 60_000));
  const deadline = Date.now() + waitMs;
  const db = getDb();

  do {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<JobRow[]>(
        `
          SELECT *
          FROM chatgpt_phone_jobs
          WHERE status = 'queued'
            AND (phone_api_url IS NULL OR phone_api_url = '')
            AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.executor')), '') <> 'native-cromite'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE
        `,
      );
      const row = rows[0] ?? null;
      if (!row) {
        await connection.rollback();
      } else {
        await connection.query(
          `
            UPDATE chatgpt_phone_jobs
            SET status = 'running',
                worker_id = ?,
                claimed_at = CURRENT_TIMESTAMP(3),
                heartbeat_at = CURRENT_TIMESTAMP(3),
                started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3)),
                error_message = NULL
            WHERE job_id = ?
            LIMIT 1
          `,
          [workerId, row.job_id],
        );
        await connection.commit();
        const job = await getChatGptPhoneJob(row.job_id);
        return job;
      }
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        /* ignore rollback errors */
      }
      throw error;
    } finally {
      connection.release();
    }

    if (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_RELAY_POLL_INTERVAL_MS));
    }
  } while (Date.now() < deadline);

  return null;
};

export const heartbeatChatGptPhoneWorker = async (input: {
  workerId: string;
  jobId?: string | null;
}): Promise<void> => {
  await ensureChatGptPhoneTables();
  const workerId = trimOptional(input.workerId);
  if (!workerId) {
    return;
  }

  const db = getDb();
  if (input.jobId) {
    await db.query(
      "UPDATE chatgpt_phone_jobs SET heartbeat_at = CURRENT_TIMESTAMP(3) WHERE job_id = ? AND worker_id = ? LIMIT 1",
      [input.jobId, workerId],
    );
    return;
  }

  await db.query(
    "UPDATE chatgpt_phone_jobs SET heartbeat_at = CURRENT_TIMESTAMP(3) WHERE worker_id = ? AND status = 'running'",
    [workerId],
  );
};

export const completeChatGptPhoneJob = async (input: {
  jobId: string;
  workerId?: string | null;
  payload: Record<string, unknown>;
}): Promise<ChatGptPhoneJob> => {
  const job = await getChatGptPhoneJob(input.jobId);
  if (!job) {
    throw new Error("Job do ChatGPT Phone não encontrado.");
  }
  const workerId = trimOptional(input.workerId);
  if (workerId && job.workerId && job.workerId !== workerId) {
    throw new Error("Job pertence a outro worker.");
  }

  const markerNormalizedPayload = normalizePayloadForExpectedMarker(input.payload, job.request);
  if (markerNormalizedPayload.missingMarker) {
    throw new Error("Resposta do ChatGPT sem marcador do job atual.");
  }
  const payload = markerNormalizedPayload.payload;
  const ok = payload.ok !== false;
  const resultType =
    trimOptional(payload.resultType) ??
    (Array.isArray(payload.artifacts) && payload.artifacts.length > 0 ? "media" : "text");
  const artifacts = extractArtifacts(payload);
  const responseText =
    trimOptional(payload.result) ??
    trimOptional(payload.response) ??
    trimOptional(payload.text);
  const materialized = materializeGeneratedDocumentArtifacts(job, responseText, resultType, artifacts);
  if (looksLikeBotAdminJobPromptEcho(responseText)) {
    return updateJob(input.jobId, {
      status: "timeout",
      responseText: null,
      resultType: "text",
      artifacts: [],
      workerId: workerId ?? job.workerId,
      errorMessage: GENERIC_GENERATION_FAILURE,
      completedAt: new Date(),
      heartbeatAt: new Date(),
    });
  }
  const errorMessage =
    ok ? null : trimOptional(payload.error) ?? trimOptional(payload.message) ?? GENERIC_GENERATION_FAILURE;

  return updateJob(input.jobId, {
    status: ok ? "succeeded" : "failed",
    responseText: materialized.responseText,
    resultType: materialized.resultType,
    artifacts: materialized.artifacts,
    phoneConversationId: trimOptional(payload.conversationId),
    phoneMessageId: trimOptional(payload.messageId),
    phoneInterceptKey: trimOptional(payload.interceptKey),
    workerId: workerId ?? job.workerId,
    errorMessage,
    completedAt: new Date(),
    heartbeatAt: new Date(),
  });
};

const updateChatGptPhoneJobFromExecutorPayload = async (
  jobId: string,
  rawPayload: Record<string, unknown>,
  errorFallback: string,
): Promise<ChatGptPhoneJob> => {
  const currentJob = await getChatGptPhoneJob(jobId);
  const markerNormalizedPayload = normalizePayloadForExpectedMarker(rawPayload, currentJob?.request);
  if (markerNormalizedPayload.missingMarker) {
    console.warn("[chatgpt-phone] resultado do executor sem marcador esperado; recusando resposta", {
      jobId,
      responsePreview: markerNormalizedPayload.responsePreview,
    });
    return updateJob(jobId, {
      status: "timeout",
      responseText: null,
      resultType: "text",
      artifacts: [],
      errorMessage: GENERIC_GENERATION_FAILURE,
      completedAt: new Date(),
    });
  }

  const payload = markerNormalizedPayload.payload;
  const ok = payload.ok !== false;
  const resultType =
    trimOptional(payload.resultType) ??
    (Array.isArray(payload.artifacts) && payload.artifacts.length > 0 ? "media" : "text");
  const artifacts = extractArtifacts(payload);
  const responseText =
    trimOptional(payload.result) ??
    trimOptional(payload.response) ??
    trimOptional(payload.text);
  const materialized = materializeGeneratedDocumentArtifacts(currentJob, responseText, resultType, artifacts);
  if (looksLikeBotAdminJobPromptEcho(responseText)) {
    return updateJob(jobId, {
      status: "timeout",
      responseText: null,
      resultType: "text",
      artifacts: [],
      errorMessage: GENERIC_GENERATION_FAILURE,
      completedAt: new Date(),
    });
  }
  const errorMessage =
    ok ? null : trimOptional(payload.error) ?? trimOptional(payload.message) ?? errorFallback;

  return updateJob(jobId, {
    status: ok ? "succeeded" : "failed",
    responseText: materialized.responseText,
    resultType: materialized.resultType,
    artifacts: materialized.artifacts,
    phoneConversationId: trimOptional(payload.conversationId),
    phoneMessageId: trimOptional(payload.messageId),
    phoneInterceptKey: trimOptional(payload.interceptKey),
    workerId: trimOptional(payload.workerId),
    errorMessage,
    completedAt: new Date(),
  });
};

export const runChatGptPhoneJob = async (
  jobId: string,
  options: {
    timeoutMs?: number | null;
    settleMs?: number | null;
    newChat?: boolean | null;
  } = {},
): Promise<ChatGptPhoneJob> => {
  const current = await getChatGptPhoneJob(jobId);
  if (!current) {
    throw new Error("Job do ChatGPT Phone não encontrado.");
  }
  const phoneApiUrl = sanitizePhoneBaseUrl(current.phoneApiUrl) ?? getChatGptPhoneApiUrl();
  const storedTimeoutMs = (() => {
    const value = Number(current.request?.timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_PHONE_TIMEOUT_MS;
  })();
  const storedSettleMs = (() => {
    const value = Number(current.request?.settleMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTLE_MS;
  })();
  const effectiveTimeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : storedTimeoutMs;
  const effectiveSettleMs =
    typeof options.settleMs === "number" && Number.isFinite(options.settleMs)
      ? options.settleMs
      : storedSettleMs;
  const requestMessage =
    typeof current.request?.message === "string" ? current.request.message : current.prompt;
  const request = {
    jobId,
    message: requestMessage,
    timeoutMs: effectiveTimeoutMs,
    settleMs: effectiveSettleMs,
    newChat: options.newChat ?? current.request?.newChat ?? true,
    resultSource: current.request?.resultSource ?? "database",
    ...(typeof current.request?.conversationId === "string"
      ? { conversationId: current.request.conversationId }
      : {}),
    ...(typeof current.request?.conversation_id === "string"
      ? { conversation_id: current.request.conversation_id }
      : {}),
    ...(typeof current.request?.temporaryChat === "boolean"
      ? { temporaryChat: current.request.temporaryChat }
      : {}),
    ...(typeof current.request?.temporary_chat === "boolean"
      ? { temporary_chat: current.request.temporary_chat }
      : {}),
    ...(typeof current.request?.conversationKey === "string"
      ? { conversationKey: current.request.conversationKey }
      : {}),
    ...(typeof current.request?.lockKey === "string"
      ? { lockKey: current.request.lockKey }
      : {}),
    ...(typeof current.request?.dedicatedPage === "boolean"
      ? { dedicatedPage: current.request.dedicatedPage }
      : {}),
    ...(typeof current.request?.ephemeral === "boolean"
      ? { ephemeral: current.request.ephemeral }
      : {}),
    ...(typeof current.request?.noQueue === "boolean"
      ? { noQueue: current.request.noQueue }
      : {}),
    ...(typeof current.request?.useImagesPage === "boolean"
      ? { useImagesPage: current.request.useImagesPage }
      : {}),
    ...(typeof current.request?.responseMarker === "string"
      ? { responseMarker: current.request.responseMarker }
      : {}),
    ...(typeof current.request?.response_marker === "string"
      ? { response_marker: current.request.response_marker }
      : {}),
    ...(Array.isArray(current.request?.attachments)
      ? { attachments: current.request?.attachments }
      : {}),
  };

  if (!phoneApiUrl && shouldUseNativeCromiteQueue()) {
    return runChatGptPhoneJobViaNativeCromite(
      jobId,
      request,
      effectiveTimeoutMs,
    );
  }

  if (!phoneApiUrl && shouldUseDirectCromiteImport()) {
    if (!acquireDirectPhoneSlot(jobId)) {
      return updateJob(jobId, {
        status: "failed",
        resultType: "text",
        errorMessage: "Sistema ocupado processando outra solicitação. Envie novamente em instantes.",
        completedAt: new Date(),
      });
    }

    await updateJob(jobId, { status: "running", startedAt: new Date(), errorMessage: null });

    try {
      let payload = await callCromiteMessageExecutor(request);
      const payloadFailure =
        trimOptional(payload.error) ?? trimOptional(payload.message) ?? trimOptional(payload.result);
      if (
        request.newChat === false &&
        payload.ok === false &&
        (isRetryableCurrentChatFailure(payloadFailure) ||
          isEchoedPromptFailure(payloadFailure, request.message))
      ) {
        payload = await callCromiteMessageExecutor({ ...request, newChat: true });
      }
      return updateChatGptPhoneJobFromExecutorPayload(
        jobId,
        payload,
        GENERIC_GENERATION_FAILURE,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao executar job no Cromite.";
      if (request.newChat === false && isRetryableCurrentChatFailure(message)) {
        try {
          const retryPayload = await callCromiteMessageExecutor({ ...request, newChat: true });
          return updateChatGptPhoneJobFromExecutorPayload(
            jobId,
            retryPayload,
            GENERIC_GENERATION_FAILURE,
          );
        } catch (retryError) {
          const retryMessage =
            retryError instanceof Error ? retryError.message : "Falha ao reabrir conversa no Cromite.";
          const status = /timeout|aborted|tempo/i.test(retryMessage) ? "timeout" : "failed";
          return updateJob(jobId, {
            status,
            errorMessage: GENERIC_GENERATION_FAILURE,
            completedAt: new Date(),
          });
        }
      }
      const status = /timeout|aborted|tempo/i.test(message) ? "timeout" : "failed";
      return updateJob(jobId, {
        status,
        errorMessage: GENERIC_GENERATION_FAILURE,
        completedAt: new Date(),
      });
    } finally {
      releaseDirectPhoneSlot(jobId);
    }
  }

  if (!phoneApiUrl) {
    if (await relayNoQueueBusy(jobId)) {
      return updateJob(jobId, {
        status: "failed",
        resultType: "text",
        errorMessage: "Sistema ocupado processando outra solicitação. Envie novamente em instantes.",
        completedAt: new Date(),
      });
    }
    return waitForChatGptPhoneJob(jobId, {
      timeoutMs: effectiveTimeoutMs,
    });
  }
  const phoneApiUsesGlobalSlot = request.dedicatedPage !== true && request.ephemeral !== true;
  let phoneApiSlotAcquired = false;
  if (phoneApiUsesGlobalSlot) {
    if (!acquireDirectPhoneSlot(jobId)) {
      return updateJob(jobId, {
        status: "failed",
        resultType: "text",
        errorMessage: "Sistema ocupado processando outra solicitação. Envie novamente em instantes.",
        completedAt: new Date(),
      });
    }
    phoneApiSlotAcquired = true;
  }

  await updateJob(jobId, { status: "running", startedAt: new Date(), errorMessage: null });

  try {
    let payload = await callPhoneMessageEndpoint(phoneApiUrl, request);
    const payloadFailure =
      trimOptional(payload.error) ?? trimOptional(payload.message) ?? trimOptional(payload.result);
    if (
      request.newChat === false &&
      payload.ok === false &&
      (isRetryableCurrentChatFailure(payloadFailure) ||
        isEchoedPromptFailure(payloadFailure, request.message))
    ) {
      payload = await callPhoneMessageEndpoint(phoneApiUrl, { ...request, newChat: true });
    }
    const markerNormalizedPayload = normalizePayloadForExpectedMarker(payload, current.request);
    if (markerNormalizedPayload.missingMarker) {
      console.warn("[chatgpt-phone] resposta HTTP sem marcador esperado; recusando resposta", {
        jobId,
        responsePreview: markerNormalizedPayload.responsePreview,
      });
      return updateJob(jobId, {
        status: "timeout",
        responseText: null,
        resultType: "text",
        artifacts: [],
        errorMessage: GENERIC_GENERATION_FAILURE,
        completedAt: new Date(),
      });
    }
    payload = markerNormalizedPayload.payload;
    const ok = payload.ok !== false;
    const resultType =
      trimOptional(payload.resultType) ??
      (Array.isArray(payload.artifacts) && payload.artifacts.length > 0 ? "media" : "text");
    const artifacts = extractArtifacts(payload);
    const responseText =
      trimOptional(payload.result) ??
      trimOptional(payload.response) ??
      trimOptional(payload.text);
    const materialized = materializeGeneratedDocumentArtifacts(current, responseText, resultType, artifacts);
    const errorMessage =
      ok ? null : trimOptional(payload.error) ?? trimOptional(payload.message) ?? GENERIC_GENERATION_FAILURE;

    return updateJob(jobId, {
      status: ok ? "succeeded" : "failed",
      responseText: materialized.responseText,
      resultType: materialized.resultType,
      artifacts: materialized.artifacts,
      phoneConversationId: trimOptional(payload.conversationId),
      phoneMessageId: trimOptional(payload.messageId),
      phoneInterceptKey: trimOptional(payload.interceptKey),
      workerId: trimOptional(payload.workerId),
      errorMessage,
      completedAt: new Date(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : GENERIC_GENERATION_FAILURE;
    if (request.newChat === false && isRetryableCurrentChatFailure(message)) {
      try {
        let retryPayload = await callPhoneMessageEndpoint(phoneApiUrl, { ...request, newChat: true });
        const markerNormalizedRetryPayload = normalizePayloadForExpectedMarker(retryPayload, current.request);
        if (markerNormalizedRetryPayload.missingMarker) {
          console.warn("[chatgpt-phone] retry HTTP sem marcador esperado; recusando resposta", {
            jobId,
            responsePreview: markerNormalizedRetryPayload.responsePreview,
          });
          return updateJob(jobId, {
            status: "timeout",
            responseText: null,
            resultType: "text",
            artifacts: [],
            errorMessage: GENERIC_GENERATION_FAILURE,
            completedAt: new Date(),
          });
        }
        retryPayload = markerNormalizedRetryPayload.payload;
        const ok = retryPayload.ok !== false;
        const resultType =
          trimOptional(retryPayload.resultType) ??
          (Array.isArray(retryPayload.artifacts) && retryPayload.artifacts.length > 0 ? "media" : "text");
        const artifacts = extractArtifacts(retryPayload);
        const responseText =
          trimOptional(retryPayload.result) ??
          trimOptional(retryPayload.response) ??
          trimOptional(retryPayload.text);
        const materialized = materializeGeneratedDocumentArtifacts(current, responseText, resultType, artifacts);
        const errorMessage =
          ok ? null : trimOptional(retryPayload.error) ?? trimOptional(retryPayload.message) ?? GENERIC_GENERATION_FAILURE;

        return updateJob(jobId, {
          status: ok ? "succeeded" : "failed",
          responseText: materialized.responseText,
          resultType: materialized.resultType,
          artifacts: materialized.artifacts,
          phoneConversationId: trimOptional(retryPayload.conversationId),
          phoneMessageId: trimOptional(retryPayload.messageId),
          phoneInterceptKey: trimOptional(retryPayload.interceptKey),
          workerId: trimOptional(retryPayload.workerId),
          errorMessage,
          completedAt: new Date(),
        });
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : GENERIC_GENERATION_FAILURE;
        const status = /timeout|aborted|tempo/i.test(retryMessage) ? "timeout" : "failed";
        return updateJob(jobId, {
          status,
          errorMessage: GENERIC_GENERATION_FAILURE,
          completedAt: new Date(),
        });
      }
    }
    const status = /timeout|aborted|tempo/i.test(message) ? "timeout" : "failed";
    return updateJob(jobId, {
      status,
      errorMessage: GENERIC_GENERATION_FAILURE,
      completedAt: new Date(),
    });
  } finally {
    if (phoneApiSlotAcquired) {
      releaseDirectPhoneSlot(jobId);
    }
  }
};

export const downloadChatGptPhoneArtifact = async (
  artifact: ChatGptPhoneArtifact,
  phoneApiUrl?: string | null,
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> => {
  const inlineDataUrl = trimOptional(artifact.dataUrl);
  if (inlineDataUrl) {
    const match = inlineDataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!match) {
      throw new Error("Artefato dataUrl inválido.");
    }
    const mimeType = trimOptional(match[1]) ?? artifact.mimeType ?? "image/png";
    const raw = decodeURIComponent(match[3] ?? "");
    const buffer = match[2] ? Buffer.from(raw, "base64") : Buffer.from(raw);
    const fileName =
      trimOptional(artifact.fileName) ??
      trimOptional(artifact.name) ??
      `chatgpt-phone-${Date.now()}.${mimeType.includes("jpeg") ? "jpg" : mimeType.split("/")[1] || "bin"}`;
    return { buffer, mimeType, fileName };
  }

  const inlineBase64 = trimOptional(artifact.base64);
  if (inlineBase64) {
    const mimeType = artifact.mimeType || "image/png";
    const fileName =
      trimOptional(artifact.fileName) ??
      trimOptional(artifact.name) ??
      `chatgpt-phone-${Date.now()}.${mimeType.includes("jpeg") ? "jpg" : mimeType.split("/")[1] || "bin"}`;
    return { buffer: Buffer.from(inlineBase64, "base64"), mimeType, fileName };
  }

  let url: URL;
  if (artifact.url) {
    if (/^https?:\/\//i.test(artifact.url)) {
      url = new URL(artifact.url);
    } else {
      const baseUrl = sanitizePhoneBaseUrl(phoneApiUrl) ?? getChatGptPhoneApiUrl();
      if (!baseUrl) {
        throw new Error("Artefato relativo sem base URL; envie uma URL absoluta ou configure CHATGPT_PHONE_API_URL.");
      }
      url = new URL(artifact.url, `${baseUrl}/`);
    }
  } else if (artifact.path) {
    const baseUrl = sanitizePhoneBaseUrl(phoneApiUrl) ?? getChatGptPhoneApiUrl();
    if (!baseUrl) {
      throw new Error("Artefato path sem base URL; envie url/base64/dataUrl pelo worker ou configure CHATGPT_PHONE_API_URL.");
    }
    url = new URL("/artifact", `${baseUrl}/`);
    url.searchParams.set("path", artifact.path);
  } else {
    throw new Error("Artefato sem url/path.");
  }

  const response = await fetch(url.toString(), { headers: { accept: artifact.mimeType ?? "*/*" } });
  if (!response.ok) {
    throw new Error(`Falha ao baixar artefato gerado: HTTP ${response.status}.`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || artifact.mimeType || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName =
    trimOptional(artifact.fileName) ??
    trimOptional(artifact.name) ??
    trimOptional(artifact.path?.split("/").pop()) ??
    `chatgpt-phone-${Date.now()}.${mimeType.includes("jpeg") ? "jpg" : mimeType.split("/")[1] || "bin"}`;

  return { buffer, mimeType, fileName };
};

export const getChatGptPhoneJobMcpContext = async (input: {
  jobId: string;
  accessCode: string;
}): Promise<{
  job: ChatGptPhoneJob;
  events: BotInterageContextEvent[];
} | null> => {
  const job = await getChatGptPhoneJob(input.jobId);
  if (!job) {
    return null;
  }
  const context = job.context && typeof job.context === "object"
    ? (job.context as Record<string, unknown>)
    : {};
  const expected = trimOptional(context.mcpAccessCode);
  if (!expected || expected !== input.accessCode.trim()) {
    return null;
  }
  const events = job.groupId
    ? await listBotInterageContextEvents({ groupId: job.groupId, limit: DEFAULT_CONTEXT_LIMIT }).catch(() => [])
    : [];
  return { job, events };
};

const stripAccents = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const isLikelyChatGptPhoneImageEditRequest = (text: string): boolean => {
  const normalized = stripAccents(text);
  const backgroundEdit =
    /\b(fundo removido|sem fundo|fundo transparente|png transparente|transparent background|background removido|remove background|removed background)\b/.test(
      normalized,
    ) ||
    /\b(remova|remove|remover|tira|tirar|apaga|apagar|retira|retirar)\b.{0,40}\b(fundo|background)\b/.test(
      normalized,
    ) ||
    /\b(fundo|background)\b.{0,40}\b(removido|remover|transparente|transparent)\b/.test(
      normalized,
    );
  if (backgroundEdit) {
    return true;
  }

  const qualityEdit =
    /\b(restaura|restaure|restaurar|melhora|melhore|melhorar|aumenta|aumente|aumentar|amplia|amplie|ampliar|realca|realce|realcar|corrige|corrija|corrigir|upscale|upscaler|upscaling|enhance|restore|sharpen)\b.{0,80}\b(qualidade|resolucao|resolução|nitidez|definicao|definição|4k|hd|full hd|imagem|foto|midia|media|video|photo|image|picture)\b/.test(
      normalized,
    ) ||
    /\b(qualidade|resolucao|resolução|nitidez|definicao|definição|4k|hd|full hd|upscale|upscaler|upscaling)\b.{0,80}\b(isso|isto|essa|esta|esse|este|midia|media|imagem|foto|video|arquivo|anexo|photo|image|picture)\b/.test(
      normalized,
    );
  if (qualityEdit) {
    return true;
  }

  const visualReference =
    /\b(isso|isto|esse|este|essa|esta|nesse|neste|nessa|nesta|aquela|minha|imagem|foto|midia|media|video|picture|photo|image|anexo|arquivo|referencia)\b/.test(
      normalized,
    );
  const editVerb =
    /\b(edita|edite|editar|transforma|transforme|transformar|altera|altere|alterar|troca|troque|substitua|adicione|remove|remova|melhora|melhore|melhorar|restaura|restaure|restaurar|aumenta|aumente|aumentar|amplia|amplie|ampliar|realca|realce|realcar|corrige|corrija|corrigir|recorta|recorte|recortar|upscale|upscaler|upscaling|edit|change|replace|add|remove|improve|enhance|restore|sharpen|crop)\b/.test(
      normalized,
    );
  return visualReference && editVerb;
};

export const isLikelyChatGptPhoneMediaRequest = (text: string): boolean => {
  const normalized = stripAccents(text);
  if (isLikelyChatGptPhoneImageEditRequest(text)) {
    return true;
  }
  const mentionsImage =
    /\b(imagem|foto|midia|media|desenho|arte|avatar|logo|banner|figurinha|sticker|ilustracao|wallpaper|image|photo|picture|drawing|artwork|illustration)\b/.test(
      normalized,
    );
  const asksGeneration =
    /\b(cria|crie|criar|gera|gere|gerar|desenha|desenhe|faca|fazer|monte|monta|edita|editar|transforma|transforme|melhora|melhore|melhorar|restaura|restaure|restaurar|upscale|upscaler|upscaling|create|generate|draw|make|render|design|edit|transform|enhance|restore)\b/.test(
      normalized,
    );
  const directImageCommand =
    /\b(criarimagem|createimage|imagegen|text2img|txt2img|gerar imagem|crie uma imagem|cria uma imagem|create an image|create image|generate an image|generate image|make an image|draw an image)\b/.test(
      normalized,
    );
  const referenceImage = /\b(baseado|com base|a partir|based on|from)\b.*\b(imagem|foto|image|photo|picture)\b/.test(
    normalized,
  );
  const visualCreationWithoutImageWord =
    asksGeneration &&
    /\b(versao|visual|personagem|skin|avatar|fanart|cosplay|estilo|character)\b/.test(normalized) &&
    !/\b(resumo|resumida|resumido|texto|mensagem|frase|copy|codigo|code|script)\b/.test(normalized);
  const visualCreationBySubject =
    asksGeneration &&
    /\b(pessoa|cabeca|rosto|corpo|personagem|bando|chapeu|anime|manga|cartoon|desenho|mascote|avatar|dinossauro|monstro|cenario|paisagem|produto|logo|banner|fanart|cosplay|skin|luffy|zoro|sanji|usopp|nami|naruto|goku)\b/.test(
      normalized,
    ) &&
    !/\b(resumo|resumida|resumido|texto|mensagem|frase|copy|codigo|code|script|explica|explique|explicar|calcula|calcule|calcular)\b/.test(
      normalized,
    );
  return (
    directImageCommand ||
    (mentionsImage && asksGeneration) ||
    referenceImage ||
    visualCreationWithoutImageWord ||
    visualCreationBySubject
  );
};

export const isLikelyChatGptPhoneDocumentRequest = (text: string): boolean => {
  const normalized = stripAccents(text);
  const mentionsDocument =
    /\b(pdf|documento|arquivo|relatorio|relatório|contrato|curriculo|currículo|recibo|orcamento|orçamento|proposta|certificado|apostila|material|doc|docx|word|txt|csv|planilha|excel|xlsx)\b/.test(
      normalized,
    );
  const asksCreation =
    /\b(cria|crie|criar|gera|gere|gerar|monte|monta|faca|fazer|escreva|escrever|produza|produzir|salve|salvar|anexe|anexar|envie|mandar|transforme|transformar|create|generate|make|write|export)\b/.test(
      normalized,
    );
  const asksPdf =
    /\b(?:em|para|como|formato)\s+pdf\b/.test(normalized) ||
    /\bpdf\b.{0,80}\b(cria|crie|gerar|gere|anexe|envie|salve|arquivo|documento)\b/.test(normalized);
  return mentionsDocument && (asksCreation || asksPdf);
};

const hasVisualChatGptPhoneAttachment = (
  attachments?: ChatGptPhoneInputAttachment[] | null,
): boolean =>
  Array.isArray(attachments) &&
  attachments.some((attachment) => {
    const mimeType = attachment.mimeType?.toLowerCase() ?? "";
    return mimeType.startsWith("image/") || mimeType.startsWith("video/");
  });

const hasNonVisualChatGptPhoneAttachment = (
  attachments?: ChatGptPhoneInputAttachment[] | null,
): boolean =>
  Array.isArray(attachments) &&
  attachments.some((attachment) => {
    const mimeType = attachment.mimeType?.toLowerCase() ?? "";
    return Boolean(mimeType) && !mimeType.startsWith("image/") && !mimeType.startsWith("video/");
  });

const hasAudioChatGptPhoneAttachment = (
  attachments?: ChatGptPhoneInputAttachment[] | null,
): boolean =>
  Array.isArray(attachments) &&
  attachments.some((attachment) => {
    const mimeType = attachment.mimeType?.toLowerCase() ?? "";
    const fileName = attachment.name ?? attachment.fileName ?? "";
    return isAudioAttachment(mimeType, fileName);
  });

const MAX_EXTRACTED_ATTACHMENT_CHARS = 24_000;

const decodeAttachmentBuffer = (attachment: ChatGptPhoneInputAttachment): Buffer | null => {
  const base64 = attachment.base64?.trim();
  if (!base64) {
    return null;
  }
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
};

const isPlainTextAttachment = (mimeType: string, fileName: string): boolean => {
  const normalized = mimeType.toLowerCase();
  const name = fileName.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/xml" ||
    normalized === "application/csv" ||
    normalized === "text/csv" ||
    /\.(txt|csv|json|xml|md|log)$/i.test(name)
  );
};

const isAudioAttachment = (mimeType: string, fileName: string): boolean => {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("audio/") || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm|amr)$/i.test(fileName);
};

const normalizeAudioAttachmentForChatGpt = async (
  attachment: ChatGptPhoneInputAttachment,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ChatGptPhoneInputAttachment | null> => {
  try {
    const wav = await convertMediaBufferToChatGptWav({
      buffer,
      fileName,
      mimeType,
    });
    console.info("[chatgpt-phone] audio anexado convertido para importacao no ChatGPT", {
      originalMimeType: mimeType,
      originalName: fileName,
      originalBytes: buffer.byteLength,
      convertedMimeType: wav.mimeType,
      convertedName: wav.fileName,
      convertedBytes: wav.buffer.byteLength,
    });
    return {
      ...attachment,
      name: wav.fileName,
      fileName: wav.fileName,
      mimeType: wav.mimeType,
      base64: wav.buffer.toString("base64"),
    };
  } catch (error) {
    console.warn("[chatgpt-phone] falha ao converter audio anexado para ChatGPT; usando arquivo original", {
      fileName,
      mimeType,
      error,
    });
    return null;
  }
};

const extractTextFromPdfAttachment = async (
  attachment: ChatGptPhoneInputAttachment,
  buffer: Buffer,
): Promise<string | null> => {
  const dir = await mkdtemp(path.join(tmpdir(), "botadmin-chatgpt-pdf-"));
  const fileName = (attachment.name || attachment.fileName || "arquivo.pdf").replace(/[\\/\0]+/g, "_");
  const filePath = path.join(dir, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
  try {
    await writeFile(filePath, buffer);
    const { stdout } = await execFile("/bin/pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"], {
      timeout: 15_000,
      maxBuffer: 3 * 1024 * 1024,
    });
    const text = normalizePdfText(String(stdout || ""));
    return text || null;
  } catch (error) {
    console.warn("[chatgpt-phone] falha ao extrair texto de PDF anexado", {
      fileName: attachment.name ?? attachment.fileName ?? null,
      mimeType: attachment.mimeType,
      error,
    });
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const prepareFileAttachmentsForChatGptPhone = async (
  attachments?: ChatGptPhoneInputAttachment[] | null,
): Promise<{
  attachments: ChatGptPhoneInputAttachment[];
  extractedPromptBlock: string | null;
  extractedCount: number;
}> => {
  const source = Array.isArray(attachments) ? attachments : [];
  const keepForUpload: ChatGptPhoneInputAttachment[] = [];
  const blocks: string[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const attachment = source[index];
    const mimeType = (attachment.mimeType || "application/octet-stream").toLowerCase();
    const fileName = attachment.name || attachment.fileName || `arquivo-${index + 1}`;
    const isVisual = mimeType.startsWith("image/") || mimeType.startsWith("video/");
    if (isVisual) {
      keepForUpload.push(attachment);
      continue;
    }

    const buffer = decodeAttachmentBuffer(attachment);
    if (!buffer) {
      keepForUpload.push(attachment);
      continue;
    }

    if (isAudioAttachment(mimeType, fileName)) {
      keepForUpload.push(
        (await normalizeAudioAttachmentForChatGpt(attachment, buffer, mimeType, fileName)) ?? attachment,
      );
      continue;
    }

    let extractedText: string | null = null;
    const extractedKind = "ARQUIVO_ANEXADO_EXTRAIDO";
    if (mimeType === "application/pdf" || /\.pdf$/i.test(fileName)) {
      extractedText = await extractTextFromPdfAttachment(attachment, buffer);
    } else if (isPlainTextAttachment(mimeType, fileName)) {
      extractedText = normalizePdfText(buffer.toString("utf8"));
    }

    if (!extractedText) {
      keepForUpload.push(attachment);
      continue;
    }

    blocks.push(
      [
        `${extractedKind}_${blocks.length + 1}`,
        `nome=${fileName}`,
        `mimeType=${mimeType}`,
        "conteudo:",
        extractedText.slice(0, MAX_EXTRACTED_ATTACHMENT_CHARS),
      ].join("\n"),
    );
  }

  return {
    attachments: keepForUpload,
    extractedPromptBlock: blocks.length
      ? [
          "CONTEUDO_EXTRAIDO_DOS_ANEXOS",
          "Use este conteudo como fonte principal para responder ao pedido do WhatsApp.",
          ...blocks,
        ].join("\n\n")
      : null,
    extractedCount: blocks.length,
  };
};

export const isLikelyChatGptPhoneDownloadRequest = (text: string): boolean => {
  if (isLikelyChatGptPhoneImageEditRequest(text)) {
    return false;
  }
  const trimmed = text.trim();
  const normalized = stripAccents(trimmed);
  const hasMediaUrl =
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(trimmed) ||
    /(?:https?:\/\/)?(?:open\.)?spotify\.com\//i.test(trimmed) ||
    /(?:https?:\/\/)?(?:www\.)?soundcloud\.com\//i.test(trimmed);
  if (hasMediaUrl) {
    return true;
  }
  const mediaHint = /\b(musica|som|audio|mp3|video|mp4|clipe|youtube|yt|spotify|soundcloud)\b/.test(
    normalized,
  );
  const actionHint =
    /\b(baixar?|baixe|download|manda(?:r)?|envia(?:r)?|toca(?:r)?|procura(?:r)?|pesquisa(?:r)?|coloca(?:r)?|bota(?:r)?|play)\b/.test(
      normalized,
    ) || /\b(quero|queria|gostaria de|pode|poderia)\b.{0,30}\b(ouvir|escutar|ver|assistir)\b/.test(normalized);
  const listeningIntent = /\b(quero ouvir|queria ouvir|gostaria de ouvir|toca ai|bota ai|coloca ai)\b/.test(
    normalized,
  );
  return (actionHint && mediaHint) || listeningIntent;
};

export const shouldUseChatGptPhoneForBotInterage = (text: string): boolean => {
  const dispatchMode = process.env.CHATGPT_PHONE_DISPATCH_MODE?.trim().toLowerCase();
  const hasExecutor =
    Boolean(getChatGptPhoneApiUrl()) ||
    shouldUseNativeCromiteQueue() ||
    shouldUseDirectCromiteImport() ||
    dispatchMode === "relay";
  if (!hasExecutor) {
    return false;
  }
  const mode =
    process.env.BOTINTERAGE_CHATGPT_PHONE_MODE?.trim().toLowerCase() ||
    (process.env.BOTINTERAGE_CHATGPT_PHONE_ENABLED === "1" ||
    process.env.BOTINTERAGE_CHATGPT_PHONE_ENABLED?.toLowerCase() === "true"
      ? "media"
      : "off");

  if (mode === "all") {
    return true;
  }
  if (mode === "media") {
    return (
      isLikelyChatGptPhoneMediaRequest(text) ||
      isLikelyChatGptPhoneDocumentRequest(text) ||
      isLikelyChatGptPhoneDownloadRequest(text)
    );
  }
  if (mode === "images" || mode === "image") {
    return isLikelyChatGptPhoneMediaRequest(text);
  }
  if (mode === "downloads" || mode === "download" || mode === "music" || mode === "play") {
    return isLikelyChatGptPhoneDownloadRequest(text);
  }
  return false;
};

export const buildBotInterageChatGptPhonePrompt = (input: {
  jobId: string;
  accessCode?: string | null;
  responseMarker?: string | null;
  userId?: number | null;
  groupId?: number | null;
  groupName?: string | null;
  groupRemoteId?: string | null;
  senderName?: string | null;
  senderJid?: string | null;
  whatsappMessageId?: string | null;
  message: string;
  contextEvents: BotInterageContextEvent[];
  attachmentCount?: number | null;
  documentRequest?: boolean | null;
  fileAttachmentRequest?: boolean | null;
  audioAttachmentRequest?: boolean | null;
}): string => {
  const conversationKey = `botinterage:group:${input.groupId ?? input.groupRemoteId ?? "unknown"}`;
  const contextCount = input.contextEvents.filter((event) => event.content.trim()).length;
  const senderPhone = (() => {
    const raw = input.senderJid?.trim() ?? "";
    if (!raw || raw.includes("@lid")) {
      return null;
    }
    const digits = raw.replace(/\D+/g, "");
    return digits.length >= 8 ? digits : null;
  })();

  if (input.audioAttachmentRequest) {
    return [
      "BOTADMIN_AUDIO_ONLY_TASK",
      `jobId=${input.jobId}`,
      input.attachmentCount ? `attachmentCount=${input.attachmentCount}` : null,
      "DO_NOT_USE_MCP=true",
      "DO_NOT_USE_HISTORY=true",
      "REPLY_RULE=escute somente o audio anexado no ChatGPT; nao use historico, memoria, conversas anteriores, MCP, busca ou contexto do grupo para inferir a fala; transcreva mentalmente a fala e execute o pedido falado; se nao tiver certeza, responda BOTADMIN_AUDIO_UNCLEAR; se o audio pedir criacao ou edicao de imagem, responda exatamente uma unica linha no formato BOTADMIN_AUDIO_IMAGE_PROMPT: seguido do prompt visual completo em portugues; nao reutilize prompts antigos.",
      "",
      "message:",
      input.message,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  return [
    "BOTADMIN_CONTEXT",
    `conversationKey=${conversationKey}`,
    input.userId ? `userId=${input.userId}` : null,
    input.groupId ? `groupId=${input.groupId}` : null,
    input.groupName ? `group=${input.groupName}` : null,
    input.groupRemoteId ? `groupJid=${input.groupRemoteId}` : null,
    senderPhone ? `senderPhone=${senderPhone}` : null,
    input.senderJid ? `senderJid=${input.senderJid}` : null,
    input.senderName ? `senderName=${input.senderName}` : null,
    input.whatsappMessageId ? `whatsappMessageId=${input.whatsappMessageId}` : null,
    `recentContextCount=${contextCount}`,
    input.attachmentCount ? `attachmentCount=${input.attachmentCount}` : null,
    input.responseMarker ? `ROUTE_CODE=${input.responseMarker}` : null,
    input.documentRequest ? "OUTPUT_FORMAT=PDF_SOURCE_TEXT" : null,
    input.fileAttachmentRequest ? "ATTACHMENT_MODE=ANALYZE_FILES" : null,
    "MCP_CONTEXT_HINT=use botadmin_get_botinterage_history only if you need prior messages for this sender/group.",
    input.documentRequest
      ? "REPLY_RULE=crie o conteudo final do documento pedido em texto limpo; nao diga que anexou arquivo, nao invente link de download, nao escreva apenas nome de arquivo; o BotAdmin convertera sua resposta em PDF e enviara ao WhatsApp."
      : input.audioAttachmentRequest
      ? "REPLY_RULE=escute somente o audio anexado no ChatGPT; transcreva mentalmente a fala e execute o pedido falado; se o audio pedir criacao ou edicao de imagem, responda exatamente uma unica linha no formato BOTADMIN_AUDIO_IMAGE_PROMPT: seguido do prompt visual completo em portugues; nao diga que nao recebeu arquivo quando houver audio anexado; se a fala estiver curta, use o melhor entendimento possivel."
      : input.fileAttachmentRequest
      ? "REPLY_RULE=analise os arquivos anexados no ChatGPT, inclusive audio, quando eles forem relevantes; se o audio/anexo pedir criacao ou edicao de imagem, nao explique e responda exatamente BOTADMIN_AUDIO_IMAGE_PROMPT: seguido do prompt visual completo em portugues; caso contrario, responda em portugues de forma objetiva."
      : input.responseMarker
      ? `REPLY_RULE=ignore qualquer ROUTE_CODE antigo visto nesta conversa; a primeira linha da sua resposta deve ser exatamente ${input.responseMarker}; na linha seguinte responda a mensagem em um unico bloco de texto, objetivo, sem listas; nao explique o codigo inicial; nao crie, anexe, reutilize ou sugira imagem/arquivo/midia/PDF quando o pedido atual for apenas texto.`
      : "REPLY_RULE=answer normally in this chat. BotAdmin/Cromite captures the full visible answer or generated file and sends it to WhatsApp.",
    "",
    "message:",
    input.message,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
};

export const createAndRunBotInterageChatGptPhoneJob = async (input: {
  userId: number;
  groupId: number;
  instanceId: number;
  groupRemoteId: string;
  groupName?: string | null;
  senderJid?: string | null;
  senderName?: string | null;
  whatsappMessageId?: string | null;
  message: string;
  attachments?: ChatGptPhoneInputAttachment[] | null;
  newChat?: boolean | null;
}): Promise<ChatGptPhoneJob> => {
  const jobId = randomUUID();
  const mcpAccessCode = randomUUID();
  const contextEvents = await listBotInterageContextEvents({
    groupId: input.groupId,
    limit: DEFAULT_CONTEXT_LIMIT,
  }).catch(() => []);
  const attachmentPreparation = await prepareFileAttachmentsForChatGptPhone(input.attachments);
  const effectiveAttachments = attachmentPreparation.attachments;
  const effectiveMessage = attachmentPreparation.extractedPromptBlock
    ? `${input.message}\n\n${attachmentPreparation.extractedPromptBlock}`
    : input.message;
  const hasNonVisualEffectiveAttachment = hasNonVisualChatGptPhoneAttachment(effectiveAttachments);
  const hasAudioEffectiveAttachment = hasAudioChatGptPhoneAttachment(effectiveAttachments);
  const mediaRequest =
    !hasNonVisualEffectiveAttachment &&
    (isLikelyChatGptPhoneMediaRequest(input.message) ||
      hasVisualChatGptPhoneAttachment(effectiveAttachments));
  const documentRequest = !mediaRequest && isLikelyChatGptPhoneDocumentRequest(input.message);
  const fileAttachmentRequest =
    !mediaRequest && !documentRequest && hasNonVisualEffectiveAttachment;
  const artifactRequest = mediaRequest || documentRequest || fileAttachmentRequest;
  const artifactKind = mediaRequest ? "media" : documentRequest ? "document" : fileAttachmentRequest ? "file" : "text";
  const responseMarker = artifactRequest ? null : `R${jobId.split("-")[0].toUpperCase()}`;
  const jobSettleMs = mediaRequest ? DEFAULT_SETTLE_MS : DEFAULT_TEXT_SETTLE_MS;
  const baseConversationKey = `botinterage:group:${input.groupId}`;
  const executionConversationKey = artifactRequest
    ? `${baseConversationKey}:${artifactKind}:${jobId}`
    : baseConversationKey;
  const executionLockKey = mediaRequest
    ? `${baseConversationKey}:media`
    : documentRequest
      ? `${baseConversationKey}:document`
      : fileAttachmentRequest
        ? `${baseConversationKey}:file:${jobId}`
        : baseConversationKey;
  const jobTimeoutMs = mediaRequest
    ? DEFAULT_PHONE_MEDIA_TIMEOUT_MS
    : fileAttachmentRequest || documentRequest
      ? DEFAULT_PHONE_FILE_TIMEOUT_MS
      : 120_000;
  const phonePrompt = buildBotInterageChatGptPhonePrompt({
    jobId,
    accessCode: mcpAccessCode,
    responseMarker,
    userId: input.userId,
    groupId: input.groupId,
    groupName: input.groupName,
    groupRemoteId: input.groupRemoteId,
    senderName: input.senderName,
    senderJid: input.senderJid,
    whatsappMessageId: input.whatsappMessageId,
    message: effectiveMessage,
    contextEvents,
    attachmentCount: input.attachments?.length ?? 0,
    documentRequest,
    fileAttachmentRequest,
    audioAttachmentRequest: hasAudioEffectiveAttachment,
  });
  const newChat = artifactRequest ? true : input.newChat ?? false;
  const job = await createChatGptPhoneJob({
    jobId,
    userId: input.userId,
    groupId: input.groupId,
    instanceId: input.instanceId,
    groupRemoteId: input.groupRemoteId,
    senderJid: input.senderJid,
    senderName: input.senderName,
    whatsappMessageId: input.whatsappMessageId,
    prompt: input.message,
    context: {
      source: "botinterage",
      conversationKey: baseConversationKey,
      executionConversationKey,
      artifactMode: documentRequest ? "pdf" : mediaRequest ? "image" : fileAttachmentRequest ? "file" : "text",
      groupName: input.groupName ?? null,
      contextEventIds: contextEvents.map((event) => event.id),
      mcpAccessCode,
      extractedAttachmentCount: attachmentPreparation.extractedCount,
    },
    request: {
      message: phonePrompt,
      timeoutMs: jobTimeoutMs,
      settleMs: jobSettleMs,
      newChat,
      executor: "native-cromite",
      conversationKey: executionConversationKey,
      lockKey: executionLockKey,
      dedicatedPage: artifactRequest,
      ephemeral: artifactRequest,
      noQueue: artifactRequest,
      useImagesPage: mediaRequest && !hasNonVisualEffectiveAttachment,
      ...(documentRequest ? { artifactMode: "pdf" } : fileAttachmentRequest ? { artifactMode: "file" } : {}),
      resultSource: "database",
      requireMcpCompletion: false,
      ...(responseMarker ? { responseMarker } : {}),
      ...(effectiveAttachments.length ? { attachments: effectiveAttachments } : {}),
    },
  });

  const completedJob = await runChatGptPhoneJob(job.jobId, {
    timeoutMs: jobTimeoutMs,
    settleMs: jobSettleMs,
    newChat,
  });
  if (fileAttachmentRequest && isAudioUnclearMarker(completedJob.responseText)) {
    return updateJob(completedJob.jobId, {
      responseText: "Não consegui entender esse áudio com segurança. Envie novamente mais claro ou mande o pedido em texto.",
      resultType: "text",
      completedAt: new Date(),
    });
  }
  const audioImagePrompt = fileAttachmentRequest
    ? parseAudioImagePromptMarker(completedJob.responseText)
    : null;
  if (audioImagePrompt) {
    console.info("[chatgpt-phone] pedido visual extraido de audio/anexo; iniciando geracao de imagem", {
      sourceJobId: completedJob.jobId,
      groupId: input.groupId,
      promptPreview: audioImagePrompt.slice(0, 180),
    });
    return createAndRunBotInterageChatGptPhoneJob({
      ...input,
      message: `Crie uma imagem: ${audioImagePrompt}`,
      attachments: [],
      newChat: true,
    });
  }
  return completedJob;
};
