import path from "node:path";
import { getValidAffiliateAccessToken } from "lib/affiliate-connections";

type MercadoLivreInstallments = {
  quantity?: number | null;
  amount?: number | null;
  rate?: number | null;
  currency_id?: string | null;
} | null;

type MercadoLivreProduct = {
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
};

type MercadoLivreSearchResult = {
  consulta: {
    termo: string;
    limit: number;
    modo: "busca" | "link";
    linkOriginal?: string;
    linkResolvido?: string;
    itemId?: string;
  };
  paging: {
    total: number;
    limit: number;
    offset: number;
  };
  filtros: unknown[];
  fonte: string;
  produtos: MercadoLivreProduct[];
};

type MercadoLivreSearchOptions = {
  limit?: number | string | null;
  userId?: number | null;
};

class ApiRequestError extends Error {
  status: number;
  body: string;

  constructor(status: number, message: string, body = "") {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const API_BASE = "https://api.mercadolibre.com";
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 15000;

const URL_REGEX = /(https?:\/\/[^\s]+|(?:www\.)?meli\.la\/[a-zA-Z0-9]+|(?:www\.)?mercadolivre\.com\.br\/[^\s]+|(?:www\.)?mercadolibre\.com\/[^\s]+)/i;
const ITEM_ID_REGEX = /\b(ML[A-Z]-?\d{6,})\b/i;
const AFFILIATE_SHARE_ID_REGEX = /\b([A-Z0-9]{4,10}-[A-Z0-9]{4,10})\b/i;

type MeliTokenHelper = {
  getValidAccessToken?: (forceRefresh?: boolean) => Promise<string>;
};

type AccessTokenResolver = {
  required: boolean;
  getValidAccessToken: (forceRefresh?: boolean) => Promise<string | null>;
};

const loadMeliTokenHelper = (): MeliTokenHelper | null => {
  try {
    const helperPath = path.join(process.cwd(), "lib", "integrations", "apis", "funcoes", "meli-token.js");
    const mod = (eval("require") as NodeRequire)(helperPath);
    return mod && typeof mod === "object" ? (mod as MeliTokenHelper) : null;
  } catch {
    return null;
  }
};

const globalMeliTokenHelper = loadMeliTokenHelper();

const globalTokenResolver: AccessTokenResolver = {
  required: false,
  getValidAccessToken: async (forceRefresh = false) => {
    if (!globalMeliTokenHelper?.getValidAccessToken) {
      return null;
    }
    try {
      return await globalMeliTokenHelper.getValidAccessToken(forceRefresh);
    } catch {
      return null;
    }
  },
};

const buildUserTokenResolver = (userId: number): AccessTokenResolver => ({
  required: true,
  getValidAccessToken: async (forceRefresh = false) => {
    try {
      return await getValidAffiliateAccessToken(userId, "mercadolivre", { forceRefresh });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conecte sua conta Mercado Livre no painel.";
      throw new Error(message || "Conecte sua conta Mercado Livre no painel.");
    }
  },
});

const clampLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.trunc(parsed)));
};

const cleanText = (value?: string | null): string | null => {
  if (!value) return null;
  const cleaned = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
};

const normalizePrice = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeStatus = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const normalizeStock = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
};

const hasOutOfStockTag = (tags: unknown): boolean => {
  if (!Array.isArray(tags)) return false;
  return tags.some((tag) => {
    if (typeof tag !== "string") return false;
    const normalized = tag.trim().toLowerCase();
    return normalized === "out_of_stock" || normalized === "no_stock";
  });
};

const isStatusAvailable = (status: string | null): boolean => {
  if (!status) return true;
  return status === "active";
};

const computeProductAvailability = (params: {
  status: unknown;
  stock: unknown;
  tags: unknown;
}): boolean => {
  const status = normalizeStatus(params.status);
  if (!isStatusAvailable(status)) return false;

  const stock = normalizeStock(params.stock);
  if (stock !== null && stock <= 0) return false;

  if (hasOutOfStockTag(params.tags)) return false;
  return true;
};

