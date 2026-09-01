import { ResultSetHeader } from "mysql2";

import type { PlanAddonSelection, PlanCheckoutResponse, SubscriptionPlan } from "types/plans";
import type {
  MercadoPagoCheckoutPaymentMethod,
  MercadoPagoCheckoutPaymentType,
} from "types/payments";

import {
  UserPlanPaymentRow,
  ensureUserPlanPaymentTable,
  getDb,
} from "lib/db";
import { computePlanCheckoutBreakdown } from "lib/plans";
import {
  getAdminMercadoPagoCheckoutConfig,
  getAdminMercadoPagoPixConfig,
  getAdminPoloPagPixConfig,
} from "lib/admin-payments";
import {
  createMercadoPagoCheckoutPreference,
  createMercadoPagoPixPayment,
} from "lib/mercadopago";
import { createPoloPagPixCharge as requestPoloPagPixCharge } from "lib/polopag";
import { resolvePartnerSplitForCustomer } from "lib/partner-payments";
import { resolveProxyCheckoutAdjustment } from "lib/instance-proxy";

const getAppBaseUrl = () => {
  const candidates = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_CAP_SERVER_URL,
    process.env.NOTIFICATIONS_APP_URL,
    process.env.VERCEL_URL,
    process.env.BASE_URL,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const v = raw.trim();
    if (!v) continue;
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(withScheme);
      return u.toString().replace(/\/+$/, "");
    } catch {}
  }
  const fallback =
    process.env.DEFAULT_APP_URL?.trim() ||
    (process.env.NODE_ENV === "production" ? "https://botadmin.shop" : "http://localhost:4478");
  return fallback;
};

const buildPlanCheckoutReturnUrls = () => {
  const base = getAppBaseUrl();
  const target = `${base}/dashboard/user/grupos`;
  return {
    success: `${target}?status=success`,
    pending: `${target}?status=pending`,
    failure: `${target}?status=failure`,
  };
};

const buildPlanDescription = (plan: SubscriptionPlan) =>
  `Assinatura do plano ${plan.name}`;

const PLAN_PAYMENT_TYPE_PURCHASE = "plan_purchase";
const PLAN_PAYMENT_TYPE_ADDON = "plan_addon";

const buildAddonDescription = (plan: SubscriptionPlan) =>
  `Add-ons extras do plano ${plan.name}`;

const computeAddonCheckoutBreakdown = (
  plan: SubscriptionPlan,
  addons?: PlanAddonSelection[] | null,
) => computePlanCheckoutBreakdown({ ...plan, price: 0 }, addons);

const roundCurrency = (value: number): number =>
  Math.round(Number(value || 0) * 100) / 100;

const resolveBalanceAdjustedAmount = (totalAmount: number, balanceApplied?: number | null): number => {
  const applied = Math.max(0, roundCurrency(Number(balanceApplied ?? 0)));
  return roundCurrency(Math.max(0, totalAmount - applied));
};

const withProxyCheckoutAdjustment = async (
  userId: number,
  breakdown: ReturnType<typeof computePlanCheckoutBreakdown>,
  durationDays: number,
  context?: Record<string, unknown> | null,
) => {
  const proxy = await resolveProxyCheckoutAdjustment(userId, context);
  if (proxy.amount <= 0) return breakdown;
  const billedMonths = Math.max(1, Math.round(Math.max(1, durationDays) / 30));
  const proxyAmount = roundCurrency(proxy.amount * billedMonths);
  return {
    ...breakdown,
    totalAmount: roundCurrency(breakdown.totalAmount + proxyAmount),
    proxyAmount,
    proxyLabel: `${proxy.label ?? "Proxy gerenciado"} · ${billedMonths} ${billedMonths === 1 ? "mês" : "meses"}`,
  };
};

