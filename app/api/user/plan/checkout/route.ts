import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createPlanCheckoutPreference, createPlanPixCharge } from "lib/plan-payments";
import { getSubscriptionPlanForUser } from "lib/plans";
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
    modeRaw === "profile_unlimited" ||
    modeRaw === "group_activation" ||
    modeRaw === "group_renewal"
      ? modeRaw
      : null;
  const activateGroupOnApproval =
    source.activateGroupOnApproval === true ||
    source.activate_group_on_approval === true ||
    source.activateGroupOnApproval === "true" ||
    source.activate_group_on_approval === "true";
  const proxyEnabled =
    source.proxyEnabled === true ||
    source.proxy_enabled === true ||
    source.proxyEnabled === "true" ||
    source.proxy_enabled === "true";

  const context: Record<string, unknown> = {};
  if (mode) context.mode = mode;
  if (Number.isFinite(groupId) && groupId > 0) context.groupId = groupId;
  if (Number.isFinite(instanceId) && instanceId > 0) context.instanceId = instanceId;
  if (activateGroupOnApproval || mode === "group_activation" || mode === "group_renewal") {
    context.activateGroupOnApproval = true;
  }
  if (proxyEnabled) context.proxyEnabled = true;

  return Object.keys(context).length > 0 ? context : null;
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

    const planId = Number.parseInt(String((body as Record<string, unknown>).planId ?? ""), 10);
    const provider = String((body as Record<string, unknown>).provider ?? "mercadopago_pix");

    const checkoutContext = sanitizeCheckoutContext((body as Record<string, unknown>).context);
    const addons: PlanAddonSelection[] = [];

    if (!Number.isFinite(planId) || planId <= 0) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 400 });
    }

    if (!["mercadopago_pix", "polopag_pix", "mercadopago_checkout"].includes(provider)) {
      return NextResponse.json({ message: "Provedor de pagamento inválido." }, { status: 400 });
    }

    const plan = await getSubscriptionPlanForUser(planId, user.id);
    if (!plan || !plan.isActive) {
      return NextResponse.json({ message: "Plano indisponível para assinatura." }, { status: 404 });
    }

    if (plan.price <= 0) {
      return NextResponse.json({ message: "Plano configurado com valor inválido." }, { status: 400 });
    }

    const checkout =
      provider === "mercadopago_checkout"
        ? await createPlanCheckoutPreference({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            plan,
            addons,
            context: checkoutContext,
          })
        : await createPlanPixCharge({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            plan,
            addons,
            provider: provider as "mercadopago_pix" | "polopag_pix",
            context: checkoutContext,
          });

    return NextResponse.json({
      message: "Pagamento criado com sucesso.",
      checkout,
    });
  } catch (error) {
    console.error("Failed to create plan checkout", error);
    return NextResponse.json(
      { message: "Não foi possível gerar o pagamento do plano." },
      { status: 500 },
    );
  }
}
