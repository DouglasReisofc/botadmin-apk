import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteGoogleSheetConnection, getGoogleSheetConnection } from "lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  return NextResponse.json({ connected: await getGoogleSheetConnection(user.id) });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  await deleteGoogleSheetConnection(user.id);
  return NextResponse.json({ ok: true });
}
