export type AdminSmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  isConfigured: boolean;
  hasPassword: boolean;
  updatedAt: string | null;
};

export type AdminSmtpSettingsPayload = {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
};

export type UserNotification = {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
};

export type NotificationSpeechMode = "browser" | "api";

export type UserNotificationAudioSettings = {
  soundsEnabled: boolean;
  ttsEnabled: boolean;
  speechMode: NotificationSpeechMode;
  speechVoice: string;
  purchaseTemplate: string;
  balanceTemplate: string;
  raffleTemplate: string;
  planTemplate: string;
  updatedAt: string | null;
};
