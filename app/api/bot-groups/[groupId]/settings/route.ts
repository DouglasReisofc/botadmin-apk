import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminSiteSettings } from "lib/admin-site";
import { getBotMenuConfigForUser } from "lib/bot-config";
import { getGroupAccessForUser } from "lib/bot-groups";
import { publishBotGroupRealtimeUpdate } from "lib/bot-group-realtime";
import {
  getGroupSettings,
  normalizeAutoResponseEntry,
  upsertGroupSettings,
} from "lib/bot-group-settings";
import { parseHorapgTimesArgument } from "lib/bot-horapg";
import { getInstanceSettings } from "lib/bot-instance-settings";
import { getInstanceForUser } from "lib/bot-instances";
import { evaluatePlanGuard } from "lib/plan-guard";
import { getPublicAppBaseUrl } from "lib/meta";
import { DEFAULT_MENU_TEXTS } from "resources/default-menu-texts";
import {
  buildBotAdminNativeMenuSections,
  renderConfiguredMenuSection,
  resolveBotAdminMenuImagePath,
  resolveBotAdminNativeMenuCopy,
  type NativeMenuKind,
} from "lib/bot-events/message-handler";
import type {
  BotGroup,
  BotGroupAutoResponse,
  BotGroupCommandToggles,
  BotGroupMenuCarousel,
  BotGroupMenuTexts,
  BotGroupPremiumConfig,
  BotGroupSettings,
  BotGroupWelcomeConfig,
  BotGroupFarewellConfig,
  BotGroupHorapgConfig,
  BotGroupScheduleConfig,
  BotGroupAntiInactivityConfig,
  BotGroupAntispamConfig,
  BotGroupModerationActionKey,
  BotGroupModerationActions,
} from "types/bot-groups";
import type { SessionUser } from "types/auth";

const parseListInput = (value: unknown): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,;,]+/)
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  }

  return [];
};

const sanitizeDigits = (value: string): string => value.replace(/\D+/g, "");

const sanitizeDigitsList = (entries: string[]): string[] =>
  Array.from(
    new Set(
      entries
        .map((entry) => sanitizeDigits(entry))
        .filter((entry) => entry.length >= 5),
    ),
  );

const parseFeatureFlagsInput = (value: unknown): Record<string, boolean> | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, boolean>>(
      (acc, [key, raw]) => {
        if (!key) {
          return acc;
        }
        const boolValue =
          raw === true ||
          raw === "true" ||
          raw === 1 ||
          raw === "1" ||
          (typeof raw === "string" && raw.trim().toLowerCase() === "on");
        acc[key] = boolValue;
        return acc;
      },
      {},
    );
  }

  return undefined;
};

const MODERATION_ACTION_KEYS: BotGroupModerationActionKey[] = [
  "antilink",
  "antilinkgp",
  "banextremo",
  "antipalavras",
  "bangringos",
  "antinsfwimagem",
  "proibirnsfw",
  "antisticker",
  "antimage",
  "antvideo",
  "antaudio",
  "antdoc",
  "antvcard",
];

const MODERATION_ACTION_KEY_SET = new Set<string>(MODERATION_ACTION_KEYS);

const defaultModerationActionInput = (key: BotGroupModerationActionKey) => ({
  deleteMessage: true,
  registerInfraction: true,
  banUser: key === "banextremo" || key === "bangringos",
  maxInfractions: key === "banextremo" || key === "bangringos" ? 1 : null,
});

const normalizeModerationMaxInfractions = (
  value: unknown,
  fallback: number | null,
): number | null => {
  if (value === null) {
    return null;
  }
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value).replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(20, Math.floor(parsed)));
};

const parseModerationActionsInput = (value: unknown): BotGroupModerationActions | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const actions: BotGroupModerationActions = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!MODERATION_ACTION_KEY_SET.has(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const source = raw as Record<string, unknown>;
    const current = {
      deleteMessage: normalizeBoolean(source.deleteMessage ?? source.delete_message ?? source.delete),
      registerInfraction: normalizeBoolean(
        source.registerInfraction ?? source.register_infraction ?? source.infraction,
      ),
      banUser: normalizeBoolean(source.banUser ?? source.ban_user ?? source.ban),
      maxInfractions: normalizeModerationMaxInfractions(
        source.maxInfractions ??
          source.max_infractions ??
          source.infractionLimit ??
          source.infraction_limit ??
          source.limit,
        null,
      ),
    };
    if (
      current.deleteMessage === undefined &&
      current.registerInfraction === undefined &&
      current.banUser === undefined &&
      current.maxInfractions === null
    ) {
      continue;
    }
    const actionKey = key as BotGroupModerationActionKey;
    const fallback = defaultModerationActionInput(actionKey);
    actions[actionKey] = {
      deleteMessage: current.deleteMessage ?? fallback.deleteMessage,
      registerInfraction: current.registerInfraction ?? fallback.registerInfraction,
      banUser: current.banUser ?? fallback.banUser,
      maxInfractions: current.maxInfractions ?? fallback.maxInfractions,
    };
  }

  return Object.keys(actions).length > 0 ? actions : undefined;
};

const parseAntispamConfigInput = (value: unknown): Partial<BotGroupAntispamConfig> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const parseIntBounded = (raw: unknown, min: number, max: number): number | undefined => {
    if (raw === undefined || raw === null || raw === "") {
      return undefined;
    }
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.max(min, Math.min(max, parsed));
  };

  const config: Partial<BotGroupAntispamConfig> = {};
  const burstLimit = parseIntBounded(
    source.burstLimit ?? source.burst_limit ?? source.messageLimit ?? source.message_limit,
    2,
    50,
  );
  if (burstLimit !== undefined) config.burstLimit = burstLimit;

  const burstWindowSeconds = parseIntBounded(
    source.burstWindowSeconds ?? source.burst_window_seconds ?? source.windowSeconds ?? source.window_seconds,
    2,
    60,
  );
  if (burstWindowSeconds !== undefined) config.burstWindowSeconds = burstWindowSeconds;

  const repeatLimit = parseIntBounded(source.repeatLimit ?? source.repeat_limit, 2, 20);
  if (repeatLimit !== undefined) config.repeatLimit = repeatLimit;

  const repeatWindowSeconds = parseIntBounded(
    source.repeatWindowSeconds ?? source.repeat_window_seconds,
    5,
    300,
  );
  if (repeatWindowSeconds !== undefined) config.repeatWindowSeconds = repeatWindowSeconds;

  const infractionResetDays = parseIntBounded(
    source.infractionResetDays ?? source.infraction_reset_days ?? source.resetDays ?? source.reset_days,
    1,
    365,
  );
  if (infractionResetDays !== undefined) config.infractionResetDays = infractionResetDays;

  return Object.keys(config).length > 0 ? config : undefined;
};

