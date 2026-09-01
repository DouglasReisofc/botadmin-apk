import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createPlanAddonCheckoutPreference, createPlanAddonPixCharge, recordPlanPayment } from "lib/plan-payments";
import { applyGroupLicenseForUser } from "lib/bot-groups";
import { decreaseUserBalance, getUserBalanceById } from "lib/users";
import { computePlanCheckoutBreakdown, getSubscriptionPlanForUser, getUserPlanStatus, grantPlanAddons, normalizePlanAddonSelections } from "lib/plans";
import type { PlanAddonSelection } from "types/plans";

const sanitizeCheckoutContext = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const groupId = Number(source.groupId ?? source.group_id);
  const instanceId = Number(source.instanceId ?? source.instance_id);
  const modeRaw = typeof source.mode === "string" ? source.mode.trim().toLowerCase() : "";
  const mode =
    modeRaw === "instance_renewal" ||
    modeRaw === "instance_creation" ||
    modeRaw === "group_activation" ||
    modeRaw === "group_renewal"
      ? modeRaw
      : null;
  const activateGroupOnApproval =
    source.activateGroupOnApproval === true ||
    source.activate_group_on_approval === true ||
    source.activateGroupOnApproval === "true" ||
    source.activate_group_on_approval === "true";

  const context: Record<string, unknown> = {};
  if (mode) context.mode = mode;
  if (Number.isFinite(groupId) && groupId > 0) context.groupId = groupId;
  if (Number.isFinite(instanceId) && instanceId > 0) context.instanceId = instanceId;
  if (activateGroupOnApproval) context.activateGroupOnApproval = true;

  return Object.keys(context).length > 0 ? context : null;
};

const addPlanDuration = (days: number): string => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + Math.max(1, Math.floor(days || 1)));
  return expiresAt.toISOString();
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "sim", "yes", "on"].includes(normalized);
  }
  return false;
};

