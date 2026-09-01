import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getPartnerFinancialSettings,
  getPartnerPlanCreditCosts,
  savePartnerFinancialSettings,
  savePartnerPlanCreditCosts,
} from "lib/partner-finance";
import { getPartnerAccess, ResellerProgramError } from "lib/reseller-program";

const fail = (error: unknown) => error instanceof ResellerProgramError
  ? NextResponse.json({ message: error.message }, { status: error.status })
  : NextResponse.json({ message: "Não foi possível salvar as regras financeiras." }, { status: 500 });

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const url = new URL(request.url);
    const targetUserId = Number(url.searchParams.get("userId") || user.id);
    const access = await getPartnerAccess(user.id);
    if (!access?.permissions.view_financial) throw new ResellerProgramError("Sem permissão financeira.", 403);
    if (access.role !== "owner" && targetUserId !== user.id) {
      const { getDb } = await import("lib/db");
      const [rows] = await getDb().query<any[]>("SELECT user_id FROM admin_panel_members WHERE user_id = ? AND invited_by = ? LIMIT 1", [targetUserId, user.id]);
      if (!rows.length) throw new ResellerProgramError("Parceiro fora da sua equipe.", 403);
    }
    return NextResponse.json({
      settings: await getPartnerFinancialSettings(targetUserId),
      planCosts: await getPartnerPlanCreditCosts(targetUserId),
    });
  } catch (error) { return fail(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const body = await request.json() as Record<string, any>;
    const targetUserId = Number(body.userId || user.id);
    const settings = await savePartnerFinancialSettings({
      actorUserId: user.id,
      targetUserId,
      creditUnitPrice: body.creditUnitPrice,
      manualPaymentsEnabled: body.manualPaymentsEnabled === true,
      allowChildManualPayments: body.allowChildManualPayments === true,
      manualPixKey: typeof body.manualPixKey === "string" ? body.manualPixKey : null,
      manualInstructions: typeof body.manualInstructions === "string" ? body.manualInstructions : null,
      proxySalesMode: body.proxySalesMode,
      proxyMonthlyPrice: body.proxyMonthlyPrice,
      allowCustomerProxy: body.allowCustomerProxy !== false,
      proxySalesInstructions: typeof body.proxySalesInstructions === "string" ? body.proxySalesInstructions : null,
    });
    const planCosts = body.planCosts
      ? await savePartnerPlanCreditCosts(user.id, targetUserId, body.planCosts)
      : await getPartnerPlanCreditCosts(targetUserId);
    return NextResponse.json({ message: "Regras financeiras atualizadas.", settings, planCosts });
  } catch (error) { return fail(error); }
}
