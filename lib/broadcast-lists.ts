import { randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getDb } from "lib/db";
import { getGoogleSheetsAccessToken } from "lib/google-oauth";
import { getInstanceForUser } from "lib/bot-instances";
import { convertTimezoneLocalToUtc, normalizeTimezoneInput } from "lib/timezones";
import { getGroupInfo, sendChatPresence, sendInteractiveButtons, sendMediaMessage, sendTextMessage, type InteractiveButton, type WuzapiClient } from "lib/wuzapi";

type ContactInput = {
  name?: unknown;
  phone?: unknown;
  jid?: unknown;
  location?: unknown;
  details?: unknown;
  source?: unknown;
  pushName?: unknown;
  attributes?: unknown;
  recipientType?: unknown;
  groupId?: unknown;
  remoteId?: unknown;
  mentionAll?: unknown;
  excludeAdmins?: unknown;
};

type BroadcastMedia = { url: string; mediaType: "image" | "video" | "audio" | "document"; mimeType?: string; fileName?: string };
type BroadcastVariable = {
  name: string;
  type: "contact" | "static" | "greeting" | "datetime" | "api";
  source?: string;
  value?: string;
  timezone?: string;
  format?: "date" | "time" | "datetime";
  morningText?: string;
  afternoonText?: string;
  eveningText?: string;
  apiUrl?: string;
  jsonPath?: string;
  fallback?: string;
};
type BroadcastQuietHours = {
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
  timezone: string;
};
type BroadcastPacing = {
  batchSize: number;
  batchPauseMinMs: number;
  batchPauseMaxMs: number;
};
type BroadcastMessageVariant = {
  templateId?: string;
  name?: string;
  body: string;
  media?: BroadcastMedia | null;
  buttons?: InteractiveButton[];
  variables?: BroadcastVariable[];
};
type BroadcastPayload = {
  media?: BroadcastMedia | null;
  buttons?: InteractiveButton[];
  variables?: BroadcastVariable[];
  quietHours?: BroadcastQuietHours | null;
  pacing?: BroadcastPacing;
  messageVariants?: BroadcastMessageVariant[];
};

type ListRow = RowDataPacket & {
  id: string;
  name: string;
  description: string | null;
  instance_id: number;
  created_at: string;
  updated_at: string;
  contact_count: number;
  last_message: string | null;
  last_run_status: string | null;
  google_sheet_url?: string | null;
  google_sheet_mapping_json?: string | null;
  google_sheet_last_synced_at?: string | null;
};

type ContactRow = RowDataPacket & {
  id: string;
  list_id: string;
  normalized_phone: string;
  phone: string;
  jid: string;
  name: string | null;
  location: string | null;
  details_json: string | null;
  source: string;
  push_name: string | null;
  attributes_json: string | null;
  created_at: string;
  recipient_type?: string | null;
  group_id?: number | null;
  mention_all?: number | boolean | null;
  exclude_admins?: number | boolean | null;
};

type MessageRow = RowDataPacket & {
  id: string;
  list_id: string;
  body: string;
  created_at: string;
  payload_json: string | null;
  is_template?: number;
  template_name?: string | null;
};

let tablesReady: Promise<void> | null = null;
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const clampDelay = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(10_000, Math.min(300_000, Math.round(parsed)));
};

const clampInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
};

const text = (value: unknown, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const flag = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";
const parseJsonObject = (value: string | null): Record<string, string> => {
  try {
    const raw = JSON.parse(value || "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([key, item]) => [key, text(item, 1_000)]));
  } catch { return {}; }
};
const parseJsonRecord = (value: string | null): Record<string, unknown> => {
  try {
    const raw = JSON.parse(value || "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  } catch { return {}; }
};
const parsePayload = (value: string | null): BroadcastPayload => {
  try {
    const raw = JSON.parse(value || "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as BroadcastPayload : {};
  } catch { return {}; }
};
const broadcastMessageSignature = (body: unknown, payload: BroadcastPayload) => JSON.stringify({
  body: text(body, 4_096),
  media: payload.media ?? null,
  buttons: payload.buttons?.length ? payload.buttons : [],
  variables: payload.variables?.length ? payload.variables : [],
  messageVariants: payload.messageVariants?.length ? payload.messageVariants : [],
});
const validTimezone = (value: unknown, fallback = "America/Sao_Paulo") => {
  const candidate = text(value, 80) || fallback;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
};
const minuteOfDay = (value: unknown, fallback: number) => {
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    const [hours, minutes] = value.trim().split(":").map(Number);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) return hours * 60 + minutes;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1439, Math.floor(parsed))) : fallback;
};
const normalizeQuietHours = (value: unknown): BroadcastQuietHours | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!flag(raw.enabled)) return null;
  const startMinutes = minuteOfDay(raw.startMinutes ?? raw.start, 23 * 60);
  const endMinutes = minuteOfDay(raw.endMinutes ?? raw.end, 6 * 60);
  if (startMinutes === endMinutes) return null;
  return {
    enabled: true,
    startMinutes,
    endMinutes,
    timezone: validTimezone(raw.timezone),
  };
};
const normalizeBasePayload = (input: Record<string, unknown>): BroadcastPayload => {
  const rawMedia = input.media;
  const media = rawMedia && typeof rawMedia === "object" && !Array.isArray(rawMedia) ? rawMedia as Record<string, unknown> : null;
  const mediaType = media && ["image", "video", "audio", "document"].includes(String(media.mediaType)) ? String(media.mediaType) as BroadcastMedia["mediaType"] : null;
  const normalizedMedia = mediaType && text(media?.url, 2_000) ? { url: text(media?.url, 2_000), mediaType, mimeType: text(media?.mimeType, 160) || undefined, fileName: text(media?.fileName, 240) || undefined } : null;
  const buttons = Array.isArray(input.buttons) ? input.buttons.slice(0, 3).map((item, index) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { id: text(raw.id, 80) || `broadcast_${index + 1}`, text: text(raw.text, 80), type: ["quick_reply", "cta_url", "cta_copy", "cta_call", "single_select"].includes(String(raw.type)) ? String(raw.type) as InteractiveButton["type"] : "quick_reply", url: text(raw.url, 1_500) || undefined, phoneNumber: text(raw.phoneNumber, 80) || undefined, copyCode: text(raw.copyCode, 300) || undefined };
  }).filter((item) => Boolean(item.text)) : [];
  const variables = Array.isArray(input.variables) ? input.variables.slice(0, 40).map((item) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const rawType = text(raw.type, 24).toLowerCase();
    const type: BroadcastVariable["type"] = ["contact", "static", "greeting", "datetime", "api"].includes(rawType)
      ? rawType as BroadcastVariable["type"]
      : "contact";
    const rawFormat = text(raw.format, 20).toLowerCase();
    return {
      name: text(raw.name, 64).replace(/[^a-zA-Z0-9_]/g, ""),
      type,
      source: text(raw.source, 100) || undefined,
      value: text(raw.value, 2_000) || undefined,
      timezone: validTimezone(raw.timezone),
      format: ["date", "time", "datetime"].includes(rawFormat) ? rawFormat as BroadcastVariable["format"] : "datetime",
      morningText: text(raw.morningText, 160) || "Bom dia",
      afternoonText: text(raw.afternoonText, 160) || "Boa tarde",
      eveningText: text(raw.eveningText, 160) || "Boa noite",
      apiUrl: text(raw.apiUrl, 2_000) || undefined,
      jsonPath: text(raw.jsonPath, 300) || undefined,
      fallback: text(raw.fallback, 1_000) || undefined,
    };
  }).filter((item) => Boolean(item.name && (item.type !== "contact" || item.source))) : [];
  const rawPacing = input.pacing && typeof input.pacing === "object" && !Array.isArray(input.pacing)
    ? input.pacing as Record<string, unknown>
    : {};
  const batchSize = clampInteger(rawPacing.batchSize, 20, 5, 100);
  const batchPauseMinMs = clampInteger(rawPacing.batchPauseMinMs, 180_000, 60_000, 1_800_000);
  const batchPauseMaxMs = Math.max(
    batchPauseMinMs,
    clampInteger(rawPacing.batchPauseMaxMs, 300_000, 60_000, 1_800_000),
  );
  return {
    media: normalizedMedia,
    buttons,
    variables,
    quietHours: normalizeQuietHours(input.quietHours),
    pacing: { batchSize, batchPauseMinMs, batchPauseMaxMs },
  };
};
const normalizePayload = (input: Record<string, unknown>): BroadcastPayload => {
  const payload = normalizeBasePayload(input);
  const messageVariants = Array.isArray(input.messageVariants)
    ? input.messageVariants.slice(0, 30).map((item) => {
        const raw = item && typeof item === "object" && !Array.isArray(item)
          ? item as Record<string, unknown>
          : {};
        const variantPayload = normalizeBasePayload(raw);
        return {
          templateId: text(raw.templateId, 80) || undefined,
          name: text(raw.name, 160) || undefined,
          body: text(raw.body, 4_096),
          media: variantPayload.media,
          buttons: variantPayload.buttons,
          variables: variantPayload.variables,
        } satisfies BroadcastMessageVariant;
      }).filter((item) => Boolean(item.body || item.media || item.buttons?.length))
    : [];
  return {
    ...payload,
    messageVariants: messageVariants.length >= 2 ? messageVariants : undefined,
  };
};
const renderBroadcastTemplate = (body: string, values: Record<string, string>) =>
  body.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => values[key] ?? "");

export const selectBroadcastMessageVariant = (
  body: string,
  payload: BroadcastPayload,
  random = Math.random(),
) => {
  const variants = payload.messageVariants ?? [];
  if (variants.length < 2) return { body, payload };
  const bounded = Math.max(0, Math.min(0.999999999, random));
  const variant = variants[Math.floor(bounded * variants.length)];
  return {
    body: variant.body,
    payload: {
      ...payload,
      media: variant.media ?? null,
      buttons: variant.buttons ?? [],
      variables: variant.variables ?? [],
      messageVariants: undefined,
    } satisfies BroadcastPayload,
  };
};

const localDateParts = (date: Date, timezone: string) => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
) as Record<string, number>;

export const quietHoursDelayMs = (quietHours: BroadcastQuietHours | null | undefined, now = new Date()) => {
  if (!quietHours?.enabled) return 0;
  const parts = localDateParts(now, quietHours.timezone);
  const currentMinutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0);
  const { startMinutes, endMinutes } = quietHours;
  const inside = startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes;
  if (!inside) return 0;
  const remainingMinutes = currentMinutes < endMinutes
    ? endMinutes - currentMinutes
    : 1440 - currentMinutes + endMinutes;
  return Math.max(1_000, remainingMinutes * 60_000 - (parts.second ?? 0) * 1_000);
};

