import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createMobileAppAuthToken } from "lib/mobile-app-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Sessão inválida." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const next = typeof body?.next === "string" && body.next.startsWith("/")
    ? body.next
    : "/dashboard/user";
  const { token, expiresAt } = await createMobileAppAuthToken(user.id);
  const deepLink = `botadmin://auth?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;

  return NextResponse.json({
    token,
    deepLink,
    expiresAt: expiresAt.toISOString(),
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
