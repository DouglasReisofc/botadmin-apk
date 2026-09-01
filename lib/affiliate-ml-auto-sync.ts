import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureUserTable, getDb } from "lib/db";

const TABLE_NAME = "affiliate_ml_auto_sync_configs";
const PROVIDER_KEY = "mercadolivre";
const DEFAULT_INTERVAL_MINUTES = 45;
const MIN_INTERVAL_MINUTES = 10;
const MAX_INTERVAL_MINUTES = 720;
const DEFAULT_TARGET_IMPORT_LIMIT = 50;
const MIN_TARGET_IMPORT_LIMIT = 10;
const MAX_TARGET_IMPORT_LIMIT = 2000;
const MAX_ERROR_LENGTH = 500;
const MAX_DISCOVERY_TERMS = 30;
const MAX_DISCOVERY_TERM_LENGTH = 120;
const MAX_DISCOVERY_CATEGORIES = 24;

type AutoSyncRow = RowDataPacket & {
  id: number;
  user_id: number;
  provider: string;
  enabled: number | boolean;
  refresh_existing: number | boolean;
  discover_new: number | boolean;
  target_import_limit: number | null;
  interval_minutes: number | null;
  discovery_terms: string | null;
  discovery_categories: string | null;
  last_run_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type AffiliateMlAutoSyncSummary = {
  provider: "mercadolivre";
  enabled: boolean;
  refreshExisting: boolean;
  discoverNew: boolean;
  targetImportLimit: number;
  intervalMinutes: number;
  discoveryTerms: string[];
  discoveryCategories: string[];
  lastRunAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type AffiliateMlAutoSyncWorkerEntry = {
  userId: number;
  enabled: boolean;
  refreshExisting: boolean;
  discoverNew: boolean;
  targetImportLimit: number;
  intervalMinutes: number;
  discoveryTerms: string[];
  discoveryCategories: string[];
  lastRunAt: string | null;
};

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

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return fallback;
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const sanitizeError = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_ERROR_LENGTH);
};

const parseList = (
  value: unknown,
  options: { maxItems: number; maxItemLength: number; numericOnly?: boolean } = {
    maxItems: MAX_DISCOVERY_TERMS,
    maxItemLength: MAX_DISCOVERY_TERM_LENGTH,
  },
): string[] => {
  const normalizedRaw =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.map((entry) => String(entry ?? "")).join(",")
        : "";
  if (!normalizedRaw.trim()) return [];
  const unique = new Set<string>();
  for (const chunk of normalizedRaw.split(/[,\n;\r\t|]+/g)) {
    if (unique.size >= options.maxItems) break;
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const normalized = options.numericOnly
      ? trimmed.replace(/[^\d]/g, "")
      : trimmed.replace(/\s+/g, " ");
    if (!normalized) continue;
    const sliced = normalized.slice(0, options.maxItemLength);
    if (!sliced) continue;
    unique.add(sliced);
  }
  return Array.from(unique);
};

const serializeList = (items: string[]): string | null => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const normalized = items
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (normalized.length === 0) return null;
  return normalized.join(",");
};

const mapSummary = (row: AutoSyncRow | null): AffiliateMlAutoSyncSummary => ({
  provider: "mercadolivre",
  enabled: parseBoolean(row?.enabled, false),
  refreshExisting: parseBoolean(row?.refresh_existing, true),
  discoverNew: parseBoolean(row?.discover_new, false),
  targetImportLimit: clampInt(
    row?.target_import_limit,
    MIN_TARGET_IMPORT_LIMIT,
    MAX_TARGET_IMPORT_LIMIT,
    DEFAULT_TARGET_IMPORT_LIMIT,
  ),
  intervalMinutes: clampInt(
    row?.interval_minutes,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES,
  ),
  discoveryTerms: parseList(row?.discovery_terms, {
    maxItems: MAX_DISCOVERY_TERMS,
    maxItemLength: MAX_DISCOVERY_TERM_LENGTH,
  }),
  discoveryCategories: parseList(row?.discovery_categories, {
    maxItems: MAX_DISCOVERY_CATEGORIES,
    maxItemLength: 40,
  }),
  lastRunAt: toIso(row?.last_run_at),
  lastError: sanitizeError(row?.last_error),
  updatedAt: toIso(row?.updated_at),
});

