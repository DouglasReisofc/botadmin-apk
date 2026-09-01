import { NextRequest, NextResponse } from "next/server";

import {
  enqueueAutoDownJobAndWait,
  normalizeAutoDownUrl,
  type AutoDownJobResult,
} from "lib/autodown";
import { withUserApiAuth } from "lib/api-rest-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_TIMEOUT_MS = 180000;

const buildSuccessPayload = (
  inputUrl: string,
  job: { id: string },
  result: AutoDownJobResult,
) => ({
  status: true,
  código: 200,
  resultado: {
    url: result.directLink || result.previewUrl,
    source: inputUrl,
    site: result.site,
    job_id: job.id,
    client_id: result.clientId,
    filename: result.filename || undefined,
    mime: result.mime || undefined,
    preview_url: result.previewUrl || undefined,
    message: result.message || undefined,
  },
});

const buildFailureResponse = (inputUrl: string, message: string, status = 502) =>
  NextResponse.json(
    {
      status: false,
      mensagem: message,
      source: inputUrl,
    },
    { status },
  );

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const rawUrl = searchParams.get("url") || searchParams.get("q");
    const url = normalizeAutoDownUrl(rawUrl);
    if (!url) {
      return NextResponse.json(
        {
          status: false,
          mensagem: "Passe ?url=https://... com um link do Envato Elements ou Freepik.",
        },
        { status: 400 },
      );
    }

    const timeoutMs = Number.parseInt(searchParams.get("timeout_ms") || searchParams.get("timeout") || `${DEFAULT_TIMEOUT_MS}`, 10) || DEFAULT_TIMEOUT_MS;
    const payload = await enqueueAutoDownJobAndWait(
      url,
      {
        source: "api-autodown-enqueue",
        method: "GET",
      },
      timeoutMs,
    );

    if (!payload.ok) {
      return buildFailureResponse(url, payload.result.message || "A extensao retornou erro.", 502);
    }

    if (!payload.result.directLink && !payload.result.previewUrl) {
      return buildFailureResponse(url, "Resposta sem link de download.", 502);
    }

    return NextResponse.json(buildSuccessPayload(url, payload.job, payload.result));
  } catch (error: any) {
    return buildFailureResponse(
      "",
      error?.message || "Tempo limite aguardando resultado da extensao.",
      504,
    );
  }
});

export const POST = withUserApiAuth(async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}));
    const url = normalizeAutoDownUrl(body?.url);
    if (!url) {
      return NextResponse.json(
        {
          status: false,
          mensagem: 'Envie {"url":"https://..."} com um link do Envato Elements ou Freepik.',
        },
        { status: 400 },
      );
    }

    const timeoutMs = Number.isFinite(body?.timeout_ms) ? body.timeout_ms : DEFAULT_TIMEOUT_MS;
    const metadata =
      body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {};

    const payload = await enqueueAutoDownJobAndWait(
      url,
      {
        ...metadata,
        source: "api-autodown-enqueue",
        method: "POST",
      },
      timeoutMs,
    );

    if (!payload.ok) {
      return buildFailureResponse(url, payload.result.message || "A extensao retornou erro.", 502);
    }

    if (!payload.result.directLink && !payload.result.previewUrl) {
      return buildFailureResponse(url, "Resposta sem link de download.", 502);
    }

    return NextResponse.json(buildSuccessPayload(url, payload.job, payload.result));
  } catch (error: any) {
    return buildFailureResponse(
      "",
      error?.message || "Tempo limite aguardando resultado da extensao.",
      504,
    );
  }
});
