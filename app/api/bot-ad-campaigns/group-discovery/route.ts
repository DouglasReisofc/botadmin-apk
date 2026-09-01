import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { searchGruposWhats } from "lib/gruposwhats";

export const runtime = "nodejs";
export const maxDuration = 60;

const cleanPositiveInt = (value: string | null, fallback: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const category = (request.nextUrl.searchParams.get("category") ?? "")
      .trim()
      .toLowerCase();
    if (!query && !category) {
      return NextResponse.json(
        { message: "Informe uma busca ou categoria." },
        { status: 400 },
      );
    }
    if (category && !/^[a-z0-9-]+$/.test(category)) {
      return NextResponse.json({ message: "Categoria inválida." }, { status: 400 });
    }

    const result = await searchGruposWhats(query, {
      category,
      page: cleanPositiveInt(request.nextUrl.searchParams.get("page"), 1, 1000),
      maxPages: cleanPositiveInt(request.nextUrl.searchParams.get("maxPages"), 1, 3),
      // The campaign selector needs the real WhatsApp invite whenever the
      // source can resolve it, rather than only a link to the catalog page.
      includeDetails: true,
    });

    return NextResponse.json({
      source: "gruposwhats.app",
      inviteResolution: result.inviteResolution ?? "protected",
      categories: result.categories ?? [],
      groups: result.groups,
      total: result.total,
      fetchedAt: result.fetchedAt,
    });
  } catch (error) {
    console.error("Failed to discover campaign groups", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o catálogo de grupos.",
      },
      { status: 502 },
    );
  }
}
