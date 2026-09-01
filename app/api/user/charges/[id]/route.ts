import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { updateChargeAdminNote } from "lib/payments";

const MAX_NOTE_LENGTH = 2000;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "user") {
      return NextResponse.json({ message: "Não autorizado." }, { status: 403 });
    }

    const params = await context.params;
    const idParam = params.id;
    const chargeId = Number.parseInt(idParam, 10);

    if (!Number.isFinite(chargeId) || chargeId <= 0) {
      return NextResponse.json({ message: "Identificador inválido." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || body === null) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { adminNote: rawNote } = body as { adminNote?: unknown };

    if (typeof rawNote !== "string") {
      return NextResponse.json({ message: "Informe a anotação que deseja salvar." }, { status: 400 });
    }

    if (rawNote.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { message: `A anotação pode ter no máximo ${MAX_NOTE_LENGTH} caracteres.` },
        { status: 400 },
      );
    }

    const charge = await updateChargeAdminNote(user.id, chargeId, rawNote);

    if (!charge) {
      return NextResponse.json({ message: "Cobrança não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ message: "Cobrança atualizada.", charge });
  } catch (error) {
    console.error("Failed to update charge note", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a cobrança. Tente novamente." },
      { status: 500 },
    );
  }
}
