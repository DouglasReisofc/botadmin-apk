import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';

const handler = async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const filePath = path.join(process.cwd(), 'lib', 'python', 'tmp', `${id}.mp4`);
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    return new Response(JSON.stringify({ status: false, message: 'Vídeo não encontrado.' }), { status: 404 });
  }
  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;

  const range = req.headers.get('range');
  const headers = new Headers();
  headers.set('Content-Type', 'video/mp4');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'no-store');

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
    const stream = fs.createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(stream) as any;
    return new Response(webStream, { status: 206, headers });
  }

  headers.set('Content-Length', String(fileSize));
  const stream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as any;
  return new Response(webStream, { status: 200, headers });
};

export const GET = handler;
