import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  CustomerStoreDisabledError,
  updateCustomerForUser,
} from "lib/customers";

const parseBalance = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

    const sanitized = trimmed.replace(/[^0-9,.-]/g, "");
    const normalized = sanitized.includes(",")
      ? sanitized.replace(/\./g, "").replace(/,/g, ".")
      : sanitized;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

type CustomerRouteParams = {
  params: {
    id: string;
  };
};

export async function PUT(request: NextRequest, { params }: CustomerRouteParams) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const customerId = Number.parseInt(params.id, 10);
    if (Number.isNaN(customerId)) {
      return NextResponse.json({ message: "Cliente inválido." }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    }

    const payloadRecord = payload as Record<string, unknown>;

    const displayName = typeof payloadRecord.displayName === "string"
      ? payloadRecord.displayName
      : null;
    const notes = typeof payloadRecord.notes === "string" ? payloadRecord.notes : null;
    const isBlocked = Boolean(payloadRecord.isBlocked);
    const balance = parseBalance(payloadRecord.balance);

    const updated = await updateCustomerForUser(user.id, customerId, {
      displayName,
      notes,
      isBlocked,
      balance,
    });

    if (!updated) {
      return NextResponse.json({ message: "Cliente não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ customer: updated });
  } catch (error) {
    if (error instanceof CustomerStoreDisabledError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to update customer", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o cliente." },
      { status: 500 },
    );
  }
}
