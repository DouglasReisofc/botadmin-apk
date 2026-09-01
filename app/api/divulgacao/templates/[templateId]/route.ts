import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteDivulgacaoTemplate, updateDivulgacaoTemplate } from "lib/divulgacao";
import type { DivulgacaoTemplateInput } from "types/divulgacao";

type RouteContext = {
  params: { templateId: string };
};

const parseTemplateId = (value: string): number => {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("ID inválido.");
  }
  return id;
};

const parsePayload = async (request: NextRequest): Promise<DivulgacaoTemplateInput | null> => {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return null;
    }
    return body as DivulgacaoTemplateInput;
  } catch {
    return null;
  }
};

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const templateId = parseTemplateId(context.params.templateId);
    const payload = await parsePayload(request);
    if (!payload) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }
    const template = await updateDivulgacaoTemplate(user.id, templateId, payload);
    return NextResponse.json({ message: "Mensagem atualizada com sucesso.", template });
  } catch (error) {
    const status =
      error instanceof Error && typeof (error as { status?: number }).status === "number"
        ? (error as { status?: number }).status!
        : 400;
    const message =
      error instanceof Error ? error.message : "Não foi possível atualizar a mensagem.";
    return NextResponse.json({ message }, { status: Number.isFinite(status) ? status : 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const templateId = parseTemplateId(context.params.templateId);
    await deleteDivulgacaoTemplate(user.id, templateId);
    return NextResponse.json({ message: "Mensagem removida com sucesso." });
  } catch (error) {
    const status =
      error instanceof Error && typeof (error as { status?: number }).status === "number"
        ? (error as { status?: number }).status!
        : 400;
    const message =
      error instanceof Error ? error.message : "Não foi possível remover a mensagem.";
    return NextResponse.json({ message }, { status: Number.isFinite(status) ? status : 400 });
  }
}