const ensureAutoSyncTable = async () =>
  runEnsure("affiliate-ml-auto-sync-table", async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'mercadolivre',
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        refresh_existing TINYINT(1) NOT NULL DEFAULT 1,
        discover_new TINYINT(1) NOT NULL DEFAULT 0,
        target_import_limit INT NOT NULL DEFAULT 50,
        interval_minutes INT NOT NULL DEFAULT 45,
        discovery_terms TEXT NULL,
        discovery_categories TEXT NULL,
        last_run_at DATETIME NULL,
        last_error VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_affiliate_ml_auto_sync_user_provider (user_id, provider),
        KEY idx_affiliate_ml_auto_sync_enabled (provider, enabled, updated_at),
        CONSTRAINT fk_affiliate_ml_auto_sync_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

    await ensureColumn("refresh_existing", "refresh_existing TINYINT(1) NOT NULL DEFAULT 1 AFTER enabled");
    await ensureColumn("discover_new", "discover_new TINYINT(1) NOT NULL DEFAULT 0 AFTER refresh_existing");
    await ensureColumn("target_import_limit", "target_import_limit INT NOT NULL DEFAULT 50 AFTER discover_new");
    await ensureColumn("interval_minutes", "interval_minutes INT NOT NULL DEFAULT 45 AFTER target_import_limit");
    await ensureColumn("discovery_terms", "discovery_terms TEXT NULL AFTER interval_minutes");
    await ensureColumn("discovery_categories", "discovery_categories TEXT NULL AFTER discovery_terms");
    await ensureColumn("last_run_at", "last_run_at DATETIME NULL AFTER interval_minutes");
    await ensureColumn("last_error", "last_error VARCHAR(500) NULL AFTER last_run_at");
  });

const getRowByUserId = async (userId: number): Promise<AutoSyncRow | null> => {
  await ensureAutoSyncTable();
  const db = getDb();
  const [rows] = await db.query<AutoSyncRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
};

export const getAffiliateMlAutoSyncConfigForUser = async (
  userId: number,
): Promise<AffiliateMlAutoSyncSummary> => {
  const row = await getRowByUserId(userId);
  return mapSummary(row);
};