export const nextBroadcastDelayMs = (options: {
  minDelayMs: number;
  maxDelayMs: number;
  completed: number;
  pacing?: BroadcastPacing;
  random?: number;
}) => {
  const pacing = options.pacing ?? {
    batchSize: 20,
    batchPauseMinMs: 180_000,
    batchPauseMaxMs: 300_000,
  };
  const isBatchBoundary = options.completed > 0 && options.completed % pacing.batchSize === 0;
  const minimum = isBatchBoundary ? pacing.batchPauseMinMs : options.minDelayMs;
  const maximum = Math.max(
    minimum,
    isBatchBoundary ? pacing.batchPauseMaxMs : options.maxDelayMs,
  );
  const random = Math.max(0, Math.min(1, options.random ?? Math.random()));
  return {
    delayMs: minimum + Math.round(random * (maximum - minimum)),
    batchPause: isBatchBoundary,
  };
};

const blockedIp = (address: string) => {
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item))) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const assertPublicApiUrl = async (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("A variável de API aceita apenas HTTP ou HTTPS.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("Endereço privado não permitido na variável de API.");
  if (isIP(hostname)) {
    if (blockedIp(hostname)) throw new Error("Endereço privado não permitido na variável de API.");
  } else {
    const addresses = await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((item) => blockedIp(item.address))) throw new Error("A API informada resolve para um endereço privado.");
  }
  return url;
};

const fetchBroadcastJson = async (value: string): Promise<unknown> => {
  let url = await assertPublicApiUrl(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json", "user-agent": "BotAdmin-Broadcast/1.0" },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = await assertPublicApiUrl(new URL(response.headers.get("location")!, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`API respondeu HTTP ${response.status}.`);
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error("Resposta da API excede 1 MB.");
    return JSON.parse(raw);
  }
  throw new Error("A API excedeu o limite de redirecionamentos.");
};

const jsonPathValue = (value: unknown, path: string): unknown => {
  if (!path.trim()) return value;
  const tokens = path.replace(/\[(\d+)\]/g, ".$1").split(".").map((item) => item.trim()).filter(Boolean);
  let current = value;
  for (const token of tokens) {
    if (Array.isArray(current)) current = current[Number(token)];
    else if (current && typeof current === "object") current = (current as Record<string, unknown>)[token];
    else return undefined;
  }
  return current;
};

const stringifyVariableValue = (value: unknown) => value == null
  ? ""
  : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);

const resolveContactTemplate = async (body: string, contact: BroadcastContact, variables: BroadcastVariable[] = []) => {
  const values: Record<string, string> = { nome: contact.name, name: contact.name, pushname: contact.pushName, pushName: contact.pushName, numero: contact.phone, phone: contact.phone, localizacao: contact.location, location: contact.location, detalhes: contact.details, details: contact.details, ...contact.attributes };
  for (const variable of variables) {
    try {
      if (variable.type === "static") values[variable.name] = variable.value ?? "";
      else if (variable.type === "greeting") {
        const hour = localDateParts(new Date(), variable.timezone ?? "America/Sao_Paulo").hour ?? 0;
        values[variable.name] = hour < 12 ? variable.morningText ?? "Bom dia" : hour < 18 ? variable.afternoonText ?? "Boa tarde" : variable.eveningText ?? "Boa noite";
      } else if (variable.type === "datetime") {
        const format = variable.format ?? "datetime";
        values[variable.name] = new Intl.DateTimeFormat("pt-BR", {
          timeZone: validTimezone(variable.timezone),
          ...(format !== "time" ? { dateStyle: "short" as const } : {}),
          ...(format !== "date" ? { timeStyle: "short" as const } : {}),
        }).format(new Date());
      } else if (variable.type === "api" && variable.apiUrl) {
        const url = renderBroadcastTemplate(variable.apiUrl, values);
        const response = await fetchBroadcastJson(url);
        values[variable.name] = stringifyVariableValue(jsonPathValue(response, variable.jsonPath ?? "")) || variable.fallback || "";
      } else {
        const source = variable.source ?? "";
        values[variable.name] = values[source] ?? contact.attributes[source] ?? variable.fallback ?? "";
      }
    } catch (error) {
      console.warn("[broadcast] variável dinâmica não resolvida", { name: variable.name, type: variable.type, error: error instanceof Error ? error.message : String(error) });
      values[variable.name] = variable.fallback ?? "";
    }
  }
  return renderBroadcastTemplate(body, values);
};

export type BroadcastContact = {
  id?: string;
  phone: string;
  jid: string;
  name: string;
  location: string;
  details: string;
  source: string;
  pushName: string;
  attributes: Record<string, string>;
  recipientType: "contact" | "group";
  groupId: number | null;
  mentionAll: boolean;
  excludeAdmins: boolean;
};

type BroadcastRunRecipient = BroadcastContact & { runPosition: number };

const activeBroadcastRuns = new Set<string>();

export type BroadcastListSummary = {
  id: string;
  name: string;
  description: string;
  instanceId: number;
  contactCount: number;
  lastMessage: string;
  lastRunStatus: string;
  createdAt: string;
  updatedAt: string;
};

