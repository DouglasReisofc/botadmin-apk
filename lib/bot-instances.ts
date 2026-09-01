import { randomBytes } from "crypto";
import { ResultSetHeader, RowDataPacket } from "mysql2";

import type {
  BotInstance,
  BotInstanceAction,
  BotInstanceProfile,
  BotInstanceProfileUpdatePayload,
  BotInstancePayload,
  BotInstanceRenamePayload,
  BotInstanceStatus,
  BotInstancePurpose,
  BotInstanceAdminSummary,
  BotInstanceUpdatePayload,
} from "types/bot-instances";
import type { SubscriptionPlan } from "types/plans";
import {
  BotInstanceRow,
  BotServerRow,
  ensureBotGroupTable,
  ensureBotInstanceTable,
  ensureBotServerTable,
  getDb,
} from "./db";
import { BotServerError, getAllBotServers, getBotServerById } from "./bot-servers";
import {
  SubscriptionPlanError,
  assignProfileSlotToProfile,
  assertUserHasActivePlan,
  getAvailableProfileSlotForUser,
  getUserPlanStatus,
  getUserPlanLimits,
  validatePlanInstanceLimit,
} from "./plans";
import type { AvailableProfileSlot } from "./plans";
import {
  countUserProfiles,
  createUserProfile,
  deleteUserProfile,
  getUserProfileById,
  listUserProfiles,
  migrateLegacyProfileInstances,
  profileToInstanceStub,
} from "lib/bot-user-profiles";
import { deleteWhatsappConversationsForInstance } from "lib/whatsapp-conversations";
import { deleteUserMediaStorageObjectsForInstance } from "lib/user-media-storage";
import { evaluateBotResalePaymentReadiness } from "lib/bot-resale-payments";
import { invalidateInstanceByTokenCache } from "lib/bot-events/cache";
import { applyConfiguredProxyToRemote } from "lib/instance-proxy";

class BotInstanceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BotInstanceError";
    this.status = status;
  }
}

export type DeleteInstanceGroupStrategy = "delete_all" | "keep_active";

type DeleteInstanceOptions = {
  groupStrategy?: DeleteInstanceGroupStrategy;
};

type DeleteInstanceResult = {
  strategy: DeleteInstanceGroupStrategy;
  deletedGroups: number;
  keptGroups: number;
  conversationsDeleted: number;
  messagesDeleted: number;
  realtimeEventsDeleted: number;
  mediaObjectsDeleted: number;
  r2ObjectsDeleted: number;
  flowsDeleted: number;
};

type InstanceRowWithServer = BotInstanceRow & {
  user_name: string;
  user_email: string;
  server_name: string;
  server_base_url: string;
  server_api_type: string;
  server_global_api_key: string;
  server_session_limit: number;
};

// Subscribe only to events that power BotAdmin features. `All` also includes
// high-volume delivery/read receipts and full history noise, which can starve
// live message commands in the webhook queue during reconnects.
export const BOT_EVENT_SUBSCRIPTIONS = [
  "Message",
  "UndecryptableMessage",
  "ChatAction",
  "MessageAction",
  "GroupInfo",
  "JoinedGroup",
  "Picture",
  "Connected",
  "Disconnected",
  "ConnectFailure",
  "KeepAliveRestored",
  "KeepAliveTimeout",
  "LoggedOut",
  "ClientOutdated",
  "TemporaryBan",
  "StreamError",
  "StreamReplaced",
  "PairSuccess",
  "PairError",
  "QR",
  "CallOffer",
  "CallAccept",
  "CallTerminate",
  "CallReject",
  "Presence",
  "ChatPresence",
] as const;

export const DEFAULT_EVENTS = BOT_EVENT_SUBSCRIPTIONS.join(",");

const sanitizeBotEvents = (_input?: string[]): string[] => {
  // Migrate legacy `All` subscriptions to the bounded production set too.
  // The UI does not currently expose per-instance event selection.
  return [...BOT_EVENT_SUBSCRIPTIONS];
};

const DEFAULT_WEBHOOK_URL = (() => {
  const explicit = (process.env.BOT_EVENT_WEBHOOK_URL || "").trim();
  if (explicit) {
    return explicit;
  }

  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_CAP_SERVER_URL || "").trim();
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      url.pathname = "/api/webhooks/bot-events";
      return url.toString();
    } catch {
      /* ignore invalid */
    }
  }

  return "https://botadmin.shop/api/webhooks/bot-events";
})();

const normalizePhone = (value: unknown): string => {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BotInstanceError("Informe o número do WhatsApp.");
  }

  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 16) {
    throw new BotInstanceError("Número de WhatsApp inválido.");
  }

  return digits;
};

const normalizeName = (raw: unknown, fallback: string): string => {
  if (typeof raw !== "string") {
    return fallback;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.length > 120) {
    return trimmed.slice(0, 120);
  }
  return trimmed;
};

const parseDate = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const isInstanceProfileLicenseActive = (
  expiresAt: Date | string | null | undefined,
  now = Date.now(),
): boolean => {
  if (!expiresAt) return false;
  const parsed = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(parsed) && parsed > now;
};

const mapInstanceRow = (row: InstanceRowWithServer): BotInstance => ({
  id: row.id,
  userId: row.user_id,
  serverId: row.server_id,
  serverName: row.server_name,
  serverBaseUrl: row.server_base_url,
  serverApiType: row.server_api_type,
  name: row.name,
  phone: row.phone,
  token: row.token,
  remoteId: row.remote_id,
  webhookUrl: row.webhook_url,
  events: row.events,
  autoRead: row.auto_read === 1,
  pvEnabled: row.pv_enabled === 1,
  licenseSalesEnabled: row.license_sales_enabled === 1,
  purpose: normalizeInstancePurpose(row.purpose),
  sessionStatus: (row.session_status as BotInstanceStatus) ?? "desconectado",
  desiredSessionState:
    row.desired_session_state === "disconnected" ? "disconnected" : "connected",
  lastStatusSync: parseDate(row.last_status_sync),
  expiresAt: parseDate(row.expires_at),
  planId: row.plan_id,
  profileId: typeof row.profile_id === "number" ? row.profile_id : null,
  hasActiveSession: true,
  createdAt: parseDate(row.created_at)!,
  updatedAt: parseDate(row.updated_at)!,
});

const mapInstanceAdminRow = (row: InstanceRowWithServer): BotInstanceAdminSummary => ({
  ...mapInstanceRow(row),
  userName: row.user_name,
  userEmail: row.user_email,
});

const buildServerFromInstance = (instance: InstanceRowWithServer): BotServerRow => ({
  id: instance.server_id,
  name: instance.server_name,
  base_url: instance.server_base_url,
  api_type: instance.server_api_type,
  global_api_key: instance.server_global_api_key,
  session_limit: instance.server_session_limit,
  is_active: 1,
  created_at: new Date(),
  updated_at: new Date(),
});

const normalizeInstanceWebhook = (instance: InstanceRowWithServer): string => {
  const raw = typeof instance.webhook_url === "string" ? instance.webhook_url.trim() : "";
  return raw || DEFAULT_WEBHOOK_URL;
};

const normalizeInstanceEvents = (instance: InstanceRowWithServer): string => {
  const raw = typeof instance.events === "string" ? instance.events.trim() : "";
  if (!raw) return DEFAULT_EVENTS;
  const events = raw.split(",").map((event) => event.trim().toLowerCase());
  return events.includes("all") ? "All" : DEFAULT_EVENTS;
};

const normalizeInstancePurpose = (value: unknown): BotInstancePurpose => {
  if (value === "admin_system") return "admin_system";
  if (value === "session") return "session";
  return "profile";
};

const SESSION_INSTANCE_PURPOSES: BotInstancePurpose[] = ["profile", "session"];

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
};

const getErrorMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "";
};

const shouldRecreateRemoteInstance = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status && [401, 403, 404, 410].includes(status)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("not found") ||
    message.includes("não encontrado") ||
    message.includes("nao encontrado") ||
    message.includes("instância inválida") ||
    message.includes("instancia invalida") ||
    message.includes("invalid instance") ||
    message.includes("instance invalid") ||
    message.includes("unauthorized") ||
    message.includes("não autorizado") ||
    message.includes("nao autorizado") ||
    message.includes("invalid token") ||
    message.includes("token inválido") ||
    message.includes("token invalido") ||
    message.includes("no session") ||
    message.includes("session not found") ||
    message.includes("sessão não encontrada") ||
    message.includes("sessao nao encontrada")
  );
};

const isDisconnectedSessionError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("no session") ||
    message.includes("session not found") ||
    message.includes("sessão não encontrada") ||
    message.includes("sessao nao encontrada") ||
    message.includes("logged out") ||
    message.includes("desconectado") ||
    message.includes("disconnected")
  );
};

const isAlreadyDisconnectedActionError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    isDisconnectedSessionError(error) ||
    message.includes("not connected") ||
    message.includes("was not connected") ||
    message.includes("não estava conectado") ||
    message.includes("nao estava conectado")
  );
};

const isRemoteAlreadyExistsError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status === 409) {
    return true;
  }
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("já existe") ||
    message.includes("ja existe") ||
    message.includes("duplicate") ||
    message.includes("conflict")
  );
};

const recreateRemoteInstance = async (instance: InstanceRowWithServer): Promise<void> => {
  const server = buildServerFromInstance(instance);
  const webhook = normalizeInstanceWebhook(instance);
  const events = normalizeInstanceEvents(instance);
  let remoteId: string | number | null = null;

  try {
    const remote = await registerRemoteInstance(server, {
      name: instance.name,
      token: instance.token,
      webhook,
      events,
    });
    remoteId = remote.id ?? null;
  } catch (error) {
    if (!isRemoteAlreadyExistsError(error)) {
      throw error;
    }
  }

  const db = getDb();
  const updates: string[] = ["webhook_url = ?", "events = ?", "updated_at = CURRENT_TIMESTAMP"];
  const params: Array<string | number> = [webhook, events];

  if (remoteId !== null && remoteId !== undefined) {
    updates.push("remote_id = ?");
    params.push(remoteId);
  }

  params.push(instance.id);

  await db.query(
    `
      UPDATE bot_instances
      SET ${updates.join(", ")}
      WHERE id = ?
    `,
    params,
  );
};

