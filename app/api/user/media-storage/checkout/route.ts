import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createMediaStorageCheckout } from "lib/media-storage-payments";
import { getAdminMediaStorageSummary, getUserMediaStoragePlanById } from "lib/user-media-storage";

type PaymentProvider = "mercadopago_pix" | "polopag_pix" | "mercadopago_checkout";

const isProvider = (value: string): value is PaymentProvider =>
  value === "mercadopago_pix" || value === "polopag_pix" || value === "mercadopago_checkout";

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

    const planId = Number.parseInt(String((body as Record<string, unknown>).planId ?? ""), 10);
    const providerRaw = String((body as Record<string, unknown>).provider ?? "mercadopago_pix");
    if (!Number.isFinite(planId) || planId <= 0) {
      return NextResponse.json({ message: "Plano de armazenamento inválido." }, { status: 400 });
    }
    if (!isProvider(providerRaw)) {
      return NextResponse.json({ message: "Forma de pagamento inválida." }, { status: 400 });
    }

    const plan = await getUserMediaStoragePlanById(planId);
    if (!plan || !plan.isActive) {
      return NextResponse.json({ message: "Plano de armazenamento indisponível." }, { status: 404 });
    }

    if (user.role === "admin") {
      const storage = await getAdminMediaStorageSummary(user.id);
      return NextResponse.json({
        message: "Armazenamento R2 liberado para administrador.",
        checkout: null,
        storage,
        adminExempt: true,
        activated: true,
      });
    }

    const checkout = await createMediaStorageCheckout({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      plan,
      provider: providerRaw,
    });

    return NextResponse.json({
      message: "Pagamento de armazenamento criado com sucesso.",
      checkout,
    });
  } catch (error) {
    console.error("Failed to create media storage checkout", error);
    return NextResponse.json(
      { message: "Não foi possível gerar o pagamento de armazenamento." },
      { status: 500 },
    );
  }
}
