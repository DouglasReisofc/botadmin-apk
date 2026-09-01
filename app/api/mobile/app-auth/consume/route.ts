import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE, setSessionCookie } from "lib/auth";
import { consumeMobileAppAuthToken } from "lib/mobile-app-auth";
import { getPartnerPanelAccess } from "lib/reseller-program";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";

  const result = await consumeMobileAppAuthToken(token);
  if (!result) {
    return NextResponse.json(
      { message: "Link expirado. Abra o painel pelo navegador novamente." },
      { status: 401 },
    );
  }

  const headerList = await headers();
  const partnerAccess = await getPartnerPanelAccess(result.user.id).catch(() => null);
  const response = NextResponse.json({
    user: {
      ...result.user,
      partnerRole: partnerAccess?.role ?? null,
    },
    ...(headerList.get("x-botadmin-mobile") === "flutter"
      ? { sessionCookie: `${SESSION_COOKIE}=${result.session.id}` }
      : {}),
    message: "App autenticado com sucesso.",
  });
  setSessionCookie(response, result.session.id, result.session.expiresAt, {
    forwardedProto: headerList.get("x-forwarded-proto"),
    host: headerList.get("host"),
  });

  return response;
}
