import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE,
  SESSION_COOKIE,
  createSession,
  findActiveSession,
  getCurrentUser,
  setAdminSessionReferenceCookie,
  setSessionCookie,
} from "lib/auth";
import { getAdminUserById } from "lib/users";

type RouteParams<T> = T | Promise<T>;

export async function POST(
  _request: Request,
  { params }: { params: RouteParams<{ id: string }> },
) {
  const headerList = await headers();
  const cookieStore = await cookies();
  const cookieContext = {
    forwardedProto: headerList.get("x-forwarded-proto"),
    host: headerList.get("host"),
  };
  const isNativeMobile = headerList.get("x-botadmin-mobile") === "flutter";

  try {
    const currentUser = await getCurrentUser();

    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso não autorizado." }, { status: 403 });
    }

    const currentSessionId = cookieStore.get(SESSION_COOKIE)?.value ?? null;
    if (!currentSessionId) {
      return NextResponse.json(
        { message: "Sessão atual não encontrada. Faça login novamente." },
        { status: 401 },
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const targetId = Number.parseInt(resolvedParams.id, 10);
    if (Number.isNaN(targetId) || targetId <= 0) {
      return NextResponse.json({ message: "Identificador de usuário inválido." }, { status: 400 });
    }

    const targetUser = await getAdminUserById(targetId);
    if (!targetUser) {
      return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    }

    if (!targetUser.isActive) {
      return NextResponse.json(
        { message: "Não é possível acessar uma conta desativada." },
        { status: 400 },
      );
    }

    if (currentUser.id === targetUser.id) {
      return NextResponse.json(
        {
          message: "Você já está autenticado com esta conta.",
          redirectTo: "/dashboard/admin",
        },
        { status: 200 },
      );
    }

    const adminSession = await findActiveSession(currentSessionId);
    if (!adminSession || adminSession.user_id !== currentUser.id) {
      return NextResponse.json(
        { message: "Sessão administrativa inválida." },
        { status: 401 },
      );
    }

    const session = await createSession(targetUser.id, undefined, {
      impersonatedByUserId: currentUser.id,
      impersonatedFromSessionId: currentSessionId,
    });

    const response = NextResponse.json(
      {
        message: `Sessão iniciada como ${targetUser.name}.`,
        redirectTo: "/dashboard/user",
        ...(isNativeMobile
          ? {
              sessionCookie: `${SESSION_COOKIE}=${session.id}`,
              adminSessionCookie: `${ADMIN_SESSION_COOKIE}=${currentSessionId}`,
            }
          : {}),
      },
      { status: 200 },
    );

    setSessionCookie(response, session.id, session.expiresAt, cookieContext);
    setAdminSessionReferenceCookie(response, currentSessionId, adminSession.expires_at, cookieContext);

    return response;
  } catch (error) {
    console.error("Failed to impersonate user", error);
    return NextResponse.json(
      { message: "Não foi possível iniciar sessão como o usuário selecionado." },
      { status: 500 },
    );
  }
}
