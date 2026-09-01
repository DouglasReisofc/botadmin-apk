import { getDb, ensureSisregWatcherTable, type SisregWatcherRow } from "lib/db";

export type CreateSisregWatcherParams = {
  instanceId: number;
  contactDigits: string;
  code: string;
  unitHint: string;
  unitResolved: string;
  intervalMs: number;
  lastStatus: string | null;
  lastCheckedAt: Date;
};

export type SisregWatcherDueRow = SisregWatcherRow & {
  user_id: number;
  base_url: string;
  token: string;
  phone: string | null;
};

const nowUtc = (): Date => new Date();

const toIntervalSeconds = (intervalMs: number): number => {
  const seconds = Math.max(1, Math.round(intervalMs / 1000));
  return Number.isFinite(seconds) ? seconds : 900;
};

export const upsertSisregWatcher = async (params: CreateSisregWatcherParams): Promise<void> => {
  if (!params.contactDigits || !params.code) {
    throw new Error("Informações incompletas para cadastrar a verificação do SisReg.");
  }
  await ensureSisregWatcherTable();
  const db = getDb();
  const sanitizedCode = params.code.trim();
  const sanitizedDigits = params.contactDigits.trim();
  const sanitizedUnitHint = params.unitHint.trim();
  const sanitizedUnitResolved = params.unitResolved.trim() || sanitizedUnitHint;
  const intervalSeconds = toIntervalSeconds(params.intervalMs);
  const nextRun = new Date(params.lastCheckedAt.getTime() + intervalSeconds * 1000);

  await db.query(
    `
      INSERT INTO sisreg_watchers (
        instance_id,
        contact_digits,
        code,
        unit_hint,
        unit_resolved,
        interval_seconds,
        next_run_at,
      last_status,
      last_checked_at,
      daily_notified_at,
      failure_count,
      locked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)
      ON DUPLICATE KEY UPDATE
        unit_hint = VALUES(unit_hint),
        unit_resolved = VALUES(unit_resolved),
        interval_seconds = VALUES(interval_seconds),
        next_run_at = VALUES(next_run_at),
        last_status = VALUES(last_status),
        last_checked_at = VALUES(last_checked_at),
        daily_notified_at = VALUES(last_checked_at),
        failure_count = 0,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      params.instanceId,
      sanitizedDigits,
      sanitizedCode,
      sanitizedUnitHint || sanitizedUnitResolved,
      sanitizedUnitResolved,
      intervalSeconds,
      nextRun,
      params.lastStatus,
      params.lastCheckedAt,
      params.lastCheckedAt,
    ],
  );
};

export const countSisregWatchersForContact = async (instanceId: number, contactDigits: string): Promise<number> => {
  if (!contactDigits) {
    return 0;
  }
  await ensureSisregWatcherTable();
  const db = getDb();
  const [rows] = await db.query<Array<{ total: number }>>(
    `
      SELECT COUNT(*) AS total
      FROM sisreg_watchers
      WHERE instance_id = ? AND contact_digits = ?
    `,
    [instanceId, contactDigits.trim()],
  );
  const total = Array.isArray(rows) && rows[0] ? Number(rows[0].total ?? 0) : 0;
  return Number.isFinite(total) ? total : 0;
};

export const removeSisregWatcher = async (instanceId: number, contactDigits: string, code: string): Promise<boolean> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  const [result] = await db.query<{ affectedRows: number } & Record<string, unknown>>(
    `
      DELETE FROM sisreg_watchers
      WHERE instance_id = ? AND contact_digits = ? AND code = ?
    `,
    [instanceId, contactDigits.trim(), code.trim()],
  );
  return Number(result?.affectedRows ?? 0) > 0;
};

export const removeSisregWatcherById = async (id: number): Promise<void> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  await db.query(`DELETE FROM sisreg_watchers WHERE id = ?`, [id]);
};

export const listSisregWatchersForContact = async (
  instanceId: number,
  contactDigits: string,
): Promise<SisregWatcherRow[]> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  const [rows] = await db.query<SisregWatcherRow[]>(
    `
      SELECT *
      FROM sisreg_watchers
      WHERE instance_id = ? AND contact_digits = ?
      ORDER BY next_run_at ASC
    `,
    [instanceId, contactDigits.trim()],
  );
  return Array.isArray(rows) ? rows : [];
};

export const findSisregWatcher = async (
  instanceId: number,
  contactDigits: string,
  code: string,
): Promise<SisregWatcherRow | null> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  const [rows] = await db.query<SisregWatcherRow[]>(
    `
      SELECT *
      FROM sisreg_watchers
      WHERE instance_id = ? AND contact_digits = ? AND code = ?
      LIMIT 1
    `,
    [instanceId, contactDigits.trim(), code.trim()],
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

export const listDueSisregWatchers = async (limit: number): Promise<SisregWatcherDueRow[]> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  const now = nowUtc();
  const staleThreshold = new Date(now.getTime() - 5 * 60_000);
  const [rows] = await db.query<SisregWatcherDueRow[]>(
    `
      SELECT
        w.*,
        i.user_id,
        i.base_url,
        i.token,
        i.phone
      FROM sisreg_watchers w
      INNER JOIN bot_instances i ON i.id = w.instance_id
      WHERE w.next_run_at <= ?
        AND i.session_status = 'conectado'
        AND (w.locked_at IS NULL OR w.locked_at <= ?)
      ORDER BY w.next_run_at ASC
      LIMIT ?
    `,
    [now, staleThreshold, Math.max(1, limit)],
  );
  return Array.isArray(rows) ? rows : [];
};

export const tryLockSisregWatcher = async (id: number): Promise<boolean> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  const now = nowUtc();
  const staleThreshold = new Date(now.getTime() - 5 * 60_000);
  const [result] = await db.query<{ affectedRows: number } & Record<string, unknown>>(
    `
      UPDATE sisreg_watchers
      SET locked_at = ?
      WHERE id = ? AND (locked_at IS NULL OR locked_at <= ?)
    `,
    [now, id, staleThreshold],
  );
  return Number(result?.affectedRows ?? 0) > 0;
};

export const markSisregWatcherFailure = async (id: number, intervalMs: number): Promise<void> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  const now = nowUtc();
  const fallbackInterval = Math.max(5 * 60_000, Math.min(intervalMs, 60 * 60_000));
  const nextRun = new Date(now.getTime() + fallbackInterval);
  await db.query(
    `
      UPDATE sisreg_watchers
      SET
        failure_count = failure_count + 1,
        next_run_at = ?,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [nextRun, id],
  );
};

