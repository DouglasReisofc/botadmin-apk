import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";

const loadIntegrationModule = <T = any>(relativePath: string): T | null => {
  try {
    const absolute = path.join(process.cwd(), relativePath);
    return (eval("require") as NodeRequire)(absolute) as T;
  } catch {
    return null;
  }
};

const telegraphHelper = (() => {
  return loadIntegrationModule("lib/integrations/apis/funcoes/telegraph-helper.js");
})();

const integrationApi = (() => {
  return loadIntegrationModule("lib/integrations/apis/funcoes/api.js");
})();

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = withUserApiAuth(async (req: NextRequest) => {
  if (!telegraphHelper?.downloadImageToTempFile || !integrationApi?.TelegraPh) {
    return NextResponse.json(
      { status: false, mensagem: "Dependências do Telegraph indisponíveis." },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const link = (searchParams.get("link") || searchParams.get("url") || "").trim();
  if (!link) {
    return NextResponse.json(
      { status: false, mensagem: "Informe o parâmetro link ou url." },
      { status: 400 },
    );
  }

  try {
    const fetchImpl = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
    const { tempFile, finalUrl } = await telegraphHelper.downloadImageToTempFile(link, {
      fetch: fetchImpl,
    });
    let uploadedUrl: string | null = null;

    try {
      uploadedUrl = await integrationApi.TelegraPh(tempFile);
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }

    return NextResponse.json({
      status: true,
      codigo: 200,
      resultado: {
        url: uploadedUrl,
        origem: finalUrl || link,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: false, mensagem: error?.message || "Não foi possível enviar a imagem para o Telegra.ph." },
      { status: 500 },
    );
  }
});
