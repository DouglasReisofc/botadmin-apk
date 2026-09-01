import fs from 'node:fs';
import ytdl from 'ytdl-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
const evalRequire: NodeRequire = (eval('require') as NodeRequire);

type ConsoleMethod = (...data: any[]) => void;

let mutedYtSearchConsoleDepth = 0;
let originalConsoleLog: ConsoleMethod | null = null;
let originalConsoleDebug: ConsoleMethod | null = null;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isYtSearchNoiseLog = (args: unknown[]): boolean => {
  const first = args[0];
  if (typeof first === 'string') {
    const text = first.trim();
    return text === 'DEBUGGING' || text.startsWith('getting results:') || text.startsWith('items.length:');
  }
  if (isObject(first)) {
    const href = typeof first.href === 'string' ? first.href : '';
    const host = typeof first.host === 'string' ? first.host : '';
    const pathname = typeof first.pathname === 'string' ? first.pathname : '';
    return href.includes('youtube.com/results') || (host === 'www.youtube.com' && pathname === '/results');
  }
  return false;
};

const withMutedYtSearchConsole = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (process.env.YT_SEARCH_DEBUG === '1') {
    return fn();
  }

  if (mutedYtSearchConsoleDepth === 0) {
    originalConsoleLog = console.log.bind(console);
    originalConsoleDebug = console.debug.bind(console);
    console.log = ((...args: unknown[]) => {
      if (!isYtSearchNoiseLog(args)) originalConsoleLog?.(...args);
    }) as typeof console.log;
    console.debug = ((...args: unknown[]) => {
      if (!isYtSearchNoiseLog(args)) originalConsoleDebug?.(...args);
    }) as typeof console.debug;
  }
  mutedYtSearchConsoleDepth += 1;

  try {
    return await fn();
  } finally {
    mutedYtSearchConsoleDepth = Math.max(0, mutedYtSearchConsoleDepth - 1);
    if (mutedYtSearchConsoleDepth === 0) {
      if (originalConsoleLog) console.log = originalConsoleLog as typeof console.log;
      if (originalConsoleDebug) console.debug = originalConsoleDebug as typeof console.debug;
      originalConsoleLog = null;
      originalConsoleDebug = null;
    }
  }
};

const withMutedYtSearchDebugEnv = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (process.env.YT_SEARCH_DEBUG === '1') {
    return fn();
  }

  const previousDebug = process.env.DEBUG;
  if (previousDebug) {
    process.env.DEBUG = '0';
  }

  try {
    return await fn();
  } finally {
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  }
};

const importYtSearch = async (): Promise<any> =>
  withMutedYtSearchDebugEnv(() => import('yt-search'));


const fetchRestDownload = async (
  kind: 'ytmp3' | 'ytmp4',
  query: string,
  apiKey?: string | null,
): Promise<YtPlayResult> => {
  const baseUrl = getBaseUrl();
  const url = new URL(`/api/rest/${kind}`, baseUrl);
  url.searchParams.set('q', query);
  const headers: Record<string, string> = { accept: 'application/json' };
  const resolvedApiKey = apiKey?.trim() || getInternalApiKey();
  if (resolvedApiKey) {
    headers['x-api-key'] = resolvedApiKey;
  }

  // 1) Tentativa via endpoint REST (conversão MP3/MP4)
  let restData: any = null;
  try {
    const resp = await fetch(url.toString(), { headers });
    try {
      restData = await resp.json();
    } catch {
      /* ignore */
    }
    if (resp.ok && restData?.resultado?.url) {
      return restData.resultado as YtPlayResult;
    }
  } catch {
    /* segue fallback */
  }

  // 2) Fallback direto via scripts Python (yt_dlp) já utilizados no painel
  const resolved = await resolveBestUrl(query);
  if (!resolved) {
    const message = restData?.message || restData?.mensagem || "Não foi possível encontrar o vídeo.";
    throw new Error(message);
  }
  const pyKind: 'audio' | 'video' = kind === 'ytmp3' ? 'audio' : 'video';
  return runPython(pyKind, resolved.url);
};

