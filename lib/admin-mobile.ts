import { randomUUID } from "crypto";
import { RowDataPacket } from "mysql2";

import type {
  AdminMobileOnboardingSlide,
  AdminMobileSettings,
} from "types/admin-mobile";

import { ensureAdminMobileSettingsTable, getDb } from "./db";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveUploadedFile,
} from "./uploads";

export class AdminMobileSettingsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminMobileSettingsError";
    this.status = status;
  }
}

const sanitizeText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const sanitizeOptionalText = (value: unknown, max: number): string | null => {
  const v = sanitizeText(value, max);
  return v ? v : null;
};

const sanitizeRequiredText = (
  value: unknown,
  max: number,
  label: string,
): string => {
  const v = sanitizeText(value, max);
  if (!v) throw new AdminMobileSettingsError(`Informe ${label}.`);
  return v;
};

const sanitizePackage = (value: unknown): string => {
  const v = sanitizeRequiredText(value, 160, "o nome do pacote");
  const ok = /^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(v);
  if (!ok) {
    throw new AdminMobileSettingsError(
      "Pacote inválido. Use formato como com.exemplo.app.",
    );
  }
  return v;
};

const sanitizeVersionCode = (value: unknown): number => {
  const num = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(num) || num <= 0) {
    throw new AdminMobileSettingsError(
      "Version code deve ser um número inteiro positivo.",
    );
  }
  return num;
};

const sanitizeVersionName = (value: unknown): string => {
  return sanitizeRequiredText(value, 40, "a versão (ex.: 1.0.0)");
};

const sanitizeServerUrl = (value: unknown): string | null => {
  const v = sanitizeOptionalText(value, 300);
  if (!v) return null;
  try {
    const u = new URL(v);
    if (!/^https?:$/i.test(u.protocol)) throw new Error("invalid");
    return v;
  } catch {
    throw new AdminMobileSettingsError(
      "URL do servidor inválida. Use http(s)://...",
    );
  }
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "1" || trimmed === "true" || trimmed === "on";
  }
  return false;
};

type AdminMobileSettingsRow = RowDataPacket & {
  app_name: string;
  package_name: string;
  version_code: number;
  version_name: string;
  server_url: string | null;
  updated_at: Date | null;
  min_version_code: number | null;
  release_notes: string | null;
  onboarding_enabled: number | null;
  onboarding_slides: string | null;
  onboarding_revision: string | null;
};

type StoredSlide = {
  id: string;
  title: string;
  description: string;
  buttonLabel: string | null;
  image: string | null;
};

type IncomingSlidePayload = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  buttonLabel?: unknown;
  imageStoragePath?: unknown;
  removeImage?: unknown;
};

const normalizeSlidesJson = (raw: string | null): string => {
  if (!raw) return "[]";
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(Array.isArray(parsed) ? parsed : []);
  } catch {
    return "[]";
  }
};

const parseStoredSlides = (raw: string | null): StoredSlide[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const id = sanitizeText(record.id, 80) || randomUUID();
        const title = sanitizeText(record.title, 120);
        const description = sanitizeText(record.description, 400);
        if (!title || !description) return null;
        const buttonLabel = sanitizeOptionalText(record.buttonLabel, 40);
        const image =
          typeof record.image === "string" && record.image.trim()
            ? record.image.trim()
            : null;
        return { id, title, description, buttonLabel, image };
      })
      .filter((value): value is StoredSlide => value !== null);
  } catch (error) {
    console.error("Failed to parse onboarding slides", error);
    return [];
  }
};

const toResponseSlides = (
  slides: StoredSlide[],
): AdminMobileOnboardingSlide[] => {
  return slides.map((slide) => ({
    id: slide.id,
    title: slide.title,
    description: slide.description,
    buttonLabel: slide.buttonLabel ?? null,
    imageUrl: slide.image ? resolveUploadedFileUrl(slide.image) : null,
    imageStoragePath: slide.image ?? null,
  }));
};

const fetchSettingsRow = async (): Promise<AdminMobileSettingsRow | null> => {
  await ensureAdminMobileSettingsTable();
  const db = getDb();
  const [rows] = await db.query<AdminMobileSettingsRow[]>(
    `SELECT * FROM admin_mobile_settings WHERE id = 1 LIMIT 1`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

export const getAdminMobileSettings = async (): Promise<AdminMobileSettings> => {
  const row = await fetchSettingsRow();

  const fallbackServerUrl =
    (process.env.NEXT_PUBLIC_CAP_SERVER_URL?.trim() ||
      process.env.APP_URL?.trim() ||
      "") || null;

  const storedSlides = parseStoredSlides(row?.onboarding_slides ?? null);

  return {
    appName: row?.app_name ?? "Bot Admin",
    packageName: row?.package_name ?? "com.botadmin.shop",
    versionCode: row?.version_code ?? 1,
    versionName: row?.version_name ?? "1.0",
    serverUrl: row?.server_url ?? fallbackServerUrl,
    updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
    minVersionCode: row?.min_version_code ?? null,
    releaseNotes: row?.release_notes ?? null,
    onboardingEnabled: !!(row?.onboarding_enabled ?? 0),
    onboardingSlides: toResponseSlides(storedSlides),
    onboardingRevision: row?.onboarding_revision ?? null,
  };
};

const SLIDE_LIMIT = 5;

const sanitizeStoredPath = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("uploads/")) {
    return null;
  }
  return trimmed;
};

