import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAllSubscriptionPlansForUser } from "lib/plans";
import { getPartnerFinancialSettings, getPartnerPlanCreditCosts } from "lib/partner-finance";
import {
  ResellerProgramError,
  activatePartnerCustomer,
  createPartnerMember,
  createPartnerCustomer,
  grantPartnerCredits,
  getPartnerAccess,
  getPartnerWallet,
  listPartnerCustomers,
  listPartnerMembers,
  removePartnerMember,
  upsertPartnerMember,
  updatePartnerCustomer,
} from "lib/reseller-program";

type PartnerDashboardPayload = Record<string, unknown>;
type PartnerDashboardCacheEntry = {
  expiresAt: number;
  payload: PartnerDashboardPayload;
};

// Partner workspaces are read far more often than they change (navigation,
// hot reload and mobile reconnects). Keep a short, user-scoped cache and
// coalesce concurrent requests so a slow database cannot blank the panel.
const PARTNER_CACHE_TTL_MS = 15_000;
const partnerDashboardCache = new Map<number, PartnerDashboardCacheEntry>();
const partnerDashboardInflight = new Map<
  number,
  Promise<PartnerDashboardPayload>
>();

async function loadPartnerDashboard(userId: number): Promise<PartnerDashboardPayload> {
  const now = Date.now();
  const cached = partnerDashboardCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.payload;
  const running = partnerDashboardInflight.get(userId);
  if (running) return running;
  const request = (async () => {
    const access = await getPartnerAccess(userId);
    if (!access || !Object.values(access.permissions).some(Boolean)) {
      return {
        enabled: false,
        role: access?.role ?? null,
        permissions: access?.permissions ?? {},
      };
    }
    const [wallet, customers, plans, partners, financialSettings, planCosts] =
      await Promise.all([
        getPartnerWallet(userId),
        access.permissions.manage_customers
          ? listPartnerCustomers(userId)
          : Promise.resolve([]),
        access.permissions.manage_customers
          ? getAllSubscriptionPlansForUser(userId)
          : Promise.resolve([]),
        access.permissions.manage_partners
          ? listPartnerMembers(userId, access)
          : Promise.resolve([]),
        getPartnerFinancialSettings(userId),
        access.permissions.activate_customers
          ? getPartnerPlanCreditCosts(userId)
          : Promise.resolve([]),
      ]);
    const costMap = new Map(planCosts.map((item) => [item.planId, item.creditCost]));
    const enrichedPlans = plans.filter((plan) => plan.isActive).map((plan) => ({
      ...plan,
      creditCost: costMap.get(plan.id) ?? 1,
      commissionAmount:
        Math.round(Number(plan.price) * financialSettings.commissionRate) / 100,
    }));
    return {
      enabled: true,
      role: access.role,
      permissions: access.permissions,
      wallet,
      customers,
      partners,
      plans: enrichedPlans,
      financialSettings,
      planCosts,
    };
  })();
  partnerDashboardInflight.set(userId, request);
  try {
    const payload = await request;
    partnerDashboardCache.set(userId, {
      expiresAt: Date.now() + PARTNER_CACHE_TTL_MS,
      payload,
    });
    return payload;
  } finally {
    partnerDashboardInflight.delete(userId);
  }
}

function invalidatePartnerDashboard(userId: number) {
  partnerDashboardCache.delete(userId);
}

const fail = (error: unknown) => {
  if (error instanceof ResellerProgramError) return NextResponse.json({ message: error.message }, { status: error.status });
  console.error("[user/reseller] request failed", error);
  return NextResponse.json({ message: "Não foi possível concluir a operação de revenda." }, { status: 500 });
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const payload = await loadPartnerDashboard(user.id);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30" },
    });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    const action = String(body.action ?? "create_customer").trim().toLowerCase();
    if (action === "create_subpartner" || action === "create_partner") {
      const member = await createPartnerMember({
        actorUserId: user.id,
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        whatsappNumber: typeof body.whatsappNumber === "string" ? body.whatsappNumber : null,
        role: body.role ?? "reseller",
        permissions: body.permissions && typeof body.permissions === "object" ? body.permissions as Record<string, unknown> : null,
        status: body.status === "suspended" ? "suspended" : "active",
        commissionRate: body.commissionRate == null || body.commissionRate === "" ? undefined : Number(body.commissionRate),
        initialCredits: body.initialCredits == null || body.initialCredits === "" ? undefined : Number(body.initialCredits),
      });
      invalidatePartnerDashboard(user.id);
      return NextResponse.json({ message: "Parceiro criado com sucesso.", member }, { status: 201 });
    }
    if (action === "grant_subpartner_credits" || action === "transfer_credits") {
      const wallet = await grantPartnerCredits({
        actorUserId: user.id,
        resellerUserId: Number(body.resellerUserId ?? body.userId),
        credits: Number(body.credits),
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
        referenceId: typeof body.referenceId === "string" ? body.referenceId : null,
      });
      invalidatePartnerDashboard(user.id);
      return NextResponse.json({ message: "Créditos distribuídos.", wallet });
    }
    if (action === "update_subpartner" || action === "update_partner") {
      const member = await upsertPartnerMember({
        actorUserId: user.id,
        userId: Number(body.userId),
        role: body.role ?? "reseller",
        permissions: body.permissions && typeof body.permissions === "object" ? body.permissions as Record<string, unknown> : null,
        status: body.status === "suspended" ? "suspended" : "active",
        commissionRate: body.commissionRate == null || body.commissionRate === "" ? undefined : Number(body.commissionRate),
        name: typeof body.name === "string" ? body.name : undefined,
        email: typeof body.email === "string" ? body.email : undefined,
        whatsappNumber: typeof body.whatsappNumber === "string" || body.whatsappNumber === null ? body.whatsappNumber as string | null : undefined,
        password: typeof body.password === "string" ? body.password : null,
      });
      invalidatePartnerDashboard(user.id);
      return NextResponse.json({ message: "Revendedor atualizado.", member });
    }
    if (action === "remove_subpartner" || action === "remove_partner") {
      const result = await removePartnerMember(user.id, Number(body.userId));
      invalidatePartnerDashboard(user.id);
      return NextResponse.json({ message: "Revendedor removido da equipe.", ...result });
    }
    if (action === "activate" || action === "activation") {
      const result = await activatePartnerCustomer({
        resellerUserId: user.id,
        customerUserId: Number(body.customerUserId),
        planId: Number(body.planId),
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      });
      invalidatePartnerDashboard(user.id);
      return NextResponse.json({ message: "Cliente ativado com sucesso.", ...result });
    }
    if (action === "update_customer" || action === "edit_customer") {
      const customer = await updatePartnerCustomer({
        resellerUserId: user.id,
        customerUserId: Number(body.customerUserId),
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        whatsappNumber: typeof body.whatsappNumber === "string" ? body.whatsappNumber : null,
      });
      invalidatePartnerDashboard(user.id);
      return NextResponse.json({ message: "Cliente atualizado.", customer });
    }
    const result = await createPartnerCustomer({
      resellerUserId: user.id,
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      whatsappNumber: typeof body.whatsappNumber === "string" ? body.whatsappNumber : null,
      planId: body.planId == null || body.planId === "" ? null : Number(body.planId),
    });
    invalidatePartnerDashboard(user.id);
    return NextResponse.json({ message: "Cliente criado com sucesso.", ...result }, { status: 201 });
  } catch (error) { return fail(error); }
}
