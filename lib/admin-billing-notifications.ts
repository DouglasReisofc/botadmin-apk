import { randomUUID } from "crypto";
import { ResultSetHeader, RowDataPacket } from "mysql2";

import {
  ensureAdminBillingNotificationsTable,
  getDb,
} from "./db";
import { resolveUploadedFileUrl } from "./uploads";
import type {
  BillingNotificationRule,
  BillingNotificationSettings,
} from "types/admin-notifications";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const DEFAULT_SEND_TIME = "09:00";

const DEFAULT_RULES: BillingNotificationRule[] = [
  {
    id: randomUUID(),
    label: "2 dias antes do vencimento",
    enabled: true,
    offsetDays: -2,
    sendTime: DEFAULT_SEND_TIME,
    channels: { email: true, push: true },
    subject: "🔔 Seu plano vence em {{due_date}}",
    emailHtml:
      "<p>Olá {{user_name}},</p><p>Seu plano <strong>{{plan_name}}</strong> vence em {{due_date}}.</p><p>Valor: {{plan_amount}}.</p><p>Renove acessando <a href=\"{{dashboard_url}}\">seu painel</a>.</p>",
    pushTitle: "Plano vence em breve",
    pushBody: "Olá {{user_name}}, seu plano vence em {{due_date}}. Renove para manter seu bot ativo.",
    pushImagePath: null,
    pushImageUrl: null,
    pushTargetUrl: "{{dashboard_url}}",
  },
  {
    id: randomUUID(),
    label: "Dia do vencimento",
    enabled: true,
    offsetDays: 0,
    sendTime: DEFAULT_SEND_TIME,
    channels: { email: true, push: true },
    subject: "⚠️ Plano vencendo hoje ({{due_date}})",
    emailHtml:
      "<p>Olá {{user_name}},</p><p>O plano <strong>{{plan_name}}</strong> vence hoje.</p><p>Valor: {{plan_amount}}.</p><p>Renove agora para manter o bot funcionando sem interrupções.</p>",
    pushTitle: "Plano vence hoje",
    pushBody: "Ei {{user_name}}, seu plano vence hoje. Renove para não interromper o serviço.",
    pushImagePath: null,
    pushImageUrl: null,
    pushTargetUrl: "{{dashboard_url}}",
  },
];

type RawSettingsRow = RowDataPacket & {
  settings: string | null;
  timezone: string | null;
  updated_at: Date | string | null;
};

const clampOffsetDays = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < -30) return -30;
  if (value > 30) return 30;
  return Math.trunc(value);
};

