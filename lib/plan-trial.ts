import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureUserPlanSubscriptionTable, getDb, UserPlanSubscriptionRow } from "./db";
import { getPlanTrialSettings } from "./plan-trial-settings";
import type { PlanTrialActivationContext, PlanTrialActivationResult, PlanTrialSettings } from "types/plan-trial";
import { getSubscriptionPlanById } from "./plans";
import { getAdminSiteSettings } from "./admin-site";
import { PlanTrialSettingsError } from "./plan-trial-settings";

type TrialMetadata = {
  isTrial: boolean;
  duration: {
    amount: number;
    unit: PlanTrialSettings["duration"]["unit"];
    hours: number;
  };
  assignedAt: string;
  context: PlanTrialActivationContext;
  expiresAt: string;
};

const computeDurationHours = (settings: PlanTrialSettings): number => {
  const amount = Math.max(1, Math.floor(settings.duration.amount));
  return settings.duration.unit === "days" ? amount * 24 : amount;
};

const formatDurationLabel = (hours: number): string => {
  if (hours <= 0) {
    return "0 hora";
  }
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} dia${days === 1 ? "" : "s"}`;
  }
  return `${hours} hora${hours === 1 ? "" : "s"}`;
};

const formatDurationDays = (hours: number): string => {
  const days = hours / 24;
  if (Number.isInteger(days)) {
    return `${days}`;
  }
  return days.toFixed(1);
};

const applyTemplate = (template: string | null | undefined, replacements: Map<string, string>): string | null => {
  if (typeof template !== "string") {
    return null;
  }
  let output = template;
  replacements.forEach((value, token) => {
    output = output.split(token).join(value);
  });
  return output;
};

const applyTemplateList = (items: string[], replacements: Map<string, string>): string[] =>
  items
    .map((item) => applyTemplate(item, replacements))
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);

const upsertTrialSubscription = async (
  userId: number,
  planId: number,
  hours: number,
  metadata: TrialMetadata,
): Promise<{ expiresAt: Date }> => {
  await ensureUserPlanSubscriptionTable();
  const db = getDb();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const payload = JSON.stringify(metadata);

  const [existingRows] = await db.query<(UserPlanSubscriptionRow & RowDataPacket)[]>(
    `SELECT * FROM user_plan_subscriptions WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    const existing = existingRows[0];
    await db.query(
      `
        UPDATE user_plan_subscriptions
        SET
          plan_id = ?,
          auto_renew_plan = 0,
          status = 'active',
          current_period_start = ?,
          current_period_end = ?,
          cancelled_at = NULL,
          is_trial = 1,
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [planId, now, expiresAt, payload, existing.id],
    );
  } else {
    await db.query<ResultSetHeader>(
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
        ) VALUES (?, ?, 0, 'active', ?, ?, NULL, 1, ?)
      `,
      [userId, planId, now, expiresAt, payload],
    );
  }

  return { expiresAt };
};

const buildTemplateReplacements = async (
  userName: string,
  hours: number,
  expiresAt: Date,
): Promise<Map<string, string>> => {
  const site = await getAdminSiteSettings().catch(() => ({ siteName: "StoreBot" }));
  const fullName = userName.trim() || "Cliente";
  const firstName = fullName.split(/\s+/)[0] || fullName;
  const durationLabel = formatDurationLabel(hours);
  const expiresLabel = expiresAt.toLocaleString("pt-BR");

  return new Map<string, string>([
    ["{{nome}}", fullName],
    ["{{userName}}", fullName],
    ["{{primeiroNome}}", firstName],
    ["{{firstName}}", firstName],
    ["{{durationLabel}}", durationLabel],
    ["{{durationHours}}", `${hours}`],
    ["{{durationDays}}", formatDurationDays(hours)],
    ["{{dataFim}}", expiresLabel],
    ["{{endsAt}}", expiresLabel],
    ["{{siteName}}", site.siteName ?? "StoreBot"],
  ]);
};

const applySettingsTemplates = async (
  settings: PlanTrialSettings,
  userName: string,
  hours: number,
  expiresAt: Date,
): Promise<PlanTrialActivationResult> => {
  const replacements = await buildTemplateReplacements(userName, hours, expiresAt);

  const modalTitle = applyTemplate(settings.modal.title, replacements) ?? settings.modal.title;
  const modalMessage = applyTemplate(settings.modal.message, replacements) ?? settings.modal.message;
  const modalSteps = applyTemplateList(settings.modal.steps, replacements);

  const whatsappMessage = applyTemplate(settings.whatsapp.message, replacements) ?? settings.whatsapp.message;

  return {
    applied: true,
    expiresAt: expiresAt.toISOString(),
    durationHours: hours,
    durationLabel: formatDurationLabel(hours),
    modal: {
      title: modalTitle,
      message: modalMessage,
      steps: modalSteps,
      imageUrl: settings.modal.imageUrl ?? null,
    },
    whatsapp: {
      message: whatsappMessage,
      mediaUrl: settings.whatsapp.mediaUrl ?? null,
    },
  };
};

export const applyTrialForNewUser = async ({
  userId,
  userName,
  context,
}: {
  userId: number;
  userName: string;
  context: PlanTrialActivationContext;
}): Promise<PlanTrialActivationResult> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new PlanTrialSettingsError("Usuário inválido para aplicar o teste gratuito.");
  }

  const settings = await getPlanTrialSettings();
  if (!settings.enabled || !settings.planId) {
    return { applied: false, expiresAt: null, durationHours: null, durationLabel: null };
  }

  const plan = await getSubscriptionPlanById(settings.planId);
  if (!plan || !plan.isActive) {
    return { applied: false, expiresAt: null, durationHours: null, durationLabel: null };
  }

  const hours = computeDurationHours(settings);
  const metadata: TrialMetadata = {
    isTrial: true,
    duration: {
      amount: settings.duration.amount,
      unit: settings.duration.unit,
      hours,
    },
    assignedAt: new Date().toISOString(),
    context,
    expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
  };

  const { expiresAt } = await upsertTrialSubscription(userId, plan.id, hours, metadata);
  return applySettingsTemplates(settings, userName, hours, expiresAt);
};
