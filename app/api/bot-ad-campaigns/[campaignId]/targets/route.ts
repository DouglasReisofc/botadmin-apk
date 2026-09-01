import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { describeInviteValidationIssues, listCampaignTargets, replaceBotAdCampaignTargets } from "lib/bot-ad-campaigns";
import type { BotAdCampaignTargetInput } from "types/bot-ad-campaigns";

const assertPayload = (value: unknown): value is BotAdCampaignTargetInput[] => {
  return Array.isArray(value);
};

type CampaignTargetsRouteContext = { params: Promise<{ campaignId: string }> };

const resolveCampaignId = async (
  context: CampaignTargetsRouteContext,
  request: Request,
): Promise<string | null> => {
  const params = await Promise.resolve(context.params);
  const fromParams = typeof params?.campaignId === "string" ? params.campaignId.trim() : "";
  if (fromParams) {
    return fromParams;
  }
  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const fromPath = (path[path.length - 2] ?? "").trim();
    return fromPath || null;
  } catch {
    return null;
  }
};

export async function GET(
  request: Request,
  context: CampaignTargetsRouteContext,
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
    const targets = await listCampaignTargets(user.id, campaignId);
    return NextResponse.json({ targets });
  } catch (error) {
    console.error("Failed to list campaign targets", error);
    return NextResponse.json(
      { message: (error as Error).message ?? "Não foi possível carregar os destinos." },
      { status: 400 },
    );
  }
}

export async function PUT(
  request: Request,
  context: CampaignTargetsRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const payload = await request.json().catch(() => null);
    if (!assertPayload(payload)) {
      return NextResponse.json({ message: "Informe a lista completa de destinos." }, { status: 400 });
    }
    const campaignId = await resolveCampaignId(context, request);
    if (!campaignId) {
      return NextResponse.json({ message: "Campanha inválida." }, { status: 400 });
    }
    const result = await replaceBotAdCampaignTargets(user.id, campaignId, payload);
    const inviteIssuesMessage = describeInviteValidationIssues(result.inviteIssues);
    const baseMessage = "Destinos atualizados com sucesso.";
    const message = inviteIssuesMessage ? `${baseMessage} ${inviteIssuesMessage}` : baseMessage;
    return NextResponse.json({
      message,
      targets: result.targets,
      inviteIssues: result.inviteIssues,
    });
  } catch (error) {
    console.error("Failed to upsert campaign targets", error);
    return NextResponse.json(
      { message: (error as Error).message ?? "Não foi possível atualizar os destinos." },
      { status: 400 },
    );
  }
}
