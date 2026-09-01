import { randomUUID } from "crypto";
import { ResultSetHeader, RowDataPacket } from "mysql2";

import type {
  MercadoPagoCheckoutCharge,
  MercadoPagoCheckoutConfig,
  MercadoPagoCheckoutPaymentMethod,
  MercadoPagoCheckoutPaymentType,
  MercadoPagoPixCharge,
  MercadoPagoPixConfig,
  PaymentCharge,
  PaymentChargeMetadata,
  PaymentConfirmationMessageConfig,
  PaymentMethodSummary,
  PoloPagPixCharge,
  PoloPagPixConfig,
} from "types/payments";
import {
  UserPaymentChargeRow,
  UserPaymentMethodRow,
  ensurePaymentChargeTable,
  ensurePaymentMethodTable,
  getDb,
} from "./db";
import {
  createMercadoPagoCheckoutPreference,
  createMercadoPagoPixPayment,
} from "./mercadopago";
import { createPoloPagPixCharge as requestPoloPagPixCharge } from "./polopag";

const DEFAULT_MERCADO_PAGO_PIX_DISPLAY_NAME = "Pagamento Pix";
const DEFAULT_POLOPAG_PIX_DISPLAY_NAME = "Pagamento Pix (PoloPag)";
const DEFAULT_MERCADO_PAGO_CHECKOUT_DISPLAY_NAME = "Pagamento online";
const DEFAULT_EXPIRATION_MINUTES = 30;
const DEFAULT_AMOUNT_OPTIONS = [25, 50, 100];
const DEFAULT_CONFIRMATION_MESSAGE =
  "Pagamento confirmado! Seu saldo foi atualizado automaticamente. Use o botão abaixo para continuar comprando.";
const DEFAULT_CONFIRMATION_BUTTON = "Ir para o menu";
const CHECKOUT_PAYMENT_TYPES: readonly MercadoPagoCheckoutPaymentType[] = [
  "credit_card",
  "debit_card",
  "ticket",
  "bank_transfer",
  "atm",
  "account_money",
];
const CHECKOUT_PAYMENT_METHODS: readonly MercadoPagoCheckoutPaymentMethod[] = ["pix"];
const DEFAULT_CHECKOUT_PAYMENT_TYPES: readonly MercadoPagoCheckoutPaymentType[] = [
  "credit_card",
  "debit_card",
  "ticket",
  "bank_transfer",
];
const DEFAULT_CHECKOUT_PAYMENT_METHODS: readonly MercadoPagoCheckoutPaymentMethod[] = ["pix"];

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

export const getMercadoPagoNotificationUrl = () =>
  `${getAppBaseUrl()}/api/payments/mercadopago/webhook`;

export const getPoloPagNotificationUrl = () =>
  `${getAppBaseUrl()}/api/payments/polopag/webhook`;

const normalizePoloPagStatus = (status: string | null | undefined): string => {
  if (typeof status !== "string") {
    return "pending";
  }
  const normalized = status.trim().toLowerCase();
  switch (normalized) {
    case "aprovado":
    case "aprovada":
      return "approved";
    case "expirado":
    case "expirada":
      return "expired";
    case "cancelado":
    case "cancelada":
      return "cancelled";
    case "concluida":
    case "concluída":
      return "approved";
    case "ativa":
    case "ativo":
    case "pendente":
      return "pending";
    default:
      return normalized || "pending";
  }
};

const sanitizeText = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const sanitizeOptionalText = (value: unknown): string | null => {
  const text = sanitizeText(value);
  return text.length > 0 ? text : null;
};

const sanitizeOptionalUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  return trimmed;
};

const sanitizeOptionalMediaPath = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!trimmed) {
    return null;
  }

  if (!trimmed.startsWith("uploads/")) {
    return null;
  }

  return trimmed;
};

const resolveMediaUrl = (relativePath: string | null): string | null => {
  if (!relativePath) {
    return null;
  }

  const normalized = relativePath.replace(/^\/+/, "");
  return `${getAppBaseUrl()}/${normalized}`;
};

const sanitizeAmountOptions = (values: unknown): number[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  const centsSet = new Set<number>();

  for (const entry of values) {
    let numeric: number | null = null;

    if (typeof entry === "number" && Number.isFinite(entry)) {
      numeric = entry;
    } else if (typeof entry === "string" && entry.trim()) {
      const normalized = entry.trim().replace(/[^0-9,.-]/g, "");
      if (!normalized) {
        continue;
      }

      const usesComma = normalized.includes(",");
      const sanitized = usesComma
        ? normalized.replace(/\./g, "").replace(/,/g, ".")
        : normalized;
      const parsedNumber = Number.parseFloat(sanitized);
      if (Number.isFinite(parsedNumber)) {
        numeric = parsedNumber;
      }
    }

    if (numeric === null) {
      continue;
    }

    const cents = Math.round(numeric * 100);
    if (!Number.isFinite(cents) || cents < 1) {
      continue;
    }

    centsSet.add(cents);
  }

  return Array.from(centsSet)
    .sort((a, b) => a - b)
    .slice(0, 20)
    .map((cents) => cents / 100);
};

const sanitizeCheckoutPaymentTypes = (
  values: unknown,
): MercadoPagoCheckoutPaymentType[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  const allowed = new Set<MercadoPagoCheckoutPaymentType>();

  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim().toLowerCase();
    const match = CHECKOUT_PAYMENT_TYPES.find((type) => type === normalized);
    if (match) {
      allowed.add(match);
    }
  }

  return Array.from(allowed);
};

const sanitizeCheckoutPaymentMethods = (
  values: unknown,
): MercadoPagoCheckoutPaymentMethod[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  const allowed = new Set<MercadoPagoCheckoutPaymentMethod>();

  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim().toLowerCase();
    const match = CHECKOUT_PAYMENT_METHODS.find((method) => method === normalized);
    if (match) {
      allowed.add(match);
    }
  }

  return Array.from(allowed);
};

