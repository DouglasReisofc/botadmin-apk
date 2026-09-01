import { NextRequest, NextResponse } from 'next/server';

import { enqueueAutoDownJobAndWait } from 'lib/autodown';
import { withUserApiAuth } from 'lib/api-rest-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

const isFreepikHost = (hostname: string): boolean => {
  const lowered = hostname.toLowerCase();
  return lowered === 'freepik.com' || lowered.endsWith('.freepik.com');
};

const deriveFilename = (downloadUrl: string): string => {
  try {
    const url = new URL(downloadUrl);
    const paramFilename = url.searchParams.get('filename');
    if (paramFilename?.trim()) {
      return paramFilename.trim();
    }
    const pathname = url.pathname.split('/').filter(Boolean).pop();
    if (pathname) {
      return decodeURIComponent(pathname);
    }
  } catch {
    /* ignore */
  }
  return 'freepik.zip';
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const urlParam = (searchParams.get('url') || searchParams.get('q') || '').trim();
    if (!urlParam) {
      return NextResponse.json({ status: false, mensagem: 'Informe a URL do Freepik' }, { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(urlParam);
    } catch {
      return NextResponse.json({ status: false, mensagem: 'URL inválida' }, { status: 400 });
    }

    if (!/^https?:$/i.test(targetUrl.protocol)) {
      return NextResponse.json({ status: false, mensagem: 'Apenas URLs HTTP/HTTPS são aceitas' }, { status: 400 });
    }

    if (!isFreepikHost(targetUrl.hostname)) {
      return NextResponse.json({ status: false, mensagem: 'Envie um link válido do Freepik' }, { status: 400 });
    }

    const timeoutMs = Number.parseInt(searchParams.get('timeout_ms') || searchParams.get('timeout') || '180000', 10) || 180000;
    const remoteData = await enqueueAutoDownJobAndWait(
      targetUrl.toString(),
      {
        source: 'api-rest',
        endpoint: 'freepik',
      },
      timeoutMs,
    );

    if (!remoteData.ok) {
      return NextResponse.json(
        {
          status: false,
          mensagem: remoteData.result.message || 'A extensao retornou erro ao processar o Freepik.',
        },
        { status: 502 },
      );
    }

    const downloadUrl = remoteData.result.directLink || remoteData.result.previewUrl;
    if (!downloadUrl) {
      return NextResponse.json({ status: false, mensagem: 'Resposta sem link de download' }, { status: 502 });
    }

    const payload = {
      url: downloadUrl,
      filename:
        typeof remoteData.result.filename === 'string' && remoteData.result.filename.trim()
          ? remoteData.result.filename.trim()
          : deriveFilename(downloadUrl),
      mime:
        typeof remoteData.result.mime === 'string' && remoteData.result.mime.trim().length > 0
          ? remoteData.result.mime.trim()
          : undefined,
      stdout: remoteData.result.status === 'success' ? remoteData.result.message || undefined : undefined,
      stderr: remoteData.result.status === 'error' ? remoteData.result.message || undefined : undefined,
      source: targetUrl.toString(),
      job_id: remoteData.job.id,
      client_id: remoteData.result.clientId,
    };

    return NextResponse.json({ status: true, código: 200, resultado: payload });
  } catch (err: any) {
    const message =
      err?.name === 'AbortError'
        ? 'Tempo esgotado ao consultar o downloader do Freepik.'
        : err?.message || 'Erro ao consultar o Freepik.';
    return NextResponse.json({ status: false, mensagem: message }, { status: 500 });
  }
});