const ensureTables = async () => {
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_broadcast_lists (
        id CHAR(36) PRIMARY KEY,
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        name VARCHAR(160) NOT NULL,
        description VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_broadcast_lists_owner (user_id, instance_id, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_broadcast_contacts (
        id CHAR(36) PRIMARY KEY,
        list_id CHAR(36) NOT NULL,
        normalized_phone VARCHAR(32) NOT NULL,
        phone VARCHAR(32) NOT NULL,
        jid VARCHAR(64) NOT NULL,
        name VARCHAR(160) NULL,
        push_name VARCHAR(160) NULL,
        location VARCHAR(240) NULL,
        details_json JSON NULL,
        attributes_json JSON NULL,
        source VARCHAR(32) NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_broadcast_contact_phone (list_id, normalized_phone),
        INDEX idx_broadcast_contacts_list (list_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_broadcast_messages (
        id CHAR(36) PRIMARY KEY,
        list_id CHAR(36) NOT NULL,
        body TEXT NOT NULL,
        payload_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_broadcast_messages_list (list_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    // Existing installations created before custom fields/media support are
    // upgraded in place. MySQL has no portable ADD COLUMN IF NOT EXISTS.
    const addColumn = async (table: string, column: string, definition: string) => {
      const [rows] = await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
      if (!rows.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    };
    await addColumn("bot_broadcast_contacts", "push_name", "push_name VARCHAR(160) NULL AFTER name");
    await addColumn("bot_broadcast_contacts", "attributes_json", "attributes_json JSON NULL AFTER details_json");
    await addColumn("bot_broadcast_contacts", "recipient_type", "recipient_type VARCHAR(16) NOT NULL DEFAULT 'contact' AFTER list_id");
    await addColumn("bot_broadcast_contacts", "group_id", "group_id INT NULL AFTER recipient_type");
    await addColumn("bot_broadcast_contacts", "mention_all", "mention_all TINYINT(1) NOT NULL DEFAULT 0 AFTER group_id");
    await addColumn("bot_broadcast_contacts", "exclude_admins", "exclude_admins TINYINT(1) NOT NULL DEFAULT 0 AFTER mention_all");
    await addColumn("bot_broadcast_messages", "payload_json", "payload_json JSON NULL AFTER body");
    await addColumn("bot_broadcast_messages", "is_template", "is_template TINYINT(1) NOT NULL DEFAULT 0 AFTER payload_json");
    await addColumn("bot_broadcast_messages", "template_name", "template_name VARCHAR(160) NULL AFTER is_template");
    await addColumn("bot_broadcast_lists", "google_sheet_url", "google_sheet_url TEXT NULL AFTER description");
    await addColumn("bot_broadcast_lists", "google_sheet_mapping_json", "google_sheet_mapping_json JSON NULL AFTER google_sheet_url");
    await addColumn("bot_broadcast_lists", "google_sheet_last_synced_at", "google_sheet_last_synced_at TIMESTAMP NULL AFTER google_sheet_mapping_json");
    await addColumn("bot_broadcast_lists", "legacy_campaign_id", "legacy_campaign_id INT NULL AFTER google_sheet_last_synced_at");
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_broadcast_runs (
        id CHAR(36) PRIMARY KEY,
        list_id CHAR(36) NOT NULL,
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        message_id CHAR(36) NULL,
        schedule_id CHAR(36) NULL,
        status ENUM('queued','running','completed','completed_with_errors','failed') NOT NULL DEFAULT 'queued',
        typing_enabled TINYINT(1) NOT NULL DEFAULT 1,
        min_delay_ms INT NOT NULL DEFAULT 30000,
        max_delay_ms INT NOT NULL DEFAULT 60000,
        total_count INT NOT NULL DEFAULT 0,
        sent_count INT NOT NULL DEFAULT 0,
        failed_count INT NOT NULL DEFAULT 0,
        error_message TEXT NULL,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_broadcast_runs_list (list_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_broadcast_schedules (
        id CHAR(36) PRIMARY KEY,
        list_id CHAR(36) NOT NULL,
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        body TEXT NOT NULL,
        payload_json JSON NULL,
        typing_enabled TINYINT(1) NOT NULL DEFAULT 1,
        min_delay_ms INT NOT NULL DEFAULT 30000,
        max_delay_ms INT NOT NULL DEFAULT 60000,
        scheduled_for DATETIME NOT NULL,
        status ENUM('pending','dispatched','failed','cancelled') NOT NULL DEFAULT 'pending',
        run_id CHAR(36) NULL,
        message_id CHAR(36) NULL,
        error_message TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_broadcast_schedule_due (status, scheduled_for),
        INDEX idx_broadcast_schedule_list (list_id, scheduled_for)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await addColumn("bot_broadcast_schedules", "recurrence_minutes", "recurrence_minutes INT NULL AFTER scheduled_for");
    await addColumn("bot_broadcast_schedules", "occurrence_count", "occurrence_count INT NOT NULL DEFAULT 0 AFTER recurrence_minutes");
    await addColumn("bot_broadcast_schedules", "message_id", "message_id CHAR(36) NULL AFTER run_id");
    await addColumn("bot_broadcast_runs", "schedule_id", "schedule_id CHAR(36) NULL AFTER message_id");
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_broadcast_run_contacts (
        id CHAR(36) PRIMARY KEY,
        run_id CHAR(36) NOT NULL,
        contact_id CHAR(36) NULL,
        position INT NOT NULL,
        phone VARCHAR(32) NOT NULL,
        name VARCHAR(160) NULL,
        status ENUM('pending','sending','sent','failed') NOT NULL DEFAULT 'pending',
        scheduled_at DATETIME NULL,
        started_at DATETIME NULL,
        completed_at DATETIME NULL,
        error_message TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_broadcast_run_position (run_id, position),
        INDEX idx_broadcast_run_contacts (run_id, status, position)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await addColumn("bot_broadcast_run_contacts", "recipient_type", "recipient_type VARCHAR(16) NOT NULL DEFAULT 'contact' AFTER contact_id");
    await addColumn("bot_broadcast_run_contacts", "jid", "jid VARCHAR(64) NULL AFTER phone");
    await addColumn("bot_broadcast_run_contacts", "group_id", "group_id INT NULL AFTER recipient_type");
    await addColumn("bot_broadcast_run_contacts", "mention_all", "mention_all TINYINT(1) NOT NULL DEFAULT 0 AFTER group_id");
    await addColumn("bot_broadcast_run_contacts", "exclude_admins", "exclude_admins TINYINT(1) NOT NULL DEFAULT 0 AFTER mention_all");

    // Older recurring schedules created one message row on every occurrence.
    // Consolidate those rows onto the newest matching message so the history
    // represents the configured transmission once, while preserving every run
    // for delivery totals and detailed progress.
    const [legacySchedules] = await db.query<RowDataPacket[]>(`
      SELECT id,list_id,body,payload_json,created_at
        FROM bot_broadcast_schedules
       WHERE message_id IS NULL
       ORDER BY list_id,created_at ASC
    `);
    for (const schedule of legacySchedules) {
      const [candidates] = await db.query<RowDataPacket[]>(`
        SELECT r.id AS run_id,m.id AS message_id,m.payload_json,r.created_at
          FROM bot_broadcast_runs r
          INNER JOIN bot_broadcast_messages m ON m.id=r.message_id
         WHERE r.list_id=? AND m.body=? AND r.created_at>=?
         ORDER BY r.created_at DESC
      `, [schedule.list_id, schedule.body, schedule.created_at]);
      const expectedSignature = broadcastMessageSignature(
        schedule.body,
        parsePayload(schedule.payload_json == null ? null : String(schedule.payload_json)),
      );
      const matching = candidates.filter((row) =>
        broadcastMessageSignature(
          schedule.body,
          parsePayload(row.payload_json == null ? null : String(row.payload_json)),
        ) === expectedSignature,
      );
      const canonicalMessageId = matching[0]?.message_id ? String(matching[0].message_id) : "";
      if (!canonicalMessageId) continue;
      await db.query("UPDATE bot_broadcast_schedules SET message_id=? WHERE id=? AND message_id IS NULL", [canonicalMessageId, schedule.id]);
      for (const row of matching) {
        await db.query("UPDATE bot_broadcast_runs SET schedule_id=?,message_id=? WHERE id=? AND schedule_id IS NULL", [schedule.id, canonicalMessageId, row.run_id]);
      }
    }
  })().catch((error) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
};

export const normalizeBroadcastPhone = (value: unknown): { key: string; phone: string; jid: string } | null => {
  const raw = typeof value === "string" ? value : "";
  let digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Brazilian phones are deduplicated with or without the ninth digit.
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith("55") || digits.length < 12 || digits.length > 13) return null;
  const area = digits.slice(2, 4);
  let subscriber = digits.slice(4);
  if (subscriber.length === 9 && subscriber.startsWith("9")) subscriber = subscriber.slice(1);
  if (subscriber.length !== 8) return null;
  const key = `55${area}${subscriber}`;
  const phone = digits.length === 12 ? `55${area}9${subscriber}` : digits;
  return { key, phone, jid: `${phone}@s.whatsapp.net` };
};

const contactFromInput = (input: ContactInput): BroadcastContact | null => {
  const candidate = text(input.phone, 64) || text(input.jid, 80);
  const normalized = normalizeBroadcastPhone(candidate);
  if (!normalized) return null;
  const rawAttributes = input.attributes && typeof input.attributes === "object" && !Array.isArray(input.attributes) ? input.attributes as Record<string, unknown> : {};
  const attributes = Object.fromEntries(Object.entries(rawAttributes).map(([key, value]) => [text(key, 64), text(value, 1000)]).filter(([key]) => Boolean(key)));
  return {
    phone: normalized.phone,
    jid: normalized.jid,
    name: text(input.name, 160),
    location: text(input.location, 240),
    details: text(input.details, 4_000),
    source: text(input.source, 32) || "manual",
    pushName: text(input.pushName, 160),
    attributes,
    recipientType: "contact",
    groupId: null,
    mentionAll: false,
    excludeAdmins: false,
  };
};

const groupFromInput = (input: ContactInput): BroadcastContact | null => {
  const candidate = text(input.remoteId, 80) || text(input.jid, 80) || text(input.phone, 80);
  const digits = candidate.split("@")[0]?.replace(/\D+/g, "") ?? "";
  if (!digits || !/^120363\d{6,}$/.test(digits)) return null;
  const jid = `${digits}@g.us`;
  const rawAttributes = input.attributes && typeof input.attributes === "object" && !Array.isArray(input.attributes) ? input.attributes as Record<string, unknown> : {};
  const attributes = Object.fromEntries(Object.entries(rawAttributes).map(([key, value]) => [text(key, 64), text(value, 1000)]).filter(([key]) => Boolean(key)));
  const parsedGroupId = Number(input.groupId);
  return {
    phone: jid,
    jid,
    name: text(input.name, 160) || "Grupo do WhatsApp",
    location: "",
    details: text(input.details, 4_000),
    source: text(input.source, 32) || "instance_group",
    pushName: "",
    attributes,
    recipientType: "group",
    groupId: Number.isFinite(parsedGroupId) && parsedGroupId > 0 ? Math.floor(parsedGroupId) : null,
    mentionAll: flag(input.mentionAll),
    excludeAdmins: flag(input.excludeAdmins),
  };
};

const recipientFromInput = (input: ContactInput): BroadcastContact | null =>
  text(input.recipientType, 16).toLowerCase() === "group" || text(input.remoteId, 80).endsWith("@g.us") || text(input.jid, 80).endsWith("@g.us")
    ? groupFromInput(input)
    : contactFromInput(input);

const contactKey = (contact: BroadcastContact) => contact.recipientType === "group"
  ? `g:${contact.jid.split("@")[0]}`
  : normalizeBroadcastPhone(contact.phone)?.key ?? contact.phone;

const listSummary = (row: ListRow): BroadcastListSummary => ({
  id: row.id,
  name: row.name,
  description: row.description ?? "",
  instanceId: Number(row.instance_id),
  contactCount: Number(row.contact_count ?? 0),
  lastMessage: row.last_message ?? "",
  lastRunStatus: row.last_run_status ?? "",
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const ensureListAccess = async (userId: number, instanceId: number, listId: string) => {
  await ensureTables();
  const [rows] = await getDb().query<ListRow[]>(
    "SELECT id,name,description,instance_id,created_at,updated_at,google_sheet_url,google_sheet_mapping_json,google_sheet_last_synced_at,0 contact_count,NULL last_message,NULL last_run_status FROM bot_broadcast_lists WHERE id=? AND user_id=? AND instance_id=? LIMIT 1",
    [listId, userId, instanceId],
  );
  return rows[0] ?? null;
};

export const listBroadcastLists = async (userId: number, instanceId: number) => {
  await ensureTables();
  const [rows] = await getDb().query<ListRow[]>(`
    SELECT l.id,l.name,l.description,l.instance_id,l.created_at,l.updated_at,
      (SELECT COUNT(*) FROM bot_broadcast_contacts c WHERE c.list_id=l.id) AS contact_count,
      (SELECT m.body FROM bot_broadcast_messages m WHERE m.list_id=l.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
      (SELECT r.status FROM bot_broadcast_runs r WHERE r.list_id=l.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_status
    FROM bot_broadcast_lists l WHERE l.user_id=? AND l.instance_id=? ORDER BY l.updated_at DESC`, [userId, instanceId]);
  return rows.map(listSummary);
};

export const getBroadcastList = async (userId: number, instanceId: number, listId: string) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) return null;
  const db = getDb();
  const [contacts] = await db.query<ContactRow[]>("SELECT * FROM bot_broadcast_contacts WHERE list_id=? ORDER BY name ASC,phone ASC", [listId]);
  const [messages] = await db.query<MessageRow[]>(`SELECT m.* FROM bot_broadcast_messages m
    WHERE m.list_id=? AND m.is_template=0
      AND EXISTS (SELECT 1 FROM bot_broadcast_runs r WHERE r.message_id=m.id)
    ORDER BY m.created_at ASC LIMIT 100`, [listId]);
  const [templates] = await db.query<MessageRow[]>("SELECT * FROM bot_broadcast_messages WHERE list_id=? AND is_template=1 ORDER BY created_at DESC LIMIT 100", [listId]);
  const [runs] = await db.query<RowDataPacket[]>("SELECT id,message_id,schedule_id,status,total_count,sent_count,failed_count,typing_enabled,min_delay_ms,max_delay_ms,created_at,started_at,completed_at,error_message FROM bot_broadcast_runs WHERE list_id=? ORDER BY created_at DESC LIMIT 20", [listId]);
  const [schedules] = await db.query<RowDataPacket[]>(`SELECT s.id,s.body,s.payload_json,s.scheduled_for,s.recurrence_minutes,
      s.occurrence_count,s.status,s.run_id,s.message_id,s.created_at,s.error_message,
      COALESCE((SELECT SUM(r.sent_count) FROM bot_broadcast_runs r WHERE r.schedule_id=s.id),0) AS sent_total,
      COALESCE((SELECT SUM(r.failed_count) FROM bot_broadcast_runs r WHERE r.schedule_id=s.id),0) AS failed_total
    FROM bot_broadcast_schedules s WHERE s.list_id=? ORDER BY s.scheduled_for DESC LIMIT 40`, [listId]);
  const latestRunId = runs[0]?.id ? String(runs[0].id) : "";
  const [latestRunContacts] = latestRunId
    ? await db.query<RowDataPacket[]>("SELECT id,run_id,contact_id,position,phone,name,status,scheduled_at,started_at,completed_at,error_message FROM bot_broadcast_run_contacts WHERE run_id=? ORDER BY position ASC", [latestRunId])
    : [[] as RowDataPacket[]];
  return {
    list: listSummary({ ...list, contact_count: contacts.length, last_message: messages.at(-1)?.body ?? null, last_run_status: runs[0]?.status ?? null }),
    contacts: contacts.map((row) => ({ id: row.id, phone: row.phone, jid: row.jid, name: row.name ?? "", pushName: row.push_name ?? "", location: row.location ?? "", details: row.details_json ?? "", attributes: parseJsonObject(row.attributes_json), source: row.source, recipientType: (row.recipient_type === "group" ? "group" : "contact") as BroadcastContact["recipientType"], groupId: row.group_id == null ? null : Number(row.group_id), mentionAll: Boolean(row.mention_all), excludeAdmins: Boolean(row.exclude_admins) })),
    messages: messages.map((row) => ({ id: row.id, body: row.body, payload: parsePayload(row.payload_json), createdAt: new Date(row.created_at).toISOString() })),
    templates: templates.map((row) => ({ id: row.id, name: row.template_name || "Mensagem salva", body: row.body, payload: parsePayload(row.payload_json), createdAt: new Date(row.created_at).toISOString() })),
    schedules: schedules.map((row) => ({ id: row.id, body: row.body, payload: parsePayload(row.payload_json), scheduledFor: new Date(row.scheduled_for).toISOString(), recurrenceMinutes: row.recurrence_minutes == null ? null : Number(row.recurrence_minutes), occurrenceCount: Number(row.occurrence_count ?? 0), sentTotal: Number(row.sent_total ?? 0), failedTotal: Number(row.failed_total ?? 0), status: row.status, runId: row.run_id ?? null, messageId: row.message_id ?? null, error: row.error_message ?? null })),
    runs: runs.map((row) => ({ id: row.id, messageId: row.message_id, scheduleId: row.schedule_id ?? null, status: row.status, total: Number(row.total_count), sent: Number(row.sent_count), failed: Number(row.failed_count), typingEnabled: Boolean(row.typing_enabled), minDelayMs: Number(row.min_delay_ms), maxDelayMs: Number(row.max_delay_ms), createdAt: new Date(row.created_at).toISOString(), startedAt: row.started_at ? new Date(row.started_at).toISOString() : null, completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null, error: row.error_message ?? null })),
    latestRunContacts: latestRunContacts.map((row) => ({ id: row.id, runId: row.run_id, contactId: row.contact_id, position: Number(row.position), phone: row.phone, name: row.name ?? "", status: row.status, scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null, startedAt: row.started_at ? new Date(row.started_at).toISOString() : null, completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null, error: row.error_message ?? null })),
    googleSheet: list.google_sheet_url ? { configured: true, url: list.google_sheet_url, mapping: parseJsonRecord(list.google_sheet_mapping_json ?? null), lastSyncedAt: list.google_sheet_last_synced_at ? new Date(list.google_sheet_last_synced_at).toISOString() : null } : { configured: false },
  };
};

export const createBroadcastList = async (userId: number, instanceId: number, input: { name?: unknown; description?: unknown; contacts?: unknown[] }) => {
  await ensureTables();
  const name = text(input.name, 160);
  if (!name) throw new Error("Informe o nome da lista.");
  const candidates = Array.isArray(input.contacts) ? input.contacts.map((entry) => recipientFromInput((entry ?? {}) as ContactInput)).filter((entry): entry is BroadcastContact => Boolean(entry)) : [];
  const unique = new Map<string, BroadcastContact>();
  candidates.forEach((contact) => unique.set(contactKey(contact), contact));
  const id = randomUUID();
  const db = getDb();
  await db.query("INSERT INTO bot_broadcast_lists (id,user_id,instance_id,name,description) VALUES (?,?,?,?,?)", [id, userId, instanceId, name, text(input.description, 500) || null]);
  await addBroadcastContacts(userId, instanceId, id, [...unique.values()]);
  return getBroadcastList(userId, instanceId, id);
};

export const addBroadcastContacts = async (userId: number, instanceId: number, listId: string, contacts: unknown[]) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) throw new Error("Lista não encontrada.");
  const db = getDb();
  const unique = new Map<string, BroadcastContact>();
  contacts.forEach((raw) => {
    const contact = recipientFromInput((raw ?? {}) as ContactInput);
    if (contact) unique.set(contactKey(contact), contact);
  });
  for (const contact of unique.values()) {
    const normalized = contact.recipientType === "group" ? { key: contactKey(contact), phone: contact.phone, jid: contact.jid } : normalizeBroadcastPhone(contact.phone);
    if (!normalized) continue;
    await db.query(`INSERT INTO bot_broadcast_contacts (id,list_id,recipient_type,group_id,mention_all,exclude_admins,normalized_phone,phone,jid,name,push_name,location,details_json,attributes_json,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE recipient_type=VALUES(recipient_type),group_id=VALUES(group_id),mention_all=VALUES(mention_all),exclude_admins=VALUES(exclude_admins),phone=VALUES(phone),jid=VALUES(jid),name=COALESCE(NULLIF(VALUES(name),''),name),push_name=COALESCE(NULLIF(VALUES(push_name),''),push_name),location=COALESCE(NULLIF(VALUES(location),''),location),details_json=COALESCE(NULLIF(VALUES(details_json),''),details_json),attributes_json=COALESCE(VALUES(attributes_json),attributes_json),source=VALUES(source),updated_at=CURRENT_TIMESTAMP`,
      [randomUUID(), listId, contact.recipientType, contact.groupId, contact.mentionAll ? 1 : 0, contact.excludeAdmins ? 1 : 0, normalized.key, normalized.phone, normalized.jid, contact.name || null, contact.pushName || null, contact.location || null, contact.details || null, Object.keys(contact.attributes ?? {}).length ? JSON.stringify(contact.attributes) : null, contact.source || "manual"]);
  }
  await db.query("UPDATE bot_broadcast_lists SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [listId]);
};

export const deleteBroadcastContact = async (userId: number, instanceId: number, listId: string, contactId: string) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) return false;
  const [result] = await getDb().query<{ affectedRows?: number }>("DELETE FROM bot_broadcast_contacts WHERE id=? AND list_id=?", [contactId, listId]);
  return Number(result.affectedRows ?? 0) > 0;
};

export const deleteBroadcastContacts = async (userId: number, instanceId: number, listId: string, contactIds?: unknown[]) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) return 0;
  const ids = Array.isArray(contactIds) ? [...new Set(contactIds.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)))] : [];
  const db = getDb();
  const [result] = ids.length
    ? await db.query<{ affectedRows?: number }>(`DELETE FROM bot_broadcast_contacts WHERE list_id=? AND id IN (${ids.map(() => "?").join(",")})`, [listId, ...ids])
    : await db.query<{ affectedRows?: number }>("DELETE FROM bot_broadcast_contacts WHERE list_id=?", [listId]);
  await db.query("UPDATE bot_broadcast_lists SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [listId]);
  return Number(result.affectedRows ?? 0);
};

export const updateBroadcastGroupMentions = async (
  userId: number,
  instanceId: number,
  listId: string,
  input: { mentionAll?: unknown; excludeAdmins?: unknown },
) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) throw new Error("Lista não encontrada.");
  const mentionAll = flag(input.mentionAll);
  const excludeAdmins = mentionAll && flag(input.excludeAdmins);
  const [result] = await getDb().query<ResultSetHeader>(
    "UPDATE bot_broadcast_contacts SET mention_all=?,exclude_admins=?,updated_at=CURRENT_TIMESTAMP WHERE list_id=? AND recipient_type='group'",
    [mentionAll ? 1 : 0, excludeAdmins ? 1 : 0, listId],
  );
  await getDb().query("UPDATE bot_broadcast_lists SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [listId]);
  return { updated: result.affectedRows, mentionAll, excludeAdmins };
};

export const updateBroadcastList = async (userId: number, instanceId: number, listId: string, input: { name?: unknown; description?: unknown }) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) return null;
  const name = text(input.name, 160) || list.name;
  const description = input.description === undefined ? list.description : (text(input.description, 500) || null);
  await getDb().query("UPDATE bot_broadcast_lists SET name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [name, description, listId]);
  return getBroadcastList(userId, instanceId, listId);
};

export const removeBroadcastList = async (userId: number, instanceId: number, listId: string) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) return false;
  const db = getDb();
  await db.query("DELETE FROM bot_broadcast_run_contacts WHERE run_id IN (SELECT id FROM bot_broadcast_runs WHERE list_id=?)", [listId]);
  await db.query("DELETE FROM bot_broadcast_contacts WHERE list_id=?", [listId]);
  await db.query("DELETE FROM bot_broadcast_messages WHERE list_id=?", [listId]);
  await db.query("DELETE FROM bot_broadcast_runs WHERE list_id=?", [listId]);
  await db.query("DELETE FROM bot_broadcast_lists WHERE id=?", [listId]);
  return true;
};

