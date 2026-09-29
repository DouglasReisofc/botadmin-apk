import { createHash, randomInt, randomUUID } from "crypto";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { ensureBotSweepstakesTable, getDb } from "lib/db";
import type {
  BotSweepstake,
  BotSweepstakeOption,
  BotSweepstakeParticipant,
  BotSweepstakeWithInstance,
} from "types/bot-sweepstakes";
import { normalizeJid } from "./whatsapp";
export type { BotSweepstakeOption, BotSweepstakeParticipant, BotSweepstakeWithInstance } from "types/bot-sweepstakes";

type SweepstakeRow = RowDataPacket & {
  id: number;
  instance_id: number;
  group_jid: string;
  poll_message_id: string;
  poll_id: string;
  question: string;
  join_option_hash: string;
  options: unknown;
  participants: unknown;
  winners: unknown;
  max_participants: number | null;
  winners_count: number;
  status: string;
  expires_at: Date | string;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  concluded_at: Date | string | null;
  metadata: unknown;
  message_key: string | null;
  base_url?: string;
  token?: string;
  phone?: string;
  session_status?: string | null;
  user_id?: number;
  group_id?: number | null;
};

export type CreateSweepstakePayload = {
  instanceId: number;
  groupJid: string;
  pollMessageId: string;
  pollId: string;
  question: string;
  joinOptionHash: string;
  options: BotSweepstakeOption[];
  maxParticipants: number | null;
  winnersCount: number;
  expiresAt: Date;
  createdBy: string;
  metadata?: Record<string, unknown> | null;
  messageKey?: string | null;
};

export type SweepstakeVoteInput = {
  participantJid: string;
  selectedOptionHashes: string[];
  displayName?: string | null;
  timestamp?: Date;
};

export type SweepstakeVoteResult = {
  sweepstake: BotSweepstake;
  change: "added" | "removed" | "none";
  limitReached?: boolean;
  accepted?: boolean;
};

export type FinalizeSweepstakePayload = {
  status: "completed" | "cancelled";
  winners: BotSweepstakeParticipant[];
  concludedAt: Date;
  metadata?: Record<string, unknown> | null;
};

export type ListSweepstakesResult = {
  active: BotSweepstake[];
  history: BotSweepstake[];
};

const toSqlDateTime = (date: Date): string =>
  date.toISOString().slice(0, 19).replace("T", " ");

