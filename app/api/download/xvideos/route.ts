import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { callXvideos } from "lib/apis/xvideos";

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = withUserApiAuth(async (request: NextRequest) => {
  try {
    const searchParams = new URL(request.url).searchParams;
    const url = (searchParams.get("url") || searchParams.get("nome") || searchParams.get("video") || "").trim();

    if (!url) {
      return NextResponse.json(
        { status: false, message: "Informe o parâmetro url com o link do vídeo." },
        { status: 400 },
      );
    }

    const payload = await callXvideos({ nome: url, op: "download" });
    const statusCode = payload?.status === false ? 400 : 200;
    return NextResponse.json(payload, { status: statusCode });
  } catch (error: any) {
    console.error("[xvideos-download-route] Erro ao processar requisição:", error);
    return NextResponse.json(
      { status: false, message: error?.message || "Falha ao gerar download" },
      { status: 500 },
    );
  }
});
