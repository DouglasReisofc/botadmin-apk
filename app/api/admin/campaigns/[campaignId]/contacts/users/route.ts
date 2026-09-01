import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getCampaignRowByPublicId, importCampaignContactsFromUsers } from "lib/admin-campaigns";

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
    const userIds = Array.isArray(payload?.userIds) ? payload.userIds : [];

    if (userIds.length === 0) {
      return NextResponse.json({ message: "Selecione ao menos um usuário para importar." }, { status: 400 });
    }

    const result = await importCampaignContactsFromUsers(campaign, userIds);

    return NextResponse.json({
      message: "Importação concluída com sucesso.",
      result,
    });
  } catch (error) {
    console.error("Failed to import campaign contacts from users", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível importar os usuários selecionados.",
      },
      { status: 500 },
    );
  }
}
