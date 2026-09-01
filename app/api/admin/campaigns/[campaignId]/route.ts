import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminCampaignDetail } from "lib/admin-campaigns";

interface RouteContext {
  params: { campaignId: string };
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

    const campaign = await getAdminCampaignDetail(campaignId);
    if (!campaign) {
      return NextResponse.json({ message: "Campanha não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Failed to load admin campaign detail", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os dados da campanha." },
      { status: 500 },
    );
  }
}
