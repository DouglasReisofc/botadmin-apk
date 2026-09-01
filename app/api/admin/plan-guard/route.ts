import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  PLAN_GUARD_TEMPLATE_VARIABLES,
  PlanGuardSettingsError,
  getPlanGuardSettings,
  savePlanGuardSettingsFromForm,
} from "lib/plan-guard-settings";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const settings = await getPlanGuardSettings();
    return NextResponse.json({ settings, variables: PLAN_GUARD_TEMPLATE_VARIABLES });
  } catch (error) {
    console.error("Failed to load plan guard settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações de bloqueio por vencimento." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const formData = await request.formData();
    const settings = await savePlanGuardSettingsFromForm(formData);

    return NextResponse.json({
      message: "Configurações atualizadas com sucesso.",
      settings,
      variables: PLAN_GUARD_TEMPLATE_VARIABLES,
    });
  } catch (error) {
    if (error instanceof PlanGuardSettingsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to save plan guard settings", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações de bloqueio por vencimento." },
      { status: 500 },
    );
  }
}
