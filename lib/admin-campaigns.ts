import { randomUUID } from "crypto";

import type { RowDataPacket } from "mysql2";

import {
  AdminCampaignContactRow,
  AdminCampaignRow,
  ensureAdminCampaignContactTable,
  ensureAdminCampaignTable,
  ensureUserTable,
  getDb,
} from "./db";
import { getAdminMetaTemplateByTemplateId, resolveMetaTemplateCredentials } from "./admin-meta-templates";
import { getAdminWebhookRow } from "./admin-webhooks";
import { dispatchMetaMessage } from "./meta";
import type { MetaWebhookCredentials } from "./meta";
import { resolveMetaProfileCredentials } from "./meta-profile";
import type {
  AdminCampaignContact,
  AdminCampaignContactStatus,
  AdminCampaignContactsImportOptions,
  AdminCampaignCreatePayload,
  AdminCampaignDetail,
  AdminCampaignStats,
  AdminCampaignSummary,
  AdminCampaignStatus,
} from "types/admin-campaigns";

const DEFAULT_IMPORT_LIMIT = 50_000;

const CAMPAIGN_STATUS_VALUES: AdminCampaignStatus[] = [
  "draft",
  "scheduled",
  "queued",
  "sending",
  "completed",
  "paused",
  "cancelled",
];

const CONTACT_STATUS_VALUES: AdminCampaignContactStatus[] = [
  "pending",
  "queued",
  "sent",
  "failed",
  "skipped",
];

const sanitizeCampaignName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new Error("Informe o nome da campanha.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Informe o nome da campanha.");
  }

  if (trimmed.length > 191) {
    throw new Error("O nome da campanha pode ter no máximo 191 caracteres.");
  }

  return trimmed;
};

const sanitizeDescription = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
};

const sanitizeStatus = (value: unknown): AdminCampaignStatus => {
  if (typeof value !== "string") {
    return "draft";
  }

  const normalized = value.trim().toLowerCase() as AdminCampaignStatus;
  if (CAMPAIGN_STATUS_VALUES.includes(normalized)) {
    return normalized;
  }

  return "draft";
};

const sanitizeContactStatus = (value: unknown): AdminCampaignContactStatus => {
  if (typeof value !== "string") {
    return "pending";
  }

  const normalized = value.trim().toLowerCase() as AdminCampaignContactStatus;
  if (CONTACT_STATUS_VALUES.includes(normalized)) {
    return normalized;
  }

  return "pending";
};

const mapRowToCampaign = (row: AdminCampaignRow, stats: AdminCampaignStats): AdminCampaignSummary => ({
  id: row.id,
  campaignId: row.campaign_id,
  name: row.name,
  description: row.description,
  templateId: row.template_id,
  templateName: row.template_name,
  status: sanitizeStatus(row.status),
  scheduledAt: row.scheduled_at
    ? (row.scheduled_at instanceof Date ? row.scheduled_at.toISOString() : new Date(row.scheduled_at).toISOString())
    : null,
  sendingStartedAt: row.sending_started_at
    ? (row.sending_started_at instanceof Date
        ? row.sending_started_at.toISOString()
        : new Date(row.sending_started_at).toISOString())
    : null,
  sendingCompletedAt: row.sending_completed_at
    ? (row.sending_completed_at instanceof Date
        ? row.sending_completed_at.toISOString()
        : new Date(row.sending_completed_at).toISOString())
    : null,
  lastError: row.last_error ?? null,
  businessAccountId: row.business_account_id ?? null,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  stats,
});

