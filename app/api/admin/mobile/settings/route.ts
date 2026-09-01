import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { AdminMobileSettingsError, getAdminMobileSettings, saveAdminMobileSettingsFromForm } from "lib/admin-mobile";
import { sendRepositoryDispatch } from "lib/github-dispatch";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
  const settings = await getAdminMobileSettings();
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });

    const form = await request.formData();
    const settings = await saveAdminMobileSettingsFromForm(form);

    try { await sendRepositoryDispatch("android_assets_regenerate", { reason: "mobile_settings_update" }); } catch {}

    return NextResponse.json({ message: "Configurações do aplicativo atualizadas.", settings });
  } catch (error) {
    if (error instanceof AdminMobileSettingsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Falha ao salvar as configurações." }, { status: 500 });
  }
}

