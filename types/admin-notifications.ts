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
