import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteBotAdCampaign,
  getBotAdCampaignById,
  listBotAdCampaignsForUser,
  replaceBotAdCampaignTargets,
  describeInviteValidationIssues,
  updateBotAdCampaign,
} from "lib/bot-ad-campaigns";
import { deleteUploadedFile } from "lib/uploads";
import type {
  BotAdCampaignInput,
  BotAdCampaignTarget,
  BotAdCampaignTargetInput,
  CampaignTargetValidationIssue,
} from "types/bot-ad-campaigns";

const assertPayload = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

type CampaignRouteContext = { params: Promise<{ campaignId: string }> };

const readCampaignIdFromPath = (request: Request): string | null => {
  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const raw = path[path.length - 1] ?? "";
    const campaignId = raw.trim();
    return campaignId || null;
  } catch {
    return null;
  }
};

const resolveCampaignId = async (
  context: CampaignRouteContext,
  request: Request,
): Promise<string | null> => {
  const params = await Promise.resolve(context.params);
  const fromParams = typeof params?.campaignId === "string" ? params.campaignId.trim() : "";
  if (fromParams) {
    return fromParams;
  }
  return readCampaignIdFromPath(request);
};

export async function GET(
  request: Request,
  context: CampaignRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const campaignId = await resolveCampaignId(context, request);
    if (!campaignId) {
      return NextResponse.json({ message: "Campanha inválida." }, { status: 400 });
    }
    const campaign = await getBotAdCampaignById(user.id, campaignId);
    if (!campaign) {
      return NextResponse.json({ message: "Campanha não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Failed to fetch bot ad campaign", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a campanha." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: CampaignRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const payload = await request.json().catch(() => null);
    if (!assertPayload(payload)) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }
    const campaignId = await resolveCampaignId(context, request);
    if (!campaignId) {
      return NextResponse.json({ message: "Campanha inválida." }, { status: 400 });
    }
    const { targets, ...campaignPayload } = payload as BotAdCampaignInput & {
      targets?: BotAdCampaignTargetInput[];
    };
    const campaign = await updateBotAdCampaign(user.id, campaignId, campaignPayload);
    let updatedCampaign: typeof campaign & { targets: BotAdCampaignTarget[] } = campaign;
    let inviteIssues: CampaignTargetValidationIssue[] = [];
    let inviteIssuesMessage: string | null = null;
    if (Array.isArray(targets)) {
      const replaceResult = await replaceBotAdCampaignTargets(user.id, campaignId, targets);
      inviteIssues = replaceResult.inviteIssues;
      inviteIssuesMessage = describeInviteValidationIssues(inviteIssues);
      updatedCampaign = { ...campaign, targets: replaceResult.targets };
    }
    // A PATCH is an edit to future scheduling/content.  Existing WhatsApp
    // status posts must remain live until their own expiry/cleanup; deleting
    // them here made adding one video erase and republish the entire batch.
    const baseMessage = "Campanha atualizada com sucesso.";
    const message = inviteIssuesMessage ? `${baseMessage} ${inviteIssuesMessage}` : baseMessage;
    return NextResponse.json({ message, campaign: updatedCampaign, inviteIssues });
  } catch (error) {
    console.error("Failed to update bot ad campaign", error);
    return NextResponse.json(
      { message: (error as Error).message ?? "Não foi possível atualizar a campanha." },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: CampaignRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const campaignId = await resolveCampaignId(context, request);
    if (!campaignId) {
      return NextResponse.json({ message: "Campanha inválida." }, { status: 400 });
    }
    const campaign = await getBotAdCampaignById(user.id, campaignId);
    if (!campaign) {
      return NextResponse.json({ message: "Campanha não encontrada." }, { status: 404 });
    }
    await deleteBotAdCampaign(user.id, campaignId);
    await removeStatusPostsForCampaign(user.id, campaign.numericId);
    await Promise.all(
      campaign.contents.map((content) => {
        const media = "media" in content ? content.media : null;
        return media?.path ? deleteUploadedFile(media.path).catch(() => undefined) : Promise.resolve();
      }),
    );
    const campaigns = await listBotAdCampaignsForUser(user.id);
    return NextResponse.json({
      message: "Campanha removida com sucesso.",
      campaigns,
    });
  } catch (error) {
    console.error("Failed to delete bot ad campaign", error);
    return NextResponse.json(
      { message: "Não foi possível remover a campanha." },
      { status: 500 },
    );
  }
}
