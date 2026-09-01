import { NextRequest, NextResponse } from 'next/server';

import { withUserApiAuth } from 'lib/api-rest-auth';
import { downloadSpotifyTrack } from 'lib/spotify-downloader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get('url') || '').trim();
    if (!url) {
      return NextResponse.json({ status: false, message: 'Informe a URL do Spotify.' }, { status: 400 });
    }

    const track = await downloadSpotifyTrack(url);
    if (!track?.downloadUrl) {
      throw new Error('Não foi possível gerar o link de download do Spotify.');
    }

    const raw = track.raw ?? {};

    const payload = {
      status: true,
      mensagem: 'OK',
      resultado: {
        titulo: track.title,
        artista: track.artist,
        duration: track.duration ?? raw.duration ?? null,
        duration_seconds: track.durationSeconds ?? raw.duration_seconds ?? null,
        capa: track.cover ?? raw.cover ?? raw.img ?? null,
        spotify_url: track.spotifyUrl ?? raw.spotify_url ?? url,
        download_url: track.downloadUrl,
        mimetype: track.mimeType ?? raw.mimetype ?? 'audio/mpeg',
        filesize: track.fileSize ?? raw.filesize ?? null,
        file_id: track.fileId ?? raw.file_id ?? null,
        fonte: raw.source || 'spotify+yt-search',
        bruto: raw,
      },
    };

    return NextResponse.json(payload, {
      headers: { 'cache-control': 'no-store, no-cache, must-revalidate, max-age=0' },
    });
  } catch (err: any) {
    return NextResponse.json(
      { status: false, message: err?.message || 'Erro ao baixar do Spotify.' },
      { status: 500 },
    );
  }
});
