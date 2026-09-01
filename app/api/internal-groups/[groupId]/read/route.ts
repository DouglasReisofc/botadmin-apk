import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { InternalGroupError, markInternalGroupRead } from "lib/internal-groups";

type Context = { params: Promise<{ groupId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const body = await request.json().catch(() => ({}));
    await markInternalGroupRead(groupId, user.id, Number(body?.messageId ?? 0));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InternalGroupError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Não foi possível marcar a leitura." }, { status: 500 });
  }
}
