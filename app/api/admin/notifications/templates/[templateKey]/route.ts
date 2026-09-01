import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  AdminEmailTemplateError,
  updateAdminEmailTemplate,
} from "lib/admin-email-templates";

type TemplateRouteParams = {
  params: {
    templateKey: string;
  };
};

export async function PUT(
  request: Request,
  { params }: TemplateRouteParams,
) {
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

    const template = await updateAdminEmailTemplate(params.templateKey, {
      subject: typeof body.subject === "string" ? body.subject : "",
      heading: typeof body.heading === "string" ? body.heading : "",
      bodyHtml: typeof body.bodyHtml === "string" ? body.bodyHtml : "",
      ctaLabel: typeof body.ctaLabel === "string" ? body.ctaLabel : null,
      ctaUrl: typeof body.ctaUrl === "string" ? body.ctaUrl : null,
      footerText: typeof body.footerText === "string" ? body.footerText : null,
    });

    return NextResponse.json({
      message: "Modelo de e-mail atualizado com sucesso.",
      template,
    });
  } catch (error) {
    if (error instanceof AdminEmailTemplateError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to update email template", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o modelo de e-mail." },
      { status: 500 },
    );
  }
}
