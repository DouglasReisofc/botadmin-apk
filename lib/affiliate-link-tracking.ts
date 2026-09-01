import crypto from "node:crypto";

import type { RowDataPacket } from "mysql2";

import { ensureUserTable, getDb } from "lib/db";
import { getAppBaseUrl } from "lib/meta";

const METRICS_TABLE = "affiliate_link_metrics";
const LINK_TABLE = "affiliate_product_links";
const TRACKING_VERSION = 1;
const TRACKING_PROVIDERS = new Set(["mercadolivre", "shopee"]);

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

type AffiliateLinkMetricRow = RowDataPacket & {
  user_id: number;
  provider: string;
  item_id: string;
  click_count: number | string | null;
  last_click_at: Date | string | null;
};

type AffiliateLinkUrlRow = RowDataPacket & {
  affiliate_url: string;
};

export type AffiliateTrackingPayload = {
  v: number;
  u: number;
  p: string;
  i: string;
};

export type AffiliateLinkMetricSummary = {
  clickCount: number;
  lastClickAt: string | null;
  trackingToken: string;
  trackedUrl: string;
};

const parseIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const parseCount = (value: number | string | null | undefined): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
};

const getTrackingSecret = (): string => {
  const candidates = [
    process.env.AFFILIATE_TRACKING_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.JWT_SECRET,
    process.env.AUTH_SECRET,
  ];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value) return value;
  }
  return crypto
    .createHash("sha256")
    .update(`${process.cwd()}::${process.env.HOSTNAME || ""}::botadmin-affiliate-tracking`)
    .digest("hex");
};

const normalizeProvider = (value: string): string => String(value || "").trim().toLowerCase();

const normalizeItemId = (value: string): string => String(value || "").trim();

const toBase64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

const fromBase64Url = (value: string): string => Buffer.from(value, "base64url").toString("utf8");

const signPayload = (payloadB64: string): string => {
  const secret = getTrackingSecret();
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
};

const safeEqual = (a: string, b: string): boolean => {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
};

export const createAffiliateTrackingToken = (params: {
  userId: number;
  provider: string;
  itemId: string;
}): string => {
  const payload: AffiliateTrackingPayload = {
    v: TRACKING_VERSION,
    u: Math.max(1, Math.floor(Number(params.userId) || 0)),
    p: normalizeProvider(params.provider),
    i: normalizeItemId(params.itemId),
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadB64);
  return `${payloadB64}.${signature}`;
};

export const parseAffiliateTrackingToken = (tokenRaw: string): AffiliateTrackingPayload | null => {
  const token = String(tokenRaw || "").trim();
  if (!token || !token.includes(".")) return null;
  const [payloadB64, signatureRaw] = token.split(".", 2);
  if (!payloadB64 || !signatureRaw) return null;

  const expected = signPayload(payloadB64);
  if (!safeEqual(expected, signatureRaw)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payloadB64)) as Partial<AffiliateTrackingPayload>;
    const version = Number(parsed?.v);
    const userId = Number(parsed?.u);
    const provider = normalizeProvider(String(parsed?.p || ""));
    const itemId = normalizeItemId(String(parsed?.i || ""));
    if (!Number.isFinite(version) || version !== TRACKING_VERSION) return null;
    if (!Number.isFinite(userId) || userId <= 0) return null;
    if (!TRACKING_PROVIDERS.has(provider)) return null;
    if (!provider || !itemId) return null;
    return {
      v: TRACKING_VERSION,
      u: Math.floor(userId),
      p: provider,
      i: itemId,
    };
  } catch {
    return null;
  }
};

export const buildAffiliateTrackedUrlFromToken = (token: string): string => {
  const base = getAppBaseUrl().replace(/\/+$/, "");
  return `${base}/api/affiliates/track/${encodeURIComponent(token)}`;
};

const ensureAffiliateLinkMetricsTable = async () =>
  runEnsure("affiliate-link-metrics-table", async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${METRICS_TABLE} (
        user_id INT NOT NULL,
        provider VARCHAR(64) NOT NULL,
        item_id VARCHAR(64) NOT NULL,
        click_count INT UNSIGNED NOT NULL DEFAULT 0,
        last_click_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, provider, item_id),
        KEY idx_affiliate_link_metrics_provider_item (provider, item_id),
        CONSTRAINT fk_affiliate_link_metrics_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  });

