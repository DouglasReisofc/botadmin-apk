import bcrypt from "bcryptjs";
import type { ResultSetHeader } from "mysql2";
import type { RowDataPacket } from "mysql2/promise";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createSession, setSessionCookie } from "lib/auth";
import { ensureUserTable, getDb, UserRow } from "lib/db";
import { applyTrialForNewUser } from "lib/plan-trial";
import {
  consumeVerifiedSignupWhatsappVerification,
  consumeSignupWhatsappVerification,
  createSignupWhatsappVerification,
  expireSignupWhatsappVerification,
  getSignupWhatsappVerificationStatus,
  normalizeSignupWhatsappNumber,
  SignupWhatsappVerificationError,
  validateAndSendSignupWhatsappCode,
} from "lib/signup-whatsapp-verification";
import {
  buildSignupWhatsappDisplayCode,
  buildSignupWhatsappMessage,
  formatSignupWhatsappInstructions,
  getSignupWhatsappVerificationSettings,
  resolveSignupWhatsappVerificationTarget,
} from "lib/signup-whatsapp-settings";
import { sendSignupWelcomeSupportMessage } from "lib/support-automation";
import { findUserIdByWhatsappDigits } from "lib/users";
import { ensureUserWebhook } from "lib/webhooks";
import {
  recordBotAdminAffiliateReferral,
  resolveBotAdminAffiliateUserIdFromCode,
} from "lib/bot-admin-affiliates";

const normalizeEmail = (email: string): string => email.toLowerCase().trim();
const DEFERRED_WHATSAPP_VERIFICATION_MESSAGE =
  "Não conseguimos verificar seu número agora, mas você pode verificar depois dentro do painel.";
const WAITING_WHATSAPP_CONFIRMATION_MESSAGE =
  "Aguardando a mensagem de confirmação chegar pelo WhatsApp.";

const validateEmail = (email: string): NextResponse | null => {
  const atIndex = email.indexOf("@");
  const localPart = atIndex > 0 ? email.slice(0, atIndex) : email;
  if (!email || atIndex <= 0) {
    return NextResponse.json({ message: "Informe um e-mail válido." }, { status: 400 });
  }
  if (localPart.includes("+")) {
    return NextResponse.json(
      { message: "Utilize um endereço de e-mail sem o símbolo '+'." },
      { status: 400 },
    );
  }
  return null;
};

const createUserSessionResponse = async (
  userId: number,
  userName: string,
  email: string,
  whatsappNumber: string | null,
  cookieContext: { forwardedProto: string | null; host: string | null },
  options: { message?: string; whatsappVerificationDeferred?: boolean } = {},
) => {
  await ensureUserWebhook(userId);

  let trial;
  try {
    trial = await applyTrialForNewUser({
      userId,
      userName,
      context: "web_signup",
    });
  } catch (error) {
    console.error("Failed to assign trial during sign-up", error);
    trial = {
      applied: false,
      expiresAt: null,
      durationHours: null,
      durationLabel: null,
    };
  }

  await sendSignupWelcomeSupportMessage({
    userId,
    userName,
  });

  const session = await createSession(userId);
  const response = NextResponse.json(
    {
      user: {
        id: userId,
        name: userName,
        email,
        role: "user",
        isActive: true,
        whatsappNumber,
        avatarUrl: null,
      },
      trial,
      message: options.message ?? "Conta criada e WhatsApp confirmado com sucesso.",
      whatsappVerificationDeferred: options.whatsappVerificationDeferred === true,
    },
    { status: 201 },
  );
  setSessionCookie(response, session.id, session.expiresAt, cookieContext);
  return response;
};

