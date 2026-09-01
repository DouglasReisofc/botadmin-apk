import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import { ensureBotGroupTable, ensureUserTable, getDb } from "lib/db";
import { evaluatePlanGuard } from "lib/plan-guard";

const TABLE_NAME = "affiliate_ml_group_dispatches";
const PROVIDER_KEY = "mercadolivre";
const DEFAULT_DELAY_MINUTES = 15;
const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 1440;
const MAX_ERROR_LENGTH = 500;

const ensureTasks = new Map<string, Promise<void>>();
const ensureDone = new Set<string>();

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

type AffiliateMlGroupDispatchRow = RowDataPacket & {
  id: number;
  user_id: number;
  provider: string;
  group_id: number;
  group_remote_id: string;
  instance_id: number;
  enabled: number | boolean;
  delay_minutes: number;
  category_rotation_enabled: number | boolean;
  last_error: string | null;
  last_sent_at: Date | string | null;
  last_item_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  group_name?: string | null;
  group_status?: string | null;
  group_remote_current?: string | null;
  group_instance_current?: number | null;
};

export type AffiliateMlGroupDispatchSummary = {
  id: number;
  groupId: number;
  groupName: string;
  groupStatus: "active" | "disabled" | null;
  groupRemoteId: string;
  instanceId: number;
  enabled: boolean;
  delayMinutes: number;
  categoryRotationEnabled: boolean;
  lastError: string | null;
  lastSentAt: string | null;
  lastItemId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AffiliateMlGroupDispatchWorkerEntry = {
  id: number;
  userId: number;
  groupId: number;
  groupName: string;
  groupRemoteId: string;
  instanceId: number;
  delayMinutes: number;
  categoryRotationEnabled: boolean;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return fallback;
};

const normalizeRemoteId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized;
};

const normalizeItemId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  return normalized || null;
};

const sanitizeError = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_ERROR_LENGTH);
};

const clampDelayMinutes = (value: unknown, fallback = DEFAULT_DELAY_MINUTES): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_DELAY_MINUTES, Math.min(MAX_DELAY_MINUTES, Math.floor(parsed)));
};

const mapSummary = (row: AffiliateMlGroupDispatchRow): AffiliateMlGroupDispatchSummary => {
  const groupName =
    typeof row.group_name === "string" && row.group_name.trim()
      ? row.group_name.trim()
      : `Grupo ${Number(row.group_id)}`;
  const groupStatus =
    row.group_status === "active" || row.group_status === "disabled"
      ? row.group_status
      : null;

  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    groupName,
    groupStatus,
    groupRemoteId: normalizeRemoteId(row.group_remote_current ?? row.group_remote_id) ?? row.group_remote_id,
    instanceId: Number(row.group_instance_current ?? row.instance_id ?? 0),
    enabled: parseBoolean(row.enabled, true),
    delayMinutes: clampDelayMinutes(row.delay_minutes),
    categoryRotationEnabled: parseBoolean(row.category_rotation_enabled, true),
    lastError: sanitizeError(row.last_error),
    lastSentAt: toIso(row.last_sent_at),
    lastItemId: normalizeItemId(row.last_item_id),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
};

const ensureAffiliateMlGroupDispatchesTable = async () =>
  runEnsure("affiliate-ml-group-dispatches-table", async () => {
    await ensureUserTable();
    await ensureBotGroupTable();
    const db = getDb();

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'mercadolivre',
        group_id INT NOT NULL,
        group_remote_id VARCHAR(191) NOT NULL,
        instance_id INT NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        delay_minutes INT NOT NULL DEFAULT 15,
        category_rotation_enabled TINYINT(1) NOT NULL DEFAULT 1,
        last_error VARCHAR(500) NULL,
        last_sent_at DATETIME NULL,
        last_item_id VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_affiliate_ml_group_dispatch_user_group (user_id, provider, group_id),
        KEY idx_affiliate_ml_group_dispatch_enabled (provider, enabled, updated_at),
        KEY idx_affiliate_ml_group_dispatch_user (user_id, provider),
        CONSTRAINT fk_affiliate_ml_group_dispatch_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_affiliate_ml_group_dispatch_group FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [rows] = await db.query<RowDataPacket[]>(
        `SHOW COLUMNS FROM ${TABLE_NAME} LIKE ?`,
        [column],
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        await db.query(`ALTER TABLE ${TABLE_NAME} ADD COLUMN ${definition};`);
      }
    };

    await ensureColumn("group_remote_id", "group_remote_id VARCHAR(191) NOT NULL DEFAULT '' AFTER group_id");
    await ensureColumn("instance_id", "instance_id INT NOT NULL DEFAULT 0 AFTER group_remote_id");
    await ensureColumn("enabled", "enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER instance_id");
    await ensureColumn("delay_minutes", "delay_minutes INT NOT NULL DEFAULT 15 AFTER enabled");
    await ensureColumn(
      "category_rotation_enabled",
      "category_rotation_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER delay_minutes",
    );
    await ensureColumn("last_error", "last_error VARCHAR(500) NULL AFTER category_rotation_enabled");
    await ensureColumn("last_sent_at", "last_sent_at DATETIME NULL AFTER last_error");
    await ensureColumn("last_item_id", "last_item_id VARCHAR(64) NULL AFTER last_sent_at");
  });

