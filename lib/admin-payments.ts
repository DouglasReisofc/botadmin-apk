import { ResultSetHeader } from "mysql2";

import type {
  MercadoPagoCheckoutConfig,
  MercadoPagoCheckoutPaymentMethod,
  MercadoPagoCheckoutPaymentType,
  MercadoPagoPixConfig,
  PaymentConfirmationMessageConfig,
  PaymentMethodSummary,
  PoloPagPixConfig,
} from "types/payments";

import {
  AdminPaymentMethodRow,
  ensureAdminPaymentMethodTable,
  getDb,
} from "./db";
import { getMercadoPagoNotificationUrl, getPoloPagNotificationUrl } from "./payments";

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

const pickFirstTextValue = (
  source: Record<string, unknown>,
  keys: readonly string[],
): string => {
  if (!keys.length) {
    return "";
  }

  const normalizedTargets = keys
    .map((key) => (typeof key === "string" ? key.trim().toLowerCase() : ""))
    .filter((key) => key.length > 0);
  if (normalizedTargets.length === 0) {
    return "";
  }

  const visited = new Set<unknown>();
  const aliasFields = ["key", "name", "label", "field", "id", "type"] as const;
  const valueFields = [
    "value",
    "token",
    "secret",
    "text",
    "val",
    "credential",
    "content",
    "code",
  ] as const;

  const extractPrimitive = (value: unknown, allowZero = false): string => {
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (!allowZero && value === 0) {
        return "";
      }
      return String(value);
    }
    return "";
  };

  const resolveValueFields = (record: Record<string, unknown>): string => {
    for (const field of valueFields) {
      const candidate = extractPrimitive(record[field], true);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  };

  const traverse = (value: unknown, hint: string | null = null): string => {
    if (typeof value === "string" || typeof value === "number") {
      const primitive = extractPrimitive(value, true);
      return hint && primitive ? primitive : "";
    }

    if (!value || typeof value !== "object") {
      return "";
    }

    if (visited.has(value)) {
      return "";
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const entry of value) {
        let nextHint = hint;
        if (!nextHint && entry && typeof entry === "object") {
          for (const alias of aliasFields) {
            const aliasValue = (entry as Record<string, unknown>)[alias];
            if (typeof aliasValue !== "string") {
              continue;
            }
            const normalizedAlias = aliasValue.trim().toLowerCase();
            if (normalizedTargets.includes(normalizedAlias)) {
              nextHint = normalizedAlias;
              break;
            }
          }
        }

        const result = traverse(entry, nextHint);
        if (result && nextHint) {
          return result;
        }
      }
      return "";
    }

    const record = value as Record<string, unknown>;

    if (hint) {
      const directCandidate = resolveValueFields(record);
      if (directCandidate) {
        return directCandidate;
      }
    }

    for (const alias of aliasFields) {
      const aliasValue = record[alias];
      if (typeof aliasValue !== "string") {
        continue;
      }
      const normalizedAlias = aliasValue.trim().toLowerCase();
      if (!normalizedTargets.includes(normalizedAlias)) {
        continue;
      }

      const directCandidate = resolveValueFields(record);
      if (directCandidate) {
        return directCandidate;
      }

      const nestedCandidate = traverse(
        record.value
          ?? record.token
          ?? record.secret
          ?? record.text
          ?? record.val
          ?? record.credential
          ?? record.content
          ?? record.code,
        normalizedAlias,
      );
      if (nestedCandidate) {
        return nestedCandidate;
      }
    }

    for (const [rawKey, rawValue] of Object.entries(record)) {
      const normalizedKey = rawKey.trim().toLowerCase();
      const nextHint = normalizedTargets.includes(normalizedKey) ? normalizedKey : hint;
      const result = traverse(rawValue, nextHint);
      if (result && nextHint) {
        return result;
      }
    }

    return "";
  };

  return traverse(source);
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

const mapPixPaymentMethodRow = (row: AdminPaymentMethodRow | null): MercadoPagoPixConfig => {
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
      console.warn("Failed to parse admin payment credentials", error);
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
      console.warn("Failed to parse admin payment settings", error);
    }
  }

  const accessToken = sanitizeText(
    pickFirstTextValue(credentials, ["accessToken", "access_token", "token", "access-token"]),
  );
  const publicKey = sanitizeOptionalText(
    pickFirstTextValue(credentials, ["publicKey", "public_key", "public-key"]),
  );
  const pixKey = sanitizeOptionalText(
    pickFirstTextValue(credentials, ["pixKey", "pix_key", "pix-key", "key"]),
  );

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

