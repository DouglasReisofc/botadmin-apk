import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getValidAffiliateAccessToken } from "lib/affiliate-connections";
import { generateAffiliateMlLinksForUser } from "lib/affiliate-ml-resolver";
import { listAffiliateMlLinksForUser } from "lib/affiliate-ml-links";
import { searchMercadoLivre } from "lib/apis/mercadolivre";

const DEFAULT_SITE_ID = "MLB";
const MAX_LIMIT = 2000;
const TREND_KEYWORDS_LIMIT = 16;
const TREND_TERMS_MAX = 40;
const TERM_SUFFIXES_LIMIT = 12;
const ALL_CATEGORIES_TOKEN = "__ALL_CATEGORIES__";
const MIN_AUTO_FETCH_POOL = 200;
const AUTO_FETCH_POOL_MULTIPLIER = 8;
const AUTO_FETCH_POOL_ALL_CATEGORIES_MIN = 400;
const FALLBACK_ALL_CATEGORIES_TERMS = [
  "eletronicos",
  "celular smartphone",
  "notebook",
  "air fryer",
  "games",
  "perfume",
  "ferramenta",
  "casa decoracao",
  "moda",
  "pet shop",
  "automotivo",
  "beleza",
];

type ImportMode = "standard" | "promotions" | "aggressive";

type RawProduct = {
  id?: string;
  title?: string;
  permalink?: string;
  thumbnail?: string;
  category_id?: string | null;
  price?: number;
  original_price?: number | null;
  currency_id?: string;
  available_quantity?: number;
  sold_quantity?: number;
  condition?: string;
  status?: string;
};

type ProductsPayload = {
  paging: { total?: number; limit?: number; offset?: number };
  results: RawProduct[];
  source: "oauth_search" | "marketplace";
  warning?: string;
};

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
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
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

const joinWarnings = (...parts: Array<string | null | undefined>): string | null => {
  const merged = parts
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (merged.length === 0) return null;
  return Array.from(new Set(merged)).join(" ");
};

const isRecoverableMlTermError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || "");
  return /bad request|retornou 400|status 400|forbidden|retornou 403|status 403|retornou 404/i.test(message);
};

const resolveSearchTermSuffixes = (mode: ImportMode): string[] => {
  if (mode === "standard") {
    return [];
  }
  if (mode === "promotions") {
    return ["oferta", "promocao", "desconto", "frete gratis", "lancamento", "mais vendidos"];
  }
  return [
    "oferta",
    "promocao",
    "desconto",
    "frete gratis",
    "cupom",
    "liquidacao",
    "queima de estoque",
    "barato",
    "top vendas",
    "mais vendidos",
    "imperdivel",
    "black friday",
  ];
};

const dedupeProducts = (items: RawProduct[]): RawProduct[] => {
  const byKey = new Map<string, RawProduct>();
  items.forEach((entry) => {
    const itemId = normalizeItemId(typeof entry.id === "string" ? entry.id : "");
    const permalink = normalizeComparableUrl(typeof entry.permalink === "string" ? entry.permalink : null);
    const key = itemId || permalink || `${entry.title || "item"}-${byKey.size + 1}`;
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  });
  return Array.from(byKey.values());
};

