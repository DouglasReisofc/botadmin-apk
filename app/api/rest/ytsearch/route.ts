import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { ytSearch as modernYtSearch, type YtSearchItem } from 'lib/apis/yt';
import { withUserApiAuth } from 'lib/api-rest-auth';
const evalRequire = (id: string) => (eval('require') as NodeRequire)(id);

type AdapterAuthor = {
  name?: string;
  url?: string;
  avatar?: string;
  verified?: boolean;
};

type AdapterVideo = {
  type: string;
  videoId: string;
  url: string;
  title: string;
  description: string;
  image: string;
  thumbnail: string;
  seconds?: number;
  timestamp?: string;
  duration?: string | number | { timestamp?: string; seconds?: number };
  ago?: string;
  views?: number | string;
  author?: AdapterAuthor | string;
};

type CompatItem = {
  id: string;
  title: string;
  url: string;
  duration: string;
  author: string;
  views: number;
  thumbnail: string;
  published?: string;
};

type AdapterModule = {
  ytSearch?: (query: string) => Promise<unknown>;
};

type YtSearchModule = {
  default?: (query: string) => Promise<YtSearchResponse>;
  (query: string): Promise<YtSearchResponse>;
};

type YtSearchResponse = {
  videos?: unknown;
  all?: unknown;
};

const MAX_LIMIT = 50;

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

const installYtSearchConsoleFilter = (): (() => void) => {
  if (process.env.YT_SEARCH_DEBUG === '1') {
    return () => {};
  }

  if (mutedYtSearchConsoleDepth === 0) {
    originalConsoleLog = console.log.bind(console);
    originalConsoleDebug = console.debug.bind(console);

    console.log = ((...args: unknown[]) => {
      if (!isYtSearchNoiseLog(args)) {
        originalConsoleLog?.(...args);
      }
    }) as typeof console.log;

    console.debug = ((...args: unknown[]) => {
      if (!isYtSearchNoiseLog(args)) {
        originalConsoleDebug?.(...args);
      }
    }) as typeof console.debug;
  }

  mutedYtSearchConsoleDepth += 1;

  return () => {
    mutedYtSearchConsoleDepth = Math.max(0, mutedYtSearchConsoleDepth - 1);
    if (mutedYtSearchConsoleDepth === 0) {
      if (originalConsoleLog) console.log = originalConsoleLog as typeof console.log;
      if (originalConsoleDebug) console.debug = originalConsoleDebug as typeof console.debug;
      originalConsoleLog = null;
      originalConsoleDebug = null;
    }
  };
};

const withMutedYtSearchConsole = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const restore = installYtSearchConsoleFilter();
  try {
    return await fn();
  } finally {
    restore();
  }
};

