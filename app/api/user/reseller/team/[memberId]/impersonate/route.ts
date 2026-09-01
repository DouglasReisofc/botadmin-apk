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
import { requirePartnerPermission } from "lib/reseller-program";

type RouteParams = { params: { memberId: string } | Promise<{ memberId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const headerList = await headers();
  const cookieStore = await cookies();
  const cookieContext = {
    forwardedProto: headerList.get("x-forwarded-proto"),
    host: headerList.get("host"),
  };
  try {
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const access = await requirePartnerPermission(actor.id, "manage_partners");
    const currentSessionId = cookieStore.get(SESSION_COOKIE)?.value ?? null;
    if (!currentSessionId) return NextResponse.json({ message: "Sessão atual não encontrada." }, { status: 401 });
    const memberId = Number.parseInt((await Promise.resolve(params)).memberId, 10);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return NextResponse.json({ message: "Revendedor inválido." }, { status: 400 });
    }
    const db = getDb();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT m.user_id, m.role, m.status, m.invited_by, u.name, u.is_active
         FROM admin_panel_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.user_id = ? LIMIT 1`,
      [memberId],
    );
    const target = rows[0];
    const inScope = access.role === "owner" ||
      (access.role === "master" && Number(target?.invited_by) === actor.id && String(target?.role) === "reseller");
    if (!target || !inScope) {
      return NextResponse.json({ message: "Este revendedor não pertence à sua equipe." }, { status: 403 });
    }
    if (target.status !== "active" || !Boolean(target.is_active)) {
      return NextResponse.json({ message: "A conta do revendedor está suspensa." }, { status: 400 });
    }
    const actorSession = await findActiveSession(currentSessionId);
    if (!actorSession || actorSession.user_id !== actor.id) {
      return NextResponse.json({ message: "Sessão do Master inválida." }, { status: 401 });
    }
    const session = await createSession(memberId, undefined, {
      impersonatedByUserId: actor.id,
      impersonatedFromSessionId: currentSessionId,
    });
    const isNativeMobile = headerList.get("x-botadmin-mobile") === "flutter";
    const response = NextResponse.json({
      message: `Sessão iniciada como ${String(target.name ?? "revendedor")}.`,
      redirectTo: "/dashboard/partner",
      ...(isNativeMobile ? {
        sessionCookie: `${SESSION_COOKIE}=${session.id}`,
        adminSessionCookie: `${ADMIN_SESSION_COOKIE}=${currentSessionId}`,
      } : {}),
    });
    setSessionCookie(response, session.id, session.expiresAt, cookieContext);
    setAdminSessionReferenceCookie(response, currentSessionId, actorSession.expires_at, cookieContext);
    return response;
  } catch (error) {
    console.error("Failed to impersonate partner member", error);
    return NextResponse.json({ message: "Não foi possível abrir o painel do revendedor." }, { status: 500 });
  }
}
