import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { getAdminMercadoPagoCheckoutConfig } from "lib/admin-payments";
import { ensurePartnerProgramTables, getDb } from "lib/db";
import {
  createMercadoPagoCheckoutPreference,
  validateMercadoPagoAccessToken,
} from "lib/mercadopago";
import { getPartnerAccess, ResellerProgramError } from "lib/reseller-program";
import { getPartnerFinancialSettings } from "lib/partner-finance";
import { decryptWwPanelSecret, encryptWwPanelSecret } from "lib/wwpanel";

const MP_API = process.env.MERCADO_PAGO_API_URL?.trim() || "https://api.mercadopago.com";
const MP_AUTH = process.env.MERCADO_PAGO_AUTH_URL?.trim() || "https://auth.mercadopago.com.br/authorization";

type AccountRow = RowDataPacket & {
  user_id: number;
  status: string;
  provider_user_id: string | null;
  nickname: string | null;
  email: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: Date | string | null;
  scopes: string | null;
  last_error: string | null;
  connected_at: Date | string | null;
  updated_at: Date | string;
};

const appBaseUrl = () => {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.DEFAULT_APP_URL;
  const value = (raw || (process.env.NODE_ENV === "production" ? "https://botadmin.shop" : "http://localhost:4478")).trim();
  return (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/+$/, "");
};

const oauthConfig = async () => {
  const admin = await getAdminMercadoPagoCheckoutConfig();
  return {
    clientId: (process.env.MERCADOPAGO_CLIENT_ID || process.env.MP_CLIENT_ID || admin.marketplaceClientId || "").trim(),
    clientSecret: (process.env.MERCADOPAGO_CLIENT_SECRET || process.env.MP_CLIENT_SECRET || admin.marketplaceClientSecret || "").trim(),
    redirectUri: `${appBaseUrl()}/api/payments/mercadopago/oauth/callback`,
  };
};

const stateSecret = () => {
  const value = (process.env.MERCADOPAGO_OAUTH_STATE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!value) throw new Error("MERCADOPAGO_OAUTH_STATE_SECRET/JWT_SECRET não configurado.");
  return value;
};

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const signState = (payload: string) => b64url(createHmac("sha256", stateSecret()).update(payload).digest());

export const createPartnerMercadoPagoState = (userId: number) => {
  const payload = b64url(JSON.stringify({ userId, exp: Date.now() + 10 * 60_000, nonce: randomBytes(16).toString("hex") }));
  return `${payload}.${signState(payload)}`;
};

export const verifyPartnerMercadoPagoState = (state: string) => {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new ResellerProgramError("Autorização Mercado Pago inválida.", 400);
  const expected = signState(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ResellerProgramError("Autorização Mercado Pago inválida.", 400);
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: number; exp?: number };
  if (!Number.isFinite(parsed.userId) || Number(parsed.userId) <= 0 || !Number.isFinite(parsed.exp) || Number(parsed.exp) < Date.now()) {
    throw new ResellerProgramError("A autorização expirou. Inicie a conexão novamente.", 400);
  }
  return { userId: Number(parsed.userId) };
};

const iso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const getAccountRow = async (userId: number): Promise<AccountRow | null> => {
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<AccountRow[]>("SELECT * FROM partner_payment_accounts WHERE user_id = ? LIMIT 1", [userId]);
  return rows[0] ?? null;
};

const exchangeToken = async (params: Record<string, string>) => {
  const config = await oauthConfig();
  if (!config.clientId || !config.clientSecret) throw new ResellerProgramError("O aplicativo Marketplace do Mercado Pago ainda não foi configurado pelo administrador.", 503);
  const response = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(`Mercado Pago OAuth falhou (${response.status}): ${String(body.message ?? body.error ?? "resposta inválida")}`);
  }
  return body;
};

export const buildPartnerMercadoPagoAuthorizationUrl = async (userId: number) => {
  const access = await getPartnerAccess(userId);
  if (!access || !["owner", "master", "reseller"].includes(access.role)) throw new ResellerProgramError("Sua conta não pode configurar recebimentos.", 403);
  const config = await oauthConfig();
  if (!config.clientId || !config.clientSecret) throw new ResellerProgramError("O aplicativo Marketplace do Mercado Pago ainda não foi configurado pelo administrador.", 503);
  await ensurePartnerProgramTables();
  await getDb().query(
    `INSERT INTO partner_payment_accounts (user_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE
       status = CASE WHEN status = 'connected' THEN status ELSE 'pending' END,
       last_error = NULL`,
    [userId],
  );
  const url = new URL(MP_AUTH);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", createPartnerMercadoPagoState(userId));
  return url.toString();
};

