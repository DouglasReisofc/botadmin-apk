import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminPaymentMethodSummaries } from "lib/admin-payments";
import {
  getAllSubscriptionPlansForUser,
  getUserPlanAddons,
  getUserPlanLimits,
  getUserProfileSlotUsage,
  getUserPlanStatus,
} from "lib/plans";
import { getUserBalanceById } from "lib/users";
import type { SubscriptionPlan, UserPlanLimits, UserPlanStatus } from "types/plans";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

const ADMIN_LIMIT = 999999;

const withProfileUnlimitedFlag = (status: UserPlanStatus): UserPlanStatus & { profileUnlimited: boolean } => ({
  ...status,
  profileUnlimited:
    status.status === "active" &&
    status.plan != null &&
    Math.max(0, Math.floor(Number(status.plan.groupLimit ?? 0))) <= 0,
});

const buildAdminPlanSnapshot = (plans: SubscriptionPlan[], balance: number) => {
  const now = new Date().toISOString();
  const adminPlan: SubscriptionPlan = {
    id: 0,
    name: "Admin ilimitado",
    description: "Acesso administrativo sem cobrança.",
    price: 0,
    addonInstancePrice: 0,
    addonGroupPrice: 0,
    groupLimit: ADMIN_LIMIT,
    instanceLimit: ADMIN_LIMIT,
    allowFlows: true,
    storageQuotaGb: 0,
    durationDays: 36500,
    isActive: true,
    features: {},
    createdAt: now,
    updatedAt: now,
  };
  const status: UserPlanStatus = {
    planId: 0,
    subscriptionId: null,
    plan: adminPlan,
    status: "active",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    daysRemaining: null,
    autoRenewPlan: false,
    isTrial: false,
    trialEndsAt: null,
    trialDurationHours: null,
  };
  const limits: UserPlanLimits = {
    instanceLimit: ADMIN_LIMIT,
    groupLimit: 0,
  };
  return {
    status,
    limits,
    plans: [adminPlan, ...plans.filter((plan) => plan.id !== adminPlan.id)],
    addons: [],
    profileSlots: {
      total: ADMIN_LIMIT,
      used: 0,
      available: ADMIN_LIMIT,
      manualTotal: 0,
      manualAvailable: 0,
      manualExpiresAt: null,
      manualSlots: [],
      expiresAt: null,
      nextAvailableExpiresAt: null,
    },
    balance,
    adminExempt: true,
  };
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const [status, limits, plans, paymentMethods, addons, balance, profileSlots] = await Promise.all([
      getUserPlanStatus(user.id),
      getUserPlanLimits(user.id),
      getAllSubscriptionPlansForUser(user.id),
      getAdminPaymentMethodSummaries(),
      getUserPlanAddons(user.id, { includeExpired: true }),
      getUserBalanceById(user.id),
      getUserProfileSlotUsage(user.id),
    ]);

    if (user.role === "admin") {
      return NextResponse.json(
        {
          ...buildAdminPlanSnapshot(plans, balance),
          paymentMethods,
        },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        status: withProfileUnlimitedFlag(status),
        limits,
        plans,
        paymentMethods,
        addons,
        profileSlots,
        balance,
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Failed to load mobile plan snapshot", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os dados do plano." },
      { status: 500 },
    );
  }
}
