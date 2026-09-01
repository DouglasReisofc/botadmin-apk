import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getAffiliateShopeeMessageTemplateForUser,
  getAffiliateShopeeTemplateTokensHelp,
  saveAffiliateShopeeMessageTemplateForUser,
} from "lib/affiliate-shopee-message-template";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const template = await getAffiliateShopeeMessageTemplateForUser(user.id);
    return NextResponse.json({
      status: true,
      template,
      tokens: getAffiliateShopeeTemplateTokensHelp(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível carregar o modelo de mensagem do Shopee.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => ({}))) as {
      items?: unknown;
      buttonLabel?: unknown;
      footerText?: unknown;
      providerTitle?: unknown;
    };

    const template = await saveAffiliateShopeeMessageTemplateForUser(user.id, {
      items: payload.items,
      buttonLabel: payload.buttonLabel,
      footerText: payload.footerText,
      providerTitle: payload.providerTitle,
    });

    return NextResponse.json({
      status: true,
      message: "Modelo de mensagem atualizado com sucesso.",
      template,
      tokens: getAffiliateShopeeTemplateTokensHelp(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível salvar o modelo de mensagem do Shopee.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
