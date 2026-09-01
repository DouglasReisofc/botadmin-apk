import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureUserTable, getDb } from "lib/db";
import {
  extractShopeeItemId,
  generateShopeeShortLink,
  searchShopeeAffiliate,
  type ShopeeAffiliateProduct,
} from "lib/apis/shopee-affiliate";

type AffiliateShopeeLinkRow = RowDataPacket & {
  id: number;
  user_id: number;
  provider: string;
  item_id: string;
  affiliate_url: string;
  category_id: string | null;
  note: string | null;
  coupon_code: string | null;
  coupon_details: string | null;
  title: string | null;
  product_url: string | null;
  image_url: string | null;
  price_amount: number | string | null;
  price_formatted: string | null;
  currency_id: string | null;
  commission_rate: string | null;
  rating_star: string | null;
  is_available: number | boolean | null;
  is_active: number | boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_used_at: Date | string | null;
};

export type AffiliateShopeeLinkSummary = {
  id: number;
  itemId: string;
  affiliateUrl: string;
  trackedUrl: string | null;
  trackingToken: string | null;
  categoryId: string | null;
  note: string | null;
  couponCode: string | null;
  couponDetails: string | null;
  title: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  priceAmount: number | null;
  priceFormatted: string | null;
  currencyId: string | null;
  commissionRate: string | null;
  ratingStar: string | null;
  available: boolean | null;
  isActive: boolean;
  clickCount: number;
  lastClickAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

const TABLE_NAME = "affiliate_product_links";
const PROVIDER_KEY = "shopee";
const LIST_DEFAULT_LIMIT = 2000;
const LIST_MAX_LIMIT = 5000;
const MAX_BATCH_IMPORT_ENTRIES = 5000;

const ensureTasks = new Map<string, Promise<void>>();
const ensureDone = new Set<string>();

const runEnsure = (key: string, ensureFn: () => Promise<void>): Promise<void> => {
  if (ensureDone.has(key)) return Promise.resolve();
  const active = ensureTasks.get(key);
  if (active) return active;
  const task = ensureFn()
    .then(() => {
      ensureDone.add(key);
      ensureTasks.delete(key);
    })
    .catch((error) => {
      ensureTasks.delete(key);
      throw error;
    });
  ensureTasks.set(key, task);
  return task;
};

const parseIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const parseNumber = (value: number | string | null | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseBoolean = (value: number | boolean | null | undefined): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
};

const parseIsActive = (value: number | boolean | null | undefined): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return true;
};

const normalizeItemId = (value: string): string => {
  return String(value || "")
    .trim()
    .replace(/[^\d]/g, "");
};

const normalizeCategoryId = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[^\d]/g, "");
  return normalized || null;
};

const normalizeUrl = (value: string): string | null => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

const toNullableTinyInt = (value: boolean | null): number | null => {
  if (value === null) return null;
  return value ? 1 : 0;
};

const mapLinkRow = (row: AffiliateShopeeLinkRow): AffiliateShopeeLinkSummary => ({
  id: Number(row.id),
  itemId: String(row.item_id),
  affiliateUrl: String(row.affiliate_url),
  trackedUrl: null,
  trackingToken: null,
  categoryId: normalizeCategoryId(row.category_id),
  note: row.note ?? null,
  couponCode: row.coupon_code ?? null,
  couponDetails: row.coupon_details ?? null,
  title: row.title ?? null,
  productUrl: row.product_url ?? null,
  imageUrl: row.image_url ?? null,
  priceAmount: parseNumber(row.price_amount),
  priceFormatted: row.price_formatted ?? null,
  currencyId: row.currency_id ?? null,
  commissionRate: row.commission_rate ?? null,
  ratingStar: row.rating_star ?? null,
  available: parseBoolean(row.is_available),
  isActive: parseIsActive(row.is_active),
  clickCount: 0,
  lastClickAt: null,
  createdAt: parseIso(row.created_at) ?? new Date().toISOString(),
  updatedAt: parseIso(row.updated_at) ?? new Date().toISOString(),
  lastUsedAt: parseIso(row.last_used_at),
});

