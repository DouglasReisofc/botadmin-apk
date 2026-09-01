import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  AdminMetaTemplateError,
  resolveMetaTemplateCredentials,
  syncAdminMetaTemplates,
} from "lib/admin-meta-templates";
import { MetaApiError } from "lib/meta-profile";

const ALLOWED_TEMPLATE_STATUSES = new Set([
  "APPROVED",
  "PENDING",
  "REJECTED",
  "IN_APPEAL",
  "PAUSED",
  "DISABLED",
]);

const sanitizeStatus = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();

  if (!normalized) {
    return undefined;
  }

  if (!ALLOWED_TEMPLATE_STATUSES.has(normalized)) {
    throw new AdminMetaTemplateError(
      "Status inválido. Utilize APPROVED, PENDING, REJECTED ou IN_APPEAL.",
    );
  }

  return normalized;
};

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const payload = await request.json().catch(() => ({}));
    const status = sanitizeStatus(payload?.status);

    const webhook = await getAdminWebhookRow();

    if (!(await resolveMetaTemplateCredentials(webhook))) {
      throw new AdminMetaTemplateError(
        "Configure o webhook administrativo com o access token, Business Account ID e número oficial antes de importar os modelos.",
      );
    }

    const templates = await syncAdminMetaTemplates(webhook, { status });

    return NextResponse.json({
      message: "Sincronização concluída com sucesso.",
      templates,
    });
  } catch (error) {
    console.error("Failed to sync admin Meta templates", error);

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
                "A Meta retornou um erro ao importar os modelos.")
              : "A Meta retornou um erro ao importar os modelos.",
          details: error.body,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { message: "Não foi possível sincronizar os modelos agora." },
      { status: 500 },
    );
  }
}