const sortAvailableFirst = (products: MercadoLivreProduct[]): MercadoLivreProduct[] => {
  if (!Array.isArray(products) || products.length <= 1) return products;
  return [...products].sort((a, b) => {
    const aRank = a.disponivel ? 0 : 1;
    const bRank = b.disponivel ? 0 : 1;
    return aRank - bRank;
  });
};

const formatCurrency = (value: number | null, currency: string | null): string | null => {
  if (value === null || !Number.isFinite(value)) return null;
  const resolvedCurrency = currency || "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: resolvedCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${resolvedCurrency} ${value.toFixed(2)}`;
  }
};

const formatInstallments = (installments: MercadoLivreInstallments): string | null => {
  if (!installments) return null;
  const quantity = Number(installments.quantity);
  const amount = normalizePrice(installments.amount);
  if (!Number.isFinite(quantity) || quantity <= 0 || amount === null) {
    return null;
  }
  const amountText = formatCurrency(amount, installments.currency_id || "BRL") || `${amount}`;
  const rate = Number(installments.rate || 0);
  if (Number.isFinite(rate) && rate === 0) {
    return `${quantity}x de ${amountText} sem juros`;
  }
  if (Number.isFinite(rate) && rate > 0) {
    return `${quantity}x de ${amountText} (${rate}% juros)`;
  }
  return `${quantity}x de ${amountText}`;
};

const normalizePossibleUrl = (value: string): string | null => {
  const trimmed = value.trim().replace(/[)\],.;]+$/g, "");
  if (!trimmed) return null;
  const match = trimmed.match(URL_REGEX);
  const candidate = match ? match[0] : trimmed;
  if (!candidate) return null;

  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  if (/^(www\.)?meli\.la\//i.test(candidate)) {
    return `https://${candidate.replace(/^https?:\/\//i, "")}`;
  }
  if (/^(www\.)?mercadolivre\.com\.br\//i.test(candidate) || /^(www\.)?mercadolibre\.com\//i.test(candidate)) {
    return `https://${candidate.replace(/^https?:\/\//i, "")}`;
  }
  return null;
};

const extractItemId = (text: string): string | null => {
  if (!text) return null;
  const match = text.match(ITEM_ID_REGEX);
  if (!match?.[1]) return null;
  return match[1].replace("-", "").toUpperCase();
};

const extractAffiliateShareId = (text: string): string | null => {
  if (!text) return null;
  const match = text.match(AFFILIATE_SHARE_ID_REGEX);
  if (!match?.[1]) return null;
  const value = match[1].toUpperCase();
  if (!/[A-Z]/.test(value) || !/\d/.test(value)) return null;
  return value;
};

const resolveAccessToken = async (
  tokenResolver: AccessTokenResolver,
  forceRefresh = false,
): Promise<string | null> => {
  try {
    const token = await tokenResolver.getValidAccessToken(forceRefresh);
    if (token && token.trim()) return token.trim();
  } catch (error) {
    if (tokenResolver.required) {
      throw error;
    }
  }

  if (tokenResolver.required) {
    throw new Error("Conecte sua conta Mercado Livre no painel para continuar.");
  }
  return null;
};

const fetchJson = async (url: string, tokenResolver: AccessTokenResolver, retry = true): Promise<any> => {
  const token = await resolveAccessToken(tokenResolver, false);
  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-language": "pt-BR,pt;q=0.9",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 && retry) {
    const refreshedToken = await resolveAccessToken(tokenResolver, true);
    if (refreshedToken) {
      return fetchJson(url, tokenResolver, false);
    }
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new ApiRequestError(
      response.status,
      `Mercado Livre retornou ${response.status}${errorBody ? `: ${errorBody.slice(0, 240)}` : ""}`,
      errorBody,
    );
  }

  return response.json();
};