type GroupMentionSnapshot = { jid: string; isAdmin: boolean };
const mentionCandidate = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  return text(row.JID ?? row.jid ?? row.ID ?? row.id ?? row.PhoneNumber ?? row.phoneNumber, 100);
};
const groupMentionSnapshot = (payload: unknown): GroupMentionSnapshot[] => {
  let current = payload;
  for (let depth = 0; depth < 4 && current && typeof current === "object" && !Array.isArray(current); depth += 1) {
    const row = current as Record<string, unknown>;
    const nested = row.data ?? row.Data ?? row.result ?? row.Result ?? row.info ?? row.Info;
    if (!nested || nested === current) break;
    current = nested;
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return [];
  const row = current as Record<string, unknown>;
  const raw = row.Participants ?? row.participants;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const jid = mentionCandidate(item);
    const participant = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return { jid, isAdmin: flag(participant.IsAdmin ?? participant.isAdmin ?? participant.IsSuperAdmin ?? participant.isSuperAdmin) };
  }).filter((item) => Boolean(item.jid));
};
const recipientMentions = async (client: WuzapiClient, contact: BroadcastContact) => {
  if (contact.recipientType !== "group" || !contact.mentionAll) return [] as string[];
  const participants = groupMentionSnapshot(await getGroupInfo<Record<string, unknown>>(client, contact.jid));
  return participants.filter((item) => !contact.excludeAdmins || !item.isAdmin).map((item) => item.jid);
};

