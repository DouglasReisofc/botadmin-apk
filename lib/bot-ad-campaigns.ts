import { randomUUID } from "crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2";

import {
  BotAdCampaignRow,
  BotAdCampaignRunRow,
  BotAdCampaignStatusPostRow,
  BotAdCampaignTargetRow,
  ensureBotAdCampaignRunTable,
  ensureBotAdCampaignStatusPostTable,
  ensureBotAdCampaignTable,
  ensureBotAdCampaignTargetTable,
  getDb,
} from "lib/db";
import { getInstanceForUser } from "lib/bot-instances";
import {
  addDaysInTimezone,
  convertTimezoneLocalToUtc,
  describeDateInTimezone,
  normalizeTimezoneInput,
  resolveTimezonePreference,
} from "lib/timezones";
import { getGroupInviteInfo, type WuzapiClient } from "lib/wuzapi";
import type {
  BotAdCampaign,
  BotAdCampaignContent,
  BotAdCampaignInput,
  BotAdCampaignOptions,
  BotAdCampaignScheduleConfig,
  BotAdCampaignStatusConfig,
  BotAdCampaignStatusRandomizer,
  BotAdCampaignScheduleRandomizer,
  BotAdCampaignGroupRandomizer,
  BotAdCampaignGroupDispatchOptions,
  BotAdCampaignStatusCommand,
  BotAdCampaignTarget,
  BotAdCampaignTargetAudience,
  BotAdCampaignTargetInput,
  CampaignNextTargetHint,
  CampaignTargetValidationIssue,
} from "types/bot-ad-campaigns";
import type { DivulgacaoInspectionResult } from "types/divulgacao";

type GenericObject = Record<string, unknown>;

type ReplaceTargetsResult = {
  targets: BotAdCampaignTarget[];
  inviteIssues: CampaignTargetValidationIssue[];
};

// Conteúdos de status são referências leves (links/configuração), portanto não
// impomos um limite de produto. Este teto técnico apenas protege a API de um
// payload malformado gigantesco e não é exposto na interface.
const MAX_CONTENT_ITEMS = 10_000;
const MAX_TARGETS_PER_CAMPAIGN = 200;
const MAX_MENTIONS_PER_TARGET = 256;
const DEFAULT_RECURRING_MINUTES = 24 * 60;
const MAX_LOOKAHEAD_DAYS = 31;
const INVITE_INSPECTION_DELAY_MS = (() => {
  const raw = Number(process.env.BOT_AD_CAMPAIGN_INSPECTION_DELAY_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(200, Math.floor(raw));
  }
  return 1200;
})();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ALLOWED_CAMPAIGN_STATUSES: BotAdCampaignRow["status"][] = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "cancelled",
];

const sanitizeCampaignStatus = (
  value: unknown,
  fallback: BotAdCampaignRow["status"] = "draft",
): BotAdCampaignRow["status"] => {
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as BotAdCampaignRow["status"];
    if (ALLOWED_CAMPAIGN_STATUSES.includes(normalized)) {
      return normalized;
    }
  }
  return fallback;
};

const parseJsonField = <T>(value: string | null): T | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? null;
  } catch {
    return null;
  }
};

const stringifyJson = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const MYSQL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const parseDateValue = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = MYSQL_DATETIME_PATTERN.test(trimmed)
      ? `${trimmed.replace(" ", "T")}Z`
      : trimmed;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
};

const formatDateTimeForDb = (value: Date | null): string | null => {
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }
  const iso = value.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
};

