import { ResultSetHeader, RowDataPacket } from "mysql2";

import type {
  PlanAddonSelection,
  PlanAddonType,
  PlanCheckoutAddonLine,
  PlanCheckoutBreakdown,
  SubscriptionPlan,
  SubscriptionPlanPayload,
  UserPlanAddon,
  UserPlanLimits,
  UserPlanStatus,
} from "types/plans";

import {
  SubscriptionPlanRow,
  UserPlanSubscriptionRow,
  ensureSubscriptionPlanTable,
  ensureUserPlanSubscriptionTable,
  ensureUserPlanAddonTable,
  ensureUserTable,
  ensureBotInstanceTable,
  getDb,
  UserPlanAddonRow,
} from "./db";
import { ensureBotUserProfileTable } from "./bot-user-profiles";

export class SubscriptionPlanError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SubscriptionPlanError";
    this.status = status;
  }
}

const sanitizeText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }

  return trimmed;
};

const sanitizeOptionalText = (value: unknown, maxLength: number): string | null => {
  const text = sanitizeText(value, maxLength);
  return text ? text : null;
};

const sanitizePositiveInteger = (value: unknown, label: string, minValue: number): number => {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    throw new SubscriptionPlanError(`Informe ${label}.`);
  }

  const rounded = Math.floor(Number(numeric));
  if (rounded < minValue) {
    throw new SubscriptionPlanError(`${label} deve ser no mínimo ${minValue}.`);
  }

  return rounded;
};

const sanitizePrice = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    throw new SubscriptionPlanError("Informe o preço do plano.");
  }

  if (numeric < 0) {
    throw new SubscriptionPlanError("O preço não pode ser negativo.");
  }

  return Number(numeric.toFixed(2));
};

const sanitizeNonNegativeInteger = (value: unknown, label: string): number => {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) {
    throw new SubscriptionPlanError(`${label} inválido.`);
  }
  return Math.floor(numeric);
};

const sanitizeStorageQuotaGb = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return 0;
  }

  if (numeric < 0) {
    throw new SubscriptionPlanError("A franquia de armazenamento não pode ser negativa.");
  }

  return Number(numeric.toFixed(2));
};

const sanitizePlanFeatures = (
  value: unknown,
): Record<string, boolean | number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, boolean | number> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 80);
    if (!key) continue;
    if (typeof rawValue === "boolean") {
      result[key] = rawValue;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      result[key] = Math.max(0, Math.floor(rawValue));
    }
  }
  return result;
};

const parsePlanFeatures = (value: unknown): Record<string, boolean | number> => {
  if (typeof value === "string") {
    try {
      return sanitizePlanFeatures(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return sanitizePlanFeatures(value);
};

export const DEFAULT_PLAN_FEATURES: Record<string, boolean> = {
  conversas: true,
  grupos_botadmin: true,
  status: true,
  status_programado: true,
  transmissao: true,
  bot_interage: true,
  antilink: true,
  boas_vindas: true,
  download_media: true,
  midia_persistente: true,
  multi_perfil: true,
  api: false,
  suporte_prioritario: false,
  revenda: false,
};

const roundToTwoDecimals = (value: number): number =>
  Math.round(Number(value ?? 0) * 100) / 100;

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const parseDateInput = (
  value: Date | string | null | undefined,
  label: string,
): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (DATE_ONLY_REGEX.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map((entry) => Number.parseInt(entry, 10));
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day) &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= 31
      ) {
        return new Date(year, month - 1, day, 23, 59, 59, 999);
      }
    }
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SubscriptionPlanError(`${label} inválida.`);
  }

  return parsed;
};

const normalizeSubscriptionStatus = (
  value: unknown,
  fallback: UserPlanSubscriptionRow["status"],
): UserPlanSubscriptionRow["status"] => {
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as UserPlanSubscriptionRow["status"];
    if (
      normalized === "pending" ||
      normalized === "active" ||
      normalized === "expired" ||
      normalized === "cancelled"
    ) {
      return normalized;
    }
  }
  return fallback;
};

const parseAddonMetadata = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return null;
};

const extractPaymentReferencesFromMetadata = (metadata: Record<string, unknown> | null): string[] => {
  if (!metadata) {
    return [];
  }

  const references = new Set<string>();
  const direct = metadata["paymentReference"];
  if (typeof direct === "string" && direct.trim().length > 0) {
    references.add(direct.trim());
  }

  const list = metadata["paymentReferences"];
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (typeof entry !== "string") {
        continue;
      }
      const normalized = entry.trim();
      if (normalized.length > 0) {
        references.add(normalized);
      }
    }
  }

  return Array.from(references);
};

const getAutoRenewFromMetadata = (metadata: Record<string, unknown> | null): boolean => {
  if (!metadata) {
    return false;
  }
  const value = metadata["autoRenew"];
  return typeof value === "boolean" ? value : false;
};

const parseSubscriptionMetadata = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
};

const toDateOrNull = (value: Date | string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const syncPlanInstancesForUser = async (params: {
  userId: number;
  newPlanId: number | null;
  periodEnd: Date | null;
  matchPlanIds: number[];
}): Promise<void> => {
  const { userId, newPlanId, periodEnd, matchPlanIds } = params;
  if (!Number.isFinite(userId) || userId <= 0) {
    return;
  }
  if (!Array.isArray(matchPlanIds) || matchPlanIds.length === 0) {
    return;
  }
  const normalizedIds = Array.from(new Set(matchPlanIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (normalizedIds.length === 0) {
    return;
  }

  await ensureBotInstanceTable();
  const db = getDb();
  const placeholders = normalizedIds.map(() => "?").join(", ");

  if (newPlanId === null) {
    await db.query(
      `
        UPDATE bot_instances
        SET
          plan_id = NULL,
          expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND plan_id IN (${placeholders})
      `,
      [userId, ...normalizedIds],
    );
    return;
  }

  await db.query(
    `
      UPDATE bot_instances
      SET
        plan_id = ?,
        expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND plan_id IN (${placeholders})
    `,
    [newPlanId, periodEnd, userId, ...normalizedIds],
  );
};

const diffInWholeHours = (start: Date | null, end: Date | null): number | null => {
  if (!start || !end) {
    return null;
  }
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return null;
  }
  return Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
};

export const DEFAULT_PLAN_ADDON_INSTANCE_PRICE = 25;

export const resolvePlanAddonUnitPrice = (
  plan: Pick<SubscriptionPlan, "price" | "addonInstancePrice" | "addonGroupPrice">,
  type: PlanAddonType,
): number => {
  if (type === "group") {
    const configured = Number(plan.addonGroupPrice);
    return roundToTwoDecimals(
      Number.isFinite(configured) && configured > 0
        ? configured
        : plan.price,
    );
  }

  const configured = Number(plan.addonInstancePrice);
  return roundToTwoDecimals(
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_PLAN_ADDON_INSTANCE_PRICE,
  );
};

export const normalizePlanAddonSelections = (
  addons?: PlanAddonSelection[] | null,
): PlanAddonSelection[] => {
  if (!Array.isArray(addons)) {
    return [];
  }

  const accumulated: Record<PlanAddonType, number> = {
    instance: 0,
    group: 0,
  };

  addons.forEach((item) => {
    if (!item) {
      return;
    }

    const typeRaw = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
    if (typeRaw !== "instance" && typeRaw !== "group") {
      return;
    }
    const normalizedType: PlanAddonType = typeRaw as PlanAddonType;

    const parsed = Number.parseInt(String(item.quantity ?? ""), 10);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const quantity = Math.max(0, Math.floor(parsed));
    if (quantity <= 0) {
      return;
    }

    accumulated[normalizedType] += quantity;
  });

  return (["instance", "group"] as const)
    .map((type) => ({
      type,
      quantity: accumulated[type],
    } satisfies PlanAddonSelection))
    .filter((item) => item.quantity > 0);
};

export const computePlanCheckoutBreakdown = (
  plan: SubscriptionPlan,
  addons?: PlanAddonSelection[] | null,
): PlanCheckoutBreakdown => {
  const normalizedAddons = normalizePlanAddonSelections(addons);

  const addonLines: PlanCheckoutAddonLine[] = normalizedAddons.map((addon) => {
    const unitPrice = resolvePlanAddonUnitPrice(plan, addon.type);
    const totalPrice = roundToTwoDecimals(unitPrice * addon.quantity);

    return {
      type: addon.type,
      quantity: addon.quantity,
      unitPrice,
      totalPrice,
    };
  });

  const addonsTotal = roundToTwoDecimals(
    addonLines.reduce((sum, line) => sum + line.totalPrice, 0),
  );

  const baseAmount = roundToTwoDecimals(plan.price);
  const totalAmount = roundToTwoDecimals(baseAmount + addonsTotal);

  return {
    baseAmount,
    addonsTotal,
    totalAmount,
    addons: addonLines,
  };
};

const normalizePayload = (payload: SubscriptionPlanPayload): SubscriptionPlanPayload => {
  const name = sanitizeText(payload.name, 120);
  if (!name) {
    throw new SubscriptionPlanError("Informe o nome do plano.");
  }

  const description = sanitizeOptionalText(payload.description, 500);
  const price = sanitizePrice(payload.price);
  const addonInstancePrice = sanitizePrice(payload.addonInstancePrice ?? 0);
  const addonGroupPrice = sanitizePrice(payload.addonGroupPrice ?? 0);
  const groupLimit = sanitizeNonNegativeInteger(payload.groupLimit ?? 0, "o limite de grupos");
  const instanceLimit = sanitizeNonNegativeInteger(payload.instanceLimit ?? 0, "o limite de perfis");
  const allowFlows = payload.allowFlows === undefined ? true : Boolean(payload.allowFlows);
  const storageQuotaGb = sanitizeStorageQuotaGb(payload.storageQuotaGb ?? 0);
  const durationDays = sanitizePositiveInteger(payload.durationDays, "a duração em dias", 1);
  const isActive = Boolean(payload.isActive);
  const features = sanitizePlanFeatures(payload.features);

  return {
    name,
    description,
    price,
    addonInstancePrice,
    addonGroupPrice,
    groupLimit,
    instanceLimit,
    allowFlows,
    storageQuotaGb,
    durationDays,
    isActive,
    features,
  };
};

const mapPlanRow = (row: SubscriptionPlanRow): SubscriptionPlan => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  price: roundToTwoDecimals(Number.parseFloat(row.price)),
  addonInstancePrice: 0,
  addonGroupPrice: 0,
  groupLimit: 0,
  instanceLimit: 0,
  allowFlows: true,
  storageQuotaGb: 0,
  durationDays: row.duration_days,
  isActive: row.is_active === 1,
  features: { ...DEFAULT_PLAN_FEATURES, ...parsePlanFeatures(row.features_json) },
  createdAt: row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString(),
});

