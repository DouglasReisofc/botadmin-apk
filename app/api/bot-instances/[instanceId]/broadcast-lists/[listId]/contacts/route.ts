import { NextResponse } from "next/server";

import { addBroadcastContacts, contactsFromGoogleSheet, deleteBroadcastContacts, saveBroadcastGoogleSheetSource, updateBroadcastGroupMentions } from "lib/broadcast-lists";
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
    const body = await request.json().catch(() => null) as { contacts?: unknown; groups?: unknown; googleSheetUrl?: unknown; googleSheetMapping?: unknown } | null;
    const direct = Array.isArray(body?.contacts) ? body.contacts : [];
    const groups = Array.isArray(body?.groups) ? body.groups : [];
    const sheetUrl = typeof body?.googleSheetUrl === "string" ? body.googleSheetUrl.trim() : "";
    const sheetMapping = body?.googleSheetMapping && typeof body.googleSheetMapping === "object" ? body.googleSheetMapping as Record<string, unknown> : undefined;
    const sheetContacts = sheetUrl ? await contactsFromGoogleSheet(sheetUrl, user.id, sheetMapping) : [];
    await addBroadcastContacts(user.id, instanceId, listId, [...direct, ...groups, ...sheetContacts]);
    if (sheetUrl) await saveBroadcastGoogleSheetSource(user.id, instanceId, listId, sheetUrl, sheetMapping);
    return NextResponse.json({ ok: true, imported: direct.length + groups.length + sheetContacts.length, contacts: direct.length + sheetContacts.length, groups: groups.length, googleSheets: sheetContacts.length });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível importar os contatos." }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params;
    const instanceId = Number.parseInt(raw, 10);
    if (!Number.isFinite(instanceId) || instanceId <= 0 || !listId) return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    if (!await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { contactIds?: unknown };
    const deleted = await deleteBroadcastContacts(user.id, instanceId, listId, Array.isArray(body.contactIds) ? body.contactIds : undefined);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível remover os contatos." }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params;
    const instanceId = Number.parseInt(raw, 10);
    if (!Number.isFinite(instanceId) || instanceId <= 0 || !listId) return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    if (!await getInstanceForUser(user.id, instanceId)) return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { mentionAll?: unknown; excludeAdmins?: unknown };
    return NextResponse.json(await updateBroadcastGroupMentions(user.id, instanceId, listId, body));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível atualizar as menções." }, { status: 400 });
  }
}