export type YtSearchItem = {
  id: string;
  title: string;
  url: string;
  duration: string;
  author: string;
  views: number;
  thumbnail: string;
  published?: string;
};

type YtDlpSearchRecord = {
  id?: unknown;
  title?: unknown;
  uploader?: unknown;
  channel?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  webpage_url?: unknown;
  view_count?: unknown;
  upload_date?: unknown;
};

const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;

/**
 * Resolve metadados diretamente pelo yt-dlp configurado no servidor.
 *
 * Esta busca usa o mesmo cookie/player/runtime dos downloaders e serve como
 * fallback confiavel quando o HTML publico do YouTube bloqueia `yt-search`.
 * Os argumentos sao passados diretamente ao processo (sem shell).
 */
export async function ytDlpSearch(query: string, limit = 1): Promise<YtSearchItem[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, 50));
  const binary = process.env.YT_DLP_BINARY?.trim() || 'yt-dlp';
  const cookiePath = path.join(process.cwd(), 'lib', 'python', 'ytcookies.txt');
  const playerClients = process.env.YT_PLAYER_CLIENTS?.trim() || 'android,mweb';
  const args = [
    '--skip-download',
    '--no-playlist',
    '--playlist-end',
    String(safeLimit),
    '--default-search',
    `ytsearch${safeLimit}`,
    '--socket-timeout',
    '8',
    '--no-warnings',
    '--extractor-args',
    `youtube:player_client=${playerClients}`,
  ];

  if (fs.existsSync(cookiePath)) {
    args.push('--cookies', cookiePath);
  }
  if (process.env.YT_ALLOW_NODE_JS_RUNTIME === '1' && process.env.YT_JS_RUNTIME?.trim()) {
    args.push('--js-runtimes', `node:${process.env.YT_JS_RUNTIME.trim()}`);
  }
  const remoteComponents = process.env.YT_REMOTE_COMPONENTS?.trim() || 'ejs:github';
  if (remoteComponents) {
    args.push('--remote-components', remoteComponents);
  }
  args.push(
    '--print',
    '%(.{id,title,uploader,channel,duration,thumbnail,webpage_url,view_count,upload_date})j',
    cleanQuery,
  );

  return new Promise<YtSearchItem[]>((resolve) => {
    const child = spawn(binary, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let settled = false;
    const finish = (items: YtSearchItem[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(items);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish([]);
    }, 20_000);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 1_000_000) stdout += String(chunk);
    });
    child.on('error', () => finish([]));
    child.on('close', (code) => {
      if (code !== 0) return finish([]);
      const items: YtSearchItem[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const raw = line.trim();
        if (!raw) continue;
        try {
          const record = JSON.parse(raw) as YtDlpSearchRecord;
          const id = typeof record.id === 'string' ? record.id.trim() : '';
          if (!youtubeVideoIdPattern.test(id)) continue;
          const directThumbnail =
            typeof record.thumbnail === 'string' && /^https?:\/\//i.test(record.thumbnail.trim())
              ? record.thumbnail.trim()
              : '';
          const webpageUrl =
            typeof record.webpage_url === 'string' && /^https?:\/\//i.test(record.webpage_url.trim())
              ? record.webpage_url.trim()
              : `https://www.youtube.com/watch?v=${id}`;
          const duration = Number(record.duration ?? 0);
          const views = Number(record.view_count ?? 0);
          items.push({
            id,
            title: typeof record.title === 'string' ? record.title.trim() : '',
            url: webpageUrl,
            duration: toDuration(duration),
            author:
              typeof record.uploader === 'string'
                ? record.uploader.trim()
                : typeof record.channel === 'string'
                  ? record.channel.trim()
                  : '',
            views: Number.isFinite(views) ? views : 0,
            thumbnail: directThumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            published: typeof record.upload_date === 'string' ? record.upload_date : undefined,
          });
          if (items.length >= safeLimit) break;
        } catch {
          // O yt-dlp pode imprimir diagnosticos no stdout em ambientes antigos.
        }
      }
      finish(items);
    });
  });
}

