import { RowDataPacket } from "mysql2";

import { getDb } from "./db";

export type AdminMessageContextRow = {
  message_id: string;
  context_type: string;
  plan_id: number | null;
  created_at: Date;
};

export const ensureAdminMessageContextTable = async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_message_context (
      message_id VARCHAR(64) PRIMARY KEY,
      context_type VARCHAR(64) NOT NULL,
      plan_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_message_context_created_at ON admin_message_context (created_at)`).catch(() => {});
};

export const savePlanPickerMessageContext = async (messageId: string, planId: number) => {
  if (!messageId || !Number.isFinite(planId)) return;
  await ensureAdminMessageContextTable();
  const db = getDb();
  await db.query(
    `INSERT INTO admin_message_context (message_id, context_type, plan_id)
     VALUES (?, 'plan_payment_picker', ?)
     ON DUPLICATE KEY UPDATE context_type = VALUES(context_type), plan_id = VALUES(plan_id), created_at = CURRENT_TIMESTAMP`,
    [messageId, planId],
  );
};

export const findPlanIdByReplyMessageId = async (messageId: string): Promise<number | null> => {
  if (!messageId) return null;
  await ensureAdminMessageContextTable();
  const db = getDb();
  const [rows] = await db.query<(AdminMessageContextRow & RowDataPacket)[]>(
    `SELECT plan_id FROM admin_message_context WHERE message_id = ? AND context_type = 'plan_payment_picker' LIMIT 1`,
    [messageId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const planId = rows[0].plan_id;
  return Number.isFinite(planId as any) ? (planId as any as number) : null;
};

export const cleanupAdminMessageContext = async (maxAgeMinutes = 120) => {
  await ensureAdminMessageContextTable();
  const db = getDb();
  const minutes = Math.max(1, Math.floor(maxAgeMinutes));
  await db.query(`DELETE FROM admin_message_context WHERE created_at < (NOW() - INTERVAL ${minutes} MINUTE)`);
};

