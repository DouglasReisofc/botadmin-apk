import { createHash } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { getBotInterageRuntimeConfig } from "lib/admin-botinterage-config";
import { getDb } from "lib/db";

export type BotInterageSystemConversation = {
  conversationId: string;
  lastMessageId: string | null;
};

export type BotInterageSystemJob = {
  jobId: string;
  groupId: number;
  userId: number;
  instanceId: number;
  chatId: string;
  senderJid: string;
  whatsappMessageId: string | null;
  internalGroupId: number | null;
  internalMessageId: number | null;
  prompt: string;
  status: string;
  createdAt: Date;
};

type ConversationRow = RowDataPacket & {
  conversation_id: string;
  last_message_id: string | null;
};

type JobRow = RowDataPacket & {
  job_id: string;
  group_id: number;
  user_id: number;
  instance_id: number;
  chat_id: string;
  sender_jid: string;
  whatsapp_message_id: string | null;
  internal_group_id: number | null;
  internal_message_id: number | null;
  prompt: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
};

let ensurePromise: Promise<void> | null = null;

export const ensureBotInterageSystemTables = async (): Promise<void> => {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS botinterage_system_conversations (
        group_id INT NOT NULL,
        sender_jid VARCHAR(191) NOT NULL,
        conversation_id VARCHAR(191) NOT NULL,
        last_message_id VARCHAR(191) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, sender_jid),
        CONSTRAINT fk_botinterage_system_conversation_group
          FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS botinterage_system_jobs (
        job_id VARCHAR(191) NOT NULL PRIMARY KEY,
        group_id INT NOT NULL,
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        chat_id VARCHAR(191) NOT NULL,
        sender_jid VARCHAR(191) NOT NULL,
        whatsapp_message_id VARCHAR(191) NULL,
        internal_group_id BIGINT NULL,
        internal_message_id BIGINT NULL,
        prompt TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'accepted',
        event_id VARCHAR(191) NULL,
        delivered_message_id VARCHAR(191) NULL,
        last_error TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL DEFAULT NULL,
        UNIQUE KEY uq_botinterage_system_event (event_id),
        KEY idx_botinterage_system_jobs_status (status, created_at),
        CONSTRAINT fk_botinterage_system_job_group
          FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_botinterage_system_job_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    const ensureJobColumn = async (column: string, definition: string) => {
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM botinterage_system_jobs LIKE ?",
        [column],
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        await db.query(`ALTER TABLE botinterage_system_jobs ADD COLUMN ${definition}`);
      }
    };
    await ensureJobColumn(
      "internal_group_id",
      "internal_group_id BIGINT NULL AFTER whatsapp_message_id",
    );
    await ensureJobColumn(
      "internal_message_id",
      "internal_message_id BIGINT NULL AFTER internal_group_id",
    );
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
};

const normalizeSenderJid = (value: string): string =>
  value.trim().slice(0, 191);

export const getBotInterageSystemConversation = async (
  groupId: number,
  senderJid: string,
): Promise<BotInterageSystemConversation | null> => {
  await ensureBotInterageSystemTables();
  const db = getDb();
  const [rows] = await db.query<ConversationRow[]>(
    `
      SELECT conversation_id, last_message_id
      FROM botinterage_system_conversations
      WHERE group_id = ? AND sender_jid = ?
      LIMIT 1
    `,
    [groupId, normalizeSenderJid(senderJid)],
  );
  const row = rows[0];
  if (!row?.conversation_id) return null;
  return {
    conversationId: row.conversation_id,
    lastMessageId: row.last_message_id ?? null,
  };
};

