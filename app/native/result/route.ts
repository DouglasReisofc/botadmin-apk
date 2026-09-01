import { NextRequest, NextResponse } from "next/server";

import { submitAutoDownNativeJobResult } from "lib/autodown";
import {
  buildChatGptPayloadFromNativeResult,
  completeChatGptPhoneJob,
  getChatGptPhoneJob,
  isRetryableChatGptNativeErrorResult,
} from "lib/chatgpt-phone";
import { authorizeNative } from "../_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

const parseBodyJson = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const readBody = async (req: NextRequest): Promise<Record<string, unknown>> => {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  const raw = await req.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  if (contentType.includes("application/json") || contentType.includes("text/plain")) {
    const parsed = parseBodyJson(trimmed);
    if (parsed) {
      return parsed;
    }
    if (trimmed.startsWith("payload=")) {
      return parseBodyJson(trimmed.slice("payload=".length).trim()) ?? {};
    }
    return {};
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const payload = params.get("payload") ?? params.get("json");
    return payload ? parseBodyJson(payload) ?? {} : {};
  }
  return {};
};

export async function POST(req: NextRequest) {
  const unauthorized = authorizeNative(req);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await readBody(req);
  const result = submitAutoDownNativeJobResult(body);
  const nativeResult = result.ok ? result.result : null;
  if (nativeResult?.jobId) {
    const job = await getChatGptPhoneJob(nativeResult.jobId).catch(() => null);
    if (job && !["succeeded", "failed"].includes(job.status)) {
      if (isRetryableChatGptNativeErrorResult(nativeResult)) {
        return NextResponse.json(
          {
            ...result,
            chatgptPhoneJob: {
              jobId: job.jobId,
              status: job.status,
              ignoredNativeError: true,
            },
          },
          { status: result.ok ? 200 : 400 },
        );
      }
      try {
        const completedJob = await completeChatGptPhoneJob({
          jobId: nativeResult.jobId,
          workerId: nativeResult.clientId,
          payload: buildChatGptPayloadFromNativeResult(nativeResult),
        });
        return NextResponse.json(
          {
            ...result,
            chatgptPhoneJob: {
              jobId: completedJob.jobId,
              status: completedJob.status,
              resultType: completedJob.resultType,
              artifactsCount: completedJob.artifacts.length,
            },
          },
          { status: result.ok ? 200 : 400 },
        );
      } catch (error) {
        console.warn("[native/result] falha ao completar chatgpt_phone_job pelo retorno nativo", {
          jobId: nativeResult.jobId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const status = result.ok ? 200 : 400;
  return NextResponse.json(result, { status });
}