const COMMAND_TOGGLE_KEYS: (keyof BotGroupCommandToggles)[] = [
  "autoresposta",
  "botinterage",
  "vozbotinterage",
  "ouviraudiobotinterage",
  "lerimagem",
  "autosticker",
  "autodownloader",
  "bemvindo",
  "despedida",
  "antisticker",
  "antimage",
  "antvideo",
  "antaudio",
  "antdoc",
  "antvcard",
  "moderacaocomia",
  "antilink",
  "antilinkgp",
  "antipalavras",
  "banextremo",
  "bangringos",
  "antinsfwimagem",
  "proibirnsfw",
  "soadm",
  "brincadeiras",
  "linkmembro",
];

const parseCommandTogglesInput = (
  value: unknown,
): Partial<BotGroupCommandToggles> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const toggles: Partial<BotGroupCommandToggles> = {};
  for (const key of COMMAND_TOGGLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const normalized = normalizeBoolean((value as Record<string, unknown>)[key]);
      if (normalized !== undefined) {
        toggles[key] = normalized;
      }
    }
  }

  return Object.keys(toggles).length > 0 ? toggles : undefined;
};

const MENU_TEXT_KEYS: (keyof BotGroupMenuTexts)[] = [
  "main",
  "admin",
  "comandos",
  "outros",
  "downloads",
  "ativacoes",
  "jogos",
];

const sanitizeMenuTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[\r\n]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

  const parseMenuTextsInput = (
    value: unknown,
  ): Partial<BotGroupMenuTexts> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const source =
    typeof value === "string" && value.trim()
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;

  if (!source || typeof source !== "object") {
    return undefined;
  }

  let hasEntries = false;
  const result: Partial<BotGroupMenuTexts> = {};

  for (const key of MENU_TEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sanitized = sanitizeMenuTextList((source as Record<string, unknown>)[key]);
      result[key] = sanitized;
      hasEntries = true;
    }
  }

  return hasEntries ? result : undefined;
};

const normalizeAliasToken = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const parseCommandAliasesInput = (
  value: unknown,
): Record<string, string[]> | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string[]> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const canon = normalizeAliasToken(key);
    if (!canon) continue;
    const list = Array.isArray(v)
      ? v
      : typeof v === "string"
        ? v.split(/[\s,;]+/)
        : [];
    const normalized = Array.from(new Set(list.map((s) => normalizeAliasToken(String(s))).filter(Boolean)));
    if (normalized.length > 0) out[canon] = normalized;
  }
  return Object.keys(out).length ? out : undefined;
};

const parseReplyButtonsInput = (
  value: unknown,
): Record<string, unknown> | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return undefined;
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
};

const parseWelcomeConfigInput = (
  value: unknown,
): Partial<BotGroupWelcomeConfig> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const config: Partial<BotGroupWelcomeConfig> = {};
  const enabled = normalizeBoolean(source.enabled);
  if (enabled !== undefined) {
    config.enabled = enabled;
  }
  if (typeof source.caption === "string") {
    config.caption = source.caption;
  }
  if (Object.prototype.hasOwnProperty.call(source, "mediaUrl")) {
    config.mediaUrl = source.mediaUrl === null ? null : String(source.mediaUrl ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(source, "mediaPath")) {
    config.mediaPath = source.mediaPath === null ? null : String(source.mediaPath ?? "");
  }
  const useParticipantProfilePhoto = normalizeBoolean(
    source.useParticipantProfilePhoto ??
      source.use_participant_profile_photo ??
      source.useMemberProfilePhoto ??
      source.use_member_profile_photo,
  );
  if (useParticipantProfilePhoto !== undefined) {
    config.useParticipantProfilePhoto = useParticipantProfilePhoto;
  }
  const asSticker = normalizeBoolean(source.asSticker);
  if (asSticker !== undefined) {
    config.asSticker = asSticker;
  }

  if (Array.isArray(source.attachments)) {
    const attachments = (source.attachments as unknown[])
      .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
      .filter(Boolean)
      .map((rec) => {
        const kindRaw = typeof rec!.kind === "string" ? rec!.kind.trim().toLowerCase() : "";
        if (kindRaw === "vcard") {
          const name = typeof rec!.name === "string" ? rec!.name.trim() : "Contato";
          const vcard = typeof rec!.vcard === "string" ? rec!.vcard.replace(/\r\n/g, "\n").trim() : "";
          if (!vcard) return null;
          return { kind: "vcard", name, vcard } as any;
        }
        const kind = ["video", "audio", "document", "sticker"].includes(kindRaw) ? kindRaw : "image";
        const url = typeof rec!.url === "string" ? rec!.url.trim() : "";
        const path = typeof rec!.path === "string" ? rec!.path.trim() : "";
        if (!url && !path) return null;
        const fileName = typeof rec!.fileName === "string" ? rec!.fileName.trim() : null;
        const mimeType = typeof rec!.mimeType === "string" ? rec!.mimeType.trim() : null;
        const caption = typeof rec!.caption === "string" ? rec!.caption.trim() : null;
        return { kind, url: url || null, path: path || null, fileName, mimeType, caption } as any;
      })
      .filter(Boolean) as any[];
    (config as any).attachments = attachments;
  }
  if (
    Object.prototype.hasOwnProperty.call(source, "replyButtons") ||
    Object.prototype.hasOwnProperty.call(source, "reply_buttons")
  ) {
    const raw = source.replyButtons ?? source.reply_buttons;
    const parsed = parseReplyButtonsInput(raw);
    if (parsed !== undefined) {
      (config as any).replyButtons = parsed;
    }
  }

  return Object.keys(config).length > 0 ? config : undefined;
};

const parseFarewellConfigInput = (
  value: unknown,
): Partial<BotGroupFarewellConfig> | undefined =>
  parseWelcomeConfigInput(value) as Partial<BotGroupFarewellConfig> | undefined;

const parseAutoResponsesInput = (
  value: unknown,
): BotGroupAutoResponse[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const source =
    typeof value === "string" && value.trim()
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;

  if (source === null) {
    return [];
  }

  if (!Array.isArray(source)) {
    return undefined;
  }

  const seen = new Set<string>();

  const entries = source
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const normalized = normalizeAutoResponseEntry(entry as Partial<BotGroupAutoResponse>);
      if (
        typeof (entry as Record<string, unknown>).updatedAt !== "string" ||
        !(entry as Record<string, unknown>).updatedAt
      ) {
        normalized.updatedAt = new Date().toISOString();
      }

      return normalized;
    })
    .filter((entry): entry is BotGroupAutoResponse => Boolean(entry))
    .filter(
      (entry) =>
        entry.triggers.length > 0 &&
        (entry.responseText.length > 0 || entry.responseMedia !== null || entry.responseVcard !== null),
    )
    .filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    });

  return entries.slice(0, 50);
};

