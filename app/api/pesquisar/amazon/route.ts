import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { searchAmazon } from "lib/apis/amazon";

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = withUserApiAuth(async (request: NextRequest) => {
  try {
    const searchParams = new URL(request.url).searchParams;
    const nome = (searchParams.get("nome") || searchParams.get("q") || "").trim();
    const page = Number(searchParams.get("page") || "1");

    if (!nome) {
      return NextResponse.json(
        { status: false, message: "Informe o parâmetro nome ou q com o termo de busca." },
        { status: 400 },
      );
    }

    const data = await searchAmazon(nome, { page });
    return NextResponse.json({
      status: true,
      quantidade: data.produtos.length,
      resultado: data.produtos,
      fonte: data.fonte,
    });
  } catch (error: any) {
    console.error("[amazon-search-route] erro:", error);
    return NextResponse.json(
      {
        status: false,
        message: error?.message || "Falha ao consultar a Amazon.",
      },
      { status: 500 },
    );
  }
});
