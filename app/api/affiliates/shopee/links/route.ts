import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteAffiliateShopeeLinksForUser,
  listAffiliateShopeeLinksForUser,
  upsertAffiliateShopeeLinkForUser,
} from "lib/affiliate-shopee-links";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }
    const url = new URL(request.url);
    const parsedLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(5000, Math.floor(parsedLimit)))
      : 2000;
    const links = await listAffiliateShopeeLinksForUser(user.id, { limit });
    return NextResponse.json({ status: true, links });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível listar os links afiliados.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }
    const payload = (await request.json().catch(() => ({}))) as {
      affiliateUrl?: string;
      url?: string;
      note?: string | null;
    };
    const affiliateUrl =
      typeof payload.affiliateUrl === "string" && payload.affiliateUrl.trim()
        ? payload.affiliateUrl
        : typeof payload.url === "string"
          ? payload.url
          : "";
    const link = await upsertAffiliateShopeeLinkForUser(user.id, {
      affiliateUrl,
      note: payload.note ?? null,
    });
    return NextResponse.json({
      status: true,
      message: "Link afiliado salvo com sucesso.",
      link,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível salvar o link afiliado.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }
    const payload = (await request.json().catch(() => ({}))) as {
      all?: unknown;
      itemIds?: unknown;
    };
    const all = payload.all === true;
    const itemIds = Array.isArray(payload.itemIds)
      ? payload.itemIds.map((entry) => String(entry ?? ""))
      : [];

    if (!all && itemIds.length === 0) {
      return NextResponse.json(
        { status: false, message: "Informe itemIds ou all=true para remover produtos." },
        { status: 400 },
      );
    }

    const removed = await deleteAffiliateShopeeLinksForUser(user.id, {
      all,
      itemIds,
    });

    return NextResponse.json({
      status: true,
      removed,
      message:
        removed > 0
          ? `${removed} produto(s) removido(s) com sucesso.`
          : "Nenhum produto removido para o filtro enviado.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível remover os produtos selecionados.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