const parseHorapgConfigInput = (
  value: unknown,
): Partial<BotGroupHorapgConfig> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const config: Partial<BotGroupHorapgConfig> = {};

  if (Object.prototype.hasOwnProperty.call(source, "enabled")) {
    const enabled = normalizeBoolean(source.enabled);
    if (enabled !== undefined) {
      config.enabled = enabled;
    }
  }

  const timesSource = source.times ?? source.horarios ?? source.schedule;
  if (timesSource !== undefined) {
    if (timesSource === null) {
      config.times = [];
    } else if (Array.isArray(timesSource) || typeof timesSource === "string") {
      const tokens = parseHorapgTimesArgument(timesSource as any);
      config.times = tokens;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "imageUrl") || Object.prototype.hasOwnProperty.call(source, "image_url")) {
    const raw = (source.imageUrl ?? source.image_url) as unknown;
    if (raw === null) {
      config.imageUrl = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      config.imageUrl = trimmed.length > 0 ? trimmed : null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "imagePath") || Object.prototype.hasOwnProperty.call(source, "image_path")) {
    const raw = (source.imagePath ?? source.image_path) as unknown;
    if (raw === null) {
      config.imagePath = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      config.imagePath = trimmed.length > 0 ? trimmed.replace(/^\/+/, "") : null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "mentionAll") || Object.prototype.hasOwnProperty.call(source, "mention_all")) {
    const mention = normalizeBoolean(source.mentionAll ?? source.mention_all);
    if (mention !== undefined) {
      config.mentionAll = mention;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "timezone")) {
    const raw = source.timezone;
    if (raw === null) {
      config.timezone = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      config.timezone = trimmed.length > 0 ? trimmed : null;
    }
  }

  return Object.keys(config).length > 0 ? config : undefined;
};

const parseScheduleConfigInput = (
  value: unknown,
): Partial<BotGroupScheduleConfig> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const config: Partial<BotGroupScheduleConfig> = {};
  const normalizeOptionalMessage = (message: unknown): string | null | undefined => {
    if (message === null) {
      return null;
    }
    if (typeof message !== "string") {
      return undefined;
    }
    const trimmed = message.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const closeEnabled = normalizeBoolean(source.closeEnabled ?? source.close_enabled);
  if (closeEnabled !== undefined) {
    config.closeEnabled = closeEnabled;
  }

  const openEnabled = normalizeBoolean(source.openEnabled ?? source.open_enabled);
  if (openEnabled !== undefined) {
    config.openEnabled = openEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(source, "closeTimes") || Object.prototype.hasOwnProperty.call(source, "close_times")) {
    const rawTimes = source.closeTimes ?? source.close_times;
    if (rawTimes === null) {
      config.closeTimes = [];
    } else if (Array.isArray(rawTimes) || typeof rawTimes === "string") {
      config.closeTimes = parseHorapgTimesArgument(rawTimes as any);
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "closeMessage") || Object.prototype.hasOwnProperty.call(source, "close_message")) {
    const closeMessage = normalizeOptionalMessage(source.closeMessage ?? source.close_message);
    if (closeMessage !== undefined) {
      config.closeMessage = closeMessage;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "openTimes") || Object.prototype.hasOwnProperty.call(source, "open_times")) {
    const rawTimes = source.openTimes ?? source.open_times;
    if (rawTimes === null) {
      config.openTimes = [];
    } else if (Array.isArray(rawTimes) || typeof rawTimes === "string") {
      config.openTimes = parseHorapgTimesArgument(rawTimes as any);
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "openMessage") || Object.prototype.hasOwnProperty.call(source, "open_message")) {
    const openMessage = normalizeOptionalMessage(source.openMessage ?? source.open_message);
    if (openMessage !== undefined) {
      config.openMessage = openMessage;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "timezone")) {
    const rawTz = source.timezone;
    if (rawTz === null) {
      config.timezone = null;
    } else if (typeof rawTz === "string") {
      const trimmed = rawTz.trim();
      config.timezone = trimmed.length > 0 ? trimmed : null;
    }
  }

  return Object.keys(config).length > 0 ? config : undefined;
};

const parseAntiInactivityConfigInput = (
  value: unknown,
): Partial<BotGroupAntiInactivityConfig> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const config: Partial<BotGroupAntiInactivityConfig> = {};
  const parseBoundedInt = (raw: unknown, min: number, max: number): number | undefined => {
    if (raw === undefined || raw === null || raw === "") {
      return undefined;
    }
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.max(min, Math.min(max, parsed));
  };

  const enabled = normalizeBoolean(source.enabled);
  if (enabled !== undefined) {
    config.enabled = enabled;
  }

  const days = parseBoundedInt(source.days ?? source.inactiveDays ?? source.inactive_days, 1, 365);
  if (days !== undefined) {
    config.days = days;
  }

  const scanIntervalHours = parseBoundedInt(
    source.scanIntervalHours ?? source.scan_interval_hours ?? source.intervalHours ?? source.interval_hours,
    1,
    168,
  );
  if (scanIntervalHours !== undefined) {
    config.scanIntervalHours = scanIntervalHours;
  }

  const removeLimit = parseBoundedInt(source.removeLimit ?? source.remove_limit ?? source.limit, 1, 100);
  if (removeLimit !== undefined) {
    config.removeLimit = removeLimit;
  }

  if (Object.prototype.hasOwnProperty.call(source, "lastRunAt") || Object.prototype.hasOwnProperty.call(source, "last_run_at")) {
    const raw = source.lastRunAt ?? source.last_run_at;
    config.lastRunAt = raw === null ? null : String(raw ?? "").trim() || null;
  }

  if (
    Object.prototype.hasOwnProperty.call(source, "lastRemovedCount") ||
    Object.prototype.hasOwnProperty.call(source, "last_removed_count")
  ) {
    const count = parseBoundedInt(source.lastRemovedCount ?? source.last_removed_count, 0, 1000);
    if (count !== undefined) {
      config.lastRemovedCount = count;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "lastError") || Object.prototype.hasOwnProperty.call(source, "last_error")) {
    const raw = source.lastError ?? source.last_error;
    config.lastError = raw === null ? null : String(raw ?? "").trim() || null;
  }

  return Object.keys(config).length > 0 ? config : undefined;
};

