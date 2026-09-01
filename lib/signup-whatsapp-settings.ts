import type { RowDataPacket } from "mysql2/promise";

import { getAdminOperationalWuzapiClient } from "lib/admin-operational-instance";
import { ensureAdminSiteSettingsTable, getDb } from "lib/db";

export type SignupWhatsappVerificationMode = "user_sends_code" | "send_code";

export type SignupWhatsappVerificationSettings = {
  enabled: boolean;
  mode: SignupWhatsappVerificationMode;
  targetWhatsappNumber: string | null;
  supportWhatsappNumber: string | null;
  instructions: string;
  supportText: string;
};

type SettingsRow = RowDataPacket & {
  signup_whatsapp_verification_enabled: number | null;
  signup_whatsapp_verification_mode: string | null;
  signup_whatsapp_verification_target_number: string | null;
  signup_whatsapp_verification_instructions: string | null;
  signup_whatsapp_verification_support_text: string | null;
  support_url: string | null;
  support_whatsapp_number: string | null;
};

const DEFAULT_INSTRUCTIONS =
  "Toque em confirmar ou escaneie o QR Code para abrir o WhatsApp. A mensagem ja vai pronta para {{target}} e o numero que enviar sera usado no cadastro.";

const DEFAULT_SUPPORT_TEXT =
  "Se não conseguir confirmar o número, chame o suporte pelo painel ou pelo canal oficial informado no site.";

const normalizeMode = (value: unknown): SignupWhatsappVerificationMode =>
  value === "send_code" ? "send_code" : "user_sends_code";

export const normalizeSignupWhatsappDigits = (value: unknown): string => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\D+/g, "");
};

const nullableText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
};

const ensureSignupWhatsappSettingsColumns = async () => {
  await ensureAdminSiteSettingsTable();
  const db = getDb();

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_site_settings LIKE ?",
      [column],
    );
    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_site_settings ADD COLUMN ${definition}`);
    }
  };

  await Promise.all([
    ensureColumn(
      "signup_whatsapp_verification_enabled",
      "signup_whatsapp_verification_enabled TINYINT(1) NOT NULL DEFAULT 1",
    ),
    ensureColumn(
      "signup_whatsapp_verification_mode",
      "signup_whatsapp_verification_mode VARCHAR(32) NOT NULL DEFAULT 'user_sends_code'",
    ),
    ensureColumn(
      "signup_whatsapp_verification_target_number",
      "signup_whatsapp_verification_target_number VARCHAR(40) NULL",
    ),
    ensureColumn(
      "signup_whatsapp_verification_instructions",
      "signup_whatsapp_verification_instructions TEXT NULL",
    ),
    ensureColumn(
      "signup_whatsapp_verification_support_text",
      "signup_whatsapp_verification_support_text TEXT NULL",
    ),
  ]);
};

const rowToSettings = (row: SettingsRow | null): SignupWhatsappVerificationSettings => ({
  enabled: row?.signup_whatsapp_verification_enabled !== 0,
  mode: normalizeMode(row?.signup_whatsapp_verification_mode),
  targetWhatsappNumber:
    nullableText(row?.signup_whatsapp_verification_target_number, 40) ?? null,
  supportWhatsappNumber: nullableText(row?.support_whatsapp_number, 40) ?? null,
  instructions:
    nullableText(row?.signup_whatsapp_verification_instructions, 1200) ??
    DEFAULT_INSTRUCTIONS,
  supportText:
    nullableText(row?.signup_whatsapp_verification_support_text, 1200) ??
    DEFAULT_SUPPORT_TEXT,
});

export const getSignupWhatsappVerificationSettings = async (): Promise<
  SignupWhatsappVerificationSettings
> => {
  await ensureSignupWhatsappSettingsColumns();
  const db = getDb();
  const [rows] = await db.query<SettingsRow[]>(
    `
      SELECT
        signup_whatsapp_verification_enabled,
        signup_whatsapp_verification_mode,
        signup_whatsapp_verification_target_number,
        signup_whatsapp_verification_instructions,
        signup_whatsapp_verification_support_text,
        support_url,
        support_whatsapp_number
      FROM admin_site_settings
      WHERE id = 1
      LIMIT 1
    `,
  );
  return rowToSettings(Array.isArray(rows) ? rows[0] ?? null : null);
};

export const saveSignupWhatsappVerificationSettings = async (payload: {
  enabled?: unknown;
  mode?: unknown;
  targetWhatsappNumber?: unknown;
  instructions?: unknown;
  supportText?: unknown;
}): Promise<SignupWhatsappVerificationSettings> => {
  await ensureSignupWhatsappSettingsColumns();
  const db = getDb();
  const enabled = payload.enabled !== false;
  const mode = normalizeMode(payload.mode);
  const targetDigits = normalizeSignupWhatsappDigits(payload.targetWhatsappNumber);
  const targetWhatsappNumber = targetDigits ? `+${targetDigits}` : null;
  const instructions = nullableText(payload.instructions, 1200) ?? DEFAULT_INSTRUCTIONS;
  const supportText = nullableText(payload.supportText, 1200) ?? DEFAULT_SUPPORT_TEXT;

  await db.query(
    `
      UPDATE admin_site_settings
      SET
        signup_whatsapp_verification_enabled = ?,
        signup_whatsapp_verification_mode = ?,
        signup_whatsapp_verification_target_number = ?,
        signup_whatsapp_verification_instructions = ?,
        signup_whatsapp_verification_support_text = ?
      WHERE id = 1
    `,
    [enabled ? 1 : 0, mode, targetWhatsappNumber, instructions, supportText],
  );

  return getSignupWhatsappVerificationSettings();
};

export const buildSignupWhatsappDisplayCode = (code: string): string => {
  const digits = normalizeSignupWhatsappDigits(code).slice(0, 6);
  return digits ? `SB-${digits}` : code.trim().toUpperCase();
};

export const buildSignupWhatsappMessage = (code: string): string =>
  `Confirmar cadastro BotAdmin: ${buildSignupWhatsappDisplayCode(code)}`;

export const resolveSignupWhatsappVerificationTarget = async (
  settings?: SignupWhatsappVerificationSettings,
): Promise<{ digits: string; display: string } | null> => {
  const current = settings ?? (await getSignupWhatsappVerificationSettings());
  const configuredDigits = normalizeSignupWhatsappDigits(current.targetWhatsappNumber);
  if (configuredDigits) {
    return { digits: configuredDigits, display: `+${configuredDigits}` };
  }

  const operationalClient = await getAdminOperationalWuzapiClient().catch(() => null);
  const adminWhatsapp = operationalClient?.conversation?.instancePhone ?? null;
  const adminDigits = normalizeSignupWhatsappDigits(adminWhatsapp);
  if (adminDigits) {
    return { digits: adminDigits, display: `+${adminDigits}` };
  }

  const supportDigits = normalizeSignupWhatsappDigits(current.supportWhatsappNumber);
  if (supportDigits) {
    return { digits: supportDigits, display: `+${supportDigits}` };
  }

  return null;
};

export const formatSignupWhatsappInstructions = (params: {
  template: string;
  code: string;
  message: string;
  target: string;
}): string =>
  params.template
    .replaceAll("{{code}}", params.code)
    .replaceAll("{{message}}", params.message)
    .replaceAll("{{target}}", params.target);
