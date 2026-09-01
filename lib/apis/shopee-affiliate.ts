import crypto from "node:crypto";

import { getAffiliateProviderSelectedCredentialForUser } from "lib/affiliate-connections";
import { getAffiliateProviderRuntimeConfig } from "lib/admin-affiliate-providers";

const SHOPEE_GRAPHQL_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_PAGE = 1;
const DEFAULT_LIST_TYPE = 0;
const DEFAULT_SORT_TYPE = 2;

type ShopeeProductOfferV2Node = {
  itemId?: number | string | null;
  productName?: string | null;
  productLink?: string | null;
  offerLink?: string | null;
  imageUrl?: string | null;
  price?: string | number | null;
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  sales?: number | string | null;
  shopName?: string | null;
  shopId?: number | string | null;
  productCatIds?: Array<number | string | null> | null;
  priceDiscountRate?: number | null;
  commissionRate?: string | null;
  ratingStar?: string | null;
  periodStartTime?: number | string | null;
  periodEndTime?: number | string | null;
  sellerCommissionRate?: string | null;
  shopeeCommissionRate?: string | null;
  appExistRate?: string | null;
  appNewRate?: string | null;
  webExistRate?: string | null;
  webNewRate?: string | null;
};

type ShopeeGraphQLError = {
  message?: string;
  path?: string[];
  extensions?: {
    code?: number | string;
    message?: string;
  };
};

type ShopeeProductOfferV2Connection = {
  pageInfo?: {
    page?: number | null;
    limit?: number | null;
    hasNextPage?: boolean | null;
  } | null;
  nodes?: ShopeeProductOfferV2Node[] | null;
};

type ShopeeShortLinkMutationResult = {
  shortLink?: string | null;
};

type ShopeeBatchShortLinkMutationResult = {
  total?: number | null;
  successCount?: number | null;
  links?:
    | Array<{
        originUrl?: string | null;
        shortLink?: string | null;
        success?: boolean | null;
        errorMessage?: string | null;
      }>
    | null;
};

type ShopeeOfferV2Node = {
  offerName?: string | null;
  offerType?: number | string | null;
  offerLink?: string | null;
  originalLink?: string | null;
  imageUrl?: string | null;
  commissionRate?: string | null;
  categoryId?: number | string | null;
  collectionId?: number | string | null;
  periodStartTime?: number | string | null;
  periodEndTime?: number | string | null;
};

type ShopeeOfferV2Connection = {
  pageInfo?: {
    page?: number | null;
    limit?: number | null;
    hasNextPage?: boolean | null;
  } | null;
  nodes?: ShopeeOfferV2Node[] | null;
};

type ShopeeShopOfferV2Node = {
  shopId?: number | string | null;
  shopName?: string | null;
  offerLink?: string | null;
  originalLink?: string | null;
  imageUrl?: string | null;
  commissionRate?: string | null;
  ratingStar?: string | null;
  shopType?: string | null;
  sellerCommCoveRatio?: string | null;
  remainingBudget?: string | number | null;
  periodStartTime?: number | string | null;
  periodEndTime?: number | string | null;
};

type ShopeeShopOfferV2Connection = {
  pageInfo?: {
    page?: number | null;
    limit?: number | null;
    hasNextPage?: boolean | null;
  } | null;
  nodes?: ShopeeShopOfferV2Node[] | null;
};

type ShopeeItemFeedNode = {
  datafeedId?: string | null;
  referenceId?: string | null;
  datafeedName?: string | null;
  description?: string | null;
  totalCount?: number | string | null;
  date?: string | null;
  feedMode?: string | null;
};

type ShopeeItemFeedsConnection = {
  feeds?: ShopeeItemFeedNode[] | null;
};

type ShopeeItemFeedDataRowQuery = {
  columns?: string | null;
  updateType?: string | null;
};

type ShopeeItemFeedDataConnection = {
  pageInfo?: {
    offset?: number | string | null;
    limit?: number | string | null;
    totalCount?: number | string | null;
    hasMore?: boolean | null;
  } | null;
  rows?: ShopeeItemFeedDataRowQuery[] | null;
};

type ShopeeAffiliateProduct = {
  id: string | null;
  titulo: string | null;
  descricaoCurta: string | null;
  url: string | null;
  imagem: string | null;
  preco: number | null;
  precoFormatado: string | null;
  precoAntigo: number | null;
  precoAntigoFormatado: string | null;
  precoParcelado: string | null;
  moeda: string | null;
  condicao: string | null;
  categoriaId: string | null;
  vendidos: number | null;
  estoque: number | null;
  aceitaMercadoPago: boolean | null;
  status: string | null;
  garantia: string | null;
  freteGratis: boolean;
  freteModo: string | null;
  freteLogistica: string | null;
  freteTexto: string | null;
  atributosResumo: string[];
  tags: string[];
  variacoes: number;
  disponivel: boolean;
  vendedor: {
    id: number | null;
    nickname: string | null;
    reputacaoNivel: string | null;
    lojaOficialId: number | null;
    permalink: string | null;
  };
  pictures: Array<{ id: string | null; url: string | null }>;
  raw: {
    search: unknown;
    detail: unknown;
  };
  shopee: {
    commissionRate: string | null;
    ratingStar: string | null;
    discountRate: number | null;
    shopId: string | null;
    shopName: string | null;
    offerLink: string | null;
    productLink: string | null;
  };
};

type ShopeeAffiliateSearchResult = {
  consulta: {
    termo: string;
    limit: number;
    page: number;
    modo: "busca" | "link";
    itemId?: string;
    listType: number;
    sortType: number | null;
  };
  paging: {
    total: number;
    limit: number;
    offset: number;
    hasNextPage: boolean;
  };
  filtros: unknown[];
  fonte: string;
  produtos: ShopeeAffiliateProduct[];
};

type ShopeeAffiliateSearchOptions = {
  limit?: number | string | null;
  page?: number | string | null;
  listType?: number | string | null;
  sortType?: number | string | null;
  itemId?: string | number | null;
  shopId?: string | number | null;
  categoryId?: string | number | null;
  userId?: number | null;
  connectionId?: number | null;
};

type ShopeeAffiliateShortLinkResult = {
  originUrl: string;
  shortUrl: string | null;
  ok: boolean;
  error: string | null;
};

type ShopeeConversionReportOrderItem = {
  itemId: string | null;
  itemName: string | null;
  qty: number | null;
  itemPrice: number | null;
  actualAmount: number | null;
  refundAmount: number | null;
  itemCommission: number | null;
  itemTotalCommission: number | null;
  itemSellerCommission: number | null;
  itemShopeeCommissionCapped: number | null;
  attributionType: string | null;
  campaignPartnerName: string | null;
  campaignType: string | null;
  fraudStatus: string | null;
};

type ShopeeConversionReportOrder = {
  orderId: string | null;
  shopType: string | null;
  orderStatus: string | null;
  items: ShopeeConversionReportOrderItem[];
};

type ShopeeConversionReportEntry = {
  clickTime: number | null;
  purchaseTime: number | null;
  conversionId: string | null;
  conversionStatus: string | null;
  grossCommission: number | null;
  sellerCommission: number | null;
  shopeeCommissionCapped: number | null;
  totalCommission: number | null;
  netCommission: number | null;
  buyerType: string | null;
  device: string | null;
  productType: string | null;
  referrer: string | null;
  orders: ShopeeConversionReportOrder[];
};

type ShopeeConversionReportQueryOrderItem = {
  itemId?: number | string | null;
  itemName?: string | null;
  qty?: number | string | null;
  itemPrice?: string | number | null;
  actualAmount?: string | number | null;
  refundAmount?: string | number | null;
  itemCommission?: string | number | null;
  itemTotalCommission?: string | number | null;
  itemSellerCommission?: string | number | null;
  itemShopeeCommissionCapped?: string | number | null;
  attributionType?: string | null;
  campaignPartnerName?: string | null;
  campaignType?: string | null;
  fraudStatus?: string | null;
};

type ShopeeConversionReportQueryOrder = {
  orderId?: number | string | null;
  shopType?: string | null;
  orderStatus?: string | null;
  items?: ShopeeConversionReportQueryOrderItem[] | null;
};

type ShopeeConversionReportQueryNode = {
  clickTime?: number | string | null;
  purchaseTime?: number | string | null;
  conversionId?: number | string | null;
  conversionStatus?: string | null;
  grossCommission?: string | number | null;
  sellerCommission?: string | number | null;
  shopeeCommissionCapped?: string | number | null;
  totalCommission?: string | number | null;
  netCommission?: string | number | null;
  buyerType?: string | null;
  device?: string | null;
  productType?: string | null;
  referrer?: string | null;
  orders?: ShopeeConversionReportQueryOrder[] | null;
};

