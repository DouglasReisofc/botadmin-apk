import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { listAffiliateShopeeLinksForUser } from "lib/affiliate-shopee-links";
import {
  generateShopeeShortLinksBatch,
  searchShopeeAffiliate,
  type ShopeeAffiliateProduct,
} from "lib/apis/shopee-affiliate";

const MAX_LIMIT = 2000;
const ALL_CATEGORIES_TOKEN = "__ALL_CATEGORIES__";
const MIN_AUTO_FETCH_POOL = 200;
const AUTO_FETCH_POOL_MULTIPLIER = 8;
const AUTO_FETCH_POOL_ALL_CATEGORIES_MIN = 420;
const AUTO_FETCH_MAX_PAGES_PER_TERM = 5;
const STANDARD_FETCH_MAX_PAGES_PER_TERM = 2;
const AUTO_FETCH_PAGE_SIZE = 80;

const FALLBACK_ALL_CATEGORIES_TERMS = [
  "eletronicos",
  "celular",
  "fone bluetooth",
  "notebook",
  "console",
  "casa cozinha",
  "ferramenta",
  "moda feminina",
  "moda masculina",
  "beleza",
  "pet",
  "automotivo",
  "brinquedo",
  "smartwatch",
];

type ImportMode = "standard" | "promotions" | "aggressive";

const IMPORT_MODE_SET = new Set<ImportMode>(["standard", "promotions", "aggressive"]);

const parseImportMode = (value: string | null): ImportMode => {
  const normalized = String(value || "").trim().toLowerCase() as ImportMode;
  if (IMPORT_MODE_SET.has(normalized)) return normalized;
  return "promotions";
};

const clamp = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
};

