import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { previewBroadcastVariables } from "lib/broadcast-lists";

type Context = { params: Promise<{ instanceId: string; listId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params;
    const instanceId = Number(raw);
    if (!Number.isFinite(instanceId) || !listId || !await getInstanceForUser(user.id, instanceId)) {
      return NextResponse.json({ message: "Lista ou perfil não encontrado." }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await previewBroadcastVariables(
      user.id,
      instanceId,
      listId,
      body && typeof body === "object" ? body as Record<string, unknown> : {},
    ));
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não consegui testar as variáveis." },
      { status: 400 },
    );
  }
}
