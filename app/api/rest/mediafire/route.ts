import { NextRequest, NextResponse } from 'next/server';

import { withUserApiAuth } from 'lib/api-rest-auth';

// Carrega o módulo CJS diretamente (evita index.ts)
const integrationApi = (() => {
  try { return (eval('require') as NodeRequire)('lib/integrations/apis/funcoes/api.js'); } catch { return null as any; }
})();

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get('url') || '').trim();
    if (!url) return NextResponse.json({ message: 'Informe url' }, { status: 400 });
    const info = await integrationApi?.mediafire?.(url);
    return NextResponse.json({ ok: true, info });
  } catch (err: any) {
    return NextResponse.json({ message: err?.message || 'Erro' }, { status: 500 });
  }
});
