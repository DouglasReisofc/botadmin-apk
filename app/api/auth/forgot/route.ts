import { randomBytes, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";

import { sendAdminOperationalText } from "lib/admin-operational-instance";
import { ensurePasswordResetTable, ensureUserTable, getDb } from "lib/db";
import { sendEmail, EmailNotConfiguredError } from "lib/email";
import { getPublicAppBaseUrl } from "lib/meta";

type ResetUserRow = RowDataPacket & {
  id: number;
  name: string | null;
  email: string | null;
  whatsapp_number: string | null;
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

const createResetCode = () => String(Math.floor(100000 + Math.random() * 900000));

const maskEmail = (value: string | null) => {
  const email = value?.trim();
  if (!email || !email.includes("@")) return null;
  const [name, domain] = email.split("@");
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, name.length - visible.length))}@${domain}`;
};

const maskPhone = (value: string | null) => {
  const digits = sanitizeDigits(value || "");
  if (digits.length < 4) return null;
  return `+${digits.slice(0, 2)} ${"*".repeat(Math.max(4, digits.length - 6))}${digits.slice(-4)}`;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email, identifier, whatsapp } = body as {
      email?: string;
      identifier?: string;
      whatsapp?: string;
    };

    const rawIdentifier = (identifier || email || whatsapp || "").trim();
    if (!rawIdentifier) {
      return NextResponse.json({ message: "Informe e-mail ou WhatsApp." }, { status: 400 });
    }

    const normalizedEmail = rawIdentifier.includes("@")
      ? rawIdentifier.toLowerCase().trim()
      : "";
    const phoneCandidates = buildWhatsappCandidates(rawIdentifier);

    await ensureUserTable();
    await ensurePasswordResetTable();
    const db = getDb();

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

    // Resposta uniforme para evitar enumeração
    const genericResponse = NextResponse.json({
      message: "Se a conta existir, enviaremos um código para o e-mail e WhatsApp cadastrados.",
    });

    if (whereParts.length === 0) {
      return genericResponse;
    }

    const [rows] = await db.query<ResetUserRow[]>(
      `
        SELECT id, name, email, whatsapp_number
        FROM users
        WHERE ${whereParts.join(" OR ")}
        LIMIT 1
      `,
      whereValues,
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return genericResponse;
    }

    const userId = Number(rows[0].id);
    const userName = rows[0].name?.trim() || "usuário";
    const userEmail = rows[0].email?.trim() || null;
    const userWhatsapp = rows[0].whatsapp_number?.trim() || null;
    const token = randomBytes(32).toString("hex");
    const code = createResetCode();
    const codeHash = await bcrypt.hash(code, 10);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1h

    await db.query(
      `UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`,
      [userId],
    );

    await db.query(
      `INSERT INTO password_resets (id, user_id, token, code_hash, expires_at) VALUES (?, ?, ?, ?, ?)`,
      [id, userId, token, codeHash, expiresAt],
    );

    // Monta URL de reset
    // Nunca use a URL interna da aplicação (por exemplo, localhost:4322) em
    // mensagens enviadas ao usuário. A URL pública ignora hosts locais e tem
    // botadmin.shop como fallback seguro em produção.
    const baseUrl = getPublicAppBaseUrl();
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const deliveryDetails = [
      maskEmail(userEmail) ? `e-mail ${maskEmail(userEmail)}` : null,
      maskPhone(userWhatsapp) ? `WhatsApp ${maskPhone(userWhatsapp)}` : null,
    ].filter(Boolean).join(" e ");

    if (userEmail) {
      try {
        await sendEmail({
          to: userEmail,
          subject: "Código de recuperação - BotAdmin",
          text: `Olá, ${userName}!\n\nSeu código de recuperação do BotAdmin é: ${code}\n\nEle expira em 1 hora.\n\nVocê também pode redefinir pelo link:\n${resetUrl}\n\nSe você não solicitou, ignore esta mensagem.\n`,
          html: `<p>Olá, ${userName}!</p><p>Seu código de recuperação do BotAdmin é:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>Ele expira em 1 hora.</p><p>Você também pode <a href="${resetUrl}">redefinir pelo link</a>.</p><p>Se você não solicitou, ignore esta mensagem.</p>`,
        });
      } catch (error) {
        if (error instanceof EmailNotConfiguredError) {
          console.warn("[forgot-password] SMTP não configurado. Código/link:", code, resetUrl);
        } else {
          console.error("[forgot-password] Falha ao enviar e-mail de reset", error);
        }
      }
    }

    const whatsappDigits = sanitizeDigits(userWhatsapp || "");
    if (whatsappDigits) {
      await sendAdminOperationalText({
        toDigits: whatsappDigits,
        body: [
          `Olá, ${userName}!`,
          `Seu código de recuperação do BotAdmin é: ${code}`,
          "Ele expira em 1 hora.",
          "Se você não solicitou, ignore esta mensagem.",
        ].join("\n"),
      }).catch((error) => {
        console.error("[forgot-password] Falha ao enviar WhatsApp de reset", error);
      });
    }

    return NextResponse.json({
      message: deliveryDetails
        ? `Enviamos o código para ${deliveryDetails}.`
        : "Se a conta existir, enviaremos um código para os canais cadastrados.",
    });
  } catch (error) {
    console.error("[forgot-password] Erro", error);
    return NextResponse.json(
      { message: "Não foi possível processar a solicitação." },
      { status: 500 },
    );
  }
}
