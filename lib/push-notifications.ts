import type { MulticastMessage } from "firebase-admin/messaging";
import type { RowDataPacket } from "mysql2";

import {
  ensurePushSubscriptionTable,
  getDb,
  PushSubscriptionRow,
} from "lib/db";
import { getFirebaseMessagingAsync } from "lib/firebase-admin";
import { getAdminSiteSettings } from "lib/admin-site";

export type PushPlatform = "android" | "ios" | "web";

export const ANDROID_NOTIFICATION_CHANNEL_ID = "botadmin_support_messages_v2";
export const ANDROID_REALTIME_MESSAGES_CHANNEL_ID = "botadmin_realtime_messages_v5";
export const ANDROID_NOTIFICATION_SOUND = "ba_receive";
export const ANDROID_TTS_DEFAULT_LOCALE = "pt-BR";

export type AndroidPushOptions = {
  channelId?: string | null;
  sound?: string | null;
  soundUrl?: string | null;
  speakText?: string | null;
  speakLocale?: string | null;
  speechMode?: "browser" | "api" | null;
  speechVoice?: string | null;
  speakUrl?: string | null;
  imageUrl?: string | null;
};

const INVALID_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  if (items.length <= size) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

export const registerPushSubscription = async (
  userId: number,
  payload: {
    token: string;
    platform: PushPlatform;
    deviceId?: string | null;
  },
): Promise<void> => {
  const token = payload.token.trim();
  if (!token) {
    throw new Error("Token de push invalido.");
  }

  await ensurePushSubscriptionTable();
  const db = getDb();

  await db.query(
    `
      INSERT INTO push_subscriptions (user_id, token, platform, device_id, last_seen_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        platform = VALUES(platform),
        device_id = VALUES(device_id),
        last_seen_at = VALUES(last_seen_at),
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, token, payload.platform, payload.deviceId ?? null],
  );
};

export const unregisterPushSubscription = async (
  token: string,
): Promise<void> => {
  const normalized = token.trim();
  if (!normalized) {
    return;
  }

  await ensurePushSubscriptionTable();
  const db = getDb();
  await db.query(`DELETE FROM push_subscriptions WHERE token = ?`, [normalized]);
};

export const listPushSubscriptionsForUser = async (
  userId: number,
): Promise<PushSubscriptionRow[]> => {
  await ensurePushSubscriptionTable();
  const db = getDb();

  const [rows] = await db.query<PushSubscriptionRow[]>(
    `SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId],
  );

  return rows;
};

const removeInvalidTokens = async (tokens: string[]): Promise<void> => {
  if (!tokens.length) {
    return;
  }

  const db = getDb();
  const placeholders = tokens.map(() => "?").join(", ");
  await db.query(`DELETE FROM push_subscriptions WHERE token IN (${placeholders})`, tokens);
};

