import { NextRequest, NextResponse } from "next/server";

import { buildAutoDownNativeAdaptersBundle } from "lib/autodown";
import { authorizeNative } from "../_shared";

export const runtime = "nodejs";

const jsonNoStore = (body: Record<string, unknown>, init?: ResponseInit) => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
};

export async function GET(req: NextRequest) {
  const unauthorized = authorizeNative(req);
  if (unauthorized) {
    return unauthorized;
  }
  return jsonNoStore({ ok: true, ...buildAutoDownNativeAdaptersBundle() });
}
