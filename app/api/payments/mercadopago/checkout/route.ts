import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getMercadoPagoNotificationUrl,
  upsertMercadoPagoCheckoutConfig,
} from "lib/payments";
import type {
  MercadoPagoCheckoutPaymentMethod,
  MercadoPagoCheckoutPaymentType,
} from "types/payments";

const SUPPORTED_PAYMENT_TYPES: readonly MercadoPagoCheckoutPaymentType[] = [
  "credit_card",
  "debit_card",
  "ticket",
  "bank_transfer",
  "atm",
  "account_money",
];

const SUPPORTED_PAYMENT_METHODS: readonly MercadoPagoCheckoutPaymentMethod[] = ["pix"];

const normalizeArray = <T extends string>(value: unknown, allowed: readonly T[]): T[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = new Set<T>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed = entry.trim().toLowerCase();
    const match = allowed.find((item) => item === trimmed);

    if (match) {
      normalized.add(match);
    }
  }

  return Array.from(normalized);
};

const parseString = (value: unknown): string => (typeof value === "string" ? value : "");

const parseAmountOptions = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed = value
    .map((entry) => {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        return entry;
      }

      if (typeof entry === "string" && entry.trim()) {
        const normalized = entry.trim().replace(/[^0-9,.-]/g, "");
        const usesComma = normalized.includes(",");
        const sanitized = usesComma
          ? normalized.replace(/\./g, "").replace(/,/g, ".")
          : normalized;
        const parsedNumber = Number.parseFloat(sanitized);
        if (Number.isFinite(parsedNumber)) {
          return parsedNumber;
        }
      }

      return null;
    })
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry) && entry > 0)
    .map((value) => Number(value.toFixed(2)));

  const unique = Array.from(new Set(parsed));
  return unique.sort((a, b) => a - b);
};

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      isActive,
      displayName,
      accessToken,
      publicKey,
      notificationUrl,
      allowedPaymentTypes,
      allowedPaymentMethods,
      amountOptions: amountOptionsRaw,
    } = body as Record<string, unknown>;

    const sanitizedAccessToken = parseString(accessToken);
    const sanitizedDisplayName = typeof displayName === "string" ? displayName : null;
    const sanitizedPublicKey = typeof publicKey === "string" ? publicKey : null;
    const defaultNotificationUrl = getMercadoPagoNotificationUrl();
    const sanitizedNotificationUrl =
      typeof notificationUrl === "string" && notificationUrl.trim().length > 0
        ? notificationUrl
        : defaultNotificationUrl;

    const paymentTypes = normalizeArray(
      allowedPaymentTypes,
      SUPPORTED_PAYMENT_TYPES,
    ) as MercadoPagoCheckoutPaymentType[];
    const paymentMethods = normalizeArray(
      allowedPaymentMethods,
      SUPPORTED_PAYMENT_METHODS,
    ) as MercadoPagoCheckoutPaymentMethod[];

    const amountOptions = parseAmountOptions(amountOptionsRaw);

    const desiredActive = Boolean(isActive);

    if (!sanitizedAccessToken.trim() && desiredActive) {
      return NextResponse.json(
        { message: "Informe o access token do Mercado Pago para ativar o checkout." },
        { status: 400 },
      );
    }

    if (desiredActive && paymentTypes.length + paymentMethods.length === 0) {
      return NextResponse.json(
        { message: "Selecione ao menos uma forma de pagamento para o checkout." },
        { status: 400 },
      );
    }

    const config = await upsertMercadoPagoCheckoutConfig({
      userId: user.id,
      isActive: desiredActive,
      displayName: sanitizedDisplayName,
      accessToken: sanitizedAccessToken,
      publicKey: sanitizedPublicKey,
      notificationUrl: sanitizedNotificationUrl,
      amountOptions,
      allowedPaymentTypes: paymentTypes,
      allowedPaymentMethods: paymentMethods,
    });

    return NextResponse.json({
      message: "Configurações do Mercado Pago Checkout atualizadas com sucesso.",
      config,
    });
  } catch (error) {
    console.error("Failed to update Mercado Pago checkout config", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações de checkout." },
      { status: 500 },
    );
  }
}