const processRun = async (runId: string, body: string, payload: BroadcastPayload, contacts: BroadcastRunRecipient[], client: WuzapiClient, typing: boolean, minDelay: number, maxDelay: number) => {
  const db = getDb();
  try {
    await db.query("UPDATE bot_broadcast_runs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP) WHERE id=?", [runId]);
    const [counterRows] = await db.query<RowDataPacket[]>("SELECT sent_count,failed_count FROM bot_broadcast_runs WHERE id=? LIMIT 1", [runId]);
    let sent = Number(counterRows[0]?.sent_count ?? 0);
    let failed = Number(counterRows[0]?.failed_count ?? 0);
    const contact = contacts[0];
    if (!contact) {
      await db.query("UPDATE bot_broadcast_runs SET status=?,sent_count=?,failed_count=?,completed_at=CURRENT_TIMESTAMP WHERE id=?", [failed ? "completed_with_errors" : "completed", sent, failed, runId]);
      return;
    }
    const quietDelay = quietHoursDelayMs(payload.quietHours);
    if (quietDelay > 0) {
      const resumesAt = new Date(Date.now() + quietDelay);
      await db.query("UPDATE bot_broadcast_run_contacts SET scheduled_at=? WHERE run_id=? AND position=? AND status='pending'", [resumesAt, runId, contact.runPosition]);
      await db.query("UPDATE bot_broadcast_runs SET status='queued',error_message=NULL WHERE id=?", [runId]);
      console.info("[broadcast] transmissão pausada no horário de descanso", { runId, resumesAt: resumesAt.toISOString(), timezone: payload.quietHours?.timezone });
      return;
    }
    await db.query("UPDATE bot_broadcast_run_contacts SET status='sending',started_at=CURRENT_TIMESTAMP,scheduled_at=COALESCE(scheduled_at,CURRENT_TIMESTAMP) WHERE run_id=? AND position=?", [runId, contact.runPosition]);
    try {
      const mentions = await recipientMentions(client, contact);
      if (typing) {
        await sendChatPresence(client, { to: contact.jid, state: "composing" });
        await sleep(Math.min(4_000, Math.max(1_200, minDelay * 0.12)));
      }
      const selectedMessage = selectBroadcastMessageVariant(body, payload);
      const selectedPayload = selectedMessage.payload;
      const rendered = await resolveContactTemplate(
        selectedMessage.body,
        contact,
        selectedPayload.variables,
      );
      if (selectedPayload.buttons?.length) {
        await sendInteractiveButtons(client, {
          to: contact.jid,
          title: "BotAdmin",
          body: rendered || selectedPayload.media?.fileName || "Selecione uma opção abaixo.",
          buttons: selectedPayload.buttons,
          mentions,
          buttonType: "native",
          headerMedia: selectedPayload.media ? { type: selectedPayload.media.mediaType === "image" || selectedPayload.media.mediaType === "video" ? selectedPayload.media.mediaType : "document", media: selectedPayload.media.url, mimeType: selectedPayload.media.mimeType, fileName: selectedPayload.media.fileName, sourceUrl: selectedPayload.media.url } : undefined,
        });
      } else if (selectedPayload.media) {
        await sendMediaMessage(client, { to: contact.jid, media: selectedPayload.media.url, mediaType: selectedPayload.media.mediaType, mimeType: selectedPayload.media.mimeType, filename: selectedPayload.media.fileName, caption: rendered || null, useExternalUrl: true, mentions });
      } else {
        await sendTextMessage(client, { to: contact.jid, body: rendered, mentions });
      }
      sent += 1;
      await db.query("UPDATE bot_broadcast_run_contacts SET status='sent',completed_at=CURRENT_TIMESTAMP,error_message=NULL WHERE run_id=? AND position=?", [runId, contact.runPosition]);
    } catch (error) {
      failed += 1;
      await db.query("UPDATE bot_broadcast_run_contacts SET status='failed',completed_at=CURRENT_TIMESTAMP,error_message=? WHERE run_id=? AND position=?", [error instanceof Error ? error.message.slice(0, 1_200) : "Falha no envio.", runId, contact.runPosition]);
    } finally {
      if (typing) await sendChatPresence(client, { to: contact.jid, state: "paused" }).catch(() => undefined);
    }
    await db.query("UPDATE bot_broadcast_runs SET sent_count=?,failed_count=? WHERE id=?", [sent, failed, runId]);
    const nextContact = contacts[1];
    if (nextContact) {
      const completed = sent + failed;
      const nextDelay = nextBroadcastDelayMs({
        minDelayMs: minDelay,
        maxDelayMs: maxDelay,
        completed,
        pacing: payload.pacing,
      });
      const delay = nextDelay.delayMs;
      const scheduledAt = new Date(Date.now() + delay);
      await db.query("UPDATE bot_broadcast_run_contacts SET scheduled_at=? WHERE run_id=? AND position=? AND status='pending'", [scheduledAt, runId, nextContact.runPosition]);
      await db.query("UPDATE bot_broadcast_runs SET status='queued',error_message=NULL WHERE id=?", [runId]);
      console.info("[broadcast] próximo destinatário agendado", { runId, position: nextContact.runPosition, scheduledAt: scheduledAt.toISOString(), batchPause: nextDelay.batchPause });
      return;
    }
    await db.query("UPDATE bot_broadcast_runs SET status=?,sent_count=?,failed_count=?,completed_at=CURRENT_TIMESTAMP WHERE id=?", [failed ? "completed_with_errors" : "completed", sent, failed, runId]);
  } catch (error) {
    await db.query("UPDATE bot_broadcast_runs SET status='failed',error_message=?,completed_at=CURRENT_TIMESTAMP WHERE id=?", [error instanceof Error ? error.message.slice(0, 1200) : "Falha ao enviar transmissão.", runId]);
  }
};

const launchBroadcastRun = (
  runId: string,
  body: string,
  payload: BroadcastPayload,
  contacts: BroadcastRunRecipient[],
  client: WuzapiClient,
  typing: boolean,
  minDelay: number,
  maxDelay: number,
) => {
  if (activeBroadcastRuns.has(runId)) return;
  activeBroadcastRuns.add(runId);
  void processRun(runId, body, payload, contacts, client, typing, minDelay, maxDelay)
    .finally(() => activeBroadcastRuns.delete(runId));
};

export const startBroadcastRun = async (userId: number, instanceId: number, listId: string, input: { body?: unknown; media?: unknown; buttons?: unknown; variables?: unknown; messageVariants?: unknown; quietHours?: unknown; pacing?: unknown; typingEnabled?: unknown; minDelayMs?: unknown; maxDelayMs?: unknown; cloneFromMessageId?: unknown; reuseMessageId?: unknown; scheduleId?: unknown }) => {
  const data = await getBroadcastList(userId, instanceId, listId);
  if (!data) throw new Error("Lista não encontrada.");
  const body = text(input.body, 4_096);
  const payload = normalizePayload(input as Record<string, unknown>);
  if (!body && !payload.media && !payload.buttons?.length) throw new Error("Digite uma mensagem, selecione uma mídia ou adicione botões antes de enviar.");
  if (!data.contacts.length) throw new Error("Adicione contatos à lista antes de enviar.");
  const instance = await getInstanceForUser(userId, instanceId);
  if (!instance?.serverBaseUrl || !instance.token) throw new Error("A instância não está disponível para transmissão.");
  const minDelay = clampDelay(input.minDelayMs, 30_000);
  const maxDelay = Math.max(minDelay, clampDelay(input.maxDelayMs, 60_000));
  const typing = input.typingEnabled !== false && input.typingEnabled !== "false";
  const requestedMessageId = text(input.reuseMessageId, 36);
  let messageId = "";
  const runId = randomUUID();
  const db = getDb();
  if (requestedMessageId) {
    const [existingMessages] = await db.query<RowDataPacket[]>(
      "SELECT id FROM bot_broadcast_messages WHERE id=? AND list_id=? AND is_template=0 LIMIT 1",
      [requestedMessageId, listId],
    );
    if (existingMessages.length) messageId = String(existingMessages[0].id);
  }
  if (!messageId) {
    messageId = randomUUID();
    await db.query("INSERT INTO bot_broadcast_messages (id,list_id,body,payload_json) VALUES (?,?,?,?)", [messageId, listId, body, JSON.stringify(payload)]);
  }
  const scheduleId = text(input.scheduleId, 36) || null;
  await db.query("INSERT INTO bot_broadcast_runs (id,list_id,user_id,instance_id,message_id,schedule_id,typing_enabled,min_delay_ms,max_delay_ms,total_count) VALUES (?,?,?,?,?,?,?,?,?,?)", [runId, listId, userId, instanceId, messageId, scheduleId, typing ? 1 : 0, minDelay, maxDelay, data.contacts.length]);
  for (let index = 0; index < data.contacts.length; index += 1) {
    const contact = data.contacts[index];
    await db.query(
      "INSERT INTO bot_broadcast_run_contacts (id,run_id,contact_id,recipient_type,group_id,mention_all,exclude_admins,position,phone,jid,name,scheduled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [randomUUID(), runId, contact.id ?? null, contact.recipientType, contact.groupId, contact.mentionAll ? 1 : 0, contact.excludeAdmins ? 1 : 0, index + 1, contact.phone, contact.jid, contact.pushName || contact.name || null, index === 0 ? new Date() : null],
    );
  }
  const client: WuzapiClient = { baseUrl: instance.serverBaseUrl.replace(/\/+$/, ""), token: instance.token, conversation: { userId, instanceId, instanceName: instance.name, instancePhone: instance.phone } };
  // Deliberately detached: the API acknowledges immediately while run status is
  // persisted and available to the Flutter conversation view.
  launchBroadcastRun(runId, body, payload, data.contacts.map((contact, index) => ({ ...contact, runPosition: index + 1 })), client, typing, minDelay, maxDelay);
  return { runId, messageId, total: data.contacts.length, typingEnabled: typing, minDelayMs: minDelay, maxDelayMs: maxDelay };
};

type BroadcastInput = { body?: unknown; media?: unknown; buttons?: unknown; variables?: unknown; messageVariants?: unknown; quietHours?: unknown; pacing?: unknown; typingEnabled?: unknown; minDelayMs?: unknown; maxDelayMs?: unknown; scheduledAt?: unknown; timezone?: unknown; recurrenceMinutes?: unknown; templateName?: unknown; templateId?: unknown };

const parseBroadcastScheduledAt = (rawValue: unknown, timezoneValue: unknown): Date => {
  const raw = text(rawValue, 80);
  const timezone = normalizeTimezoneInput(text(timezoneValue, 80)) ?? "America/Sao_Paulo";
  // A datetime-local field has no offset. Parsing it with new Date() on a UTC
  // server shifts Brazilian schedules by three hours, so convert its wall
  // clock using the timezone explicitly selected by the user.
  const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    return convertTimezoneLocalToUtc(timezone, {
      year: Number(local[1]),
      month: Number(local[2]),
      day: Number(local[3]),
      hour: Number(local[4]),
      minute: Number(local[5]),
      second: Number(local[6] ?? 0),
    });
  }
  return new Date(raw);
};

const prepareBroadcastInput = async (userId: number, instanceId: number, listId: string, input: BroadcastInput) => {
  const data = await getBroadcastList(userId, instanceId, listId);
  if (!data) throw new Error("Lista não encontrada.");
  const body = text(input.body, 4_096);
  const payload = normalizePayload(input as Record<string, unknown>);
  if (!body && !payload.media && !payload.buttons?.length) throw new Error("Digite uma mensagem, selecione uma mídia ou adicione botões antes de salvar.");
  return { body, payload, typing: input.typingEnabled !== false && input.typingEnabled !== "false", minDelay: clampDelay(input.minDelayMs, 30_000), maxDelay: Math.max(clampDelay(input.minDelayMs, 30_000), clampDelay(input.maxDelayMs, 60_000)), total: data.contacts.length };
};

export const previewBroadcastVariables = async (
  userId: number,
  instanceId: number,
  listId: string,
  input: { body?: unknown; variables?: unknown },
) => {
  const data = await getBroadcastList(userId, instanceId, listId);
  if (!data) throw new Error("Lista não encontrada.");
  const contact = data.contacts[0];
  if (!contact) throw new Error("Adicione ao menos um destinatário para testar as variáveis.");
  const body = text(input.body, 4_096);
  const payload = normalizePayload({ variables: input.variables });
  const rendered = await resolveContactTemplate(body, contact, payload.variables);
  return {
    rendered,
    contact: {
      name: contact.pushName || contact.name || "Primeiro destinatário",
      phone: contact.phone,
      recipientType: contact.recipientType,
    },
  };
};