type UserPlanPricingOverride = {
  planPrice: number | null;
  addonInstancePrice: number | null;
  addonGroupPrice: number | null;
};

const parseOverrideValue = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    return null;
  }

  return roundToTwoDecimals(parsed);
};

const hasPricingOverride = (override: UserPlanPricingOverride | null): boolean =>
  Boolean(
    override &&
      (override.planPrice !== null ||
        override.addonInstancePrice !== null ||
        override.addonGroupPrice !== null),
  );

const applyPricingOverrideToPlan = (
  plan: SubscriptionPlan,
  override: UserPlanPricingOverride | null,
): SubscriptionPlan => {
  if (!hasPricingOverride(override)) {
    return plan;
  }

  const planPrice = override?.planPrice;
  const addonInstancePrice = override?.addonInstancePrice;
  const addonGroupPrice = override?.addonGroupPrice;

  return {
    ...plan,
    price:
      planPrice !== null && planPrice !== undefined ? planPrice : plan.price,
    addonInstancePrice:
      addonInstancePrice !== null && addonInstancePrice !== undefined
        ? addonInstancePrice
        : plan.addonInstancePrice,
    addonGroupPrice:
      addonGroupPrice !== null && addonGroupPrice !== undefined
        ? addonGroupPrice
        : plan.addonGroupPrice,
  };
};

