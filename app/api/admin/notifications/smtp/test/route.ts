import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { sendEmail, EmailNotConfiguredError, EmailDeliveryError } from "lib/email";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : "";

    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ message: "Informe um e-mail válido para teste." }, { status: 400 });
    }

    await sendEmail({
      to: email,
      subject: "Teste de SMTP - StoreBot",
      text: [
        "Este é um e-mail de teste enviado pelo painel administrativo do StoreBot.",
        "",
        `Solicitado por: ${user.name} (${user.email})`,
        "",
        "Se você recebeu esta mensagem, o SMTP está configurado corretamente.",
      ].join("\n"),
    });

    return NextResponse.json({
      message: `E-mail de teste enviado para ${email}.`,
    });
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { message: "Configure o SMTP antes de executar o teste." },
        { status: 400 },
      );
    }

    if (error instanceof EmailDeliveryError) {
      return NextResponse.json(
        { message: error.message },
        { status: 502 },
      );
    }

    console.error("[SMTP Test] Falha ao enviar e-mail de teste", error);
    return NextResponse.json(
      { message: "Não foi possível enviar o e-mail de teste." },
      { status: 500 },
    );
  }
}
