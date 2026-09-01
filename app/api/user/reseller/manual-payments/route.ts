import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  createManualPartnerPayment,
  listManualPartnerPayments,
  reviewManualPartnerPayment,
} from "lib/partner-finance";
import { ResellerProgramError } from "lib/reseller-program";

const fail = (error: unknown) => error instanceof ResellerProgramError
  ? NextResponse.json({ message: error.message }, { status: error.status })
  : NextResponse.json({ message: "Não foi possível processar o pagamento manual." }, { status: 500 });

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    return NextResponse.json({ requests: await listManualPartnerPayments(user.id) });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const type = request.headers.get("content-type") || "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const proof = form.get("proof");
      if (!(proof instanceof File)) throw new ResellerProgramError("Envie o comprovante.");
      const result = await createManualPartnerPayment({
        buyerUserId: user.id,
        credits: form.get("credits"),
        proof,
        note: typeof form.get("note") === "string" ? String(form.get("note")) : null,
      });
      return NextResponse.json({ message: "Comprovante enviado para aprovação.", request: result }, { status: 201 });
    }
    const body = await request.json() as Record<string, unknown>;
    const decision = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : null;
    if (!decision) throw new ResellerProgramError("Ação inválida.");
    const result = await reviewManualPartnerPayment(user.id, String(body.publicId || ""), decision, typeof body.note === "string" ? body.note : null);
    return NextResponse.json({ message: decision === "approved" ? "Pagamento aprovado e créditos liberados." : "Pagamento rejeitado.", request: result });
  } catch (error) { return fail(error); }
}