export const getUserPlanPricingOverride = async (
  userId: number,
): Promise<UserPlanPricingOverride | null> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  await ensureUserTable();
  const db = getDb();

  const [rows] = await db.query<
    (RowDataPacket & {
      custom_plan_price: string | null;
      custom_addon_instance_price: string | null;
      custom_addon_group_price: string | null;
    })[]
  >(
    `
      SELECT
        custom_plan_price,
        custom_addon_instance_price,
        custom_addon_group_price
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const row = rows[0];
  const override: UserPlanPricingOverride = {
    planPrice: parseOverrideValue(row.custom_plan_price),
    addonInstancePrice: parseOverrideValue(row.custom_addon_instance_price),
    addonGroupPrice: parseOverrideValue(row.custom_addon_group_price),
  };

  return hasPricingOverride(override) ? override : null;
};

const toIsoString = (value: Date | string | null): string | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const mapAddonRow = (row: UserPlanAddonRow): UserPlanAddon => {
  const metadata = parseAddonMetadata(row.metadata);
  const autoRenew =
    typeof row.auto_renew === "number"
      ? row.auto_renew === 1
      : getAutoRenewFromMetadata(metadata);

  return {
    id: row.id,
    userId: row.user_id,
    subscriptionId: row.subscription_id,
    type: row.addon_type,
    quantity: Number(row.quantity ?? 0),
    purchasedAt: toIsoString(row.purchased_at) ?? new Date().toISOString(),
    expiresAt: toIsoString(row.expires_at),
    autoRenew,
    metadata,
  };
};

export const getAllSubscriptionPlans = async (): Promise<SubscriptionPlan[]> => {
  await ensureSubscriptionPlanTable();
  const db = getDb();
  const [rows] = await db.query<(SubscriptionPlanRow & RowDataPacket)[]>(
    `SELECT * FROM subscription_plans ORDER BY price ASC, name ASC`,
  );

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => mapPlanRow(row));
};

export const getAllSubscriptionPlansForUser = async (
  userId: number,
): Promise<SubscriptionPlan[]> => {
  const plans = await getAllSubscriptionPlans();
  const override = await getUserPlanPricingOverride(userId);
  if (!hasPricingOverride(override)) {
    return plans;
  }
  return plans.map((plan) => applyPricingOverrideToPlan(plan, override));
};

export const createSubscriptionPlan = async (
  payload: SubscriptionPlanPayload,
): Promise<SubscriptionPlan> => {
  const normalized = normalizePayload(payload);
  await ensureSubscriptionPlanTable();
  const db = getDb();

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO subscription_plans (
        name,
        description,
        price,
        addon_instance_price,
        addon_group_price,
        group_limit,
        instance_limit,
        allow_flows,
        storage_quota_gb,
        features_json,
        duration_days,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      normalized.name,
      normalized.description,
      normalized.price,
      normalized.addonInstancePrice,
      normalized.addonGroupPrice,
      normalized.groupLimit,
      normalized.instanceLimit,
      normalized.allowFlows ? 1 : 0,
      normalized.storageQuotaGb,
      JSON.stringify(normalized.features),
      normalized.durationDays,
      normalized.isActive ? 1 : 0,
    ],
  );

  const insertedId = result.insertId;

  const [rows] = await db.query<(SubscriptionPlanRow & RowDataPacket)[]>(
    `SELECT * FROM subscription_plans WHERE id = ? LIMIT 1`,
    [insertedId],
  );

  const planRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!planRow) {
    throw new SubscriptionPlanError("Não foi possível carregar o plano após a criação.", 500);
  }

  return mapPlanRow(planRow);
};

export const updateSubscriptionPlan = async (
  planId: number,
  payload: SubscriptionPlanPayload,
): Promise<SubscriptionPlan> => {
  if (!Number.isFinite(planId) || planId <= 0) {
    throw new SubscriptionPlanError("Plano inválido.", 404);
  }

  const normalized = normalizePayload(payload);
  await ensureSubscriptionPlanTable();
  const db = getDb();

  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE subscription_plans
      SET
        name = ?,
        description = ?,
        price = ?,
        addon_instance_price = ?,
        addon_group_price = ?,
        group_limit = ?,
        instance_limit = ?,
        allow_flows = ?,
        storage_quota_gb = ?,
        features_json = ?,
        duration_days = ?,
        is_active = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      normalized.name,
      normalized.description,
      normalized.price,
      normalized.addonInstancePrice,
      normalized.addonGroupPrice,
      normalized.groupLimit,
      normalized.instanceLimit,
      normalized.allowFlows ? 1 : 0,
      normalized.storageQuotaGb,
      JSON.stringify(normalized.features),
      normalized.durationDays,
      normalized.isActive ? 1 : 0,
      planId,
    ],
  );

  if (result.affectedRows === 0) {
    throw new SubscriptionPlanError("Plano não encontrado.", 404);
  }

  const [rows] = await db.query<(SubscriptionPlanRow & RowDataPacket)[]>(
    `SELECT * FROM subscription_plans WHERE id = ? LIMIT 1`,
    [planId],
  );

  const planRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!planRow) {
    throw new SubscriptionPlanError("Não foi possível carregar o plano atualizado.", 500);
  }

  return mapPlanRow(planRow);
};

export const deleteSubscriptionPlan = async (planId: number): Promise<void> => {
  if (!Number.isFinite(planId) || planId <= 0) {
    throw new SubscriptionPlanError("Plano inválido.", 404);
  }

  await ensureSubscriptionPlanTable();
  const db = getDb();

  const [result] = await db.query<ResultSetHeader>(
    `DELETE FROM subscription_plans WHERE id = ?`,
    [planId],
  );

  if (result.affectedRows === 0) {
    throw new SubscriptionPlanError("Plano não encontrado.", 404);
  }
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_IN_MS);

const mapSubscriptionPlan = (row: SubscriptionPlanRow | null): SubscriptionPlan | null => {
  if (!row) {
    return null;
  }

  return mapPlanRow(row);
};

export const getSubscriptionPlanById = async (
  planId: number,
): Promise<SubscriptionPlan | null> => {
  if (!Number.isFinite(planId) || planId <= 0) {
    return null;
  }

  await ensureSubscriptionPlanTable();
  const db = getDb();

  const [rows] = await db.query<(SubscriptionPlanRow & RowDataPacket)[]>(
    `SELECT * FROM subscription_plans WHERE id = ? LIMIT 1`,
    [planId],
  );

  const planRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapSubscriptionPlan(planRow);
};

export const getSubscriptionPlanForUser = async (
  planId: number,
  userId: number,
): Promise<SubscriptionPlan | null> => {
  const plan = await getSubscriptionPlanById(planId);
  if (!plan) {
    return null;
  }
  const override = await getUserPlanPricingOverride(userId);
  return applyPricingOverrideToPlan(plan, override);
};

const mapSubscriptionRow = (
  row: UserPlanSubscriptionRow | null,
  planRow: SubscriptionPlanRow | null,
): UserPlanStatus => {
  if (!row) {
    return {
      planId: null,
      subscriptionId: null,
      plan: null,
      status: "inactive",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      daysRemaining: null,
      autoRenewPlan: false,
      isTrial: false,
      trialEndsAt: null,
      trialDurationHours: null,
    } satisfies UserPlanStatus;
  }

  if (!planRow) {
    const startIso = row.current_period_start ? row.current_period_start.toISOString() : null;
    const endIso = row.current_period_end ? row.current_period_end.toISOString() : null;
    const metadata = parseSubscriptionMetadata(row.metadata);
    const trialFlag = row.is_trial === 1 || metadata?.isTrial === true;
    const endDate = row.current_period_end ? new Date(row.current_period_end) : null;
    const trialEndsDate = metadata?.expiresAt
      ? toDateOrNull(metadata.expiresAt as string)
      : endDate;
    const trialDurationHours = (() => {
      if (metadata?.duration && typeof metadata.duration === "object") {
        const hoursRaw = (metadata.duration as { hours?: unknown }).hours;
        if (hoursRaw !== undefined) {
          const parsed = Number.parseInt(String(hoursRaw), 10);
          if (Number.isFinite(parsed) && !Number.isNaN(parsed) && parsed > 0) {
            return parsed;
          }
        }
      }
      if (trialFlag) {
        const startDate = row.current_period_start ? new Date(row.current_period_start) : null;
        const diff = diffInWholeHours(startDate, endDate);
        if (diff && diff > 0) {
          return diff;
        }
      }
      return null;
    })();

    return {
      planId: null,
      subscriptionId: row.id,
      plan: null,
      status: row.status,
      currentPeriodStart: startIso,
      currentPeriodEnd: endIso,
      daysRemaining: null,
      autoRenewPlan: Boolean(row.auto_renew_plan),
      isTrial: trialFlag,
      trialEndsAt: trialEndsDate ? trialEndsDate.toISOString() : null,
      trialDurationHours,
    } satisfies UserPlanStatus;
  }

  const plan = mapPlanRow(planRow);
  const startIso = row.current_period_start ? row.current_period_start.toISOString() : null;
  const endIso = row.current_period_end ? row.current_period_end.toISOString() : null;

  let status = row.status as UserPlanStatus["status"];
  let daysRemaining: number | null = null;

  // Se o plano foi desativado/removido do catálogo, considere-o expirado para forçar nova escolha
  if (!plan.isActive && status !== "expired") {
    status = "expired";
    daysRemaining = 0;
  }

  const endDate = row.current_period_end ? new Date(row.current_period_end) : null;
  if (status !== "expired") {
    if (endDate) {
      const now = new Date();

      if (endDate.getTime() >= now.getTime()) {
        const diff = Math.ceil((endDate.getTime() - now.getTime()) / DAY_IN_MS);
        daysRemaining = Math.max(diff, 0);
        if (status === "pending") {
          status = "active";
        }
      } else {
        status = "expired";
        daysRemaining = 0;
      }
    } else if (status === "pending") {
      status = "pending";
    }
  }

  const metadata = parseSubscriptionMetadata(row.metadata);
  const trialFlag = row.is_trial === 1 || metadata?.isTrial === true;
  const trialEndsDate = (() => {
    if (metadata?.expiresAt && typeof metadata.expiresAt === "string") {
      const parsed = toDateOrNull(metadata.expiresAt);
      if (parsed) {
        return parsed;
      }
    }
    return endDate;
  })();
  const trialDurationHours = (() => {
    if (metadata?.duration && typeof metadata.duration === "object") {
      const hoursRaw = (metadata.duration as { hours?: unknown }).hours;
      if (hoursRaw !== undefined) {
        const parsed = Number.parseInt(String(hoursRaw), 10);
        if (Number.isFinite(parsed) && !Number.isNaN(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
    if (trialFlag) {
      const startDate = row.current_period_start ? new Date(row.current_period_start) : null;
      const diff = diffInWholeHours(startDate, endDate);
      if (diff && diff > 0) {
        return diff;
      }
    }
    return null;
  })();

  return {
    planId: plan.id,
    subscriptionId: row.id,
    plan,
    status,
    currentPeriodStart: startIso,
    currentPeriodEnd: endIso,
    daysRemaining,
    autoRenewPlan: Boolean(row.auto_renew_plan),
    isTrial: trialFlag,
    trialEndsAt: trialEndsDate ? trialEndsDate.toISOString() : null,
    trialDurationHours,
  } satisfies UserPlanStatus;
};

export const getUserPlanStatus = async (userId: number): Promise<UserPlanStatus> => {
  await ensureUserPlanSubscriptionTable();
  const db = getDb();

  const [rows] = await db.query<
    (UserPlanSubscriptionRow &
      RowDataPacket & {
        plan_ref_id: number | null;
        plan_name: string | null;
        plan_description: string | null;
        plan_price: string | null;
        plan_addon_instance_price: string | null;
        plan_addon_group_price: string | null;
        plan_category_limit: number | null;
        plan_group_limit: number | null;
        plan_instance_limit: number | null;
        plan_allow_flows: number | null;
        plan_storage_quota_gb: string | null;
        plan_features_json: string | null;
        plan_duration_days: number | null;
        plan_is_active: number | null;
        plan_created_at: Date | string | null;
        plan_updated_at: Date | string | null;
      })
  >(
    `
      SELECT
        ups.*,
        p.id AS plan_ref_id,
        p.name AS plan_name,
        p.description AS plan_description,
        p.price AS plan_price,
        p.addon_instance_price AS plan_addon_instance_price,
        p.addon_group_price AS plan_addon_group_price,
        p.category_limit AS plan_category_limit,
        p.group_limit AS plan_group_limit,
        p.instance_limit AS plan_instance_limit,
        p.allow_flows AS plan_allow_flows,
        p.storage_quota_gb AS plan_storage_quota_gb,
        p.features_json AS plan_features_json,
        p.duration_days AS plan_duration_days,
        p.is_active AS plan_is_active,
        p.created_at AS plan_created_at,
        p.updated_at AS plan_updated_at
      FROM user_plan_subscriptions ups
      LEFT JOIN subscription_plans p ON p.id = ups.plan_id
      WHERE ups.user_id = ?
      LIMIT 1
    `,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      planId: null,
      subscriptionId: null,
      plan: null,
      status: "inactive",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      daysRemaining: null,
      autoRenewPlan: false,
      isTrial: false,
      trialEndsAt: null,
      trialDurationHours: null,
    } satisfies UserPlanStatus;
  }

  const row = rows[0];

  let planRow: SubscriptionPlanRow | null = null;
  if (row.plan_ref_id) {
    planRow = {
      id: row.plan_ref_id,
      name: row.plan_name ?? "",
      description: row.plan_description,
      price: row.plan_price ?? "0",
      addon_instance_price: row.plan_addon_instance_price ?? "0",
      addon_group_price: row.plan_addon_group_price ?? "0",
      category_limit: row.plan_category_limit ?? 0,
      group_limit: row.plan_group_limit ?? row.plan_category_limit ?? 0,
      instance_limit: row.plan_instance_limit ?? row.plan_category_limit ?? 0,
      allow_flows: row.plan_allow_flows ?? 1,
      storage_quota_gb: row.plan_storage_quota_gb ?? "0",
      features_json: row.plan_features_json,
      duration_days: row.plan_duration_days ?? 30,
      is_active: row.plan_is_active ?? 0,
      created_at: row.plan_created_at instanceof Date
        ? row.plan_created_at
        : new Date(row.plan_created_at ?? new Date()),
      updated_at: row.plan_updated_at instanceof Date
        ? row.plan_updated_at
        : new Date(row.plan_updated_at ?? new Date()),
    };
  }

  const status = mapSubscriptionRow(row, planRow);

  if (status.status === "expired" && row.status !== "expired") {
    await db.query(
      `
        UPDATE user_plan_subscriptions
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [row.id],
    );
  }

  const override = await getUserPlanPricingOverride(userId);
  if (status.plan && hasPricingOverride(override)) {
    return {
      ...status,
      plan: applyPricingOverrideToPlan(status.plan, override),
    };
  }

  return status;
};

export const getUserPlanAddons = async (
  userId: number,
  options: { includeExpired?: boolean } = {},
): Promise<UserPlanAddon[]> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return [];
  }

  await ensureUserPlanAddonTable();
  const db = getDb();

  const includeExpired = Boolean(options.includeExpired);
  const [rows] = await db.query<(UserPlanAddonRow & RowDataPacket)[]>(
    `
      SELECT *
      FROM user_plan_addons
      WHERE user_id = ?
        ${includeExpired ? "" : "AND (expires_at IS NULL OR expires_at > NOW())"}
      ORDER BY purchased_at DESC, id DESC
    `,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows.map(mapAddonRow);
};

type ProfileSlotUnit = {
  addon: UserPlanAddon;
  unitIndex: number;
  expiresAt: string | null;
  planId: number | null;
  assignedProfileId: number | null;
};

export type UserProfileManualSlot = {
  addonId: number;
  expiresAt: string | null;
  planId: number | null;
  used: boolean;
  available: boolean;
};

