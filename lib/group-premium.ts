import type { RowDataPacket } from "mysql2";

import { ensureBotGroupPremiumMembersTable, getDb } from "lib/db";

const normalizeMemberJid = (value: string): string => value.replace(/\D+/g, "");

export const getPremiumSubscriptionState = async (options: {
  groupId: number;
  memberJid: string;
  now?: Date;
}) => {
  const id = Number(options.groupId);
  const normalized = normalizeMemberJid(options.memberJid);
  if (!Number.isFinite(id) || id <= 0 || !normalized) return null;

  await ensureBotGroupPremiumMembersTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT expires_at
      FROM bot_group_premium_members
      WHERE group_id = ? AND member_jid = ?
      LIMIT 1
    `,
    [id, normalized],
  );
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  const expiresAt = row?.expires_at ? new Date(row.expires_at) : null;
  const now = options.now ?? new Date();
  return {
    memberJid: normalized,
    expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
    active: Boolean(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt > now),
  };
};

export const grantPremiumSubscription = async (options: {
  groupId: number;
  memberJid: string;
  durationDays: number;
  now?: Date;
}) => {
  const id = Number(options.groupId);
  const normalized = normalizeMemberJid(options.memberJid);
  const durationDays = Math.max(1, Math.floor(Number(options.durationDays ?? 0)));
  if (!Number.isFinite(id) || id <= 0 || !normalized || durationDays <= 0) return null;

  await ensureBotGroupPremiumMembersTable();
  const db = getDb();
  const connection = await db.getConnection();
  const now = options.now ?? new Date();

  try {
    await connection.beginTransaction();
    await connection.query(
      `
        INSERT IGNORE INTO bot_group_premium_members (group_id, member_jid, expires_at)
        VALUES (?, ?, ?)
      `,
      [id, normalized, now],
    );
    const [rows] = await connection.query<RowDataPacket[]>(
      `
        SELECT expires_at
        FROM bot_group_premium_members
        WHERE group_id = ? AND member_jid = ?
        LIMIT 1
        FOR UPDATE
      `,
      [id, normalized],
    );
    const current = Array.isArray(rows) && rows[0]?.expires_at
      ? new Date(rows[0].expires_at)
      : null;
    const base = current && Number.isFinite(current.getTime()) && current > now ? current : now;
    const expiresAt = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
    await connection.query(
      `
        UPDATE bot_group_premium_members
        SET expires_at = ?
        WHERE group_id = ? AND member_jid = ?
      `,
      [expiresAt, id, normalized],
    );
    await connection.commit();
    return {
      memberJid: normalized,
      expiresAt,
      active: true,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
