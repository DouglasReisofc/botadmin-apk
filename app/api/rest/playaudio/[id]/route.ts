import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';

const handler = async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const base = path.join(process.cwd(), 'lib', 'python', 'tmp');
  const candidates = [
    { path: path.join(base, `${id}.mp3`), type: 'audio/mpeg' },
    { path: path.join(base, `${id}.webm`), type: 'audio/webm' },
    { path: path.join(base, `${id}.m4a`), type: 'audio/mp4' },
  ];
  let chosen: { path: string; type: string } | null = null;
  for (const c of candidates) {
    try {
      await fs.promises.access(c.path, fs.constants.R_OK);
      chosen = c; break;
    } catch {}
  }
  if (!chosen) {
    return new Response(JSON.stringify({ status: false, message: 'Áudio não encontrado.' }), { status: 404 });
  }
  const stat = await fs.promises.stat(chosen.path);
  const fileSize = stat.size;
  if (!stat.isFile() || fileSize < 1024) {
    return new Response(JSON.stringify({ status: false, message: 'Áudio incompleto.' }), { status: 502 });
  }

  let metadata: Record<string, unknown> | null = null;
  try {
    const raw = await fs.promises.readFile(path.join(process.cwd(), 'lib', 'python', 'audios.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    metadata = parsed[id] ?? null;
  } catch {
    metadata = null;
  }

  const range = req.headers.get('range');
  const headers = new Headers();
  headers.set('Content-Type', chosen.type);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Length', String(fileSize));
  const duration = Number(metadata?.duration_downloaded ?? metadata?.duration ?? 0);
  if (Number.isFinite(duration) && duration > 0) {
    headers.set('X-Duration-Seconds', String(Math.round(duration)));
  }

  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (!m) {
      headers.set('Content-Range', `bytes */${fileSize}`);
      return new Response(null, { status: 416, headers });
    }
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
      headers.set('Content-Range', `bytes */${fileSize}`);
      return new Response(null, { status: 416, headers });
    }
    const chunkSize = end - start + 1;
    headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    headers.set('Content-Length', String(chunkSize));
    const stream = fs.createReadStream(chosen.path, { start, end });
    const webStream = Readable.toWeb(stream) as any;
    return new Response(webStream, { status: 206, headers });
  }

  headers.set('Content-Length', String(fileSize));
  const stream = fs.createReadStream(chosen.path);
  const webStream = Readable.toWeb(stream) as any;
  return new Response(webStream, { status: 200, headers });
};

export const GET = handler;

export const HEAD = async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const response = await handler(req, ctx);
  return new Response(null, { status: response.status, headers: response.headers });
};
