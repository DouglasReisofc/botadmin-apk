import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  buildPartnerMercadoPagoAuthorizationUrl,
  createPartnerCreditCheckout,
  disconnectPartnerMercadoPago,
  getPartnerPaymentSnapshot,
} from "lib/partner-payments";
import { ResellerProgramError } from "lib/reseller-program";

const fail = (error: unknown) => {
  if (error instanceof ResellerProgramError) return NextResponse.json({ message: error.message }, { status: error.status });
  console.error("[user/reseller/payments] request failed", error);
  return NextResponse.json({ message: "Não foi possível concluir a operação de pagamentos." }, { status: 500 });
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    return NextResponse.json({ payment: await getPartnerPaymentSnapshot(user.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = String(body?.action ?? "connect").trim().toLowerCase();
    if (action === "connect") {
      return NextResponse.json({ authorizationUrl: await buildPartnerMercadoPagoAuthorizationUrl(user.id) });
    }
    if (action === "disconnect") {
      return NextResponse.json({ payment: await disconnectPartnerMercadoPago(user.id) });
    }
    if (action === "buy_credits" || action === "credit_checkout") {
      const result = await createPartnerCreditCheckout(user.id, Number(body?.credits));
      return NextResponse.json(result, { status: 201 });
    }
    return NextResponse.json({ message: "Ação de pagamento inválida." }, { status: 400 });
  } catch (error) { return fail(error); }
}
