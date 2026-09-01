import {
  UsefulLinkBannerRow,
  UsefulLinkRow,
  ensureUsefulLinkBannersTable,
  ensureUsefulLinksTable,
  getDb,
} from "lib/db";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveUploadedFile,
} from "lib/uploads";
import type { UsefulLink, UsefulLinkBanner } from "types/useful-links";

const mapLinkRow = (row: UsefulLinkRow): UsefulLink => ({
  id: row.id,
  title: row.title,
  description: row.description ?? null,
  url: row.url,
  buttonLabel: row.button_label,
  icon: row.icon ?? null,
  imagePath: row.image_path ?? null,
  imageUrl: row.image_path ? resolveUploadedFileUrl(row.image_path) : null,
  order: row.order_index ?? 0,
  isActive: row.is_active === 1,
  updatedAt: row.updated_at.toISOString(),
});

const mapBannerRow = (row: UsefulLinkBannerRow): UsefulLinkBanner => ({
  id: row.id,
  title: row.title,
  subtitle: row.subtitle ?? null,
  linkUrl: row.link_url ?? null,
  mediaPath: row.media_path,
  mediaUrl: resolveUploadedFileUrl(row.media_path),
  order: row.order_index ?? 0,
  isActive: row.is_active === 1,
  updatedAt: row.updated_at.toISOString(),
});

export const getAllUsefulLinks = async (): Promise<UsefulLink[]> => {
  await ensureUsefulLinksTable();
  const db = getDb();
  const [rows] = await db.query<UsefulLinkRow[]>(
    "SELECT * FROM useful_links ORDER BY order_index ASC, id ASC",
  );
  return rows.map(mapLinkRow);
};

export const getPublishedUsefulLinks = async (): Promise<UsefulLink[]> => {
  await ensureUsefulLinksTable();
  const db = getDb();
  const [rows] = await db.query<UsefulLinkRow[]>(
    "SELECT * FROM useful_links WHERE is_active = 1 ORDER BY order_index ASC, id ASC",
  );
  return rows.map(mapLinkRow);
};

export const getAllUsefulLinkBanners = async (): Promise<UsefulLinkBanner[]> => {
  await ensureUsefulLinkBannersTable();
  const db = getDb();
  const [rows] = await db.query<UsefulLinkBannerRow[]>(
    "SELECT * FROM useful_link_banners ORDER BY order_index ASC, id ASC",
  );
  return rows.map(mapBannerRow);
};

export const getPublishedUsefulLinkBanners = async (): Promise<UsefulLinkBanner[]> => {
  await ensureUsefulLinkBannersTable();
  const db = getDb();
  const [rows] = await db.query<UsefulLinkBannerRow[]>(
    "SELECT * FROM useful_link_banners WHERE is_active = 1 ORDER BY order_index ASC, id ASC",
  );
  return rows.map(mapBannerRow);
};

type UpsertUsefulLinkInput = {
  id?: number;
  title: string;
  description?: string | null;
  url: string;
  buttonLabel: string;
  icon?: string | null;
  order?: number;
  isActive?: boolean;
  file?: File | null;
  removeImage?: boolean;
};

export const upsertUsefulLink = async (input: UpsertUsefulLinkInput): Promise<UsefulLink> => {
  await ensureUsefulLinksTable();
  const db = getDb();

  const id = Number.isFinite(Number(input.id)) ? Number(input.id) : null;
  let existing: UsefulLinkRow | null = null;

  if (id) {
    const [rows] = await db.query<UsefulLinkRow[]>(
      "SELECT * FROM useful_links WHERE id = ? LIMIT 1",
      [id],
    );
    existing = rows.length > 0 ? rows[0] : null;
  }

  const sanitizedTitle = input.title.trim();
  const sanitizedUrl = input.url.trim();
  const sanitizedButtonLabel = input.buttonLabel.trim() || "Acessar";
  const sanitizedDescription = input.description?.trim() ?? null;
  const sanitizedIcon = input.icon?.trim() || null;
  const orderIndex = Number.isFinite(Number(input.order)) ? Number(input.order) : existing?.order_index ?? 0;
  const isActive = input.isActive ?? existing?.is_active === 1 ?? true;

  if (!sanitizedTitle) {
    throw new Error("Informe um título para o link útil.");
  }

  if (!sanitizedUrl) {
    throw new Error("Informe a URL que será aberta ao clicar no link.");
  }

  let imagePath = existing?.image_path ?? null;
  if (input.removeImage && imagePath) {
    await deleteUploadedFile(imagePath);
    imagePath = null;
  }

  if (input.file instanceof File && input.file.size > 0) {
    const storedPath = await saveUploadedFile(input.file, "useful-links/items", {
      convertToWebp: false,
    });
    if (imagePath && imagePath !== storedPath) {
      await deleteUploadedFile(imagePath);
    }
    imagePath = storedPath;
  }

  let recordId = existing?.id ?? null;

  if (existing) {
    await db.query(
      `
        UPDATE useful_links
        SET
          title = ?,
          description = ?,
          url = ?,
          button_label = ?,
          icon = ?,
          image_path = ?,
          order_index = ?,
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        sanitizedTitle,
        sanitizedDescription,
        sanitizedUrl,
        sanitizedButtonLabel,
        sanitizedIcon,
        imagePath,
        orderIndex,
        isActive ? 1 : 0,
        existing.id,
      ],
    );
    recordId = existing.id;
  } else {
    const [result] = await db.query<{ insertId: number } & Record<string, unknown>>(
      `
        INSERT INTO useful_links (
          title,
          description,
          url,
          button_label,
          icon,
          image_path,
          order_index,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sanitizedTitle,
        sanitizedDescription,
        sanitizedUrl,
        sanitizedButtonLabel,
        sanitizedIcon,
        imagePath,
        orderIndex,
        isActive ? 1 : 0,
      ],
    );
    recordId = Number(result.insertId);
  }

  const [rows] = await db.query<UsefulLinkRow[]>(
    "SELECT * FROM useful_links WHERE id = ? LIMIT 1",
    [recordId ?? existing?.id ?? input.id],
  );

  if (!rows.length) {
    throw new Error("Não foi possível carregar o link atualizado.");
  }

  return mapLinkRow(rows[0]);
};