type ShopeeConversionReportResult = {
  paging: {
    page: number | null;
    limit: number;
    hasNextPage: boolean;
    scrollId: string | null;
  };
  summary: {
    rows: number;
    conversions: number;
    orders: number;
    items: number;
    totalCommission: number;
    netCommission: number;
    clicksWithPurchase: number;
    conversionStatus: Array<{ status: string; count: number }>;
    orderStatus: Array<{ status: string; count: number }>;
  };
  entries: ShopeeConversionReportEntry[];
};

type ShopeeOfferCampaignEntry = {
  offerName: string | null;
  offerType: number | null;
  offerLink: string | null;
  originalLink: string | null;
  imageUrl: string | null;
  commissionRate: string | null;
  categoryId: string | null;
  collectionId: string | null;
  periodStartTime: number | null;
  periodEndTime: number | null;
};

type ShopeeOfferCampaignResult = {
  paging: {
    page: number | null;
    limit: number;
    hasNextPage: boolean;
  };
  entries: ShopeeOfferCampaignEntry[];
};

type ShopeeOfferCampaignOptions = {
  keyword?: string | null;
  page?: number | string | null;
  limit?: number | string | null;
  sortType?: number | string | null;
  userId?: number | null;
};

type ShopeeShopOfferEntry = {
  shopId: string | null;
  shopName: string | null;
  offerLink: string | null;
  originalLink: string | null;
  imageUrl: string | null;
  commissionRate: string | null;
  ratingStar: string | null;
  shopType: string | null;
  sellerCommCoveRatio: string | null;
  remainingBudget: string | null;
  periodStartTime: number | null;
  periodEndTime: number | null;
};

type ShopeeShopOfferResult = {
  paging: {
    page: number | null;
    limit: number;
    hasNextPage: boolean;
  };
  entries: ShopeeShopOfferEntry[];
};

type ShopeeShopOfferOptions = {
  keyword?: string | null;
  page?: number | string | null;
  limit?: number | string | null;
  sortType?: number | string | null;
  userId?: number | null;
};

type ShopeeFeedMode = "FULL" | "DELTA";

type ShopeeItemFeedEntry = {
  datafeedId: string;
  referenceId: string | null;
  datafeedName: string | null;
  description: string | null;
  totalCount: number;
  date: string | null;
  feedMode: ShopeeFeedMode | null;
};

type ShopeeItemFeedsResult = {
  mode: ShopeeFeedMode;
  entries: ShopeeItemFeedEntry[];
};

type ShopeeItemFeedDataRow = {
  columnsRaw: string;
  columns: Record<string, unknown> | null;
  updateType: string | null;
  itemId: string | null;
  productLink: string | null;
  offerLink: string | null;
  title: string | null;
  price: number | null;
  salePrice: number | null;
};

type ShopeeItemFeedDataResult = {
  pageInfo: {
    offset: number;
    limit: number;
    totalCount: number;
    hasMore: boolean;
  };
  rows: ShopeeItemFeedDataRow[];
};

type ShopeeItemFeedDataOptions = {
  datafeedId: string;
  offset?: number | string | null;
  limit?: number | string | null;
  userId?: number | null;
};

type ShopeeConversionReportOptions = {
  limit?: number | string | null;
  scrollId?: string | null;
  purchaseTimeStart?: number | string | null;
  purchaseTimeEnd?: number | string | null;
  completeTimeStart?: number | string | null;
  completeTimeEnd?: number | string | null;
  shopId?: number | string | null;
  orderId?: string | null;
  userId?: number | null;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
};

const normalizeUrl = (value: unknown): string | null => {
  const base = normalizeText(value);
  if (!base) return null;
  const candidate = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toInt = (value: unknown): number | null => {
  const numberValue = toNumber(value);
  if (numberValue === null) return null;
  return Math.trunc(numberValue);
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = toInt(value);
  if (parsed === null) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const formatCurrency = (value: number | null): string | null => {
  if (value === null || !Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `R$ ${value.toFixed(2).replace(".", ",")}`;
  }
};

const normalizeItemId = (value: unknown): string | null => {
  const text = value == null ? "" : String(value);
  const normalized = text.trim().replace(/[^\d]/g, "");
  return normalized || null;
};

const normalizeShopId = (value: unknown): string | null => {
  const text = value == null ? "" : String(value);
  const normalized = text.trim().replace(/[^\d]/g, "");
  return normalized || null;
};

const normalizeCategoryId = (value: unknown): string | null => {
  if (value == null) return null;
  const numeric = String(value).trim().replace(/[^\d]/g, "");
  return numeric || null;
};

const normalizeShopeeFeedMode = (value: unknown): ShopeeFeedMode | null => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "FULL" || normalized === "DELTA") return normalized;
  return null;
};

const parseJsonObject = (value: string | null | undefined): Record<string, unknown> | null => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const pickStringFromObject = (obj: Record<string, unknown> | null, keys: string[]): string | null => {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
};

const decodeHtmlEntities = (value: string): string => {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#x3a;/gi, ":")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u003F/gi, "?")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
};

const collectDecodeVariants = (value: string): string[] => {
  const seed = String(value || "").trim();
  if (!seed) return [];
  const queue = [seed];
  const seen = new Set<string>();
  const results: string[] = [];
  for (let depth = 0; depth < 4 && queue.length > 0; depth += 1) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    results.push(current);

    const htmlDecoded = decodeHtmlEntities(current);
    if (htmlDecoded && !seen.has(htmlDecoded)) {
      queue.push(htmlDecoded);
    }

    const plusAsSpace = current.replace(/\+/g, "%20");
    const candidates = [current, plusAsSpace];
    for (const candidate of candidates) {
      try {
        const decoded = decodeURIComponent(candidate);
        if (decoded && !seen.has(decoded)) {
          queue.push(decoded);
        }
      } catch {
        // ignore malformed URI sequence
      }
    }
  }
  return results;
};

