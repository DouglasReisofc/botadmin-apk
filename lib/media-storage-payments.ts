import { ResultSetHeader } from "mysql2";

import type { PlanCheckoutBreakdown, PlanCheckoutResponse } from "types/plans";

import { ensureUserBalancePaymentTable, getDb } from "lib/db";
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
import type { UserMediaStoragePlan } from "lib/user-media-storage";

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
    const value = raw.trim();
    if (!value) continue;
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      return new URL(withScheme).toString().replace(/\/+$/, "");
    } catch {}
  }
  return process.env.DEFAULT_APP_URL?.trim() || "https://botadmin.shop";
};

const buildReturnUrls = () => {
  const target = `${getAppBaseUrl()}/dashboard/user`;
  return {
    success: `${target}?storage=success`,
    pending: `${target}?storage=pending`,
    failure: `${target}?storage=failure`,
  };
};

const sanitizeMetadata = (metadata: Record<string, unknown>) => JSON.stringify(metadata).slice(0, 6000);

const buildBreakdown = (plan: UserMediaStoragePlan): PlanCheckoutBreakdown => ({
  baseAmount: plan.price,
  addonsTotal: 0,
  totalAmount: plan.price,
  addons: [],
});

const buildDescription = (plan: UserMediaStoragePlan) =>
  `Armazenamento persistente BotAdmin ${plan.quotaGb} GB`;

const buildMetadata = (
  plan: UserMediaStoragePlan,
  extra: Record<string, unknown>,
) => ({
  ...extra,
  type: "media_storage_purchase",
  storagePlanId: plan.id,
  planName: plan.name,
  quotaGb: plan.quotaGb,
  quotaBytes: plan.quotaBytes,
  durationDays: plan.durationDays,
  skipBalanceCredit: true,
});

const resolvePayerEmail = (email: string | null | undefined, userId: number) => {
  const normalized = typeof email === "string" ? email.trim() : "";
  return normalized || `cliente+${userId}@botadmin.shop`;
};

