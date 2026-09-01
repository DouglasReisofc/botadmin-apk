import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { refreshAffiliateMlLinksSnapshotForUser } from "lib/affiliate-ml-links";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => ({}))) as { limit?: unknown };
    const limit = Math.max(10, Math.min(5000, Math.floor(Number(payload.limit) || 180)));
    const result = await refreshAffiliateMlLinksSnapshotForUser(user.id, { limit });

    return NextResponse.json({
      status: true,
      message: `Atualização concluída. ${result.updated} produto(s) sincronizado(s).`,
      summary: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível atualizar os produtos agora.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
