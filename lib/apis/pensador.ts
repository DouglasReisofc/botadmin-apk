import * as cheerio from "cheerio";

const BASE_URL = "https://www.pensador.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36";

export const DEFAULT_PENSADOR_TOPIC = "amor";
export const MAX_PENSADOR_PAGE = 20;
export const MAX_PENSADOR_LIMIT = 50;

export type PensadorQuote = {
  id: string | null;
  text: string;
  author: string | null;
  source: string | null;
  link: string | null;
  image: string | null;
  tags: string[];
};

const sanitizeTopic = (value: string | null | undefined): string => {
  if (!value) return DEFAULT_PENSADOR_TOPIC;
  const normalized = value
    .normalize("NFD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized || DEFAULT_PENSADOR_TOPIC;
};

const absolutize = (path: string | null | undefined): string | null => {
  if (!path) return null;
  if (/^https?:/i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  return `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

const requestHtml = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Falha ao acessar Pensador (${response.status})`);
  }
  return response.text();
};

const fetchTopicPage = async (topicSlug: string, page: number) => {
  const suffix = page > 1 ? `${page}/` : "";
  return requestHtml(`${BASE_URL}/${topicSlug}/${suffix}`);
};

const fetchSearchPage = async (query: string, page: number) => {
  const params = new URLSearchParams();
  params.set("q", query);
  if (page > 1) params.set("p", String(page));
  return requestHtml(`${BASE_URL}/busca.php?${params.toString()}`);
};

const parseQuotesFromHtml = (html: string) => {
  const $ = cheerio.load(html);
  const cards = $(".thought-card");
  const quotes: PensadorQuote[] = cards
    .map((_, element) => {
      const card = $(element);
      const quoteNode = card.find("p.frase").first();
      const text = quoteNode.text().replace(/\s+/g, " ").trim();
      if (!text) {
        return null;
      }
      const id = quoteNode.attr("id") || null;
      const author = card.find(".author-name").first().text().trim() || null;
      const source = card.find(".thought-source .thought-source").first().text().trim() || null;
      const link = id ? `${BASE_URL}/frase/${id}/` : absolutize(card.find(".iconbar .linkDetailImage").attr("href"));
      const shareImage = card.find(".sg-social").attr("data-media") || card.find("img").attr("src") || null;
      const tags = card
        .find(".thought-card__meta a, .tags a")
        .map((__, anchor) => $(anchor).text().trim())
        .get()
        .filter(Boolean);

      return {
        id,
        text,
        author,
        source: source || null,
        link: link ? absolutize(link) : null,
        image: shareImage ? absolutize(shareImage) : null,
        tags,
      } as PensadorQuote;
    })
    .get()
    .filter(Boolean);

  const nextHref = $("#paginacao a.nav").attr("href") || null;
  let nextPage: number | null = null;
  if (nextHref) {
    const slugMatch = nextHref.match(/\/([0-9]+)\/?$/);
    const searchMatch = nextHref.match(/[?&]p=([0-9]+)/i);
    if (slugMatch) {
      nextPage = Number(slugMatch[1]);
    } else if (searchMatch) {
      nextPage = Number(searchMatch[1]);
    }
  }

  return { quotes, nextPage: Number.isFinite(nextPage) ? nextPage : null };
};

export type PensadorResult = {
  tema: string;
  rawTema: string;
  page: number;
  total: number;
  quotes: PensadorQuote[];
  pagination: {
    hasNext: boolean;
    nextPage: number | null;
  };
  source: "topic" | "search";
};

export const fetchPensadorQuotes = async (options: {
  tema?: string | null;
  page?: number;
  limit?: number;
}): Promise<PensadorResult> => {
  const rawTema = (options.tema ?? DEFAULT_PENSADOR_TOPIC).trim() || DEFAULT_PENSADOR_TOPIC;
  const topicSlug = sanitizeTopic(rawTema);
  const page = options.page && Number.isFinite(options.page) ? Math.max(1, Math.min(MAX_PENSADOR_PAGE, Math.floor(options.page))) : 1;
  const limit = options.limit && Number.isFinite(options.limit)
    ? Math.max(1, Math.min(MAX_PENSADOR_LIMIT, Math.floor(options.limit)))
    : 20;

  let parsed: { quotes: PensadorQuote[]; nextPage: number | null } | null = null;
  let source: "topic" | "search" = "topic";

  try {
    const html = await fetchTopicPage(topicSlug, page);
    parsed = parseQuotesFromHtml(html);
  } catch {
    parsed = null;
  }

  if (!parsed || parsed.quotes.length === 0) {
    source = "search";
    const searchHtml = await fetchSearchPage(rawTema, page);
    parsed = parseQuotesFromHtml(searchHtml);
  }

  if (!parsed || parsed.quotes.length === 0) {
    throw new Error("Nenhuma frase encontrada para o tema informado.");
  }

  const quotes = parsed.quotes.slice(0, limit);
  return {
    tema: topicSlug,
    rawTema,
    page,
    total: parsed.quotes.length,
    quotes,
    pagination: {
      hasNext: parsed.nextPage !== null && parsed.nextPage > page,
      nextPage: parsed.nextPage,
    },
    source,
  };
};