export const upsertAffiliateMlAutoSyncConfigForUser = async (
  userId: number,
  payload: {
    enabled?: unknown;
    refreshExisting?: unknown;
    discoverNew?: unknown;
    targetImportLimit?: unknown;
    intervalMinutes?: unknown;
    discoveryTerms?: unknown;
    discoveryCategories?: unknown;
  },
): Promise<AffiliateMlAutoSyncSummary> => {
  await ensureAutoSyncTable();
  const current = await getAffiliateMlAutoSyncConfigForUser(userId);
  const nextEnabled =
    payload.enabled === undefined ? current.enabled : parseBoolean(payload.enabled, current.enabled);
  let nextRefreshExisting =
    payload.refreshExisting === undefined
      ? current.refreshExisting
      : parseBoolean(payload.refreshExisting, current.refreshExisting);
  const nextDiscoverNew =
    payload.discoverNew === undefined ? current.discoverNew : parseBoolean(payload.discoverNew, current.discoverNew);
  const nextTargetImportLimit =
    payload.targetImportLimit === undefined
      ? current.targetImportLimit
      : clampInt(
          payload.targetImportLimit,
          MIN_TARGET_IMPORT_LIMIT,
          MAX_TARGET_IMPORT_LIMIT,
          current.targetImportLimit,
        );
  const nextIntervalMinutes =
    payload.intervalMinutes === undefined
      ? current.intervalMinutes
      : clampInt(
          payload.intervalMinutes,
          MIN_INTERVAL_MINUTES,
          MAX_INTERVAL_MINUTES,
          current.intervalMinutes,
        );
  const nextDiscoveryTerms =
    payload.discoveryTerms === undefined
      ? current.discoveryTerms
      : parseList(payload.discoveryTerms, {
          maxItems: MAX_DISCOVERY_TERMS,
          maxItemLength: MAX_DISCOVERY_TERM_LENGTH,
        });
  const nextDiscoveryCategories =
    payload.discoveryCategories === undefined
      ? current.discoveryCategories
      : parseList(payload.discoveryCategories, {
          maxItems: MAX_DISCOVERY_CATEGORIES,
          maxItemLength: 40,
        });
  const nextDiscoveryTermsRaw = serializeList(nextDiscoveryTerms);
  const nextDiscoveryCategoriesRaw = serializeList(nextDiscoveryCategories);

  // Evita configuração ativa sem nenhuma ação habilitada.
  if (nextEnabled && !nextRefreshExisting && !nextDiscoverNew) {
    nextRefreshExisting = true;
  }

  const db = getDb();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_NAME} (
        user_id,
        provider,
        enabled,
        refresh_existing,
        discover_new,
        target_import_limit,
        interval_minutes,
        discovery_terms,
        discovery_categories
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        refresh_existing = VALUES(refresh_existing),
        discover_new = VALUES(discover_new),
        target_import_limit = VALUES(target_import_limit),
        interval_minutes = VALUES(interval_minutes),
        discovery_terms = VALUES(discovery_terms),
        discovery_categories = VALUES(discovery_categories),
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      PROVIDER_KEY,
      nextEnabled ? 1 : 0,
      nextRefreshExisting ? 1 : 0,
      nextDiscoverNew ? 1 : 0,
      nextTargetImportLimit,
      nextIntervalMinutes,
      nextDiscoveryTermsRaw,
      nextDiscoveryCategoriesRaw,
    ],
  );

  return await getAffiliateMlAutoSyncConfigForUser(userId);
};

export const listAffiliateMlAutoSyncConfigsForRun = async (
  limit = 20,
): Promise<AffiliateMlAutoSyncWorkerEntry[]> => {
  await ensureAutoSyncTable();
  const db = getDb();
  const cappedLimit = clampInt(limit, 1, 100, 20);
  const [rows] = await db.query<AutoSyncRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE provider = ?
        AND enabled = 1
        AND (
          last_run_at IS NULL
          OR TIMESTAMPDIFF(MINUTE, last_run_at, NOW()) >= GREATEST(?, interval_minutes)
        )
      ORDER BY COALESCE(last_run_at, created_at) ASC, id ASC
      LIMIT ?
    `,
    [PROVIDER_KEY, MIN_INTERVAL_MINUTES, cappedLimit],
  );

  const entries: AffiliateMlAutoSyncWorkerEntry[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const mapped = mapSummary(row);
    entries.push({
      userId: Number(row.user_id),
      enabled: mapped.enabled,
      refreshExisting: mapped.refreshExisting,
      discoverNew: mapped.discoverNew,
      targetImportLimit: mapped.targetImportLimit,
      intervalMinutes: mapped.intervalMinutes,
      discoveryTerms: mapped.discoveryTerms,
      discoveryCategories: mapped.discoveryCategories,
      lastRunAt: mapped.lastRunAt,
    });
  }
  return entries;
};

export const markAffiliateMlAutoSyncSuccess = async (params: {
  userId: number;
}): Promise<void> => {
  await ensureAutoSyncTable();
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        last_run_at = NOW(),
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ?
    `,
    [params.userId, PROVIDER_KEY],
  );
};

export const markAffiliateMlAutoSyncError = async (params: {
  userId: number;
  error: unknown;
}): Promise<void> => {
  await ensureAutoSyncTable();
  const message =
    params.error instanceof Error
      ? params.error.message
      : String(params.error || "Falha ao executar varredura automática de afiliados.");
  const sanitizedError = sanitizeError(message);
  if (!sanitizedError) return;

  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        last_run_at = NOW(),
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ?
    `,
    [sanitizedError, params.userId, PROVIDER_KEY],
  );
};
