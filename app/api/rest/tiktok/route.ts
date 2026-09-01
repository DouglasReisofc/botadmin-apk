import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { withUserApiAuth } from 'lib/api-rest-auth';
import { resolveTikTok } from 'lib/tiktok-resolver';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const SHOULD_LOG = String(process.env.TIKTOK_LOG ?? '1') !== '0';
const VERBOSE_LOG = String(process.env.TIKTOK_LOG_VERBOSE ?? '0') === '1';
const log = (...args: any[]) => {
  if (!SHOULD_LOG) return;
  try {
    console.log('[rest/tiktok]', ...args);
  } catch {}
};

const getBaseUrl = () => {
  if (process.env.APP_URL?.trim()) return process.env.APP_URL.trim().replace(/\/$/, '');
  if (process.env.BASE_SITE_URL?.trim()) return process.env.BASE_SITE_URL.trim().replace(/\/$/, '');
  try {
    const cfg = (eval('require') as NodeRequire)('config/app-settings.js');
    if (cfg?.basesiteUrl) return String(cfg.basesiteUrl).replace(/\/$/, '');
  } catch {}
  return 'http://localhost:4478';
};

const compactErrorMessage = (value: unknown): string => {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  return raw.replace(/\s+/g, ' ').trim().slice(0, 600);
};

const decodeBasicHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const stripHtml = (value: string): string =>
  decodeBasicHtmlEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const extractHtmlAttributes = (html: string, attributeName: string): string[] => {
  const values: string[] = [];
  const pattern = new RegExp(`${attributeName}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const value = decodeBasicHtmlEntities(match[2] || match[3] || '').trim();
    if (value) values.push(value);
  }
  return values;
};

const selectSnapTikVideoUrl = (html: string): string | null => {
  const hrefs = extractHtmlAttributes(html, 'href');
  const absolute = hrefs
    .map((href) => {
      try {
        return new URL(href, 'https://snaptik.me').toString();
      } catch {
        return null;
      }
    })
    .filter((href): href is string => Boolean(href));

  return (
    absolute.find((href) => /pro\.snapcdn\.app\/dl\?/i.test(href)) ||
    absolute.find((href) => /tikcdn\.io\/ssstik\/\d+/i.test(href) && !/\/ssstik\/m\//i.test(href)) ||
    absolute.find((href) => /\.(?:mp4)(?:\?|$)/i.test(href) && !/audio|music|mp3/i.test(href)) ||
    null
  );
};

const runSnapTikFallback = async (url: string) => {
  const body = new URLSearchParams({
    q: url,
    cursor: '0',
    page: '0',
    lang: 'en',
  });
  const response = await fetch('https://snaptik.me/api/ajaxSearch', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      origin: 'https://snaptik.me',
      referer: 'https://snaptik.me/en',
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    },
    body,
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`SnapTik HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => null);
  if (!payload || payload.status !== 'ok' || payload.statusCode === 404) {
    throw new Error(payload?.msg || 'SnapTik não retornou mídia.');
  }

  const html = typeof payload.data === 'string' ? payload.data : '';
  const mediaUrl = selectSnapTikVideoUrl(html);
  if (!mediaUrl) {
    throw new Error('SnapTik não retornou link de vídeo.');
  }

  const titleMatch = html.match(/<h3[^>]*>(.*?)<\/h3>/is);
  const title = titleMatch ? stripHtml(titleMatch[1]) : '';
  const imageUrl =
    extractHtmlAttributes(html, 'src').find((src) => /^https?:\/\//i.test(src) && /tiktok|tikcdn|snapcdn/i.test(src)) ||
    '';

  const data = {
    title,
    author: '',
    play: mediaUrl,
    hdplay: mediaUrl,
    download: mediaUrl,
    cover: imageUrl,
    duration: 0,
    source: url,
  };

  return {
    normalized: {
      type: 'video' as const,
      title: data.title,
      author: data.author,
      duration: data.duration,
      url: data.download,
      thumbnail: data.cover,
      music: null,
    },
    apiPayload: {
      code: 0,
      msg: 'success',
      data,
    },
  };
};

const runPythonVideoFallback = async (url: string) => {
  const baseDir = path.join(process.cwd(), 'lib', 'python');
  const pyScript = path.join(baseDir, 'video_downloader.py');
  const infoScript = path.join(baseDir, 'video_info.py');
  const baseUrl = getBaseUrl();

  const id: string = await new Promise((resolve, reject) => {
    const child = spawn('python3', [pyScript, url, baseUrl], { cwd: baseDir });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (err += String(chunk)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `python exited ${code}`));
      const value = out.trim();
      if (!value) return reject(new Error('python did not return id'));
      resolve(value);
    });
  });

  const info: any = await new Promise((resolve, reject) => {
    const child = spawn('python3', [infoScript, id], { cwd: baseDir });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (err += String(chunk)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `python info exited ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error('invalid info json'));
      }
    });
  });

  const bundle = info?.video_info || {};
  const data = {
    id,
    title: bundle.titulo || bundle.title || '',
    author: bundle.uploader || '',
    play: bundle.video_url || `${baseUrl}/api/play/${id}`,
    hdplay: bundle.video_url || `${baseUrl}/api/play/${id}`,
    download: bundle.video_url || `${baseUrl}/api/play/${id}`,
    cover: bundle.thumbnail || '',
    duration: Number(bundle.duration || 0),
    source: bundle.url || url,
  };

  return {
    normalized: {
      type: 'video' as const,
      title: data.title,
      author: data.author,
      duration: data.duration,
      url: data.download,
      thumbnail: data.cover,
      music: null,
    },
    apiPayload: {
      code: 0,
      msg: 'success',
      data,
    },
    id,
  };
};

const respond = (payload: any, status = 200) => {
  log('response', { status, payload });
  const headers = new Headers({
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    pragma: 'no-cache',
    expires: '0',
  });
  return NextResponse.json(payload, { status, headers });
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get('url') || searchParams.get('q') || '').trim();
    if (!raw) return NextResponse.json({ status: false, mensagem: 'Informe url' }, { status: 400 });

    const debugFlag = /^(1|true|yes)$/i.test(String(searchParams.get('debug') || ''));
    const resolved = await resolveTikTok(raw);
    log('request', { raw, debug: resolved.debug });
    if (resolved.success) {
      const { normalized, apiPayload, raw: rawResponse } = resolved.result;
      if (VERBOSE_LOG) {
        log('tikwm:ok:full', { resolved: resolved.result.resolvedVariant, data: rawResponse });
      } else {
        log('tikwm:ok', {
          resolved: resolved.result.resolvedVariant,
          hasData: Boolean(rawResponse?.data),
          code: rawResponse?.code,
          msg: rawResponse?.msg,
        });
      }
      return respond({
        status: true,
        código: 200,
        resultado: normalized,
        raw: rawResponse,
        code: apiPayload.code,
        msg: apiPayload.msg,
        data: apiPayload.data,
        ...(debugFlag ? { debug: resolved.debug } : {}),
      });
    }

    try {
      const fallback = await runSnapTikFallback(raw);
      log('snaptik:fallback:ok', { raw });
      return respond({
        status: true,
        código: 200,
        resultado: fallback.normalized,
        raw: fallback.apiPayload,
        code: fallback.apiPayload.code,
        msg: fallback.apiPayload.msg,
        data: fallback.apiPayload.data,
        source: 'snaptik',
        ...(debugFlag ? { debug: resolved.debug } : {}),
      });
    } catch (snapTikError: any) {
      log('snaptik:fallback:error', {
        raw,
        tikwmError: resolved.error,
        fallbackError: compactErrorMessage(snapTikError),
      });
      try {
        const fallback = await runPythonVideoFallback(raw);
        log('yt-dlp:fallback:ok', { raw, id: fallback.id });
        return respond({
          status: true,
          código: 200,
          resultado: fallback.normalized,
          raw: fallback.apiPayload,
          code: fallback.apiPayload.code,
          msg: fallback.apiPayload.msg,
          data: fallback.apiPayload.data,
          source: 'yt-dlp',
          ...(debugFlag ? { debug: resolved.debug } : {}),
        });
      } catch (fallbackError: any) {
        log('yt-dlp:fallback:error', {
          raw,
          tikwmError: resolved.error,
          snapTikError: compactErrorMessage(snapTikError),
          fallbackError: compactErrorMessage(fallbackError),
        });
        return respond(
          {
            status: false,
            mensagem: resolved.error,
            fallback: compactErrorMessage(fallbackError),
            snapTikFallback: compactErrorMessage(snapTikError),
            ...(debugFlag ? { debug: resolved.debug } : {}),
          },
          400,
        );
      }
    }
  } catch (err: any) {
    log('error', { message: err?.message, stack: err?.stack });
    return NextResponse.json({ status: false, mensagem: err?.message || 'Erro' }, { status: 500 });
  }
});
