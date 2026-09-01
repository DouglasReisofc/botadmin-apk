const DEFAULT_SEARCH_ENDPOINT = process.env.SPOTIFY_SEARCH_API_URL || "https://theresapis.vercel.app/search/song";
const DEFAULT_SEARCH_KEY = process.env.SPOTIFY_SEARCH_API_KEY || "THERESA";
const MAX_RESULTS = 20;

export type SpotifySearchItem = {
  title: string;
  artist: string;
  url: string;
  duration: string | null;
  thumbnail: string | null;
};

export type SpotifySearchResult = {
  query: string;
  total: number;
  items: SpotifySearchItem[];
  source: "theresapis";
};

type RawSearchResponse = {
  status?: boolean;
  result?: {
    songs?: unknown;
  };
};

const normalizeItems = (payload: unknown, limit: number): SpotifySearchItem[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  const items: SpotifySearchItem[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url) {
      continue;
    }

    const title = typeof record.title === "string" ? record.title.trim() : "";
    const artist = typeof record.artist === "string" ? record.artist.trim() : "";
    const duration = typeof record.duration === "string" ? record.duration.trim() : null;
    const thumbnail = typeof record.thumbnail === "string" ? record.thumbnail.trim() : null;

    items.push({
      title: title || url,
      artist,
      url,
      duration,
      thumbnail,
    });

    if (items.length >= limit) {
      break;
    }
  }
  return items;
};

const buildSearchUrl = (endpoint: string, query: string): string => {
  const url = new URL(endpoint);
  url.searchParams.set("apikey", DEFAULT_SEARCH_KEY);
  url.searchParams.set("query", query);
  return url.toString();
};

export const searchSpotifyTracks = async (query: string, limit = MAX_RESULTS): Promise<SpotifySearchResult> => {
  const sanitizedQuery = query.trim();
  if (!sanitizedQuery) {
    throw new Error("Informe um termo para pesquisar no Spotify.");
  }

  const max = Number.isFinite(limit) ? Math.max(1, Math.min(MAX_RESULTS, Math.floor(limit))) : MAX_RESULTS;
  const endpoint = DEFAULT_SEARCH_ENDPOINT.trim() || DEFAULT_SEARCH_ENDPOINT;
  const url = buildSearchUrl(endpoint, sanitizedQuery);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error("[spotify-search] network error", { error });
    throw new Error("Não foi possível contatar o serviço de busca do Spotify.");
  }

  if (!response.ok) {
    throw new Error("Não foi possível consultar a busca do Spotify no momento.");
  }

  let data: RawSearchResponse | null = null;
  try {
    data = (await response.json()) as RawSearchResponse;
  } catch {
    data = null;
  }

  if (!data?.status) {
    throw new Error("Busca do Spotify indisponível no momento.");
  }

  const items = normalizeItems(data?.result?.songs, max);
  if (items.length === 0) {
    throw new Error("Nenhuma música encontrada para o termo informado.");
  }

  return {
    query: sanitizedQuery,
    total: items.length,
    items,
    source: "theresapis",
  };
};