const fetchTrendsKeywords = async (params: {
  siteId: string;
  accessToken?: string | null;
}): Promise<string[]> => {
  const endpoint = new URL(`/trends/${encodeURIComponent(params.siteId)}`, "https://api.mercadolibre.com");
  const response = await fetch(endpoint, {
    headers: {
      ...(params.accessToken ? { Authorization: `Bearer ${params.accessToken}` } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as Array<{ keyword?: string }>;
  return (Array.isArray(payload) ? payload : [])
    .map((entry) => (typeof entry.keyword === "string" ? entry.keyword.trim() : ""))
    .filter(Boolean);
};

const buildSearchTerms = (baseTerm: string, trendKeywords: string[], mode: ImportMode): string[] => {
  const normalizedBase = normalizeKeyword(baseTerm);
  const baseTokens = normalizedBase.split(" ").filter(Boolean);

  const relevantKeywords = trendKeywords
    .filter((entry) => {
      const normalized = normalizeKeyword(entry);
      if (!normalized) return false;
      if (baseTokens.length === 0) return true;
      return baseTokens.some((token) => normalized.includes(token));
    })
    .slice(0, TREND_KEYWORDS_LIMIT);

  const fallbackKeywords =
    relevantKeywords.length > 0
      ? relevantKeywords
      : trendKeywords.slice(0, TREND_KEYWORDS_LIMIT);

  const uniqueTerms: string[] = [];
  const seen = new Set<string>();

  const suffixTerms = resolveSearchTermSuffixes(mode)
    .slice(0, TERM_SUFFIXES_LIMIT)
    .map((suffix) => `${baseTerm} ${suffix}`);

  [baseTerm, ...suffixTerms, ...fallbackKeywords].forEach((entry) => {
    const trimmed = entry.trim();
    const normalized = normalizeKeyword(trimmed);
    if (!trimmed || !normalized || seen.has(normalized)) return;
    seen.add(normalized);
    uniqueTerms.push(trimmed);
  });

  return uniqueTerms.slice(0, TREND_TERMS_MAX);
};

const buildAllCategoriesTerms = (trendKeywords: string[], mode: ImportMode): string[] => {
  const fallbackTerms = mode === "standard"
    ? FALLBACK_ALL_CATEGORIES_TERMS
    : mode === "promotions"
      ? [...FALLBACK_ALL_CATEGORIES_TERMS, "promocao", "desconto", "frete gratis", "mais vendidos"]
      : [...FALLBACK_ALL_CATEGORIES_TERMS, "promocao", "desconto", "cupom", "liquidacao", "black friday"];

  const byKeyword = trendKeywords
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, TREND_TERMS_MAX);

  const merged = Array.from(
    new Set([...byKeyword, ...fallbackTerms].map((entry) => entry.trim()).filter(Boolean)),
  );
  return merged.slice(0, TREND_TERMS_MAX);
};

const mapSearchProducts = (products: unknown[]): RawProduct[] => {
  return (Array.isArray(products) ? products : []).map((entry) => {
    const current = entry as Record<string, unknown>;
    return {
      id: typeof current.id === "string" ? current.id : undefined,
      title: typeof current.titulo === "string" ? current.titulo : undefined,
      permalink: typeof current.url === "string" ? current.url : undefined,
      thumbnail: typeof current.imagem === "string" ? current.imagem : undefined,
      category_id:
        typeof current.categoriaId === "string"
          ? current.categoriaId
          : typeof current.categoria_id === "string"
            ? current.categoria_id
            : null,
      price: typeof current.preco === "number" ? current.preco : undefined,
      original_price: typeof current.precoAntigo === "number" ? current.precoAntigo : null,
      currency_id: typeof current.moeda === "string" ? current.moeda : undefined,
      available_quantity: typeof current.estoque === "number" ? current.estoque : undefined,
      sold_quantity: typeof current.vendidos === "number" ? current.vendidos : undefined,
      condition: typeof current.condicao === "string" ? current.condicao : undefined,
      status: typeof current.status === "string" ? current.status : undefined,
    };
  });
};

const collectProductsByTerms = async (params: {
  userId: number;
  terms: string[];
  limit: number;
  allowPublicFallback: boolean;
}): Promise<ProductsPayload> => {
  const merged: RawProduct[] = [];
  let source: ProductsPayload["source"] = "oauth_search";
  let warning: string | null = null;
  let failedTerms = 0;
  let fallbackTerms = 0;

  for (const term of params.terms) {
    if (merged.length >= params.limit) break;
    const perTermLimit = Math.max(1, Math.min(50, params.limit - merged.length));

    try {
      const search = await searchMercadoLivre(term, {
        userId: params.userId,
        limit: perTermLimit,
      });
      merged.push(...mapSearchProducts(search.produtos));
      continue;
    } catch (error) {
      failedTerms += 1;
      if (!params.allowPublicFallback) {
        if (!isRecoverableMlTermError(error)) {
          warning = joinWarnings(warning, "Falha na busca autenticada de alguns termos.");
        }
        continue;
      }

      try {
        const search = await searchMercadoLivre(term, {
          limit: perTermLimit,
        });
        source = "marketplace";
        fallbackTerms += 1;
        merged.push(...mapSearchProducts(search.produtos));
      } catch (fallbackError) {
        if (!isRecoverableMlTermError(fallbackError)) {
          warning = joinWarnings(warning, "Falha ao buscar produtos para alguns termos.");
        }
      }
    }
  }

  const deduped = dedupeProducts(merged).slice(0, params.limit);
  if (fallbackTerms > 0) {
    warning = joinWarnings(
      warning,
      `${fallbackTerms} termo(s) usaram fallback público para ampliar os resultados.`,
    );
  }
  if (failedTerms > 0 && deduped.length > 0) {
    warning = joinWarnings(
      warning,
      `${failedTerms} termo(s) com erro/sem retorno foram ignorados automaticamente.`,
    );
  }

  return {
    paging: {
      total: deduped.length,
      limit: params.limit,
      offset: 0,
    },
    results: deduped,
    source,
    warning: warning || undefined,
  };
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const siteId = (url.searchParams.get("siteId") || DEFAULT_SITE_ID).trim().toUpperCase();
    const rawCategoryName = (
      url.searchParams.get("categoryName") ||
      url.searchParams.get("query") ||
      ""
    ).trim();
    const allCategories = isAllCategoriesQuery(rawCategoryName) || isTruthy(url.searchParams.get("allCategories"));
    const categoryName = allCategories ? ALL_CATEGORIES_TOKEN : rawCategoryName;
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
      : Math.max(limit * 2, 100);
    const collectLimit = Math.min(MAX_LIMIT, Math.max(limit + offset, collectLimitBase));

    if (!categoryName && !allCategories) {
      return NextResponse.json(
        { status: false, message: "Informe o termo da busca em categoryName." },
        { status: 400 },
      );
    }

    let accessToken: string | null = null;
    let sourceWarning: string | null = null;

    try {
      accessToken = await getValidAffiliateAccessToken(user.id, "mercadolivre");
    } catch (error) {
      sourceWarning =
        error instanceof Error
          ? `${error.message} Busca pública será usada como fallback quando necessário.`
          : "Conta OAuth indisponível. Busca pública será usada como fallback quando necessário.";
    }

    let trendKeywords: string[] = [];
    if (preferHighDemand) {
      try {
        trendKeywords = await fetchTrendsKeywords({
          siteId,
          accessToken,
        });
      } catch {
        trendKeywords = [];
      }
    }

    const terms = allCategories
      ? buildAllCategoriesTerms(preferHighDemand ? trendKeywords : [], mode)
      : preferHighDemand
        ? buildSearchTerms(categoryName, trendKeywords, mode)
        : buildSearchTerms(categoryName, [], mode);

    if (!allCategories && terms.length === 0) {
      return NextResponse.json(
        { status: false, message: "Não foi possível montar termos de busca para esse filtro." },
        { status: 400 },
      );
    }

    const payload = await collectProductsByTerms({
      userId: user.id,
      terms,
      limit: collectLimit,
      allowPublicFallback: true,
    });

    const candidateProducts = payload.results.slice(offset, offset + collectLimit);

    const links = await listAffiliateMlLinksForUser(user.id);
    const linksByItemId = new Map(links.map((entry) => [normalizeItemId(entry.itemId), entry]));

    const generatedLinkByOrigin = new Map<string, string>();
    let autoAffiliateMeta: { enabled: boolean; generated: number; tag?: string; warning?: string } = {
      enabled: autoAffiliate,
      generated: 0,
    };

    if (autoAffiliate) {
      const candidateUrls = Array.from(
        new Set(
          candidateProducts
            .map((entry) => (typeof entry?.permalink === "string" ? entry.permalink : null))
            .filter((entry): entry is string => Boolean(entry)),
        ),
      );
      if (candidateUrls.length > 0) {
        try {
          const generated = await generateAffiliateMlLinksForUser(user.id, candidateUrls);
          generated.links.forEach((entry) => {
            const comparable = normalizeComparableUrl(entry.originUrl);
            if (!comparable || !entry.shortUrl) return;
            generatedLinkByOrigin.set(comparable, entry.shortUrl);
          });
          autoAffiliateMeta = {
            enabled: true,
            generated: generated.links.length,
            tag: generated.tag,
            warning:
              joinWarnings(
                sourceWarning,
                generated.warning ||
                  (generated.links.length === 0
                    ? "Nenhum link afiliado elegível foi gerado para este termo."
                    : null),
              ) ?? undefined,
          };
        } catch (error) {
          autoAffiliateMeta = {
            enabled: true,
            generated: 0,
            warning:
              error instanceof Error
                ? sourceWarning
                  ? `${sourceWarning} ${error.message}`
                  : error.message
                : "Não foi possível gerar links afiliados automáticos nesta consulta.",
          };
        }
      }
    }

    const mappedProducts = candidateProducts.map((entry) => {
      const itemId = normalizeItemId(typeof entry.id === "string" ? entry.id : "");
      const mappedLink = itemId ? linksByItemId.get(itemId) : null;
      const comparablePermalink = normalizeComparableUrl(
        typeof entry.permalink === "string" ? entry.permalink : null,
      );
      const generatedLink = comparablePermalink ? generatedLinkByOrigin.get(comparablePermalink) ?? null : null;
      const available = mappedLink?.available ?? (
        typeof entry.available_quantity === "number"
          ? entry.available_quantity > 0
          : typeof entry.status === "string" && entry.status.trim()
            ? entry.status.trim().toLowerCase() === "active"
            : typeof entry.sold_quantity === "number" && entry.sold_quantity > 0
              ? true
              : null
      );

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
        currencyId: typeof entry.currency_id === "string" ? entry.currency_id : null,
        availableQuantity:
          typeof entry.available_quantity === "number" ? entry.available_quantity : null,
        soldQuantity: typeof entry.sold_quantity === "number" ? entry.sold_quantity : null,
        condition: typeof entry.condition === "string" ? entry.condition : null,
        status: typeof entry.status === "string" ? entry.status : null,
        available,
        affiliateUrl: mappedLink?.affiliateUrl ?? generatedLink,
      };
    });

    const withAffiliate = mappedProducts.filter((entry) => Boolean(entry.affiliateUrl));
    const products = (autoAffiliate ? withAffiliate : mappedProducts).slice(0, limit);

    const highDemandWarning = preferHighDemand
      ? mode === "aggressive"
        ? "Garimpo agressivo ativo: termo base + promoções/cupons + tendências."
        : mode === "promotions"
          ? "Garimpo de promoções ativo: termo base + ofertas/descontos + tendências."
          : terms.length > 1
            ? "Resultados priorizados por alta demanda (termo + tendências)."
            : null
      : mode !== "standard"
        ? "Garimpo por promoções/cupons ativo."
        : null;
    const validTargetWarning =
      autoAffiliate && withAffiliate.length < limit
        ? `Foram encontrados ${withAffiliate.length} produto(s) com link afiliado válido para um alvo de ${limit}. O sistema mantém somente válidos para evitar cards quebrados.`
        : null;
    const mergedWarning = [sourceWarning, payload.warning, highDemandWarning, validTargetWarning]
      .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      .join(" ") || null;

    console.info("[affiliates-ml-products] fetch-success", {
      userId: user.id,
      siteId,
      categoryName,
      source: payload.source,
      termsUsed: terms.slice(0, 6),
      returned: products.length,
      warning: mergedWarning,
    });

    return NextResponse.json({
      status: true,
      siteId,
      categoryId: null,
      categoryName: allCategories ? "Todas categorias" : categoryName,
      allCategories,
      mode,
      paging: {
        total: autoAffiliate ? withAffiliate.length : mappedProducts.length,
        limit,
        offset,
      },
      source: payload.source,
      products,
      autoAffiliate: autoAffiliateMeta,
      warning:
        mergedWarning ||
        (products.length === 0 ? "Nenhum produto foi encontrado para este termo no momento." : null),
      note:
        "Use autoAffiliate=true para tentar gerar links via cookie do Link Builder. Sem isso, retorna apenas links já mapeados na aba Produtos. Para maior volume, aumente o limit e use mode=promotions ou mode=aggressive.",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar os produtos para o termo informado.";
    console.error("[affiliates-ml-products] fetch-error", {
      message,
      error,
    });
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
