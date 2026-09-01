import { NextRequest, NextResponse } from "next/server";

import { listGroqModels } from "lib/apis/groq";
import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getGroupSettings } from "lib/bot-group-settings";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const groupIdParam = searchParams.get("groupId");
    const groupId = groupIdParam ? Number.parseInt(groupIdParam, 10) : NaN;
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const group = await getGroupByIdForUser(user.id, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    const settings = await getGroupSettings(group.id);
    const keys = settings.groqKeys ?? [];
    if (keys.length === 0) {
      return NextResponse.json({
        models: [],
        rateLimitRemaining: null,
        error: { type: "no_keys", message: "Cadastre ao menos uma chave Groq para listar os modelos disponíveis." },
      });
    }

    const result = await listGroqModels(keys);
    return NextResponse.json({
      models: result.models,
      rateLimitRemaining:
        typeof result.rateLimitRemaining === "number" ? result.rateLimitRemaining : null,
      error: result.error ?? null,
    });
  } catch (error) {
    console.error("[groq] failed to list models", error);
    return NextResponse.json(
      { message: "Não foi possível consultar os modelos disponíveis." },
      { status: 500 },
    );
  }
}