export type UserProfileSlotUsage = {
  total: number;
  used: number;
  available: number;
  manualTotal: number;
  manualAvailable: number;
  manualExpiresAt: string | null;
  manualSlots: UserProfileManualSlot[];
  expiresAt: string | null;
  nextAvailableExpiresAt: string | null;
};

export type AvailableProfileSlot = {
  addonId: number;
  unitIndex: number;
  expiresAt: string | null;
  planId: number | null;
};

const MANUAL_PROFILE_SLOT_SOURCES = new Set([
  "manual_admin",
  "admin_profile_slots",
  "manual_profile_slots",
]);

const readMetadataString = (
  metadata: Record<string, unknown> | null,
  key: string,
): string | null => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const readMetadataNumber = (
  metadata: Record<string, unknown> | null,
  key: string,
): number | null => {
  const value = metadata?.[key];
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const readMetadataNumberList = (
  metadata: Record<string, unknown> | null,
  key: string,
): number[] => {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const parsed = Number.parseInt(String(entry ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  });
};

const getActiveProfileSlotUnits = async (userId: number): Promise<ProfileSlotUnit[]> => {
  const now = Date.now();
  const addons = await getUserPlanAddons(userId);
  const units: ProfileSlotUnit[] = [];

  for (const addon of addons) {
    if (addon.type !== "instance") {
      continue;
    }

    const quantity = Math.max(0, Math.floor(Number(addon.quantity ?? 0)));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    if (addon.expiresAt) {
      const expiresTs = Date.parse(addon.expiresAt);
      if (!Number.isFinite(expiresTs) || expiresTs <= now) {
        continue;
      }
    }

    const planId = readMetadataNumber(addon.metadata, "planId");
    const assignedProfileIds = readMetadataNumberList(
      addon.metadata,
      "assignedProfileIds",
    );
    const hasAssignedProfileIds = Array.isArray(
      addon.metadata?.assignedProfileIds,
    );
    const legacyAssignedProfileId = readMetadataNumber(
      addon.metadata,
      "assignedProfileId",
    );
    for (let index = 0; index < quantity; index += 1) {
      units.push({
        addon,
        unitIndex: index,
        expiresAt: addon.expiresAt,
        planId,
        assignedProfileId:
          assignedProfileIds[index] ||
          (!hasAssignedProfileIds && index === 0
            ? legacyAssignedProfileId
            : null),
      });
    }
  }

  return units.sort((left, right) => {
    const leftExpiry = left.expiresAt ? Date.parse(left.expiresAt) : Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.expiresAt ? Date.parse(right.expiresAt) : Number.MAX_SAFE_INTEGER;
    const safeLeftExpiry = Number.isFinite(leftExpiry) ? leftExpiry : Number.MAX_SAFE_INTEGER;
    const safeRightExpiry = Number.isFinite(rightExpiry) ? rightExpiry : Number.MAX_SAFE_INTEGER;
    if (safeLeftExpiry !== safeRightExpiry) {
      return safeLeftExpiry - safeRightExpiry;
    }

    const leftPurchase = Date.parse(left.addon.purchasedAt);
    const rightPurchase = Date.parse(right.addon.purchasedAt);
    const safeLeftPurchase = Number.isFinite(leftPurchase) ? leftPurchase : Number.MAX_SAFE_INTEGER;
    const safeRightPurchase = Number.isFinite(rightPurchase) ? rightPurchase : Number.MAX_SAFE_INTEGER;
    if (safeLeftPurchase !== safeRightPurchase) {
      return safeLeftPurchase - safeRightPurchase;
    }

    return left.addon.id - right.addon.id;
  });
};

const getActiveProfileLicensesForUser = async (
  userId: number,
): Promise<{
  profiles: Array<{ id: number; createdAt: number; expiresAt: number }>;
  profileIds: Set<number>;
  orphanCount: number;
  total: number;
}> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return { profiles: [], profileIds: new Set(), orphanCount: 0, total: 0 };
  }

  await ensureBotUserProfileTable();
  await ensureBotInstanceTable();
  const db = getDb();
  const [profileRows] = await db.query<
    (RowDataPacket & {
      id: number;
      created_at: Date | string;
      expires_at: Date | string;
    })[]
  >(
    `
      SELECT id, created_at, expires_at
      FROM bot_user_profiles
      WHERE user_id = ?
        AND expires_at IS NOT NULL
        AND expires_at > NOW()
    `,
    [userId],
  );
  const [orphanRows] = await db.query<(RowDataPacket & { total: number })[]>(
    `
      SELECT COUNT(*) AS total
      FROM bot_instances
      WHERE user_id = ?
        AND COALESCE(purpose, 'profile') <> 'admin_system'
        AND profile_id IS NULL
        AND expires_at IS NOT NULL
        AND expires_at > NOW()
    `,
    [userId],
  );

  const profiles = (Array.isArray(profileRows) ? profileRows : [])
    .map((row) => ({
      id: Number(row.id),
      createdAt: new Date(row.created_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
    }))
    .filter(
      (profile) =>
        Number.isFinite(profile.id) &&
        profile.id > 0 &&
        Number.isFinite(profile.createdAt) &&
        Number.isFinite(profile.expiresAt),
    )
    .sort((left, right) => left.createdAt - right.createdAt || left.id - right.id);
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const orphanCount = Math.max(0, Number(orphanRows?.[0]?.total ?? 0));
  return {
    profiles,
    profileIds,
    orphanCount,
    total: profileIds.size + orphanCount,
  };
};

const resolveProfileSlotAllocation = async (userId: number) => {
  const [units, activeLicenses] = await Promise.all([
    getActiveProfileSlotUnits(userId),
    getActiveProfileLicensesForUser(userId),
  ]);
  const consumedIndexes = new Set<number>();
  const explicitlyAssignedProfiles = new Set<number>();
  const assignmentsByIndex = new Map<number, number>();

  units.forEach((unit, index) => {
    const profileId = unit.assignedProfileId;
    if (
      profileId !== null &&
      activeLicenses.profileIds.has(profileId) &&
      !explicitlyAssignedProfiles.has(profileId)
    ) {
      consumedIndexes.add(index);
      explicitlyAssignedProfiles.add(profileId);
      assignmentsByIndex.set(index, profileId);
    }
  });

  const remainingProfiles = activeLicenses.profiles.filter(
    (profile) => !explicitlyAssignedProfiles.has(profile.id),
  );
  const legacyMatchedProfiles = new Set<number>();

  units.forEach((unit, index) => {
    if (consumedIndexes.has(index) || unit.assignedProfileId !== null) {
      return;
    }
    const source = readMetadataString(unit.addon.metadata, "source");
    const isManual = source !== null && MANUAL_PROFILE_SLOT_SOURCES.has(source);
    if (!isManual) {
      return;
    }

    const slotCreatedAt = Date.parse(unit.addon.purchasedAt);
    if (!Number.isFinite(slotCreatedAt)) {
      return;
    }
    const slotExpiresAt = unit.expiresAt
      ? Date.parse(unit.expiresAt)
      : Number.NaN;
    if (!Number.isFinite(slotExpiresAt)) {
      return;
    }
    const matched = remainingProfiles.find(
      (profile) =>
        !legacyMatchedProfiles.has(profile.id) &&
        profile.createdAt >= slotCreatedAt &&
        Math.abs(profile.expiresAt - slotExpiresAt) <= 5 * 60 * 1000,
    );
    if (!matched) {
      return;
    }
    consumedIndexes.add(index);
    legacyMatchedProfiles.add(matched.id);
    assignmentsByIndex.set(index, matched.id);
  });

  let fallbackActiveLicenses = Math.max(
    0,
    activeLicenses.total -
      explicitlyAssignedProfiles.size -
      legacyMatchedProfiles.size,
  );
  units.forEach((unit, index) => {
    if (fallbackActiveLicenses <= 0 || consumedIndexes.has(index)) {
      return;
    }
    const source = readMetadataString(unit.addon.metadata, "source");
    const isManual = source !== null && MANUAL_PROFILE_SLOT_SOURCES.has(source);
    if (isManual) {
      return;
    }
    consumedIndexes.add(index);
    const matched = remainingProfiles.find(
      (profile) =>
        !legacyMatchedProfiles.has(profile.id) &&
        !explicitlyAssignedProfiles.has(profile.id),
    );
    if (matched) {
      legacyMatchedProfiles.add(matched.id);
      assignmentsByIndex.set(index, matched.id);
    }
    fallbackActiveLicenses -= 1;
  });

  return {
    units,
    consumedIndexes,
    assignmentsByIndex,
    availableUnits: units.filter((_, index) => !consumedIndexes.has(index)),
  };
};

