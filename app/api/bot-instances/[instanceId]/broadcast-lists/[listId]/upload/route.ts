import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getBroadcastList } from "lib/broadcast-lists";
import { getInstanceForUser } from "lib/bot-instances";
import { resolveUploadedFileUrl, saveUploadedFile } from "lib/uploads";

const types = new Set(["image", "video", "audio", "document"]);

export async function POST(request: NextRequest, context: { params: Promise<{ instanceId: string; listId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { instanceId: raw, listId } = await context.params;
    const instanceId = Number.parseInt(raw, 10);
    if (!Number.isFinite(instanceId) || instanceId <= 0 || !listId) return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    if (!await getInstanceForUser(user.id, instanceId) || !await getBroadcastList(user.id, instanceId, listId)) return NextResponse.json({ message: "Lista não encontrada." }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ message: "Selecione um arquivo válido." }, { status: 400 });
    if (file.size > 64 * 1024 * 1024) return NextResponse.json({ message: "O arquivo deve ter no máximo 64 MB." }, { status: 400 });
    const type = String(form.get("mediaType") || "document").toLowerCase();
    if (!types.has(type)) return NextResponse.json({ message: "Tipo de mídia inválido." }, { status: 400 });
    const path = await saveUploadedFile(file, `bot-broadcast/${user.id}/${listId}`);
    return NextResponse.json({ media: { url: resolveUploadedFileUrl(path), path, mediaType: type, fileName: file.name, mimeType: file.type || "application/octet-stream" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível enviar a mídia." }, { status: 400 });
  }
}
