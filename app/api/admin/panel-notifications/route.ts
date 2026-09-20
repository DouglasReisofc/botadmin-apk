import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { createAdminPanelNotification, listAdminPanelNotifications } from "lib/admin-panel-notifications";

const admin = async () => {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  if (user.role !== "admin") return { response: NextResponse.json({ message: "Acesso restrito." }, { status: 403 }) };
  return { user };
};

export async function GET() {
  const auth = await admin();
  if (auth.response) return auth.response;
  return NextResponse.json({ notifications: await listAdminPanelNotifications() });
}

export async function POST(request: Request) {
  try {
    const auth = await admin();
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    const notification = await createAdminPanelNotification(body as Record<string, unknown>, auth.user!.id);
    const input = body as Record<string, unknown>;
    const startsAt = typeof input.startsAt === "string" ? Date.parse(input.startsAt) : Number.NaN;
    const shouldDispatchNow = input.sendNow === true && (!Number.isFinite(startsAt) || startsAt <= Date.now());
    if (shouldDispatchNow) {
      const { dispatchAdminPanelNotification } = await import("lib/admin-panel-notifications");
      await dispatchAdminPanelNotification(notification.id);
    }
    return NextResponse.json({ notification });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível criar a notificação." }, { status: 400 });
  }
}
