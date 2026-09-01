import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getApiRequestPlanById } from "lib/api-request-plans";
import { getApiRequestTopupByProviderPaymentId } from "lib/api-request-payments";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const paymentId = (url.searchParams.get("paymentId") || url.searchParams.get("id") || "").trim();

    if (!paymentId) {
      return NextResponse.json({ message: "Parâmetro paymentId obrigatório." }, { status: 400 });
    }

    const topup = await getApiRequestTopupByProviderPaymentId(paymentId);

    if (!topup || topup.userId !== user.id) {
      return NextResponse.json({ message: "Pagamento não encontrado." }, { status: 404 });
    }

    const plan = topup.planId ? await getApiRequestPlanById(topup.planId) : null;

    return NextResponse.json({
      status: topup.status,
      provider: topup.provider,
      requestAmount: topup.requestAmount,
      amount: topup.amountCents / 100,
      updatedAt: topup.updatedAt,
      processedAt: topup.processedAt,
      metadata: topup.metadata,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            requestAmount: plan.requestAmount,
          }
        : null,
    });
  } catch (error) {
    console.error("Failed to fetch API request payment status", error);
    return NextResponse.json(
      { message: "Não foi possível verificar o status do pagamento." },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