const isTruthy = (value: string | null): boolean => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const normalizeItemId = (value: string): string => {
  return String(value || "")
    .trim()
    .replace(/[^\d]/g, "");
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

const normalizeKeyword = (value: string): string => {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isAllCategoriesQuery = (value: string): boolean => {
  const normalized = normalizeKeyword(value);
  return (
    normalized === normalizeKeyword(ALL_CATEGORIES_TOKEN) ||
    normalized === "todas categorias" ||
    normalized === "todas as categorias"
  );
};

const resolveSuffixes = (mode: ImportMode): string[] => {
  if (mode === "standard") return [];
  if (mode === "promotions") {
    return ["promocao", "desconto", "cupom", "frete gratis", "mais vendido", "liquidacao"];
  }
  return [
    "promocao",
    "desconto",
    "cupom",
    "frete gratis",
    "mais vendido",
    "barato",
    "oferta relampago",
    "liquidacao",
    "top vendas",
    "imperdivel",
  ];
};

const resolveSortTypes = (mode: ImportMode): number[] => {
  if (mode === "standard") return [1, 2];
  if (mode === "promotions") return [2, 5, 1];
  return [2, 5, 8, 9, 1];
};

const buildSearchTerms = (baseTerm: string, mode: ImportMode): string[] => {
  const normalizedBase = normalizeKeyword(baseTerm);
  if (!normalizedBase) return [];

  const terms = [baseTerm.trim()];
  const suffixes = resolveSuffixes(mode);
  suffixes.forEach((suffix) => {
    terms.push(`${baseTerm.trim()} ${suffix}`);
  });

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const term of terms) {
    const normalized = normalizeKeyword(term);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(term.trim());
  }
  return unique.slice(0, 40);
};

const buildAllCategoriesTerms = (mode: ImportMode): string[] => {
  const extras =
    mode === "standard"
      ? []
      : mode === "promotions"
        ? ["promocao", "desconto", "cupom", "frete gratis", "mais vendido"]
        : ["promocao", "desconto", "cupom", "frete gratis", "mais vendido", "liquidacao", "barato"];

  return Array.from(new Set([...FALLBACK_ALL_CATEGORIES_TERMS, ...extras]));
};

const mapSearchProducts = (products: ShopeeAffiliateProduct[]): Array<{
  id: string;
  title: string | null;
  permalink: string | null;
  thumbnail: string | null;
  category_id: string | null;
  price: number | null;
  original_price: number | null;
  currency_id: string | null;
  available_quantity: number | null;
  sold_quantity: number | null;
  condition: string | null;
  status: string | null;
  commission_rate: string | null;
  rating_star: string | null;
  offer_link: string | null;
}> => {
  return (Array.isArray(products) ? products : []).map((entry) => ({
    id: normalizeItemId(String(entry.id || "")),
    title: typeof entry.titulo === "string" ? entry.titulo : null,
    permalink: typeof entry.url === "string" ? entry.url : null,
    thumbnail: typeof entry.imagem === "string" ? entry.imagem : null,
    category_id: typeof entry.categoriaId === "string" ? entry.categoriaId : null,
    price: typeof entry.preco === "number" ? entry.preco : null,
    original_price: typeof entry.precoAntigo === "number" ? entry.precoAntigo : null,
    currency_id: typeof entry.moeda === "string" ? entry.moeda : "BRL",
    available_quantity: typeof entry.estoque === "number" ? entry.estoque : null,
    sold_quantity: typeof entry.vendidos === "number" ? entry.vendidos : null,
    condition: typeof entry.condicao === "string" ? entry.condicao : null,
    status: typeof entry.status === "string" ? entry.status : "active",
    commission_rate:
      typeof entry.shopee?.commissionRate === "string" && entry.shopee.commissionRate.trim()
        ? entry.shopee.commissionRate.trim()
        : null,
    rating_star:
      typeof entry.shopee?.ratingStar === "string" && entry.shopee.ratingStar.trim()
        ? entry.shopee.ratingStar.trim()
        : null,
    offer_link:
      typeof entry.shopee?.offerLink === "string" && entry.shopee.offerLink.trim()
        ? entry.shopee.offerLink.trim()
        : null,
  }));
};

const dedupeProducts = <T extends { id: string; permalink: string | null }>(items: T[]): T[] => {
  const byKey = new Map<string, T>();
  items.forEach((entry) => {
    const itemId = normalizeItemId(entry.id);
    const permalink = normalizeComparableUrl(entry.permalink);
    const key = itemId || permalink || `${byKey.size + 1}`;
    if (!key) return;
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  });
  return Array.from(byKey.values());
};

const collectProductsByTerms = async (params: {
  userId: number;
  terms: string[];
  categoryId: number | null;
  maxRawLimit: number;
  mode: ImportMode;
  autoAffiliate: boolean;
}): Promise<{
  results: Array<{
    id: string;
    title: string | null;
    permalink: string | null;
    thumbnail: string | null;
    category_id: string | null;
    price: number | null;
    original_price: number | null;
    currency_id: string | null;
    available_quantity: number | null;
    sold_quantity: number | null;
    condition: string | null;
    status: string | null;
    commission_rate: string | null;
    rating_star: string | null;
    offer_link: string | null;
  }>;
  warning: string | null;
}> => {
  const merged: Array<{
    id: string;
    title: string | null;
    permalink: string | null;
    thumbnail: string | null;
    category_id: string | null;
    price: number | null;
    original_price: number | null;
    currency_id: string | null;
    available_quantity: number | null;
    sold_quantity: number | null;
    condition: string | null;
    status: string | null;
    commission_rate: string | null;
    rating_star: string | null;
    offer_link: string | null;
  }> = [];

  let failures = 0;
  const failureMessages: string[] = [];
  const maxPagesPerTerm = params.autoAffiliate ? AUTO_FETCH_MAX_PAGES_PER_TERM : STANDARD_FETCH_MAX_PAGES_PER_TERM;

  for (const term of params.terms) {
    if (merged.length >= params.maxRawLimit) break;

    let fetched = false;
    let lastErrorMessage: string | null = null;
    for (const sortType of resolveSortTypes(params.mode)) {
      for (let page = 1; page <= maxPagesPerTerm; page += 1) {
        if (merged.length >= params.maxRawLimit) break;
        const remaining = Math.max(1, params.maxRawLimit - merged.length);
        const perPageLimit = Math.max(1, Math.min(50, params.autoAffiliate ? Math.min(remaining, AUTO_FETCH_PAGE_SIZE) : remaining));

        try {
          const search = await searchShopeeAffiliate(term, {
            userId: params.userId,
            limit: perPageLimit,
            page,
            listType: 0,
            sortType,
            ...(params.categoryId !== null ? { categoryId: params.categoryId } : {}),
          });
          const products = mapSearchProducts(search.produtos);
          merged.push(...products);
          if (products.length > 0) {
            fetched = true;
          }

          const hasNextPage = Boolean(search.paging?.hasNextPage);
          if (products.length === 0 || !hasNextPage) {
            break;
          }
        } catch (error) {
          lastErrorMessage =
            error instanceof Error ? error.message : "Falha ao consultar produtos na Open API da Shopee.";
          break;
        }
      }

      if (fetched) break;
    }

    if (!fetched) {
      failures += 1;
      if (lastErrorMessage) {
        failureMessages.push(lastErrorMessage);
      }
    }
  }

  const deduped = dedupeProducts(merged).slice(0, params.maxRawLimit);
  if (deduped.length === 0 && failures >= params.terms.length && failureMessages.length > 0) {
    throw new Error(failureMessages[0] || "Falha ao consultar produtos na Open API da Shopee.");
  }

  const warning =
    failures > 0
      ? `${failures} termo(s) não retornaram resultados válidos e foram ignorados automaticamente.`
      : null;

  return { results: deduped, warning };
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const rawCategoryName = (
      url.searchParams.get("categoryName") ||
      url.searchParams.get("query") ||
      ""
    ).trim();
    const explicitCategoryIdRaw = (url.searchParams.get("categoryId") || "").trim();

    const allCategories = isAllCategoriesQuery(rawCategoryName) || isTruthy(url.searchParams.get("allCategories"));
    const categoryName = allCategories ? ALL_CATEGORIES_TOKEN : rawCategoryName;
    const categoryId = !allCategories
      ? /^\d+$/.test(explicitCategoryIdRaw)
        ? Number(explicitCategoryIdRaw)
        : /^\d+$/.test(rawCategoryName)
          ? Number(rawCategoryName)
          : null
      : null;

    const preferHighDemand = url.searchParams.has("preferHighDemand")
      ? isTruthy(url.searchParams.get("preferHighDemand"))
      : true;
    const autoAffiliate = isTruthy(url.searchParams.get("autoAffiliate"));
    const mode = parseImportMode(url.searchParams.get("mode"));
    const limit = clamp(url.searchParams.get("limit"), 120, 1, MAX_LIMIT);
    const offset = clamp(url.searchParams.get("offset"), 0, 0, 1000);

    const collectLimitBase = autoAffiliate
      ? Math.max(
          MIN_AUTO_FETCH_POOL,
          limit * AUTO_FETCH_POOL_MULTIPLIER,
          allCategories ? AUTO_FETCH_POOL_ALL_CATEGORIES_MIN : 0,
        )
      : Math.max(limit * 2, 80);
    const collectLimit = Math.min(MAX_LIMIT, Math.max(limit + offset, collectLimitBase));

    if (!categoryName && !allCategories) {
      return NextResponse.json(
        { status: false, message: "Informe o termo da busca em categoryName." },
        { status: 400 },
      );
    }

    const terms = allCategories
      ? buildAllCategoriesTerms(mode)
      : buildSearchTerms(categoryName, preferHighDemand ? mode : "standard");

    if (terms.length === 0) {
      return NextResponse.json(
        { status: false, message: "Não foi possível montar termos de busca para esse filtro." },
        { status: 400 },
      );
    }

    const payload = await collectProductsByTerms({
      userId: user.id,
      terms,
      categoryId,
      maxRawLimit: collectLimit,
      mode,
      autoAffiliate,
    });

    const candidateProducts = payload.results.slice(offset, offset + collectLimit);

    const links = await listAffiliateShopeeLinksForUser(user.id);
    const linksByItemId = new Map(links.map((entry) => [normalizeItemId(entry.itemId), entry]));

    const generatedLinkByOrigin = new Map<string, string>();
    const missingOriginUrls = autoAffiliate
      ? Array.from(
          new Set(
            candidateProducts
              .filter((entry) => !entry.offer_link)
              .map((entry) => (typeof entry.permalink === "string" ? entry.permalink : null))
              .filter((entry): entry is string => Boolean(entry)),
          ),
        ).slice(0, 400)
      : [];

    let generatedCount = 0;
    let autoAffiliateWarning: string | null = null;

    if (autoAffiliate && missingOriginUrls.length > 0) {
      try {
        const generated = await generateShopeeShortLinksBatch(missingOriginUrls, {
          preferBatchMutation: true,
          userId: user.id,
        });
        generated.forEach((entry) => {
          const origin = normalizeComparableUrl(entry.originUrl);
          if (!origin || !entry.ok || !entry.shortUrl) return;
          generatedLinkByOrigin.set(origin, entry.shortUrl);
        });
        generatedCount = generated.filter((entry) => entry.ok && entry.shortUrl).length;
      } catch (error) {
        autoAffiliateWarning =
          error instanceof Error
            ? error.message
            : "Não foi possível gerar links afiliados automáticos nesta consulta.";
      }
    }

    const mappedProducts = candidateProducts.map((entry) => {
      const itemId = normalizeItemId(entry.id);
      const mappedLink = itemId ? linksByItemId.get(itemId) : null;
      const comparablePermalink = normalizeComparableUrl(entry.permalink);
      const generatedLink = comparablePermalink ? generatedLinkByOrigin.get(comparablePermalink) ?? null : null;
      const directOfferLink = typeof entry.offer_link === "string" && entry.offer_link.trim() ? entry.offer_link.trim() : null;
      const available =
        mappedLink?.available ??
        (typeof entry.available_quantity === "number"
          ? entry.available_quantity > 0
          : typeof entry.status === "string" && entry.status.trim()
            ? entry.status.trim().toLowerCase() === "active"
            : typeof entry.sold_quantity === "number" && entry.sold_quantity > 0
              ? true
              : null);

      return {
        itemId,
        title: typeof entry.title === "string" ? entry.title : null,
        permalink: typeof entry.permalink === "string" ? entry.permalink : null,
        thumbnail: typeof entry.thumbnail === "string" ? entry.thumbnail : null,
        categoryId:
          mappedLink?.categoryId ??
          (typeof entry.category_id === "string" ? entry.category_id : null),
        price: typeof entry.price === "number" ? entry.price : null,
        originalPrice: typeof entry.original_price === "number" ? entry.original_price : null,
        currencyId: typeof entry.currency_id === "string" ? entry.currency_id : "BRL",
        commissionRate:
          mappedLink?.commissionRate ??
          (typeof entry.commission_rate === "string" ? entry.commission_rate : null),
        ratingStar:
          mappedLink?.ratingStar ??
          (typeof entry.rating_star === "string" ? entry.rating_star : null),
        availableQuantity:
          typeof entry.available_quantity === "number" ? entry.available_quantity : null,
        soldQuantity: typeof entry.sold_quantity === "number" ? entry.sold_quantity : null,
        condition: typeof entry.condition === "string" ? entry.condition : null,
        status: typeof entry.status === "string" ? entry.status : null,
        available,
        affiliateUrl: mappedLink?.affiliateUrl ?? directOfferLink ?? generatedLink,
      };
    });

    const dedupedMappedProducts = (() => {
      const byItem = new Map<string, (typeof mappedProducts)[number]>();
      const seenAffiliate = new Set<string>();
      for (const current of mappedProducts) {
        if (!current.itemId) continue;
        const affiliateKey = current.affiliateUrl ? current.affiliateUrl.toLowerCase() : "";
        if (byItem.has(current.itemId)) continue;
        if (affiliateKey && seenAffiliate.has(affiliateKey)) continue;
        byItem.set(current.itemId, current);
        if (affiliateKey) seenAffiliate.add(affiliateKey);
      }
      return Array.from(byItem.values());
    })();

    const withAffiliate = dedupedMappedProducts.filter((entry) => Boolean(entry.affiliateUrl));
    const products = (autoAffiliate ? withAffiliate : dedupedMappedProducts).slice(0, limit);

    const highDemandWarning = preferHighDemand
      ? mode === "aggressive"
        ? "Garimpo agressivo ativo: termo base + promoções/cupons + variações de ranking da Shopee."
        : mode === "promotions"
          ? "Garimpo de promoções ativo: termo base + ofertas/descontos + variações de ranking da Shopee."
          : "Resultados priorizados por alta demanda da Shopee."
      : null;

    const validTargetWarning =
      autoAffiliate && withAffiliate.length < limit
        ? `Foram encontrados ${withAffiliate.length} produto(s) com link afiliado válido para um alvo de ${limit}. O sistema prioriza válidos e tenta completar o alvo automaticamente.`
        : null;

    const mergedWarning = [payload.warning, autoAffiliateWarning, highDemandWarning, validTargetWarning]
      .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      .join(" ") || null;

    return NextResponse.json({
      status: true,
      categoryId,
      categoryName: allCategories ? "Todas categorias" : categoryName,
      allCategories,
      mode,
      paging: {
        total: autoAffiliate ? withAffiliate.length : dedupedMappedProducts.length,
        limit,
        offset,
      },
      source: "shopee_open_api",
      products,
      autoAffiliate: {
        enabled: autoAffiliate,
        generated: generatedCount,
        warning: autoAffiliateWarning || undefined,
      },
      warning: mergedWarning || (products.length === 0 ? "Nenhum produto foi encontrado para este termo no momento." : null),
      note:
        "A busca usa a Open API oficial da Shopee (productOfferV2). Com autoAffiliate=true, usa offerLink nativo e fallback de short link para URLs sem oferta.",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar os produtos para o termo informado.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
