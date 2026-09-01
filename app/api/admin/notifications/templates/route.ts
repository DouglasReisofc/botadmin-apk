import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAllAdminEmailTemplates } from "lib/admin-email-templates";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const templates = await getAllAdminEmailTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Failed to load email templates", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os modelos de e-mail." },
      { status: 500 },
    );
  }
}