const mapPixPaymentMethodRow = (row: UserPaymentMethodRow | null): MercadoPagoPixConfig => {
  const defaultConfig: MercadoPagoPixConfig = {
    isActive: false,
    displayName: DEFAULT_MERCADO_PAGO_PIX_DISPLAY_NAME,
    accessToken: "",
    publicKey: null,
    pixKey: null,
    notificationUrl: null,
    pixExpirationMinutes: DEFAULT_EXPIRATION_MINUTES,
    amountOptions: Array.from(DEFAULT_AMOUNT_OPTIONS),
    instructions: null,
    isConfigured: false,
    updatedAt: null,
  };

  if (!row) {
    return defaultConfig;
  }

  let credentials: Record<string, unknown> = {};
  if (row.credentials) {
    try {
      const parsed = JSON.parse(row.credentials) as unknown;
      if (parsed && typeof parsed === "object") {
        credentials = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("Failed to parse payment credentials", error);
    }
  }

  let settings: Record<string, unknown> = {};
  if (row.settings) {
    try {
      const parsed = JSON.parse(row.settings) as unknown;
      if (parsed && typeof parsed === "object") {
        settings = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("Failed to parse payment settings", error);
    }
  }

  const accessToken = sanitizeText(credentials.accessToken);
  const publicKey = sanitizeOptionalText(credentials.publicKey);
  const pixKey = sanitizeOptionalText(credentials.pixKey);

  const notificationUrl = getMercadoPagoNotificationUrl();
  const pixExpirationMinutesRaw = typeof settings.pixExpirationMinutes === "number"
    ? settings.pixExpirationMinutes
    : typeof settings.pixExpirationMinutes === "string"
      ? Number.parseInt(settings.pixExpirationMinutes, 10)
      : undefined;
  const pixExpirationMinutes = Number.isFinite(pixExpirationMinutesRaw)
    ? Math.min(Math.max(Number(pixExpirationMinutesRaw), 5), 1440)
    : DEFAULT_EXPIRATION_MINUTES;

  const amountOptionsRaw = Array.isArray(settings.amountOptions)
    ? settings.amountOptions
    : DEFAULT_AMOUNT_OPTIONS;
  const amountOptions = sanitizeAmountOptions(amountOptionsRaw);

  const instructions = sanitizeOptionalText(settings.instructions);

  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString();

  return {
    isActive: row.is_active === 1 && accessToken.length > 0,
    displayName: row.display_name?.trim() || DEFAULT_MERCADO_PAGO_PIX_DISPLAY_NAME,
    accessToken,
    publicKey,
    pixKey,
    notificationUrl,
    pixExpirationMinutes,
    amountOptions: amountOptions.length > 0 ? amountOptions : Array.from(DEFAULT_AMOUNT_OPTIONS),
    instructions,
    isConfigured: accessToken.length > 0,
    updatedAt,
} satisfies MercadoPagoPixConfig;
};

const mapPoloPagPaymentMethodRow = (row: UserPaymentMethodRow | null): PoloPagPixConfig => {
  const defaultConfig: PoloPagPixConfig = {
    isActive: false,
    displayName: DEFAULT_POLOPAG_PIX_DISPLAY_NAME,
    apiKey: "",
    pixExpirationMinutes: DEFAULT_EXPIRATION_MINUTES,
    amountOptions: Array.from(DEFAULT_AMOUNT_OPTIONS),
    instructions: null,
    webhookUrl: getPoloPagNotificationUrl(),
    isConfigured: false,
    updatedAt: null,
  };

  if (!row) {
    return defaultConfig;
  }

  let credentials: Record<string, unknown> = {};
  if (row.credentials) {
    try {
      const parsed = JSON.parse(row.credentials) as unknown;
      if (parsed && typeof parsed === "object") {
        credentials = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("Failed to parse PoloPag payment credentials", error);
    }
  }

  let settings: Record<string, unknown> = {};
  if (row.settings) {
    try {
      const parsed = JSON.parse(row.settings) as unknown;
      if (parsed && typeof parsed === "object") {
        settings = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("Failed to parse PoloPag payment settings", error);
    }
  }

  const apiKey = sanitizeText(credentials.apiKey);
  const instructions = sanitizeOptionalText(settings.instructions);
  const webhookUrl = sanitizeOptionalUrl(settings.webhookUrl) ?? getPoloPagNotificationUrl();

  const pixExpirationMinutesRaw = typeof settings.pixExpirationMinutes === "number"
    ? settings.pixExpirationMinutes
    : typeof settings.pixExpirationMinutes === "string"
      ? Number.parseInt(settings.pixExpirationMinutes, 10)
      : undefined;
  const pixExpirationMinutes = Number.isFinite(pixExpirationMinutesRaw)
    ? Math.min(Math.max(Number(pixExpirationMinutesRaw), 5), 1440)
    : DEFAULT_EXPIRATION_MINUTES;

  const amountOptionsRaw = Array.isArray(settings.amountOptions)
    ? settings.amountOptions
    : DEFAULT_AMOUNT_OPTIONS;
  const amountOptions = sanitizeAmountOptions(amountOptionsRaw);

  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString();

  return {
    isActive: row.is_active === 1 && apiKey.length > 0,
    displayName: row.display_name?.trim() || DEFAULT_POLOPAG_PIX_DISPLAY_NAME,
    apiKey,
    pixExpirationMinutes,
    amountOptions: amountOptions.length > 0 ? amountOptions : Array.from(DEFAULT_AMOUNT_OPTIONS),
    instructions,
    webhookUrl,
    isConfigured: apiKey.length > 0,
    updatedAt,
  } satisfies PoloPagPixConfig;
};

const mapPaymentConfirmationRow = (
  row: UserPaymentMethodRow | null,
): PaymentConfirmationMessageConfig => {
  const defaultConfig: PaymentConfirmationMessageConfig = {
    messageText: DEFAULT_CONFIRMATION_MESSAGE,
    buttonLabel: DEFAULT_CONFIRMATION_BUTTON,
    mediaPath: null,
    mediaUrl: null,
    updatedAt: null,
  };

  if (!row) {
    return defaultConfig;
  }

  let settings: Record<string, unknown> = {};
  if (row.settings) {
    try {
      const parsed = JSON.parse(row.settings) as unknown;
      if (parsed && typeof parsed === "object") {
        settings = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("Failed to parse payment confirmation settings", error);
    }
  }

  const messageText = sanitizeText(settings.messageText);
  const buttonLabel = sanitizeText(settings.buttonLabel);
  const mediaPath = sanitizeOptionalMediaPath(settings.mediaPath);
  const mediaUrlFromSettings = sanitizeOptionalUrl(settings.mediaUrl);
  const mediaUrl = mediaPath ? resolveMediaUrl(mediaPath) : mediaUrlFromSettings;

  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString();

  return {
    messageText: messageText || DEFAULT_CONFIRMATION_MESSAGE,
    buttonLabel: buttonLabel || DEFAULT_CONFIRMATION_BUTTON,
    mediaPath: mediaPath ?? null,
    mediaUrl: mediaUrl ?? null,
    updatedAt,
  } satisfies PaymentConfirmationMessageConfig;
};

const mapCheckoutPaymentMethodRow = (
  row: UserPaymentMethodRow | null,
): MercadoPagoCheckoutConfig => {
  const defaultConfig: MercadoPagoCheckoutConfig = {
    isActive: false,
    displayName: DEFAULT_MERCADO_PAGO_CHECKOUT_DISPLAY_NAME,
    accessToken: "",
    publicKey: null,
    notificationUrl: null,
    amountOptions: Array.from(DEFAULT_AMOUNT_OPTIONS),
    allowedPaymentTypes: Array.from(DEFAULT_CHECKOUT_PAYMENT_TYPES),
    allowedPaymentMethods: Array.from(DEFAULT_CHECKOUT_PAYMENT_METHODS),
    isConfigured: false,
    updatedAt: null,
  };

  if (!row) {
    return defaultConfig;
  }

  let credentials: Record<string, unknown> = {};
  if (row.credentials) {
    try {
      const parsed = JSON.parse(row.credentials) as unknown;
      if (parsed && typeof parsed === "object") {
        credentials = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("Failed to parse payment credentials", error);
    }
  }

  let settings: Record<string, unknown> = {};
  if (row.settings) {
    try {
      const parsed = JSON.parse(row.settings) as unknown;
      if (parsed && typeof parsed === "object") {
        settings = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("Failed to parse payment settings", error);
    }
  }

  const accessToken = sanitizeText(credentials.accessToken);
  const publicKey = sanitizeOptionalText(credentials.publicKey);
  const notificationUrl = getMercadoPagoNotificationUrl();

  const allowedPaymentTypesRaw = Array.isArray(settings.allowedPaymentTypes)
    ? settings.allowedPaymentTypes
    : DEFAULT_CHECKOUT_PAYMENT_TYPES;
  const allowedPaymentTypes = sanitizeCheckoutPaymentTypes(allowedPaymentTypesRaw);

  const allowedPaymentMethodsRaw = Array.isArray(settings.allowedPaymentMethods)
    ? settings.allowedPaymentMethods
    : DEFAULT_CHECKOUT_PAYMENT_METHODS;
  const allowedPaymentMethods = sanitizeCheckoutPaymentMethods(allowedPaymentMethodsRaw);

  const amountOptionsRaw = Array.isArray(settings.amountOptions)
    ? settings.amountOptions
    : DEFAULT_AMOUNT_OPTIONS;
  const amountOptions = sanitizeAmountOptions(amountOptionsRaw);

  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString();

  return {
    isActive: row.is_active === 1 && accessToken.length > 0,
    displayName: row.display_name?.trim() || DEFAULT_MERCADO_PAGO_CHECKOUT_DISPLAY_NAME,
    accessToken,
    publicKey,
    notificationUrl,
    amountOptions: amountOptions.length > 0 ? amountOptions : Array.from(DEFAULT_AMOUNT_OPTIONS),
    allowedPaymentTypes:
      allowedPaymentTypes.length > 0
        ? allowedPaymentTypes
        : Array.from(DEFAULT_CHECKOUT_PAYMENT_TYPES),
    allowedPaymentMethods:
      allowedPaymentMethods.length > 0
        ? allowedPaymentMethods
        : Array.from(DEFAULT_CHECKOUT_PAYMENT_METHODS),
    isConfigured: accessToken.length > 0,
    updatedAt,
  } satisfies MercadoPagoCheckoutConfig;
};

const parseChargeMetadata = (raw: unknown): PaymentChargeMetadata | null => {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PaymentChargeMetadata;
    }
  } catch (error) {
    console.warn("Failed to parse charge metadata", error);
  }

  return null;
};

const mapChargeRow = (row: UserPaymentChargeRow): PaymentCharge => ({
  id: row.id,
  publicId: row.public_id,
  userId: row.user_id,
  provider: row.provider,
  providerPaymentId: row.provider_payment_id,
  status: row.status,
  amount: Number.parseFloat(row.amount),
  currency: row.currency,
  qrCode: row.qr_code,
  qrCodeBase64: row.qr_code_base64,
  ticketUrl: row.ticket_url,
  expiresAt: row.expires_at ? (row.expires_at instanceof Date
    ? row.expires_at.toISOString()
    : new Date(row.expires_at).toISOString()) : null,
  customerWhatsapp: row.customer_whatsapp,
  customerName: row.customer_name,
  metadata: parseChargeMetadata(row.metadata),
  createdAt: row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString(),
});

export const getPixChargeImageUrl = (publicId: string) => {
  const trimmed = publicId.trim();
  return `${getAppBaseUrl()}/api/payments/mercadopago/pix/${trimmed}/image`;
};

export const getMercadoPagoPixConfigForUser = async (
  userId: number,
): Promise<MercadoPagoPixConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<UserPaymentMethodRow[]>(
    `SELECT * FROM user_payment_methods WHERE user_id = ? AND provider = 'mercadopago_pix' LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapPixPaymentMethodRow(null);
  }

  return mapPixPaymentMethodRow(rows[0]);
};

export const getPoloPagPixConfigForUser = async (
  userId: number,
): Promise<PoloPagPixConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<UserPaymentMethodRow[]>(
    `SELECT * FROM user_payment_methods WHERE user_id = ? AND provider = 'polopag_pix' LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapPoloPagPaymentMethodRow(null);
  }

  return mapPoloPagPaymentMethodRow(rows[0]);
};

export const getPaymentConfirmationConfigForUser = async (
  userId: number,
): Promise<PaymentConfirmationMessageConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<UserPaymentMethodRow[]>(
    `SELECT * FROM user_payment_methods WHERE user_id = ? AND provider = 'payment_confirmation' LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapPaymentConfirmationRow(null);
  }

  return mapPaymentConfirmationRow(rows[0]);
};

export const getMercadoPagoCheckoutConfigForUser = async (
  userId: number,
): Promise<MercadoPagoCheckoutConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<UserPaymentMethodRow[]>(
    `SELECT * FROM user_payment_methods WHERE user_id = ? AND provider = 'mercadopago_checkout' LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapCheckoutPaymentMethodRow(null);
  }

  return mapCheckoutPaymentMethodRow(rows[0]);
};

export const getPaymentMethodSummariesForUser = async (
  userId: number,
): Promise<PaymentMethodSummary[]> => {
  const [mpPixConfig, polopagConfig, checkoutConfig] = await Promise.all([
    getMercadoPagoPixConfigForUser(userId),
    getPoloPagPixConfigForUser(userId),
    getMercadoPagoCheckoutConfigForUser(userId),
  ]);

  const summaries: PaymentMethodSummary[] = [
    {
      provider: "mercadopago_pix",
      displayName: mpPixConfig.displayName,
      isActive: mpPixConfig.isActive,
      isConfigured: mpPixConfig.isConfigured,
    },
    {
      provider: "polopag_pix",
      displayName: polopagConfig.displayName,
      isActive: polopagConfig.isActive,
      isConfigured: polopagConfig.isConfigured,
    },
    {
      provider: "mercadopago_checkout",
      displayName: checkoutConfig.displayName,
      isActive: checkoutConfig.isActive,
      isConfigured: checkoutConfig.isConfigured,
    },
  ];

  return summaries;
};

export const upsertMercadoPagoPixConfig = async (payload: {
  userId: number;
  isActive: boolean;
  displayName?: string | null;
  accessToken: string;
  publicKey?: string | null;
  pixKey?: string | null;
  notificationUrl?: string | null;
  pixExpirationMinutes?: number;
  amountOptions?: number[];
  instructions?: string | null;
}): Promise<MercadoPagoPixConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();

  const sanitizedAccessToken = sanitizeText(payload.accessToken);
  const sanitizedDisplayName =
    payload.displayName?.trim() || DEFAULT_MERCADO_PAGO_PIX_DISPLAY_NAME;
  const sanitizedPublicKey = sanitizeOptionalText(payload.publicKey);
  const sanitizedPixKey = sanitizeOptionalText(payload.pixKey);
  const sanitizedNotificationUrl = null;
  const sanitizedInstructions = sanitizeOptionalText(payload.instructions);

  const expirationMinutes = Number.isFinite(payload.pixExpirationMinutes)
    ? Math.min(Math.max(Number(payload.pixExpirationMinutes), 5), 1440)
    : DEFAULT_EXPIRATION_MINUTES;

  const amountOptions = sanitizeAmountOptions(payload.amountOptions ?? DEFAULT_AMOUNT_OPTIONS);
  const normalizedAmountOptions = amountOptions.length > 0 ? amountOptions : Array.from(DEFAULT_AMOUNT_OPTIONS);

  const credentials = JSON.stringify({
    accessToken: sanitizedAccessToken,
    publicKey: sanitizedPublicKey,
    pixKey: sanitizedPixKey,
  });

  const settings = JSON.stringify({
    notificationUrl: sanitizedNotificationUrl,
    pixExpirationMinutes: expirationMinutes,
    amountOptions: normalizedAmountOptions,
    instructions: sanitizedInstructions,
  });

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_payment_methods (
        user_id,
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES (?, 'mercadopago_pix', ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        display_name = VALUES(display_name),
        credentials = VALUES(credentials),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [
      payload.userId,
      sanitizedAccessToken.length > 0 && payload.isActive ? 1 : 0,
      sanitizedDisplayName,
      credentials,
      settings,
    ],
  );

  return getMercadoPagoPixConfigForUser(payload.userId);
};

export const upsertPoloPagPixConfig = async (payload: {
  userId: number;
  isActive: boolean;
  displayName?: string | null;
  apiKey: string;
  pixExpirationMinutes?: number;
  amountOptions?: number[];
  instructions?: string | null;
  webhookUrl?: string | null;
}): Promise<PoloPagPixConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();

  const sanitizedApiKey = sanitizeText(payload.apiKey);
  const sanitizedDisplayName = payload.displayName?.trim() || DEFAULT_POLOPAG_PIX_DISPLAY_NAME;
  const sanitizedInstructions = sanitizeOptionalText(payload.instructions);
  const sanitizedWebhookUrl = sanitizeOptionalUrl(payload.webhookUrl) ?? getPoloPagNotificationUrl();

  const expirationMinutes = Number.isFinite(payload.pixExpirationMinutes)
    ? Math.min(Math.max(Number(payload.pixExpirationMinutes), 5), 1440)
    : DEFAULT_EXPIRATION_MINUTES;

  const amountOptions = sanitizeAmountOptions(payload.amountOptions ?? DEFAULT_AMOUNT_OPTIONS);
  const normalizedAmountOptions = amountOptions.length > 0 ? amountOptions : Array.from(DEFAULT_AMOUNT_OPTIONS);

  const credentials = JSON.stringify({
    apiKey: sanitizedApiKey,
  });

  const settings = JSON.stringify({
    pixExpirationMinutes: expirationMinutes,
    amountOptions: normalizedAmountOptions,
    instructions: sanitizedInstructions,
    webhookUrl: sanitizedWebhookUrl,
  });

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_payment_methods (
        user_id,
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES (?, 'polopag_pix', ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        display_name = VALUES(display_name),
        credentials = VALUES(credentials),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [
      payload.userId,
      sanitizedApiKey.length > 0 && payload.isActive ? 1 : 0,
      sanitizedDisplayName,
      credentials,
      settings,
    ],
  );

  return getPoloPagPixConfigForUser(payload.userId);
};

export const upsertPaymentConfirmationConfig = async (payload: {
  userId: number;
  messageText: string;
  buttonLabel: string;
  mediaPath?: string | null;
  mediaUrl?: string | null;
}): Promise<PaymentConfirmationMessageConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();

  const messageText = sanitizeText(payload.messageText);
  const buttonLabel = sanitizeText(payload.buttonLabel);
  const mediaPath = sanitizeOptionalMediaPath(payload.mediaPath);
  const mediaUrl = mediaPath ? resolveMediaUrl(mediaPath) : sanitizeOptionalUrl(payload.mediaUrl);

  const settings = JSON.stringify({
    messageText: messageText || DEFAULT_CONFIRMATION_MESSAGE,
    buttonLabel: buttonLabel || DEFAULT_CONFIRMATION_BUTTON,
    mediaPath: mediaPath ?? null,
    mediaUrl: mediaUrl ?? null,
  });

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_payment_methods (
        user_id,
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES (?, 'payment_confirmation', 1, 'Confirmação de pagamento', NULL, ?, NULL)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        display_name = VALUES(display_name),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [payload.userId, settings],
  );

  return getPaymentConfirmationConfigForUser(payload.userId);
};

export const upsertMercadoPagoCheckoutConfig = async (payload: {
  userId: number;
  isActive: boolean;
  displayName?: string | null;
  accessToken: string;
  publicKey?: string | null;
  notificationUrl?: string | null;
  amountOptions?: number[];
  allowedPaymentTypes?: MercadoPagoCheckoutPaymentType[];
  allowedPaymentMethods?: MercadoPagoCheckoutPaymentMethod[];
}): Promise<MercadoPagoCheckoutConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();

  const sanitizedAccessToken = sanitizeText(payload.accessToken);
  const sanitizedDisplayName =
    payload.displayName?.trim() || DEFAULT_MERCADO_PAGO_CHECKOUT_DISPLAY_NAME;
  const sanitizedPublicKey = sanitizeOptionalText(payload.publicKey);
  const sanitizedNotificationUrl = null;

  const paymentTypes = sanitizeCheckoutPaymentTypes(
    payload.allowedPaymentTypes ?? DEFAULT_CHECKOUT_PAYMENT_TYPES,
  );
  const normalizedPaymentTypes =
    paymentTypes.length > 0 ? paymentTypes : Array.from(DEFAULT_CHECKOUT_PAYMENT_TYPES);

  const paymentMethods = sanitizeCheckoutPaymentMethods(
    payload.allowedPaymentMethods ?? DEFAULT_CHECKOUT_PAYMENT_METHODS,
  );
  const normalizedPaymentMethods =
    paymentMethods.length > 0 ? paymentMethods : Array.from(DEFAULT_CHECKOUT_PAYMENT_METHODS);

  const amountOptions = sanitizeAmountOptions(payload.amountOptions ?? DEFAULT_AMOUNT_OPTIONS);
  const normalizedAmountOptions =
    amountOptions.length > 0 ? amountOptions : Array.from(DEFAULT_AMOUNT_OPTIONS);

  const credentials = JSON.stringify({
    accessToken: sanitizedAccessToken,
    publicKey: sanitizedPublicKey,
  });

  const settings = JSON.stringify({
    notificationUrl: sanitizedNotificationUrl,
    amountOptions: normalizedAmountOptions,
    allowedPaymentTypes: normalizedPaymentTypes,
    allowedPaymentMethods: normalizedPaymentMethods,
  });

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_payment_methods (
        user_id,
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES (?, 'mercadopago_checkout', ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        display_name = VALUES(display_name),
        credentials = VALUES(credentials),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [
      payload.userId,
      sanitizedAccessToken.length > 0 && payload.isActive ? 1 : 0,
      sanitizedDisplayName,
      credentials,
      settings,
    ],
  );

  return getMercadoPagoCheckoutConfigForUser(payload.userId);
};

export const createMercadoPagoPixCharge = async (payload: {
  userId: number;
  amount: number;
  customerWhatsapp: string;
  customerName?: string | null;
  config: MercadoPagoPixConfig;
  metadata?: PaymentChargeMetadata | null;
  publicId?: string | null;
}): Promise<MercadoPagoPixCharge> => {
  await ensurePaymentChargeTable();
  const db = getDb();

  if (!payload.config.isConfigured || !payload.config.accessToken) {
    throw new Error("Mercado Pago Pix não configurado para este usuário.");
  }

  const sanitizedAmount = Number(payload.amount);
  if (!Number.isFinite(sanitizedAmount) || sanitizedAmount <= 0) {
    throw new Error("Valor inválido para geração de cobrança Pix.");
  }
  if (sanitizedAmount < 1) {
    throw new Error("O valor mínimo do Pix pela PoloPag é R$ 1,00.");
  }

  const expirationMinutes = payload.config.pixExpirationMinutes > 0
    ? payload.config.pixExpirationMinutes
    : DEFAULT_EXPIRATION_MINUTES;
  const expiresAt = Number.isFinite(expirationMinutes)
    ? new Date(Date.now() + expirationMinutes * 60_000)
    : new Date(Date.now() + DEFAULT_EXPIRATION_MINUTES * 60_000);

  const customerWhatsapp = payload.customerWhatsapp.trim();
  const customerName = sanitizeOptionalText(payload.customerName);

  const reference = `storebot:${payload.userId}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`;
  const payerEmail = `cliente+${payload.userId}+${Date.now()}@storebot.app`;

  const nameParts = customerName ? customerName.split(" ").filter(Boolean) : [];
  const payerFirstName = nameParts.length > 0 ? nameParts[0] : "Cliente";
  const payerLastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

  const pixPayment = await createMercadoPagoPixPayment({
    accessToken: payload.config.accessToken,
    amount: sanitizedAmount,
    description: `${payload.config.displayName} - saldo StoreBot`,
    externalReference: reference,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName ?? null,
    },
    notificationUrl: payload.config.notificationUrl,
    expiresAt,
    additionalMetadata: {
      storebot_user_id: payload.userId,
      storebot_customer_whatsapp: customerWhatsapp,
    },
  });

  const chargePublicId = payload.publicId && payload.publicId.trim().length > 0
    ? payload.publicId.trim()
    : randomUUID();
  const expiresAtDate = pixPayment.dateOfExpiration
    ? new Date(pixPayment.dateOfExpiration)
    : expiresAt;

  const metadataPayload: PaymentChargeMetadata = {
    ...(payload.metadata ?? {}),
    createdAt: new Date().toISOString(),
    initialPaymentPayload: pixPayment.raw ?? {},
  };

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_payment_charges (
        public_id,
        user_id,
        provider,
        provider_payment_id,
        status,
        amount,
        currency,
        qr_code,
        qr_code_base64,
        ticket_url,
        expires_at,
        customer_whatsapp,
        customer_name,
        metadata
      ) VALUES (?, ?, 'mercadopago_pix', ?, ?, ?, 'BRL', ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      chargePublicId,
      payload.userId,
      pixPayment.id,
      pixPayment.status,
      Number(sanitizedAmount.toFixed(2)),
      pixPayment.qrCode,
      pixPayment.qrCodeBase64,
      pixPayment.ticketUrl,
      expiresAtDate && Number.isFinite(expiresAtDate.getTime()) ? expiresAtDate : null,
      customerWhatsapp || null,
      customerName,
      JSON.stringify(metadataPayload),
    ],
  );

  const [rows] = await db.query<UserPaymentChargeRow[]>(
    `SELECT * FROM user_payment_charges WHERE public_id = ? LIMIT 1`,
    [chargePublicId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Não foi possível recuperar a cobrança Pix recém-criada.");
  }

  const charge = mapChargeRow(rows[0]);

  if (charge.provider !== "mercadopago_pix") {
    throw new Error("Cobrança criada com provedor inesperado.");
  }

  return charge as MercadoPagoPixCharge;
};

export const createPoloPagPixCharge = async (payload: {
  userId: number;
  amount: number;
  customerWhatsapp: string;
  customerName?: string | null;
  config: PoloPagPixConfig;
  metadata?: PaymentChargeMetadata | null;
  publicId?: string | null;
}): Promise<PoloPagPixCharge> => {
  await ensurePaymentChargeTable();
  const db = getDb();

  if (!payload.config.isConfigured || !payload.config.apiKey) {
    throw new Error("PoloPag Pix não configurado para este usuário.");
  }

  const sanitizedAmount = Number(payload.amount);
  if (!Number.isFinite(sanitizedAmount) || sanitizedAmount <= 0) {
    throw new Error("Valor inválido para geração de cobrança Pix.");
  }

  const expirationMinutes = payload.config.pixExpirationMinutes > 0
    ? payload.config.pixExpirationMinutes
    : DEFAULT_EXPIRATION_MINUTES;
  const expirationSeconds = Math.max(60, Math.min(86400, Math.floor(expirationMinutes * 60)));
  const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

  const customerWhatsapp = payload.customerWhatsapp.trim();
  const customerName = sanitizeOptionalText(payload.customerName);

  const reference = `storebot:${payload.userId}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`;

  const pixCharge = await requestPoloPagPixCharge({
    apiKey: payload.config.apiKey,
    amount: sanitizedAmount,
    expirationSeconds,
    reference,
    description: payload.config.displayName,
    webhookUrl: payload.config.webhookUrl,
  });

  const chargePublicId = payload.publicId && payload.publicId.trim().length > 0
    ? payload.publicId.trim()
    : randomUUID();

  const providerPaymentId = pixCharge.txid || pixCharge.internalId || reference;

  let expiresAtValue: Date | null = expiresAt;
  if (pixCharge.calendario?.expira_em) {
    const parsed = new Date(pixCharge.calendario.expira_em);
    if (Number.isFinite(parsed.getTime())) {
      expiresAtValue = parsed;
    }
  }

  const metadataPayload: PaymentChargeMetadata = {
    ...(payload.metadata ?? {}),
    createdAt: new Date().toISOString(),
    txid: pixCharge.txid ?? null,
    internalId: pixCharge.internalId ?? null,
    reference,
    webhookUrl: payload.config.webhookUrl ?? null,
    initialPaymentPayload: pixCharge.raw ?? {},
  };

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_payment_charges (
        public_id,
        user_id,
        provider,
        provider_payment_id,
        status,
        amount,
        currency,
        qr_code,
        qr_code_base64,
        ticket_url,
        expires_at,
        customer_whatsapp,
        customer_name,
        metadata
      ) VALUES (?, ?, 'polopag_pix', ?, ?, ?, 'BRL', ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      chargePublicId,
      payload.userId,
      providerPaymentId,
      normalizePoloPagStatus(pixCharge.status),
      Number(sanitizedAmount.toFixed(2)),
      pixCharge.pixCopiaECola ?? null,
      pixCharge.qrcodeBase64 ?? null,
      pixCharge.ticketUrl ?? null,
      expiresAtValue,
      customerWhatsapp || null,
      customerName,
      JSON.stringify(metadataPayload),
    ],
  );

  const [rows] = await db.query<UserPaymentChargeRow[]>(
    `SELECT * FROM user_payment_charges WHERE public_id = ? LIMIT 1`,
    [chargePublicId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Não foi possível recuperar a cobrança Pix recém-criada.");
  }

  const charge = mapChargeRow(rows[0]);

  if (charge.provider !== "polopag_pix") {
    throw new Error("Cobrança criada com provedor inesperado.");
  }

  return charge as PoloPagPixCharge;
};

export const createMercadoPagoCheckoutCharge = async (payload: {
  userId: number;
  amount: number;
  customerWhatsapp: string;
  customerName?: string | null;
  customerEmail?: string | null;
  productTitle?: string | null;
  productDescription?: string | null;
  config: MercadoPagoCheckoutConfig;
  metadata?: PaymentChargeMetadata | null;
}): Promise<MercadoPagoCheckoutCharge> => {
  await ensurePaymentChargeTable();
  const db = getDb();

  if (!payload.config.isConfigured || !payload.config.accessToken) {
    throw new Error("Mercado Pago Checkout não configurado para este usuário.");
  }

  const sanitizedAmount = Number(payload.amount);
  if (!Number.isFinite(sanitizedAmount) || sanitizedAmount <= 0) {
    throw new Error("Valor inválido para geração de cobrança no checkout.");
  }

  const customerWhatsapp = payload.customerWhatsapp.trim();
  const customerName = sanitizeOptionalText(payload.customerName);
  const customerEmail = sanitizeOptionalText(payload.customerEmail);

  const checkoutTitle =
    sanitizeOptionalText(payload.productTitle) || payload.config.displayName || DEFAULT_MERCADO_PAGO_CHECKOUT_DISPLAY_NAME;
  const checkoutDescription =
    sanitizeOptionalText(payload.productDescription)
    || `${payload.config.displayName || DEFAULT_MERCADO_PAGO_CHECKOUT_DISPLAY_NAME} - saldo StoreBot`;

  const reference = `storebot:${payload.userId}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`;
  const payerEmail = customerEmail || `cliente+${payload.userId}+${Date.now()}@storebot.app`;

  const nameParts = customerName ? customerName.split(" ").filter(Boolean) : [];
  const payerFirstName = nameParts.length > 0 ? nameParts[0] : "Cliente";
  const payerLastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

  const allowedTypeSet = new Set(payload.config.allowedPaymentTypes);
  const excludedPaymentTypes = CHECKOUT_PAYMENT_TYPES.filter((type) => !allowedTypeSet.has(type));

  const allowedMethodSet = new Set(payload.config.allowedPaymentMethods);
  const excludedPaymentMethods = CHECKOUT_PAYMENT_METHODS.filter((method) => !allowedMethodSet.has(method));

  const preference = await createMercadoPagoCheckoutPreference({
    accessToken: payload.config.accessToken,
    amount: sanitizedAmount,
    title: checkoutTitle,
    description: checkoutDescription,
    externalReference: reference,
    notificationUrl: payload.config.notificationUrl,
    payer: {
      email: payerEmail,
      firstName: payerFirstName,
      lastName: payerLastName ?? null,
    },
    metadata: {
      storebot_user_id: payload.userId,
      storebot_customer_whatsapp: customerWhatsapp,
    },
    excludedPaymentTypes,
    excludedPaymentMethods,
  });

  const chargePublicId = randomUUID();
  const checkoutUrl = preference.initPoint ?? preference.sandboxInitPoint ?? null;

  const metadataPayload: PaymentChargeMetadata = {
    ...(payload.metadata ?? {}),
    createdAt: new Date().toISOString(),
    initialPreferencePayload: preference.raw ?? {},
    productTitle: checkoutTitle,
    productDescription: checkoutDescription,
  };

  await db.query<ResultSetHeader>(
    `
      INSERT INTO user_payment_charges (
        public_id,
        user_id,
        provider,
        provider_payment_id,
        status,
        amount,
        currency,
        qr_code,
        qr_code_base64,
        ticket_url,
        expires_at,
        customer_whatsapp,
        customer_name,
        metadata
      ) VALUES (?, ?, 'mercadopago_checkout', ?, 'pending', ?, 'BRL', NULL, NULL, ?, NULL, ?, ?, ?)
    `,
    [
      chargePublicId,
      payload.userId,
      preference.id,
      Number(sanitizedAmount.toFixed(2)),
      checkoutUrl,
      customerWhatsapp || null,
      customerName,
      JSON.stringify(metadataPayload),
    ],
  );

  const charge = await getPaymentChargeByPublicId(chargePublicId);

  if (!charge || charge.provider !== "mercadopago_checkout") {
    throw new Error("Não foi possível recuperar a cobrança de checkout recém-criada.");
  }

  return charge as MercadoPagoCheckoutCharge;
};

export const getPaymentChargeByPublicId = async (
  publicId: string,
): Promise<PaymentCharge | null> => {
  await ensurePaymentChargeTable();
  const db = getDb();
  const trimmed = publicId.trim();

  const [rows] = await db.query<UserPaymentChargeRow[]>(
    `SELECT * FROM user_payment_charges WHERE public_id = ? LIMIT 1`,
    [trimmed],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapChargeRow(rows[0]);
};

export const getPaymentChargeByProviderPaymentId = async (
  providerPaymentId: string,
): Promise<PaymentCharge | null> => {
  await ensurePaymentChargeTable();
  const db = getDb();
  const trimmed = providerPaymentId.trim();

  if (!trimmed) {
    return null;
  }

  const [rows] = await db.query<UserPaymentChargeRow[]>(
    `SELECT * FROM user_payment_charges WHERE provider_payment_id = ? LIMIT 1`,
    [trimmed],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapChargeRow(rows[0]);
};

export const getMercadoPagoPixChargeByPublicId = async (
  publicId: string,
): Promise<MercadoPagoPixCharge | null> => {
  const charge = await getPaymentChargeByPublicId(publicId);
  return charge && charge.provider === "mercadopago_pix" ? (charge as MercadoPagoPixCharge) : null;
};

export const getMercadoPagoPixChargeByProviderPaymentId = async (
  providerPaymentId: string,
): Promise<MercadoPagoPixCharge | null> => {
  const charge = await getPaymentChargeByProviderPaymentId(providerPaymentId);
  return charge && charge.provider === "mercadopago_pix" ? (charge as MercadoPagoPixCharge) : null;
};

export const getPoloPagPixChargeByPublicId = async (
  publicId: string,
): Promise<PoloPagPixCharge | null> => {
  const charge = await getPaymentChargeByPublicId(publicId);
  return charge && charge.provider === "polopag_pix" ? (charge as PoloPagPixCharge) : null;
};

export const getPoloPagPixChargeByProviderPaymentId = async (
  providerPaymentId: string,
): Promise<PoloPagPixCharge | null> => {
  const charge = await getPaymentChargeByProviderPaymentId(providerPaymentId);
  return charge && charge.provider === "polopag_pix" ? (charge as PoloPagPixCharge) : null;
};

type UpdateChargeStatusInput = {
  chargeId: number;
  status: string;
  statusDetail?: string | null;
  rawPayload?: Record<string, unknown> | null;
  creditResult?: {
    success: boolean;
    amount: number;
    balance: number;
    customerId: number | null;
    customerWhatsapp: string | null;
    creditedAt: string;
    reason?: string | null;
  } | null;
};

export const updatePaymentChargeStatus = async (
  input: UpdateChargeStatusInput,
): Promise<PaymentCharge | null> => {
  await ensurePaymentChargeTable();
  const db = getDb();

  const [existingRows] = await db.query<UserPaymentChargeRow[]>(
    `SELECT * FROM user_payment_charges WHERE id = ? LIMIT 1`,
    [input.chargeId],
  );

  if (!Array.isArray(existingRows) || existingRows.length === 0) {
    return null;
  }

  const existingRow = existingRows[0];
  const metadata = parseChargeMetadata(existingRow.metadata) ?? {};

  const history = Array.isArray(metadata.webhookHistory)
    ? (metadata.webhookHistory as unknown[])
    : [];
  history.push({
    receivedAt: new Date().toISOString(),
    status: input.status,
    statusDetail: input.statusDetail ?? null,
    payload: input.rawPayload ?? null,
  });

  const trimmedHistory = history.slice(-20);

  const metadataPayload: Record<string, unknown> = {
    ...metadata,
    lastPaymentStatus: {
      status: input.status,
      updatedAt: new Date().toISOString(),
      statusDetail: input.statusDetail ?? null,
      payload: input.rawPayload ?? null,
    },
    webhookHistory: trimmedHistory,
  };

  if (input.creditResult) {
    metadataPayload.lastCreditResult = input.creditResult;
  }

  await db.query(
    `
      UPDATE user_payment_charges
      SET status = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [input.status, JSON.stringify(metadataPayload), input.chargeId],
  );

  const [rows] = await db.query<UserPaymentChargeRow[]>(
    `SELECT * FROM user_payment_charges WHERE id = ? LIMIT 1`,
    [input.chargeId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapChargeRow(rows[0]);
};

export const getChargeHistoryForUser = async (
  userId: number,
  limit = 50,
): Promise<PaymentCharge[]> => {
  await ensurePaymentChargeTable();
  const db = getDb();

  const [rows] = await db.query<UserPaymentChargeRow[]>(
    `
      SELECT *
      FROM user_payment_charges
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [userId, limit],
  );

  return rows.map(mapChargeRow);
};

const normalizeChargeNote = (note: string): string => note.trim();

const serializeChargeMetadata = (metadata: PaymentChargeMetadata | null): string | null => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }

  return JSON.stringify(metadata);
};

export const updateChargeAdminNote = async (
  userId: number,
  chargeId: number,
  adminNote: string,
): Promise<PaymentCharge | null> => {
  await ensurePaymentChargeTable();
  const db = getDb();

  const [rows] = await db.query<UserPaymentChargeRow[]>(
    `SELECT * FROM user_payment_charges WHERE id = ? AND user_id = ? LIMIT 1`,
    [chargeId, userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const currentRow = rows[0];
  const existingMetadata = parseChargeMetadata(currentRow.metadata);
  const normalizedNote = normalizeChargeNote(adminNote);
  let nextMetadata: PaymentChargeMetadata | null = existingMetadata ? { ...existingMetadata } : null;

  if (normalizedNote.length > 0) {
    nextMetadata = nextMetadata ? { ...nextMetadata, adminNote: normalizedNote } : { adminNote: normalizedNote };
  } else if (nextMetadata) {
    const rest: PaymentChargeMetadata = { ...nextMetadata };
    delete rest.adminNote;
    nextMetadata = Object.keys(rest).length > 0 ? rest : null;
  }

  const metadataString = serializeChargeMetadata(nextMetadata);

  await db.query(
    `
      UPDATE user_payment_charges
      SET metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [metadataString, chargeId, userId],
  );

  const [updatedRows] = await db.query<UserPaymentChargeRow[]>(
    `SELECT * FROM user_payment_charges WHERE id = ? AND user_id = ? LIMIT 1`,
    [chargeId, userId],
  );

  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    return null;
  }

  return mapChargeRow(updatedRows[0]);
};

export const getApprovedChargeTotalsForUser = async (
  userId: number,
): Promise<{ totalAmount: number; totalCount: number }> => {
  await ensurePaymentChargeTable();
  const db = getDb();

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM user_payment_charges
      WHERE user_id = ? AND LOWER(status) = 'approved'
    `,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      totalAmount: 0,
      totalCount: 0,
    };
  }

  const { total_count: totalCountRaw, total_amount: totalAmountRaw } = rows[0];

  return {
    totalCount: typeof totalCountRaw === "number"
      ? totalCountRaw
      : Number.parseInt(String(totalCountRaw ?? 0), 10) || 0,
    totalAmount: typeof totalAmountRaw === "number"
      ? Number(totalAmountRaw)
      : Number.parseFloat(String(totalAmountRaw ?? 0)) || 0,
  };
};