const parseJsonColumn = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (Array.isArray(value) || typeof value === "object") {
    return value as T;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const toIsoString = (value: Date | string | null): string | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const ensureTable = (() => {
  let ensured = false;
  return async () => {
    if (!ensured) {
      await ensureBotSweepstakesTable();
      ensured = true;
    }
  };
})();

const mapSweepstakeRow = (row: SweepstakeRow): BotSweepstake => {
  const options = parseJsonColumn<BotSweepstakeOption[]>(row.options, []);
  const participants = parseJsonColumn<BotSweepstakeParticipant[]>(row.participants, []).map(
    (entry) => ({
      ...entry,
      joinedAt: entry.joinedAt ?? toIsoString(new Date()) ?? new Date().toISOString(),
      lastVoteAt: entry.lastVoteAt ?? entry.joinedAt ?? null,
    }),
  );
  const winners = parseJsonColumn<BotSweepstakeParticipant[]>(row.winners, []).map((entry) => ({
    ...entry,
    joinedAt: entry.joinedAt ?? new Date().toISOString(),
    lastVoteAt: entry.lastVoteAt ?? entry.joinedAt ?? null,
  }));
  const metadata = parseJsonColumn<Record<string, unknown> | null>(row.metadata, null);

  return {
    id: row.id,
    instanceId: row.instance_id,
    groupJid: row.group_jid,
    pollMessageId: row.poll_message_id,
    pollId: row.poll_id,
    question: row.question,
    joinOptionHash: row.join_option_hash,
    options,
    participants,
    winners,
    maxParticipants: row.max_participants,
    winnersCount: row.winners_count,
    status: row.status as BotSweepstake["status"],
    expiresAt: toIsoString(row.expires_at) ?? new Date().toISOString(),
    createdBy: row.created_by,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
    concludedAt: toIsoString(row.concluded_at),
    metadata,
    messageKey: row.message_key,
  };
};

const mapSweepstakeWithInstanceRow = (row: SweepstakeRow): BotSweepstakeWithInstance => {
  const sweepstake = mapSweepstakeRow(row);
  return {
    ...sweepstake,
    userId: Number(row.user_id ?? 0),
    groupId: row.group_id === null || row.group_id === undefined ? null : Number(row.group_id),
    instance: {
      id: sweepstake.instanceId,
      baseUrl: row.base_url ?? "",
      token: row.token ?? "",
      phone: row.phone ?? "",
      sessionStatus: row.session_status ?? null,
    },
  };
};

const clampHistoryLimit = (limit?: number): number => {
  if (!Number.isFinite(limit as number)) {
    return 20;
  }
  const normalized = Math.floor(Number(limit));
  if (normalized <= 0) {
    return 0;
  }
  return Math.min(normalized, 100);
};

export const listSweepstakesForGroup = async (
  instanceId: number,
  groupJid: string,
  options: { historyLimit?: number } = {},
): Promise<ListSweepstakesResult> => {
  await ensureTable();
  const db = getDb();
  const historyLimit = clampHistoryLimit(options.historyLimit);

  const [activeRows] = await db.query<SweepstakeRow[]>(
    `
      SELECT *
      FROM bot_sweepstakes
      WHERE instance_id = ?
        AND group_jid = ?
        AND status = 'active'
      ORDER BY id DESC
    `,
    [instanceId, groupJid],
  );

  let historyRows: SweepstakeRow[] = [];
  if (historyLimit > 0) {
    const [rows] = await db.query<SweepstakeRow[]>(
      `
        SELECT *
        FROM bot_sweepstakes
        WHERE instance_id = ?
          AND group_jid = ?
          AND status <> 'active'
        ORDER BY id DESC
        LIMIT ?
      `,
      [instanceId, groupJid, historyLimit],
    );
    historyRows = rows;
  }

  return {
    active: activeRows.map(mapSweepstakeRow),
    history: historyRows.map(mapSweepstakeRow),
  };
};

export const getSweepstakeForGroup = async (
  instanceId: number,
  groupJid: string,
  sweepstakeId: number,
): Promise<BotSweepstake | null> => {
  await ensureTable();
  const db = getDb();
  const [rows] = await db.query<SweepstakeRow[]>(
    `
      SELECT *
      FROM bot_sweepstakes
      WHERE id = ?
        AND instance_id = ?
        AND group_jid = ?
      LIMIT 1
    `,
    [sweepstakeId, instanceId, groupJid],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapSweepstakeRow(rows[0]);
};

export const createSweepstake = async (
  payload: CreateSweepstakePayload,
): Promise<BotSweepstake> => {
  await ensureTable();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_sweepstakes (
        instance_id,
        group_jid,
        poll_message_id,
        poll_id,
        question,
        join_option_hash,
        options,
        participants,
        winners,
        max_participants,
        winners_count,
        status,
        expires_at,
        created_by,
        metadata,
        message_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `,
    [
      payload.instanceId,
      payload.groupJid,
      payload.pollMessageId,
      payload.pollId,
      payload.question,
      payload.joinOptionHash,
      JSON.stringify(payload.options ?? []),
      JSON.stringify([]),
      JSON.stringify([]),
      payload.maxParticipants ?? null,
      payload.winnersCount,
      toSqlDateTime(payload.expiresAt),
      payload.createdBy,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      payload.messageKey ?? null,
    ],
  );

  const [rows] = await db.query<SweepstakeRow[]>(
    "SELECT * FROM bot_sweepstakes WHERE id = ? LIMIT 1",
    [result.insertId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Failed to load sweepstake after insert");
  }
  return mapSweepstakeRow(rows[0]);
};

export const findActiveSweepstakeByGroup = async (
  instanceId: number,
  groupJid: string,
): Promise<BotSweepstake | null> => {
  await ensureTable();
  const db = getDb();
  const [rows] = await db.query<SweepstakeRow[]>(
    `
      SELECT *
      FROM bot_sweepstakes
      WHERE instance_id = ?
        AND group_jid = ?
        AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `,
    [instanceId, groupJid],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return mapSweepstakeRow(rows[0]);
};

export const findActiveSweepstakeByPoll = async (
  instanceId: number,
  pollId: string,
): Promise<BotSweepstake | null> => {
  await ensureTable();
  const db = getDb();
  const [rows] = await db.query<SweepstakeRow[]>(
    `
      SELECT *
      FROM bot_sweepstakes
      WHERE instance_id = ?
        AND (poll_id = ? OR poll_message_id = ?)
        AND status = 'active'
      LIMIT 1
    `,
    [instanceId, pollId, pollId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return mapSweepstakeRow(rows[0]);
};

/**
 * Poll webhooks can arrive through a connected sibling instance while the
 * poll itself belongs to another instance of the same account/group. Resolve
 * the active sweepstake by owner user + chat as a transport-independent
 * fallback so votes are not lost just because the webhook route changed.
 */
export const findActiveSweepstakeByPollForUser = async (
  userId: number,
  groupJid: string,
  pollId: string,
): Promise<BotSweepstake | null> => {
  await ensureTable();
  const db = getDb();
  const [rows] = await db.query<SweepstakeRow[]>(
    `
      SELECT s.*
      FROM bot_sweepstakes s
      INNER JOIN bot_instances bi ON bi.id = s.instance_id
      WHERE bi.user_id = ?
        AND s.group_jid = ?
        AND (s.poll_id = ? OR s.poll_message_id = ?)
        AND s.status = 'active'
      ORDER BY s.id DESC
      LIMIT 1
    `,
    [userId, groupJid, pollId, pollId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapSweepstakeRow(rows[0]);
};

/** Last-resort lookup for webhook transports that belong to a different
 * account/instance row than the owner of the poll. Poll IDs are generated per
 * message and are globally unique enough for the group-scoped lookup. */
export const findActiveSweepstakeByPollForGroup = async (
  groupJid: string,
  pollId: string,
): Promise<BotSweepstake | null> => {
  await ensureTable();
  const db = getDb();
  const [rows] = await db.query<SweepstakeRow[]>(
    `
      SELECT *
      FROM bot_sweepstakes
      WHERE group_jid = ?
        AND (poll_id = ? OR poll_message_id = ?)
        AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `,
    [groupJid, pollId, pollId],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapSweepstakeRow(rows[0]);
};

export const getSweepstakeById = async (id: number): Promise<BotSweepstake | null> => {
  await ensureTable();
  const db = getDb();
  const [rows] = await db.query<SweepstakeRow[]>(
    "SELECT * FROM bot_sweepstakes WHERE id = ? LIMIT 1",
    [id],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return mapSweepstakeRow(rows[0]);
};

const serializeParticipant = (
  entry: BotSweepstakeParticipant,
  hash: string,
  displayName: string | null | undefined,
  timestamp: string,
): BotSweepstakeParticipant => ({
  ...entry,
  hash,
  displayName: sanitizeParticipantName(displayName ?? entry.displayName ?? null),
  lastVoteAt: timestamp,
});

const participantKey = (value: unknown): string =>
  normalizeJid(String(value ?? "")).replace(/@(s\.whatsapp\.net|c\.us|lid)$/i, "");

const sanitizeParticipantName = (value: string | null | undefined): string | null => {
  const clean = String(value ?? "")
    .replace(/@(s\.whatsapp\.net|c\.us|lid)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || null;
};

export const recordSweepstakeVote = async (
  sweepstake: BotSweepstake,
  vote: SweepstakeVoteInput,
): Promise<SweepstakeVoteResult> => {
  await ensureTable();
  // A WhatsApp LID is an internal alias, not a participant phone number. The
  // webhook handler resolves it before reaching this function; reject any
  // remaining LID defensively so manual/replayed events cannot persist it.
  if (/@lid(?:$|:)/i.test(String(vote.participantJid ?? '').trim())) {
    return { sweepstake, change: "none", accepted: false };
  }
  const connection = await getDb().getConnection();
  try {
    await connection.beginTransaction();
    // Serialize votes for the same poll. A stale webhook snapshot could otherwise
    // overwrite a vote that arrived a moment earlier on another instance.
    const [rows] = await connection.query<SweepstakeRow[]>(
      "SELECT * FROM bot_sweepstakes WHERE id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
      [sweepstake.id],
    );
    if (!rows.length) {
      await connection.commit();
      return { sweepstake, change: "none", accepted: false };
    }
    const current = mapSweepstakeRow(rows[0]);
    // Defense in depth: the bot itself is never an eligible participant.
    const [instanceRows] = await connection.query<Array<{ phone: string | null }>>(
      "SELECT phone FROM bot_instances WHERE id = ? LIMIT 1",
      [current.instanceId],
    );
    const botPhone = String(instanceRows[0]?.phone || "").replace(/\D+/g, "");
    const voterPhone = normalizeJid(vote.participantJid).replace(/\D+/g, "");
    if (botPhone && voterPhone && botPhone === voterPhone) {
      await connection.commit();
      return { sweepstake: current, change: "none", accepted: false };
    }
    const voteTime = (vote.timestamp ?? new Date()).getTime();
    const metadata = { ...(current.metadata ?? {}) };
    const voteTimes = { ...(metadata.pollVoteTimestamps as Record<string, number> ?? {}) };
    const voterKey = participantKey(vote.participantJid);
    // Replayed updates must not resurrect a withdrawn vote or change a
    // completed poll. Keep the timestamp even when the participant leaves.
    if (!Number.isFinite(voteTime) || voteTime > Date.parse(current.expiresAt) ||
        voteTime < Date.parse(current.createdAt) - 1000 ||
        voteTime <= Number(voteTimes[voterKey] ?? 0)) {
      await connection.commit();
      return { sweepstake: current, change: "none", accepted: false };
    }
    const selected = new Set(vote.selectedOptionHashes.map((value) => String(value).trim().toLowerCase()));
    const joinOption = current.options.find((option) => option.hash === current.joinOptionHash);
    const joinAliases = new Set([
      current.joinOptionHash.toLowerCase(),
      joinOption?.name?.trim().toLowerCase() ?? "",
    ]);
    const joinTitleHash = joinOption?.name
      ? createHash("sha256").update(joinOption.name.trim()).digest("hex")
      : "";
    if (joinTitleHash) joinAliases.add(joinTitleHash);
    const wantsParticipate = [...selected].some((value) => joinAliases.has(value));
    const timestampIso = (vote.timestamp ?? new Date()).toISOString();
    const participants = [...current.participants];
    const existingIndex = participants.findIndex((entry) => participantKey(entry.jid) === participantKey(vote.participantJid));

    let change: SweepstakeVoteResult["change"] = "none";
    let limitReached = false;
    let shouldPersist = false;

    if (wantsParticipate) {
      if (existingIndex === -1) {
        const limit = current.maxParticipants;
        if (limit && participants.length >= limit) {
          limitReached = true;
        } else {
          participants.push({
            jid: vote.participantJid,
            hash: current.joinOptionHash,
            displayName: sanitizeParticipantName(vote.displayName),
            joinedAt: timestampIso,
            lastVoteAt: timestampIso,
          });
          change = "added";
          shouldPersist = true;
        }
      } else {
        participants[existingIndex] = serializeParticipant(
          participants[existingIndex],
          current.joinOptionHash,
          vote.displayName,
          timestampIso,
        );
        shouldPersist = true;
      }
    } else if (existingIndex !== -1) {
      participants.splice(existingIndex, 1);
      change = "removed";
      shouldPersist = true;
    }

    voteTimes[voterKey] = voteTime;
    metadata.pollVoteTimestamps = voteTimes;
    await connection.query(
      "UPDATE bot_sweepstakes SET participants = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
      [JSON.stringify(participants), JSON.stringify(metadata), current.id],
    );
    await connection.commit();
    return {
      sweepstake: { ...current, participants, metadata, updatedAt: shouldPersist ? new Date().toISOString() : current.updatedAt },
      change,
      limitReached,
      accepted: true,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const removeSweepstakeParticipant = async (
  sweepstake: BotSweepstake,
  participantJid: string,
): Promise<BotSweepstake> => {
  await ensureTable();
  const participants = sweepstake.participants.filter(
    (entry) => participantKey(entry.jid) !== participantKey(participantJid),
  );
  await getDb().query(
    "UPDATE bot_sweepstakes SET participants = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
    [JSON.stringify(participants), sweepstake.id],
  );
  return { ...sweepstake, participants, updatedAt: new Date().toISOString() };
};

export const pickSweepstakeWinners = (
  participants: BotSweepstakeParticipant[],
  winnersCount: number,
): BotSweepstakeParticipant[] => {
  if (!participants.length || winnersCount <= 0) {
    return [];
  }

  if (participants.length <= winnersCount) {
    return [...participants];
  }

  const pool = [...participants];
  const winners: BotSweepstakeParticipant[] = [];

  while (winners.length < winnersCount && pool.length > 0) {
    const index = randomInt(pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }

  return winners;
};

export const formatSweepstakeWinnerLabel = (
  winner: BotSweepstakeParticipant,
): string => {
  const normalized = /@(s\.whatsapp\.net|c\.us)$/i.test(winner.jid) ? normalizeJid(winner.jid) : null;
  const phoneLabel = normalized ? `@${normalized}` : "Participante";
  if (winner.displayName && winner.displayName.trim()) {
    return `${winner.displayName.trim().replace(/^@+/, "")} (${phoneLabel})`;
  }
  return phoneLabel;
};

export const DEFAULT_SWEEPSTAKE_WINNER_MESSAGE = "🎉 *Parabéns, {pushname}!*\nVocê venceu *{premio}*!\nGanhador: {mencao}\nParticipantes: {participantes}\n\nObrigado a todos que participaram!";

export const renderSweepstakeWinnerMessage = (
  template: string,
  winner: BotSweepstakeParticipant,
  sweepstake: Pick<BotSweepstake, "question" | "participants">,
  winnersCount: number,
): string => {
  const phone = /@lid$/i.test(winner.jid) ? "" : normalizeJid(winner.jid);
  const mention = phone ? `@${phone}` : "Participante";
  const values: Record<string, string> = {
    pushname: winner.displayName?.trim() || phone || "Participante",
    numero: phone, jid: phone, mencao: mention,
    premio: sweepstake.question, participantes: String(sweepstake.participants.length),
    ganhadores: String(winnersCount),
  };
  const body = template.replace(/\{\{?\s*(pushname|numero|jid|mencao|premio|participantes|ganhadores)\s*\}\}?/gi,
    (_, key: string) => values[key.toLowerCase()]).trim();
  // Mention metadata alone does not make an arbitrary @pushname clickable.
  return phone && !body.includes(mention) ? `${body}\n${mention}` : body;
};

export const buildSweepstakeAnnouncement = (
  sweepstake: Pick<BotSweepstake, "question" | "participants" | "maxParticipants" | "winnersCount">,
  winners: BotSweepstakeParticipant[],
): { body: string; mentions: string[] } => {
  const participantsCount = sweepstake.participants.length;
  const maxParticipants = sweepstake.maxParticipants ?? null;

  const lines: string[] = [];
  lines.push("🎉 *SORTEIO ENCERRADO!*");
  lines.push(`• Prêmio: ${sweepstake.question}`);
  lines.push(
    `• Participantes: ${participantsCount}${
      typeof maxParticipants === "number" ? `/${maxParticipants}` : ""
    }`,
  );

  if (winners.length > 0) {
    lines.push(`• Ganhador${winners.length > 1 ? "es" : ""}:`);
    winners.forEach((winner, index) => {
      lines.push(`  ${index + 1}. ${formatSweepstakeWinnerLabel(winner)}`);
    });
  } else {
    lines.push("• Nenhum participante elegível 😕");
  }

  lines.push("", "Obrigado a todos que participaram!");

  const mentions = winners
    .map((winner) => /@(s\.whatsapp\.net|c\.us)$/i.test(winner.jid) ? winner.jid : null)
    .filter((jid): jid is string => typeof jid === "string" && jid.length > 0);

  return {
    body: lines.join("\n"),
    mentions,
  };
};

export const listDueSweepstakes = async (
  limit = 25,
  cleanupOnly = false,
): Promise<BotSweepstakeWithInstance[]> => {
  await ensureTable();
  const db = getDb();
  const [rows] = await db.query<SweepstakeRow[]>(
    `
      SELECT
        s.*,
        bi.user_id,
        bi.base_url,
        bi.token,
        bi.phone,
        bi.session_status,
        bg.id AS group_id
      FROM bot_sweepstakes s
      INNER JOIN bot_instances bi ON s.instance_id = bi.id
      LEFT JOIN bot_groups bg ON bg.instance_id = s.instance_id AND bg.remote_id = s.group_jid
      WHERE ${cleanupOnly
        ? "s.status <> 'active' AND CAST(s.metadata AS TEXT) LIKE '%\"cleanupPending\":true%'"
        : "s.status = 'active'"}
        AND s.expires_at <= ?
      ORDER BY s.expires_at ASC
      LIMIT ?
    `,
    [toSqlDateTime(new Date()), limit],
  );

  return rows.map(mapSweepstakeWithInstanceRow);
};

export const finalizeSweepstake = async (
  sweepstakeId: number,
  payload: FinalizeSweepstakePayload,
): Promise<void> => {
  await ensureTable();
  const db = getDb();
  await db.query(
    `
      UPDATE bot_sweepstakes
      SET status = ?,
          winners = ?,
          metadata = ?,
          concluded_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      payload.status,
      JSON.stringify(payload.winners ?? []),
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      toSqlDateTime(payload.concludedAt),
      sweepstakeId,
    ],
  );
};

export const cancelSweepstake = async (
  sweepstakeId: number,
  metadata?: Record<string, unknown> | null,
): Promise<void> => {
  await finalizeSweepstake(sweepstakeId, {
    status: "cancelled",
    winners: [],
    concludedAt: new Date(),
    metadata: metadata ?? null,
  });
};

export const deleteSweepstake = async (sweepstakeId: number): Promise<void> => {
  await ensureTable();
  const db = getDb();
  await db.query(
    `
      DELETE FROM bot_sweepstakes
      WHERE id = ?
    `,
    [sweepstakeId],
  );
};

export const refreshSweepstake = async (
  sweepstakeId: number,
): Promise<BotSweepstake | null> => getSweepstakeById(sweepstakeId);

export const upsertSweepstakeMetadata = async (
  sweepstakeId: number,
  metadata: Record<string, unknown> | null,
): Promise<void> => {
  await ensureTable();
  const db = getDb();
  await db.query(
    `
      UPDATE bot_sweepstakes
      SET metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [metadata ? JSON.stringify(metadata) : null, sweepstakeId],
  );
};

export const generateSweepstakePollId = (): string =>
  randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase();
