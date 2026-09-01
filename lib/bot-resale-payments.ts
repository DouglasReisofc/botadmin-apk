import type { PlanCheckoutResponse, SubscriptionPlan } from "types/plans";


import { computePlanCheckoutBreakdown } from "lib/plans";
import { createMercadoPagoPixPayment } from "lib/mercadopago";
import { getAdminMercadoPagoPixConfig } from "lib/admin-payments";
import { getMercadoPagoNotificationUrl } from "lib/payments";
import { recordPlanPayment } from "lib/plan-payments";
import { computeBotResaleSellerShare } from "lib/bot-resale-wallet";
import { getBotResalePayoutConfigForUser } from "lib/bot-resale-payout-config";
import type { BotResalePayoutMode } from "types/payments";

export const BOT_RESALE_SPLIT_PROVIDERS = ["mercadopago_pix"] as const;
export type BotResaleSplitProvider = (typeof BOT_RESALE_SPLIT_PROVIDERS)[number];
export type BotResalePaymentMode = "split" | "wallet";

const PLAN_PAYMENT_TYPE_PURCHASE = "plan_purchase";
const DEFAULT_COMMISSION_PERCENT = 20;

const sanitizePercent = (value: unknown): number => {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseFloat(value.trim().replace(",", "."))
      : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return DEFAULT_COMMISSION_PERCENT;
  }
  return Math.min(Math.max(numeric, 0), 99);
};

export const getBotResaleCommissionPercent = (): number =>
  sanitizePercent(process.env.BOT_RESALE_COMMISSION_PERCENT);

export const computeBotResaleApplicationFee = (
  amount: number,
  commissionPercent = getBotResaleCommissionPercent(),
): number => {
  const sanitizedAmount = Number(amount);
  if (!Number.isFinite(sanitizedAmount) || sanitizedAmount <= 0) {
    return 0;
  }
  const fee = sanitizedAmount * (commissionPercent / 100);
  const rounded = Number(fee.toFixed(2));
  if (rounded <= 0) {
    return 0;
  }
  if (rounded >= sanitizedAmount) {
    return Number(Math.max(sanitizedAmount - 0.01, 0).toFixed(2));
  }
  return rounded;
};

const resolvePayerEmail = (
  email: string | null | undefined,
  userId: number,
): string => {
  if (typeof email === "string") {
    const normalized = email.trim();
    if (normalized) {
      return normalized;
    }
  }
  const safeId = Number.isFinite(userId) && userId > 0 ? userId : Math.floor(Math.random() * 10_000);
  return `cliente+${safeId}@storebot.app`;
};

const buildPlanDescription = (plan: SubscriptionPlan) =>
  `Assinatura do robô — ${plan.name}`;

export type BotResalePaymentReadiness = {
  ready: boolean;
  mode: BotResalePaymentMode | null;
  payoutMode: BotResalePayoutMode | null;
  provider: BotResaleSplitProvider | null;
  adminConfigured: boolean;
  payoutConfigured: boolean;
  message: string | null;
};

export const resolveBotResalePaymentMode = async (
  userId: number,
): Promise<BotResalePaymentMode> => {
  const payoutConfig = await getBotResalePayoutConfigForUser(userId);
  if (payoutConfig.mode === "automatic" && payoutConfig.isConfigured && payoutConfig.accessToken) {
    return "split";
  }
  return "wallet";
};

export const evaluateBotResalePaymentReadiness = async (
  userId: number,
): Promise<BotResalePaymentReadiness> => {
  const [payoutConfig, adminConfig] = await Promise.all([
    getBotResalePayoutConfigForUser(userId),
    getAdminMercadoPagoPixConfig(),
  ]);

  const adminConfigured = Boolean(adminConfig.isConfigured && adminConfig.accessToken);
  const payoutConfigured = payoutConfig.isConfigured;
  const paymentMode = await resolveBotResalePaymentMode(userId);

  if (!adminConfigured) {
    return {
      ready: false,
      mode: null,
      payoutMode: payoutConfig.mode,
      provider: null,
      adminConfigured,
      payoutConfigured,
      message: "O Mercado Pago da plataforma ainda não está configurado para processar vendas.",
    };
  }

  if (!payoutConfigured) {
    return {
      ready: false,
      mode: null,
      payoutMode: payoutConfig.mode,
      provider: null,
      adminConfigured,
      payoutConfigured,
      message: payoutConfig.mode === "manual"
        ? "Preencha chave Pix e nome do recebedor em Pagamentos → Pagamentos manual."
        : "Informe o access token do Mercado Pago em Pagamentos → Pagamentos automático.",
    };
  }

  return {
    ready: true,
    mode: paymentMode,
    payoutMode: payoutConfig.mode,
    provider: "mercadopago_pix",
    adminConfigured,
    payoutConfigured,
    message: paymentMode === "split"
      ? null
      : "Modo manual ativo: a plataforma processa o Pix e o valor acumula na sua carteira para saque.",
  };
};