const mapRowToContact = (row: AdminCampaignContactRow): AdminCampaignContact => {
  let variables: Record<string, string> = {};
  if (row.variables) {
    try {
      const parsed = JSON.parse(row.variables) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        variables = Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
          if (typeof value === "string") {
            acc[key] = value;
          } else if (value != null) {
            acc[key] = String(value);
          }
          return acc;
        }, {});
      }
    } catch {
      variables = {};
    }
  }

  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata) as Record<string, unknown>;
      metadata = parsed ?? null;
    } catch {
      metadata = null;
    }
  }

  return {
    id: row.id,
    contactId: row.campaign_contact_id,
    name: row.name,
    phone: row.phone,
    variables,
    status: sanitizeContactStatus(row.status),
    errorMessage: row.error_message,
    metadata,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    sentAt: row.sent_at
      ? (row.sent_at instanceof Date ? row.sent_at.toISOString() : new Date(row.sent_at).toISOString())
      : null,
    attemptCount: Number.isFinite(Number(row.attempt_count)) ? Number(row.attempt_count) : 0,
    lastAttemptAt: row.last_attempt_at
      ? (row.last_attempt_at instanceof Date
          ? row.last_attempt_at.toISOString()
          : new Date(row.last_attempt_at).toISOString())
      : null,
    messageId: row.message_id ?? null,
  };
};

const buildEmptyStats = (): AdminCampaignStats => ({
  totalContacts: 0,
  pendingContacts: 0,
  queuedContacts: 0,
  sentContacts: 0,
  failedContacts: 0,
  skippedContacts: 0,
});

const mapStatsRow = (row: RowDataPacket | null | undefined): AdminCampaignStats => {
  if (!row) {
    return buildEmptyStats();
  }

  const toNumber = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  return {
    totalContacts: toNumber(row.total_contacts),
    pendingContacts: toNumber(row.pending_contacts),
    queuedContacts: toNumber(row.queued_contacts),
    sentContacts: toNumber(row.sent_contacts),
    failedContacts: toNumber(row.failed_contacts),
    skippedContacts: toNumber(row.skipped_contacts),
  };
};

const normalizePhoneNumber = (value: string): string => {
  const digits = value.replace(/[^\d+]/g, "");
  const trimmed = digits.startsWith("+") ? `+${digits.replace(/[^\d]/g, "")}` : digits.replace(/[^\d]/g, "");
  if (!trimmed) {
    return "";
  }
  return trimmed;
};

const splitCsvLine = (line: string, delimiter: string): string[] => {
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;

  const pushCurrent = () => {
    columns.push(current);
    current = "";
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();
  return columns.map((column) => column.trim());
};

const parseCsvContent = (
  raw: string,
  options: { delimiter: string; hasHeader: boolean },
): { headers: string[]; rows: string[][] } => {
  const delimiter = options.delimiter;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  if (!options.hasHeader) {
    const rows = lines.map((line) => splitCsvLine(line, delimiter));
    return { headers: [], rows };
  }

  const [headerLine, ...dataLines] = lines;
  const headers = splitCsvLine(headerLine, delimiter).map((header) => header.toLowerCase());
  const rows = dataLines.map((line) => splitCsvLine(line, delimiter));
  return { headers, rows };
};

const resolveColumnIndex = (column: string, headers: string[]): number => {
  const trimmed = column.trim();
  if (!trimmed) {
    return -1;
  }

  if (headers.length > 0) {
    const headerIndex = headers.findIndex((header) => header === trimmed.toLowerCase());
    if (headerIndex >= 0) {
      return headerIndex;
    }
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.floor(numeric) - 1);
  }

  return -1;
};

const buildContactVariables = (row: string[], mapping: Record<string, string | null>, headers: string[]): Record<string, string> => {
  const variables: Record<string, string> = {};

  for (const [variableKey, column] of Object.entries(mapping)) {
    if (!column) {
      continue;
    }

    const index = resolveColumnIndex(column, headers);
    if (index < 0 || index >= row.length) {
      continue;
    }

    const value = row[index]?.trim();
    if (value) {
      variables[variableKey] = value;
    }
  }

  return variables;
};

type ParsedContact = {
  phone: string;
  name: string | null;
  variables: Record<string, string>;
};