const resolveRedirect = async (originalUrl: string): Promise<string> => {
  const response = await fetch(originalUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return response.url || originalUrl;
};

const resolveShortUrlViaUnshorten = async (originalUrl: string): Promise<string | null> => {
  const url = `https://unshorten.me/json/${encodeURIComponent(originalUrl)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const resolved = cleanText(payload?.resolved_url);
  if (!payload?.success || !resolved) {
    return null;
  }
  return resolved;
};

const resolveRedirectWithFallback = async (originalUrl: string): Promise<string> => {
  try {
    return await resolveRedirect(originalUrl);
  } catch {
    if (/meli\.la\//i.test(originalUrl)) {
      const fallback = await resolveShortUrlViaUnshorten(originalUrl);
      if (fallback) return fallback;
    }
    throw new Error("Não foi possível resolver o link informado.");
  }
};

const fetchHtml = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
};

const extractItemIdFromSocialHtml = (html: string): string | null => {
  if (!html) return null;

  const patterns = [
    /"event_data"\s*:\s*\{[\s\S]{0,2000}?"product_id"\s*:\s*"(ML[A-Z]-?\d{6,})"/i,
    /"event_data"\s*:\s*\{[\s\S]{0,2000}?"item_id"\s*:\s*"(ML[A-Z]-?\d{6,})"/i,
    /"trigger"\s*:\s*\{[\s\S]{0,2000}?"product_id"\s*:\s*"(ML[A-Z]-?\d{6,})"/i,
    /"trigger"\s*:\s*\{[\s\S]{0,2000}?"item_id"\s*:\s*"(ML[A-Z]-?\d{6,})"/i,
    /"product_id"\s*:\s*"(ML[A-Z]-?\d{6,})"/i,
    /"item_id"\s*:\s*"(ML[A-Z]-?\d{6,})"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const resolvedId = match?.[1] ? extractItemId(match[1]) : null;
    if (resolvedId) return resolvedId;
  }

  const allMatches = html.match(/ML[A-Z]-?\d{6,}/gi) || [];
  for (const value of allMatches) {
    const resolvedId = extractItemId(value);
    if (resolvedId) return resolvedId;
  }

  return null;
};

const resolveSocialItemId = async (resolvedLink: string): Promise<string | null> => {
  const html = await fetchHtml(resolvedLink);
  if (!html) return null;
  return extractItemIdFromSocialHtml(html);
};

const summarizeAttributes = (attributes: any): string[] => {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((attribute) => {
      const name = cleanText(attribute?.name);
      const value = cleanText(attribute?.value_name || attribute?.value_struct?.number);
      if (!name || !value) return null;
      return `${name}: ${value}`;
    })
    .filter(Boolean)
    .slice(0, 8) as string[];
};

const toProduct = (searchItem: any, detailItem: any): MercadoLivreProduct => {
  const currency = cleanText(detailItem?.currency_id || searchItem?.currency_id);
  const price = normalizePrice(detailItem?.price ?? searchItem?.price);
  const oldPrice = normalizePrice(detailItem?.original_price ?? searchItem?.original_price);
  const installments = (detailItem?.installments || searchItem?.installments || null) as MercadoLivreInstallments;
  const shipping = detailItem?.shipping || searchItem?.shipping || {};
  const pictures = Array.isArray(detailItem?.pictures)
    ? detailItem.pictures
        .map((picture: any) => ({
          id: cleanText(picture?.id),
          url: cleanText(picture?.secure_url || picture?.url),
        }))
        .filter((picture: { id: string | null; url: string | null }) => Boolean(picture.url))
    : [];

  const image =
    pictures[0]?.url ||
    cleanText(searchItem?.thumbnail) ||
    cleanText(searchItem?.thumbnail_id) ||
    null;

  const sellerId =
    Number(searchItem?.seller?.id ?? detailItem?.seller_id ?? detailItem?.seller?.id) || null;
  const sellerNickname = cleanText(searchItem?.seller?.nickname || detailItem?.seller?.nickname);
  const sellerLevel = cleanText(
    searchItem?.seller?.seller_reputation?.level_id || detailItem?.seller?.seller_reputation?.level_id,
  );
  const status = cleanText(detailItem?.status || searchItem?.status);
  const estoque = Number(detailItem?.available_quantity ?? searchItem?.available_quantity) || null;
  const rawTags = Array.isArray(detailItem?.tags)
    ? detailItem.tags
    : Array.isArray(searchItem?.tags)
      ? searchItem.tags
      : [];
  const tags = rawTags.filter((tag: unknown) => typeof tag === "string");
  const disponivel = computeProductAvailability({
    status,
    stock: estoque,
    tags,
  });

  return {
    id: cleanText(detailItem?.id || searchItem?.id),
    titulo: cleanText(detailItem?.title || searchItem?.title),
    descricaoCurta: cleanText(detailItem?.subtitle || searchItem?.official_store_name),
    url: cleanText(detailItem?.permalink || searchItem?.permalink),
    imagem: image,
    preco: price,
    precoFormatado: formatCurrency(price, currency),
    precoAntigo: oldPrice,
    precoAntigoFormatado: formatCurrency(oldPrice, currency),
    precoParcelado: formatInstallments(installments),
    moeda: currency,
    condicao: cleanText(detailItem?.condition || searchItem?.condition),
    categoriaId: cleanText(detailItem?.category_id || searchItem?.category_id),
    vendidos: Number(detailItem?.sold_quantity ?? searchItem?.sold_quantity) || null,
    estoque,
    aceitaMercadoPago:
      typeof detailItem?.accepts_mercadopago === "boolean"
        ? detailItem.accepts_mercadopago
        : typeof searchItem?.accepts_mercadopago === "boolean"
          ? searchItem.accepts_mercadopago
          : null,
    status,
    garantia: cleanText(detailItem?.warranty || searchItem?.warranty),
    freteGratis: Boolean(shipping?.free_shipping),
    freteModo: cleanText(shipping?.mode),
    freteLogistica: cleanText(shipping?.logistic_type),
    freteTexto: shipping?.free_shipping
      ? "Frete grátis"
      : cleanText(shipping?.mode ? `Envio: ${shipping.mode}` : null),
    atributosResumo: summarizeAttributes(detailItem?.attributes || searchItem?.attributes),
    tags,
    variacoes: Array.isArray(detailItem?.variations) ? detailItem.variations.length : 0,
    disponivel,
    vendedor: {
      id: sellerId,
      nickname: sellerNickname,
      reputacaoNivel: sellerLevel,
      lojaOficialId: Number(detailItem?.official_store_id ?? searchItem?.official_store_id) || null,
      permalink: sellerId ? `https://perfil.mercadolivre.com.br/${sellerId}` : null,
    },
    pictures,
    raw: {
      search: searchItem ?? null,
      detail: detailItem ?? null,
    },
  };
};