const roundCurrency = (value: number): number =>
  Math.round(Number(value || 0) * 100) / 100;

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

    const addonsInput = (body as Record<string, unknown>).addons;
    const checkoutContext = sanitizeCheckoutContext((body as Record<string, unknown>).context);
    const rawAddonSelections: PlanAddonSelection[] = [];

    if (Array.isArray(addonsInput)) {
      for (const entry of addonsInput) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const value = entry as Record<string, unknown>;
        const typeRaw = typeof value.type === "string" ? value.type.trim().toLowerCase() : "";
        if (typeRaw !== "instance" && typeRaw !== "group") {
          continue;
        }

        const quantityValue = Number.parseInt(String(value.quantity ?? ""), 10);
        if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
          continue;
        }

        rawAddonSelections.push({ type: typeRaw as PlanAddonSelection["type"], quantity: quantityValue });
      }
    }

    const addons = normalizePlanAddonSelections(rawAddonSelections);

    if (addons.length > 0) {
      return NextResponse.json(
        { message: "Add-ons de perfil e grupo foram descontinuados. Uma assinatura ativa libera todos os perfis, grupos e funcionalidades; storage continua separado." },
        { status: 410 },
      );
    }

    if (!Number.isFinite(planId) || planId <= 0) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 400 });
    }

    if (!["mercadopago_pix", "polopag_pix", "mercadopago_checkout"].includes(providerRaw)) {
      return NextResponse.json({ message: "Forma de pagamento inválida." }, { status: 400 });
    }

    const plan = await getSubscriptionPlanForUser(planId, user.id);
    if (!plan || !plan.isActive) {
      return NextResponse.json({ message: "Plano indisponível para assinatura." }, { status: 404 });
    }

    if (addons.length === 0) {
      return NextResponse.json({ message: "Informe ao menos um add-on válido." }, { status: 400 });
    }

    const subscriptionId = Number.isFinite((body as any).subscriptionId)
      ? Number((body as any).subscriptionId)
      : undefined;
    const addonExpiresAt = (body as any).addonExpiresAt ?? addPlanDuration(plan.durationDays);
    const useBalance = parseBoolean((body as Record<string, unknown>).useBalance);
    const breakdown = computePlanCheckoutBreakdown({ ...plan, price: 0 }, addons);
    const totalAmount = roundCurrency(breakdown.totalAmount);
    const currentBalance = useBalance ? await getUserBalanceById(user.id) : 0;
    const balanceApplied = useBalance ? roundCurrency(Math.min(Math.max(0, currentBalance), totalAmount)) : 0;
    const amountDue = roundCurrency(Math.max(0, totalAmount - balanceApplied));

    if (useBalance && balanceApplied > 0 && amountDue <= 0) {
      const paymentReference = `balance-addon:${user.id}:${plan.id}:${Date.now()}`;
      const newBalance = await decreaseUserBalance(user.id, balanceApplied);
      const parsedAddonExpiresAt = (() => {
        const parsed = new Date(addonExpiresAt);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      })();
      const planStatus = await getUserPlanStatus(user.id).catch(() => null);
      await grantPlanAddons({
        userId: user.id,
        subscriptionId: subscriptionId ?? planStatus?.subscriptionId ?? null,
        planId: plan.id,
        addons: breakdown.addons,
        periodEnd: parsedAddonExpiresAt,
        paymentReference,
        source: "addon_purchase",
      });

      const groupId = Number(checkoutContext?.groupId ?? checkoutContext?.group_id);
      const mode = typeof checkoutContext?.mode === "string" ? checkoutContext.mode : "";
      if (
        Number.isFinite(groupId) &&
        groupId > 0 &&
        (mode === "group_activation" || mode === "group_renewal" || checkoutContext?.activateGroupOnApproval === true)
      ) {
        await applyGroupLicenseForUser(user.id, groupId, plan, paymentReference, {
          licenseSource: "group_purchase",
        });
      }

      await recordPlanPayment({
        userId: user.id,
        planId: plan.id,
        provider: "balance",
        providerPaymentId: paymentReference,
        status: "approved",
        amount: totalAmount,
        subscriptionId: subscriptionId ?? planStatus?.subscriptionId ?? null,
        metadata: {
          type: "plan_addon",
          paymentType: "plan_addon",
          paidWithBalance: true,
          amountBeforeBalance: totalAmount,
          balanceApplied,
          amountDue: 0,
          breakdown,
          addonExpiresAt: parsedAddonExpiresAt ? parsedAddonExpiresAt.toISOString() : null,
          context: checkoutContext,
        },
      });

      return NextResponse.json({
        message: "Assinatura ativada usando o saldo disponível.",
        paidWithBalance: true,
        balance: newBalance,
      });
    }

    const checkout =
      providerRaw === "mercadopago_checkout"
        ? await createPlanAddonCheckoutPreference({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            plan,
            addons,
            subscriptionId: subscriptionId ?? null,
            addonExpiresAt,
            context: checkoutContext,
            balanceApplied,
          })
        : await createPlanAddonPixCharge({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            plan,
            addons,
            subscriptionId: subscriptionId ?? null,
            addonExpiresAt,
            provider: providerRaw as "mercadopago_pix" | "polopag_pix",
            context: checkoutContext,
            balanceApplied,
          });

    let balance: number | null = null;
    if (useBalance && balanceApplied > 0) {
      balance = await decreaseUserBalance(user.id, balanceApplied);
    }

    return NextResponse.json({
      message: "Pagamento criado com sucesso.",
      checkout,
      balanceApplied,
      balance,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Saldo insuficiente")) {
      return NextResponse.json({ message: error.message }, { status: 402 });
    }
    console.error("Failed to create plan addon checkout", error);
    return NextResponse.json(
      { message: "Não foi possível gerar o pagamento." },
      { status: 500 },
    );
  }
}
