import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { deleteBroadcastSchedule, scheduleBroadcastRun, updateBroadcastSchedule } from "lib/broadcast-lists";

type Context = { params: Promise<{ instanceId: string; listId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params; const instanceId = Number(raw);
    if (!Number.isFinite(instanceId) || !listId || !await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Lista ou perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await scheduleBroadcastRun(user.id, instanceId, listId, body && typeof body === "object" ? body as Record<string, unknown> : {}), { status: 201 });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Não consegui agendar a mensagem." }, { status: 400 }); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params; const instanceId = Number(raw);
    if (!Number.isFinite(instanceId) || !listId || !await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Lista ou perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const scheduleId = body && typeof body === "object" ? String((body as Record<string, unknown>).scheduleId ?? "") : "";
    if (!scheduleId) return NextResponse.json({ message: "Informe a programação." }, { status: 400 });
    return NextResponse.json(await updateBroadcastSchedule(user.id, instanceId, listId, scheduleId, body as Record<string, unknown>));
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Não consegui atualizar a programação." }, { status: 400 }); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params; const instanceId = Number(raw);
    if (!Number.isFinite(instanceId) || !listId || !await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Lista ou perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const scheduleId = body && typeof body === "object" ? String((body as Record<string, unknown>).scheduleId ?? "") : "";
    if (!scheduleId) return NextResponse.json({ message: "Informe a programação." }, { status: 400 });
    const deleted = await deleteBroadcastSchedule(user.id, instanceId, listId, scheduleId);
    if (!deleted) return NextResponse.json({ message: "Programação não encontrada." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Não consegui excluir a programação." }, { status: 400 }); }
}
