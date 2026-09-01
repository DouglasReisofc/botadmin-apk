import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { searchMercadoLivre } from "lib/apis/mercadolivre";

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = withUserApiAuth(async (request: NextRequest, _context: unknown, auth) => {
  try {
    const searchParams = new URL(request.url).searchParams;
    const term =
      (searchParams.get("q") ||
        searchParams.get("query") ||
        searchParams.get("nome") ||
        searchParams.get("termo") ||
        searchParams.get("busca") ||
        searchParams.get("produto") ||
        "").trim();
    const link = (searchParams.get("link") || "").trim();
    const limit = searchParams.get("limit") || undefined;

    const input = link || term;
    if (!input) {
      return NextResponse.json(
        {
          status: false,
          message: "Informe o parâmetro q/query/nome/produto ou link para consultar no Mercado Livre.",
        },
        { status: 400 },
      );
    }

    const data = await searchMercadoLivre(input, { limit, userId: auth.userId });
    return NextResponse.json({
      status: true,
      quantidade: data.produtos.length,
      resultado: data.produtos,
      produtos: data.produtos,
      consulta: data.consulta,
      paging: data.paging,
      filtros: data.filtros,
      fonte: data.fonte,
    });
  } catch (error: any) {
    console.error("[mercadolivre-route] erro:", error);
    return NextResponse.json(
      {
        status: false,
        message: error?.message || "Falha ao consultar o Mercado Livre.",
      },
      { status: 500 },
    );
  }
});
