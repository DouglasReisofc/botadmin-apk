import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { querySisregStatus, sanitizeSisregUnitInput } from "lib/sisreg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const buildError = (message: string, status = 400) =>
  NextResponse.json({ status: false, mensagem: message }, { status });

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get("code") ?? searchParams.get("codigo") ?? "").trim();
    const unitRaw = searchParams.get("unit") ?? searchParams.get("unidade") ?? "";
    const unit = sanitizeSisregUnitInput(unitRaw);

    if (!code || !/^\d+$/.test(code)) {
      return buildError("Informe o código numérico da solicitação (apenas dígitos).");
    }

    if (!unit) {
      return buildError("Informe o nome da unidade solicitante.");
    }

    const result = await querySisregStatus(code, unit);

    return NextResponse.json({
      status: true,
      codigo: 200,
      resultado: {
        code,
        unitRequested: unit,
        unitResolved: result.unit,
        status: result.status,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Não foi possível consultar o SisReg no momento.";
    return buildError(message, 502);
  }
});
