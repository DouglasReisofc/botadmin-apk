import {
  listAffiliateShopeeAutoSyncConfigsForRun,
  markAffiliateShopeeAutoSyncError,
  markAffiliateShopeeAutoSyncSuccess,
  type AffiliateShopeeAutoSyncWorkerEntry,
} from "lib/affiliate-shopee-auto-sync";
import {
  listAffiliateShopeeLinksForUser,
  refreshAffiliateShopeeLinksSnapshotForUser,
  upsertAffiliateShopeeLinksBatchForUser,
} from "lib/affiliate-shopee-links";
import {
  generateShopeeShortLinksBatch,
  searchShopeeAffiliate,
  type ShopeeAffiliateProduct,
} from "lib/apis/shopee-affiliate";

const AUTO_SYNC_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.AFFILIATE_SHOPEE_PRODUCTS_AUTO_SYNC_INTERVAL_MS ?? 180_000),
);
const AUTO_SYNC_BATCH_SIZE = Math.max(
  1,
  Number(process.env.AFFILIATE_SHOPEE_PRODUCTS_AUTO_SYNC_BATCH ?? 4),
);
const AUTO_SYNC_REFRESH_LIMIT = Math.max(
  20,
  Number(process.env.AFFILIATE_SHOPEE_PRODUCTS_AUTO_SYNC_REFRESH_LIMIT ?? 180),
);

const DISCOVERY_TERMS = [
  "eletronicos",
  "celular smartphone",
  "notebook",
  "air fryer",
  "games",
  "perfume",
  "ferramenta",
  "moda",
  "casa decoracao",
  "pet shop",
  "automotivo",
  "beleza skincare",
];
const DISCOVERY_CATEGORY_QUERY_BY_KEY: Record<string, { query: string; categoryId: string | null }> = {
  eletronicos: { query: "eletronicos", categoryId: "100636" },
  eletrodomesticos: { query: "eletrodomesticos", categoryId: "100632" },
  games: { query: "games", categoryId: "100634" },
  moda: { query: "moda", categoryId: "100011" },
  beleza: { query: "beleza", categoryId: "100630" },
  saude: { query: "suplementos", categoryId: "100001" },
  casa: { query: "casa decoracao", categoryId: "100721" },
  ferramentas: { query: "ferramentas", categoryId: "100715" },
  automotivo: { query: "automotivo", categoryId: "102187" },
  bebes: { query: "bebes", categoryId: "101011" },
  pet: { query: "pet", categoryId: "100631" },
  smart_home: { query: "casa inteligente", categoryId: null },
};

type DiscoveryCandidate = {
  itemId: string;
  permalink: string;
  affiliateUrl: string | null;
  title: string | null;
  thumbnail: string | null;
  categoryId: string | null;
  priceAmount: number | null;
  priceFormatted: string | null;
  currencyId: string | null;
  available: boolean | null;
};

const runtime = globalThis as typeof globalThis & {
  __affiliateShopeeProductsAutoSyncDispatcherStarted?: boolean;
};

let dispatcherStarted = runtime.__affiliateShopeeProductsAutoSyncDispatcherStarted ?? false;
let autoSyncCycleRunning = false;

const log = (message: string, extra?: Record<string, unknown>) => {
  console.log(`[AffiliateShopeeProductsAutoSync] ${message}`, extra ?? {});
};

const normalizeItemId = (value: string | null | undefined): string => {
  return String(value || "")
    .trim()
    .replace(/[^\d]/g, "");
};

const normalizeDiscoveryCategoryKey = (value: string | null | undefined): string => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
};

const buildDiscoveryPlan = (entry: AffiliateShopeeAutoSyncWorkerEntry): { terms: string[]; categoryIds: string[] } => {
  const terms: string[] = [];
  const categories = new Set<string>();
  const seenTerms = new Set<string>();
  const pushTerm = (value: string | null | undefined) => {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seenTerms.has(key)) return;
    seenTerms.add(key);
    terms.push(normalized);
  };

  for (const rawCategory of Array.isArray(entry.discoveryCategories) ? entry.discoveryCategories : []) {
    const key = normalizeDiscoveryCategoryKey(rawCategory);
    const mapped = DISCOVERY_CATEGORY_QUERY_BY_KEY[key];
    if (mapped) {
      pushTerm(mapped.query);
      if (mapped.categoryId) categories.add(mapped.categoryId);
      continue;
    }
    const numericCategory = String(rawCategory || "").replace(/[^\d]/g, "");
    if (numericCategory) categories.add(numericCategory);
  }

  for (const term of Array.isArray(entry.discoveryTerms) ? entry.discoveryTerms : []) {
    pushTerm(term);
  }

  if (terms.length === 0) {
    DISCOVERY_TERMS.forEach(pushTerm);
  }

  return {
    terms,
    categoryIds: Array.from(categories),
  };
};