export const sendPushNotification = async (
  payload: {
    tokens: string[];
    notification?: MulticastMessage["notification"];
    data?: Record<string, string | number | boolean | null>;
    android?: AndroidPushOptions;
  },
): Promise<void> => {
  if (!payload.tokens.length) {
    return;
  }

  const messaging = await getFirebaseMessagingAsync();

  const androidChannelId =
    typeof payload.android?.channelId === "string" && payload.android.channelId.trim()
      ? payload.android.channelId.trim()
      : ANDROID_NOTIFICATION_CHANNEL_ID;

  const rawSound = payload.android?.sound;
  const rawSoundUrl = payload.android?.soundUrl;
  let androidSound: string | undefined;
  let androidSoundUrl: string | undefined;

  if (typeof rawSound === "string") {
    const trimmed = rawSound.trim();
    if (trimmed) {
      androidSound = trimmed;
    }
  } else if (rawSound === null) {
    androidSound = undefined;
  }

  if (typeof rawSoundUrl === "string") {
    const trimmed = rawSoundUrl.trim();
    if (trimmed) {
      androidSoundUrl = trimmed;
    }
  }

  if (!androidSound && rawSound !== null) {
    androidSound = ANDROID_NOTIFICATION_SOUND;
  }
  const androidSpeakText = payload.android?.speakText?.trim() || undefined;
  const androidSpeakLocale = payload.android?.speakLocale?.trim() || undefined;
  const androidSpeechMode =
    payload.android?.speechMode === "browser" || payload.android?.speechMode === "api"
      ? payload.android.speechMode
      : undefined;
  const androidSpeechVoice = payload.android?.speechVoice?.trim() || undefined;
  const androidSpeakUrl = payload.android?.speakUrl?.trim() || undefined;

  const baseData = payload.data
    ? Object.entries(payload.data).reduce<Record<string, string>>((accumulator, [key, value]) => {
        if (value === null || value === undefined) {
          return accumulator;
        }
        accumulator[key] = String(value);
        return accumulator;
      }, {})
    : {};

  if (payload.notification?.title) {
    baseData.storebot_title = payload.notification.title;
  }
  if (payload.notification?.body) {
    baseData.storebot_body = payload.notification.body;
  }

  baseData.storebot_channel_id = androidChannelId;
  if (androidSound) {
    baseData.storebot_sound = androidSound;
  }
  if (androidSoundUrl) {
    baseData.storebot_sound_url = androidSoundUrl;
  }

  if (androidSpeakText) {
    baseData.storebot_speak = androidSpeakText;
  }
  if (androidSpeakLocale) {
    baseData.storebot_speak_locale = androidSpeakLocale;
  }
  if (androidSpeechMode) {
    baseData.storebot_speech_mode = androidSpeechMode;
  }
  if (androidSpeechVoice) {
    baseData.storebot_speech_voice = androidSpeechVoice;
  }
  if (androidSpeakUrl) {
    baseData.storebot_speak_url = androidSpeakUrl;
  }
  const androidImageUrl = payload.android?.imageUrl?.trim() || undefined;
  if (androidImageUrl) {
    baseData.storebot_image_url = androidImageUrl;
  }

  const data = Object.keys(baseData).length > 0 ? baseData : undefined;

  const chunks = chunkArray(payload.tokens, 500);
  const invalidTokens: string[] = [];

  const site = await getAdminSiteSettings().catch(() => null);
  const webIcon = (site?.mobileAppIconUrl || site?.logoUrl || "/images/brand/logo/logo-icon.svg");

  for (const tokens of chunks) {
    const androidNotificationTag =
      typeof baseData.storebot_notification_id === "string" && baseData.storebot_notification_id.trim()
        ? baseData.storebot_notification_id.trim()
        : typeof baseData.notification_id === "string" && baseData.notification_id.trim()
          ? baseData.notification_id.trim()
          : typeof baseData.notificationId === "string" && baseData.notificationId.trim()
            ? baseData.notificationId.trim()
            : undefined;
    const message: MulticastMessage = {
      tokens,
      data,
      android: {
        priority: "high",
        notification: payload.notification
          ? {
              title: payload.notification.title,
              body: payload.notification.body,
              channelId: androidChannelId,
              sound: androidSound,
              tag: androidNotificationTag,
              eventTimestamp: new Date(),
              notificationCount: 1,
            }
          : undefined,
        collapseKey: androidNotificationTag,
      },
      apns: payload.notification
        ? {
            payload: {
              aps: {
                alert: {
                  title: payload.notification.title,
                  body: payload.notification.body,
                },
                sound: "default",
                contentAvailable: true,
              },
            },
          }
        : {
            payload: {
              aps: {
                contentAvailable: true,
              },
            },
          },
      webpush: payload.notification
        ? {
            headers: {
              Urgency: "high",
            },
            notification: {
              title: payload.notification.title,
              body: payload.notification.body,
              icon: webIcon,
            },
          }
        : {
            headers: {
              Urgency: "high",
            },
          },
    };

    const response = await messaging.sendEachForMulticast(message);

    response.responses.forEach((result, index) => {
      if (result.success) {
        return;
      }

      const code = result.error?.code;
      if (code && INVALID_TOKEN_ERRORS.has(code)) {
        invalidTokens.push(tokens[index]!);
      } else if (result.error) {
        console.error("Falha ao enviar push notification", result.error);
      }
    });
  }

  if (invalidTokens.length > 0) {
    await removeInvalidTokens(Array.from(new Set(invalidTokens)));
  }
};