export const assertBotResalePaymentReady = async (userId: number): Promise<void> => {
  const readiness = await evaluateBotResalePaymentReadiness(userId);
  if (!readiness.ready) {
    throw new Error(readiness.message ?? "Venda do robô indisponível.");
  }
};

export const createBotResalePlanPixCharge = async ({
  userId,
  userName,
  userEmail,
  plan,
  addons,
  context,
  commissionPercent,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  plan: SubscriptionPlan;
  addons?: import("types/plans").PlanAddonSelection[] | null;
  context?: Record<string, unknown> | null;
  commissionPercent?: number;
}): Promise<PlanCheckoutResponse> => {
  const readiness = await evaluateBotResalePaymentReadiness(userId);
  if (!readiness.ready) {
    throw new Error(readiness.message ?? "Venda do robô indisponível.");
  }

  const payoutConfig = await getBotResalePayoutConfigForUser(userId);
  const adminConfig = await getAdminMercadoPagoPixConfig();
  const mode = readiness.mode ?? "wallet";
  if (mode === "split" && payoutConfig.accessToken) {
    return createBotResaleSplitPlanPixCharge({
      userId,
      userName,
      userEmail,
      plan,
      addons,
      context,
      commissionPercent,
      accessToken: payoutConfig.accessToken,
      notificationUrl: getMercadoPagoNotificationUrl(),
      pixExpirationMinutes: adminConfig.pixExpirationMinutes,
    });
  }

  return createBotResaleWalletPlanPixCharge({
    userId,
    userName,
    userEmail,
    plan,
    addons,
    context,
    commissionPercent,
  });
};

const createBotResaleSplitPlanPixCharge = async ({
  userId,
  userName,
  userEmail,
  plan,
  addons,
  context,
  commissionPercent,
  accessToken,
  notificationUrl,
  pixExpirationMinutes,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  plan: SubscriptionPlan;
  addons?: import("types/plans").PlanAddonSelection[] | null;
  context?: Record<string, unknown> | null;
  commissionPercent?: number;
  accessToken: string;
  notificationUrl: string | null;
  pixExpirationMinutes: number;
}): Promise<PlanCheckoutResponse> => {
  const breakdown = computePlanCheckoutBreakdown(plan, addons);
  const totalAmount = breakdown.totalAmount;
  const effectiveCommission = commissionPercent ?? getBotResaleCommissionPercent();
  const applicationFee = computeBotResaleApplicationFee(totalAmount, effectiveCommission);
  const sellerShare = computeBotResaleSellerShare(totalAmount, effectiveCommission);

  const payerNameParts = userName.split(" ").filter((part) => part.trim().length > 0);
  const payerFirstName = payerNameParts[0] ?? "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;
  const payerEmail = resolvePayerEmail(userEmail, userId);

  const reference = `bot-resale:${userId}:${plan.id}:${Date.now()}`;
  const expiresInMinutes = pixExpirationMinutes > 0 ? pixExpirationMinutes : 30;
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

  const pixPayment = await createMercadoPagoPixPayment({
    accessToken,
    amount: totalAmount,
    description: buildPlanDescription(plan),
    externalReference: reference,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    notificationUrl,
    expiresAt,
    applicationFee,
    additionalMetadata: {
      storebot_plan_user_id: userId,
      storebot_plan_id: plan.id,
      storebot_resale: true,
      storebot_resale_mode: "split",
    },
  });

  await recordPlanPayment({
    userId,
    planId: plan.id,
    provider: "mercadopago_pix",
    providerPaymentId: String(pixPayment.id),
    status: pixPayment.status,
    statusDetail: null,
    amount: totalAmount,
    metadata: {
      publicId: pixPayment.id,
      externalReference: reference,
      type: PLAN_PAYMENT_TYPE_PURCHASE,
      paymentType: PLAN_PAYMENT_TYPE_PURCHASE,
      breakdown,
      resale: true,
      resalePayoutMode: "split",
      splitProvider: "mercadopago_pix",
      commissionPercent: effectiveCommission,
      applicationFee,
      sellerShare,
      context: context ?? null,
    },
  });

  const expiresAtIso = pixPayment.dateOfExpiration
    ? new Date(pixPayment.dateOfExpiration).toISOString()
    : expiresAt.toISOString();

  return {
    paymentId: String(pixPayment.id),
    providerPaymentId: String(pixPayment.id),
    provider: "mercadopago_pix",
    amount: totalAmount,
    breakdown,
    ticketUrl: pixPayment.ticketUrl ?? null,
    qrCode: pixPayment.qrCode ?? null,
    qrCodeBase64: pixPayment.qrCodeBase64 ?? null,
    expiresAt: expiresAtIso,
  } satisfies PlanCheckoutResponse;
};

