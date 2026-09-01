import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { listGoogleSpreadsheets } from "lib/broadcast-lists";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    return NextResponse.json(await listGoogleSpreadsheets(user.id));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não consegui listar as planilhas." }, { status: 400 });
  }
}
