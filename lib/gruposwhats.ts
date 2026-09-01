const DEFAULT_SERVICE_URL = (() => {
  const raw = (process.env.GRUPOWHATS_API_URL || "").trim();
  if (raw) {
    try {
      return new URL(raw).toString();
    } catch {
      /* ignore invalid custom url */
    }
  }
  return "https://cookies.botadmin.shop/api/gruposwhats/search";
})();

const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  accept: "application/json",
};

export type GruposWhatsSearchOptions = {
  maxPages?: number;
  page?: number;
  category?: string;
  delayMs?: number;
  includeDetails?: boolean;
  verbose?: boolean;
};

export type GruposWhatsCategory = {
  id: string | null;
  name: string;
  slug: string;
  url: string;
};

export type GruposWhatsGroup = {
  id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  categoryId: string | null;
  vip: boolean;
  detailUrl: string | null;
  joinUrl: string | null;
  whatsappUrl: string | null;
  inviteProtected: boolean;
  image: { url: string; alt: string | null } | null;
};

export type GruposWhatsSearchResult = {
  query: string;
  category?: string | null;
  fetchedAt: string;
  total: number;
  includeDetails: boolean;
  inviteResolution?: "protected" | "direct";
  categories?: GruposWhatsCategory[];
  groups: GruposWhatsGroup[];
};

const buildSearchUrl = (query: string, options: GruposWhatsSearchOptions): URL => {
  const url = new URL(DEFAULT_SERVICE_URL);
  if (query.trim()) {
    url.searchParams.set("q", query.trim());
  }
  if (options.category?.trim()) {
    url.searchParams.set("category", options.category.trim().toLowerCase());
  }

  if (options.maxPages !== undefined && !Number.isNaN(options.maxPages)) {
    url.searchParams.set("maxPages", String(Math.max(1, Math.floor(options.maxPages))));
  }
  if (options.page !== undefined && !Number.isNaN(options.page)) {
    url.searchParams.set("page", String(Math.max(1, Math.floor(options.page))));
  }
  if (options.delayMs !== undefined && !Number.isNaN(options.delayMs)) {
    url.searchParams.set("delayMs", String(Math.max(0, Math.floor(options.delayMs))));
  }
  if (options.includeDetails !== undefined) {
    const details = options.includeDetails ? "1" : "0";
    url.searchParams.set("includeDetails", details);
    url.searchParams.set("details", details);
  }
  if (options.verbose) {
    url.searchParams.set("verbose", "1");
  }

  return url;
};

export const searchGruposWhats = async (
  query: string,
  options: GruposWhatsSearchOptions = {},
): Promise<GruposWhatsSearchResult> => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery && !options.category?.trim()) {
    throw new Error("Informe a consulta ou uma categoria para buscar os grupos.");
  }

  const url = buildSearchUrl(trimmedQuery, options);
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Falha ao consultar o agregador de grupos (${response.status}). ${body || "Sem detalhes."}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Resposta inválida da API de grupos.");
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Resposta inesperada da API de grupos.");
  }

  const result = payload as GruposWhatsSearchResult;
  if (!Array.isArray(result.groups)) {
    throw new Error("Resposta da API de grupos não contém a lista esperada.");
  }

  return result;
};
