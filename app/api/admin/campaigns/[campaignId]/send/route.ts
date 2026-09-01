import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  dispatchAdminCampaign,
  dispatchAdminCampaignInBackground,
  getAdminCampaignSummary,
} from "lib/admin-campaigns";

interface RouteContext {
  params: { campaignId: string };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const campaignId = params?.campaignId?.trim();
    if (!campaignId) {
      return NextResponse.json({ message: "Campanha inválida." }, { status: 400 });
    }

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "async";

    if (mode === "sync") {
      const summary = await dispatchAdminCampaign(campaignId);
      return NextResponse.json({
        message: "Processamento da campanha concluído.",
        campaign: summary,
      });
    }

    dispatchAdminCampaignInBackground(campaignId);

    const summary = await getAdminCampaignSummary(campaignId);
    return NextResponse.json({
      message: "Processamento da campanha iniciado em segundo plano.",
      campaign: summary,
    });
  } catch (error) {
    console.error("Failed to dispatch admin campaign", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível processar a campanha no momento.",
      },
      { status: 500 },
    );
  }
}