export const markSisregWatcherSuccess = async (
  id: number,
  intervalMs: number,
  status: string | null,
  checkedAt: Date,
): Promise<void> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  const nextRun = new Date(checkedAt.getTime() + intervalMs);
  await db.query(
    `
      UPDATE sisreg_watchers
      SET
        last_status = ?,
        last_checked_at = ?,
        next_run_at = ?,
        failure_count = 0,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [status, checkedAt, nextRun, id],
  );
};

export const markSisregDailyNotification = async (id: number, timestamp: Date | null): Promise<void> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  await db.query(
    `
      UPDATE sisreg_watchers
      SET daily_notified_at = ?
      WHERE id = ?
    `,
    [timestamp, id],
  );
};

export const listSisregWatchersPendingDigest = async (
  limit: number,
  threshold: Date,
): Promise<SisregWatcherDueRow[]> => {
  await ensureSisregWatcherTable();
  const db = getDb();
  const [rows] = await db.query<SisregWatcherDueRow[]>(
    `
      SELECT
        w.*,
        i.user_id,
        i.base_url,
        i.token,
        i.phone
      FROM sisreg_watchers w
      INNER JOIN bot_instances i ON i.id = w.instance_id
      WHERE i.session_status = 'conectado'
        AND w.contact_digits IS NOT NULL
        AND w.contact_digits <> ''
        AND (w.daily_notified_at IS NULL OR w.daily_notified_at < ?)
      ORDER BY w.id ASC
      LIMIT ?
    `,
    [threshold, Math.max(1, limit)],
  );
  return Array.isArray(rows) ? rows : [];
};
