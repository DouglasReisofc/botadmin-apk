import { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureUserTable, getDb } from "lib/db";
import { deleteCachedMediaFromR2 } from "lib/r2-media-cache";

const DEFAULT_STORAGE_QUOTA_BYTES = Number.isFinite(Number(process.env.DEFAULT_R2_STORAGE_BYTES))
  ? Math.max(0, Math.floor(Number(process.env.DEFAULT_R2_STORAGE_BYTES)))
  : 0;
const ADMIN_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024 * 1024;

type StorageQuotaRow = RowDataPacket & {
  quota_bytes: string | number | null;
};

type StorageUsageRow = RowDataPacket & {
  used_bytes: string | number | null;
  object_count: string | number | null;
};

type StorageObjectRow = RowDataPacket & {
  object_key: string | null;
};

type StorageEntitlementRow = RowDataPacket & {
  quota_bytes: string | number | null;
  expires_at: Date | string | null;
};

type StoragePlanRow = RowDataPacket & {
  id: number;
  name: string;
  description: string | null;
  quota_gb: string | number;
  price: string | number;
  duration_days: number;
  is_active: number;
};

let ensureTask: Promise<void> | null = null;

export type UserMediaStorageSummary = {
  userId: number;
  quotaBytes: number;
  usedBytes: number;
  remainingBytes: number;
  objectCount: number;
  hasActivePlan: boolean;
  expiresAt: string | null;
};

export type UserMediaStoragePlan = {
  id: number;
  name: string;
  description: string | null;
  quotaGb: number;
  quotaBytes: number;
  price: number;
  durationDays: number;
  isActive: boolean;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const gbToBytes = (value: number) =>
  Math.max(0, Math.floor(Number(value || 0) * 1024 * 1024 * 1024));

const toIsoOrNull = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const mapStoragePlanRow = (row: StoragePlanRow): UserMediaStoragePlan => {
  const quotaGb = Number(row.quota_gb ?? 0) || 0;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    quotaGb,
    quotaBytes: gbToBytes(quotaGb),
    price: roundMoney(Number(row.price ?? 0) || 0),
    durationDays: Math.max(1, Math.floor(Number(row.duration_days ?? 30) || 30)),
    isActive: Number(row.is_active ?? 0) === 1,
  };
};

export const ensureUserMediaStorageTables = async () => {
  if (ensureTask) return ensureTask;
  ensureTask = (async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_media_storage_quotas (
        user_id INT NOT NULL PRIMARY KEY,
        quota_bytes BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_user_media_storage_quotas_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_media_storage_objects (
        user_id INT NOT NULL,
        object_key VARCHAR(512) NOT NULL,
        instance_id INT NULL,
        chat_jid VARCHAR(191) NULL,
        message_key VARCHAR(191) NULL,
        bytes BIGINT NOT NULL DEFAULT 0,
        content_type VARCHAR(191) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, object_key),
        INDEX idx_user_media_storage_objects_user_updated (user_id, updated_at),
        INDEX idx_user_media_storage_objects_instance_chat (user_id, instance_id, chat_jid),
        CONSTRAINT fk_user_media_storage_objects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_media_storage_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        description TEXT NULL,
        quota_gb DECIMAL(10, 2) NOT NULL DEFAULT 0,
        price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        duration_days INT NOT NULL DEFAULT 30,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_media_storage_entitlements (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        plan_id INT NULL,
        payment_provider VARCHAR(80) NULL,
        payment_reference VARCHAR(191) NULL,
        quota_bytes BIGINT NOT NULL DEFAULT 0,
        starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        metadata JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_media_storage_payment (payment_provider, payment_reference),
        INDEX idx_user_media_storage_entitlements_user_expiry (user_id, expires_at),
        CONSTRAINT fk_user_media_storage_entitlements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_user_media_storage_entitlements_plan FOREIGN KEY (plan_id) REFERENCES user_media_storage_plans(id) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);
    const [planCountRows] = await db.query<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM user_media_storage_plans",
    );
    if (Number(planCountRows[0]?.total ?? 0) === 0) {
      await db.query(
        `
          INSERT INTO user_media_storage_plans
            (name, description, quota_gb, price, duration_days, is_active)
          VALUES
            ('R2 10 GB', 'Historico e midias persistentes por 30 dias.', 10, 15.00, 30, 1),
            ('R2 50 GB', 'Mais espaco para grupos ativos e midias frequentes.', 50, 49.90, 30, 1),
            ('R2 100 GB', 'Plano para operacao pesada com muitas midias.', 100, 89.90, 30, 1)
        `,
      );
    }
  })().catch((error) => {
    ensureTask = null;
    throw error;
  });
  return ensureTask;
};

