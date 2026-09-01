import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInterageConfigError,
  getAdminBotInterageConfig,
  saveAdminBotInterageConfig,
} from "lib/admin-botinterage-config";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const config = await getAdminBotInterageConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Failed to load BotInterage config", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a configuração do BotInterage." },
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

    const payload = await request.json();
    const config = await saveAdminBotInterageConfig(payload);

    return NextResponse.json({
      message: "Configuração do BotInterage atualizada com sucesso.",
      config,
    });
  } catch (error) {
    if (error instanceof BotInterageConfigError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to update BotInterage config", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a configuração do BotInterage." },
      { status: 500 },
    );
  }
}
