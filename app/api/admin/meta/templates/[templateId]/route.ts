import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  AdminMetaTemplateError,
  updateAdminMetaTemplate,
} from "lib/admin-meta-templates";
import { MetaApiError } from "lib/meta-profile";

type RouteContext = {
  params: Promise<{ templateId: string }>;
};

export async function PUT(request: NextRequest, { params }: RouteContext) {
  let requestPayload: unknown = null;
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const { templateId: templateIdParam } = await params;
    const templateId = templateIdParam?.trim();

    if (!templateId) {
      return NextResponse.json({ message: "Modelo inválido." }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    requestPayload = payload;

    if (!payload) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const webhook = await getAdminWebhookRow();
    const template = await updateAdminMetaTemplate(webhook, templateId, payload);

    return NextResponse.json({
      message: "Modelo atualizado com sucesso.",
      template,
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("Failed to update admin Meta template (MetaApiError)", {
        status: error.status,
        statusText: error.statusText,
        body: error.body,
        context: error.context,
        requestPayload,
      });
    } else {
      console.error("Failed to update admin Meta template", {
        error,
        requestPayload,
      });
    }

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
                "A Meta retornou um erro ao atualizar o modelo.")
              : "A Meta retornou um erro ao atualizar o modelo.",
          details: error.body,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { message: "Não foi possível atualizar o modelo agora." },
      { status: 500 },
    );
  }
}