export const completePartnerMercadoPagoOAuth = async (userId: number, code: string) => {
  const config = await oauthConfig();
  const token = await exchangeToken({ grant_type: "authorization_code", code: code.trim(), redirect_uri: config.redirectUri });
  const accessToken = String(token.access_token);
  const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
  const expiresIn = Math.max(60, Number(token.expires_in ?? 15_552_000));
  const account = await validateMercadoPagoAccessToken(accessToken);
  await ensurePartnerProgramTables();
  await getDb().query(
    `INSERT INTO partner_payment_accounts
      (user_id, status, provider_user_id, nickname, email, access_token_encrypted, refresh_token_encrypted,
       token_expires_at, scopes, last_error, connected_at)
     VALUES (?, 'connected', ?, ?, ?, ?, ?, ?, ?, NULL, NOW())
     ON DUPLICATE KEY UPDATE status = 'connected', provider_user_id = VALUES(provider_user_id), nickname = VALUES(nickname),
       email = VALUES(email), access_token_encrypted = VALUES(access_token_encrypted),
       refresh_token_encrypted = CASE
         WHEN VALUES(refresh_token_encrypted) = '' THEN refresh_token_encrypted
         ELSE VALUES(refresh_token_encrypted)
       END,
       token_expires_at = VALUES(token_expires_at), scopes = VALUES(scopes), last_error = NULL, connected_at = NOW()`,
    [
      userId,
      String(token.user_id ?? account.id ?? "") || null,
      account.nickname,
      account.email,
      encryptWwPanelSecret(accessToken),
      refreshToken ? encryptWwPanelSecret(refreshToken) : "",
      new Date(Date.now() + Math.floor(expiresIn) * 1000),
      String(token.scope ?? "") || null,
    ],
  );
  return getPartnerPaymentSnapshot(userId);
};

export const getPartnerMercadoPagoAccessToken = async (userId: number) => {
  const row = await getAccountRow(userId);
  if (!row || row.status !== "connected" || !row.access_token_encrypted) return null;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (!expiresAt || expiresAt > Date.now() + 5 * 60_000) return decryptWwPanelSecret(row.access_token_encrypted);
  if (!row.refresh_token_encrypted) return null;
  try {
    const refreshed = await exchangeToken({ grant_type: "refresh_token", refresh_token: decryptWwPanelSecret(row.refresh_token_encrypted) });
    const accessToken = String(refreshed.access_token);
    const refreshToken = typeof refreshed.refresh_token === "string" && refreshed.refresh_token ? refreshed.refresh_token : decryptWwPanelSecret(row.refresh_token_encrypted);
    const expiresIn = Math.max(60, Number(refreshed.expires_in ?? 15_552_000));
    await getDb().query(
      `UPDATE partner_payment_accounts SET access_token_encrypted = ?, refresh_token_encrypted = ?,
       token_expires_at = ?, status = 'connected', last_error = NULL WHERE user_id = ?`,
      [encryptWwPanelSecret(accessToken), encryptWwPanelSecret(refreshToken), new Date(Date.now() + Math.floor(expiresIn) * 1000), userId],
    );
    return accessToken;
  } catch (error) {
    await getDb().query("UPDATE partner_payment_accounts SET status = 'error', last_error = ? WHERE user_id = ?", [String(error).slice(0, 500), userId]);
    return null;
  }
};

const memberFinance = async (userId: number) => {
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<RowDataPacket[]>(
    "SELECT role, commission_rate, invited_by FROM admin_panel_members WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return rows[0] ? {
    role: String(rows[0].role),
    commissionRate: Math.max(0, Math.min(100, Number(rows[0].commission_rate ?? 20))),
    parentUserId: rows[0].invited_by == null ? null : Number(rows[0].invited_by),
  } : { role: "owner", commissionRate: 100, parentUserId: null };
};

export const getPartnerPaymentSnapshot = async (userId: number) => {
  const [access, row, finance, settings] = await Promise.all([getPartnerAccess(userId), getAccountRow(userId), memberFinance(userId), getPartnerFinancialSettings(userId)]);
  const oauth = await oauthConfig();
  return {
    enabled: Boolean(access && ["owner", "master", "reseller"].includes(access.role)),
    marketplaceConfigured: Boolean(oauth.clientId && oauth.clientSecret),
    provider: "mercadopago",
    status: row?.status ?? "disconnected",
    connected: row?.status === "connected",
    account: row ? { providerUserId: row.provider_user_id, nickname: row.nickname, email: row.email } : null,
    commissionRate: finance.commissionRate,
    platformFeeRate: Math.max(0, 100 - finance.commissionRate),
    creditUnitPrice: settings.creditUnitPrice,
    manualPaymentsEnabled: settings.manualPaymentsEnabled,
    allowChildManualPayments: settings.allowChildManualPayments,
    manualPixKey: settings.manualPixKey,
    manualInstructions: settings.manualInstructions,
    proxySalesMode: settings.proxySalesMode,
    proxyMonthlyPrice: settings.proxyMonthlyPrice,
    allowCustomerProxy: settings.allowCustomerProxy,
    proxySalesInstructions: settings.proxySalesInstructions,
    connectedAt: iso(row?.connected_at),
    updatedAt: iso(row?.updated_at),
    lastError: row?.last_error ?? null,
  };
};

