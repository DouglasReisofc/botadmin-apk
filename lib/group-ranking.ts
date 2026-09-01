import type { RowDataPacket } from "mysql2";

import { ensureBotGroupRankingPeriodTable, ensureBotGroupRankingTable, getDb } from "lib/db";
import { formatMonthKey, formatWeekKey } from "lib/timezones";

const normalizeMemberJid = (value: string): string => value.replace(/\D+/g, "");

export type GroupRankingEntry = {
  memberJid: string;
  score: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  rank: number;
};

export type MemberRankingInfo = {
  memberJid: string;
  score: number;
  rank: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
};

export type GroupRankingPeriod = "weekly" | "monthly";

export type GroupRankingSnapshot = {
  score: number;
};

export type GroupRankingHistorySyncResult = {
  members: number;
  messages: number;
};

const runtime = globalThis as typeof globalThis & {
  __groupRankingHistorySyncAt?: Map<number, number>;
};

const historySyncAt = runtime.__groupRankingHistorySyncAt ?? new Map<number, number>();
runtime.__groupRankingHistorySyncAt = historySyncAt;
const HISTORY_SYNC_TTL_MS = 60 * 1000;

type HistoryAggregate = {
  score: number;
  firstMessageAt: Date;
  lastMessageAt: Date;
};

