import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { resolvePinterest } from "lib/pinterest-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, message: "Não autenticado." }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const rawUrl = (searchParams.get("url") || searchParams.get("q") || "").trim();
    if (!rawUrl) {
      return NextResponse.json({ success: false, message: "Informe a URL do Pinterest." }, { status: 400 });
    }
    const result = await resolvePinterest(rawUrl);
    return NextResponse.json({
      success: true,
      normalized: result.normalized,
      downloads: result.downloads,
      pin: result.response.pin,
    });
  } catch (error) {
    console.error("[api/pinterest/preview] Failed to resolve pin", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Falha ao processar o link do Pinterest." },
      { status: 500 },
    );
  }
}