const buildYtdlOptions = () => {
  const cookie = getYoutubeCookieHeader();
  return cookie ? { requestOptions: { headers: { cookie } } } : {};
};

const isYoutubeIdentityTokenError = (error: unknown): boolean => {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  return (
    message.includes("unable to find YouTube identity token") ||
    message.includes("Cookie header used in request")
  );
};

const getYtdlInfoWithCookieFallback = async (target: string) => {
  const opts = buildYtdlOptions() as Parameters<typeof ytdl.getInfo>[1];
  const hasCookieHeader = Boolean(
    (opts as { requestOptions?: { headers?: { cookie?: string } } })?.requestOptions?.headers?.cookie,
  );

  if (!hasCookieHeader) {
    return ytdl.getInfo(target);
  }

  try {
    return await ytdl.getInfo(target, opts);
  } catch (error) {
    if (isYoutubeIdentityTokenError(error)) {
      if (process.env.DEBUG_YT === "1") {
        console.warn("[yt] ytdl cookie header rejected; retrying without cookie", {
          target,
          error: (error as { message?: string })?.message || String(error),
        });
      }
      return ytdl.getInfo(target);
    }
    throw error;
  }
};

const PIPED_HOSTS = [
  'https://piped.video',
  'https://pipedapi.kavin.rocks',
  'https://piped.projectsegfau.lt',
  'https://piped.mha.fi',
  'https://piped.tokhmi.xyz',
  'https://piped.syncpundit.io',
  'https://piped.in.projectsegfau.lt',
  'https://piped.lunar.icu',
];

const toDuration = (seconds: number | undefined | null): string => {
  const s = Number(seconds ?? 0);
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const mm = m.toString().padStart(2, '0');
  const sss = ss.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${sss}` : `${m}:${sss}`;
};

const absolutize = (host: string, url: string): string =>
  /^https?:\/\//i.test(url) ? url : host.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${url}`);

type PipedItem = {
  type: string;
  url?: string;
  id?: string;
  title?: string;
  thumbnail?: string;
  uploaderName?: string;
  views?: number;
  duration?: number;
  uploaded?: string;
  uploadedDate?: string;
};

async function pipedSearch(query: string, host: string): Promise<YtSearchItem[]> {
  const endpoint = `${host.replace(/\/$/, '')}/api/v1/search?q=${encodeURIComponent(query)}`;
  const resp = await fetch(endpoint, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Piped search failed (${resp.status})`);
  const items = (await resp.json()) as PipedItem[];
  const streams = items.filter((it) => it && (it.type === 'stream' || it.type === 'video'));
  const results: YtSearchItem[] = [];
  for (const it of streams) {
    let id = it.id || '';
    if (!id && it.url) {
      const u = new URL(absolutize(host, it.url));
      id = u.searchParams.get('v') || '';
    }
    if (!id) continue;
    const thumb = it.thumbnail ? absolutize(host, it.thumbnail) : '';
    results.push({
      id,
      title: it.title || '',
      url: `https://www.youtube.com/watch?v=${id}`,
      duration: toDuration(it.duration),
      author: it.uploaderName || '',
      views: Number(it.views || 0),
      thumbnail: thumb,
      published: it.uploadedDate || it.uploaded,
    });
  }
  return results;
}

// Invidious fallback (sem cheerio)
const INVIDIOUS_HOSTS = [
  'https://yewtu.be',
  'https://inv.n8pjl.ca',
  'https://vid.puffyan.us',
  'https://invidious.nerdvpn.de',
];

type InvidiousItem = {
  type?: string;
  videoId?: string;
  title?: string;
  author?: string;
  viewCount?: number | string;
  lengthSeconds?: number | string;
  videoThumbnails?: Array<{ url: string }>;
  publishedText?: string;
};

