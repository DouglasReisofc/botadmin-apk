import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { getBroadcastList, removeBroadcastList, updateBroadcastList } from "lib/broadcast-lists";

type Context = { params: Promise<{ instanceId: string; listId: string }> };

const resolve = async (context: Context) => {
  const { instanceId: raw, listId } = await context.params;
  const instanceId = Number.parseInt(raw, 10);
  return { instanceId: Number.isFinite(instanceId) && instanceId > 0 ? instanceId : null, listId };
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId, listId } = await resolve(context);
    if (!instanceId || !listId) return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    if (!await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    const detail = await getBroadcastList(user.id, instanceId, listId);
    return detail ? NextResponse.json(detail) : NextResponse.json({ message: "Lista não encontrada." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível abrir a lista." }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId, listId } = await resolve(context);
    if (!instanceId || !listId) return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const list = await updateBroadcastList(user.id, instanceId, listId, body && typeof body === "object" ? body as Record<string, unknown> : {});
    return list ? NextResponse.json(list) : NextResponse.json({ message: "Lista não encontrada." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível editar a lista." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId, listId } = await resolve(context);
    if (!instanceId || !listId) return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    const deleted = await removeBroadcastList(user.id, instanceId, listId);
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ message: "Lista não encontrada." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível excluir a lista." }, { status: 400 });
  }
}
