import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { resolveTikTok } from "lib/tiktok-resolver";

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
      return NextResponse.json({ success: false, message: "Informe a URL do TikTok." }, { status: 400 });
    }

    const debugFlag = /^(1|true|yes)$/i.test(String(searchParams.get("debug") || ""));
    const result = await resolveTikTok(rawUrl);
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.error,
          ...(debugFlag ? { debug: result.debug } : {}),
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      normalized: result.result.normalized,
      raw: result.result.raw,
      data: result.result.apiPayload.data,
      variant: result.result.resolvedVariant,
      ...(debugFlag ? { debug: result.debug } : {}),
    });
  } catch (error) {
    console.error("[api/tiktok/preview] Failed to resolve link", error);
    return NextResponse.json(
      { success: false, message: "Falha ao processar o link do TikTok." },
      { status: 500 },
    );
  }
}
