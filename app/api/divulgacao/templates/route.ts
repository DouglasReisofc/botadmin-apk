import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createDivulgacaoTemplate, listDivulgacaoTemplates } from "lib/divulgacao";
import type { DivulgacaoTemplateInput } from "types/divulgacao";

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

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const templates = await listDivulgacaoTemplates(user.id);
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("[Divulgacao] Failed to list templates", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as mensagens salvas." },
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
    const payload = await parsePayload(request);
    if (!payload) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const template = await createDivulgacaoTemplate(user.id, payload);
    return NextResponse.json({ message: "Mensagem criada com sucesso.", template }, { status: 201 });
  } catch (error) {
    const status =
      error instanceof Error && typeof (error as { status?: number }).status === "number"
        ? (error as { status?: number }).status!
        : 400;
    const message =
      error instanceof Error ? error.message : "Não foi possível salvar a mensagem.";
    return NextResponse.json({ message }, { status: Number.isFinite(status) ? status : 400 });
  }
}
