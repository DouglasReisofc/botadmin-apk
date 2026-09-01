import type { AdminGroupSummary } from "types/admin-groups";
import type { BotGroup } from "types/bot-groups";

const licenseExpiryMillis = (value: string | null) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const mapBotGroupToAdminSummary = (
  group: BotGroup,
  user: { id: number; name: string; email: string | null },
): AdminGroupSummary => ({
  id: group.id,
  name: group.name,
  description: group.description ?? null,
  userId: user.id,
  userName: user.name,
  userEmail: user.email ?? null,
  instanceId: group.instanceId ?? null,
  instanceName: group.instanceName ?? null,
  instancePhone: group.instancePhone ?? null,
  slot: group.slot ?? 0,
  remoteId: group.remoteId,
  inviteCode: group.inviteCode ?? null,
  inviteLink: group.inviteLink ?? null,
  owner: group.owner ?? null,
  imageUrl: group.imageUrl ?? null,
  status: group.status,
  isVip: licenseExpiryMillis(group.metadata?.licenseExpiresAt ?? null) > Date.now(),
  licenseExpiresAt: group.metadata?.licenseExpiresAt ?? null,
  licensePlanId: group.metadata?.licensePlanId ?? null,
  licensePlanName: group.metadata?.licensePlanName ?? null,
  licenseSource: group.metadata?.licenseSource ?? null,
  awaitingApproval: group.awaitingApproval,
  awaitingEntry: group.awaitingEntry,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});