export const saveBroadcastTemplate = async (userId: number, instanceId: number, listId: string, input: BroadcastInput) => {
  const prepared = await prepareBroadcastInput(userId, instanceId, listId, input);
  const name = text(input.templateName, 160) || `Mensagem salva ${new Date().toLocaleDateString("pt-BR")}`;
  const requestedId = text(input.templateId, 80);
  if (requestedId) {
    const [result] = await getDb().query<ResultSetHeader>(
      "UPDATE bot_broadcast_messages SET body=?,payload_json=?,template_name=? WHERE id=? AND list_id=? AND is_template=1",
      [prepared.body, JSON.stringify(prepared.payload), name, requestedId, listId],
    );
    if (!result.affectedRows) throw new Error("A mensagem salva não foi encontrada.");
    await getDb().query("UPDATE bot_broadcast_lists SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [listId]);
    return { templateId: requestedId, name, updated: true };
  }
  const id = randomUUID();
  await getDb().query("INSERT INTO bot_broadcast_messages (id,list_id,body,payload_json,is_template,template_name) VALUES (?,?,?,?,1,?)", [id, listId, prepared.body, JSON.stringify(prepared.payload), name]);
  return { templateId: id, name };
};

export const deleteBroadcastTemplate = async (userId: number, instanceId: number, listId: string, templateId: string) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) return false;
  const [result] = await getDb().query<ResultSetHeader>(
    "DELETE FROM bot_broadcast_messages WHERE id=? AND list_id=? AND is_template=1",
    [templateId, listId],
  );
  if (result.affectedRows) await getDb().query("UPDATE bot_broadcast_lists SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [listId]);
  return result.affectedRows > 0;
};

export const scheduleBroadcastRun = async (userId: number, instanceId: number, listId: string, input: BroadcastInput) => {
  const prepared = await prepareBroadcastInput(userId, instanceId, listId, input);
  if (!prepared.total) throw new Error("Adicione contatos antes de agendar.");
  const raw = text(input.scheduledAt, 80);
  const scheduledFor = parseBroadcastScheduledAt(raw, input.timezone);
  if (!raw || Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now() + 30_000) throw new Error("Escolha uma data e horário pelo menos 30 segundos no futuro.");
  const requestedRecurrence = Number(input.recurrenceMinutes);
  const recurrenceMinutes = Number.isFinite(requestedRecurrence) && requestedRecurrence > 0
    ? Math.max(1, Math.min(43_200, Math.floor(requestedRecurrence)))
    : null;
  const id = randomUUID();
  await getDb().query("INSERT INTO bot_broadcast_schedules (id,list_id,user_id,instance_id,body,payload_json,typing_enabled,min_delay_ms,max_delay_ms,scheduled_for,recurrence_minutes) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [id, listId, userId, instanceId, prepared.body, JSON.stringify(prepared.payload), prepared.typing ? 1 : 0, prepared.minDelay, prepared.maxDelay, scheduledFor, recurrenceMinutes]);
  return { scheduleId: id, scheduledFor: scheduledFor.toISOString(), recurrenceMinutes, total: prepared.total };
};

export const updateBroadcastSchedule = async (
  userId: number,
  instanceId: number,
  listId: string,
  scheduleId: string,
  input: BroadcastInput & { enabled?: unknown },
) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) throw new Error("Lista não encontrada.");
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id,status,scheduled_for,recurrence_minutes,payload_json,typing_enabled,min_delay_ms,max_delay_ms FROM bot_broadcast_schedules WHERE id=? AND list_id=? AND user_id=? AND instance_id=? LIMIT 1",
    [scheduleId, listId, userId, instanceId],
  );
  if (!rows.length) throw new Error("Programação não encontrada.");
  const row = rows[0];
  const updates: string[] = [];
  const values: unknown[] = [];

  const contentKeys = ["body", "media", "buttons", "variables", "messageVariants"] as const;
  const hasContentChange = contentKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
  let nextPayload: Record<string, unknown> | null = null;

  if (hasContentChange) {
    const prepared = await prepareBroadcastInput(userId, instanceId, listId, input);
    const existingPayload = parsePayload(row.payload_json == null ? null : String(row.payload_json));
    // Operational settings belong to the schedule and must survive a content
    // edit. Message fields are replaced so removing media/buttons in the editor
    // does not resurrect the old value on the next dispatch.
    const {
      media: _oldMedia,
      buttons: _oldButtons,
      variables: _oldVariables,
      messageVariants: _oldVariants,
      ...operationalPayload
    } = existingPayload;
    void _oldMedia; void _oldButtons; void _oldVariables; void _oldVariants;
    nextPayload = {
      ...operationalPayload,
      media: prepared.payload.media ?? null,
      buttons: prepared.payload.buttons ?? [],
      variables: prepared.payload.variables ?? [],
      ...(prepared.payload.messageVariants?.length
        ? { messageVariants: prepared.payload.messageVariants }
        : {}),
    };
    updates.push("body=?");
    values.push(prepared.body);
  }

  // Editing only the message must never reset the operational cadence. Timing
  // fields are changed exclusively when the caller explicitly sends them.
  if (Object.prototype.hasOwnProperty.call(input, "typingEnabled")) {
    const typing = input.typingEnabled !== false && input.typingEnabled !== "false";
    updates.push("typing_enabled=?");
    values.push(typing ? 1 : 0);
  }
  if (
    Object.prototype.hasOwnProperty.call(input, "minDelayMs") ||
    Object.prototype.hasOwnProperty.call(input, "maxDelayMs")
  ) {
    const currentMin = Math.max(10_000, Number(row.min_delay_ms) || 30_000);
    const currentMax = Math.max(currentMin, Number(row.max_delay_ms) || 60_000);
    const nextMin = Object.prototype.hasOwnProperty.call(input, "minDelayMs")
      ? clampDelay(input.minDelayMs, currentMin)
      : currentMin;
    const requestedMax = Object.prototype.hasOwnProperty.call(input, "maxDelayMs")
      ? clampDelay(input.maxDelayMs, currentMax)
      : currentMax;
    updates.push("min_delay_ms=?", "max_delay_ms=?");
    values.push(nextMin, Math.max(nextMin, requestedMax));
  }

  if (Object.prototype.hasOwnProperty.call(input, "recurrenceMinutes")) {
    const raw = Number(input.recurrenceMinutes);
    const recurrence = Number.isFinite(raw) && raw > 0
      ? Math.max(1, Math.min(43_200, Math.floor(raw)))
      : null;
    updates.push("recurrence_minutes=?");
    values.push(recurrence);
  }
  if (Object.prototype.hasOwnProperty.call(input, "quietHours")) {
    const payload = nextPayload ?? parsePayload(row.payload_json == null ? null : String(row.payload_json));
    nextPayload = { ...payload, quietHours: normalizeQuietHours(input.quietHours) };
  }
  if (nextPayload) {
    updates.push("payload_json=?");
    values.push(JSON.stringify(nextPayload));
  }
  if (input.scheduledAt != null && text(input.scheduledAt, 80)) {
    const scheduledFor = parseBroadcastScheduledAt(input.scheduledAt, input.timezone);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now() + 30_000) {
      throw new Error("Escolha uma data e horário pelo menos 30 segundos no futuro.");
    }
    updates.push("scheduled_for=?");
    values.push(scheduledFor);
  }
  if (Object.prototype.hasOwnProperty.call(input, "enabled")) {
    const enabled = input.enabled === true || input.enabled === "true" || input.enabled === 1 || input.enabled === "1";
    updates.push("status=?");
    values.push(enabled ? "pending" : "cancelled");
    if (enabled) {
      const existing = new Date(row.scheduled_for).getTime();
      if (!Number.isFinite(existing) || existing < Date.now() + 30_000) {
        const recurrence = Number(input.recurrenceMinutes ?? row.recurrence_minutes ?? 0);
        const delay = recurrence > 0 ? recurrence * 60_000 : 30_000;
        updates.push("scheduled_for=?");
        values.push(new Date(Date.now() + delay));
      }
      updates.push("error_message=NULL");
    }
  }
  if (!updates.length) throw new Error("Nenhuma alteração foi informada.");
  values.push(scheduleId, listId, userId, instanceId);
  await db.query(
    `UPDATE bot_broadcast_schedules SET ${updates.join(",")} WHERE id=? AND list_id=? AND user_id=? AND instance_id=?`,
    values,
  );
  return { updated: true };
};

export const deleteBroadcastSchedule = async (userId: number, instanceId: number, listId: string, scheduleId: string) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) return false;
  const [result] = await getDb().query<ResultSetHeader>(
    "DELETE FROM bot_broadcast_schedules WHERE id=? AND list_id=? AND user_id=? AND instance_id=?",
    [scheduleId, listId, userId, instanceId],
  );
  return result.affectedRows > 0;
};

export const dispatchDueBroadcastSchedules = async () => {
  await ensureTables();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>("SELECT id,list_id,user_id,instance_id,body,payload_json,typing_enabled,min_delay_ms,max_delay_ms,scheduled_for,recurrence_minutes,message_id FROM bot_broadcast_schedules WHERE status='pending' AND scheduled_for<=CURRENT_TIMESTAMP ORDER BY scheduled_for ASC LIMIT 8");
  for (const row of rows) {
    const payload = parsePayload(row.payload_json);
    const quietDelay = quietHoursDelayMs(payload.quietHours);
    if (quietDelay > 0) {
      await db.query("UPDATE bot_broadcast_schedules SET scheduled_for=?,error_message=NULL WHERE id=? AND status='pending'", [new Date(Date.now() + quietDelay), row.id]);
      continue;
    }
    const [claim] = await db.query<ResultSetHeader>("UPDATE bot_broadcast_schedules SET status='dispatched' WHERE id=? AND status='pending'", [row.id]);
    if (!claim.affectedRows) continue;
    try {
      const run = await startBroadcastRun(Number(row.user_id), Number(row.instance_id), String(row.list_id), { body: row.body, media: payload.media, buttons: payload.buttons, variables: payload.variables, messageVariants: payload.messageVariants, quietHours: payload.quietHours, pacing: payload.pacing, typingEnabled: Boolean(row.typing_enabled), minDelayMs: Number(row.min_delay_ms), maxDelayMs: Number(row.max_delay_ms), reuseMessageId: row.message_id, scheduleId: row.id });
      const recurrenceMinutes = Number(row.recurrence_minutes ?? 0);
      if (recurrenceMinutes > 0) {
        const previous = new Date(row.scheduled_for).getTime();
        const interval = recurrenceMinutes * 60_000;
        const next = new Date(Math.max(previous + interval, Date.now() + interval));
        await db.query("UPDATE bot_broadcast_schedules SET status='pending',run_id=?,message_id=?,scheduled_for=?,occurrence_count=occurrence_count+1,error_message=NULL WHERE id=?", [run.runId, run.messageId, next, row.id]);
      } else {
        await db.query("UPDATE bot_broadcast_schedules SET run_id=?,message_id=?,occurrence_count=occurrence_count+1 WHERE id=?", [run.runId, run.messageId, row.id]);
      }
    } catch (error) {
      await db.query("UPDATE bot_broadcast_schedules SET status='failed',error_message=? WHERE id=?", [error instanceof Error ? error.message.slice(0, 1200) : "Falha ao iniciar transmissão agendada.", row.id]);
    }
  }
};