const toValidDate = (value: unknown): Date | null => {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const runInBatches = async <T>(
  entries: T[],
  worker: (entry: T) => Promise<void>,
  batchSize = 20,
) => {
  for (let index = 0; index < entries.length; index += batchSize) {
    await Promise.all(entries.slice(index, index + batchSize).map(worker));
  }
};

/**
 * Reconciles the ranking with messages already stored by the conversation
 * recorder. This repairs older groups where admin-only mode prevented normal
 * members from being counted, without reducing valid legacy counters.
 */
export const syncGroupRankingFromMessageHistory = async (
  groupId: number,
  options?: { force?: boolean; timezone?: string | null },
): Promise<GroupRankingHistorySyncResult> => {
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return { members: 0, messages: 0 };
  }
  const nowMs = Date.now();
  const lastSyncAt = historySyncAt.get(groupId) ?? 0;
  if (!options?.force && nowMs - lastSyncAt < HISTORY_SYNC_TTL_MS) {
    return { members: 0, messages: 0 };
  }

  await ensureBotGroupRankingTable();
  await ensureBotGroupRankingPeriodTable();
  const db = getDb();
  const [groupRows] = await db.query<
    (RowDataPacket & { instance_id: number | null; remote_id: string | null })[]
  >(
    "SELECT instance_id, remote_id FROM bot_groups WHERE id = ? LIMIT 1",
    [groupId],
  );
  const group = groupRows?.[0];
  if (!group?.instance_id || !group.remote_id) {
    historySyncAt.set(groupId, nowMs);
    return { members: 0, messages: 0 };
  }

  const [historyRows] = await db.query<
    (RowDataPacket & { sender_jid: string | null; timestamp: Date | string })[]
  >(
    `
      SELECT sender_jid, timestamp
      FROM bot_whatsapp_messages
      WHERE instance_id = ?
        AND chat_jid = ?
        AND direction = 'inbound'
        AND sender_jid IS NOT NULL
    `,
    [group.instance_id, group.remote_id],
  );

  const timezone = options?.timezone ?? "UTC";
  const now = new Date();
  const currentWeekKey = formatWeekKey(now, timezone);
  const currentMonthKey = formatMonthKey(now, timezone);
  const totals = new Map<string, HistoryAggregate>();
  const currentWeek = new Map<string, HistoryAggregate>();
  const currentMonth = new Map<string, HistoryAggregate>();
  const periodKeysByQuarterHour = new Map<number, { week: string; month: string }>();
  let messageCount = 0;

  const addHit = (target: Map<string, HistoryAggregate>, memberJid: string, timestamp: Date) => {
    const current = target.get(memberJid);
    if (!current) {
      target.set(memberJid, {
        score: 1,
        firstMessageAt: timestamp,
        lastMessageAt: timestamp,
      });
      return;
    }
    current.score += 1;
    if (timestamp < current.firstMessageAt) current.firstMessageAt = timestamp;
    if (timestamp > current.lastMessageAt) current.lastMessageAt = timestamp;
  };

  for (const row of historyRows) {
    const memberJid = normalizeMemberJid(String(row.sender_jid ?? ""));
    const timestamp = toValidDate(row.timestamp);
    if (!memberJid || !timestamp) continue;
    messageCount += 1;
    addHit(totals, memberJid, timestamp);
    const periodBucket = Math.floor(timestamp.getTime() / (15 * 60 * 1000));
    let periodKeys = periodKeysByQuarterHour.get(periodBucket);
    if (!periodKeys) {
      periodKeys = {
        week: formatWeekKey(timestamp, timezone),
        month: formatMonthKey(timestamp, timezone),
      };
      periodKeysByQuarterHour.set(periodBucket, periodKeys);
    }
    if (periodKeys.week === currentWeekKey) {
      addHit(currentWeek, memberJid, timestamp);
    }
    if (periodKeys.month === currentMonthKey) {
      addHit(currentMonth, memberJid, timestamp);
    }
  }

  const [existingRows] = await db.query<
    (RowDataPacket & {
      member_jid: string;
      score: number;
      first_message_at: Date | string;
      last_message_at: Date | string;
    })[]
  >(
    `SELECT member_jid, score, first_message_at, last_message_at
     FROM bot_group_ranking WHERE group_id = ?`,
    [groupId],
  );
  const existingByMember = new Map(
    existingRows.map((row) => [normalizeMemberJid(row.member_jid), row] as const),
  );

  await runInBatches(Array.from(totals.entries()), async ([memberJid, aggregate]) => {
    const existing = existingByMember.get(memberJid);
    if (!existing) {
      await db.query(
        `INSERT INTO bot_group_ranking
          (group_id, member_jid, score, first_message_at, last_message_at)
         VALUES (?, ?, ?, ?, ?)`,
        [groupId, memberJid, aggregate.score, aggregate.firstMessageAt, aggregate.lastMessageAt],
      );
      return;
    }
    const existingFirst = toValidDate(existing.first_message_at) ?? aggregate.firstMessageAt;
    const existingLast = toValidDate(existing.last_message_at) ?? aggregate.lastMessageAt;
    const nextScore = Math.max(Number(existing.score ?? 0), aggregate.score);
    const nextFirst = existingFirst < aggregate.firstMessageAt ? existingFirst : aggregate.firstMessageAt;
    const nextLast = existingLast > aggregate.lastMessageAt ? existingLast : aggregate.lastMessageAt;
    if (
      nextScore === Number(existing.score ?? 0) &&
      nextFirst.getTime() === existingFirst.getTime() &&
      nextLast.getTime() === existingLast.getTime()
    ) {
      return;
    }
    await db.query(
      `UPDATE bot_group_ranking
       SET score = ?, first_message_at = ?, last_message_at = ?
       WHERE group_id = ? AND member_jid = ?`,
      [
        nextScore,
        nextFirst,
        nextLast,
        groupId,
        memberJid,
      ],
    );
  });

  const syncPeriod = async (
    periodType: GroupRankingPeriod,
    periodKey: string,
    aggregates: Map<string, HistoryAggregate>,
  ) => {
    const [existingPeriodRows] = await db.query<
      (RowDataPacket & { member_jid: string; score: number; last_message_at: Date | string })[]
    >(
      `SELECT member_jid, score, last_message_at
       FROM bot_group_ranking_periods
       WHERE group_id = ? AND period_type = ? AND period_key = ?`,
      [groupId, periodType, periodKey],
    );
    const existingPeriods = new Map(
      existingPeriodRows.map((row) => [normalizeMemberJid(row.member_jid), row] as const),
    );
    await runInBatches(Array.from(aggregates.entries()), async ([memberJid, aggregate]) => {
      const existing = existingPeriods.get(memberJid);
      if (!existing) {
        await db.query(
          `INSERT INTO bot_group_ranking_periods
            (group_id, member_jid, period_type, period_key, score, last_message_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [groupId, memberJid, periodType, periodKey, aggregate.score, aggregate.lastMessageAt],
        );
        return;
      }
      const existingLast = toValidDate(existing.last_message_at) ?? aggregate.lastMessageAt;
      const nextScore = Math.max(Number(existing.score ?? 0), aggregate.score);
      const nextLast = existingLast > aggregate.lastMessageAt ? existingLast : aggregate.lastMessageAt;
      if (
        nextScore === Number(existing.score ?? 0) &&
        nextLast.getTime() === existingLast.getTime()
      ) {
        return;
      }
      await db.query(
        `UPDATE bot_group_ranking_periods
         SET score = ?, last_message_at = ?
         WHERE group_id = ? AND member_jid = ? AND period_type = ? AND period_key = ?`,
        [
          nextScore,
          nextLast,
          groupId,
          memberJid,
          periodType,
          periodKey,
        ],
      );
    });
  };

  await syncPeriod("weekly", currentWeekKey, currentWeek);
  await syncPeriod("monthly", currentMonthKey, currentMonth);
  historySyncAt.set(groupId, nowMs);
  return { members: totals.size, messages: messageCount };
};

/** Seeds members with a grace-period timestamp when no message history exists. */
export const seedGroupRankingMembers = async (
  groupId: number,
  memberJids: string[],
  now = new Date(),
): Promise<number> => {
  if (!Number.isFinite(groupId) || groupId <= 0) return 0;
  const members = Array.from(
    new Set(memberJids.map((entry) => normalizeMemberJid(entry)).filter((entry) => entry.length >= 5)),
  );
  if (members.length === 0) return 0;
  await ensureBotGroupRankingTable();
  const db = getDb();
  const [existingRows] = await db.query<(RowDataPacket & { member_jid: string })[]>(
    "SELECT member_jid FROM bot_group_ranking WHERE group_id = ?",
    [groupId],
  );
  const existing = new Set(existingRows.map((row) => normalizeMemberJid(row.member_jid)));
  let seeded = 0;
  await runInBatches(members, async (memberJid) => {
    if (existing.has(memberJid)) return;
    await db.query(
      `INSERT INTO bot_group_ranking
        (group_id, member_jid, score, first_message_at, last_message_at)
       VALUES (?, ?, 0, ?, ?)`,
      [groupId, memberJid, now, now],
    );
    seeded += 1;
  });
  return seeded;
};

export const recordGroupRankingHit = async (
  groupId: number,
  memberJid: string,
  options?: { delta?: number; now?: Date; timezone?: string | null },
): Promise<GroupRankingSnapshot | null> => {
  const normalizedMember = normalizeMemberJid(memberJid);
  if (!Number.isFinite(groupId) || groupId <= 0 || !normalizedMember) {
    return null;
  }
  const delta = options?.delta ?? 1;
  const safeDelta = Number.isFinite(delta) && delta > 0 ? Math.floor(delta) : 1;
  const now = options?.now ?? new Date();
  const timezone = options?.timezone ?? "UTC";

  await ensureBotGroupRankingTable();
  await ensureBotGroupRankingPeriodTable();
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_group_ranking (group_id, member_jid, score, first_message_at, last_message_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        score = bot_group_ranking.score + VALUES(score),
        last_message_at = CURRENT_TIMESTAMP
    `,
    [groupId, normalizedMember, safeDelta],
  );

  const weekKey = formatWeekKey(now, timezone);
  const monthKey = formatMonthKey(now, timezone);

  await db.query(
    `
      INSERT INTO bot_group_ranking_periods (group_id, member_jid, period_type, period_key, score, last_message_at)
      VALUES (?, ?, 'weekly', ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        score = bot_group_ranking_periods.score + VALUES(score),
        last_message_at = CURRENT_TIMESTAMP
    `,
    [groupId, normalizedMember, weekKey, safeDelta],
  );

  await db.query(
    `
      INSERT INTO bot_group_ranking_periods (group_id, member_jid, period_type, period_key, score, last_message_at)
      VALUES (?, ?, 'monthly', ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        score = bot_group_ranking_periods.score + VALUES(score),
        last_message_at = CURRENT_TIMESTAMP
    `,
    [groupId, normalizedMember, monthKey, safeDelta],
  );

  const [rows] = await db.query<(RowDataPacket & { score: number })[]>(
    `
      SELECT score
      FROM bot_group_ranking
      WHERE group_id = ? AND member_jid = ?
      LIMIT 1
    `,
    [groupId, normalizedMember],
  );

  const score = Number(rows?.[0]?.score ?? safeDelta);
  return { score };
};

export const getGroupRankingPeriodLeaders = async (
  groupId: number,
  periodType: GroupRankingPeriod,
  periodKey: string,
  limit = 10,
): Promise<GroupRankingEntry[]> => {
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return [];
  }
  await ensureBotGroupRankingPeriodTable();
  const db = getDb();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const [rows] = await db.query<
    (RowDataPacket & {
      member_jid: string;
      score: number;
      last_message_at: Date | null;
    })[]
  >(
    `
      SELECT member_jid, score, last_message_at
      FROM bot_group_ranking_periods
      WHERE group_id = ? AND period_type = ? AND period_key = ?
      ORDER BY score DESC, last_message_at DESC
      LIMIT ?
    `,
    [groupId, periodType, periodKey, cappedLimit],
  );

  return rows.map((row, index) => ({
    memberJid: row.member_jid,
    score: Number(row.score ?? 0),
    firstMessageAt: null,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
    rank: index + 1,
  }));
};

export const getMemberRankingPeriodCount = async (
  groupId: number,
  memberJid: string,
  periodType: GroupRankingPeriod,
  periodKey: string,
): Promise<number> => {
  const normalizedMember = normalizeMemberJid(memberJid);
  if (!Number.isFinite(groupId) || groupId <= 0 || !normalizedMember) {
    return 0;
  }
  await ensureBotGroupRankingPeriodTable();
  const db = getDb();
  const [rows] = await db.query<(RowDataPacket & { score: number })[]>(
    `
      SELECT score
      FROM bot_group_ranking_periods
      WHERE group_id = ? AND member_jid = ? AND period_type = ? AND period_key = ?
      LIMIT 1
    `,
    [groupId, normalizedMember, periodType, periodKey],
  );
  return Number(rows?.[0]?.score ?? 0);
};

export const getGroupRankingLeaders = async (
  groupId: number,
  limit = 10,
): Promise<GroupRankingEntry[]> => {
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return [];
  }
  await ensureBotGroupRankingTable();
  const db = getDb();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const [rows] = await db.query<
    (RowDataPacket & {
      member_jid: string;
      score: number;
      first_message_at: Date | null;
      last_message_at: Date | null;
    })[]
  >(
    `
      SELECT member_jid, score, first_message_at, last_message_at
      FROM bot_group_ranking
      WHERE group_id = ?
      ORDER BY score DESC, last_message_at DESC
      LIMIT ?
    `,
    [groupId, cappedLimit],
  );

  return rows.map((row, index) => ({
    memberJid: row.member_jid,
    score: Number(row.score ?? 0),
    firstMessageAt: row.first_message_at ? new Date(row.first_message_at) : null,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
    rank: index + 1,
  }));
};

export const getMemberRankingInfo = async (
  groupId: number,
  memberJid: string,
): Promise<MemberRankingInfo | null> => {
  const normalizedMember = normalizeMemberJid(memberJid);
  if (!Number.isFinite(groupId) || groupId <= 0 || !normalizedMember) {
    return null;
  }
  await ensureBotGroupRankingTable();
  const db = getDb();

  type RankingRow = RowDataPacket & {
    score: number;
    last_message_at: Date | null;
    first_message_at?: Date | null;
  };
  let current: RankingRow | null = null;
  try {
    const [rows] = await db.query<RankingRow[]>(
      `
        SELECT score, last_message_at, first_message_at
        FROM bot_group_ranking
        WHERE group_id = ? AND member_jid = ?
        LIMIT 1
      `,
      [groupId, normalizedMember],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }
    current = rows[0];
  } catch (error: any) {
    const isMissingColumn =
      error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ER_BAD_FIELD_ERROR";
    if (!isMissingColumn) {
      throw error;
    }
    const [fallbackRows] = await db.query<
      (RowDataPacket & { score: number; last_message_at: Date | null })[]
    >(
      `
        SELECT score, last_message_at
        FROM bot_group_ranking
        WHERE group_id = ? AND member_jid = ?
        LIMIT 1
      `,
      [groupId, normalizedMember],
    );
    if (!Array.isArray(fallbackRows) || fallbackRows.length === 0) {
      return null;
    }
    current = { ...fallbackRows[0], first_message_at: null };
  }

  if (!current) {
    return null;
  }
  const referenceDate = current.last_message_at
    ? new Date(current.last_message_at)
    : new Date(0);

  const [rankRows] = await db.query<(RowDataPacket & { rank_value: number })[]>(
    `
      SELECT 1 + COUNT(*) AS rank_value
      FROM bot_group_ranking
      WHERE group_id = ?
        AND (score > ? OR (score = ? AND last_message_at > ?))
    `,
    [groupId, current.score, current.score, referenceDate],
  );

  const rankValue = rankRows?.[0]?.rank_value ? Number(rankRows[0].rank_value) : 1;

  return {
    memberJid: normalizedMember,
    score: Number(current.score ?? 0),
    rank: rankValue,
    firstMessageAt: current.first_message_at ? new Date(current.first_message_at) : null,
    lastMessageAt: current.last_message_at ? new Date(current.last_message_at) : null,
  };
};

export const listInactiveGroupRankingMembers = async (
  groupId: number,
  days: number,
  limit = 100,
): Promise<GroupRankingEntry[]> => {
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return [];
  }
  const safeDays = Math.max(1, Math.min(Number.parseInt(String(days), 10) || 30, 365));
  const safeLimit = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 100, 100));
  await ensureBotGroupRankingTable();
  const db = getDb();
  const [rows] = await db.query<
    (RowDataPacket & {
      member_jid: string;
      score: number;
      first_message_at: Date | null;
      last_message_at: Date | null;
    })[]
  >(
    `
      SELECT member_jid, score, first_message_at, last_message_at
      FROM bot_group_ranking
      WHERE group_id = ?
        AND last_message_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
      ORDER BY last_message_at ASC, score ASC
      LIMIT ?
    `,
    [groupId, safeDays, safeLimit],
  );

  return rows.map((row, index) => ({
    memberJid: row.member_jid,
    score: Number(row.score ?? 0),
    firstMessageAt: row.first_message_at ? new Date(row.first_message_at) : null,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
    rank: index + 1,
  }));
};