export const setCampaignNextRunState = async (
  campaignId: number,
  nextRunAt: Date | null,
  nextTargetHint: CampaignNextTargetHint | null,
): Promise<void> => {
  const db = getDb();
  await db.query(
    `
      UPDATE bot_ad_campaigns
      SET next_run_at = ?, next_target_hint_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [formatDateTimeForDb(nextRunAt), nextTargetHint ? JSON.stringify(nextTargetHint) : null, campaignId],
  );
};

const sanitizeName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new Error("Informe o nome da campanha.");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Informe o nome da campanha.");
  }
  if (trimmed.length > 191) {
    return trimmed.slice(0, 191);
  }
  return trimmed;
};

const sanitizeDescription = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 2000);
};

const toMinutes = (hour: number, minute: number) => hour * 60 + minute;

const sanitizeTimeToken = (value: unknown): { hour: number; minute: number } | null => {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^([0-2]?\d):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23) {
    return null;
  }
  if (minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
};

const sanitizeTimes = (values: unknown): { hour: number; minute: number }[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const sanitized: { hour: number; minute: number }[] = [];
  for (const value of values) {
    const parsed = sanitizeTimeToken(value);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.hour}-${parsed.minute}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sanitized.push(parsed);
    if (sanitized.length >= 24) {
      break;
    }
  }
  return sanitized.sort((a, b) => toMinutes(a.hour, a.minute) - toMinutes(b.hour, b.minute));
};

const sanitizeDaysOfWeek = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = new Set<number>();
  for (const entry of value) {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const normalizedValue = ((Math.floor(parsed) % 7) + 7) % 7;
    normalized.add(normalizedValue);
    if (normalized.size >= 7) {
      break;
    }
  }
  return Array.from(normalized.values()).sort((a, b) => a - b);
};

const sanitizeStatusConfig = (value: unknown): BotAdCampaignStatusConfig | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as GenericObject;
  const deleteAfterMinutes = Number.isFinite(record.deleteAfterMinutes)
    ? Math.max(1, Math.floor(Number(record.deleteAfterMinutes)))
    : null;
  const deleteAt = parseDateValue(record.deleteAt);
  const visibility =
    typeof record.visibility === "string" && record.visibility
      ? (record.visibility.toLowerCase() as BotAdCampaignStatusConfig["visibility"])
      : null;

  const sanitizeStringList = (list: unknown): string[] => {
    if (!Array.isArray(list)) {
      return [];
    }
    const out: string[] = [];
    for (const entry of list) {
      if (typeof entry === "string" && entry.trim()) {
        out.push(entry.trim());
      }
      if (out.length >= 256) {
        break;
      }
    }
    return out;
  };

  const whitelist = sanitizeStringList(record.whitelist);
  const blacklist = sanitizeStringList(record.blacklist);
  const mentions = sanitizeStringList(record.mentions ?? record.Mentions ?? record.mentionList);
  const allowReshare =
    typeof record.allowReshare === "boolean"
      ? record.allowReshare
      : typeof record.allow_reshare === "boolean"
        ? record.allow_reshare
        : null;
  const scheduleSlot = Number.isFinite(record.scheduleSlot)
    ? Math.max(0, Math.min(95, Math.floor(Number(record.scheduleSlot))))
    : null;
  const visualRecord =
    record.visualEditor && typeof record.visualEditor === "object"
      ? (record.visualEditor as GenericObject)
      : null;
  const sanitizeAlignment = (input: unknown): { x: number; y: number } | null => {
    if (!input || typeof input !== "object") return null;
    const alignment = input as GenericObject;
    const x = Number(alignment.x);
    const y = Number(alignment.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x: Math.max(-1.45, Math.min(1.45, x)),
      y: Math.max(-1.45, Math.min(1.45, y)),
    };
  };
  const sanitizeColor = (input: unknown, fallback: string): string => {
    const color = typeof input === "string" ? input.trim().toUpperCase() : "";
    return /^#[0-9A-F]{6}$/.test(color) ? color : fallback;
  };
  const mediaLayers = Array.isArray(visualRecord?.mediaLayers)
    ? visualRecord.mediaLayers
        .slice(0, 12)
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const layer = entry as GenericObject;
          const type = layer.type === "video" ? "video" : "image";
          const sourceUrl =
            typeof layer.sourceUrl === "string" ? layer.sourceUrl.trim().slice(0, 2048) : "";
          const sourcePath =
            typeof layer.sourcePath === "string" ? layer.sourcePath.trim().slice(0, 1024) : "";
          if (!sourceUrl && !sourcePath) return null;
          return {
            type,
            fileName:
              typeof layer.fileName === "string" ? layer.fileName.trim().slice(0, 255) : "",
            mimeType:
              typeof layer.mimeType === "string" ? layer.mimeType.trim().slice(0, 120) : "",
            sourceUrl: sourceUrl || null,
            sourcePath: sourcePath || null,
            alignment: sanitizeAlignment(layer.alignment) ?? { x: 0, y: 0 },
            scale: Math.max(0.2, Math.min(4, Number(layer.scale) || 1)),
            rotation: Math.max(
              -Math.PI * 100,
              Math.min(Math.PI * 100, Number(layer.rotation) || 0),
            ),
          };
        })
        .filter((entry) => entry !== null)
    : [];
  const visualEditor = visualRecord
    ? {
        version: 1,
        text: typeof visualRecord.text === "string" ? visualRecord.text.slice(0, 700) : "",
        backgroundColor: sanitizeColor(visualRecord.backgroundColor, "#075E54"),
        textColor: sanitizeColor(visualRecord.textColor, "#FFFFFF"),
        textAlignment: sanitizeAlignment(visualRecord.textAlignment) ?? { x: 0, y: 0 },
        mediaAlignment: sanitizeAlignment(visualRecord.mediaAlignment) ?? { x: 0, y: 0 },
        textAlign: ["left", "center", "right"].includes(String(visualRecord.textAlign))
          ? String(visualRecord.textAlign)
          : "center",
        fontSize: Math.max(12, Math.min(110, Number(visualRecord.fontSize) || 32)),
        mediaScale: Math.max(0.25, Math.min(4, Number(visualRecord.mediaScale) || 1)),
        textRotation: Math.max(
          -Math.PI * 100,
          Math.min(Math.PI * 100, Number(visualRecord.textRotation) || 0),
        ),
        mediaRotation: Math.max(
          -Math.PI * 100,
          Math.min(Math.PI * 100, Number(visualRecord.mediaRotation) || 0),
        ),
        bold: visualRecord.bold !== false,
        italic: visualRecord.italic === true,
        underline: visualRecord.underline === true,
        sourceMedia: visualRecord.sourceMedia === true,
        mediaLayers,
      }
    : null;
  const sourceUrl =
    typeof record.sourceUrl === "string" && /^https?:\/\//i.test(record.sourceUrl.trim())
      ? record.sourceUrl.trim().slice(0, 2048)
      : null;
  const previewUrl =
    typeof record.previewUrl === "string" && /^https?:\/\//i.test(record.previewUrl.trim())
      ? record.previewUrl.trim().slice(0, 2048)
      : null;
  const instagramProfileRecord =
    record.instagramProfile && typeof record.instagramProfile === "object"
      ? (record.instagramProfile as GenericObject)
      : null;
  const instagramUsername =
    typeof instagramProfileRecord?.username === "string"
      ? instagramProfileRecord.username.replace(/^@+/, "").trim().toLowerCase()
      : "";
  const instagramProfile = /^[a-z0-9._]{1,30}$/.test(instagramUsername)
    ? {
        username: instagramUsername,
        automatic: instagramProfileRecord?.automatic !== false,
        analyzeWithGemini: instagramProfileRecord?.analyzeWithGemini !== false,
      }
    : null;

  return {
    deleteAfterMinutes,
    deleteAt: deleteAt ? deleteAt.toISOString() : null,
    visibility,
    whitelist: whitelist.length > 0 ? whitelist : null,
    blacklist: blacklist.length > 0 ? blacklist : null,
    mentions: mentions.length > 0 ? mentions : null,
    allowReshare,
    scheduleSlot,
    visualEditor,
    sourceUrl,
    previewUrl,
    instagramProfile,
  };
};

const parsePerRunCount = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(10_000, Math.floor(value)));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(10_000, Math.floor(parsed)));
    }
  }
  return null;
};

const parseBoundedNumber = (
  value: unknown,
  min: number,
  max: number,
): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, Math.floor(parsed)));
    }
  }
  return null;
};

const sanitizeStatusRandomizer = (
  value: unknown,
): BotAdCampaignStatusRandomizer | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as GenericObject;
  const enabled = Boolean(record.enabled);
  const perRunCountInput =
    record.perRunCount ?? record.maxPerRun ?? record.count ?? record.quantity;
  const perDayCountInput =
    record.perDayCount ?? record.dailyCount ?? record.quantityPerDay;
  const dailyLimitInput =
    record.dailyLimit ?? record.maxPerDay ?? record.perDayCount ?? record.dailyCount ?? record.quantityPerDay;
  let perRunCount = parsePerRunCount(perRunCountInput);
  let perDayCount = parsePerRunCount(perDayCountInput);
  let dailyLimit = parsePerRunCount(dailyLimitInput);
  if (enabled && perRunCount === null) {
    perRunCount = 1;
  }
  if (enabled && perDayCount !== null) {
    perDayCount = Math.max(1, perDayCount);
  }
  if (dailyLimit !== null) {
    dailyLimit = Math.max(1, dailyLimit);
  }
  if (!enabled && perRunCount === null && perDayCount === null && dailyLimit === null) {
    return null;
  }
  return {
    enabled,
    perRunCount,
    perDayCount,
    dailyLimit,
    ensurePreferredDaily: record.ensurePreferredDaily !== false,
  };
};

const sanitizeGroupRandomizer = (
  value: unknown,
): BotAdCampaignGroupRandomizer | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as GenericObject;
  const enabled = Boolean(record.enabled);
  const countInput =
    record.perRunCount ?? record.maxPerRun ?? record.count ?? record.quantity;
  let perRunCount = parsePerRunCount(countInput);
  if (perRunCount !== null) {
    perRunCount = Math.max(1, Math.min(5, perRunCount));
  }
  if (enabled && perRunCount === null) {
    perRunCount = 2;
  }
  if (!enabled && perRunCount === null) {
    return null;
  }
  return {
    enabled,
    perRunCount,
  };
};

const sanitizeScheduleRandomizer = (
  value: unknown,
): BotAdCampaignScheduleRandomizer | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as GenericObject;
  const enabled = Boolean(record.enabled);
  const reshuffleDaily = Boolean(
    record.reshuffleDaily ?? record.redistributeTimes ?? record.randomizeTimes,
  );
  let jitterMinutes = parseBoundedNumber(
    record.jitterMinutes ?? record.maxJitterMinutes ?? record.jitter ?? record.windowMinutes,
    1,
    720,
  );
  const windowStartHour = parseBoundedNumber(
    record.windowStartHour ?? record.startHour,
    0,
    23,
  );
  let windowEndHour = parseBoundedNumber(
    record.windowEndHour ?? record.endHour,
    0,
    23,
  );

  if (windowStartHour !== null && windowEndHour !== null && windowEndHour <= windowStartHour) {
    windowEndHour = Math.min(23, windowStartHour + 1);
  }

  if (enabled && !reshuffleDaily && jitterMinutes === null) {
    jitterMinutes = 30;
  }

  if (
    !enabled &&
    !reshuffleDaily &&
    jitterMinutes === null &&
    windowStartHour === null &&
    windowEndHour === null
  ) {
    return null;
  }

  return {
    enabled,
    jitterMinutes,
    reshuffleDaily,
    windowStartHour,
    windowEndHour,
  };
};

const sanitizeGroupDispatchOptions = (
  value: unknown,
): BotAdCampaignGroupDispatchOptions | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as GenericObject;
  const targetMode = record.targetMode === "all_open" ? "all_open" : "selected";
  let targetDelayMinMinutes = parseBoundedNumber(
    record.targetDelayMinMinutes ?? record.delayMinMinutes,
    1,
    1440,
  );
  let targetDelayMaxMinutes = parseBoundedNumber(
    record.targetDelayMaxMinutes ?? record.delayMaxMinutes,
    1,
    1440,
  );
  targetDelayMinMinutes ??= 5;
  targetDelayMaxMinutes ??= Math.max(10, targetDelayMinMinutes);
  if (targetDelayMaxMinutes < targetDelayMinMinutes) {
    targetDelayMaxMinutes = targetDelayMinMinutes;
  }
  return {
    targetMode,
    targetDelayMinMinutes,
    targetDelayMaxMinutes,
    prioritizeNeverSent: record.prioritizeNeverSent !== false,
  };
};

const sanitizeStatusCommand = (
  value: unknown,
): BotAdCampaignStatusCommand | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as GenericObject;
  const command = typeof record.command === "string"
    ? record.command.trim().replace(/^[!/#$%&.~]+/, "").toLowerCase()
    : "";
  if (!command) return null;
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(command)) {
    throw new Error("O comando deve ter de 3 a 32 caracteres, usando letras, números, _ ou -.");
  }
  const provider = record.captionProvider === "auto" || record.captionProvider === "chatgpt"
    ? record.captionProvider
    : "gemini";
  return {
    enabled: record.enabled !== false,
    command,
    captionProvider: provider,
  };
};

const sanitizeCampaignOptions = (
  value: BotAdCampaignOptions | null | undefined,
): BotAdCampaignOptions => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const normalized: BotAdCampaignOptions = {};
  const randomizer = sanitizeStatusRandomizer((value as BotAdCampaignOptions)?.statusRandomizer);
  if (randomizer) {
    normalized.statusRandomizer = randomizer;
  }
  const groupRandomizer = sanitizeGroupRandomizer((value as BotAdCampaignOptions)?.groupRandomizer);
  if (groupRandomizer) {
    normalized.groupRandomizer = groupRandomizer;
  }
  const scheduleRandomizer = sanitizeScheduleRandomizer(
    (value as BotAdCampaignOptions)?.scheduleRandomizer,
  );
  if (scheduleRandomizer) {
    normalized.scheduleRandomizer = scheduleRandomizer;
  }
  const groupDispatch = sanitizeGroupDispatchOptions(
    (value as BotAdCampaignOptions)?.groupDispatch,
  );
  if (groupDispatch) {
    normalized.groupDispatch = groupDispatch;
  }
  const statusCommand = sanitizeStatusCommand(
    (value as BotAdCampaignOptions)?.statusCommand,
  );
  if (statusCommand) {
    normalized.statusCommand = statusCommand;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
};

export const parseBotAdCampaignOptions = (
  value: string | null,
): BotAdCampaignOptions => {
  const parsed = parseJsonField<BotAdCampaignOptions>(value);
  return sanitizeCampaignOptions(parsed);
};

const sanitizeMentions = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const mentions: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      mentions.push(entry.trim());
    }
    if (mentions.length >= MAX_MENTIONS_PER_TARGET) {
      break;
    }
  }
  return mentions;
};

const extractInviteCode = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/chat\.whatsapp\.com\/([A-Za-z0-9-_]+)/i);
  const code = match?.[1] ?? trimmed.split("/").pop();
  return code ? code.replace(/\s+/g, "") : null;
};

const sanitizeAudience = (value: unknown): BotAdCampaignTargetAudience | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : null;
  const description =
    typeof record.description === "string" && record.description.trim() ? record.description.trim() : null;
  const imageUrl = typeof record.imageUrl === "string" && record.imageUrl.trim() ? record.imageUrl.trim() : null;
  const categories = Array.isArray(record.categories)
    ? record.categories.filter((entry): entry is string => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : null;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((entry): entry is string => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : null;
  const metadata = record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : null;

  if (!title && !description && !imageUrl && (!categories || categories.length === 0) && (!tags || tags.length === 0) && !metadata) {
    return null;
  }
  return {
    title,
    description,
    imageUrl,
    categories: categories && categories.length > 0 ? categories : null,
    tags: tags && tags.length > 0 ? tags : null,
    metadata,
  };
};

const sanitizeInspection = (value: unknown): DivulgacaoInspectionResult | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const inviteLink = typeof record.inviteLink === "string" && record.inviteLink.trim() ? record.inviteLink.trim() : null;
  const inviteCodeRaw = typeof record.inviteCode === "string" && record.inviteCode.trim() ? record.inviteCode.trim() : null;
  const inviteCode = inviteCodeRaw || extractInviteCode(inviteLink);
  if (!inviteCode && !inviteLink) {
    return null;
  }
  const sanitizeString = (input: unknown) => (typeof input === "string" && input.trim() ? input.trim() : null);
  const memberCount = typeof record.memberCount === "number" ? record.memberCount : null;
  return {
    inviteCode: inviteCode ?? "",
    inviteLink: inviteLink ?? "",
    groupJid: sanitizeString(record.groupJid),
    groupName: sanitizeString(record.groupName),
    adminsOnly: Boolean(record.adminsOnly),
    locked: Boolean(record.locked),
    joinApprovalRequired: Boolean(record.joinApprovalRequired),
    ephemeralEnabled: Boolean(record.ephemeralEnabled),
    memberCount,
    owner: sanitizeString(record.owner),
    inspectedAt: sanitizeString(record.inspectedAt) ?? new Date().toISOString(),
    raw:
      record.raw && typeof record.raw === "object"
        ? (record.raw as Record<string, unknown>)
        : null,
  };
};

const sanitizeContents = (value: unknown): BotAdCampaignContent[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const sanitized: BotAdCampaignContent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as GenericObject;
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : randomUUID();
    const type = typeof record.type === "string" ? record.type.toLowerCase() : "text";

    if (type === "text") {
      const textValue =
        typeof record.text === "string" && record.text.trim()
          ? record.text.trim()
          : "";
      if (!textValue) {
        continue;
      }
      sanitized.push({
        id,
        type: "text",
        text: textValue,
        mentionAll: Boolean(record.mentionAll),
        mentions: sanitizeMentions(record.mentions),
      });
      continue;
    }

    if (type === "buttons") {
      const body =
        typeof record.body === "string" && record.body.trim() ? record.body.trim() : "";
      if (!body) {
        continue;
      }
      sanitized.push({
        id,
        type: "buttons",
        style:
          typeof record.style === "string" && record.style.trim()
            ? (record.style.trim().toLowerCase() as "reply" | "cta")
            : "reply",
        title:
          typeof record.title === "string" && record.title.trim() ? record.title.trim() : null,
        body,
        footer:
          typeof record.footer === "string" && record.footer.trim()
            ? record.footer.trim()
            : null,
        replyButtons: Array.isArray(record.replyButtons)
          ? (record.replyButtons as BotAdCampaignContent["replyButtons"])
          : undefined,
        ctaButtons: Array.isArray(record.ctaButtons)
          ? (record.ctaButtons as BotAdCampaignContent["ctaButtons"])
          : undefined,
        headerMedia:
          record.headerMedia && typeof record.headerMedia === "object"
            ? (record.headerMedia as BotAdCampaignContent["headerMedia"])
            : undefined,
        mentionAll: Boolean(record.mentionAll),
        mentions: sanitizeMentions(record.mentions),
      });
      continue;
    }

    if (type === "affiliate_ml") {
      const query =
        typeof record.query === "string" && record.query.trim() ? record.query.trim() : "";
      if (!query) {
        continue;
      }
      const filterRaw =
        typeof record.filter === "string" && record.filter.trim()
          ? record.filter.trim().toLowerCase()
          : "relevance";
      const allowedFilters = new Set(["relevance", "cheapest", "free_shipping", "sold", "random"]);
      const filter = allowedFilters.has(filterRaw) ? filterRaw : "relevance";
      const parsedLimit = Number(record.limit);
      const limit = Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(50, Math.floor(parsedLimit)))
        : 20;
      const parsedDispatchInterval = Number(record.dispatchIntervalMinutes);
      const dispatchIntervalMinutes = Number.isFinite(parsedDispatchInterval)
        ? Math.max(0, Math.min(1440, Math.floor(parsedDispatchInterval)))
        : 0;
      sanitized.push({
        id,
        type: "affiliate_ml",
        query,
        filter: filter as "relevance" | "cheapest" | "free_shipping" | "sold" | "random",
        limit,
        preferAvailable: record.preferAvailable !== false,
        includeImage: record.includeImage !== false,
        includeUrlButton: record.includeUrlButton !== false,
        requireAffiliateLink: record.requireAffiliateLink !== false,
        introText:
          typeof record.introText === "string" && record.introText.trim()
            ? record.introText.trim()
            : null,
        dispatchEnabled: record.dispatchEnabled !== false,
        dispatchIntervalMinutes,
        categoryRotationEnabled: record.categoryRotationEnabled !== false,
        mentionAll: Boolean(record.mentionAll),
        mentions: sanitizeMentions(record.mentions),
      });
      continue;
    }

    if (type === "status") {
      const statusType =
        typeof record.statusType === "string" && record.statusType.trim()
          ? (record.statusType.trim().toLowerCase() as BotAdCampaignContent["statusType"])
          : "text";
      const text =
        typeof record.text === "string" && record.text.trim() ? record.text.trim() : null;
      const caption =
        typeof record.caption === "string" && record.caption.trim()
          ? record.caption.trim()
          : null;

      if (!text && !record.media && statusType === "text") {
        continue;
      }

      sanitized.push({
        id,
        type: "status",
        statusType,
        text,
        caption,
        media:
          record.media && typeof record.media === "object"
            ? (record.media as BotAdCampaignContent["media"])
            : undefined,
        config: sanitizeStatusConfig(record.config),
        alwaysSendWhenRandomized: Boolean(
          record.alwaysSendWhenRandomized ?? record.statusPinned,
        ),
      });
      continue;
    }

    if (
      type === "image" ||
      type === "video" ||
      type === "audio" ||
      type === "document" ||
      type === "sticker"
    ) {
      sanitized.push({
        id,
        type,
        caption:
          typeof record.caption === "string" && record.caption.trim()
            ? record.caption.trim()
            : null,
        media:
          record.media && typeof record.media === "object"
            ? (record.media as BotAdCampaignContent["media"])
            : undefined,
        fileName:
          typeof record.fileName === "string" && record.fileName.trim()
            ? record.fileName.trim()
            : undefined,
        mimeType:
          typeof record.mimeType === "string" && record.mimeType.trim()
            ? record.mimeType.trim()
            : undefined,
        mentionAll: Boolean(record.mentionAll),
        mentions: sanitizeMentions(record.mentions),
      });
    }

    if (sanitized.length >= MAX_CONTENT_ITEMS) {
      break;
    }
  }
  return sanitized;
};

const sanitizeScheduleConfig = (
  value: BotAdCampaignScheduleConfig | null | undefined,
  startAt: Date | null,
): BotAdCampaignScheduleConfig => {
  if (!value || typeof value !== "object") {
    return { kind: "manual" };
  }
  const kind = value.kind;
  switch (kind) {
    case "manual":
      return { kind: "manual" };
    case "immediate":
      return { kind: "immediate" };
    case "once": {
      const runDate = parseDateValue(value.runAt ?? startAt ?? null);
      if (!runDate) {
        throw new Error("Informe a data de execução única da campanha.");
      }
      return { kind: "once", runAt: runDate.toISOString() };
    }
    case "recurring": {
      const everyMinutes =
        Number.isFinite(value.everyMinutes) && Number(value.everyMinutes) > 0
          ? Math.max(1, Math.floor(Number(value.everyMinutes)))
          : DEFAULT_RECURRING_MINUTES;
      const times = sanitizeTimes(value.atTimes ?? []);
      const timezone = normalizeTimezoneInput(value.timezone);
      const daysOfWeek = sanitizeDaysOfWeek(value.daysOfWeek);
      return {
        kind: "recurring",
        everyMinutes,
        atTimes: times.map((item) => `${item.hour.toString().padStart(2, "0")}:${item.minute
          .toString()
          .padStart(2, "0")}`),
        timezone: timezone ?? null,
        daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : undefined,
        startAt: value.startAt ?? null,
        endAt: value.endAt ?? null,
      };
    }
    case "window": {
      const times = sanitizeTimes(value.atTimes ?? []);
      if (times.length === 0) {
        throw new Error("Informe ao menos um horário para a janela de envio.");
      }
      const timezone = normalizeTimezoneInput(value.timezone);
      const daysOfWeek = sanitizeDaysOfWeek(value.daysOfWeek);
      return {
        kind: "window",
        timezone: timezone ?? null,
        atTimes: times.map((item) => `${item.hour.toString().padStart(2, "0")}:${item.minute
          .toString()
          .padStart(2, "0")}`),
        daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : undefined,
        startAt: value.startAt ?? null,
        endAt: value.endAt ?? null,
      };
    }
    default:
      return { kind: "manual" };
  }
};

const resolveNextTimedOccurrence = ({
  reference,
  timezone,
  times,
  daysOfWeek,
  scheduleRandomizer,
  campaignSeed,
}: {
  reference: Date;
  timezone: string;
  times: string[];
  daysOfWeek?: number[] | null;
  scheduleRandomizer?: BotAdCampaignScheduleRandomizer | null;
  campaignSeed?: string | number | null;
}): Date | null => {
  const parsedTimes = sanitizeTimes(times);
  if (parsedTimes.length === 0) {
    return null;
  }
  const baseMinutes = parsedTimes.map((entry) => toMinutes(entry.hour, entry.minute));
  const allowedDays = daysOfWeek && daysOfWeek.length > 0 ? new Set(daysOfWeek) : null;

  const seedToUnit = (seed: string) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
  };

  const seedToInt = (seed: string, min: number, max: number) => {
    if (max <= min) return min;
    const unit = seedToUnit(seed);
    const span = max - min + 1;
    return min + Math.floor(unit * span);
  };

  const clampMinuteOfDay = (value: number) =>
    Math.max(0, Math.min(23 * 60 + 59, Math.floor(value)));

  const normalizeMinuteList = (values: number[]) =>
    Array.from(new Set(values.map(clampMinuteOfDay))).sort((left, right) => left - right);

  const buildDailyMinutes = (dayKey: string) => {
    const randomizer = scheduleRandomizer;
    if (!randomizer || (!randomizer.enabled && !randomizer.reshuffleDaily)) {
      return normalizeMinuteList(baseMinutes);
    }

    if (randomizer.reshuffleDaily) {
      const count = Math.max(1, Math.min(24, baseMinutes.length));
      const startHour = randomizer.windowStartHour ?? 7;
      const endHour = randomizer.windowEndHour ?? 22;
      const windowStart = clampMinuteOfDay(startHour * 60);
      const windowEnd = clampMinuteOfDay(endHour * 60 + 59);
      const safeEnd = windowEnd > windowStart ? windowEnd : Math.min(23 * 60 + 59, windowStart + 60);
      const range = Math.max(1, safeEnd - windowStart + 1);
      const generated: number[] = [];
      const used = new Set<number>();

      for (let index = 0; index < count * 6 && generated.length < count; index += 1) {
        const candidate = windowStart + seedToInt(`${dayKey}:slot:${index}`, 0, range - 1);
        if (used.has(candidate)) continue;
        used.add(candidate);
        generated.push(candidate);
      }

      if (generated.length < count) {
        const fallback = normalizeMinuteList(baseMinutes).map((minute) =>
          Math.max(windowStart, Math.min(safeEnd, minute)),
        );
        for (const minute of fallback) {
          if (generated.length >= count) break;
          if (used.has(minute)) continue;
          used.add(minute);
          generated.push(minute);
        }
      }

      return normalizeMinuteList(generated);
    }

    const jitter =
      randomizer.enabled && randomizer.jitterMinutes && randomizer.jitterMinutes > 0
        ? Math.min(720, Math.floor(randomizer.jitterMinutes))
        : 0;
    if (jitter <= 0) {
      return normalizeMinuteList(baseMinutes);
    }

    return normalizeMinuteList(
      baseMinutes.map((minute, index) => {
        const offset = seedToInt(`${dayKey}:jitter:${index}`, -jitter, jitter);
        return minute + offset;
      }),
    );
  };

  const effectiveTimezone = normalizeTimezoneInput(timezone) ?? "UTC";
  const refDescription = describeDateInTimezone(reference, effectiveTimezone);
  const refMinutes = refDescription.hour * 60 + refDescription.minute;

  for (let dayOffset = 0; dayOffset < MAX_LOOKAHEAD_DAYS; dayOffset += 1) {
    const dayMoment =
      dayOffset === 0
        ? refDescription
        : addDaysInTimezone(reference, effectiveTimezone, dayOffset);
    if (allowedDays && !allowedDays.has(dayMoment.weekday)) {
      continue;
    }
    const minuteThreshold = dayOffset === 0 ? refMinutes : -1;
    const dayKey = `${campaignSeed ?? "campaign"}:${dayMoment.year}-${String(dayMoment.month).padStart(2, "0")}-${String(
      dayMoment.day,
    ).padStart(2, "0")}`;
    const candidateMinutes = buildDailyMinutes(dayKey);
    for (const minutes of candidateMinutes) {
      if (minutes <= minuteThreshold) {
        continue;
      }
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      const candidate = convertTimezoneLocalToUtc(effectiveTimezone, {
        year: dayMoment.year,
        month: dayMoment.month,
        day: dayMoment.day,
        hour,
        minute,
        second: 0,
      });
      if (candidate <= reference) {
        continue;
      }
      return candidate;
    }
  }

  return null;
};

const computeNextRunAt = (
  schedule: BotAdCampaignScheduleConfig,
  context: {
    now?: Date;
    startAt?: Date | null;
    endAt?: Date | null;
    lastRunAt?: Date | null;
    campaignSeed?: string | number | null;
    scheduleRandomizer?: BotAdCampaignScheduleRandomizer | null;
  },
): Date | null => {
  const now = context.now ?? new Date();
  const startAt = context.startAt ?? null;
  const endAt = context.endAt ?? null;
  const lastRunAt = context.lastRunAt ?? null;
  const campaignSeed = context.campaignSeed ?? null;
  const scheduleRandomizer = context.scheduleRandomizer ?? null;

  const clampDate = (candidate: Date | null): Date | null => {
    if (!candidate) {
      return null;
    }
    if (endAt && candidate > endAt) {
      return null;
    }
    if (startAt && candidate < startAt) {
      return startAt > now ? startAt : now;
    }
    return candidate;
  };

  switch (schedule.kind) {
    case "manual":
      return null;
    case "immediate":
      return clampDate(now);
    case "once": {
      const runDate = parseDateValue(schedule.runAt ?? startAt ?? null);
      if (!runDate) {
        return null;
      }
      if (lastRunAt) {
        return null;
      }
      if (runDate <= now) {
        return clampDate(now);
      }
      return clampDate(runDate);
    }
    case "recurring": {
      const times = schedule.atTimes ?? [];
      if (times.length > 0) {
        const timezone =
          normalizeTimezoneInput(schedule.timezone ?? null) ??
          (startAt ? describeDateInTimezone(startAt, "UTC") : null);
        const nextTimed = resolveNextTimedOccurrence({
          reference: lastRunAt && lastRunAt > now ? lastRunAt : now,
          timezone: timezone ?? schedule.timezone ?? "UTC",
          times,
          daysOfWeek: schedule.daysOfWeek,
          scheduleRandomizer,
          campaignSeed,
        });
        return clampDate(nextTimed);
      }
      const everyMinutes =
        Number.isFinite(schedule.everyMinutes) && schedule.everyMinutes! > 0
          ? Math.max(1, Math.floor(schedule.everyMinutes!))
          : DEFAULT_RECURRING_MINUTES;
      const base = lastRunAt && lastRunAt > now ? lastRunAt : now;
      const jitter =
        scheduleRandomizer?.enabled &&
        scheduleRandomizer.jitterMinutes &&
        scheduleRandomizer.jitterMinutes > 0
          ? Math.min(720, Math.floor(scheduleRandomizer.jitterMinutes))
          : 0;
      let effectiveEveryMinutes = everyMinutes;
      if (jitter > 0) {
        const seedInput = `${campaignSeed ?? "campaign"}:${base.toISOString()}:recurring`;
        let hash = 2166136261;
        for (let index = 0; index < seedInput.length; index += 1) {
          hash ^= seedInput.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        const unit = (hash >>> 0) / 0xffffffff;
        const jitterDelta = -jitter + Math.floor(unit * (jitter * 2 + 1));
        effectiveEveryMinutes = Math.max(1, everyMinutes + jitterDelta);
      }
      const candidate = new Date(base.getTime() + effectiveEveryMinutes * 60_000);
      return clampDate(candidate);
    }
    case "window": {
      if (!schedule.atTimes || schedule.atTimes.length === 0) {
        return null;
      }
      const timezone = schedule.timezone ?? "UTC";
      const reference = lastRunAt && lastRunAt > now ? lastRunAt : now;
      const nextTimed = resolveNextTimedOccurrence({
        reference,
        timezone,
        times: schedule.atTimes,
        daysOfWeek: schedule.daysOfWeek,
        scheduleRandomizer,
        campaignSeed,
      });
      return clampDate(nextTimed);
    }
    default:
      return null;
  }
};

type InviteMeta = { inviteCode: string; inviteLink: string };

const normalizeInviteInspection = (
  invite: InviteMeta,
  payload: unknown,
): DivulgacaoInspectionResult => {
  const now = new Date().toISOString();
  const baseRecord =
    payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)
      ? (payload as Record<string, unknown>).data
      : payload;
  const record = (baseRecord || {}) as Record<string, any>;

  const normalizeString = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return null;
  };

  const groupJid =
    normalizeString(record?.JID) ||
    normalizeString(record?.jid) ||
    normalizeString(record?.Id) ||
    normalizeString(record?.id) ||
    (record && typeof record === "object" && normalizeString((record as Record<string, unknown>).remoteId)) ||
    null;

  const groupName =
    normalizeString(record?.Name) ||
    normalizeString(record?.name) ||
    normalizeString(record?.Subject) ||
    normalizeString(record?.subject) ||
    null;

  const adminsOnly =
    Boolean(record?.IsAnnounce) ||
    Boolean(record?.AnnounceOnly) ||
    Boolean(record?.announce) ||
    Boolean(record?.adminsOnly);
  const locked = Boolean(record?.IsLocked) || Boolean(record?.locked);
  const joinApproval =
    Boolean(record?.IsJoinApprovalRequired) ||
    Boolean(record?.isJoinApprovalRequired) ||
    Boolean(record?.MembershipApprovalMode) ||
    Boolean(record?.membershipApprovalMode);
  const ephemeral =
    Boolean(record?.IsEphemeral) ||
    Boolean(record?.ephemeral) ||
    Boolean(record?.DisappearingTimer) ||
    Boolean(record?.disappearingTimer);

  let memberCount: number | null = null;
  if (Array.isArray(record?.Participants)) {
    memberCount = record?.Participants.length;
  } else if (typeof record?.memberCount === "number") {
    memberCount = record?.memberCount;
  }

  const owner =
    normalizeString(record?.OwnerJID) ||
    normalizeString(record?.OwnerNumber) ||
    normalizeString(record?.owner) ||
    null;

  return {
    inviteCode: invite.inviteCode,
    inviteLink: invite.inviteLink,
    groupJid,
    groupName,
    adminsOnly,
    locked,
    joinApprovalRequired: joinApproval,
    ephemeralEnabled: ephemeral,
    memberCount,
    owner,
    inspectedAt: now,
    raw: record ?? null,
  };
};

const resolveInviteMetaFromTarget = (target: BotAdCampaignTargetInput): InviteMeta | null => {
  const rawLink = typeof target.inviteLink === "string" ? target.inviteLink.trim() : "";
  const rawCode = typeof target.inviteCode === "string" ? target.inviteCode.trim() : "";
  const inviteCode = rawCode || extractInviteCode(rawLink);
  if (!inviteCode) {
    return null;
  }
  const inviteLink = rawLink || `https://chat.whatsapp.com/${inviteCode}`;
  return { inviteCode, inviteLink };
};

const buildInstanceClient = async (
  userId: number,
  instanceId: number,
  cache: Map<number, WuzapiClient>,
): Promise<WuzapiClient> => {
  const cached = cache.get(instanceId);
  if (cached) {
    return cached;
  }
  const instance = await getInstanceForUser(userId, instanceId);
  if (!instance) {
    throw new Error("Instância não encontrada.");
  }
  if (!instance.serverBaseUrl || !instance.token) {
    throw new Error("A instância selecionada não possui servidor configurado.");
  }
  const client: WuzapiClient = {
    baseUrl: instance.serverBaseUrl,
    token: instance.token,
  };
  cache.set(instanceId, client);
  return client;
};

const ensureInviteTargetsAreValid = async (
  userId: number,
  targets: BotAdCampaignTargetInput[],
): Promise<CampaignTargetValidationIssue[]> => {
  const clientCache = new Map<number, WuzapiClient>();
  const inspectionCache = new Map<string, DivulgacaoInspectionResult>();
  const invalidTargets: CampaignTargetValidationIssue[] = [];
  const invalidTargetIds = new Set<string>();
  const lastInspectionAt = new Map<number, number>();

  const maybeDelayInspection = async (instanceId: number) => {
    if (INVITE_INSPECTION_DELAY_MS <= 0) {
      return;
    }
    const lastRun = lastInspectionAt.get(instanceId);
    if (lastRun) {
      const elapsed = Date.now() - lastRun;
      if (elapsed < INVITE_INSPECTION_DELAY_MS) {
        await sleep(INVITE_INSPECTION_DELAY_MS - elapsed);
      }
    }
  };

  for (const target of targets) {
    if (target.type !== "group") {
      continue;
    }

    const invite = resolveInviteMetaFromTarget(target);
    if (!invite) {
      continue;
    }

    const instanceId = target.instanceId;
    if (!Number.isFinite(instanceId)) {
      throw new Error("Selecione a instância responsável por enviar a campanha.");
    }

    const cacheKey = `${instanceId}:${invite.inviteCode.toLowerCase()}`;
    let inspection = inspectionCache.get(cacheKey) ?? null;
    if (!inspection) {
      await maybeDelayInspection(instanceId);
      const client = await buildInstanceClient(userId, instanceId, clientCache);
      let payload: unknown;
      try {
        payload = await getGroupInviteInfo(client, invite.inviteCode);
      } catch (error) {
        lastInspectionAt.set(instanceId, Date.now());
        const status = (error as { status?: number }).status ?? null;
        const reason =
          error instanceof Error && error.message
            ? error.message
            : `Não foi possível validar o grupo ${invite.inviteLink}.`;
        if (status && status >= 500) {
          const label = target.audience?.title ?? invite.inviteLink ?? invite.inviteCode;
          invalidTargets.push({
            targetId: typeof target.id === "string" ? target.id : invite.inviteCode,
            inviteLink: invite.inviteLink,
            targetName: label,
            reason,
          });
          if (typeof target.id === "string") {
            invalidTargetIds.add(target.id);
          }
          continue;
        }
        console.error("[bot-ad-campaigns] Falha ao validar convite do grupo", {
          instanceId,
          invite: invite.inviteLink,
          error,
        });
        throw new Error(
          `Não foi possível validar o grupo ${invite.inviteLink}. Verifique se o link está correto e tente novamente.`,
        );
      }
      lastInspectionAt.set(instanceId, Date.now());
      inspection = normalizeInviteInspection(invite, payload);
      if (!inspection.groupJid) {
        throw new Error(`Não foi possível identificar o grupo do convite ${invite.inviteLink}.`);
      }
      if (inspection.adminsOnly || inspection.locked) {
        throw new Error(
          `O grupo ${inspection.groupName ?? invite.inviteLink} está fechado para mensagens. Escolha outro destino.`,
        );
      }
      if (inspection.joinApprovalRequired) {
        throw new Error(
          `O grupo ${inspection.groupName ?? invite.inviteLink} exige aprovação antes de aceitar novos participantes.`,
        );
      }
      inspectionCache.set(cacheKey, inspection);
    }

    target.remoteId = inspection.groupJid ?? target.remoteId;
    target.inviteCode = inspection.inviteCode ?? invite.inviteCode;
    target.inviteLink = inspection.inviteLink ?? invite.inviteLink;
    target.inspection = inspection;
  }

  if (invalidTargetIds.size > 0) {
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      const entry = targets[index];
      if (entry && typeof entry.id === "string" && invalidTargetIds.has(entry.id)) {
        targets.splice(index, 1);
      }
    }
  }

  return invalidTargets;
};

