import { ResultSetHeader } from "mysql2";

import type {
  BotResaleMercadoPagoAccountSnapshot,
  BotResalePayoutConfig,
  BotResalePayoutMode,
} from "types/payments";
import { UserPaymentMethodRow, ensurePaymentMethodTable, getDb } from "lib/db";

const PROVIDER = "bot_resale_payout";

const sanitizeText = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const sanitizeMode = (value: unknown): BotResalePayoutMode => {
  const normalized = sanitizeText(value).toLowerCase();
  return normalized === "manual" ? "manual" : "automatic";
};

const parseMercadoPagoAccountSnapshot = (
  value: unknown,
): BotResaleMercadoPagoAccountSnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const parsedId = Number(record.id);
  const validatedAt = sanitizeText(record.validatedAt) || null;
  const nickname = sanitizeText(record.nickname) || null;
  const email = sanitizeText(record.email) || null;
  const firstName = sanitizeText(record.firstName) || null;
  const lastName = sanitizeText(record.lastName) || null;
  const countryId = sanitizeText(record.countryId) || null;
  const siteId = sanitizeText(record.siteId) || null;

  if (
    !validatedAt &&
    !nickname &&
    !email &&
    !firstName &&
    !lastName &&
    !Number.isFinite(parsedId)
  ) {
    return null;
  }

  return {
    id: Number.isFinite(parsedId) ? parsedId : null,
    nickname,
    email,
    firstName,
    lastName,
    countryId,
    siteId,
    validatedAt,
  };
};

const mapRow = (row: UserPaymentMethodRow | null): BotResalePayoutConfig => {
  const defaults: BotResalePayoutConfig = {
    mode: "automatic",
    isActive: false,
    isConfigured: false,
    hasAccessToken: false,
    pixKey: null,
    recipientFullName: null,
    mercadoPagoAccount: null,
    updatedAt: null,
  };

  if (!row) {
    return defaults;
  }

  let credentials: Record<string, unknown> = {};
  let settings: Record<string, unknown> = {};
  let metadata: Record<string, unknown> = {};

  if (row.credentials) {
    try {
      const parsed = JSON.parse(row.credentials) as unknown;
      if (parsed && typeof parsed === "object") {
        credentials = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }

  if (row.settings) {
    try {
      const parsed = JSON.parse(row.settings) as unknown;
      if (parsed && typeof parsed === "object") {
        settings = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }

  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata) as unknown;
      if (parsed && typeof parsed === "object") {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }

  const mode = sanitizeMode(settings.mode);
  const accessToken = sanitizeText(credentials.accessToken) || null;
  const pixKey = sanitizeText(credentials.pixKey) || null;
  const recipientFullName = sanitizeText(credentials.recipientFullName) || null;
  const isConfigured = mode === "automatic"
    ? Boolean(accessToken)
    : Boolean(pixKey && recipientFullName);

  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString();

  return {
    mode,
    isActive: row.is_active === 1 && isConfigured,
    isConfigured,
    accessToken,
    hasAccessToken: Boolean(accessToken),
    pixKey,
    recipientFullName,
    mercadoPagoAccount: parseMercadoPagoAccountSnapshot(metadata.mercadoPagoAccount),
    updatedAt,
  };
};

export const getBotResalePayoutConfigForClient = async (
  userId: number,
): Promise<BotResalePayoutConfig> => {
  const config = await getBotResalePayoutConfigForUser(userId);
  return {
    mode: config.mode,
    isActive: config.isActive,
    isConfigured: config.isConfigured,
    hasAccessToken: config.hasAccessToken,
    pixKey: config.pixKey,
    recipientFullName: config.recipientFullName,
    mercadoPagoAccount: config.mercadoPagoAccount,
    updatedAt: config.updatedAt,
  };
};

export const getBotResalePayoutConfigForUser = async (
  userId: number,
): Promise<BotResalePayoutConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();
  const [rows] = await db.query<UserPaymentMethodRow[]>(
    `SELECT * FROM user_payment_methods WHERE user_id = ? AND provider = ? LIMIT 1`,
    [userId, PROVIDER],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return mapRow(null);
  }

  return mapRow(rows[0]);
};

export const upsertBotResalePayoutConfig = async (payload: {
  userId: number;
  mode: BotResalePayoutMode;
  isActive?: boolean;
  accessToken?: string | null;
  pixKey?: string | null;
  recipientFullName?: string | null;
  mercadoPagoAccount?: BotResaleMercadoPagoAccountSnapshot | null;
}): Promise<BotResalePayoutConfig> => {
  await ensurePaymentMethodTable();
  const db = getDb();

  const mode = payload.mode;
  const accessToken = sanitizeText(payload.accessToken);
  const pixKey = sanitizeText(payload.pixKey);
  const recipientFullName = sanitizeText(payload.recipientFullName);

  if (mode === "automatic" && !accessToken) {
    throw new Error("Informe o access token do Mercado Pago para pagamentos automáticos.");
  }

  if (mode === "manual") {
    if (!pixKey) {
      throw new Error("Informe a chave Pix do recebedor.");
    }
    if (!recipientFullName) {
      throw new Error("Informe o nome completo do recebedor.");
    }
  }

  const isConfigured = mode === "automatic"
    ? Boolean(accessToken)
    : Boolean(pixKey && recipientFullName);
  const isActive = payload.isActive !== false && isConfigured;

  const credentials = JSON.stringify(
    mode === "automatic"
      ? { accessToken }
      : { pixKey, recipientFullName },
  );
  const settings = JSON.stringify({ mode });
  const metadata = payload.mercadoPagoAccount
    ? JSON.stringify({ mercadoPagoAccount: payload.mercadoPagoAccount })
    : mode === "manual"
      ? null
      : undefined;

  const [existingRows] = await db.query<UserPaymentMethodRow[]>(
    `SELECT metadata FROM user_payment_methods WHERE user_id = ? AND provider = ? LIMIT 1`,
    [payload.userId, PROVIDER],
  );
  const existingRow = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;
  let metadataJson: string | null = null;
  if (metadata !== undefined) {
    metadataJson = metadata;
  } else if (existingRow?.metadata) {
    metadataJson = existingRow.metadata;
  }

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
      ) VALUES (?, ?, ?, 'Venda do robô', ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        display_name = VALUES(display_name),
        credentials = VALUES(credentials),
        settings = VALUES(settings),
        metadata = VALUES(metadata)
    `,
    [payload.userId, PROVIDER, isActive ? 1 : 0, credentials, settings, metadataJson],
  );

  return getBotResalePayoutConfigForUser(payload.userId);
};

export const assertBotResalePayoutConfigured = async (userId: number): Promise<BotResalePayoutConfig> => {
  const config = await getBotResalePayoutConfigForUser(userId);
  if (!config.isConfigured) {
    if (config.mode === "manual") {
      throw new Error(
        "Configure os dados Pix (chave e nome do recebedor) em Pagamentos → Pagamentos manual.",
      );
    }
    throw new Error(
      "Configure o access token do Mercado Pago em Pagamentos → Pagamentos automático.",
    );
  }
  return config;
};