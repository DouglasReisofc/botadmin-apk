import { ResultSetHeader, RowDataPacket } from "mysql2";

import type { BotInstance, BotInstanceStatus } from "types/bot-instances";
import { BotInstanceRow, ensureBotInstanceTable, ensureUserTable, getDb } from "./db";

export type BotUserProfileRow = {
  id: number;
  user_id: number;
  name: string;
  phone: string | null;
  plan_id: number | null;
  expires_at: Date | string | null;
  created_at: Date;
  updated_at: Date;
};

export type BotUserProfile = {
  id: number;
  userId: number;
  name: string;
  phone: string | null;
  planId: number | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BotUserProfileAdminSummary = BotUserProfile & {
  userName: string;
  userEmail: string;
  userWhatsapp: string | null;
  instanceId: number | null;
  serverId: number | null;
  serverName: string | null;
  sessionStatus: BotInstanceStatus;
  hasActiveSession: boolean;
};

type BotUserProfileAdminRow = BotUserProfileRow & RowDataPacket & {
  user_name: string;
  user_email: string;
  user_whatsapp: string | null;
  instance_id: number | null;
  server_id: number | null;
  server_name: string | null;
  session_status: BotInstanceStatus | null;
};

const parseDate = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const mapProfileRow = (row: BotUserProfileRow): BotUserProfile => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  phone: row.phone,
  planId: row.plan_id,
  expiresAt: parseDate(row.expires_at),
  createdAt: parseDate(row.created_at)!,
  updatedAt: parseDate(row.updated_at)!,
});

let migrationDone = false;

export const ensureBotUserProfileTable = async () => {
  await ensureUserTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_user_profiles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(32) NULL,
      plan_id INT NULL,
      expires_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_bot_user_profiles_user (user_id),
      CONSTRAINT fk_bot_user_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
};

export const ensureBotInstanceProfileLink = async () => {
  await ensureBotInstanceTable();
  const db = getDb();
  const [existing] = await db.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM bot_instances LIKE 'profile_id'",
  );
  if (!Array.isArray(existing) || existing.length === 0) {
    await db.query("ALTER TABLE bot_instances ADD COLUMN profile_id INT NULL AFTER user_id;");
    await db.query(`
      ALTER TABLE bot_instances
      ADD CONSTRAINT fk_bot_instances_profile
      FOREIGN KEY (profile_id) REFERENCES bot_user_profiles(id) ON DELETE SET NULL;
    `).catch(() => {
      /* constraint may already exist */
    });
  }
};