const normalizeComparableUrl = (value: string | null | undefined): string | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return `${host}${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
};

const toDiscoveryCandidate = (product: ShopeeAffiliateProduct): DiscoveryCandidate | null => {
  const itemId = normalizeItemId(product.id);
  const permalink = typeof product.url === "string" ? product.url.trim() : "";
  if (!itemId || !permalink) return null;
  const affiliateUrl =
    typeof product.shopee?.offerLink === "string" && product.shopee.offerLink.trim()
      ? product.shopee.offerLink.trim()
      : null;
  return {
    itemId,
    permalink,
    affiliateUrl,
    title: product.titulo ?? null,
    thumbnail: product.imagem ?? null,
    categoryId: product.categoriaId ?? null,
    priceAmount:
      typeof product.preco === "number" && Number.isFinite(product.preco) ? product.preco : null,
    priceFormatted: product.precoFormatado ?? null,
    currencyId: product.moeda ?? null,
    available:
      typeof product.disponivel === "boolean"
        ? product.disponivel
        : typeof product.estoque === "number"
          ? product.estoque > 0
          : null,
  };
};

const collectDiscoveryCandidates = async (params: {
  userId: number;
  desired: number;
  existingItemIds: Set<string>;
  existingAffiliateUrls: Set<string>;
  discoveryTerms: string[];
  discoveryCategoryIds: string[];
}): Promise<DiscoveryCandidate[]> => {
  const target = Math.max(10, params.desired);
  const candidateMap = new Map<string, DiscoveryCandidate>();
  const seenPermalinks = new Set<string>(params.existingAffiliateUrls);
  const categoryIdFilter = new Set(params.discoveryCategoryIds.map((entry) => entry.replace(/[^\d]/g, "")).filter(Boolean));
  const searchTerms = params.discoveryTerms.length > 0 ? params.discoveryTerms : DISCOVERY_TERMS;
  const maxRequests = 36;
  let requests = 0;

  const runSearch = async (term: string, categoryId?: string) => {
    if (requests >= maxRequests || candidateMap.size >= target * 4) return;
    requests += 1;
    try {
      const search = await searchShopeeAffiliate(term, {
        userId: params.userId,
        limit: 50,
        ...(categoryId ? { categoryId } : {}),
      });
      const products = Array.isArray(search.produtos) ? search.produtos : [];
      for (const product of products) {
        const mapped = toDiscoveryCandidate(product);
        if (!mapped) continue;
        if (categoryIdFilter.size > 0) {
          const normalizedCategory = String(mapped.categoryId || "").replace(/[^\d]/g, "");
          if (!normalizedCategory || !categoryIdFilter.has(normalizedCategory)) {
            continue;
          }
        }
        if (params.existingItemIds.has(mapped.itemId)) continue;
        if (candidateMap.has(mapped.itemId)) continue;
        const permalinkKey = normalizeComparableUrl(mapped.permalink);
        if (permalinkKey && seenPermalinks.has(permalinkKey)) continue;
        candidateMap.set(mapped.itemId, mapped);
        if (permalinkKey) seenPermalinks.add(permalinkKey);
        if (candidateMap.size >= target * 4) break;
      }
    } catch {
      // ignora termo com falha e continua no próximo
    }
  };

  const categoryIds = Array.from(categoryIdFilter).slice(0, 8);
  if (categoryIds.length > 0) {
    for (const categoryId of categoryIds) {
      for (const term of searchTerms.slice(0, 12)) {
        await runSearch(term, categoryId);
        if (requests >= maxRequests || candidateMap.size >= target * 4) break;
      }
      if (requests >= maxRequests || candidateMap.size >= target * 4) break;
    }
  } else {
    for (const term of searchTerms) {
      await runSearch(term);
      if (requests >= maxRequests || candidateMap.size >= target * 4) break;
    }
  }

  return Array.from(candidateMap.values());
};

const discoverAndImportLinks = async (
  entry: AffiliateShopeeAutoSyncWorkerEntry,
): Promise<{ candidates: number; generated: number; imported: number; failed: number }> => {
  const existingLinks = await listAffiliateShopeeLinksForUser(entry.userId);
  const existingItemIds = new Set(existingLinks.map((current) => normalizeItemId(current.itemId)).filter(Boolean));
  const existingUrls = new Set(
    existingLinks
      .map((current) => normalizeComparableUrl(current.affiliateUrl))
      .filter((current): current is string => Boolean(current)),
  );
  const discovery = buildDiscoveryPlan(entry);

  const candidates = await collectDiscoveryCandidates({
    userId: entry.userId,
    desired: entry.targetImportLimit,
    existingItemIds,
    existingAffiliateUrls: existingUrls,
    discoveryTerms: discovery.terms,
    discoveryCategoryIds: discovery.categoryIds,
  });
  if (candidates.length === 0) {
    return { candidates: 0, generated: 0, imported: 0, failed: 0 };
  }

  const directAffiliateByOrigin = new Map<string, string>();
  candidates.forEach((current) => {
    const origin = normalizeComparableUrl(current.permalink);
    if (!origin || !current.affiliateUrl) return;
    if (!directAffiliateByOrigin.has(origin)) {
      directAffiliateByOrigin.set(origin, current.affiliateUrl);
    }
  });

  const unresolvedOrigins = Array.from(
    new Set(
      candidates
        .map((current) => normalizeComparableUrl(current.permalink))
        .filter((origin): origin is string => Boolean(origin) && !directAffiliateByOrigin.has(origin)),
    ),
  );
  const unresolvedUrls = candidates
    .map((current) => current.permalink)
    .filter((url) => {
      const origin = normalizeComparableUrl(url);
      return Boolean(origin) && unresolvedOrigins.includes(origin as string);
    })
    .slice(0, 200);

  const generated = unresolvedUrls.length > 0
    ? await generateShopeeShortLinksBatch(unresolvedUrls, {
        preferBatchMutation: true,
        userId: entry.userId,
      })
    : [];
  const generatedByOrigin = new Map<string, string>();
  generated.forEach((current) => {
    const origin = normalizeComparableUrl(current.originUrl);
    if (!origin || !current.ok || !current.shortUrl) return;
    if (!generatedByOrigin.has(origin)) {
      generatedByOrigin.set(origin, current.shortUrl);
    }
  });

  const entriesToImport = candidates
    .map((current) => {
      const origin = normalizeComparableUrl(current.permalink);
      const affiliateUrl = origin
        ? directAffiliateByOrigin.get(origin) ?? generatedByOrigin.get(origin) ?? null
        : null;
      if (!affiliateUrl) return null;
      return {
        itemId: current.itemId,
        affiliateUrl,
        title: current.title,
        productUrl: current.permalink,
        imageUrl: current.thumbnail,
        categoryId: current.categoryId,
        priceAmount: current.priceAmount,
        priceFormatted: current.priceFormatted,
        currencyId: current.currencyId,
        available: current.available,
      };
    })
    .filter((current): current is NonNullable<typeof current> => Boolean(current))
    .slice(0, entry.targetImportLimit);

  if (entriesToImport.length === 0) {
    return {
      candidates: candidates.length,
      generated: generated.length,
      imported: 0,
      failed: 0,
    };
  }

  const imported = await upsertAffiliateShopeeLinksBatchForUser(entry.userId, entriesToImport);
  return {
    candidates: candidates.length,
    generated: generated.length + directAffiliateByOrigin.size,
    imported: imported.imported,
    failed: imported.failed,
  };
};

const processAutoSyncEntry = async (entry: AffiliateShopeeAutoSyncWorkerEntry): Promise<void> => {
  if (!entry.enabled) return;

  const summaries: string[] = [];

  if (entry.refreshExisting) {
    const refreshed = await refreshAffiliateShopeeLinksSnapshotForUser(entry.userId, {
      limit: AUTO_SYNC_REFRESH_LIMIT,
    });
    summaries.push(`refresh:${refreshed.updated}/${refreshed.checked}`);
  }

  if (entry.discoverNew) {
    const discovery = await discoverAndImportLinks(entry);
    summaries.push(
      `discover:candidates=${discovery.candidates},generated=${discovery.generated},imported=${discovery.imported},failed=${discovery.failed}`,
    );
  }

  log("varredura concluída", {
    userId: entry.userId,
    summaries,
  });
};

const runAutoSyncCycle = async (): Promise<void> => {
  if (autoSyncCycleRunning) {
    return;
  }
  autoSyncCycleRunning = true;

  try {
    const entries = await listAffiliateShopeeAutoSyncConfigsForRun(AUTO_SYNC_BATCH_SIZE);
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    for (const entry of entries) {
      try {
        await processAutoSyncEntry(entry);
        await markAffiliateShopeeAutoSyncSuccess({ userId: entry.userId });
      } catch (error) {
        await markAffiliateShopeeAutoSyncError({
          userId: entry.userId,
          error,
        }).catch(() => {
          // não travar ciclo
        });
        log("falha ao executar varredura", {
          userId: entry.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    autoSyncCycleRunning = false;
  }
};

export const startAffiliateShopeeProductsAutoSyncDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  runtime.__affiliateShopeeProductsAutoSyncDispatcherStarted = true;

  void runAutoSyncCycle();

  const timer = setInterval(() => {
    void runAutoSyncCycle();
  }, AUTO_SYNC_INTERVAL_MS);

  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }

  log("dispatcher iniciado", {
    intervalMs: AUTO_SYNC_INTERVAL_MS,
    batch: AUTO_SYNC_BATCH_SIZE,
    refreshLimit: AUTO_SYNC_REFRESH_LIMIT,
  });
};
