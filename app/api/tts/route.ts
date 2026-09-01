import { NextRequest } from "next/server";

const UPSTREAM_URL =
  process.env.TIKTOK_TTS_UPSTREAM_URL ||
  "https://tiktok-tts-extension.mobisharksdev.com/api/v1/generate";
const MAX_TEXT_BYTES = Number(process.env.TIKTOK_TTS_MAX_TEXT_BYTES || 300);
const DEFAULT_VOICE = (process.env.TIKTOK_TTS_DEFAULT_VOICE || "br_005").trim();
const UPSTREAM_CONCURRENCY = Number(process.env.TIKTOK_TTS_UPSTREAM_CONCURRENCY || 3);
const UPSTREAM_RETRIES = Number(process.env.TIKTOK_TTS_UPSTREAM_RETRIES || 1);
const RETRY_DELAY_MS = Number(process.env.TIKTOK_TTS_RETRY_DELAY_MS || 750);
const TTS_CACHE_TTL_MS = Number(process.env.TTS_CACHE_TTL_MS || 5 * 60 * 1000);
const TTS_CACHE_MAX = Number(process.env.TTS_CACHE_MAX || 100);

const VOICE_MAP: Record<string, string> = {
  laizza: "br_004",
  br004: "br_004",
  lhays: "br_003",
  ludmilla: "br_004",
  bueno: "br_005",
  ivete: "br_004",
  br003: "br_003",
  br001: "br_003",
  br002: "br_004",
  br005: "br_005",
  en_us_001: "en_us_001",
  en_us_006: "en_us_006",
  en_us_007: "en_us_007",
  en_us_009: "en_us_009",
  en_us_010: "en_us_010",
  en_uk_001: "en_uk_001",
  en_uk_003: "en_uk_003",
  en_au_001: "en_au_001",
  en_au_002: "en_au_002",
  fr_001: "fr_001",
  fr_002: "fr_002",
  de_001: "de_001",
  de_002: "de_002",
  es_002: "es_002",
  es_mx_002: "es_mx_002",
  es_male_m3: "es_male_m3",
  es_female_f6: "es_female_f6",
  es_female_fp1: "es_female_fp1",
  es_mx_female_supermom: "es_mx_female_supermom",
  id_001: "id_001",
  jp_001: "jp_001",
  jp_003: "jp_003",
  jp_005: "jp_005",
  jp_006: "jp_006",
  kr_002: "kr_002",
  kr_003: "kr_003",
  kr_004: "kr_004",
  en_us_ghostface: "en_us_ghostface",
  en_us_chewbacca: "en_us_chewbacca",
  en_us_c3po: "en_us_c3po",
  en_us_stitch: "en_us_stitch",
  en_us_stormtrooper: "en_us_stormtrooper",
  en_us_rocket: "en_us_rocket",
  en_female_f08_salut_damour: "en_female_f08_salut_damour",
  en_male_m03_lobby: "en_male_m03_lobby",
  en_male_m03_sunshine_soon: "en_male_m03_sunshine_soon",
  en_female_f08_warmy_breeze: "en_female_f08_warmy_breeze",
  en_female_ht_f08_glorious: "en_female_ht_f08_glorious",
  en_male_sing_funny_it_goes_up: "en_male_sing_funny_it_goes_up",
  en_male_m2_xhxs_m03_silly: "en_male_m2_xhxs_m03_silly",
  en_female_ht_f08_wonderful_world: "en_female_ht_f08_wonderful_world",
};

const cache: Map<string, { buf: Buffer; exp: number }> = new Map();
const queue: Array<{
  task: () => Promise<Response>;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
}> = [];
let activeUpstreamCalls = 0;

const getCache = (key: string) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.buf;
};

const setCache = (key: string, buf: Buffer) => {
  cache.set(key, { buf, exp: Date.now() + TTS_CACHE_TTL_MS });
  if (cache.size > TTS_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveVoice = (rawVoice: string) => {
  const normalized = rawVoice.trim().toLowerCase();
  if (!normalized) return DEFAULT_VOICE;
  return VOICE_MAP[normalized] || normalized;
};

const enqueue = (task: () => Promise<Response>) =>
  new Promise<Response>((resolve, reject) => {
    queue.push({ task, resolve, reject });
    runNext();
  });

const runNext = () => {
  while (activeUpstreamCalls < UPSTREAM_CONCURRENCY && queue.length > 0) {
    const item = queue.shift();
    if (!item) return;
    activeUpstreamCalls += 1;
    item.task()
      .then(item.resolve, item.reject)
      .finally(() => {
        activeUpstreamCalls -= 1;
        runNext();
      });
  }
};

const fetchWithRetry = async (payload: { text: string; voice: string }) => {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= UPSTREAM_RETRIES; attempt += 1) {
    try {
      const response = await fetch(UPSTREAM_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      lastResponse = response;
      if (response.ok || attempt === UPSTREAM_RETRIES) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === UPSTREAM_RETRIES) {
        throw error;
      }
    }

    await delay(RETRY_DELAY_MS);
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError ?? new Error("falha desconhecida no upstream");
};

const callUpstream = (payload: { text: string; voice: string }) =>
  enqueue(() => fetchWithRetry(payload));

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const texto = (searchParams.get("texto") || searchParams.get("text") || "").trim();
    const voz = resolveVoice(searchParams.get("voz") || searchParams.get("voice") || DEFAULT_VOICE);
    const format = (searchParams.get("format") || "").trim().toLowerCase();

    if (!texto || texto.length < 2) {
      return Response.json({ status: false, mensagem: "Texto muito curto." }, { status: 400 });
    }

    const textBytes = new TextEncoder().encode(texto).length;
    if (textBytes > MAX_TEXT_BYTES) {
      return Response.json(
        {
          status: false,
          mensagem: `Texto excede ${MAX_TEXT_BYTES} bytes UTF-8.`,
          bytes: textBytes,
        },
        { status: 400 },
      );
    }

    const cacheKey = `${voz}|${texto}`;
    const hit = getCache(cacheKey);
    if (hit && format !== "json") {
      return new Response(hit, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "private, max-age=60, must-revalidate",
          "Content-Disposition": "inline; filename=voz.mp3",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "X-TTS-Cache": "HIT",
        },
      });
    }

    const upstream = await callUpstream({ text: texto, voice: voz });
    const data = await upstream.json().catch(() => null) as
      | { success?: boolean; data?: string; error?: string }
      | null;

    if (!upstream.ok || !data?.success || !data.data) {
      return Response.json(
        {
          status: false,
          mensagem: "Falha no serviço TTS.",
          statusCode: upstream.ok ? 502 : upstream.status,
          body: data?.error ?? "falha ao gerar audio no upstream",
        },
        { status: upstream.ok ? 502 : upstream.status },
      );
    }

    if (format === "json") {
      return Response.json({
        success: true,
        voice: voz,
        mime: "audio/mpeg",
        data: data.data,
      });
    }

    const audio = Buffer.from(data.data, "base64");
    if (audio.length === 0) {
      return Response.json({ status: false, mensagem: "Base64 não retornado." }, { status: 500 });
    }

    setCache(cacheKey, audio);
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Content-Disposition": 'inline; filename="voz.mp3"',
        "Cache-Control": "private, max-age=60, must-revalidate",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "X-TTS-Cache": "MISS",
      },
    });
  } catch (error) {
    try {
      console.error("[tts] erro:", error);
    } catch {}
    return Response.json({ status: false, mensagem: "Erro ao gerar ou converter áudio." }, { status: 500 });
  }
}
