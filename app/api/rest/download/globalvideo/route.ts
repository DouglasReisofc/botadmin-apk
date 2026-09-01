import { NextRequest } from 'next/server';

import { withUserApiAuth } from 'lib/api-rest-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const GET = withUserApiAuth(async (req: NextRequest) => {
  const redir = new URL(req.url);
  redir.pathname = redir.pathname.replace('/download/globalvideo', '/globalvideo');
  return Response.redirect(redir.toString(), 307);
});
