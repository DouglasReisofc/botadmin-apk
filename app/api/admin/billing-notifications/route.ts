import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BILLING_NOTIFICATION_VARIABLES,
  getBillingNotificationSettings,
  updateBillingNotificationSettings,
} from "lib/admin-billing-notifications";
import type { BillingNotificationSettings } from "types/admin-notifications";

const ensureAdminAccess = async () => {
  const current = await getCurrentUser();
  if (!current || current.role !== "admin") {
    throw new Error("Acesso restrito.");
  }
};

export async function GET() {
  try {
    await ensureAdminAccess();
    const settings = await getBillingNotificationSettings();
    return NextResponse.json({ settings, variables: BILLING_NOTIFICATION_VARIABLES });
  } catch (error) {
    if (error instanceof Error && error.message === "Acesso restrito.") {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    console.error("Failed to load billing notification settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações de notificações." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureAdminAccess();
    let payload: BillingNotificationSettings | null = null;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    }

    const updated = await updateBillingNotificationSettings(payload as BillingNotificationSettings);
    return NextResponse.json({
      message: "Configurações atualizadas com sucesso.",
      settings: updated,
      variables: BILLING_NOTIFICATION_VARIABLES,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Acesso restrito.") {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    console.error("Failed to update billing notification settings", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações de notificações." },
      { status: 500 },
    );
  }
}
