import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getPurchaseHistoryForUser } from "lib/purchase-history";

export const dynamic = "force-dynamic";

const parseLimit = (request: Request) => {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "120", 10);
  if (!Number.isFinite(raw)) return 120;
  return Math.min(Math.max(raw, 1), 300);
};

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const purchases = await getPurchaseHistoryForUser(user.id, parseLimit(request));

    return NextResponse.json({ purchases });
  } catch (error) {
    console.error("Failed to list user purchases", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o histórico de compras." },
      { status: 500 },
    );
  }
}
