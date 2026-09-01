import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  fetchShopeeItemFeedData,
  listShopeeItemFeeds,
  type ShopeeFeedMode,
} from "lib/apis/shopee-affiliate";

const clamp = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const parseMode = (value: string | null): "all" | ShopeeFeedMode => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "FULL" || normalized === "DELTA") return normalized;
  return "all";
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const mode = parseMode(url.searchParams.get("mode"));
    const datafeedId = (url.searchParams.get("datafeedId") || "").trim() || null;
    const offset = clamp(url.searchParams.get("offset"), 0, 0, 10_000_000);
    const limit = clamp(url.searchParams.get("limit"), 100, 1, 500);

    const modes: ShopeeFeedMode[] = mode === "all" ? ["FULL", "DELTA"] : [mode];
    const list = await Promise.all(
      modes.map((entry) => listShopeeItemFeeds(entry, { userId: user.id })),
    );

    const feedsByMode = list.reduce<Record<ShopeeFeedMode, Awaited<typeof list>[number]["entries"]>>(
      (acc, current) => {
        acc[current.mode] = current.entries;
        return acc;
      },
      { FULL: [], DELTA: [] },
    );

    const feedData = datafeedId
      ? await fetchShopeeItemFeedData({
          userId: user.id,
          datafeedId,
          offset,
          limit,
        })
      : null;

    return NextResponse.json({
      status: true,
      provider: "shopee",
      modes,
      feedsByMode,
      feedData,
      note:
        "Feeds oficiais do catálogo Shopee. FULL = catálogo completo, DELTA = alterações incrementais (NEW/DELETE).",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar os feeds da Shopee.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