const withMutedYtSearchDebugEnv = async <T,>(fn: () => Promise<T>): Promise<T> => {
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

const isAdapterAuthor = (value: unknown): value is AdapterAuthor => {
  if (!isObject(value)) return false;
  return (
    (value.name === undefined || typeof value.name === 'string') &&
    (value.url === undefined || typeof value.url === 'string') &&
    (value.avatar === undefined || typeof value.avatar === 'string') &&
    (value.verified === undefined || typeof value.verified === 'boolean')
  );
};

const extractVideoId = (source: Record<string, unknown>): string | null => {
  const candidates = ['videoId', 'video_id', 'videoid'];
  for (const key of candidates) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
};

const toAdapterVideo = (value: unknown): AdapterVideo | null => {
  if (!isObject(value)) return null;
  const videoId = extractVideoId(value);
  if (!videoId) return null;

  const title = typeof value.title === 'string' ? value.title : '';
  const url = typeof value.url === 'string' ? value.url : `https://www.youtube.com/watch?v=${videoId}`;
  const thumbnail = typeof value.thumbnail === 'string' ? value.thumbnail : typeof value.image === 'string' ? value.image : '';
  const description = typeof value.description === 'string' ? value.description : '';
  const seconds = typeof value.seconds === 'number' && Number.isFinite(value.seconds) ? value.seconds : undefined;
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : undefined;
  const duration = value.duration;
  const ago = typeof value.ago === 'string' ? value.ago : undefined;
  const views = typeof value.views === 'number' || typeof value.views === 'string' ? value.views : undefined;
  const author =
    typeof value.author === 'string' || isAdapterAuthor(value.author) ? (value.author as AdapterAuthor | string) : undefined;

  return {
    type: typeof value.type === 'string' ? value.type : 'video',
    videoId,
    url,
    title,
    description,
    image: thumbnail,
    thumbnail,
    seconds,
    timestamp,
    duration,
    ago,
    views,
    author,
  };
};

const sanitizeAdapterVideos = (list: unknown, limit: number): AdapterVideo[] | null => {
  if (!Array.isArray(list)) return null;
  const results: AdapterVideo[] = [];
  for (const entry of list) {
    const video = toAdapterVideo(entry);
    if (video) {
      results.push(video);
      if (results.length >= limit) break;
    }
  }
  return results.length > 0 ? results : null;
};

const extractAdapterVideos = (value: unknown, limit: number): AdapterVideo[] | null => {
  if (Array.isArray(value)) return sanitizeAdapterVideos(value, limit);
  if (isObject(value)) {
    if (Array.isArray(value.videos)) return sanitizeAdapterVideos(value.videos, limit);
    if (Array.isArray(value.resultados)) return sanitizeAdapterVideos(value.resultados, limit);
  }
  return null;
};

const parseDurationText = (input: AdapterVideo): string => {
  if (typeof input.duration === 'string') return input.duration;
  if (typeof input.timestamp === 'string') return input.timestamp;
  if (typeof input.duration === 'number' && Number.isFinite(input.duration)) {
    const total = Math.max(0, Math.trunc(input.duration));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
  }
  if (isObject(input.duration)) {
    const durationObj = input.duration as Record<string, unknown>;
    if (typeof durationObj.timestamp === 'string') return durationObj.timestamp;
  }
  return '';
};

const durationToSeconds = (duration: string): number => {
  const parts = duration.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some((value) => Number.isNaN(value))) return 0;
  return parts.reverse().reduce((total, value, index) => total + value * 60 ** index, 0);
};

const parseViews = (views: number | string | undefined): number => {
  if (typeof views === 'number') return Number.isFinite(views) ? views : 0;
  if (typeof views === 'string') {
    const cleaned = views.replace(/[^0-9]/g, '');
    return cleaned.length ? Number.parseInt(cleaned, 10) : 0;
  }
  return 0;
};

const extractAuthorName = (author: AdapterAuthor | string | undefined): string => {
  if (!author) return '';
  if (typeof author === 'string') return author;
  return author.name ?? '';
};

const toCompatItem = (video: AdapterVideo): CompatItem => ({
  id: video.videoId,
  title: video.title,
  url: video.url,
  duration: parseDurationText(video),
  author: extractAuthorName(video.author),
  views: parseViews(video.views),
  thumbnail: video.thumbnail,
  published: video.ago,
});

const fromModernItem = (item: YtSearchItem): AdapterVideo => {
  const duration = item.duration || '';
  const seconds = durationToSeconds(duration);
  return {
    type: 'video',
    videoId: item.id,
    url: item.url,
    title: item.title,
    description: '',
    image: item.thumbnail,
    thumbnail: item.thumbnail,
    seconds: seconds || undefined,
    timestamp: duration,
    duration: duration ? { timestamp: duration, seconds: seconds || undefined } : undefined,
    ago: item.published,
    views: item.views,
    author: item.author ? { name: item.author } : undefined,
  };
};

const tryAdapterModule = async (query: string, limit: number): Promise<AdapterVideo[] | null> => {
  try {
    const integrationApi = evalRequire(process.cwd() + '/lib/integrations/apis/funcoes/api.js') as AdapterModule;
    if (typeof integrationApi?.ytSearch === 'function') {
      const response = await integrationApi.ytSearch(query);
      const videos = extractAdapterVideos(response, limit);
      if (videos) return videos;
    }
  } catch (error) {
    console.error('[rest-ytsearch] integration module failed', error);
  }
  return null;
};

