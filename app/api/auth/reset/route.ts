import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";

import {
  ensurePasswordResetTable,
  ensureUserTable,
  getDb,
  PasswordResetRow,
} from "lib/db";
import { revokeSessionsForUser } from "lib/auth";

type ResetLookupUserRow = RowDataPacket & {
  id: number;
};

const sanitizeDigits = (value: string) => value.replace(/\D+/g, "");

const buildWhatsappCandidates = (value: string) => {
  const digits = sanitizeDigits(value);
  if (!digits) return [];
  return Array.from(
    new Set([
      digits,
      digits.length === 10 || digits.length === 11 ? `55${digits}` : digits,
      digits.startsWith("55") ? digits.slice(2) : digits,
    ].filter(Boolean)),
  );
};

const findResetUserId = async (identifier: string): Promise<number | null> => {
  const clean = identifier.trim();
  if (!clean) return null;

  const normalizedEmail = clean.includes("@") ? clean.toLowerCase() : "";
  const phoneCandidates = buildWhatsappCandidates(clean);
  const whereParts: string[] = [];
  const whereValues: unknown[] = [];

  if (normalizedEmail) {
    whereParts.push("LOWER(email) = ?");
    whereValues.push(normalizedEmail);
  }
  if (phoneCandidates.length > 0) {
    whereParts.push(
      `REGEXP_REPLACE(COALESCE(whatsapp_number, ''), '[^0-9]', '') IN (${phoneCandidates.map(() => "?").join(",")})`,
    );
    whereValues.push(...phoneCandidates);
  }
  if (!whereParts.length) return null;

  const db = getDb();
  const [rows] = await db.query<ResetLookupUserRow[]>(
    `SELECT id FROM users WHERE ${whereParts.join(" OR ")} LIMIT 1`,
    whereValues,
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return Number(rows[0].id) || null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token, password, identifier, code } = body as {
      token?: string;
      password?: string;
      identifier?: string;
      code?: string;
    };

    if (!password || password.length < 6) {
      return NextResponse.json(
        { message: "Informe uma nova senha com pelo menos 6 caracteres." },
        { status: 400 },
      );
    }

    await ensureUserTable();
    await ensurePasswordResetTable();
    const db = getDb();

    let reset: PasswordResetRow | null = null;

    if (token) {
      const [rows] = await db.query<PasswordResetRow[]>(
        `SELECT * FROM password_resets WHERE token = ? LIMIT 1`,
        [token],
      );
      reset = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    } else {
      const cleanCode = (code || "").replace(/\D+/g, "");
      const userId = identifier ? await findResetUserId(identifier) : null;
      if (!userId || cleanCode.length < 4) {
        return NextResponse.json({ message: "Código inválido." }, { status: 400 });
      }

      const [rows] = await db.query<PasswordResetRow[]>(
        `
          SELECT *
          FROM password_resets
          WHERE user_id = ?
            AND used_at IS NULL
            AND expires_at > NOW()
            AND code_hash IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 5
        `,
        [userId],
      );

      for (const candidate of rows) {
        const matches = candidate.code_hash
          ? await bcrypt.compare(cleanCode, candidate.code_hash)
          : false;
        if (matches) {
          reset = candidate;
          break;
        }
      }
    }

    if (!reset) {
      return NextResponse.json({ message: "Código ou token inválido." }, { status: 400 });
    }

    const now = new Date();
    const expires = new Date(reset.expires_at);
    if (reset.used_at || expires.getTime() <= now.getTime()) {
      return NextResponse.json({ message: "Token expirado ou já utilizado." }, { status: 400 });
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.query(`UPDATE users SET password = ? WHERE id = ?`, [hashed, reset.user_id]);
    await db.query(`UPDATE password_resets SET used_at = NOW() WHERE id = ?`, [reset.id]);

    await revokeSessionsForUser(reset.user_id);

    return NextResponse.json({ message: "Senha alterada com sucesso." });
  } catch (error) {
    console.error("[reset-password] Erro ao redefinir senha", error);
    return NextResponse.json(
      { message: "Não foi possível redefinir a senha." },
      { status: 500 },
    );
  }
}
