export interface AdminWebhookDetails {
  id: string;
  endpoint: string;
  verifyToken: string;
  appId: string | null;
  businessAccountId: string | null;
  phoneNumberId: string | null;
  phoneNumber: string | null;
  accessToken: string | null;
  createdAt: string;
  updatedAt: string;
  lastEventAt: string | null;
}

export interface AdminWebhookEventSummary {
  id: number;
  eventType: string | null;
  payload: string;
  receivedAt: string;
}
