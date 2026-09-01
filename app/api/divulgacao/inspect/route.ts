import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { inspectDivulgacaoInvite } from "lib/divulgacao";

type InspectPayload = {
  instanceId?: number;
  invite?: string;
};

const parsePayload = async (request: NextRequest): Promise<InspectPayload | null> => {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return null;
    }
    return body as InspectPayload;
  } catch {
    return null;
  }
};

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const payload = await parsePayload(request);
    if (!payload || !payload.invite || !payload.instanceId) {
      return NextResponse.json(
        { message: "Informe o link do grupo e a instância que fará a inspeção." },
        { status: 400 },
      );
    }

    const inspection = await inspectDivulgacaoInvite(user.id, Number(payload.instanceId), payload.invite);
    return NextResponse.json({ inspection });
  } catch (error) {
    console.error("Failed to inspect divulgacao invite", error);
    const status =
      error instanceof Error && typeof (error as { status?: number }).status === "number"
        ? (error as { status?: number }).status!
        : 400;
    const message = error instanceof Error ? error.message : "Não foi possível validar o grupo.";
    return NextResponse.json({ message }, { status: Number.isFinite(status) ? status : 400 });
  }
}
