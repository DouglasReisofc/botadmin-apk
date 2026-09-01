import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  AdminSiteSettingsError,
  getAdminSiteSettings,
  saveAdminSiteSettingsFromForm,
} from "lib/admin-site";
import { sendRepositoryDispatch } from "lib/github-dispatch";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const settings = await getAdminSiteSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Failed to load admin site settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações do site." },
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
    const hasLogoUpload = formData.get("logo") instanceof File && (formData.get("logo")).size > 0;
    const removeLogo = String(formData.get("removeLogo")).toLowerCase() == "true";
    const hasAppIconUpload = formData.get("appIcon") instanceof File && (formData.get("appIcon") as File).size > 0;
    const removeAppIcon = String(formData.get("removeAppIcon")).toLowerCase() == "true";

    const settings = await saveAdminSiteSettingsFromForm(formData);

    if (hasLogoUpload || removeLogo || hasAppIconUpload || removeAppIcon) {
      try {
        await sendRepositoryDispatch("android_assets_regenerate", { reason: "logo_update" });
      } catch (_error) {}
    }

    return NextResponse.json({
      message: "Configurações atualizadas com sucesso.",
      settings,
    });
  } catch (error) {
    if (error instanceof AdminSiteSettingsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to save admin site settings", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações do site." },
      { status: 500 },
    );
  }
}