export const sendPushNotificationToUser = async (
  userId: number,
  payload: {
    title?: string;
    body?: string;
    data?: Record<string, string | number | boolean | null>;
    android?: AndroidPushOptions;
  },
): Promise<void> => {
  const subscriptions = await listPushSubscriptionsForUser(userId);
  if (!subscriptions.length) {
    return;
  }

  const speakText =
    payload.android?.speakText?.trim() || payload.body?.trim() || payload.title?.trim() || undefined;

  const androidOptions = payload.android ?? {};
  const rawChannelId = androidOptions.channelId;
  const rawSound = androidOptions.sound;
  const rawSoundUrl = androidOptions.soundUrl;
  const speechMode = androidOptions.speechMode === "browser" || androidOptions.speechMode === "api"
    ? androidOptions.speechMode
    : undefined;
  const speechVoice = androidOptions.speechVoice?.trim() || undefined;
  const speakUrl = androidOptions.speakUrl?.trim() || undefined;
  const soundUrl = typeof rawSoundUrl === "string" ? rawSoundUrl.trim() || undefined : undefined;
  const imageUrl =
    typeof androidOptions.imageUrl === "string" ? androidOptions.imageUrl.trim() || undefined : undefined;

  const channelId =
    typeof rawChannelId === "string" && rawChannelId.trim()
      ? rawChannelId.trim()
      : ANDROID_NOTIFICATION_CHANNEL_ID;

  let sound: string | null | undefined;
  if (typeof rawSound === "string") {
    const trimmed = rawSound.trim();
    sound = trimmed || undefined;
  } else if (rawSound === null) {
    sound = null;
  }

  const androidTokens: string[] = [];
  const otherTokens: string[] = [];

  for (const subscription of subscriptions) {
    const target = subscription.platform === "android" ? androidTokens : otherTokens;
    target.push(subscription.token);
  }

  const baseData: Record<string, string | number | boolean | null> = {
    ...(payload.data ?? {}),
  };
  baseData.targetUserId = userId;
  baseData.target_user_id = String(userId);

  const trimmedTitle = payload.title?.trim();
  const trimmedBody = payload.body?.trim();

  if (trimmedTitle) {
    baseData.storebot_title = trimmedTitle;
  }
  if (trimmedBody) {
    baseData.storebot_body = trimmedBody;
  }
  if (speechMode) {
    baseData.storebot_speech_mode = speechMode;
  }
  if (speechVoice) {
    baseData.storebot_speech_voice = speechVoice;
  }
  if (speakUrl) {
    baseData.storebot_speak_url = speakUrl;
  }

  const notificationPayload =
    trimmedTitle || trimmedBody ? { title: trimmedTitle || undefined, body: trimmedBody || undefined } : undefined;
  const isWhatsappMessagePush =
    typeof baseData.type === "string" && baseData.type.trim() === "whatsapp_message";
  if (typeof baseData.targetUrl === "string") {
    const normalized = baseData.targetUrl.trim();
    if (normalized) {
      baseData.target_url = normalized;
    }
  }
  if (typeof baseData.whatsappId === "string") {
    const normalized = baseData.whatsappId.trim();
    if (normalized) {
      baseData.whatsapp_id = normalized;
    }
  }
  if (typeof baseData.userId === "string") {
    const normalized = baseData.userId.trim();
    if (normalized) {
      baseData.user_id = normalized;
    }
  }

  const androidPayload: AndroidPushOptions = {
    channelId,
    sound,
    soundUrl,
    speakText,
    speakLocale: androidOptions.speakLocale ?? ANDROID_TTS_DEFAULT_LOCALE,
    speechMode,
    speechVoice,
    speakUrl,
    imageUrl,
  };

  if (androidTokens.length > 0) {
    await sendPushNotification({
      tokens: androidTokens,
      notification: isWhatsappMessagePush ? undefined : notificationPayload,
      data: { ...baseData },
      android: androidPayload,
    });
  }

  if (otherTokens.length > 0) {
    await sendPushNotification({
      tokens: otherTokens,
      notification: notificationPayload,
      data: { ...baseData },
      android: androidPayload,
    });
  }
};

