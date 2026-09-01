import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { callXvideos } from "lib/apis/xvideos";

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = withUserApiAuth(async (request: NextRequest) => {
  try {
    const searchParams = new URL(request.url).searchParams;
    const nome = (searchParams.get('nome') || searchParams.get('q') || '').trim();
    const op = (searchParams.get('op') || 'search').trim();

    if (!nome) {
      return NextResponse.json(
        { status: false, message: 'Informe o parâmetro nome.' },
        { status: 400 },
      );
    }

    const payload = await callXvideos({ nome, op });
    const statusCode = payload?.status === false ? 400 : 200;
    return NextResponse.json(payload, { status: statusCode });
  } catch (error: any) {
    console.error('[xvideos-route] Erro ao processar requisição:', error);
    return NextResponse.json(
      { status: false, message: error?.message || 'Falha ao consultar xvideos' },
      { status: 500 },
    );
  }
});
