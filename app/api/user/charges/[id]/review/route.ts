import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { guardPanelModuleRequest } from "lib/panel-module-http";
import {
  getPaymentChargeByIdForUser,
  updatePaymentChargeStatus,
} from "lib/payments";
import { processBotStoreApprovedCharge } from "lib/bot-store";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const blocked = await guardPanelModuleRequest(user, "payments");
    if (blocked) return blocked;

    const id = Number.parseInt((await context.params).id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ message: "Cobrança inválida." }, { status: 400 });
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = String(body?.action || "").trim().toLowerCase();
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ message: "Informe approve ou reject." }, { status: 400 });
    }
    const charge = await getPaymentChargeByIdForUser(user.id, id);
    if (!charge || charge.provider !== "manual_pix") {
      return NextResponse.json({ message: "Cobrança manual não encontrada." }, { status: 404 });
    }
    if (!["pending", "in_process"].includes(charge.status.toLowerCase())) {
      return NextResponse.json({ message: "Esta cobrança já foi revisada." }, { status: 409 });
    }
    const status = action === "approve" ? "approved" : "rejected";
    const reviewed = await updatePaymentChargeStatus({
      chargeId: charge.id,
      status,
      statusDetail: action === "approve" ? "Aprovado manualmente no painel." : "Recusado manualmente no painel.",
      rawPayload: { source: "panel", reviewedBy: user.id, action },
    });
    if (!reviewed) return NextResponse.json({ message: "Não foi possível atualizar a cobrança." }, { status: 500 });
    if (action === "approve") {
      await processBotStoreApprovedCharge(reviewed);
    }
    return NextResponse.json({ message: action === "approve" ? "Pagamento aprovado." : "Pagamento recusado.", charge: reviewed });
  } catch (error) {
    console.error("Failed to review manual payment", error);
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível revisar o pagamento." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
