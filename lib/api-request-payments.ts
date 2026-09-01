import { ResultSetHeader } from "mysql2";

import {
  getAdminMercadoPagoCheckoutConfig,
  getAdminMercadoPagoPixConfig,
  getAdminPoloPagPixConfig,
} from "lib/admin-payments";
import {
  createMercadoPagoCheckoutCharge,
  createMercadoPagoPixCharge,
  createPoloPagPixCharge,
} from "lib/payments";
import { addUserApiRequestQuota, getOrCreateUserApiKey } from "lib/user-api-keys";
import {
  ensureUserApiRequestTopupTable,
  getDb,
  type UserApiRequestTopupRow,
} from "lib/db";
import { getApiRequestPlanById, type ApiRequestPlan } from "./api-request-plans";
import type { PlanCheckoutResponse } from "types/plans";
import type { PaymentChargeMetadata, PaymentMethodProvider } from "types/payments";

const sanitizeWhatsapp = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 8 ? digits : "";
};

const buildMetadataContext = (plan: ApiRequestPlan): Record<string, unknown> => ({
  type: "api_request_package",
  planId: plan.id,
  planName: plan.name,
  requestAmount: plan.requestAmount,
  priceCents: plan.priceCents,
});

const parseTopupMetadata = (value: string | null | undefined): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    console.warn("Failed to parse API request topup metadata", error);
  }
  return null;
};

const mapTopupRow = (row: UserApiRequestTopupRow) => ({
  id: row.id,
  userId: row.user_id,
  planId: row.plan_id,
  provider: row.provider,
  providerPaymentId: row.provider_payment_id,
  requestAmount: row.request_amount,
  amountCents: row.amount_cents,
  status: row.status,
  metadata: parseTopupMetadata(row.metadata),
  processedAt: row.processed_at ? (row.processed_at instanceof Date
    ? row.processed_at.toISOString()
    : new Date(row.processed_at).toISOString()) : null,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
});

