import cheerio from "cheerio";

export type AmazonProduct = {
  asin: string | null;
  titulo: string | null;
  descricaoCurta: string | null;
  url: string | null;
  imagem: string | null;
  preco: number | null;
  precoFormatado: string | null;
  moeda: string | null;
  precoAntigo: string | null;
  precoPorUnidade: string | null;
  precoParcelado: string | null;
  avaliacao: number | null;
  avaliacaoTexto: string | null;
  totalAvaliacoes: number | null;
  prime: boolean;
  patrocinado: boolean;
  entrega: string | null;
  entregaGratis: boolean;
  selos: string[];
  destaques: string[];
  compraRecenteTexto: string | null;
  opcoesTexto: string | null;
};

const AMAZON_BASE = "https://www.amazon.com.br";
const LANG = "pt_BR";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const randomDigits = (len: number): string => {
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += Math.floor(Math.random() * 10);
  }
  return out;
};

const buildSessionId = (): string =>
  `${randomDigits(3)}-${randomDigits(7)}-${randomDigits(7)}`;

const buildSessionTime = (): string => {
  const timestamp = Math.floor(Date.now() / 1000);
  return String(timestamp + 60 * 60 * 24); // +1 dia
};

const buildCookieHeader = (): string => {
  const parts = [
    "i18n-prefs=BRL",
    `lc-acbbr=${LANG}`,
    `ubid-acbbr=${buildSessionId()}`,
    `session-id=${buildSessionId()}`,
    `session-id-time=${buildSessionTime()}`,
  ];
  return parts.join("; ");
};

const normalizeNumber = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const cleaned = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanText = (value?: string | null): string => {
  if (!value) return "";
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
};

const extractPriceInfo = ($el: cheerio.Cheerio): {
  value: number | null;
  formatted: string | null;
  currency: string | null;
} => {
  const priceSection = $el.find(".a-price").first();
  if (!priceSection.length) {
    return { value: null, formatted: null, currency: null };
  }

  const offscreen = priceSection.find(".a-offscreen").first().text().trim();
  const currencyMatch = offscreen.match(/^[^\d\s]+/);
  const currency = currencyMatch ? currencyMatch[0].trim() : null;
  const formatted = offscreen || null;
  const value = normalizeNumber(offscreen);

  return {
    value,
    formatted,
    currency,
  };
};

const extractOldPrice = ($el: cheerio.Cheerio): string | null => {
  const el = $el.find(".a-text-price .a-offscreen").first();
  return el.length ? el.text().trim() : null;
};

const extractRating = ($el: cheerio.Cheerio): { value: number | null; text: string | null } => {
  const ratingText = $el.find(".a-icon-star-small span.a-icon-alt, .a-icon-star span.a-icon-alt").first().text().trim() || null;
  return {
    value: ratingText ? normalizeNumber(ratingText) : null,
    text: ratingText,
  };
};

