import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { withUserApiAuth } from 'lib/api-rest-auth';

export const runtime = 'nodejs';
export const maxDuration = 300; // segundos

const getBaseUrl = () => {
  if (process.env.APP_URL?.trim()) return process.env.APP_URL.trim().replace(/\/$/, '');
  if (process.env.BASE_SITE_URL?.trim()) return process.env.BASE_SITE_URL.trim().replace(/\/$/, '');
  try {
    const cfg = (eval('require') as NodeRequire)('config/app-settings.js');
    if (cfg?.basesiteUrl) return String(cfg.basesiteUrl).replace(/\/$/, '');
  } catch {}
  return 'http://localhost:4478';
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get('url') || searchParams.get('q') || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ status: false, mensagem: 'Forneça url válida' }, { status: 400 });
    }

    const baseDir = path.join(process.cwd(), 'lib', 'python');
    const pyScript = path.join(baseDir, 'audio_downloader.py');
    const infoScript = path.join(baseDir, 'audio_info.py');
    const baseUrl = getBaseUrl();

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

    const bundle = info?.audio_info || {};
    const payload = {
      id,
      title: bundle.titulo || bundle.title || '',
      author: bundle.uploader || '',
      url: bundle.audio_url || `${baseUrl}/api/playaudio/${id}`,
      durationSeconds: Number(bundle.duration || 0),
      thumbnail: bundle.thumbnail || '',
      format: 'audio/mpeg',
      source: bundle.url || url,
    };
    return NextResponse.json({ status: true, código: 200, resultado: payload });
  } catch (err: any) {
    return NextResponse.json({ status: false, mensagem: err?.message || 'Erro' }, { status: 500 });
  }
});