export const disconnectPartnerMercadoPago = async (userId: number) => {
  await ensurePartnerProgramTables();
  await getDb().query(
    `UPDATE partner_payment_accounts SET status = 'disconnected', access_token_encrypted = NULL,
     refresh_token_encrypted = NULL, token_expires_at = NULL, last_error = NULL WHERE user_id = ?`,
    [userId],
  );
  return getPartnerPaymentSnapshot(userId);
};

export const resolvePartnerSplitForCustomer = async (customerUserId: number, amount: number) => {
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<RowDataPacket[]>(
    `SELECT l.reseller_user_id, m.invited_by
       FROM reseller_customer_links l
       JOIN admin_panel_members m ON m.user_id = l.reseller_user_id AND m.status = 'active'
      WHERE l.customer_user_id = ? AND l.status = 'active' ORDER BY l.updated_at DESC LIMIT 1`,
    [customerUserId],
  );
  if (!rows.length) return null;
  const candidates = [Number(rows[0].reseller_user_id), rows[0].invited_by == null ? null : Number(rows[0].invited_by)].filter((id): id is number => Boolean(id));
  for (const sellerUserId of candidates) {
    const token = await getPartnerMercadoPagoAccessToken(sellerUserId);
    if (!token) continue;
    const finance = await memberFinance(sellerUserId);
    const platformFee = Math.round(amount * Math.max(0, 100 - finance.commissionRate)) / 100;
    return { sellerUserId, accessToken: token, partnerRate: finance.commissionRate, platformFee, notificationUrl: webhookUrl(sellerUserId) };
  }
  throw new ResellerProgramError(
    "O parceiro responsável ainda não conectou o Mercado Pago. A cobrança foi bloqueada para evitar que a comissão seja perdida.",
    409,
  );
};

const webhookUrl = (sellerUserId?: number | null) => {
  const url = new URL(`${appBaseUrl()}/api/payments/mercadopago/webhook`);
  if (sellerUserId) url.searchParams.set("partner_seller_user_id", String(sellerUserId));
  return url.toString();
};

