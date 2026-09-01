import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import {
  ensurePartnerProgramTables,
  ensureUserTable,
  getDb,
} from "lib/db";
import { getSubscriptionPlanById, setUserPlanSubscription } from "lib/plans";

export type PartnerRole = "owner" | "master" | "reseller" | "support";
export type PartnerStatus = "active" | "suspended";
export type PartnerPermission =
  | "manage_partners"
  | "grant_credits"
  | "manage_customers"
  | "activate_customers"
  | "view_financial"
  | "support_users";

export type PartnerAccess = {
  role: PartnerRole;
  permissions: Record<PartnerPermission, boolean>;
};

const ROLE_PERMISSIONS: Record<PartnerRole, PartnerPermission[]> = {
  owner: ["manage_partners", "grant_credits", "manage_customers", "activate_customers", "view_financial", "support_users"],
  master: ["manage_partners", "grant_credits", "manage_customers", "activate_customers", "view_financial", "support_users"],
  reseller: ["manage_customers", "activate_customers", "view_financial"],
  support: ["support_users"],
};

export class ResellerProgramError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ResellerProgramError";
    this.status = status;
  }
}

const normalizeRole = (value: unknown): Exclude<PartnerRole, "owner"> => {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "manager" || role === "master") return "master";
  if (role === "reseller" || role === "support") return role;
  return "reseller";
};

const parsePositiveInt = (value: unknown, label: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ResellerProgramError(`${label} inválido.`);
  }
  return Math.floor(parsed);
};

const json = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return null;
  try { return JSON.stringify(value); } catch { return null; }
};

const parsePermissions = (value: unknown): Record<string, boolean> => {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { source = null; }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>).map(([key, enabled]) => [key, enabled === true]),
  );
};

export const getPartnerAccess = async (userId: number): Promise<PartnerAccess | null> => {
  await ensurePartnerProgramTables();
  const db = getDb();
  const [users] = await db.query<RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!users.length) return null;
  if (String(users[0].role).toLowerCase() === "admin") {
    return { role: "owner", permissions: Object.fromEntries(ROLE_PERMISSIONS.owner.map((key) => [key, true])) as Record<PartnerPermission, boolean> };
  }
  const [members] = await db.query<RowDataPacket[]>(
    "SELECT role, status, permissions FROM admin_panel_members WHERE user_id = ? LIMIT 1",
    [userId],
  );
  if (!members.length || members[0].status !== "active") return null;
  const role = normalizeRole(members[0].role);
  const overrides = parsePermissions(members[0].permissions);
  const permissions = Object.fromEntries(
    (Object.keys(ROLE_PERMISSIONS) as PartnerRole[])
      .flatMap((entry) => ROLE_PERMISSIONS[entry])
      .filter((entry, index, all) => all.indexOf(entry) === index)
      .map((key) => [key, Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] === true : ROLE_PERMISSIONS[role].includes(key)]),
  ) as Record<PartnerPermission, boolean>;
  return { role, permissions };
};

export const getPartnerRole = async (userId: number): Promise<PartnerRole | null> => {
  return (await getPartnerAccess(userId))?.role ?? null;
};

/**
 * Returns only memberships that can actually open the partner panel. Keeping
 * this decision in one place prevents redirect loops when a member has been
 * suspended or all of their permissions have been disabled.
 */
export const getPartnerPanelAccess = async (userId: number) => {
  const access = await getPartnerAccess(userId);
  return access && Object.values(access.permissions).some(Boolean)
    ? access
    : null;
};

export const requirePartnerRole = async (
  userId: number,
  allowed: PartnerRole[],
): Promise<PartnerRole> => {
  const role = await getPartnerRole(userId);
  if (!role || !allowed.includes(role)) {
    throw new ResellerProgramError("Você não possui permissão para esta ação.", 403);
  }
  return role;
};

export const requirePartnerPermission = async (
  userId: number,
  permission: PartnerPermission,
) => {
  const access = await getPartnerAccess(userId);
  if (!access?.permissions[permission]) {
    throw new ResellerProgramError("Você não possui permissão para esta ação.", 403);
  }
  return access;
};