const resolveGroupContext = async (
  userId: number,
  groupId: number,
  expectedInstanceId?: number,
) => {
  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new Error("Grupo não encontrado para ativar o disparo de afiliados.");
  }
  if (group.status !== "active") {
    throw new Error("Selecione apenas grupos ativos para cadastrar o disparo.");
  }
  if (!group.remoteId || !group.remoteId.trim()) {
    throw new Error("Grupo sem remoteId válido. Sincronize os grupos antes de ativar.");
  }
  if (!Number.isFinite(group.instanceId) || group.instanceId <= 0) {
    throw new Error("Grupo sem instância vinculada. Atualize a sincronização e tente novamente.");
  }
  if (
    expectedInstanceId !== undefined &&
    Number.isFinite(Number(expectedInstanceId)) &&
    Math.floor(Number(expectedInstanceId)) > 0 &&
    group.instanceId !== Math.floor(Number(expectedInstanceId))
  ) {
    throw new Error("O grupo selecionado não pertence à instância informada.");
  }
  const instance = await getInstanceForUser(userId, group.instanceId);
  if (!instance) {
    throw new Error("Instância vinculada ao grupo não encontrada.");
  }
  if (instance.sessionStatus !== "conectado") {
    throw new Error("Selecione uma instância conectada para cadastrar o disparo.");
  }
  const violation = await evaluatePlanGuard({ userId, instance, group });
  if (violation) {
    throw new Error("Selecione apenas grupos VIP ativos e cobertos pelo plano/add-on.");
  }
  return {
    groupId: group.id,
    groupRemoteId: group.remoteId.trim(),
    instanceId: group.instanceId,
  };
};

const getDispatchById = async (
  userId: number,
  dispatchId: number,
): Promise<AffiliateMlGroupDispatchSummary | null> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const db = getDb();
  const [rows] = await db.query<AffiliateMlGroupDispatchRow[]>(
    `
      SELECT
        d.*,
        g.name AS group_name,
        g.status AS group_status,
        g.remote_id AS group_remote_current,
        g.instance_id AS group_instance_current
      FROM ${TABLE_NAME} d
      LEFT JOIN bot_groups g
        ON g.id = d.group_id
       AND g.user_id = d.user_id
      WHERE d.user_id = ? AND d.provider = ? AND d.id = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY, dispatchId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapSummary(rows[0]);
};

const getDispatchByGroupId = async (
  userId: number,
  groupId: number,
): Promise<AffiliateMlGroupDispatchSummary | null> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const db = getDb();
  const [rows] = await db.query<AffiliateMlGroupDispatchRow[]>(
    `
      SELECT
        d.*,
        g.name AS group_name,
        g.status AS group_status,
        g.remote_id AS group_remote_current,
        g.instance_id AS group_instance_current
      FROM ${TABLE_NAME} d
      LEFT JOIN bot_groups g
        ON g.id = d.group_id
       AND g.user_id = d.user_id
      WHERE d.user_id = ? AND d.provider = ? AND d.group_id = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY, groupId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapSummary(rows[0]);
};

export const listAffiliateMlGroupDispatchesForUser = async (
  userId: number,
): Promise<AffiliateMlGroupDispatchSummary[]> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const db = getDb();
  const [rows] = await db.query<AffiliateMlGroupDispatchRow[]>(
    `
      SELECT
        d.*,
        g.name AS group_name,
        g.status AS group_status,
        g.remote_id AS group_remote_current,
        g.instance_id AS group_instance_current
      FROM ${TABLE_NAME} d
      LEFT JOIN bot_groups g
        ON g.id = d.group_id
       AND g.user_id = d.user_id
      WHERE d.user_id = ? AND d.provider = ?
      ORDER BY d.updated_at DESC, d.id DESC
    `,
    [userId, PROVIDER_KEY],
  );

  return (Array.isArray(rows) ? rows : []).map(mapSummary);
};