const mapPoloPagPaymentMethodRow = (row: AdminPaymentMethodRow | null): PoloPagPixConfig => {
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
      console.warn("Failed to parse admin PoloPag credentials", error);
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
      console.warn("Failed to parse admin PoloPag settings", error);
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

  const amountOptions = sanitizeAmountOptions(settings.amountOptions ?? DEFAULT_AMOUNT_OPTIONS);
  const normalizedAmountOptions = amountOptions.length > 0 ? amountOptions : Array.from(DEFAULT_AMOUNT_OPTIONS);

  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString();

  return {
    isActive: row.is_active === 1 && apiKey.length > 0,
    displayName: row.display_name?.trim() || DEFAULT_POLOPAG_PIX_DISPLAY_NAME,
    apiKey,
    pixExpirationMinutes,
    amountOptions: normalizedAmountOptions,
    instructions,
    webhookUrl,
    isConfigured: apiKey.length > 0,
    updatedAt,
  } satisfies PoloPagPixConfig;
};

const mapCheckoutPaymentMethodRow = (
  row: AdminPaymentMethodRow | null,
): MercadoPagoCheckoutConfig => {
  const defaultConfig: MercadoPagoCheckoutConfig = {
    isActive: false,
    displayName: DEFAULT_MERCADO_PAGO_CHECKOUT_DISPLAY_NAME,
    accessToken: "",
    publicKey: null,
    notificationUrl: null,
    amountOptions: Array.from(DEFAULT_AMOUNT_OPTIONS),
    allowedPaymentTypes: ["credit_card", "debit_card", "ticket", "bank_transfer"],
    allowedPaymentMethods: ["pix"],
    isConfigured: false,
    marketplaceClientId: "",
    marketplaceClientSecret: "",
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
      console.warn("Failed to parse admin checkout credentials", error);
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
      console.warn("Failed to parse admin checkout settings", error);
    }
  }

  const accessToken = sanitizeText(
    pickFirstTextValue(credentials, ["accessToken", "access_token", "token", "access-token"]),
  );
  const publicKey = sanitizeOptionalText(
    pickFirstTextValue(credentials, ["publicKey", "public_key", "public-key"]),
  );
  const marketplaceClientId = sanitizeText(
    pickFirstTextValue(credentials, ["marketplaceClientId", "marketplace_client_id", "clientId", "client_id"]),
  );
  const marketplaceClientSecret = sanitizeText(
    pickFirstTextValue(credentials, ["marketplaceClientSecret", "marketplace_client_secret", "clientSecret", "client_secret"]),
  );

  const notificationUrl = getMercadoPagoNotificationUrl();

  const amountOptionsRaw = Array.isArray(settings.amountOptions)
    ? settings.amountOptions
    : DEFAULT_AMOUNT_OPTIONS;
  const amountOptions = sanitizeAmountOptions(amountOptionsRaw);

  const allowedPaymentTypes = sanitizeCheckoutPaymentTypes(settings.allowedPaymentTypes);
  const allowedPaymentMethods = sanitizeCheckoutPaymentMethods(settings.allowedPaymentMethods);

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
    allowedPaymentTypes: allowedPaymentTypes.length > 0
      ? allowedPaymentTypes
      : ["credit_card", "debit_card", "ticket", "bank_transfer"],
    allowedPaymentMethods: allowedPaymentMethods.length > 0 ? allowedPaymentMethods : ["pix"],
    isConfigured: accessToken.length > 0,
    marketplaceClientId,
    marketplaceClientSecret,
    updatedAt,
  } satisfies MercadoPagoCheckoutConfig;
};

const mapPaymentConfirmationRow = (
  row: AdminPaymentMethodRow | null,
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
      console.warn("Failed to parse admin confirmation settings", error);
    }
  }

  const messageText = sanitizeText(settings.messageText);
  const buttonLabel = sanitizeText(settings.buttonLabel);
  const mediaPath = sanitizeOptionalMediaPath(settings.mediaPath);
  const mediaUrl = mediaPath ? resolveMediaUrl(mediaPath) : sanitizeOptionalUrl(settings.mediaUrl);

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

