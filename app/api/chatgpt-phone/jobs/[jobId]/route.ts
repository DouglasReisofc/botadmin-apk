import { NextRequest, NextResponse } from "next/server";

import { getChatGptPhoneJob, runChatGptPhoneJob } from "lib/chatgpt-phone";

export const runtime = "nodejs";

const getBearerToken = (req: NextRequest): string | null => {
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  return req.headers.get("x-botadmin-mcp-token")?.trim() || null;
};

const isLocalRequest = (req: NextRequest): boolean => {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host.startsWith("[::1]:");
};

const authorize = (req: NextRequest): NextResponse | null => {
  const expected = process.env.BOTADMIN_MCP_TOKEN?.trim();
  if (!expected) {
    if (isLocalRequest(req)) {
      return null;
    }
    return NextResponse.json(
      { message: "Configure BOTADMIN_MCP_TOKEN antes de expor esta rota." },
      { status: 503 },
    );
  }
  if (getBearerToken(req) === expected) {
    return null;
  }
  return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
};

type RouteContext = {
  params: Promise<{ jobId: string }> | { jobId: string };
};

const readParams = async (context: RouteContext): Promise<{ jobId: string }> =>
  Promise.resolve(context.params);

const toPositiveInt = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.trunc(numeric);
};

export async function GET(req: NextRequest, context: RouteContext) {
  const unauthorized = authorize(req);
  if (unauthorized) {
    return unauthorized;
  }

  const { jobId } = await readParams(context);
  const job = await getChatGptPhoneJob(jobId);
  if (!job) {
    return NextResponse.json({ message: "Job não encontrado." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, job });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const unauthorized = authorize(req);
  if (unauthorized) {
    return unauthorized;
  }

  const { jobId } = await readParams(context);
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const job = await runChatGptPhoneJob(jobId, {
    timeoutMs: toPositiveInt(body.timeoutMs),
    settleMs: toPositiveInt(body.settleMs),
    newChat: body.newChat === undefined ? undefined : body.newChat !== false,
  });
  return NextResponse.json({ ok: job.status === "succeeded", job });
}
