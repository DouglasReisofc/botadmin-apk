import { ResultSetHeader } from "mysql2";

import type {
  MegaCredentialSecret,
  MegaCredentials,
  MegaCredentialsPayload,
} from "types/mega";
import {
  AdminMegaCredentialsRow,
  ensureAdminMegaCredentialsTable,
  getDb,
} from "./db";

export class MegaCredentialsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MegaCredentialsError";
    this.status = status;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hasOwn = <T extends object>(obj: T, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const sanitizeOptionalEmail = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > 255) {
    throw new MegaCredentialsError("O e-mail informado é muito longo.");
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    throw new MegaCredentialsError("Informe um e-mail válido do Mega.");
  }

  return trimmed;
};

const sanitizeOptionalPassword = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > 255) {
    throw new MegaCredentialsError("A senha informada é muito longa.");
  }

  if (trimmed.length < 6) {
    throw new MegaCredentialsError("A senha do Mega deve conter pelo menos 6 caracteres.");
  }

  return trimmed;
};

const sanitizeOptionalUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > 500) {
    throw new MegaCredentialsError("A URL do endpoint é muito longa.");
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new MegaCredentialsError("Informe uma URL válida (http/https) para o endpoint externo.");
  }

  return trimmed;
};

const mapRowToCredentials = (row: AdminMegaCredentialsRow | null): MegaCredentials => {
  if (!row) {
    return {
      email: null,
      hasPassword: false,
      updatedAt: null,
      externalAccountsEnabled: false,
      externalAccountsUrl: null,
      hasSession: false,
      sessionEmail: null,
      sessionUpdatedAt: null,
    };
  }

  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString();
  const sessionUpdatedAt = row.session_updated_at
    ? row.session_updated_at instanceof Date
      ? row.session_updated_at.toISOString()
      : new Date(row.session_updated_at).toISOString()
    : null;

  return {
    email: row.email ?? null,
    hasPassword: Boolean(row.password && row.password.length > 0),
    updatedAt,
    externalAccountsEnabled: Boolean(row.external_accounts_enabled),
    externalAccountsUrl: row.external_accounts_url ?? null,
    hasSession: Boolean(row.session_payload),
    sessionEmail: row.session_email ?? null,
    sessionUpdatedAt,
  };
};

const mapRowToSecret = (row: AdminMegaCredentialsRow | null): MegaCredentialSecret => ({
  email: row?.email ?? null,
  password: row?.password ?? null,
  externalAccountsEnabled: Boolean(row?.external_accounts_enabled),
  externalAccountsUrl: row?.external_accounts_url ?? null,
  sessionEmail: row?.session_email ?? null,
  sessionPayload: row?.session_payload ?? null,
  sessionUpdatedAt: row?.session_updated_at
    ? row.session_updated_at instanceof Date
      ? row.session_updated_at.toISOString()
      : new Date(row.session_updated_at).toISOString()
    : null,
});