export const upsertAffiliateMlGroupDispatchForUser = async (
  userId: number,
  payload: {
    groupId?: number;
    instanceId?: number;
    enabled?: boolean;
    delayMinutes?: number;
    categoryRotationEnabled?: boolean;
  },
): Promise<AffiliateMlGroupDispatchSummary> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const groupId = Number(payload.groupId);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new Error("Selecione um grupo válido para ativar o envio.");
  }

  const groupContext = await resolveGroupContext(userId, Math.floor(groupId), payload.instanceId);
  const delayMinutes = clampDelayMinutes(payload.delayMinutes);
  const enabled = payload.enabled !== false;
  const categoryRotationEnabled = payload.categoryRotationEnabled !== false;

  const db = getDb();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_NAME} (
        user_id,
        provider,
        group_id,
        group_remote_id,
        instance_id,
        enabled,
        delay_minutes,
        category_rotation_enabled,
        last_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        group_remote_id = VALUES(group_remote_id),
        instance_id = VALUES(instance_id),
        enabled = VALUES(enabled),
        delay_minutes = VALUES(delay_minutes),
        category_rotation_enabled = VALUES(category_rotation_enabled),
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      PROVIDER_KEY,
      groupContext.groupId,
      groupContext.groupRemoteId,
      groupContext.instanceId,
      enabled ? 1 : 0,
      delayMinutes,
      categoryRotationEnabled ? 1 : 0,
    ],
  );

  const saved = await getDispatchByGroupId(userId, groupContext.groupId);
  if (!saved) {
    throw new Error("Ativação salva, mas não foi possível confirmar os dados.");
  }
  return saved;
};