const ensureAffiliateShopeeLinkTable = async () =>
  runEnsure("affiliate-shopee-links-table", async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'shopee',
        item_id VARCHAR(64) NOT NULL,
        affiliate_url VARCHAR(1024) NOT NULL,
        category_id VARCHAR(64) NULL,
        note VARCHAR(255) NULL,
        coupon_code VARCHAR(64) NULL,
        coupon_details VARCHAR(255) NULL,
        title VARCHAR(255) NULL,
        product_url VARCHAR(1024) NULL,
        image_url VARCHAR(1024) NULL,
        price_amount DECIMAL(12,2) NULL,
        price_formatted VARCHAR(64) NULL,
        currency_id VARCHAR(16) NULL,
        commission_rate VARCHAR(64) NULL,
        rating_star VARCHAR(32) NULL,
        is_available TINYINT(1) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_used_at DATETIME NULL,
        UNIQUE KEY uq_affiliate_product_link (user_id, provider, item_id),
        KEY idx_affiliate_product_user_provider (user_id, provider),
        CONSTRAINT fk_affiliate_product_link_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [existing] = await db.query<RowDataPacket[]>(
        `SHOW COLUMNS FROM ${TABLE_NAME} LIKE ?`,
        [column],
      );
      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE ${TABLE_NAME} ADD COLUMN ${definition};`);
      }
    };

    await ensureColumn("product_url", "product_url VARCHAR(1024) NULL");
    await ensureColumn("image_url", "image_url VARCHAR(1024) NULL");
    await ensureColumn("category_id", "category_id VARCHAR(64) NULL");
    await ensureColumn("price_amount", "price_amount DECIMAL(12,2) NULL");
    await ensureColumn("price_formatted", "price_formatted VARCHAR(64) NULL");
    await ensureColumn("currency_id", "currency_id VARCHAR(16) NULL");
    await ensureColumn("coupon_code", "coupon_code VARCHAR(64) NULL");
    await ensureColumn("coupon_details", "coupon_details VARCHAR(255) NULL");
    await ensureColumn("commission_rate", "commission_rate VARCHAR(64) NULL");
    await ensureColumn("rating_star", "rating_star VARCHAR(32) NULL");
    await ensureColumn("is_available", "is_available TINYINT(1) NULL");
    await ensureColumn("is_active", "is_active TINYINT(1) NOT NULL DEFAULT 1");
  });

const resolveProductFromLink = async (
  userId: number,
  affiliateUrl: string,
): Promise<{
  itemId: string;
  affiliateUrl: string;
  categoryId: string | null;
  title: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  priceAmount: number | null;
  priceFormatted: string | null;
  currencyId: string | null;
  commissionRate: string | null;
  ratingStar: string | null;
  available: boolean | null;
}> => {
  const sourceHasDirectItem = Boolean(extractShopeeItemId(affiliateUrl));
  const searchResult = await searchShopeeAffiliate(affiliateUrl, { userId, limit: 1 });
  const products = Array.isArray(searchResult.produtos) ? searchResult.produtos : [];
  const product = (products[0] ?? null) as ShopeeAffiliateProduct | null;
  const rawId = product?.id ? String(product.id) : String(searchResult.consulta?.itemId || "");
  const itemId = normalizeItemId(rawId);
  if (!itemId) {
    throw new Error(
      "Não foi possível identificar o item desse link de afiliado. Use o link direto do anúncio no Shopee.",
    );
  }

  let canonicalAffiliateUrl = affiliateUrl;
  if (!sourceHasDirectItem && typeof product?.url === "string" && product.url.trim()) {
    try {
      const generated = await generateShopeeShortLink(product.url, [], { userId });
      if (generated) {
        canonicalAffiliateUrl = generated;
      }
    } catch {
      // mantém a URL de origem quando não for possível gerar o short link canônico
    }
  }

  return {
    itemId,
    affiliateUrl: canonicalAffiliateUrl,
    categoryId: normalizeCategoryId(product?.categoriaId),
    title: product?.titulo ?? null,
    productUrl: product?.url ?? null,
    imageUrl: product?.imagem ?? null,
    priceAmount:
      typeof product?.preco === "number" && Number.isFinite(product.preco) ? product.preco : null,
    priceFormatted: product?.precoFormatado ?? null,
    currencyId: product?.moeda ?? null,
    commissionRate:
      typeof product?.shopee?.commissionRate === "string" && product.shopee.commissionRate.trim()
        ? product.shopee.commissionRate.trim().slice(0, 64)
        : null,
    ratingStar:
      typeof product?.shopee?.ratingStar === "string" && product.shopee.ratingStar.trim()
        ? product.shopee.ratingStar.trim().slice(0, 32)
        : null,
    available: typeof product?.disponivel === "boolean" ? product.disponivel : null,
  };
};

const dedupeAffiliateUrlRows = async (db: ReturnType<typeof getDb>, userId: number): Promise<void> => {
  await db.query(
    `
      DELETE older
      FROM ${TABLE_NAME} older
      INNER JOIN ${TABLE_NAME} newer
        ON newer.user_id = older.user_id
       AND newer.provider = older.provider
       AND newer.affiliate_url = older.affiliate_url
       AND newer.id > older.id
      WHERE older.user_id = ? AND older.provider = ?
    `,
    [userId, PROVIDER_KEY],
  );
};

const loadAffiliateShopeeLinkByItemId = async (
  db: ReturnType<typeof getDb>,
  userId: number,
  itemId: string,
): Promise<AffiliateShopeeLinkSummary> => {
  const [rows] = await db.query<AffiliateShopeeLinkRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ? AND item_id = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY, itemId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Link afiliado salvo, mas não foi possível confirmar o cadastro.");
  }
  return mapLinkRow(rows[0]);
};

export const listAffiliateShopeeLinksForUser = async (
  userId: number,
  options: { limit?: number } = {},
): Promise<AffiliateShopeeLinkSummary[]> => {
  await ensureAffiliateShopeeLinkTable();
  const db = getDb();
  const parsedLimit = Number(options.limit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(LIST_MAX_LIMIT, Math.floor(parsedLimit)))
    : LIST_DEFAULT_LIMIT;
  const [rows] = await db.query<AffiliateShopeeLinkRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `,
    [userId, PROVIDER_KEY, limit],
  );
  const mapped = Array.isArray(rows) ? rows.map(mapLinkRow) : [];
  const byItemId = new Map<string, AffiliateShopeeLinkSummary>();
  mapped.forEach((entry) => {
    if (!byItemId.has(entry.itemId)) {
      byItemId.set(entry.itemId, entry);
    }
  });
  const seenAffiliateUrl = new Set<string>();
  const deduped = Array.from(byItemId.values()).filter((entry) => {
    const key = entry.affiliateUrl.trim().toLowerCase();
    if (!key) return false;
    if (seenAffiliateUrl.has(key)) return false;
    seenAffiliateUrl.add(key);
    return true;
  });

  return deduped;
};

