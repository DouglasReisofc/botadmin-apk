import { NextRequest, NextResponse } from "next/server";

import { recordAutoDownNativeMonitorEvents } from "lib/autodown";
import { authorizeNative } from "../_shared";

export const runtime = "nodejs";

const readBody = async (req: NextRequest): Promise<Record<string, unknown>> => {
  const raw = await req.text();
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

export async function POST(req: NextRequest) {
  const unauthorized = authorizeNative(req);
  if (unauthorized) {
    return unauthorized;
  }
  return NextResponse.json({ ok: true, ...recordAutoDownNativeMonitorEvents(await readBody(req)) });
}
