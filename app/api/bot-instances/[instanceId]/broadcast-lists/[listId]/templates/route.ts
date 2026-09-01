import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { deleteBroadcastTemplate, saveBroadcastTemplate } from "lib/broadcast-lists";

type Context = { params: Promise<{ instanceId: string; listId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params; const instanceId = Number(raw);
    if (!Number.isFinite(instanceId) || !listId || !await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Lista ou perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await saveBroadcastTemplate(user.id, instanceId, listId, body && typeof body === "object" ? body as Record<string, unknown> : {}), { status: 201 });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Não consegui salvar a mensagem." }, { status: 400 }); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params; const instanceId = Number(raw);
    if (!Number.isFinite(instanceId) || !listId || !await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Lista ou perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { templateId?: unknown };
    const templateId = typeof body.templateId === "string" ? body.templateId : "";
    if (!templateId) return NextResponse.json({ message: "Informe a mensagem salva." }, { status: 400 });
    const removed = await deleteBroadcastTemplate(user.id, instanceId, listId, templateId);
    return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Não consegui excluir a mensagem." }, { status: 400 }); }
}
