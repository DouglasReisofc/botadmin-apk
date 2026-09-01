import type { BotAdCampaignContent } from "./bot-ad-campaigns";

export type DivulgacaoTemplate = {
  id: string;
  name: string;
  description: string | null;
  contents: BotAdCampaignContent[];
  createdAt: string;
  updatedAt: string;
};

export type DivulgacaoTemplateInput = {
  name: string;
  description?: string | null;
  contents: BotAdCampaignContent[];
};

export type DivulgacaoInspectionResult = {
  inviteCode: string;
  inviteLink: string;
  groupJid: string | null;
  groupName: string | null;
  adminsOnly: boolean;
  locked: boolean;
  joinApprovalRequired: boolean;
  ephemeralEnabled: boolean;
  memberCount?: number | null;
  owner?: string | null;
  inspectedAt: string;
  raw?: Record<string, unknown> | null;
};

export type DivulgacaoSendResult = {
  runId: string;
  status: "sent" | "failed";
  inviteCode: string;
  inviteLink: string;
  groupJid: string | null;
  groupName: string | null;
  messageCount: number;
  inspection?: DivulgacaoInspectionResult | null;
  error?: string | null;
};

export type DivulgacaoGroupCandidate = {
  id: string;
  title: string;
  description: string;
  inviteCode: string;
  inviteLink: string;
  imageUrl?: string | null;
  categories?: string[];
  language?: string | null;
  region?: string | null;
  members?: number | null;
  metadata: Record<string, unknown>;
};
