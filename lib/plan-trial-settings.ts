import { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensurePlanTrialSettingsTable, getDb } from "./db";
import { deleteUploadedFile, resolveUploadedFileUrl, saveUploadedFile } from "./uploads";
import { getAppBaseUrl } from "./meta";
import type { PlanTrialSettings, PlanTrialDurationUnit, PlanTrialTemplateVariable } from "types/plan-trial";

export class PlanTrialSettingsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PlanTrialSettingsError";
    this.status = status;
  }
}

const TABLE_ID = 1;

const DEFAULT_MODAL_STEPS: string[] = [
  "Conecte a sua instância do WhatsApp para liberar os comandos.",
  "Cadastre o primeiro grupo do robô e personalize as automações.",
  "Explore os menus de Bem-vindo, Autoresposta e Sorteios para encantar o seu público.",
];

const DEFAULT_SETTINGS: PlanTrialSettings = {
  enabled: false,
  planId: null,
  duration: {
    amount: 48,
    unit: "hours",
  },
  modal: {
    title: "🎉 Seu teste gratuito começou!",
    message:
      "Você tem {{durationLabel}} para explorar todos os recursos do Bot Admin sem custo.\nVamos dar os primeiros passos juntos ⬇️",
    steps: [...DEFAULT_MODAL_STEPS],
    imageUrl: null,
  },
  whatsapp: {
    message:
      "🎉 *Seu teste gratuito começou agora!*\n\nVocê tem {{durationLabel}} para testar o Bot Admin sem custo.\n\n1️⃣ Conecte sua instância do WhatsApp pelo painel.\n2️⃣ Cadastre seu grupo e ative as mensagens automáticas.\n3️⃣ Teste comandos como /menu, /bemvindo e /sorteio.\n\nSe precisar de ajuda, estamos por aqui! 🚀",
    mediaUrl: null,
  },
  updatedAt: null,
};

type StoredSettings = {
  enabled?: boolean;
  planId?: number | null;
  duration?: {
    amount?: number;
    unit?: PlanTrialDurationUnit;
  };
  modal?: {
    title?: string | null;
    message?: string | null;
    steps?: string[] | null;
    imagePath?: string | null;
  };
  whatsapp?: {
    message?: string | null;
    mediaPath?: string | null;
  };
  updatedAt?: string | null;
};

const TABLE_COLUMNS = {
  settings: "settings_json",
};

const sanitizeText = (value: unknown, maxLength: number, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const sanitizeOptionalText = (value: unknown, maxLength: number, fallback: string | null = null): string | null => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const sanitizeDurationUnit = (value: unknown): PlanTrialDurationUnit => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "days" ? "days" : "hours";
};

const sanitizeDurationAmount = (value: unknown): number => {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric <= 0) {
    throw new PlanTrialSettingsError("Informe um prazo válido para o teste gratuito (mínimo de 1).");
  }
  return Math.min(24 * 30, Math.floor(numeric));
};

const sanitizeSteps = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return [...DEFAULT_MODAL_STEPS];
  }
  const steps: string[] = [];
  values.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      return;
    }
    steps.push(trimmed.length > 260 ? trimmed.slice(0, 260) : trimmed);
  });
  return steps.length > 0 ? steps.slice(0, 5) : [...DEFAULT_MODAL_STEPS];
};

const loadStoredSettings = async (): Promise<{ stored: StoredSettings; rowExists: boolean }> => {
  await ensurePlanTrialSettingsTable();
  const db = getDb();
  const [rows] = await db.query<
    (RowDataPacket & {
      [TABLE_COLUMNS.settings]: string | null;
    })[]
  >(
    `SELECT ${TABLE_COLUMNS.settings} FROM plan_trial_settings WHERE id = ? LIMIT 1`,
    [TABLE_ID],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return { stored: {}, rowExists: false };
  }

  const raw = rows[0]?.[TABLE_COLUMNS.settings] ?? null;
  if (!raw) {
    return { stored: {}, rowExists: true };
  }

  try {
    const parsed = JSON.parse(raw) as StoredSettings;
    return { stored: parsed ?? {}, rowExists: true };
  } catch {
    return { stored: {}, rowExists: true };
  }
};

const serializeSettings = (value: StoredSettings): string => JSON.stringify(value ?? {});

