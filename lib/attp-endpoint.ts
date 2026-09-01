import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";

type FactoryKey = "createAttp" | "createAttp2" | "createAttp3";

type AttpModule = Partial<Record<FactoryKey, (text: string) => Promise<Buffer>>>;

const loadAttpModule = (): AttpModule | null => {
  try {
    const absolute = path.join(process.cwd(), "lib", "integrations", "apis", "funcoes", "attp.js");
    return (eval("require") as NodeRequire)(absolute) as AttpModule;
  } catch (error) {
    console.error("[attp-endpoint] Falha ao carregar módulo do ATTp", error);
    return null;
  }
};

const attpModule = loadAttpModule();

const sanitizeInput = (input: string) => input.replace(/\s+/g, " ").trim().slice(0, 200);

export const buildAttpEndpoint = (factoryKey: FactoryKey, fileName: string) => {
  return withUserApiAuth(async (req: NextRequest) => {
    const factory = attpModule?.[factoryKey];
    if (typeof factory !== "function") {
      return NextResponse.json(
        { status: false, mensagem: "Ferramenta de sticker indisponível no momento." },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(req.url);
    const textRaw = (searchParams.get("text") || searchParams.get("q") || "").trim();
    if (!textRaw) {
      return NextResponse.json(
        { status: false, mensagem: "Informe o parâmetro text (ou q) com o conteúdo desejado." },
        { status: 400 },
      );
    }

    const text = sanitizeInput(textRaw);
    if (!text) {
      return NextResponse.json(
        { status: false, mensagem: "Não foi possível processar o texto informado." },
        { status: 400 },
      );
    }

    try {
      const sticker = await factory(text);
      return new NextResponse(sticker, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Content-Disposition": `inline; filename="${fileName}.webp"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error: any) {
      console.error("[attp-endpoint] Falha ao gerar sticker", error);
      return NextResponse.json(
        { status: false, mensagem: error?.message ?? "Não foi possível gerar a figurinha." },
        { status: 500 },
      );
    }
  });
};
