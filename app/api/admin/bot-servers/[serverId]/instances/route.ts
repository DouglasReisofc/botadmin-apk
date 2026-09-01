import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { assignInstancesToServer } from "lib/bot-instances";

export async function POST(
  request: Request,
  { params }: { params: { serverId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const serverId = Number.parseInt(params.serverId, 10);
    if (!Number.isFinite(serverId) || serverId <= 0) {
      return NextResponse.json({ message: "Servidor inválido." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { instanceIds } = body as { instanceIds?: unknown };
    if (!Array.isArray(instanceIds)) {
      return NextResponse.json({ message: "Informe as instâncias a vincular." }, { status: 400 });
    }

    await assignInstancesToServer(
      serverId,
      instanceIds.map((value) => Number(value)),
    );

    return NextResponse.json({ message: "Instâncias vinculadas com sucesso." });
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const status = (error as Error & { status?: number }).status ?? 400;
      return NextResponse.json({ message: error.message }, { status });
    }
    console.error("Failed to assign instances to server", error);
    return NextResponse.json(
      { message: "Não foi possível vincular as instâncias." },
      { status: 500 },
    );
  }
}
