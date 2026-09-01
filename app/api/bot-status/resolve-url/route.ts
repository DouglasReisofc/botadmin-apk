import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { resolveUrlTarget } from "lib/url-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, message: "Não autenticado." }, { status: 401 });
    }

    const rawInput =
      (request.nextUrl.searchParams.get("url") ||
        request.nextUrl.searchParams.get("q") ||
        "").trim();

    if (!rawInput) {
      return NextResponse.json(
        { success: false, message: "Informe a URL para resolver." },
        { status: 400 },
      );
    }

    const result = await resolveUrlTarget(rawInput);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível resolver a URL informada.",
      },
      { status: 500 },
    );
  }
}