export const deleteUsefulLink = async (id: number): Promise<void> => {
  await ensureUsefulLinksTable();
  const db = getDb();
  const [rows] = await db.query<UsefulLinkRow[]>(
    "SELECT * FROM useful_links WHERE id = ? LIMIT 1",
    [id],
  );
  const existing = rows.length ? rows[0] : null;
  if (!existing) {
    return;
  }

  if (existing.image_path) {
    await deleteUploadedFile(existing.image_path);
  }

  await db.query("DELETE FROM useful_links WHERE id = ?", [id]);
};

type UpsertUsefulLinkBannerInput = {
  id?: number;
  title: string;
  subtitle?: string | null;
  linkUrl?: string | null;
  order?: number;
  isActive?: boolean;
  file?: File | null;
};

export const upsertUsefulLinkBanner = async (
  input: UpsertUsefulLinkBannerInput,
): Promise<UsefulLinkBanner> => {
  await ensureUsefulLinkBannersTable();
  const db = getDb();

  const id = Number.isFinite(Number(input.id)) ? Number(input.id) : null;
  let existing: UsefulLinkBannerRow | null = null;

  if (id) {
    const [rows] = await db.query<UsefulLinkBannerRow[]>(
      "SELECT * FROM useful_link_banners WHERE id = ? LIMIT 1",
      [id],
    );
    existing = rows.length > 0 ? rows[0] : null;
  }

  const sanitizedTitle = input.title.trim();
  const sanitizedSubtitle = input.subtitle?.trim() ?? null;
  const sanitizedLinkUrl = input.linkUrl?.trim() || null;
  const orderIndex = Number.isFinite(Number(input.order)) ? Number(input.order) : existing?.order_index ?? 0;
  const isActive = input.isActive ?? existing?.is_active === 1 ?? true;

  if (!sanitizedTitle) {
    throw new Error("Informe um título para o banner.");
  }

  let mediaPath = existing?.media_path ?? null;

  if (input.file instanceof File && input.file.size > 0) {
    const storedPath = await saveUploadedFile(input.file, "useful-links/banners", {
      convertToWebp: false,
    });
    if (mediaPath && mediaPath !== storedPath) {
      await deleteUploadedFile(mediaPath);
    }
    mediaPath = storedPath;
  } else if (!mediaPath) {
    throw new Error("Envie a imagem ou GIF do banner.");
  }

  let recordId = existing?.id ?? null;

  if (existing) {
    await db.query(
      `
        UPDATE useful_link_banners
        SET
          title = ?,
          subtitle = ?,
          link_url = ?,
          media_path = ?,
          order_index = ?,
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        sanitizedTitle,
        sanitizedSubtitle,
        sanitizedLinkUrl,
        mediaPath,
        orderIndex,
        isActive ? 1 : 0,
        existing.id,
      ],
    );
    recordId = existing.id;
  } else {
    const [result] = await db.query<{ insertId: number } & Record<string, unknown>>(
      `
        INSERT INTO useful_link_banners (
          title,
          subtitle,
          link_url,
          media_path,
          order_index,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        sanitizedTitle,
        sanitizedSubtitle,
        sanitizedLinkUrl,
        mediaPath,
        orderIndex,
        isActive ? 1 : 0,
      ],
    );
    recordId = Number(result.insertId);
  }

  const [rows] = await db.query<UsefulLinkBannerRow[]>(
    "SELECT * FROM useful_link_banners WHERE id = ? LIMIT 1",
    [recordId ?? existing?.id ?? input.id],
  );

  if (!rows.length) {
    throw new Error("Não foi possível carregar o banner atualizado.");
  }

  return mapBannerRow(rows[0]);
};

export const deleteUsefulLinkBanner = async (id: number): Promise<void> => {
  await ensureUsefulLinkBannersTable();
  const db = getDb();
  const [rows] = await db.query<UsefulLinkBannerRow[]>(
    "SELECT * FROM useful_link_banners WHERE id = ? LIMIT 1",
    [id],
  );
  const existing = rows.length ? rows[0] : null;
  if (!existing) {
    return;
  }

  if (existing.media_path) {
    await deleteUploadedFile(existing.media_path);
  }

  await db.query("DELETE FROM useful_link_banners WHERE id = ?", [id]);
};

export const getUsefulLinksLastUpdatedAt = async (): Promise<Date | null> => {
  await Promise.all([ensureUsefulLinksTable(), ensureUsefulLinkBannersTable()]);
  const db = getDb();
  const [rows] = await db.query<Array<{ lastUpdated: Date | null }>>(
    `
      SELECT MAX(updated_at) AS lastUpdated
      FROM (
        SELECT updated_at FROM useful_links
        UNION ALL
        SELECT updated_at FROM useful_link_banners
      ) merged
    `,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const value = rows[0]?.lastUpdated;
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
};
