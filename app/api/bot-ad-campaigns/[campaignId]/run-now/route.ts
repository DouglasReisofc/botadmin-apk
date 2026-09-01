import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { triggerBotAdCampaignDispatchNow } from "lib/bot-ad-campaign-dispatcher";
import { triggerImmediateBotAdCampaignRun } from "lib/bot-ad-campaigns";

type CampaignRunRouteContext = { params: Promise<{ campaignId: string }> };

const resolveCampaignId = async (
  context: CampaignRunRouteContext,
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

export async function POST(
  request: Request,
  context: CampaignRunRouteContext,
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
    await triggerImmediateBotAdCampaignRun(user.id, campaignId);
    void triggerBotAdCampaignDispatchNow().catch((error) => {
      console.error("Failed to run immediate dispatch cycle", error);
    });
    return NextResponse.json({
      message: "Campanha enviada para processamento. Aguarde alguns instantes.",
    });
  } catch (error) {
    console.error("Failed to trigger manual dispatch", error);
    return NextResponse.json(
      { message: (error as Error).message ?? "Não foi possível iniciar a campanha agora." },
      { status: 400 },
    );
  }
}