const normalizeTime = (value: string | null | undefined, fallback = DEFAULT_SEND_TIME): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    return fallback;
  }
  const [hoursRaw, minutesRaw] = trimmed.split(":");
  const hours = Math.min(Math.max(Number.parseInt(hoursRaw, 10) || 0, 0), 23)
    .toString()
    .padStart(2, "0");
  const minutes = Math.min(Math.max(Number.parseInt(minutesRaw, 10) || 0, 0), 59)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}`;
};

const sanitizeString = (value: unknown, maxLength: number, fallback = ""): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, maxLength);
};

const sanitizeUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 500);
};

const sanitizeMediaPath = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith("uploads/")) {
    return null;
  }
  return trimmed.slice(0, 600);
};

const sanitizeRule = (
  rule: Partial<BillingNotificationRule> | null | undefined,
  fallbackLabel: string,
  defaultTime: string,
): BillingNotificationRule => {
  const id =
    typeof rule?.id === "string" && rule.id.trim() ? rule.id.trim() : randomUUID();

  const label = sanitizeString(rule?.label, 120, fallbackLabel);

  const enabled = Boolean(rule?.enabled ?? true);

  const offsetDays = clampOffsetDays(
    typeof rule?.offsetDays === "number"
      ? rule.offsetDays
      : Number.parseInt(String(rule?.offsetDays ?? 0), 10),
  );

  const sendTime = normalizeTime(rule?.sendTime ?? null, defaultTime);

  const channels = {
    email: Boolean(rule?.channels?.email ?? true),
    push: Boolean(rule?.channels?.push ?? true),
  };

  const subject = sanitizeString(rule?.subject, 200, "Atualização do plano");
  const emailHtml = sanitizeString(rule?.emailHtml, 8000, "<p>Atualização sobre seu plano.</p>");
  const pushTitle = sanitizeString(rule?.pushTitle, 100, subject);
  const pushBody = sanitizeString(
    rule?.pushBody,
    500,
    "Seu plano foi atualizado. Acesse o painel para mais detalhes.",
  );
  const pushImagePath = sanitizeMediaPath((rule as BillingNotificationRule | undefined)?.pushImagePath);
  const rawPushImageUrl = sanitizeUrl(rule?.pushImageUrl);
  const pushImageUrl = pushImagePath ? resolveUploadedFileUrl(pushImagePath) : rawPushImageUrl;
  const pushTargetUrl = sanitizeUrl(rule?.pushTargetUrl);

  return {
    id,
    label,
    enabled,
    offsetDays,
    sendTime,
    channels,
    subject,
    emailHtml,
    pushTitle,
    pushBody,
    pushImagePath,
    pushImageUrl,
    pushTargetUrl,
  };
};

const sanitizeTimezone = (value: unknown): string => {
  if (typeof value !== "string") {
    return DEFAULT_TIMEZONE;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return DEFAULT_TIMEZONE;
  }
};

const buildSettings = (raw: unknown, timezone: string | null): BillingNotificationSettings => {
  const payload =
    raw && typeof raw === "object"
      ? (raw as { rules?: unknown; defaultSendTime?: unknown })
      : {};

  const defaultSendTime = normalizeTime(
    typeof payload.defaultSendTime === "string" ? payload.defaultSendTime : null,
    DEFAULT_SEND_TIME,
  );

  const rawRules = Array.isArray(payload.rules) ? payload.rules : DEFAULT_RULES;

  const sanitizedRules = rawRules
    .map((entry, index) =>
      sanitizeRule(entry as Partial<BillingNotificationRule>, `Lembrete ${index + 1}`, defaultSendTime),
    )
    .slice(0, 12);

  return {
    timezone: sanitizeTimezone(timezone ?? DEFAULT_TIMEZONE),
    defaultSendTime,
    rules: sanitizedRules,
    updatedAt: new Date().toISOString(),
  };
};

export const getBillingNotificationSettings = async (): Promise<BillingNotificationSettings> => {
  await ensureAdminBillingNotificationsTable();
  const db = getDb();

  const [rows] = await db.query<RawSettingsRow[]>(
    `SELECT settings, timezone, updated_at FROM admin_billing_notifications WHERE id = 1 LIMIT 1`,
  );

  if (Array.isArray(rows) && rows.length > 0) {
    const row = rows[0];
    let parsed: unknown = null;
    if (typeof row.settings === "string" && row.settings.trim()) {
      try {
        parsed = JSON.parse(row.settings);
      } catch {
        parsed = null;
      }
    } else if (row.settings && typeof row.settings === "object") {
      parsed = row.settings;
    }
    const settings = buildSettings(parsed, row.timezone);
    settings.updatedAt =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : typeof row.updated_at === "string"
          ? new Date(row.updated_at).toISOString()
          : null;
    return settings;
  }

  return buildSettings(null, DEFAULT_TIMEZONE);
};

export const updateBillingNotificationSettings = async (
  settings: BillingNotificationSettings,
): Promise<BillingNotificationSettings> => {
  await ensureAdminBillingNotificationsTable();
  const db = getDb();

  const sanitized = buildSettings(
    {
      rules: settings.rules,
      defaultSendTime: settings.defaultSendTime,
    },
    settings.timezone,
  );

  await db.query<ResultSetHeader>(
    `
      INSERT INTO admin_billing_notifications (id, settings, timezone, updated_at)
      VALUES (1, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        settings = VALUES(settings),
        timezone = VALUES(timezone),
        updated_at = NOW()
    `,
    [JSON.stringify({ defaultSendTime: sanitized.defaultSendTime, rules: sanitized.rules }), sanitized.timezone],
  );

  return getBillingNotificationSettings();
};

export const BILLING_NOTIFICATION_VARIABLES: Array<{ token: string; description: string }> = [
  { token: "{{user_name}}", description: "Nome completo do usuário" },
  { token: "{{user_first_name}}", description: "Primeiro nome do usuário" },
  { token: "{{user_email}}", description: "E-mail do usuário" },
  { token: "{{plan_name}}", description: "Nome do plano ou assinatura" },
  { token: "{{plan_amount}}", description: "Valor do plano formatado" },
  { token: "{{due_date}}", description: "Data de vencimento formatada" },
  { token: "{{due_datetime}}", description: "Data e hora de vencimento (ISO)" },
  { token: "{{dashboard_url}}", description: "URL do painel do usuário" },
  { token: "{{payment_url}}", description: "URL do checkout ou pagamento" },
];