export const upsertAffiliateShopeeLinkForUser = async (
  userId: number,
  payload: { affiliateUrl: string; note?: string | null },
): Promise<AffiliateShopeeLinkSummary> => {
  await ensureAffiliateShopeeLinkTable();
  const url = normalizeUrl(payload.affiliateUrl);
  if (!url) {
    throw new Error("Informe um link de afiliado válido.");
  }
  const note =
    typeof payload.note === "string" && payload.note.trim()
      ? payload.note.trim().slice(0, 255)
      : null;
  const resolved = await resolveProductFromLink(userId, url);

  const db = getDb();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_NAME} (
        user_id, provider, item_id, affiliate_url, category_id, note, coupon_code, coupon_details, title, product_url, image_url, price_amount, price_formatted, currency_id, commission_rate, rating_star, is_available, is_active, last_used_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        affiliate_url = VALUES(affiliate_url),
        category_id = COALESCE(VALUES(category_id), category_id),
        note = VALUES(note),
        coupon_code = COALESCE(VALUES(coupon_code), coupon_code),
        coupon_details = COALESCE(VALUES(coupon_details), coupon_details),
        title = COALESCE(VALUES(title), title),
        product_url = COALESCE(VALUES(product_url), product_url),
        image_url = COALESCE(VALUES(image_url), image_url),
        price_amount = COALESCE(VALUES(price_amount), price_amount),
        price_formatted = COALESCE(VALUES(price_formatted), price_formatted),
        currency_id = COALESCE(VALUES(currency_id), currency_id),
        commission_rate = COALESCE(VALUES(commission_rate), commission_rate),
        rating_star = COALESCE(VALUES(rating_star), rating_star),
        is_available = COALESCE(VALUES(is_available), is_available),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      PROVIDER_KEY,
      resolved.itemId,
      resolved.affiliateUrl,
      resolved.categoryId,
      note,
      null,
      null,
      resolved.title,
      resolved.productUrl,
      resolved.imageUrl,
      resolved.priceAmount,
      resolved.priceFormatted,
      resolved.currencyId,
      resolved.commissionRate,
      resolved.ratingStar,
      typeof resolved.available === "boolean" ? (resolved.available ? 1 : 0) : null,
      1,
    ],
  );

  await dedupeAffiliateUrlRows(db, userId);
  return loadAffiliateShopeeLinkByItemId(db, userId, resolved.itemId);
};