async function invidiousSearch(query: string, host: string): Promise<YtSearchItem[]> {
  const endpoint = `${host.replace(/\/$/, '')}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
  const resp = await fetch(endpoint, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Invidious search failed (${resp.status})`);
  const items = (await resp.json()) as InvidiousItem[];
  const results: YtSearchItem[] = [];
  for (const it of items) {
    const id = it.videoId || '';
    if (!id) continue;
    const thumb = Array.isArray(it.videoThumbnails) && it.videoThumbnails.length
      ? it.videoThumbnails[it.videoThumbnails.length - 1].url
      : '';
    const dur = typeof it.lengthSeconds === 'string' ? Number(it.lengthSeconds) : Number(it.lengthSeconds || 0);
    const views = typeof it.viewCount === 'string' ? Number(it.viewCount) : Number(it.viewCount || 0);
    results.push({
      id,
      title: it.title || '',
      url: `https://www.youtube.com/watch?v=${id}`,
      duration: toDuration(dur),
      author: it.author || '',
      views,
      thumbnail: thumb,
      published: it.publishedText,
    });
  }
  return results;
}

export async function ytSearch(query: string, limit = 10): Promise<YtSearchItem[]> {
  // 1) Tenta com yt-search (compatível com legado)
  try {
    const mod: any = await importYtSearch();
    const yts = (mod && (mod.default || mod)) as (q: string) => Promise<any>;
    if (typeof yts === 'function') {
      const res = await withMutedYtSearchConsole(() => yts(query));
      const videos = Array.isArray(res?.videos) ? res.videos : Array.isArray(res?.all) ? res.all.filter((x: any) => x?.type === 'video') : [];
      return videos.slice(0, Math.max(1, Math.min(limit, 50))).map((v: any) => ({
        id: v.videoId || v.video_id || v.videoid || '',
        title: v.title || '',
        url: v.url || (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : ''),
        duration: v.timestamp || toDuration(v.duration),
        author: v.author?.name || v.author || '',
        views: Number(v.views || 0),
        thumbnail: v.image || v.thumbnail || '',
        published: v.ago || v.ago_text || undefined,
      }));
    }
  } catch {/* fallback abaixo */}

  // 2) Fallback: Piped (sem cheerio)
  for (const host of PIPED_HOSTS) {
    try {
      const list = await pipedSearch(query, host);
      return list.slice(0, Math.max(1, Math.min(limit, 50)));
    } catch {}
  }

  // 3) Fallback: Invidious
  for (const host of INVIDIOUS_HOSTS) {
    try {
      const list = await invidiousSearch(query, host);
      if (list.length) return list.slice(0, Math.max(1, Math.min(limit, 50)));
    } catch {}
  }

  // 4) Sem resultados — retorne lista vazia em vez de lançar
  return [];
}

export type YtPlayResult = {
  id: string;
  title: string;
  author: string;
  url: string; // direct media URL
  durationSeconds: number;
  thumbnail: string;
  format: string;
};

const isUrl = (s: string) => /^(https?:)?\/\//i.test(s);

const resolveBestUrl = async (query: string): Promise<{ id: string; url: string } | null> => {
  if (isUrl(query)) {
    try {
      const id = new URL(query).searchParams.get('v') || query.split('/').pop() || '';
      return { id, url: query };
    } catch { return { id: '', url: query }; }
  }
  const [best] = await ytSearch(query, 1);
  if (!best) return null;
  return { id: best.id, url: best.url };
};

const getYoutubeCookieHeader = (): string | null => {
  try {
    const cookiePath = path.join(process.cwd(), 'lib', 'python', 'ytcookies.txt');
    const raw = fs.readFileSync(cookiePath, 'utf-8');
    const pairs: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('\t');
      if (parts.length >= 7) {
        const name = parts[5];
        const value = parts[6];
        if (name && value) pairs.push(`${name}=${value}`);
      }
    }
    return pairs.length ? pairs.join('; ') : null;
  } catch {
    return null;
  }
};