export const saveBotInterageSystemConversation = async (params: {
  groupId: number;
  senderJid: string;
  conversationId: string;
  messageId?: string | null;
}): Promise<void> => {
  const conversationId = params.conversationId.trim();
  if (!conversationId) return;
  await ensureBotInterageSystemTables();
  const db = getDb();
  await db.query(
    `
      INSERT INTO botinterage_system_conversations (
        group_id, sender_jid, conversation_id, last_message_id
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        conversation_id = VALUES(conversation_id),
        last_message_id = VALUES(last_message_id),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      params.groupId,
      normalizeSenderJid(params.senderJid),
      conversationId.slice(0, 191),
      params.messageId?.trim().slice(0, 191) || null,
    ],
  );
};

const imageEndpoint = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}/images/generations?delivery=webhook`
    : `${normalized}/v1/images/generations?delivery=webhook`;
};

const submitSystemJobWithRetry = async (
  endpoint: string,
  init: RequestInit,
): Promise<Response> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        ...init,
        signal: AbortSignal.timeout(25_000),
      });
      const retryable = response.status === 429 || response.status === 502 ||
        response.status === 503 || response.status === 504;
      if (!retryable || attempt === 2) return response;
      await response.arrayBuffer().catch(() => undefined);
      const retryAfter = Number(response.headers.get("retry-after") || 0);
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(10_000, retryAfter * 1_000)
        : 750 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Não foi possível alcançar a API do ChatGPT Sistema.");
};

const audioAskEndpoint = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}/audio/native/ask?delivery=webhook`
    : `${normalized}/v1/audio/native/ask?delivery=webhook`;
};

const askEndpoint = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}/ask?delivery=webhook`
    : `${normalized}/v1/ask?delivery=webhook`;
};

export const submitBotInterageSystemVideoAnalysisJob = async (params: {
  groupId: number;
  userId: number;
  instanceId: number;
  chatId: string;
  senderJid: string;
  whatsappMessageId?: string | null;
  prompt: string;
  attachments: Array<{ name: string; mimeType: string; base64: string }>;
}): Promise<{ jobId: string; status: string }> => {
  const config = await getBotInterageRuntimeConfig();
  if (!config.enabled || !config.baseUrl || !config.token) {
    throw new Error("ChatGPT Sistema não está configurado.");
  }
  if (!config.webhookSecret || !config.webhookId) {
    throw new Error("Webhook do ChatGPT Sistema não está configurado.");
  }
  if (!params.attachments.some((attachment) => attachment.mimeType.toLowerCase().startsWith("video/"))) {
    throw new Error("A análise de vídeo exige pelo menos um anexo video/*.");
  }
  const conversation = await getBotInterageSystemConversation(
    params.groupId,
    params.senderJid,
  );
  const idempotencyKey = `wa-video-analysis-${createHash("sha256")
    .update(`${params.groupId}:${params.whatsappMessageId || params.prompt}`)
    .digest("hex")}`;
  const response = await submitSystemJobWithRetry(askEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "respond-async",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      prompt: params.prompt.trim(),
      model: "auto",
      provider: "chatgpt",
      attachments: params.attachments,
      ...(conversation?.conversationId
        ? {
            conversation_id: conversation.conversationId,
            ...(conversation.lastMessageId
              ? { parent_message_id: conversation.lastMessageId }
              : {}),
          }
        : {}),
    }),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const jobId = typeof payload?.job_id === "string" ? payload.job_id.trim() : "";
  if (!response.ok || !jobId) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : `A API de análise de vídeo retornou HTTP ${response.status}.`;
    throw new Error(message);
  }

  await ensureBotInterageSystemTables();
  const db = getDb();
  await db.query(
    `
      INSERT INTO botinterage_system_jobs (
        job_id, group_id, user_id, instance_id, chat_id, sender_jid,
        whatsapp_message_id, prompt, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted')
      ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
    `,
    [
      jobId,
      params.groupId,
      params.userId,
      params.instanceId,
      params.chatId.slice(0, 191),
      normalizeSenderJid(params.senderJid),
      params.whatsappMessageId?.trim().slice(0, 191) || null,
      params.prompt.trim(),
    ],
  );
  return {
    jobId,
    status: typeof payload?.status === "string" ? payload.status : "queued",
  };
};