export const upsertAffiliateShopeeLinkDirectForUser = async (
  userId: number,
  payload: {
    itemId: string;
    affiliateUrl: string;
    note?: string | null;
    couponCode?: string | null;
    couponDetails?: string | null;
    title?: string | null;
    productUrl?: string | null;
    imageUrl?: string | null;
    categoryId?: string | null;
    priceAmount?: number | null;
    priceFormatted?: string | null;
    currencyId?: string | null;
    commissionRate?: string | null;
    ratingStar?: string | null;
    available?: boolean | null;
    isActive?: boolean | null;
  },
): Promise<AffiliateShopeeLinkSummary> => {
  await ensureAffiliateShopeeLinkTable();

  const itemId = normalizeItemId(payload.itemId);
  if (!itemId) {
    throw new Error("Item inválido para salvar o link afiliado.");
  }

  const affiliateUrl = normalizeUrl(payload.affiliateUrl);
  if (!affiliateUrl) {
    throw new Error("Informe um link de afiliado válido.");
  }

  const note =
    typeof payload.note === "string" && payload.note.trim()
      ? payload.note.trim().slice(0, 255)
      : null;
  const couponCode =
    typeof payload.couponCode === "string" && payload.couponCode.trim()
      ? payload.couponCode.trim().slice(0, 64)
      : null;
  const couponDetails =
    typeof payload.couponDetails === "string" && payload.couponDetails.trim()
      ? payload.couponDetails.trim().slice(0, 255)
      : null;
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim().slice(0, 255)
      : null;
  const productUrl =
    typeof payload.productUrl === "string" && payload.productUrl.trim()
      ? normalizeUrl(payload.productUrl) || null
      : null;
  const imageUrl =
    typeof payload.imageUrl === "string" && payload.imageUrl.trim()
      ? normalizeUrl(payload.imageUrl) || null
      : null;
  const categoryId = normalizeCategoryId(payload.categoryId ?? null);
  const priceAmount =
    typeof payload.priceAmount === "number" && Number.isFinite(payload.priceAmount)
      ? payload.priceAmount
      : null;
  const priceFormatted =
    typeof payload.priceFormatted === "string" && payload.priceFormatted.trim()
      ? payload.priceFormatted.trim().slice(0, 64)
      : null;
  const currencyId =
    typeof payload.currencyId === "string" && payload.currencyId.trim()
      ? payload.currencyId.trim().slice(0, 16)
      : null;
  const commissionRate =
    typeof payload.commissionRate === "string" && payload.commissionRate.trim()
      ? payload.commissionRate.trim().slice(0, 64)
      : null;
  const ratingStar =
    typeof payload.ratingStar === "string" && payload.ratingStar.trim()
      ? payload.ratingStar.trim().slice(0, 32)
      : null;
  const available =
    payload.available === null || typeof payload.available === "undefined"
      ? null
      : payload.available
        ? 1
        : 0;
  const isActiveForInsert = payload.isActive === false ? 0 : 1;
  const isActiveForUpdate =
    typeof payload.isActive === "boolean"
      ? payload.isActive
        ? 1
        : 0
      : null;

  const db = getDb();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_NAME} (
        user_id, provider, item_id, affiliate_url, category_id, note, coupon_code, coupon_details, title, product_url, image_url, price_amount, price_formatted, currency_id, commission_rate, rating_star, is_available, is_active, last_used_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        affiliate_url = VALUES(affiliate_url),
        category_id = COALESCE(VALUES(category_id), category_id),
        note = VALUES(note),
        coupon_code = VALUES(coupon_code),
        coupon_details = VALUES(coupon_details),
        title = COALESCE(VALUES(title), title),
        product_url = COALESCE(VALUES(product_url), product_url),
        image_url = COALESCE(VALUES(image_url), image_url),
        price_amount = COALESCE(VALUES(price_amount), price_amount),
        price_formatted = COALESCE(VALUES(price_formatted), price_formatted),
        currency_id = COALESCE(VALUES(currency_id), currency_id),
        commission_rate = COALESCE(VALUES(commission_rate), commission_rate),
        rating_star = COALESCE(VALUES(rating_star), rating_star),
        is_available = COALESCE(VALUES(is_available), is_available),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      PROVIDER_KEY,
      itemId,
      affiliateUrl,
      categoryId,
      note,
      couponCode,
      couponDetails,
      title,
      productUrl,
      imageUrl,
      priceAmount,
      priceFormatted,
      currencyId,
      commissionRate,
      ratingStar,
      available,
      isActiveForInsert,
      isActiveForUpdate,
    ],
  );

  await dedupeAffiliateUrlRows(db, userId);
  return loadAffiliateShopeeLinkByItemId(db, userId, itemId);
};

