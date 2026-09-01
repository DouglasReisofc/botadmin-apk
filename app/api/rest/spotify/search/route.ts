import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { searchSpotifyTracks } from "lib/apis/spotify-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseLimit = (raw: string | null): number | undefined => {
  if (!raw) {
    return undefined;
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return numeric;
};

export const GET = withUserApiAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? searchParams.get("query") ?? "";
    const limit = parseLimit(searchParams.get("limit"));

    const result = await searchSpotifyTracks(query, limit);
    const payload = {
      status: true,
      query: result.query,
      total: result.total,
      resultado: result.items.map((item) => ({
        title: item.title,
        artist: item.artist,
        duration: item.duration,
        thumbnail: item.thumbnail,
        url: item.url,
        downloadEndpoint: "/api/download/spotify",
        downloadQuery: { url: item.url },
      })),
      source: result.source,
    };

    return NextResponse.json(payload, {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  } catch (error) {
    const message = (error as Error)?.message || "Erro ao buscar músicas no Spotify.";
    return NextResponse.json(
      {
        status: false,
        message,
      },
      {
        status: /termo|informe|encontrada/i.test(message) ? 400 : 502,
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      },
    );
  }
});