export const getAdminMercadoPagoPixConfig = async (): Promise<MercadoPagoPixConfig> => {
  await ensureAdminPaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<AdminPaymentMethodRow[]>(
    `SELECT * FROM admin_payment_methods WHERE provider = 'mercadopago_pix' LIMIT 1`,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapPixPaymentMethodRow(null);
  }

  return mapPixPaymentMethodRow(rows[0]);
};

export const getAdminPoloPagPixConfig = async (): Promise<PoloPagPixConfig> => {
  await ensureAdminPaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<AdminPaymentMethodRow[]>(
    `SELECT * FROM admin_payment_methods WHERE provider = 'polopag_pix' LIMIT 1`,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapPoloPagPaymentMethodRow(null);
  }

  return mapPoloPagPaymentMethodRow(rows[0]);
};

export const getAdminMercadoPagoCheckoutConfig = async (): Promise<MercadoPagoCheckoutConfig> => {
  await ensureAdminPaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<AdminPaymentMethodRow[]>(
    `SELECT * FROM admin_payment_methods WHERE provider = 'mercadopago_checkout' LIMIT 1`,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapCheckoutPaymentMethodRow(null);
  }

  return mapCheckoutPaymentMethodRow(rows[0]);
};

export const getAdminPaymentConfirmationConfig = async (): Promise<PaymentConfirmationMessageConfig> => {
  await ensureAdminPaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<AdminPaymentMethodRow[]>(
    `SELECT * FROM admin_payment_methods WHERE provider = 'payment_confirmation' LIMIT 1`,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapPaymentConfirmationRow(null);
  }

  return mapPaymentConfirmationRow(rows[0]);
};

/**
 * Produz as configurações que podem seguir no carregamento normal do painel.
 * Os valores completos só são entregues depois de reautenticação explícita.
 */
export const protectAdminMercadoPagoPixConfig = (config: MercadoPagoPixConfig) => ({
  ...config,
  accessToken: "",
  publicKey: null,
  pixKey: null,
  credentialFields: {
    accessToken: config.accessToken.trim().length > 0,
    publicKey: Boolean(config.publicKey?.trim()),
    pixKey: Boolean(config.pixKey?.trim()),
  },
});

export const protectAdminPoloPagPixConfig = (config: PoloPagPixConfig) => ({
  ...config,
  apiKey: "",
  credentialFields: {
    apiKey: config.apiKey.trim().length > 0,
  },
});

export const protectAdminMercadoPagoCheckoutConfig = (
  config: MercadoPagoCheckoutConfig,
) => ({
  ...config,
  accessToken: "",
  publicKey: null,
  marketplaceClientSecret: "",
  credentialFields: {
    accessToken: config.accessToken.trim().length > 0,
    publicKey: Boolean(config.publicKey?.trim()),
    marketplaceClientId: Boolean(config.marketplaceClientId?.trim()),
    marketplaceClientSecret: Boolean(config.marketplaceClientSecret?.trim()),
  },
});