export const listAffiliateLinkMetricsByItems = async (
  userId: number,
  providerRaw: string,
  itemIdsRaw: string[],
): Promise<Map<string, { clickCount: number; lastClickAt: string | null }>> => {
  await ensureAffiliateLinkMetricsTable();
  const provider = normalizeProvider(providerRaw);
  const itemIds = Array.from(new Set((Array.isArray(itemIdsRaw) ? itemIdsRaw : []).map(normalizeItemId).filter(Boolean)));
  const map = new Map<string, { clickCount: number; lastClickAt: string | null }>();
  if (!provider || itemIds.length === 0) return map;

  const db = getDb();
  const placeholders = itemIds.map(() => "?").join(", ");
  const [rows] = await db.query<AffiliateLinkMetricRow[]>(
    `
      SELECT user_id, provider, item_id, click_count, last_click_at
      FROM ${METRICS_TABLE}
      WHERE user_id = ? AND provider = ? AND item_id IN (${placeholders})
    `,
    [userId, provider, ...itemIds],
  );

  if (!Array.isArray(rows)) return map;
  rows.forEach((row) => {
    const itemId = normalizeItemId(String(row.item_id || ""));
    if (!itemId) return;
    map.set(itemId, {
      clickCount: parseCount(row.click_count),
      lastClickAt: parseIso(row.last_click_at),
    });
  });
  return map;
};

export const buildAffiliateTrackingSummaryByItems = async (params: {
  userId: number;
  provider: string;
  itemIds: string[];
}): Promise<Map<string, AffiliateLinkMetricSummary>> => {
  const itemIds = Array.from(new Set((Array.isArray(params.itemIds) ? params.itemIds : []).map(normalizeItemId).filter(Boolean)));
  const provider = normalizeProvider(params.provider);
  const metrics = await listAffiliateLinkMetricsByItems(params.userId, provider, itemIds);

  const byItemId = new Map<string, AffiliateLinkMetricSummary>();
  itemIds.forEach((itemId) => {
    const token = createAffiliateTrackingToken({
      userId: params.userId,
      provider,
      itemId,
    });
    const trackedUrl = buildAffiliateTrackedUrlFromToken(token);
    const metric = metrics.get(itemId);
    byItemId.set(itemId, {
      clickCount: metric?.clickCount ?? 0,
      lastClickAt: metric?.lastClickAt ?? null,
      trackingToken: token,
      trackedUrl,
    });
  });
  return byItemId;
};

export const incrementAffiliateLinkClickMetric = async (params: {
  userId: number;
  provider: string;
  itemId: string;
}): Promise<void> => {
  await ensureAffiliateLinkMetricsTable();
  const userId = Math.max(1, Math.floor(Number(params.userId) || 0));
  const provider = normalizeProvider(params.provider);
  const itemId = normalizeItemId(params.itemId);
  if (!userId || !provider || !itemId) return;
  const db = getDb();
  await db.query(
    `
      INSERT INTO ${METRICS_TABLE} (user_id, provider, item_id, click_count, last_click_at)
      VALUES (?, ?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE
        click_count = click_count + 1,
        last_click_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, provider, itemId],
  );
};

export const resolveAffiliateTrackedDestination = async (payload: AffiliateTrackingPayload): Promise<string | null> => {
  const userId = Math.max(1, Math.floor(Number(payload.u) || 0));
  const provider = normalizeProvider(payload.p);
  const itemId = normalizeItemId(payload.i);
  if (!userId || !provider || !itemId) return null;

  const db = getDb();
  const [rows] = await db.query<AffiliateLinkUrlRow[]>(
    `
      SELECT affiliate_url
      FROM ${LINK_TABLE}
      WHERE user_id = ? AND provider = ? AND item_id = ?
      LIMIT 1
    `,
    [userId, provider, itemId],
  );

  if (!Array.isArray(rows) || rows.length === 0) return null;
  const destination = typeof rows[0]?.affiliate_url === "string" ? rows[0].affiliate_url.trim() : "";
  if (!destination) return null;
  return destination;
};
