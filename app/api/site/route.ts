import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getSiteSettingsForUser, saveSiteSettingsFromForm, SiteSettingsError } from "lib/site";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const settings = await getSiteSettingsForUser(user.id);

    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Failed to load site settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações do site." },
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

    const formData = await request.formData();
    const settings = await saveSiteSettingsFromForm(user.id, formData);

    return NextResponse.json({
      message: "Configurações do site atualizadas com sucesso.",
      settings,
    });
  } catch (error) {
    if (error instanceof SiteSettingsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to save site settings", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações do site." },
      { status: 500 },
    );
  }
}