export async function POST(request: Request) {
  try {
    const headerList = await headers();
    const cookieContext = {
      forwardedProto: headerList.get("x-forwarded-proto"),
      host: headerList.get("host"),
    };

    const body = await request.json();
    const {
      name,
      email,
      password,
      whatsappNumber,
      verificationToken,
      verificationCode,
      referralCode,
    } = body as {
      name?: string;
      email?: string;
      password?: string;
      whatsappNumber?: string;
      verificationToken?: string;
      verificationCode?: string;
      referralCode?: string;
    };

    await ensureUserTable();
    const db = getDb();

    if (verificationToken || verificationCode) {
      if (!verificationToken) {
        return NextResponse.json(
          { message: "Informe o código recebido no WhatsApp." },
          { status: 400 },
        );
      }

      let pending;
      if (verificationCode) {
        pending = await consumeSignupWhatsappVerification({
          token: verificationToken,
          code: verificationCode,
        });
      } else {
        const status = await getSignupWhatsappVerificationStatus(verificationToken);
        if (!status) {
          return NextResponse.json(
            { message: "Verificação de cadastro inválida ou expirada." },
            { status: 400 },
          );
        }
        if (status.status !== "verified") {
          return NextResponse.json(
            {
              pendingVerification: true,
              verificationStatus: status.status,
              expiresAt: status.expiresAt,
              message:
                status.status === "expired"
                  ? "Código expirado. Refazer o cadastro gera um novo código."
                  : WAITING_WHATSAPP_CONFIRMATION_MESSAGE,
            },
            { status: status.status === "expired" ? 410 : 202 },
          );
        }
        pending = await consumeVerifiedSignupWhatsappVerification({
          token: verificationToken,
        });
      }

      const [existingUsers] = await db.query<(UserRow & RowDataPacket)[]>(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [pending.email],
      );
      if (existingUsers.length) {
        return NextResponse.json({ message: "Este e-mail já está registrado." }, { status: 409 });
      }

      const existingPhoneOwner = await findUserIdByWhatsappDigits(pending.whatsappNumber);
      if (existingPhoneOwner) {
        return NextResponse.json(
          { message: "Este WhatsApp já está vinculado a outra conta." },
          { status: 409 },
        );
      }

      const [result] = await db.query<ResultSetHeader>(
        "INSERT INTO users (name, email, password, role, is_active, whatsapp_number) VALUES (?, ?, ?, 'user', 1, ?)",
        [pending.name, pending.email, pending.passwordHash, pending.whatsappNumber],
      );
      const referrerUserId = await resolveBotAdminAffiliateUserIdFromCode(referralCode);
      await recordBotAdminAffiliateReferral({
        referrerUserId,
        referredUserId: result.insertId,
        referralCode: referralCode ?? null,
        metadata: { registrationFlow: "whatsapp_confirmed" },
      }).catch((error) => console.error("Failed to record affiliate referral", error));

      return createUserSessionResponse(
        result.insertId,
        pending.name,
        pending.email,
        pending.whatsappNumber,
        cookieContext,
      );
    }

    if (!name || !email || !password) {
      return NextResponse.json(
        { message: "Nome, e-mail e senha são obrigatórios." },
        { status: 400 },
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { message: "A senha deve ter pelo menos 6 caracteres." },
        { status: 400 },
      );
    }

    const normalizedEmail = normalizeEmail(email);
    const emailError = validateEmail(normalizedEmail);
    if (emailError) return emailError;

    const verificationSettings = await getSignupWhatsappVerificationSettings();
    const normalizedWhatsapp =
      typeof whatsappNumber === "string" && whatsappNumber.trim()
        ? normalizeSignupWhatsappNumber(whatsappNumber)
        : null;

    if (
      verificationSettings.enabled &&
      verificationSettings.mode === "send_code" &&
      !normalizedWhatsapp
    ) {
      return NextResponse.json(
        { message: "Informe o WhatsApp para receber o código de confirmação." },
        { status: 400 },
      );
    }

    const [existingUsers] = await db.query<(UserRow & RowDataPacket)[]>(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail],
    );
    if (existingUsers.length) {
      return NextResponse.json({ message: "Este e-mail já está registrado." }, { status: 409 });
    }

    if (normalizedWhatsapp) {
      const existingPhoneOwner = await findUserIdByWhatsappDigits(normalizedWhatsapp.digits);
      if (existingPhoneOwner) {
        return NextResponse.json(
          { message: "Este WhatsApp já está vinculado a outra conta." },
          { status: 409 },
        );
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    if (!verificationSettings.enabled) {
      const [result] = await db.query<ResultSetHeader>(
        "INSERT INTO users (name, email, password, role, is_active, whatsapp_number) VALUES (?, ?, ?, 'user', 1, ?)",
        [name.trim(), normalizedEmail, hashedPassword, normalizedWhatsapp?.e164 ?? null],
      );
      const referrerUserId = await resolveBotAdminAffiliateUserIdFromCode(referralCode);
      await recordBotAdminAffiliateReferral({
        referrerUserId,
        referredUserId: result.insertId,
        referralCode: referralCode ?? null,
        metadata: { registrationFlow: "whatsapp_verification_disabled" },
      }).catch((recordError) => console.error("Failed to record affiliate referral", recordError));

      return createUserSessionResponse(
        result.insertId,
        name.trim(),
        normalizedEmail,
        normalizedWhatsapp?.e164 ?? null,
        cookieContext,
        {
          message: "Conta criada com sucesso.",
          whatsappVerificationDeferred: true,
        },
      );
    }

    const verification = await createSignupWhatsappVerification({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: hashedPassword,
      whatsappNumber: normalizedWhatsapp?.e164 ?? null,
    });

    if (verificationSettings.mode === "send_code") {
      if (!normalizedWhatsapp) {
        await expireSignupWhatsappVerification(verification.token).catch(() => undefined);
        return NextResponse.json(
          { message: "Informe o WhatsApp para receber o código de confirmação." },
          { status: 400 },
        );
      }
      try {
        await validateAndSendSignupWhatsappCode({
          whatsappDigits: normalizedWhatsapp.digits,
          whatsappNumber: normalizedWhatsapp.e164,
          name: name.trim(),
          code: verification.code,
        });
      } catch (error) {
        await expireSignupWhatsappVerification(verification.token).catch(() => undefined);
        if (error instanceof SignupWhatsappVerificationError && error.status === 503) {
          throw new SignupWhatsappVerificationError(
            `${DEFERRED_WHATSAPP_VERIFICATION_MESSAGE} Chame o suporte para validar manualmente.`,
            503,
          );
        }
        throw error;
      }

      return NextResponse.json(
        {
          pendingVerification: true,
          verificationToken: verification.token,
          whatsappNumber: normalizedWhatsapp.e164,
          expiresAt: verification.expiresAt,
          verification: {
            mode: "send_code",
            token: verification.token,
            whatsappNumber: normalizedWhatsapp.e164,
            expiresAt: verification.expiresAt,
          },
          message: `Enviamos um código para ${normalizedWhatsapp.e164}.`,
        },
        { status: 200 },
      );
    }

    const target = await resolveSignupWhatsappVerificationTarget(verificationSettings);
    if (!target) {
      await expireSignupWhatsappVerification(verification.token).catch(() => undefined);
      throw new SignupWhatsappVerificationError(
        "Não há número de confirmação configurado. Chame o suporte para validar seu WhatsApp.",
        503,
      );
    }

    const displayCode = buildSignupWhatsappDisplayCode(verification.code);
    const messageToSend = buildSignupWhatsappMessage(verification.code);
    const whatsappUrl = `https://wa.me/${target.digits}?text=${encodeURIComponent(messageToSend)}`;
    const instructions = formatSignupWhatsappInstructions({
      template: verificationSettings.instructions,
      code: displayCode,
      message: messageToSend,
      target: target.display,
    });

    return NextResponse.json(
      {
        pendingVerification: true,
        verificationToken: verification.token,
        whatsappNumber: normalizedWhatsapp?.e164 ?? null,
        expiresAt: verification.expiresAt,
        verification: {
          mode: "user_sends_code",
          token: verification.token,
          code: displayCode,
          messageToSend,
          whatsappUrl,
          targetWhatsappNumber: target.display,
          expiresAt: verification.expiresAt,
          instructions,
          supportText: verificationSettings.supportText,
        },
        message: "Confirme o cadastro pelo WhatsApp. O número será identificado automaticamente pela mensagem enviada.",
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof SignupWhatsappVerificationError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Erro ao registrar usuário", error);
    return NextResponse.json(
      { message: "Não foi possível completar o registro." },
      { status: 500 },
    );
  }
}
