import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { searchGruposWhats } from "lib/gruposwhats";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("q") || searchParams.get("query") || "").trim();
    const category = (searchParams.get("category") || "").trim().toLowerCase();
    if (!query && !category) {
      return NextResponse.json(
        { status: false, mensagem: "Informe o termo de busca ou uma categoria." },
        { status: 400 },
      );
    }
    if (category && !/^[a-z0-9-]+$/.test(category)) {
      return NextResponse.json(
        { status: false, mensagem: "Categoria inválida." },
        { status: 400 },
      );
    }

    const maxPagesParam = searchParams.get("maxPages");
    const pageParam = searchParams.get("page");
    const delayMsParam = searchParams.get("delayMs");
    const detailsParam = searchParams.get("details");

    const result = await searchGruposWhats(query, {
      category,
      page: pageParam ? Number(pageParam) : undefined,
      maxPages: maxPagesParam ? Number(maxPagesParam) : undefined,
      delayMs: delayMsParam ? Number(delayMsParam) : undefined,
      includeDetails: detailsParam === null ? true : detailsParam !== "0",
    });

    return NextResponse.json({ status: true, resultado: result });
  } catch (error) {
    console.error("Failed to search gruposwhats", error);
    return NextResponse.json(
      { status: false, mensagem: error instanceof Error ? error.message : "Erro ao consultar a busca." },
      { status: 500 },
    );
  }
});
