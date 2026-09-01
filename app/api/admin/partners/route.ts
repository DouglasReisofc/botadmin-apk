import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  ResellerProgramError,
  createPartnerMember,
  grantPartnerCredits,
  listPartnerMembers,
  requirePartnerPermission,
  upsertPartnerMember,
} from "lib/reseller-program";

const errorResponse = (error: unknown) => {
  if (error instanceof ResellerProgramError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  console.error("[admin/partners] request failed", error);
  return NextResponse.json({ message: "Não foi possível concluir a operação de parceiros." }, { status: 500 });
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    await requirePartnerPermission(user.id, "manage_partners");
    return NextResponse.json({ members: await listPartnerMembers(user.id) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    const action = String(body.action ?? "member").trim().toLowerCase();
    if (action === "create_member" || action === "create") {
      const member = await createPartnerMember({
        actorUserId: user.id,
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        whatsappNumber: typeof body.whatsappNumber === "string" ? body.whatsappNumber : null,
        role: body.role,
        permissions: body.permissions && typeof body.permissions === "object" ? body.permissions as Record<string, unknown> : null,
        status: body.status === "suspended" ? "suspended" : "active",
        commissionRate: body.commissionRate == null || body.commissionRate === "" ? undefined : Number(body.commissionRate),
        initialCredits: body.initialCredits == null || body.initialCredits === "" ? undefined : Number(body.initialCredits),
      });
      return NextResponse.json({ message: "Parceiro criado com sucesso.", member }, { status: 201 });
    }
    if (action === "credits" || action === "grant_credits") {
      const wallet = await grantPartnerCredits({
        actorUserId: user.id,
        resellerUserId: Number(body.resellerUserId ?? body.userId),
        credits: Number(body.credits),
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
        referenceId: typeof body.referenceId === "string" ? body.referenceId : null,
      });
      return NextResponse.json({ message: "Créditos adicionados.", wallet });
    }
    const member = await upsertPartnerMember({
      actorUserId: user.id,
      userId: Number(body.userId),
      role: body.role,
      permissions: body.permissions && typeof body.permissions === "object" ? body.permissions as Record<string, unknown> : null,
      status: body.status === "suspended" ? "suspended" : "active",
      commissionRate: body.commissionRate == null || body.commissionRate === "" ? undefined : Number(body.commissionRate),
      name: typeof body.name === "string" ? body.name : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      whatsappNumber: typeof body.whatsappNumber === "string" || body.whatsappNumber === null ? body.whatsappNumber as string | null : undefined,
      password: typeof body.password === "string" ? body.password : null,
    });
    return NextResponse.json({ message: "Parceiro atualizado.", member });
  } catch (error) { return errorResponse(error); }
}
