import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";

import { ensurePartnerProgramTables, getDb } from "lib/db";
import { getPartnerAccess, ResellerProgramError } from "lib/reseller-program";

const money = (value: unknown, fallback = 29.9) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100_000) return fallback;
  return Math.round(parsed * 100) / 100;
};

const int = (value: unknown, fallback = 1) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : fallback;
};

export const defaultPlanCreditCost = (durationDays: number) => {
  if (durationDays <= 45) return 1;
  if (durationDays >= 300) return 10;
  return Math.max(1, Math.ceil(durationDays / 30));
};

export const getPartnerFinancialSettings = async (userId: number) => {
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT f.credit_unit_price, f.manual_payments_enabled, f.allow_child_manual_payments,
            f.manual_pix_key, f.manual_instructions, f.proxy_sales_mode,
            f.proxy_monthly_price, f.allow_customer_proxy, f.proxy_sales_instructions,
            m.commission_rate
       FROM users u
       LEFT JOIN partner_financial_settings f ON f.user_id = u.id
       LEFT JOIN admin_panel_members m ON m.user_id = u.id
      WHERE u.id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  return {
    userId,
    creditUnitPrice: money(row?.credit_unit_price, Number(process.env.RESELLER_CREDIT_UNIT_PRICE || 29.9)),
    manualPaymentsEnabled: Boolean(row?.manual_payments_enabled),
    allowChildManualPayments: Boolean(row?.allow_child_manual_payments),
    manualPixKey: row?.manual_pix_key ? String(row.manual_pix_key) : null,
    manualInstructions: row?.manual_instructions ? String(row.manual_instructions) : null,
    proxySalesMode: row?.proxy_sales_mode === "automatic" ? "automatic" : "manual",
    proxyMonthlyPrice: Math.max(0, Math.round(Number(row?.proxy_monthly_price ?? 0) * 100) / 100),
    allowCustomerProxy: row ? row.allow_customer_proxy !== 0 : true,
    proxySalesInstructions: row?.proxy_sales_instructions ? String(row.proxy_sales_instructions) : null,
    commissionRate: Math.max(0, Math.min(100, Number(row?.commission_rate ?? 100))),
  };
};

export const savePartnerFinancialSettings = async (payload: {
  actorUserId: number;
  targetUserId: number;
  creditUnitPrice: unknown;
  manualPaymentsEnabled: boolean;
  allowChildManualPayments?: boolean;
  manualPixKey?: string | null;
  manualInstructions?: string | null;
  proxySalesMode?: unknown;
  proxyMonthlyPrice?: unknown;
  allowCustomerProxy?: boolean;
  proxySalesInstructions?: string | null;
}) => {
  const actorAccess = await getPartnerAccess(payload.actorUserId);
  if (!actorAccess || !actorAccess.permissions.view_financial) throw new ResellerProgramError("Sem permissão financeira.", 403);
  const targetId = int(payload.targetUserId, 0);
  if (!targetId) throw new ResellerProgramError("Parceiro inválido.");
  if (actorAccess.role !== "owner" && targetId !== payload.actorUserId) {
    const [scope] = await getDb().query<RowDataPacket[]>(
      "SELECT user_id FROM admin_panel_members WHERE user_id = ? AND invited_by = ? LIMIT 1",
      [targetId, payload.actorUserId],
    );
    if (!scope.length) throw new ResellerProgramError("Este parceiro não pertence à sua equipe.", 403);
  }
  let manualEnabled = Boolean(payload.manualPaymentsEnabled);
  if (actorAccess.role !== "owner" && targetId !== payload.actorUserId && manualEnabled) {
    const own = await getPartnerFinancialSettings(payload.actorUserId);
    if (!own.allowChildManualPayments) throw new ResellerProgramError("O Admin não liberou pagamentos manuais para sua equipe.", 403);
  }
  const price = money(payload.creditUnitPrice);
  const pix = payload.manualPixKey?.trim().slice(0, 255) || null;
  const instructions = payload.manualInstructions?.trim().slice(0, 1000) || null;
  const proxySalesMode = payload.proxySalesMode === "automatic" ? "automatic" : "manual";
  const parsedProxyPrice = Number(payload.proxyMonthlyPrice ?? 0);
  const proxyMonthlyPrice = Number.isFinite(parsedProxyPrice) && parsedProxyPrice >= 0 && parsedProxyPrice <= 100_000
    ? Math.round(parsedProxyPrice * 100) / 100
    : 0;
  const proxySalesInstructions = payload.proxySalesInstructions?.trim().slice(0, 1000) || null;
  await ensurePartnerProgramTables();
  await getDb().query(
    `INSERT INTO partner_financial_settings
      (user_id, credit_unit_price, manual_payments_enabled, allow_child_manual_payments, manual_pix_key, manual_instructions,
       proxy_sales_mode, proxy_monthly_price, allow_customer_proxy, proxy_sales_instructions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE credit_unit_price = VALUES(credit_unit_price),
       manual_payments_enabled = VALUES(manual_payments_enabled),
       allow_child_manual_payments = VALUES(allow_child_manual_payments),
       manual_pix_key = VALUES(manual_pix_key), manual_instructions = VALUES(manual_instructions),
       proxy_sales_mode = VALUES(proxy_sales_mode), proxy_monthly_price = VALUES(proxy_monthly_price),
       allow_customer_proxy = VALUES(allow_customer_proxy), proxy_sales_instructions = VALUES(proxy_sales_instructions)`,
    [targetId, price, manualEnabled ? 1 : 0, payload.allowChildManualPayments ? 1 : 0, pix, instructions,
      proxySalesMode, proxyMonthlyPrice, payload.allowCustomerProxy === false ? 0 : 1, proxySalesInstructions],
  );
  return getPartnerFinancialSettings(targetId);
};

