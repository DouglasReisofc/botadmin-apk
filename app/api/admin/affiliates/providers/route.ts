import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { listAdminAffiliateProviderSettings } from "lib/admin-affiliate-providers";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Nao autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ status: false, message: "Acesso restrito." }, { status: 403 });
    }

    const providers = await listAdminAffiliateProviderSettings();
    return NextResponse.json({ status: true, providers });
  } catch (error) {
    console.error("[admin/affiliates/providers] GET error", error);
    return NextResponse.json(
      { status: false, message: "Nao foi possivel carregar os provedores de afiliados." },
      { status: 500 },
    );
  }
}
