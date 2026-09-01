import { RowDataPacket } from "mysql2";

import {
  DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
  DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
  DEFAULT_NOTIFICATION_VOICE,
  NOTIFICATION_VOICE_ID_SET,
} from "data/notification-audio";
import type {
  NotificationSpeechMode,
  UserNotificationAudioSettings,
} from "types/notifications";
import {
  ensureUserNotificationAudioSettingsTable,
  getDb,
  UserNotificationAudioSettingsRow,
} from "./db";

const MAX_TEMPLATE_LENGTH = 160;

const sanitizeBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    return !["0", "false", "no", "off"].includes(normalized);
  }
  return fallback;
};

const sanitizeSpeechMode = (value: unknown, fallback: NotificationSpeechMode): NotificationSpeechMode => {
  if (value === "browser" || value === "api") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "browser" || normalized === "api") {
      return normalized;
    }
  }
  return fallback;
};

const sanitizeVoice = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }
  if (NOTIFICATION_VOICE_ID_SET.has(normalized)) {
    return normalized;
  }
  return fallback;
};

const sanitizeTemplate = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.length > MAX_TEMPLATE_LENGTH) {
    return trimmed.slice(0, MAX_TEMPLATE_LENGTH);
  }
  return trimmed;
};

export const DEFAULT_USER_NOTIFICATION_AUDIO_SETTINGS: UserNotificationAudioSettings = {
  soundsEnabled: true,
  ttsEnabled: true,
  speechMode: "api",
  speechVoice: DEFAULT_NOTIFICATION_VOICE,
  purchaseTemplate: DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  balanceTemplate: DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  raffleTemplate: DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
  planTemplate: DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
  updatedAt: null,
};

const mapRowToSettings = (
  row: UserNotificationAudioSettingsRow,
): UserNotificationAudioSettings => ({
  soundsEnabled: row.sounds_enabled === 1,
  ttsEnabled: row.tts_enabled === 1,
  speechMode: row.speech_mode === "browser" ? "browser" : "api",
  speechVoice: row.speech_voice || DEFAULT_NOTIFICATION_VOICE,
  purchaseTemplate: row.purchase_template || DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  balanceTemplate: row.balance_template || DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  raffleTemplate: row.raffle_template || DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
  planTemplate: row.plan_template || DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

export const getUserNotificationAudioSettings = async (
  userId: number,
): Promise<UserNotificationAudioSettings> => {
  await ensureUserNotificationAudioSettingsTable();
  const db = getDb();

  const [rows] = await db.query<
    (UserNotificationAudioSettingsRow & RowDataPacket)[]
  >(
    `SELECT * FROM user_notification_audio_settings WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  if (Array.isArray(rows) && rows.length > 0) {
    return mapRowToSettings(rows[0]);
  }

  return DEFAULT_USER_NOTIFICATION_AUDIO_SETTINGS;
};

export const saveUserNotificationAudioSettings = async (
  userId: number,
  payload: Partial<UserNotificationAudioSettings>,
): Promise<UserNotificationAudioSettings> => {
  await ensureUserNotificationAudioSettingsTable();
  const db = getDb();

  const current = await getUserNotificationAudioSettings(userId).catch(() =>
    DEFAULT_USER_NOTIFICATION_AUDIO_SETTINGS,
  );

  const soundsEnabled = sanitizeBoolean(payload.soundsEnabled, current.soundsEnabled);
  const ttsEnabled = sanitizeBoolean(payload.ttsEnabled, current.ttsEnabled);
  const speechMode = sanitizeSpeechMode(payload.speechMode, current.speechMode);
  const speechVoice = sanitizeVoice(payload.speechVoice, current.speechVoice);
  const purchaseTemplate = sanitizeTemplate(
    payload.purchaseTemplate,
    current.purchaseTemplate,
  );
  const balanceTemplate = sanitizeTemplate(
    payload.balanceTemplate,
    current.balanceTemplate,
  );
  const raffleTemplate = sanitizeTemplate(
    payload.raffleTemplate,
    current.raffleTemplate,
  );
  const planTemplate = sanitizeTemplate(
    payload.planTemplate,
    current.planTemplate,
  );

  await db.query(
    `
      INSERT INTO user_notification_audio_settings (
        user_id,
        sounds_enabled,
        tts_enabled,
        speech_mode,
        speech_voice,
        purchase_template,
        balance_template,
        raffle_template,
        plan_template
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        sounds_enabled = VALUES(sounds_enabled),
        tts_enabled = VALUES(tts_enabled),
        speech_mode = VALUES(speech_mode),
        speech_voice = VALUES(speech_voice),
        purchase_template = VALUES(purchase_template),
        balance_template = VALUES(balance_template),
        raffle_template = VALUES(raffle_template),
        plan_template = VALUES(plan_template),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      soundsEnabled ? 1 : 0,
      ttsEnabled ? 1 : 0,
      speechMode,
      speechVoice,
      purchaseTemplate,
      balanceTemplate,
      raffleTemplate,
      planTemplate,
    ],
  );

  return {
    soundsEnabled,
    ttsEnabled,
    speechMode,
    speechVoice,
    purchaseTemplate,
    balanceTemplate,
    raffleTemplate,
    planTemplate,
    updatedAt: new Date().toISOString(),
  };
};