const sanitizeMetadata = (metadata: Record<string, unknown> | null | undefined) => {
  if (!metadata) {
    return null;
  }

  try {
    return JSON.stringify(metadata);
  } catch (error) {
    console.warn("Failed to stringify plan payment metadata", error);
    return null;
  }
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

export const recordPlanPayment = async (payload: {
  userId: number;
  planId: number;
  provider: string;
  providerPaymentId: string;
  status: string;
  statusDetail?: string | null;
  amount: number;
  metadata?: Record<string, unknown> | null;
  subscriptionId?: number | null;
}) => {
  await ensureUserPlanPaymentTable();
  const db = getDb();

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_plan_payments (
        user_id,
        plan_id,
        subscription_id,
        provider,
        provider_payment_id,
        status,
        status_detail,
        amount,
        currency,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BRL', ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        status_detail = VALUES(status_detail),
        amount = VALUES(amount),
        metadata = VALUES(metadata),
        subscription_id = COALESCE(VALUES(subscription_id), subscription_id),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      payload.userId,
      payload.planId,
      payload.subscriptionId ?? null,
      payload.provider,
      payload.providerPaymentId,
      payload.status,
      payload.statusDetail ?? null,
      payload.amount,
      sanitizeMetadata(payload.metadata ?? null),
    ],
  );
};

