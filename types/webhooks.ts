export type UserWebhookDetails = {
  id: string;
  endpoint: string;
  verifyToken: string;
  appId: string | null;
  businessAccountId: string | null;
  phoneNumberId: string | null;
  accessToken: string | null;
  createdAt: string;
  updatedAt: string;
  lastEventAt: string | null;
};

export type WebhookEventSummary = {
  id: number;
  webhookId: string;
  eventType: string | null;
  receivedAt: string;
  payload: string;
};

export type WebhookTestProfile = {
  about: string | null;
  email: string | null;
  website: string | null;
  vertical: string | null;
  profilePictureUrl: string | null;
};

export type WebhookTestResult = {
  message: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  profile?: WebhookTestProfile | null;
};
