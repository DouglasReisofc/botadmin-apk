import { NextRequest, NextResponse } from 'next/server';
import { ytSearch as modernYtSearch, ytPlayMp4 } from 'lib/apis/yt';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { withUserApiAuth } from 'lib/api-rest-auth';

export const runtime = 'nodejs';
export const maxDuration = 300; // segundos

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

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || searchParams.get('query') || searchParams.get('url') || '').trim();
    if (!q) return NextResponse.json({ status: false, message: 'Informe q/url' }, { status: 400 });

    // 1) Canonicaliza a URL/termo
    const toCanonicalUrl = async (input: string): Promise<string> => {
      try {
        const [best] = await modernYtSearch(input, 1);
        if (best?.url) return best.url;
    } catch {}
    try {
      const yts = await withMutedYtSearchDebugEnv(async () => {
        const evalRequire: NodeRequire = (eval('require') as NodeRequire);
        return evalRequire('yt-search');
      });
        const res = await yts(input);
        const videos = Array.isArray(res?.videos) ? res.videos : Array.isArray(res?.all) ? res.all.filter((x: any) => x?.type === 'video') : [];
        const id = videos?.[0]?.videoId || videos?.[0]?.video_id || videos?.[0]?.videoid;
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      } catch {}
      return input;
    };
    const canonical = await toCanonicalUrl(q);
    if (!/https?:\/\/(?:www\.)?(youtube\.com|youtu\.be)\//i.test(canonical)) {
      return NextResponse.json({ status: false, mensagem: 'Forneça um link/termo do YouTube' }, { status: 400 });
    }

    if (process.env.YTMP4_USE_DIRECT_WRAPPER === '1') {
      try {
        const direct = await ytPlayMp4(canonical, { skipInternalEndpoint: true });
        const payload = {
          id: direct.id,
          title: direct.title,
          author: direct.author,
          url: direct.url,
          durationSeconds: Number(direct.durationSeconds || 0),
          thumbnail: direct.thumbnail || '',
          format: direct.format || 'video/mp4',
        };
        return NextResponse.json({ status: true, código: 200, resultado: payload });
      } catch (_error) {
        // Prossegue para o fluxo Python + yt-dlp configurado abaixo.
      }
    }

    // 2) Atualiza cookies do YouTube se necessário antes de chamar Python
    const baseDir = path.join(process.cwd(), 'lib', 'python');
    const pyScript = path.join(baseDir, 'video_downloader.py');
    const infoScript = path.join(baseDir, 'video_info.py');
    const ytCookiesPath = path.join(baseDir, 'ytcookies.txt');
    const COOKIES_URL = 'https://cookies.botadmin.shop/cookies/youtube?format=txt';

    const refreshCookiesIfStale = async () => {
      try {
        const stat = await fs.stat(ytCookiesPath).catch(() => null as any);
        const now = Date.now();
        const isStale = !stat || now - stat.mtimeMs > 30 * 60 * 1000; // 30min
        if (!isStale) return;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const resp = await fetch(COOKIES_URL, { signal: ctrl.signal, headers: { accept: 'text/plain' } }).catch(() => null);
        clearTimeout(t);
        const text = resp && resp.ok ? await resp.text() : '';
        if (text && text.trim().length > 0) {
          await fs.writeFile(ytCookiesPath, text, 'utf8');
        }
      } catch {}
    };

    await refreshCookiesIfStale();
    const baseUrl = (() => {
      if (process.env.APP_URL?.trim()) return process.env.APP_URL.trim().replace(/\/$/, '');
      if (process.env.NEXT_PUBLIC_APP_URL?.trim()) return process.env.NEXT_PUBLIC_APP_URL.trim().replace(/\/$/, '');
      if (process.env.BASE_SITE_URL?.trim()) return process.env.BASE_SITE_URL.trim().replace(/\/$/, '');
      if (process.env.INTERNAL_APP_URL?.trim()) return process.env.INTERNAL_APP_URL.trim().replace(/\/$/, '');
      try { const cfg = (eval('require') as NodeRequire)('config/app-settings.js'); if (cfg?.basesiteUrl) return String(cfg.basesiteUrl).replace(/\/$/, ''); } catch {}
      return 'http://localhost:4478';
    })();

    const id: string = await new Promise((resolve, reject) => {
      const child = spawn('python3', [pyScript, canonical, baseUrl], { cwd: baseDir });
      let out = ''; let err = '';
      child.stdout.on('data', (d) => (out += String(d)));
      child.stderr.on('data', (d) => (err += String(d)));
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `python exited ${code}`));
        const val = out.trim(); if (!val) return reject(new Error('python did not return id'));
        resolve(val);
      });
    });

    const infoJson: any = await new Promise((resolve, reject) => {
      const child = spawn('python3', [infoScript, id], { cwd: baseDir });
      let out = ''; let err = '';
      child.stdout.on('data', (d) => (out += String(d)));
      child.stderr.on('data', (d) => (err += String(d)));
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `python info exited ${code}`));
        try { resolve(JSON.parse(out)); } catch { reject(new Error('invalid info json')); }
      });
    });

    const bundle = infoJson?.video_info || {};
    const payload = {
      id,
      title: bundle.titulo || bundle.title || '',
      author: bundle.uploader || '',
      url: bundle.video_url || `${baseUrl}/api/play/${id}`,
      durationSeconds: Number(bundle.duration || 0),
      thumbnail: bundle.thumbnail || '',
      format: 'video/mp4',
    };
    return NextResponse.json({ status: true, código: 200, resultado: payload });
  } catch (err: any) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch('https://cookies.botadmin.shop/cookies/youtube?format=txt', { signal: ctrl.signal, headers: { accept: 'text/plain' } }).catch(() => null);
      clearTimeout(t);
      const text = r && r.ok ? await r.text() : '';
      if (text && text.trim().length > 0) {
        await fs.writeFile(path.join(process.cwd(), 'lib', 'python', 'ytcookies.txt'), text, 'utf8');
      }
    } catch {}
    return NextResponse.json({ status: false, mensagem: err?.message || 'Erro' }, { status: 500 });
  }
});