const toProductFromCatalog = (product: any): MercadoLivreProduct => {
  const pictures = Array.isArray(product?.pictures)
    ? product.pictures
        .map((picture: any) => ({
          id: cleanText(picture?.id),
          url: cleanText(picture?.url),
        }))
        .filter((picture: { id: string | null; url: string | null }) => Boolean(picture.url))
    : [];

  const productId = cleanText(product?.id);
  const status = cleanText(product?.status);
  const estoque = normalizeStock(product?.available_quantity);
  const tags = Array.isArray(product?.tags)
    ? product.tags.filter((tag: unknown) => typeof tag === "string")
    : [];
  const disponivel = computeProductAvailability({
    status,
    stock: estoque,
    tags,
  });

  return {
    id: productId,
    titulo: cleanText(product?.name),
    descricaoCurta: cleanText(product?.short_description?.content),
    url: cleanText(product?.permalink) || (productId ? `https://www.mercadolivre.com.br/p/${productId}` : null),
    imagem: pictures[0]?.url || null,
    preco: null,
    precoFormatado: null,
    precoAntigo: null,
    precoAntigoFormatado: null,
    precoParcelado: null,
    moeda: "BRL",
    condicao: null,
    categoriaId: cleanText(product?.domain_id),
    vendidos: null,
    estoque,
    aceitaMercadoPago: null,
    status,
    garantia: null,
    freteGratis: false,
    freteModo: null,
    freteLogistica: null,
    freteTexto: null,
    atributosResumo: summarizeAttributes(product?.attributes),
    tags,
    variacoes: Array.isArray(product?.children_ids) ? product.children_ids.length : 0,
    disponivel,
    vendedor: {
      id: null,
      nickname: null,
      reputacaoNivel: null,
      lojaOficialId: null,
      permalink: null,
    },
    pictures,
    raw: {
      search: product ?? null,
      detail: product ?? null,
    },
  };
};

