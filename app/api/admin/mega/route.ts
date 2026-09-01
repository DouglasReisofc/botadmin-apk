import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  MegaCredentialsError,
  getAdminMegaCredentials,
  saveAdminMegaCredentials,
} from "lib/admin-mega-credentials";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const credentials = await getAdminMegaCredentials();
    return NextResponse.json({ credentials });
  } catch (error) {
    console.error("Failed to load Mega credentials", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as credenciais do Mega." },
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
    const credentials = await saveAdminMegaCredentials(payload);
    return NextResponse.json({
      message: "Credenciais do Mega atualizadas com sucesso.",
      credentials,
    });
  } catch (error) {
    if (error instanceof MegaCredentialsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to update Mega credentials", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as credenciais do Mega." },
      { status: 500 },
    );
  }
}
