import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";

import {
  ADMIN_SESSION_COOKIE,
  SESSION_COOKIE,
  createSession,
  findActiveSession,
  getCurrentUser,
  setAdminSessionReferenceCookie,
  setSessionCookie,
} from "lib/auth";
import { getDb } from "lib/db";
import { getPartnerAccess } from "lib/reseller-program";

type RouteParams = { params: { customerId: string } | Promise<{ customerId: string }> };

/** Scoped support access: a partner can only enter a customer linked to its wallet. */
export async function POST(_request: Request, { params }: RouteParams) {
  const headerList = await headers();
  const cookieStore = await cookies();
  const cookieContext = {
    forwardedProto: headerList.get("x-forwarded-proto"),
    host: headerList.get("host"),
  };
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const access = await getPartnerAccess(currentUser.id);
    if (!access?.permissions.manage_customers) {
      return NextResponse.json({ message: "Você não possui permissão para gerenciar clientes." }, { status: 403 });
    }
    const currentSessionId = cookieStore.get(SESSION_COOKIE)?.value ?? null;
    if (!currentSessionId) return NextResponse.json({ message: "Sessão atual não encontrada." }, { status: 401 });
    const targetId = Number.parseInt((await Promise.resolve(params)).customerId, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return NextResponse.json({ message: "Cliente inválido." }, { status: 400 });
    }
    const db = getDb();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.is_active
         FROM users u
         JOIN reseller_customer_links l ON l.customer_user_id = u.id
        WHERE l.reseller_user_id = ? AND l.customer_user_id = ? AND l.status <> 'ended'
        LIMIT 1`,
      [currentUser.id, targetId],
    );
    const target = rows[0];
    if (!target) return NextResponse.json({ message: "Cliente não pertence à sua carteira." }, { status: 403 });
    if (!Boolean(target.is_active)) return NextResponse.json({ message: "A conta do cliente está desativada." }, { status: 400 });
    const partnerSession = await findActiveSession(currentSessionId);
    if (!partnerSession || partnerSession.user_id !== currentUser.id) {
      return NextResponse.json({ message: "Sessão do parceiro inválida." }, { status: 401 });
    }
    const session = await createSession(targetId, undefined, {
      impersonatedByUserId: currentUser.id,
      impersonatedFromSessionId: currentSessionId,
    });
    const isNativeMobile = headerList.get("x-botadmin-mobile") === "flutter";
    const response = NextResponse.json({
      message: `Sessão iniciada como ${String(target.name ?? "cliente")}.`,
      redirectTo: "/dashboard/user",
      ...(isNativeMobile
        ? {
            sessionCookie: `${SESSION_COOKIE}=${session.id}`,
            adminSessionCookie: `${ADMIN_SESSION_COOKIE}=${currentSessionId}`,
          }
        : {}),
    });
    setSessionCookie(response, session.id, session.expiresAt, cookieContext);
    setAdminSessionReferenceCookie(response, currentSessionId, partnerSession.expires_at, cookieContext);
    return response;
  } catch (error) {
    console.error("Failed to impersonate reseller customer", error);
    return NextResponse.json({ message: "Não foi possível abrir o painel do cliente." }, { status: 500 });
  }
}
