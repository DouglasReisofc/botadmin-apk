import { NextRequest } from "next/server";

const TTS_BASE_URL = (process.env.NEXT_PUBLIC_TTS_BASE_URL || "/api/tts").trim();
const TTS_VOICE = (process.env.NEXT_PUBLIC_TTS_VOICE || "ludmilla").trim();
const TTS_API_KEY = (process.env.NEXT_PUBLIC_TTS_API_KEY || "equipevipadm").trim();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const texto = (searchParams.get("texto") || "").trim();
    const voz = (searchParams.get("voz") || TTS_VOICE).trim();
    const apikey = (searchParams.get("apikey") || TTS_API_KEY).trim();

    if (!texto) {
      return new Response(JSON.stringify({ message: "Informe o parâmetro 'texto'." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // Monta a URL upstream (permite que TTS_BASE_URL seja relativo ou absoluto)
    const upstream = TTS_BASE_URL.startsWith("http")
      ? new URL(TTS_BASE_URL)
      : new URL(TTS_BASE_URL, request.nextUrl.origin);

    upstream.searchParams.set("texto", texto);
    if (voz) upstream.searchParams.set("voz", voz);
    if (apikey) upstream.searchParams.set("apikey", apikey);

    const upstreamRes = await fetch(upstream.toString(), {
      method: "GET",
      // Server-side fetch; CORS não se aplica aqui
      headers: {
        // Repasse de cabeçalhos úteis, se necessário
      },
      cache: "no-store",
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      const bodyText = await upstreamRes.text().catch(() => "");
      return new Response(JSON.stringify({ message: "Falha no TTS", status: upstreamRes.status, body: bodyText.slice(0, 500) }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const contentType = upstreamRes.headers.get("content-type") || "audio/mpeg";
    const resp = new Response(upstreamRes.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Hints de cache leves para CDN, sem reter demais
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        // Melhor interoperabilidade de players
        "Accept-Ranges": "bytes",
        // Em tese é same-origin, mas liberamos por segurança para elementos de mídia
        "Access-Control-Allow-Origin": "*",
      },
    });

    return resp;
  } catch {
    return new Response(JSON.stringify({ message: "Erro interno no proxy de TTS" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