export const createApiRequestPackageCharge = async ({
  userId,
  userName,
  userEmail,
  userWhatsapp,
  plan,
  provider,
}: {
  userId: number;
  userName: string;
  userEmail: string | null | undefined;
  userWhatsapp: string | null | undefined;
  plan: ApiRequestPlan;
  provider: PaymentMethodProvider;
}): Promise<PlanCheckoutResponse> => {
  const amount = plan.priceCents / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Valor do pacote inválido.");
  }

  const sanitizedWhatsapp = sanitizeWhatsapp(userWhatsapp);
  const normalizedEmail = typeof userEmail === "string" ? userEmail.trim() : "";

  const context = {
    ...buildMetadataContext(plan),
    planName: plan.name,
    purchaserName: userName,
    purchaserWhatsapp: sanitizedWhatsapp || null,
    purchaserEmail: normalizedEmail || null,
  };

  const metadata: PaymentChargeMetadata = {
    paymentType: "api_request_package",
    planId: plan.id,
    planName: plan.name,
    requestAmount: plan.requestAmount,
    purchaserName: userName,
    purchaserWhatsapp: sanitizedWhatsapp || null,
    purchaserEmail: normalizedEmail || null,
    skipBalanceCredit: true,
    context,
  };

  const toPlanCheckoutResponse = (
    charge: {
      publicId: string;
      providerPaymentId: string;
      provider: string;
      amount: number;
      ticketUrl: string | null;
      qrCode: string | null;
      qrCodeBase64: string | null;
      expiresAt: string | null;
    },
  ): PlanCheckoutResponse => ({
    paymentId: charge.publicId,
    providerPaymentId: charge.providerPaymentId,
    provider: charge.provider as PlanCheckoutResponse["provider"],
    amount: charge.amount,
    breakdown: {
      baseAmount: charge.amount,
      addonsTotal: 0,
      totalAmount: charge.amount,
      addons: [],
    },
    ticketUrl: charge.ticketUrl,
    qrCode: charge.qrCode,
    qrCodeBase64: charge.qrCodeBase64,
    expiresAt: charge.expiresAt,
  });

  if (provider === "mercadopago_pix") {
    const config = await getAdminMercadoPagoPixConfig();
    if (!config.isConfigured || !config.accessToken) {
      throw new Error("O Pix do administrador não está configurado para vendas de API.");
    }
    const charge = await createMercadoPagoPixCharge({
      userId,
      amount,
      customerWhatsapp: sanitizedWhatsapp,
      customerName: userName,
      config,
      metadata,
    });
    return toPlanCheckoutResponse({
      publicId: charge.publicId,
      providerPaymentId: charge.providerPaymentId,
      provider: charge.provider,
      amount: charge.amount,
      ticketUrl: charge.ticketUrl,
      qrCode: charge.qrCode,
      qrCodeBase64: charge.qrCodeBase64,
      expiresAt: charge.expiresAt,
    });
  }

  if (provider === "polopag_pix") {
    const config = await getAdminPoloPagPixConfig();
    if (!config.isConfigured || !config.apiKey) {
      throw new Error("O Pix da PoloPag do administrador não está configurado.");
    }
    const charge = await createPoloPagPixCharge({
      userId,
      amount,
      customerWhatsapp: sanitizedWhatsapp,
      customerName: userName,
      config,
      metadata,
    });
    return toPlanCheckoutResponse({
      publicId: charge.publicId,
      providerPaymentId: charge.providerPaymentId,
      provider: charge.provider,
      amount: charge.amount,
      ticketUrl: charge.ticketUrl,
      qrCode: charge.qrCode,
      qrCodeBase64: charge.qrCodeBase64,
      expiresAt: charge.expiresAt,
    });
  }

  if (provider === "mercadopago_checkout") {
    const config = await getAdminMercadoPagoCheckoutConfig();
    if (!config.isConfigured || !config.accessToken) {
      throw new Error("O checkout do administrador não está configurado para vendas de API.");
    }
    const requestLabel = plan.requestAmount.toLocaleString("pt-BR");
    const checkoutTitle = plan.name.trim() || "Pacote de requisições";
    const checkoutDescription = `${requestLabel} requisições de API`;
    const charge = await createMercadoPagoCheckoutCharge({
      userId,
      amount,
      customerWhatsapp: sanitizedWhatsapp,
      customerName: userName,
      customerEmail: normalizedEmail || undefined,
      productTitle: checkoutTitle,
      productDescription: `${checkoutDescription} (${checkoutTitle})`,
      config,
      metadata,
    });
    return toPlanCheckoutResponse({
      publicId: charge.publicId,
      providerPaymentId: charge.providerPaymentId,
      provider: charge.provider,
      amount: charge.amount,
      ticketUrl: charge.ticketUrl,
      qrCode: charge.qrCode,
      qrCodeBase64: charge.qrCodeBase64,
      expiresAt: charge.expiresAt,
    });
  }

  throw new Error("Provedor de pagamento não suportado para requisições de API.");
};

