import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getPlanPaymentByProviderPaymentId } from "lib/plan-payments";
import { getUserPlanStatus } from "lib/plans";
import type { PlanCheckoutBreakdown } from "types/plans";
import { fetchMercadoPagoPayment } from "lib/mercadopago";
import { getAdminMercadoPagoPixConfig, getAdminMercadoPagoCheckoutConfig } from "lib/admin-payments";

const PLAN_PAYMENT_TYPE_PURCHASE = "plan_purchase";
const PLAN_PAYMENT_TYPE_ADDON = "plan_addon";

const resolvePlanPaymentType = (value: unknown): string => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === PLAN_PAYMENT_TYPE_ADDON) {
      return PLAN_PAYMENT_TYPE_ADDON;
    }
    if (normalized === PLAN_PAYMENT_TYPE_PURCHASE || normalized === "plan") {
      return PLAN_PAYMENT_TYPE_PURCHASE;
    }
  }
  return PLAN_PAYMENT_TYPE_PURCHASE;
};

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

    const payment = await getPlanPaymentByProviderPaymentId(id);
    if (!payment || payment.user_id !== user.id) {
      return NextResponse.json({ message: "Pagamento não encontrado." }, { status: 404 });
    }

    let paymentType = PLAN_PAYMENT_TYPE_PURCHASE;
    let breakdown: PlanCheckoutBreakdown | undefined;
    let addonExpiresAt: string | null = null;
    let rawMeta: Record<string, unknown> | null = null;

    if (payment.metadata) {
      try {
        const parsed = JSON.parse(payment.metadata) as Record<string, unknown>;
        rawMeta = parsed;
        paymentType = resolvePlanPaymentType(parsed?.paymentType ?? parsed?.type ?? null);
        breakdown = parsed?.breakdown as PlanCheckoutBreakdown | undefined;
        addonExpiresAt = typeof parsed?.addonExpiresAt === "string" ? parsed.addonExpiresAt : null;
      } catch {
        paymentType = PLAN_PAYMENT_TYPE_PURCHASE;
      }
    }

    // Heurística extra: se o externalReference indicar add-on, ajusta classificação
    if (rawMeta && typeof rawMeta["externalReference"] === "string") {
      const ref = (rawMeta["externalReference"] as string).trim().toLowerCase();
      if (ref.startsWith("plan-addon:")) {
        paymentType = PLAN_PAYMENT_TYPE_ADDON;
      }
    }

    // Heurística adicional: se o breakdown tiver baseAmount 0 e houver linhas de add-ons,
    // trata-se de uma compra somente de add-ons, mesmo que algum campo de tipo esteja ausente.
    if (
      breakdown &&
      typeof (breakdown as any).baseAmount === 'number' &&
      (breakdown as any).baseAmount === 0 &&
      Array.isArray((breakdown as any).addons) &&
      (breakdown as any).addons.length > 0
    ) {
      paymentType = PLAN_PAYMENT_TYPE_ADDON;
    }

    const planStatus = await getUserPlanStatus(user.id);

    // Fallback: se ainda classificado como purchase, tenta inspecionar o pagamento no MP
    if (paymentType !== PLAN_PAYMENT_TYPE_ADDON && payment.provider.startsWith('mercadopago_')) {
      try {
        let accessToken: string | null = null;
        if (payment.provider === 'mercadopago_pix') {
          const cfg = await getAdminMercadoPagoPixConfig();
          if (cfg?.isConfigured && cfg.accessToken) accessToken = cfg.accessToken;
        } else if (payment.provider === 'mercadopago_checkout') {
          const cfg = await getAdminMercadoPagoCheckoutConfig();
          if (cfg?.isConfigured && cfg.accessToken) accessToken = cfg.accessToken;
        }
        if (accessToken) {
          const details = await fetchMercadoPagoPayment({ accessToken, paymentId: payment.provider_payment_id });
          const ext = (details.raw as any)?.external_reference;
          if (typeof ext === 'string' && ext.trim().toLowerCase().startsWith('plan-addon:')) {
            paymentType = PLAN_PAYMENT_TYPE_ADDON;
          }
        }
      } catch {
        // ignore classification fallback errors
      }
    }

    return NextResponse.json({
      status: payment.status,
      statusDetail: payment.status_detail,
      provider: payment.provider,
      amount: Number.parseFloat(String(payment.amount ?? 0)) || 0,
      updatedAt: payment.updated_at instanceof Date
        ? payment.updated_at.toISOString()
        : new Date(payment.updated_at as any).toISOString(),
      paymentType,
      breakdown,
      addonExpiresAt,
      planStatus,
    });
  } catch (error) {
    console.error("Failed to fetch plan payment status", error);
    return NextResponse.json(
      { message: "Não foi possível verificar o status do pagamento." },
      { status: 500 },
    );
  }
}
export const dynamic = "force-dynamic";