export const listUserMediaStoragePlans = async (): Promise<UserMediaStoragePlan[]> => {
  await ensureUserMediaStorageTables();
  const db = getDb();
  const [rows] = await db.query<StoragePlanRow[]>(
    `
      SELECT *
      FROM user_media_storage_plans
      WHERE is_active = 1
      ORDER BY quota_gb ASC, price ASC, id ASC
    `,
  );
  return Array.isArray(rows) ? rows.map(mapStoragePlanRow) : [];
};

export const getUserMediaStoragePlanById = async (
  planId: number,
): Promise<UserMediaStoragePlan | null> => {
  if (!Number.isFinite(planId) || planId <= 0) return null;
  await ensureUserMediaStorageTables();
  const db = getDb();
  const [rows] = await db.query<StoragePlanRow[]>(
    "SELECT * FROM user_media_storage_plans WHERE id = ? LIMIT 1",
    [planId],
  );
  return Array.isArray(rows) && rows[0] ? mapStoragePlanRow(rows[0]) : null;
};

export const grantUserMediaStorageEntitlement = async (params: {
  userId: number;
  planId: number;
  paymentProvider?: string | null;
  paymentReference?: string | null;
  metadata?: Record<string, unknown> | null;
}) => {
  if (!Number.isFinite(params.userId) || params.userId <= 0) {
    throw new Error("Usuário inválido para armazenamento.");
  }
  const plan = await getUserMediaStoragePlanById(params.planId);
  if (!plan || !plan.isActive || plan.quotaBytes <= 0 || plan.price <= 0) {
    throw new Error("Plano de armazenamento indisponível.");
  }

  await ensureUserMediaStorageTables();
  const db = getDb();
  const provider = params.paymentProvider?.trim() || null;
  const reference = params.paymentReference?.trim() || null;

  if (provider && reference) {
    const [existing] = await db.query<RowDataPacket[]>(
      `
        SELECT id
        FROM user_media_storage_entitlements
        WHERE payment_provider = ? AND payment_reference = ?
        LIMIT 1
      `,
      [provider, reference],
    );
    if (Array.isArray(existing) && existing.length > 0) {
      return getUserMediaStorageSummary(params.userId);
    }
  }

  const [activeRows] = await db.query<(RowDataPacket & { max_expires_at: Date | string | null })[]>(
    `
      SELECT MAX(expires_at) AS max_expires_at
      FROM user_media_storage_entitlements
      WHERE user_id = ?
        AND expires_at > NOW()
    `,
    [params.userId],
  );
  const now = new Date();
  const activeBase = activeRows[0]?.max_expires_at ? new Date(activeRows[0].max_expires_at) : null;
  const startsAt = activeBase && activeBase.getTime() > now.getTime() ? activeBase : now;
  const expiresAt = new Date(startsAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
  const metadata = {
    ...(params.metadata ?? {}),
    planName: plan.name,
    quotaGb: plan.quotaGb,
    quotaBytes: plan.quotaBytes,
    durationDays: plan.durationDays,
  };

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_media_storage_entitlements
        (user_id, plan_id, payment_provider, payment_reference, quota_bytes, starts_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      params.userId,
      plan.id,
      provider,
      reference,
      plan.quotaBytes,
      startsAt,
      expiresAt,
      JSON.stringify(metadata),
    ],
  );

  return getUserMediaStorageSummary(params.userId);
};

export const recordUserMediaStorageObject = async (params: {
  userId: number;
  objectKey: string;
  bytes: number;
  contentType?: string | null;
  instanceId?: number | null;
  chatJid?: string | null;
  messageKey?: string | null;
}) => {
  if (!Number.isFinite(params.userId) || params.userId <= 0 || !params.objectKey.trim()) return;
  await ensureUserMediaStorageTables();
  const bytes = Math.max(0, Math.floor(params.bytes));
  const db = getDb();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_media_storage_objects
        (user_id, object_key, instance_id, chat_jid, message_key, bytes, content_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        instance_id = VALUES(instance_id),
        chat_jid = VALUES(chat_jid),
        message_key = VALUES(message_key),
        bytes = VALUES(bytes),
        content_type = VALUES(content_type),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      params.userId,
      params.objectKey,
      params.instanceId ?? null,
      params.chatJid ?? null,
      params.messageKey ?? null,
      bytes,
      params.contentType ?? null,
    ],
  );
};