export const submitBotInterageSystemAudioJob = async (params: {
  groupId: number;
  userId: number;
  instanceId: number;
  chatId: string;
  senderJid: string;
  whatsappMessageId?: string | null;
  prompt: string;
  audio: { name: string; mimeType: string; base64: string };
  references?: Array<{ name: string; mimeType: string; base64: string }>;
  language?: string | null;
}): Promise<{ jobId: string; status: string }> => {
  const config = await getBotInterageRuntimeConfig();
  if (!config.enabled || !config.baseUrl || !config.token) {
    throw new Error("ChatGPT Sistema não está configurado.");
  }
  if (!config.webhookSecret || !config.webhookId) {
    throw new Error("Webhook do ChatGPT Sistema não está configurado.");
  }
  const conversation = await getBotInterageSystemConversation(
    params.groupId,
    params.senderJid,
  );
  const idempotencyKey = `wa-native-audio-${createHash("sha256")
    .update(`${params.groupId}:${params.whatsappMessageId || params.audio.base64.slice(0, 128)}`)
    .digest("hex")}`;
  const response = await submitSystemJobWithRetry(audioAskEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "respond-async",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      audio_base64: params.audio.base64,
      mime_type: params.audio.mimeType || "audio/ogg",
      filename: params.audio.name || "whatsapp-audio.ogg",
      reference_attachments: (params.references || []).map((attachment) => ({
        name: attachment.name,
        mime_type: attachment.mimeType || "application/octet-stream",
        base64: attachment.base64,
      })),
      prompt: params.prompt.trim(),
      ...(params.language?.trim() ? { language: params.language.trim() } : {}),
      ...(conversation?.conversationId
        ? {
            conversation_id: conversation.conversationId,
            ...(conversation.lastMessageId
              ? { parent_message_id: conversation.lastMessageId }
              : {}),
          }
        : {}),
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const jobId = typeof payload?.job_id === "string" ? payload.job_id.trim() : "";
  if (!response.ok || !jobId) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : `A API de áudio retornou HTTP ${response.status}.`;
    throw new Error(message);
  }

  await ensureBotInterageSystemTables();
  const db = getDb();
  await db.query(
    `
      INSERT INTO botinterage_system_jobs (
        job_id, group_id, user_id, instance_id, chat_id, sender_jid,
        whatsapp_message_id, prompt, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted')
      ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
    `,
    [
      jobId,
      params.groupId,
      params.userId,
      params.instanceId,
      params.chatId.slice(0, 191),
      normalizeSenderJid(params.senderJid),
      params.whatsappMessageId?.trim().slice(0, 191) || null,
      params.prompt.trim(),
    ],
  );
  return {
    jobId,
    status: typeof payload?.status === "string" ? payload.status : "queued",
  };
};

