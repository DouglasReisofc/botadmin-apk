import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { ensureUserTable, getDb, UserRow } from "lib/db";
import type { RowDataPacket } from "mysql2/promise";
import { createSession, normalizeUserRole, SESSION_COOKIE, setSessionCookie } from "lib/auth";
import { getPartnerPanelAccess } from "lib/reseller-program";

export async function POST(request: Request) {
  const headerList = await headers();
  const cookieContext = {
    forwardedProto: headerList.get("x-forwarded-proto"),
    host: headerList.get("host"),
  };
  const isNativeMobile = headerList.get("x-botadmin-mobile") === "flutter";

  try {
    const body = await request.json();
    const { identifier, password, remember } = body as {
      identifier?: string;
      password?: string;
      remember?: boolean;
    };

    if (!identifier || !password) {
      return NextResponse.json(
        { message: "Informe e-mail ou WhatsApp e senha válidos." },
        { status: 400 },
      );
    }

    const normalizedIdentifier = identifier.trim();
    const isEmailLogin = normalizedIdentifier.includes("@");

    await ensureUserTable();
    const db = getDb();

    let userRow: (UserRow & RowDataPacket) | null = null;

    if (isEmailLogin) {
      const normalizedEmail = normalizedIdentifier.toLowerCase();
      const [users] = await db.query<(UserRow & RowDataPacket)[]>(
        "SELECT * FROM users WHERE email = ? LIMIT 1",
        [normalizedEmail],
      );
      if (Array.isArray(users) && users.length > 0) {
        userRow = users[0];
      }
    } else {
      const digits = normalizedIdentifier.replace(/[^0-9]/g, "");
      if (!digits) {
        return NextResponse.json(
          { message: "Informe um número de WhatsApp válido." },
          { status: 400 },
        );
      }

      const [users] = await db.query<(UserRow & RowDataPacket)[]>(
        `
          SELECT *
          FROM users
          WHERE whatsapp_number IS NOT NULL
            AND REGEXP_REPLACE(whatsapp_number, '[^0-9]', '') = ?
          LIMIT 1
        `,
        [digits],
      );

      if (Array.isArray(users) && users.length > 0) {
        userRow = users[0];
      }
    }

    if (!userRow) {
      return NextResponse.json(
        { message: "Credenciais inválidas." },
        { status: 401 },
      );
    }

    const user = userRow;

    if (!user.is_active) {
      return NextResponse.json(
        {
          message:
            "Sua conta está desativada. Entre em contato com o suporte para reativação.",
        },
        { status: 403 },
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return NextResponse.json(
        { message: "Credenciais inválidas." },
        { status: 401 },
      );
    }

    const session = await createSession(user.id, remember ? 30 : undefined);
    const normalizeAvatarUrl = (value: string | null) => {
      if (!value) {
        return null;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const sanitized = trimmed.replace(/^\/+/, "").replace(/\\/g, "/");
      return `/${sanitized}`;
    };

    const partnerAccess = await getPartnerPanelAccess(user.id).catch((error) => {
      console.warn("[auth] Falha ao consultar papel de parceiro", error);
      return null;
    });

    const response = NextResponse.json(
      {
        user: {
          id: user.id,
          name: user.name,
          email: user.email ?? null,
          role: normalizeUserRole(user.role),
          isActive: Boolean(user.is_active),
          whatsappNumber: user.whatsapp_number ?? null,
          avatarUrl: normalizeAvatarUrl(user.avatar_path ?? null),
          needsCredentialsCompletion: Boolean(user.needs_credentials_completion),
          passwordMissing: Boolean(user.password_missing),
          partnerRole: partnerAccess?.role ?? null,
        },
        ...(isNativeMobile ? { sessionCookie: `${SESSION_COOKIE}=${session.id}` } : {}),
        message: "Login realizado com sucesso.",
      },
      { status: 200 },
    );

    setSessionCookie(response, session.id, session.expiresAt, cookieContext);

    return response;
  } catch (error) {
    console.error("Erro ao autenticar usuário", error);
    return NextResponse.json(
      { message: "Não foi possível completar o login." },
      { status: 500 },
    );
  }
}