const createBotResaleWalletPlanPixCharge = async ({
  userId,
  userName,
  userEmail,
  plan,
  addons,
  context,
  commissionPercent,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  plan: SubscriptionPlan;
  addons?: import("types/plans").PlanAddonSelection[] | null;
  context?: Record<string, unknown> | null;
  commissionPercent?: number;
}): Promise<PlanCheckoutResponse> => {
  const adminConfig = await getAdminMercadoPagoPixConfig();
  if (!adminConfig.isConfigured || !adminConfig.accessToken) {
    throw new Error("O Pix da plataforma não está configurado.");
  }

  const breakdown = computePlanCheckoutBreakdown(plan, addons);
  const totalAmount = breakdown.totalAmount;
  const effectiveCommission = commissionPercent ?? getBotResaleCommissionPercent();
  const sellerShare = computeBotResaleSellerShare(totalAmount, effectiveCommission);

  const payerNameParts = userName.split(" ").filter((part) => part.trim().length > 0);
  const payerFirstName = payerNameParts[0] ?? "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;
  const payerEmail = resolvePayerEmail(userEmail, userId);

  const reference = `bot-resale-wallet:${userId}:${plan.id}:${Date.now()}`;
  const expiresInMinutes = adminConfig.pixExpirationMinutes > 0 ? adminConfig.pixExpirationMinutes : 30;
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

  const pixPayment = await createMercadoPagoPixPayment({
    accessToken: adminConfig.accessToken,
    amount: totalAmount,
    description: buildPlanDescription(plan),
    externalReference: reference,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    notificationUrl: adminConfig.notificationUrl,
    expiresAt,
    additionalMetadata: {
      storebot_plan_user_id: userId,
      storebot_plan_id: plan.id,
      storebot_resale: true,
      storebot_resale_mode: "wallet",
    },
  });

  await recordPlanPayment({
    userId,
    planId: plan.id,
    provider: "mercadopago_pix",
    providerPaymentId: String(pixPayment.id),
    status: pixPayment.status,
    statusDetail: null,
    amount: totalAmount,
    metadata: {
      publicId: pixPayment.id,
      externalReference: reference,
      type: PLAN_PAYMENT_TYPE_PURCHASE,
      paymentType: PLAN_PAYMENT_TYPE_PURCHASE,
      breakdown,
      resale: true,
      resalePayoutMode: "wallet",
      commissionPercent: effectiveCommission,
      sellerShare,
      context: context ?? null,
    },
  });

  const expiresAtIso = pixPayment.dateOfExpiration
    ? new Date(pixPayment.dateOfExpiration).toISOString()
    : expiresAt.toISOString();

  return {
    paymentId: String(pixPayment.id),
    providerPaymentId: String(pixPayment.id),
    provider: "mercadopago_pix",
    amount: totalAmount,
    breakdown,
    ticketUrl: pixPayment.ticketUrl ?? null,
    qrCode: pixPayment.qrCode ?? null,
    qrCodeBase64: pixPayment.qrCodeBase64 ?? null,
    expiresAt: expiresAtIso,
  } satisfies PlanCheckoutResponse;
};

export const resolvePlanPaymentAccessToken = async (
  planPaymentMetadata: Record<string, unknown> | null,
  userId: number,
): Promise<string | null> => {
  const payoutMode = typeof planPaymentMetadata?.resalePayoutMode === "string"
    ? planPaymentMetadata.resalePayoutMode.trim().toLowerCase()
    : planPaymentMetadata?.resale === true
      ? "split"
      : null;

  if (payoutMode === "wallet") {
    const adminConfig = await getAdminMercadoPagoPixConfig();
    return adminConfig.isConfigured && adminConfig.accessToken ? adminConfig.accessToken : null;
  }

  if (planPaymentMetadata?.resale === true) {
    const payoutConfig = await getBotResalePayoutConfigForUser(userId);
    if (payoutConfig.mode === "automatic" && payoutConfig.accessToken) {
      return payoutConfig.accessToken;
    }
    const adminConfig = await getAdminMercadoPagoPixConfig();
    return adminConfig.isConfigured && adminConfig.accessToken ? adminConfig.accessToken : null;
  }

  const adminConfig = await getAdminMercadoPagoPixConfig();
  return adminConfig.isConfigured && adminConfig.accessToken ? adminConfig.accessToken : null;
};

export const processBotResaleApprovedPayment = async (payload: {
  userId: number;
  planPaymentId: string;
  amount: number;
  metadata: Record<string, unknown> | null;
}): Promise<void> => {
  if (!payload.metadata?.resale) {
    return;
  }

  if (payload.metadata.resalePayoutMode !== "wallet") {
    return;
  }

  const commissionPercent = typeof payload.metadata.commissionPercent === "number"
    ? payload.metadata.commissionPercent
    : getBotResaleCommissionPercent();
  const sellerShare = typeof payload.metadata.sellerShare === "number"
    ? payload.metadata.sellerShare
    : computeBotResaleSellerShare(payload.amount, commissionPercent);

  const { creditBotResaleWalletSale } = await import("lib/bot-resale-wallet");
  await creditBotResaleWalletSale({
    userId: payload.userId,
    planPaymentId: payload.planPaymentId,
    sellerShare,
    totalAmount: payload.amount,
    commissionPercent,
    metadata: {
      source: "bot_resale_wallet_payment",
    },
  });
};