const fetchInstanceRows = async (
  filters: {
    userId?: number;
    instanceId?: number;
    serverId?: number;
    token?: string;
    purpose?: BotInstancePurpose | BotInstancePurpose[];
    search?: string;
    order?: "asc" | "desc";
  } = {},
): Promise<InstanceRowWithServer[]> => {
  await ensureBotInstanceTable();
  await ensureBotServerTable();
  const db = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (typeof filters.userId === "number") {
    conditions.push("bi.user_id = ?");
    params.push(filters.userId);
  }

  if (typeof filters.instanceId === "number") {
    conditions.push("bi.id = ?");
    params.push(filters.instanceId);
  }

  if (typeof filters.serverId === "number") {
    conditions.push("bi.server_id = ?");
    params.push(filters.serverId);
  }

  if (typeof filters.token === "string" && filters.token.trim()) {
    conditions.push("bi.token = ?");
    params.push(filters.token.trim());
  }

  if (filters.purpose) {
    const purposes = (Array.isArray(filters.purpose) ? filters.purpose : [filters.purpose])
      .map(normalizeInstancePurpose);
    conditions.push(`bi.purpose IN (${purposes.map(() => "?").join(", ")})`);
    params.push(...purposes);
  }

  if (typeof filters.search === "string" && filters.search.trim()) {
    const normalized = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      `(LOWER(bi.name) LIKE ? OR LOWER(bi.phone) LIKE ? OR LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(bs.name) LIKE ?)`,
    );
    params.push(normalized, normalized, normalized, normalized, normalized);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderDirection = filters.order === "asc" ? "ASC" : "DESC";

  const [rows] = await db.query<(InstanceRowWithServer & RowDataPacket)[]>(
    `
      SELECT
        bi.*,
        u.name AS user_name,
        u.email AS user_email,
        bs.name AS server_name,
        bs.base_url AS server_base_url,
        bs.api_type AS server_api_type,
        bs.global_api_key AS server_global_api_key,
        bs.session_limit AS server_session_limit
      FROM bot_instances bi
      INNER JOIN bot_servers bs ON bs.id = bi.server_id
      INNER JOIN users u ON u.id = bi.user_id
      ${whereClause}
      ORDER BY bi.created_at ${orderDirection}, bi.id ${orderDirection}
    `,
    params,
  );

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows;
};

const fetchInstanceRowsForUser = async (
  userId: number,
  instanceId?: number,
  purpose: BotInstancePurpose | BotInstancePurpose[] = SESSION_INSTANCE_PURPOSES,
): Promise<InstanceRowWithServer[]> =>
  fetchInstanceRows({
    userId,
    instanceId: typeof instanceId === "number" ? instanceId : undefined,
    purpose,
    order: "asc",
  });

const getReusablePendingProfileInstance = async (
  userId: number,
  phone: string,
): Promise<BotInstance | null> => {
  await migrateLegacyProfileInstances();
  await ensureBotInstanceTable();
  await ensureBotServerTable();
  const db = getDb();

  const [rows] = await db.query<(InstanceRowWithServer & RowDataPacket)[]>(
    `
      SELECT
        bi.*,
        u.name AS user_name,
        u.email AS user_email,
        bs.name AS server_name,
        bs.base_url AS server_base_url,
        bs.api_type AS server_api_type,
        bs.global_api_key AS server_global_api_key,
        bs.session_limit AS server_session_limit
      FROM bot_instances bi
      INNER JOIN bot_servers bs ON bs.id = bi.server_id
      INNER JOIN users u ON u.id = bi.user_id
      WHERE bi.user_id = ?
        AND bi.phone = ?
        AND bi.profile_id IS NOT NULL
        AND COALESCE(bi.purpose, 'session') = 'session'
        AND bi.created_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)
        AND COALESCE(bi.session_status, 'desconectado') IN ('desconectado', 'inicializando', 'aguardando_qr')
        AND NOT EXISTS (SELECT 1 FROM bot_groups bg WHERE bg.instance_id = bi.id)
        AND NOT EXISTS (SELECT 1 FROM bot_whatsapp_conversations wc WHERE wc.instance_id = bi.id)
        AND NOT EXISTS (SELECT 1 FROM bot_whatsapp_messages wm WHERE wm.instance_id = bi.id)
      ORDER BY bi.created_at DESC, bi.id DESC
      LIMIT 1
    `,
    [userId, phone],
  );

  return Array.isArray(rows) && rows.length > 0 ? mapInstanceRow(rows[0]) : null;
};

export const listInstancesForAdmin = async (
  filters: { userId?: number; includeSystem?: boolean } = {},
): Promise<BotInstanceAdminSummary[]> => {
  await migrateLegacyProfileInstances();
  const rows = await fetchInstanceRows({
    userId: typeof filters.userId === "number" ? filters.userId : undefined,
    purpose: filters.includeSystem ? ["session", "profile", "admin_system"] : SESSION_INSTANCE_PURPOSES,
    order: "desc",
  });
  return rows.map(mapInstanceAdminRow);
};

export const getInstanceById = async (
  instanceId: number,
): Promise<BotInstanceAdminSummary | null> => {
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    return null;
  }
  const rows = await fetchInstanceRows({ instanceId, order: "desc" });
  if (!rows.length) {
    return null;
  }
  return mapInstanceAdminRow(rows[0]);
};

export const searchInstancesForServerAssignment = async (options: {
  query?: string | null;
  serverId?: number;
  limit?: number;
} = {}): Promise<BotInstanceAdminSummary[]> => {
  const { query, serverId, limit } = options;
  const normalizedLimit =
    Number.isFinite(limit) && Number(limit) > 0 ? Math.min(Math.floor(Number(limit)), 100) : 50;

  const rows = await fetchInstanceRows({
    serverId: typeof serverId === "number" ? serverId : undefined,
    search: typeof query === "string" ? query : undefined,
    order: "asc",
  });

  const summaries = rows.map(mapInstanceAdminRow);
  return summaries.slice(0, normalizedLimit);
};

const syncInstanceWebhookUsingRow = async (
  instance: InstanceRowWithServer,
  options: { webhookUrl?: string; events?: string[] } = {},
): Promise<BotInstanceAdminSummary> => {
  const targetWebhook = (options.webhookUrl ?? DEFAULT_WEBHOOK_URL).trim();
  if (!targetWebhook) {
    throw new BotInstanceError("URL de webhook inválida.", 400);
  }

  const normalizedEvents = sanitizeBotEvents(options.events);

  const server: BotServerRow = {
    id: instance.server_id,
    name: instance.server_name,
    base_url: instance.server_base_url,
    api_type: instance.server_api_type,
    global_api_key: instance.server_global_api_key,
    session_limit: instance.server_session_limit,
    is_active: 1,
    created_at: new Date(),
    updated_at: new Date(),
  };

  await callInstanceSession(server, instance.token, "/webhook", {
    method: "POST",
    body: JSON.stringify({
      webhook: targetWebhook,
      events: normalizedEvents,
    }),
  });

  const eventsValue = normalizedEvents.join(",");

  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET webhook_url = ?, events = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [targetWebhook, eventsValue, instance.id],
  );

  const updatedRow: InstanceRowWithServer = {
    ...instance,
    webhook_url: targetWebhook,
    events: eventsValue,
    updated_at: new Date(),
  };

  return mapInstanceAdminRow(updatedRow);
};

export const syncInstanceWebhookAdmin = async (
  instanceId: number,
  options: { webhookUrl?: string; events?: string[] } = {},
): Promise<BotInstanceAdminSummary> => {
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    throw new BotInstanceError("Instância inválida.", 404);
  }

  const rows = await fetchInstanceRows({ instanceId, order: "desc" });
  if (!rows.length) {
    throw new BotInstanceError("Instância não encontrada.", 404);
  }

  return syncInstanceWebhookUsingRow(rows[0], options);
};

export const syncAllInstanceWebhooksAdmin = async (
  options: { webhookUrl?: string; events?: string[] } = {},
): Promise<{
  total: number;
  succeeded: number;
  failures: Array<{ instanceId: number; name: string; error: string }>;
}> => {
  const rows = await fetchInstanceRows({ order: "asc" });
  if (!rows.length) {
    return { total: 0, succeeded: 0, failures: [] };
  }

  let succeeded = 0;
  const failures: Array<{ instanceId: number; name: string; error: string }> = [];

  for (const row of rows) {
    try {
      await syncInstanceWebhookUsingRow(row, options);
      succeeded += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Erro desconhecido ao sincronizar o webhook.";
      failures.push({
        instanceId: row.id,
        name: row.name,
        error: message,
      });
    }
  }

  return {
    total: rows.length,
    succeeded,
    failures,
  };
};

const ensureInstanceWebhookAll = async (instance: InstanceRowWithServer): Promise<void> => {
  try {
    await syncInstanceWebhookUsingRow(instance, {
      webhookUrl: DEFAULT_WEBHOOK_URL,
      events: [...BOT_EVENT_SUBSCRIPTIONS],
    });
  } catch (error) {
    console.warn("[bot-instances] failed to enforce All webhook events before connection", {
      instanceId: instance.id,
      token: instance.token,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const assignInstancesToServer = async (serverId: number, instanceIds: number[]): Promise<void> => {
  if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
    return;
  }

  if (!Number.isFinite(serverId) || serverId <= 0) {
    throw new BotInstanceError("Servidor inválido.", 400);
  }

  const uniqueIds = Array.from(new Set(instanceIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Number(id))));
  if (uniqueIds.length === 0) {
    return;
  }

  const server = await getBotServerById(serverId);
  if (!server) {
    throw new BotInstanceError("Servidor não encontrado.", 404);
  }

  await ensureBotInstanceTable();
  const db = getDb();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [currentAssignments] = await connection.query<RowDataPacket[]>(
      `SELECT id, server_id FROM bot_instances WHERE id IN (${uniqueIds.map(() => "?").join(",")}) FOR UPDATE`,
      uniqueIds,
    );

    if (!Array.isArray(currentAssignments) || currentAssignments.length === 0) {
      throw new BotInstanceError("Nenhuma instância encontrada para vincular.", 404);
    }

    const alreadyAssigned = currentAssignments
      .filter((row) => Number(row.server_id) === serverId)
      .map((row) => Number(row.id));

    const instancesToUpdate = uniqueIds.filter((id) => !alreadyAssigned.includes(id));

    if (server.sessionLimit > 0 && instancesToUpdate.length > 0) {
      const [countRows] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM bot_instances WHERE server_id = ?",
        [serverId],
      );
      const currentCount = Number(countRows?.[0]?.total ?? 0) - alreadyAssigned.length;
      if (currentCount + instancesToUpdate.length > server.sessionLimit) {
        throw new BotInstanceError("Limite de sessões do servidor excedido.", 400);
      }
    }

    if (instancesToUpdate.length > 0) {
      await connection.query(
        `
          UPDATE bot_instances
          SET server_id = ?, base_url = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${instancesToUpdate.map(() => "?").join(",")})
        `,
        [serverId, server.baseUrl, ...instancesToUpdate],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const requestJson = async <T>(
  input: RequestInfo,
  init: RequestInit & { expectedStatus?: number } = {},
): Promise<T> => {
  const { expectedStatus, ...options } = init;
  const response = await fetch(input, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* ignore */
  }

  if (!response.ok || (typeof expectedStatus === "number" && response.status !== expectedStatus)) {
    const errorData =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const messageValue = errorData?.message ?? errorData?.error ?? errorData?.detail ?? errorData?.data;
    const message = typeof messageValue === "string"
      ? messageValue
      : `Falha na requisição (${response.status})`;
    throw new BotInstanceError(message, response.status);
  }

  return payload as T;
};

const callServerAdmin = async <T>(
  server: BotServerRow,
  path: string,
  init: RequestInit & { expectedStatus?: number } = {},
): Promise<T> => {
  const base = server.base_url.replace(/\/+$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return requestJson<T>(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: server.global_api_key,
    },
  });
};

const callInstanceSession = async <T>(
  server: BotServerRow,
  token: string,
  path: string,
  init: RequestInit & { expectedStatus?: number } = {},
): Promise<T> => {
  const base = server.base_url.replace(/\/+$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return requestJson<T>(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      token,
    },
  });
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseJsonRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
};

const hasGroupActivationHistory = (metadata: unknown): boolean => {
  const record = parseJsonRecord(metadata);
  const activatedAt = typeof record.activatedAt === "string" ? record.activatedAt.trim() : "";
  const lastActivatedAt =
    typeof record.lastActivatedAt === "string" ? record.lastActivatedAt.trim() : "";
  const activatedAtCompat =
    typeof record.activated_at === "string" ? record.activated_at.trim() : "";
  const lastActivatedAtCompat =
    typeof record.last_activated_at === "string" ? record.last_activated_at.trim() : "";
  return Boolean(activatedAt || lastActivatedAt || activatedAtCompat || lastActivatedAtCompat);
};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const firstBoolean = (...values: unknown[]): boolean | null => {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (!normalized) continue;
      if (["1", "true", "yes", "on", "sim"].includes(normalized)) return true;
      if (["0", "false", "no", "off", "nao", "não"].includes(normalized)) return false;
    }
  }
  return null;
};