const extractShopeeIdsFromText = (valueRaw: string): { shopId: string | null; itemId: string | null } => {
  const variants = collectDecodeVariants(valueRaw);
  for (const variant of variants) {
    const productMatch = variant.match(/\/product\/(\d+)\/(\d+)(?=$|[^0-9])/i);
    if (productMatch) {
      const shopId = normalizeShopId(productMatch[1]);
      const itemId = normalizeItemId(productMatch[2]);
      if (itemId) return { shopId, itemId };
    }

    const productPathMatch = variant.match(/\/i\.(\d+)\.(\d+)(?=$|[^0-9])/i);
    if (productPathMatch) {
      const shopId = normalizeShopId(productPathMatch[1]);
      const itemId = normalizeItemId(productPathMatch[2]);
      if (itemId) return { shopId, itemId };
    }

    const affiliateShareMatch = variant.match(/\/opaanlp\/(\d+)\/(\d+)(?=$|[^0-9])/i);
    if (affiliateShareMatch) {
      const shopId = normalizeShopId(affiliateShareMatch[1]);
      const itemId = normalizeItemId(affiliateShareMatch[2]);
      if (itemId) return { shopId, itemId };
    }

    const pairMatch = variant.match(/(?:shop(?:_|)id)\s*[:=]\s*["']?(\d+)["']?[\s,&;|]+(?:item(?:_|)id)\s*[:=]\s*["']?(\d+)["']?/i);
    if (pairMatch) {
      const shopId = normalizeShopId(pairMatch[1]);
      const itemId = normalizeItemId(pairMatch[2]);
      if (itemId) return { shopId, itemId };
    }

    const itemMatch = variant.match(/(?:item(?:_|)id)\s*[:=]\s*["']?(\d+)["']?/i);
    if (itemMatch) {
      const itemId = normalizeItemId(itemMatch[1]);
      const shopMatch = variant.match(/(?:shop(?:_|)id)\s*[:=]\s*["']?(\d+)["']?/i);
      const shopId = normalizeShopId(shopMatch?.[1]);
      if (itemId) return { shopId, itemId };
    }
  }
  return { shopId: null, itemId: null };
};

const buildShopeeProductUrlFromIds = (ids: { shopId: string | null; itemId: string | null }): string | null => {
  if (!ids.itemId) return null;
  const shopId = normalizeShopId(ids.shopId) || "0";
  return `https://shopee.com.br/product/${shopId}/${ids.itemId}`;
};

const parseShopeeProductIdsFromUrl = (
  urlRaw: string,
  depth = 0,
): { shopId: string | null; itemId: string | null } => {
  const urlBase = normalizeText(urlRaw);
  if (!urlBase) return { shopId: null, itemId: null };
  if (depth > 3) return { shopId: null, itemId: null };
  const directFromText = extractShopeeIdsFromText(urlBase);
  if (directFromText.itemId) {
    return directFromText;
  }
  const url = normalizeUrl(urlBase);
  if (!url) return directFromText;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    const productMatch = pathname.match(/\/product\/(\d+)\/(\d+)(?=$|[^0-9])/i);
    if (productMatch) {
      return {
        shopId: normalizeShopId(productMatch[1]),
        itemId: normalizeItemId(productMatch[2]),
      };
    }

    const productPathMatch = pathname.match(/\/i\.(\d+)\.(\d+)(?=$|[^0-9])/i);
    if (productPathMatch) {
      return {
        shopId: normalizeShopId(productPathMatch[1]),
        itemId: normalizeItemId(productPathMatch[2]),
      };
    }

    const queryItemId =
      normalizeItemId(parsed.searchParams.get("itemid")) ||
      normalizeItemId(parsed.searchParams.get("item_id"));
    const queryShopId =
      normalizeShopId(parsed.searchParams.get("shopid")) ||
      normalizeShopId(parsed.searchParams.get("shop_id"));

    if (queryItemId) {
      return {
        shopId: queryShopId,
        itemId: queryItemId,
      };
    }

    const embeddedUrlKeys = [
      "url",
      "redirect",
      "redirect_url",
      "target",
      "to",
      "deeplink",
      "deep_link",
      "af_dp",
      "af_web_dp",
      "destination",
      "dest",
      "u",
      "r",
    ];
    for (const key of embeddedUrlKeys) {
      const rawValue = parsed.searchParams.get(key);
      if (!rawValue) continue;
      const nested = parseShopeeProductIdsFromUrl(rawValue, depth + 1);
      if (nested.itemId) {
        return nested;
      }
    }

    const fromPath = extractShopeeIdsFromText(`${parsed.pathname}?${parsed.searchParams.toString()}`);
    if (fromPath.itemId) {
      return {
        shopId: fromPath.shopId || queryShopId,
        itemId: fromPath.itemId,
      };
    }

    return {
      shopId: queryShopId,
      itemId: null,
    };
  } catch {
    return directFromText;
  }
};

const normalizeShopeeKeywordHint = (value: string): string | null => {
  const normalized = String(value || "")
    .replace(/[-_.+/]+/g, " ")
    .replace(/\b(cat|categoria|category)\b/gi, " ")
    .replace(/[^0-9a-zA-ZÀ-ÿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 2) {
    return null;
  }
  return normalized.slice(0, 80);
};

const extractShopeeCategoryHintFromUrl = (
  valueRaw: string,
): { categoryId: string | null; keyword: string | null } => {
  const raw = normalizeText(valueRaw);
  if (!raw) return { categoryId: null, keyword: null };

  const variants = collectDecodeVariants(raw);
  for (const variant of variants) {
    const candidateUrl = normalizeUrl(variant);
    if (!candidateUrl) {
      continue;
    }
    try {
      const parsed = new URL(candidateUrl);
      const path = (() => {
        try {
          return decodeURIComponent(parsed.pathname || "");
        } catch {
          return parsed.pathname || "";
        }
      })();

      let categoryId =
        normalizeCategoryId(parsed.searchParams.get("categoryid")) ||
        normalizeCategoryId(parsed.searchParams.get("category_id")) ||
        normalizeCategoryId(parsed.searchParams.get("catid")) ||
        normalizeCategoryId(parsed.searchParams.get("cat_id")) ||
        normalizeCategoryId(parsed.searchParams.get("productCatId"));

      let keyword =
        normalizeShopeeKeywordHint(parsed.searchParams.get("keyword") || "") ||
        normalizeShopeeKeywordHint(parsed.searchParams.get("q") || "") ||
        normalizeShopeeKeywordHint(parsed.searchParams.get("k") || "");

      const slugCategoryMatch = path.match(/\/([^/?#]+)-cat\.(\d+)(?=$|[/?#])/i);
      if (slugCategoryMatch) {
        categoryId = categoryId || normalizeCategoryId(slugCategoryMatch[2]);
        keyword = keyword || normalizeShopeeKeywordHint(slugCategoryMatch[1]);
      }

      const categoryOnlyMatch = path.match(/(?:^|\/)(?:cat|category)\.(\d+)(?=$|[/?#])/i);
      if (categoryOnlyMatch) {
        categoryId = categoryId || normalizeCategoryId(categoryOnlyMatch[1]);
      }

      if (!keyword) {
        const firstSegment = path.split("/").filter(Boolean)[0] || "";
        keyword = normalizeShopeeKeywordHint(firstSegment.replace(/\.html?$/i, ""));
      }

      if (categoryId || keyword) {
        return {
          categoryId: categoryId || null,
          keyword: keyword || null,
        };
      }
    } catch {
      // ignore malformed URL variant
    }
  }

  return { categoryId: null, keyword: null };
};

const extractRedirectUrlFromHtml = (htmlRaw: string): string | null => {
  const html = String(htmlRaw || "");
  if (!html.trim()) return null;
  const patterns = [
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"']+)["']/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.replace\(\s*["']([^"']+)["']\s*\)/i,
    /location\.assign\(\s*["']([^"']+)["']\s*\)/i,
    /["']redirect_uri["']\s*:\s*["']([^"']+)["']/i,
    /\bhttpUrl\s*:\s*["']([^"']+)["']/i,
    /\bdeepLinkUrl\s*:\s*["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const decoded = (() => {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    })();
    const cleaned = decodeHtmlEntities(decoded);
    const normalized = normalizeUrl(cleaned);
    if (normalized) return normalized;

    const navigateUrlMatch = cleaned.match(/[?&]navigate_url=([^&#]+)/i);
    if (navigateUrlMatch?.[1]) {
      const nested = (() => {
        try {
          return decodeURIComponent(navigateUrlMatch[1]);
        } catch {
          return navigateUrlMatch[1];
        }
      })();
      const normalizedNested = normalizeUrl(decodeHtmlEntities(nested));
      if (normalizedNested) return normalizedNested;
    }
  }
  const generic = html.match(/https?:\/\/[^\s"'<>]+shopee\.[^\s"'<>]+/i);
  if (generic?.[0]) {
    return normalizeUrl(generic[0]);
  }
  return null;
};

const resolveShortLink = async (urlRaw: string): Promise<string> => {
  const normalized = normalizeUrl(urlRaw);
  if (!normalized) {
    throw new Error("URL da Shopee inválida.");
  }

  let currentUrl = normalized;
  const visited = new Set<string>();
  for (let hop = 0; hop < 5; hop += 1) {
    if (visited.has(currentUrl)) break;
    visited.add(currentUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
      });

      const location = response.headers.get("location");
      if (location && response.status >= 300 && response.status < 400) {
        const resolvedLocation = normalizeUrl(new URL(location, currentUrl).toString());
        if (resolvedLocation && resolvedLocation !== currentUrl) {
          currentUrl = resolvedLocation;
          continue;
        }
      }

      const responseUrl = normalizeUrl(response.url);
      if (responseUrl && responseUrl !== currentUrl) {
        currentUrl = responseUrl;
      }

      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        const html = await response.text().catch(() => "");
        const redirectedFromHtml = extractRedirectUrlFromHtml(html);
        if (redirectedFromHtml && redirectedFromHtml !== currentUrl) {
          currentUrl = redirectedFromHtml;
          continue;
        }
        const htmlIds = parseShopeeProductIdsFromUrl(html, 1);
        const htmlProductUrl = buildShopeeProductUrlFromIds(htmlIds);
        if (htmlProductUrl) {
          return htmlProductUrl;
        }
      }

      break;
    } catch {
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  const parsedCurrent = parseShopeeProductIdsFromUrl(currentUrl);
  if (parsedCurrent.itemId) {
    return currentUrl;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(normalized, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    const followedUrl = normalizeUrl(response.url);
    if (followedUrl) {
      const parsedFollowed = parseShopeeProductIdsFromUrl(followedUrl);
      if (parsedFollowed.itemId) {
        return followedUrl;
      }
      currentUrl = followedUrl;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      const html = await response.text().catch(() => "");
      const redirectedFromHtml = extractRedirectUrlFromHtml(html);
      if (redirectedFromHtml) {
        return redirectedFromHtml;
      }
      const htmlIds = parseShopeeProductIdsFromUrl(html, 1);
      const htmlProductUrl = buildShopeeProductUrlFromIds(htmlIds);
      if (htmlProductUrl) {
        return htmlProductUrl;
      }
    }
  } catch {
    // keep best effort from manual redirect flow
  } finally {
    clearTimeout(timeout);
  }

  return currentUrl;
};

const isLikelyUrl = (value: string): boolean => {
  return /https?:\/\//i.test(value) || /(?:^|\.)shopee\./i.test(value) || /s\.shopee\./i.test(value);
};

const isLikelyItemId = (value: string): boolean => {
  const normalized = value.trim();
  return /^\d{6,}$/.test(normalized);
};

const PRODUCT_OFFER_QUERY = `
  query ShopeeProductOffer(
    $keyword: String
    $itemId: Int64
    $shopId: Int64
    $productCatId: Int
    $listType: Int
    $sortType: Int
    $page: Int
    $limit: Int
    $isKeySeller: Boolean
  ) {
    productOfferV2(
      keyword: $keyword
      itemId: $itemId
      shopId: $shopId
      productCatId: $productCatId
      listType: $listType
      sortType: $sortType
      page: $page
      limit: $limit
      isKeySeller: $isKeySeller
    ) {
      pageInfo {
        page
        limit
        hasNextPage
      }
      nodes {
        itemId
        productName
        productLink
        offerLink
        imageUrl
        price
        priceMin
        priceMax
        sales
        shopName
        shopId
        productCatIds
        priceDiscountRate
        commissionRate
        ratingStar
        periodStartTime
        periodEndTime
        sellerCommissionRate
        shopeeCommissionRate
        appExistRate
        appNewRate
        webExistRate
        webNewRate
      }
    }
  }
`;

const GENERATE_SHORT_LINK_MUTATION = `
  mutation ShopeeGenerateShortLink($input: ShortLinkInput!) {
    generateShortLink(input: $input) {
      shortLink
    }
  }
`;

const GENERATE_BATCH_SHORT_LINK_MUTATION = `
  mutation ShopeeGenerateBatchShortLink($input: BatchShortLinkInput!) {
    generateBatchShortLink(input: $input) {
      total
      successCount
      links {
        originUrl
        shortLink
        success
        errorMessage
      }
    }
  }
`;

const SHOPEE_OFFER_V2_QUERY = `
  query ShopeeOfferV2($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
    shopeeOfferV2(keyword: $keyword, sortType: $sortType, page: $page, limit: $limit) {
      pageInfo {
        page
        limit
        hasNextPage
      }
      nodes {
        offerName
        offerType
        offerLink
        originalLink
        imageUrl
        commissionRate
        categoryId
        collectionId
        periodStartTime
        periodEndTime
      }
    }
  }
`;

const SHOPEE_SHOP_OFFER_V2_QUERY = `
  query ShopeeShopOfferV2($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
    shopOfferV2(keyword: $keyword, sortType: $sortType, page: $page, limit: $limit) {
      pageInfo {
        page
        limit
        hasNextPage
      }
      nodes {
        shopId
        shopName
        offerLink
        originalLink
        imageUrl
        commissionRate
        ratingStar
        shopType
        sellerCommCoveRatio
        remainingBudget
        periodStartTime
        periodEndTime
      }
    }
  }
`;

const SHOPEE_LIST_ITEM_FEEDS_QUERY = `
  query ShopeeListItemFeeds($feedMode: FeedMode!) {
    listItemFeeds(feedMode: $feedMode) {
      feeds {
        datafeedId
        referenceId
        datafeedName
        description
        totalCount
        date
        feedMode
      }
    }
  }
`;

const SHOPEE_GET_ITEM_FEED_DATA_QUERY = `
  query ShopeeGetItemFeedData($datafeedId: String!, $offset: Int, $limit: Int) {
    getItemFeedData(datafeedId: $datafeedId, offset: $offset, limit: $limit) {
      pageInfo {
        offset
        limit
        totalCount
        hasMore
      }
      rows {
        columns
        updateType
      }
    }
  }
`;

const CONVERSION_REPORT_QUERY_SCROLL = `
  query ShopeeConversionReportScroll($limit: Int, $scrollId: String!) {
    conversionReport(limit: $limit, scrollId: $scrollId) {
      pageInfo {
        page
        limit
        hasNextPage
        scrollId
      }
      nodes {
        clickTime
        purchaseTime
        conversionId
        conversionStatus
        grossCommission
        sellerCommission
        shopeeCommissionCapped
        totalCommission
        netCommission
        buyerType
        device
        productType
        referrer
        orders {
          orderId
          shopType
          orderStatus
          items {
            itemId
            itemName
            qty
            itemPrice
            actualAmount
            refundAmount
            itemCommission
            itemTotalCommission
            itemSellerCommission
            itemShopeeCommissionCapped
            attributionType
            campaignPartnerName
            campaignType
            fraudStatus
          }
        }
      }
    }
  }
`;

const CONVERSION_REPORT_QUERY_FILTERED = `
  query ShopeeConversionReportFiltered(
    $limit: Int
    $purchaseTimeStart: Int64
    $purchaseTimeEnd: Int64
    $completeTimeStart: Int64
    $completeTimeEnd: Int64
    $shopId: Int64
    $orderId: String
  ) {
    conversionReport(
      limit: $limit
      purchaseTimeStart: $purchaseTimeStart
      purchaseTimeEnd: $purchaseTimeEnd
      completeTimeStart: $completeTimeStart
      completeTimeEnd: $completeTimeEnd
      shopId: $shopId
      orderId: $orderId
    ) {
      pageInfo {
        page
        limit
        hasNextPage
        scrollId
      }
      nodes {
        clickTime
        purchaseTime
        conversionId
        conversionStatus
        grossCommission
        sellerCommission
        shopeeCommissionCapped
        totalCommission
        netCommission
        buyerType
        device
        productType
        referrer
        orders {
          orderId
          shopType
          orderStatus
          items {
            itemId
            itemName
            qty
            itemPrice
            actualAmount
            refundAmount
            itemCommission
            itemTotalCommission
            itemSellerCommission
            itemShopeeCommissionCapped
            attributionType
            campaignPartnerName
            campaignType
            fraudStatus
          }
        }
      }
    }
  }
`;

const buildAuthorizationHeader = (appId: string, clientSecret: string, payload: string): string => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHash("sha256")
    .update(`${appId}${timestamp}${payload}${clientSecret}`)
    .digest("hex");
  return `SHA256 Credential=${appId},Timestamp=${timestamp},Signature=${signature}`;
};

type ShopeeResolvedCredential = {
  appId: string;
  clientSecret: string;
  source: "selected" | "runtime" | "env";
};

const readShopeeEnvCredential = (): ShopeeResolvedCredential | null => {
  const envAppId =
    normalizeText(process.env.SHOPEE_APP_ID) ||
    normalizeText(process.env.SHOPEE_APPID) ||
    normalizeText(process.env.SHOPEE_PARTNER_ID);
  const envClientSecret =
    normalizeText(process.env.SHOPEE_CLIENT_SECRET) ||
    normalizeText(process.env.SHOPEE_APP_SECRET) ||
    normalizeText(process.env.SHOPEE_SECRET);
  if (!envAppId || !envClientSecret) return null;
  return { appId: envAppId, clientSecret: envClientSecret, source: "env" };
};

const resolveShopeeCredentials = async (
  options: { userId?: number | null; preferGlobal?: boolean } = {},
): Promise<ShopeeResolvedCredential> => {
  let runtime: Awaited<ReturnType<typeof getAffiliateProviderRuntimeConfig>> | null = null;
  try {
    runtime = await getAffiliateProviderRuntimeConfig("shopee");
  } catch {
    runtime = null;
  }

  if (runtime && !runtime.enabled) {
    throw new Error("Shopee está desativado no painel admin de afiliados.");
  }

  const userId = Number(options.userId);
  const preferGlobal = Boolean(options.preferGlobal);
  if (!preferGlobal && Number.isFinite(userId) && userId > 0) {
    try {
      const selectedCredential = await getAffiliateProviderSelectedCredentialForUser(
        Math.floor(userId),
        "shopee",
      );
      const selectedAppId = normalizeText(selectedCredential?.appId);
      const selectedClientSecret = normalizeText(selectedCredential?.clientSecret);
      if (selectedAppId && selectedClientSecret) {
        return {
          appId: selectedAppId,
          clientSecret: selectedClientSecret,
          source: "selected",
        };
      }
    } catch {
      // fallback para credencial global/env
    }
  }

  const runtimeAppId = normalizeText(runtime?.appId);
  const runtimeClientSecret = normalizeText(runtime?.clientSecret);
  if (runtimeAppId && runtimeClientSecret) {
    return {
      appId: runtimeAppId,
      clientSecret: runtimeClientSecret,
      source: "runtime",
    };
  }

  const envCredential = readShopeeEnvCredential();
  if (!envCredential) {
    throw new Error("Credenciais da Shopee não configuradas. Defina AppID e Senha no admin.");
  }
  return envCredential;
};

const parseGraphQLError = (errors: ShopeeGraphQLError[] | null | undefined, status: number): string => {
  if (!Array.isArray(errors) || errors.length === 0) {
    return `Falha na Open API da Shopee (HTTP ${status}).`;
  }

  const first = errors[0];
  const extensionMessage = normalizeText(first?.extensions?.message);
  const directMessage = normalizeText(first?.message);
  const code = first?.extensions?.code != null ? String(first.extensions.code) : null;

  if (extensionMessage && code) {
    return `Shopee API [${code}]: ${extensionMessage}`;
  }
  if (extensionMessage) {
    return `Shopee API: ${extensionMessage}`;
  }
  if (directMessage && code) {
    return `Shopee API [${code}]: ${directMessage}`;
  }
  if (directMessage) {
    return `Shopee API: ${directMessage}`;
  }
  return `Falha na Open API da Shopee (HTTP ${status}).`;
};

const requestShopeeGraphQL = async <TData>(
  query: string,
  variables?: Record<string, unknown>,
  options: { userId?: number | null; allowPartialData?: boolean } = {},
): Promise<TData> => {
  const primaryCredential = await resolveShopeeCredentials(options);
  const credentialsToTry: ShopeeResolvedCredential[] = [primaryCredential];

  if (primaryCredential.source === "selected") {
    try {
      const fallbackCredential = await resolveShopeeCredentials({
        userId: options.userId,
        preferGlobal: true,
      });
      const duplicate =
        fallbackCredential.appId === primaryCredential.appId &&
        fallbackCredential.clientSecret === primaryCredential.clientSecret;
      if (!duplicate) {
        credentialsToTry.push(fallbackCredential);
      }
    } catch {
      // sem fallback global disponível
    }
  }

  const envCredential = readShopeeEnvCredential();
  if (envCredential) {
    const duplicate = credentialsToTry.some(
      (entry) =>
        entry.appId === envCredential.appId && entry.clientSecret === envCredential.clientSecret,
    );
    if (!duplicate) {
      credentialsToTry.push(envCredential);
    }
  }

  const payload = JSON.stringify({ query, ...(variables ? { variables } : {}) });
  let lastError: Error | null = null;

  for (const credential of credentialsToTry) {
    const authorization = buildAuthorizationHeader(credential.appId, credential.clientSecret, payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(SHOPEE_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization,
        },
        body: payload,
        signal: controller.signal,
        cache: "no-store",
      });

      let parsed: { data?: TData; errors?: ShopeeGraphQLError[] } | null = null;
      try {
        parsed = (await response.json()) as { data?: TData; errors?: ShopeeGraphQLError[] };
      } catch {
        parsed = null;
      }

      const hasErrors = Array.isArray(parsed?.errors) && parsed.errors.length > 0;
      if (!response.ok || !parsed?.data || (hasErrors && !options.allowPartialData)) {
        throw new Error(parseGraphQLError(parsed?.errors, response.status));
      }

      return parsed.data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Falha ao consultar a Open API da Shopee.");
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Falha ao consultar a Open API da Shopee.");
};

const mapNodeToProduct = (node: ShopeeProductOfferV2Node): ShopeeAffiliateProduct | null => {
  const itemId = normalizeItemId(node.itemId);
  if (!itemId) return null;

  const productLink = normalizeUrl(node.productLink);
  const offerLink = normalizeUrl(node.offerLink);
  const imageUrl = normalizeUrl(node.imageUrl);
  const title = normalizeText(node.productName);
  const price = toNumber(node.price);
  const priceMin = toNumber(node.priceMin);
  const priceMax = toNumber(node.priceMax);

  let oldPrice: number | null = null;
  if (priceMax !== null && price !== null && priceMax > price) {
    oldPrice = priceMax;
  } else if (priceMin !== null && price !== null && priceMin > price) {
    oldPrice = priceMin;
  }

  const categoryId = Array.isArray(node.productCatIds)
    ? normalizeCategoryId(node.productCatIds.find((entry) => entry != null))
    : null;

  const sold = toInt(node.sales);
  const shopId = normalizeShopId(node.shopId);
  const shopName = normalizeText(node.shopName);

  return {
    id: itemId,
    titulo: title,
    descricaoCurta: null,
    url: productLink || offerLink,
    imagem: imageUrl,
    preco: price,
    precoFormatado: formatCurrency(price),
    precoAntigo: oldPrice,
    precoAntigoFormatado: formatCurrency(oldPrice),
    precoParcelado: null,
    moeda: "BRL",
    condicao: "Novo",
    categoriaId: categoryId,
    vendidos: sold,
    estoque: null,
    aceitaMercadoPago: null,
    status: "active",
    garantia: null,
    freteGratis: false,
    freteModo: null,
    freteLogistica: null,
    freteTexto: null,
    atributosResumo: [],
    tags: [],
    variacoes: 0,
    disponivel: true,
    vendedor: {
      id: shopId ? Number(shopId) : null,
      nickname: shopName,
      reputacaoNivel: null,
      lojaOficialId: null,
      permalink: shopId ? `https://shopee.com.br/shop/${shopId}` : null,
    },
    pictures: imageUrl ? [{ id: null, url: imageUrl }] : [],
    raw: {
      search: node,
      detail: node,
    },
    shopee: {
      commissionRate: normalizeText(node.commissionRate),
      ratingStar: normalizeText(node.ratingStar),
      discountRate: toInt(node.priceDiscountRate),
      shopId,
      shopName,
      offerLink,
      productLink,
    },
  };
};

const queryProductOfferV2 = async (
  variables: Record<string, unknown>,
  options: { userId?: number | null } = {},
): Promise<ShopeeProductOfferV2Connection> => {
  const data = await requestShopeeGraphQL<{ productOfferV2?: ShopeeProductOfferV2Connection | null }>(
    PRODUCT_OFFER_QUERY,
    variables,
    options,
  );
  return data.productOfferV2 ?? { nodes: [], pageInfo: { page: 1, limit: 0, hasNextPage: false } };
};

const searchByKeyword = async (term: string, options: ShopeeAffiliateSearchOptions): Promise<ShopeeAffiliateSearchResult> => {
  const limit = clampInt(options.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
  const page = clampInt(options.page, DEFAULT_PAGE, 1, 100);
  const listType = clampInt(options.listType, DEFAULT_LIST_TYPE, 0, 8);
  const sortType = options.sortType === null || options.sortType === undefined
    ? DEFAULT_SORT_TYPE
    : clampInt(options.sortType, DEFAULT_SORT_TYPE, 1, 9);
  const categoryId = normalizeCategoryId(options.categoryId);
  const shopId = normalizeShopId(options.shopId);

  let connection: ShopeeProductOfferV2Connection;
  try {
    connection = await queryProductOfferV2({
      keyword: term,
      listType,
      sortType,
      page,
      limit,
      ...(categoryId ? { productCatId: Number(categoryId) } : {}),
      ...(shopId ? { shopId } : {}),
    }, { userId: options.userId });
  } catch {
    connection = await queryProductOfferV2({
      keyword: term,
      listType,
      page,
      limit,
      ...(categoryId ? { productCatId: Number(categoryId) } : {}),
      ...(shopId ? { shopId } : {}),
    }, { userId: options.userId });
  }

  const nodes = Array.isArray(connection.nodes) ? connection.nodes : [];
  const products = nodes.map(mapNodeToProduct).filter((entry): entry is ShopeeAffiliateProduct => Boolean(entry));

  return {
    consulta: {
      termo: term,
      limit,
      page,
      modo: "busca",
      listType,
      sortType,
    },
    paging: {
      total: products.length,
      limit,
      offset: Math.max(0, (page - 1) * limit),
      hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
    },
    filtros: [],
    fonte: SHOPEE_GRAPHQL_ENDPOINT,
    produtos: products,
  };
};

const searchByCategory = async (
  categoryIdRaw: string,
  options: ShopeeAffiliateSearchOptions = {},
): Promise<ShopeeAffiliateSearchResult> => {
  const categoryId = normalizeCategoryId(categoryIdRaw);
  if (!categoryId) {
    throw new Error("Categoria inválida para busca na Shopee.");
  }

  const limit = clampInt(options.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
  const page = clampInt(options.page, DEFAULT_PAGE, 1, 100);
  const listType = clampInt(options.listType, DEFAULT_LIST_TYPE, 0, 8);
  const sortType = options.sortType === null || options.sortType === undefined
    ? DEFAULT_SORT_TYPE
    : clampInt(options.sortType, DEFAULT_SORT_TYPE, 1, 9);
  const shopId = normalizeShopId(options.shopId);

  let connection: ShopeeProductOfferV2Connection;
  try {
    connection = await queryProductOfferV2({
      productCatId: Number(categoryId),
      listType,
      sortType,
      page,
      limit,
      ...(shopId ? { shopId } : {}),
    }, { userId: options.userId });
  } catch {
    connection = await queryProductOfferV2({
      productCatId: Number(categoryId),
      listType: 1,
      page,
      limit,
      ...(shopId ? { shopId } : {}),
    }, { userId: options.userId });
  }

  const nodes = Array.isArray(connection.nodes) ? connection.nodes : [];
  const products = nodes.map(mapNodeToProduct).filter((entry): entry is ShopeeAffiliateProduct => Boolean(entry));

  return {
    consulta: {
      termo: categoryId,
      limit,
      page,
      modo: "busca",
      listType,
      sortType,
    },
    paging: {
      total: products.length,
      limit,
      offset: Math.max(0, (page - 1) * limit),
      hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
    },
    filtros: [],
    fonte: SHOPEE_GRAPHQL_ENDPOINT,
    produtos: products,
  };
};

const searchByItemId = async (
  itemIdRaw: string,
  options: ShopeeAffiliateSearchOptions = {},
): Promise<ShopeeAffiliateSearchResult> => {
  const itemId = normalizeItemId(itemIdRaw);
  if (!itemId) {
    throw new Error("Não foi possível identificar o item da Shopee.");
  }

  const limit = clampInt(options.limit, 1, 1, 10);
  const page = clampInt(options.page, 1, 1, 3);
  const listType = clampInt(options.listType, DEFAULT_LIST_TYPE, 0, 8);
  const shopId = normalizeShopId(options.shopId);

  let connection: ShopeeProductOfferV2Connection;
  try {
    connection = await queryProductOfferV2({
      itemId,
      listType,
      page,
      limit,
      ...(shopId ? { shopId } : {}),
    }, { userId: options.userId });
  } catch {
    connection = await queryProductOfferV2({
      itemId,
      listType: 1,
      page,
      limit,
      ...(shopId ? { shopId } : {}),
    }, { userId: options.userId });
  }

  const nodes = Array.isArray(connection.nodes) ? connection.nodes : [];
  const products = nodes.map(mapNodeToProduct).filter((entry): entry is ShopeeAffiliateProduct => Boolean(entry));

  return {
    consulta: {
      termo: itemId,
      limit,
      page,
      modo: "link",
      itemId,
      listType,
      sortType: null,
    },
    paging: {
      total: products.length,
      limit,
      offset: 0,
      hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
    },
    filtros: [],
    fonte: SHOPEE_GRAPHQL_ENDPOINT,
    produtos: products,
  };
};

export const extractShopeeItemId = (value: string): string | null => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  if (isLikelyItemId(trimmed)) {
    return normalizeItemId(trimmed);
  }

  const ids = parseShopeeProductIdsFromUrl(trimmed);
  if (ids.itemId) return ids.itemId;

  return null;
};

export const searchShopeeAffiliate = async (
  termOrLink: string,
  options: ShopeeAffiliateSearchOptions = {},
): Promise<ShopeeAffiliateSearchResult> => {
  const term = String(termOrLink || "").trim();
  if (!term) {
    throw new Error("Informe o termo de busca, item ID ou link da Shopee.");
  }

  const forcedItemId = normalizeItemId(options.itemId);
  if (forcedItemId) {
    return searchByItemId(forcedItemId, options);
  }

  if (isLikelyItemId(term)) {
    return searchByItemId(term, options);
  }

  if (isLikelyUrl(term)) {
    const directIds = parseShopeeProductIdsFromUrl(term);
    if (directIds.itemId) {
      return searchByItemId(directIds.itemId, {
        ...options,
        ...(directIds.shopId ? { shopId: directIds.shopId } : {}),
      });
    }

    const resolved = await resolveShortLink(term);
    const resolvedIds = parseShopeeProductIdsFromUrl(resolved);
    if (resolvedIds.itemId) {
      return searchByItemId(resolvedIds.itemId, {
        ...options,
        ...(resolvedIds.shopId ? { shopId: resolvedIds.shopId } : {}),
      });
    }

    const resolvedHint = extractShopeeCategoryHintFromUrl(resolved);
    const directHint = extractShopeeCategoryHintFromUrl(term);
    const fallbackCategoryId = resolvedHint.categoryId || directHint.categoryId || null;
    const fallbackKeyword = resolvedHint.keyword || directHint.keyword || null;

    if (fallbackCategoryId) {
      const byCategory = await searchByCategory(fallbackCategoryId, options);
      if (byCategory.produtos.length > 0) {
        return byCategory;
      }
    }

    if (fallbackKeyword) {
      const byKeywordOnly = await searchByKeyword(fallbackKeyword, {
        ...options,
        categoryId: null,
      });
      if (byKeywordOnly.produtos.length > 0) {
        return byKeywordOnly;
      }
    }

    if (fallbackCategoryId || fallbackKeyword) {
      const fallback = await searchByKeyword(fallbackKeyword || "ofertas", {
        ...options,
        ...(fallbackCategoryId ? { categoryId: fallbackCategoryId } : {}),
      });
      if (fallback.produtos.length > 0) {
        return fallback;
      }
    }

    throw new Error("Não foi possível extrair o item desse link da Shopee.");
  }

  return searchByKeyword(term, options);
};

export const generateShopeeShortLink = async (
  originUrlRaw: string,
  subIds: string[] = [],
  options: { userId?: number | null } = {},
): Promise<string> => {
  const originUrl = normalizeUrl(originUrlRaw);
  if (!originUrl) {
    throw new Error("URL inválida para gerar link afiliado da Shopee.");
  }

  const cleanSubIds = Array.from(
    new Set(
      (Array.isArray(subIds) ? subIds : [])
        .map((entry) => normalizeText(entry))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 10),
    ),
  );

  const data = await requestShopeeGraphQL<{ generateShortLink?: ShopeeShortLinkMutationResult | null }>(
    GENERATE_SHORT_LINK_MUTATION,
    {
      input: {
        originUrl,
        ...(cleanSubIds.length > 0 ? { subIds: cleanSubIds } : {}),
      },
    },
    options,
  );

  const shortLink = normalizeUrl(data.generateShortLink?.shortLink);
  if (!shortLink) {
    throw new Error("Shopee não retornou short link válido.");
  }
  return shortLink;
};

export const generateShopeeShortLinksBatch = async (
  originUrls: string[],
  options: { subIds?: string[]; preferBatchMutation?: boolean; userId?: number | null } = {},
): Promise<ShopeeAffiliateShortLinkResult[]> => {
  const normalized = Array.from(
    new Set(
      (Array.isArray(originUrls) ? originUrls : [])
        .map((entry) => normalizeUrl(entry))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 200),
    ),
  );

  if (normalized.length === 0) {
    return [];
  }

  const cleanSubIds = Array.from(
    new Set(
      (Array.isArray(options.subIds) ? options.subIds : [])
        .map((entry) => normalizeText(entry))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 10),
    ),
  );

  if (options.preferBatchMutation !== false && normalized.length > 1) {
    try {
      const data = await requestShopeeGraphQL<{ generateBatchShortLink?: ShopeeBatchShortLinkMutationResult | null }>(
        GENERATE_BATCH_SHORT_LINK_MUTATION,
        {
          input: {
            links: normalized.map((originUrl) => ({
              originUrl,
              ...(cleanSubIds.length > 0 ? { subIds: cleanSubIds } : {}),
            })),
          },
        },
        { userId: options.userId },
      );

      const links = Array.isArray(data.generateBatchShortLink?.links)
        ? data.generateBatchShortLink?.links
        : [];

      if (links.length > 0) {
        const mapped = links.map((entry) => {
          const originUrl = normalizeUrl(entry.originUrl) || "";
          const shortUrl = normalizeUrl(entry.shortLink);
          const success = Boolean(entry.success) && Boolean(shortUrl);
          return {
            originUrl,
            shortUrl,
            ok: success,
            error: success ? null : normalizeText(entry.errorMessage) || "Falha ao gerar short link.",
          } as ShopeeAffiliateShortLinkResult;
        });

        if (mapped.some((entry) => entry.originUrl)) {
          return normalized.map((originUrl) => {
            const found = mapped.find((entry) => entry.originUrl === originUrl);
            return (
              found || {
                originUrl,
                shortUrl: null,
                ok: false,
                error: "Falha ao gerar short link.",
              }
            );
          });
        }
      }
    } catch {
      // fallback para chamadas unitárias
    }
  }

  const results: ShopeeAffiliateShortLinkResult[] = [];
  for (const originUrl of normalized) {
    try {
      const shortUrl = await generateShopeeShortLink(originUrl, cleanSubIds, {
        userId: options.userId,
      });
      results.push({ originUrl, shortUrl, ok: true, error: null });
    } catch (error) {
      results.push({
        originUrl,
        shortUrl: null,
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao gerar short link.",
      });
    }
  }
  return results;
};

export const fetchShopeeOfferCampaigns = async (
  options: ShopeeOfferCampaignOptions = {},
): Promise<ShopeeOfferCampaignResult> => {
  const limit = clampInt(options.limit, 20, 1, 50);
  const page = clampInt(options.page, 1, 1, 100);
  const sortType =
    options.sortType === null || options.sortType === undefined
      ? 2
      : clampInt(options.sortType, 2, 1, 9);
  const keyword = normalizeText(options.keyword);

  const data = await requestShopeeGraphQL<{ shopeeOfferV2?: ShopeeOfferV2Connection | null }>(
    SHOPEE_OFFER_V2_QUERY,
    {
      ...(keyword ? { keyword } : {}),
      sortType,
      page,
      limit,
    },
    { userId: options.userId },
  );

  const connection = data.shopeeOfferV2 ?? null;
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];

  return {
    paging: {
      page: typeof connection?.pageInfo?.page === "number" ? Math.max(1, Math.floor(connection.pageInfo.page)) : page,
      limit:
        typeof connection?.pageInfo?.limit === "number"
          ? Math.max(1, Math.floor(connection.pageInfo.limit))
          : limit,
      hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    },
    entries: nodes.map((entry) => ({
      offerName: normalizeText(entry.offerName),
      offerType: toInt(entry.offerType),
      offerLink: normalizeUrl(entry.offerLink),
      originalLink: normalizeUrl(entry.originalLink),
      imageUrl: normalizeUrl(entry.imageUrl),
      commissionRate: normalizeText(entry.commissionRate),
      categoryId: normalizeCategoryId(entry.categoryId),
      collectionId: normalizeCategoryId(entry.collectionId),
      periodStartTime: toInt(entry.periodStartTime),
      periodEndTime: toInt(entry.periodEndTime),
    })),
  };
};

export const fetchShopeeShopOffers = async (
  options: ShopeeShopOfferOptions = {},
): Promise<ShopeeShopOfferResult> => {
  const limit = clampInt(options.limit, 20, 1, 50);
  const page = clampInt(options.page, 1, 1, 100);
  const sortType =
    options.sortType === null || options.sortType === undefined
      ? 2
      : clampInt(options.sortType, 2, 1, 9);
  const keyword = normalizeText(options.keyword);

  const data = await requestShopeeGraphQL<{ shopOfferV2?: ShopeeShopOfferV2Connection | null }>(
    SHOPEE_SHOP_OFFER_V2_QUERY,
    {
      ...(keyword ? { keyword } : {}),
      sortType,
      page,
      limit,
    },
    { userId: options.userId },
  );

  const connection = data.shopOfferV2 ?? null;
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];

  return {
    paging: {
      page: typeof connection?.pageInfo?.page === "number" ? Math.max(1, Math.floor(connection.pageInfo.page)) : page,
      limit:
        typeof connection?.pageInfo?.limit === "number"
          ? Math.max(1, Math.floor(connection.pageInfo.limit))
          : limit,
      hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    },
    entries: nodes.map((entry) => ({
      shopId: normalizeShopId(entry.shopId),
      shopName: normalizeText(entry.shopName),
      offerLink: normalizeUrl(entry.offerLink),
      originalLink: normalizeUrl(entry.originalLink),
      imageUrl: normalizeUrl(entry.imageUrl),
      commissionRate: normalizeText(entry.commissionRate),
      ratingStar: normalizeText(entry.ratingStar),
      shopType: normalizeText(entry.shopType),
      sellerCommCoveRatio: normalizeText(entry.sellerCommCoveRatio),
      remainingBudget: normalizeText(entry.remainingBudget == null ? null : String(entry.remainingBudget)),
      periodStartTime: toInt(entry.periodStartTime),
      periodEndTime: toInt(entry.periodEndTime),
    })),
  };
};

export const listShopeeItemFeeds = async (
  mode: ShopeeFeedMode,
  options: { userId?: number | null } = {},
): Promise<ShopeeItemFeedsResult> => {
  const normalizedMode = normalizeShopeeFeedMode(mode);
  if (!normalizedMode) {
    throw new Error("Modo de feed da Shopee inválido. Use FULL ou DELTA.");
  }

  const data = await requestShopeeGraphQL<{ listItemFeeds?: ShopeeItemFeedsConnection | null }>(
    SHOPEE_LIST_ITEM_FEEDS_QUERY,
    { feedMode: normalizedMode },
    { userId: options.userId },
  );

  const feeds = Array.isArray(data.listItemFeeds?.feeds) ? data.listItemFeeds.feeds : [];
  const entries = feeds
    .map((entry) => ({
      datafeedId: normalizeText(entry.datafeedId),
      referenceId: normalizeText(entry.referenceId),
      datafeedName: normalizeText(entry.datafeedName),
      description: normalizeText(entry.description),
      totalCount: Math.max(0, toInt(entry.totalCount) || 0),
      date: normalizeText(entry.date),
      feedMode: normalizeShopeeFeedMode(entry.feedMode),
    }))
    .filter((entry): entry is ShopeeItemFeedEntry => Boolean(entry.datafeedId))
    .sort((left, right) => {
      const leftTs = left.date ? Date.parse(left.date) : 0;
      const rightTs = right.date ? Date.parse(right.date) : 0;
      return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
    });

  return {
    mode: normalizedMode,
    entries,
  };
};

export const fetchShopeeItemFeedData = async (
  options: ShopeeItemFeedDataOptions,
): Promise<ShopeeItemFeedDataResult> => {
  const datafeedId = normalizeText(options.datafeedId);
  if (!datafeedId) {
    throw new Error("Informe um datafeedId válido para carregar os itens do feed.");
  }

  const offset = clampInt(options.offset, 0, 0, 10_000_000);
  const limit = clampInt(options.limit, 100, 1, 500);

  const data = await requestShopeeGraphQL<{ getItemFeedData?: ShopeeItemFeedDataConnection | null }>(
    SHOPEE_GET_ITEM_FEED_DATA_QUERY,
    {
      datafeedId,
      offset,
      limit,
    },
    { userId: options.userId },
  );

  const pageInfo = data.getItemFeedData?.pageInfo ?? null;
  const rowsRaw = Array.isArray(data.getItemFeedData?.rows) ? data.getItemFeedData.rows : [];

  const rows = rowsRaw.map((entry) => {
    const columnsRaw = normalizeText(entry.columns) || "";
    const columns = parseJsonObject(columnsRaw);

    const itemId = normalizeItemId(
      pickStringFromObject(columns, ["itemid", "item_id", "itemId", "product_id", "productId"]) || "",
    );
    const productLink = normalizeUrl(
      pickStringFromObject(columns, ["product_link", "productLink", "product_url", "url"]),
    );
    const offerLink = normalizeUrl(
      pickStringFromObject(columns, ["product_short link", "product_short_link", "offer_link", "offerLink", "short_link"]),
    );
    const title = pickStringFromObject(columns, ["title", "product_name", "item_name"]);
    const price = toNumber(columns?.price);
    const salePrice = toNumber(columns?.sale_price ?? columns?.salePrice);

    return {
      columnsRaw,
      columns,
      updateType: normalizeText(entry.updateType),
      itemId: itemId || null,
      productLink,
      offerLink,
      title,
      price,
      salePrice,
    } satisfies ShopeeItemFeedDataRow;
  });

  return {
    pageInfo: {
      offset:
        typeof pageInfo?.offset === "number" || typeof pageInfo?.offset === "string"
          ? Math.max(0, Math.floor(Number(pageInfo.offset) || 0))
          : offset,
      limit:
        typeof pageInfo?.limit === "number" || typeof pageInfo?.limit === "string"
          ? Math.max(1, Math.floor(Number(pageInfo.limit) || limit))
          : limit,
      totalCount:
        typeof pageInfo?.totalCount === "number" || typeof pageInfo?.totalCount === "string"
          ? Math.max(0, Math.floor(Number(pageInfo.totalCount) || 0))
          : 0,
      hasMore: Boolean(pageInfo?.hasMore),
    },
    rows,
  };
};

export const fetchShopeeConversionReport = async (
  options: ShopeeConversionReportOptions = {},
): Promise<ShopeeConversionReportResult> => {
  const limit = clampInt(options.limit, 50, 1, 200);
  const scrollId = normalizeText(options.scrollId);
  const purchaseTimeStart = toInt(options.purchaseTimeStart);
  const purchaseTimeEnd = toInt(options.purchaseTimeEnd);
  const completeTimeStart = toInt(options.completeTimeStart);
  const completeTimeEnd = toInt(options.completeTimeEnd);
  const shopId = toInt(options.shopId);
  const orderId = normalizeText(options.orderId);

  const variables: Record<string, unknown> = { limit };
  if (purchaseTimeStart !== null) variables.purchaseTimeStart = String(purchaseTimeStart);
  if (purchaseTimeEnd !== null) variables.purchaseTimeEnd = String(purchaseTimeEnd);
  if (completeTimeStart !== null) variables.completeTimeStart = String(completeTimeStart);
  if (completeTimeEnd !== null) variables.completeTimeEnd = String(completeTimeEnd);
  if (shopId !== null) variables.shopId = String(shopId);
  if (orderId) variables.orderId = orderId;

  const query = scrollId ? CONVERSION_REPORT_QUERY_SCROLL : CONVERSION_REPORT_QUERY_FILTERED;
  if (scrollId) {
    variables.scrollId = scrollId;
    delete variables.purchaseTimeStart;
    delete variables.purchaseTimeEnd;
    delete variables.completeTimeStart;
    delete variables.completeTimeEnd;
    delete variables.shopId;
    delete variables.orderId;
  }

  const data = await requestShopeeGraphQL<{
    conversionReport?: {
      pageInfo?: {
        page?: number | null;
        limit?: number | null;
        hasNextPage?: boolean | null;
        scrollId?: string | null;
      } | null;
      nodes?: ShopeeConversionReportQueryNode[] | null;
    } | null;
  }>(
    query,
    variables,
    { userId: options.userId, allowPartialData: true },
  );

  const rawNodes = Array.isArray(data.conversionReport?.nodes) ? data.conversionReport?.nodes : [];
  const entries: ShopeeConversionReportEntry[] = rawNodes.map((entry) => {
    const ordersRaw = Array.isArray(entry.orders) ? entry.orders : [];
    const orders: ShopeeConversionReportOrder[] = ordersRaw.map((order) => {
      const itemsRaw = Array.isArray(order.items) ? order.items : [];
      const items: ShopeeConversionReportOrderItem[] = itemsRaw.map((item) => ({
        itemId: normalizeItemId(item.itemId),
        itemName: normalizeText(item.itemName),
        qty: toInt(item.qty),
        itemPrice: toNumber(item.itemPrice),
        actualAmount: toNumber(item.actualAmount),
        refundAmount: toNumber(item.refundAmount),
        itemCommission: toNumber(item.itemCommission),
        itemTotalCommission: toNumber(item.itemTotalCommission),
        itemSellerCommission: toNumber(item.itemSellerCommission),
        itemShopeeCommissionCapped: toNumber(item.itemShopeeCommissionCapped),
        attributionType: normalizeText(item.attributionType),
        campaignPartnerName: normalizeText(item.campaignPartnerName),
        campaignType: normalizeText(item.campaignType),
        fraudStatus: normalizeText(item.fraudStatus),
      }));
      return {
        orderId: normalizeText(order.orderId == null ? null : String(order.orderId)),
        shopType: normalizeText(order.shopType),
        orderStatus: normalizeText(order.orderStatus),
        items,
      };
    });

    return {
      clickTime: toInt(entry.clickTime),
      purchaseTime: toInt(entry.purchaseTime),
      conversionId: normalizeText(entry.conversionId == null ? null : String(entry.conversionId)),
      conversionStatus: normalizeText(entry.conversionStatus),
      grossCommission: toNumber(entry.grossCommission),
      sellerCommission: toNumber(entry.sellerCommission),
      shopeeCommissionCapped: toNumber(entry.shopeeCommissionCapped),
      totalCommission: toNumber(entry.totalCommission),
      netCommission: toNumber(entry.netCommission),
      buyerType: normalizeText(entry.buyerType),
      device: normalizeText(entry.device),
      productType: normalizeText(entry.productType),
      referrer: normalizeText(entry.referrer),
      orders,
    };
  });

  const conversionIds = new Set<string>();
  const orderIds = new Set<string>();
  let totalCommission = 0;
  let netCommission = 0;
  let clicksWithPurchase = 0;
  let totalItems = 0;
  const conversionStatusCounter = new Map<string, number>();
  const orderStatusCounter = new Map<string, number>();

  entries.forEach((entry) => {
    if (entry.conversionId) conversionIds.add(entry.conversionId);
    if (entry.clickTime) clicksWithPurchase += 1;
    if (typeof entry.totalCommission === "number") totalCommission += entry.totalCommission;
    if (typeof entry.netCommission === "number") netCommission += entry.netCommission;
    const conversionStatus = entry.conversionStatus || "UNKNOWN";
    conversionStatusCounter.set(conversionStatus, (conversionStatusCounter.get(conversionStatus) || 0) + 1);

    entry.orders.forEach((order) => {
      if (order.orderId) orderIds.add(order.orderId);
      const orderStatus = order.orderStatus || "UNKNOWN";
      orderStatusCounter.set(orderStatus, (orderStatusCounter.get(orderStatus) || 0) + 1);
      totalItems += order.items.length;
    });
  });

  return {
    paging: {
      page:
        typeof data.conversionReport?.pageInfo?.page === "number"
          ? data.conversionReport.pageInfo.page
          : null,
      limit:
        typeof data.conversionReport?.pageInfo?.limit === "number"
          ? Math.max(1, Math.floor(data.conversionReport.pageInfo.limit))
          : limit,
      hasNextPage: Boolean(data.conversionReport?.pageInfo?.hasNextPage),
      scrollId: normalizeText(data.conversionReport?.pageInfo?.scrollId),
    },
    summary: {
      rows: entries.length,
      conversions: conversionIds.size,
      orders: orderIds.size,
      items: totalItems,
      totalCommission: Number(totalCommission.toFixed(4)),
      netCommission: Number(netCommission.toFixed(4)),
      clicksWithPurchase,
      conversionStatus: Array.from(conversionStatusCounter.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => right.count - left.count),
      orderStatus: Array.from(orderStatusCounter.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => right.count - left.count),
    },
    entries,
  };
};

export type {
  ShopeeAffiliateProduct,
  ShopeeAffiliateSearchOptions,
  ShopeeAffiliateSearchResult,
  ShopeeAffiliateShortLinkResult,
  ShopeeFeedMode,
  ShopeeItemFeedDataOptions,
  ShopeeItemFeedDataResult,
  ShopeeItemFeedDataRow,
  ShopeeItemFeedEntry,
  ShopeeItemFeedsResult,
  ShopeeOfferCampaignEntry,
  ShopeeOfferCampaignOptions,
  ShopeeOfferCampaignResult,
  ShopeeShopOfferEntry,
  ShopeeShopOfferOptions,
  ShopeeShopOfferResult,
  ShopeeConversionReportOrder,
  ShopeeConversionReportOrderItem,
  ShopeeConversionReportEntry,
  ShopeeConversionReportResult,
  ShopeeConversionReportOptions,
};
