import { NextResponse } from "next/server";

import { addBroadcastContacts, contactsFromGoogleSheet } from "lib/broadcast-lists";
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
    const body = await request.json().catch(() => null) as { contacts?: unknown; googleSheetUrl?: unknown } | null;
    const direct = Array.isArray(body?.contacts) ? body.contacts : [];
    const sheetUrl = typeof body?.googleSheetUrl === "string" ? body.googleSheetUrl.trim() : "";
    const sheetContacts = sheetUrl ? await contactsFromGoogleSheet(sheetUrl, user.id) : [];
    await addBroadcastContacts(user.id, instanceId, listId, [...direct, ...sheetContacts] as never[]);
    return NextResponse.json({ ok: true, imported: direct.length + sheetContacts.length, googleSheets: sheetContacts.length });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível importar os contatos." }, { status: 400 });
  }
}