const normalizePhoneJidCandidate = (value: string): string | null => {
  const localPart = value.includes("@") ? value.split("@")[0] ?? "" : value;
  const phonePart = localPart.split(":")[0] ?? localPart;
  const digits = phonePart.replace(/\D+/g, "");
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
};

const normalizePhoneDigitsCandidate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const localPart = value.includes("@") ? value.split("@")[0] ?? "" : value;
  const phonePart = localPart.split(":")[0] ?? localPart;
  const digits = phonePart.replace(/\D+/g, "");
  return digits.length >= 10 && digits.length <= 16 ? digits : null;
};

const normalizeStatusResponse = (payload: unknown): {
  status: BotInstanceStatus;
  node: Record<string, unknown>;
} => {
  const root = toRecord(payload) ?? {};
  const dataNode =
    toRecord(root.data) ??
    toRecord(root.Data) ??
    toRecord(root.session) ??
    toRecord(root.Session) ??
    root;

  const infoNode =
    toRecord(dataNode.info) ??
    toRecord(dataNode.Info) ??
    toRecord(dataNode.profile) ??
    toRecord(dataNode.Profile) ??
    null;

  const loggedIn = firstBoolean(
    dataNode.loggedIn,
    dataNode.LoggedIn,
    dataNode.isLoggedIn,
    infoNode?.loggedIn,
    infoNode?.LoggedIn,
  );
  const hasQr = Boolean(
    firstString(
      dataNode.qrcode,
      dataNode.QRCode,
      dataNode.qr,
      dataNode.QrCode,
      infoNode?.qrcode,
      infoNode?.QRCode,
      infoNode?.qr,
    ),
  );
  const connected = firstBoolean(
    dataNode.connected,
    dataNode.Connected,
    dataNode.isConnected,
    infoNode?.connected,
    infoNode?.Connected,
  );
  const jid = firstString(
    dataNode.JID,
    dataNode.jid,
    dataNode.Jid,
    dataNode.ID,
    dataNode.id,
    infoNode?.JID,
    infoNode?.jid,
    infoNode?.Jid,
    infoNode?.ID,
    infoNode?.id,
  );
  const starting = firstBoolean(
    dataNode.starting,
    dataNode.initializing,
    dataNode.Initializing,
    dataNode.Starting,
  );
  const sessionState =
    firstString(
      dataNode.status,
      dataNode.Status,
      dataNode.state,
      dataNode.State,
      infoNode?.status,
      infoNode?.Status,
    )?.toLowerCase() ?? "";
  const reconnecting =
    sessionState.includes("connecting") ||
    sessionState.includes("reconnecting") ||
    sessionState.includes("starting") ||
    sessionState.includes("initializing");
  const offlineState =
    sessionState.includes("disconnect") ||
    sessionState.includes("loggedout") ||
    sessionState.includes("logged_out") ||
    sessionState.includes("offline");

  let status: BotInstanceStatus = "desconectado";
  // Wuzapi can retain `loggedIn: true` while its socket is explicitly
  // `connected: false`. `loggedIn` means credentials exist, not that sending
  // is currently possible, so the explicit transport state must win.
  if (connected === false) status = reconnecting ? "inicializando" : "desconectado";
  else if (offlineState) status = "desconectado";
  else if (loggedIn === true) status = "conectado";
  else if (hasQr) status = "aguardando_qr";
  else if (loggedIn === false && connected === true) status = "aguardando_pareamento";
  else if (loggedIn === false) status = "desconectado";
  else if (connected === true && normalizePhoneDigitsCandidate(jid)) status = "conectado";
  else if (connected === true) status = "aguardando_pareamento";
  else if (starting === true) status = "inicializando";

  return { status, node: { ...dataNode, ...(infoNode ? { __info: infoNode } : {}) } };
};

const resolveProfileFromStatusNode = (
  instance: InstanceRowWithServer,
  node: Record<string, unknown>,
): {
  pushName: string | null;
  statusText: string | null;
  jid: string | null;
} => {
  const infoNode = toRecord(node.__info) ?? {};
  const jid =
    firstString(
      node.JID,
      node.jid,
      node.ID,
      node.id,
      infoNode.JID,
      infoNode.jid,
      infoNode.ID,
      infoNode.id,
    ) ?? normalizePhoneJidCandidate(instance.phone);
  const rawStatusText = firstString(
    node.About,
    node.about,
    node.StatusText,
    node.statusText,
    infoNode.About,
    infoNode.about,
    infoNode.StatusText,
    infoNode.statusText,
  );
  const statusText = rawStatusText && !/^(connected|conectado|connecting|conectando|reconnecting|reconectando|disconnected|desconectado|offline|online|logged[_ ]?in|aguardando[_ ]?(qr|pareamento)|inicializando|initializing)$/i.test(rawStatusText)
    ? rawStatusText
    : null;

  return {
    pushName: firstString(
      node.PushName,
      node.pushName,
      node.Name,
      node.name,
      infoNode.PushName,
      infoNode.pushName,
      infoNode.Name,
      infoNode.name,
    ),
    statusText,
    jid,
  };
};

const resolveAvatarUrlFromPayload = (payload: unknown): string | null => {
  const root = toRecord(payload) ?? {};
  const node =
    toRecord(root.data) ??
    toRecord(root.Data) ??
    toRecord(root.avatar) ??
    root;

  const directPath = firstString(
    node.DirectPath,
    node.directPath,
    node.direct_path,
  );
  if (directPath && directPath.startsWith("/")) {
    return `https://pps.whatsapp.net${directPath}`;
  }

  return firstString(
    node.URL,
    node.Url,
    node.url,
    node.avatar,
    node.Avatar,
    node.picture,
    node.Picture,
    node.href,
    node.link,
  );
};

const fetchInstanceAvatarUrl = async (
  instance: InstanceRowWithServer,
  candidateContacts: string[],
): Promise<string | null> => {
  const server = buildServerFromInstance(instance);
  for (const contact of candidateContacts) {
    try {
      const payload = await callInstanceSession<unknown>(
        server,
        instance.token,
        "/user/avatar",
        {
          method: "POST",
          body: JSON.stringify({ Phone: contact, Preview: false }),
        },
      );
      const url = resolveAvatarUrlFromPayload(payload);
      if (url) return url;
    } catch (error) {
      const status = getErrorStatus(error);
      if (status === 404 || status === 400) {
        continue;
      }
    }
  }
  return null;
};

const tryCallProfileEndpoint = async (
  instance: InstanceRowWithServer,
  pathVariants: string[],
  body: Record<string, unknown> | Array<Record<string, unknown>>,
): Promise<void> => {
  const server = buildServerFromInstance(instance);
  const payloads = Array.isArray(body) ? body.filter(Boolean) : [body];
  let lastError: unknown = null;

  for (const path of pathVariants) {
    let pathUnsupported = false;
    for (const payload of payloads) {
      try {
        await callInstanceSession<unknown>(server, instance.token, path, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        return;
      } catch (error) {
        const status = getErrorStatus(error);
        lastError = error;
        if (status === 404 || status === 405) {
          pathUnsupported = true;
          break;
        }
      }
    }
    if (pathUnsupported) {
      continue;
    }
  }

  throw lastError ?? new BotInstanceError("Falha ao atualizar perfil da instância.", 500);
};

const generateToken = () => randomBytes(24).toString("hex");

const ensureServerCapacity = async (server: BotServerRow): Promise<void> => {
  if (!server.session_limit || server.session_limit <= 0) {
    return;
  }

  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM bot_instances WHERE server_id = ?",
    [server.id],
  );
  const total = Array.isArray(rows) && rows.length > 0 ? Number(rows[0].total ?? 0) : 0;
  if (total >= server.session_limit) {
    throw new BotInstanceError(
      "O servidor selecionado atingiu o limite de instâncias disponíveis.",
      409,
    );
  }
};

type ListInstancesForUserOptions = {
  refreshStatus?: boolean;
  refreshConcurrency?: number;
};

export const listInstancesForUser = async (
  userId: number,
  options: ListInstancesForUserOptions = {},
): Promise<BotInstance[]> => {
  await migrateLegacyProfileInstances();
  const [profiles, sessionRows] = await Promise.all([
    listUserProfiles(userId),
    fetchInstanceRowsForUser(userId),
  ]);
  const sessions = sessionRows.map(mapInstanceRow);
  const sessionsByProfileId = new Map<number, BotInstance>();
  sessions.forEach((session) => {
    if (typeof session.profileId === "number" && session.profileId > 0) {
      sessionsByProfileId.set(session.profileId, session);
    }
  });

  const instances = profiles.map((profile) => {
    const session = sessionsByProfileId.get(profile.id);
    if (session) {
      return {
        ...session,
        name: profile.name,
        phone: session.phone || profile.phone || "",
        expiresAt: profile.expiresAt ?? session.expiresAt,
        planId: profile.planId ?? session.planId,
        profileId: profile.id,
        hasActiveSession: true,
        purpose: "profile" as BotInstancePurpose,
      };
    }
    return profileToInstanceStub(profile);
  });

  const orphanSessions = sessions.filter(
    (session) => !session.profileId || !profiles.some((profile) => profile.id === session.profileId),
  );
  instances.push(...orphanSessions);

  if (!options.refreshStatus || instances.length === 0) {
    return instances;
  }

  const concurrency = Math.max(
    1,
    Math.min(options.refreshConcurrency ?? 4, instances.length),
  );
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const instance = instances[index++];
      if (!instance) {
        return;
      }
      if (!instance.hasActiveSession) {
        continue;
      }
      try {
        instance.sessionStatus = await refreshInstanceStatus(userId, instance.id);
      } catch (error) {
        console.warn("Failed to refresh instance status", {
          instanceId: instance.id,
          error,
        });
      }
    }
  });

  await Promise.all(workers);
  return instances;
};

export const getInstanceForUser = async (
  userId: number,
  instanceId: number,
): Promise<BotInstance | null> => {
  await migrateLegacyProfileInstances();
  const rows = await fetchInstanceRowsForUser(userId, instanceId);
  if (rows.length) {
    return mapInstanceRow(rows[0]);
  }
  const profile = await getUserProfileById(userId, instanceId);
  return profile ? profileToInstanceStub(profile) : null;
};