export const getUserMediaStorageSummary = async (userId: number): Promise<UserMediaStorageSummary> => {
  await ensureUserMediaStorageTables();
  const db = getDb();
  const [quotaRows] = await db.query<StorageQuotaRow[]>(
    "SELECT quota_bytes FROM user_media_storage_quotas WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const [entitlementRows] = await db.query<StorageEntitlementRow[]>(
    `
      SELECT
        COALESCE(MAX(quota_bytes), 0) AS quota_bytes,
        MAX(expires_at) AS expires_at
      FROM user_media_storage_entitlements
      WHERE user_id = ?
        AND expires_at > NOW()
    `,
    [userId],
  );
  const [usageRows] = await db.query<StorageUsageRow[]>(
    `
      SELECT COALESCE(SUM(bytes), 0) AS used_bytes, COUNT(*) AS object_count
      FROM user_media_storage_objects
      WHERE user_id = ?
    `,
    [userId],
  );
  const manualQuotaBytes = Number(quotaRows[0]?.quota_bytes ?? 0) || 0;
  const entitlementQuotaBytes = Number(entitlementRows[0]?.quota_bytes ?? 0) || 0;
  const expiresAt = toIsoOrNull(entitlementRows[0]?.expires_at ?? null);
  const quotaBytes = Math.max(DEFAULT_STORAGE_QUOTA_BYTES, manualQuotaBytes, entitlementQuotaBytes);
  const usedBytes = Number(usageRows[0]?.used_bytes ?? 0) || 0;
  const objectCount = Number(usageRows[0]?.object_count ?? 0) || 0;
  return {
    userId,
    quotaBytes,
    usedBytes,
    remainingBytes: Math.max(0, quotaBytes - usedBytes),
    objectCount,
    hasActivePlan: entitlementQuotaBytes > 0 || manualQuotaBytes > 0 || DEFAULT_STORAGE_QUOTA_BYTES > 0,
    expiresAt,
  };
};

export const getAdminMediaStorageSummary = async (userId: number): Promise<UserMediaStorageSummary> => {
  const summary = await getUserMediaStorageSummary(userId);
  const quotaBytes = Math.max(summary.quotaBytes, ADMIN_STORAGE_QUOTA_BYTES);
  return {
    ...summary,
    quotaBytes,
    remainingBytes: Math.max(0, quotaBytes - summary.usedBytes),
    hasActivePlan: true,
    expiresAt: null,
  };
};

export const resetUserMediaStorageObjects = async () => {
  await ensureUserMediaStorageTables();
  const db = getDb();
  await db.query("DELETE FROM user_media_storage_objects");
};

export const deleteUserMediaStorageObjectsForInstance = async (
  userId: number,
  instanceId: number,
): Promise<{ metadataDeleted: number; r2Deleted: number; r2Errors: number }> => {
  if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(instanceId) || instanceId <= 0) {
    return { metadataDeleted: 0, r2Deleted: 0, r2Errors: 0 };
  }

  await ensureUserMediaStorageTables();
  const db = getDb();
  const [rows] = await db.query<StorageObjectRow[]>(
    `
      SELECT object_key
      FROM user_media_storage_objects
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );

  let r2Deleted = 0;
  let r2Errors = 0;
  const keys = Array.isArray(rows)
    ? rows.map((row) => row.object_key?.trim()).filter((key): key is string => Boolean(key))
    : [];

  for (const key of keys) {
    try {
      await deleteCachedMediaFromR2(key);
      r2Deleted += 1;
    } catch (error) {
      r2Errors += 1;
      console.warn("[user-media-storage] failed to delete R2 object", { userId, instanceId, key, error });
    }
  }

  const [result] = await db.query<ResultSetHeader>(
    `
      DELETE FROM user_media_storage_objects
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );

  return {
    metadataDeleted: Number(result.affectedRows ?? 0),
    r2Deleted,
    r2Errors,
  };
};
