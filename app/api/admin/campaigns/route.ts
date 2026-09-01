import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  createAdminCampaign,
  getAdminCampaigns,
} from "lib/admin-campaigns";
import { resolveMetaTemplateCredentials } from "lib/admin-meta-templates";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const campaigns = await getAdminCampaigns();
    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error("Failed to load admin campaigns", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as campanhas cadastradas." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const payload = await request.json().catch(() => null);

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const webhook = await getAdminWebhookRow();
    const credentials = await resolveMetaTemplateCredentials(webhook);

    if (!credentials) {
      return NextResponse.json(
        {
          message:
            "Configure as credenciais do bot administrativo com o token e Business Account ID antes de criar campanhas.",
        },
        { status: 400 },
      );
    }

    const campaign = await createAdminCampaign(payload, {
      businessAccountId: credentials.businessAccountId,
    });

    return NextResponse.json({
      message: "Campanha criada com sucesso.",
      campaign,
    });
  } catch (error) {
    console.error("Failed to create admin campaign", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível criar a campanha no momento.",
      },
      { status: 500 },
    );
  }
}