export const describeInviteValidationIssues = (
  issues: CampaignTargetValidationIssue[],
): string | null => {
  if (!issues.length) {
    return null;
  }
  const labels = Array.from(
    new Set(
      issues
        .map((issue) => issue.targetName?.trim() || issue.inviteLink?.trim() || null)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (labels.length === 0) {
    return issues.length === 1
      ? "Removemos um destino porque o link público está inválido ou expirado."
      : `Removemos ${issues.length} destinos porque os links públicos estão inválidos ou expirados.`;
  }
  if (labels.length === 1) {
    return `Removemos o destino ${labels[0]} porque o link público está inválido ou expirado.`;
  }
  return `Removemos ${labels.length} destinos com link inválido: ${labels.join(", ")}.`;
};

const mapTargetRow = (row: BotAdCampaignTargetRow): BotAdCampaignTarget => ({
  id: row.target_id,
  type: row.target_type === "status" ? "status" : "group",
  instanceId: row.instance_id,
  groupId: row.group_id ?? null,
  remoteId: row.remote_id ?? null,
  inviteCode: row.invite_code ?? null,
  inviteLink: row.invite_link ?? null,
  audience: parseJsonField<BotAdCampaignTargetAudience>(row.audience_meta) ?? null,
  inspection: parseJsonField<DivulgacaoInspectionResult>(row.inspection_json) ?? null,
  mentionAll: row.mention_all === 1,
  excludeAdmins: row.exclude_admins === 1,
  mentions: parseJsonField<string[]>(row.mention_list) ?? [],
  statusConfig: parseJsonField<BotAdCampaignStatusConfig>(row.status_config) ?? null,
});

const mapCampaignRow = (
  row: BotAdCampaignRow,
  targets: BotAdCampaignTargetRow[],
): BotAdCampaign => {
  const schedule =
    parseJsonField<BotAdCampaignScheduleConfig>(row.schedule_config) ??
    ({ kind: row.schedule_kind ?? "manual" } as BotAdCampaignScheduleConfig);

  return {
    id: row.campaign_id,
    numericId: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? null,
    status: row.status as BotAdCampaign["status"],
    schedule,
    timezone: row.timezone ?? null,
    startAt: row.start_at
      ? row.start_at instanceof Date
        ? row.start_at.toISOString()
        : new Date(row.start_at).toISOString()
      : null,
    endAt: row.end_at
      ? row.end_at instanceof Date
        ? row.end_at.toISOString()
        : new Date(row.end_at).toISOString()
      : null,
    lastRunAt: row.last_run_at
      ? row.last_run_at instanceof Date
        ? row.last_run_at.toISOString()
        : new Date(row.last_run_at).toISOString()
      : null,
    nextRunAt: row.next_run_at
      ? row.next_run_at instanceof Date
        ? row.next_run_at.toISOString()
        : new Date(row.next_run_at).toISOString()
      : null,
    contents: parseJsonField<BotAdCampaignContent[]>(row.content_json) ?? [],
    targets: targets.map(mapTargetRow),
    options: parseBotAdCampaignOptions(row.options_json),
    nextTargetHint: parseJsonField<CampaignNextTargetHint>(row.next_target_hint_json) ?? null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
};

const fetchCampaignTargets = async (campaignIds: number[]): Promise<Map<number, BotAdCampaignTargetRow[]>> => {
  const db = getDb();
  const map = new Map<number, BotAdCampaignTargetRow[]>();
  if (campaignIds.length === 0) {
    return map;
  }
  const placeholders = campaignIds.map(() => "?").join(",");
  const [rows] = await db.query<BotAdCampaignTargetRow[]>(
    `SELECT * FROM bot_ad_campaign_targets WHERE campaign_id IN (${placeholders}) ORDER BY id ASC`,
    campaignIds,
  );
  for (const row of rows) {
    const list = map.get(row.campaign_id) ?? [];
    list.push(row);
    map.set(row.campaign_id, list);
  }
  return map;
};

export const listBotAdCampaignsForUser = async (userId: number): Promise<BotAdCampaign[]> => {
  await ensureBotAdCampaignTable();
  await ensureBotAdCampaignTargetTable();
  const db = getDb();
  const [rows] = await db.query<BotAdCampaignRow[]>(
    `
      SELECT *
      FROM bot_ad_campaigns
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `,
    [userId],
  );
  const targets = await fetchCampaignTargets(rows.map((row) => row.id));
  return rows.map((row) => mapCampaignRow(row, targets.get(row.id) ?? []));
};

const getCampaignRow = async (userId: number, campaignId: string): Promise<BotAdCampaignRow | null> => {
  await ensureBotAdCampaignTable();
  const db = getDb();
  const [rows] = await db.query<BotAdCampaignRow[]>(
    `SELECT * FROM bot_ad_campaigns WHERE user_id = ? AND campaign_id = ? AND deleted_at IS NULL LIMIT 1`,
    [userId, campaignId],
  );
  return rows[0] ?? null;
};

export const getBotAdCampaignById = async (
  userId: number,
  campaignId: string,
): Promise<BotAdCampaign | null> => {
  const row = await getCampaignRow(userId, campaignId);
  if (!row) {
    return null;
  }
  await ensureBotAdCampaignTargetTable();
  const db = getDb();
  const [targets] = await db.query<BotAdCampaignTargetRow[]>(
    `SELECT * FROM bot_ad_campaign_targets WHERE campaign_id = ? ORDER BY id ASC`,
    [row.id],
  );
  return mapCampaignRow(row, targets);
};

const upsertCampaignRow = async (
  userId: number,
  payload: BotAdCampaignInput,
  existing?: BotAdCampaignRow | null,
): Promise<BotAdCampaignRow> => {
  await ensureBotAdCampaignTable();
  const db = getDb();

  const name = sanitizeName(payload.name ?? existing?.name);
  const description = sanitizeDescription(payload.description ?? existing?.description);
  const status = sanitizeCampaignStatus(payload.status ?? existing?.status ?? "draft", existing?.status ?? "draft");

  const startAtInput = parseDateValue(payload.startAt ?? existing?.start_at ?? null);
  const endAtInput = parseDateValue(payload.endAt ?? existing?.end_at ?? null);
  const startAt = formatDateTimeForDb(startAtInput);
  const endAt = formatDateTimeForDb(endAtInput);

  const existingSchedule = existing
    ? parseJsonField<BotAdCampaignScheduleConfig>(existing.schedule_config) ??
      ({ kind: existing.schedule_kind ?? "manual" } as BotAdCampaignScheduleConfig)
    : null;

  const schedule = sanitizeScheduleConfig(payload.schedule ?? existingSchedule, startAtInput);
  const timezonePreference = resolveTimezonePreference({
    preferred: [payload.timezone, schedule.kind !== "manual" ? schedule.timezone : null, existing?.timezone],
  });

  const contents = sanitizeContents(payload.contents ?? parseJsonField(existing?.content_json) ?? []);
  const existingOptions = existing ? parseBotAdCampaignOptions(existing.options_json) : null;
  const options =
    payload.options === undefined ? existingOptions : sanitizeCampaignOptions(payload.options);
  const optionsJson = options ? JSON.stringify(options) : null;
  const nextRunAtDate = computeNextRunAt(schedule, {
    now: new Date(),
    startAt: startAtInput,
    endAt: endAtInput,
    lastRunAt: existing?.last_run_at ? parseDateValue(existing.last_run_at) : null,
    campaignSeed: existing?.campaign_id ?? name,
    scheduleRandomizer: options?.scheduleRandomizer ?? null,
  });
  const computedNextRunAt = nextRunAtDate ? nextRunAtDate.toISOString().slice(0, 19).replace("T", " ") : null;
  const nextRunAt = status === "paused" ? null : computedNextRunAt;

  if (existing) {
    await db.query(
      `
        UPDATE bot_ad_campaigns
        SET name = ?, description = ?, schedule_kind = ?, schedule_config = ?, content_json = ?, options_json = ?, timezone = ?, start_at = ?, end_at = ?, next_run_at = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        name,
        description,
        schedule.kind,
        stringifyJson(schedule),
        stringifyJson(contents),
        optionsJson,
        timezonePreference,
        startAt,
        endAt,
        nextRunAt,
        status,
        existing.id,
        userId,
      ],
    );
    const updatedRow = await getCampaignRow(userId, existing.campaign_id);
    if (!updatedRow) {
      throw new Error("Falha ao atualizar a campanha.");
    }
    return updatedRow;
  }

  const campaignId = randomUUID();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_ad_campaigns
        (campaign_id, user_id, name, description, status, schedule_kind, schedule_config, content_json, options_json, timezone, start_at, end_at, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      campaignId,
      userId,
      name,
      description,
      status,
      schedule.kind,
      stringifyJson(schedule),
      stringifyJson(contents),
      optionsJson,
      timezonePreference,
      startAt,
      endAt,
      nextRunAt,
    ],
  );

  const inserted = await getCampaignRow(userId, campaignId);
  if (!inserted) {
    throw new Error("Não foi possível criar a campanha.");
  }
  return inserted;
};

export const createBotAdCampaign = async (
  userId: number,
  payload: BotAdCampaignInput,
): Promise<BotAdCampaign> => {
  const row = await upsertCampaignRow(userId, payload);
  return await getBotAdCampaignById(userId, row.campaign_id).then((campaign) => {
    if (!campaign) {
      throw new Error("Não foi possível carregar a campanha recém criada.");
    }
    return campaign;
  });
};

export const updateBotAdCampaign = async (
  userId: number,
  campaignId: string,
  payload: BotAdCampaignInput,
): Promise<BotAdCampaign> => {
  const existing = await getCampaignRow(userId, campaignId);
  if (!existing) {
    throw new Error("Campanha não encontrada.");
  }
  await upsertCampaignRow(userId, payload, existing);
  const updated = await getBotAdCampaignById(userId, campaignId);
  if (!updated) {
    throw new Error("Não foi possível atualizar a campanha.");
  }
  return updated;
};

export const deleteBotAdCampaign = async (userId: number, campaignId: string): Promise<void> => {
  await ensureBotAdCampaignTable();
  const db = getDb();
  await db.query(
    `UPDATE bot_ad_campaigns SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = ? AND campaign_id = ?`,
    [userId, campaignId],
  );
};

export const replaceBotAdCampaignTargets = async (
  userId: number,
  campaignId: string,
  targets: BotAdCampaignTargetInput[],
): Promise<ReplaceTargetsResult> => {
  const campaign = await getCampaignRow(userId, campaignId);
  if (!campaign) {
    throw new Error("Campanha não encontrada.");
  }
  await ensureBotAdCampaignTargetTable();
  const db = getDb();

  const sanitizedTargets: BotAdCampaignTargetInput[] = [];
  for (const target of targets) {
    if (!target || typeof target !== "object") {
      continue;
    }
    if (!Number.isFinite(target.instanceId)) {
      continue;
    }
    const type: BotAdCampaignTarget["type"] =
      target.type === "status" ? "status" : "group";
    const audience = sanitizeAudience(target.audience);
    const inspection = sanitizeInspection(target.inspection);
    const inviteLink =
      typeof target.inviteLink === "string" && target.inviteLink.trim() ? target.inviteLink.trim() : null;
    const inviteCodeInput =
      typeof target.inviteCode === "string" && target.inviteCode.trim() ? target.inviteCode.trim() : null;
    const inviteCode = inviteCodeInput ?? extractInviteCode(inviteLink);
    let remoteId =
      typeof target.remoteId === "string" && target.remoteId.trim()
        ? target.remoteId.trim()
        : null;
    if (!remoteId && inspection?.groupJid) {
      remoteId = inspection.groupJid;
    }

    sanitizedTargets.push({
      id: target.id && typeof target.id === "string" ? target.id : randomUUID(),
      type,
      instanceId: Number(target.instanceId),
      groupId: Number.isFinite(target.groupId) ? Number(target.groupId) : null,
      remoteId,
      inviteCode: inviteCode ?? null,
      inviteLink: inviteLink ?? null,
      audience: audience ?? null,
      inspection: inspection ?? null,
      mentionAll: Boolean(target.mentionAll),
      excludeAdmins: Boolean(target.excludeAdmins),
      mentions: sanitizeMentions(target.mentions),
      statusConfig: sanitizeStatusConfig(target.statusConfig),
    });
    if (sanitizedTargets.length >= MAX_TARGETS_PER_CAMPAIGN) {
      break;
    }
  }

  const inviteIssues = await ensureInviteTargetsAreValid(userId, sanitizedTargets);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM bot_ad_campaign_targets WHERE campaign_id = ?`, [
      campaign.id,
    ]);
    if (sanitizedTargets.length > 0) {
      const placeholders: string[] = [];
      const values: unknown[] = [];
      for (const target of sanitizedTargets) {
        placeholders.push(`(${Array.from({ length: 14 }, () => "?").join(", ")})`);
        values.push(
          campaign.id,
          target.id,
          target.type,
          target.instanceId,
          target.groupId,
          target.remoteId,
          target.inviteCode ?? null,
          target.inviteLink ?? null,
          stringifyJson(target.audience),
          stringifyJson(target.inspection),
          stringifyJson(target.statusConfig),
          target.mentionAll ? 1 : 0,
          target.excludeAdmins ? 1 : 0,
          stringifyJson(target.mentions),
        );
      }
      await connection.query(
        `
          INSERT INTO bot_ad_campaign_targets (
            campaign_id,
            target_id,
            target_type,
            instance_id,
            group_id,
            remote_id,
            invite_code,
            invite_link,
            audience_meta,
            inspection_json,
            status_config,
            mention_all,
            exclude_admins,
            mention_list
          ) VALUES ${placeholders.join(", ")}
        `,
        values,
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [rows] = await db.query<BotAdCampaignTargetRow[]>(
    `SELECT * FROM bot_ad_campaign_targets WHERE campaign_id = ? ORDER BY id ASC`,
    [campaign.id],
  );
  return { targets: rows.map(mapTargetRow), inviteIssues };
};

export const listCampaignTargets = async (
  userId: number,
  campaignId: string,
): Promise<BotAdCampaignTarget[]> => {
  const campaign = await getCampaignRow(userId, campaignId);
  if (!campaign) {
    throw new Error("Campanha não encontrada.");
  }
  await ensureBotAdCampaignTargetTable();
  const db = getDb();
  const [rows] = await db.query<BotAdCampaignTargetRow[]>(
    `SELECT * FROM bot_ad_campaign_targets WHERE campaign_id = ? ORDER BY id ASC`,
    [campaign.id],
  );
  return rows.map(mapTargetRow);
};

const listDueCampaignRows = async (
  limit: number,
): Promise<BotAdCampaignRow[]> => {
  await ensureBotAdCampaignTable();
  const db = getDb();
  const [rows] = await db.query<BotAdCampaignRow[]>(
    `
      SELECT *
      FROM bot_ad_campaigns
      WHERE deleted_at IS NULL
        AND status IN ('scheduled','running','draft')
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
      ORDER BY
        CASE WHEN EXISTS (
          SELECT 1
          FROM bot_ad_campaign_targets priority_target
          WHERE priority_target.campaign_id = bot_ad_campaigns.id
            AND priority_target.target_type = 'status'
        ) THEN 0 ELSE 1 END,
        next_run_at ASC
      LIMIT ?
    `,
    [limit],
  );
  return rows;
};

export const isBotAdCampaignDispatchable = async (
  campaignId: number,
): Promise<boolean> => {
  await ensureBotAdCampaignTable();
  const [rows] = await getDb().query<RowDataPacket[]>(
    `
      SELECT id
      FROM bot_ad_campaigns
      WHERE id = ?
        AND deleted_at IS NULL
        AND status IN ('scheduled','running','draft')
      LIMIT 1
    `,
    [campaignId],
  );
  return rows.length > 0;
};

export const listDueBotAdCampaigns = async (
  limit: number,
): Promise<Array<{ campaign: BotAdCampaignRow; targets: BotAdCampaignTargetRow[] }>> => {
  const rows = await listDueCampaignRows(limit);
  if (rows.length === 0) {
    return [];
  }
  await ensureBotAdCampaignTargetTable();
  const targets = await fetchCampaignTargets(rows.map((row) => row.id));
  return rows.map((row) => ({
    campaign: row,
    targets: targets.get(row.id) ?? [],
  }));
};

export const getCampaignTargetLastSuccessAt = async (
  campaignId: number,
): Promise<Map<number, number>> => {
  await ensureBotAdCampaignRunTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT target_id, MAX(COALESCE(finished_at, updated_at, created_at)) AS last_success_at
      FROM bot_ad_campaign_runs
      WHERE campaign_id = ?
        AND target_id IS NOT NULL
        AND status = 'success'
      GROUP BY target_id
    `,
    [campaignId],
  );
  const result = new Map<number, number>();
  for (const row of rows) {
    const targetId = Number(row.target_id);
    const timestamp = new Date(row.last_success_at as string | Date).getTime();
    if (Number.isFinite(targetId) && Number.isFinite(timestamp)) {
      result.set(targetId, timestamp);
    }
  }
  return result;
};

export const updateCampaignNextRun = async (row: BotAdCampaignRow): Promise<void> => {
  const schedule =
    parseJsonField<BotAdCampaignScheduleConfig>(row.schedule_config) ??
    ({ kind: row.schedule_kind } as BotAdCampaignScheduleConfig);
  const options = parseBotAdCampaignOptions(row.options_json);
  const nextRunDate = computeNextRunAt(schedule, {
    now: new Date(),
    startAt: row.start_at ? new Date(row.start_at) : null,
    endAt: row.end_at ? new Date(row.end_at) : null,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
    campaignSeed: row.campaign_id,
    scheduleRandomizer: options?.scheduleRandomizer ?? null,
  });
  await setCampaignNextRunState(row.id, nextRunDate, null);
};

export const recordCampaignRun = async (
  campaignId: number,
  targetId: number | null,
  status: BotAdCampaignRunRow["status"],
  options: {
    scheduledFor?: Date | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    errorMessage?: string | null;
    stats?: Record<string, unknown> | null;
  } = {},
): Promise<BotAdCampaignRunRow> => {
  await ensureBotAdCampaignRunTable();
  const db = getDb();
  const runId = randomUUID();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_ad_campaign_runs (
        run_id,
        campaign_id,
        target_id,
        status,
        scheduled_for,
        started_at,
        finished_at,
        error_message,
        stats_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      runId,
      campaignId,
      targetId,
      status,
      options.scheduledFor ?? null,
      options.startedAt ?? null,
      options.finishedAt ?? null,
      options.errorMessage ?? null,
      stringifyJson(options.stats),
    ],
  );
  const [rows] = await db.query<BotAdCampaignRunRow[]>(
    `SELECT * FROM bot_ad_campaign_runs WHERE run_id = ? LIMIT 1`,
    [runId],
  );
  return rows[0];
};

export const touchCampaignRun = async (campaignId: number): Promise<void> => {
  await ensureBotAdCampaignTable();
  const db = getDb();
  await db.query(`UPDATE bot_ad_campaigns SET last_run_at = NOW() WHERE id = ?`, [campaignId]);
  const [rows] = await db.query<BotAdCampaignRow[]>(
    `SELECT * FROM bot_ad_campaigns WHERE id = ? LIMIT 1`,
    [campaignId],
  );
  if (rows[0]) {
    await updateCampaignNextRun(rows[0]);
  }
};

export const scheduleCampaignRetry = async (
  campaignId: number,
  delaySeconds = 60,
): Promise<void> => {
  const delay = Number.isFinite(delaySeconds) ? Math.max(5, Math.floor(delaySeconds)) : 60;
  const nextDate = new Date(Date.now() + delay * 1000);
  await setCampaignNextRunState(campaignId, nextDate, null);
};

export const triggerImmediateBotAdCampaignRun = async (
  userId: number,
  campaignId: string,
): Promise<void> => {
  const campaign = await getCampaignRow(userId, campaignId);
  if (!campaign) {
    throw new Error("Campanha não encontrada.");
  }
  await ensureBotAdCampaignTable();
  const db = getDb();
  await db.query(
    `
      UPDATE bot_ad_campaigns
      SET status = CASE WHEN status = 'draft' THEN 'running' ELSE 'running' END,
          next_run_at = NOW(),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [campaign.id],
  );
};

export const createStatusPostRecord = async (
  campaignId: number,
  targetId: number | null,
  instanceId: number,
  data: {
    remoteJid?: string | null;
    messageId?: string | null;
    deleteAt?: Date | null;
    payload?: Record<string, unknown> | null;
    runId?: number | null;
  },
): Promise<BotAdCampaignStatusPostRow> => {
  await ensureBotAdCampaignStatusPostTable();
  const db = getDb();
  const postId = randomUUID();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_ad_campaign_status_posts (
        post_id,
        campaign_id,
        run_id,
        target_id,
        instance_id,
        remote_jid,
        message_id,
        delete_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      postId,
      campaignId,
      data.runId ?? null,
      targetId,
      instanceId,
      data.remoteJid ?? null,
      data.messageId ?? null,
      data.deleteAt ?? null,
      stringifyJson(data.payload),
    ],
  );
  const [rows] = await db.query<BotAdCampaignStatusPostRow[]>(
    `SELECT * FROM bot_ad_campaign_status_posts WHERE post_id = ? LIMIT 1`,
    [postId],
  );
  return rows[0];
};

export type StatusContentHistory = {
  lastContentId: string | null;
  usageCounts: Record<string, number>;
  dailySentCount: number;
  dailyUsageCounts: Record<string, number>;
};

export const getStatusContentHistoryForTarget = async (
  campaignId: number,
  targetId: number,
  options: { limit?: number; timezone?: string | null; dayReference?: Date | string | null } = {},
): Promise<StatusContentHistory> => {
  await ensureBotAdCampaignStatusPostTable();
  const db = getDb();
  const requestedLimit = Number.isFinite(options.limit)
    ? Math.max(1, Math.floor(options.limit!))
    : null;
  const effectiveTimezone = normalizeTimezoneInput(options.timezone ?? null) ?? "UTC";
  const referenceDate = parseDateValue(options.dayReference ?? null) ?? new Date();
  const referenceDay = describeDateInTimezone(referenceDate, effectiveTimezone);
  const referenceDayKey = `${referenceDay.year}-${String(referenceDay.month).padStart(2, "0")}-${String(
    referenceDay.day,
  ).padStart(2, "0")}`;
  const [rows] = await db.query<Array<{ payload_json: string | null; created_at: Date | string }>>(
    `
      SELECT payload_json, created_at
      FROM bot_ad_campaign_status_posts
      WHERE campaign_id = ? AND target_id = ?
      ORDER BY id DESC
      ${requestedLimit === null ? "" : "LIMIT ?"}
    `,
    requestedLimit === null ? [campaignId, targetId] : [campaignId, targetId, requestedLimit],
  );
  let lastContentId: string | null = null;
  const usageCounts: Record<string, number> = {};
  let dailySentCount = 0;
  const dailyUsageCounts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.payload_json) {
      continue;
    }
    try {
      const payload = JSON.parse(row.payload_json);
      const contentId = typeof payload?.contentId === "string" ? payload.contentId : null;
      if (!contentId) {
        continue;
      }
      if (!lastContentId) {
        lastContentId = contentId;
      }
      usageCounts[contentId] = (usageCounts[contentId] ?? 0) + 1;

      const createdAt = parseDateValue(row.created_at);
      if (createdAt) {
        const localCreated = describeDateInTimezone(createdAt, effectiveTimezone);
        const localDayKey = `${localCreated.year}-${String(localCreated.month).padStart(2, "0")}-${String(
          localCreated.day,
        ).padStart(2, "0")}`;
        if (localDayKey === referenceDayKey) {
          dailySentCount += 1;
          dailyUsageCounts[contentId] = (dailyUsageCounts[contentId] ?? 0) + 1;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { lastContentId, usageCounts, dailySentCount, dailyUsageCounts };
};

export type BotAdCampaignStatusPostWithOwnerRow = BotAdCampaignStatusPostRow & {
  user_id: number;
};

export const listStatusPostsPendingDeletion = async (
  limit: number,
): Promise<BotAdCampaignStatusPostWithOwnerRow[]> => {
  await ensureBotAdCampaignStatusPostTable();
  const db = getDb();
  const [rows] = await db.query<BotAdCampaignStatusPostWithOwnerRow[]>(
    `
      SELECT sp.*, c.user_id
      FROM bot_ad_campaign_status_posts sp
      INNER JOIN bot_ad_campaigns c ON c.id = sp.campaign_id
      WHERE sp.deleted_at IS NULL
        AND sp.delete_at IS NOT NULL
        AND sp.delete_at <= NOW()
      ORDER BY sp.delete_at ASC
      LIMIT ?
    `,
    [limit],
  );
  return rows;
};

export const listActiveStatusPostsForTarget = async (
  campaignId: number,
  targetId: number,
): Promise<BotAdCampaignStatusPostRow[]> => {
  await ensureBotAdCampaignStatusPostTable();
  const db = getDb();
  const [rows] = await db.query<BotAdCampaignStatusPostRow[]>(
    `
      SELECT *
      FROM bot_ad_campaign_status_posts
      WHERE campaign_id = ? AND target_id = ? AND deleted_at IS NULL
      ORDER BY id ASC
    `,
    [campaignId, targetId],
  );
  return rows;
};

export const listActiveStatusPostsForCampaign = async (
  campaignId: number,
): Promise<BotAdCampaignStatusPostRow[]> => {
  await ensureBotAdCampaignStatusPostTable();
  const db = getDb();
  const [rows] = await db.query<BotAdCampaignStatusPostRow[]>(
    `
      SELECT *
      FROM bot_ad_campaign_status_posts
      WHERE campaign_id = ? AND deleted_at IS NULL
      ORDER BY id ASC
    `,
    [campaignId],
  );
  return rows;
};

export const markStatusPostDeleted = async (postId: number, messageId: string | null, errorMessage?: string | null) => {
  await ensureBotAdCampaignStatusPostTable();
  const db = getDb();
  await db.query(
    `
      UPDATE bot_ad_campaign_status_posts
      SET deleted_at = CURRENT_TIMESTAMP,
          message_id = COALESCE(?, message_id),
          error_message = ?
      WHERE id = ?
    `,
    [messageId, errorMessage ?? null, postId],
  );
};
