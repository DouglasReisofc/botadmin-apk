import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  ADMIN_REALTIME_NOTIFICATION_VARIABLES,
  getAdminRealtimeNotificationSettings,
  updateAdminRealtimeNotificationSettings,
} from "lib/admin-realtime-notifications";

const requireAdmin = async () => {
  const user = await getCurrentUser();
  return user?.role === "admin" ? user : null;
};

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
  const settings = await getAdminRealtimeNotificationSettings();
  return NextResponse.json({ settings, variables: ADMIN_REALTIME_NOTIFICATION_VARIABLES });
}

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const settings = await updateAdminRealtimeNotificationSettings(
    body && typeof body === "object" ? body : {},
  );
  return NextResponse.json({ settings, variables: ADMIN_REALTIME_NOTIFICATION_VARIABLES });
}