export const submitBotInterageSystemImageJob = async (params: {
  groupId: number;
  userId: number;
  instanceId: number;
  chatId: string;
  senderJid: string;
  whatsappMessageId?: string | null;
  internalGroupId?: number | null;
  internalMessageId?: number | null;
  prompt: string;
  attachments?: Array<{ name: string; mimeType: string; base64: string }>;
}): Promise<{ jobId: string; status: string }> => {
  const config = await getBotInterageRuntimeConfig();
  if (!config.enabled || !config.baseUrl || !config.token) {
    throw new Error("ChatGPT Sistema não está configurado.");
  }
  if (!config.webhookSecret || !config.webhookId) {
    throw new Error("Webhook do ChatGPT Sistema não está configurado.");
  }
  const conversation = await getBotInterageSystemConversation(
    params.groupId,
    params.senderJid,
  );
  const idempotencyKey = `wa-img-${createHash("sha256")
    .update(`${params.groupId}:${params.whatsappMessageId || params.prompt}`)
    .digest("hex")}`;
  const response = await submitSystemJobWithRetry(imageEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "respond-async",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      prompt: params.prompt.trim(),
      model: "auto",
      ...(conversation?.conversationId
        ? {
            conversation_id: conversation.conversationId,
            ...(conversation.lastMessageId
              ? { parent_message_id: conversation.lastMessageId }
              : {}),
          }
        : {}),
      ...(params.attachments && params.attachments.length > 0
        ? { attachments: params.attachments }
        : {}),
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const jobId = typeof payload?.job_id === "string" ? payload.job_id.trim() : "";
  if (!response.ok || !jobId) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : `A API de imagem retornou HTTP ${response.status}.`;
    throw new Error(message);
  }

  await ensureBotInterageSystemTables();
  const db = getDb();
  await db.query(
    `
      INSERT INTO botinterage_system_jobs (
        job_id, group_id, user_id, instance_id, chat_id, sender_jid,
        whatsapp_message_id, internal_group_id, internal_message_id, prompt, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')
      ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
    `,
    [
      jobId,
      params.groupId,
      params.userId,
      params.instanceId,
      params.chatId.slice(0, 191),
      normalizeSenderJid(params.senderJid),
      params.whatsappMessageId?.trim().slice(0, 191) || null,
      Number(params.internalGroupId) > 0 ? Number(params.internalGroupId) : null,
      Number(params.internalMessageId) > 0 ? Number(params.internalMessageId) : null,
      params.prompt.trim(),
    ],
  );
  return {
    jobId,
    status: typeof payload?.status === "string" ? payload.status : "queued",
  };
};

const mapJob = (row: JobRow): BotInterageSystemJob => ({
  jobId: row.job_id,
  groupId: Number(row.group_id),
  userId: Number(row.user_id),
  instanceId: Number(row.instance_id),
  chatId: row.chat_id,
  senderJid: row.sender_jid,
  whatsappMessageId: row.whatsapp_message_id ?? null,
  internalGroupId: Number(row.internal_group_id) > 0 ? Number(row.internal_group_id) : null,
  internalMessageId: Number(row.internal_message_id) > 0 ? Number(row.internal_message_id) : null,
  prompt: row.prompt,
  status: row.status,
  createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
});

export const getBotInterageSystemJob = async (
  jobId: string,
): Promise<BotInterageSystemJob | null> => {
  await ensureBotInterageSystemTables();
  const db = getDb();
  const [rows] = await db.query<JobRow[]>(
    "SELECT * FROM botinterage_system_jobs WHERE job_id = ? LIMIT 1",
    [jobId],
  );
  return rows[0] ? mapJob(rows[0]) : null;
};

export const claimBotInterageSystemJob = async (params: {
  jobId: string;
  eventId: string;
}): Promise<"claimed" | "delivered" | "busy" | "missing"> => {
  await ensureBotInterageSystemTables();
  const db = getDb();
  const current = await getBotInterageSystemJob(params.jobId);
  if (!current) return "missing";
  if (current.status === "delivered" || current.status === "failed") return "delivered";
  const staleDeliveryCutoff = new Date(Date.now() - 2 * 60 * 1_000);
  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE botinterage_system_jobs
      SET status = 'delivering', event_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
        AND status NOT IN ('delivered', 'failed')
        AND (
          status <> 'delivering'
          OR updated_at < ?
        )
    `,
    [params.eventId.slice(0, 191), params.jobId, staleDeliveryCutoff],
  );
  return result.affectedRows > 0 ? "claimed" : "busy";
};

export const completeBotInterageSystemJob = async (params: {
  jobId: string;
  status: "delivered" | "failed" | "accepted";
  messageId?: string | null;
  error?: string | null;
}): Promise<void> => {
  await ensureBotInterageSystemTables();
  const db = getDb();
  await db.query(
    `
      UPDATE botinterage_system_jobs
      SET status = ?, delivered_message_id = ?, last_error = ?,
          completed_at = CASE WHEN ? IN ('delivered', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `,
    [
      params.status,
      params.messageId?.trim().slice(0, 191) || null,
      params.error?.trim().slice(0, 4000) || null,
      params.status,
      params.jobId,
    ],
  );
};
