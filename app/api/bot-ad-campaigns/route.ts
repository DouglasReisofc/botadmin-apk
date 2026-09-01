import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  createBotAdCampaign,
  listBotAdCampaignsForUser,
  replaceBotAdCampaignTargets,
  describeInviteValidationIssues,
} from "lib/bot-ad-campaigns";
import { listGroupAdsAsCampaigns } from "lib/group-ad-campaigns";
import type {
  BotAdCampaignInput,
  BotAdCampaignTargetInput,
  CampaignTargetValidationIssue,
} from "types/bot-ad-campaigns";

const assertPayload = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const campaigns = await listBotAdCampaignsForUser(user.id);
    const includeGroupAds = request.nextUrl.searchParams.get("includeGroupAds") === "1";
    const body: Record<string, unknown> = { campaigns };
    if (includeGroupAds) {
      const groupAdCampaigns = await listGroupAdsAsCampaigns(user.id);
      body.groupAdCampaigns = groupAdCampaigns.campaigns;
      body.groupAdCampaignMeta = groupAdCampaigns.meta;
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error("Failed to list bot ad campaigns", error);
    return NextResponse.json(
      { message: "Não foi possível listar as campanhas de anúncios." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    if (!assertPayload(payload)) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { targets, ...campaignData } = payload as BotAdCampaignInput & {
      targets?: BotAdCampaignTargetInput[];
    };

    const campaign = await createBotAdCampaign(user.id, campaignData);

    let inviteIssuesMessage: string | null = null;
    let inviteIssues: CampaignTargetValidationIssue[] = [];
    if (Array.isArray(targets) && targets.length > 0) {
      const replaceResult = await replaceBotAdCampaignTargets(user.id, campaign.id, targets);
      inviteIssues = replaceResult.inviteIssues;
      inviteIssuesMessage = describeInviteValidationIssues(inviteIssues);
    }
    const refreshed = await listBotAdCampaignsForUser(user.id);
    const baseMessage = "Campanha criada com sucesso.";
    const message = inviteIssuesMessage ? `${baseMessage} ${inviteIssuesMessage}` : baseMessage;
    return NextResponse.json(
      { message, campaign, campaigns: refreshed, inviteIssues },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create bot ad campaign", error);
    return NextResponse.json(
      { message: (error as Error).message ?? "Não foi possível criar a campanha." },
      { status: 400 },
    );
  }
}
