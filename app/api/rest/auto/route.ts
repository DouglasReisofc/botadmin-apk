import { NextRequest, NextResponse } from 'next/server';

import { withUserApiAuth } from 'lib/api-rest-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

const getInternalBaseUrl = () => {
  const explicit = process.env.REST_INTERNAL_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  const port = process.env.PORT?.trim() || '4478';
  return `http://127.0.0.1:${port}`;
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get('url') || searchParams.get('q') || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ status: false, mensagem: 'Forneça url válida' }, { status: 400 });
    }
    const goto = (path: string) => new URL(path, `${getInternalBaseUrl()}/`).toString();
    const headers = { accept: 'application/json' } as Record<string, string>;
    const apiKey =
      req.headers.get('x-api-key') ||
      req.headers.get('apikey') ||
      req.nextUrl.searchParams.get('apikey') ||
      req.nextUrl.searchParams.get('apiKey') ||
      '';
    if (apiKey.trim()) {
      headers['x-api-key'] = apiKey.trim();
    }

    const lower = url.toLowerCase();
    const hostname = (() => {
      try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    const matchesHost = (...domains: string[]) =>
      domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));

    const choose = async () => {
      if (matchesHost('tiktok.com') || lower.includes('tiktok.com')) return goto(`/api/rest/tiktok?url=${encodeURIComponent(url)}`);
      if (matchesHost('douyin.com', 'iesdouyin.com', 'ixigua.com') || lower.includes('douyin.com') || lower.includes('iesdouyin.com') || lower.includes('ixigua.com')) return goto(`/api/rest/douyin?url=${encodeURIComponent(url)}`);
      if (matchesHost('kwai.com', 'kuaishou.com') || lower.includes('kwai') || lower.includes('kuaishou')) return goto(`/api/rest/kwai?url=${encodeURIComponent(url)}`);
      if (matchesHost('instagram.com', 'instagr.am') || lower.includes('instagram.com')) return goto(`/api/rest/instagram?url=${encodeURIComponent(url)}`);
      if (matchesHost('facebook.com', 'fb.watch', 'fb.com') || lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return goto(`/api/rest/facebook?url=${encodeURIComponent(url)}`);
      if (matchesHost('pinterest.com', 'pin.it', 'pinimg.com') || lower.includes('pinterest')) return goto(`/api/rest/pinterest?url=${encodeURIComponent(url)}`);
      if (matchesHost('mediafire.com') || lower.includes('mediafire.com')) return goto(`/api/rest/mediafire?url=${encodeURIComponent(url)}`);
      return goto(`/api/rest/globalvideo?url=${encodeURIComponent(url)}`);
    };

    const endpoint = await choose();
    const resp = await fetch(endpoint, { headers });
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch (err: any) {
    return NextResponse.json({ status: false, mensagem: err?.message || 'Erro' }, { status: 500 });
  }
});
