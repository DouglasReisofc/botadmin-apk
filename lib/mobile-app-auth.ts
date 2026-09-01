import { createHash, randomBytes } from "crypto";
import type { RowDataPacket } from "mysql2/promise";

import { createSession, getSessionUserById } from "lib/auth";
import { ensureUserTable, getDb } from "lib/db";

type MobileAppAuthTokenRow = RowDataPacket & {
  id: number;
  token_hash: string;
  user_id: number;
  expires_at: Date;
  used_at: Date | null;
};

const TABLE = "mobile_app_auth_tokens";
const TOKEN_TTL_MS = 1000 * 60 * 2;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const ensureMobileAppAuthTokenTable = async () => {
  await ensureUserTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      token_hash CHAR(64) NOT NULL UNIQUE,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mobile_app_auth_user_created (user_id, created_at),
      INDEX idx_mobile_app_auth_token_active (token_hash, expires_at, used_at),
      CONSTRAINT fk_mobile_app_auth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
};

export const createMobileAppAuthToken = async (userId: number) => {
  await ensureMobileAppAuthTokenTable();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const db = getDb();

  await db.query(
    `DELETE FROM ${TABLE} WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at < NOW())`,
    [userId],
  );
  await db.query(
    `INSERT INTO ${TABLE} (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
    [hashToken(token), userId, expiresAt],
  );

  return { token, expiresAt };
};

export const consumeMobileAppAuthToken = async (token: string) => {
  const cleanToken = token.trim();
  if (!cleanToken) return null;

  await ensureMobileAppAuthTokenTable();
  const db = getDb();
  const tokenHash = hashToken(cleanToken);
  const [rows] = await db.query<MobileAppAuthTokenRow[]>(
    `
      SELECT *
      FROM ${TABLE}
      WHERE token_hash = ?
        AND used_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash],
  );

  const row = rows[0];
  if (!row) return null;

  const [result] = await db.query<any>(
    `
      UPDATE ${TABLE}
      SET used_at = NOW()
      WHERE id = ?
        AND used_at IS NULL
        AND expires_at > NOW()
    `,
    [row.id],
  );
  if (Number(result?.affectedRows ?? 0) !== 1) return null;

  const session = await createSession(Number(row.user_id), 30);
  const user = await getSessionUserById(session.id);
  if (!user) return null;

  return { session, user };
};
