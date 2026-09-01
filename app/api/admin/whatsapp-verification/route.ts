import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getSignupWhatsappVerificationSettings,
  saveSignupWhatsappVerificationSettings,
} from "lib/signup-whatsapp-settings";

const requireAdmin = async () => {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json({ message: "Não autenticado." }, { status: 401 }),
    };
  }
  if (user.role !== "admin") {
    return {
      response: NextResponse.json({ message: "Acesso restrito." }, { status: 403 }),
    };
  }
  return { user };
};

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("response" in auth) return auth.response;

    const settings = await getSignupWhatsappVerificationSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Failed to load WhatsApp verification settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a verificação de WhatsApp." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const settings = await saveSignupWhatsappVerificationSettings(payload);
    return NextResponse.json({
      message: "Verificação de WhatsApp atualizada.",
      settings,
    });
  } catch (error) {
    console.error("Failed to save WhatsApp verification settings", error);
    return NextResponse.json(
      { message: "Não foi possível salvar a verificação de WhatsApp." },
      { status: 500 },
    );
  }
}