const enrichCatalogProductWithItems = async (
  productId: string,
  product: MercadoLivreProduct,
  tokenResolver: AccessTokenResolver,
): Promise<MercadoLivreProduct> => {
  try {
    const itemsUrl = new URL(`/products/${productId}/items`, API_BASE);
    itemsUrl.searchParams.set("limit", "1");
    const itemsData = await fetchJson(itemsUrl.toString(), tokenResolver);
    const item = Array.isArray(itemsData?.results) ? itemsData.results[0] : null;
    if (!item) return product;

    const currency = cleanText(item?.currency_id) || product.moeda || "BRL";
    const price = normalizePrice(item?.price);
    const oldPrice = normalizePrice(item?.original_price);
    const shipping = item?.shipping || {};
    const itemInstallments = (item?.installments || null) as MercadoLivreInstallments;
    const status = cleanText(item?.status) || product.status;
    const estoque = Number(item?.available_quantity) || product.estoque;
    const tags = Array.isArray(item?.tags)
      ? item.tags.filter((tag: unknown) => typeof tag === "string")
      : product.tags;
    const disponivel = computeProductAvailability({
      status,
      stock: estoque,
      tags,
    });

    return {
      ...product,
      url: cleanText(item?.permalink) || product.url,
      preco: price,
      precoFormatado: formatCurrency(price, currency),
      precoAntigo: oldPrice,
      precoAntigoFormatado: formatCurrency(oldPrice, currency),
      precoParcelado: formatInstallments(itemInstallments),
      moeda: currency,
      condicao: cleanText(item?.condition) || product.condicao,
      vendidos: Number(item?.sold_quantity) || product.vendidos,
      estoque,
      aceitaMercadoPago:
        typeof item?.accepts_mercadopago === "boolean" ? item.accepts_mercadopago : product.aceitaMercadoPago,
      status,
      garantia: cleanText(item?.warranty) || product.garantia,
      freteGratis: Boolean(shipping?.free_shipping),
      freteModo: cleanText(shipping?.mode),
      freteLogistica: cleanText(shipping?.logistic_type),
      freteTexto: shipping?.free_shipping
        ? "Frete grátis"
        : cleanText(shipping?.mode ? `Envio: ${shipping.mode}` : null),
      tags,
      disponivel,
      raw: {
        search: product.raw.search,
        detail: {
          product: product.raw.detail,
          item,
        },
      },
    };
  } catch {
    return product;
  }
};

const fetchItemsDetails = async (
  ids: string[],
  tokenResolver: AccessTokenResolver,
): Promise<Record<string, any>> => {
  if (!ids.length) return {};
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) {
    chunks.push(ids.slice(i, i + 20));
  }

  const detailMap: Record<string, any> = {};
  for (const chunk of chunks) {
    const url = new URL("/items", API_BASE);
    url.searchParams.set("ids", chunk.join(","));
    const response = await fetchJson(url.toString(), tokenResolver);
    if (!Array.isArray(response)) continue;
    for (const entry of response) {
      if (entry?.code === 200 && entry?.body?.id) {
        detailMap[String(entry.body.id)] = entry.body;
      }
    }
  }
  return detailMap;
};

const searchByTerm = async (
  term: string,
  limit: number,
  tokenResolver: AccessTokenResolver,
): Promise<MercadoLivreSearchResult> => {
  const listingUrl = new URL("/sites/MLB/search", API_BASE);
  listingUrl.searchParams.set("q", term);
  listingUrl.searchParams.set("limit", String(limit));

  try {
    const data = await fetchJson(listingUrl.toString(), tokenResolver);
    const results = Array.isArray(data?.results) ? data.results : [];
    const ids = results.map((item: any) => String(item?.id || "")).filter(Boolean);
    const detailMap = await fetchItemsDetails(ids, tokenResolver);
    const produtos = sortAvailableFirst(results.map((item: any) => toProduct(item, detailMap[item.id])));

    return {
      consulta: {
        termo: term,
        limit,
        modo: "busca",
      },
      paging: {
        total: Number(data?.paging?.total) || produtos.length,
        limit: Number(data?.paging?.limit) || limit,
        offset: Number(data?.paging?.offset) || 0,
      },
      filtros: Array.isArray(data?.available_filters) ? data.available_filters : [],
      fonte: listingUrl.toString(),
      produtos,
    };
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 403) {
      throw error;
    }
  }

  const catalogUrl = new URL("/products/search", API_BASE);
  catalogUrl.searchParams.set("site_id", "MLB");
  catalogUrl.searchParams.set("q", term);
  catalogUrl.searchParams.set("limit", String(limit));

  const catalogData = await fetchJson(catalogUrl.toString(), tokenResolver);
  const results = Array.isArray(catalogData?.results) ? catalogData.results : [];
  const produtos = sortAvailableFirst(results.map((product: any) => toProductFromCatalog(product)));

  return {
    consulta: {
      termo: term,
      limit,
      modo: "busca",
    },
    paging: {
      total: Number(catalogData?.paging?.total) || produtos.length,
      limit: Number(catalogData?.paging?.limit) || limit,
      offset: Number(catalogData?.paging?.offset) || 0,
    },
    filtros: [],
    fonte: catalogUrl.toString(),
    produtos,
  };
};

