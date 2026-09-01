import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  AdminSmtpSettingsError,
  getAdminSmtpSettings,
  saveAdminSmtpSettings,
} from "lib/admin-smtp";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const settings = await getAdminSmtpSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Failed to load admin SMTP settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações de e-mail." },
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

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      host,
      port,
      secure,
      username,
      password,
      fromName,
      fromEmail,
      replyTo,
    } = body as Record<string, unknown>;

    const settings = await saveAdminSmtpSettings({
      host: typeof host === "string" ? host : "",
      port: typeof port === "number" ? port : Number.parseInt(String(port ?? ""), 10),
      secure: Boolean(secure),
      username: typeof username === "string" ? username : null,
      password: typeof password === "string" ? password : null,
      fromName: typeof fromName === "string" ? fromName : "",
      fromEmail: typeof fromEmail === "string" ? fromEmail : "",
      replyTo: typeof replyTo === "string" ? replyTo : null,
    });

    return NextResponse.json({
      message: "Configurações de e-mail atualizadas com sucesso.",
      settings,
    });
  } catch (error) {
    if (error instanceof AdminSmtpSettingsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to save admin SMTP settings", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações de e-mail." },
      { status: 500 },
    );
  }
}
