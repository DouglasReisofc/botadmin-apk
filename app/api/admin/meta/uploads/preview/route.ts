import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import { resolveTemplateMediaUrl } from "lib/admin-meta-media";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const handle = searchParams.get("handle")?.trim();

    if (!handle) {
      return NextResponse.json({ message: "Handle inválido." }, { status: 400 });
    }

    const webhook = await getAdminWebhookRow();
    const url = await resolveTemplateMediaUrl(webhook, handle);

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Failed to resolve template media preview", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a mídia.",
      },
      { status: 500 },
    );
  }
}