export const upsertAffiliateShopeeLinksBatchForUser = async (
  userId: number,
  entries: Array<{
    itemId?: string | null;
    affiliateUrl?: string | null;
    note?: string | null;
    couponCode?: string | null;
    couponDetails?: string | null;
    title?: string | null;
    productUrl?: string | null;
    imageUrl?: string | null;
    categoryId?: string | null;
    priceAmount?: number | null;
    priceFormatted?: string | null;
    currencyId?: string | null;
    commissionRate?: string | null;
    ratingStar?: string | null;
    available?: boolean | null;
    isActive?: boolean | null;
  }>,
): Promise<{
  links: AffiliateShopeeLinkSummary[];
  imported: number;
  failed: number;
  errors: string[];
}> => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Nenhum produto informado para importação.");
  }

  const normalizedEntries: Array<{
    itemId: string;
    affiliateUrl: string;
    note: string | null;
    couponCode: string | null;
    couponDetails: string | null;
    title: string | null;
    productUrl: string | null;
    imageUrl: string | null;
    categoryId: string | null;
    priceAmount: number | null;
    priceFormatted: string | null;
    currencyId: string | null;
    commissionRate: string | null;
    ratingStar: string | null;
    available: boolean | null;
    isActive: boolean;
  }> = [];
  const seenItemIds = new Set<string>();
  const seenAffiliateUrls = new Set<string>();

  for (const entry of entries.slice(0, MAX_BATCH_IMPORT_ENTRIES)) {
    const itemId = normalizeItemId(String(entry?.itemId || ""));
    const affiliateUrl = normalizeUrl(String(entry?.affiliateUrl || ""));
    if (!itemId || !affiliateUrl) {
      continue;
    }
    const affiliateKey = affiliateUrl.toLowerCase();
    if (seenItemIds.has(itemId) || seenAffiliateUrls.has(affiliateKey)) {
      continue;
    }
    seenItemIds.add(itemId);
    seenAffiliateUrls.add(affiliateKey);
    normalizedEntries.push({
      itemId,
      affiliateUrl,
      note:
        typeof entry?.note === "string" && entry.note.trim()
          ? entry.note.trim().slice(0, 255)
          : null,
      couponCode:
        typeof entry?.couponCode === "string" && entry.couponCode.trim()
          ? entry.couponCode.trim().slice(0, 64)
          : null,
      couponDetails:
        typeof entry?.couponDetails === "string" && entry.couponDetails.trim()
          ? entry.couponDetails.trim().slice(0, 255)
          : null,
      title:
        typeof entry?.title === "string" && entry.title.trim()
          ? entry.title.trim().slice(0, 255)
          : null,
      productUrl:
        typeof entry?.productUrl === "string" && entry.productUrl.trim()
          ? normalizeUrl(entry.productUrl) || null
          : null,
      imageUrl:
        typeof entry?.imageUrl === "string" && entry.imageUrl.trim()
          ? normalizeUrl(entry.imageUrl) || null
          : null,
      categoryId:
        typeof entry?.categoryId === "string" && entry.categoryId.trim()
          ? normalizeCategoryId(entry.categoryId)
          : null,
      priceAmount:
        typeof entry?.priceAmount === "number" && Number.isFinite(entry.priceAmount)
          ? entry.priceAmount
          : null,
      priceFormatted:
        typeof entry?.priceFormatted === "string" && entry.priceFormatted.trim()
          ? entry.priceFormatted.trim().slice(0, 64)
          : null,
      currencyId:
        typeof entry?.currencyId === "string" && entry.currencyId.trim()
          ? entry.currencyId.trim().slice(0, 16)
          : null,
      commissionRate:
        typeof entry?.commissionRate === "string" && entry.commissionRate.trim()
          ? entry.commissionRate.trim().slice(0, 64)
          : null,
      ratingStar:
        typeof entry?.ratingStar === "string" && entry.ratingStar.trim()
          ? entry.ratingStar.trim().slice(0, 32)
          : null,
      available:
        entry?.available === null || typeof entry?.available === "undefined"
          ? null
          : Boolean(entry.available),
      isActive: entry?.isActive !== false,
    });
  }

  if (normalizedEntries.length === 0) {
    throw new Error("Nenhum produto válido encontrado para importar.");
  }

  const links: AffiliateShopeeLinkSummary[] = [];
  const errors: string[] = [];

  const chunkSize = 25;
  let totalResults = 0;
  for (let index = 0; index < normalizedEntries.length; index += chunkSize) {
    const chunk = normalizedEntries.slice(index, index + chunkSize);
    const chunkResults = await Promise.allSettled(
      chunk.map((entry) =>
        upsertAffiliateShopeeLinkDirectForUser(userId, {
          itemId: entry.itemId,
          affiliateUrl: entry.affiliateUrl,
          note: entry.note,
          couponCode: entry.couponCode,
          couponDetails: entry.couponDetails,
          title: entry.title,
          productUrl: entry.productUrl,
          imageUrl: entry.imageUrl,
          categoryId: entry.categoryId,
          priceAmount: entry.priceAmount,
          priceFormatted: entry.priceFormatted,
          currencyId: entry.currencyId,
          commissionRate: entry.commissionRate,
          ratingStar: entry.ratingStar,
          available: entry.available,
          isActive: entry.isActive,
        }),
      ),
    );
    totalResults += chunkResults.length;
    for (const result of chunkResults) {
      if (result.status === "fulfilled") {
        links.push(result.value);
        continue;
      }
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : "Falha ao importar um dos produtos selecionados.";
      if (!errors.includes(message)) {
        errors.push(message);
      }
    }
  }

  return {
    links,
    imported: links.length,
    failed: totalResults - links.length,
    errors: errors.slice(0, 10),
  };
};