export const grantApiRequestPackage = async ({
  userId,
  provider,
  providerPaymentId,
  planId,
  requestAmount,
  amount,
  metadata,
}: {
  userId: number;
  provider: string;
  providerPaymentId: string;
  planId?: number | null;
  requestAmount?: number | null;
  amount: number;
  metadata?: Record<string, unknown> | null;
}): Promise<{ granted: boolean; requestsAdded: number; plan?: ApiRequestPlan | null }> => {
  await ensureUserApiRequestTopupTable();
  const db = getDb();

  const normalizedAmountCents = Math.max(0, Math.round(Number(amount) * 100));
  let resolvedPlan: ApiRequestPlan | null = null;
  if (Number.isFinite(planId) && planId && planId > 0) {
    resolvedPlan = await getApiRequestPlanById(planId);
  }

  const metadataContext =
    metadata && typeof metadata === "object"
      ? (metadata.context as Record<string, unknown> | null | undefined)
      : null;

  const planIdFromMetadata = (() => {
    if (!metadata || typeof metadata !== "object") return null;
    const direct = Number((metadata as Record<string, unknown>).planId ?? (metadata as Record<string, unknown>).plan_id);
    if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
    if (metadataContext && typeof metadataContext === "object") {
      const ctxPlan = Number(metadataContext.planId ?? metadataContext.plan_id ?? metadataContext.packageId ?? metadataContext.package_id);
      if (Number.isFinite(ctxPlan) && ctxPlan > 0) return Math.floor(ctxPlan);
    }
    return null;
  })();

  const requestsFromMetadata = (() => {
    const tryNormalize = (value: unknown): number | null => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        return Math.floor(numeric);
      }
      return null;
    };

    if (metadata && typeof metadata === "object") {
      const direct = tryNormalize(
        (metadata as Record<string, unknown>).requestAmount
          ?? (metadata as Record<string, unknown>).requests
          ?? (metadata as Record<string, unknown>).quantity,
      );
      if (direct) return direct;
    }

    if (metadataContext && typeof metadataContext === "object") {
      const ctxValue = tryNormalize(
        metadataContext.requestAmount
          ?? metadataContext.requests
          ?? metadataContext.quantity
          ?? metadataContext.amount,
      );
      if (ctxValue) return ctxValue;
    }

    return Number.isFinite(requestAmount ?? null) ? Math.floor(Number(requestAmount)) : 0;
  })();

  const effectivePlanId = Number.isFinite(planId) && planId && planId > 0 ? planId : planIdFromMetadata ?? undefined;

  const requestsToAdd = (() => {
    if (resolvedPlan) {
      return resolvedPlan.requestAmount;
    }
    if (Number.isFinite(requestsFromMetadata) && requestsFromMetadata > 0) {
      return requestsFromMetadata;
    }
    if (metadata && typeof metadata === "object") {
      const fallback = Number((metadata as Record<string, unknown>).requestAmount);
      if (Number.isFinite(fallback) && fallback > 0) {
        return Math.floor(fallback);
      }
    }
    if (metadataContext && typeof metadataContext === "object") {
      const ctxFallback = Number(metadataContext.requestAmount ?? metadataContext.requests);
      if (Number.isFinite(ctxFallback) && ctxFallback > 0) {
        return Math.floor(ctxFallback);
      }
    }
    return 0;
  })();

  if (!Number.isFinite(requestsToAdd) || requestsToAdd <= 0) {
    return { granted: false, requestsAdded: 0, plan: resolvedPlan };
  }

  // Garante que o usuário possui um registro de chave antes de adicionar saldo.
  await getOrCreateUserApiKey(userId);

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_api_request_topups (
        user_id,
        plan_id,
        provider,
        provider_payment_id,
        request_amount,
        amount_cents,
        status,
        metadata,
        processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      resolvedPlan ? resolvedPlan.id : (effectivePlanId ?? null),
      provider,
      providerPaymentId,
      requestsToAdd,
      normalizedAmountCents,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );

  const wasInserted = result.affectedRows === 1;

  if (wasInserted) {
    await addUserApiRequestQuota(userId, requestsToAdd);
    return { granted: true, requestsAdded: requestsToAdd, plan: resolvedPlan };
  }

  return { granted: false, requestsAdded: 0, plan: resolvedPlan };
};

export type ApiRequestTopup = ReturnType<typeof mapTopupRow>;

export const getApiRequestTopupByProviderPaymentId = async (
  providerPaymentId: string,
): Promise<ApiRequestTopup | null> => {
  await ensureUserApiRequestTopupTable();
  const db = getDb();
  const trimmed = providerPaymentId.trim();
  if (!trimmed) {
    return null;
  }

  const [rows] = await db.query<UserApiRequestTopupRow[]>(
    `
      SELECT *
      FROM user_api_request_topups
      WHERE provider_payment_id = ?
      LIMIT 1
    `,
    [trimmed],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapTopupRow(rows[0]);
};
