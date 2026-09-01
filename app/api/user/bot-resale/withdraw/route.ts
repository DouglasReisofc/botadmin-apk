import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { requestBotResaleWithdrawal } from "lib/bot-resale-wallet";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const amountRaw = body && typeof body === "object" ? (body as Record<string, unknown>).amount : null;
    const amount = typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string"
        ? Number.parseFloat(amountRaw.replace(",", "."))
        : null;

    const result = await requestBotResaleWithdrawal(
      user.id,
      amount != null && Number.isFinite(amount) ? amount : null,
    );

    return NextResponse.json({
      message: "Saque registrado com sucesso. O valor foi debitado da sua carteira do site.",
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível processar o saque.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";