const parseContactsFromCsv = (
  csv: string,
  options: AdminCampaignContactsImportOptions,
): ParsedContact[] => {
  const delimiter = options.delimiter ?? ",";
  const hasHeader = options.hasHeader ?? true;
  const { headers, rows } = parseCsvContent(csv, { delimiter, hasHeader });

  if (rows.length === 0) {
    return [];
  }

  const phoneColumn = options.mapping.phoneColumn;
  const nameColumn = options.mapping.nameColumn ?? null;
  const variableColumns = options.mapping.variableColumns;

  const phoneIndex = resolveColumnIndex(phoneColumn, headers);
  if (phoneIndex < 0) {
    throw new Error("Não foi possível localizar a coluna de telefone na planilha importada.");
  }

  const nameIndex = nameColumn ? resolveColumnIndex(nameColumn, headers) : -1;

  const contacts: ParsedContact[] = [];

  for (const row of rows) {
    const phoneRaw = row[phoneIndex]?.trim();
    if (!phoneRaw) {
      continue;
    }
    const normalizedPhone = normalizePhoneNumber(phoneRaw);
    if (!normalizedPhone) {
      continue;
    }

    const nameValue = nameIndex >= 0 && nameIndex < row.length ? row[nameIndex]?.trim() ?? null : null;
    const variables = buildContactVariables(row, variableColumns, headers);

    contacts.push({
      phone: normalizedPhone,
      name: nameValue || null,
      variables,
    });
  }

  return contacts;
};