function getBaseUrl(): string {
  // Prefer internal loopback for server-side self-calls on this host.
  if (process.env.INTERNAL_APP_URL && process.env.INTERNAL_APP_URL.trim()) {
    return process.env.INTERNAL_APP_URL.trim().replace(/\/$/, '');
  }
  // Prioriza domínio do app em execução
  if (process.env.APP_URL && process.env.APP_URL.trim()) {
    return process.env.APP_URL.trim().replace(/\/$/, '');
  }
  if (process.env.BASE_SITE_URL && process.env.BASE_SITE_URL.trim()) {
    return process.env.BASE_SITE_URL.trim().replace(/\/$/, '');
  }
  try {
    const cfg = evalRequire('config/app-settings.js');
    if (cfg?.basesiteUrl) return String(cfg.basesiteUrl).replace(/\/$/, '');
  } catch {}
  return 'http://localhost:4478';
}

function getPublicMediaBaseUrl(): string {
  const candidates = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BASE_SITE_URL,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim().replace(/\/$/, '');
    }
  }
  return getBaseUrl();
}

function getInternalApiKey(): string | null {
  const candidates = [
    process.env.INTERNAL_API_KEY,
    process.env.BOTADMIN_INTERNAL_API_KEY,
    process.env.USER_API_FALLBACK_KEY,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

async function runPython(kind: 'audio' | 'video', targetUrl: string): Promise<YtPlayResult> {
  const baseDir = path.join(process.cwd(), 'lib', 'python');
  const pyScript = path.join(baseDir, kind === 'audio' ? 'audio_downloader.py' : 'video_downloader.py');
  const infoScript = path.join(baseDir, kind === 'audio' ? 'audio_info.py' : 'video_info.py');
  const baseUrl = getPublicMediaBaseUrl();

  const id: string = await new Promise((resolve, reject) => {
    const child = spawn('python3', [pyScript, targetUrl, baseUrl], { cwd: baseDir });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `python exited ${code}`));
      const val = out.trim();
      if (!val) return reject(new Error('python did not return id'));
      resolve(val);
    });
  });

  const infoJson: any = await new Promise((resolve, reject) => {
    const child = spawn('python3', [infoScript, id], { cwd: baseDir });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `python info exited ${code}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('invalid info json')); }
    });
  });

  const bundle = (kind === 'audio' ? infoJson?.audio_info : infoJson?.video_info) || {};
  const title = bundle.titulo || bundle.title || '';
  const author = bundle.uploader || '';
  const durationSeconds = Number(bundle.duration || 0);
  const thumbnail = bundle.thumbnail || '';
  // Garante duração >0 para ajudar clientes (evita mostrar 0s em players)
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : Number(bundle?.duration || 0);
  const fallbackPath = kind === 'audio' ? `/api/playaudio/${id}` : `/api/play/${id}`;
  const url = (kind === 'audio' ? bundle.audio_url : bundle.video_url) || `${baseUrl}${fallbackPath}`;
  return {
    id,
    title,
    author,
    url,
    durationSeconds: safeDuration,
    thumbnail,
    format: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
  };
}

export async function ytPlayMp3(
  query: string,
  opts: { skipInternalEndpoint?: boolean; apiKey?: string | null } = {},
): Promise<YtPlayResult> {
  if (!opts.skipInternalEndpoint) {
    try {
      return await fetchRestDownload('ytmp3', query, opts.apiKey);
  } catch (_err) {
      // Continua com os fallbacks para compatibilidade
    }
  }
  // Prefer Python downloader (yt-dlp) para o melhor resultado encontrado; fallback para ytdl-core
  try {
    const target = await resolveBestUrl(query);
    if (target?.url) return await runPython('audio', target.url);
  } catch (error) {
    // Python (yt-dlp) falhou — seguimos com fallbacks (ytdl-core).
    // Log apenas se variável de depuração estiver ativa para evitar ruído.
    if (process.env.DEBUG_YT === '1') {
      console.warn('[ytPlayMp3] python failed (fallback to ytdl)', { query, error: (error as any)?.message || String(error) });
    }
  }
  if (isUrl(query)) {
    try {
      const info = await getYtdlInfoWithCookieFallback(query);
      const audio = ytdl.filterFormats(info.formats, 'audioonly')
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
      if (!audio?.url) throw new Error('Não foi possível obter o áudio');
      const details = info.videoDetails;
      return {
        id: details.videoId,
        title: details.title,
        author: details.author?.name || '',
        url: audio.url,
        durationSeconds: Number(details.lengthSeconds || 0),
        thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url || '',
        format: audio.mimeType || 'audio/webm',
      };
    } catch {/* fallback para busca */}
  }
  const [best] = await ytSearch(query, 1);
  if (!best) throw new Error('Nenhum resultado encontrado');
  const info = await getYtdlInfoWithCookieFallback(best.id);
  const audio = ytdl.filterFormats(info.formats, 'audioonly')
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
  if (!audio?.url) throw new Error('Não foi possível obter o áudio');
  const details = info.videoDetails;
  return {
    id: details.videoId,
    title: details.title,
    author: details.author?.name || '',
    url: audio.url,
    durationSeconds: Number(details.lengthSeconds || 0),
    thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url || '',
    format: audio.mimeType || 'audio/webm',
  };
}

export async function ytPlayMp4(
  query: string,
  opts: { skipInternalEndpoint?: boolean; apiKey?: string | null } = {},
): Promise<YtPlayResult> {
  if (!opts.skipInternalEndpoint) {
    try {
      return await fetchRestDownload('ytmp4', query, opts.apiKey);
  } catch (_err) {
      // Continua com fallbacks se endpoint falhar
    }
  }
  try {
    const target = await resolveBestUrl(query);
    if (target?.url) return await runPython('video', target.url);
  } catch (error) {
    if (process.env.DEBUG_YT === '1') {
      console.warn('[ytPlayMp4] python failed (fallback to ytdl)', { query, error: (error as any)?.message || String(error) });
    }
  }
  if (isUrl(query)) {
    try {
      const info = await getYtdlInfoWithCookieFallback(query);
      const progressive = info.formats
        .filter((f) => f.container === 'mp4' && f.hasAudio && f.hasVideo && !!f.url)
        .sort((a, b) => (b.qualityLabel || '').localeCompare(a.qualityLabel || ''))[0];
      const chosen = progressive || info.formats.find((f) => f.hasAudio && f.hasVideo && !!f.url);
      if (!chosen?.url) throw new Error('Não foi possível obter o vídeo');
      const details = info.videoDetails;
      return {
        id: details.videoId,
        title: details.title,
        author: details.author?.name || '',
        url: chosen.url,
        durationSeconds: Number(details.lengthSeconds || 0),
        thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url || '',
        format: chosen.mimeType || 'video/mp4',
      };
    } catch (error) {
      if (process.env.DEBUG_YT === '1') {
        console.warn('[ytPlayMp4] direct ytdl failed', { query, error });
      }
    }
  }
  const [best] = await ytSearch(query, 1);
  if (!best) throw new Error('Nenhum resultado encontrado');
  const info = await getYtdlInfoWithCookieFallback(best.id);
  const progressive = info.formats
    .filter((f) => f.container === 'mp4' && f.hasAudio && f.hasVideo && !!f.url)
    .sort((a, b) => (b.qualityLabel || '').localeCompare(a.qualityLabel || ''))[0];
  const chosen = progressive || info.formats.find((f) => f.hasAudio && f.hasVideo && !!f.url);
  if (!chosen?.url) throw new Error('Não foi possível obter o vídeo');
  const details = info.videoDetails;
  return {
    id: details.videoId,
    title: details.title,
    author: details.author?.name || '',
    url: chosen.url,
    durationSeconds: Number(details.lengthSeconds || 0),
    thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url || '',
    format: chosen.mimeType || 'video/mp4',
  };
}
