import { randomBytes } from "crypto";
import type { ResultSetHeader } from "mysql2";
import type { RowDataPacket } from "mysql2/promise";

import {
  ensureUserTable,
  ensureUserVerificationTable,
  getDb,
  type UserVerificationRow,
} from "lib/db";

const VERIFICATION_EXPIRATION_MINUTES = 60;

const buildExpirationDate = () => {
  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + VERIFICATION_EXPIRATION_MINUTES);
  return expires;
};

const normalizeRow = (row: UserVerificationRow) => ({
  id: row.id,
  userId: row.user_id,
  code: row.code,
  token: row.token,
  status: row.status,
  confirmationChannel: row.confirmation_channel,
  expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : new Date(row.expires_at).toISOString(),
  verifiedAt: row.verified_at instanceof Date
    ? row.verified_at.toISOString()
    : row.verified_at
      ? new Date(row.verified_at).toISOString()
      : null,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
});

const generateUniqueCode = async () => {
  const db = getDb();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `SB-${Math.floor(100000 + Math.random() * 900000)}`;
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT id FROM user_verification_codes WHERE code = ? LIMIT 1",
      [code],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return code;
    }
  }
  throw new Error("Não foi possível gerar um código de verificação único.");
};

export const createUserVerificationRequest = async (userId: number) => {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error("Usuário inválido para verificação.");
  }

  await ensureUserTable();
  await ensureUserVerificationTable();
  const db = getDb();

  await db.query("DELETE FROM user_verification_codes WHERE user_id = ? AND status = 'pending'", [userId]);

  const code = await generateUniqueCode();
  const token = randomBytes(32).toString("hex");
  const expiresAt = buildExpirationDate();

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_verification_codes (user_id, code, token, expires_at)
      VALUES (?, ?, ?, ?)
    `,
    [userId, code, token, expiresAt],
  );

  return {
    id: result.insertId,
    code,
    token,
    expiresAt: expiresAt.toISOString(),
  };
};

export const getUserVerificationByToken = async (token: string) => {
  if (!token || typeof token !== "string") {
    return null;
  }

  await ensureUserVerificationTable();
  const db = getDb();

  const [rows] = await db.query<UserVerificationRow[]>(
    `
      SELECT *
      FROM user_verification_codes
      WHERE token = ?
      LIMIT 1
    `,
    [token],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return normalizeRow(rows[0]);
};

export const getPendingVerificationByCode = async (code: string) => {
  if (!code || typeof code !== "string") {
    return null;
  }

  await ensureUserVerificationTable();
  const db = getDb();

  const normalizedCode = code.trim().toUpperCase();

  const [rows] = await db.query<UserVerificationRow[]>(
    `
      SELECT *
      FROM user_verification_codes
      WHERE code = ?
        AND status = 'pending'
        AND expires_at > NOW()
      LIMIT 1
    `,
    [normalizedCode],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return normalizeRow(rows[0]);
};

export const markVerificationAsVerified = async (
  verificationId: number,
  options: { channel?: string } = {},
) => {
  if (!Number.isFinite(verificationId) || verificationId <= 0) {
    throw new Error("Verificação inválida.");
  }

  await ensureUserVerificationTable();
  const db = getDb();

  const channel = options.channel?.trim() || null;

  await db.query<ResultSetHeader>(
    `
      UPDATE user_verification_codes
      SET status = 'verified', verified_at = NOW(), confirmation_channel = ?, expires_at = NOW()
      WHERE id = ?
    `,
    [channel, verificationId],
  );
};