const parsePremiumConfigInput = (
  value: unknown,
): Partial<BotGroupPremiumConfig> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const config: Partial<BotGroupPremiumConfig> = {};

  const enabled = normalizeBoolean(source.enabled);
  if (enabled !== undefined) {
    config.enabled = enabled;
  }

  if (Array.isArray(source.plans)) {
    config.plans = source.plans
      .map((entry, index) => {
        if (!entry || typeof entry !== "object") return null;
        const plan = entry as Record<string, unknown>;
        const keyRaw = typeof plan.key === "string" ? plan.key.trim().toLowerCase() : "";
        const label = typeof plan.label === "string" && plan.label.trim()
          ? plan.label.trim()
          : `Premium ${index + 1}`;
        const price = Number(plan.price ?? 0);
        const durationDays = Number.parseInt(String(plan.durationDays ?? plan.duration_days ?? 30), 10);
        return {
          key: keyRaw.replace(/[^a-z0-9_-]+/g, "") || `p${index + 1}`,
          label,
          price: Number.isFinite(price) && price >= 0 ? price : 0,
          durationDays: Number.isFinite(durationDays) && durationDays > 0 ? Math.min(durationDays, 3650) : 30,
          enabled: normalizeBoolean(plan.enabled) ?? true,
          description: typeof plan.description === "string" ? plan.description : null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .slice(0, 3);
  }

  if (Array.isArray(source.commandKeys) || Array.isArray(source.command_keys)) {
    const rawCommands = (source.commandKeys ?? source.command_keys) as unknown[];
    config.commandKeys = Array.from(
      new Set(
        rawCommands
          .map((entry) => normalizeAliasToken(String(entry ?? "")))
          .filter(Boolean),
      ),
    );
  }

  const price = Number(source.price);
  if (Number.isFinite(price) && price >= 0) {
    config.price = price;
  }

  const durationDays = Number.parseInt(String(source.durationDays ?? source.duration_days ?? ""), 10);
  if (Number.isFinite(durationDays) && durationDays > 0) {
    config.durationDays = Math.min(durationDays, 3650);
  }

  const bypassCoinCosts = normalizeBoolean(source.bypassCoinCosts ?? source.bypass_coin_costs);
  if (bypassCoinCosts !== undefined) {
    config.bypassCoinCosts = bypassCoinCosts;
  }

  return Object.keys(config).length > 0 ? config : undefined;
};

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim", "on"].includes(trimmed)) {
      return true;
    }
    if (["false", "0", "no", "nao", "não", "off"].includes(trimmed)) {
      return false;
    }
  }
  return undefined;
};

const normalizeMaxInfractions = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.min(parsed, 20);
};

const ensureAuthorizedGroup = async (groupId: number) => {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  }

  const access = await getGroupAccessForUser(user.id, groupId);
  if (!access) {
    return { error: NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 }) };
  }

  return {
    user,
    userRole: user.role,
    group: access.group,
    ownerUserId: access.ownerUserId,
  };
};