export const applyInstanceProfileLicenseForUser = async (
  userId: number,
  instanceId: number,
  plan: SubscriptionPlan,
): Promise<BotInstance> => {
  const normalizedInstanceId = Number(instanceId);
  if (!Number.isFinite(normalizedInstanceId) || normalizedInstanceId <= 0) {
    throw new BotInstanceError("Instância inválida.", 404);
  }
  if (!plan || !Number.isFinite(plan.id) || plan.id <= 0) {
    throw new BotInstanceError("Plano inválido para liberar o perfil.", 400);
  }
  if (!plan.isActive) {
    throw new BotInstanceError("Este plano está inativo no momento.", 400);
  }

  await migrateLegacyProfileInstances();
  const rows = await fetchInstanceRowsForUser(userId, normalizedInstanceId);
  const row = rows[0] ?? null;
  const directProfile = await getUserProfileById(userId, normalizedInstanceId);
  const profileId =
    typeof row?.profile_id === "number" && row.profile_id > 0
      ? row.profile_id
      : directProfile?.id ?? null;
  if (!row && !directProfile) {
    throw new BotInstanceError("Perfil não encontrado.", 404);
  }
  const now = new Date();
  const expiryCandidates = [row?.expires_at ?? null, directProfile?.expiresAt ?? null]
    .map((value) => (value ? new Date(value) : null))
    .filter((value): value is Date => Boolean(value && !Number.isNaN(value.getTime())));
  const currentExpiry = expiryCandidates.sort(
    (left, right) => right.getTime() - left.getTime(),
  )[0] ?? null;
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  const nextExpiry = new Date(base.getTime() + Math.max(1, Math.floor(plan.durationDays || 1)) * DAY_IN_MS);

  await ensureBotInstanceTable();
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (profileId) {
      await connection.query(
        `
          UPDATE bot_user_profiles
          SET plan_id = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?
        `,
        [plan.id, nextExpiry, profileId, userId],
      );
      await connection.query(
        `
          UPDATE bot_instances
          SET plan_id = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE profile_id = ? AND user_id = ?
        `,
        [plan.id, nextExpiry, profileId, userId],
      );
    } else if (row) {
      await connection.query(
        `
          UPDATE bot_instances
          SET plan_id = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?
        `,
        [plan.id, nextExpiry, row.id, userId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const lookupId = row?.id ?? profileId ?? normalizedInstanceId;
  const updated = await getInstanceForUser(userId, lookupId);
  if (!updated) {
    throw new BotInstanceError("Instância não encontrada após atualização.", 404);
  }
  return updated;
};

const applyProfileSlotLicenseToInstance = async (
  userId: number,
  instanceId: number,
  slot: AvailableProfileSlot,
): Promise<BotInstance | null> => {
  const expiresAt = slot.expiresAt ? new Date(slot.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return getInstanceForUser(userId, instanceId);
  }

  await ensureBotInstanceTable();
  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET plan_id = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [slot.planId ?? null, expiresAt, instanceId, userId],
  );
  await db.query(
    `
      UPDATE bot_user_profiles bup
      INNER JOIN bot_instances bi ON bi.profile_id = bup.id
      SET bup.plan_id = ?, bup.expires_at = ?, bup.updated_at = CURRENT_TIMESTAMP
      WHERE bi.id = ? AND bi.user_id = ? AND bup.user_id = ?
    `,
    [slot.planId ?? null, expiresAt, instanceId, userId, userId],
  ).catch(() => undefined);

  const updated = await getInstanceForUser(userId, instanceId);
  if (updated?.profileId) {
    await assignProfileSlotToProfile(
      userId,
      slot,
      updated.profileId,
      updated.id,
    );
  }
  return updated;
};

const assertInstanceOwnership = async (
  userId: number,
  instanceId: number,
): Promise<InstanceRowWithServer> => {
  const rows = await fetchInstanceRowsForUser(userId, instanceId);
  if (!rows.length) {
    throw new BotInstanceError("Instância não encontrada.", 404);
  }
  return rows[0];
};

const countUserInstances = async (userId: number): Promise<number> => countUserProfiles(userId);

const getActiveSessionRowForProfile = async (
  userId: number,
  profileId: number,
): Promise<InstanceRowWithServer | null> => {
  const rows = await fetchInstanceRowsForUser(userId);
  return rows.find((row) => row.profile_id === profileId) ?? null;
};

export const createSessionForProfile = async (
  userId: number,
  profileId: number,
  payload: { serverId?: number; phone: string; name?: string },
): Promise<BotInstance> => {
  await migrateLegacyProfileInstances();
  const profile = await getUserProfileById(userId, profileId);
  if (!profile) {
    throw new BotInstanceError("Perfil não encontrado.", 404);
  }

  const existing = await getActiveSessionRowForProfile(userId, profileId);
  if (existing) {
    return mapInstanceRow(existing);
  }

  let serverId = payload.serverId;
  if (!Number.isFinite(serverId) || Number(serverId) <= 0) {
    const servers = await getAllBotServers();
    const activeServer = servers.find((entry) => entry.isActive) ?? servers[0];
    if (!activeServer) {
      throw new BotInstanceError("Nenhum servidor disponível para reconectar o perfil.", 503);
    }
    serverId = activeServer.id;
  }

  const phone = normalizePhone(payload.phone || profile.phone || "");
  const instanceName = normalizeName(payload.name ?? profile.name, phone);
  const server = await getBotServerById(serverId);
  if (!server || !server.isActive) {
    throw new BotInstanceError("Servidor inválido ou inativo.", 404);
  }

  await ensureServerCapacity({
    id: server.id,
    name: server.name,
    base_url: server.baseUrl,
    api_type: server.apiType,
    global_api_key: server.globalApiKey,
    session_limit: server.sessionLimit,
    is_active: server.isActive ? 1 : 0,
    created_at: new Date(),
    updated_at: new Date(),
  });

  const token = generateToken();
  let remoteId: string | number | null = null;
  try {
    const remote = await registerRemoteInstance(
      {
        id: server.id,
        name: server.name,
        base_url: server.baseUrl,
        api_type: server.apiType,
        global_api_key: server.globalApiKey,
        session_limit: server.sessionLimit,
        is_active: server.isActive ? 1 : 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
      { name: instanceName, token, webhook: DEFAULT_WEBHOOK_URL, events: DEFAULT_EVENTS },
    );
    remoteId = remote.id ?? null;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível registrar a sessão no servidor remoto.";
    const status =
      typeof (error as { status?: unknown })?.status === "number"
        ? Number((error as { status: number }).status)
        : 502;
    throw new BotInstanceError(message, status);
  }

  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_instances (
        user_id,
        profile_id,
        server_id,
        name,
        phone,
        token,
        base_url,
        remote_id,
        webhook_url,
        events,
        auto_read,
        pv_enabled,
        purpose,
        session_status,
        expires_at,
        plan_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'session', 'desconectado', ?, ?)
    `,
    [
      userId,
      profileId,
      server.id,
      instanceName,
      phone,
      token,
      server.baseUrl,
      remoteId,
      DEFAULT_WEBHOOK_URL,
      DEFAULT_EVENTS,
      0,
      0,
      profile.expiresAt ? new Date(profile.expiresAt) : null,
      profile.planId,
    ],
  );

  const created = await getInstanceForUser(userId, Number(result.insertId));
  if (!created) {
    throw new BotInstanceError("Não foi possível carregar a sessão recém-criada.", 500);
  }
  return {
    ...created,
    profileId,
    hasActiveSession: true,
    purpose: "profile",
    name: profile.name,
  };
};

const resolveSessionInstanceForUser = async (
  userId: number,
  instanceOrProfileId: number,
): Promise<InstanceRowWithServer> => {
  await migrateLegacyProfileInstances();
  const directRows = await fetchInstanceRowsForUser(userId, instanceOrProfileId);
  if (directRows.length) {
    return directRows[0];
  }

  const profile = await getUserProfileById(userId, instanceOrProfileId);
  if (!profile) {
    throw new BotInstanceError("Instância não encontrada.", 404);
  }

  const existing = await getActiveSessionRowForProfile(userId, profile.id);
  if (existing) {
    return existing;
  }

  const created = await createSessionForProfile(userId, profile.id, {
    phone: profile.phone ?? "",
    name: profile.name,
  });
  const rows = await fetchInstanceRowsForUser(userId, created.id);
  if (!rows.length) {
    throw new BotInstanceError("Não foi possível preparar a sessão do perfil.", 500);
  }
  return rows[0];
};

const registerRemoteInstance = async (
  server: BotServerRow,
  options: { name: string; token: string; webhook: string; events: string },
): Promise<{ id: string | number | null }> => {
  const payload = await callServerAdmin<{ data?: { id?: string | number } }>(server, "/admin/users", {
    method: "POST",
    body: JSON.stringify({
      name: options.name,
      token: options.token,
      webhook: options.webhook,
      events: options.events,
    }),
    expectedStatus: 201,
  });

  return {
    id: payload?.data?.id ?? null,
  };
};

const connectRemoteInstance = async (
  server: BotServerRow,
  token: string,
  events: string,
  instanceId?: number,
): Promise<void> => {
  if (instanceId && instanceId > 0) {
    await applyConfiguredProxyToRemote({
      instanceId,
      serverBaseUrl: server.base_url,
      token,
    });
  }
  await callInstanceSession(server, token, "/session/connect", {
    method: "POST",
    body: JSON.stringify({
      Subscribe: events.split(","),
      Immediate: true,
    }),
    expectedStatus: 200,
  }).catch(() => {
    /* ignore initial failure, user will retry */
  });
};

export const createInstanceForUser = async (
  userId: number,
  payload: BotInstancePayload,
  options: {
    allowLimitOverflow?: boolean;
    bypassPlan?: boolean;
    purpose?: BotInstancePurpose;
  } = {},
): Promise<BotInstance> => {
  await ensureBotInstanceTable();
  const purpose = normalizeInstancePurpose(options.purpose);
  const bypassPlan = options.bypassPlan === true || purpose === "admin_system";

  const existingCount = await countUserInstances(userId);
  const profileSlot = !bypassPlan
    ? await getAvailableProfileSlotForUser(userId)
    : null;
  const hasProfileSlot = Boolean(profileSlot);
  const pendingPaymentState = !bypassPlan && !hasProfileSlot;
  const shouldConnectRemote =
    bypassPlan || hasProfileSlot || existingCount === 0;

  const phone = normalizePhone(payload.phone);

  if (!Number.isFinite(payload.serverId) || payload.serverId <= 0) {
    throw new BotInstanceError("Servidor inválido.", 404);
  }

  const server = await getBotServerById(payload.serverId);
  if (!server) {
    throw new BotServerError("Servidor não encontrado.", 404);
  }

  if (!server.isActive) {
    throw new BotInstanceError("O servidor selecionado está inativo.", 409);
  }

  await ensureServerCapacity({
    id: server.id,
    name: server.name,
    base_url: server.baseUrl,
    api_type: server.apiType,
    global_api_key: server.globalApiKey,
    session_limit: server.sessionLimit,
    is_active: server.isActive ? 1 : 0,
    created_at: new Date(),
    updated_at: new Date(),
  });

  const instanceName = normalizeName(payload.name, phone);
  const token = generateToken();

  const db = getDb();

  const expiresAt = bypassPlan
    ? null
    : profileSlot?.expiresAt
      ? new Date(profileSlot.expiresAt)
      : new Date();
  const licensePlanId = profileSlot?.planId ?? null;

  if (!bypassPlan) {
    const reusableInstance = await getReusablePendingProfileInstance(userId, phone);
    if (reusableInstance) {
      if (profileSlot) {
        return (await applyProfileSlotLicenseToInstance(userId, reusableInstance.id, profileSlot)) ?? reusableInstance;
      }
      return reusableInstance;
    }
  }

  let linkedProfileId: number | null = null;
  let sessionPurpose: BotInstancePurpose = purpose;
  if (!bypassPlan) {
    await migrateLegacyProfileInstances();
	    const profile = await createUserProfile(userId, {
	      name: instanceName,
	      phone,
	      planId: licensePlanId,
	      expiresAt,
	    });
    linkedProfileId = profile.id;
    sessionPurpose = "session";
  }

  let remoteId: string | number | null = null;

  try {
    const remote = await registerRemoteInstance(
      {
        id: server.id,
        name: server.name,
        base_url: server.baseUrl,
        api_type: server.apiType,
        global_api_key: server.globalApiKey,
        session_limit: server.sessionLimit,
        is_active: server.isActive ? 1 : 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
      { name: instanceName, token, webhook: DEFAULT_WEBHOOK_URL, events: DEFAULT_EVENTS },
    );

    remoteId = remote.id ?? null;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível registrar a instância no servidor remoto.";
    const status =
      typeof (error as { status?: unknown })?.status === "number"
        ? Number((error as { status: number }).status)
        : 502;
    throw new BotInstanceError(message, status);
  }

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_instances (
        user_id,
        profile_id,
        server_id,
        name,
        phone,
        token,
        base_url,
        remote_id,
        webhook_url,
        events,
        auto_read,
        pv_enabled,
        purpose,
        session_status,
        expires_at,
        plan_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      linkedProfileId,
      server.id,
      instanceName,
      phone,
      token,
      server.baseUrl,
      remoteId,
      DEFAULT_WEBHOOK_URL,
      DEFAULT_EVENTS,
      0,
      0,
	      sessionPurpose,
	      shouldConnectRemote ? "inicializando" : "desconectado",
	      expiresAt,
	      licensePlanId,
	    ],
	  );

  if (shouldConnectRemote) {
    await connectRemoteInstance(
      {
        id: server.id,
        name: server.name,
        base_url: server.baseUrl,
        api_type: server.apiType,
        global_api_key: server.globalApiKey,
        session_limit: server.sessionLimit,
        is_active: server.isActive ? 1 : 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
      token,
      DEFAULT_EVENTS,
      result.insertId,
    );
  }

  const instance = await getInstanceForUser(userId, result.insertId);
  if (!instance) {
    throw new BotInstanceError("Não foi possível carregar a instância recém-criada.", 500);
  }

  if (linkedProfileId) {
    if (profileSlot) {
      await assignProfileSlotToProfile(
        userId,
        profileSlot,
        linkedProfileId,
        instance.id,
      );
    }
    return {
      ...instance,
      profileId: linkedProfileId,
      hasActiveSession: true,
      purpose: "profile",
      name: instanceName,
    };
  }

  return instance;
};

export const getAdminSystemInstanceForUser = async (
  adminUserId: number,
): Promise<BotInstance | null> => {
  const rows = await fetchInstanceRows({
    userId: adminUserId,
    purpose: "admin_system",
    order: "desc",
  });
  return rows[0] ? mapInstanceRow(rows[0]) : null;
};

const assertAdminSystemInstanceOwnership = async (
  adminUserId: number,
  instanceId?: number,
): Promise<InstanceRowWithServer> => {
  const rows = await fetchInstanceRows({
    userId: adminUserId,
    instanceId: typeof instanceId === "number" ? instanceId : undefined,
    purpose: "admin_system",
    order: "desc",
  });
  if (!rows.length) {
    throw new BotInstanceError("Instância operacional do admin não encontrada.", 404);
  }
  return rows[0];
};

export const createAdminSystemInstanceForUser = async (
  adminUserId: number,
  payload: BotInstancePayload,
): Promise<BotInstance> => {
  const existing = await getAdminSystemInstanceForUser(adminUserId);
  if (existing) {
    return updateAdminSystemInstanceForUser(adminUserId, existing.id, {
      name: payload.name,
      phone: payload.phone,
    });
  }
  return createInstanceForUser(adminUserId, {
    ...payload,
    name: payload.name || "BotAdmin Verificações",
  }, {
    bypassPlan: true,
    purpose: "admin_system",
  });
};

export const updateAdminSystemInstanceForUser = async (
  adminUserId: number,
  instanceId: number,
  payload: BotInstanceUpdatePayload,
): Promise<BotInstance> => {
  const instance = await assertAdminSystemInstanceOwnership(adminUserId, instanceId);
  let nextName = instance.name;
  let nextPhone = instance.phone;
  if (typeof payload.name === "string") {
    nextName = normalizeName(payload.name, instance.name);
  }
  if (typeof payload.phone === "string") {
    nextPhone = normalizePhone(payload.phone);
  }
  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND purpose = 'admin_system'
    `,
    [nextName, nextPhone, instance.id, adminUserId],
  );
  if (payload.resetSession === true) {
    const refreshedRow = await assertAdminSystemInstanceOwnership(adminUserId, instance.id);
    await resetInstanceRemoteSessionForPairing(refreshedRow);
  }
  const updated = await getAdminSystemInstanceForUser(adminUserId);
  if (!updated) {
    throw new BotInstanceError("Não foi possível carregar a instância operacional.", 500);
  }
  return updated;
};

export const renameInstance = async (
  userId: number,
  instanceId: number,
  payload: BotInstanceRenamePayload,
): Promise<BotInstance> => {
  const instance = await assertInstanceOwnership(userId, instanceId);
  const newName = normalizeName(payload.name, instance.name);

  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [newName, instanceId],
  );

  const updated = await getInstanceForUser(userId, instanceId);
  if (!updated) {
    throw new BotInstanceError("Não foi possível carregar a instância após a alteração.", 500);
  }
  return updated;
};

export const updateInstanceForUser = async (
  userId: number,
  instanceId: number,
  payload: BotInstanceUpdatePayload,
): Promise<BotInstance> => {
  await ensureBotInstanceTable();
  const instance = await assertInstanceOwnership(userId, instanceId);

  let nextName = instance.name;
  let nextPhone = instance.phone;
  let nextLicenseSalesEnabled = instance.license_sales_enabled === 1;

  if (typeof payload.name === "string") {
    nextName = normalizeName(payload.name, instance.name);
  }

  if (typeof payload.phone === "string") {
    const normalizedPhone = normalizePhone(payload.phone);
    if (normalizedPhone !== instance.phone) {
      nextPhone = normalizedPhone;
    }
  }

  if (typeof payload.licenseSalesEnabled === "boolean") {
    if (payload.licenseSalesEnabled && !nextLicenseSalesEnabled) {
      const readiness = await evaluateBotResalePaymentReadiness(userId);
      if (!readiness.ready) {
        throw new BotInstanceError(
          readiness.message ?? "Configure os pagamentos antes de ativar a renovação pelo grupo.",
          400,
        );
      }
    }
    nextLicenseSalesEnabled = payload.licenseSalesEnabled;
  }

  if (
    nextName === instance.name &&
    nextPhone === instance.phone &&
    nextLicenseSalesEnabled === (instance.license_sales_enabled === 1)
  ) {
    const current = await getInstanceForUser(userId, instanceId);
    if (!current) {
      throw new BotInstanceError("Instância não encontrada.", 404);
    }
    return current;
  }

  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET name = ?, phone = ?, license_sales_enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [nextName, nextPhone, nextLicenseSalesEnabled ? 1 : 0, instanceId],
  );

  const updated = await getInstanceForUser(userId, instanceId);
  if (!updated) {
    throw new BotInstanceError("Não foi possível carregar a instância após a alteração.", 500);
  }
  return updated;
};

