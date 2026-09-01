import { RowDataPacket } from "mysql2";
import { unstable_noStore as noStore } from "next/cache";

import type { SiteFooterLink, SiteSettings } from "types/site";

import {
  UserSiteSettingsRow,
  ensureSiteSettingsTable,
  getDb,
} from "./db";
import { deleteUploadedFile, resolveUploadedFileUrl, saveUploadedFile } from "./uploads";

export class SiteSettingsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SiteSettingsError";
    this.status = status;
  }
}

const DEFAULT_SITE_NAME = "Minha loja virtual";
const DEFAULT_SEO_TITLE = "Minha loja virtual";
const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const MAX_FAVICON_SIZE = 512 * 1024;
const MAX_SEO_IMAGE_SIZE = 3 * 1024 * 1024;
const MAX_FOOTER_LINKS = 5;
const MAX_KEYWORDS = 12;
const LOGO_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const FAVICON_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
]);
const SEO_IMAGE_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const sanitizeText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.slice(0, maxLength);
};

const sanitizeOptionalText = (value: unknown, maxLength: number): string | null => {
  const sanitized = sanitizeText(value, maxLength);
  return sanitized ? sanitized : null;
};

const parseSeoKeywords = (input: unknown): string[] => {
  const rawList: string[] = [];

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === "string") {
        rawList.push(entry);
      }
    }
  } else if (typeof input === "string") {
    rawList.push(...input.split(/[,\n]/));
  }

  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const keyword of rawList) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    keywords.push(normalized.slice(0, 40));

    if (keywords.length >= MAX_KEYWORDS) {
      break;
    }
  }

  return keywords;
};

const parseFooterLinks = (input: unknown): SiteFooterLink[] => {
  let rawValue: unknown = input;

  if (typeof input === "string" && input.trim()) {
    try {
      rawValue = JSON.parse(input);
    } catch {
      rawValue = [];
    }
  }

  if (!Array.isArray(rawValue)) {
    return [];
  }

  const links: SiteFooterLink[] = [];

  for (const entry of rawValue) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const label = sanitizeText((entry as Record<string, unknown>).label, 60);
    const url = sanitizeText((entry as Record<string, unknown>).url, 300);

    if (!label || !url) {
      continue;
    }

    if (!/^https?:\/\//i.test(url)) {
      continue;
    }

    links.push({ label, url });

    if (links.length >= MAX_FOOTER_LINKS) {
      break;
    }
  }

  return links;
};

