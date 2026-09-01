import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getCampaignRowByPublicId,
  importCampaignContactsFromCsv,
} from "lib/admin-campaigns";
import type { AdminCampaignContactsImportOptions } from "types/admin-campaigns";

interface RouteContext {
  params: { campaignId: string };
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const campaignId = params?.campaignId?.trim();
    if (!campaignId) {
      return NextResponse.json({ message: "Campanha inválida." }, { status: 400 });
    }

    const campaign = await getCampaignRowByPublicId(campaignId);
    if (!campaign) {
      return NextResponse.json({ message: "Campanha não encontrada." }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const optionsRaw = formData.get("options");

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Envie um arquivo CSV para importar os contatos." }, { status: 400 });
    }

    const options: AdminCampaignContactsImportOptions | null = (() => {
      if (typeof optionsRaw !== "string" || !optionsRaw.trim()) {
        return null;
      }

      try {
        const parsed = JSON.parse(optionsRaw) as Partial<AdminCampaignContactsImportOptions>;
        if (!parsed || typeof parsed !== "object") {
          return null;
        }

        if (!parsed.mapping || typeof parsed.mapping !== "object") {
          return null;
        }

        const phoneColumn = typeof parsed.mapping.phoneColumn === "string" ? parsed.mapping.phoneColumn : "";
        if (!phoneColumn.trim()) {
          return null;
        }

        return {
          delimiter:
            parsed.delimiter === ";" || parsed.delimiter === "\t" ? parsed.delimiter : ",",
          hasHeader: parsed.hasHeader !== false,
          mapping: {
            phoneColumn,
            nameColumn:
              typeof parsed.mapping.nameColumn === "string"
                ? parsed.mapping.nameColumn
                : null,
            variableColumns:
              typeof parsed.mapping.variableColumns === "object" && parsed.mapping.variableColumns
                ? Object.entries(parsed.mapping.variableColumns as Record<string, unknown>).reduce<Record<string, string | null>>(
                    (acc, [key, value]) => {
                      acc[key] = typeof value === "string" ? value : null;
                      return acc;
                    },
                    {},
                  )
                : {},
          },
        } satisfies AdminCampaignContactsImportOptions;
      } catch (error) {
        console.error("Failed to parse import options", error);
        return null;
      }
    })();

    if (!options) {
      return NextResponse.json({ message: "Configurações de importação inválidas." }, { status: 400 });
    }

    const text = await file.text();

    const result = await importCampaignContactsFromCsv(campaign, text, options);

    return NextResponse.json({
      message: "Importação concluída.",
      result,
    });
  } catch (error) {
    console.error("Failed to import campaign contacts", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível importar os contatos agora.",
      },
      { status: 500 },
    );
  }
}