const parseResults = ($: cheerio.Root): AmazonProduct[] => {
  const results: AmazonProduct[] = [];
  $('div.s-result-item[data-component-type="s-search-result"]').each((_, element) => {
    const node = $(element);
    const asin = node.attr("data-asin") || null;
    if (!asin) {
      return;
    }

    const titleAnchor =
      node.find("[data-cy=\"title-recipe\"] a.a-link-normal").first() ||
      node.find("h2 a.a-link-normal").first();
    const title =
      titleAnchor.find("span").text().trim() ||
      titleAnchor.text().trim() ||
      node.find("h2").first().text().trim() ||
      null;
    const shortDescription =
      titleAnchor.attr("aria-label") ||
      node.find("h2").first().attr("aria-label") ||
      null;
    const relativeUrl = titleAnchor.attr("href") || null;
    const image = node.find("img.s-image").first().attr("src") || null;

    const { value: priceNum, formatted: formattedPrice, currency } = extractPriceInfo(node);
    const oldPrice = extractOldPrice(node);
    const { value: ratingValue, text: ratingText } = extractRating(node);
    const priceRecipe = node.find("[data-cy='price-recipe']").first();
    const priceRecipeText = cleanText(priceRecipe.text());
    let unitPrice: string | null = null;
    let installmentText: string | null = null;
    if (priceRecipeText) {
      const unitMatch = priceRecipeText.match(/\(([^()]+\/[^()]+)\)/);
      if (unitMatch) {
        unitPrice = cleanText(unitMatch[1]);
      }
      const installmentMatch = priceRecipeText.match(/em\s+até[^.]+/i);
      if (installmentMatch) {
        installmentText = cleanText(installmentMatch[0]);
      }
    }

    const totalReviewsText = node
      .find(".a-size-base.s-underline-text")
      .first()
      .text()
      .replace(/[^\d]/g, "");
    const totalReviews = totalReviewsText ? Number(totalReviewsText) : null;

    const prime = node.find(".a-icon-prime, .s-prime").length > 0;
    const sponsored =
      node.find("[data-component-type='sp-sponsored-result'], .puis-sponsored-label-text").length > 0;
    const badgeTexts = Array.from(
      new Set(
        node
          .find(".a-badge-text")
          .map((_, el) => cleanText($(el).text()))
          .get()
          .filter(Boolean),
      ),
    );

    const deliveryBlock =
      cleanText(node.find(".udm-primary-delivery-message").first().text()) || null;

    const highlightTexts: string[] = [];
    node.find(".a-row").each((_, row) => {
      const rowEl = $(row);
      if (rowEl.parents("[data-cy='price-recipe']").length > 0) return;
      const text = cleanText(rowEl.text());
      if (!text) return;
      if (/Adicionar ao carrinho/i.test(text)) return;
      if (/^R\$\s?\d/.test(text) && !/desconto|%|economize|cupom|poupe/i.test(text)) return;
      if (/página do produto/i.test(text)) return;
      if (/de 5 estrelas/i.test(text)) return;
      highlightTexts.push(text);
    });
    const uniqueHighlights = Array.from(new Set(highlightTexts));

    const purchaseText = uniqueHighlights.find((text) => /compra/i.test(text)) || null;
    const optionsText =
      uniqueHighlights.find((text) => /opç|opcoes|opcoes|tamanh|varia/i.test(text)) || null;
    const deliveryFallback =
      uniqueHighlights.find((text) => /entrega/i.test(text)) || null;

    const promoHighlights = uniqueHighlights.filter((text) =>
      /oferta|desconto|poupe|economize|%|cashback|promo/i.test(text),
    );
    const miscHighlights = uniqueHighlights.filter((text) => {
      if (text === purchaseText || text === optionsText) return false;
      if (/entrega/i.test(text)) return false;
      if (/compra/i.test(text)) return false;
      return !promoHighlights.includes(text);
    });

    const delivery = deliveryBlock || deliveryFallback || null;
    const entregaGratis = /grátis/i.test(delivery ?? "");
    const destaques = Array.from(new Set([...promoHighlights, ...miscHighlights])).slice(0, 3);

    if (!relativeUrl || relativeUrl === "#") {
      return;
    }

    if (!title && !relativeUrl) {
      return;
    }

    results.push({
      asin,
      titulo: title,
      descricaoCurta: shortDescription,
      url: relativeUrl ? new URL(relativeUrl, AMAZON_BASE).toString() : null,
      imagem: image,
      preco: priceNum,
      precoFormatado: formattedPrice,
      moeda: currency,
      precoAntigo: oldPrice,
      precoPorUnidade: unitPrice,
      precoParcelado: installmentText,
      avaliacao: ratingValue,
      avaliacaoTexto: ratingText,
      totalAvaliacoes: totalReviews,
      prime,
      patrocinado: sponsored,
      entrega: delivery,
      entregaGratis,
      selos: badgeTexts,
      destaques,
      compraRecenteTexto: purchaseText,
      opcoesTexto: optionsText,
    });
  });
  return results;
};

export type AmazonSearchOptions = {
  page?: number;
};

export const searchAmazon = async (
  query: string,
  options: AmazonSearchOptions = {},
): Promise<{ produtos: AmazonProduct[]; fonte: string }> => {
  const page = Math.max(1, Number(options.page ?? 1));
  const url = new URL(`${AMAZON_BASE}/s`);
  url.searchParams.set("k", query);
  url.searchParams.set("language", LANG);
  if (page > 1) {
    url.searchParams.set("page", String(page));
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "Cache-Control": "no-cache",
      Cookie: buildCookieHeader(),
      Referer: AMAZON_BASE,
    },
  });

  if (!response.ok) {
    throw new Error(`Amazon retornou ${response.status}`);
  }

  const html = await response.text();
  if (html.includes("Algo deu errado")) {
    throw new Error("Amazon bloqueou a consulta, tente novamente mais tarde.");
  }

  const $ = cheerio.load(html);
  const produtos = parseResults($);
  return { produtos, fonte: url.toString() };
};