export const getAdminPaymentMethodSummaries = async (): Promise<PaymentMethodSummary[]> => {
  const [mpPixConfig, polopagConfig, checkoutConfig] = await Promise.all([
    getAdminMercadoPagoPixConfig(),
    getAdminPoloPagPixConfig(),
    getAdminMercadoPagoCheckoutConfig(),
  ]);

  return [
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
};

export const upsertAdminMercadoPagoPixConfig = async (payload: {
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
  await ensureAdminPaymentMethodTable();
  const db = getDb();

  const sanitizedAccessToken = sanitizeText(payload.accessToken);
  const sanitizedDisplayName =
    payload.displayName?.trim() || DEFAULT_MERCADO_PAGO_PIX_DISPLAY_NAME;
  const sanitizedPublicKey = sanitizeOptionalText(payload.publicKey);
  const sanitizedPixKey = sanitizeOptionalText(payload.pixKey);
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
    pixExpirationMinutes: expirationMinutes,
    amountOptions: normalizedAmountOptions,
    instructions: sanitizedInstructions,
  });

  await db.query<ResultSetHeader>(
    `
      INSERT INTO admin_payment_methods (
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES ('mercadopago_pix', ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        display_name = VALUES(display_name),
        credentials = VALUES(credentials),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [sanitizedAccessToken.length > 0 && payload.isActive ? 1 : 0, sanitizedDisplayName, credentials, settings],
  );

  return getAdminMercadoPagoPixConfig();
};

export const upsertAdminPoloPagPixConfig = async (payload: {
  isActive: boolean;
  displayName?: string | null;
  apiKey: string;
  pixExpirationMinutes?: number;
  amountOptions?: number[];
  instructions?: string | null;
  webhookUrl?: string | null;
}): Promise<PoloPagPixConfig> => {
  await ensureAdminPaymentMethodTable();
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
      INSERT INTO admin_payment_methods (
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES ('polopag_pix', ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        display_name = VALUES(display_name),
        credentials = VALUES(credentials),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [
      sanitizedApiKey.length > 0 && payload.isActive ? 1 : 0,
      sanitizedDisplayName,
      credentials,
      settings,
    ],
  );

  return getAdminPoloPagPixConfig();
};

export const upsertAdminMercadoPagoCheckoutConfig = async (payload: {
  isActive: boolean;
  displayName?: string | null;
  accessToken: string;
  publicKey?: string | null;
  notificationUrl?: string | null;
  amountOptions?: number[];
  allowedPaymentTypes?: MercadoPagoCheckoutPaymentType[];
  allowedPaymentMethods?: MercadoPagoCheckoutPaymentMethod[];
  marketplaceClientId?: string | null;
  marketplaceClientSecret?: string | null;
  clearMarketplaceCredentials?: boolean;
}): Promise<MercadoPagoCheckoutConfig> => {
  await ensureAdminPaymentMethodTable();
  const db = getDb();

  const sanitizedAccessToken = sanitizeText(payload.accessToken);
  const sanitizedDisplayName =
    payload.displayName?.trim() || DEFAULT_MERCADO_PAGO_CHECKOUT_DISPLAY_NAME;
  const sanitizedPublicKey = sanitizeOptionalText(payload.publicKey);
  const currentConfig = await getAdminMercadoPagoCheckoutConfig();
  const sanitizedMarketplaceClientId = payload.clearMarketplaceCredentials
    ? null
    : sanitizeOptionalText(payload.marketplaceClientId) ?? currentConfig.marketplaceClientId ?? null;
  const sanitizedMarketplaceClientSecret = payload.clearMarketplaceCredentials
    ? null
    : sanitizeOptionalText(payload.marketplaceClientSecret) ?? currentConfig.marketplaceClientSecret ?? null;
  const amountOptions = sanitizeAmountOptions(payload.amountOptions ?? DEFAULT_AMOUNT_OPTIONS);
  const normalizedAmountOptions = amountOptions.length > 0 ? amountOptions : Array.from(DEFAULT_AMOUNT_OPTIONS);

  const allowedPaymentTypes = sanitizeCheckoutPaymentTypes(payload.allowedPaymentTypes);
  const allowedPaymentMethods = sanitizeCheckoutPaymentMethods(payload.allowedPaymentMethods);

  const credentials = JSON.stringify({
    accessToken: sanitizedAccessToken,
    publicKey: sanitizedPublicKey,
    marketplaceClientId: sanitizedMarketplaceClientId,
    marketplaceClientSecret: sanitizedMarketplaceClientSecret,
  });

  const settings = JSON.stringify({
    amountOptions: normalizedAmountOptions,
    allowedPaymentTypes: allowedPaymentTypes.length > 0
      ? allowedPaymentTypes
      : ["credit_card", "debit_card", "ticket", "bank_transfer"],
    allowedPaymentMethods: allowedPaymentMethods.length > 0 ? allowedPaymentMethods : ["pix"],
  });

  await db.query<ResultSetHeader>(
    `
      INSERT INTO admin_payment_methods (
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES ('mercadopago_checkout', ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        display_name = VALUES(display_name),
        credentials = VALUES(credentials),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [sanitizedAccessToken.length > 0 && payload.isActive ? 1 : 0, sanitizedDisplayName, credentials, settings],
  );

  return getAdminMercadoPagoCheckoutConfig();
};

export const upsertAdminPaymentConfirmationConfig = async (payload: {
  messageText: string;
  buttonLabel: string;
  mediaPath?: string | null;
  mediaUrl?: string | null;
}): Promise<PaymentConfirmationMessageConfig> => {
  await ensureAdminPaymentMethodTable();
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
      INSERT INTO admin_payment_methods (
        provider,
        is_active,
        display_name,
        credentials,
        settings,
        metadata
      ) VALUES ('payment_confirmation', 1, 'Confirmação de pagamento', NULL, ?, NULL)
      ON DUPLICATE KEY UPDATE
        settings = VALUES(settings),
        updated_at = CURRENT_TIMESTAMP
    `,
    [settings],
  );

  return getAdminPaymentConfirmationConfig();
};