export const getPartnerPlanCreditCosts = async (ownerUserId: number) => {
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT p.id AS plan_id, p.name, p.price, p.duration_days, p.is_active,
            COALESCE(c.credit_cost, CASE WHEN p.duration_days <= 45 THEN 1 WHEN p.duration_days >= 300 THEN 10 ELSE CEIL(p.duration_days / 30) END) AS credit_cost
       FROM subscription_plans p
       LEFT JOIN partner_plan_credit_costs c ON c.plan_id = p.id AND c.owner_user_id = ?
      ORDER BY p.duration_days, p.price`,
    [ownerUserId],
  );
  return rows.map((row) => ({
    planId: Number(row.plan_id), name: String(row.name), price: Number(row.price),
    durationDays: Number(row.duration_days), active: Boolean(row.is_active), creditCost: int(row.credit_cost),
  }));
};

export const savePartnerPlanCreditCosts = async (actorUserId: number, ownerUserId: number, costs: unknown) => {
  const access = await getPartnerAccess(actorUserId);
  if (!access || !access.permissions.view_financial) throw new ResellerProgramError("Sem permissão financeira.", 403);
  if (access.role !== "owner" && ownerUserId !== actorUserId) throw new ResellerProgramError("Você só pode definir os custos dos seus clientes.", 403);
  if (!Array.isArray(costs)) throw new ResellerProgramError("Custos dos planos inválidos.");
  await ensurePartnerProgramTables();
  for (const raw of costs) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const planId = int(item.planId, 0);
    if (!planId) continue;
    await getDb().query(
      `INSERT INTO partner_plan_credit_costs (owner_user_id, plan_id, credit_cost) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE credit_cost = VALUES(credit_cost)`,
      [ownerUserId, planId, int(item.creditCost)],
    );
  }
  return getPartnerPlanCreditCosts(ownerUserId);
};

export const getPlanCreditCost = async (ownerUserId: number, planId: number) => {
  const costs = await getPartnerPlanCreditCosts(ownerUserId);
  const found = costs.find((item) => item.planId === planId);
  if (!found) throw new ResellerProgramError("Plano não encontrado.", 404);
  return found.creditCost;
};

const parentForBuyer = async (buyerUserId: number) => {
  const [rows] = await getDb().query<RowDataPacket[]>("SELECT invited_by FROM admin_panel_members WHERE user_id = ? LIMIT 1", [buyerUserId]);
  return rows[0]?.invited_by == null ? null : Number(rows[0].invited_by);
};

export const createManualPartnerPayment = async (payload: {
  buyerUserId: number; credits: unknown; proof: File; note?: string | null;
}) => {
  const buyerAccess = await getPartnerAccess(payload.buyerUserId);
  if (!buyerAccess || !["master", "reseller"].includes(buyerAccess.role)) throw new ResellerProgramError("Conta sem acesso à compra de créditos.", 403);
  const settings = await getPartnerFinancialSettings(payload.buyerUserId);
  if (!settings.manualPaymentsEnabled) throw new ResellerProgramError("Pagamento manual não está liberado para esta conta.", 403);
  if (!payload.proof || payload.proof.size <= 0 || payload.proof.size > 12 * 1024 * 1024) throw new ResellerProgramError("Envie um comprovante de até 12 MB.");
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(payload.proof.type)) throw new ResellerProgramError("Use comprovante JPG, PNG, WEBP ou PDF.");
  const credits = int(payload.credits, 0);
  if (!credits) throw new ResellerProgramError("Quantidade de créditos inválida.");
  const approverUserId = await parentForBuyer(payload.buyerUserId);
  const publicId = `pmr_${randomUUID().replace(/-/g, "")}`;
  const extension = payload.proof.type === "application/pdf" ? "pdf" : payload.proof.type.split("/")[1].replace("jpeg", "jpg");
  const directory = path.join(process.cwd(), "public", "uploads", "partner-payments");
  await mkdir(directory, { recursive: true });
  const fileName = `${publicId}.${extension}`;
  await writeFile(path.join(directory, fileName), Buffer.from(await payload.proof.arrayBuffer()));
  const total = Math.round(settings.creditUnitPrice * credits * 100) / 100;
  await getDb().query(
    `INSERT INTO partner_manual_payment_requests
      (public_id, buyer_user_id, approver_user_id, credit_count, unit_price, total_amount, proof_path, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [publicId, payload.buyerUserId, approverUserId, credits, settings.creditUnitPrice, total, `/uploads/partner-payments/${fileName}`, payload.note?.trim().slice(0, 500) || null],
  );
  return { publicId, credits, totalAmount: total, status: "pending" };
};

