import type { RowDataPacket } from "mysql2";

import { ensureUserTable, getDb } from "lib/db";

const TABLE_NAME = "affiliate_ml_dispatch_history";
const DEFAULT_RECENT_CATEGORY_LIMIT = 4;
const MAX_RECENT_CATEGORY_LIMIT = 10;

type HistoryRow = RowDataPacket & {
  id: number;
  user_id: number;
  campaign_id: number;
  target_id: number;
  target_key: string;
  content_id: string;
  query_text: string | null;
  item_id: string | null;
  category_id: string | null;
  affiliate_url: string | null;
  product_url: string | null;
  sent_at: Date | string;
  created_at: Date | string;
};

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

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizeText = (value: string | null | undefined, maxLength: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const normalizeItemId = (value: string | null | undefined): string | null => {
  const normalized = normalizeText(value, 64);
  if (!normalized) return null;
  return normalized.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
};

const normalizeCategoryId = (value: string | null | undefined): string | null => {
  const normalized = normalizeText(value, 64);
  if (!normalized) return null;
  return normalized.toUpperCase().replace(/\s+/g, "");
};

const normalizeTargetKey = (value: string | null | undefined): string | null => {
  const normalized = normalizeText(value, 191);
  if (!normalized) return null;
  return normalized;
};

const clampRecentCategoryLimit = (value?: number | null): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RECENT_CATEGORY_LIMIT;
  }
  return Math.max(1, Math.min(MAX_RECENT_CATEGORY_LIMIT, Math.floor(value)));
};

const ensureAffiliateMlDispatchHistoryTable = async () =>
  runEnsure("affiliate-ml-dispatch-history-table", async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        campaign_id INT NOT NULL,
        target_id INT NOT NULL,
        target_key VARCHAR(191) NOT NULL,
        content_id VARCHAR(120) NOT NULL,
        query_text VARCHAR(255) NULL,
        item_id VARCHAR(64) NULL,
        category_id VARCHAR(64) NULL,
        affiliate_url VARCHAR(1024) NULL,
        product_url VARCHAR(1024) NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_affiliate_ml_history_context (user_id, campaign_id, target_key, content_id, sent_at),
        INDEX idx_affiliate_ml_history_target (campaign_id, target_id, sent_at),
        CONSTRAINT fk_affiliate_ml_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  });

export type AffiliateMlDispatchContextSnapshot = {
  lastSentAt: string | null;
  lastItemId: string | null;
  lastCategoryId: string | null;
  recentCategoryIds: string[];
};

export const getAffiliateMlDispatchContextSnapshot = async (params: {
  userId: number;
  campaignId: number;
  targetId: number;
  targetKey: string;
  contentId: string;
  recentCategoryLimit?: number | null;
}): Promise<AffiliateMlDispatchContextSnapshot> => {
  await ensureAffiliateMlDispatchHistoryTable();
  const targetKey = normalizeTargetKey(params.targetKey);
  const contentId = normalizeText(params.contentId, 120);
  if (!targetKey || !contentId) {
    return {
      lastSentAt: null,
      lastItemId: null,
      lastCategoryId: null,
      recentCategoryIds: [],
    };
  }

  const db = getDb();
  const [lastRows] = await db.query<HistoryRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND campaign_id = ? AND target_key = ? AND content_id = ?
      ORDER BY sent_at DESC, id DESC
      LIMIT 1
    `,
    [params.userId, params.campaignId, targetKey, contentId],
  );
  const last = Array.isArray(lastRows) && lastRows.length > 0 ? lastRows[0] : null;

  const limit = clampRecentCategoryLimit(params.recentCategoryLimit);
  const [categoryRows] = await db.query<Array<RowDataPacket & { category_id: string | null }>>(
    `
      SELECT category_id
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND campaign_id = ? AND target_key = ? AND content_id = ? AND category_id IS NOT NULL
      ORDER BY sent_at DESC, id DESC
      LIMIT ?
    `,
    [params.userId, params.campaignId, targetKey, contentId, limit * 3],
  );

  const seenCategories = new Set<string>();
  const recentCategoryIds: string[] = [];
  for (const row of Array.isArray(categoryRows) ? categoryRows : []) {
    const categoryId = normalizeCategoryId(row.category_id);
    if (!categoryId || seenCategories.has(categoryId)) continue;
    seenCategories.add(categoryId);
    recentCategoryIds.push(categoryId);
    if (recentCategoryIds.length >= limit) break;
  }

  return {
    lastSentAt: toIso(last?.sent_at),
    lastItemId: normalizeItemId(last?.item_id),
    lastCategoryId: normalizeCategoryId(last?.category_id),
    recentCategoryIds,
  };
};

export const recordAffiliateMlDispatchForContext = async (params: {
  userId: number;
  campaignId: number;
  targetId: number;
  targetKey: string;
  contentId: string;
  query?: string | null;
  itemId?: string | null;
  categoryId?: string | null;
  affiliateUrl?: string | null;
  productUrl?: string | null;
}): Promise<void> => {
  await ensureAffiliateMlDispatchHistoryTable();
  const targetKey = normalizeTargetKey(params.targetKey);
  const contentId = normalizeText(params.contentId, 120);
  if (!targetKey || !contentId) {
    return;
  }

  const db = getDb();
  await db.query(
    `
      INSERT INTO ${TABLE_NAME} (
        user_id, campaign_id, target_id, target_key, content_id, query_text, item_id, category_id, affiliate_url, product_url, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    [
      params.userId,
      params.campaignId,
      params.targetId,
      targetKey,
      contentId,
      normalizeText(params.query ?? null, 255),
      normalizeItemId(params.itemId ?? null),
      normalizeCategoryId(params.categoryId ?? null),
      normalizeText(params.affiliateUrl ?? null, 1024),
      normalizeText(params.productUrl ?? null, 1024),
    ],
  );
};
