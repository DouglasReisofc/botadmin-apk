import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getCampaignRowByPublicId, addCampaignContact } from "lib/admin-campaigns";

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

    const campaign = await getCampaignRowByPublicId(campaignId);
    if (!campaign) {
      return NextResponse.json({ message: "Campanha não encontrada." }, { status: 404 });
    }

    const payload = await request.json().catch(() => null);

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const phone = typeof payload.phone === "string" ? payload.phone : "";
    const name = typeof payload.name === "string" ? payload.name : null;
    const variables = payload.variables && typeof payload.variables === "object" ? (payload.variables as Record<string, unknown>) : null;

    const result = await addCampaignContact(campaign, { phone, name, variables });

    return NextResponse.json({
      message: "Contato adicionado à campanha.",
      result,
    });
  } catch (error) {
    console.error("Failed to add manual campaign contact", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível adicionar o contato à campanha.",
      },
      { status: 500 },
    );
  }
}
