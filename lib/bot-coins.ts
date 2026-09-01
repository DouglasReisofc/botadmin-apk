import type { ResultSetHeader, RowDataPacket } from "mysql2";

import type {
  BotGroupCoinsConfig,
  BotGroupCoinLedgerEntry,
  BotGroupCoinMember,
} from "types/bot-groups";
import {
  ensureBotGroupCoinLedgerTable,
  ensureBotGroupCoinsTable,
  ensureBotGroupPremiumMembersTable,
  getDb,
} from "lib/db";

const normalizeMemberJid = (value: string): string => value.replace(/\D+/g, "");

const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as any);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
};

const formatDateKey = (value: Date, timezone?: string | null): string => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  } catch {
    const iso = value.toISOString();
    return iso.slice(0, 10);
  }
};

const normalizeDateKey = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    // MySQL pool uses timezone "Z", so normalize using UTC getters to avoid day shift.
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 10);
  }
  return null;
};

const mapCoinRow = (row: RowDataPacket): BotGroupCoinMember => ({
  memberJid: String(row.member_jid ?? ""),
  balance: Number(row.balance ?? 0),
  totalEarned: Number(row.total_earned ?? 0),
  totalSpent: Number(row.total_spent ?? 0),
  xp: Number(row.xp ?? 0),
  level: Number(row.level ?? 1),
  lastAwardAt: toIsoString(row.last_award_at),
  lastMessageAt: toIsoString(row.last_message_at),
  dailyDate: normalizeDateKey(row.daily_date),
  dailyEarned: Number(row.daily_earned ?? 0),
});

const mapLedgerRow = (row: RowDataPacket): BotGroupCoinLedgerEntry => ({
  id: Number(row.id),
  groupId: Number(row.group_id),
  memberJid: String(row.member_jid ?? ""),
  delta: Number(row.delta ?? 0),
  balanceAfter: Number(row.balance_after ?? 0),
  reason: String(row.reason ?? ""),
  metadata: row.metadata && typeof row.metadata === "object"
    ? (row.metadata as Record<string, unknown>)
    : row.metadata
      ? (() => {
          try {
            return JSON.parse(String(row.metadata));
          } catch {
            return null;
          }
        })()
      : null,
  createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
});

