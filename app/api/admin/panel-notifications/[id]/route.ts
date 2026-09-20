import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { cancelAdminPanelNotification } from "lib/admin-panel-notifications";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ message: "ID inválido." }, { status: 400 });
  await cancelAdminPanelNotification(id);
  return NextResponse.json({ message: "Notificação cancelada." });
}
