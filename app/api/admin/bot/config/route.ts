import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminBotConfig, saveAdminBotConfigFromForm } from "lib/admin-bot-config";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const config = await getAdminBotConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Failed to load admin bot config", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações do bot." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const config = await saveAdminBotConfigFromForm(formData);

    return NextResponse.json({
      message: "Configurações do bot atualizadas com sucesso.",
      config,
    });
  } catch (error) {
    console.error("Failed to update admin bot config", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações do bot." },
      { status: 500 },
    );
  }
}
