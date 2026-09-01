import { NextRequest, NextResponse } from "next/server";

import { heartbeatChatGptPhoneWorker } from "lib/chatgpt-phone";

export const runtime = "nodejs";

const tokenFromRequest = (req: NextRequest): string | null => {
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  return req.headers.get("x-chatgpt-phone-token")?.trim() || null;
};

const authorizeWorker = (req: NextRequest): NextResponse | null => {
  const expected = process.env.CHATGPT_PHONE_WORKER_TOKEN?.trim();
  if (!expected && process.env.NODE_ENV !== "production") {
    return null;
  }
  if (expected && tokenFromRequest(req) === expected) {
    return null;
  }
  return NextResponse.json({ message: "Worker não autorizado." }, { status: 401 });
};

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

export async function POST(req: NextRequest) {
  const unauthorized = authorizeWorker(req);
  if (unauthorized) {
    return unauthorized;
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const workerId =
    toStringOrNull(body.workerId) ??
    req.headers.get("x-chatgpt-phone-worker")?.trim() ??
    "chatgpt-phone-worker";
  await heartbeatChatGptPhoneWorker({
    workerId,
    jobId: toStringOrNull(body.jobId),
  });

  return NextResponse.json({ ok: true });
}
