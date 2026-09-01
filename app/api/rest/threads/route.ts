import { NextRequest, NextResponse } from 'next/server';

import { withUserApiAuth } from 'lib/api-rest-auth';

const integrationApi = (() => {
  try { return (eval('require') as NodeRequire)('lib/integrations/apis/funcoes/api.js'); } catch { return null as any; }
})();

export const runtime = 'nodejs';

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get('url') || searchParams.get('q') || '').trim();
    if (!url) return NextResponse.json({ status: false, mensagem: 'Informe url' }, { status: 400 });
    const data = await integrationApi?.threadsDownloader?.(url);
    return NextResponse.json({ status: true, código: 200, resultado: data });
  } catch (err: any) {
    return NextResponse.json({ status: false, mensagem: err?.message || 'Erro' }, { status: 500 });
  }
});