const resolvePublicUrl = (relativePath: string | null): string | null => {
  if (!relativePath) {
    return null;
  }

  const normalized = relativePath.replace(/^\//, "");
  const assetUrl = resolveUploadedFileUrl(normalized);
  if (!assetUrl) {
    return null;
  }

  try {
    const baseUrl = getAppBaseUrl();
    return new URL(assetUrl, baseUrl).toString();
  } catch {
    return assetUrl;
  }
};

const mergeSettings = (stored: StoredSettings): PlanTrialSettings => {
  const defaults = { ...DEFAULT_SETTINGS };

  const enabled = Boolean(stored.enabled);
  const planId = typeof stored.planId === "number" && Number.isFinite(stored.planId) ? stored.planId : null;

  const amount = sanitizeDurationAmount(stored.duration?.amount ?? defaults.duration.amount);
  const unit = sanitizeDurationUnit(stored.duration?.unit ?? defaults.duration.unit);

  const modalTitle = sanitizeText(stored.modal?.title, 160, defaults.modal.title);
  const modalMessage = sanitizeText(stored.modal?.message, 2000, defaults.modal.message);
  const modalSteps = sanitizeSteps(stored.modal?.steps ?? defaults.modal.steps);

  const modalImagePath = sanitizeOptionalText(stored.modal?.imagePath, 255, null);
  const modalImageUrl = modalImagePath ? resolvePublicUrl(modalImagePath) : null;

  const whatsappMessage = sanitizeText(stored.whatsapp?.message, 2000, defaults.whatsapp.message);
  const whatsappMediaPath = sanitizeOptionalText(stored.whatsapp?.mediaPath, 255, null);
  const whatsappMediaUrl = whatsappMediaPath ? resolvePublicUrl(whatsappMediaPath) : null;

  return {
    enabled,
    planId,
    duration: { amount, unit },
    modal: {
      title: modalTitle,
      message: modalMessage,
      steps: modalSteps,
      imageUrl: modalImageUrl,
      imagePath: modalImagePath,
    },
    whatsapp: {
      message: whatsappMessage,
      mediaUrl: whatsappMediaUrl,
      mediaPath: whatsappMediaPath,
    },
    updatedAt: stored.updatedAt ?? null,
  };
};

export const PLAN_TRIAL_TEMPLATE_VARIABLES: PlanTrialTemplateVariable[] = [
  { token: "{{nome}}", description: "Nome completo do usuário." },
  { token: "{{userName}}", description: "Mesma informação de {{nome}}." },
  { token: "{{primeiroNome}}", description: "Primeiro nome do usuário." },
  { token: "{{firstName}}", description: "Mesma informação de {{primeiroNome}}." },
  { token: "{{durationLabel}}", description: "Duração do teste formatada (ex.: 48 horas ou 7 dias)." },
  { token: "{{durationHours}}", description: "Quantidade total em horas do teste gratuito." },
  { token: "{{durationDays}}", description: "Quantidade em dias (valor com casa decimal quando necessário)." },
  { token: "{{dataFim}}", description: "Data e hora de término do teste em formato local." },
  { token: "{{endsAt}}", description: "Mesma informação de {{dataFim}}." },
  { token: "{{siteName}}", description: "Nome configurado do site/plataforma." },
];

export const getPlanTrialSettings = async (): Promise<PlanTrialSettings> => {
  const { stored, rowExists } = await loadStoredSettings();

  if (!rowExists) {
    const defaults = mergeSettings({});
    const db = getDb();
    await db.query<ResultSetHeader>(
      `
        INSERT INTO plan_trial_settings (id, ${TABLE_COLUMNS.settings})
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE ${TABLE_COLUMNS.settings} = VALUES(${TABLE_COLUMNS.settings})
      `,
      [TABLE_ID, serializeSettings({})],
    );
    return defaults;
  }

  return mergeSettings(stored);
};

const toStoredSteps = (steps: string[]): string[] =>
  steps.filter((step) => typeof step === "string" && step.trim().length > 0).map((step) => step.trim());

const toStoredSettings = (settings: PlanTrialSettings): StoredSettings => ({
  enabled: settings.enabled,
  planId: settings.planId,
  duration: {
    amount: settings.duration.amount,
    unit: settings.duration.unit,
  },
  modal: {
    title: settings.modal.title,
    message: settings.modal.message,
    steps: toStoredSteps(settings.modal.steps),
    imagePath: settings.modal.imagePath ?? null,
  },
  whatsapp: {
    message: settings.whatsapp.message,
    mediaPath: settings.whatsapp.mediaPath ?? null,
  },
  updatedAt: settings.updatedAt,
});

const normalizeFile = (value: FormDataEntryValue | null): File | null => {
  if (!value || !(value instanceof File)) {
    return null;
  }
  return value.size > 0 ? value : null;
};

const isTruthyFlag = (value: FormDataEntryValue | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
};

export const savePlanTrialSettingsFromForm = async (formData: FormData): Promise<PlanTrialSettings> => {
  const { stored } = await loadStoredSettings();

  const enabled = isTruthyFlag(formData.get("enabled"));
  const planIdRaw = formData.get("planId");
  const planIdParsed = Number.parseInt(String(planIdRaw ?? ""), 10);
  const planId = Number.isFinite(planIdParsed) && planIdParsed > 0 ? planIdParsed : null;

  if (enabled && !planId) {
    throw new PlanTrialSettingsError("Selecione qual plano será associado ao teste gratuito.");
  }

  const durationAmount = sanitizeDurationAmount(formData.get("durationAmount") ?? stored.duration?.amount ?? DEFAULT_SETTINGS.duration.amount);
  const durationUnit = sanitizeDurationUnit(formData.get("durationUnit") ?? stored.duration?.unit ?? DEFAULT_SETTINGS.duration.unit);

  const modalTitle = sanitizeText(formData.get("modalTitle") ?? stored.modal?.title, 160, DEFAULT_SETTINGS.modal.title);
  const modalMessage = sanitizeText(formData.get("modalMessage") ?? stored.modal?.message, 2000, DEFAULT_SETTINGS.modal.message);
  const stepsRaw = [
    formData.get("modalStep1") ?? (stored.modal?.steps?.[0] ?? DEFAULT_MODAL_STEPS[0]),
    formData.get("modalStep2") ?? (stored.modal?.steps?.[1] ?? DEFAULT_MODAL_STEPS[1]),
    formData.get("modalStep3") ?? (stored.modal?.steps?.[2] ?? DEFAULT_MODAL_STEPS[2]),
  ];
  const modalSteps = sanitizeSteps(stepsRaw);

  const previousModalImage = stored.modal?.imagePath ?? null;
  const modalImageFile = normalizeFile(formData.get("modalImage"));
  const removeModalImage = isTruthyFlag(formData.get("removeModalImage"));

  let modalImagePath = previousModalImage;
  if (removeModalImage) {
    await deleteUploadedFile(previousModalImage ?? null);
    modalImagePath = null;
  }
  if (modalImageFile) {
    await deleteUploadedFile(previousModalImage ?? null);
    modalImagePath = await saveUploadedFile(modalImageFile, "admin/plan-trial/modal", {
      convertToWebp: true,
    });
  }

  const whatsappMessage = sanitizeText(
    formData.get("whatsappMessage") ?? stored.whatsapp?.message,
    2000,
    DEFAULT_SETTINGS.whatsapp.message,
  );
  const previousWhatsappMedia = stored.whatsapp?.mediaPath ?? null;
  const whatsappMediaFile = normalizeFile(formData.get("whatsappMedia"));
  const removeWhatsappMedia = isTruthyFlag(formData.get("removeWhatsappMedia"));

  let whatsappMediaPath = previousWhatsappMedia;
  if (removeWhatsappMedia) {
    await deleteUploadedFile(previousWhatsappMedia ?? null);
    whatsappMediaPath = null;
  }
  if (whatsappMediaFile) {
    await deleteUploadedFile(previousWhatsappMedia ?? null);
    whatsappMediaPath = await saveUploadedFile(whatsappMediaFile, "admin/plan-trial/whatsapp", {
      convertToWebp: true,
    });
  }

  const nextSettings: PlanTrialSettings = {
    enabled,
    planId,
    duration: {
      amount: durationAmount,
      unit: durationUnit,
    },
    modal: {
      title: modalTitle,
      message: modalMessage,
      steps: modalSteps,
      imageUrl: modalImagePath ? resolvePublicUrl(modalImagePath) : null,
      imagePath: modalImagePath,
    },
    whatsapp: {
      message: whatsappMessage,
      mediaUrl: whatsappMediaPath ? resolvePublicUrl(whatsappMediaPath) : null,
      mediaPath: whatsappMediaPath,
    },
    updatedAt: new Date().toISOString(),
  };

  const storedValue = toStoredSettings(nextSettings);
  const db = getDb();

  await db.query<ResultSetHeader>(
    `
      INSERT INTO plan_trial_settings (id, ${TABLE_COLUMNS.settings})
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE ${TABLE_COLUMNS.settings} = VALUES(${TABLE_COLUMNS.settings})
    `,
    [TABLE_ID, serializeSettings(storedValue)],
  );

  return nextSettings;
};