export const getOrCreateCoinState = async (
  groupId: number,
  memberJid: string,
): Promise<BotGroupCoinMember | null> => {
  const id = Number(groupId);
  const normalized = normalizeMemberJid(memberJid);
  if (!Number.isFinite(id) || id <= 0 || !normalized) return null;

  await ensureBotGroupCoinsTable();
  const db = getDb();
  await db.query(
    "INSERT IGNORE INTO bot_group_coins (group_id, member_jid) VALUES (?, ?)",
    [id, normalized],
  );

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT member_jid, balance, total_earned, total_spent, xp, level,
        last_award_at, last_message_at, daily_date, daily_earned
      FROM bot_group_coins
      WHERE group_id = ? AND member_jid = ?
      LIMIT 1
    `,
    [id, normalized],
  );

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapCoinRow(rows[0]);
};

export const awardCoinsForMessage = async (options: {
  groupId: number;
  memberJid: string;
  config: BotGroupCoinsConfig;
  now?: Date;
  timezone?: string | null;
  messageLength?: number;
  messageScore?: number | null;
}) => {
  const { groupId, memberJid, config, timezone } = options;
  const now = options.now ?? new Date();
  const id = Number(groupId);
  const normalized = normalizeMemberJid(memberJid);

  if (!Number.isFinite(id) || id <= 0 || !normalized) return null;
  if (!config?.enabled) return null;

  await ensureBotGroupCoinsTable();
  await ensureBotGroupCoinLedgerTable();
  const db = getDb();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      "INSERT IGNORE INTO bot_group_coins (group_id, member_jid) VALUES (?, ?)",
      [id, normalized],
    );

    const [rows] = await connection.query<RowDataPacket[]>(
      `
        SELECT *
        FROM bot_group_coins
        WHERE group_id = ? AND member_jid = ?
        LIMIT 1
        FOR UPDATE
      `,
      [id, normalized],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      await connection.rollback();
      return null;
    }

    const row = rows[0];
    const lastAwardAt = row.last_award_at ? new Date(row.last_award_at) : null;
    const lastMessageAt = row.last_message_at ? new Date(row.last_message_at) : null;
    const messageConfig = config.earnings.message;
    const cooldownMs = Math.max(0, Number(messageConfig.cooldownSec ?? 0)) * 1000;
    const isCooldownReady =
      !lastAwardAt || cooldownMs <= 0 || now.getTime() - lastAwardAt.getTime() >= cooldownMs;
    const spacingSec = Math.max(
      5,
      Math.min(20, Math.floor((cooldownMs > 0 ? cooldownMs / 1000 : 10) / 2) || 5),
    );
    const isSpacingReady =
      !lastMessageAt || now.getTime() - lastMessageAt.getTime() >= spacingSec * 1000;

    const todayKey = formatDateKey(now, timezone);
    const dailyDate = normalizeDateKey(row.daily_date);
    let dailyEarned = Number(row.daily_earned ?? 0);
    const isFirstMessageToday = dailyDate !== todayKey;
    if (isFirstMessageToday) {
      // reset only when day actually changes
      dailyEarned = 0;
    }

    const maxPerDay = Math.max(0, Number(messageConfig.maxPerDay ?? 0));
    const available = maxPerDay > 0 ? Math.max(0, maxPerDay - dailyEarned) : Number.POSITIVE_INFINITY;
    const baseAmount = Math.max(0, Number(messageConfig.amount ?? 0));
    const messagesPerReward = Math.max(1, Number(messageConfig.messagesPerReward ?? 1));
    const lastAwardScore = Math.max(0, Number(row.last_award_score ?? 0));
    const minLength = Math.max(1, Number(messageConfig.minLength ?? 1));
    const meetsLength =
      typeof options.messageLength === "number" ? options.messageLength >= minLength : true;
    const xpPerMessage = Math.max(0, Number(config.leveling.xpPerMessage ?? 0));
    const levelStep = Math.max(1, Number(config.leveling.levelStep ?? 1));
    const incomingScore = Number(options.messageScore);
    const fallbackScore = Math.max(0, lastAwardScore + Math.max(1, messagesPerReward));
    const rawScore =
      Number.isFinite(incomingScore) && incomingScore > 0 ? Math.floor(incomingScore) : null;
    const scoreOffset = Math.max(0, Number(row.score_offset ?? 0));
    const effectiveIncomingScore =
      rawScore !== null ? Math.max(0, rawScore - scoreOffset) : null;
    const xpBefore = Number(row.xp ?? 0);
    const baseScoreFromXp = Math.max(
      0,
      Math.floor(xpPerMessage > 0 ? xpBefore / xpPerMessage : xpBefore),
    );
    const messageScore = Math.max(effectiveIncomingScore ?? fallbackScore, baseScoreFromXp);
    const messagesSinceAward = Math.max(0, messageScore - lastAwardScore);
    let nextAwardScore = lastAwardScore;
    let messageAmount = 0;
    const messageEnabled = Boolean(messageConfig.enabled);
    const shouldConsumeMessages =
      messageEnabled && meetsLength && isSpacingReady && messagesSinceAward >= messagesPerReward;
    if (shouldConsumeMessages) {
      if (available > 0 && isCooldownReady && baseAmount > 0) {
        messageAmount =
          available === Number.POSITIVE_INFINITY
            ? baseAmount
            : Math.min(baseAmount, available);
      }
      nextAwardScore = lastAwardScore + messagesPerReward;
    }

    const dailyAmount =
      config.earnings.daily.enabled && isFirstMessageToday
        ? Math.max(0, Number(config.earnings.daily.amount ?? 0))
        : 0;

    const levelBefore = Number(row.level ?? 1) || 1;
    const xpAfter =
      xpPerMessage > 0 ? Math.max(0, Math.floor(messageScore * xpPerMessage)) : Number(row.xp ?? 0);
    const computedLevel = Math.max(1, Math.floor(xpAfter / levelStep) + 1);
    const levelGained = Math.max(0, computedLevel - levelBefore);
    const levelUpAmount =
      config.earnings.levelUp.enabled && levelGained > 0
        ? Math.max(0, Number(config.earnings.levelUp.amount ?? 0)) * levelGained
        : 0;

    const totalDelta = messageAmount + dailyAmount + levelUpAmount;

    const nextBalance = Number(row.balance ?? 0) + totalDelta;
    const nextTotalEarned = Number(row.total_earned ?? 0) + totalDelta;

    const nextDailyEarned = dailyEarned + messageAmount;
    const nextAwardAt = totalDelta > 0 ? now : row.last_award_at;

    await connection.query(
      `
        UPDATE bot_group_coins
        SET balance = ?,
            total_earned = ?,
            xp = ?,
            level = ?,
            last_award_at = ?,
            last_message_at = ?,
            daily_date = ?,
            daily_earned = ?,
            last_award_score = ?
        WHERE group_id = ? AND member_jid = ?
      `,
      [
        nextBalance,
        nextTotalEarned,
        xpAfter,
        computedLevel,
        nextAwardAt,
        now,
        isFirstMessageToday ? todayKey : dailyDate,
        nextDailyEarned,
        nextAwardScore,
        id,
        normalized,
      ],
    );

    const ledgerEntries: Array<[number, string, Record<string, unknown> | null]> = [];
    if (messageAmount > 0) {
      ledgerEntries.push([messageAmount, "message", { kind: "message" }]);
    }
    if (dailyAmount > 0) {
      ledgerEntries.push([dailyAmount, "daily", { kind: "daily" }]);
    }
    if (levelUpAmount > 0) {
      ledgerEntries.push([levelUpAmount, "level_up", { levelGained }]);
    }

    for (const [delta, reason, metadata] of ledgerEntries) {
      await connection.query(
        `
          INSERT INTO bot_group_coin_ledger (group_id, member_jid, delta, balance_after, reason, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [id, normalized, delta, nextBalance, reason, metadata ? JSON.stringify(metadata) : null],
      );
    }

    await connection.commit();

    return {
      totalDelta,
      balanceAfter: nextBalance,
      xp: xpAfter,
      level: computedLevel,
      components: {
        message: messageAmount,
        daily: dailyAmount,
        levelUp: levelUpAmount,
        levelGained,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const chargeCoinsForCommand = async (options: {
  groupId: number;
  memberJid: string;
  cost: number;
  reason: string;
  metadata?: Record<string, unknown> | null;
}) => {
  const id = Number(options.groupId);
  const normalized = normalizeMemberJid(options.memberJid);
  const cost = Math.max(0, Math.floor(Number(options.cost ?? 0)));
  if (!Number.isFinite(id) || id <= 0 || !normalized) return null;
  if (cost <= 0) return null;

  await ensureBotGroupCoinsTable();
  await ensureBotGroupCoinLedgerTable();
  const db = getDb();

  await db.query(
    "INSERT IGNORE INTO bot_group_coins (group_id, member_jid) VALUES (?, ?)",
    [id, normalized],
  );

  const [updateResult] = await db.query<ResultSetHeader>(
    `
      UPDATE bot_group_coins
      SET balance = balance - ?, total_spent = total_spent + ?
      WHERE group_id = ? AND member_jid = ? AND balance >= ?
    `,
    [cost, cost, id, normalized, cost],
  );

  if (!updateResult.affectedRows) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT balance, xp, level FROM bot_group_coins WHERE group_id = ? AND member_jid = ? LIMIT 1`,
      [id, normalized],
    );
    const balance = Array.isArray(rows) && rows[0] ? Number(rows[0].balance ?? 0) : 0;
    return { success: false, balanceAfter: balance };
  }

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT balance FROM bot_group_coins WHERE group_id = ? AND member_jid = ? LIMIT 1`,
    [id, normalized],
  );
  const balanceAfter = Array.isArray(rows) && rows[0] ? Number(rows[0].balance ?? 0) : 0;

  await db.query(
    `
      INSERT INTO bot_group_coin_ledger (group_id, member_jid, delta, balance_after, reason, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [id, normalized, -cost, balanceAfter, options.reason, options.metadata ? JSON.stringify(options.metadata) : null],
  );

  return { success: true, balanceAfter };
};

export const applyInfractionPenalty = async (options: {
  groupId: number;
  memberJid: string;
  amount: number;
}) => {
  const id = Number(options.groupId);
  const normalized = normalizeMemberJid(options.memberJid);
  const amount = Math.max(0, Math.floor(Number(options.amount ?? 0)));
  if (!Number.isFinite(id) || id <= 0 || !normalized || amount <= 0) return null;

  await ensureBotGroupCoinsTable();
  await ensureBotGroupCoinLedgerTable();
  const db = getDb();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT IGNORE INTO bot_group_coins (group_id, member_jid) VALUES (?, ?)",
      [id, normalized],
    );

    const [rows] = await connection.query<RowDataPacket[]>(
      `
        SELECT balance, total_spent
        FROM bot_group_coins
        WHERE group_id = ? AND member_jid = ?
        LIMIT 1
        FOR UPDATE
      `,
      [id, normalized],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      await connection.rollback();
      return null;
    }

    const currentBalance = Number(rows[0].balance ?? 0);
    const penalty = Math.min(currentBalance, amount);
    if (penalty <= 0) {
      await connection.rollback();
      return { applied: false, balanceAfter: currentBalance, penalty: 0 };
    }

    const nextBalance = currentBalance - penalty;
    const nextTotalSpent = Number(rows[0].total_spent ?? 0) + penalty;

    await connection.query(
      `
        UPDATE bot_group_coins
        SET balance = ?, total_spent = ?
        WHERE group_id = ? AND member_jid = ?
      `,
      [nextBalance, nextTotalSpent, id, normalized],
    );

    await connection.query(
      `
        INSERT INTO bot_group_coin_ledger (group_id, member_jid, delta, balance_after, reason, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [id, normalized, -penalty, nextBalance, "infraction", null],
    );

    await connection.commit();
    return { applied: true, balanceAfter: nextBalance, penalty };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const adjustMemberCoins = async (options: {
  groupId: number;
  memberJid: string;
  delta: number;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}) => {
  const id = Number(options.groupId);
  const normalized = normalizeMemberJid(options.memberJid);
  const deltaRaw = Number(options.delta ?? 0);
  if (!Number.isFinite(id) || id <= 0 || !normalized || !Number.isFinite(deltaRaw) || deltaRaw === 0) {
    return null;
  }

  await ensureBotGroupCoinsTable();
  await ensureBotGroupCoinLedgerTable();
  const db = getDb();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT IGNORE INTO bot_group_coins (group_id, member_jid) VALUES (?, ?)",
      [id, normalized],
    );

    const [rows] = await connection.query<RowDataPacket[]>(
      `
        SELECT balance, total_earned, total_spent
        FROM bot_group_coins
        WHERE group_id = ? AND member_jid = ?
        LIMIT 1
        FOR UPDATE
      `,
      [id, normalized],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      await connection.rollback();
      return null;
    }

    const currentBalance = Number(rows[0].balance ?? 0);
    let deltaApplied = Math.trunc(deltaRaw);
    if (deltaApplied < 0 && currentBalance + deltaApplied < 0) {
      deltaApplied = -currentBalance;
    }
    if (deltaApplied === 0) {
      await connection.rollback();
      return { balanceAfter: currentBalance, deltaApplied: 0 };
    }

    const nextBalance = currentBalance + deltaApplied;
    const nextTotalEarned = Number(rows[0].total_earned ?? 0) + Math.max(0, deltaApplied);
    const nextTotalSpent = Number(rows[0].total_spent ?? 0) + Math.max(0, -deltaApplied);

    await connection.query(
      `
        UPDATE bot_group_coins
        SET balance = ?, total_earned = ?, total_spent = ?
        WHERE group_id = ? AND member_jid = ?
      `,
      [nextBalance, nextTotalEarned, nextTotalSpent, id, normalized],
    );

    await connection.query(
      `
        INSERT INTO bot_group_coin_ledger (group_id, member_jid, delta, balance_after, reason, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        normalized,
        deltaApplied,
        nextBalance,
        options.reason || "admin_adjust",
        options.metadata ? JSON.stringify(options.metadata) : null,
      ],
    );

    await connection.commit();
    return { balanceAfter: nextBalance, deltaApplied };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const resetMemberCoins = async (options: {
  groupId: number;
  memberJid: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  scoreOffset?: number | null;
  clearLedger?: boolean;
}) => {
  const id = Number(options.groupId);
  const normalized = normalizeMemberJid(options.memberJid);
  if (!Number.isFinite(id) || id <= 0 || !normalized) return null;

  await ensureBotGroupCoinsTable();
  await ensureBotGroupCoinLedgerTable();
  const db = getDb();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT IGNORE INTO bot_group_coins (group_id, member_jid) VALUES (?, ?)",
      [id, normalized],
    );

    const [rows] = await connection.query<RowDataPacket[]>(
      `
        SELECT balance, total_earned, total_spent, xp, level
        FROM bot_group_coins
        WHERE group_id = ? AND member_jid = ?
        LIMIT 1
        FOR UPDATE
      `,
      [id, normalized],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      await connection.rollback();
      return null;
    }

    const currentBalance = Number(rows[0].balance ?? 0);
    const baseMetadata = {
      previousBalance: currentBalance,
      previousTotalEarned: Number(rows[0].total_earned ?? 0),
      previousTotalSpent: Number(rows[0].total_spent ?? 0),
      previousXp: Number(rows[0].xp ?? 0),
      previousLevel: Number(rows[0].level ?? 1) || 1,
    };
    const metadata = options.metadata
      ? { ...baseMetadata, ...options.metadata }
      : baseMetadata;
    const deltaApplied = currentBalance > 0 ? -currentBalance : 0;
    const scoreOffset = Number.isFinite(Number(options.scoreOffset))
      ? Math.max(0, Math.floor(Number(options.scoreOffset)))
      : 0;

    await connection.query(
      `
        UPDATE bot_group_coins
        SET balance = 0,
            total_earned = 0,
            total_spent = 0,
            xp = 0,
            level = 1,
            last_award_at = NULL,
            last_message_at = NULL,
            daily_date = NULL,
            daily_earned = 0,
            last_award_score = 0,
            score_offset = ?
        WHERE group_id = ? AND member_jid = ?
      `,
      [scoreOffset, id, normalized],
    );

    if (options.clearLedger) {
      await connection.query(
        `
          DELETE FROM bot_group_coin_ledger
          WHERE group_id = ? AND member_jid = ?
        `,
        [id, normalized],
      );
    } else {
      await connection.query(
        `
          INSERT INTO bot_group_coin_ledger (group_id, member_jid, delta, balance_after, reason, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          normalized,
          deltaApplied,
          0,
          options.reason || "admin_reset",
          JSON.stringify(metadata),
        ],
      );
    }

    await connection.commit();
    return { balanceAfter: 0, deltaApplied };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const listGroupCoinMembers = async (options: {
  groupId: number;
  search?: string | null;
  limit?: number;
  offset?: number;
}) => {
  const id = Number(options.groupId);
  if (!Number.isFinite(id) || id <= 0) return [] as BotGroupCoinMember[];

  await ensureBotGroupCoinsTable();
  const db = getDb();
  const limit = Math.max(1, Math.min(Number(options.limit ?? 80), 300));
  const offset = Math.max(0, Number(options.offset ?? 0));
  const searchDigits = options.search ? options.search.replace(/\D+/g, "") : "";

  const params: Array<string | number> = [id];
  let where = "WHERE group_id = ?";
  if (searchDigits) {
    where += " AND member_jid LIKE ?";
    params.push(`%${searchDigits}%`);
  }
  params.push(limit, offset);

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT member_jid, balance, total_earned, total_spent, xp, level,
        last_award_at, last_message_at, daily_date, daily_earned
      FROM bot_group_coins
      ${where}
      ORDER BY balance DESC, xp DESC
      LIMIT ? OFFSET ?
    `,
    params,
  );

  return Array.isArray(rows) ? rows.map(mapCoinRow) : [];
};

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

export const listCoinLedger = async (options: {
  groupId: number;
  memberJid?: string | null;
  limit?: number;
  offset?: number;
}) => {
  const id = Number(options.groupId);
  if (!Number.isFinite(id) || id <= 0) return [] as BotGroupCoinLedgerEntry[];

  await ensureBotGroupCoinLedgerTable();
  const db = getDb();
  const limit = Math.max(1, Math.min(Number(options.limit ?? 80), 300));
  const offset = Math.max(0, Number(options.offset ?? 0));
  const normalized = options.memberJid ? normalizeMemberJid(options.memberJid) : "";

  const params: Array<string | number> = [id];
  let where = "WHERE group_id = ?";
  if (normalized) {
    where += " AND member_jid = ?";
    params.push(normalized);
  }
  params.push(limit, offset);

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT id, group_id, member_jid, delta, balance_after, reason, metadata, created_at
      FROM bot_group_coin_ledger
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `,
    params,
  );

  return Array.isArray(rows) ? rows.map(mapLedgerRow) : [];
};

export const getCoinRobberyState = async (options: {
  groupId: number;
  memberJid: string;
}) => {
  void options;
  return null;
};

export const updateCoinRobberyTimestamps = async (options: {
  groupId: number;
  memberJid: string;
  lastRobberyAt?: Date | null;
  lastRobbedAt?: Date | null;
}) => {
  void options;
};

export const listActiveCoinItems = async (options: {
  groupId: number;
  memberJid: string;
  now?: Date;
}) => {
  void options;
  return [];
};

export const upsertCoinItem = async (options: {
  groupId: number;
  memberJid: string;
  itemKey: string;
  addUses: number;
  durationDays: number;
  now?: Date;
}) => {
  void options;
  return null;
};

export const consumeCoinItem = async (options: {
  groupId: number;
  memberJid: string;
  itemKey: string;
  now?: Date;
}) => {
  void options;
  return null;
};
