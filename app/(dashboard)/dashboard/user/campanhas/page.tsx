import { Metadata } from "next";

import { getCurrentUser } from "lib/auth";
import { listBotAdCampaignsForUser } from "lib/bot-ad-campaigns";
import { listGroupsForUser } from "lib/bot-groups";
import { listInstancesForUser } from "lib/bot-instances";
import { listGroupAdsAsCampaigns } from "lib/group-ad-campaigns";
import { getOrCreateUserApiKey } from "lib/user-api-keys";
import UserAdCampaignManager from "components/bot/UserAdCampaignManager";

export const metadata: Metadata = {
  title: "Campanhas e anúncios | StoreBot Dashboard",
  description:
    "Centralize seus anúncios em grupos, canais e status com agendamentos e remoção automática.",
};

const UserCampaignPage = async () => {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const [campaigns, instances, groups, apiKeyRecord] = await Promise.all([
    listBotAdCampaignsForUser(user.id),
    listInstancesForUser(user.id),
    listGroupsForUser(user.id),
    getOrCreateUserApiKey(user.id),
  ]);

  const {
    campaigns: groupAdCampaigns,
    meta: groupAdCampaignMeta,
  } = await listGroupAdsAsCampaigns(user.id, { groups });

  const combinedCampaigns = [...campaigns, ...groupAdCampaigns];

  return (
    <UserAdCampaignManager
      initialCampaigns={combinedCampaigns}
      instances={instances}
      groups={groups}
      initialGroupAdCampaignMeta={groupAdCampaignMeta}
      apiKey={apiKeyRecord.apiKey ?? ""}
    />
  );
};

export default UserCampaignPage;