export type GroupRankingHistoryCoverage = {
  trackedMembers: number;
  membersWithMessages: number;
  messageCount: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
};

/**
 * Returns only evidence recorded for the participants currently in the group.
 * Anti-inactivity uses this before any removal so an empty/partial ranking can
 * never be interpreted as proof that a member is inactive.
 */
export const getGroupRankingHistoryCoverage = async (
  groupId: number,
  memberJids: string[],
): Promise<GroupRankingHistoryCoverage> => {
  const empty: GroupRankingHistoryCoverage = {
    trackedMembers: 0,
    membersWithMessages: 0,
    messageCount: 0,
    firstMessageAt: null,
    lastMessageAt: null,
  };
  if (!Number.isFinite(groupId) || groupId <= 0) return empty;

  const members = Array.from(
    new Set(memberJids.map((entry) => normalizeMemberJid(entry)).filter((entry) => entry.length >= 5)),
  );
  if (members.length === 0) return empty;

  await ensureBotGroupRankingTable();
  const db = getDb();
  const placeholders = members.map(() => "?").join(", ");
  const [rows] = await db.query<
    (RowDataPacket & {
      tracked_members: number | string | null;
      members_with_messages: number | string | null;
      message_count: number | string | null;
      first_message_at: Date | string | null;
      last_message_at: Date | string | null;
    })[]
  >(
    `
      SELECT
        COUNT(*) AS tracked_members,
        COUNT(CASE WHEN score > 0 THEN 1 END) AS members_with_messages,
        COALESCE(SUM(CASE WHEN score > 0 THEN score ELSE 0 END), 0) AS message_count,
        MIN(CASE WHEN score > 0 THEN first_message_at ELSE NULL END) AS first_message_at,
        MAX(CASE WHEN score > 0 THEN last_message_at ELSE NULL END) AS last_message_at
      FROM bot_group_ranking
      WHERE group_id = ?
        AND member_jid IN (${placeholders})
    `,
    [groupId, ...members],
  );
  const row = rows?.[0];
  if (!row) return empty;
  return {
    trackedMembers: Number(row.tracked_members ?? 0) || 0,
    membersWithMessages: Number(row.members_with_messages ?? 0) || 0,
    messageCount: Number(row.message_count ?? 0) || 0,
    firstMessageAt: toValidDate(row.first_message_at),
    lastMessageAt: toValidDate(row.last_message_at),
  };
};

export const deleteGroupRankingMembers = async (
  groupId: number,
  memberJids: string[],
): Promise<void> => {
  if (!Number.isFinite(groupId) || groupId <= 0 || memberJids.length === 0) {
    return;
  }
  const normalizedMembers = Array.from(
    new Set(memberJids.map((entry) => normalizeMemberJid(entry)).filter(Boolean)),
  ).slice(0, 200);
  if (normalizedMembers.length === 0) {
    return;
  }

  await ensureBotGroupRankingTable();
  await ensureBotGroupRankingPeriodTable();
  const db = getDb();
  const placeholders = normalizedMembers.map(() => "?").join(", ");
  await db.query(
    `DELETE FROM bot_group_ranking WHERE group_id = ? AND member_jid IN (${placeholders})`,
    [groupId, ...normalizedMembers],
  );
  await db.query(
    `DELETE FROM bot_group_ranking_periods WHERE group_id = ? AND member_jid IN (${placeholders})`,
    [groupId, ...normalizedMembers],
  );
};

export const resetGroupRanking = async (groupId: number): Promise<void> => {
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return;
  }
  await ensureBotGroupRankingTable();
  const db = getDb();
  await db.query("DELETE FROM bot_group_ranking WHERE group_id = ?", [groupId]);
};