export const deleteAffiliateShopeeLinkForUser = async (
  userId: number,
  itemIdRaw: string,
): Promise<void> => {
  await ensureAffiliateShopeeLinkTable();
  const itemId = normalizeItemId(itemIdRaw);
  if (!itemId) {
    throw new Error("Item inválido para remover.");
  }
  const db = getDb();
  await db.query(
    `
      DELETE FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ? AND item_id = ?
    `,
    [userId, PROVIDER_KEY, itemId],
  );
};

export const deleteAffiliateShopeeLinksForUser = async (
  userId: number,
  options: {
    itemIds?: string[];
    all?: boolean;
    limit?: number;
  } = {},
): Promise<number> => {
  await ensureAffiliateShopeeLinkTable();
  const db = getDb();

  if (options.all) {
    const limit = Number.isFinite(Number(options.limit))
      ? Math.max(1, Math.min(LIST_MAX_LIMIT, Math.floor(Number(options.limit))))
      : LIST_MAX_LIMIT;
    const [result] = await db.query<ResultSetHeader>(
      `
        DELETE FROM ${TABLE_NAME}
        WHERE user_id = ? AND provider = ?
        LIMIT ?
      `,
      [userId, PROVIDER_KEY, limit],
    );
    return Number(result?.affectedRows ?? 0);
  }

  const normalizedItemIds = Array.from(
    new Set(
      (Array.isArray(options.itemIds) ? options.itemIds : [])
        .map((entry) => normalizeItemId(String(entry ?? "")))
        .filter(Boolean),
    ),
  );
  if (normalizedItemIds.length === 0) {
    return 0;
  }

  const placeholders = normalizedItemIds.map(() => "?").join(", ");
  const [result] = await db.query<ResultSetHeader>(
    `
      DELETE FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ? AND item_id IN (${placeholders})
    `,
    [userId, PROVIDER_KEY, ...normalizedItemIds],
  );
  return Number(result?.affectedRows ?? 0);
};

