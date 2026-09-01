import { headers, cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCurrentUser, SESSION_COOKIE } from "lib/auth";
import { getPartnerPanelAccess } from "lib/reseller-program";

export async function GET() {
  const hdrs = await headers();
  const cks = await cookies();
  const sessionId = cks.get(SESSION_COOKIE)?.value ?? null;
  const user = await getCurrentUser();
  const partnerAccess = user
    ? await getPartnerPanelAccess(user.id).catch(() => null)
    : null;

  return NextResponse.json({
    ok: true,
    sessionId,
    user: user
      ? {
          ...user,
          partnerRole: partnerAccess?.role ?? null,
        }
      : null,
    request: {
      host: hdrs.get("host"),
      forwardedProto: hdrs.get("x-forwarded-proto"),
      cookieNames: Array.from(cks.getAll?.() ?? []).map((c: any) => c?.name ?? ""),
    },
  });
}
