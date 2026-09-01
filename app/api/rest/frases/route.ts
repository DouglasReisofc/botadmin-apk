import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import {
  DEFAULT_PENSADOR_TOPIC,
  fetchPensadorQuotes,
  MAX_PENSADOR_LIMIT,
  MAX_PENSADOR_PAGE,
} from "lib/apis/pensador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withUserApiAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const rawTema = searchParams.get("tema") ?? searchParams.get("q") ?? DEFAULT_PENSADOR_TOPIC;
    const pageParam = Number(searchParams.get("page") || "1");
    const limitParam = Number(searchParams.get("limit") || "20");

    const page = Number.isFinite(pageParam) ? Math.max(1, Math.min(MAX_PENSADOR_PAGE, Math.floor(pageParam))) : 1;
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(MAX_PENSADOR_LIMIT, Math.floor(limitParam))) : 20;

    const data = await fetchPensadorQuotes({ tema: rawTema, page, limit });

    const payload = {
      status: true,
      tema: data.tema,
      temaOriginal: data.rawTema,
      page: data.page,
      total: data.total,
      resultado: data.quotes,
      pagination: {
        ...data.pagination,
        nextEndpoint:
          data.pagination.hasNext && data.pagination.nextPage
            ? `/api/rest/frases?tema=${encodeURIComponent(data.rawTema)}&page=${data.pagination.nextPage}`
            : null,
      },
      source: data.source,
    };

    return NextResponse.json(payload, { headers: { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error("[rest/frases] error", { error });
    return NextResponse.json(
      {
        status: false,
        mensagem: (error as Error)?.message || "Erro ao coletar frases do Pensador.",
      },
      { status: 500 },
    );
  }
});
