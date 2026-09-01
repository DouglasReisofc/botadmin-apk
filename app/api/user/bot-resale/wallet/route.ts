import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  evaluateBotResalePaymentReadiness,
  resolveBotResalePaymentMode,
} from "lib/bot-resale-payments";
import { getBotResaleWalletSummary } from "lib/bot-resale-wallet";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const [wallet, readiness, mode] = await Promise.all([
      getBotResaleWalletSummary(user.id),
      evaluateBotResalePaymentReadiness(user.id),
      resolveBotResalePaymentMode(user.id),
    ]);

    return NextResponse.json({
      wallet,
      readiness,
      paymentMode: mode,
    });
  } catch (error) {
    console.error("[bot-resale/wallet] Falha ao carregar carteira", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a carteira de vendas." },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";