import { NextResponse } from "next/server";

import { startBroadcastRun } from "lib/broadcast-lists";
import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";

type Context = { params: Promise<{ instanceId: string; listId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params;
    const instanceId = Number.parseInt(raw, 10);
    if (!Number.isFinite(instanceId) || instanceId <= 0 || !listId) return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    if (!await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => null);
    const run = await startBroadcastRun(user.id, instanceId, listId, body && typeof body === "object" ? body as Record<string, unknown> : {});
    return NextResponse.json({ accepted: true, ...run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível iniciar a transmissão." }, { status: 400 });
  }
}
