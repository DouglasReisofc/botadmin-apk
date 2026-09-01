import { RowDataPacket } from "mysql2";

import type {
  AdminEmailTemplate,
  AdminEmailTemplateUpdatePayload,
  EmailTemplateKey,
} from "types/email-templates";

import {
  AdminEmailTemplateRow,
  ensureAdminEmailTemplatesTable,
  getDb,
} from "lib/db";

export class AdminEmailTemplateError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminEmailTemplateError";
    this.status = status;
  }
}

const sanitizeText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
};

const sanitizeOptionalText = (value: unknown, maxLength: number): string | null => {
  const sanitized = sanitizeText(value, maxLength);
  return sanitized ? sanitized : null;
};

const sanitizeHtml = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new AdminEmailTemplateError("Informe o conteúdo do e-mail.");
  }

  if (trimmed.length > 5000) {
    throw new AdminEmailTemplateError("O conteúdo do e-mail pode ter no máximo 5000 caracteres.");
  }

  return trimmed;
};

const mapRowToTemplate = (row: AdminEmailTemplateRow): AdminEmailTemplate => ({
  key: row.template_key,
  name: row.name,
  subject: row.subject,
  heading: row.heading,
  bodyHtml: row.body_html,
  ctaLabel: row.cta_label,
  ctaUrl: row.cta_url,
  footerText: row.footer_text,
  updatedAt: row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString(),
});

export const getAllAdminEmailTemplates = async (): Promise<AdminEmailTemplate[]> => {
  await ensureAdminEmailTemplatesTable();
  const db = getDb();

  const [rows] = await db.query<(AdminEmailTemplateRow & RowDataPacket)[]>(
    `SELECT * FROM admin_email_templates ORDER BY name ASC`,
  );

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => mapRowToTemplate(row));
};

export const getAdminEmailTemplate = async (
  key: EmailTemplateKey | string,
): Promise<AdminEmailTemplate | null> => {
  await ensureAdminEmailTemplatesTable();
  const db = getDb();

  const [rows] = await db.query<(AdminEmailTemplateRow & RowDataPacket)[]>(
    `SELECT * FROM admin_email_templates WHERE template_key = ? LIMIT 1`,
    [key],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapRowToTemplate(rows[0]);
};

export const updateAdminEmailTemplate = async (
  key: EmailTemplateKey | string,
  payload: AdminEmailTemplateUpdatePayload,
): Promise<AdminEmailTemplate> => {
  await ensureAdminEmailTemplatesTable();
  const db = getDb();

  const subject = sanitizeText(payload.subject, 255);
  if (!subject) {
    throw new AdminEmailTemplateError("Informe o assunto do e-mail.");
  }

  const heading = sanitizeText(payload.heading, 255);
  if (!heading) {
    throw new AdminEmailTemplateError("Informe o título exibido no topo do e-mail.");
  }

  const bodyHtml = sanitizeHtml(payload.bodyHtml);
  const ctaLabel = sanitizeOptionalText(payload.ctaLabel, 120);
  const ctaUrl = sanitizeOptionalText(payload.ctaUrl, 255);
  const footerText = sanitizeOptionalText(payload.footerText, 255);

  const [result] = await db.query(
    `
      UPDATE admin_email_templates
      SET
        subject = ?,
        heading = ?,
        body_html = ?,
        cta_label = ?,
        cta_url = ?,
        footer_text = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE template_key = ?
    `,
    [subject, heading, bodyHtml, ctaLabel, ctaUrl, footerText, key],
  );

  if (!("affectedRows" in result) || result.affectedRows === 0) {
    throw new AdminEmailTemplateError("Modelo de e-mail não encontrado.", 404);
  }

  const updated = await getAdminEmailTemplate(key);
  if (!updated) {
    throw new AdminEmailTemplateError("Não foi possível carregar o modelo atualizado.", 500);
  }

  return updated;
};