const searchByLink = async (
  originalLink: string,
  tokenResolver: AccessTokenResolver,
): Promise<MercadoLivreSearchResult> => {
  const resolvedLink = await resolveRedirectWithFallback(originalLink);
  let itemId = extractItemId(resolvedLink) || extractItemId(originalLink);

  if (!itemId && /\/social\//i.test(resolvedLink)) {
    itemId = await resolveSocialItemId(resolvedLink);
  }

  if (!itemId) {
    if (/\/social\//i.test(resolvedLink)) {
      throw new Error(
        "Não consegui extrair o produto desse link social. Envie o link direto do anúncio ou use 'Copiar informação'.",
      );
    }
    throw new Error("Não foi possível identificar o ID do item nesse link do Mercado Livre.");
  }

  let product: MercadoLivreProduct | null = null;
  let sourceUrl = "";

  const itemUrl = new URL(`/items/${itemId}`, API_BASE).toString();
  try {
    const detail = await fetchJson(itemUrl, tokenResolver);
    product = toProduct({ id: itemId, permalink: resolvedLink }, detail);
    sourceUrl = itemUrl;
  } catch (error) {
    if (!(error instanceof ApiRequestError) || (error.status !== 404 && error.status !== 403)) {
      throw error;
    }

    const productUrl = new URL(`/products/${itemId}`, API_BASE).toString();
    try {
      const detail = await fetchJson(productUrl, tokenResolver);
      product = await enrichCatalogProductWithItems(itemId, toProductFromCatalog(detail), tokenResolver);
      sourceUrl = productUrl;
    } catch (productError) {
      throw error;
    }
  }

  return {
    consulta: {
      termo: originalLink,
      limit: 1,
      modo: "link",
      linkOriginal: originalLink,
      linkResolvido: resolvedLink,
      itemId,
    },
    paging: {
      total: 1,
      limit: 1,
      offset: 0,
    },
    filtros: [],
    fonte: sourceUrl,
    produtos: product ? sortAvailableFirst([product]) : [],
  };
};

export const searchMercadoLivre = async (
  termOrLink: string,
  options: MercadoLivreSearchOptions = {},
): Promise<MercadoLivreSearchResult> => {
  const term = String(termOrLink || "").trim();
  if (!term) {
    throw new Error("Informe o termo de busca ou o link do produto.");
  }

  const userId =
    typeof options.userId === "number" && Number.isFinite(options.userId) && options.userId > 0
      ? Math.trunc(options.userId)
      : null;
  const tokenResolver = userId ? buildUserTokenResolver(userId) : globalTokenResolver;

  const asUrl = normalizePossibleUrl(term);
  if (asUrl) {
    return searchByLink(asUrl, tokenResolver);
  }

  const itemId = extractItemId(term);
  if (itemId) {
    return searchByLink(`https://www.mercadolivre.com.br/p/${itemId}`, tokenResolver);
  }

  const affiliateShareId = extractAffiliateShareId(term);
  if (affiliateShareId) {
    return searchByLink(`https://lista.mercadolivre.com.br/${affiliateShareId}`, tokenResolver);
  }

  const limit = clampLimit(options.limit);
  return searchByTerm(term, limit, tokenResolver);
};

export type { MercadoLivreProduct, MercadoLivreSearchResult, MercadoLivreSearchOptions };