export const deleteInstanceForUser = async (
  userId: number,
  instanceId: number,
  options: DeleteInstanceOptions = {},
): Promise<DeleteInstanceResult> => {
  const instance = await assertInstanceOwnership(userId, instanceId);
  const db = getDb();
  const strategy: DeleteInstanceGroupStrategy =
    options.groupStrategy === "keep_active" ? "keep_active" : "delete_all";
  let deletedGroups = 0;
  let keptGroups = 0;

  await ensureBotGroupTable();
  const [groupRows] = await db.query<RowDataPacket[]>(
    `
      SELECT id, status, metadata
      FROM bot_groups
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );

  const linkedGroups = Array.isArray(groupRows) ? groupRows : [];
  if (strategy === "keep_active" && linkedGroups.length > 0) {
    const keepIds: number[] = [];
    const deleteIds: number[] = [];

    linkedGroups.forEach((row) => {
      const groupId = Number(row.id ?? 0);
      if (!Number.isFinite(groupId) || groupId <= 0) return;

      const status = String(row.status ?? "").trim().toLowerCase();
      const keepBecauseActivated = status === "active" || hasGroupActivationHistory(row.metadata);
      if (keepBecauseActivated) {
        keepIds.push(groupId);
      } else {
        deleteIds.push(groupId);
      }
    });

    if (keepIds.length > 0) {
      await db.query(
        `
          UPDATE bot_groups
          SET
            instance_id = NULL,
            status = 'disabled',
            updated_at = NOW()
          WHERE id IN (${keepIds.map(() => "?").join(",")})
        `,
        keepIds,
      );
      keptGroups = keepIds.length;
    }

    if (deleteIds.length > 0) {
      await db.query(
        `DELETE FROM bot_groups WHERE id IN (${deleteIds.map(() => "?").join(",")})`,
        deleteIds,
      );
      deletedGroups = deleteIds.length;
    }
  } else {
    if (linkedGroups.length > 0) {
      await db.query(
        `
          DELETE FROM bot_groups
          WHERE user_id = ? AND instance_id = ?
        `,
        [userId, instanceId],
      );
    }
    deletedGroups = linkedGroups.length;
  }

  let conversationsDeleted = 0;
  let messagesDeleted = 0;
  let realtimeEventsDeleted = 0;
  let mediaObjectsDeleted = 0;
  let r2ObjectsDeleted = 0;
  let flowsDeleted = 0;

  try {
    const cleanup = await deleteWhatsappConversationsForInstance(userId, instanceId);
    conversationsDeleted = cleanup.threadsDeleted;
    messagesDeleted = cleanup.messagesDeleted;
    realtimeEventsDeleted = cleanup.eventsDeleted;
  } catch (error) {
    console.warn("[bot-instances] failed to clean WhatsApp history before deleting instance", {
      userId,
      instanceId,
      error,
    });
  }

  try {
    const mediaCleanup = await deleteUserMediaStorageObjectsForInstance(userId, instanceId);
    mediaObjectsDeleted = mediaCleanup.metadataDeleted;
    r2ObjectsDeleted = mediaCleanup.r2Deleted;
  } catch (error) {
    console.warn("[bot-instances] failed to clean media storage before deleting instance", {
      userId,
      instanceId,
      error,
    });
  }

  try {
    const [flowsResult] = await db.query<ResultSetHeader>(
      `
        DELETE FROM bot_flows
        WHERE user_id = ? AND instance_id = ?
      `,
      [userId, instanceId],
    );
    flowsDeleted = Number(flowsResult.affectedRows ?? 0);
  } catch (error) {
    console.warn("[bot-instances] failed to clean profile flows before deleting instance", {
      userId,
      instanceId,
      error,
    });
  }

  const profileIdToDelete =
    typeof instance.profile_id === "number" && instance.profile_id > 0
      ? instance.profile_id
      : null;

  await db.query(
    "DELETE FROM bot_instances WHERE id = ? AND user_id = ?",
    [instanceId, userId],
  );

  if (profileIdToDelete) {
    await deleteUserProfile(userId, profileIdToDelete);
  }

  try {
    await callInstanceSession(
      {
        id: instance.server_id,
        name: instance.server_name,
        base_url: instance.server_base_url,
        api_type: instance.server_api_type,
        global_api_key: instance.server_global_api_key,
        session_limit: instance.server_session_limit,
        is_active: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
      instance.token,
      "/session/logout",
      { method: "POST" },
    );
  } catch {
    /* ignore */
  }

  if (instance.remote_id) {
    try {
      await callServerAdmin(
        {
          id: instance.server_id,
          name: instance.server_name,
          base_url: instance.server_base_url,
          api_type: instance.server_api_type,
          global_api_key: instance.server_global_api_key,
          session_limit: instance.server_session_limit,
          is_active: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
        `/admin/users/${instance.remote_id}`,
        { method: "DELETE" },
      );
    } catch {
      /* ignore */
    }
  }

  return {
    strategy,
    deletedGroups,
    keptGroups,
    conversationsDeleted,
    messagesDeleted,
    realtimeEventsDeleted,
    mediaObjectsDeleted,
    r2ObjectsDeleted,
    flowsDeleted,
  };
};

export type PurgeInstanceSessionResult = {
  detachedGroups: number;
  conversationsDeleted: number;
  messagesDeleted: number;
  realtimeEventsDeleted: number;
  mediaObjectsDeleted: number;
  r2ObjectsDeleted: number;
  flowsDeleted: number;
  preservedProfile: true;
};

const logoutRemoteInstanceSession = async (instance: InstanceRowWithServer) => {
  try {
    await callInstanceSession(
      {
        id: instance.server_id,
        name: instance.server_name,
        base_url: instance.server_base_url,
        api_type: instance.server_api_type,
        global_api_key: instance.server_global_api_key,
        session_limit: instance.server_session_limit,
        is_active: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
      instance.token,
      "/session/logout",
      { method: "POST" },
    );
  } catch {
    /* ignore */
  }

  if (instance.remote_id) {
    try {
      await callServerAdmin(
        {
          id: instance.server_id,
          name: instance.server_name,
          base_url: instance.server_base_url,
          api_type: instance.server_api_type,
          global_api_key: instance.server_global_api_key,
          session_limit: instance.server_session_limit,
          is_active: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
        `/admin/users/${instance.remote_id}`,
        { method: "DELETE" },
      );
    } catch {
      /* ignore */
    }
  }
};

export const deleteDisconnectedInstanceForUser = async (
  userId: number,
  instanceId: number,
): Promise<PurgeInstanceSessionResult> => {
  const instance = await assertInstanceOwnership(userId, instanceId);
  if (normalizeInstancePurpose(instance.purpose) === "admin_system") {
    throw new BotInstanceError("Instâncias do sistema não podem ser removidas por esta ação.", 400);
  }

  const db = getDb();
  await ensureBotGroupTable();
  const preservedProfileId =
    typeof instance.profile_id === "number" && instance.profile_id > 0
      ? instance.profile_id
      : null;

  const [groupRows] = await db.query<RowDataPacket[]>(
    `
      SELECT id
      FROM bot_groups
      WHERE user_id = ? AND instance_id = ?
    `,
    [userId, instanceId],
  );
  const linkedGroups = Array.isArray(groupRows) ? groupRows : [];
  let detachedGroups = 0;

  if (linkedGroups.length > 0) {
    await db.query(
      `
        UPDATE bot_groups
        SET instance_id = NULL, updated_at = NOW()
        WHERE user_id = ? AND instance_id = ?
      `,
      [userId, instanceId],
    );
    detachedGroups = linkedGroups.length;
  }

  let conversationsDeleted = 0;
  let messagesDeleted = 0;
  let realtimeEventsDeleted = 0;
  let mediaObjectsDeleted = 0;
  let r2ObjectsDeleted = 0;
  let flowsDeleted = 0;

  try {
    const cleanup = await deleteWhatsappConversationsForInstance(userId, instanceId);
    conversationsDeleted = cleanup.threadsDeleted;
    messagesDeleted = cleanup.messagesDeleted;
    realtimeEventsDeleted = cleanup.eventsDeleted;
  } catch (error) {
    console.warn("[bot-instances] failed to clean WhatsApp history before deleting session", {
      userId,
      instanceId,
      error,
    });
  }

  try {
    const mediaCleanup = await deleteUserMediaStorageObjectsForInstance(userId, instanceId);
    mediaObjectsDeleted = mediaCleanup.metadataDeleted;
    r2ObjectsDeleted = mediaCleanup.r2Deleted;
  } catch (error) {
    console.warn("[bot-instances] failed to clean media storage before deleting session", {
      userId,
      instanceId,
      error,
    });
  }

  try {
    const [flowsResult] = await db.query<ResultSetHeader>(
      `
        DELETE FROM bot_flows
        WHERE user_id = ? AND instance_id = ?
      `,
      [userId, instanceId],
    );
    flowsDeleted = Number(flowsResult.affectedRows ?? 0);
  } catch (error) {
    console.warn("[bot-instances] failed to clean flows before deleting session", {
      userId,
      instanceId,
      error,
    });
  }

  await logoutRemoteInstanceSession(instance);

  await db.query("DELETE FROM bot_instances WHERE id = ? AND user_id = ?", [instanceId, userId]);

  return {
    detachedGroups,
    conversationsDeleted,
    messagesDeleted,
    realtimeEventsDeleted,
    mediaObjectsDeleted,
    r2ObjectsDeleted,
    flowsDeleted,
    preservedProfile: preservedProfileId ? true : true,
  };
};

export const purgeInstanceSessionForUser = deleteDisconnectedInstanceForUser;

export const purgeDisconnectedProfileInstancesForAdmin = async () => {
  await migrateLegacyProfileInstances();
  const instances = await listInstancesForAdmin();
  const targets = instances.filter(
    (item) =>
      item.purpose !== "admin_system" && item.sessionStatus === "desconectado",
  );

  const results: Array<{
    instanceId: number;
    userId: number;
    name: string;
    ok: boolean;
    message?: string;
    cleanup?: PurgeInstanceSessionResult;
  }> = [];

  for (const instance of targets) {
    try {
      const cleanup = await deleteDisconnectedInstanceForUser(instance.userId, instance.id);
      results.push({
        instanceId: instance.id,
        userId: instance.userId,
        name: instance.name,
        ok: true,
        cleanup,
      });
    } catch (error) {
      results.push({
        instanceId: instance.id,
        userId: instance.userId,
        name: instance.name,
        ok: false,
        message: error instanceof Error ? error.message : "Falha ao limpar sessão.",
      });
    }
  }

  const succeeded = results.filter((entry) => entry.ok).length;
  const failed = results.length - succeeded;

  return { targets: targets.length, succeeded, failed, results };
};

export const transferInstanceToUser = async (
  instanceId: number,
  targetUserId: number,
): Promise<BotInstanceAdminSummary> => {
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    throw new BotInstanceError("Instância inválida.", 404);
  }

  const targetInstance = await getInstanceById(instanceId);
  if (!targetInstance) {
    throw new BotInstanceError("Instância não encontrada.", 404);
  }

  if (targetInstance.userId === targetUserId) {
    return targetInstance;
  }

  const { plan } = await assertUserHasActivePlan(targetUserId);
  const limits = await getUserPlanLimits(targetUserId);
  const currentCount = await countUserInstances(targetUserId);
  validatePlanInstanceLimit(limits, currentCount);

  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET user_id = ?, plan_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [targetUserId, plan.id, instanceId],
  );

  const updated = await getInstanceById(instanceId);
  if (!updated) {
    throw new BotInstanceError("Não foi possível carregar a instância após a transferência.", 500);
  }

  return updated;
};

export const getInstanceByToken = async (token: string): Promise<BotInstance | null> => {
  if (typeof token !== "string" || !token.trim()) {
    return null;
  }

  const rows = await fetchInstanceRows({
    token: token.trim(),
    order: "asc",
  });

  if (!rows.length) {
    return null;
  }

  return mapInstanceRow(rows[0]);
};

export const performInstanceAction = async (
  userId: number,
  instanceId: number,
  action: BotInstanceAction,
  options: { respectDesiredState?: boolean } = {},
): Promise<void> => {
  const instance = await assertInstanceOwnership(userId, instanceId);
  if (
    action === "connect" &&
    options.respectDesiredState === true &&
    instance.desired_session_state === "disconnected"
  ) {
    return;
  }
  const server = buildServerFromInstance(instance);
  const events = normalizeInstanceEvents(instance);

  const db = getDb();
  const desiredState = action === "logout" ? "disconnected" : "connected";
  await db.query(
    `
      UPDATE bot_instances
      SET desired_session_state = ?,
          session_status = CASE WHEN ? = 'disconnected' THEN 'desconectado' ELSE session_status END,
          last_status_sync = CASE WHEN ? = 'disconnected' THEN NOW() ELSE last_status_sync END
      WHERE id = ? AND user_id = ?
    `,
    [desiredState, desiredState, desiredState, instanceId, userId],
  );
  invalidateInstanceByTokenCache(instance.token);

  if (action === "connect") {
    await ensureInstanceWebhookAll(instance);
  }

  const pathMap: Record<BotInstanceAction, string> = {
    connect: "/session/connect",
    logout: "/session/logout",
    restart: "/session/disconnect",
  };

  const payload =
    action === "connect"
      ? {
          Subscribe: events.split(","),
          Immediate: true,
        }
      : {};

  const method = "POST";
  const path = pathMap[action];

  if (!path) {
    throw new BotInstanceError("Ação inválida.", 400);
  }

  const performConnect = () =>
    applyConfiguredProxyToRemote({
      instanceId: instance.id,
      serverBaseUrl: server.base_url,
      token: instance.token,
    }).then(() =>
      callInstanceSession(server, instance.token, "/session/connect", {
        method,
        body: JSON.stringify({
          Subscribe: events.split(","),
          Immediate: true,
        }),
      }),
    );

  if (action === "restart") {
    const performRestart = async () => {
      await callInstanceSession(server, instance.token, "/session/disconnect", {
        method,
        body: JSON.stringify({}),
      }).catch(() => {});

      await performConnect();
    };

    try {
      await performRestart();
    } catch (error) {
      if (!shouldRecreateRemoteInstance(error)) {
        throw error;
      }
      await recreateRemoteInstance(instance);
      await performRestart();
    }
    return;
  }

  const performAction = () =>
    callInstanceSession(server, instance.token, path, {
      method,
      body: JSON.stringify(payload),
    });

  try {
    await performAction();
  } catch (error) {
    if (action === "logout" && isAlreadyDisconnectedActionError(error)) {
      // A session with retained credentials may report loggedIn=true even
      // though there is no live socket to accept /session/logout. Recycling
      // the remote registration clears those credentials deterministically.
      await logoutRemoteInstanceSession(instance);
      await recreateRemoteInstance(instance);
      await persistInstanceStatus(instance.id, "desconectado");
      invalidateInstanceByTokenCache(instance.token);
      return;
    }
    if (!shouldRecreateRemoteInstance(error)) {
      throw error;
    }
    if (action === "logout") {
      await persistInstanceStatus(instance.id, "desconectado");
      invalidateInstanceByTokenCache(instance.token);
      return;
    }
    await recreateRemoteInstance(instance);
    await performAction();
  }

  if (action === "logout") {
    await persistInstanceStatus(instance.id, "desconectado");
    invalidateInstanceByTokenCache(instance.token);
  }
};

type SessionStatusEnvelope = {
  data?: {
    loggedIn?: boolean;
    LoggedIn?: boolean;
    jid?: string;
    Jid?: string;
    JID?: string;
    qrcode?: unknown;
    QRCode?: unknown;
    qr?: unknown;
    connected?: boolean;
    Connected?: boolean;
    starting?: boolean;
    initializing?: boolean;
  };
};

const fetchSessionStatusSnapshot = async (
  instance: InstanceRowWithServer,
): Promise<{ status: BotInstanceStatus; jid: string | null }> => {
  const payload = await callInstanceSession<SessionStatusEnvelope>(
    buildServerFromInstance(instance),
    instance.token,
    "/session/status",
  );

  const normalized = normalizeStatusResponse(payload);
  const jid = firstString(
    normalized.node.jid,
    normalized.node.Jid,
    normalized.node.JID,
    normalized.node.id,
    normalized.node.ID,
  );
  return { status: normalized.status, jid };
};

const fetchSessionStatus = async (
  instance: InstanceRowWithServer,
): Promise<BotInstanceStatus> => (await fetchSessionStatusSnapshot(instance)).status;

export const refreshInstanceStatus = async (
  userId: number,
  instanceId: number,
  options: { purpose?: BotInstancePurpose } = {},
): Promise<BotInstanceStatus> => {
  const instance = normalizeInstancePurpose(options.purpose) === "admin_system"
    ? await assertAdminSystemInstanceOwnership(userId, instanceId)
    : await assertInstanceOwnership(userId, instanceId);
  let status: BotInstanceStatus = "desconectado";
  let statusJid: string | null = null;

  try {
    const snapshot = await fetchSessionStatusSnapshot(instance);
    status = snapshot.status;
    statusJid = snapshot.jid;
  } catch (error) {
    if (isDisconnectedSessionError(error)) {
      status = "desconectado";
    } else if (shouldRecreateRemoteInstance(error)) {
      try {
        console.warn("Remote instance missing, recreating", {
          instanceId: instance.id,
          serverId: instance.server_id,
        });
        await recreateRemoteInstance(instance);
        await connectRemoteInstance(
          buildServerFromInstance(instance),
          instance.token,
          normalizeInstanceEvents(instance),
          instance.id,
        );
        const snapshot = await fetchSessionStatusSnapshot(instance).catch((statusError) => {
          if (isDisconnectedSessionError(statusError)) {
            return { status: "desconectado" as BotInstanceStatus, jid: null };
          }
          return { status: "inicializando" as BotInstanceStatus, jid: null };
        });
        status = snapshot.status;
        statusJid = snapshot.jid;
      } catch (recreateError) {
        console.error("Failed to recreate remote instance", recreateError);
      }
    }
  }

  // A deliberate user logout is authoritative. This also closes the small
  // race where the health monitor had already loaded the old connected row.
  if (instance.desired_session_state === "disconnected") {
    status = "desconectado";
    statusJid = null;
  }

  const db = getDb();
  const connectedPhone = status === "conectado" ? normalizePhoneDigitsCandidate(statusJid) : null;
  if (connectedPhone && connectedPhone !== instance.phone) {
    await db.query(
      `
        UPDATE bot_instances
        SET session_status = ?, phone = ?, last_status_sync = NOW(), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [status, connectedPhone, instanceId],
    );
  } else {
    await db.query(
      `
        UPDATE bot_instances
        SET session_status = ?, last_status_sync = NOW()
        WHERE id = ?
      `,
      [status, instanceId],
    );
  }

  return status;
};

