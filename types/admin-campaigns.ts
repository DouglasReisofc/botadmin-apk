export type AdminCampaignStatus =
  | "draft"
  | "scheduled"
  | "queued"
  | "sending"
  | "completed"
  | "paused"
  | "cancelled";

export type AdminCampaignContactStatus =
  | "pending"
  | "queued"
  | "sent"
  | "failed"
  | "skipped";

export interface AdminCampaignStats {
  totalContacts: number;
  pendingContacts: number;
  queuedContacts: number;
  sentContacts: number;
  failedContacts: number;
  skippedContacts: number;
}

export interface AdminCampaignSummary {
  id: number;
  campaignId: string;
  name: string;
  description: string | null;
  templateId: string;
  templateName: string;
  status: AdminCampaignStatus;
  scheduledAt: string | null;
  sendingStartedAt: string | null;
  sendingCompletedAt: string | null;
  lastError: string | null;
  businessAccountId: string | null;
  createdAt: string;
  updatedAt: string;
  stats: AdminCampaignStats;
}

export interface AdminCampaignDetail extends AdminCampaignSummary {
  contacts: AdminCampaignContact[];
  metaTemplateName: string;
}

export interface AdminCampaignContact {
  id: number;
  contactId: string;
  name: string | null;
  phone: string;
  variables: Record<string, string>;
  status: AdminCampaignContactStatus;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  messageId: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export type AdminCampaignCreatePayload = {
  name: string;
  description?: string | null;
  templateId: string;
  scheduledAt?: string | null;
};

export type AdminCampaignContactsImportMapping = {
  nameColumn?: string | null;
  phoneColumn: string;
  variableColumns: Record<string, string | null>;
};

export type AdminCampaignContactsImportOptions = {
  delimiter?: "," | ";" | "\t";
  hasHeader?: boolean;
  mapping: AdminCampaignContactsImportMapping;
};
