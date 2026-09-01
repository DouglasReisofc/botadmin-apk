import { NextRequest, NextResponse } from 'next/server';
import { ytPlayMp4 } from 'lib/apis/yt';

import { withUserApiAuth } from 'lib/api-rest-auth';

export const GET = withUserApiAuth(async (req: NextRequest, _context, auth) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || searchParams.get('query') || '').trim();
    if (!q) return NextResponse.json({ message: 'Informe q' }, { status: 400 });
    const result = await ytPlayMp4(q, { apiKey: auth.apiKey });
    return NextResponse.json({
      ok: true,
      status: true,
      código: 200,
      resultado: result,
      result,
    });
  } catch (err: any) {
    const message = err?.message || 'Erro';
    return NextResponse.json({ status: false, ok: false, mensagem: message, message }, { status: 500 });
  }
});
