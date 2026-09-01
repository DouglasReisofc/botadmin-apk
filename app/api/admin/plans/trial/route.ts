import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  PLAN_TRIAL_TEMPLATE_VARIABLES,
  PlanTrialSettingsError,
  getPlanTrialSettings,
  savePlanTrialSettingsFromForm,
} from "lib/plan-trial-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const settings = await getPlanTrialSettings();
    return NextResponse.json({ settings, variables: PLAN_TRIAL_TEMPLATE_VARIABLES });
  } catch (error) {
    console.error("Failed to load plan trial settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações de teste gratuito." },
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
    const settings = await savePlanTrialSettingsFromForm(formData);
    return NextResponse.json({
      message: "Configurações de teste gratuito atualizadas com sucesso.",
      settings,
      variables: PLAN_TRIAL_TEMPLATE_VARIABLES,
    });
  } catch (error) {
    if (error instanceof PlanTrialSettingsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to save plan trial settings", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações de teste gratuito." },
      { status: 500 },
    );
  }
}
