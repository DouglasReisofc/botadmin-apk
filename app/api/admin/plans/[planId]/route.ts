import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  SubscriptionPlanError,
  deleteSubscriptionPlan,
  updateSubscriptionPlan,
} from "lib/plans";

const parseNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim().replace(/,/g, "."));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Number.NaN;
};

const parseInteger = (value: unknown): number => {
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

type PlanRouteParams = {
  params: Promise<{
    planId: string;
  }>;
};

export async function PUT(
  request: Request,
  { params }: PlanRouteParams,
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const { planId: planIdRaw } = await params;
    const planId = Number.parseInt(planIdRaw, 10);
    if (!Number.isFinite(planId)) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      name,
      description,
      price,
      addonInstancePrice,
      addonGroupPrice,
      groupLimit,
      instanceLimit,
      allowFlows,
      storageQuotaGb,
      durationDays,
      isActive,
      features,
    } = body as Record<string, unknown>;

    const payload = {
      name: typeof name === "string" ? name : "",
      description: typeof description === "string" ? description : null,
      price: parseNumber(price),
      addonInstancePrice: parseNumber(addonInstancePrice ?? 0),
      addonGroupPrice: parseNumber(addonGroupPrice ?? 0),
      groupLimit: parseInteger(groupLimit ?? 0),
      instanceLimit: parseInteger(instanceLimit ?? 0),
      allowFlows: allowFlows === undefined ? true : Boolean(allowFlows),
      storageQuotaGb: parseNumber(storageQuotaGb ?? 0),
      durationDays: parseInteger(durationDays),
      isActive: Boolean(isActive),
      features: features && typeof features === "object" && !Array.isArray(features) ? features as Record<string, boolean | number> : {},
    };

    const plan = await updateSubscriptionPlan(planId, payload);

    return NextResponse.json({
      message: "Plano atualizado com sucesso.",
      plan,
    });
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to update subscription plan", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o plano." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: PlanRouteParams,
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const { planId: planIdRaw } = await params;
    const planId = Number.parseInt(planIdRaw, 10);
    if (!Number.isFinite(planId)) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 404 });
    }

    await deleteSubscriptionPlan(planId);

    return NextResponse.json({ message: "Plano removido." });
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to delete subscription plan", error);
    return NextResponse.json(
      { message: "Não foi possível remover o plano." },
      { status: 500 },
    );
  }
}
