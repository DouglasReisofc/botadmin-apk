/**
 * Descobre o vídeo de um link colado na ligação.
 *  - link direto (.mp4, .m3u8/HLS, .webm…): usado como está
 *  - Instagram, TikTok, Kwai, Facebook, Pinterest, YouTube…: resolvido pelos
 *    downloaders internos (/api/rest/auto) para uma URL de mídia direta.
 * A EasyZap baixa ou transmite essa URL; aqui só se decide qual URL é.
 */

export type CallVideoPlatform =
  | "direct"
  | "hls"
  | "instagram"
  | "tiktok"
  | "kwai"
  | "facebook"
  | "pinterest"
  | "youtube"
  | "twitter"
  | "threads"
  | "other";

export type ResolvedCallVideoSource = {
  url: string;
  platform: CallVideoPlatform;
  title: string | null;
  /** URL que o usuário colou (quando difere da resolvida). */
  originalUrl: string | null;
  /** true quando só dá para transmitir direto do link (HLS). */
  streamOnly: boolean;
};

export type CallVideoPlaylistKind = "live" | "movie" | "series";

export type CallVideoPlaylistItem = {
  title: string;
  url: string;
  kind: CallVideoPlaylistKind;
  group: string | null;
  logo: string | null;
  duration: number | null;
};

export type CallVideoPlaylistInspection = {
  isPlaylist: boolean;
  title: string | null;
  items: CallVideoPlaylistItem[];
  counts: Record<CallVideoPlaylistKind, number>;
  truncated: boolean;
};

const MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ts|3gp)(?:$|[?#])/i;
const HLS_EXT = /\.(m3u8|m3u)(?:$|[?#])|\.m3u8/i;
const BAD_EXT = /\.(jpe?g|png|webp|gif|bmp|svg|mp3|m4a|aac|ogg|opus|wav|vtt|srt)(?:$|[?#])/i;

const SOCIAL: Array<{ platform: CallVideoPlatform; domains: string[] }> = [
  { platform: "tiktok", domains: ["tiktok.com", "douyin.com", "iesdouyin.com"] },
  { platform: "kwai", domains: ["kwai.com", "kuaishou.com", "k.kwai.com", "kw.ai"] },
  { platform: "instagram", domains: ["instagram.com", "instagr.am"] },
  { platform: "facebook", domains: ["facebook.com", "fb.watch", "fb.com", "fb.gg"] },
  { platform: "pinterest", domains: ["pinterest.com", "pin.it", "pinterest.com.br"] },
  { platform: "youtube", domains: ["youtube.com", "youtu.be", "music.youtube.com"] },
  { platform: "twitter", domains: ["twitter.com", "x.com", "t.co"] },
  { platform: "threads", domains: ["threads.net", "threads.com"] },
];

const hostOf = (value: string): string => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const playlistKind = (title: string, group: string, url: string): CallVideoPlaylistKind => {
  const haystack = `${title} ${group} ${url}`.toLowerCase();
  if (
    /(?:^|[^a-z])(series?|seriados?|temporada|season|epis[oó]dio|episode)(?:[^a-z]|$)/i.test(haystack) ||
    /(?:^|[^a-z])s\d{1,2}e\d{1,3}(?:[^a-z]|$)/i.test(haystack) ||
    /\/series?(?:\/|[-_])/i.test(url)
  ) return "series";
  if (
    /(?:ao vivo|live|canais?|canal|news|not[ií]cias|sports?|esportes|tv\s*ao\s*vivo)/i.test(haystack) ||
    /\/live(?:\/|[-_])/i.test(url)
  ) return "live";
  return "movie";
};

const m3uAttribute = (line: string, name: string): string | null => {
  const match = line.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1]?.trim() || null;
};

/** Analisa uma lista M3U sem iniciar a chamada nem preparar mídia. */
export const inspectCallVideoPlaylist = async (
  rawLink: string,
): Promise<CallVideoPlaylistInspection> => {
  const link = rawLink.trim();
  if (!/^https?:\/\//i.test(link) || link.length > 2048) {
    throw new CallVideoSourceError("Cole um link http ou https de lista M3U.", 400);
  }
  let response: Response;
  try {
    response = await fetch(link, {
      redirect: "follow",
      headers: { "user-agent": "BotAdmin-CallPlaylist/1.0", accept: "audio/x-mpegurl,text/plain,*/*" },
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new CallVideoSourceError("Não consegui ler essa lista M3U.", 502);
  }
  if (!response.ok) {
    throw new CallVideoSourceError(`A lista M3U respondeu HTTP ${response.status}.`, 422);
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > 96 * 1024 * 1024) {
    throw new CallVideoSourceError("Essa lista M3U é maior que 96 MB.", 413);
  }
  const text = await response.text();
  if (text.length > 96 * 1024 * 1024) {
    throw new CallVideoSourceError("Essa lista M3U é maior que 96 MB.", 413);
  }
  const lines = text.split(/\r?\n/);
  const items: CallVideoPlaylistItem[] = [];
  const counts: Record<CallVideoPlaylistKind, number> = { live: 0, movie: 0, series: 0 };
  let currentInfo: string | null = null;
  let currentDuration: number | null = null;
  const base = response.url || link;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      currentInfo = line;
      const durationText = line.slice(8).split(",", 1)[0].trim();
      const duration = Number(durationText);
      currentDuration = Number.isFinite(duration) && duration >= 0 ? duration : null;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!currentInfo) continue;
    let url: string;
    try {
      url = new URL(line, base).toString();
    } catch {
      currentInfo = null;
      currentDuration = null;
      continue;
    }
    const comma = currentInfo.indexOf(",");
    const title = (comma >= 0 ? currentInfo.slice(comma + 1) : "")
      .trim()
      .replace(/^\s+|\s+$/g, "") || "Vídeo sem nome";
    const group = m3uAttribute(currentInfo, "group-title");
    const kind = playlistKind(title, group || "", url);
    counts[kind] += 1;
    if (items.length < 6000) {
      items.push({
        title: title.slice(0, 240),
        url,
        kind,
        group,
        logo: m3uAttribute(currentInfo, "tvg-logo"),
        duration: currentDuration,
      });
    }
    currentInfo = null;
    currentDuration = null;
  }
  if (items.length === 0) {
    throw new CallVideoSourceError("A lista não contém entradas de vídeo reconhecíveis.", 422);
  }
  return {
    isPlaylist: true,
    title: hostOf(link) || null,
    items,
    counts,
    truncated: items.length < counts.live + counts.movie + counts.series,
  };
};

export const detectCallVideoPlatform = (link: string): CallVideoPlatform => {
  const host = hostOf(link);
  for (const entry of SOCIAL) {
    if (entry.domains.some((d) => host === d || host.endsWith(`.${d}`))) return entry.platform;
  }
  if (HLS_EXT.test(link)) return "hls";
  if (MEDIA_EXT.test(link)) return "direct";
  return "other";
};

const internalBase = (): string => {
  const explicit = process.env.REST_INTERNAL_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return `http://127.0.0.1:${process.env.PORT?.trim() || "4478"}`;
};

const internalKey = (): string | null => {
  for (const candidate of [
    process.env.INTERNAL_API_KEY,
    process.env.BOTADMIN_INTERNAL_API_KEY,
    process.env.USER_API_FALLBACK_KEY,
  ]) {
    if (candidate?.trim()) return candidate.trim();
  }
  return null;
};

const GOOD_KEYS = /^(hdplay|hd|hd_url|hdurl|url|download|downloadurl|video|videourl|play|src|source|link|mp4|nowm|nowatermark)$/i;
const BAD_KEYS = /(thumb|cover|avatar|image|img|photo|poster|audio|music|mp3|profile|icon|logo|preview)/i;

type Candidate = { value: string; score: number; key: string };

const collect = (node: unknown, key: string, depth: number, out: Candidate[]) => {
  if (depth > 6 || node == null) return;
  if (typeof node === "string") {
    if (!/^https?:\/\//i.test(node)) return;
    if (BAD_EXT.test(node) || BAD_KEYS.test(key)) return;
    let score = 0;
    if (HLS_EXT.test(node)) score += 4;
    if (MEDIA_EXT.test(node)) score += 5;
    if (/video|mp4|play|download|cdn/i.test(node)) score += 1;
    if (GOOD_KEYS.test(key)) score += 3;
    if (/^hd/i.test(key)) score += 2;
    if (/wm|watermark/i.test(key) && !/nowm|nowatermark/i.test(key)) score -= 3;
    out.push({ value: node, score, key });
    return;
  }
  if (Array.isArray(node)) {
    node.slice(0, 20).forEach((item, index) => collect(item, key || String(index), depth + 1, out));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) collect(v, k, depth + 1, out);
  }
};

export const extractVideoUrlFromRestPayload = (payload: unknown): { url: string | null; title: string | null } => {
  const root = (payload ?? {}) as Record<string, unknown>;
  const result = (root.resultado ?? root.result ?? root.data ?? root) as unknown;
  const candidates: Candidate[] = [];
  collect(result, "", 0, candidates);
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates.find((c) => c.score > 0) ?? null;
  const res = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const title = [res.title, res.titulo, res.desc, res.description, res.caption]
    .find((v): v is string => typeof v === "string" && v.trim().length > 0);
  return { url: best?.value ?? null, title: title?.trim().slice(0, 140) ?? null };
};

export class CallVideoSourceError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

export const resolveCallVideoSource = async (
  rawLink: string,
  userApiKey?: string | null,
): Promise<ResolvedCallVideoSource> => {
  const link = rawLink.trim();
  if (!/^https?:\/\//i.test(link) || link.length > 2048) {
    throw new CallVideoSourceError("Cole um link http ou https de vídeo.", 400);
  }
  const platform = detectCallVideoPlatform(link);
  if (platform === "direct" || platform === "hls" || platform === "other") {
    // Links diretos e desconhecidos vão como estão; a EasyZap valida e rejeita o que não for vídeo.
    return {
      url: link,
      platform,
      title: null,
      originalUrl: null,
      streamOnly: platform === "hls",
    };
  }
  const headers: Record<string, string> = { accept: "application/json" };
  const key = userApiKey?.trim() || internalKey();
  if (key) headers["x-api-key"] = key;
  let payload: unknown = null;
  try {
    const response = await fetch(`${internalBase()}/api/rest/auto?url=${encodeURIComponent(link)}`, {
      headers,
      signal: AbortSignal.timeout(90_000),
    });
    payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        (payload as { mensagem?: string; message?: string } | null)?.mensagem ??
        (payload as { message?: string } | null)?.message ??
        `HTTP ${response.status}`;
      throw new CallVideoSourceError(`Não consegui obter o vídeo desse link (${message}).`, 422);
    }
  } catch (error) {
    if (error instanceof CallVideoSourceError) throw error;
    throw new CallVideoSourceError("O serviço de download não respondeu. Tente de novo em instantes.", 502);
  }
  const { url, title } = extractVideoUrlFromRestPayload(payload);
  if (!url) {
    throw new CallVideoSourceError(
      "Esse link não trouxe um vídeo utilizável (pode ser só imagem, privado ou removido).",
      422,
    );
  }
  return {
    url,
    platform,
    title,
    originalUrl: link,
    streamOnly: HLS_EXT.test(url),
  };
};
