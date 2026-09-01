import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { previewGoogleSheet } from "lib/broadcast-lists";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const body = await request.json().catch(() => ({})) as { googleSheetUrl?: unknown; mapping?: unknown };
    const url = typeof body.googleSheetUrl === "string" ? body.googleSheetUrl.trim() : "";
    if (!url) return NextResponse.json({ message: "Informe o link da planilha." }, { status: 400 });
    return NextResponse.json(await previewGoogleSheet(url, user.id, body.mapping && typeof body.mapping === "object" ? body.mapping as Record<string, unknown> : undefined));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não consegui abrir a planilha." }, { status: 400 });
  }
}
