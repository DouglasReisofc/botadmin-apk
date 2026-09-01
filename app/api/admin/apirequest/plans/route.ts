import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  createApiRequestPlan,
  getApiRequestPlanById,
  listApiRequestPlans,
  updateApiRequestPlan,
} from "lib/api-request-plans";

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

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const plans = await listApiRequestPlans({ includeInactive: true });
    return NextResponse.json({ plans });
  } catch (error) {
    console.error("Failed to list API request plans", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os pacotes de requisições." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      name,
      description,
      price,
      requestAmount,
      isActive,
      orderIndex,
    } = body as Record<string, unknown>;

    const priceCents = parseCurrencyToCents(price);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      return NextResponse.json({ message: "Informe um valor válido para o pacote." }, { status: 400 });
    }

    const requests = parseInteger(requestAmount);
    if (!Number.isFinite(requests) || requests <= 0) {
      return NextResponse.json({ message: "Informe a quantidade de requisições." }, { status: 400 });
    }

    let plan = await createApiRequestPlan({
      name: typeof name === "string" ? name : "",
      description: typeof description === "string" ? description : null,
      priceCents,
      requestAmount: requests,
      isActive: isActive !== false,
    });

    const parsedOrder = parseInteger(orderIndex);
    if (Number.isFinite(parsedOrder) && parsedOrder >= 0) {
      await updateApiRequestPlan(plan.id, { orderIndex: parsedOrder });
      const refreshed = await getApiRequestPlanById(plan.id);
      if (refreshed) {
        plan = refreshed;
      }
    }

    return NextResponse.json({
      message: "Pacote criado com sucesso.",
      plan,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to create API request plan", error);
    return NextResponse.json(
      { message: "Não foi possível criar o pacote de requisições." },
      { status: 500 },
    );
  }
}
