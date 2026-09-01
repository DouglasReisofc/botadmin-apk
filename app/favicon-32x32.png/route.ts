import type { NextRequest } from "next/server";

import { handleFaviconRequest } from "lib/favicon-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleFaviconRequest(req, "png32");
}
