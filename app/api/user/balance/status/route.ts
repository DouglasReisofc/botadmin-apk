import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getBalancePaymentByProviderPaymentId } from "lib/balance-payments";
import { getUserBalanceById } from "lib/users";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const id = (url.searchParams.get("paymentId") || url.searchParams.get("id") || "").trim();

    if (!id) {
      return NextResponse.json({ message: "Parâmetro paymentId obrigatório." }, { status: 400 });
    }

    const payment = await getBalancePaymentByProviderPaymentId(id);
    if (!payment || payment.user_id !== user.id) {
      return NextResponse.json({ message: "Pagamento não encontrado." }, { status: 404 });
    }

    const balance = await getUserBalanceById(user.id);

    return NextResponse.json({
      status: payment.status,
      statusDetail: payment.status_detail,
      provider: payment.provider,
      amount: Number.parseFloat(String(payment.amount ?? 0)) || 0,
      updatedAt: payment.updated_at instanceof Date
        ? payment.updated_at.toISOString()
        : new Date(payment.updated_at as any).toISOString(),
      balance,
    });
  } catch (error) {
    console.error("Failed to fetch balance payment status", error);
    return NextResponse.json(
      { message: "Não foi possível verificar o status do pagamento." },
      { status: 500 },
    );
  }
}
export const dynamic = "force-dynamic";
