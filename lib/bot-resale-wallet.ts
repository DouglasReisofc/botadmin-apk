import { ResultSetHeader, RowDataPacket } from "mysql2";

import {
  UserBotResaleLedgerRow,
  ensureUserBotResaleLedgerTable,
  getDb,
} from "lib/db";
import { decreaseUserBalance, getUserBalanceById, increaseUserBalance } from "lib/users";
import { getBotResalePayoutConfigForUser } from "lib/bot-resale-payout-config";

export const BOT_RESALE_LEDGER_SALE_CREDIT = "sale_credit";
export const BOT_RESALE_LEDGER_WITHDRAWAL = "withdrawal";

const DEFAULT_MIN_SALES_FOR_WITHDRAWAL = 3;

export const getBotResaleMinSalesForWithdrawal = (): number => {
  const raw = process.env.BOT_RESALE_MIN_SALES_FOR_WITHDRAWAL;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MIN_SALES_FOR_WITHDRAWAL;
  }
  return parsed;
};

export type BotResaleWalletSummary = {
  balance: number;
  siteBalance: number;
  approvedSalesCount: number;
  minSalesForWithdrawal: number;
  canWithdraw: boolean;
  withdrawBlockedReason: string | null;
  totalCredited: number;
  totalWithdrawn: number;
};

const parseAmount = (value: unknown): number => {
  const parsed = typeof value === "number"
    ? value
    : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const serializeMetadata = (metadata: Record<string, unknown> | null | undefined): string | null => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
};

