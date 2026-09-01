import { ResultSetHeader, RowDataPacket } from "mysql2";

import { getPublicAppBaseUrl } from "lib/meta";
import {
  UserBotResaleLedgerRow,
  UserPaymentMethodRow,
  ensurePaymentMethodTable,
  ensureUserTable,
  ensureUserBotResaleLedgerTable,
  getDb,
} from "lib/db";
import { BOT_RESALE_LEDGER_SALE_CREDIT } from "lib/bot-resale-wallet";
import { getBotResaleCommissionPercent } from "lib/bot-resale-payments";
import { increaseUserBalance } from "lib/users";

const PROVIDER = "bot_resale_payout";
const AFFILIATE_LINK_PATH = "/sign-up";

type JsonRecord = Record<string, unknown>;

type BotAdminAffiliateReferralRow = {
  id: number;
  referrer_user_id: number;
  referred_user_id: number;
  referral_code: string;
  first_purchase_at: Date | string | null;
  metadata: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type BotAdminAffiliateConfig = {
  enabled: boolean;
  referralCode: string;
  referralLink: string;
  commissionPercent: number;
  updatedAt: string | null;
  autoShare: BotAdminAffiliateAutoShareConfig;
};

export type BotAdminAffiliateAutoShareConfig = {
  enabled: boolean;
  groupIds: number[];
  mode: "interval" | "scheduled";
  intervalHours: number;
  times: string[];
  groupSchedules: BotAdminAffiliateAutoShareGroupSchedule[];
  messageText: string;
  ctaText: string;
  mediaItems: BotAdminAffiliateAutoShareMediaItem[];
  updatedAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};

export type BotAdminAffiliateAutoShareGroupSchedule = {
  groupId: number;
  times: string[];
  offsetMinutes: number;
};

export type BotAdminAffiliateAutoShareMediaItem = {
  id: string;
  path: string;
  url: string;
  mediaType: "image" | "video" | "audio" | "document";
  mimeType: string | null;
  fileName: string | null;
  createdAt: string;
};

export type BotAdminAffiliateHistoryItem = {
  id: number;
  type: "commission" | "withdrawal" | "other";
  amount: number;
  status: string;
  planPaymentId: string | null;
  description: string;
  createdAt: string;
};

export type BotAdminAffiliateAutoShareWorkerEntry = {
  userId: number;
  referralCode: string;
  referralLink: string;
  autoShare: BotAdminAffiliateAutoShareConfig;
};

const parseJsonRecord = (value: string | null | undefined): JsonRecord => {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
  } catch {
    return {};
  }
};

const serializeJsonRecord = (value: JsonRecord): string | null => {
  if (Object.keys(value).length === 0) {
    return null;
  }
  return JSON.stringify(value);
};

const DEFAULT_AUTO_SHARE_MESSAGE =
  "🚀 Quer automatizar seu grupo com boas-vindas, comandos, moderação e vendas pelo WhatsApp?\n\nConheça o BotAdmin e ative seu robô em poucos minutos.";
const DEFAULT_AUTO_SHARE_CTA_TEXT = "Conhecer BotAdmin";
const DEFAULT_AUTO_SHARE_INTERVAL_HOURS = 24;
const DEFAULT_AUTO_SHARE_TIMES = ["09:30"];
const AUTO_SHARE_GROUP_STAGGER_MINUTES = 7;

const normalizeGroupIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = value
    .map((entry) => Math.floor(Number(entry)))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  return Array.from(new Set(ids)).slice(0, 80);
};

const sanitizeBoundedText = (value: unknown, fallback: string, maxLength: number): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, maxLength);
};

const sanitizeIntervalHours = (value: unknown, fallback = DEFAULT_AUTO_SHARE_INTERVAL_HOURS): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(168, Math.floor(parsed)));
};

const normalizeAutoShareMode = (value: unknown, fallback: "interval" | "scheduled" = "interval") => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "scheduled" || normalized === "times" || normalized === "horarios"
    ? "scheduled"
    : normalized === "interval"
      ? "interval"
      : fallback;
};

const normalizeTimeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const sanitizeAutoShareTimes = (value: unknown, fallback: string[] = DEFAULT_AUTO_SHARE_TIMES): string[] => {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s;]+/)
      : [];
  const times = Array.from(
    new Set(source.map((entry) => normalizeTimeString(entry)).filter((entry): entry is string => Boolean(entry))),
  ).slice(0, 8);
  return times.length > 0 ? times : fallback;
};

const shiftTimeByMinutes = (time: string, offsetMinutes: number): string => {
  const normalized = normalizeTimeString(time) ?? DEFAULT_AUTO_SHARE_TIMES[0];
  const [hour, minute] = normalized.split(":").map((entry) => Number.parseInt(entry, 10));
  const total = (((hour * 60 + minute + offsetMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const buildAutoShareGroupSchedules = (
  groupIds: number[],
  times: string[],
): BotAdminAffiliateAutoShareGroupSchedule[] =>
  normalizeGroupIds(groupIds).map((groupId, index) => {
    const offsetMinutes = (index * AUTO_SHARE_GROUP_STAGGER_MINUTES) % 60;
    return {
      groupId,
      offsetMinutes,
      times: times.map((time) => shiftTimeByMinutes(time, offsetMinutes)),
    };
  });

const sanitizeAutoShareGroupSchedules = (
  value: unknown,
  groupIds: number[],
  times: string[],
): BotAdminAffiliateAutoShareGroupSchedule[] => {
  const allowed = new Set(normalizeGroupIds(groupIds));
  const result = new Map<number, BotAdminAffiliateAutoShareGroupSchedule>();

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      const record = entry as JsonRecord;
      const groupId = Math.floor(Number(record.groupId ?? record.group_id));
      if (!Number.isFinite(groupId) || groupId <= 0 || !allowed.has(groupId)) return;
      const entryTimes = sanitizeAutoShareTimes(record.times, []);
      if (entryTimes.length === 0) return;
      const offsetMinutes = Math.max(0, Math.min(240, Math.floor(Number(record.offsetMinutes ?? 0) || 0)));
      result.set(groupId, { groupId, times: entryTimes, offsetMinutes });
    });
  }

  for (const schedule of buildAutoShareGroupSchedules(Array.from(allowed), times)) {
    if (!result.has(schedule.groupId)) {
      result.set(schedule.groupId, schedule);
    }
  }

  return Array.from(result.values());
};

const normalizeAutoShareMediaType = (value: unknown): BotAdminAffiliateAutoShareMediaItem["mediaType"] | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "image" ||
    normalized === "video" ||
    normalized === "audio" ||
    normalized === "document"
    ? normalized
    : null;
};