export const getUserProfileSlotUsage = async (
  userId: number,
): Promise<UserProfileSlotUsage> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return {
      total: 0,
      used: 0,
      available: 0,
      manualTotal: 0,
      manualAvailable: 0,
      manualExpiresAt: null,
      manualSlots: [],
      expiresAt: null,
      nextAvailableExpiresAt: null,
    };
  }

  const { units, consumedIndexes, availableUnits } =
    await resolveProfileSlotAllocation(userId);

  const total = units.length;
  const used = consumedIndexes.size;
  const available = availableUnits.length;
  const next = availableUnits[0] ?? null;
  const manualSlots = units
    .map((unit, index) => {
      const source = readMetadataString(unit.addon.metadata, "source");
      const isManual = source !== null && MANUAL_PROFILE_SLOT_SOURCES.has(source);
      if (!isManual) {
        return null;
      }
      const isUsed = consumedIndexes.has(index);
      return {
        addonId: unit.addon.id,
        expiresAt: unit.expiresAt,
        planId: unit.planId,
        used: isUsed,
        available: !isUsed,
      } satisfies UserProfileManualSlot;
    })
    .filter((slot): slot is UserProfileManualSlot => Boolean(slot));
  const manualUnits = units.filter((unit) => {
    const source = readMetadataString(unit.addon.metadata, "source");
    return source !== null && MANUAL_PROFILE_SLOT_SOURCES.has(source);
  });
  const manualTotal = manualUnits.length;
  const manualUsed = manualSlots.filter((slot) => slot.used).length;
  const manualAvailable = Math.max(0, manualTotal - manualUsed);
  const lastExpiring = units
    .filter((unit) => unit.expiresAt)
    .sort((left, right) => Date.parse(right.expiresAt!) - Date.parse(left.expiresAt!))[0];
  const manualLastExpiring = manualUnits
    .filter((unit) => unit.expiresAt)
    .sort((left, right) => Date.parse(right.expiresAt!) - Date.parse(left.expiresAt!))[0];

  return {
    total,
    used,
    available,
    manualTotal,
    manualAvailable,
    manualExpiresAt: manualLastExpiring?.expiresAt ?? null,
    manualSlots,
    expiresAt: lastExpiring?.expiresAt ?? null,
    nextAvailableExpiresAt: next?.expiresAt ?? null,
  };
};

export const getAvailableProfileSlotForUser = async (
  userId: number,
): Promise<AvailableProfileSlot | null> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  const { availableUnits } = await resolveProfileSlotAllocation(userId);
  if (availableUnits.length === 0) {
    return null;
  }

  const unit = availableUnits[0];
  return {
    addonId: unit.addon.id,
    unitIndex: unit.unitIndex,
    expiresAt: unit.expiresAt,
    planId: unit.planId,
  };
};

