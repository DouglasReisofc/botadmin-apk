import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteAffiliateShopeeLinkForUser, updateAffiliateShopeeLinkForUser } from "lib/affiliate-shopee-links";

type RouteContext = { params: Promise<{ itemId: string }> | { itemId: string } };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }
    const params = await Promise.resolve(context.params);
    const itemId = String(params.itemId || "").trim();
    await deleteAffiliateShopeeLinkForUser(user.id, itemId);
    return NextResponse.json({ status: true, message: "Link afiliado removido com sucesso." });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível remover o link afiliado.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }
    const params = await Promise.resolve(context.params);
    const itemId = String(params.itemId || "").trim();
    const payload = (await request.json().catch(() => ({}))) as {
      affiliateUrl?: string | null;
      note?: string | null;
      couponCode?: string | null;
      couponDetails?: string | null;
      title?: string | null;
      productUrl?: string | null;
      imageUrl?: string | null;
      available?: boolean | null;
      isActive?: boolean | null;
    };

    const link = await updateAffiliateShopeeLinkForUser(user.id, itemId, {
      affiliateUrl: payload.affiliateUrl,
      note: payload.note,
      couponCode: payload.couponCode,
      couponDetails: payload.couponDetails,
      title: payload.title,
      productUrl: payload.productUrl,
      imageUrl: payload.imageUrl,
      available: payload.available,
      isActive: payload.isActive,
    });
    return NextResponse.json({
      status: true,
      message: "Produto afiliado atualizado com sucesso.",
      link,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível atualizar o produto afiliado.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
