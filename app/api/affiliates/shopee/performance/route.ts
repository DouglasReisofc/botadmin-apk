import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { fetchShopeeConversionReport } from "lib/apis/shopee-affiliate";

const clamp = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const parseEpoch = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const limit = clamp(url.searchParams.get("limit"), 50, 1, 200);
    const scrollId = (url.searchParams.get("scrollId") || "").trim() || null;
    const purchaseTimeStart = parseEpoch(url.searchParams.get("purchaseTimeStart"));
    const purchaseTimeEnd = parseEpoch(url.searchParams.get("purchaseTimeEnd"));
    const completeTimeStart = parseEpoch(url.searchParams.get("completeTimeStart"));
    const completeTimeEnd = parseEpoch(url.searchParams.get("completeTimeEnd"));
    const shopId = parseEpoch(url.searchParams.get("shopId"));
    const orderId = (url.searchParams.get("orderId") || "").trim() || null;

    const report = await fetchShopeeConversionReport({
      userId: user.id,
      limit,
      scrollId,
      purchaseTimeStart,
      purchaseTimeEnd,
      completeTimeStart,
      completeTimeEnd,
      shopId,
      orderId,
    });

    return NextResponse.json({
      status: true,
      provider: "shopee",
      ...report,
      note:
        "Shopee retorna eventos de conversão (com clickTime, pedidos e comissão). Para contador de clique total (incluindo cliques sem compra), use link rastreado interno do BotAdmin.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar métricas da Shopee.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
