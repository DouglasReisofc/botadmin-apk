import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getSubscriptionPlanForUser,
  activateUserPlan,
  normalizePlanAddonSelections,
  computePlanCheckoutBreakdown,
  grantPlanAddons,
} from "lib/plans";
import type { PlanAddonSelection } from "types/plans";
import { refreshBasePlanGroupLicensesForUser } from "lib/bot-groups";
import { decreaseUserBalance, getUserBasicById } from "lib/users";
import { recordPlanPayment } from "lib/plan-payments";
import { sendPlanPurchaseNotification } from "lib/notifications";
import { sendPurchaseSupportMessage } from "lib/support-automation";

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
    const addonsInput = (body as Record<string, unknown>).addons;
    const rawAddonSelections: PlanAddonSelection[] = [];

    if (Array.isArray(addonsInput)) {
      for (const entry of addonsInput) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const value = entry as Record<string, unknown>;
        const typeRaw = typeof value.type === "string" ? value.type.trim().toLowerCase() : "";
        if (typeRaw !== "instance") {
          continue;
        }

        const quantityValue = Number.parseInt(String(value.quantity ?? ""), 10);
        if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
          continue;
        }

        rawAddonSelections.push({ type: typeRaw as PlanAddonSelection['type'], quantity: quantityValue });
      }
    }

    const addons = normalizePlanAddonSelections(rawAddonSelections);

    if (!Number.isFinite(planId) || planId <= 0) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 400 });
    }

    const plan = await getSubscriptionPlanForUser(planId, user.id);
    if (!plan || !plan.isActive) {
      return NextResponse.json({ message: "Plano indisponível para assinatura." }, { status: 404 });
    }

    const breakdown = computePlanCheckoutBreakdown(plan, addons);

    if (breakdown.totalAmount <= 0) {
      return NextResponse.json({ message: "Valor do pagamento inv�lido." }, { status: 400 });
    }

    const totalAmount = breakdown.totalAmount;

    const paymentReference = `balance:${user.id}:${Date.now()}`;
    const newBalance = await decreaseUserBalance(user.id, totalAmount);
    const { status: planStatus, subscriptionId, periodEnd } = await activateUserPlan(user.id, plan.id);
    await refreshBasePlanGroupLicensesForUser(user.id);

    await grantPlanAddons({
      userId: user.id,
      subscriptionId,
      planId: plan.id,
      addons: breakdown.addons,
      periodEnd,
      paymentReference,
    });

    await recordPlanPayment({
      userId: user.id,
      planId: plan.id,
      provider: "balance",
      providerPaymentId: paymentReference,
      status: "approved",
      amount: totalAmount,
      metadata: {
        type: "plan",
        paidWithBalance: true,
        breakdown,
      },
      subscriptionId,
    });

    const userProfile = await getUserBasicById(user.id);
    if (userProfile) {
      await sendPlanPurchaseNotification({
        planName: plan.name,
        amount: totalAmount,
        buyerName: userProfile.name,
        buyerEmail: userProfile.email,
        buyerUserId: userProfile.id,
      });
      await sendPurchaseSupportMessage({
        userId: userProfile.id,
        userName: userProfile.name,
        productName: plan.name,
        amount: totalAmount,
      });
    }

    return NextResponse.json({
      message: "Plano ativado com sucesso usando o saldo disponível.",
      status: planStatus,
      balance: newBalance,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Saldo insuficiente")) {
      return NextResponse.json({ message: error.message }, { status: 402 });
    }

    console.error("Failed to activate plan with balance", error);
    return NextResponse.json(
      { message: "Não foi possível ativar o plano com o saldo disponível." },
      { status: 500 },
    );
  }
}

