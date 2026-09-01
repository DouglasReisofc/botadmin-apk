import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  SubscriptionPlanError,
  getAllSubscriptionPlans,
  getUserPlanLimits,
  getUserPlanAddons,
  getUserProfileSlotUsage,
  getUserPlanStatus,
  setManualProfileSlotsForUser,
  setUserPlanSubscription,
} from "lib/plans";
import { listGroupsForUser } from "lib/bot-groups";
import { listUserProfilesForAdmin } from "lib/bot-user-profiles";

const parseUserId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

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

const parseNonNegativeInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numeric =
    typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return null;
  }

  return Math.max(0, Math.floor(numeric));
};

const parseOptionalBoolean = (value: unknown): boolean | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  return undefined;
};

type ManualSubscriptionStatus = "pending" | "active" | "expired" | "cancelled";

const parseOptionalSubscriptionStatus = (value: unknown): ManualSubscriptionStatus | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "active" ||
    normalized === "expired" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }
  return undefined;
};

const parseOptionalDateValue = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
};

const parseProfileSlotItems = (
  value: unknown,
): Array<{ expiresAt?: string | null }> | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const slots: Array<{ expiresAt?: string | null }> = [];
  for (const item of value) {
    const itemMap =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const rawExpiresAtValue = itemMap.expiresAt ?? itemMap.expires_at ?? null;
    const rawExpiresAt =
      typeof rawExpiresAtValue === "string" && !rawExpiresAtValue.trim()
        ? null
        : rawExpiresAtValue;
    const normalizedExpiresAt = parseOptionalDateValue(rawExpiresAt);
    if (normalizedExpiresAt === undefined) {
      return null;
    }
    slots.push({ expiresAt: normalizedExpiresAt });
  }
  return slots;
};

type RouteParams<T> = T | Promise<T>;

export async function GET(
  _request: NextRequest,
  { params }: { params: RouteParams<{ id: string }> },
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const resolvedParams = await Promise.resolve(params);
    const userId = parseUserId(resolvedParams.id);
    if (!userId) {
      return NextResponse.json({ message: "Usuário inválido." }, { status: 404 });
    }

    const [status, limits, plans, groups, addons, profileSlots, profiles] =
      await Promise.all([
        getUserPlanStatus(userId),
        getUserPlanLimits(userId),
        getAllSubscriptionPlans(),
        listGroupsForUser(userId),
        getUserPlanAddons(userId, { includeExpired: true }),
        getUserProfileSlotUsage(userId),
        listUserProfilesForAdmin({ userId }),
      ]);

    return NextResponse.json({
      status,
      limits,
      plans,
      groups,
      addons,
      profileSlots,
      profiles,
    });
  } catch (error) {
    console.error("Failed to load user plan overview", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as informações de plano do usuário." },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: RouteParams<{ id: string }> },
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const resolvedParams = await Promise.resolve(params);
    const userId = parseUserId(resolvedParams.id);
    if (!userId) {
      return NextResponse.json({ message: "Usuário inválido." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      planId,
      status,
      periodStart,
      periodEnd,
      autoRenewPlan,
      profileSlots,
      profileSlotQuantity,
      profileSlotExpiresAt,
      profileSlotItems,
    } = body as {
      planId?: unknown;
      status?: unknown;
      periodStart?: unknown;
      periodEnd?: unknown;
      autoRenewPlan?: unknown;
      profileSlots?: unknown;
      profileSlotQuantity?: unknown;
      profileSlotExpiresAt?: unknown;
      profileSlotItems?: unknown;
    };

    const hasPlanUpdate = Object.prototype.hasOwnProperty.call(body, "planId");
    const hasSlotUpdate =
      Object.prototype.hasOwnProperty.call(body, "profileSlots") ||
      Object.prototype.hasOwnProperty.call(body, "profileSlotQuantity") ||
      Object.prototype.hasOwnProperty.call(body, "profileSlotExpiresAt") ||
      Object.prototype.hasOwnProperty.call(body, "profileSlotItems");

    if (!hasPlanUpdate && !hasSlotUpdate) {
      return NextResponse.json(
        { message: "Informe os slots de perfil ou o plano que deseja atualizar." },
        { status: 400 },
      );
    }

    const initialStatus = await getUserPlanStatus(userId);
    let result = {
      status: initialStatus,
      subscriptionId: initialStatus.subscriptionId,
    };

    if (hasPlanUpdate) {
      const parsedPlanId = planId === null ? null : parseOptionalNumber(planId);
      if (parsedPlanId !== null && Number.isNaN(parsedPlanId)) {
        return NextResponse.json({ message: "Plano inválido." }, { status: 400 });
      }

      const autoRenewValue = parseOptionalBoolean(autoRenewPlan);
      const normalizedStatus = parseOptionalSubscriptionStatus(status);
      const normalizedPeriodStart = parseOptionalDateValue(periodStart);
      const normalizedPeriodEnd = parseOptionalDateValue(periodEnd);

      result = await setUserPlanSubscription(userId, {
        planId: parsedPlanId,
        status: normalizedStatus,
        periodStart: normalizedPeriodStart,
        periodEnd: normalizedPeriodEnd,
        autoRenewPlan: autoRenewValue,
      });
    }

    let profileSlotSummary = await getUserProfileSlotUsage(userId);
    if (hasSlotUpdate) {
      const slotPayload =
        profileSlots && typeof profileSlots === "object"
          ? (profileSlots as Record<string, unknown>)
          : {};
      const parsedSlots = parseProfileSlotItems(
        slotPayload.slots ?? slotPayload.items ?? profileSlotItems,
      );
      if (parsedSlots === null) {
        return NextResponse.json({ message: "Slots de perfil inválidos." }, { status: 400 });
      }
      const parsedQuantity = parseNonNegativeInteger(
        slotPayload.quantity ?? profileSlotQuantity,
      );
      if (parsedSlots === undefined && parsedQuantity === null) {
        return NextResponse.json({ message: "Quantidade de slots inválida." }, { status: 400 });
      }

      const rawExpiresAt =
        slotPayload.expiresAt ??
        slotPayload.expires_at ??
        profileSlotExpiresAt ??
        null;
      const normalizedExpiresAt = parseOptionalDateValue(rawExpiresAt);
      profileSlotSummary = await setManualProfileSlotsForUser(userId, {
        quantity: parsedSlots === undefined ? parsedQuantity ?? 0 : undefined,
        expiresAt: normalizedExpiresAt,
        slots: parsedSlots,
        grantedByUserId: currentUser.id,
      });
    }

    const [limits, plans, groups, addons] = await Promise.all([
      getUserPlanLimits(userId),
      getAllSubscriptionPlans(),
      listGroupsForUser(userId),
      getUserPlanAddons(userId, { includeExpired: true }),
    ]);

    const message =
      hasSlotUpdate && !hasPlanUpdate
        ? "Slots de perfil atualizados com sucesso."
        : hasPlanUpdate && planId === null
          ? "Plano removido do usuário."
          : "Plano do usuário atualizado com sucesso.";

    return NextResponse.json({
      message,
      status: result.status,
      subscriptionId: result.subscriptionId,
      limits,
      plans,
      groups,
      addons,
      profileSlots: profileSlotSummary,
    });
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to update user plan manually", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o plano do usuário." },
      { status: 500 },
    );
  }
}