export const assignProfileSlotToProfile = async (
  userId: number,
  slot: AvailableProfileSlot,
  profileId: number,
  instanceId?: number | null,
): Promise<void> => {
  if (
    !Number.isFinite(userId) ||
    userId <= 0 ||
    !Number.isFinite(slot.addonId) ||
    slot.addonId <= 0 ||
    !Number.isFinite(profileId) ||
    profileId <= 0
  ) {
    return;
  }

  const addons = await getUserPlanAddons(userId, { includeExpired: true });
  const addon = addons.find((entry) => entry.id === slot.addonId);
  if (!addon) {
    return;
  }

  const assignedProfileIds = readMetadataNumberList(
    addon.metadata,
    "assignedProfileIds",
  );
  while (assignedProfileIds.length < Math.max(1, addon.quantity)) {
    assignedProfileIds.push(0);
  }
  assignedProfileIds[Math.max(0, slot.unitIndex)] = profileId;

  await ensureUserPlanAddonTable();
  const db = getDb();
  await db.query(
    `
      UPDATE user_plan_addons
      SET metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [
      JSON.stringify({
        ...(addon.metadata ?? {}),
        assignedProfileId: assignedProfileIds[0] || null,
        assignedProfileIds,
        assignedInstanceId:
          typeof instanceId === "number" && instanceId > 0 ? instanceId : null,
        assignedAt: new Date().toISOString(),
      }),
      slot.addonId,
      userId,
    ],
  );
};

export const setManualProfileSlotsForUser = async (
  userId: number,
  payload: {
    quantity?: number;
    expiresAt?: Date | string | null;
    slots?: Array<{ expiresAt?: Date | string | null }>;
    grantedByUserId?: number | null;
  },
): Promise<UserProfileSlotUsage> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new SubscriptionPlanError("Usuário inválido.");
  }

  const slotExpirations: Date[] = [];
  if (Array.isArray(payload.slots)) {
    for (const slot of payload.slots) {
      let slotExpiresAt: Date | null = null;
      if (slot.expiresAt !== undefined && slot.expiresAt !== null) {
        slotExpiresAt = parseDateInput(slot.expiresAt, "Validade do slot de perfil");
      }
      slotExpirations.push(slotExpiresAt ?? addDays(new Date(), 30));
    }
  } else {
    const quantity = Math.max(0, Math.floor(Number(payload.quantity ?? 0)));
    if (!Number.isFinite(quantity)) {
      throw new SubscriptionPlanError("Quantidade de slots inválida.");
    }

    let expiresAt: Date | null = null;
    if (payload.expiresAt !== undefined && payload.expiresAt !== null) {
      expiresAt = parseDateInput(payload.expiresAt, "Validade dos slots de perfil");
    }
    const normalizedExpiresAt = expiresAt ?? addDays(new Date(), 30);
    for (let index = 0; index < quantity; index += 1) {
      slotExpirations.push(normalizedExpiresAt);
    }
  }

  await ensureUserPlanAddonTable();
  const db = getDb();
  const currentAllocation = await resolveProfileSlotAllocation(userId);
  const preservedAssignments = currentAllocation.units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => {
      const source = readMetadataString(unit.addon.metadata, "source");
      return source !== null && MANUAL_PROFILE_SLOT_SOURCES.has(source);
    })
    .map(
      ({ index }) =>
        currentAllocation.assignmentsByIndex.get(index) ?? null,
    );
  const existingAddons = await getUserPlanAddons(userId, { includeExpired: true });
  const manualIds = existingAddons
    .filter((addon) => {
      if (addon.type !== "instance") {
        return false;
      }
      const source = readMetadataString(addon.metadata, "source");
      return source !== null && MANUAL_PROFILE_SLOT_SOURCES.has(source);
    })
    .map((addon) => addon.id)
    .filter((id) => Number.isFinite(id) && id > 0);

  if (manualIds.length > 0) {
    await db.query(
      `DELETE FROM user_plan_addons WHERE user_id = ? AND id IN (${manualIds.map(() => "?").join(", ")})`,
      [userId, ...manualIds],
    );
  }

  for (const [index, expiresAt] of slotExpirations.entries()) {
    await createUserPlanAddon(userId, {
      type: "instance",
      quantity: 1,
      expiresAt,
      autoRenew: false,
      metadata: {
        source: "admin_profile_slots",
        grantedBy: payload.grantedByUserId ?? null,
        grantedAt: new Date().toISOString(),
        slotIndex: index + 1,
        totalSlots: slotExpirations.length,
        assignedProfileId: preservedAssignments[index] ?? null,
        assignedProfileIds: preservedAssignments[index]
          ? [preservedAssignments[index]]
          : [],
      },
    });
  }

  return getUserProfileSlotUsage(userId);
};

export const getUserPlanLimits = async (userId: number): Promise<UserPlanLimits> => {
  const status = await getUserPlanStatus(userId);
  if (!isUserProfilePlanActive(status) || !status.plan) {
    return { instanceLimit: 0, groupLimit: 0 } satisfies UserPlanLimits;
  }
  return {
    instanceLimit: Math.max(0, status.plan.instanceLimit),
    groupLimit: Math.max(0, status.plan.groupLimit),
  } satisfies UserPlanLimits;
};

export const userPlanAllowsFlows = async (userId: number): Promise<boolean> => {
  const status = await getUserPlanStatus(userId);
  return isUserProfilePlanActive(status) &&
    (status.plan?.features.fluxos ?? status.plan?.features.flows ?? true) !== false;
};

export const getUserPlanFeature = async (
  userId: number,
  featureKey: string,
): Promise<boolean | number> => {
  const status = await getUserPlanStatus(userId);
  if (!isUserProfilePlanActive(status) || !status.plan) return false;
  const key = featureKey.trim().toLowerCase();
  const value = status.plan.features[key];
  return value === undefined ? false : value;
};

export const assertUserPlanFeature = async (
  userId: number,
  featureKey: string,
): Promise<{ status: UserPlanStatus; plan: SubscriptionPlan; value: boolean | number }> => {
  const status = await getUserPlanStatus(userId);
  if (!isUserProfilePlanActive(status) || !status.plan) {
    throw new SubscriptionPlanError("Você precisa de um plano ativo para utilizar esta funcionalidade.", 402);
  }
  const value = status.plan.features[featureKey.trim().toLowerCase()];
  if (value === false || value === 0) {
    throw new SubscriptionPlanError("Esta funcionalidade não está liberada no seu plano.", 403);
  }
  return { status, plan: status.plan, value: value ?? true };
};

export const isUserProfilePlanActive = (
  status: UserPlanStatus,
  now = Date.now(),
): boolean => {
  if (status.status !== "active" || !status.plan) {
    return false;
  }
  if (!status.currentPeriodEnd) {
    return true;
  }
  const endTs = new Date(status.currentPeriodEnd).getTime();
  return Number.isFinite(endTs) && endTs > now;
};

export const assertUserHasActivePlan = async (
  userId: number,
): Promise<{ status: UserPlanStatus; plan: SubscriptionPlan }> => {
  const status = await getUserPlanStatus(userId);

  if (!isUserProfilePlanActive(status)) {
    throw new SubscriptionPlanError(
      "Você precisa de um plano ativo para utilizar esta funcionalidade.",
      402,
    );
  }

  return { status, plan: status.plan! };
};

/**
 * Recursos próprios do painel (como os Grupos BotAdmin) permanecem liberados
 * quando o cliente possui uma assinatura global ativa OU ao menos um perfil
 * pago ainda vigente. Renovações feitas no contexto `instance_renewal`
 * estendem a licença do perfil, sem necessariamente alterar a linha legada de
 * `user_plan_subscriptions`; por isso essa é a fonte de autorização correta
 * para funcionalidades que não dependem de uma instância específica.
 */
export const assertUserHasActivePanelEntitlement = async (
  userId: number,
): Promise<{ status: UserPlanStatus; source: "subscription" | "profile_license" }> => {
  const status = await getUserPlanStatus(userId);
  if (isUserProfilePlanActive(status)) {
    return { status, source: "subscription" };
  }

  const profileLicenses = await getActiveProfileLicensesForUser(userId);
  if (profileLicenses.total > 0) {
    return { status, source: "profile_license" };
  }

  throw new SubscriptionPlanError(
    "Você precisa de um plano ou perfil ativo para utilizar esta funcionalidade.",
    402,
  );
};

export const activateUserPlan = async (
  userId: number,
  planId: number,
): Promise<{ status: UserPlanStatus; subscriptionId: number | null; periodStart: string | null; periodEnd: string | null }> => {
  const plan = await getSubscriptionPlanById(planId);
  if (!plan) {
    throw new SubscriptionPlanError("Plano não encontrado.", 404);
  }

  if (!plan.isActive) {
    throw new SubscriptionPlanError("Este plano está inativo no momento.");
  }

  await ensureUserPlanSubscriptionTable();
  const db = getDb();

  const [rows] = await db.query<UserPlanSubscriptionRow[]>(
    `SELECT * FROM user_plan_subscriptions WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  const now = new Date();
  let periodStart = now;
  let periodEnd = addDays(now, plan.durationDays);
  const status: UserPlanSubscriptionRow["status"] = "active";

  let subscriptionId: number | null = null;
  let previousPlanId: number | null = null;

  if (rows.length > 0) {
    const existing = rows[0];
    subscriptionId = existing.id;
    previousPlanId = Number.isFinite(Number(existing.plan_id)) ? Number(existing.plan_id) : null;
    const existingEnd = existing.current_period_end ? new Date(existing.current_period_end) : null;

    if (existing.plan_id === planId && existingEnd && existingEnd.getTime() > now.getTime()) {
      periodStart = existing.current_period_start ? new Date(existing.current_period_start) : now;
      periodEnd = addDays(existingEnd, plan.durationDays);
    } else {
      periodStart = now;
      periodEnd = addDays(now, plan.durationDays);
    }

    await db.query(
      `
        UPDATE user_plan_subscriptions
        SET
          plan_id = ?,
          auto_renew_plan = 0,
          status = ?,
          current_period_start = ?,
          current_period_end = ?,
          cancelled_at = NULL,
          is_trial = 0,
          metadata = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [planId, status, periodStart, periodEnd, existing.id],
    );
  } else {
    const [insertResult] = await db.query<ResultSetHeader>(
      `
        INSERT INTO user_plan_subscriptions (
          user_id,
          plan_id,
          auto_renew_plan,
          status,
          current_period_start,
          current_period_end,
          is_trial,
          metadata
        ) VALUES (?, ?, 0, ?, ?, ?, 0, NULL)
      `,
      [userId, planId, status, periodStart, periodEnd],
    );
    subscriptionId = insertResult.insertId;
  }

  const planIdsToSync = new Set<number>();
  if (previousPlanId && previousPlanId > 0) {
    planIdsToSync.add(previousPlanId);
  }
  planIdsToSync.add(planId);
  await syncPlanInstancesForUser({
    userId,
    newPlanId: planId,
    periodEnd,
    matchPlanIds: Array.from(planIdsToSync),
  });

  const statusSnapshot = await getUserPlanStatus(userId);
  return {
    status: statusSnapshot,
    subscriptionId,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
};

export const validatePlanInstanceLimit = (
  limits: UserPlanLimits,
  currentInstances: number,
) => {
  void limits;
  void currentInstances;
};

export const validatePlanGroupLimit = (
  limits: UserPlanLimits,
  currentGroups: number,
) => {
  void limits;
  void currentGroups;
};

export const createUserPlanAddon = async (
  userId: number,
  payload: {
    type: PlanAddonType;
    quantity: number;
    subscriptionId?: number | null;
    expiresAt?: Date | string | null;
    autoRenew?: boolean;
    metadata?: Record<string, unknown> | null;
  },
): Promise<UserPlanAddon> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new SubscriptionPlanError("Usuário inválido.");
  }

  const type = payload.type;
  if (type !== "instance" && type !== "group") {
    throw new SubscriptionPlanError("Tipo de add-on indisponível.");
  }

  const quantity = sanitizePositiveInteger(payload.quantity, "a quantidade do add-on", 1);
  let expiresAt: Date | null = null;
  if (payload.expiresAt) {
    const parsed = payload.expiresAt instanceof Date ? payload.expiresAt : new Date(payload.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new SubscriptionPlanError("Data de expiração inválida para o add-on.");
    }
    expiresAt = parsed;
  }

  const autoRenew = payload.autoRenew === true;
  const subscriptionId = payload.subscriptionId ?? null;
  const metadataObject: Record<string, unknown> =
    payload.metadata && typeof payload.metadata === "object"
      ? { ...payload.metadata }
      : {};

  if (payload.autoRenew !== undefined || typeof metadataObject["autoRenew"] !== "boolean") {
    metadataObject["autoRenew"] = autoRenew;
  }

  const metadata =
    Object.keys(metadataObject).length > 0 ? JSON.stringify(metadataObject) : null;

  await ensureUserPlanAddonTable();
  const db = getDb();

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_plan_addons (
        user_id,
        subscription_id,
        addon_type,
        quantity,
        auto_renew,
        expires_at,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [userId, subscriptionId, type, quantity, autoRenew ? 1 : 0, expiresAt, metadata],
  );

  const insertedId = result.insertId;

  const [rows] = await db.query<(UserPlanAddonRow & RowDataPacket)[]>(
    `SELECT * FROM user_plan_addons WHERE id = ? LIMIT 1`,
    [insertedId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SubscriptionPlanError("Não foi possível carregar o add-on criado.", 500);
  }

  return mapAddonRow(rows[0]);
};

export const grantPlanAddons = async (payload: {
  userId: number;
  subscriptionId: number | null;
  planId: number;
  addons: PlanCheckoutAddonLine[];
  periodEnd: Date | string | null;
  paymentReference?: string | null;
  source?: "plan_purchase" | "addon_purchase";
}): Promise<void> => {
  const addons = Array.isArray(payload.addons)
    ? payload.addons.filter((addon) => addon?.type === "instance" || addon?.type === "group")
    : [];
  if (addons.length === 0) {
    return;
  }

  let expiresAt: Date | null = null;
  if (payload.periodEnd) {
    const parsed = payload.periodEnd instanceof Date
      ? payload.periodEnd
      : new Date(payload.periodEnd);
    if (!Number.isNaN(parsed.getTime())) {
      expiresAt = parsed;
    }
  }

  const nowTs = Date.now();
  const existingAddons = await getUserPlanAddons(payload.userId, { includeExpired: true });
  const reusableByType = {
    instance: [] as UserPlanAddon[],
    group: [] as UserPlanAddon[],
  };

  for (const addon of existingAddons) {
    if ((addon.type !== "instance" && addon.type !== "group") || !addon.expiresAt) {
      continue;
    }
    const expiresAtTs = Date.parse(addon.expiresAt);
    if (!Number.isFinite(expiresAtTs) || expiresAtTs > nowTs) {
      continue;
    }
    reusableByType[addon.type].push(addon);
  }

  const byReusePriority = (left: UserPlanAddon, right: UserPlanAddon) => {
    const leftExpiry = left.expiresAt ? Date.parse(left.expiresAt) : Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.expiresAt ? Date.parse(right.expiresAt) : Number.MAX_SAFE_INTEGER;
    const safeLeftExpiry = Number.isFinite(leftExpiry) ? leftExpiry : Number.MAX_SAFE_INTEGER;
    const safeRightExpiry = Number.isFinite(rightExpiry) ? rightExpiry : Number.MAX_SAFE_INTEGER;
    if (safeLeftExpiry !== safeRightExpiry) {
      return safeLeftExpiry - safeRightExpiry;
    }

    const leftPurchase = Date.parse(left.purchasedAt);
    const rightPurchase = Date.parse(right.purchasedAt);
    const safeLeftPurchase = Number.isFinite(leftPurchase) ? leftPurchase : Number.MAX_SAFE_INTEGER;
    const safeRightPurchase = Number.isFinite(rightPurchase) ? rightPurchase : Number.MAX_SAFE_INTEGER;
    if (safeLeftPurchase !== safeRightPurchase) {
      return safeLeftPurchase - safeRightPurchase;
    }

    return left.id - right.id;
  };

  reusableByType.instance.sort(byReusePriority);
  reusableByType.group.sort(byReusePriority);

  for (const addon of addons) {
    if (!addon) {
      continue;
    }

    const quantity = Math.max(0, Math.floor(Number(addon.quantity ?? 0)));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    const unitPrice = roundToTwoDecimals(addon.unitPrice);
    const source = payload.source ?? "plan_purchase";
    let remaining = quantity;
    const candidates = reusableByType[addon.type];
    let unitIndex = 0;

    for (const candidate of candidates) {
      if (remaining <= 0) {
        break;
      }

      const candidateQuantity = Math.max(0, Math.floor(Number(candidate.quantity ?? 0)));
      if (!Number.isFinite(candidateQuantity) || candidateQuantity <= 0) {
        continue;
      }

      const existingMetadata = candidate.metadata && typeof candidate.metadata === "object"
        ? { ...candidate.metadata }
        : {};
      const currentRefs = extractPaymentReferencesFromMetadata(existingMetadata);
      const nextRefs = new Set(currentRefs);
      if (typeof payload.paymentReference === "string" && payload.paymentReference.trim().length > 0) {
        nextRefs.add(payload.paymentReference.trim());
      }

      const mergedMetadata: Record<string, unknown> = {
        ...existingMetadata,
        source: `${source}_reuse`,
        planId: payload.planId,
        quantity: 1,
        requestedQuantity: quantity,
        unitIndex: unitIndex + 1,
        unitPrice,
        totalPrice: unitPrice,
        paymentReference: payload.paymentReference ?? null,
        reusedFromExpiredSlot: true,
      };
      if (nextRefs.size > 0) {
        mergedMetadata.paymentReferences = Array.from(nextRefs);
      }

      if (candidateQuantity > 1) {
        await updateUserPlanAddonSlot(
          candidate.id,
          1,
          {
            expiresAt: expiresAt ?? undefined,
            subscriptionId: payload.subscriptionId ?? null,
            autoRenew: false,
            metadata: mergedMetadata,
          },
          { expectedUserId: payload.userId },
        );
      } else {
        await updateUserPlanAddon(
          candidate.id,
          {
            quantity: 1,
            expiresAt: expiresAt ?? undefined,
            subscriptionId: payload.subscriptionId ?? null,
            autoRenew: false,
            metadata: mergedMetadata,
          },
          { expectedUserId: payload.userId },
        );
      }

      candidate.quantity = 0;
      remaining -= 1;
      unitIndex += 1;
    }

    if (remaining <= 0) {
      continue;
    }

    for (let index = 0; index < remaining; index += 1) {
      const metadata: Record<string, unknown> = {
        source,
        planId: payload.planId,
        quantity: 1,
        requestedQuantity: quantity,
        unitIndex: unitIndex + index + 1,
        unitPrice,
        totalPrice: unitPrice,
        paymentReference: payload.paymentReference ?? null,
      };
      if (typeof payload.paymentReference === "string" && payload.paymentReference.trim().length > 0) {
        metadata.paymentReferences = [payload.paymentReference.trim()];
      }

      await createUserPlanAddon(payload.userId, {
        type: addon.type,
        quantity: 1,
        subscriptionId: payload.subscriptionId ?? undefined,
        expiresAt: expiresAt ?? undefined,
        autoRenew: false,
        metadata,
      });
    }
  }
};

export const setUserPlanSubscription = async (
  userId: number,
  options: {
    planId: number | null;
    status?: UserPlanSubscriptionRow["status"] | null;
    periodStart?: Date | string | null;
    periodEnd?: Date | string | null;
    autoRenewPlan?: boolean;
    clearAddons?: boolean;
    isTrial?: boolean;
    metadata?: Record<string, unknown> | null;
  },
): Promise<{ status: UserPlanStatus; subscriptionId: number | null }> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new SubscriptionPlanError("Usuário inválido.");
  }

  await ensureUserPlanSubscriptionTable();
  const db = getDb();

  const [existingRows] = await db.query<(UserPlanSubscriptionRow & RowDataPacket)[]>(
    `SELECT * FROM user_plan_subscriptions WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;

  const existingPlanId =
    existing && existing.plan_id !== null && existing.plan_id !== undefined
      ? Number(existing.plan_id)
      : null;

  if (options.planId === null) {
    if (existing) {
      await db.query(`DELETE FROM user_plan_subscriptions WHERE id = ?`, [existing.id]);
    }

    if (options.clearAddons === true) {
      await ensureUserPlanAddonTable();
      await db.query(`DELETE FROM user_plan_addons WHERE user_id = ?`, [userId]);
    }

    if (existingPlanId) {
      await syncPlanInstancesForUser({
        userId,
        newPlanId: null,
        periodEnd: null,
        matchPlanIds: [existingPlanId],
      });
    }

    return {
      status: await getUserPlanStatus(userId),
      subscriptionId: null,
    };
  }

  const targetPlanId = Number.parseInt(String(options.planId ?? ""), 10);
  if (!Number.isFinite(targetPlanId) || targetPlanId <= 0) {
    throw new SubscriptionPlanError("Plano inválido.");
  }

  const plan = await getSubscriptionPlanById(targetPlanId);
  if (!plan) {
    throw new SubscriptionPlanError("Plano não encontrado.", 404);
  }

  const providedStart = options.periodStart !== undefined
    ? parseDateInput(options.periodStart, "Data de início do plano")
    : null;
  const providedEnd = options.periodEnd !== undefined
    ? parseDateInput(options.periodEnd, "Data de término do plano")
    : null;

  const now = new Date();
  const existingEnd = existing?.current_period_end ? new Date(existing.current_period_end) : null;
  const existingIsStillActive =
    existing?.status === "active" &&
    existingEnd !== null &&
    Number.isFinite(existingEnd.getTime()) &&
    existingEnd.getTime() > now.getTime();
  const shouldResetPeriodStart =
    !existing ||
    existingPlanId !== targetPlanId ||
    !existingIsStillActive;

  let periodStart: Date;
  if (providedStart) {
    periodStart = providedStart;
  } else if (shouldResetPeriodStart) {
    periodStart = now;
  } else if (existing?.current_period_start) {
    periodStart = new Date(existing.current_period_start);
  } else {
    periodStart = now;
  }

  let periodEnd: Date;
  if (providedEnd) {
    periodEnd = providedEnd;
  } else if (existing?.current_period_end) {
    periodEnd = new Date(existing.current_period_end);
  } else {
    periodEnd = addDays(periodStart, plan.durationDays);
  }

  if (periodEnd.getTime() <= periodStart.getTime()) {
    throw new SubscriptionPlanError("A data de término do plano deve ser posterior à data de início.");
  }

  const computedDefaultStatus: UserPlanSubscriptionRow["status"] =
    periodEnd.getTime() >= Date.now() ? "active" : "expired";
  const status = normalizeSubscriptionStatus(options.status, computedDefaultStatus);
  const autoRenewPlan = typeof options.autoRenewPlan === "boolean"
    ? options.autoRenewPlan
    : Boolean(existing?.auto_renew_plan ?? false);
  const cancelledAt =
    status === "cancelled"
      ? new Date()
      : null;
  const isTrial = options.isTrial === true;
  const metadataJson =
    options.metadata && Object.keys(options.metadata).length > 0
      ? JSON.stringify(options.metadata)
      : null;

  let subscriptionId: number | null = existing ? existing.id : null;

  if (existing) {
    await db.query(
      `
        UPDATE user_plan_subscriptions
        SET
          plan_id = ?,
          auto_renew_plan = ?,
          status = ?,
          current_period_start = ?,
          current_period_end = ?,
          cancelled_at = ?,
          is_trial = ?,
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        targetPlanId,
        autoRenewPlan ? 1 : 0,
        status,
        periodStart,
        periodEnd,
        cancelledAt,
        isTrial ? 1 : 0,
        metadataJson,
        existing.id,
      ],
    );
  } else {
    const [insertResult] = await db.query<ResultSetHeader>(
      `
        INSERT INTO user_plan_subscriptions (
          user_id,
          plan_id,
          auto_renew_plan,
          status,
          current_period_start,
          current_period_end,
          cancelled_at,
          is_trial,
          metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        targetPlanId,
        autoRenewPlan ? 1 : 0,
        status,
        periodStart,
        periodEnd,
        cancelledAt,
        isTrial ? 1 : 0,
        metadataJson,
      ],
    );
    subscriptionId = insertResult.insertId;
  }

  if (options.clearAddons === true) {
    await ensureUserPlanAddonTable();
    await db.query(`DELETE FROM user_plan_addons WHERE user_id = ?`, [userId]);
  }

  const planIdsToSync = new Set<number>();
  if (existingPlanId) {
    planIdsToSync.add(existingPlanId);
  }
  planIdsToSync.add(targetPlanId);

  await syncPlanInstancesForUser({
    userId,
    newPlanId: targetPlanId,
    periodEnd,
    matchPlanIds: Array.from(planIdsToSync),
  });

  const statusSnapshot = await getUserPlanStatus(userId);
  return {
    status: statusSnapshot,
    subscriptionId,
  };
};

export const updateUserPlanAddon = async (
  addonId: number,
  payload: {
    quantity?: number;
    expiresAt?: Date | string | null;
    subscriptionId?: number | null;
    autoRenew?: boolean;
    metadata?: Record<string, unknown> | null;
  },
  options: { expectedUserId?: number } = {},
): Promise<UserPlanAddon> => {
  if (!Number.isFinite(addonId) || addonId <= 0) {
    throw new SubscriptionPlanError("Add-on inválido.");
  }

  await ensureUserPlanAddonTable();
  const db = getDb();

  const [existingRows] = await db.query<(UserPlanAddonRow & RowDataPacket)[]>(
    `SELECT * FROM user_plan_addons WHERE id = ? LIMIT 1`,
    [addonId],
  );

  if (!Array.isArray(existingRows) || existingRows.length === 0) {
    throw new SubscriptionPlanError("Add-on não encontrado.", 404);
  }

  const existing = existingRows[0];
  if (
    options.expectedUserId !== undefined &&
    existing.user_id !== options.expectedUserId
  ) {
    throw new SubscriptionPlanError("Add-on não encontrado.", 404);
  }

  const updates: string[] = [];
  const values: Array<string | number | Date | null> = [];

  if (payload.quantity !== undefined) {
    const quantity = sanitizePositiveInteger(payload.quantity, "a quantidade do add-on", 1);
    updates.push("quantity = ?");
    values.push(quantity);
  }

  if (payload.expiresAt !== undefined) {
    const expiresAt = parseDateInput(payload.expiresAt, "Data de expiração do add-on");
    updates.push("expires_at = ?");
    values.push(expiresAt);
  }

  if (payload.subscriptionId !== undefined) {
    const subscriptionId =
      payload.subscriptionId === null || payload.subscriptionId === undefined
        ? null
        : Number.parseInt(String(payload.subscriptionId), 10);

    if (subscriptionId !== null && (!Number.isFinite(subscriptionId) || subscriptionId <= 0)) {
      throw new SubscriptionPlanError("Assinatura inválida para o add-on.");
    }

    updates.push("subscription_id = ?");
    values.push(subscriptionId);
  }

  if (payload.autoRenew !== undefined) {
    updates.push("auto_renew = ?");
    values.push(payload.autoRenew ? 1 : 0);
  }

  if (payload.metadata !== undefined) {
    const currentMetadata = parseAddonMetadata(existing.metadata);
    const mergedMetadata: Record<string, unknown> = {
      ...(currentMetadata ?? {}),
      ...(payload.metadata ?? {}),
    };

    if (payload.autoRenew !== undefined) {
      mergedMetadata["autoRenew"] = payload.autoRenew;
    } else if (typeof mergedMetadata["autoRenew"] !== "boolean") {
      mergedMetadata["autoRenew"] = typeof existing.auto_renew === "number"
        ? existing.auto_renew === 1
        : false;
    }

    const metadataJson =
      Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null;
    updates.push("metadata = ?");
    values.push(metadataJson);
  } else if (payload.autoRenew !== undefined) {
    const currentMetadata = parseAddonMetadata(existing.metadata) ?? {};
    currentMetadata["autoRenew"] = payload.autoRenew;
    const metadataJson =
      Object.keys(currentMetadata).length > 0 ? JSON.stringify(currentMetadata) : null;
    updates.push("metadata = ?");
    values.push(metadataJson);
  }

  if (updates.length === 0) {
    return mapAddonRow(existing);
  }

  await db.query(
    `
      UPDATE user_plan_addons
      SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [...values, addonId],
  );

  const [rows] = await db.query<(UserPlanAddonRow & RowDataPacket)[]>(
    `SELECT * FROM user_plan_addons WHERE id = ? LIMIT 1`,
    [addonId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SubscriptionPlanError("Não foi possível carregar o add-on atualizado.", 500);
  }

  return mapAddonRow(rows[0]);
};

export const updateUserPlanAddonSlot = async (
  addonId: number,
  slotNumber: number,
  payload: {
    expiresAt?: Date | string | null;
    subscriptionId?: number | null;
    autoRenew?: boolean;
    metadata?: Record<string, unknown> | null;
  },
  options: { expectedUserId?: number } = {},
): Promise<UserPlanAddon> => {
  if (!Number.isFinite(addonId) || addonId <= 0) {
    throw new SubscriptionPlanError("Add-on inválido.");
  }

  const slot = Math.floor(Number(slotNumber));
  if (!Number.isFinite(slot) || slot <= 0) {
    throw new SubscriptionPlanError("Vaga do add-on inválida.");
  }

  await ensureUserPlanAddonTable();
  const db = getDb();

  const [existingRows] = await db.query<(UserPlanAddonRow & RowDataPacket)[]>(
    `SELECT * FROM user_plan_addons WHERE id = ? LIMIT 1`,
    [addonId],
  );

  if (!Array.isArray(existingRows) || existingRows.length === 0) {
    throw new SubscriptionPlanError("Add-on não encontrado.", 404);
  }

  const existing = existingRows[0];
  if (
    options.expectedUserId !== undefined &&
    existing.user_id !== options.expectedUserId
  ) {
    throw new SubscriptionPlanError("Add-on não encontrado.", 404);
  }

  const currentQuantity = sanitizePositiveInteger(
    existing.quantity,
    "a quantidade do add-on",
    1,
  );
  if (slot > currentQuantity) {
    throw new SubscriptionPlanError("Vaga do add-on fora da quantidade contratada.");
  }

  if (currentQuantity === 1) {
    return updateUserPlanAddon(addonId, payload, options);
  }

  const beforeQuantity = slot - 1;
  const afterQuantity = currentQuantity - slot;
  const currentMetadata = parseAddonMetadata(existing.metadata) ?? {};
  const selectedMetadata: Record<string, unknown> = {
    ...currentMetadata,
    ...(payload.metadata ?? {}),
  };

  if (payload.autoRenew !== undefined) {
    selectedMetadata["autoRenew"] = payload.autoRenew;
  } else if (typeof selectedMetadata["autoRenew"] !== "boolean") {
    selectedMetadata["autoRenew"] =
      typeof existing.auto_renew === "number" ? existing.auto_renew === 1 : false;
  }

  selectedMetadata["splitFromAddonId"] = addonId;
  selectedMetadata["splitSlotNumber"] = slot;
  selectedMetadata["splitAt"] = new Date().toISOString();

  const selectedExpiresAt =
    payload.expiresAt !== undefined
      ? parseDateInput(payload.expiresAt, "Data de expiração do add-on")
      : existing.expires_at ?? null;
  const selectedSubscriptionId =
    payload.subscriptionId !== undefined ? payload.subscriptionId : existing.subscription_id;
  const selectedAutoRenew =
    payload.autoRenew !== undefined
      ? payload.autoRenew
      : typeof existing.auto_renew === "number"
        ? existing.auto_renew === 1
        : false;
  const selectedMetadataJson =
    Object.keys(selectedMetadata).length > 0 ? JSON.stringify(selectedMetadata) : null;
  const unchangedMetadataJson = existing.metadata ? JSON.stringify(currentMetadata) : null;
  const purchasedAt = existing.purchased_at;

  let selectedAddonId = addonId;

  await db.query("START TRANSACTION");
  try {
    if (beforeQuantity > 0) {
      await db.query(
        `
          UPDATE user_plan_addons
          SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [beforeQuantity, addonId],
      );

      const [selectedResult] = await db.query<ResultSetHeader>(
        `
          INSERT INTO user_plan_addons (
            user_id,
            subscription_id,
            addon_type,
            quantity,
            auto_renew,
            purchased_at,
            expires_at,
            metadata
          ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
        `,
        [
          existing.user_id,
          selectedSubscriptionId ?? null,
          existing.addon_type,
          selectedAutoRenew ? 1 : 0,
          purchasedAt,
          selectedExpiresAt,
          selectedMetadataJson,
        ],
      );
      selectedAddonId = selectedResult.insertId;
    } else {
      await db.query(
        `
          UPDATE user_plan_addons
          SET
            quantity = 1,
            subscription_id = ?,
            auto_renew = ?,
            expires_at = ?,
            metadata = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          selectedSubscriptionId ?? null,
          selectedAutoRenew ? 1 : 0,
          selectedExpiresAt,
          selectedMetadataJson,
          addonId,
        ],
      );
    }

    if (afterQuantity > 0) {
      await db.query(
        `
          INSERT INTO user_plan_addons (
            user_id,
            subscription_id,
            addon_type,
            quantity,
            auto_renew,
            purchased_at,
            expires_at,
            metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          existing.user_id,
          existing.subscription_id ?? null,
          existing.addon_type,
          afterQuantity,
          typeof existing.auto_renew === "number" && existing.auto_renew === 1 ? 1 : 0,
          purchasedAt,
          existing.expires_at ?? null,
          unchangedMetadataJson,
        ],
      );
    }

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  const [rows] = await db.query<(UserPlanAddonRow & RowDataPacket)[]>(
    `SELECT * FROM user_plan_addons WHERE id = ? LIMIT 1`,
    [selectedAddonId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SubscriptionPlanError("Não foi possível carregar a vaga de add-on atualizada.", 500);
  }

  return mapAddonRow(rows[0]);
};

export const deleteUserPlanAddon = async (
  addonId: number,
  options: { expectedUserId?: number } = {},
): Promise<void> => {
  if (!Number.isFinite(addonId) || addonId <= 0) {
    throw new SubscriptionPlanError("Add-on inválido.");
  }

  await ensureUserPlanAddonTable();
  const db = getDb();

  const [rows] = await db.query<(Pick<UserPlanAddonRow, "user_id"> & RowDataPacket)[]>(
    `SELECT user_id FROM user_plan_addons WHERE id = ? LIMIT 1`,
    [addonId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SubscriptionPlanError("Add-on não encontrado.", 404);
  }

  const row = rows[0];
  if (
    options.expectedUserId !== undefined &&
    row.user_id !== options.expectedUserId
  ) {
    throw new SubscriptionPlanError("Add-on não encontrado.", 404);
  }

  const [result] = await db.query<ResultSetHeader>(
    `DELETE FROM user_plan_addons WHERE id = ?`,
    [addonId],
  );

  if (result.affectedRows === 0) {
    throw new SubscriptionPlanError("Add-on não encontrado.", 404);
  }
};
