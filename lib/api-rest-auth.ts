import { NextRequest, NextResponse } from "next/server";

import {
  consumeUserApiRequest,
  type UserApiKey,
} from "lib/user-api-keys";

const extractToken = (request: NextRequest): string | null => {
  const headerToken = request.headers.get("x-api-key") ?? request.headers.get("apikey");
  if (headerToken?.trim()) {
    return headerToken.trim();
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const [scheme, token] = authHeader.split(/\s+/);
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }
  }

  const apiKey = request.nextUrl.searchParams.get("apikey") ?? request.nextUrl.searchParams.get("apiKey");
  if (apiKey?.trim()) {
    return apiKey.trim();
  }

  return null;
};

export type ApiAuthResult =
  | { ok: true; record: UserApiKey }
  | { ok: false; response: NextResponse };

export const authenticateUserApiRequest = async (request: NextRequest): Promise<ApiAuthResult> => {
  const token = extractToken(request);
  const result = await consumeUserApiRequest(token);

  if (!result.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { status: false, message: result.message },
        { status: result.status },
      ),
    };
  }

  return { ok: true, record: result.record };
};

export const applyRateLimitHeaders = (response: Response, record: UserApiKey): void => {
  const remaining = Math.max(0, record.dailyQuota - record.requestsUsed);
  response.headers.set("X-RateLimit-Limit", record.dailyQuota.toString());
  response.headers.set("X-RateLimit-Remaining", remaining.toString());
  if (record.resetAt) {
    const resetSeconds = Math.floor(record.resetAt.getTime() / 1000);
    response.headers.set("X-RateLimit-Reset", resetSeconds.toString());
  }
};

export const withUserApiAuth = <
  Handler extends (request: NextRequest, context: any, auth: UserApiKey) => Promise<Response>
>(
  handler: Handler,
) => {
  return async (request: NextRequest, context?: any): Promise<Response> => {
    const auth = await authenticateUserApiRequest(request);
    if (!auth.ok) {
      return auth.response;
    }
    const response = await handler(request, context, auth.record);
    applyRateLimitHeaders(response, auth.record);
    return response;
  };
};
