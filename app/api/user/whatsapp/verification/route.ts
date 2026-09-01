import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminOperationalWuzapiClient } from "lib/admin-operational-instance";
import { createUserVerificationRequest } from "lib/user-verification";

const UNAVAILABLE_MESSAGE =
  "Não conseguimos verificar seu número agora, mas você pode verificar depois dentro do painel.";

export async function POST() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const operationalClient = await getAdminOperationalWuzapiClient();
    const adminWhatsapp = operationalClient?.conversation.instancePhone ?? null;
    const adminWhatsappDigits = (adminWhatsapp ?? "").replace(/[^0-9]/g, "");
    if (!adminWhatsappDigits) {
      return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    const verification = await createUserVerificationRequest(user.id);
    const message = `Ativar conta botadmin código: ${verification.code}`;
    const whatsappUrl = adminWhatsappDigits
      ? `https://wa.me/${adminWhatsappDigits}?text=${encodeURIComponent(message)}`
      : null;

    return NextResponse.json({
      verification: {
        token: verification.token,
        code: verification.code,
        expiresAt: verification.expiresAt,
        message,
        whatsappUrl,
        whatsappNumber: adminWhatsappDigits ? `+${adminWhatsappDigits}` : adminWhatsapp,
      },
    });
  } catch (error) {
    console.error("Failed to generate WhatsApp verification", error);
    return NextResponse.json(
      { message: "Não foi possível gerar o código de verificação." },
      { status: 500 },
    );
  }
}
