import { NextRequest, NextResponse } from 'next/server';

import { withUserApiAuth } from 'lib/api-rest-auth';

const integrationApi = (() => {
  try { return (eval('require') as NodeRequire)('lib/integrations/apis/funcoes/api.js'); } catch { return null as any; }
})();

export const GET = withUserApiAuth(async (req: NextRequest, { params }: { params: { name: string } }) => {
  try {
    const fnName = (params.name || '').trim();
    if (!fnName) return NextResponse.json({ message: 'Informe o nome da função.' }, { status: 400 });
    const fn = integrationApi?.[fnName];
    if (typeof fn !== 'function') return NextResponse.json({ message: 'Função não encontrada.' }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || searchParams.get('query') || searchParams.get('text') || '').trim();
    const url = (searchParams.get('url') || '').trim();
    const arg = url || q || undefined;
    const result = await fn(arg);
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json({ message: err?.message || 'Erro' }, { status: 500 });
  }
});