const processOnboardingSlides = async (
  form: FormData,
  existingSlides: StoredSlide[],
): Promise<{
  storedSlides: StoredSlide[];
  normalizedJson: string;
  removedPaths: string[];
}> => {
  const payloadRaw = form.get("onboardingSlides");
  if (typeof payloadRaw !== "string" || !payloadRaw.trim()) {
    const normalizedExisting = JSON.stringify(existingSlides);
    return {
      storedSlides: existingSlides,
      normalizedJson: normalizedExisting,
      removedPaths: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadRaw);
  } catch {
    throw new AdminMobileSettingsError(
      "Configuração dos slides inválida. Recarregue a página e tente novamente.",
    );
  }

  if (!Array.isArray(parsed)) {
    throw new AdminMobileSettingsError(
      "A lista de slides informada é inválida.",
    );
  }

  const existingById = new Map(existingSlides.map((slide) => [slide.id, slide]));
  const sanitizedSlides: StoredSlide[] = [];
  const removedPaths: string[] = [];

  for (let index = 0; index < parsed.length && sanitizedSlides.length < SLIDE_LIMIT; index += 1) {
    const rawSlide = parsed[index] as IncomingSlidePayload;
    if (!rawSlide || typeof rawSlide !== "object") {
      continue;
    }

    const requestedId = sanitizeText(rawSlide.id, 80);
    const id = requestedId || randomUUID();
    const existing = existingById.get(id) ?? null;

    const title = sanitizeRequiredText(
      rawSlide.title,
      120,
      `o título do slide ${index + 1}`,
    );
    const description = sanitizeRequiredText(
      rawSlide.description,
      400,
      `a descrição do slide ${index + 1}`,
    );
    const buttonLabel = sanitizeOptionalText(rawSlide.buttonLabel, 40);

    const removeImageRequested =
      toBoolean(rawSlide.removeImage) ||
      toBoolean(form.get(`onboardingSlideRemoveImage[${index}]`));

    let imagePath =
      sanitizeStoredPath(rawSlide.imageStoragePath) ?? existing?.image ?? null;

    const fileCandidate = form.get(`onboardingSlideImage[${index}]`);
    if (fileCandidate instanceof File && fileCandidate.size > 0) {
      const stored = await saveUploadedFile(
        fileCandidate,
        "admin/mobile/onboarding",
        { convertToWebp: true },
      );
      if (imagePath && imagePath !== stored) {
        removedPaths.push(imagePath);
      }
      imagePath = stored;
    } else if (removeImageRequested && imagePath) {
      removedPaths.push(imagePath);
      imagePath = null;
    }

    sanitizedSlides.push({
      id,
      title,
      description,
      buttonLabel,
      image: imagePath,
    });
  }

  // Delete images from removed slides
  const nextIds = new Set(sanitizedSlides.map((slide) => slide.id));
  for (const slide of existingSlides) {
    if (!nextIds.has(slide.id) && slide.image) {
      removedPaths.push(slide.image);
    }
  }

  const normalizedJson = JSON.stringify(sanitizedSlides);

  return {
    storedSlides: sanitizedSlides,
    normalizedJson,
    removedPaths,
  };
};

export const saveAdminMobileSettingsFromForm = async (
  form: FormData,
): Promise<AdminMobileSettings> => {
  await ensureAdminMobileSettingsTable();

  const rowBeforeUpdate = await fetchSettingsRow();
  const existingSlides = parseStoredSlides(rowBeforeUpdate?.onboarding_slides ?? null);
  const existingSlidesJson = normalizeSlidesJson(rowBeforeUpdate?.onboarding_slides ?? null);

  const appName = sanitizeRequiredText(form.get("appName"), 120, "o nome do app");
  const packageName = sanitizePackage(form.get("packageName"));
  const versionCode = sanitizeVersionCode(form.get("versionCode"));
  const versionName = sanitizeVersionName(form.get("versionName"));
  const serverUrl = sanitizeServerUrl(form.get("serverUrl"));

  const minVersionCodeRaw = form.get("minVersionCode");
  const minVersionCode =
    minVersionCodeRaw != null && String(minVersionCodeRaw).trim() !== ""
      ? sanitizeVersionCode(minVersionCodeRaw)
      : null;

  const releaseNotes = sanitizeOptionalText(form.get("releaseNotes"), 4000);
  const onboardingEnabled = toBoolean(form.get("onboardingEnabled"));

  const { normalizedJson, removedPaths } = await processOnboardingSlides(
    form,
    existingSlides,
  );

  const slidesChanged = normalizedJson !== existingSlidesJson;
  const enabledChanged =
    onboardingEnabled !== !!(rowBeforeUpdate?.onboarding_enabled ?? 0);

  const onboardingRevision =
    slidesChanged || enabledChanged
      ? randomUUID()
      : rowBeforeUpdate?.onboarding_revision ?? null;

  for (const path of removedPaths) {
    try {
      await deleteUploadedFile(path);
    } catch (error) {
      console.warn(
        "[admin-mobile] Falha ao remover imagem de slide obsoleta:",
        error,
      );
    }
  }

  const db = getDb();
  await db.query(
    `UPDATE admin_mobile_settings
     SET
       app_name = ?,
       package_name = ?,
       version_code = ?,
       version_name = ?,
       server_url = ?,
       min_version_code = ?,
       release_notes = ?,
       onboarding_enabled = ?,
       onboarding_slides = ?,
       onboarding_revision = ?
     WHERE id = 1`,
    [
      appName,
      packageName,
      versionCode,
      versionName,
      serverUrl,
      minVersionCode,
      releaseNotes,
      onboardingEnabled ? 1 : 0,
      normalizedJson,
      onboardingRevision,
    ],
  );

  return getAdminMobileSettings();
};