export const updateAffiliateShopeeLinkForUser = async (
  userId: number,
  itemIdRaw: string,
  payload: {
    affiliateUrl?: string | null;
    note?: string | null;
    couponCode?: string | null;
    couponDetails?: string | null;
    title?: string | null;
    productUrl?: string | null;
    imageUrl?: string | null;
    available?: boolean | null;
    isActive?: boolean | null;
  },
): Promise<AffiliateShopeeLinkSummary> => {
  await ensureAffiliateShopeeLinkTable();
  const itemId = normalizeItemId(itemIdRaw);
  if (!itemId) {
    throw new Error("Item inválido para atualizar.");
  }

  const db = getDb();
  const [existingRows] = await db.query<AffiliateShopeeLinkRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ? AND item_id = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY, itemId],
  );
  if (!Array.isArray(existingRows) || existingRows.length === 0) {
    throw new Error("Produto afiliado não encontrado para edição.");
  }

  const existing = existingRows[0];
  const nextAffiliateUrl =
    payload.affiliateUrl === undefined
      ? String(existing.affiliate_url)
      : normalizeUrl(payload.affiliateUrl ?? "") || null;
  if (!nextAffiliateUrl) {
    throw new Error("Informe um link de afiliado válido.");
  }

  const [duplicateRows] = await db.query<RowDataPacket[]>(
    `
      SELECT id
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ? AND affiliate_url = ? AND item_id <> ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY, nextAffiliateUrl, itemId],
  );
  if (Array.isArray(duplicateRows) && duplicateRows.length > 0) {
    throw new Error("Esse link afiliado já está vinculado a outro produto.");
  }

  const nextNote =
    payload.note === undefined
      ? existing.note
      : typeof payload.note === "string" && payload.note.trim()
        ? payload.note.trim().slice(0, 255)
        : null;
  const nextCouponCode =
    payload.couponCode === undefined
      ? existing.coupon_code
      : typeof payload.couponCode === "string" && payload.couponCode.trim()
        ? payload.couponCode.trim().slice(0, 64)
        : null;
  const nextCouponDetails =
    payload.couponDetails === undefined
      ? existing.coupon_details
      : typeof payload.couponDetails === "string" && payload.couponDetails.trim()
        ? payload.couponDetails.trim().slice(0, 255)
        : null;

  const nextTitle =
    payload.title === undefined
      ? existing.title
      : typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim().slice(0, 255)
        : null;

  const nextProductUrl =
    payload.productUrl === undefined
      ? existing.product_url
      : payload.productUrl
        ? normalizeUrl(payload.productUrl) || null
        : null;

  const nextImageUrl =
    payload.imageUrl === undefined
      ? existing.image_url
      : payload.imageUrl
        ? normalizeUrl(payload.imageUrl) || null
        : null;

  const nextAvailable =
    payload.available === undefined
      ? existing.is_available
      : payload.available === null
        ? null
        : payload.available
          ? 1
          : 0;
  const nextIsActive =
    payload.isActive === undefined || payload.isActive === null
      ? parseIsActive(existing.is_active)
        ? 1
        : 0
      : payload.isActive
        ? 1
        : 0;

  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET
        affiliate_url = ?,
        note = ?,
        coupon_code = ?,
        coupon_details = ?,
        title = ?,
        product_url = ?,
        image_url = ?,
        is_available = ?,
        is_active = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ? AND item_id = ?
    `,
    [
      nextAffiliateUrl,
      nextNote,
      nextCouponCode,
      nextCouponDetails,
      nextTitle,
      nextProductUrl,
      nextImageUrl,
      nextAvailable,
      nextIsActive,
      userId,
      PROVIDER_KEY,
      itemId,
    ],
  );

  const [rows] = await db.query<AffiliateShopeeLinkRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ? AND item_id = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY, itemId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Produto atualizado, mas não foi possível confirmar os dados.");
  }
  return mapLinkRow(rows[0]);
};

export const resolveAffiliateShopeeLinkForUserByItemId = async (
  userId: number,
  itemIdRaw: string,
): Promise<AffiliateShopeeLinkSummary | null> => {
  await ensureAffiliateShopeeLinkTable();
  const itemId = normalizeItemId(itemIdRaw);
  if (!itemId) {
    return null;
  }
  const db = getDb();
  const [rows] = await db.query<AffiliateShopeeLinkRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ? AND item_id = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY, itemId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return mapLinkRow(rows[0]);
};