export const migrateLegacyProfileInstances = async () => {
  if (migrationDone) return;
  await ensureBotUserProfileTable();
  await ensureBotInstanceProfileLink();
  const db = getDb();

  const [legacyRows] = await db.query<(BotInstanceRow & RowDataPacket)[]>(
    `
      SELECT *
      FROM bot_instances
      WHERE purpose = 'profile' AND (profile_id IS NULL OR profile_id = 0)
    `,
  );

  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  for (const row of rows) {
    const [insertResult] = await db.query<ResultSetHeader>(
      `
        INSERT INTO bot_user_profiles (user_id, name, phone, plan_id, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        row.user_id,
        row.name,
        row.phone,
        row.plan_id,
        row.expires_at,
        row.created_at,
        row.updated_at,
      ],
    );
    const profileId = Number(insertResult.insertId);
    await db.query(
      `
        UPDATE bot_instances
        SET profile_id = ?, purpose = 'session', updated_at = NOW()
        WHERE id = ?
      `,
      [profileId, row.id],
    );
  }

  migrationDone = true;
};

export const countUserProfiles = async (userId: number): Promise<number> => {
  await migrateLegacyProfileInstances();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM bot_user_profiles WHERE user_id = ?",
    [userId],
  );
  return Number(rows?.[0]?.total ?? 0);
};

export const listUserProfiles = async (userId: number): Promise<BotUserProfile[]> => {
  await migrateLegacyProfileInstances();
  const db = getDb();
  const [rows] = await db.query<(BotUserProfileRow & RowDataPacket)[]>(
    `
      SELECT *
      FROM bot_user_profiles
      WHERE user_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [userId],
  );
  return (Array.isArray(rows) ? rows : []).map(mapProfileRow);
};

export const listUserProfilesForAdmin = async (
  filters: { userId?: number; profileId?: number } = {},
): Promise<BotUserProfileAdminSummary[]> => {
  await migrateLegacyProfileInstances();
  const db = getDb();
  const conditions: string[] = [];
  const params: number[] = [];

  if (typeof filters.userId === "number" && filters.userId > 0) {
    conditions.push("p.user_id = ?");
    params.push(filters.userId);
  }
  if (typeof filters.profileId === "number" && filters.profileId > 0) {
    conditions.push("p.id = ?");
    params.push(filters.profileId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.query<BotUserProfileAdminRow[]>(
    `
      SELECT
        p.*,
        u.name AS user_name,
        u.email AS user_email,
        u.whatsapp_number AS user_whatsapp,
        bi.id AS instance_id,
        bi.server_id,
        bi.session_status,
        bs.name AS server_name
      FROM bot_user_profiles p
      INNER JOIN users u ON u.id = p.user_id
      LEFT JOIN bot_instances bi
        ON bi.profile_id = p.id
       AND COALESCE(bi.purpose, 'session') <> 'admin_system'
      LEFT JOIN bot_servers bs ON bs.id = bi.server_id
      ${where}
      ORDER BY p.created_at DESC, p.id DESC, bi.id DESC
    `,
    params,
  );

  const summaries: BotUserProfileAdminSummary[] = [];
  const seen = new Set<number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    summaries.push({
      ...mapProfileRow(row),
      userName: row.user_name,
      userEmail: row.user_email,
      userWhatsapp: row.user_whatsapp,
      instanceId:
        typeof row.instance_id === "number" && row.instance_id > 0 ? row.instance_id : null,
      serverId: typeof row.server_id === "number" && row.server_id > 0 ? row.server_id : null,
      serverName: row.server_name ?? null,
      sessionStatus: row.session_status ?? "desconectado",
      hasActiveSession:
        typeof row.instance_id === "number" && row.instance_id > 0,
    });
  }
  return summaries;
};

export const renewUserProfileForAdmin = async (
  profileId: number,
  payload: { expiresAt?: Date | string; extendDays?: number },
): Promise<BotUserProfileAdminSummary> => {
  if (!Number.isFinite(profileId) || profileId <= 0) {
    throw new Error("Perfil inválido.");
  }

  const current = (await listUserProfilesForAdmin({ profileId }))[0];
  if (!current) {
    throw new Error("Perfil não encontrado.");
  }

  let nextExpiry: Date;
  if (payload.extendDays !== undefined) {
    const days = Math.floor(Number(payload.extendDays));
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      throw new Error("Período de renovação inválido.");
    }
    const currentExpiry = current.expiresAt ? Date.parse(current.expiresAt) : Number.NaN;
    const base = Number.isFinite(currentExpiry)
      ? Math.max(Date.now(), currentExpiry)
      : Date.now();
    nextExpiry = new Date(base + days * 24 * 60 * 60 * 1000);
  } else {
    nextExpiry = new Date(payload.expiresAt ?? "");
    if (Number.isNaN(nextExpiry.getTime())) {
      throw new Error("Informe uma validade válida.");
    }
  }

  if (nextExpiry.getTime() <= Date.now()) {
    throw new Error("A nova validade precisa estar no futuro.");
  }

  await ensureBotUserProfileTable();
  await ensureBotInstanceProfileLink();
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `
        UPDATE bot_user_profiles
        SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [nextExpiry, profileId],
    );
    await connection.query(
      `
        UPDATE bot_instances
        SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE profile_id = ?
      `,
      [nextExpiry, profileId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const updated = (await listUserProfilesForAdmin({ profileId }))[0];
  if (!updated) {
    throw new Error("Não foi possível carregar o perfil renovado.");
  }
  return updated;
};

export const getUserProfileById = async (
  userId: number,
  profileId: number,
): Promise<BotUserProfile | null> => {
  await migrateLegacyProfileInstances();
  const db = getDb();
  const [rows] = await db.query<(BotUserProfileRow & RowDataPacket)[]>(
    "SELECT * FROM bot_user_profiles WHERE user_id = ? AND id = ? LIMIT 1",
    [userId, profileId],
  );
  return rows?.[0] ? mapProfileRow(rows[0]) : null;
};

export const createUserProfile = async (
  userId: number,
  payload: { name: string; phone?: string | null; planId?: number | null; expiresAt?: Date | null },
): Promise<BotUserProfile> => {
  await migrateLegacyProfileInstances();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_user_profiles (user_id, name, phone, plan_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      userId,
      payload.name.trim(),
      payload.phone?.trim() || null,
      payload.planId ?? null,
      payload.expiresAt ?? null,
    ],
  );
  const profile = await getUserProfileById(userId, Number(result.insertId));
  if (!profile) {
    throw new Error("Não foi possível carregar o perfil recém-criado.");
  }
  return profile;
};

export const deleteUserProfile = async (userId: number, profileId: number): Promise<void> => {
  await migrateLegacyProfileInstances();
  const db = getDb();
  await db.query("DELETE FROM bot_user_profiles WHERE user_id = ? AND id = ?", [userId, profileId]);
};

export const profileToInstanceStub = (profile: BotUserProfile): BotInstance => ({
  id: profile.id,
  userId: profile.userId,
  serverId: 0,
  serverName: "",
  serverBaseUrl: "",
  serverApiType: "",
  name: profile.name,
  phone: profile.phone ?? "",
  token: "",
  remoteId: null,
  webhookUrl: null,
  events: null,
  autoRead: false,
  pvEnabled: false,
  licenseSalesEnabled: false,
  purpose: "profile",
  sessionStatus: "desconectado" as BotInstanceStatus,
  desiredSessionState: "disconnected",
  lastStatusSync: null,
  expiresAt: profile.expiresAt,
  planId: profile.planId,
  profileId: profile.id,
  hasActiveSession: false,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
});
