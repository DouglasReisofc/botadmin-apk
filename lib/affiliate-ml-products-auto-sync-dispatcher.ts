import {
  listAffiliateMlAutoSyncConfigsForRun,
  markAffiliateMlAutoSyncError,
  markAffiliateMlAutoSyncSuccess,
  type AffiliateMlAutoSyncWorkerEntry,
} from "lib/affiliate-ml-auto-sync";
import {
  listAffiliateMlLinksForUser,
  refreshAffiliateMlLinksSnapshotForUser,
  upsertAffiliateMlLinksBatchForUser,
} from "lib/affiliate-ml-links";
import { generateAffiliateMlLinksForUser } from "lib/affiliate-ml-resolver";
import { searchMercadoLivre, type MercadoLivreProduct } from "lib/apis/mercadolivre";

const AUTO_SYNC_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.AFFILIATE_ML_PRODUCTS_AUTO_SYNC_INTERVAL_MS ?? 180_000),
);
const AUTO_SYNC_BATCH_SIZE = Math.max(
  1,
  Number(process.env.AFFILIATE_ML_PRODUCTS_AUTO_SYNC_BATCH ?? 4),
);
const AUTO_SYNC_REFRESH_LIMIT = Math.max(
  20,
  Number(process.env.AFFILIATE_ML_PRODUCTS_AUTO_SYNC_REFRESH_LIMIT ?? 180),
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
const DISCOVERY_CATEGORY_QUERY_BY_KEY: Record<string, string> = {
  eletronicos: "eletronicos smartphone notebook tv gamer",
  moda: "moda roupa feminina masculina calcado",
  casa: "casa decoracao organizacao utilidades",
  beleza: "beleza skincare perfume maquiagem",
  games: "games console acessorios gamer",
  ferramentas: "ferramenta parafusadeira furadeira bricolagem",
  automotivo: "acessorios carro automotivo central multimidia",
  bebes: "fralda carrinho bebe brinquedo infantil",
  pet: "racao pet brinquedo cachorro gato",
  smart_home: "camera wifi lampada inteligente alexa",
};

type DiscoveryCandidate = {
  itemId: string;
  permalink: string;
  title: string | null;
  thumbnail: string | null;
  categoryId: string | null;
  priceAmount: number | null;
  priceFormatted: string | null;
  currencyId: string | null;
  available: boolean | null;
};

const runtime = globalThis as typeof globalThis & {
  __affiliateMlProductsAutoSyncDispatcherStarted?: boolean;
};

let dispatcherStarted = runtime.__affiliateMlProductsAutoSyncDispatcherStarted ?? false;
let autoSyncCycleRunning = false;

const log = (message: string, extra?: Record<string, unknown>) => {
  console.log(`[AffiliateMlProductsAutoSync] ${message}`, extra ?? {});
};

const normalizeItemId = (value: string | null | undefined): string => {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
};

const normalizeDiscoveryCategoryKey = (value: string | null | undefined): string => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
};

const buildDiscoveryTerms = (entry: AffiliateMlAutoSyncWorkerEntry): string[] => {
  const terms: string[] = [];
  const used = new Set<string>();
  const pushTerm = (value: string | null | undefined) => {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (used.has(key)) return;
    used.add(key);
    terms.push(normalized);
  };

  for (const category of Array.isArray(entry.discoveryCategories) ? entry.discoveryCategories : []) {
    const mapped = DISCOVERY_CATEGORY_QUERY_BY_KEY[normalizeDiscoveryCategoryKey(category)] ?? category;
    pushTerm(mapped);
  }
  for (const term of Array.isArray(entry.discoveryTerms) ? entry.discoveryTerms : []) {
    pushTerm(term);
  }
  if (terms.length === 0) {
    DISCOVERY_TERMS.forEach(pushTerm);
  }
  return terms;
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

const isMercadoLivreItemId = (value: string | null | undefined): boolean => {
  const normalized = normalizeItemId(value);
  return /^ML[A-Z]{1,3}\d+$/i.test(normalized);
};

const extractMercadoLivreItemIdFromUrl = (value: string | null | undefined): string | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalizedDirect = normalizeItemId(raw);
  if (isMercadoLivreItemId(normalizedDirect)) return normalizedDirect;
  try {
    const parsed = new URL(raw);
    const source = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    const match = source.match(/(ML[A-Z]{1,3}-?\d+)/i);
    if (!match?.[1]) return null;
    const normalized = normalizeItemId(match[1]);
    return isMercadoLivreItemId(normalized) ? normalized : null;
  } catch {
    return null;
  }
};