export const dispatchDueBroadcastRuns = async () => {
  await ensureTables();
  const db = getDb();
  // Se o processo cair no meio de um envio, a execução volta para a fila
  // após uma margem curta, em vez de ficar permanentemente como "running".
  await db.query(`
    UPDATE bot_broadcast_run_contacts
       SET status='pending',started_at=NULL
     WHERE status='sending'
       AND updated_at<NOW() - INTERVAL 2 MINUTE
       AND EXISTS (
         SELECT 1 FROM bot_broadcast_runs r
          WHERE r.id=bot_broadcast_run_contacts.run_id
            AND r.status='running'
       )
  `);
  await db.query(`
    UPDATE bot_broadcast_runs
       SET status='queued'
     WHERE status='running'
       AND updated_at<NOW() - INTERVAL 2 MINUTE
       AND EXISTS (
         SELECT 1 FROM bot_broadcast_run_contacts rc
          WHERE rc.run_id=bot_broadcast_runs.id AND rc.status='pending'
       )
  `);
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT r.id,r.user_id,r.instance_id,r.message_id,r.typing_enabled,r.min_delay_ms,r.max_delay_ms,m.body,m.payload_json
      FROM bot_broadcast_runs r
      INNER JOIN bot_broadcast_messages m ON m.id=r.message_id
     WHERE r.status='queued'
       AND EXISTS (
         SELECT 1 FROM bot_broadcast_run_contacts rc
          WHERE rc.run_id=r.id AND rc.status='pending'
            AND rc.position=(
              SELECT MIN(rc2.position)
                FROM bot_broadcast_run_contacts rc2
               WHERE rc2.run_id=r.id AND rc2.status='pending'
            )
            AND (rc.scheduled_at IS NULL OR rc.scheduled_at<=CURRENT_TIMESTAMP)
       )
     ORDER BY r.created_at ASC
     LIMIT 12
  `);
  for (const row of rows) {
    const runId = String(row.id);
    if (activeBroadcastRuns.has(runId)) continue;
    const [claim] = await db.query<ResultSetHeader>("UPDATE bot_broadcast_runs SET status='running' WHERE id=? AND status='queued'", [runId]);
    if (!claim.affectedRows) continue;
    try {
      const instance = await getInstanceForUser(Number(row.user_id), Number(row.instance_id));
      if (!instance?.serverBaseUrl || !instance.token) throw new Error("A instância não está disponível para retomar a transmissão.");
      const [recipients] = await db.query<RowDataPacket[]>(`
        SELECT rc.position,rc.phone,rc.jid,rc.name,rc.recipient_type,rc.group_id,rc.mention_all,rc.exclude_admins,
               c.name AS contact_name,c.push_name,c.location,c.details_json,c.attributes_json,c.source
          FROM bot_broadcast_run_contacts rc
          LEFT JOIN bot_broadcast_contacts c ON c.id=rc.contact_id
         WHERE rc.run_id=? AND rc.status='pending'
         ORDER BY rc.position ASC
      `, [runId]);
      const contacts: BroadcastRunRecipient[] = recipients.map((contact) => ({
        phone: String(contact.phone ?? ""),
        jid: String(contact.jid ?? contact.phone ?? ""),
        name: String(contact.contact_name ?? contact.name ?? ""),
        location: String(contact.location ?? ""),
        details: String(contact.details_json ?? ""),
        source: String(contact.source ?? "broadcast_run"),
        pushName: String(contact.push_name ?? contact.name ?? ""),
        attributes: parseJsonObject(contact.attributes_json == null ? null : String(contact.attributes_json)),
        recipientType: contact.recipient_type === "group" ? "group" : "contact",
        groupId: contact.group_id == null ? null : Number(contact.group_id),
        mentionAll: Boolean(contact.mention_all),
        excludeAdmins: Boolean(contact.exclude_admins),
        runPosition: Number(contact.position),
      }));
      if (!contacts.length) {
        await db.query("UPDATE bot_broadcast_runs SET status=CASE WHEN failed_count>0 THEN 'completed_with_errors' ELSE 'completed' END,completed_at=CURRENT_TIMESTAMP WHERE id=?", [runId]);
        continue;
      }
      const client: WuzapiClient = {
        baseUrl: instance.serverBaseUrl.replace(/\/+$/, ""),
        token: instance.token,
        conversation: { userId: Number(row.user_id), instanceId: Number(row.instance_id), instanceName: instance.name, instancePhone: instance.phone },
      };
      launchBroadcastRun(runId, String(row.body ?? ""), parsePayload(row.payload_json == null ? null : String(row.payload_json)), contacts, client, Boolean(row.typing_enabled), Number(row.min_delay_ms), Number(row.max_delay_ms));
    } catch (error) {
      await db.query("UPDATE bot_broadcast_runs SET status='queued',error_message=? WHERE id=?", [error instanceof Error ? error.message.slice(0, 1200) : "Falha ao retomar transmissão.", runId]);
    }
  }
};

type LegacyCampaignRow = RowDataPacket & { id: number; name: string; description: string | null; status: string; schedule_kind: string; schedule_config: string | null; content_json: string | null; next_run_at: Date | string | null };
type LegacyTargetRow = RowDataPacket & { campaign_id: number; instance_id: number; group_id: number | null; remote_id: string | null; mention_all: number | boolean | null; exclude_admins: number | boolean | null; audience_meta: string | null };
const legacyJson = <T>(value: unknown, fallback: T): T => {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed == null ? fallback : parsed as T; }
  catch { return fallback; }
};
const publicMediaUrl = (value: unknown) => {
  const url = text(value, 2_000);
  if (!url || /^https?:\/\//i.test(url)) return url;
  const base = text(process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://botadmin.shop", 500).replace(/\/+$/, "");
  return `${base}/${url.replace(/^\/+/, "")}`;
};
const legacyPayload = (content: Record<string, unknown>, groupInvites = new Map<number, string>()): { body: string; payload: BroadcastPayload } | null => {
  const type = text(content.type, 30).toLowerCase();
  if (!type || type === "status") return null;
  const body = text(content.body ?? content.text ?? content.caption, 4_096);
  const payload: BroadcastPayload = {};
  const rawMedia = content.headerMedia ?? content.media;
  if (rawMedia && typeof rawMedia === "object" && !Array.isArray(rawMedia)) {
    const media = rawMedia as Record<string, unknown>;
    const mediaType = text(media.mediaType ?? media.type, 20).toLowerCase();
    const url = publicMediaUrl(media.url ?? media.path);
    if (url && ["image", "video", "audio", "document"].includes(mediaType)) payload.media = { url, mediaType: mediaType as BroadcastMedia["mediaType"], mimeType: text(media.mimeType, 160) || undefined, fileName: text(media.fileName, 240) || undefined };
  }
  const rawButtons = Array.isArray(content.ctaButtons) ? content.ctaButtons : Array.isArray(content.buttons) ? content.buttons : [];
  payload.buttons = rawButtons.slice(0, 3).map((item, index) => {
    const button = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const buttonType = text(button.type, 30);
    const groupInvite = text(button.urlSource, 40) === "group_invite" ? groupInvites.get(Number(button.groupId)) : undefined;
    return { id: text(button.id, 80) || `legacy_${index + 1}`, text: text(button.text, 80), type: ["quick_reply", "cta_url", "cta_copy", "cta_call", "single_select"].includes(buttonType) ? buttonType as InteractiveButton["type"] : "quick_reply", url: text(button.url, 1_500) || groupInvite || undefined, phoneNumber: text(button.phoneNumber, 80) || undefined, copyCode: text(button.copyCode, 300) || undefined };
  }).filter((button) => Boolean(button.text));
  return body || payload.media || payload.buttons?.length ? { body, payload } : null;
};

/** Migrates group campaigns while deliberately leaving shared Status records intact. */
export const migrateLegacyAutoPromoter = async (userId: number, instanceId: number) => {
  await ensureTables();
  const db = getDb();
  const [campaigns] = await db.query<LegacyCampaignRow[]>(`SELECT DISTINCT c.id,c.name,c.description,c.status,c.schedule_kind,c.schedule_config,c.content_json,c.next_run_at FROM bot_ad_campaigns c INNER JOIN bot_ad_campaign_targets t ON t.campaign_id=c.id AND t.target_type='group' AND t.instance_id=? WHERE c.user_id=? AND c.deleted_at IS NULL ORDER BY c.id ASC`, [instanceId, userId]);
  let migrated = 0;
  for (const campaign of campaigns) {
    const contents = legacyJson<unknown[]>(campaign.content_json, []).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
    const referencedGroupIds = [...new Set(contents.flatMap((content) => {
      const buttons = Array.isArray(content.ctaButtons) ? content.ctaButtons : Array.isArray(content.buttons) ? content.buttons : [];
      return buttons.map((item) => item && typeof item === "object" ? Number((item as Record<string, unknown>).groupId) : 0).filter((id) => Number.isFinite(id) && id > 0);
    }))];
    const groupInvites = new Map<number, string>();
    if (referencedGroupIds.length) {
      const [groups] = await db.query<RowDataPacket[]>(`SELECT id,invite_link FROM bot_groups WHERE id IN (${referencedGroupIds.map(() => "?").join(",")})`, referencedGroupIds);
      groups.forEach((group) => {
        const invite = text(group.invite_link, 1_500);
        if (invite) groupInvites.set(Number(group.id), invite);
      });
    }
    const converted = contents.map((content) => legacyPayload(content, groupInvites)).filter((item): item is { body: string; payload: BroadcastPayload } => Boolean(item));
    if (!converted.length) continue;
    const [existing] = await db.query<RowDataPacket[]>("SELECT id FROM bot_broadcast_lists WHERE user_id=? AND instance_id=? AND legacy_campaign_id=? LIMIT 1", [userId, instanceId, campaign.id]);
    if (existing.length) continue;
    const [targets] = await db.query<LegacyTargetRow[]>("SELECT campaign_id,instance_id,group_id,remote_id,mention_all,exclude_admins,audience_meta FROM bot_ad_campaign_targets WHERE campaign_id=? AND target_type='group' AND instance_id=? ORDER BY id ASC", [campaign.id, instanceId]);
    const listId = randomUUID();
    await db.query("INSERT INTO bot_broadcast_lists (id,user_id,instance_id,name,description,legacy_campaign_id) VALUES (?,?,?,?,?,?)", [listId, userId, instanceId, text(campaign.name, 160) || "Divulgação migrada", text(campaign.description, 500) || "Migrado do Autodivulgador", campaign.id]);
    await addBroadcastContacts(userId, instanceId, listId, targets.map((target) => {
      const meta = legacyJson<Record<string, unknown>>(target.audience_meta, {});
      return { recipientType: "group", groupId: target.group_id, remoteId: target.remote_id, jid: target.remote_id, name: text(meta.title, 160) || "Grupo do WhatsApp", mentionAll: flag(target.mention_all), excludeAdmins: flag(target.exclude_admins), source: "legacy_autopromoter" };
    }));
    for (let index = 0; index < converted.length; index += 1) {
      const item = converted[index];
      await db.query("INSERT INTO bot_broadcast_messages (id,list_id,body,payload_json,is_template,template_name) VALUES (?,?,?,?,1,?)", [randomUUID(), listId, item.body, JSON.stringify(item.payload), converted.length === 1 ? text(campaign.name, 160) || "Mensagem migrada" : `${text(campaign.name, 130) || "Mensagem migrada"} · ${index + 1}`]);
    }
    const schedule = legacyJson<Record<string, unknown>>(campaign.schedule_config, {});
    const everyMinutes = Number(schedule.everyMinutes ?? 0);
    if (campaign.schedule_kind === "recurring" && Number.isFinite(everyMinutes) && everyMinutes > 0 && campaign.status !== "paused") {
      const first = campaign.next_run_at ? new Date(campaign.next_run_at) : new Date(Date.now() + 60_000);
      const scheduledFor = Number.isNaN(first.getTime()) || first.getTime() < Date.now() + 30_000 ? new Date(Date.now() + 60_000) : first;
      const firstMessage = converted[0];
      await db.query("INSERT INTO bot_broadcast_schedules (id,list_id,user_id,instance_id,body,payload_json,typing_enabled,min_delay_ms,max_delay_ms,scheduled_for,recurrence_minutes) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(), listId, userId, instanceId, firstMessage.body, JSON.stringify(firstMessage.payload), 1, 30_000, 60_000, scheduledFor, Math.max(1, Math.min(43_200, Math.floor(everyMinutes)))]);
    }
    const [remaining] = await db.query<RowDataPacket[]>("SELECT id FROM bot_ad_campaign_targets WHERE campaign_id=? AND target_type='group' AND instance_id<>? LIMIT 1", [campaign.id, instanceId]);
    if (!remaining.length) await db.query("UPDATE bot_ad_campaigns SET deleted_at=CURRENT_TIMESTAMP,status='paused' WHERE id=?", [campaign.id]);
    migrated += 1;
  }
  return { migrated };
};

const csvRows = (value: string): string[][] => value.split(/\r?\n/).filter(Boolean).map((line) => {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') { quoted = !quoted; continue; }
    if ((char === "," || char === ";") && !quoted) { result.push(current.trim()); current = ""; continue; }
    current += char;
  }
  result.push(current.trim());
  return result;
});

export type GoogleSheetMapping = { sheetId?: unknown; nameColumn?: unknown; phoneColumn?: unknown; attributeColumns?: unknown };
const contactsFromRows = (rows: string[][], mapping?: GoogleSheetMapping): BroadcastContact[] => {
  const headers = rows.shift()?.map((header) => header.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()) ?? [];
  const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const mappedName = text(mapping?.nameColumn, 160).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const mappedPhone = text(mapping?.phoneColumn, 160).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const nameIndex = mappedName ? headers.indexOf(mappedName) : find("nome", "name", "cliente");
  const phoneIndex = mappedPhone ? headers.indexOf(mappedPhone) : find("telefone", "phone", "numero", "whatsapp", "celular");
  const locationIndex = find("localizacao", "location", "cidade", "endereco");
  const detailsIndex = find("detalhes", "details", "observacao", "obs");
  if (phoneIndex < 0) throw new Error("A planilha precisa de uma coluna Telefone, Número, WhatsApp ou Celular.");
  const pushNameIndex = find("pushname", "push_name", "nome_whatsapp");
  const selectedAttributes = Array.isArray(mapping?.attributeColumns)
    ? mapping!.attributeColumns.map((item) => text(item, 160).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")).filter(Boolean)
    : [];
  return rows.map((row) => {
    const attributes: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (index !== nameIndex && index !== phoneIndex && index !== locationIndex && index !== detailsIndex && index !== pushNameIndex && header && (!selectedAttributes.length || selectedAttributes.includes(header))) attributes[header] = row[index] ?? "";
    });
    return contactFromInput({ name: row[nameIndex], phone: row[phoneIndex], pushName: row[pushNameIndex], location: row[locationIndex], details: row[detailsIndex], attributes, source: "google_sheets" });
  }).filter((entry): entry is BroadcastContact => Boolean(entry));
};

const sheetParts = (sheetUrl: string) => {
  const match = sheetUrl.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Informe um link válido do Google Sheets.");
  const parsed = new URL(sheetUrl);
  const gid = parsed.searchParams.get("gid") ?? parsed.hash.match(/gid=([0-9]+)/)?.[1] ?? "0";
  return { spreadsheetId: match[1], gid };
};

const privateGoogleSheetRows = async (spreadsheetId: string, gid: string, accessToken: string) => {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const infoResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`, { headers, signal: AbortSignal.timeout(20_000) });
  const info = await infoResponse.json().catch(() => ({})) as { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> };
  const title = info.sheets?.find((sheet) => String(sheet.properties?.sheetId ?? "") === gid)?.properties?.title ?? info.sheets?.[0]?.properties?.title;
  if (!infoResponse.ok || !title) throw new Error("Não consegui abrir esta planilha usando a conta Google conectada.");
  const range = encodeURIComponent(`${title}!A:ZZ`);
  const valuesResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`, { headers, signal: AbortSignal.timeout(20_000) });
  const values = await valuesResponse.json().catch(() => ({})) as { values?: unknown[][]; error?: { message?: string } };
  if (!valuesResponse.ok || !Array.isArray(values.values)) throw new Error(values.error?.message || "Não consegui ler as linhas desta planilha.");
  return values.values.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []);
};

export const contactsFromGoogleSheet = async (sheetUrl: string, userId?: number, mapping?: GoogleSheetMapping): Promise<BroadcastContact[]> => {
  const { spreadsheetId, gid } = sheetParts(sheetUrl);
  const accessToken = userId ? await getGoogleSheetsAccessToken(userId) : null;
  const selectedGid = text(mapping?.sheetId, 80) || gid;
  if (accessToken) return contactsFromRows(await privateGoogleSheetRows(spreadsheetId, selectedGid, accessToken), mapping);
  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(selectedGid)}`;
  const response = await fetch(exportUrl, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "BotAdmin Sheets Import/1.0" } });
  if (!response.ok) throw new Error("Não consegui abrir a planilha. Compartilhe-a como leitor ou publique-a para importar.");
  return contactsFromRows(csvRows(await response.text()), mapping);
};

