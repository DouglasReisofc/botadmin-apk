import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { withUserApiAuth } from 'lib/api-rest-auth';
import { resolveVideoWithBrowser } from 'lib/browser-media-resolver';

export const runtime = 'nodejs';
export const maxDuration = 300;

const getBaseUrl = () => {
  if (process.env.APP_URL?.trim()) return process.env.APP_URL.trim().replace(/\/$/, '');
  if (process.env.BASE_SITE_URL?.trim()) return process.env.BASE_SITE_URL.trim().replace(/\/$/, '');
  try {
    const cfg = (eval('require') as NodeRequire)('config/app-settings.js');
    if (cfg?.basesiteUrl) return String(cfg.basesiteUrl).replace(/\/$/, '');
  } catch {}
  return 'http://localhost:4478';
};

const KWAI_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

const decodeHtmlAttribute = (value: string): string =>
  value
    .replace(/\\u002F/gi, '/')
    .replace(/\\u003F/gi, '?')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'");

/**
 * The current Kwai web player exposes the signed MP4 in its server-rendered
 * HTML.  Short links redirect to a canonical /@user/video URL which yt-dlp
 * does not support, so use this lightweight resolver before launching a
 * browser or the Python fallback.
 */
const resolveKwaiPage = async (sourceUrl: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'user-agent': KWAI_USER_AGENT,
      },
    });
    if (!response.ok) return null;
    const html = await response.text();
    if (!html) return null;

    const mediaMatches = Array.from(
      html.matchAll(/(?:src|contentUrl)=["'](https?:[^"']+?\.mp4[^"']*)["']/gi),
    );
    const mediaUrl = mediaMatches
      .map((match) => decodeHtmlAttribute(match[1]))
      .find((url) => /^https?:\/\//i.test(url));
    if (!mediaUrl) return null;

    const meta = (property: string): string => {
      const match = html.match(
        new RegExp(
          `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
          'i',
        ),
      );
      return match ? decodeHtmlAttribute(match[1]).trim() : '';
    };
    const title = meta('og:title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '';
    const description = meta('og:description') || meta('description');
    const thumbnail = meta('og:image') || meta('twitter:image');
    const id = sourceUrl.match(/\/video\/(\d{8,})/i)?.[1] ??
      mediaUrl.match(/photo[_-]?id[=/](\d{8,})/i)?.[1] ?? null;

    return {
      provider: 'kwai' as const,
      id,
      title,
      author: '',
      url: mediaUrl,
      durationSeconds: 0,
      thumbnail,
      source: sourceUrl,
      pageUrl: response.url,
      format: 'video/mp4' as const,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get('url') || searchParams.get('q') || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ status: false, mensagem: 'Forneça url válida' }, { status: 400 });
    }
    if (!/kwai|kuaishou/i.test(url)) {
      return NextResponse.json({ status: false, mensagem: 'Este endpoint é apenas para links do Kwai.' }, { status: 400 });
    }

    const baseUrl = getBaseUrl();

    // Resolve Kwai's signed CDN URL directly from the SSR page. This avoids
    // the unsupported canonical URL error returned by yt-dlp for /@user/video
    // links and is substantially faster for the group auto-downloader.
    const pageResult = await resolveKwaiPage(url);
    if (pageResult) {
      return NextResponse.json({ status: true, código: 200, resultado: pageResult });
    }

    try {
      const browserResult = await resolveVideoWithBrowser(url);
      return NextResponse.json({ status: true, código: 200, resultado: browserResult });
    } catch (browserError: any) {
      console.warn('[api/rest/kwai] resolvedor por navegador falhou; tentando yt-dlp local', {
        url,
        error: browserError?.message,
      });
    }

    const baseDir = path.join(process.cwd(), 'lib', 'python');
    const pyScript = path.join(baseDir, 'video_downloader.py');
    const infoScript = path.join(baseDir, 'video_info.py');

    const id: string = await new Promise((resolve, reject) => {
      const child = spawn('python3', [pyScript, url, baseUrl], { cwd: baseDir });
      let out = ''; let err = '';
      child.stdout.on('data', d => (out += String(d)));
      child.stderr.on('data', d => (err += String(d)));
      child.on('close', code => {
        if (code !== 0) return reject(new Error(err.trim() || `python exited ${code}`));
        const val = out.trim();
        if (!val) return reject(new Error('python did not return id'));
        resolve(val);
      });
    });

    const info: any = await new Promise((resolve, reject) => {
      const child = spawn('python3', [infoScript, id], { cwd: baseDir });
      let out = ''; let err = '';
      child.stdout.on('data', d => (out += String(d)));
      child.stderr.on('data', d => (err += String(d)));
      child.on('close', code => {
        if (code !== 0) return reject(new Error(err.trim() || `python info exited ${code}`));
        try { resolve(JSON.parse(out)); } catch { reject(new Error('invalid info json')); }
      });
    });

    const bundle = info?.video_info || {};
    const payload = {
      id,
      title: bundle.titulo || bundle.title || '',
      author: bundle.uploader || '',
      url: bundle.video_url || `${baseUrl}/api/play/${id}`,
      durationSeconds: Number(bundle.duration || 0),
      thumbnail: bundle.thumbnail || '',
      format: 'video/mp4',
      source: bundle.url || url,
    };
    return NextResponse.json({ status: true, código: 200, resultado: payload });
  } catch (err: any) {
    return NextResponse.json({ status: false, mensagem: err?.message || 'Erro' }, { status: 500 });
  }
});
