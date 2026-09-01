import { randomBytes, randomUUID } from "crypto";

import {
  AdminWebhookEventRow,
  AdminWebhookRow,
  ensureAdminWebhookEventTable,
  ensureAdminWebhookTable,
  getDb,
} from "./db";
import type { AdminWebhookDetails, AdminWebhookEventSummary } from "types/admin-webhooks";

const getBaseUrl = () => {
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
  return "http://localhost:4478";
};

const mapWebhookRow = (row: AdminWebhookRow): AdminWebhookDetails => ({
  id: row.id,
  endpoint: `${getBaseUrl()}/api/webhooks/meta/admin/${row.id}`,
  verifyToken: row.verify_token,
  appId: row.app_id,
  businessAccountId: row.business_account_id,
  phoneNumberId: row.phone_number_id,
  phoneNumber: row.phone_number,
  accessToken: row.access_token,
  createdAt: row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString(),
  lastEventAt: row.last_event_at
    ? (row.last_event_at instanceof Date
        ? row.last_event_at.toISOString()
        : new Date(row.last_event_at).toISOString())
    : null,
});

const mapEventRow = (row: AdminWebhookEventRow): AdminWebhookEventSummary => ({
  id: row.id,
  eventType: row.event_type,
  payload: row.payload,
  receivedAt: row.received_at instanceof Date
    ? row.received_at.toISOString()
    : new Date(row.received_at).toISOString(),
});

export const ensureAdminWebhook = async (): Promise<AdminWebhookDetails> => {
  await ensureAdminWebhookTable();
  const db = getDb();

  const [rows] = await db.query<AdminWebhookRow[]>(
    `SELECT * FROM admin_webhooks ORDER BY created_at ASC LIMIT 1`,
  );

  if (Array.isArray(rows) && rows.length > 0) {
    return mapWebhookRow(rows[0]);
  }

  const id = randomUUID();
  const verifyToken = randomBytes(24).toString("hex");

  await db.query(
    `
      INSERT INTO admin_webhooks (id, verify_token)
      VALUES (?, ?)
    `,
    [id, verifyToken],
  );

  const [createdRows] = await db.query<AdminWebhookRow[]>(
    `SELECT * FROM admin_webhooks WHERE id = ? LIMIT 1`,
    [id],
  );

  if (!Array.isArray(createdRows) || createdRows.length === 0) {
    throw new Error("Falha ao criar o webhook administrativo.");
  }

  return mapWebhookRow(createdRows[0]);
};

export const getAdminWebhookRow = async (): Promise<AdminWebhookRow | null> => {
  await ensureAdminWebhookTable();
  const db = getDb();

  const [rows] = await db.query<AdminWebhookRow[]>(
    `SELECT * FROM admin_webhooks ORDER BY created_at ASC LIMIT 1`,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const getAdminWebhookDetails = async (): Promise<AdminWebhookDetails> => {
  const details = await ensureAdminWebhook();
  return details;
};

export const getAdminWebhookByPublicId = async (
  webhookId: string,
): Promise<AdminWebhookRow | null> => {
  await ensureAdminWebhookTable();
  const db = getDb();

  const [rows] = await db.query<AdminWebhookRow[]>(
    `SELECT * FROM admin_webhooks WHERE id = ? LIMIT 1`,
    [webhookId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const updateAdminWebhookConfig = async (config: {
  verifyToken: string;
  appId: string | null;
  businessAccountId: string | null;
  phoneNumberId: string | null;
  phoneNumber: string | null;
  accessToken: string | null;
}): Promise<AdminWebhookDetails> => {
  const webhook = await ensureAdminWebhook();
  const db = getDb();

  await db.query(
    `
      UPDATE admin_webhooks
      SET
        verify_token = ?,
        app_id = ?,
        business_account_id = ?,
        phone_number_id = ?,
        phone_number = ?,
        access_token = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      config.verifyToken,
      config.appId,
      config.businessAccountId,
      config.phoneNumberId,
      config.phoneNumber,
      config.accessToken,
      webhook.id,
    ],
  );

  const [rows] = await db.query<AdminWebhookRow[]>(
    `SELECT * FROM admin_webhooks WHERE id = ? LIMIT 1`,
    [webhook.id],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Não foi possível carregar o webhook após a atualização.");
  }

  return mapWebhookRow(rows[0]);
};

export const recordAdminWebhookEvent = async (
  webhookId: string,
  eventType: string | null,
  payload: unknown,
) => {
  await ensureAdminWebhookEventTable();
  const db = getDb();

  const serializedPayload = JSON.stringify(payload ?? {});

  await db.query(
    `
      INSERT INTO admin_webhook_events (webhook_id, event_type, payload)
      VALUES (?, ?, ?)
    `,
    [webhookId, eventType, serializedPayload],
  );

  await db.query(
    `
      UPDATE admin_webhooks
      SET last_event_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [webhookId],
  );
};

export const getRecentAdminWebhookEvents = async (
  limit = 25,
): Promise<AdminWebhookEventSummary[]> => {
  await ensureAdminWebhookEventTable();
  const db = getDb();

  const [rows] = await db.query<AdminWebhookEventRow[]>(
    `
      SELECT *
      FROM admin_webhook_events
      ORDER BY received_at DESC
      LIMIT ?
    `,
    [limit],
  );

  return Array.isArray(rows) ? rows.map(mapEventRow) : [];
};
