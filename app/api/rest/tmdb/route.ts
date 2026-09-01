import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";

type TmdbType = "movie" | "tv" | "multi";

const getConfigModule = <T = any>(): T | null => {
  try {
    const resolver = eval("require") as NodeRequire;
    return resolver("config/app-settings.js") as T;
  } catch {
    return null;
  }
};

const getTmdbConfig = () => {
  const apiKey =
    process.env.TMDB_API_KEY ||
    (() => {
      const cfg = getConfigModule();
      return cfg?.tmdbApiKey || cfg?.config?.tmdbApiKey || null;
    })();
  const readToken =
    process.env.TMDB_READ_TOKEN ||
    (() => {
      const cfg = getConfigModule();
      return cfg?.tmdbReadToken || cfg?.config?.tmdbReadToken || null;
    })();
  return { apiKey: apiKey || null, readToken: readToken || null };
};

const fetchTmdb = async (path: string, params: Record<string, string | number>) => {
  const { apiKey, readToken } = getTmdbConfig();
  if (!apiKey || !readToken) {
    throw new Error("TMDB API key/token não configurados");
  }
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set("api_key", apiKey);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const resp = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${readToken}`,
    },
    next: { revalidate: 60 },
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(msg || `TMDB (${resp.status})`);
  }
  return resp.json();
};

const toTmdbType = (typeParam: string | null): TmdbType => {
  const raw = (typeParam || "").toLowerCase();
  if (raw === "filme" || raw === "movie" || raw === "film") return "movie";
  if (raw === "serie" || raw === "tv" || raw === "show") return "tv";
  return "multi";
};

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || searchParams.get("query") || "").trim();
    const typeParam = searchParams.get("type");
    const lang = (searchParams.get("lang") || "pt-BR").trim() || "pt-BR";

    if (!q) {
      return NextResponse.json({ status: false, mensagem: "Informe q" }, { status: 400 });
    }

    const searchType = toTmdbType(typeParam);

    // Se for ID numérico, tenta buscar direto
    if (/^\\d+$/.test(q)) {
      const bases: TmdbType[] =
        searchType === "multi" ? ["movie", "tv"] : [searchType];
      for (const base of bases) {
        try {
          const data = await fetchTmdb(`${base}/${q}`, { language: lang });
          return NextResponse.json({ status: true, resultado: data });
        } catch {
          // tenta próxima base
        }
      }
      return NextResponse.json(
        { status: false, mensagem: "Nenhum resultado encontrado" },
        { status: 404 },
      );
    }

    // Busca por termo
    const dataSearch = await fetchTmdb(`search/${searchType}`, {
      query: q,
      language: lang,
    });
    const first =
      Array.isArray(dataSearch?.results) && dataSearch.results.length > 0
        ? dataSearch.results[0]
        : null;
    if (!first) {
      return NextResponse.json(
        { status: false, mensagem: "Nenhum resultado encontrado" },
        { status: 404 },
      );
    }

    const detailType: TmdbType =
      searchType === "multi" ? (first.media_type as TmdbType) : searchType;
    const detail = await fetchTmdb(`${detailType}/${first.id}`, {
      language: lang,
    });

    return NextResponse.json({ status: true, resultado: detail });
  } catch (err: any) {
    const message = err?.message || "Erro";
    return NextResponse.json({ status: false, mensagem: message }, { status: 500 });
  }
});