export const createPlanPixCharge = async ({
  userId,
  userName,
  userEmail,
  plan,
  addons,
  provider,
  context,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  plan: SubscriptionPlan;
  addons?: PlanAddonSelection[] | null;
  provider: "mercadopago_pix" | "polopag_pix";
  context?: Record<string, unknown> | null;
}): Promise<PlanCheckoutResponse> => {
  if (provider === "polopag_pix") {
    const polopagConfig = await getAdminPoloPagPixConfig();

    if (!polopagConfig.isConfigured || !polopagConfig.apiKey) {
      throw new Error("O Pix da PoloPag não está configurado.");
    }

    const breakdown = await withProxyCheckoutAdjustment(
      userId,
      computePlanCheckoutBreakdown(plan, addons),
      plan.durationDays,
      context,
    );
    const totalAmount = breakdown.totalAmount;
    const reference = `plan:${userId}:${plan.id}:${Date.now()}`;
    const expirationMinutes = polopagConfig.pixExpirationMinutes > 0 ? polopagConfig.pixExpirationMinutes : 30;
    const expirationSeconds = Math.max(60, Math.min(86400, Math.floor(expirationMinutes * 60)));
    const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

    const pixCharge = await requestPoloPagPixCharge({
      apiKey: polopagConfig.apiKey,
      amount: totalAmount,
      expirationSeconds,
      reference,
      description: buildPlanDescription(plan),
      webhookUrl: polopagConfig.webhookUrl,
    });

    const providerPaymentId = pixCharge.txid || pixCharge.internalId || reference;

    await recordPlanPayment({
      userId,
      planId: plan.id,
      provider: "polopag_pix",
      providerPaymentId: String(providerPaymentId),
      status: pixCharge.status || "ATIVA",
      statusDetail: null,
      amount: totalAmount,
      metadata: {
        publicId: providerPaymentId,
        externalReference: reference,
        type: PLAN_PAYMENT_TYPE_PURCHASE,
        paymentType: PLAN_PAYMENT_TYPE_PURCHASE,
        txid: pixCharge.txid ?? null,
        internalId: pixCharge.internalId ?? null,
        webhookUrl: polopagConfig.webhookUrl ?? null,
        breakdown,
        context: context ?? null,
      },
    });

    const expiresAtValue = pixCharge.calendario?.expira_em
      ? new Date(pixCharge.calendario.expira_em)
      : expiresAt;
    const expiresAtIso = Number.isFinite(expiresAtValue?.getTime())
      ? expiresAtValue!.toISOString()
      : expiresAt.toISOString();

    return {
      paymentId: String(providerPaymentId),
      providerPaymentId: String(providerPaymentId),
      provider: "polopag_pix",
      amount: totalAmount,
      breakdown,
      ticketUrl: pixCharge.ticketUrl ?? null,
      qrCode: pixCharge.pixCopiaECola ?? null,
      qrCodeBase64: pixCharge.qrcodeBase64 ?? null,
      expiresAt: expiresAtIso,
    } satisfies PlanCheckoutResponse;
  }

  const pixConfig = await getAdminMercadoPagoPixConfig();
  const breakdown = await withProxyCheckoutAdjustment(
    userId,
    computePlanCheckoutBreakdown(plan, addons),
    plan.durationDays,
    context,
  );
  const totalAmount = breakdown.totalAmount;
  const partnerSplit = await resolvePartnerSplitForCustomer(userId, totalAmount);

  if ((!pixConfig.isConfigured || !pixConfig.accessToken) && !partnerSplit) {
    throw new Error("O Pix do administrador não está configurado.");
  }

  const payerNameParts = userName.split(" ").filter((part) => part.trim().length > 0);
  const payerFirstName = payerNameParts[0] ?? "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;
  const payerEmail = resolvePayerEmail(userEmail, userId);

  const reference = `plan:${userId}:${plan.id}:${Date.now()}`;
  const expiresInMinutes = pixConfig.pixExpirationMinutes > 0 ? pixConfig.pixExpirationMinutes : 30;
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

  const pixPayment = await createMercadoPagoPixPayment({
    accessToken: partnerSplit?.accessToken ?? pixConfig.accessToken,
    amount: totalAmount,
    description: buildPlanDescription(plan),
    externalReference: reference,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    notificationUrl: partnerSplit?.notificationUrl ?? pixConfig.notificationUrl,
    expiresAt,
    additionalMetadata: {
      storebot_plan_user_id: userId,
      storebot_plan_id: plan.id,
      ...(partnerSplit ? {
        partnerSellerUserId: partnerSplit.sellerUserId,
        partnerRate: partnerSplit.partnerRate,
        marketplaceFee: partnerSplit.platformFee,
      } : {}),
    },
    applicationFee: partnerSplit?.platformFee ?? null,
  });

  await recordPlanPayment({
    userId,
    planId: plan.id,
    provider: "mercadopago_pix",
    providerPaymentId: String(pixPayment.id),
    status: pixPayment.status,
    statusDetail: pixPayment.statusDetail ?? null,
    amount: totalAmount,
      metadata: {
        publicId: pixPayment.id,
        externalReference: reference,
        type: PLAN_PAYMENT_TYPE_PURCHASE,
        paymentType: PLAN_PAYMENT_TYPE_PURCHASE,
        breakdown,
        context: context ?? null,
        ...(partnerSplit ? {
          partnerSellerUserId: partnerSplit.sellerUserId,
          partnerRate: partnerSplit.partnerRate,
          marketplaceFee: partnerSplit.platformFee,
        } : {}),
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

export const createPlanCheckoutPreference = async ({
  userId,
  userName,
  userEmail,
  plan,
  addons,
  context,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  plan: SubscriptionPlan;
  addons?: PlanAddonSelection[] | null;
  context?: Record<string, unknown> | null;
}): Promise<PlanCheckoutResponse> => {
  const checkoutConfig = await getAdminMercadoPagoCheckoutConfig();

  const reference = `plan:${userId}:${plan.id}:${Date.now()}`;
  const breakdown = await withProxyCheckoutAdjustment(
    userId,
    computePlanCheckoutBreakdown(plan, addons),
    plan.durationDays,
    context,
  );
  const totalAmount = breakdown.totalAmount;
  const partnerSplit = await resolvePartnerSplitForCustomer(userId, totalAmount);

  if (!checkoutConfig.isConfigured && !partnerSplit) {
    throw new Error("O checkout do administrador não está configurado.");
  }
  if (!partnerSplit && !checkoutConfig.accessToken) {
    throw new Error("O checkout do administrador não está configurado.");
  }
  const payerNameParts = userName.split(" ").filter((part) => part.trim().length > 0);
  const payerFirstName = payerNameParts[0] ?? "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;
  const payerEmail = resolvePayerEmail(userEmail, userId);

  const ALL_PAYMENT_TYPES: readonly MercadoPagoCheckoutPaymentType[] = [
    "credit_card",
    "debit_card",
    "ticket",
    "bank_transfer",
    "atm",
    "account_money",
  ];
  const ALL_PAYMENT_METHODS: readonly MercadoPagoCheckoutPaymentMethod[] = ["pix"];

  const excludedPaymentTypes = ALL_PAYMENT_TYPES.filter(
    (type) => !checkoutConfig.allowedPaymentTypes.includes(type),
  );

  const excludedPaymentMethods = ALL_PAYMENT_METHODS.filter(
    (method) => !checkoutConfig.allowedPaymentMethods.includes(method),
  );

  const preference = await createMercadoPagoCheckoutPreference({
    accessToken: partnerSplit?.accessToken ?? checkoutConfig.accessToken,
    amount: totalAmount,
    title: plan.name,
    description: buildPlanDescription(plan),
    externalReference: reference,
    notificationUrl: partnerSplit?.notificationUrl ?? checkoutConfig.notificationUrl,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    metadata: {
      storebot_plan_user_id: userId,
      storebot_plan_id: plan.id,
      ...(partnerSplit ? {
        partnerSellerUserId: partnerSplit.sellerUserId,
        partnerRate: partnerSplit.partnerRate,
        marketplaceFee: partnerSplit.platformFee,
      } : {}),
    },
    excludedPaymentMethods,
    excludedPaymentTypes,
    backUrls: buildPlanCheckoutReturnUrls(),
    autoReturn: "approved",
    marketplaceFee: partnerSplit?.platformFee ?? null,
  });

  await recordPlanPayment({
    userId,
    planId: plan.id,
    provider: "mercadopago_checkout",
    providerPaymentId: String(preference.id),
    status: "pending",
    statusDetail: null,
    amount: totalAmount,
    metadata: {
      preferenceId: preference.id,
      initPoint: preference.initPoint,
      sandboxInitPoint: preference.sandboxInitPoint,
      externalReference: reference,
      type: PLAN_PAYMENT_TYPE_PURCHASE,
      paymentType: PLAN_PAYMENT_TYPE_PURCHASE,
      breakdown,
      context: context ?? null,
      ...(partnerSplit ? {
        partnerSellerUserId: partnerSplit.sellerUserId,
        partnerRate: partnerSplit.partnerRate,
        marketplaceFee: partnerSplit.platformFee,
      } : {}),
    },
  });

  return {
    paymentId: String(preference.id),
    providerPaymentId: String(preference.id),
    provider: "mercadopago_checkout",
    amount: totalAmount,
    breakdown,
    ticketUrl: preference.initPoint ?? preference.sandboxInitPoint ?? null,
    qrCode: null,
    qrCodeBase64: null,
    expiresAt: null,
  } satisfies PlanCheckoutResponse;
};

export const createPlanAddonPixCharge = async ({
  userId,
  userName,
  userEmail,
  plan,
  addons,
  subscriptionId,
  addonExpiresAt,
  provider,
  context,
  balanceApplied,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  plan: SubscriptionPlan;
  addons: PlanAddonSelection[];
  subscriptionId?: number | null;
  addonExpiresAt?: Date | string | null;
  provider: "mercadopago_pix" | "polopag_pix";
  context?: Record<string, unknown> | null;
  balanceApplied?: number | null;
}): Promise<PlanCheckoutResponse> => {
  if (provider === "polopag_pix") {
    const polopagConfig = await getAdminPoloPagPixConfig();

    if (!polopagConfig.isConfigured || !polopagConfig.apiKey) {
      throw new Error("O Pix da PoloPag não está configurado.");
    }

    const breakdown = computeAddonCheckoutBreakdown(plan, addons);
    const originalAmount = breakdown.totalAmount;
    const totalAmount = resolveBalanceAdjustedAmount(originalAmount, balanceApplied);

    if (totalAmount <= 0) {
      throw new Error("Informe ao menos um add-on para gerar o pagamento.");
    }

    const reference = `plan-addon:${userId}:${plan.id}:${Date.now()}`;
    const expirationMinutes = polopagConfig.pixExpirationMinutes > 0 ? polopagConfig.pixExpirationMinutes : 30;
    const expirationSeconds = Math.max(60, Math.min(86400, Math.floor(expirationMinutes * 60)));
    const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

    const pixCharge = await requestPoloPagPixCharge({
      apiKey: polopagConfig.apiKey,
      amount: totalAmount,
      expirationSeconds,
      reference,
      description: buildAddonDescription(plan),
      webhookUrl: polopagConfig.webhookUrl,
    });

    const providerPaymentId = pixCharge.txid || pixCharge.internalId || reference;

    const paymentExpiresAtValue = pixCharge.calendario?.expira_em
      ? new Date(pixCharge.calendario.expira_em)
      : expiresAt;
    const paymentExpiresAtIso = Number.isFinite(paymentExpiresAtValue?.getTime())
      ? paymentExpiresAtValue!.toISOString()
      : expiresAt.toISOString();

    const addonExpiresAtIso = (() => {
      if (!addonExpiresAt) {
        return null;
      }
      const parsed = addonExpiresAt instanceof Date ? addonExpiresAt : new Date(addonExpiresAt);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    })();

    await recordPlanPayment({
      userId,
      planId: plan.id,
      provider: "polopag_pix",
      providerPaymentId: String(providerPaymentId),
      status: pixCharge.status || "ATIVA",
      statusDetail: null,
      amount: totalAmount,
      subscriptionId: subscriptionId ?? null,
      metadata: {
        publicId: providerPaymentId,
        externalReference: reference,
        type: PLAN_PAYMENT_TYPE_ADDON,
        paymentType: PLAN_PAYMENT_TYPE_ADDON,
        breakdown,
        subscriptionId: subscriptionId ?? null,
        paymentExpiresAt: paymentExpiresAtIso,
        addonExpiresAt: addonExpiresAtIso,
        amountBeforeBalance: originalAmount,
        balanceApplied: roundCurrency(Number(balanceApplied ?? 0)),
        amountDue: totalAmount,
        txid: pixCharge.txid ?? null,
        internalId: pixCharge.internalId ?? null,
        webhookUrl: polopagConfig.webhookUrl ?? null,
        context: context ?? null,
      },
    });

    return {
      paymentId: String(providerPaymentId),
      providerPaymentId: String(providerPaymentId),
      provider: "polopag_pix",
      amount: totalAmount,
      breakdown,
      ticketUrl: pixCharge.ticketUrl ?? null,
      qrCode: pixCharge.pixCopiaECola ?? null,
      qrCodeBase64: pixCharge.qrcodeBase64 ?? null,
      expiresAt: paymentExpiresAtIso,
    } satisfies PlanCheckoutResponse;
  }

  const pixConfig = await getAdminMercadoPagoPixConfig();

  if (!pixConfig.isConfigured || !pixConfig.accessToken) {
    throw new Error("O Pix do administrador não está configurado.");
  }

  const breakdown = computeAddonCheckoutBreakdown(plan, addons);
  const originalAmount = breakdown.totalAmount;
  const totalAmount = resolveBalanceAdjustedAmount(originalAmount, balanceApplied);

  if (totalAmount <= 0) {
    throw new Error("Informe ao menos um add-on para gerar o pagamento.");
  }

  const payerNameParts = userName.split(" ").filter((part) => part.trim().length > 0);
  const payerFirstName = payerNameParts[0] ?? "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;
  const payerEmail = resolvePayerEmail(userEmail, userId);

  const reference = `plan-addon:${userId}:${plan.id}:${Date.now()}`;
  const expiresInMinutes = pixConfig.pixExpirationMinutes > 0 ? pixConfig.pixExpirationMinutes : 30;
  const paymentExpiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

  const pixPayment = await createMercadoPagoPixPayment({
    accessToken: pixConfig.accessToken,
    amount: totalAmount,
    description: buildAddonDescription(plan),
    externalReference: reference,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    notificationUrl: pixConfig.notificationUrl,
    expiresAt: paymentExpiresAt,
    additionalMetadata: {
      storebot_plan_user_id: userId,
      storebot_plan_id: plan.id,
    },
  });

  const paymentExpiresAtIso = pixPayment.dateOfExpiration
    ? new Date(pixPayment.dateOfExpiration).toISOString()
    : paymentExpiresAt.toISOString();

  const addonExpiresAtIso = (() => {
    if (!addonExpiresAt) {
      return null;
    }
    const parsed = addonExpiresAt instanceof Date ? addonExpiresAt : new Date(addonExpiresAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  })();

  await recordPlanPayment({
    userId,
    planId: plan.id,
    provider: "mercadopago_pix",
    providerPaymentId: String(pixPayment.id),
    status: pixPayment.status,
    statusDetail: pixPayment.statusDetail ?? null,
    amount: totalAmount,
    subscriptionId: subscriptionId ?? null,
      metadata: {
        publicId: pixPayment.id,
      externalReference: reference,
      type: PLAN_PAYMENT_TYPE_ADDON,
      paymentType: PLAN_PAYMENT_TYPE_ADDON,
      breakdown,
      subscriptionId: subscriptionId ?? null,
        paymentExpiresAt: paymentExpiresAtIso,
        addonExpiresAt: addonExpiresAtIso,
        amountBeforeBalance: originalAmount,
        balanceApplied: roundCurrency(Number(balanceApplied ?? 0)),
        amountDue: totalAmount,
        context: context ?? null,
      },
  });

  return {
    paymentId: String(pixPayment.id),
    providerPaymentId: String(pixPayment.id),
    provider: "mercadopago_pix",
    amount: totalAmount,
    breakdown,
    ticketUrl: pixPayment.ticketUrl ?? null,
    qrCode: pixPayment.qrCode ?? null,
    qrCodeBase64: pixPayment.qrCodeBase64 ?? null,
    expiresAt: paymentExpiresAtIso,
  } satisfies PlanCheckoutResponse;
};
export const createPlanAddonCheckoutPreference = async ({
  userId,
  userName,
  userEmail,
  plan,
  addons,
  subscriptionId,
  addonExpiresAt,
  context,
  balanceApplied,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  plan: SubscriptionPlan;
  addons: PlanAddonSelection[];
  subscriptionId?: number | null;
  addonExpiresAt?: Date | string | null;
  context?: Record<string, unknown> | null;
  balanceApplied?: number | null;
}): Promise<PlanCheckoutResponse> => {
  const checkoutConfig = await getAdminMercadoPagoCheckoutConfig();

  if (!checkoutConfig.isConfigured || !checkoutConfig.accessToken) {
    throw new Error("O checkout do administrador não está configurado.");
  }

  const breakdown = computeAddonCheckoutBreakdown(plan, addons);
  const originalAmount = breakdown.totalAmount;
  const totalAmount = resolveBalanceAdjustedAmount(originalAmount, balanceApplied);

  if (totalAmount <= 0) {
    throw new Error("Informe ao menos um add-on para gerar o pagamento.");
  }

  const payerNameParts = userName.split(" ").filter((part) => part.trim().length > 0);
  const payerFirstName = payerNameParts[0] ?? "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;
  const payerEmail = resolvePayerEmail(userEmail, userId);

  const reference = `plan-addon:${userId}:${plan.id}:${Date.now()}`;

  const preference = await createMercadoPagoCheckoutPreference({
    accessToken: checkoutConfig.accessToken,
    amount: totalAmount,
    title: "Add-ons extras",
    description: buildAddonDescription(plan),
    externalReference: reference,
    notificationUrl: checkoutConfig.notificationUrl,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    metadata: {
      storebot_plan_user_id: userId,
      storebot_plan_id: plan.id,
    },
    excludedPaymentMethods: [],
    excludedPaymentTypes: [],
    backUrls: buildPlanCheckoutReturnUrls(),
    autoReturn: "approved",
  });

  const addonExpiresAtIso = (() => {
    if (!addonExpiresAt) {
      return null;
    }
    const parsed = addonExpiresAt instanceof Date ? addonExpiresAt : new Date(addonExpiresAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  })();

  await recordPlanPayment({
    userId,
    planId: plan.id,
    provider: "mercadopago_checkout",
    providerPaymentId: String(preference.id),
    status: "pending",
    statusDetail: null,
    amount: totalAmount,
    subscriptionId: subscriptionId ?? null,
    metadata: {
      preferenceId: preference.id,
      initPoint: preference.initPoint,
      sandboxInitPoint: preference.sandboxInitPoint,
      externalReference: reference,
      type: PLAN_PAYMENT_TYPE_ADDON,
      paymentType: PLAN_PAYMENT_TYPE_ADDON,
      breakdown,
      subscriptionId: subscriptionId ?? null,
      addonExpiresAt: addonExpiresAtIso,
      amountBeforeBalance: originalAmount,
      balanceApplied: roundCurrency(Number(balanceApplied ?? 0)),
      amountDue: totalAmount,
      context: context ?? null,
    },
  });

  return {
    paymentId: String(preference.id),
    providerPaymentId: String(preference.id),
    provider: "mercadopago_checkout",
    amount: totalAmount,
    breakdown,
    ticketUrl: preference.initPoint ?? preference.sandboxInitPoint ?? null,
    qrCode: null,
    qrCodeBase64: null,
    expiresAt: null,
  } satisfies PlanCheckoutResponse;
};

export const getPlanPaymentByProviderPaymentId = async (
  providerPaymentId: string,
): Promise<UserPlanPaymentRow | null> => {
  await ensureUserPlanPaymentTable();
  const db = getDb();

  const [rows] = await db.query<UserPlanPaymentRow[]>(
    `SELECT * FROM user_plan_payments WHERE provider_payment_id = ? LIMIT 1`,
    [providerPaymentId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const getPlanPaymentByExternalReference = async (
  externalReference: string,
): Promise<UserPlanPaymentRow | null> => {
  await ensureUserPlanPaymentTable();
  const db = getDb();

  const trimmed = externalReference.trim();
  if (!trimmed) return null;

  // Metadata example contains: "externalReference":"plan:..."
  const pattern = `%\"externalReference\":\"${trimmed.replace(/"/g, '\\"')}\"%`;

  const [rows] = await db.query<UserPlanPaymentRow[]>(
    `SELECT * FROM user_plan_payments WHERE metadata LIKE ? ORDER BY updated_at DESC LIMIT 1`,
    [pattern],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const getPlanPaymentByPreferenceId = async (
  preferenceId: string,
): Promise<UserPlanPaymentRow | null> => {
  await ensureUserPlanPaymentTable();
  const db = getDb();

  const trimmed = preferenceId.trim();
  if (!trimmed) return null;

  // Metadata example contains: "preferenceId":"<id>"
  const pattern = `%\"preferenceId\":\"${trimmed.replace(/"/g, '\\"')}\"%`;

  const [rows] = await db.query<UserPlanPaymentRow[]>(
    `SELECT * FROM user_plan_payments WHERE metadata LIKE ? ORDER BY updated_at DESC LIMIT 1`,
    [pattern],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const updatePlanPaymentStatus = async (
  providerPaymentId: string,
  status: string,
  statusDetail: string | null,
  metadata?: Record<string, unknown> | null,
  subscriptionId?: number | null,
): Promise<UserPlanPaymentRow | null> => {
  await ensureUserPlanPaymentTable();
  const db = getDb();

  await db.query(
    `
      UPDATE user_plan_payments
      SET
        status = ?,
        status_detail = ?,
        metadata = COALESCE(?, metadata),
        subscription_id = COALESCE(?, subscription_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE provider_payment_id = ?
    `,
    [status, statusDetail ?? null, sanitizeMetadata(metadata ?? null), subscriptionId ?? null, providerPaymentId],
  );

  const [rows] = await db.query<UserPlanPaymentRow[]>(
    `SELECT * FROM user_plan_payments WHERE provider_payment_id = ? LIMIT 1`,
    [providerPaymentId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};