const buildMercadoLivreUrlVariants = (candidate: DiscoveryCandidate): string[] => {
  const variants = new Set<string>();
  const push = (value: string | null | undefined) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    variants.add(raw);
  };

  push(candidate.permalink);

  const itemId = normalizeItemId(candidate.itemId);
  if (isMercadoLivreItemId(itemId)) {
    const dashedItemId = itemId.replace(/^([A-Z]+)(\d+)$/i, "$1-$2");
    push(`https://www.mercadolivre.com.br/${itemId}`);
    push(`https://produto.mercadolivre.com.br/${itemId}`);
    push(`https://produto.mercadolivre.com.br/${dashedItemId}`);
    push(`https://www.mercadolivre.com.br/p/${itemId}`);
  }

  return Array.from(variants);
};

const toDiscoveryCandidate = (product: MercadoLivreProduct): DiscoveryCandidate | null => {
  const itemId = normalizeItemId(product.id);
  const permalink = typeof product.url === "string" ? product.url.trim() : "";
  if (!itemId || !permalink) return null;
  return {
    itemId,
    permalink,
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
}): Promise<DiscoveryCandidate[]> => {
  const target = Math.max(10, params.desired);
  const candidateMap = new Map<string, DiscoveryCandidate>();
  const seenPermalinks = new Set<string>(params.existingAffiliateUrls);
  const searchTerms = params.discoveryTerms.length > 0 ? params.discoveryTerms : DISCOVERY_TERMS;

  for (const term of searchTerms) {
    if (candidateMap.size >= target * 4) break;

    try {
      const search = await searchMercadoLivre(term, {
        userId: params.userId,
        limit: 50,
      });
      const products = Array.isArray(search.produtos) ? search.produtos : [];
      for (const product of products) {
        const mapped = toDiscoveryCandidate(product);
        if (!mapped) continue;
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
  }

  return Array.from(candidateMap.values());
};

const discoverAndImportLinks = async (
  entry: AffiliateMlAutoSyncWorkerEntry,
): Promise<{ candidates: number; generated: number; imported: number; failed: number; warning?: string }> => {
  const existingLinks = await listAffiliateMlLinksForUser(entry.userId);
  const existingItemIds = new Set(existingLinks.map((current) => normalizeItemId(current.itemId)).filter(Boolean));
  const existingUrls = new Set(
    existingLinks
      .map((current) => normalizeComparableUrl(current.affiliateUrl))
      .filter((current): current is string => Boolean(current)),
  );
  const discoveryTerms = buildDiscoveryTerms(entry);

  const candidates = await collectDiscoveryCandidates({
    userId: entry.userId,
    desired: entry.targetImportLimit,
    existingItemIds,
    existingAffiliateUrls: existingUrls,
    discoveryTerms,
  });
  if (candidates.length === 0) {
    return { candidates: 0, generated: 0, imported: 0, failed: 0 };
  }

  const candidateByItemId = new Map<string, DiscoveryCandidate>();
  const candidateByUrlKey = new Map<string, DiscoveryCandidate>();
  const primaryUrls: string[] = [];
  const fallbackUrls: string[] = [];
  const primaryUrlSet = new Set<string>();
  const fallbackUrlSet = new Set<string>();

  candidates.forEach((candidate) => {
    const normalizedItemId = normalizeItemId(candidate.itemId);
    if (normalizedItemId && !candidateByItemId.has(normalizedItemId)) {
      candidateByItemId.set(normalizedItemId, candidate);
    }

    const variants = buildMercadoLivreUrlVariants(candidate);
    variants.forEach((url, index) => {
      const key = normalizeComparableUrl(url);
      if (key && !candidateByUrlKey.has(key)) {
        candidateByUrlKey.set(key, candidate);
      }
      if (index === 0) {
        if (!primaryUrlSet.has(url)) {
          primaryUrlSet.add(url);
          primaryUrls.push(url);
        }
        return;
      }
      if (!fallbackUrlSet.has(url)) {
        fallbackUrlSet.add(url);
        fallbackUrls.push(url);
      }
    });
  });

  const candidateUrls = primaryUrls.slice(0, 500);

  if (candidateUrls.length === 0) {
    return { candidates: candidates.length, generated: 0, imported: 0, failed: 0 };
  }

  const generatedWarnings: string[] = [];
  const generatedLinks: Array<{ shortUrl: string; originUrl: string | null; longUrl: string | null }> = [];

  const collectGenerated = (payload: { links: Array<{ shortUrl: string; originUrl: string | null; longUrl: string | null }>; warning?: string }) => {
    if (payload.warning) {
      generatedWarnings.push(payload.warning);
    }
    payload.links.forEach((link) => {
      if (!link?.shortUrl) return;
      generatedLinks.push(link);
    });
  };

  const generatedPrimary = await generateAffiliateMlLinksForUser(entry.userId, candidateUrls);
  collectGenerated(generatedPrimary);

  if (generatedLinks.length === 0 && fallbackUrls.length > 0) {
    const fallbackBatch = fallbackUrls.filter((url) => !primaryUrlSet.has(url)).slice(0, 500);
    if (fallbackBatch.length > 0) {
      const generatedFallback = await generateAffiliateMlLinksForUser(entry.userId, fallbackBatch);
      collectGenerated(generatedFallback);
    }
  }

  const uniqueGeneratedLinks = Array.from(
    new Map(generatedLinks.map((entry) => [entry.shortUrl, entry])).values(),
  );
  const generatedByItemId = new Map<string, string>();

  uniqueGeneratedLinks.forEach((generated) => {
    const candidateKeys = [
      normalizeComparableUrl(generated.originUrl),
      normalizeComparableUrl(generated.longUrl),
    ].filter((entry): entry is string => Boolean(entry));

    for (const key of candidateKeys) {
      const candidate = candidateByUrlKey.get(key);
      if (!candidate) continue;
      const itemId = normalizeItemId(candidate.itemId);
      if (!itemId || generatedByItemId.has(itemId)) continue;
      generatedByItemId.set(itemId, generated.shortUrl);
      return;
    }

    const parsedItemId =
      extractMercadoLivreItemIdFromUrl(generated.originUrl) ||
      extractMercadoLivreItemIdFromUrl(generated.longUrl);
    if (!parsedItemId || generatedByItemId.has(parsedItemId)) return;
    if (!candidateByItemId.has(parsedItemId)) return;
    generatedByItemId.set(parsedItemId, generated.shortUrl);
  });

  const entriesToImport = candidates
    .map((current) => {
      const affiliateUrl = generatedByItemId.get(normalizeItemId(current.itemId)) ?? null;
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
    const warningBase = Array.from(new Set(generatedWarnings)).filter(Boolean).slice(0, 2).join(" ");
    const warning =
      warningBase ||
      "Nenhum link afiliado foi gerado para os candidatos desta varredura. Verifique cookie/CSRF/tag ou use termos/categorias mais elegíveis.";
    return {
      candidates: candidates.length,
      generated: uniqueGeneratedLinks.length,
      imported: 0,
      failed: 0,
      ...(warning ? { warning } : {}),
    };
  }

  const imported = await upsertAffiliateMlLinksBatchForUser(entry.userId, entriesToImport);
  const warning = Array.from(new Set(generatedWarnings)).filter(Boolean).slice(0, 2).join(" ");
  return {
    candidates: candidates.length,
    generated: uniqueGeneratedLinks.length,
    imported: imported.imported,
    failed: imported.failed,
    ...(warning ? { warning } : {}),
  };
};

const processAutoSyncEntry = async (entry: AffiliateMlAutoSyncWorkerEntry): Promise<void> => {
  if (!entry.enabled) return;

  const summaries: string[] = [];

  if (entry.refreshExisting) {
    const refreshed = await refreshAffiliateMlLinksSnapshotForUser(entry.userId, {
      limit: AUTO_SYNC_REFRESH_LIMIT,
    });
    summaries.push(`refresh:${refreshed.updated}/${refreshed.checked}`);
  }

  if (entry.discoverNew) {
    const discovery = await discoverAndImportLinks(entry);
    summaries.push(
      `discover:candidates=${discovery.candidates},generated=${discovery.generated},imported=${discovery.imported},failed=${discovery.failed}`,
    );
    if (discovery.warning) {
      summaries.push(`discover_warning=${discovery.warning}`);
    }
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
    const entries = await listAffiliateMlAutoSyncConfigsForRun(AUTO_SYNC_BATCH_SIZE);
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    for (const entry of entries) {
      try {
        await processAutoSyncEntry(entry);
        await markAffiliateMlAutoSyncSuccess({ userId: entry.userId });
      } catch (error) {
        await markAffiliateMlAutoSyncError({
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

export const startAffiliateMlProductsAutoSyncDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  runtime.__affiliateMlProductsAutoSyncDispatcherStarted = true;

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