export const previewGoogleSheet = async (sheetUrl: string, userId: number, mapping?: GoogleSheetMapping) => {
  const { spreadsheetId, gid } = sheetParts(sheetUrl);
  const accessToken = await getGoogleSheetsAccessToken(userId);
  if (!accessToken) throw new Error("Conecte sua conta Google antes de abrir uma planilha privada.");
  const headers = { Authorization: `Bearer ${accessToken}` };
  const infoResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`, { headers, signal: AbortSignal.timeout(20_000) });
  const info = await infoResponse.json().catch(() => ({})) as { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> };
  if (!infoResponse.ok || !info.sheets?.length) throw new Error("Não consegui listar as abas desta planilha.");
  const requestedSheet = text(mapping?.sheetId, 80) || gid;
  const selected = info.sheets.find((sheet) => String(sheet.properties?.sheetId ?? "") === requestedSheet) ?? info.sheets[0];
  const title = selected.properties?.title ?? "";
  const selectedId = String(selected.properties?.sheetId ?? "0");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${title}!A:ZZ`)}`, { headers, signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({})) as { values?: unknown[][]; error?: { message?: string } };
  if (!response.ok || !Array.isArray(data.values)) throw new Error(data.error?.message || "Não consegui ler esta aba.");
  const rows = data.values.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []);
  const headerRow = (rows[0] ?? []).map((cell, index) => text(cell, 160) || `coluna_${index + 1}`);
  return { spreadsheetId, sheetId: selectedId, sheets: info.sheets.map((sheet) => ({ id: String(sheet.properties?.sheetId ?? ""), title: sheet.properties?.title ?? "Aba" })), headers: headerRow, sampleRows: rows.slice(1, 4), estimatedContacts: contactsFromRows(rows.map((row) => [...row]), mapping).length };
};

export const listGoogleSpreadsheets = async (userId: number) => {
  const accessToken = await getGoogleSheetsAccessToken(userId);
  if (!accessToken) throw new Error("Conecte sua conta Google antes de listar as planilhas.");
  const query = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    orderBy: "modifiedTime desc",
    pageSize: "100",
    fields: "files(id,name,modifiedTime,webViewLink)",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${query.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as { files?: Array<{ id?: string; name?: string; modifiedTime?: string; webViewLink?: string }>; error?: { message?: string } };
  if (!response.ok) {
    const message = payload.error?.message || "Não consegui listar suas planilhas.";
    if (/insufficient|scope|permission/i.test(message)) throw new Error("Reconecte o Google Sheets para permitir a listagem das suas planilhas.");
    throw new Error(message);
  }
  return { files: (payload.files ?? []).filter((file) => file.id && file.name).map((file) => ({ id: file.id!, name: file.name!, modifiedTime: file.modifiedTime ?? null, url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit` })) };
};

export const saveBroadcastGoogleSheetSource = async (
  userId: number,
  instanceId: number,
  listId: string,
  sheetUrl: string,
  mapping?: GoogleSheetMapping,
) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) throw new Error("Lista não encontrada.");
  const url = text(sheetUrl, 2_000);
  if (!url) throw new Error("Informe a planilha que será sincronizada.");
  sheetParts(url);
  await getDb().query(
    "UPDATE bot_broadcast_lists SET google_sheet_url=?,google_sheet_mapping_json=?,google_sheet_last_synced_at=CURRENT_TIMESTAMP WHERE id=?",
    [url, JSON.stringify(mapping ?? {}), listId],
  );
};

export const syncBroadcastGoogleSheet = async (
  userId: number,
  instanceId: number,
  listId: string,
  apply = false,
) => {
  const list = await ensureListAccess(userId, instanceId, listId);
  if (!list) throw new Error("Lista não encontrada.");
  const sheetUrl = text(list.google_sheet_url, 2_000);
  if (!sheetUrl) return { configured: false, newContacts: 0, totalInSheet: 0, preview: [] as Array<Record<string, string>> };
  const mapping = parseJsonRecord(list.google_sheet_mapping_json ?? null) as GoogleSheetMapping;
  const sheetContacts = await contactsFromGoogleSheet(sheetUrl, userId, mapping);
  const [existingRows] = await getDb().query<RowDataPacket[]>("SELECT normalized_phone FROM bot_broadcast_contacts WHERE list_id=?", [listId]);
  const existing = new Set(existingRows.map((row) => String(row.normalized_phone)));
  const fresh = sheetContacts.filter((contact) => !existing.has(contactKey(contact)));
  if (apply && fresh.length) await addBroadcastContacts(userId, instanceId, listId, fresh);
  if (apply) await getDb().query("UPDATE bot_broadcast_lists SET google_sheet_last_synced_at=CURRENT_TIMESTAMP WHERE id=?", [listId]);
  return {
    configured: true,
    applied: apply,
    newContacts: fresh.length,
    totalInSheet: sheetContacts.length,
    preview: fresh.slice(0, 10).map((contact) => ({ name: contact.name, phone: contact.phone })),
  };
};
