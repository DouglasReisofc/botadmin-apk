import { ResultSetHeader } from "mysql2";

import type { AdminSmtpSettings, AdminSmtpSettingsPayload } from "types/notifications";

import {
  AdminSmtpSettingsRow,
  ensureAdminSmtpSettingsTable,
  getDb,
} from "./db";

export class AdminSmtpSettingsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminSmtpSettingsError";
    this.status = status;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizeText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.slice(0, maxLength);
};

const sanitizeOptionalText = (value: unknown, maxLength: number): string | null => {
  const sanitized = sanitizeText(value, maxLength);
  return sanitized ? sanitized : null;
};

const sanitizeEmail = (value: unknown, label: string): string => {
  const sanitized = sanitizeText(value, 255);
  if (!sanitized) {
    throw new AdminSmtpSettingsError(`Informe ${label}.`);
  }

  if (!EMAIL_REGEX.test(sanitized)) {
    throw new AdminSmtpSettingsError(`Informe um endereço de e-mail válido para ${label}.`);
  }

  return sanitized;
};

const sanitizeOptionalEmail = (value: unknown): string | null => {
  const sanitized = sanitizeText(value, 255);
  if (!sanitized) {
    return null;
  }

  if (!EMAIL_REGEX.test(sanitized)) {
    throw new AdminSmtpSettingsError("Informe um endereço de e-mail válido.");
  }

  return sanitized;
};

const sanitizePort = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    throw new AdminSmtpSettingsError("Informe a porta SMTP.");
  }

  const port = Math.floor(Number(numeric));
  if (port < 1 || port > 65535) {
    throw new AdminSmtpSettingsError("A porta SMTP deve estar entre 1 e 65535.");
  }

  return port;
};

const mapRowToSettings = (row: AdminSmtpSettingsRow | null): AdminSmtpSettings => {
  if (!row) {
    return {
      host: "",
      port: 587,
      secure: false,
      username: null,
      fromName: "StoreBot",
      fromEmail: "",
      replyTo: null,
      isConfigured: false,
      hasPassword: false,
      updatedAt: null,
    };
  }

  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString();

  const isConfigured = Boolean(row.host && row.from_email);

  return {
    host: row.host,
    port: row.port,
    secure: row.is_secure === 1,
    username: row.username ?? null,
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to ?? null,
    isConfigured,
    hasPassword: Boolean(row.password && row.password.length > 0),
    updatedAt,
  } satisfies AdminSmtpSettings;
};

const mapRowToTransportConfig = (row: AdminSmtpSettingsRow | null) => {
  if (!row || !row.host || !row.from_email) {
    return null;
  }

  return {
    host: row.host,
    port: row.port,
    secure: row.is_secure === 1,
    username: row.username ?? null,
    password: row.password ?? null,
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to ?? null,
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString(),
  };
};

export const getAdminSmtpSettings = async (): Promise<AdminSmtpSettings> => {
  await ensureAdminSmtpSettingsTable();
  const db = getDb();

  const [rows] = await db.query<AdminSmtpSettingsRow[]>(
    `SELECT * FROM admin_smtp_settings WHERE id = 1 LIMIT 1`,
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapRowToSettings(row);
};

export const getAdminSmtpTransportConfig = async () => {
  await ensureAdminSmtpSettingsTable();
  const db = getDb();

  const [rows] = await db.query<AdminSmtpSettingsRow[]>(
    `SELECT * FROM admin_smtp_settings WHERE id = 1 LIMIT 1`,
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapRowToTransportConfig(row);
};

export const saveAdminSmtpSettings = async (
  payload: AdminSmtpSettingsPayload & { passwordAction?: "keep" | "replace" } = {
    host: "",
    port: 0,
    secure: false,
    username: null,
    password: null,
    fromName: "",
    fromEmail: "",
  },
): Promise<AdminSmtpSettings> => {
  await ensureAdminSmtpSettingsTable();
  const db = getDb();

  const currentConfigRow = await (async () => {
    const [rows] = await db.query<AdminSmtpSettingsRow[]>(
      `SELECT * FROM admin_smtp_settings WHERE id = 1 LIMIT 1`,
    );
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  })();

  const host = sanitizeText(payload.host, 255);
  if (!host) {
    throw new AdminSmtpSettingsError("Informe o host SMTP.");
  }

  const port = sanitizePort(payload.port);
  const secure = Boolean(payload.secure);
  const username = sanitizeOptionalText(payload.username, 255);
  const passwordRaw = payload.password ?? null;
  const fromName = sanitizeText(payload.fromName, 255);
  if (!fromName) {
    throw new AdminSmtpSettingsError("Informe o nome do remetente.");
  }

  const fromEmail = sanitizeEmail(payload.fromEmail, "o remetente");
  const replyTo = sanitizeOptionalEmail(payload.replyTo);

  const password = passwordRaw && passwordRaw.trim().length > 0
    ? passwordRaw.trim()
    : currentConfigRow?.password ?? null;

  if (!password) {
    throw new AdminSmtpSettingsError("Informe a senha SMTP.");
  }

  await db.query<ResultSetHeader>(
    `
      INSERT INTO admin_smtp_settings (
        id,
        host,
        port,
        is_secure,
        username,
        password,
        from_name,
        from_email,
        reply_to
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        host = VALUES(host),
        port = VALUES(port),
        is_secure = VALUES(is_secure),
        username = VALUES(username),
        password = VALUES(password),
        from_name = VALUES(from_name),
        from_email = VALUES(from_email),
        reply_to = VALUES(reply_to)
    `,
    [
      host,
      port,
      secure ? 1 : 0,
      username,
      password,
      fromName,
      fromEmail,
      replyTo,
    ],
  );

  return getAdminSmtpSettings();
};
