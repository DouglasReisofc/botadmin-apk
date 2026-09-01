import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getApiRequestPlanById } from "lib/api-request-plans";
import { createApiRequestPackageCharge } from "lib/api-request-payments";
import type { PaymentMethodProvider } from "types/payments";

const SUPPORTED_PROVIDERS = new Set<PaymentMethodProvider>([
  "mercadopago_pix",
  "polopag_pix",
  "mercadopago_checkout",
]);

const parsePlanId = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.NaN;
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { planId, provider } = body as Record<string, unknown>;

    const parsedPlanId = parsePlanId(planId);
    if (!Number.isFinite(parsedPlanId) || parsedPlanId <= 0) {
      return NextResponse.json({ message: "Pacote inválido." }, { status: 400 });
    }

    const providerValue = typeof provider === "string" ? (provider.trim() as PaymentMethodProvider) : "";
    if (!SUPPORTED_PROVIDERS.has(providerValue)) {
      return NextResponse.json({ message: "Forma de pagamento não suportada." }, { status: 400 });
    }

    const plan = await getApiRequestPlanById(parsedPlanId);
    if (!plan || !plan.isActive) {
      return NextResponse.json({ message: "Pacote de requisições indisponível no momento." }, { status: 404 });
    }

    const checkout = await createApiRequestPackageCharge({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userWhatsapp: user.whatsappNumber ?? null,
      plan,
      provider: providerValue,
    });

    return NextResponse.json({
      message: "Pagamento gerado. Assim que confirmado, seu saldo será liberado automaticamente.",
      checkout,
    });
  } catch (error) {
    console.error("Failed to create API request package payment", error);
    return NextResponse.json(
      { message: "Não foi possível gerar o pagamento de requisições." },
      { status: 500 },
    );
  }
}
