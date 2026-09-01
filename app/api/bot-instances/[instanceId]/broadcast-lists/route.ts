import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { createBroadcastList, listBroadcastLists, migrateLegacyAutoPromoter } from "lib/broadcast-lists";

type Context = { params: Promise<{ instanceId: string }> };

const resolve = async (context: Context) => {
  const { instanceId: raw } = await context.params;
  const instanceId = Number.parseInt(raw, 10);
  return Number.isFinite(instanceId) && instanceId > 0 ? instanceId : null;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const instanceId = await resolve(context);
    if (!instanceId) return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    if (!await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    await migrateLegacyAutoPromoter(user.id, instanceId);
    return NextResponse.json({ lists: await listBroadcastLists(user.id, instanceId) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível listar as transmissões." }, { status: 400 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const instanceId = await resolve(context);
    if (!instanceId) return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    if (!await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const list = await createBroadcastList(user.id, instanceId, body && typeof body === "object" ? body as Record<string, unknown> : {});
    return NextResponse.json(list, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível criar a lista." }, { status: 400 });
  }
}
