import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  fetchShopeeOfferCampaigns,
  fetchShopeeShopOffers,
} from "lib/apis/shopee-affiliate";

const clamp = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const keyword = (url.searchParams.get("keyword") || "").trim() || null;
    const sortType = clamp(url.searchParams.get("sortType"), 2, 1, 9);
    const campaignLimit = clamp(url.searchParams.get("campaignLimit"), 20, 1, 50);
    const shopLimit = clamp(url.searchParams.get("shopLimit"), 20, 1, 50);
    const campaignPage = clamp(url.searchParams.get("campaignPage"), 1, 1, 100);
    const shopPage = clamp(url.searchParams.get("shopPage"), 1, 1, 100);

    const [campaigns, shopOffers] = await Promise.all([
      fetchShopeeOfferCampaigns({
        userId: user.id,
        keyword,
        sortType,
        limit: campaignLimit,
        page: campaignPage,
      }),
      fetchShopeeShopOffers({
        userId: user.id,
        keyword,
        sortType,
        limit: shopLimit,
        page: shopPage,
      }),
    ]);

    return NextResponse.json({
      status: true,
      provider: "shopee",
      campaigns,
      shopOffers,
      note:
        "Dados oficiais da Open API da Shopee via shopeeOfferV2 e shopOfferV2.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar as campanhas da Shopee.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
