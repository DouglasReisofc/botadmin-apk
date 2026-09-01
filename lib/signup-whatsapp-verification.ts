import { randomBytes } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { requireAdminOperationalWuzapiClient } from "lib/admin-operational-instance";
import { ensureUserTable, getDb } from "lib/db";
import { findUserIdByWhatsappDigits } from "lib/users";
import { checkWhatsappUsers, sendTextMessage } from "lib/wuzapi";

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export class SignupWhatsappVerificationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SignupWhatsappVerificationError";
    this.status = status;
  }
}

type SignupWhatsappVerificationRow = RowDataPacket & {
  id: number;
  token: string;
  name: string;
  email: string;
  password_hash: string;
  whatsapp_number: string;
  code: string;
  attempts: number;
  expires_at: Date | string;
};

export type NormalizedSignupWhatsapp = {
  digits: string;
  e164: string;
};

export type PendingSignupWhatsappVerification = {
  token: string;
  code: string;
  expiresAt: Date;
};

export type ConsumedSignupWhatsappVerification = {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  whatsappNumber: string;
};

export type SignupWhatsappVerificationStatus = {
  token: string;
  status: "pending" | "verified" | "expired";
  expiresAt: Date;
  verifiedAt: Date | null;
};

export const normalizeSignupWhatsappNumber = (value: unknown): NormalizedSignupWhatsapp => {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new SignupWhatsappVerificationError("Informe o número do WhatsApp.");
  }

  let digits = String(value).replace(/\D+/g, "");
  if (!digits) {
    throw new SignupWhatsappVerificationError("Informe o número do WhatsApp.");
  }

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = `55${digits}`;
  }

  if (digits.length < 12 || digits.length > 15) {
    throw new SignupWhatsappVerificationError("Informe o WhatsApp com DDI, DDD e número.");
  }

  return {
    digits,
    e164: `+${digits}`,
  };
};