export const markAffiliateShopeeLinkUsage = async (
  userId: number,
  itemIdRaw: string,
): Promise<void> => {
  await ensureAffiliateShopeeLinkTable();
  const itemId = normalizeItemId(itemIdRaw);
  if (!itemId) {
    return;
  }
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET last_used_at = NOW(), updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ? AND item_id = ?
    `,
    [userId, PROVIDER_KEY, itemId],
  );
};

export const updateAffiliateShopeeLinkCategoryForUser = async (
  userId: number,
  itemIdRaw: string,
  categoryIdRaw: string | null | undefined,
): Promise<void> => {
  await ensureAffiliateShopeeLinkTable();
  const itemId = normalizeItemId(itemIdRaw);
  const categoryId = normalizeCategoryId(categoryIdRaw ?? null);
  if (!itemId || !categoryId) {
    return;
  }
  const db = getDb();
  await db.query(
    `
      UPDATE ${TABLE_NAME}
      SET category_id = COALESCE(category_id, ?), updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND provider = ? AND item_id = ?
    `,
    [categoryId, userId, PROVIDER_KEY, itemId],
  );
};

const resolveLatestAvailability = (product: ShopeeAffiliateProduct | null): boolean | null => {
  if (!product) return null;
  if (typeof product.disponivel === "boolean") return product.disponivel;
  if (typeof product.estoque === "number") return product.estoque > 0;
  if (typeof product.status === "string" && product.status.trim()) {
    return product.status.trim().toLowerCase() === "active";
  }
  return null;
};

const fetchLatestProductByItemId = async (
  userId: number,
  itemId: string,
): Promise<ShopeeAffiliateProduct | null> => {
  try {
    const search = await searchShopeeAffiliate(itemId, { userId, limit: 1 });
    if (Array.isArray(search.produtos) && search.produtos.length > 0) {
      return search.produtos[0] ?? null;
    }
  } catch {
    // fallback abaixo
  }

  try {
    const search = await searchShopeeAffiliate(itemId, { limit: 1 });
    if (Array.isArray(search.produtos) && search.produtos.length > 0) {
      return search.produtos[0] ?? null;
    }
  } catch {
    // vazio
  }
  return null;
};

export const refreshAffiliateShopeeLinksSnapshotForUser = async (
  userId: number,
  options: { limit?: number; itemIds?: string[] } = {},
): Promise<{ checked: number; updated: number; failed: number }> => {
  await ensureAffiliateShopeeLinkTable();
  const db = getDb();

  const itemIds = Array.isArray(options.itemIds)
    ? Array.from(new Set(options.itemIds.map((entry) => normalizeItemId(entry)).filter(Boolean)))
    : [];
  const limit = Math.max(1, Math.min(LIST_MAX_LIMIT, Math.floor(Number(options.limit) || 180)));

  const rowsToRefresh = await (async () => {
    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => "?").join(", ");
      const [rows] = await db.query<AffiliateShopeeLinkRow[]>(
        `
          SELECT *
          FROM ${TABLE_NAME}
          WHERE user_id = ? AND provider = ? AND item_id IN (${placeholders})
          ORDER BY updated_at ASC, id ASC
        `,
        [userId, PROVIDER_KEY, ...itemIds],
      );
      return Array.isArray(rows) ? rows : [];
    }

    const [rows] = await db.query<AffiliateShopeeLinkRow[]>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE user_id = ? AND provider = ?
        ORDER BY updated_at ASC, id ASC
        LIMIT ?
      `,
      [userId, PROVIDER_KEY, limit],
    );
    return Array.isArray(rows) ? rows : [];
  })();

  if (rowsToRefresh.length === 0) {
    return { checked: 0, updated: 0, failed: 0 };
  }

  let checked = 0;
  let updated = 0;
  let failed = 0;

  const CONCURRENCY = 4;
  for (let index = 0; index < rowsToRefresh.length; index += CONCURRENCY) {
    const chunk = rowsToRefresh.slice(index, index + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (row) => {
        const itemId = normalizeItemId(row.item_id);
        if (!itemId) return false;

        const product = await fetchLatestProductByItemId(userId, itemId);
        if (!product) return false;

        const title =
          typeof product.titulo === "string" && product.titulo.trim()
            ? product.titulo.trim().slice(0, 255)
            : row.title;
        const productUrl =
          typeof product.url === "string" && product.url.trim()
            ? normalizeUrl(product.url) || row.product_url
            : row.product_url;
        const imageUrl =
          typeof product.imagem === "string" && product.imagem.trim()
            ? normalizeUrl(product.imagem) || row.image_url
            : row.image_url;
        const categoryId = normalizeCategoryId(product.categoriaId ?? row.category_id);
        const priceAmount =
          typeof product.preco === "number" && Number.isFinite(product.preco)
            ? product.preco
            : parseNumber(row.price_amount);
        const priceFormatted =
          typeof product.precoFormatado === "string" && product.precoFormatado.trim()
            ? product.precoFormatado.trim().slice(0, 64)
            : row.price_formatted;
        const currencyId =
          typeof product.moeda === "string" && product.moeda.trim()
            ? product.moeda.trim().slice(0, 16)
            : row.currency_id;
        const commissionRate =
          typeof product.shopee?.commissionRate === "string" && product.shopee.commissionRate.trim()
            ? product.shopee.commissionRate.trim().slice(0, 64)
            : row.commission_rate;
        const ratingStar =
          typeof product.shopee?.ratingStar === "string" && product.shopee.ratingStar.trim()
            ? product.shopee.ratingStar.trim().slice(0, 32)
            : row.rating_star;
        const available = resolveLatestAvailability(product);

        await db.query(
          `
            UPDATE ${TABLE_NAME}
            SET
              title = COALESCE(?, title),
              product_url = COALESCE(?, product_url),
              image_url = COALESCE(?, image_url),
              category_id = COALESCE(?, category_id),
              price_amount = ?,
              price_formatted = COALESCE(?, price_formatted),
              currency_id = COALESCE(?, currency_id),
              commission_rate = COALESCE(?, commission_rate),
              rating_star = COALESCE(?, rating_star),
              is_available = COALESCE(?, is_available),
              updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND provider = ? AND item_id = ?
          `,
          [
            title,
            productUrl,
            imageUrl,
            categoryId,
            priceAmount,
            priceFormatted,
            currencyId,
            commissionRate,
            ratingStar,
            toNullableTinyInt(available),
            userId,
            PROVIDER_KEY,
            itemId,
          ],
        );

        return true;
      }),
    );

    for (const result of results) {
      checked += 1;
      if (result.status === "fulfilled" && result.value) {
        updated += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { checked, updated, failed };
};