const mapRowToSettings = (row: UserSiteSettingsRow | null): SiteSettings => {
  if (!row) {
    return {
      siteName: DEFAULT_SITE_NAME,
      tagline: null,
      logoUrl: null,
      faviconUrl: null,
      seoTitle: DEFAULT_SEO_TITLE,
      seoDescription: null,
      seoImageUrl: null,
      seoKeywords: [],
      footerText: null,
      footerLinks: [],
      updatedAt: null,
    };
  }

  const keywords = row.seo_keywords
    ? row.seo_keywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
    : [];

  return {
    siteName: row.site_name || DEFAULT_SITE_NAME,
    tagline: row.tagline ?? null,
    logoUrl: row.logo_path ? resolveUploadedFileUrl(row.logo_path) : null,
    faviconUrl: row.favicon_path ? resolveUploadedFileUrl(row.favicon_path) : null,
    seoTitle: row.seo_title ?? null,
    seoDescription: row.seo_description ?? null,
    seoImageUrl: row.seo_image_path ? resolveUploadedFileUrl(row.seo_image_path) : null,
    seoKeywords: keywords,
    footerText: row.footer_text ?? null,
    footerLinks: row.footer_links
      ? (() => {
          try {
            const parsed = JSON.parse(row.footer_links) as SiteFooterLink[];
            if (!Array.isArray(parsed)) {
              return [];
            }

            return parsed
              .filter(
                (link): link is SiteFooterLink =>
                  typeof link === "object" &&
                  link !== null &&
                  typeof link.label === "string" &&
                  typeof link.url === "string",
              )
              .map((link) => ({
                label: sanitizeText(link.label, 60),
                url: sanitizeText(link.url, 300),
              }));
          } catch {
            return [];
          }
        })()
      : [],
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
};

export const getSiteSettingsForUser = async (userId: number): Promise<SiteSettings> => {
  noStore();
  await ensureSiteSettingsTable();

  const db = getDb();
  const [rows] = await db.query<(UserSiteSettingsRow & RowDataPacket)[]>(
    "SELECT * FROM user_site_settings WHERE user_id = ? LIMIT 1",
    [userId],
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapRowToSettings(row);
};

const validateImageFile = (
  file: File,
  maxSize: number,
  allowed: Set<string>,
  sizeLabel: string,
) => {
  if (!(file instanceof File)) {
    throw new SiteSettingsError("Arquivo de imagem inválido.", 400);
  }

  if (file.size === 0) {
    throw new SiteSettingsError("O arquivo enviado está vazio.");
  }

  if (file.size > maxSize) {
    throw new SiteSettingsError(
      `A imagem selecionada excede o tamanho máximo permitido (${sizeLabel}).`,
    );
  }

  if (!allowed.has(file.type)) {
    throw new SiteSettingsError("Formato de imagem não suportado.");
  }
};

export const saveSiteSettingsFromForm = async (
  userId: number,
  formData: FormData,
): Promise<SiteSettings> => {
  await ensureSiteSettingsTable();

  const db = getDb();
  const [rows] = await db.query<(UserSiteSettingsRow & RowDataPacket)[]>(
    "SELECT * FROM user_site_settings WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  const siteName = sanitizeText(formData.get("siteName"), 120);
  if (!siteName) {
    throw new SiteSettingsError("Informe o nome do site.");
  }

  const tagline = sanitizeOptionalText(formData.get("tagline"), 160);
  const seoTitle = sanitizeOptionalText(formData.get("seoTitle"), 120);
  const seoDescription = sanitizeOptionalText(formData.get("seoDescription"), 320);
  const footerText = sanitizeOptionalText(formData.get("footerText"), 600);
  const keywords = parseSeoKeywords(formData.get("seoKeywords"));
  const footerLinks = parseFooterLinks(formData.get("footerLinks"));

  const removeLogo = String(formData.get("removeLogo")).toLowerCase() === "true";
  const removeFavicon = String(formData.get("removeFavicon")).toLowerCase() === "true";
  const removeSeoImage = String(formData.get("removeSeoImage")).toLowerCase() === "true";

  const logoFile = formData.get("logo");
  const faviconFile = formData.get("favicon");
  const seoImageFile = formData.get("seoImage");

  let nextLogoPath = existing?.logo_path ?? null;
  let nextFaviconPath = existing?.favicon_path ?? null;
  let nextSeoImagePath = existing?.seo_image_path ?? null;
  let logoToDelete: string | null = null;
  let faviconToDelete: string | null = null;
  let seoImageToDelete: string | null = null;

  if (removeLogo && nextLogoPath) {
    logoToDelete = nextLogoPath;
    nextLogoPath = null;
  }

  if (removeFavicon && nextFaviconPath) {
    faviconToDelete = nextFaviconPath;
    nextFaviconPath = null;
  }

  if (removeSeoImage && nextSeoImagePath) {
    seoImageToDelete = nextSeoImagePath;
    nextSeoImagePath = null;
  }

  if (logoFile instanceof File && logoFile.size > 0) {
    validateImageFile(logoFile, MAX_LOGO_SIZE, LOGO_ALLOWED_MIME, "5 MB");
    const stored = await saveUploadedFile(logoFile, "site/logos");
    if (!removeLogo && existing?.logo_path) {
      logoToDelete = existing.logo_path;
    }
    nextLogoPath = stored;
  }

  if (faviconFile instanceof File && faviconFile.size > 0) {
    validateImageFile(faviconFile, MAX_FAVICON_SIZE, FAVICON_ALLOWED_MIME, "512 KB");
    if (faviconFile.type === "image/svg+xml") {
      throw new SiteSettingsError("Use arquivos PNG, JPG ou ICO para o favicon.");
    }
    const stored = await saveUploadedFile(faviconFile, "site/favicons");
    if (!removeFavicon && existing?.favicon_path) {
      faviconToDelete = existing.favicon_path;
    }
    nextFaviconPath = stored;
  }

  if (seoImageFile instanceof File && seoImageFile.size > 0) {
    validateImageFile(seoImageFile, MAX_SEO_IMAGE_SIZE, SEO_IMAGE_ALLOWED_MIME, "3 MB");
    const stored = await saveUploadedFile(seoImageFile, "site/seo");
    if (!removeSeoImage && existing?.seo_image_path) {
      seoImageToDelete = existing.seo_image_path;
    }
    nextSeoImagePath = stored;
  }

  const keywordsValue = keywords.join(",");
  const footerLinksValue = footerLinks.length > 0 ? JSON.stringify(footerLinks) : null;

  await db.query(
    `
      INSERT INTO user_site_settings (
        user_id,
        site_name,
        tagline,
        logo_path,
        favicon_path,
        seo_image_path,
        seo_title,
        seo_description,
        seo_keywords,
        footer_text,
        footer_links
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        site_name = VALUES(site_name),
        tagline = VALUES(tagline),
        logo_path = VALUES(logo_path),
        favicon_path = VALUES(favicon_path),
        seo_image_path = VALUES(seo_image_path),
        seo_title = VALUES(seo_title),
        seo_description = VALUES(seo_description),
        seo_keywords = VALUES(seo_keywords),
        footer_text = VALUES(footer_text),
        footer_links = VALUES(footer_links)
    `,
    [
      userId,
      siteName,
      tagline,
      nextLogoPath,
      nextFaviconPath,
      nextSeoImagePath,
      seoTitle,
      seoDescription,
      keywordsValue || null,
      footerText,
      footerLinksValue,
    ],
  );

  await Promise.all([
    logoToDelete ? deleteUploadedFile(logoToDelete) : Promise.resolve(),
    faviconToDelete ? deleteUploadedFile(faviconToDelete) : Promise.resolve(),
    seoImageToDelete ? deleteUploadedFile(seoImageToDelete) : Promise.resolve(),
  ]);

  return getSiteSettingsForUser(userId);
};