export const listManualPartnerPayments = async (actorUserId: number) => {
  const access = await getPartnerAccess(actorUserId);
  if (!access || !access.permissions.view_financial) throw new ResellerProgramError("Sem permissão financeira.", 403);
  const owner = access.role === "owner";
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT r.*, u.name AS buyer_name, u.email AS buyer_email
       FROM partner_manual_payment_requests r JOIN users u ON u.id = r.buyer_user_id
      WHERE ${owner ? "1 = 1" : "(r.buyer_user_id = ? OR r.approver_user_id = ?)"}
      ORDER BY r.created_at DESC LIMIT 200`,
    owner ? [] : [actorUserId, actorUserId],
  );
  return rows.map((row) => ({
    publicId: String(row.public_id), buyerUserId: Number(row.buyer_user_id), buyerName: String(row.buyer_name), buyerEmail: String(row.buyer_email),
    credits: Number(row.credit_count), unitPrice: Number(row.unit_price), totalAmount: Number(row.total_amount), proofUrl: String(row.proof_path),
    note: row.note ? String(row.note) : null, status: String(row.status), reviewNote: row.review_note ? String(row.review_note) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
};

export const reviewManualPartnerPayment = async (actorUserId: number, publicId: string, decision: "approved" | "rejected", note?: string | null) => {
  const access = await getPartnerAccess(actorUserId);
  if (!access || !access.permissions.view_financial) throw new ResellerProgramError("Sem permissão financeira.", 403);
  await ensurePartnerProgramTables();
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM partner_manual_payment_requests WHERE public_id = ? FOR UPDATE", [publicId]);
    const order = rows[0];
    if (!order) throw new ResellerProgramError("Solicitação não encontrada.", 404);
    if (String(order.status) !== "pending") throw new ResellerProgramError("Esta solicitação já foi analisada.", 409);
    if (access.role !== "owner" && Number(order.approver_user_id) !== actorUserId) throw new ResellerProgramError("Esta solicitação não pertence à sua equipe.", 403);
    if (decision === "approved") {
      await connection.query("INSERT INTO reseller_wallets (reseller_user_id) VALUES (?) ON DUPLICATE KEY UPDATE reseller_user_id = reseller_user_id", [order.buyer_user_id]);
      const [wallets] = await connection.query<RowDataPacket[]>("SELECT id FROM reseller_wallets WHERE reseller_user_id = ? FOR UPDATE", [order.buyer_user_id]);
      await connection.query("UPDATE reseller_wallets SET credit_balance = credit_balance + ? WHERE id = ?", [order.credit_count, wallets[0].id]);
      await connection.query(
        `INSERT INTO reseller_credit_ledger (wallet_id, entry_type, credits, idempotency_key, reference_id, created_by, metadata)
         VALUES (?, 'manual_purchase', ?, ?, ?, ?, ?)`,
        [wallets[0].id, order.credit_count, `manual:${publicId}`, publicId, actorUserId, JSON.stringify({ amount: Number(order.total_amount) })],
      );
    }
    await connection.query("UPDATE partner_manual_payment_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE id = ?", [decision, actorUserId, note?.trim().slice(0, 500) || null, order.id]);
    await connection.commit();
    return { publicId, status: decision };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
};