export const createMediaStorageCheckout = async ({
  userId,
  userName,
  userEmail,
  plan,
  provider,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  plan: UserMediaStoragePlan;
  provider: "mercadopago_pix" | "polopag_pix" | "mercadopago_checkout";
}): Promise<PlanCheckoutResponse> => {
  if (plan.price <= 0 || plan.quotaBytes <= 0) {
    throw new Error("Plano de armazenamento inválido.");
  }

  const breakdown = buildBreakdown(plan);
  const payerNameParts = userName.split(" ").filter(Boolean);
  const payerFirstName = payerNameParts[0] || "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;
  const payerEmail = resolvePayerEmail(userEmail, userId);
  const db = getDb();
  await ensureUserBalancePaymentTable();

  if (provider === "polopag_pix") {
    const config = await getAdminPoloPagPixConfig();
    if (!config.isConfigured || !config.apiKey) {
      throw new Error("O Pix da PoloPag não está configurado.");
    }

    const reference = `media-storage:${userId}:${plan.id}:${Date.now()}`;
    const expirationMinutes = config.pixExpirationMinutes > 0 ? config.pixExpirationMinutes : 30;
    const expirationSeconds = Math.max(60, Math.min(86400, Math.floor(expirationMinutes * 60)));
    const expiresAt = new Date(Date.now() + expirationSeconds * 1000);
    const pixCharge = await requestPoloPagPixCharge({
      apiKey: config.apiKey,
      amount: plan.price,
      expirationSeconds,
      reference,
      description: buildDescription(plan),
      webhookUrl: config.webhookUrl,
    });
    const providerPaymentId = pixCharge.txid || pixCharge.internalId || reference;
    const expiresAtValue = pixCharge.calendario?.expira_em ? new Date(pixCharge.calendario.expira_em) : expiresAt;
    const expiresAtIso = Number.isFinite(expiresAtValue?.getTime())
      ? expiresAtValue!.toISOString()
      : expiresAt.toISOString();

    await db.query<ResultSetHeader>(
      `
        INSERT INTO user_balance_payments
          (user_id, provider, provider_payment_id, status, status_detail, amount, currency, metadata)
        VALUES (?, 'polopag_pix', ?, ?, NULL, ?, 'BRL', ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          amount = VALUES(amount),
          metadata = VALUES(metadata),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        userId,
        providerPaymentId,
        pixCharge.status || "ATIVA",
        plan.price,
        sanitizeMetadata(buildMetadata(plan, {
          publicId: providerPaymentId,
          externalReference: reference,
          txid: pixCharge.txid ?? null,
          internalId: pixCharge.internalId ?? null,
          webhookUrl: config.webhookUrl ?? null,
        })),
      ],
    );

    return {
      paymentId: String(providerPaymentId),
      providerPaymentId: String(providerPaymentId),
      provider,
      amount: plan.price,
      breakdown,
      ticketUrl: pixCharge.ticketUrl ?? null,
      qrCode: pixCharge.pixCopiaECola ?? null,
      qrCodeBase64: pixCharge.qrcodeBase64 ?? null,
      expiresAt: expiresAtIso,
    };
  }

  if (provider === "mercadopago_checkout") {
    const config = await getAdminMercadoPagoCheckoutConfig();
    if (!config.isConfigured || !config.accessToken) {
      throw new Error("O checkout do Mercado Pago não está configurado.");
    }

    const reference = `media-storage:${userId}:${plan.id}:${Date.now()}`;
    const preference = await createMercadoPagoCheckoutPreference({
      accessToken: config.accessToken,
      amount: plan.price,
      title: plan.name,
      description: buildDescription(plan),
      externalReference: reference,
      notificationUrl: config.notificationUrl,
      payer: {
        email: payerEmail,
        firstName: payerFirstName,
        lastName: payerLastName,
      },
      metadata: {
        botadmin_media_storage_user_id: userId,
        botadmin_media_storage_plan_id: plan.id,
      },
      excludedPaymentMethods: [],
      excludedPaymentTypes: [],
      backUrls: buildReturnUrls(),
      autoReturn: "approved",
    });

    await db.query<ResultSetHeader>(
      `
        INSERT INTO user_balance_payments
          (user_id, provider, provider_payment_id, status, status_detail, amount, currency, metadata)
        VALUES (?, 'mercadopago_checkout', ?, 'pending', NULL, ?, 'BRL', ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          amount = VALUES(amount),
          metadata = VALUES(metadata),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        userId,
        preference.id,
        plan.price,
        sanitizeMetadata(buildMetadata(plan, {
          preferenceId: preference.id,
          initPoint: preference.initPoint,
          sandboxInitPoint: preference.sandboxInitPoint,
          externalReference: reference,
        })),
      ],
    );

    return {
      paymentId: String(preference.id),
      providerPaymentId: String(preference.id),
      provider,
      amount: plan.price,
      breakdown,
      ticketUrl: preference.initPoint ?? preference.sandboxInitPoint ?? null,
      qrCode: null,
      qrCodeBase64: null,
      expiresAt: null,
    };
  }

  const config = await getAdminMercadoPagoPixConfig();
  if (!config.isConfigured || !config.accessToken) {
    throw new Error("O Pix do Mercado Pago não está configurado.");
  }

  const reference = `media-storage:${userId}:${plan.id}:${Date.now()}`;
  const expiresInMinutes = config.pixExpirationMinutes > 0 ? config.pixExpirationMinutes : 30;
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
  const pixPayment = await createMercadoPagoPixPayment({
    accessToken: config.accessToken,
    amount: plan.price,
    description: buildDescription(plan),
    externalReference: reference,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    notificationUrl: config.notificationUrl,
    expiresAt,
    additionalMetadata: {
      botadmin_media_storage_user_id: userId,
      botadmin_media_storage_plan_id: plan.id,
    },
  });

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_balance_payments
        (user_id, provider, provider_payment_id, status, status_detail, amount, currency, metadata)
      VALUES (?, 'mercadopago_pix', ?, ?, ?, ?, 'BRL', ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        status_detail = VALUES(status_detail),
        amount = VALUES(amount),
        metadata = VALUES(metadata),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      pixPayment.id,
      pixPayment.status,
      pixPayment.statusDetail ?? null,
      plan.price,
      sanitizeMetadata(buildMetadata(plan, {
        publicId: pixPayment.id,
        externalReference: reference,
      })),
    ],
  );

  return {
    paymentId: String(pixPayment.id),
    providerPaymentId: String(pixPayment.id),
    provider,
    amount: plan.price,
    breakdown,
    ticketUrl: pixPayment.ticketUrl ?? null,
    qrCode: pixPayment.qrCode ?? null,
    qrCodeBase64: pixPayment.qrCodeBase64 ?? null,
    expiresAt: pixPayment.dateOfExpiration ? new Date(pixPayment.dateOfExpiration).toISOString() : expiresAt.toISOString(),
  };
};
