import { ResultSetHeader } from "mysql2";

import type { PlanCheckoutBreakdown, PlanCheckoutResponse } from "types/plans";

import {
  UserBalancePaymentRow,
  ensureUserBalancePaymentTable,
  getDb,
} from "lib/db";
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

const buildTopUpReturnUrls = () => {
  const base = getAppBaseUrl();
  const target = `${base}/dashboard/user/grupos`;
  return {
    success: `${target}?status=success`,
    pending: `${target}?status=pending`,
    failure: `${target}?status=failure`,
  };
};

const sanitizeMetadata = (metadata: Record<string, unknown> | null | undefined) =>
  metadata ? JSON.stringify(metadata).slice(0, 6000) : null;

const buildTopUpDescription = (amount: number) =>
  `Adição de saldo StoreBot (${amount.toFixed(2)})`;

export const createBalanceTopUpPix = async ({
  userId,
  userName,
  userEmail,
  amount,
  provider,
}: {
  userId: number;
  userName: string;
  userEmail: string;
  amount: number;
  provider: "mercadopago_pix" | "polopag_pix";
}): Promise<PlanCheckoutResponse> => {
  if (provider === "polopag_pix") {
    const polopagConfig = await getAdminPoloPagPixConfig();

    if (!polopagConfig.isConfigured || !polopagConfig.apiKey) {
      throw new Error("O Pix da PoloPag não está configurado.");
    }

    const reference = `balance:${userId}:${Date.now()}`;
    const expirationMinutes = polopagConfig.pixExpirationMinutes > 0 ? polopagConfig.pixExpirationMinutes : 30;
    const expirationSeconds = Math.max(60, Math.min(86400, Math.floor(expirationMinutes * 60)));
    const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

    const pixCharge = await requestPoloPagPixCharge({
      apiKey: polopagConfig.apiKey,
      amount,
      expirationSeconds,
      reference,
      description: buildTopUpDescription(amount),
      webhookUrl: polopagConfig.webhookUrl,
    });

    const db = getDb();
    await ensureUserBalancePaymentTable();

    const providerPaymentId = pixCharge.txid || pixCharge.internalId || reference;

    await db.query<ResultSetHeader>(
      `
        INSERT INTO user_balance_payments (
          user_id,
          provider,
          provider_payment_id,
          status,
          status_detail,
          amount,
          currency,
          metadata
        ) VALUES (?, ?, ?, ?, ?, ?, 'BRL', ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          status_detail = VALUES(status_detail),
          amount = VALUES(amount),
          metadata = VALUES(metadata),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        userId,
        "polopag_pix",
        providerPaymentId,
        pixCharge.status || "ATIVA",
        null,
        amount,
        sanitizeMetadata({
          publicId: providerPaymentId,
          externalReference: reference,
          type: "balance_topup",
          txid: pixCharge.txid ?? null,
          internalId: pixCharge.internalId ?? null,
          webhookUrl: polopagConfig.webhookUrl ?? null,
        }),
      ],
    );

    const expiresAtValue = pixCharge.calendario?.expira_em
      ? new Date(pixCharge.calendario.expira_em)
      : expiresAt;
    const expiresAtIso = Number.isFinite(expiresAtValue?.getTime())
      ? expiresAtValue!.toISOString()
      : expiresAt.toISOString();

    const breakdown: PlanCheckoutBreakdown = {
      baseAmount: amount,
      addonsTotal: 0,
      totalAmount: amount,
      addons: [],
    };

    return {
      paymentId: providerPaymentId,
      providerPaymentId,
      provider: "polopag_pix",
      amount,
      breakdown,
      ticketUrl: pixCharge.ticketUrl ?? null,
      qrCode: pixCharge.pixCopiaECola ?? null,
      qrCodeBase64: pixCharge.qrcodeBase64 ?? null,
      expiresAt: expiresAtIso,
    } satisfies PlanCheckoutResponse;
  }

  const pixConfig = await getAdminMercadoPagoPixConfig();

  if (!pixConfig.isConfigured || !pixConfig.accessToken) {
    throw new Error("O Pix do administrador não está configurado.");
  }

  const payerNameParts = userName.split(" ").filter((part) => part.trim().length > 0);
  const payerFirstName = payerNameParts[0] ?? "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;

  const reference = `balance:${userId}:${Date.now()}`;
  const expiresInMinutes = pixConfig.pixExpirationMinutes > 0 ? pixConfig.pixExpirationMinutes : 30;
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

  const pixPayment = await createMercadoPagoPixPayment({
    accessToken: pixConfig.accessToken,
    amount,
    description: buildTopUpDescription(amount),
    externalReference: reference,
    payer: {
      email: userEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    notificationUrl: pixConfig.notificationUrl,
    expiresAt,
    additionalMetadata: {
      storebot_balance_user_id: userId,
    },
  });

  const db = getDb();
  await ensureUserBalancePaymentTable();

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_balance_payments (
        user_id,
        provider,
        provider_payment_id,
        status,
        status_detail,
        amount,
        currency,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, 'BRL', ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        status_detail = VALUES(status_detail),
        amount = VALUES(amount),
        metadata = VALUES(metadata),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      "mercadopago_pix",
      pixPayment.id,
      pixPayment.status,
      pixPayment.statusDetail ?? null,
      amount,
      sanitizeMetadata({
        publicId: pixPayment.id,
        externalReference: reference,
        type: "balance_topup",
      }),
    ],
  );

  const expiresAtIso = pixPayment.dateOfExpiration
    ? new Date(pixPayment.dateOfExpiration).toISOString()
    : expiresAt.toISOString();

  const breakdown: PlanCheckoutBreakdown = {
    baseAmount: amount,
    addonsTotal: 0,
    totalAmount: amount,
    addons: [],
  };

  return {
    paymentId: String(pixPayment.id),
    providerPaymentId: String(pixPayment.id),
    provider: "mercadopago_pix",
    amount,
    breakdown,
    ticketUrl: pixPayment.ticketUrl ?? null,
    qrCode: pixPayment.qrCode ?? null,
    qrCodeBase64: pixPayment.qrCodeBase64 ?? null,
    expiresAt: expiresAtIso,
  } satisfies PlanCheckoutResponse;
};
export const createBalanceTopUpCheckout = async ({
  userId,
  userName,
  userEmail,
  amount,
}: {
  userId: number;
  userName: string;
  userEmail: string;
  amount: number;
}): Promise<PlanCheckoutResponse> => {
  const checkoutConfig = await getAdminMercadoPagoCheckoutConfig();

  if (!checkoutConfig.isConfigured || !checkoutConfig.accessToken) {
    throw new Error("O checkout do administrador não está configurado.");
  }

  const payerNameParts = userName.split(" ").filter((part) => part.trim().length > 0);
  const payerFirstName = payerNameParts[0] ?? "Cliente";
  const payerLastName = payerNameParts.length > 1 ? payerNameParts.slice(1).join(" ") : null;

  const reference = `balance:${userId}:${Date.now()}`;

  const preference = await createMercadoPagoCheckoutPreference({
    accessToken: checkoutConfig.accessToken,
    amount,
    title: "Adição de saldo",
    description: buildTopUpDescription(amount),
    externalReference: reference,
    notificationUrl: checkoutConfig.notificationUrl,
    payer: {
      email: userEmail,
      firstName: payerFirstName,
      lastName: payerLastName,
    },
    metadata: {
      storebot_balance_user_id: userId,
    },
    excludedPaymentTypes: [],
    excludedPaymentMethods: [],
    backUrls: buildTopUpReturnUrls(),
    autoReturn: "approved",
  });

  const db = getDb();
  await ensureUserBalancePaymentTable();

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_balance_payments (
        user_id,
        provider,
        provider_payment_id,
        status,
        status_detail,
        amount,
        currency,
        metadata
      ) VALUES (?, 'mercadopago_checkout', ?, 'pending', NULL, ?, 'BRL', ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        status_detail = VALUES(status_detail),
        amount = VALUES(amount),
        metadata = VALUES(metadata),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      preference.id,
      amount,
      sanitizeMetadata({
        preferenceId: preference.id,
        initPoint: preference.initPoint,
        sandboxInitPoint: preference.sandboxInitPoint,
        externalReference: reference,
        type: "balance_topup",
      }),
    ],
  );

  const breakdown: PlanCheckoutBreakdown = {
    baseAmount: amount,
    addonsTotal: 0,
    totalAmount: amount,
    addons: [],
  };

  return {
    paymentId: String(preference.id),
    providerPaymentId: String(preference.id),
    provider: "mercadopago_checkout",
    amount,
    breakdown,
    ticketUrl: preference.initPoint ?? preference.sandboxInitPoint ?? null,
    qrCode: null,
    qrCodeBase64: null,
    expiresAt: null,
  } satisfies PlanCheckoutResponse;
};

export const getBalancePaymentByProviderPaymentId = async (
  providerPaymentId: string,
): Promise<UserBalancePaymentRow | null> => {
  await ensureUserBalancePaymentTable();
  const db = getDb();

  const [rows] = await db.query<UserBalancePaymentRow[]>(
    `SELECT * FROM user_balance_payments WHERE provider_payment_id = ? LIMIT 1`,
    [providerPaymentId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const getBalancePaymentByExternalReference = async (
  externalReference: string,
): Promise<UserBalancePaymentRow | null> => {
  await ensureUserBalancePaymentTable();
  const db = getDb();

  const trimmed = externalReference.trim();
  if (!trimmed) {
    return null;
  }

  const pattern = `%\"externalReference\":\"${trimmed.replace(/"/g, '\\"')}\"%`;

  const [rows] = await db.query<UserBalancePaymentRow[]>(
    `SELECT * FROM user_balance_payments WHERE metadata LIKE ? ORDER BY updated_at DESC LIMIT 1`,
    [pattern],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const updateBalancePaymentStatus = async (
  providerPaymentId: string,
  status: string,
  statusDetail: string | null,
  metadata?: Record<string, unknown> | null,
): Promise<UserBalancePaymentRow | null> => {
  await ensureUserBalancePaymentTable();
  const db = getDb();

  await db.query(
    `
      UPDATE user_balance_payments
      SET
        status = ?,
        status_detail = ?,
        metadata = COALESCE(?, metadata),
        updated_at = CURRENT_TIMESTAMP
      WHERE provider_payment_id = ?
    `,
    [status, statusDetail ?? null, sanitizeMetadata(metadata ?? null), providerPaymentId],
  );

  const [rows] = await db.query<UserBalancePaymentRow[]>(
    `SELECT * FROM user_balance_payments WHERE provider_payment_id = ? LIMIT 1`,
    [providerPaymentId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};
