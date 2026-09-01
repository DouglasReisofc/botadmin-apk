import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE,
  SESSION_COOKIE,
  findActiveSession,
  getSessionUserById,
  revokeSession,
  setAdminSessionReferenceCookie,
  setSessionCookie,
} from "lib/auth";
import { getPartnerPanelAccess } from "lib/reseller-program";

export async function POST() {
  const headerList = await headers();
  const cookieContext = {
    forwardedProto: headerList.get("x-forwarded-proto"),
    host: headerList.get("host"),
  };

  const cookieStore = await cookies();
  const adminSessionId = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const currentSessionId = cookieStore.get(SESSION_COOKIE)?.value ?? null;

  if (!adminSessionId) {
    return NextResponse.json(
      { message: "Nenhuma sessão administrativa em andamento." },
      { status: 400 },
    );
  }

  if (!currentSessionId) {
    return NextResponse.json(
      { message: "Sessão expirada. Faça login novamente." },
      { status: 401 },
    );
  }

  if (adminSessionId === currentSessionId) {
    const response = NextResponse.json({
      message: "Sessão administrativa restaurada.",
      redirectTo: "/dashboard/admin",
    });
    setAdminSessionReferenceCookie(response, null, null, cookieContext);
    return response;
  }

  try {
    const adminSession = await findActiveSession(adminSessionId);
    if (!adminSession) {
      return NextResponse.json(
        { message: "Sessão administrativa expirada ou inválida." },
        { status: 401 },
      );
    }

    const ownerUser = await getSessionUserById(adminSessionId);
    const partnerAccess = ownerUser?.role === "admin"
      ? null
      : ownerUser ? await getPartnerPanelAccess(ownerUser.id) : null;
    if (!ownerUser || (ownerUser.role !== "admin" && !partnerAccess)) {
      return NextResponse.json(
        { message: "Sessão de origem inválida." },
        { status: 403 },
      );
    }

    await revokeSession(currentSessionId).catch(() => {});

    const response = NextResponse.json({
      message: ownerUser.role === "admin"
        ? "Retornado ao painel administrativo."
        : "Retornado ao painel de parceiros.",
      redirectTo: ownerUser.role === "admin" ? "/dashboard/admin" : "/dashboard/partner",
    });

    const expiresAt = adminSession.expires_at instanceof Date
      ? adminSession.expires_at
      : new Date(adminSession.expires_at);

    setSessionCookie(response, adminSessionId, expiresAt, cookieContext);
    setAdminSessionReferenceCookie(response, null, null, cookieContext);

    return response;
  } catch (error) {
    console.error("Failed to restore admin session", error);
    return NextResponse.json(
      { message: "Não foi possível restaurar a sessão administrativa." },
      { status: 500 },
    );
  }
}
