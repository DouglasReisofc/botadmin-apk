import { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensurePlanGuardSettingsTable, getDb } from "./db";
import { resolveUploadedFileUrl, saveUploadedFile, deleteUploadedFile } from "./uploads";
import { getAppBaseUrl } from "lib/meta";
import type { PlanGuardSettings, PlanGuardTemplateType } from "types/plan-guard";

export class PlanGuardSettingsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PlanGuardSettingsError";
    this.status = status;
  }
}

const TABLE_ID = 1;

const TEMPLATE_TYPES: readonly PlanGuardTemplateType[] = ["plan", "instance", "group"];

const DEFAULT_CAPTIONS: Record<PlanGuardTemplateType, string> = {
  plan: [
    "⚠️ 𝑷𝑳𝑨𝑵𝑶 𝑷𝑨𝑼𝑺𝑨𝑫𝑶 ⚠️",
    "╭━━ 乂 𝑨𝑪𝑬𝑺𝑺𝑶 乂 ━━╮",
    "┃ 📦 {{nomePlano}}",
    "┃ ⏰ {{vencimento}}",
    "╰━━━━━━━━━━━━╯",
    "💎 𝑻𝒐𝒒𝒖𝒆 𝒆𝒎 𝑹𝒆𝒏𝒐𝒗𝒂𝒓 𝒆 𝒍𝒊𝒃𝒆𝒓𝒆 𝒐 𝒃𝒐𝒕.",
  ].join("\n"),
  instance: [
    "🔌 𝑰𝑵𝑺𝑻Â𝑵𝑪𝑰𝑨 𝑷𝑨𝑼𝑺𝑨𝑫𝑨 🔌",
    "╭━━ 乂 𝑺𝑬𝑺𝑺Ã𝑶 乂 ━━╮",
    "┃ 📱 {{nomeInstancia}}",
    "┃ ⏰ {{vencimento}}",
    "╰━━━━━━━━━━━━╯",
    "💎 𝑹𝒆𝒏𝒐𝒗𝒆 𝒑𝒂𝒓𝒂 𝒄𝒐𝒏𝒕𝒊𝒏𝒖𝒂𝒓.",
  ].join("\n"),
  group: [
    "⚠️ 𝑳𝑰𝑪𝑬𝑵Ç𝑨 𝑽𝑬𝑵𝑪𝑰𝑫𝑨 ⚠️",
    "╭━━ 乂 𝑮𝑹𝑼𝑷𝑶 乂 ━━╮",
    "┃ 📌 {{nomeGrupo}}",
    "┃ ⏰ {{vencimento}}",
    "╰━━━━━━━━━━━━╯",
    "💎 𝑻𝒐𝒒𝒖𝒆 𝒆𝒎 𝑹𝒆𝒏𝒐𝒗𝒂𝒓 𝒆 𝒈𝒆𝒓𝒆 𝒐 𝑷𝒊𝒙.",
  ].join("\n"),
};

const normalizeCaption = (value: string | null | undefined, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const ensureDefaultSiteUrl = (): string | null => {
  try {
    return getAppBaseUrl();
  } catch {
    return null;
  }
};

const normalizeSiteUrlInput = (raw: string | null | undefined): string | null => {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    throw new PlanGuardSettingsError("Informe uma URL válida iniciando com http ou https.");
  }
};

const buildDefaultSettings = (): PlanGuardSettings => ({
  siteUrl: ensureDefaultSiteUrl(),
  templates: {
    plan: { caption: DEFAULT_CAPTIONS.plan, imageUrl: null, imagePath: null },
    instance: { caption: DEFAULT_CAPTIONS.instance, imageUrl: null, imagePath: null },
    group: { caption: DEFAULT_CAPTIONS.group, imageUrl: null, imagePath: null },
  },
  updatedAt: null,
});

type StoredTemplate = {
  caption?: string | null;
  imagePath?: string | null;
};

type StoredSettings = {
  siteUrl?: string | null;
  templates?: Partial<Record<PlanGuardTemplateType, StoredTemplate>>;
  updatedAt?: string | null;
};

