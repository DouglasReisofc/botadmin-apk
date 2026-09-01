import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  AdminMetaTemplateError,
  createAdminMetaTemplate,
  getAdminMetaTemplates,
  resolveMetaTemplateCredentials,
} from "lib/admin-meta-templates";
import { MetaApiError } from "lib/meta-profile";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const webhook = await getAdminWebhookRow();
    const hasCredentials = Boolean(await resolveMetaTemplateCredentials(webhook));
    const templates = await getAdminMetaTemplates();

    return NextResponse.json({ templates, hasCredentials });
  } catch (error) {
    console.error("Failed to load admin Meta templates", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os modelos cadastrados." },
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

    const payload = await request.json().catch(() => null);

    if (!payload) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const webhook = await getAdminWebhookRow();
    const template = await createAdminMetaTemplate(webhook, payload);

    return NextResponse.json({
      message:
        "Modelo criado com sucesso. Aguarde a aprovação da Meta antes de utilizá-lo em campanhas.",
      template,
    });
  } catch (error) {
    console.error("Failed to create admin Meta template", error);

    if (error instanceof AdminMetaTemplateError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          message:
            error.body &&
            typeof error.body === "object" &&
            "error" in error.body &&
            error.body.error &&
            typeof (error.body.error as Record<string, unknown>).message === "string"
              ? ((error.body.error as { message?: string }).message ??
                "A Meta retornou um erro ao criar o modelo.")
              : "A Meta retornou um erro ao criar o modelo.",
          details: error.body,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { message: "Não foi possível criar o modelo no momento." },
      { status: 500 },
    );
  }
}
