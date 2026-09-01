import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { ResultSetHeader } from "mysql2";

import { getCurrentUser } from "lib/auth";
import { ensureUserTable, getDb } from "lib/db";
import { getSubscriptionPlanById, setUserPlanSubscription } from "lib/plans";
import { findUserIdByWhatsappDigits, getAdminUserById, searchAdminUsers } from "lib/users";
import { ensureUserWebhook } from "lib/webhooks";

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const validateEmail = (value: string) => {
  const atIndex = value.indexOf("@");
  return Boolean(value && atIndex > 0 && atIndex < value.length - 1);
};

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso nao autorizado." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const limitParam = searchParams.get("limit");

    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const { users, hasMore } = await searchAdminUsers({ query, limit });

    return NextResponse.json({ users, hasMore });
  } catch (error) {
    console.error("Failed to list admin users", error);
    return NextResponse.json(
      { message: "Nao foi possivel carregar a lista de usuarios." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso nao autorizado." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      name,
      email,
      password,
      role,
      isActive,
      whatsappDialCode,
      whatsappNumber,
      planId,
    } = body as Record<string, unknown>;

    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? normalizeEmail(email) : "";
    const rawPassword = typeof password === "string" ? password : "";
    const normalizedRole = role === "admin" ? "admin" : "user";
    const active = typeof isActive === "boolean" ? isActive : true;

    if (!normalizedName) {
      return NextResponse.json({ message: "Informe o nome do usuário." }, { status: 400 });
    }

    if (!validateEmail(normalizedEmail)) {
      return NextResponse.json({ message: "Informe um e-mail válido." }, { status: 400 });
    }

    if (rawPassword.length < 6) {
      return NextResponse.json({ message: "A senha deve ter pelo menos 6 caracteres." }, { status: 400 });
    }

    let fullWhatsapp: string | null = null;
    if (typeof whatsappNumber === "string" && whatsappNumber.trim()) {
      const dial = typeof whatsappDialCode === "string" && whatsappDialCode.trim()
        ? whatsappDialCode.trim()
        : "+55";
      const dialCode = dial.startsWith("+") ? dial : `+${dial.replace(/[^0-9]/g, "")}`;
      const digits = whatsappNumber.replace(/[^0-9]/g, "");
      if (digits.length < 8 || digits.length > 15) {
        return NextResponse.json(
          { message: "Informe um número de WhatsApp válido (DDD + número)." },
          { status: 400 },
        );
      }
      const existingPhoneOwner = await findUserIdByWhatsappDigits(digits);
      if (existingPhoneOwner) {
        return NextResponse.json(
          { message: "Este WhatsApp já está vinculado a outro usuário." },
          { status: 409 },
        );
      }
      fullWhatsapp = `${dialCode}${digits}`;
    }

    const parsedPlanId =
      typeof planId === "number"
        ? Math.floor(planId)
        : typeof planId === "string" && planId.trim()
          ? Number.parseInt(planId, 10)
          : null;

    if (parsedPlanId !== null && (!Number.isFinite(parsedPlanId) || parsedPlanId <= 0)) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 400 });
    }

    const plan = parsedPlanId ? await getSubscriptionPlanById(parsedPlanId) : null;
    if (parsedPlanId && !plan) {
      return NextResponse.json({ message: "Plano não encontrado." }, { status: 404 });
    }

    await ensureUserTable();
    const db = getDb();
    const [existingUsers] = await db.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail],
    );
    if (existingUsers.length) {
      return NextResponse.json({ message: "Este e-mail já está registrado." }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const [result] = await db.query<ResultSetHeader>(
      `
        INSERT INTO users
          (name, email, password, role, is_active, balance, whatsapp_number, needs_credentials_completion, password_missing)
        VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0)
      `,
      [normalizedName, normalizedEmail, hashedPassword, normalizedRole, active ? 1 : 0, fullWhatsapp],
    );

    const userId = result.insertId;
    await ensureUserWebhook(userId);

    let planStatus = null;
    if (plan) {
      const assigned = await setUserPlanSubscription(userId, {
        planId: plan.id,
        status: "active",
      });
      planStatus = assigned.status;
    }

    const user = await getAdminUserById(userId);

    return NextResponse.json(
      {
        message: plan
          ? `Usuário criado com ${plan.name} ativo.`
          : "Usuário criado com sucesso.",
        user,
        planStatus,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create admin user", error);
    return NextResponse.json(
      { message: "Nao foi possivel criar o usuario." },
      { status: 500 },
    );
  }
}
