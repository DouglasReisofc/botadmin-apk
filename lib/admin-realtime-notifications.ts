import { RowDataPacket, ResultSetHeader } from "mysql2";

import { NOTIFICATION_VOICE_ID_SET } from "data/notification-audio";
import { ensureAdminBillingNotificationsTable, getDb } from "./db";
import type { AdminRealtimeNotificationSettings } from "types/admin-notifications";

const DEFAULT_SALES_TEMPLATE =
  "{{customer_name}} realizou uma compra do plano {{plan_name}} no valor de {{amount}}.";
const DEFAULT_SUPPORT_TEMPLATE = "{{customer_name}} disse: {{message}}";
const DEFAULT_VOICE = "ludmilla";

export const DEFAULT_ADMIN_REALTIME_NOTIFICATION_SETTINGS: AdminRealtimeNotificationSettings = {
  salesNotificationsEnabled: true,
  salesTtsEnabled: true,
  supportNotificationsEnabled: true,
  supportTtsEnabled: true,
  speechVoice: DEFAULT_VOICE,
  salesTemplate: DEFAULT_SALES_TEMPLATE,
  supportTemplate: DEFAULT_SUPPORT_TEMPLATE,
  updatedAt: null,
};

type SettingsRow = RowDataPacket & {
  settings: string | Record<string, unknown> | null;
  updated_at: Date | string | null;
};

const bool = (value: unknown, fallback: boolean) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
  return fallback;
};

const text = (value: unknown, fallback: string, max = 240) => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim().slice(0, max);
};

const voice = (value: unknown, fallback = DEFAULT_VOICE) => {
  const candidate = text(value, fallback, 40).toLowerCase();
  return NOTIFICATION_VOICE_ID_SET.has(candidate) ? candidate : fallback;
};

const parseSettings = (raw: unknown, updatedAt: Date | string | null): AdminRealtimeNotificationSettings => {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const realtime = value.realtimeNotifications && typeof value.realtimeNotifications === "object"
    ? value.realtimeNotifications as Record<string, unknown>
    : value;
  return {
    salesNotificationsEnabled: bool(realtime.salesNotificationsEnabled, true),
    salesTtsEnabled: bool(realtime.salesTtsEnabled, true),
    supportNotificationsEnabled: bool(realtime.supportNotificationsEnabled, true),
    supportTtsEnabled: bool(realtime.supportTtsEnabled, true),
    speechVoice: voice(realtime.speechVoice),
    salesTemplate: text(realtime.salesTemplate, DEFAULT_SALES_TEMPLATE),
    supportTemplate: text(realtime.supportTemplate, DEFAULT_SUPPORT_TEMPLATE),
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
  };
};

const parseStored = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim()) {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
};

export const getAdminRealtimeNotificationSettings = async () => {
  await ensureAdminBillingNotificationsTable();
  const db = getDb();
  const [rows] = await db.query<SettingsRow[]>(
    "SELECT settings, updated_at FROM admin_billing_notifications WHERE id = 1 LIMIT 1",
  );
  const row = rows[0];
  const parsed = parseSettings(parseStored(row?.settings), row?.updated_at ?? null);
  return parsed;
};

export const updateAdminRealtimeNotificationSettings = async (
  payload: Partial<AdminRealtimeNotificationSettings>,
) => {
  await ensureAdminBillingNotificationsTable();
  const db = getDb();
  const current = await getAdminRealtimeNotificationSettings();
  const next: AdminRealtimeNotificationSettings = {
    salesNotificationsEnabled: bool(payload.salesNotificationsEnabled, current.salesNotificationsEnabled),
    salesTtsEnabled: bool(payload.salesTtsEnabled, current.salesTtsEnabled),
    supportNotificationsEnabled: bool(payload.supportNotificationsEnabled, current.supportNotificationsEnabled),
    supportTtsEnabled: bool(payload.supportTtsEnabled, current.supportTtsEnabled),
    speechVoice: voice(payload.speechVoice, current.speechVoice),
    salesTemplate: text(payload.salesTemplate, current.salesTemplate),
    supportTemplate: text(payload.supportTemplate, current.supportTemplate),
    updatedAt: new Date().toISOString(),
  };
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT settings FROM admin_billing_notifications WHERE id = 1 LIMIT 1",
  );
  const existing = parseStored(rows[0]?.settings);
  const merged = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
  merged.realtimeNotifications = next;
  await db.query<ResultSetHeader>(
    `INSERT INTO admin_billing_notifications (id, settings, timezone, updated_at)
     VALUES (1, ?, 'America/Sao_Paulo', NOW())
     ON DUPLICATE KEY UPDATE settings = VALUES(settings), updated_at = NOW()`,
    [JSON.stringify(merged)],
  );
  return getAdminRealtimeNotificationSettings();
};

export const ADMIN_REALTIME_NOTIFICATION_VARIABLES = {
  sales: ["{{customer_name}}", "{{plan_name}}", "{{amount}}"],
  support: ["{{customer_name}}", "{{message}}", "{{message_type}}"],
};
