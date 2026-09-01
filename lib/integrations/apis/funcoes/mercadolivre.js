const axios = require("axios");
const { getValidAccessToken } = require("./meli-token");

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

function clampLimit(value) {
  const parsed = Number(value) || DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
}

const API_BASE = "https://api.mercadolibre.com";

async function requestWithAuth(url, config = {}, retry = true) {
  const token = await getValidAccessToken();
  const headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
  try {
    return await axios({ url, ...config, headers });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401 && retry) {
      const newToken = await getValidAccessToken(true);
      return requestWithAuth(
        url,
        {
          ...config,
          headers: { ...(config.headers || {}), Authorization: `Bearer ${newToken}` }
        },
        false
      );
    }
    throw err;
  }
}

async function fetchItemDetails(ids, timeout = 15000) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return {};
  }

  const { data } = await requestWithAuth(`${API_BASE}/items`, {
    method: "GET",
    params: { ids: ids.join(",") },
    timeout,
  });

  if (!Array.isArray(data)) return {};

  return data.reduce((acc, entry) => {
    if (entry && entry.code === 200 && entry.body) {
      acc[entry.body.id] = entry.body;
    }
    return acc;
  }, {});
}

function formatProduct(item, detail) {
  return {
    id: item.id,
    title: item.title,
    condition: item.condition,
    category_id: item.category_id,
    permalink: item.permalink,
    tags: item.tags || [],
    prices: {
      price: item.price,
      original_price: item.original_price,
      currency: item.currency_id,
      available_quantity: item.available_quantity,
      sold_quantity: item.sold_quantity,
      installments: item.installments || detail?.installments || null,
    },
    pictures: detail?.pictures || (item.thumbnail ? [{ url: item.thumbnail }] : []),
    thumbnail: item.thumbnail,
    video_id: detail?.video_id || null,
    shipping: detail?.shipping || item.shipping || null,
    seller: {
      id: item.seller?.id,
      nickname: item.seller?.nickname,
      permalink: detail?.seller_id ? `https://perfil.mercadolivre.com.br/${detail.seller_id}` : undefined,
      registration_date: item.seller?.registration_date,
      level_id: item.seller?.seller_reputation?.level_id,
      reputation: item.seller?.seller_reputation || null,
    },
    address: item.address || detail?.seller_address || null,
    warranty: detail?.warranty || item.warranty || null,
    attributes: detail?.attributes || item.attributes || [],
    variations: detail?.variations || [],
    accepts_mercadopago: detail?.accepts_mercadopago ?? item.accepts_mercadopago ?? null,
    official_store_id: detail?.official_store_id ?? item.official_store_id ?? null,
    listing_type_id: item.listing_type_id || detail?.listing_type_id || null,
    logistics_type: detail?.logistics_type || item.logistics_type || null,
    raw: {
      search: item,
      detail: detail || null,
    },
  };
}

async function searchMercadoLivre(term, options = {}) {
  const sanitizedTerm = String(term || "").trim();
  if (!sanitizedTerm) {
    throw new Error("Informe o termo de busca.");
  }

  const limit = clampLimit(options.limit);
  const { data: searchData } = await requestWithAuth(`${API_BASE}/sites/MLB/search`, {
    params: { q: sanitizedTerm, limit },
    timeout: 15000,
  });

  const results = Array.isArray(searchData?.results) ? searchData.results : [];
  const ids = results.map((item) => item.id).filter(Boolean);
  const detailMap = await fetchItemDetails(ids);

  const produtos = results.map((item) => formatProduct(item, detailMap[item.id]));

  return {
    consulta: {
      termo: sanitizedTerm,
      limit,
    },
    paging: searchData?.paging || { total: produtos.length, limit },
    filtros: searchData?.available_filters || [],
    produtos,
  };
}

module.exports = {
  searchMercadoLivre,
};