const buildMenuPreview = async (
  group: BotGroup,
  settings: BotGroupSettings,
  user: SessionUser,
) => {
  const prefix = settings.commandPrefixes[0]?.trim() || "/";
  const [menuConfig, siteSettings] = await Promise.all([
    getBotMenuConfigForUser(group.userId).catch(() => null),
    getAdminSiteSettings().catch(() => null),
  ]);
  const fallbackImageRef = resolveBotAdminMenuImagePath(
    group,
    menuConfig?.imagePath ?? null,
  );
  const officialGroupUrl =
    siteSettings?.officialGroups?.find(
      (entry) => entry.isActive && entry.inviteLink?.trim(),
    )?.inviteLink?.trim() ||
    siteSettings?.officialGroupInviteLink?.trim() ||
    null;
  const siteUrl = getPublicAppBaseUrl().replace(/\/+$/, "");
  const userPhone = user.whatsappNumber?.replace(/\D+/g, "") || "—";
  const botPhone = group.instancePhone?.replace(/\D+/g, "") || "—";
  const replacements: Record<string, string> = {
    usuario: user.name?.trim() || "Usuário",
    numerousuario: userPhone,
    numero: userPhone,
    numerobot: botPhone,
    prefix,
    prefixo: prefix,
    grupo: group.name,
    nomegrupo: group.name,
    bot: group.instanceName,
    nomebot: group.instanceName,
  };
  const mainDescription = renderConfiguredMenuSection(
    settings.menuTexts?.main,
    replacements,
    DEFAULT_MENU_TEXTS.main,
  );
  const kindMap: Array<{
    cardKind: BotGroupMenuCarousel["cards"][number]["kind"];
    menuKind: NativeMenuKind;
  }> = [
    { cardKind: "main", menuKind: "commands" },
    { cardKind: "admin", menuKind: "admin" },
    { cardKind: "downloads", menuKind: "downloads" },
    { cardKind: "fun", menuKind: "fun" },
  ];
  const render = (value: string | null | undefined): string | null => {
    const normalized = value?.trim();
    if (!normalized) return null;
    return normalized.replace(
      /\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g,
      (match, doubleKey, singleKey) => {
        const key = String(doubleKey ?? singleKey ?? "").toLowerCase();
        return Object.prototype.hasOwnProperty.call(replacements, key)
          ? replacements[key]
          : match;
      },
    );
  };
  return {
    cards: kindMap.map(({ cardKind, menuKind }) => {
      const configured = settings.menuCarousel.cards.find(
        (card) => card.kind === cardKind,
      );
      const copy = resolveBotAdminNativeMenuCopy(
        menuKind,
        group.name,
        group.instanceName,
      );
      const defaultSections = buildBotAdminNativeMenuSections(
        menuKind,
        prefix,
        settings.commandToggles,
      ).map((section, sectionIndex) => ({
        id: `section-${sectionIndex + 1}`,
        title: section.title,
        rows: section.rows.map((row, rowIndex) => ({
          id: `row-${sectionIndex + 1}-${rowIndex + 1}`,
          title: row.title,
          description: row.description ?? null,
          command: row.rowId ?? row.id ?? `${prefix}menu`,
        })),
      }));
      return {
        kind: cardKind,
        title: render(configured?.title) ?? copy.title,
        description:
          render(configured?.description) ??
          (cardKind === "main" ? mainDescription : null) ??
          copy.description,
        footerText: render(configured?.footerText) ?? copy.footerText,
        listButtonText:
          render(configured?.listButtonText) ?? copy.buttonText,
        effectiveImageRef:
          configured?.imageUrl?.trim() ||
          configured?.imagePath?.trim() ||
          fallbackImageRef,
        sections: configured?.sections ?? defaultSections,
        buttons:
          configured?.buttons ??
          [
            {
              id: "site",
              type: "url",
              label: "Site do BotAdmin",
              value: siteUrl,
            },
            ...(officialGroupUrl
              ? [{
                  id: "official-group",
                  type: "url" as const,
                  label: "Grupo oficial",
                  value: officialGroupUrl,
                }]
              : []),
          ],
      };
    }),
  };
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const { groupId: rawGroupId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  const auth = await ensureAuthorizedGroup(groupId);
  if ("error" in auth) {
    return auth.error;
  }

  try {
    const settings = await getGroupSettings(groupId);
    let nativeButtonsEnabled = false;
    try {
      if (auth.group.instanceId) {
        const instanceSettings = await getInstanceSettings(auth.group.instanceId);
        nativeButtonsEnabled = instanceSettings?.commandToggles.nativeButtons ?? false;
      }
    } catch (error) {
      console.error("Failed to load instance settings for native buttons", {
        groupId,
        instanceId: auth.group.instanceId,
        error,
      });
    }
    const menuPreview = await buildMenuPreview(auth.group, settings, auth.user);
    return NextResponse.json({
      settings,
      meta: {
        nativeButtonsEnabled,
        menuPreview,
      },
    });
  } catch (error) {
    console.error("Failed to load bot group settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações do grupo." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const { groupId: rawGroupId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  const auth = await ensureAuthorizedGroup(groupId);
  if ("error" in auth) {
    return auth.error;
  }
  const isInternalGroup = auth.group.remoteId.startsWith("botadmin-internal:");
  if (!isInternalGroup) {
    const instance = await getInstanceForUser(
      auth.group.userId,
      auth.group.instanceId,
    );
    if (!instance) {
      return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    }
    const profileViolation = await evaluatePlanGuard({
      userId: auth.group.userId,
      instance,
      group: auth.group,
    });
    if (profileViolation?.type === "instance") {
      return NextResponse.json(
        {
          code: "PROFILE_EXPIRED",
          message: "Renove este perfil para alterar as ativações.",
          expiresAt: instance.expiresAt,
        },
        { status: 402 },
      );
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
  }

  const updates: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">> & {
    menuTexts?: Partial<BotGroupMenuTexts>;
  } = {};

  const antilink = normalizeBoolean(payload.antilink);
  if (antilink !== undefined) {
    updates.antilink = antilink;
  }

  const antilinkGroupInvite = normalizeBoolean(payload.antilinkGroupInvite ?? payload.antilink_group_invite);
  if (antilinkGroupInvite !== undefined) {
    updates.antilinkGroupInvite = antilinkGroupInvite;
  }

  const banExtremo = normalizeBoolean(payload.banExtremo ?? payload.ban_extremo);
  if (banExtremo !== undefined) {
    updates.banExtremo = banExtremo;
  }

  const autoRead = normalizeBoolean(payload.autoRead ?? payload.auto_read);
  if (autoRead !== undefined) {
    updates.autoRead = autoRead;
  }

  const planRenewalAdminsOnly = normalizeBoolean(
    payload.planRenewalAdminsOnly ?? payload.plan_renewal_admins_only,
  );
  if (planRenewalAdminsOnly !== undefined) {
    updates.planRenewalAdminsOnly = planRenewalAdminsOnly;
  }

  const planRenewalSilent = normalizeBoolean(
    payload.planRenewalSilent ?? payload.plan_renewal_silent,
  );
  if (planRenewalSilent !== undefined) {
    updates.planRenewalSilent = planRenewalSilent;
  }

  const allowedLinks = parseListInput(payload.allowedLinks ?? payload.allowed_links);
  if (allowedLinks !== undefined) {
    updates.allowedLinks = allowedLinks;
  }

  const allowedDdis = parseListInput(payload.allowedDdis ?? payload.allowed_ddis);
  if (allowedDdis !== undefined) {
    updates.allowedDdis = allowedDdis;
  }

  const blacklistInput =
    parseListInput(
      payload.blacklist ??
        (payload as Record<string, unknown>).blacklistMembers ??
        (payload as Record<string, unknown>).blacklist_members,
    );
  if (blacklistInput !== undefined) {
    updates.blacklist = sanitizeDigitsList(blacklistInput);
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "antifakeMessage") ||
    Object.prototype.hasOwnProperty.call(payload, "antifake_message")
  ) {
    const rawMessage =
      (payload as Record<string, unknown>).antifakeMessage ??
      (payload as Record<string, unknown>).antifake_message;
    if (rawMessage === null || rawMessage === undefined) {
      updates.antifakeMessage = "";
    } else if (typeof rawMessage === "string") {
      updates.antifakeMessage = rawMessage;
    }
  }

  const bannedWords = parseListInput(payload.bannedWords ?? payload.banned_words);
  if (bannedWords !== undefined) {
    updates.bannedWords = bannedWords;
  }

  const groqKeysInput = parseListInput(payload.groqKeys ?? payload.groq_keys);
  if (groqKeysInput !== undefined) {
    const sanitized = groqKeysInput
      .map((entry) => entry.replace(/\s+/g, ""))
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
    updates.groqKeys = sanitized;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "aiProvider") ||
    Object.prototype.hasOwnProperty.call(payload, "ai_provider")
  ) {
    const provider = String(payload.aiProvider ?? payload.ai_provider ?? "").trim();
    if (provider === "groq" || provider === "openai" || provider === "chatgpt_system") {
      updates.aiProvider = provider;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "openAiApiKey") ||
    Object.prototype.hasOwnProperty.call(payload, "openai_api_key")
  ) {
    const rawKey = payload.openAiApiKey ?? payload.openai_api_key;
    if (rawKey === null || rawKey === "") {
      updates.openAiApiKey = null;
    } else if (typeof rawKey === "string") {
      updates.openAiApiKey = rawKey.replace(/\s+/g, "").slice(0, 4000);
    }
  }

  if (typeof payload.aiPrompt === "string") {
    updates.aiPrompt = payload.aiPrompt;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "aiToolsPrompt") ||
    Object.prototype.hasOwnProperty.call(payload, "ai_tools_prompt")
  ) {
    const rawToolsPrompt = (payload.aiToolsPrompt ?? payload.ai_tools_prompt) as unknown;
    if (typeof rawToolsPrompt === "string" && auth.userRole === "admin") {
      updates.aiToolsPrompt = rawToolsPrompt;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "aiVoice") ||
    Object.prototype.hasOwnProperty.call(payload, "ai_voice")
  ) {
    const rawVoice = (payload.aiVoice ?? payload.ai_voice) as unknown;
    if (rawVoice === null) {
      updates.aiVoice = null;
    } else if (typeof rawVoice === "string") {
      updates.aiVoice = rawVoice;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "aiModel") ||
    Object.prototype.hasOwnProperty.call(payload, "ai_model")
  ) {
    const rawModel = (payload.aiModel ?? payload.ai_model) as unknown;
    if (rawModel === null) {
      updates.aiModel = null;
    } else if (typeof rawModel === "string") {
      updates.aiModel = rawModel;
    }
  }

  if (Array.isArray(payload.aiMemory)) {
    updates.aiMemory = [];
  } else if (payload.aiMemory === null) {
    updates.aiMemory = [];
  }

  const commandPrefixesInput = parseListInput(
    payload.commandPrefixes ?? payload.command_prefixes,
  );
  if (commandPrefixesInput !== undefined) {
    const sanitized = commandPrefixesInput
      .map((entry) => entry.replace(/\s+/g, ""))
      .filter((entry) => entry.length > 0);
    const unique = sanitized.filter((entry, index, array) => array.indexOf(entry) === index);
    updates.commandPrefixes = unique.slice(0, 10);
  }

  const allowCommandsWithoutPrefix = normalizeBoolean(
    payload.allowCommandsWithoutPrefix ?? payload.allow_commands_without_prefix,
  );
  if (allowCommandsWithoutPrefix !== undefined) {
    updates.allowCommandsWithoutPrefix = allowCommandsWithoutPrefix;
  }

  const commandToggles = parseCommandTogglesInput(
    payload.commandToggles ?? payload.command_toggles,
  );
  const commandAliases = parseCommandAliasesInput((payload as any).commandAliases ?? (payload as any).command_aliases);
  if (commandToggles !== undefined) {
    updates.commandToggles = commandToggles;
  }
  if (commandAliases !== undefined) {
    updates.commandAliases = commandAliases;
  }

  const menuTexts = parseMenuTextsInput(payload.menuTexts ?? payload.menu_texts);
  if (menuTexts !== undefined) {
    updates.menuTexts = menuTexts;
  }

  const menuCarouselInput = payload.menuCarousel ?? payload.menu_carousel;
  if (
    menuCarouselInput &&
    typeof menuCarouselInput === "object" &&
    !Array.isArray(menuCarouselInput)
  ) {
    const cards = (menuCarouselInput as Record<string, unknown>).cards;
    if (Array.isArray(cards)) {
      updates.menuCarousel = { cards } as unknown as BotGroupMenuCarousel;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "autoResponses") ||
    Object.prototype.hasOwnProperty.call(payload, "auto_responses")
  ) {
    const autoResponses = parseAutoResponsesInput(
      payload.autoResponses ?? payload.auto_responses,
    );
    if (autoResponses !== undefined) {
      updates.autoResponses = autoResponses;
    }
  }

  const horapgConfigPayload =
    Object.prototype.hasOwnProperty.call(payload, "horapgConfig") ||
    Object.prototype.hasOwnProperty.call(payload, "horapg_config")
      ? parseHorapgConfigInput(payload.horapgConfig ?? payload.horapg_config)
      : undefined;

  const horapgUpdates: Partial<BotGroupHorapgConfig> = horapgConfigPayload ? { ...horapgConfigPayload } : {};

  const horapgEnabled = normalizeBoolean(payload.horapgEnabled ?? payload.horapg_enabled);
  if (horapgEnabled !== undefined) {
    horapgUpdates.enabled = horapgEnabled;
  }

  const horapgTimesInput = payload.horapgTimes ?? payload.horapg_times;
  if (horapgTimesInput !== undefined) {
    if (horapgTimesInput === null) {
      horapgUpdates.times = [];
    } else if (Array.isArray(horapgTimesInput) || typeof horapgTimesInput === "string") {
      horapgUpdates.times = parseHorapgTimesArgument(horapgTimesInput as any);
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "horapgImageUrl") ||
    Object.prototype.hasOwnProperty.call(payload, "horapg_image_url")
  ) {
    const raw = payload.horapgImageUrl ?? payload.horapg_image_url;
    if (raw === null) {
      horapgUpdates.imageUrl = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      horapgUpdates.imageUrl = trimmed.length > 0 ? trimmed : null;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "horapgMentionAll") ||
    Object.prototype.hasOwnProperty.call(payload, "horapg_mention_all")
  ) {
    const mention = normalizeBoolean(payload.horapgMentionAll ?? payload.horapg_mention_all);
    if (mention !== undefined) {
      horapgUpdates.mentionAll = mention;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "horapgTimezone") ||
    Object.prototype.hasOwnProperty.call(payload, "horapg_timezone")
  ) {
    const raw = payload.horapgTimezone ?? payload.horapg_timezone;
    if (raw === null) {
      horapgUpdates.timezone = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      horapgUpdates.timezone = trimmed.length > 0 ? trimmed : null;
    }
  }

  if (Object.keys(horapgUpdates).length > 0) {
    updates.horapgConfig = horapgUpdates;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "botCoins") ||
    Object.prototype.hasOwnProperty.call(payload, "bot_coins")
  ) {
    updates.botCoins = (payload as Record<string, unknown>).botCoins ?? (payload as Record<string, unknown>).bot_coins;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "premium") ||
    Object.prototype.hasOwnProperty.call(payload, "premium_config")
  ) {
    const premium = parsePremiumConfigInput(
      (payload as Record<string, unknown>).premium ??
        (payload as Record<string, unknown>).premium_config,
    );
    if (premium !== undefined) {
      updates.premium = premium as BotGroupPremiumConfig;
    }
  }

  const scheduleConfigPayload =
    Object.prototype.hasOwnProperty.call(payload, "scheduleConfig") ||
    Object.prototype.hasOwnProperty.call(payload, "schedule_config")
      ? parseScheduleConfigInput(payload.scheduleConfig ?? payload.schedule_config)
      : undefined;

  const scheduleUpdates: Partial<BotGroupScheduleConfig> = scheduleConfigPayload ? { ...scheduleConfigPayload } : {};

  const scheduleCloseEnabled = normalizeBoolean(
    payload.scheduleCloseEnabled ?? payload.schedule_close_enabled,
  );
  if (scheduleCloseEnabled !== undefined) {
    scheduleUpdates.closeEnabled = scheduleCloseEnabled;
  }

  const scheduleOpenEnabled = normalizeBoolean(
    payload.scheduleOpenEnabled ?? payload.schedule_open_enabled,
  );
  if (scheduleOpenEnabled !== undefined) {
    scheduleUpdates.openEnabled = scheduleOpenEnabled;
  }

  const scheduleCloseTimesInput = payload.scheduleCloseTimes ?? payload.schedule_close_times;
  if (scheduleCloseTimesInput !== undefined) {
    if (scheduleCloseTimesInput === null) {
      scheduleUpdates.closeTimes = [];
    } else if (Array.isArray(scheduleCloseTimesInput) || typeof scheduleCloseTimesInput === "string") {
      scheduleUpdates.closeTimes = parseHorapgTimesArgument(scheduleCloseTimesInput as any);
    }
  }

  const scheduleOpenTimesInput = payload.scheduleOpenTimes ?? payload.schedule_open_times;
  if (scheduleOpenTimesInput !== undefined) {
    if (scheduleOpenTimesInput === null) {
      scheduleUpdates.openTimes = [];
    } else if (Array.isArray(scheduleOpenTimesInput) || typeof scheduleOpenTimesInput === "string") {
      scheduleUpdates.openTimes = parseHorapgTimesArgument(scheduleOpenTimesInput as any);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "scheduleCloseMessage") || Object.prototype.hasOwnProperty.call(payload, "schedule_close_message")) {
    const raw = payload.scheduleCloseMessage ?? payload.schedule_close_message;
    if (raw === null) {
      scheduleUpdates.closeMessage = null;
    } else if (typeof raw === "string") {
      scheduleUpdates.closeMessage = raw.trim() || null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "scheduleOpenMessage") || Object.prototype.hasOwnProperty.call(payload, "schedule_open_message")) {
    const raw = payload.scheduleOpenMessage ?? payload.schedule_open_message;
    if (raw === null) {
      scheduleUpdates.openMessage = null;
    } else if (typeof raw === "string") {
      scheduleUpdates.openMessage = raw.trim() || null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "scheduleTimezone") || Object.prototype.hasOwnProperty.call(payload, "schedule_timezone")) {
    const raw = payload.scheduleTimezone ?? payload.schedule_timezone;
    if (raw === null) {
      scheduleUpdates.timezone = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      scheduleUpdates.timezone = trimmed.length > 0 ? trimmed : null;
    }
  }

  if (Object.keys(scheduleUpdates).length > 0) {
    updates.scheduleConfig = scheduleUpdates;
  }

  const antiInactivityConfigPayload =
    Object.prototype.hasOwnProperty.call(payload, "antiInactivityConfig") ||
    Object.prototype.hasOwnProperty.call(payload, "anti_inactivity_config")
      ? parseAntiInactivityConfigInput(payload.antiInactivityConfig ?? payload.anti_inactivity_config)
      : undefined;

  const antiInactivityUpdates: Partial<BotGroupAntiInactivityConfig> = antiInactivityConfigPayload
    ? { ...antiInactivityConfigPayload }
    : {};

  const antiInactivityEnabled = normalizeBoolean(
    payload.antiInactivityEnabled ?? payload.anti_inactivity_enabled,
  );
  if (antiInactivityEnabled !== undefined) {
    antiInactivityUpdates.enabled = antiInactivityEnabled;
  }

  const parseAntiInactivityNumber = (value: unknown, min: number, max: number): number | undefined => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.max(min, Math.min(max, parsed));
  };

  const antiInactivityDays = parseAntiInactivityNumber(
    payload.antiInactivityDays ?? payload.anti_inactivity_days,
    1,
    365,
  );
  if (antiInactivityDays !== undefined) {
    antiInactivityUpdates.days = antiInactivityDays;
  }

  const antiInactivityScanIntervalHours = parseAntiInactivityNumber(
    payload.antiInactivityScanIntervalHours ?? payload.anti_inactivity_scan_interval_hours,
    1,
    168,
  );
  if (antiInactivityScanIntervalHours !== undefined) {
    antiInactivityUpdates.scanIntervalHours = antiInactivityScanIntervalHours;
  }

  const antiInactivityRemoveLimit = parseAntiInactivityNumber(
    payload.antiInactivityRemoveLimit ?? payload.anti_inactivity_remove_limit,
    1,
    100,
  );
  if (antiInactivityRemoveLimit !== undefined) {
    antiInactivityUpdates.removeLimit = antiInactivityRemoveLimit;
  }

  if (Object.keys(antiInactivityUpdates).length > 0) {
    updates.antiInactivityConfig = antiInactivityUpdates as BotGroupAntiInactivityConfig;
  }

  const antispamConfigPayload =
    Object.prototype.hasOwnProperty.call(payload, "antispamConfig") ||
    Object.prototype.hasOwnProperty.call(payload, "antispam_config")
      ? parseAntispamConfigInput(payload.antispamConfig ?? payload.antispam_config)
      : undefined;

  const antispamUpdates: Partial<BotGroupAntispamConfig> = antispamConfigPayload
    ? { ...antispamConfigPayload }
    : {};

  const parseAntispamNumber = (value: unknown, min: number, max: number): number | undefined => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.max(min, Math.min(max, parsed));
  };

  const antispamBurstLimit = parseAntispamNumber(
    payload.antispamBurstLimit ?? payload.antispam_burst_limit ?? payload.antispamLimit,
    2,
    50,
  );
  if (antispamBurstLimit !== undefined) {
    antispamUpdates.burstLimit = antispamBurstLimit;
  }

  const antispamBurstWindowSeconds = parseAntispamNumber(
    payload.antispamBurstWindowSeconds ??
      payload.antispam_burst_window_seconds ??
      payload.antispamWindowSeconds,
    2,
    60,
  );
  if (antispamBurstWindowSeconds !== undefined) {
    antispamUpdates.burstWindowSeconds = antispamBurstWindowSeconds;
  }

  const antispamResetDays = parseAntispamNumber(
    payload.antispamResetDays ?? payload.antispam_reset_days ?? payload.infractionResetDays,
    1,
    365,
  );
  if (antispamResetDays !== undefined) {
    antispamUpdates.infractionResetDays = antispamResetDays;
  }

  if (Object.keys(antispamUpdates).length > 0) {
    updates.antispamConfig = antispamUpdates as BotGroupAntispamConfig;
  }

  let welcomeConfig = parseWelcomeConfigInput(
    payload.welcomeConfig ?? payload.welcome_config,
  );
  const welcomeEnabled = normalizeBoolean(
    payload.welcomeEnabled ?? payload.welcome_enabled ?? payload.bemvindo,
  );
  if (welcomeEnabled !== undefined) {
    welcomeConfig = { ...(welcomeConfig ?? {}), enabled: welcomeEnabled };
  }
  if (typeof payload.welcomeCaption === "string") {
    welcomeConfig = { ...(welcomeConfig ?? {}), caption: payload.welcomeCaption };
  }
  if (Object.prototype.hasOwnProperty.call(payload, "welcomeMediaUrl")) {
    const raw = payload.welcomeMediaUrl;
    if (raw === null) {
      welcomeConfig = { ...(welcomeConfig ?? {}), mediaUrl: null };
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      welcomeConfig = {
        ...(welcomeConfig ?? {}),
        mediaUrl: trimmed.length > 0 ? trimmed : null,
      };
    } else {
      welcomeConfig = { ...(welcomeConfig ?? {}), mediaUrl: String(raw ?? "") };
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "welcomeMediaPath")) {
    const raw = payload.welcomeMediaPath;
    welcomeConfig = {
      ...(welcomeConfig ?? {}),
      mediaPath: raw === null ? null : typeof raw === "string" ? raw : String(raw ?? ""),
    };
  }
  const welcomeUseParticipantProfilePhoto = normalizeBoolean(
    payload.welcomeUseParticipantProfilePhoto ??
      payload.welcome_use_participant_profile_photo ??
      payload.welcomeUseMemberProfilePhoto ??
      payload.welcome_use_member_profile_photo,
  );
  if (welcomeUseParticipantProfilePhoto !== undefined) {
    welcomeConfig = {
      ...(welcomeConfig ?? {}),
      useParticipantProfilePhoto: welcomeUseParticipantProfilePhoto,
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, "welcomeReplyButtons") ||
    Object.prototype.hasOwnProperty.call(payload, "welcome_reply_buttons")
  ) {
    const raw =
      (payload as Record<string, unknown>).welcomeReplyButtons ??
      (payload as Record<string, unknown>).welcome_reply_buttons;
    welcomeConfig = {
      ...(welcomeConfig ?? {}),
      replyButtons: raw as Record<string, unknown> | null | undefined,
    };
  }
  const welcomeSticker = normalizeBoolean(
    payload.welcomeAsSticker ?? payload.welcome_as_sticker,
  );
  if (welcomeSticker !== undefined) {
    welcomeConfig = { ...(welcomeConfig ?? {}), asSticker: welcomeSticker };
  }
  if (welcomeConfig !== undefined) {
    updates.welcomeConfig = welcomeConfig;
  }

  let farewellConfig = parseFarewellConfigInput(
    payload.farewellConfig ?? payload.farewell_config,
  );
  const farewellEnabled = normalizeBoolean(
    payload.farewellEnabled ?? payload.farewell_enabled ?? payload.despedida,
  );
  if (farewellEnabled !== undefined) {
    farewellConfig = { ...(farewellConfig ?? {}), enabled: farewellEnabled };
  }
  if (typeof payload.farewellCaption === "string") {
    farewellConfig = { ...(farewellConfig ?? {}), caption: payload.farewellCaption };
  }
  if (Object.prototype.hasOwnProperty.call(payload, "farewellMediaUrl")) {
    const raw = payload.farewellMediaUrl;
    if (raw === null) {
      farewellConfig = { ...(farewellConfig ?? {}), mediaUrl: null };
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      farewellConfig = {
        ...(farewellConfig ?? {}),
        mediaUrl: trimmed.length > 0 ? trimmed : null,
      };
    } else {
      farewellConfig = { ...(farewellConfig ?? {}), mediaUrl: String(raw ?? "") };
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "farewellMediaPath")) {
    const raw = payload.farewellMediaPath;
    farewellConfig = {
      ...(farewellConfig ?? {}),
      mediaPath: raw === null ? null : typeof raw === "string" ? raw : String(raw ?? ""),
    };
  }
  const farewellUseParticipantProfilePhoto = normalizeBoolean(
    payload.farewellUseParticipantProfilePhoto ??
      payload.farewell_use_participant_profile_photo ??
      payload.farewellUseMemberProfilePhoto ??
      payload.farewell_use_member_profile_photo,
  );
  if (farewellUseParticipantProfilePhoto !== undefined) {
    farewellConfig = {
      ...(farewellConfig ?? {}),
      useParticipantProfilePhoto: farewellUseParticipantProfilePhoto,
    };
  }
  const farewellSticker = normalizeBoolean(
    payload.farewellAsSticker ?? payload.farewell_as_sticker,
  );
  if (farewellSticker !== undefined) {
    farewellConfig = { ...(farewellConfig ?? {}), asSticker: farewellSticker };
  }
  if (farewellConfig !== undefined) {
    updates.farewellConfig = farewellConfig;
  }

  const featureFlags = parseFeatureFlagsInput(payload.featureFlags ?? payload.feature_flags);
  if (featureFlags !== undefined) {
    updates.featureFlags = featureFlags;
  }

  const moderationActions = parseModerationActionsInput(
    payload.moderationActions ?? payload.moderation_actions,
  );
  if (moderationActions !== undefined) {
    updates.moderationActions = moderationActions;
  }

  const maxInfractions = normalizeMaxInfractions(payload.maxInfractions ?? payload.max_infractions);
  if (maxInfractions !== undefined) {
    updates.maxInfractions = maxInfractions;
  }

  const hasUnknownTemplateField =
    Object.prototype.hasOwnProperty.call(payload, "unknownCommandTemplate") ||
    Object.prototype.hasOwnProperty.call(payload, "unknown_command_template");
  if (hasUnknownTemplateField) {
    const raw =
      (payload as Record<string, unknown>).unknownCommandTemplate ??
      (payload as Record<string, unknown>).unknown_command_template;
    if (raw === null) {
      updates.unknownCommandTemplate = null;
    } else if (typeof raw === "string") {
      updates.unknownCommandTemplate = raw.replace(/\r\n/g, "\n");
    } else if (raw === undefined) {
      updates.unknownCommandTemplate = null;
    } else {
      updates.unknownCommandTemplate = String(raw);
    }
  }

  const antipalavrasLimit = normalizeMaxInfractions(
    payload.antipalavrasMaxInfractions ?? payload.antipalavras_max_infractions,
  );
  if (antipalavrasLimit !== undefined) {
    updates.antipalavrasMaxInfractions = antipalavrasLimit;
  }

  const muteBanLimit = normalizeMaxInfractions(
    payload.muteBanLimit ?? payload.mute_ban_limit,
  );
  if (muteBanLimit !== undefined) {
    updates.muteBanLimit = muteBanLimit;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: "Nenhuma alteração informada." }, { status: 400 });
  }

  try {
    const settings = await upsertGroupSettings(groupId, updates);
    void publishBotGroupRealtimeUpdate(
      [auth.user.id, auth.ownerUserId],
      auth.group,
      "bot.group.settings.updated",
    );
    return NextResponse.json({
      message: "Configurações atualizadas com sucesso.",
      settings,
    });
  } catch (error) {
    console.error("Failed to update bot group settings", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações." },
      { status: 500 },
    );
  }
}
