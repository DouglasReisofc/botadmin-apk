import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteApiRequestPlan,
  getApiRequestPlanById,
  updateApiRequestPlan,
} from "lib/api-request-plans";

const parsePlanId = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const parseCurrencyToCents = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value * 100));
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const sanitized = trimmed.replace(/[^0-9.,]/g, "");
    if (!sanitized) {
      return Number.NaN;
    }
    const normalizedInput = sanitized.replace(/,/g, ".");
    const dotMatches = normalizedInput.match(/\./g);
    let normalized = normalizedInput;
    if (dotMatches && dotMatches.length > 1) {
      const lastDotIndex = normalizedInput.lastIndexOf(".");
      const integerPart = normalizedInput.slice(0, lastDotIndex).replace(/\./g, "");
      const decimalPart = normalizedInput.slice(lastDotIndex + 1);
      normalized = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
    }
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed * 100));
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

export async function PUT(
  request: Request,
  { params }: { params: { planId: string } },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const planId = parsePlanId(params.planId);
    if (!Number.isFinite(planId) || planId <= 0) {
      return NextResponse.json({ message: "Pacote inválido." }, { status: 400 });
    }

    const existing = await getApiRequestPlanById(planId);
    if (!existing) {
      return NextResponse.json({ message: "Pacote não encontrado." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const updates: Record<string, unknown> = body as Record<string, unknown>;

    const payload: Parameters<typeof updateApiRequestPlan>[1] = {};

    if (typeof updates.name === "string") {
      payload.name = updates.name;
    }

    if (updates.description === null || typeof updates.description === "string") {
      payload.description = updates.description as string | null;
    }

    if (updates.price !== undefined) {
      const priceCents = parseCurrencyToCents(updates.price);
      if (!Number.isFinite(priceCents) || priceCents <= 0) {
        return NextResponse.json({ message: "Informe um valor válido para o pacote." }, { status: 400 });
      }
      payload.priceCents = priceCents;
    }

    if (updates.requestAmount !== undefined) {
      const requests = parseInteger(updates.requestAmount);
      if (!Number.isFinite(requests) || requests <= 0) {
        return NextResponse.json({ message: "Informe a quantidade de requisições." }, { status: 400 });
      }
      payload.requestAmount = requests;
    }

    if (updates.isActive !== undefined) {
      payload.isActive = Boolean(updates.isActive);
    }

    if (updates.orderIndex !== undefined) {
      const order = parseInteger(updates.orderIndex);
      if (Number.isFinite(order) && order >= 0) {
        payload.orderIndex = order;
      }
    }

    const updated = await updateApiRequestPlan(planId, payload);

    return NextResponse.json({
      message: "Pacote atualizado com sucesso.",
      plan: updated,
    });
  } catch (error) {
    console.error("Failed to update API request plan", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o pacote de requisições." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { planId: string } },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const planId = parsePlanId(params.planId);
    if (!Number.isFinite(planId) || planId <= 0) {
      return NextResponse.json({ message: "Pacote inválido." }, { status: 400 });
    }

    await deleteApiRequestPlan(planId);

    return NextResponse.json({ message: "Pacote removido com sucesso." });
  } catch (error) {
    console.error("Failed to delete API request plan", error);
    return NextResponse.json(
      { message: "Não foi possível remover o pacote de requisições." },
      { status: 500 },
    );
  }
}
