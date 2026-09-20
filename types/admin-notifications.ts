export type BillingNotificationChannels = {
  email: boolean;
  push: boolean;
};

export type BillingNotificationRule = {
  id: string;
  label: string;
  enabled: boolean;
  offsetDays: number;
  sendTime: string;
  channels: BillingNotificationChannels;
  subject: string;
  emailHtml: string;
  pushTitle: string;
  pushBody: string;
  pushImagePath: string | null;
  pushImageUrl: string | null;
  pushTargetUrl: string | null;
};

export type BillingNotificationSettings = {
  timezone: string;
  defaultSendTime: string;
  rules: BillingNotificationRule[];
  updatedAt: string | null;
};

export type AdminRealtimeNotificationSettings = {
  salesNotificationsEnabled: boolean;
  salesTtsEnabled: boolean;
  supportNotificationsEnabled: boolean;
  supportTtsEnabled: boolean;
  speechVoice: string;
  salesTemplate: string;
  supportTemplate: string;
  updatedAt: string | null;
};
