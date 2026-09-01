import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { upsertAffiliateMlLinksBatchForUser } from "lib/affiliate-ml-links";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => ({}))) as {
      entries?: Array<{
        itemId?: string | null;
        affiliateUrl?: string | null;
        note?: string | null;
        title?: string | null;
        productUrl?: string | null;
        imageUrl?: string | null;
        categoryId?: string | null;
        priceAmount?: number | null;
        priceFormatted?: string | null;
        currencyId?: string | null;
        available?: boolean | null;
      }>;
    };

    const result = await upsertAffiliateMlLinksBatchForUser(
      user.id,
      Array.isArray(payload.entries) ? payload.entries : [],
    );

    return NextResponse.json({
      status: true,
      message:
        result.failed === 0
          ? `${result.imported} produto(s) importado(s) com sucesso.`
          : `${result.imported} importado(s) e ${result.failed} com falha.`,
      imported: result.imported,
      failed: result.failed,
      errors: result.errors,
      links: result.links,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível importar os produtos selecionados.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
