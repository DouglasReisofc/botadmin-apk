import { randomBytes, randomUUID } from "crypto";

import {
  ensureWebhookEventTable,
  ensureWebhookTable,
  getDb,
  UserWebhookRow,
  WebhookEventRow,
} from "lib/db";
import type { UserWebhookDetails, WebhookEventSummary } from "types/webhooks";

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

const mapWebhookRow = (row: UserWebhookRow): UserWebhookDetails => ({
  id: row.id,
  endpoint: `${getBaseUrl()}/api/webhooks/meta/${row.id}`,
  verifyToken: row.verify_token,
  appId: row.app_id,
  businessAccountId: row.business_account_id,
  phoneNumberId: row.phone_number_id,
  accessToken: row.access_token,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  lastEventAt: row.last_event_at ? row.last_event_at.toISOString() : null,
});

const mapEventRow = (row: WebhookEventRow): WebhookEventSummary => ({
  id: row.id,
  webhookId: row.webhook_id,
  eventType: row.event_type,
  receivedAt: row.received_at.toISOString(),
  payload: row.payload,
});

export const ensureUserWebhook = async (userId: number) => {
  await ensureWebhookTable();
  const db = getDb();

  const [rows] = await db.query<UserWebhookRow[]>(
    "SELECT * FROM user_webhooks WHERE user_id = ? LIMIT 1",
    [userId],
  );

  if (rows.length) {
    return mapWebhookRow(rows[0]);
  }

  const webhookId = randomUUID();
  const verifyToken = randomBytes(24).toString("hex");
  await db.query(
    `
      INSERT INTO user_webhooks (id, user_id, verify_token)
      VALUES (?, ?, ?)
    `,
    [webhookId, userId, verifyToken],
  );

  const [createdRows] = await db.query<UserWebhookRow[]>(
    "SELECT * FROM user_webhooks WHERE id = ? LIMIT 1",
    [webhookId],
  );

  return createdRows.length ? mapWebhookRow(createdRows[0]) : null;
};

export const getWebhookForUser = async (
  userId: number,
): Promise<UserWebhookDetails | null> => {
  const webhook = await ensureUserWebhook(userId);
  return webhook;
};

export const getWebhookRowForUser = async (
  userId: number,
): Promise<UserWebhookRow | null> => {
  await ensureWebhookTable();
  const db = getDb();

  const [rows] = await db.query<UserWebhookRow[]>(
    "SELECT * FROM user_webhooks WHERE user_id = ? LIMIT 1",
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const getWebhookByPublicId = async (
  webhookId: string,
): Promise<UserWebhookRow | null> => {
  await ensureWebhookTable();
  const db = getDb();

  const [rows] = await db.query<UserWebhookRow[]>(
    "SELECT * FROM user_webhooks WHERE id = ? LIMIT 1",
    [webhookId],
  );

  if (!rows.length) {
    return null;
  }

  return rows[0];
};

export const recordWebhookEvent = async (
  webhookId: string,
  userId: number,
  eventType: string | null,
  payload: unknown,
) => {
  await ensureWebhookEventTable();
  const db = getDb();

  const serializedPayload = JSON.stringify(payload ?? {});

  await db.query(
    `
      INSERT INTO user_webhook_events (webhook_id, user_id, event_type, payload)
      VALUES (?, ?, ?, ?)
    `,
    [webhookId, userId, eventType, serializedPayload],
  );

  await db.query(
    `
      UPDATE user_webhooks
      SET last_event_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [webhookId],
  );
};

export const getRecentWebhookEvents = async (
  userId: number,
  limit = 20,
): Promise<WebhookEventSummary[]> => {
  await ensureWebhookEventTable();
  const db = getDb();

  const [rows] = await db.query<WebhookEventRow[]>(
    `
      SELECT *
      FROM user_webhook_events
      WHERE user_id = ?
      ORDER BY received_at DESC
      LIMIT ?
    `,
    [userId, limit],
  );

  return rows.map(mapEventRow);
};

type WebhookConfigUpdate = {
  verifyToken: string;
  appId: string | null;
  businessAccountId: string | null;
  phoneNumberId: string | null;
  accessToken: string | null;
};

export const updateWebhookConfig = async (
  userId: number,
  config: WebhookConfigUpdate,
): Promise<UserWebhookDetails | null> => {
  await ensureWebhookTable();
  const webhook = await ensureUserWebhook(userId);

  if (!webhook) {
    return null;
  }

  const db = getDb();

  await db.query(
    `
      UPDATE user_webhooks
      SET
        verify_token = ?,
        app_id = ?,
        business_account_id = ?,
        phone_number_id = ?,
        app_secret = NULL,
        phone_number = NULL,
        access_token = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `,
    [
      config.verifyToken,
      config.appId,
      config.businessAccountId,
      config.phoneNumberId,
      config.accessToken,
      userId,
    ],
  );

  const [rows] = await db.query<UserWebhookRow[]>(
    "SELECT * FROM user_webhooks WHERE user_id = ? LIMIT 1",
    [userId],
  );

  if (!rows.length) {
    return null;
  }

  return mapWebhookRow(rows[0]);
};
