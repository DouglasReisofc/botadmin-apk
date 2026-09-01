import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  dispatchAdminCampaignInBackground,
  getAdminCampaignSummary,
  startAdminCampaign,
} from "lib/admin-campaigns";

interface RouteContext {
  params: { campaignId: string };
}

export async function POST(_request: Request, { params }: RouteContext) {
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

    const summary = await startAdminCampaign(campaignId);

    // dispara o processamento em background
    dispatchAdminCampaignInBackground(campaignId);

    return NextResponse.json({
      message: "Campanha colocada na fila de envios.",
      campaign: summary,
    });
  } catch (error) {
    console.error("Failed to start admin campaign", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível iniciar a campanha no momento.",
      },
      { status: 500 },
    );
  }
}

export async function GET(_request: Request, { params }: RouteContext) {
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

    const campaign = await getAdminCampaignSummary(campaignId);
    if (!campaign) {
      return NextResponse.json({ message: "Campanha não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Failed to retrieve campaign summary", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o status da campanha." },
      { status: 500 },
    );
  }
}