export const updateAffiliateMlGroupDispatchForUser = async (
  userId: number,
  dispatchId: number,
  payload: {
    enabled?: boolean;
    delayMinutes?: number;
    categoryRotationEnabled?: boolean;
    groupId?: number;
    instanceId?: number;
  },
): Promise<AffiliateMlGroupDispatchSummary> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const normalizedDispatchId = Number(dispatchId);
  if (!Number.isFinite(normalizedDispatchId) || normalizedDispatchId <= 0) {
    throw new Error("Ativação inválida para atualizar.");
  }

  const current = await getDispatchById(userId, Math.floor(normalizedDispatchId));
  if (!current) {
    throw new Error("Ativação de envio não encontrada.");
  }

  const nextGroupId =
    payload.groupId !== undefined && Number.isFinite(Number(payload.groupId)) && Number(payload.groupId) > 0
      ? Math.floor(Number(payload.groupId))
      : current.groupId;
  const groupContext = await resolveGroupContext(userId, nextGroupId, payload.instanceId);
  const conflictingDispatch =
    nextGroupId !== current.groupId
      ? await getDispatchByGroupId(userId, nextGroupId)
      : null;
  if (conflictingDispatch && conflictingDispatch.id !== current.id) {
    throw new Error("Esse grupo já possui uma ativação cadastrada.");
  }

  const nextEnabled =
    typeof payload.enabled === "boolean"
      ? payload.enabled
      : current.enabled;
  const nextDelayMinutes =
    payload.delayMinutes === undefined
      ? current.delayMinutes
      : clampDelayMinutes(payload.delayMinutes, current.delayMinutes);
  const nextCategoryRotationEnabled =
    typeof payload.categoryRotationEnabled === "boolean"
      ? payload.categoryRotationEnabled
      : current.categoryRotationEnabled;

  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        group_id = ?,
        group_remote_id = ?,
        instance_id = ?,
        enabled = ?,
        delay_minutes = ?,
        category_rotation_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND provider = ?
    `,
    [
      groupContext.groupId,
      groupContext.groupRemoteId,
      groupContext.instanceId,
      nextEnabled ? 1 : 0,
      nextDelayMinutes,
      nextCategoryRotationEnabled ? 1 : 0,
      normalizedDispatchId,
      userId,
      PROVIDER_KEY,
    ],
  );

  const updated = await getDispatchById(userId, normalizedDispatchId);
  if (!updated) {
    throw new Error("Ativação atualizada, mas não foi possível carregar os dados.");
  }
  return updated;
};

export const deleteAffiliateMlGroupDispatchForUser = async (
  userId: number,
  dispatchId: number,
): Promise<void> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const normalizedDispatchId = Number(dispatchId);
  if (!Number.isFinite(normalizedDispatchId) || normalizedDispatchId <= 0) {
    throw new Error("Ativação inválida para remover.");
  }
  const db = getDb();
  await db.query(
    `
      DELETE FROM ${TABLE_NAME}
      WHERE id = ? AND user_id = ? AND provider = ?
    `,
    [normalizedDispatchId, userId, PROVIDER_KEY],
  );
};

export const listEnabledAffiliateMlGroupDispatchesForRun = async (
  limit = 25,
): Promise<AffiliateMlGroupDispatchWorkerEntry[]> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const cappedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  const db = getDb();
  const [rows] = await db.query<AffiliateMlGroupDispatchRow[]>(
    `
      SELECT
        d.*,
        g.name AS group_name,
        g.status AS group_status,
        g.remote_id AS group_remote_current,
        g.instance_id AS group_instance_current
      FROM ${TABLE_NAME} d
      INNER JOIN bot_groups g
        ON g.id = d.group_id
       AND g.user_id = d.user_id
      WHERE d.provider = ?
        AND d.enabled = 1
        AND g.status = 'active'
      ORDER BY COALESCE(d.last_sent_at, d.created_at) ASC, d.id ASC
      LIMIT ?
    `,
    [PROVIDER_KEY, cappedLimit],
  );

  const entries: AffiliateMlGroupDispatchWorkerEntry[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const groupRemoteId = normalizeRemoteId(row.group_remote_current ?? row.group_remote_id);
    const instanceId = Number(row.group_instance_current ?? row.instance_id ?? 0);
    if (!groupRemoteId || !Number.isFinite(instanceId) || instanceId <= 0) {
      continue;
    }

    const group = await getGroupByIdForUser(Number(row.user_id), Number(row.group_id));
    if (!group || group.status !== "active") {
      continue;
    }
    const instance = await getInstanceForUser(Number(row.user_id), instanceId);
    if (!instance || instance.sessionStatus !== "conectado") {
      continue;
    }
    const violation = await evaluatePlanGuard({
      userId: Number(row.user_id),
      instance,
      group,
    });
    if (violation) {
      continue;
    }

    entries.push({
      id: Number(row.id),
      userId: Number(row.user_id),
      groupId: Number(row.group_id),
      groupName:
        typeof row.group_name === "string" && row.group_name.trim()
          ? row.group_name.trim()
          : `Grupo ${Number(row.group_id)}`,
      groupRemoteId,
      instanceId,
      delayMinutes: clampDelayMinutes(row.delay_minutes),
      categoryRotationEnabled: parseBoolean(row.category_rotation_enabled, true),
    });
  }

  return entries;
};

export const markAffiliateMlGroupDispatchSuccess = async (params: {
  userId: number;
  dispatchId: number;
  groupRemoteId?: string | null;
  instanceId?: number | null;
  itemId?: string | null;
}): Promise<void> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const dispatchId = Number(params.dispatchId);
  if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
    return;
  }
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        group_remote_id = COALESCE(NULLIF(?, ''), group_remote_id),
        instance_id = COALESCE(?, instance_id),
        last_sent_at = NOW(),
        last_item_id = ?,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND provider = ?
    `,
    [
      normalizeRemoteId(params.groupRemoteId) ?? "",
      Number.isFinite(Number(params.instanceId)) && Number(params.instanceId) > 0
        ? Math.floor(Number(params.instanceId))
        : null,
      normalizeItemId(params.itemId),
      dispatchId,
      params.userId,
      PROVIDER_KEY,
    ],
  );
};

export const markAffiliateMlGroupDispatchError = async (params: {
  userId: number;
  dispatchId: number;
  error: unknown;
}): Promise<void> => {
  await ensureAffiliateMlGroupDispatchesTable();
  const dispatchId = Number(params.dispatchId);
  if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
    return;
  }
  const errorText =
    params.error instanceof Error
      ? sanitizeError(params.error.message)
      : sanitizeError(String(params.error || "Falha ao disparar afiliado para o grupo."));
  if (!errorText) {
    return;
  }
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND provider = ?
    `,
    [errorText, dispatchId, params.userId, PROVIDER_KEY],
  );
};
