import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { guardPanelModuleRequest } from "lib/panel-module-http";
import { listAffiliateProvidersForUser } from "lib/affiliate-connections";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }
    const blocked = await guardPanelModuleRequest(user, "affiliates");
    if (blocked) return blocked;

    const providers = await listAffiliateProvidersForUser(user.id);
    return NextResponse.json({ status: true, providers });
  } catch (error) {
    console.error("[affiliates/providers] GET error", error);
    return NextResponse.json(
      { status: false, message: "Não foi possível carregar os provedores de afiliados." },
      { status: 500 },
    );
  }
}