const loadStoredSettings = async (): Promise<{ stored: StoredSettings; rowExists: boolean }> => {
  await ensurePlanGuardSettingsTable();
  const db = getDb();
  const [rows] = await db.query<(RowDataPacket & { settings_json: string | null })[]>(
    "SELECT settings_json FROM plan_guard_settings WHERE id = ? LIMIT 1",
    [TABLE_ID],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return { stored: {}, rowExists: false };
  }

  const raw = rows[0]?.settings_json;
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

const serializeSettings = (settings: StoredSettings): string => JSON.stringify(settings);

const toPublicSettings = (stored: StoredSettings): PlanGuardSettings => {
  const defaults = buildDefaultSettings();
  const siteUrl = typeof stored.siteUrl === "string" && stored.siteUrl.trim().length > 0
    ? stored.siteUrl.trim()
    : defaults.siteUrl;

  const templates = { ...defaults.templates } as PlanGuardSettings["templates"];
  let baseUrl: string | null = null;
  try {
    baseUrl = getAppBaseUrl();
  } catch {
    baseUrl = null;
  }

  TEMPLATE_TYPES.forEach((type) => {
    const storedTemplate = stored.templates?.[type] ?? {};
    const caption = normalizeCaption(storedTemplate.caption, DEFAULT_CAPTIONS[type]);
    const imagePath = storedTemplate.imagePath ?? null;
    const resolved = imagePath ? resolveUploadedFileUrl(imagePath) : null;
    const absoluteUrl = resolved
      ? resolved.startsWith("http://") || resolved.startsWith("https://")
        ? resolved
        : baseUrl
          ? `${baseUrl.replace(/\/$/, "")}/${resolved.replace(/^\//, "")}`
          : resolved
      : null;
    templates[type] = {
      caption,
      imageUrl: absoluteUrl,
      imagePath,
    };
  });

  return {
    siteUrl: siteUrl ?? null,
    templates,
    updatedAt: stored.updatedAt ?? null,
  };
};

export const getPlanGuardSettings = async (): Promise<PlanGuardSettings> => {
  const { stored, rowExists } = await loadStoredSettings();

  if (!rowExists) {
    const defaults = buildDefaultSettings();
    const db = getDb();
    await db.query<ResultSetHeader>(
      `INSERT INTO plan_guard_settings (id, settings_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)` ,
      [TABLE_ID, serializeSettings({ siteUrl: defaults.siteUrl, templates: {}, updatedAt: null })],
    );
    return defaults;
  }

  const normalized = toPublicSettings(stored);
  return normalized;
};

const TEMPLATE_UPLOAD_ROOT = "admin/plan-guard";

const getFileFieldName = (type: PlanGuardTemplateType) => `image_${type}`;
const getCaptionFieldName = (type: PlanGuardTemplateType) => `caption_${type}`;
const getRemoveFieldName = (type: PlanGuardTemplateType) => `removeImage_${type}`;

export const PLAN_GUARD_TEMPLATE_VARIABLES: Array<{ token: string; description: string }> = [
  { token: "{{tipo}}", description: "Tipo do recurso (Plano, Instância ou Grupo)." },
  { token: "{{resourceType}}", description: "Mesma informação de {{tipo}}." },
  { token: "{{nome}}", description: "Nome do recurso afetado." },
  { token: "{{resourceName}}", description: "Mesma informação de {{nome}}." },
  { token: "{{origem}}", description: "Origem da cobertura (plano principal, grupo ou instância)." },
  { token: "{{coverageSource}}", description: "Mesma informação de {{origem}}." },
  { token: "{{nomePlano}}", description: "Nome do plano ativo." },
  { token: "{{planName}}", description: "Mesma informação de {{nomePlano}}." },
  { token: "{{nomeInstancia}}", description: "Nome da instância (quando aplicável)." },
  { token: "{{instanceName}}", description: "Mesma informação de {{nomeInstancia}}." },
  { token: "{{nomeGrupo}}", description: "Nome do grupo (quando aplicável)." },
  { token: "{{groupName}}", description: "Mesma informação de {{nomeGrupo}}." },
  { token: "{{vencimento}}", description: "Texto com o status de vencimento (ex.: venceu em 10/10/2024 12:00)." },
  { token: "{{dataVencimento}}", description: "Data/hora formatada do vencimento." },
  { token: "{{expiresAt}}", description: "Mesma informação de {{dataVencimento}}." },
  { token: "{{siteUrl}}", description: "URL configurada para direcionar o usuário." },
];

export const savePlanGuardSettingsFromForm = async (formData: FormData): Promise<PlanGuardSettings> => {
  const { stored } = await loadStoredSettings();

  const siteUrlRaw = formData.get("siteUrl");
  const siteUrl = normalizeSiteUrlInput(siteUrlRaw ? siteUrlRaw.toString() : stored.siteUrl ?? null);

  const nextTemplates: Record<PlanGuardTemplateType, StoredTemplate> = {} as Record<PlanGuardTemplateType, StoredTemplate>;
  const deletePaths: string[] = [];

  for (const type of TEMPLATE_TYPES) {
    const currentTemplate = stored.templates?.[type] ?? {};

    const captionField = getCaptionFieldName(type);
    const captionValue = formData.get(captionField);
    const normalizedCaption = normalizeCaption(
      captionValue ? captionValue.toString() : currentTemplate.caption ?? null,
      DEFAULT_CAPTIONS[type],
    );

    const removeField = getRemoveFieldName(type);
    const shouldRemove = (formData.get(removeField)?.toString() ?? "").toLowerCase() === "true";

    const fileField = getFileFieldName(type);
    const fileEntry = formData.get(fileField);
    const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

    let imagePath = currentTemplate.imagePath ?? null;

    if (file) {
      if (imagePath) {
        deletePaths.push(imagePath);
      }
      const storedPath = await saveUploadedFile(file, TEMPLATE_UPLOAD_ROOT, { convertToWebp: false });
      imagePath = storedPath;
    } else if (shouldRemove && imagePath) {
      deletePaths.push(imagePath);
      imagePath = null;
    }

    nextTemplates[type] = {
      caption: normalizedCaption,
      imagePath,
    };
  }

  if (deletePaths.length > 0) {
    await Promise.all(
      deletePaths.map((path) =>
        deleteUploadedFile(path).catch(() => {
          /* ignore */
        }),
      ),
    );
  }

  const payloadToStore: StoredSettings = {
    siteUrl,
    templates: nextTemplates,
    updatedAt: new Date().toISOString(),
  };

  const db = getDb();
  await db.query<ResultSetHeader>(
    `INSERT INTO plan_guard_settings (id, settings_json)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)`,
    [TABLE_ID, serializeSettings(payloadToStore)],
  );

  return toPublicSettings(payloadToStore);
};

export const getDefaultPlanGuardSettings = (): PlanGuardSettings => buildDefaultSettings();

export const getDefaultPlanGuardCaption = (type: PlanGuardTemplateType): string => DEFAULT_CAPTIONS[type];