const tryYtSearchPackage = async (query: string, limit: number): Promise<AdapterVideo[] | null> => {
  // First, try plain Node require to avoid bundling issues with cheerio
  try {
    const cjs: any = await withMutedYtSearchDebugEnv(async () => evalRequire('yt-search'));
    const search = (typeof cjs === 'function' ? cjs : cjs?.default || cjs?.search) as
      | ((q: string) => Promise<YtSearchResponse>)
      | undefined;
    if (search) {
      const result = await withMutedYtSearchConsole(() => search(query));
      const videos = extractAdapterVideos((result as any)?.videos ?? (result as any)?.all, limit);
      if (videos) return videos;
    }
  } catch (error) {
    console.error('[rest-ytsearch] yt-search package failed (require)', error);
  }

  // Fallback: ESM dynamic import
  try {
    const mod = (await withMutedYtSearchDebugEnv(() => import('yt-search'))) as YtSearchModule;
    const search = (typeof mod === 'function' ? mod : mod.default) as ((q: string) => Promise<YtSearchResponse>) | undefined;
    if (search) {
      const result = await withMutedYtSearchConsole(() => search(query));
      const videos = extractAdapterVideos(result?.videos ?? result?.all, limit);
      if (videos) return videos;
    }
  } catch (error) {
    console.error('[rest-ytsearch] yt-search package failed (esm)', error);
  }
  return null;
};

const tryModernSearch = async (query: string, limit: number): Promise<AdapterVideo[] | null> => {
  try {
    const modern = await modernYtSearch(query, limit);
    if (!Array.isArray(modern) || modern.length === 0) return null;
    const adapterLike = modern.map(fromModernItem).filter((item) => item.videoId);
    return adapterLike.length ? adapterLike.slice(0, limit) : null;
  } catch (error) {
    console.error('[rest-ytsearch] modern search failed', error);
  }
  return null;
};

const buildErrorResponse = (source: string, errors: string[], debug: boolean) => {
  const payload: Record<string, unknown> = {
    ok: false,
    status: false,
    source,
    codigo: 404,
    criador: 'botadm',
    resultados: [],
    items: [],
  };
  payload['código'] = 404;
  payload['mensagem'] = 'Nenhum vídeo encontrado para a consulta informada.';
  if (debug) payload.errors = errors;
  return payload;
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = (
      searchParams.get('q') ||
      searchParams.get('query') ||
      searchParams.get('nome') ||
      searchParams.get('text') ||
      ''
    ).trim();
    const limitParam = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : 10;
    const engine = (searchParams.get('engine') || '').trim().toLowerCase();
    const debug = searchParams.get('debug') === '1';

    if (!q) {
      return NextResponse.json({ message: 'Informe o parâmetro q (consulta).' }, { status: 400 });
    }

    const errors: string[] = [];
    let source = 'unknown';
    let adapterVideos: AdapterVideo[] | null = null;

    const trySearch = async (label: string, fn: () => Promise<AdapterVideo[] | null>) => {
      if (adapterVideos) return;
      const result = await fn();
      if (result && result.length) {
        adapterVideos = result;
        source = label;
      } else {
        errors.push(`${label}:fail`);
      }
    };

    if (engine === 'internal') {
      await trySearch('internal', () => tryAdapterModule(q, limit));
    } else if (engine === 'yts') {
      await trySearch('yt-search', () => tryYtSearchPackage(q, limit));
    } else if (engine === 'modern') {
      await trySearch('modern', () => tryModernSearch(q, limit));
    }

    // Prefer yt-search first (simples e rápido), depois modern, e por fim o mecanismo interno (dependências mais pesadas)
    if (!adapterVideos) await trySearch('yt-search', () => tryYtSearchPackage(q, limit));
    if (!adapterVideos) await trySearch('modern', () => tryModernSearch(q, limit));
    if (!adapterVideos) await trySearch('internal', () => tryAdapterModule(q, limit));

    if (!adapterVideos || adapterVideos.length === 0) {
      const response = buildErrorResponse(source, errors, debug);
      return NextResponse.json(response);
    }

    const compatItems = adapterVideos.map(toCompatItem);
    const response: Record<string, unknown> = {
      ok: true,
      source,
      items: compatItems,
      status: true,
      codigo: 200,
      criador: 'botadm',
      resultados: adapterVideos,
    };
    response['código'] = 200;
    if (debug) response.errors = errors;
    return NextResponse.json(response);
  } catch (error) {
    console.error('ytsearch failed:', error);
    return NextResponse.json({ message: 'Falha ao pesquisar no YouTube.' }, { status: 500 });
  }
});