const persistInstanceStatus = async (instanceId: number, status: BotInstanceStatus) => {
  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET session_status = ?, last_status_sync = NOW()
      WHERE id = ?
    `,
    [status, instanceId],
  );
};

const resetInstanceRemoteSessionForPairing = async (instance: InstanceRowWithServer) => {
  const previousToken = instance.token;
  await logoutRemoteInstanceSession(instance);

  const nextToken = generateToken();
  const server = buildServerFromInstance(instance);
  const webhook = normalizeInstanceWebhook(instance);
  const events = normalizeInstanceEvents(instance);
  const remote = await registerRemoteInstance(server, {
    name: instance.name,
    token: nextToken,
    webhook,
    events,
  });

  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET token = ?, remote_id = ?, webhook_url = ?, events = ?,
          session_status = 'desconectado', last_status_sync = NOW(),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [nextToken, remote.id ?? null, webhook, events, instance.id],
  );

  instance.token = nextToken;
  instance.remote_id = remote.id == null ? null : String(remote.id);
  instance.webhook_url = webhook;
  instance.events = events;
  instance.session_status = "desconectado";
  invalidateInstanceByTokenCache(previousToken);
  invalidateInstanceByTokenCache(nextToken);
  await persistInstanceStatus(instance.id, "desconectado");
};

const fetchInstanceProfileSnapshot = async (
  instance: InstanceRowWithServer,
): Promise<{
  status: BotInstanceStatus;
  pushName: string | null;
  statusText: string | null;
  jid: string | null;
  avatarUrl: string | null;
}> => {
  let status: BotInstanceStatus = (instance.session_status as BotInstanceStatus) ?? "desconectado";
  let statusNode: Record<string, unknown> = {};

  try {
    const payload = await callInstanceSession<unknown>(
      buildServerFromInstance(instance),
      instance.token,
      "/session/status",
    );
    const normalized = normalizeStatusResponse(payload);
    status = normalized.status;
    statusNode = normalized.node;
    await persistInstanceStatus(instance.id, status);
  } catch (error) {
    if (shouldRecreateRemoteInstance(error)) {
      try {
        await recreateRemoteInstance(instance);
      } catch (recreateError) {
        console.error("Failed to recreate instance while loading profile snapshot", recreateError);
      }
    }
  }

  const profile = resolveProfileFromStatusNode(instance, statusNode);
  const connectedPhone = normalizePhoneDigitsCandidate(profile.jid);
  if (status === "conectado" && connectedPhone && connectedPhone !== instance.phone) {
    const db = getDb();
    await db.query(
      `
        UPDATE bot_instances
        SET phone = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [connectedPhone, instance.id],
    );
    instance.phone = connectedPhone;
  }

  const contactCandidates = Array.from(
    new Set(
      [
        profile.jid ? profile.jid.replace(/:\d+(?=@)/, "") : null,
        normalizePhoneJidCandidate(instance.phone),
        instance.phone,
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  );

  const avatarUrl =
    status === "desconectado"
      ? null
      : await fetchInstanceAvatarUrl(instance, contactCandidates);

  return {
    status,
    pushName: profile.pushName,
    statusText: profile.statusText,
    jid: profile.jid,
    avatarUrl,
  };
};

export const getInstanceProfileForUser = async (
  userId: number,
  instanceId: number,
): Promise<BotInstanceProfile> => {
  const instance = await assertInstanceOwnership(userId, instanceId);
  const snapshot = await fetchInstanceProfileSnapshot(instance);

  return {
    displayName: instance.name,
    pushName: snapshot.pushName,
    statusText: snapshot.statusText,
    jid: snapshot.jid,
    avatarUrl: snapshot.avatarUrl,
    sessionStatus: snapshot.status,
  };
};

export const updateInstanceProfileForUser = async (
  userId: number,
  instanceId: number,
  payload: BotInstanceProfileUpdatePayload,
): Promise<{ instance: BotInstance; profile: BotInstanceProfile }> => {
  const current = await assertInstanceOwnership(userId, instanceId);

  if (typeof payload.displayName === "string") {
    const nextName = normalizeName(payload.displayName, current.name);
    if (nextName !== current.name) {
      await renameInstance(userId, instanceId, { name: nextName });
    }
  }

  const hasPushName = typeof payload.pushName === "string";
  const hasStatusText = typeof payload.statusText === "string";
  const hasImage = typeof payload.imageDataUrl === "string" && payload.imageDataUrl.trim().length > 0;
  const removePhoto = payload.removePhoto === true;

  if (hasPushName || hasStatusText || hasImage || removePhoto) {
    const refreshed = await assertInstanceOwnership(userId, instanceId);
    const expiresAtTs = refreshed.expires_at ? new Date(refreshed.expires_at).getTime() : Number.NaN;
    if (Number.isFinite(expiresAtTs) && expiresAtTs <= Date.now()) {
      throw new BotInstanceError("Renove/libere esta conexão antes de editar foto e dados do WhatsApp.", 402);
    }

    let sessionStatus: BotInstanceStatus =
      (refreshed.session_status as BotInstanceStatus) ?? "desconectado";
    try {
      sessionStatus = await fetchSessionStatus(refreshed);
      await persistInstanceStatus(refreshed.id, sessionStatus);
    } catch {
      // fallback no status salvo localmente
    }
    if (sessionStatus !== "conectado") {
      throw new BotInstanceError(
        "Conecte o WhatsApp desta conexão antes de alterar foto e dados do perfil.",
        409,
      );
    }

    if (hasPushName) {
      const nextPushName = payload.pushName!.trim();
      if (!nextPushName) {
        throw new BotInstanceError("Informe o nome de perfil da instância.");
      }
      await tryCallProfileEndpoint(refreshed, ["/profile/name", "/api/profile/name"], {
        name: nextPushName,
      });
    }

    if (hasStatusText) {
      const nextStatus = payload.statusText ?? "";
      await tryCallProfileEndpoint(
        refreshed,
        ["/profile/status", "/api/profile/status", "/profile/about", "/api/profile/about"],
        [
          { status: nextStatus },
          { Status: nextStatus },
          { about: nextStatus },
          { About: nextStatus },
          { statusText: nextStatus },
          { StatusText: nextStatus },
          { text: nextStatus },
          { message: nextStatus },
        ],
      );
    }

    if (hasImage) {
      const imageDataUrl = payload.imageDataUrl!.trim();
      if (!imageDataUrl.startsWith("data:image/")) {
        throw new BotInstanceError("A imagem deve ser enviada em formato data URL (data:image/...).");
      }
      await tryCallProfileEndpoint(refreshed, ["/profile/photo", "/api/profile/photo"], {
        image: imageDataUrl,
      });
    }

    if (removePhoto) {
      await tryCallProfileEndpoint(refreshed, ["/profile/photo/remove", "/api/profile/photo/remove"], {});
    }
  }

  const updatedInstance = await getInstanceForUser(userId, instanceId);
  if (!updatedInstance) {
    throw new BotInstanceError("Instância não encontrada.", 404);
  }
  const profile = await getInstanceProfileForUser(userId, instanceId);

  return {
    instance: updatedInstance,
    profile,
  };
};

export type PairingRequestMode = "auto" | "code" | "qr";

export const requestPairingCode = async (
  userId: number,
  instanceId: number,
  mode: PairingRequestMode = "auto",
  options: { purpose?: BotInstancePurpose; forceReconnect?: boolean } = {},
): Promise<{ linkingCode?: string; qrCode?: string; alreadyConnected?: boolean }> => {
  const instance =
    normalizeInstancePurpose(options.purpose) === "admin_system"
      ? await assertAdminSystemInstanceOwnership(userId, instanceId)
      : await resolveSessionInstanceForUser(userId, instanceId);
  const bypassPlanChecks = normalizeInstancePurpose(instance.purpose) === "admin_system";

  let liveStatus: BotInstanceStatus = (instance.session_status as BotInstanceStatus) ?? "desconectado";
  const requiresCleanPairing =
    options.forceReconnect === true ||
    instance.desired_session_state === "disconnected";
  if (requiresCleanPairing) {
    await resetInstanceRemoteSessionForPairing(instance);
    liveStatus = "desconectado";
  } else {
    try {
      liveStatus = await fetchSessionStatus(instance);
      await persistInstanceStatus(instance.id, liveStatus);
    } catch {
      // segue com o status local
    }
  }

  if (liveStatus === "conectado") {
    return { alreadyConnected: true };
  }

  const now = Date.now();
  const profileLicenseActive =
    !bypassPlanChecks && isInstanceProfileLicenseActive(instance.expires_at, now);
  if (!bypassPlanChecks && !profileLicenseActive) {
    throw new BotInstanceError(
      "Renove este perfil antes de conectar o WhatsApp.",
      402,
    );
  }


  const db = getDb();
  await db.query(
    `
      UPDATE bot_instances
      SET desired_session_state = 'connected', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [instance.id, userId],
  );
  invalidateInstanceByTokenCache(instance.token);

  const server = buildServerFromInstance(instance);
  const events = normalizeInstanceEvents(instance);
  const apiType = (instance.server_api_type || "").toLowerCase();
  const wantsOnlyCode = mode === "code";
  const wantsOnlyQr = mode === "qr";
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const ensureReady = async () => {
    await ensureInstanceWebhookAll(instance);
    await connectRemoteInstance(server, instance.token, events, instance.id);
    await wait(250);
  };

  const extractPairingValue = (
    payload: unknown,
    keys: string[],
  ): string | undefined => {
    const root = toRecord(payload) ?? {};
    const data = toRecord(root.data) ?? toRecord(root.Data) ?? root;
    const nested = [
      toRecord(data.qrcode),
      toRecord(data.QRCode),
      toRecord(data.qr),
      toRecord(data.pairing),
      toRecord(data.result),
    ].filter((value): value is Record<string, unknown> => value !== null);
    const records = [data, root, ...nested];
    for (const record of records) {
      const value = firstString(...keys.map((key) => record[key]));
      if (value) return value;
    }
    return undefined;
  };

  const fetchQrFromStatus = async (): Promise<string | undefined> => {
    const status = await callInstanceSession<unknown>(
      server,
      instance.token,
      "/session/status",
    );
    return extractPairingValue(status, ["qrcode", "QRCode", "qr", "QrCode", "code"]);
  };

  const fetchQrFromSessionEndpoint = async (): Promise<string | undefined> => {
    const qr = await callInstanceSession<unknown>(
      server,
      instance.token,
      "/session/qr",
    );
    return extractPairingValue(qr, ["qrcode", "QRCode", "qr", "QrCode", "code"]);
  };

  if (apiType === "wuzapi") {
    await ensureReady();

    const attemptPairPhone = async (): Promise<string | undefined> => {
      const pair = await callInstanceSession<unknown>(server, instance.token, "/session/pairphone", {
        method: "POST",
        body: JSON.stringify({ Phone: instance.phone }),
      });
      return extractPairingValue(pair, ["LinkingCode", "linkingCode", "code", "pairingCode"]);
    };

    const attemptPairPhoneWithRecovery = async (): Promise<string | undefined> => {
      try {
        return await attemptPairPhone();
      } catch (error) {
        if (!shouldRecreateRemoteInstance(error)) {
          return undefined;
        }
        console.warn("Remote instance missing during status QR fetch, recreating", {
          instanceId: instance.id,
          serverId: instance.server_id,
        });
        await recreateRemoteInstance(instance);
        await ensureReady();
        try {
          return await attemptPairPhone();
        } catch {
          return undefined;
        }
      }
    };

    const fetchAnyQr = async (): Promise<string | undefined> => {
      const statusQr = await fetchQrFromStatus().catch(() => undefined);
      if (statusQr) {
        return statusQr;
      }
      return fetchQrFromSessionEndpoint().catch(() => undefined);
    };

    const attemptQrWithRecovery = async (): Promise<string | undefined> => {
      try {
        return await fetchAnyQr();
      } catch (error) {
        if (!shouldRecreateRemoteInstance(error)) {
          throw error;
        }
        console.warn("Remote instance missing during status QR fetch, recreating", {
          instanceId: instance.id,
          serverId: instance.server_id,
        });
        await recreateRemoteInstance(instance);
        await ensureReady();
        return fetchAnyQr();
      }
    };

    const waitForQr = async (): Promise<string | undefined> => {
      // WhatsApp emits the first QR asynchronously. Depending on network
      // latency it can take several seconds after /session/connect returns.
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const qrCode = await attemptQrWithRecovery().catch(() => undefined);
        if (qrCode) return qrCode;
        if (attempt < 23) {
          await wait(attempt < 5 ? 350 : 600);
        }
      }
      return undefined;
    };

    if (!wantsOnlyQr) {
      const linkingCode = await attemptPairPhoneWithRecovery();
      if (linkingCode) {
        return { linkingCode };
      }
      if (wantsOnlyCode) {
        await ensureReady();
        const retryCode = await attemptPairPhoneWithRecovery();
        if (retryCode) {
          return { linkingCode: retryCode };
        }
        throw new BotInstanceError("Não foi possível gerar o código de pareamento para esta conexão.", 502);
      }
    }

    let qrCode = await waitForQr();
    if (!qrCode) {
      await ensureReady();
      qrCode = await waitForQr();
    }
    if (!qrCode) {
      throw new BotInstanceError("Não foi possível gerar o QR Code para pareamento.", 502);
    }
    return { qrCode };
  }

  const attemptPairPhone = async () => {
    const pair = await callInstanceSession<{ data?: { LinkingCode?: string } }>(
      server,
      instance.token,
      "/session/pairphone",
      {
        method: "POST",
        body: JSON.stringify({ Phone: instance.phone }),
      },
    );
    return pair?.data?.LinkingCode;
  };

  const attemptQr = async () => {
    const qr = await callInstanceSession<{ data?: { QRCode?: string; qr?: string } }>(
      server,
      instance.token,
      "/session/qr",
    );
    return qr?.data?.QRCode || qr?.data?.qr;
  };

  await ensureReady();

  const attemptPairPhoneWithRecovery = async (): Promise<string | undefined> => {
    try {
      return await attemptPairPhone();
    } catch (error) {
      if (!shouldRecreateRemoteInstance(error)) {
        return undefined;
      }
      console.warn("Remote instance missing during pairing, recreating", {
        instanceId: instance.id,
        serverId: instance.server_id,
      });
      await recreateRemoteInstance(instance);
      await ensureReady();
      try {
        return await attemptPairPhone();
      } catch (retryError) {
        if (!shouldRecreateRemoteInstance(retryError)) {
          return undefined;
        }
      }
    }
    return undefined;
  };

  if (!wantsOnlyQr) {
    const linkingCode = await attemptPairPhoneWithRecovery();
    if (linkingCode) {
      return { linkingCode };
    }
    if (wantsOnlyCode) {
      await ensureReady();
      const retryCode = await attemptPairPhoneWithRecovery();
      if (retryCode) {
        return { linkingCode: retryCode };
      }
      throw new BotInstanceError("Não foi possível gerar o código de pareamento para esta conexão.", 502);
    }
  }

  let qrCode: string | undefined;
  try {
    qrCode = await attemptQr();
  } catch (error) {
    if (shouldRecreateRemoteInstance(error)) {
      console.warn("Remote instance missing when requesting QR, recreating", {
        instanceId: instance.id,
        serverId: instance.server_id,
      });
      await recreateRemoteInstance(instance);
      await ensureReady();
      try {
        qrCode = await attemptQr();
      } catch (retryError) {
        if (!shouldRecreateRemoteInstance(retryError)) {
          throw retryError;
        }
      }
    } else {
      throw error;
    }
  }

  if (!qrCode) {
    await ensureReady();
    qrCode = await attemptQr().catch(() => undefined);
  }

  if (!qrCode) {
    throw new BotInstanceError("Não foi possível gerar o QR Code para pareamento.", 502);
  }

  return { qrCode };
};

export const getInstanceOverview = async (): Promise<{
  total: number;
  connected: number;
  awaiting: number;
  users: number;
  topServers: Array<{ serverId: number; serverName: string; total: number }>;
}> => {
  await ensureBotInstanceTable();
  await ensureBotServerTable();
  const db = getDb();

  const [summaryRows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN session_status = 'conectado' THEN 1 ELSE 0 END) AS connected,
        SUM(CASE WHEN session_status IN ('aguardando_qr', 'aguardando_pareamento', 'inicializando') THEN 1 ELSE 0 END) AS awaiting,
        COUNT(DISTINCT user_id) AS users
      FROM bot_instances
    `,
  );

  const summary = Array.isArray(summaryRows) && summaryRows.length > 0 ? summaryRows[0] : null;
  const totals = {
    total: Number(summary?.total ?? 0),
    connected: Number(summary?.connected ?? 0),
    awaiting: Number(summary?.awaiting ?? 0),
    users: Number(summary?.users ?? 0),
  };

  const [serverRows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        bs.id AS serverId,
        bs.name AS serverName,
        COUNT(*) AS total
      FROM bot_instances bi
      INNER JOIN bot_servers bs ON bs.id = bi.server_id
      GROUP BY bs.id, bs.name
      ORDER BY total DESC
      LIMIT 5
    `,
  );

  const topServers = Array.isArray(serverRows)
    ? serverRows.map((row) => ({
        serverId: Number(row.serverId),
        serverName: String(row.serverName ?? "Servidor"),
        total: Number(row.total ?? 0),
      }))
    : [];

  return { ...totals, topServers };
};

export { BotInstanceError };
