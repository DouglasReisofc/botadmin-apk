import type { BotGroup, BotGroupStatus } from "./bot-groups";

export type AdminGroupSummary = {
  id: number;
  name: string;
  description: string | null;
  userId: number;
  userName: string;
  userEmail: string | null;
  instanceId: number | null;
  instanceName: string | null;
  instancePhone: string | null;
  slot: number;
  remoteId: string;
  inviteCode: string | null;
  inviteLink: string | null;
  owner: string | null;
  imageUrl: string | null;
  status: BotGroupStatus;
  isVip: boolean;
  licenseExpiresAt: string | null;
  licensePlanId: number | null;
  licensePlanName: string | null;
  licenseSource: string | null;
  awaitingApproval: boolean;
  awaitingEntry: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminGroupDetail = {
  group: BotGroup;
  user: {
    id: number;
    name: string;
    email: string | null;
  };
};