export const getAdminCampaigns = async (): Promise<AdminCampaignSummary[]> => {
  await ensureAdminCampaignTable();
  await ensureAdminCampaignContactTable();
  const db = getDb();

  const [rows] = await db.query<(AdminCampaignRow & RowDataPacket)[]>(
    `
      SELECT c.*,
        COALESCE(stats.total_contacts, 0) AS total_contacts,
        COALESCE(stats.pending_contacts, 0) AS pending_contacts,
        COALESCE(stats.queued_contacts, 0) AS queued_contacts,
        COALESCE(stats.sent_contacts, 0) AS sent_contacts,
        COALESCE(stats.failed_contacts, 0) AS failed_contacts,
        COALESCE(stats.skipped_contacts, 0) AS skipped_contacts
      FROM admin_campaigns c
      LEFT JOIN (
        SELECT campaign_id,
          COUNT(*) AS total_contacts,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_contacts,
          SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_contacts,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_contacts,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_contacts,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_contacts
        FROM admin_campaign_contacts
        GROUP BY campaign_id
      ) AS stats ON stats.campaign_id = c.id
      ORDER BY c.created_at DESC
    `,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows.map((row) =>
    mapRowToCampaign(row, mapStatsRow(row as unknown as RowDataPacket)),
  );
};

export const getCampaignRowByPublicId = async (
  campaignId: string,
): Promise<AdminCampaignRow | null> => {
  await ensureAdminCampaignTable();
  const db = getDb();

  const [rows] = await db.query<(AdminCampaignRow & RowDataPacket)[]>(
    `SELECT * FROM admin_campaigns WHERE campaign_id = ? LIMIT 1`,
    [campaignId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

const getCampaignStats = async (campaignId: number): Promise<AdminCampaignStats> => {
  const db = getDb();

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        COUNT(*) AS total_contacts,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_contacts,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_contacts,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_contacts,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_contacts,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_contacts
      FROM admin_campaign_contacts
      WHERE campaign_id = ?
    `,
    [campaignId],
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapStatsRow(row ?? undefined);
};

const getCampaignContacts = async (
  campaignId: number,
  limit = 200,
): Promise<AdminCampaignContact[]> => {
  await ensureAdminCampaignContactTable();
  const db = getDb();

  const [rows] = await db.query<(AdminCampaignContactRow & RowDataPacket)[]>(
    `
      SELECT *
      FROM admin_campaign_contacts
      WHERE campaign_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [campaignId, limit],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows.map(mapRowToContact);
};

export const getAdminCampaignDetail = async (
  campaignId: string,
): Promise<AdminCampaignDetail | null> => {
  const campaign = await getCampaignRowByPublicId(campaignId);
  if (!campaign) {
    return null;
  }

  const stats = await getCampaignStats(campaign.id);
  const contacts = await getCampaignContacts(campaign.id, 500);

  return {
    ...mapRowToCampaign(campaign, stats),
    contacts,
    metaTemplateName: campaign.template_name,
  };
};

export const createAdminCampaign = async (
  payload: AdminCampaignCreatePayload,
  context: { businessAccountId: string },
): Promise<AdminCampaignSummary> => {
  await ensureAdminCampaignTable();
  const name = sanitizeCampaignName(payload.name);
  const description = sanitizeDescription(payload.description);
  const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : null;

  const template = await getAdminMetaTemplateByTemplateId(payload.templateId);
  if (!template) {
    throw new Error("Modelo selecionado não foi encontrado. Sincronize novamente antes de criar a campanha.");
  }

  if (template.businessAccountId && template.businessAccountId !== context.businessAccountId) {
    throw new Error("O modelo selecionado pertence a outra conta Meta. Sincronize os modelos atuais antes de continuar.");
  }

  const db = getDb();
  const campaignId = randomUUID();
  const initialStatus: AdminCampaignStatus = scheduledAt ? "scheduled" : "draft";

  await db.query(
    `
      INSERT INTO admin_campaigns (
        campaign_id,
        name,
        description,
        template_id,
        template_name,
        status,
        scheduled_at,
        business_account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      campaignId,
      name,
      description,
      template.templateId,
      template.name,
      initialStatus,
      scheduledAt,
      context.businessAccountId,
    ],
  );

  const created = await getCampaignRowByPublicId(campaignId);
  if (!created) {
    throw new Error("Não foi possível carregar a campanha criada.");
  }

  return mapRowToCampaign(created, buildEmptyStats());
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  if (items.length === 0) {
    return [];
  }
  if (size <= 0 || items.length <= size) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const importCampaignContacts = async (
  campaign: AdminCampaignRow,
  contacts: ParsedContact[],
): Promise<{ inserted: number; skipped: number }> => {
  if (contacts.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  await ensureAdminCampaignContactTable();
  const db = getDb();

  let inserted = 0;
  let skipped = 0;

  const chunks = chunkArray(contacts, 500);

  for (const chunk of chunks) {
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (const contact of chunk) {
      const variablesJson = JSON.stringify(contact.variables);
      values.push(
        campaign.id,
        randomUUID(),
        contact.name,
        contact.phone,
        variablesJson,
      );
      placeholders.push("(?, ?, ?, ?, ?)");
    }

    try {
      await db.query(
        `
          INSERT INTO admin_campaign_contacts (
            campaign_id,
            campaign_contact_id,
            name,
            phone,
            variables
          ) VALUES ${placeholders.join(",")}
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            variables = VALUES(variables),
            status = 'pending',
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        `,
        values,
      );
      inserted += chunk.length;
    } catch (error) {
      console.error("Falha ao importar contatos da campanha", error);
      skipped += chunk.length;
    }
  }

  return { inserted, skipped };
};

export const addCampaignContact = async (
  campaign: AdminCampaignRow,
  input: { phone: string; name?: string | null; variables?: Record<string, unknown> | null },
): Promise<{ inserted: number; skipped: number }> => {
  const normalizedPhone = normalizePhoneNumber(input.phone ?? "");
  if (!normalizedPhone) {
    throw new Error("Informe um número de telefone válido (incluindo DDI e DDD).");
  }

  const variables = Object.entries(input.variables ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
    const trimmedKey = String(key ?? "").trim();
    if (!trimmedKey) {
      return acc;
    }

    const trimmedValue = typeof value === "string" ? value.trim() : value != null ? String(value).trim() : "";
    if (trimmedValue) {
      acc[trimmedKey] = trimmedValue;
    }

    return acc;
  }, {});

  return importCampaignContacts(campaign, [
    {
      phone: normalizedPhone,
      name: input.name?.trim() ? input.name.trim() : null,
      variables,
    },
  ]);
};

export const importCampaignContactsFromUsers = async (
  campaign: AdminCampaignRow,
  userIds: number[],
): Promise<{ inserted: number; skipped: number; totalFound: number }> => {
  const uniqueIds = Array.from(
    new Set(
      userIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );

  if (uniqueIds.length === 0) {
    throw new Error("Nenhum usuário selecionado para importação.");
  }

  await ensureUserTable();
  const db = getDb();

  const [rows] = await db.query<
    (RowDataPacket & { id: number; name: string; whatsapp_number: string | null })[]
  >(
    `SELECT id, name, whatsapp_number FROM users WHERE id IN (?)`,
    [uniqueIds],
  );

  const totalFound = Array.isArray(rows) ? rows.length : 0;
  if (totalFound === 0) {
    return { inserted: 0, skipped: 0, totalFound: 0 };
  }

  let missingNumbers = 0;
  let duplicateNumbers = 0;

  const uniqueContacts = new Map<string, ParsedContact>();

  for (const row of rows) {
    const phone = normalizePhoneNumber(row.whatsapp_number ?? "");
    if (!phone) {
      missingNumbers += 1;
      continue;
    }

    if (uniqueContacts.has(phone)) {
      duplicateNumbers += 1;
      continue;
    }

    uniqueContacts.set(phone, {
      phone,
      name: row.name?.trim() || null,
      variables: {},
    });
  }

  if (uniqueContacts.size === 0) {
    return {
      inserted: 0,
      skipped: missingNumbers + duplicateNumbers,
      totalFound,
    };
  }

  const { inserted, skipped } = await importCampaignContacts(campaign, Array.from(uniqueContacts.values()));

  return {
    inserted,
    skipped: skipped + missingNumbers + duplicateNumbers,
    totalFound,
  };
};

export const importCampaignContactsFromCsv = async (
  campaign: AdminCampaignRow,
  csvContent: string,
  options: AdminCampaignContactsImportOptions,
): Promise<{ inserted: number; skipped: number; totalFound: number }> => {
  const contacts = parseContactsFromCsv(csvContent, options);
  if (contacts.length > DEFAULT_IMPORT_LIMIT) {
    throw new Error(`Importe no máximo ${DEFAULT_IMPORT_LIMIT} contatos por vez.`);
  }

  const { inserted, skipped } = await importCampaignContacts(campaign, contacts);
  return { inserted, skipped, totalFound: contacts.length };
};

const countPendingContacts = async (campaignId: number): Promise<number> => {
  const db = getDb();

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total
      FROM admin_campaign_contacts
      WHERE campaign_id = ?
        AND status IN ('pending', 'queued')
    `,
    [campaignId],
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const total = row ? Number(row.total ?? 0) : 0;
  return Number.isFinite(total) ? total : 0;
};

export const getAdminCampaignSummary = async (
  campaignId: string,
): Promise<AdminCampaignSummary | null> => {
  const campaign = await getCampaignRowByPublicId(campaignId);
  if (!campaign) {
    return null;
  }

  const stats = await getCampaignStats(campaign.id);
  return mapRowToCampaign(campaign, stats);
};

export const startAdminCampaign = async (
  campaignId: string,
): Promise<AdminCampaignSummary> => {
  const campaign = await getCampaignRowByPublicId(campaignId);

  if (!campaign) {
    throw new Error("Campanha não encontrada.");
  }

  if (!["draft", "paused", "scheduled"].includes(sanitizeStatus(campaign.status))) {
    throw new Error("A campanha já está em execução ou foi concluída.");
  }

  const pendingCount = await countPendingContacts(campaign.id);
  if (pendingCount === 0) {
    throw new Error("Adicione contatos pendentes antes de iniciar a campanha.");
  }

  const db = getDb();

  await db.query(
    `
      UPDATE admin_campaigns
      SET
        status = 'queued',
        scheduled_at = COALESCE(scheduled_at, NOW()),
        sending_started_at = NOW(),
        sending_completed_at = NULL,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [campaign.id],
  );

  const updated = await getCampaignRowByPublicId(campaignId);
  if (!updated) {
    throw new Error("Não foi possível atualizar o status da campanha.");
  }

  const stats = await getCampaignStats(updated.id);
  return mapRowToCampaign(updated, stats);
};

const reserveContactsForDispatch = async (
  campaignId: number,
  limit: number,
): Promise<AdminCampaignContactRow[]> => {
  const db = getDb();

  const [rows] = await db.query<(AdminCampaignContactRow & RowDataPacket)[]>(
    `
      SELECT *
      FROM admin_campaign_contacts
      WHERE campaign_id = ?
        AND status IN ('pending', 'queued')
      ORDER BY status = 'queued' DESC, created_at ASC
      LIMIT ?
    `,
    [campaignId, limit],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const pendingIds = rows.filter((row) => row.status === "pending").map((row) => row.id);

  if (pendingIds.length > 0) {
    const placeholders = pendingIds.map(() => "?").join(", ");
    await db.query(
      `
        UPDATE admin_campaign_contacts
        SET status = 'queued'
        WHERE campaign_id = ? AND id IN (${placeholders})
      `,
      [campaignId, ...pendingIds],
    );

    rows.forEach((row) => {
      if (row.status === "pending") {
        row.status = "queued";
      }
    });
  }

  return rows;
};

const incrementContactAttempt = async (contactId: number) => {
  const db = getDb();
  await db.query(
    `
      UPDATE admin_campaign_contacts
      SET attempt_count = attempt_count + 1, last_attempt_at = NOW()
      WHERE id = ?
    `,
    [contactId],
  );
};

const markContactSent = async (contactId: number, messageId: string | null) => {
  const db = getDb();
  await db.query(
    `
      UPDATE admin_campaign_contacts
      SET
        status = 'sent',
        sent_at = NOW(),
        message_id = ?,
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [messageId, contactId],
  );
};

const markContactFailed = async (contactId: number, errorMessage: string | null) => {
  const db = getDb();
  const normalizedError =
    typeof errorMessage === "string"
      ? errorMessage.slice(0, 1000)
      : errorMessage != null
        ? String(errorMessage).slice(0, 1000)
        : "Falha ao enviar a mensagem.";

  await db.query(
    `
      UPDATE admin_campaign_contacts
      SET
        status = 'failed',
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [normalizedError, contactId],
  );
};

const updateCampaignStatus = async (
  campaignId: number,
  status: AdminCampaignStatus,
  params: { lastError?: string | null; completed?: boolean } = {},
) => {
  const db = getDb();

  const assignments: string[] = ["status = ?"];
  const values: unknown[] = [status];

  if (params.completed) {
    assignments.push("sending_completed_at = NOW()");
  }

  if (typeof params.lastError !== "undefined") {
    assignments.push("last_error = ?");
    values.push(params.lastError ? params.lastError.slice(0, 1000) : null);
  }

  values.push(campaignId);

  await db.query(
    `
      UPDATE admin_campaigns
      SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    values,
  );
};

const extractTemplateVariableIndexes = (text: string | null | undefined): number[] => {
  if (!text) {
    return [];
  }

  const matches = text.matchAll(/{{\s*(\d+)\s*}}/g);
  const indexes = new Set<number>();
  for (const match of matches) {
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index) && index > 0) {
      indexes.add(index);
    }
  }

  return Array.from(indexes).sort((a, b) => a - b);
};

const buildTemplateComponentsPayload = (
  template: Awaited<ReturnType<typeof getAdminMetaTemplateByTemplateId>>,
  contactVariables: Record<string, string>,
) => {
  if (!template) {
    return [];
  }

  const components = template.components ?? [];
  const payloadComponents: Array<Record<string, unknown>> = [];

  for (const component of components) {
    const type = (component.type ?? "").toUpperCase();

    if (type === "BODY") {
      const indexes = extractTemplateVariableIndexes(component.text as string | undefined);
      if (indexes.length > 0) {
        payloadComponents.push({
          type: "body",
          parameters: indexes.map((index) => ({
            type: "text",
            text: contactVariables[String(index)] ?? "",
          })),
        });
      }
    } else if (type === "HEADER" && (component.format ?? "").toUpperCase() === "TEXT") {
      const indexes = extractTemplateVariableIndexes(component.text as string | undefined);
      if (indexes.length > 0) {
        payloadComponents.push({
          type: "header",
          parameters: indexes.map((index) => ({
            type: "text",
            text: contactVariables[String(index)] ?? "",
          })),
        });
      }
    }
  }

  return payloadComponents;
};

const buildTemplateMessagePayload = (
  to: string,
  template: Awaited<ReturnType<typeof getAdminMetaTemplateByTemplateId>>,
  contactVariables: Record<string, string>,
) => {
  if (!template) {
    throw new Error("Modelo da campanha não está mais disponível. Sincronize novamente.");
  }

  const components = buildTemplateComponentsPayload(template, contactVariables);

  const payload: Record<string, unknown> = {
    type: "template",
    template: {
      name: template.templateId,
      language: { code: template.language },
    },
  };

  if (components.length > 0) {
    (payload.template as Record<string, unknown>).components = components;
  }

  return {
    messaging_product: "whatsapp",
    to,
    ...(payload as Record<string, unknown>),
  };
};

export const dispatchAdminCampaign = async (
  campaignId: string,
  options: { batchSize?: number } = {},
): Promise<AdminCampaignSummary> => {
  const campaign = await getCampaignRowByPublicId(campaignId);
  if (!campaign) {
    throw new Error("Campanha não encontrada.");
  }

  try {
    const webhook = await getAdminWebhookRow();
    const templateCredentials = await resolveMetaTemplateCredentials(webhook);
    if (!templateCredentials) {
      throw new Error("Configure as credenciais do bot administrativo antes de enviar campanhas.");
    }

    const profileCredentials = resolveMetaProfileCredentials(webhook);
    if (!profileCredentials) {
      throw new Error(
        "Configure o phone number ID e o token do webhook administrativo antes de enviar campanhas.",
      );
    }

    const template = await getAdminMetaTemplateByTemplateId(campaign.template_id);
    if (!template) {
      throw new Error("Modelo da campanha não está mais disponível. Sincronize novamente.");
    }

    if (
      template.businessAccountId &&
      templateCredentials.businessAccountId &&
      template.businessAccountId !== templateCredentials.businessAccountId
    ) {
      throw new Error(
        "O modelo selecionado pertence a outra conta Meta. Sincronize novamente antes de enviar a campanha.",
      );
    }

    const webhookCredentials: MetaWebhookCredentials = {
      access_token: profileCredentials.accessToken,
      phone_number_id: profileCredentials.phoneNumberId,
    };

    const batchSize = Math.max(1, Math.min(options.batchSize ?? 50, 200));
    let lastError: string | null = null;

    await updateCampaignStatus(campaign.id, "sending");

    while (true) {
      const contacts = await reserveContactsForDispatch(campaign.id, batchSize);
      if (contacts.length === 0) {
        break;
      }

      for (const contact of contacts) {
        await incrementContactAttempt(contact.id);

        const variables = (() => {
          try {
            const parsed = contact.variables ? JSON.parse(contact.variables) : {};
            if (parsed && typeof parsed === "object") {
              return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
                (acc, [key, value]) => {
                  if (typeof value === "string") {
                    acc[key] = value;
                  } else if (value != null) {
                    acc[key] = String(value);
                  }
                  return acc;
                },
                {},
              );
            }
          } catch {
            // ignore parse failure
          }
          return {} as Record<string, string>;
        })();

        try {
          const payload = buildTemplateMessagePayload(contact.phone, template, variables);
          const result = await dispatchMetaMessage(
            webhookCredentials,
            payload,
            {
              successLog: `[Campaign] Mensagem enviada para ${contact.phone}`,
              failureLog: `[Campaign] Falha ao enviar para ${contact.phone}`,
            },
          );

          if (result && result.success) {
            const messageId = Array.isArray(result.messageIds) && result.messageIds.length > 0
              ? result.messageIds[0]
              : null;
            await markContactSent(contact.id, messageId);
          } else {
            lastError = "Erro ao enviar template para o contato.";
            await markContactFailed(contact.id, lastError);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Erro inesperado ao enviar a mensagem.";
          lastError = message;
          await markContactFailed(contact.id, message);
        }
      }
    }

    const pendingAfter = await countPendingContacts(campaign.id);

    if (pendingAfter === 0) {
      await updateCampaignStatus(campaign.id, "completed", {
        completed: true,
        lastError,
      });
    } else {
      await updateCampaignStatus(campaign.id, "queued", {
        lastError,
      });
    }

    const updated = await getCampaignRowByPublicId(campaignId);
    if (!updated) {
      throw new Error("Não foi possível atualizar o status da campanha.");
    }

    const stats = await getCampaignStats(updated.id);
    return mapRowToCampaign(updated, stats);
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Falha ao processar a campanha.";
    try {
      await updateCampaignStatus(campaign.id, "paused", { lastError: message });
    } catch (statusError) {
      console.error(
        "[Campaign Dispatcher] Falha ao registrar erro da campanha",
        statusError,
      );
    }
    throw error;
  }
};

export const dispatchAdminCampaignInBackground = async (
  campaignId: string,
  options?: { batchSize?: number },
) => {
  setTimeout(() => {
    dispatchAdminCampaign(campaignId, options).catch((error) => {
      console.error("[Campaign Dispatcher] Falha ao despachar campanha", error);
    });
  }, 10);
};

export const listDueScheduledAdminCampaigns = async (limit = 10): Promise<string[]> => {
  await ensureAdminCampaignTable();
  await ensureAdminCampaignContactTable();
  const db = getDb();
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 10;

  const [rows] = await db.query<(RowDataPacket & { campaign_id: string })[]>(
    `
      SELECT c.campaign_id
      FROM admin_campaigns c
      INNER JOIN (
        SELECT campaign_id, COUNT(*) AS pending_contacts
        FROM admin_campaign_contacts
        WHERE status IN ('pending', 'queued')
        GROUP BY campaign_id
      ) stats ON stats.campaign_id = c.id
      WHERE c.status = 'scheduled'
        AND c.scheduled_at IS NOT NULL
        AND c.scheduled_at <= NOW()
      ORDER BY c.scheduled_at ASC
      LIMIT ?
    `,
    [normalizedLimit],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows
    .map((row) => (typeof row.campaign_id === "string" ? row.campaign_id : String(row.campaign_id ?? "")).trim())
    .filter((id) => id.length > 0);
};

export const listAdminCampaignsReadyForDispatch = async (
  limit = 5,
): Promise<string[]> => {
  await ensureAdminCampaignTable();
  await ensureAdminCampaignContactTable();
  const db = getDb();
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 5;

  const [rows] = await db.query<(RowDataPacket & { campaign_id: string })[]>(
    `
      SELECT c.campaign_id
      FROM admin_campaigns c
      INNER JOIN (
        SELECT campaign_id, COUNT(*) AS pending_contacts
        FROM admin_campaign_contacts
        WHERE status IN ('pending', 'queued')
        GROUP BY campaign_id
      ) stats ON stats.campaign_id = c.id
      WHERE c.status IN ('queued', 'sending')
      ORDER BY c.updated_at ASC
      LIMIT ?
    `,
    [normalizedLimit],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows
    .map((row) => (typeof row.campaign_id === "string" ? row.campaign_id : String(row.campaign_id ?? "")).trim())
    .filter((id) => id.length > 0);
};

export const markAdminCampaignError = async (
  campaignId: string,
  errorMessage: string | null | undefined,
) => {
  const campaign = await getCampaignRowByPublicId(campaignId);
  if (!campaign) {
    return;
  }

  const normalized =
    typeof errorMessage === "string" && errorMessage.trim().length > 0
      ? errorMessage.trim().slice(0, 1000)
      : "Falha ao processar a campanha.";

  await updateCampaignStatus(campaign.id, "paused", {
    lastError: normalized,
  });
};