export const createPartnerCreditCheckout = async (buyerUserId: number, creditCountInput: number) => {
  const access = await getPartnerAccess(buyerUserId);
  if (!access || !access.permissions.view_financial || !["master", "reseller"].includes(access.role)) throw new ResellerProgramError("Sua conta não pode comprar créditos.", 403);
  const creditCount = Math.floor(Number(creditCountInput));
  if (!Number.isFinite(creditCount) || creditCount < 1 || creditCount > 10_000) throw new ResellerProgramError("Informe de 1 a 10.000 créditos.");
  const finance = await memberFinance(buyerUserId);
  const buyerSettings = await getPartnerFinancialSettings(buyerUserId);
  const unitPrice = buyerSettings.creditUnitPrice;
  const totalAmount = Math.round(unitPrice * creditCount * 100) / 100;
  let sellerUserId: number | null = null;
  let sellerToken: string | null = null;
  let platformFee = 0;
  if (finance.role === "reseller" && finance.parentUserId) {
    sellerUserId = finance.parentUserId;
    sellerToken = await getPartnerMercadoPagoAccessToken(sellerUserId);
    if (!sellerToken) throw new ResellerProgramError("O Master responsável precisa conectar o Mercado Pago antes desta compra.", 409);
    const sellerFinance = await memberFinance(sellerUserId);
    platformFee = Math.round(totalAmount * Math.max(0, 100 - sellerFinance.commissionRate)) / 100;
  }
  if (!sellerToken) {
    const admin = await getAdminMercadoPagoCheckoutConfig();
    if (!admin.isConfigured || !admin.accessToken) throw new ResellerProgramError("O checkout Mercado Pago da plataforma não está configurado.", 503);
    sellerToken = admin.accessToken;
  }
  const publicId = `pcr_${randomUUID().replace(/-/g, "")}`;
  const reference = `partner-credit:${publicId}`;
  await ensurePartnerProgramTables();
  await getDb().query<ResultSetHeader>(
    `INSERT INTO partner_credit_orders
      (public_id, buyer_user_id, seller_user_id, credit_count, unit_price, total_amount, platform_fee, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [publicId, buyerUserId, sellerUserId, creditCount, unitPrice, totalAmount, platformFee],
  );
  try {
    const preference = await createMercadoPagoCheckoutPreference({
      accessToken: sellerToken,
      amount: totalAmount,
      title: `${creditCount} crédito${creditCount === 1 ? "" : "s"} BotAdmin`,
      description: "Créditos para ativação e renovação de clientes",
      externalReference: reference,
      notificationUrl: webhookUrl(sellerUserId),
      metadata: { type: "partner_credit_purchase", partner_credit_order_id: publicId, buyer_user_id: buyerUserId, seller_user_id: sellerUserId },
      marketplaceFee: platformFee,
      backUrls: {
        success: `${appBaseUrl()}/dashboard/user?partner_payment=success`,
        pending: `${appBaseUrl()}/dashboard/user?partner_payment=pending`,
        failure: `${appBaseUrl()}/dashboard/user?partner_payment=failure`,
      },
    });
    const checkoutUrl = preference.initPoint ?? preference.sandboxInitPoint;
    await getDb().query(
      "UPDATE partner_credit_orders SET provider_preference_id = ?, checkout_url = ? WHERE public_id = ?",
      [preference.id, checkoutUrl, publicId],
    );
    return { orderId: publicId, credits: creditCount, amount: totalAmount, platformFee, checkoutUrl };
  } catch (error) {
    await getDb().query("UPDATE partner_credit_orders SET status = 'failed', metadata = ? WHERE public_id = ?", [JSON.stringify({ error: String(error).slice(0, 500) }), publicId]);
    throw error;
  }
};

export const getPartnerCreditOrderByReference = async (externalReference: string) => {
  const publicId = externalReference.startsWith("partner-credit:") ? externalReference.slice("partner-credit:".length) : externalReference;
  await ensurePartnerProgramTables();
  const [rows] = await getDb().query<RowDataPacket[]>("SELECT * FROM partner_credit_orders WHERE public_id = ? LIMIT 1", [publicId]);
  return rows[0] ?? null;
};

export const processPartnerCreditPayment = async (payload: { externalReference: string; paymentId: string; status: string; statusDetail?: string | null }) => {
  const order = await getPartnerCreditOrderByReference(payload.externalReference);
  if (!order) return null;
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM partner_credit_orders WHERE id = ? FOR UPDATE", [order.id]);
    const current = rows[0];
    if (!current) { await connection.rollback(); return null; }
    const approved = String(payload.status).toLowerCase() === "approved";
    if (approved && String(current.status).toLowerCase() !== "approved") {
      await connection.query("INSERT INTO reseller_wallets (reseller_user_id) VALUES (?) ON DUPLICATE KEY UPDATE reseller_user_id = reseller_user_id", [current.buyer_user_id]);
      const [wallets] = await connection.query<RowDataPacket[]>("SELECT id FROM reseller_wallets WHERE reseller_user_id = ? FOR UPDATE", [current.buyer_user_id]);
      const walletId = Number(wallets[0].id);
      await connection.query("UPDATE reseller_wallets SET credit_balance = credit_balance + ? WHERE id = ?", [current.credit_count, walletId]);
      await connection.query(
        `INSERT INTO reseller_credit_ledger (wallet_id, entry_type, credits, idempotency_key, reference_id, created_by, metadata)
         VALUES (?, 'credit_purchase', ?, ?, ?, NULL, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [walletId, current.credit_count, `partner-credit:${current.public_id}`, payload.paymentId, JSON.stringify({ sellerUserId: current.seller_user_id, amount: Number(current.total_amount), platformFee: Number(current.platform_fee) })],
      );
    }
    let metadata: Record<string, unknown> = {};
    if (current.metadata) {
      try {
        const parsed = typeof current.metadata === "string" ? JSON.parse(current.metadata) : current.metadata;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch { /* ignore malformed legacy metadata */ }
    }
    metadata.statusDetail = payload.statusDetail ?? null;
    await connection.query(
      `UPDATE partner_credit_orders SET provider_payment_id = ?, status = ?, approved_at = CASE WHEN ? = 'approved' AND approved_at IS NULL THEN NOW() ELSE approved_at END,
       metadata = ? WHERE id = ?`,
      [payload.paymentId, payload.status, payload.status, JSON.stringify(metadata), current.id],
    );
    await connection.commit();
    return { orderId: String(current.public_id), buyerUserId: Number(current.buyer_user_id), credits: Number(current.credit_count), approved };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