export const sendPushNotificationToAllUsers = async (payload: {
  title?: string;
  body?: string;
  data?: Record<string, string | number | boolean | null>;
  android?: AndroidPushOptions;
}): Promise<void> => {
  await ensurePushSubscriptionTable();
  const db = getDb();

  const [rows] = await db.query<PushSubscriptionRow[]>(
    `SELECT token, platform FROM push_subscriptions WHERE token IS NOT NULL`,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const androidTokens = new Set<string>();
  const otherTokens = new Set<string>();

  for (const row of rows) {
    const rawToken = typeof row.token === "string" ? row.token.trim() : "";
    if (!rawToken) {
      continue;
    }
    if (row.platform === "android") {
      androidTokens.add(rawToken);
    } else {
      otherTokens.add(rawToken);
    }
  }

  if (androidTokens.size === 0 && otherTokens.size === 0) {
    return;
  }

  const speakText =
    payload.android?.speakText?.trim() ||
    payload.body?.trim() ||
    payload.title?.trim() ||
    undefined;

  const androidOptions = payload.android ?? {};
  const rawChannelId = androidOptions.channelId;
  const rawSound = androidOptions.sound;
  const rawSoundUrl = androidOptions.soundUrl;
  const speechMode: AndroidPushOptions["speechMode"] =
    androidOptions.speechMode === "browser" || androidOptions.speechMode === "api"
      ? androidOptions.speechMode
      : undefined;
  const speechVoice = androidOptions.speechVoice?.trim() || undefined;
  const speakUrl = androidOptions.speakUrl?.trim() || undefined;
  const soundUrl =
    typeof rawSoundUrl === "string" ? rawSoundUrl.trim() || undefined : undefined;
  const imageUrl =
    typeof androidOptions.imageUrl === "string"
      ? androidOptions.imageUrl.trim() || undefined
      : undefined;

  const channelId =
    typeof rawChannelId === "string" && rawChannelId.trim()
      ? rawChannelId.trim()
      : ANDROID_NOTIFICATION_CHANNEL_ID;

  let sound: string | null | undefined;
  if (typeof rawSound === "string") {
    const trimmed = rawSound.trim();
    sound = trimmed || undefined;
  } else if (rawSound === null) {
    sound = null;
  }

  const baseData: Record<string, string | number | boolean | null> = {
    ...(payload.data ?? {}),
  };

  const trimmedTitle = payload.title?.trim();
  const trimmedBody = payload.body?.trim();

  if (trimmedTitle) {
    baseData.storebot_title = trimmedTitle;
  }
  if (trimmedBody) {
    baseData.storebot_body = trimmedBody;
  }
  if (speechMode) {
    baseData.storebot_speech_mode = speechMode;
  }
  if (speechVoice) {
    baseData.storebot_speech_voice = speechVoice;
  }
  if (speakUrl) {
    baseData.storebot_speak_url = speakUrl;
  }

  if (typeof baseData.targetUrl === "string") {
    const normalized = baseData.targetUrl.trim();
    if (normalized) {
      baseData.target_url = normalized;
    }
  }
  if (typeof baseData.whatsappId === "string") {
    const normalized = baseData.whatsappId.trim();
    if (normalized) {
      baseData.whatsapp_id = normalized;
    }
  }
  if (typeof baseData.userId === "string") {
    const normalized = baseData.userId.trim();
    if (normalized) {
      baseData.user_id = normalized;
    }
  }

  const notificationPayload =
    trimmedTitle || trimmedBody
      ? { title: trimmedTitle || undefined, body: trimmedBody || undefined }
      : undefined;

  const androidPayload: AndroidPushOptions = {
    channelId,
    sound,
    soundUrl,
    speakText,
    speakLocale: androidOptions.speakLocale ?? ANDROID_TTS_DEFAULT_LOCALE,
    speechMode,
    speechVoice,
    speakUrl,
    imageUrl,
  };

  if (androidTokens.size > 0) {
    await sendPushNotification({
      tokens: Array.from(androidTokens),
      notification: notificationPayload,
      data: { ...baseData },
      android: androidPayload,
    });
  }

  if (otherTokens.size > 0) {
    await sendPushNotification({
      tokens: Array.from(otherTokens),
      notification: notificationPayload,
      data: { ...baseData },
      android: androidPayload,
    });
  }
};

type AdminSubscriptionRow = RowDataPacket & { user_id: number };

const listAdminSubscriptionUserIds = async (): Promise<number[]> => {
  await ensurePushSubscriptionTable();
  const db = getDb();

  const [rows] = await db.query<AdminSubscriptionRow[]>(
    `
      SELECT DISTINCT ps.user_id
      FROM push_subscriptions ps
      INNER JOIN users u ON u.id = ps.user_id
      WHERE u.role = 'admin' AND u.is_active = 1
    `,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      rows
        .map((row) => Number(row.user_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
};

export const sendPushNotificationToAdmins = async (payload: {
  title?: string;
  body?: string;
  data?: Record<string, string | number | boolean | null>;
  android?: AndroidPushOptions;
}): Promise<void> => {
  const adminIds = await listAdminSubscriptionUserIds();
  if (!adminIds.length) {
    return;
  }

  await Promise.all(
    adminIds.map(async (adminId) => {
      try {
        await sendPushNotificationToUser(adminId, payload);
      } catch (error) {
        console.error("[push] Falha ao enviar notificação para admin", { adminId, error });
      }
    }),
  );
};