export const getAdminMegaCredentials = async (): Promise<MegaCredentials> => {
  await ensureAdminMegaCredentialsTable();
  const db = getDb();

  const [rows] = await db.query<AdminMegaCredentialsRow[]>(
    `SELECT * FROM admin_mega_credentials WHERE id = 1 LIMIT 1`,
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapRowToCredentials(row);
};

export const getMegaCredentialSecret = async (): Promise<MegaCredentialSecret> => {
  await ensureAdminMegaCredentialsTable();
  const db = getDb();

  const [rows] = await db.query<AdminMegaCredentialsRow[]>(
    `SELECT * FROM admin_mega_credentials WHERE id = 1 LIMIT 1`,
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapRowToSecret(row);
};

export const requireMegaCredentialSecret = async (): Promise<{
  email: string;
  password: string;
}> => {
  const secret = await getMegaCredentialSecret();
  if (!secret.email || !secret.password) {
    throw new MegaCredentialsError("Credenciais do Mega não configuradas.", 503);
  }
  return { email: secret.email, password: secret.password };
};

export const saveMegaSessionCache = async (sessionEmail: string, payload: string): Promise<void> => {
  await ensureAdminMegaCredentialsTable();
  const db = getDb();
  await db.query(
    `
      UPDATE admin_mega_credentials
      SET session_email = ?, session_payload = ?, session_updated_at = NOW()
      WHERE id = 1
    `,
    [sessionEmail, payload],
  );
};

export const clearMegaSessionCache = async (): Promise<void> => {
  await ensureAdminMegaCredentialsTable();
  const db = getDb();
  await db.query(
    `
      UPDATE admin_mega_credentials
      SET session_email = NULL, session_payload = NULL, session_updated_at = NULL
      WHERE id = 1
    `,
  );
};

export const saveAdminMegaCredentials = async (
  payload: MegaCredentialsPayload,
): Promise<MegaCredentials> => {
  await ensureAdminMegaCredentialsTable();
  const db = getDb();

  const [rows] = await db.query<AdminMegaCredentialsRow[]>(
    `SELECT * FROM admin_mega_credentials WHERE id = 1 LIMIT 1`,
  );
  const currentRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  let emailToStore = currentRow?.email ?? null;
  const emailProvided = hasOwn(payload, "email");
  if (emailProvided) {
    emailToStore = sanitizeOptionalEmail(payload.email ?? null);
  }

  const passwordProvided = hasOwn(payload, "password");
  const clearPassword = Boolean(payload.clearPassword);

  if (clearPassword && passwordProvided) {
    throw new MegaCredentialsError(
      "Selecione apenas uma opção: limpar ou definir uma nova senha.",
    );
  }

  let passwordToStore = currentRow?.password ?? null;
  if (clearPassword) {
    passwordToStore = null;
  } else if (passwordProvided) {
    const sanitizedPassword = sanitizeOptionalPassword(payload.password ?? null);
    if (!sanitizedPassword) {
      throw new MegaCredentialsError("Informe a nova senha do Mega.");
    }
    passwordToStore = sanitizedPassword;
  }

  if ((passwordProvided || clearPassword) && !emailToStore) {
    throw new MegaCredentialsError(
      "Informe o e-mail do Mega antes de atualizar a senha.",
    );
  }

  let externalAccountsEnabled = Boolean(currentRow?.external_accounts_enabled);
  if (hasOwn(payload, "externalAccountsEnabled")) {
    externalAccountsEnabled = Boolean(payload.externalAccountsEnabled);
  }

  let externalAccountsUrl = currentRow?.external_accounts_url ?? null;
  if (hasOwn(payload, "externalAccountsUrl")) {
    externalAccountsUrl = sanitizeOptionalUrl(payload.externalAccountsUrl ?? null);
  }

  let shouldResetSession = Boolean(payload.resetSession);
  if (emailProvided && emailToStore !== (currentRow?.email ?? null)) {
    shouldResetSession = true;
  }
  if ((passwordProvided || clearPassword) && passwordToStore !== (currentRow?.password ?? null)) {
    shouldResetSession = true;
  }
  if (externalAccountsEnabled !== Boolean(currentRow?.external_accounts_enabled)) {
    shouldResetSession = true;
  }
  if (externalAccountsUrl !== (currentRow?.external_accounts_url ?? null)) {
    shouldResetSession = true;
  }

  await db.query<ResultSetHeader>(
    `
      UPDATE admin_mega_credentials
      SET email = ?, password = ?, external_accounts_enabled = ?, external_accounts_url = ?, updated_at = NOW()
      WHERE id = 1
    `,
    [emailToStore, passwordToStore, externalAccountsEnabled ? 1 : 0, externalAccountsUrl],
  );

  if (shouldResetSession) {
    await clearMegaSessionCache();
  }

  return getAdminMegaCredentials();
};