const sanitizeAutoShareMediaItems = (value: unknown): BotAdminAffiliateAutoShareMediaItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: BotAdminAffiliateAutoShareMediaItem[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as JsonRecord;
    const path = typeof record.path === "string" ? record.path.trim().slice(0, 500) : "";
    const url = typeof record.url === "string" ? record.url.trim().slice(0, 500) : "";
    const mediaType = normalizeAutoShareMediaType(record.mediaType);
    if ((!path && !url) || !mediaType) {
      continue;
    }

    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim().slice(0, 80)
        : `${mediaType}:${path || url}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    items.push({
      id,
      path,
      url,
      mediaType,
      mimeType: typeof record.mimeType === "string" && record.mimeType.trim()
        ? record.mimeType.trim().slice(0, 120)
        : null,
      fileName: typeof record.fileName === "string" && record.fileName.trim()
        ? record.fileName.trim().slice(0, 180)
        : null,
      createdAt: typeof record.createdAt === "string" && record.createdAt.trim()
        ? record.createdAt.trim().slice(0, 80)
        : new Date().toISOString(),
    });
    if (items.length >= 20) {
      break;
    }
  }

  return items;
};

const getAutoShareFromAffiliate = (affiliate: JsonRecord): BotAdminAffiliateAutoShareConfig => {
  const raw = affiliate.autoShare;
  const autoShare = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as JsonRecord)
    : {};

  return {
    enabled: autoShare.enabled === true,
    groupIds: normalizeGroupIds(autoShare.groupIds),
    mode: normalizeAutoShareMode(autoShare.mode),
    intervalHours: sanitizeIntervalHours(autoShare.intervalHours),
    times: sanitizeAutoShareTimes(autoShare.times),
    groupSchedules: sanitizeAutoShareGroupSchedules(
      autoShare.groupSchedules,
      normalizeGroupIds(autoShare.groupIds),
      sanitizeAutoShareTimes(autoShare.times),
    ),
    messageText: sanitizeBoundedText(autoShare.messageText, DEFAULT_AUTO_SHARE_MESSAGE, 1200),
    ctaText: sanitizeBoundedText(autoShare.ctaText, DEFAULT_AUTO_SHARE_CTA_TEXT, 40),
    mediaItems: sanitizeAutoShareMediaItems(autoShare.mediaItems),
    updatedAt: typeof autoShare.updatedAt === "string" ? autoShare.updatedAt : null,
    lastRunAt: typeof autoShare.lastRunAt === "string" ? autoShare.lastRunAt : null,
    lastError: typeof autoShare.lastError === "string" ? autoShare.lastError : null,
  };
};

const sanitizeReferralCode = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return normalized.length >= 4 ? normalized : null;
};

export const buildBotAdminAffiliateReferralCode = (userId: number): string => {
  const base = Math.max(1, Math.trunc(userId)).toString(36);
  const checksum = ((Math.max(1, Math.trunc(userId)) * 9973) % 46656)
    .toString(36)
    .padStart(3, "0");
  return `ba-${base}-${checksum}`;
};

export const resolveBotAdminAffiliateUserIdFromCode = async (
  referralCode: unknown,
): Promise<number | null> => {
  const sanitized = sanitizeReferralCode(referralCode);
  if (!sanitized) {
    return null;
  }
  const match = sanitized.match(/^ba-([a-z0-9]+)-([a-z0-9]{3})$/);
  if (!match) {
    return null;
  }
  const userId = Number.parseInt(match[1], 36);
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }
  if (buildBotAdminAffiliateReferralCode(userId) !== sanitized) {
    return null;
  }

  await ensureUserTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE id = ? AND role = 'user' AND is_active = 1 LIMIT 1",
    [userId],
  );

  return Array.isArray(rows) && rows.length > 0 ? userId : null;
};

export const buildBotAdminAffiliateReferralLink = (referralCode: string): string => {
  const url = new URL(AFFILIATE_LINK_PATH, getPublicAppBaseUrl());
  url.searchParams.set("ref", referralCode);
  url.searchParams.set("utm_source", "botadmin_afiliados");
  return url.toString();
};

const getAffiliateFromMetadata = (
  userId: number,
  metadata: JsonRecord,
): BotAdminAffiliateConfig => {
  const raw = metadata.botAdminAffiliate;
  const affiliate = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as JsonRecord)
    : {};
  const referralCode =
    sanitizeReferralCode(affiliate.referralCode) ?? buildBotAdminAffiliateReferralCode(userId);

  return {
    enabled: affiliate.enabled === true,
    referralCode,
    referralLink: buildBotAdminAffiliateReferralLink(referralCode),
    commissionPercent: getBotResaleCommissionPercent(),
    updatedAt: typeof affiliate.updatedAt === "string" ? affiliate.updatedAt : null,
    autoShare: getAutoShareFromAffiliate(affiliate),
  };
};

export const getBotAdminAffiliateConfig = async (
  userId: number,
): Promise<BotAdminAffiliateConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<UserPaymentMethodRow[]>(
    "SELECT metadata FROM user_payment_methods WHERE user_id = ? AND provider = ? LIMIT 1",
    [userId, PROVIDER],
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return getAffiliateFromMetadata(userId, parseJsonRecord(row?.metadata));
};

export const updateBotAdminAffiliateEnabled = async (
  userId: number,
  enabled: boolean,
): Promise<BotAdminAffiliateConfig> => {
  return updateBotAdminAffiliateConfig(userId, { enabled });
};

export const updateBotAdminAffiliateConfig = async (
  userId: number,
  patch: {
    enabled?: boolean;
    autoShare?: Partial<Pick<BotAdminAffiliateAutoShareConfig, "enabled" | "groupIds" | "mode" | "intervalHours" | "times" | "groupSchedules" | "messageText" | "ctaText" | "mediaItems">>;
  },
): Promise<BotAdminAffiliateConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();

  const [rows] = await db.query<UserPaymentMethodRow[]>(
    "SELECT * FROM user_payment_methods WHERE user_id = ? AND provider = ? LIMIT 1",
    [userId, PROVIDER],
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const credentials = parseJsonRecord(row?.credentials);
  const settings = parseJsonRecord(row?.settings);
  const metadata = parseJsonRecord(row?.metadata);
  const current = getAffiliateFromMetadata(userId, metadata);
  const now = new Date().toISOString();
  const currentRaw = metadata.botAdminAffiliate;
  const currentAffiliate = currentRaw && typeof currentRaw === "object" && !Array.isArray(currentRaw)
    ? (currentRaw as JsonRecord)
    : {};
  const previousAutoShare = current.autoShare;
  const autoSharePatch = patch.autoShare ?? null;
  const patchedGroupIds = autoSharePatch?.groupIds !== undefined
    ? normalizeGroupIds(autoSharePatch.groupIds)
    : previousAutoShare.groupIds;
  const patchedMode = autoSharePatch?.mode !== undefined
    ? normalizeAutoShareMode(autoSharePatch.mode, previousAutoShare.mode)
    : previousAutoShare.mode;
  const patchedTimes = autoSharePatch?.times !== undefined
    ? sanitizeAutoShareTimes(autoSharePatch.times)
    : previousAutoShare.times;
  const nextAutoShare = autoSharePatch
    ? {
        enabled:
          typeof autoSharePatch.enabled === "boolean"
            ? autoSharePatch.enabled
            : previousAutoShare.enabled,
        groupIds:
          patchedGroupIds,
        mode: patchedMode,
        intervalHours:
          autoSharePatch.intervalHours !== undefined
            ? sanitizeIntervalHours(autoSharePatch.intervalHours, previousAutoShare.intervalHours)
            : previousAutoShare.intervalHours,
        times: patchedTimes,
        groupSchedules:
          autoSharePatch.groupSchedules !== undefined
            ? sanitizeAutoShareGroupSchedules(autoSharePatch.groupSchedules, patchedGroupIds, patchedTimes)
            : buildAutoShareGroupSchedules(patchedGroupIds, patchedTimes),
        messageText:
          autoSharePatch.messageText !== undefined
            ? sanitizeBoundedText(autoSharePatch.messageText, DEFAULT_AUTO_SHARE_MESSAGE, 1200)
            : previousAutoShare.messageText,
        ctaText:
          autoSharePatch.ctaText !== undefined
            ? sanitizeBoundedText(autoSharePatch.ctaText, DEFAULT_AUTO_SHARE_CTA_TEXT, 40)
            : previousAutoShare.ctaText,
        mediaItems:
          autoSharePatch.mediaItems !== undefined
            ? sanitizeAutoShareMediaItems(autoSharePatch.mediaItems)
            : previousAutoShare.mediaItems,
        updatedAt: now,
        lastRunAt: previousAutoShare.lastRunAt,
        lastError: previousAutoShare.lastError,
      }
    : previousAutoShare;

  metadata.botAdminAffiliate = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    referralCode: current.referralCode,
    createdAt:
      typeof currentAffiliate.createdAt === "string"
        ? currentAffiliate.createdAt
        : now,
    updatedAt: now,
    autoShare: nextAutoShare,
  };

  if (!settings.mode) {
    settings.mode = "automatic";
  }

  await db.query(
    `
      INSERT INTO user_payment_methods (
        user_id,
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES (?, ?, ?, 'Bot Admin afiliados', ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        credentials = VALUES(credentials),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [
      userId,
      PROVIDER,
      row?.is_active === 1 ? 1 : 0,
      serializeJsonRecord(credentials),
      serializeJsonRecord(settings),
      serializeJsonRecord(metadata),
    ],
  );

  return getBotAdminAffiliateConfig(userId);
};

const parseDateMs = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const buildScheduledDate = (time: string, base: Date): Date | null => {
  const normalized = normalizeTimeString(time);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map((entry) => Number.parseInt(entry, 10));
  const date = new Date(base);
  date.setHours(hour, minute, 0, 0);
  return date;
};

export const resolveDueBotAdminAffiliateAutoShareGroupIds = (
  autoShare: BotAdminAffiliateAutoShareConfig,
  now = new Date(),
): number[] => {
  if (!autoShare.enabled || autoShare.groupIds.length === 0) {
    return [];
  }

  const lastRunAtMs = parseDateMs(autoShare.lastRunAt);
  if (autoShare.mode !== "scheduled") {
    if (lastRunAtMs === null) {
      return autoShare.groupIds;
    }
    const intervalMs = Math.max(1, autoShare.intervalHours) * 60 * 60 * 1000;
    return now.getTime() - lastRunAtMs >= intervalMs ? autoShare.groupIds : [];
  }

  const schedules =
    autoShare.groupSchedules.length > 0
      ? autoShare.groupSchedules
      : buildAutoShareGroupSchedules(autoShare.groupIds, autoShare.times);
  const nowMs = now.getTime();
  const firstRunWindowMs = 15 * 60 * 1000;
  const dueGroupIds = new Set<number>();

  for (const schedule of schedules) {
    if (!autoShare.groupIds.includes(schedule.groupId)) {
      continue;
    }
    for (const time of schedule.times) {
      const today = buildScheduledDate(time, now);
      if (!today) continue;
      const candidates = [today, new Date(today.getTime() - 24 * 60 * 60 * 1000)];
      if (
        candidates.some((candidate) => {
          const scheduledMs = candidate.getTime();
          if (scheduledMs > nowMs) return false;
          if (lastRunAtMs === null) {
            return nowMs - scheduledMs <= firstRunWindowMs;
          }
          return scheduledMs > lastRunAtMs;
        })
      ) {
        dueGroupIds.add(schedule.groupId);
        break;
      }
    }
  }

  return Array.from(dueGroupIds);
};

const shouldRunAutoShare = (autoShare: BotAdminAffiliateAutoShareConfig): boolean => {
  if (!autoShare.enabled || autoShare.groupIds.length === 0) {
    return false;
  }
  if (autoShare.mode === "scheduled") {
    return resolveDueBotAdminAffiliateAutoShareGroupIds(autoShare).length > 0;
  }
  const lastRunAtMs = parseDateMs(autoShare.lastRunAt);
  if (lastRunAtMs === null) {
    return true;
  }
  const intervalMs = Math.max(1, autoShare.intervalHours) * 60 * 60 * 1000;
  return Date.now() - lastRunAtMs >= intervalMs;
};

export const listEnabledBotAdminAffiliateAutoSharesForRun = async (
  limit = 50,
): Promise<BotAdminAffiliateAutoShareWorkerEntry[]> => {
  await ensurePaymentMethodTable();
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const [rows] = await db.query<(Pick<UserPaymentMethodRow, "user_id" | "metadata"> & RowDataPacket)[]>(
    `
      SELECT user_id, metadata
      FROM user_payment_methods
      WHERE provider = ?
        AND metadata IS NOT NULL
      ORDER BY updated_at ASC
      LIMIT ?
    `,
    [PROVIDER, safeLimit * 4],
  );

  const entries: BotAdminAffiliateAutoShareWorkerEntry[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const userId = Number(row.user_id);
    if (!Number.isFinite(userId) || userId <= 0) {
      continue;
    }
    const affiliate = getAffiliateFromMetadata(userId, parseJsonRecord(row.metadata));
    if (!affiliate.enabled || !shouldRunAutoShare(affiliate.autoShare)) {
      continue;
    }
    entries.push({
      userId,
      referralCode: affiliate.referralCode,
      referralLink: affiliate.referralLink,
      autoShare: affiliate.autoShare,
    });
    if (entries.length >= safeLimit) {
      break;
    }
  }

  return entries;
};

export const markBotAdminAffiliateAutoShareRun = async ({
  userId,
  error,
}: {
  userId: number;
  error?: unknown;
}): Promise<void> => {
  await ensurePaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<UserPaymentMethodRow[]>(
    "SELECT * FROM user_payment_methods WHERE user_id = ? AND provider = ? LIMIT 1",
    [userId, PROVIDER],
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) {
    return;
  }

  const metadata = parseJsonRecord(row.metadata);
  const current = getAffiliateFromMetadata(userId, metadata);
  const currentRaw = metadata.botAdminAffiliate;
  const currentAffiliate = currentRaw && typeof currentRaw === "object" && !Array.isArray(currentRaw)
    ? (currentRaw as JsonRecord)
    : {};
  const now = new Date().toISOString();
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : null;

  metadata.botAdminAffiliate = {
    ...currentAffiliate,
    enabled: current.enabled,
    referralCode: current.referralCode,
    updatedAt: now,
    autoShare: {
      ...current.autoShare,
      lastRunAt: now,
      lastError: errorMessage ? errorMessage.slice(0, 500) : null,
    },
  };

  await db.query(
    `
      UPDATE user_payment_methods
      SET metadata = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND provider = ?
    `,
    [serializeJsonRecord(metadata), userId, PROVIDER],
  );
};

const ensureBotAdminAffiliateReferralTable = async () => {
  await ensureUserTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_admin_affiliate_referrals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      referrer_user_id INT NOT NULL,
      referred_user_id INT NOT NULL,
      referral_code VARCHAR(64) NOT NULL,
      first_purchase_at TIMESTAMP NULL DEFAULT NULL,
      metadata LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_bot_admin_affiliate_referred (referred_user_id),
      KEY idx_bot_admin_affiliate_referrer (referrer_user_id, created_at),
      CONSTRAINT fk_bot_admin_affiliate_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bot_admin_affiliate_referred FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
};

export const recordBotAdminAffiliateReferral = async ({
  referrerUserId,
  referredUserId,
  referralCode,
  metadata,
}: {
  referrerUserId: number | null;
  referredUserId: number;
  referralCode: string | null;
  metadata?: JsonRecord | null;
}): Promise<boolean> => {
  if (!referrerUserId || referrerUserId <= 0 || referrerUserId === referredUserId) {
    return false;
  }
  const sanitizedCode = sanitizeReferralCode(referralCode);
  if (!sanitizedCode) {
    return false;
  }

  await ensureBotAdminAffiliateReferralTable();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_admin_affiliate_referrals (
        referrer_user_id,
        referred_user_id,
        referral_code,
        metadata
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        referrer_user_id = referrer_user_id,
        updated_at = updated_at
    `,
    [
      referrerUserId,
      referredUserId,
      sanitizedCode,
      serializeJsonRecord({
        ...(metadata ?? {}),
        source: "bot_admin_affiliate_link",
        recordedAt: new Date().toISOString(),
      }),
    ],
  );

  return result.affectedRows > 0;
};

const getBotAdminAffiliateReferralForBuyer = async (
  buyerUserId: number,
): Promise<BotAdminAffiliateReferralRow | null> => {
  await ensureBotAdminAffiliateReferralTable();
  const db = getDb();
  const [rows] = await db.query<(BotAdminAffiliateReferralRow & RowDataPacket)[]>(
    "SELECT * FROM bot_admin_affiliate_referrals WHERE referred_user_id = ? LIMIT 1",
    [buyerUserId],
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const computeAffiliateCommissionAmount = (amount: number, commissionPercent: number): number => {
  const total = Number(amount);
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  const commission = total * (commissionPercent / 100);
  return Math.max(0, Math.round(commission * 100) / 100);
};

export const creditBotAdminAffiliateCommissionForPayment = async ({
  buyerUserId,
  planPaymentId,
  amount,
  metadata,
}: {
  buyerUserId: number;
  planPaymentId: string;
  amount: number;
  metadata?: JsonRecord | null;
}): Promise<{ credited: boolean; referrerUserId: number | null; amount: number }> => {
  const referral = await getBotAdminAffiliateReferralForBuyer(buyerUserId);
  if (!referral) {
    return { credited: false, referrerUserId: null, amount: 0 };
  }

  const affiliate = await getBotAdminAffiliateConfig(referral.referrer_user_id);
  if (!affiliate.enabled) {
    return { credited: false, referrerUserId: referral.referrer_user_id, amount: 0 };
  }

  const commissionAmount = computeAffiliateCommissionAmount(amount, affiliate.commissionPercent);
  if (commissionAmount <= 0) {
    return { credited: false, referrerUserId: referral.referrer_user_id, amount: 0 };
  }

  await ensureUserBotResaleLedgerTable();
  const db = getDb();
  const affiliatePlanPaymentId = `botadmin-affiliate:${planPaymentId.trim()}`;

  try {
    await db.query<ResultSetHeader>(
      `
        INSERT INTO user_bot_resale_ledger (
          user_id,
          entry_type,
          amount,
          plan_payment_id,
          status,
          metadata
        ) VALUES (?, ?, ?, ?, 'completed', ?)
      `,
      [
        referral.referrer_user_id,
        BOT_RESALE_LEDGER_SALE_CREDIT,
        commissionAmount,
        affiliatePlanPaymentId,
        serializeJsonRecord({
          ...(metadata ?? {}),
          source: "bot_admin_affiliates",
          buyerUserId,
          originalPlanPaymentId: planPaymentId,
          totalAmount: amount,
          commissionPercent: affiliate.commissionPercent,
          referralCode: referral.referral_code,
          creditedAt: new Date().toISOString(),
        }),
      ],
    );
  } catch (error) {
    const duplicate = error instanceof Error && /duplicate|unique/i.test(error.message);
    if (duplicate) {
      return { credited: false, referrerUserId: referral.referrer_user_id, amount: commissionAmount };
    }
    throw error;
  }

  await increaseUserBalance(referral.referrer_user_id, commissionAmount);
  await db.query(
    `
      UPDATE bot_admin_affiliate_referrals
      SET first_purchase_at = COALESCE(first_purchase_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [referral.id],
  );

  return { credited: true, referrerUserId: referral.referrer_user_id, amount: commissionAmount };
};

const parseAmount = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const mapLedgerItem = (row: UserBotResaleLedgerRow): BotAdminAffiliateHistoryItem => {
  const amount = parseAmount(row.amount);
  const metadata = parseJsonRecord(row.metadata);
  const source = typeof metadata.source === "string" ? metadata.source : null;
  const type =
    row.entry_type === BOT_RESALE_LEDGER_SALE_CREDIT
      ? "commission"
      : row.entry_type === "withdrawal"
        ? "withdrawal"
        : "other";

  return {
    id: row.id,
    type,
    amount,
    status: row.status,
    planPaymentId: row.plan_payment_id,
    description:
      type === "commission"
        ? "Comissão por venda do BotAdmin"
        : type === "withdrawal"
          ? "Saque da carteira"
          : source ?? row.entry_type,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
};

export const listBotAdminAffiliateHistory = async (
  userId: number,
  limit = 20,
): Promise<BotAdminAffiliateHistoryItem[]> => {
  await ensureUserBotResaleLedgerTable();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const db = getDb();
  const [rows] = await db.query<(UserBotResaleLedgerRow & RowDataPacket)[]>(
    `
      SELECT id, user_id, entry_type, amount, plan_payment_id, status, metadata, created_at
      FROM user_bot_resale_ledger
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [userId, safeLimit],
  );

  return Array.isArray(rows) ? rows.map(mapLedgerItem) : [];
};