const ensureSignupWhatsappVerificationTable = async () => {
  await ensureUserTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS signup_whatsapp_verifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token CHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      whatsapp_number VARCHAR(32) NOT NULL,
      code VARCHAR(8) NOT NULL,
      status ENUM('pending','verified','expired') NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      verified_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_signup_whatsapp_token (token),
      INDEX idx_signup_whatsapp_email (email, status),
      INDEX idx_signup_whatsapp_number (whatsapp_number, status),
      INDEX idx_signup_whatsapp_expiry (status, expires_at)
    ) ENGINE=InnoDB;
  `);
};

export const createSignupWhatsappVerification = async (params: {
  name: string;
  email: string;
  passwordHash: string;
  whatsappNumber?: string | null;
}): Promise<PendingSignupWhatsappVerification> => {
  await ensureSignupWhatsappVerificationTable();
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  const whatsappNumber = params.whatsappNumber?.trim() ?? "";

  if (whatsappNumber) {
    await db.query(
      `
        UPDATE signup_whatsapp_verifications
        SET status = 'expired'
        WHERE status = 'pending'
          AND (email = ? OR whatsapp_number = ?)
      `,
      [params.email, whatsappNumber],
    );
  } else {
    await db.query(
      `
        UPDATE signup_whatsapp_verifications
        SET status = 'expired'
        WHERE status = 'pending'
          AND email = ?
      `,
      [params.email],
    );
  }

  await db.query<ResultSetHeader>(
    `
      INSERT INTO signup_whatsapp_verifications
        (token, name, email, password_hash, whatsapp_number, code, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))
    `,
    [token, params.name, params.email, params.passwordHash, whatsappNumber, code],
  );

  return { token, code, expiresAt };
};

export const expireSignupWhatsappVerification = async (token: string): Promise<void> => {
  await ensureSignupWhatsappVerificationTable();
  const db = getDb();
  await db.query(
    "UPDATE signup_whatsapp_verifications SET status = 'expired' WHERE token = ? AND status = 'pending'",
    [token],
  );
};

const mapConsumedRow = (row: SignupWhatsappVerificationRow): ConsumedSignupWhatsappVerification => ({
  id: Number(row.id),
  name: row.name,
  email: row.email,
  passwordHash: row.password_hash,
  whatsappNumber: row.whatsapp_number,
});

export const getSignupWhatsappVerificationStatus = async (
  token: string,
): Promise<SignupWhatsappVerificationStatus | null> => {
  await ensureSignupWhatsappVerificationTable();
  const db = getDb();
  const normalizedToken = token.trim();
  if (!normalizedToken) return null;

  await db.query(
    `
      UPDATE signup_whatsapp_verifications
      SET status = 'expired'
      WHERE token = ?
        AND status = 'pending'
        AND expires_at <= NOW()
    `,
    [normalizedToken],
  );

  const [rows] = await db.query<
    (SignupWhatsappVerificationRow & {
      status: "pending" | "verified" | "expired";
      verified_at: Date | string | null;
    })[]
  >(
    `
      SELECT *
      FROM signup_whatsapp_verifications
      WHERE token = ?
      LIMIT 1
    `,
    [normalizedToken],
  );

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;

  return {
    token: normalizedToken,
    status: row.status,
    expiresAt: new Date(row.expires_at),
    verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
  };
};

export const consumeVerifiedSignupWhatsappVerification = async (params: {
  token: string;
}): Promise<ConsumedSignupWhatsappVerification> => {
  await ensureSignupWhatsappVerificationTable();
  const db = getDb();
  const token = params.token.trim();

  if (!token) {
    throw new SignupWhatsappVerificationError("Verificação inválida.");
  }

  const [rows] = await db.query<SignupWhatsappVerificationRow[]>(
    `
      SELECT *
      FROM signup_whatsapp_verifications
      WHERE token = ?
        AND status = 'verified'
      LIMIT 1
    `,
    [token],
  );

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw new SignupWhatsappVerificationError("Aguardando confirmação pelo WhatsApp.", 202);
  }
  if (!row.whatsapp_number.replace(/\D+/g, "")) {
    throw new SignupWhatsappVerificationError("Aguardando confirmação pelo WhatsApp.", 202);
  }

  await db.query(
    `
      UPDATE signup_whatsapp_verifications
      SET status = 'expired'
      WHERE id = ?
        AND status = 'verified'
    `,
    [row.id],
  );

  return mapConsumedRow(row);
};

export const validateAndSendSignupWhatsappCode = async (params: {
  whatsappDigits: string;
  whatsappNumber: string;
  name: string;
  code: string;
}): Promise<void> => {
  const client = await requireAdminOperationalWuzapiClient().catch((error) => {
    throw new SignupWhatsappVerificationError(
      error instanceof Error ? error.message : "Nenhuma instância EasyZap conectada para enviar o código de cadastro.",
      503,
    );
  });
  const checked = await checkWhatsappUsers(client, [params.whatsappDigits]);
  const match = checked.find((item) => {
    const queryDigits = item.query.replace(/\D+/g, "");
    const jidDigits = (item.jid ?? "").replace(/\D+/g, "");
    return queryDigits === params.whatsappDigits || jidDigits.startsWith(params.whatsappDigits);
  });

  if (!match?.isInWhatsapp) {
    throw new SignupWhatsappVerificationError("Esse número não está ativo no WhatsApp.", 400);
  }

  const firstName = params.name.trim().split(/\s+/)[0] || "Olá";
  const body = [
    `${firstName}, seu código de cadastro no BotAdmin é:`,
    "",
    params.code,
    "",
    `Ele expira em ${CODE_TTL_MINUTES} minutos. Se você não pediu esse cadastro, ignore esta mensagem.`,
  ].join("\n");

  await sendTextMessage(client, {
    to: `${params.whatsappDigits}@s.whatsapp.net`,
    body,
  });
};

export const consumeSignupWhatsappVerification = async (params: {
  token: string;
  code: string;
}): Promise<ConsumedSignupWhatsappVerification> => {
  await ensureSignupWhatsappVerificationTable();
  const db = getDb();
  const token = params.token.trim();
  const code = params.code.replace(/\D+/g, "");

  if (!token || !code) {
    throw new SignupWhatsappVerificationError("Informe o código recebido no WhatsApp.");
  }

  const [rows] = await db.query<SignupWhatsappVerificationRow[]>(
    `
      SELECT *
      FROM signup_whatsapp_verifications
      WHERE token = ?
        AND status = 'pending'
      LIMIT 1
    `,
    [token],
  );

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw new SignupWhatsappVerificationError("Código de cadastro inválido ou já utilizado.");
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await expireSignupWhatsappVerification(token);
    throw new SignupWhatsappVerificationError("Código expirado. Solicite um novo cadastro.");
  }

  if (row.code !== code) {
    const attempts = Number(row.attempts ?? 0) + 1;
    await db.query(
      `
        UPDATE signup_whatsapp_verifications
        SET attempts = ?, status = IF(? >= ?, 'expired', status)
        WHERE id = ?
      `,
      [attempts, attempts, MAX_ATTEMPTS, row.id],
    );
    throw new SignupWhatsappVerificationError(
      attempts >= MAX_ATTEMPTS
        ? "Código incorreto muitas vezes. Faça o cadastro novamente."
        : "Código incorreto.",
      400,
    );
  }

  await db.query(
    `
      UPDATE signup_whatsapp_verifications
      SET status = 'verified', verified_at = NOW()
      WHERE id = ?
    `,
    [row.id],
  );

  return mapConsumedRow(row);
};

export const confirmSignupWhatsappVerificationFromMessage = async (params: {
  code: string;
  senderDigits: string;
}): Promise<ConsumedSignupWhatsappVerification | null> => {
  await ensureSignupWhatsappVerificationTable();
  const db = getDb();
  const code = params.code.replace(/\D+/g, "").slice(0, 6);
  const senderDigits = params.senderDigits.replace(/\D+/g, "");
  if (!code || !senderDigits) return null;

  const [rows] = await db.query<SignupWhatsappVerificationRow[]>(
    `
      SELECT *
      FROM signup_whatsapp_verifications
      WHERE code = ?
        AND status = 'pending'
        AND expires_at > NOW()
      LIMIT 1
    `,
    [code],
  );

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;

  const expectedDigits = row.whatsapp_number.replace(/\D+/g, "");
  if (expectedDigits && senderDigits !== expectedDigits) {
    throw new SignupWhatsappVerificationError(
      "O código precisa ser enviado pelo mesmo WhatsApp informado no cadastro.",
      400,
    );
  }

  const existingPhoneOwner = await findUserIdByWhatsappDigits(senderDigits);
  if (existingPhoneOwner) {
    throw new SignupWhatsappVerificationError(
      "Este WhatsApp já está vinculado a outra conta. Recupere o acesso no site ou fale com o suporte se não reconhecer esse cadastro.",
      409,
    );
  }

  const [existingEmail] = await db.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [row.email],
  );
  if (Array.isArray(existingEmail) && existingEmail.length > 0) {
    throw new SignupWhatsappVerificationError(
      "Este e-mail já está registrado. Entre em contato com o suporte.",
      409,
    );
  }

  await db.query(
    `
      UPDATE signup_whatsapp_verifications
      SET status = 'verified', verified_at = NOW(), whatsapp_number = ?
      WHERE id = ?
        AND status = 'pending'
    `,
    [`+${senderDigits}`, row.id],
  );

  return mapConsumedRow({ ...row, whatsapp_number: `+${senderDigits}` });
};