export const getBotResaleWalletSummary = async (userId: number): Promise<BotResaleWalletSummary> => {
  await ensureUserBotResaleLedgerTable();
  const db = getDb();
  const minSales = getBotResaleMinSalesForWithdrawal();

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        COALESCE(SUM(CASE WHEN entry_type = ? THEN amount ELSE 0 END), 0) AS total_credited,
        COALESCE(SUM(CASE WHEN entry_type = ? THEN amount ELSE 0 END), 0) AS total_withdrawn,
        COALESCE(SUM(CASE WHEN entry_type = ? THEN 1 ELSE 0 END), 0) AS approved_sales_count
      FROM user_bot_resale_ledger
      WHERE user_id = ? AND status = 'completed'
    `,
    [
      BOT_RESALE_LEDGER_SALE_CREDIT,
      BOT_RESALE_LEDGER_WITHDRAWAL,
      BOT_RESALE_LEDGER_SALE_CREDIT,
      userId,
    ],
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const totalCredited = parseAmount(row?.total_credited);
  const totalWithdrawn = parseAmount(row?.total_withdrawn);
  const approvedSalesCount = Number.parseInt(String(row?.approved_sales_count ?? 0), 10) || 0;
  const balance = Math.max(0, Math.round((totalCredited - totalWithdrawn) * 100) / 100);
  const siteBalance = await getUserBalanceById(userId);

  let canWithdraw = false;
  let withdrawBlockedReason: string | null = null;

  if (approvedSalesCount < minSales) {
    withdrawBlockedReason = `Conclua pelo menos ${minSales} vendas para liberar o saque (${approvedSalesCount}/${minSales}).`;
  } else if (balance <= 0) {
    withdrawBlockedReason = "Não há saldo disponível para saque.";
  } else {
    canWithdraw = true;
  }

  return {
    balance,
    siteBalance,
    approvedSalesCount,
    minSalesForWithdrawal: minSales,
    canWithdraw,
    withdrawBlockedReason,
    totalCredited,
    totalWithdrawn,
  };
};

export const hasBotResaleSaleCredit = async (
  userId: number,
  planPaymentId: string,
): Promise<boolean> => {
  await ensureUserBotResaleLedgerTable();
  const db = getDb();
  const trimmed = planPaymentId.trim();
  if (!trimmed) {
    return false;
  }

  const [rows] = await db.query<UserBotResaleLedgerRow[]>(
    `
      SELECT id
      FROM user_bot_resale_ledger
      WHERE user_id = ? AND plan_payment_id = ? AND entry_type = ?
      LIMIT 1
    `,
    [userId, trimmed, BOT_RESALE_LEDGER_SALE_CREDIT],
  );

  return Array.isArray(rows) && rows.length > 0;
};

export const creditBotResaleWalletSale = async (payload: {
  userId: number;
  planPaymentId: string;
  sellerShare: number;
  totalAmount: number;
  commissionPercent: number;
  metadata?: Record<string, unknown> | null;
}): Promise<{ credited: boolean; balance: number }> => {
  await ensureUserBotResaleLedgerTable();
  const sellerShare = parseAmount(payload.sellerShare);
  if (sellerShare <= 0) {
    throw new Error("Valor de crédito inválido para venda do robô.");
  }

  const alreadyCredited = await hasBotResaleSaleCredit(payload.userId, payload.planPaymentId);
  if (alreadyCredited) {
    const summary = await getBotResaleWalletSummary(payload.userId);
    return { credited: false, balance: summary.balance };
  }

  const db = getDb();
  const metadata = serializeMetadata({
    ...(payload.metadata ?? {}),
    totalAmount: payload.totalAmount,
    commissionPercent: payload.commissionPercent,
    sellerShare,
    creditedAt: new Date().toISOString(),
  });

  try {
    await db.query<ResultSetHeader>(
      `
        INSERT INTO user_bot_resale_ledger (
          user_id,
          entry_type,
          amount,
          plan_payment_id,
          status,
          metadata
        ) VALUES (?, ?, ?, ?, 'completed', ?)
      `,
      [
        payload.userId,
        BOT_RESALE_LEDGER_SALE_CREDIT,
        sellerShare,
        payload.planPaymentId.trim(),
        metadata,
      ],
    );
  } catch (error) {
    const duplicate = error instanceof Error && /duplicate/i.test(error.message);
    if (duplicate) {
      const summary = await getBotResaleWalletSummary(payload.userId);
      return { credited: false, balance: summary.balance };
    }
    throw error;
  }

  await increaseUserBalance(payload.userId, sellerShare);
  const summary = await getBotResaleWalletSummary(payload.userId);
  return { credited: true, balance: summary.balance };
};

export const requestBotResaleWithdrawal = async (
  userId: number,
  requestedAmount?: number | null,
): Promise<{ amount: number; balance: number; siteBalance: number }> => {
  const summary = await getBotResaleWalletSummary(userId);
  if (!summary.canWithdraw) {
    throw new Error(summary.withdrawBlockedReason ?? "Saque indisponível no momento.");
  }

  const payoutConfig = await getBotResalePayoutConfigForUser(userId);
  if (payoutConfig.mode === "manual") {
    if (!payoutConfig.pixKey || !payoutConfig.recipientFullName) {
      throw new Error("Atualize os dados Pix em Pagamentos → Pagamentos manual antes de sacar.");
    }
  }

  const amount = requestedAmount == null
    ? summary.balance
    : parseAmount(requestedAmount);

  if (amount <= 0) {
    throw new Error("Informe um valor válido para saque.");
  }
  if (amount > summary.balance) {
    throw new Error("Valor de saque maior que o saldo disponível de vendas.");
  }

  await ensureUserBotResaleLedgerTable();
  const db = getDb();

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_bot_resale_ledger (
        user_id,
        entry_type,
        amount,
        plan_payment_id,
        status,
        metadata
      ) VALUES (?, ?, ?, NULL, 'completed', ?)
    `,
    [
      userId,
      BOT_RESALE_LEDGER_WITHDRAWAL,
      amount,
      serializeMetadata({
        requestedAt: new Date().toISOString(),
        source: "user_wallet_withdrawal",
        payoutMode: payoutConfig.mode,
        pixKey: payoutConfig.pixKey,
        recipientFullName: payoutConfig.recipientFullName,
      }),
    ],
  );

  await decreaseUserBalance(userId, amount);
  const nextSummary = await getBotResaleWalletSummary(userId);
  return {
    amount,
    balance: nextSummary.balance,
    siteBalance: nextSummary.siteBalance,
  };
};

export const computeBotResaleSellerShare = (
  amount: number,
  commissionPercent: number,
): number => {
  const sanitizedAmount = parseAmount(amount);
  const fee = sanitizedAmount * (commissionPercent / 100);
  const sellerShare = sanitizedAmount - fee;
  return Math.max(0, Math.round(sellerShare * 100) / 100);
};