export const writePartnerAudit = async (payload: {
  actorUserId: number;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}) => {
  await ensurePartnerProgramTables();
  await getDb().query(
    `INSERT INTO partner_audit_logs
      (actor_user_id, action, target_type, target_id, before_data, after_data, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.actorUserId,
      payload.action.slice(0, 80),
      payload.targetType?.slice(0, 40) ?? null,
      payload.targetId == null ? null : String(payload.targetId).slice(0, 128),
      json(payload.before),
      json(payload.after),
      payload.ipAddress?.slice(0, 64) ?? null,
    ],
  );
};

export const listPartnerMembers = async (
  actorUserId?: number,
  knownAccess?: PartnerAccess | null,
) => {
  await ensurePartnerProgramTables();
  const actorAccess = actorUserId
    ? (knownAccess ?? (await getPartnerAccess(actorUserId)))
    : null;
  const scopedToMaster = actorUserId && actorAccess?.role !== "owner";
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT m.user_id AS user_id, m.role, m.status, m.permissions,
            m.commission_rate AS commission_rate, m.created_at AS created_at,
            m.invited_by AS parent_user_id,
            u.name, u.email, u.whatsapp_number AS whatsapp_number,
            COALESCE(w.credit_balance, 0) AS credit_balance,
            COALESCE(w.commission_balance, 0) AS commission_balance
       FROM admin_panel_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN reseller_wallets w ON w.reseller_user_id = m.user_id
      ${scopedToMaster ? "WHERE m.invited_by = ?" : ""}
      ORDER BY m.created_at DESC`,
    scopedToMaster ? [actorUserId] : [],
  );
  return rows.map((row) => ({
    userId: Number(row.user_id), name: String(row.name ?? ""), email: String(row.email ?? ""),
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    role: normalizeRole(row.role), status: String(row.status) as PartnerStatus,
    permissions: (() => {
      const role = normalizeRole(row.role);
      const overrides = parsePermissions(row.permissions);
      return Object.fromEntries(
        (Object.keys(ROLE_PERMISSIONS) as PartnerRole[])
          .flatMap((entry) => ROLE_PERMISSIONS[entry])
          .filter((entry, index, all) => all.indexOf(entry) === index)
          .map((key) => [
            key,
            Object.prototype.hasOwnProperty.call(overrides, key)
              ? overrides[key] === true
              : ROLE_PERMISSIONS[role].includes(key),
          ]),
      );
    })(),
    creditBalance: Number(row.credit_balance ?? 0), commissionBalance: Number(row.commission_balance ?? 0),
    commissionRate: Number(row.commission_rate ?? 20),
    parentUserId: row.parent_user_id == null ? null : Number(row.parent_user_id),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
};

const requirePartnerTargetScope = async (
  actorUserId: number,
  targetUserId: number | null,
  requestedRole: Exclude<PartnerRole, "owner">,
) => {
  const access = await requirePartnerPermission(actorUserId, "manage_partners");
  if (access.role === "owner") return access;
  if (access.role !== "master") {
    throw new ResellerProgramError("Somente o Admin geral ou um Master pode gerenciar parceiros.", 403);
  }
  if (requestedRole === "master") {
    throw new ResellerProgramError("Somente o Admin geral pode criar ou promover usuários Master.", 403);
  }
  if (targetUserId) {
    const [rows] = await getDb().query<RowDataPacket[]>(
      "SELECT invited_by FROM admin_panel_members WHERE user_id = ? LIMIT 1",
      [targetUserId],
    );
    if (rows.length && Number(rows[0].invited_by) !== actorUserId) {
      throw new ResellerProgramError("Este parceiro não pertence à sua equipe.", 403);
    }
  }
  return access;
};

export const upsertPartnerMember = async (payload: {
  actorUserId: number;
  userId: number;
  role: unknown;
  permissions?: Record<string, unknown> | null;
  status?: PartnerStatus;
  commissionRate?: number;
  name?: string;
  email?: string;
  whatsappNumber?: string | null;
  password?: string | null;
}) => {
  const userId = parsePositiveInt(payload.userId, "Usuário");
  const role = normalizeRole(payload.role);
  await requirePartnerTargetScope(payload.actorUserId, userId, role);
  await ensurePartnerProgramTables();
  const db = getDb();
  const [userRows] = await db.query<RowDataPacket[]>("SELECT id, role FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!userRows.length) throw new ResellerProgramError("Usuário não encontrado.", 404);
  if (String(userRows[0].role).toLowerCase() === "admin") {
    throw new ResellerProgramError("Uma conta admin não pode ser vinculada como revendedora.");
  }
  const status = payload.status === "suspended" ? "suspended" : "active";
  const commissionRate = Math.min(100, Math.max(0, Number(payload.commissionRate ?? 20)));
  const name = payload.name == null ? null : payload.name.trim();
  const email = payload.email == null ? null : payload.email.trim().toLowerCase();
  const rawWhatsapp = payload.whatsappNumber == null ? null : String(payload.whatsappNumber).trim();
  const whatsappDigits = rawWhatsapp?.replace(/[^0-9]/g, "") ?? "";
  const password = payload.password?.trim() || null;
  if (name != null && name.length < 2) throw new ResellerProgramError("Informe o nome completo do parceiro.");
  if (email != null && (!email.includes("@") || email.startsWith("@") || email.endsWith("@"))) {
    throw new ResellerProgramError("Informe um e-mail válido.");
  }
  if (rawWhatsapp && (whatsappDigits.length < 10 || whatsappDigits.length > 15)) {
    throw new ResellerProgramError("Informe um WhatsApp válido com DDI e DDD.");
  }
  if (password != null && password.length < 6) {
    throw new ResellerProgramError("A nova senha deve ter pelo menos 6 caracteres.");
  }
  if (email != null) {
    const [conflicts] = await db.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1",
      [email, userId],
    );
    if (conflicts.length) throw new ResellerProgramError("Este e-mail já está cadastrado.", 409);
  }
  const userFields: string[] = [];
  const userValues: unknown[] = [];
  if (name != null) { userFields.push("name = ?"); userValues.push(name); }
  if (email != null) { userFields.push("email = ?"); userValues.push(email); }
  if (payload.whatsappNumber !== undefined) {
    userFields.push("whatsapp_number = ?");
    userValues.push(whatsappDigits ? `+${whatsappDigits}` : null);
  }
  if (password != null) {
    userFields.push("password = ?");
    userValues.push(await bcrypt.hash(password, 10));
  }
  if (userFields.length) {
    await db.query(`UPDATE users SET ${userFields.join(", ")} WHERE id = ?`, [...userValues, userId]);
  }
  await db.query(
    `INSERT INTO admin_panel_members (user_id, role, permissions, commission_rate, status, invited_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), permissions = VALUES(permissions), commission_rate = VALUES(commission_rate), status = VALUES(status)`,
    [userId, role, json(payload.permissions), commissionRate, status, payload.actorUserId],
  );
  await db.query(
    `INSERT INTO reseller_wallets (reseller_user_id) VALUES (?) ON DUPLICATE KEY UPDATE reseller_user_id = reseller_user_id`,
    [userId],
  );
  await writePartnerAudit({ actorUserId: payload.actorUserId, action: "partner.member.upsert", targetType: "user", targetId: userId, after: { role, status, commissionRate } });
  return (await listPartnerMembers(payload.actorUserId)).find((entry) => entry.userId === userId) ?? null;
};

export const removePartnerMember = async (actorUserId: number, targetUserId: number) => {
  const targetId = parsePositiveInt(targetUserId, "Revendedor");
  await requirePartnerTargetScope(actorUserId, targetId, "reseller");
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT role, invited_by FROM admin_panel_members WHERE user_id = ? LIMIT 1",
    [targetId],
  );
  if (!rows.length || (await getPartnerAccess(actorUserId))?.role === "master" && Number(rows[0].invited_by) !== actorUserId) {
    throw new ResellerProgramError("Este revendedor não pertence à sua equipe.", 403);
  }
  await db.query("DELETE FROM admin_panel_members WHERE user_id = ?", [targetId]);
  await writePartnerAudit({ actorUserId, action: "partner.member.remove", targetType: "user", targetId });
  return { userId: targetId, removed: true };
};

export const createPartnerMember = async (payload: {
  actorUserId: number;
  name: string;
  email: string;
  password: string;
  whatsappNumber?: string | null;
  role: unknown;
  permissions?: Record<string, unknown> | null;
  status?: PartnerStatus;
  commissionRate?: number;
  initialCredits?: number;
}) => {
  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const password = String(payload.password ?? "");
  if (name.length < 2) throw new ResellerProgramError("Informe o nome completo do parceiro.");
  if (!email || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    throw new ResellerProgramError("Informe um e-mail válido.");
  }
  if (password.length < 6) {
    throw new ResellerProgramError("A senha inicial deve ter pelo menos 6 caracteres.");
  }
  const rawWhatsapp = String(payload.whatsappNumber ?? "").trim();
  const whatsappDigits = rawWhatsapp.replace(/[^0-9]/g, "");
  if (rawWhatsapp && (whatsappDigits.length < 10 || whatsappDigits.length > 15)) {
    throw new ResellerProgramError("Informe um WhatsApp válido com DDI e DDD.");
  }
  const whatsappNumber = whatsappDigits ? `+${whatsappDigits}` : null;
  const role = normalizeRole(payload.role);
  const actorAccess = await requirePartnerTargetScope(payload.actorUserId, null, role);
  const status = payload.status === "suspended" ? "suspended" : "active";
  const rawCommissionRate = Number(payload.commissionRate ?? 20);
  if (!Number.isFinite(rawCommissionRate) || rawCommissionRate < 0 || rawCommissionRate > 100) {
    throw new ResellerProgramError("Informe uma comissão entre 0 e 100%.");
  }
  const commissionRate = Math.round(rawCommissionRate * 100) / 100;
  const initialCredits = Math.max(0, Math.floor(Number(payload.initialCredits ?? 0)));
  if (!Number.isFinite(initialCredits) || initialCredits > 100_000) {
    throw new ResellerProgramError("Informe uma quantidade de créditos entre 0 e 100.000.");
  }

  await ensurePartnerProgramTables();
  const db = getDb();
  const connection = await db.getConnection();
  let userId = 0;
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT id, role FROM users WHERE LOWER(email) = ? LIMIT 1 FOR UPDATE",
      [email],
    );
    if (existing.length) {
      userId = Number(existing[0].id);
      if (String(existing[0].role).toLowerCase() === "admin") {
        throw new ResellerProgramError("Uma conta admin não pode ser vinculada como parceira.", 409);
      }
      const [members] = await connection.query<RowDataPacket[]>(
        "SELECT user_id FROM admin_panel_members WHERE user_id = ? LIMIT 1 FOR UPDATE",
        [userId],
      );
      if (members.length) {
        throw new ResellerProgramError("Este e-mail já possui acesso ao painel de parceiros.", 409);
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await connection.query(
        `UPDATE users
            SET name = ?, password = ?, is_active = 1, whatsapp_number = ?,
                needs_credentials_completion = 0, password_missing = 0
          WHERE id = ?`,
        [name, passwordHash, whatsappNumber, userId],
      );
    } else {
      const passwordHash = await bcrypt.hash(password, 10);
      const [created] = await connection.query<ResultSetHeader>(
        `INSERT INTO users
          (name, email, password, role, is_active, balance, whatsapp_number, needs_credentials_completion, password_missing)
         VALUES (?, ?, ?, 'user', 1, 0, ?, 0, 0)`,
        [name, email, passwordHash, whatsappNumber],
      );
      userId = Number(created.insertId);
    }
    await connection.query(
      `INSERT INTO admin_panel_members
        (user_id, role, permissions, commission_rate, status, invited_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        role,
        json(payload.permissions),
        commissionRate,
        status,
        payload.actorUserId,
      ],
    );
    if (actorAccess.role === "master" && initialCredits > 0) {
      const [masterWallets] = await connection.query<RowDataPacket[]>(
        "SELECT id, credit_balance, reserved_credits FROM reseller_wallets WHERE reseller_user_id = ? FOR UPDATE",
        [payload.actorUserId],
      );
      const available = masterWallets.length
        ? Number(masterWallets[0].credit_balance) - Number(masterWallets[0].reserved_credits)
        : 0;
      if (available < initialCredits) {
        throw new ResellerProgramError("Seu saldo de créditos é insuficiente para esta distribuição.", 402);
      }
      await connection.query(
        "UPDATE reseller_wallets SET credit_balance = credit_balance - ? WHERE id = ?",
        [initialCredits, Number(masterWallets[0].id)],
      );
    }
    await connection.query(
      `INSERT INTO reseller_wallets (reseller_user_id, credit_balance)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE credit_balance = credit_balance + VALUES(credit_balance)`,
      [userId, initialCredits],
    );
    const [walletRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM reseller_wallets WHERE reseller_user_id = ? LIMIT 1",
      [userId],
    );
    const walletId = Number(walletRows[0]?.id ?? 0);
    if (!walletId) throw new ResellerProgramError("Não foi possível preparar a carteira do parceiro.", 500);
    if (initialCredits > 0) {
      await connection.query(
        `INSERT INTO reseller_credit_ledger
          (wallet_id, entry_type, credits, reference_id, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [
          walletId,
          actorAccess.role === "owner" ? "admin_grant" : "master_transfer_in",
          initialCredits,
          `partner-create:${userId}`,
          payload.actorUserId,
        ],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await writePartnerAudit({
    actorUserId: payload.actorUserId,
    action: "partner.member.create",
    targetType: "user",
    targetId: userId,
    after: { role, status, commissionRate, initialCredits, email },
  });
  return (await listPartnerMembers(payload.actorUserId)).find((entry) => entry.userId === userId) ?? null;
};

export const grantPartnerCredits = async (payload: {
  actorUserId: number;
  resellerUserId: number;
  credits: number;
  idempotencyKey?: string | null;
  referenceId?: string | null;
}) => {
  const actorAccess = await requirePartnerPermission(payload.actorUserId, "grant_credits");
  const resellerUserId = parsePositiveInt(payload.resellerUserId, "Revendedor");
  const credits = parsePositiveInt(payload.credits, "Quantidade de créditos");
  if (credits > 100_000) throw new ResellerProgramError("A quantidade máxima por operação é 100.000 créditos.");
  await ensurePartnerProgramTables();
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [memberRows] = await connection.query<RowDataPacket[]>(
      "SELECT role, status, invited_by FROM admin_panel_members WHERE user_id = ? FOR UPDATE", [resellerUserId],
    );
    if (!memberRows.length || memberRows[0].status !== "active" || !["reseller", "master"].includes(normalizeRole(memberRows[0].role))) {
      throw new ResellerProgramError("O usuário informado não é um parceiro ativo.");
    }
    const key = payload.idempotencyKey?.trim() || null;
    await connection.query("INSERT INTO reseller_wallets (reseller_user_id) VALUES (?) ON DUPLICATE KEY UPDATE reseller_user_id = reseller_user_id", [resellerUserId]);
    const [walletRows] = await connection.query<RowDataPacket[]>("SELECT id FROM reseller_wallets WHERE reseller_user_id = ? FOR UPDATE", [resellerUserId]);
    const walletId = Number(walletRows[0].id);
    if (key) {
      const [existing] = await connection.query<RowDataPacket[]>("SELECT id FROM reseller_credit_ledger WHERE wallet_id = ? AND idempotency_key = ? LIMIT 1", [walletId, key]);
      if (existing.length) {
        await connection.commit();
        return getPartnerWallet(resellerUserId);
      }
    }
    if (actorAccess.role === "master") {
      if (normalizeRole(memberRows[0].role) !== "reseller" || Number(memberRows[0].invited_by) !== payload.actorUserId) {
        throw new ResellerProgramError("Um Master só pode distribuir créditos aos próprios revendedores.", 403);
      }
      const [masterWallets] = await connection.query<RowDataPacket[]>(
        "SELECT id, credit_balance, reserved_credits FROM reseller_wallets WHERE reseller_user_id = ? FOR UPDATE",
        [payload.actorUserId],
      );
      const available = masterWallets.length
        ? Number(masterWallets[0].credit_balance) - Number(masterWallets[0].reserved_credits)
        : 0;
      if (available < credits) {
        throw new ResellerProgramError("Seu saldo de créditos é insuficiente para esta distribuição.", 402);
      }
      await connection.query("UPDATE reseller_wallets SET credit_balance = credit_balance - ? WHERE id = ?", [credits, Number(masterWallets[0].id)]);
      await connection.query(
        `INSERT INTO reseller_credit_ledger (wallet_id, entry_type, credits, idempotency_key, reference_id, created_by)
         VALUES (?, 'master_transfer_out', ?, ?, ?, ?)`,
        [Number(masterWallets[0].id), -credits, payload.idempotencyKey?.trim() || null, String(resellerUserId), payload.actorUserId],
      );
    }
    await connection.query("UPDATE reseller_wallets SET credit_balance = credit_balance + ? WHERE id = ?", [credits, walletId]);
    await connection.query(
      `INSERT INTO reseller_credit_ledger (wallet_id, entry_type, credits, idempotency_key, reference_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [walletId, actorAccess.role === "master" ? "master_transfer_in" : "admin_grant", credits, key, payload.referenceId?.trim() || null, payload.actorUserId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  await writePartnerAudit({ actorUserId: payload.actorUserId, action: "partner.credits.grant", targetType: "user", targetId: resellerUserId, after: { credits } });
  return getPartnerWallet(resellerUserId);
};

export const getPartnerWallet = async (userId: number) => {
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT COALESCE(credit_balance, 0) AS credit_balance,
            COALESCE(reserved_credits, 0) AS reserved_credits,
            COALESCE(commission_balance, 0) AS commission_balance
       FROM reseller_wallets WHERE reseller_user_id = ? LIMIT 1`, [userId],
  );
  const row = rows[0];
  return {
    resellerUserId: userId,
    creditBalance: Number(row?.credit_balance ?? 0),
    reservedCredits: Number(row?.reserved_credits ?? 0),
    commissionBalance: Number(row?.commission_balance ?? 0),
    availableCredits: Math.max(0, Number(row?.credit_balance ?? 0) - Number(row?.reserved_credits ?? 0)),
  };
};

export const listPartnerCustomers = async (resellerUserId: number) => {
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT l.customer_user_id AS user_id, l.plan_id AS plan_id, l.status, l.source,
            l.created_at AS created_at, u.name, u.email, u.whatsapp_number AS whatsapp_number,
            s.status AS subscription_status, s.current_period_end AS period_end,
            p.name AS plan_name
       FROM reseller_customer_links l
       JOIN users u ON u.id = l.customer_user_id
       LEFT JOIN user_plan_subscriptions s ON s.user_id = l.customer_user_id
       LEFT JOIN subscription_plans p ON p.id = COALESCE(l.plan_id, s.plan_id)
      WHERE l.reseller_user_id = ? AND l.status <> 'ended'
      ORDER BY l.created_at DESC`, [resellerUserId],
  );
  return rows.map((row) => ({
    userId: Number(row.user_id), name: String(row.name ?? ""), email: String(row.email ?? ""),
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    planId: row.plan_id == null ? null : Number(row.plan_id), planName: row.plan_name ? String(row.plan_name) : null,
    status: String(row.status), subscriptionStatus: row.subscription_status ? String(row.subscription_status) : null,
    periodEnd: row.period_end instanceof Date ? row.period_end.toISOString() : row.period_end ? String(row.period_end) : null,
    source: String(row.source ?? "reseller"), createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
};

export const createPartnerCustomer = async (payload: {
  resellerUserId: number;
  name: string;
  email: string;
  password: string;
  whatsappNumber?: string | null;
  planId?: number | null;
}) => {
  await requirePartnerPermission(payload.resellerUserId, "manage_customers");
  const name = payload.name.trim();
  const email = payload.email.trim().toLowerCase();
  if (!name || !email || !email.includes("@")) throw new ResellerProgramError("Informe nome e e-mail válidos.");
  if (payload.password.length < 6) throw new ResellerProgramError("A senha deve ter pelo menos 6 caracteres.");
  const planId = payload.planId == null ? null : parsePositiveInt(payload.planId, "Plano");
  if (planId && !await getSubscriptionPlanById(planId)) throw new ResellerProgramError("Plano não encontrado.", 404);
  if (planId) {
    const { getPlanCreditCost } = await import("lib/partner-finance");
    const requiredCredits = await getPlanCreditCost(payload.resellerUserId, planId);
    const wallet = await getPartnerWallet(payload.resellerUserId);
    if (wallet.availableCredits < requiredCredits) {
      throw new ResellerProgramError(`Saldo insuficiente. Este plano exige ${requiredCredits} crédito(s).`, 402);
    }
  }
  await ensurePartnerProgramTables();
  const db = getDb();
  const [existing] = await db.query<RowDataPacket[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing.length) throw new ResellerProgramError("Este e-mail já está cadastrado.", 409);
  const hash = await bcrypt.hash(payload.password, 10);
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO users (name, email, password, role, is_active, balance, whatsapp_number, needs_credentials_completion, password_missing)
     VALUES (?, ?, ?, 'user', 1, 0, ?, 0, 0)`,
    [name, email, hash, payload.whatsappNumber?.trim() || null],
  );
  const customerId = Number(result.insertId);
  await db.query(
    `INSERT INTO reseller_customer_links (reseller_user_id, customer_user_id, plan_id) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE plan_id = VALUES(plan_id), status = 'active'`,
    [payload.resellerUserId, customerId, planId],
  );
  if (planId) {
    await activatePartnerCustomer({
      resellerUserId: payload.resellerUserId,
      customerUserId: customerId,
      planId,
      idempotencyKey: `customer-create:${customerId}:${planId}`,
    });
  }
  await writePartnerAudit({ actorUserId: payload.resellerUserId, action: "partner.customer.create", targetType: "user", targetId: customerId, after: { planId } });
  return {
    customerId,
    planId,
    customer: (await listPartnerCustomers(payload.resellerUserId)).find((entry) => entry.userId === customerId) ?? null,
  };
};

export const activatePartnerCustomer = async (payload: {
  resellerUserId: number;
  customerUserId: number;
  planId: number;
  idempotencyKey?: string | null;
}) => {
  await requirePartnerPermission(payload.resellerUserId, "activate_customers");
  const customerId = parsePositiveInt(payload.customerUserId, "Cliente");
  const planId = parsePositiveInt(payload.planId, "Plano");
  const plan = await getSubscriptionPlanById(planId);
  if (!plan || !plan.isActive) throw new ResellerProgramError("Plano não encontrado ou inativo.", 404);
  const { getPlanCreditCost } = await import("lib/partner-finance");
  const requiredCredits = await getPlanCreditCost(payload.resellerUserId, planId);
  await ensurePartnerProgramTables();
  const db = getDb();
  const connection = await db.getConnection();
  let walletId = 0;
  try {
    await connection.beginTransaction();
    const [links] = await connection.query<RowDataPacket[]>("SELECT id FROM reseller_customer_links WHERE reseller_user_id = ? AND customer_user_id = ? AND status <> 'ended' LIMIT 1 FOR UPDATE", [payload.resellerUserId, customerId]);
    if (!links.length) throw new ResellerProgramError("Cliente não pertence à sua carteira.", 403);
    const [wallets] = await connection.query<RowDataPacket[]>("SELECT id, credit_balance, reserved_credits FROM reseller_wallets WHERE reseller_user_id = ? FOR UPDATE", [payload.resellerUserId]);
    if (!wallets.length || Number(wallets[0].credit_balance) - Number(wallets[0].reserved_credits) < requiredCredits) throw new ResellerProgramError(`Saldo insuficiente. Este plano exige ${requiredCredits} crédito(s).`, 402);
    walletId = Number(wallets[0].id);
    const key = payload.idempotencyKey?.trim() || `activation:${customerId}:${planId}:${Date.now()}`;
    const [existing] = await connection.query<RowDataPacket[]>("SELECT id FROM reseller_credit_ledger WHERE wallet_id = ? AND idempotency_key = ? LIMIT 1", [walletId, key]);
    if (!existing.length) {
      await connection.query("UPDATE reseller_wallets SET credit_balance = credit_balance - ? WHERE id = ?", [requiredCredits, walletId]);
      await connection.query(`INSERT INTO reseller_credit_ledger (wallet_id, entry_type, credits, idempotency_key, reference_id, created_by, metadata) VALUES (?, 'activation', ?, ?, ?, ?, ?)`, [walletId, -requiredCredits, key, String(customerId), payload.resellerUserId, JSON.stringify({ planId, requiredCredits })]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  try {
    await setUserPlanSubscription(customerId, { planId, status: "active" });
  } catch (error) {
    const refundKey = `refund:${payload.idempotencyKey ?? `${customerId}:${planId}`}`;
    await db.query("UPDATE reseller_wallets SET credit_balance = credit_balance + ? WHERE id = ?", [requiredCredits, walletId]);
    await db.query(`INSERT INTO reseller_credit_ledger (wallet_id, entry_type, credits, idempotency_key, reference_id, created_by, metadata) VALUES (?, 'refund', ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`, [walletId, requiredCredits, refundKey, String(customerId), payload.resellerUserId, JSON.stringify({ planId, requiredCredits })]);
    throw error;
  }
  await db.query("UPDATE reseller_customer_links SET plan_id = ?, status = 'active' WHERE reseller_user_id = ? AND customer_user_id = ?", [planId, payload.resellerUserId, customerId]);
  await writePartnerAudit({ actorUserId: payload.resellerUserId, action: "partner.customer.activate", targetType: "user", targetId: customerId, after: { planId } });
  return { customerId, planId, creditsUsed: requiredCredits, wallet: await getPartnerWallet(payload.resellerUserId) };
};

export const updatePartnerCustomer = async (payload: {
  resellerUserId: number;
  customerUserId: number;
  name: string;
  email: string;
  whatsappNumber?: string | null;
}) => {
  await requirePartnerPermission(payload.resellerUserId, "manage_customers");
  const name = payload.name.trim();
  const email = payload.email.trim().toLowerCase();
  if (!name || !email || !email.includes("@")) {
    throw new ResellerProgramError("Informe nome e e-mail válidos.");
  }
  const db = getDb();
  const [link] = await db.query<RowDataPacket[]>(
    "SELECT id FROM reseller_customer_links WHERE reseller_user_id = ? AND customer_user_id = ? AND status <> 'ended' LIMIT 1",
    [payload.resellerUserId, payload.customerUserId],
  );
  if (!link.length) throw new ResellerProgramError("Cliente não pertence à sua carteira.", 403);
  const [conflict] = await db.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1",
    [email, payload.customerUserId],
  );
  if (conflict.length) throw new ResellerProgramError("Este e-mail já está cadastrado.", 409);
  await db.query(
    "UPDATE users SET name = ?, email = ?, whatsapp_number = ? WHERE id = ?",
    [name, email, payload.whatsappNumber?.trim() || null, payload.customerUserId],
  );
  await writePartnerAudit({
    actorUserId: payload.resellerUserId,
    action: "partner.customer.update",
    targetType: "user",
    targetId: payload.customerUserId,
    after: { name, email },
  });
  return (await listPartnerCustomers(payload.resellerUserId)).find(
    (entry) => entry.userId === payload.customerUserId,
  ) ?? null;
};
