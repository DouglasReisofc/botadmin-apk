import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getGroupSettings } from "lib/bot-group-settings";
import { listGroqModels } from "lib/apis/groq";

type ModelOption = {
  id: string;
  label: string;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const groupIdParam = searchParams.get("groupId");
    const groupId = groupIdParam ? Number.parseInt(groupIdParam, 10) : Number.NaN;
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const group = await getGroupByIdForUser(user.id, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    const settings = await getGroupSettings(group.id);
    const freeModels: ModelOption[] = [];

    if (Array.isArray(settings.groqKeys) && settings.groqKeys.length > 0) {
      const result = await listGroqModels(settings.groqKeys);
      if (Array.isArray(result.models)) {
        for (const model of result.models) {
          const id = typeof model?.id === "string" ? model.id.trim() : "";
          if (!id) continue;
          freeModels.push({
            id,
            label: id,
          });
        }
      }
    }

    const dedupe = (items: ModelOption[]) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    };

    const dedupedFree = dedupe(freeModels);

    return NextResponse.json({
      mode: "free",
      privateModels: [],
      freeModels: dedupedFree,
    });
  } catch (error) {
    console.error("[botinterage-models] failed to load models", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os modelos de IA." },
      { status: 500 },
    );
  }
}
