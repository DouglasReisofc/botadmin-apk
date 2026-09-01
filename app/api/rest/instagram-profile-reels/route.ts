import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { resolveInstagramProfileReels } from "lib/instagram-profile-reels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const parseBoundedInteger = (
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(parsed, maximum));
};

export const GET = withUserApiAuth(async (request: NextRequest) => {
  try {
    const profile =
      request.nextUrl.searchParams.get("username") ||
      request.nextUrl.searchParams.get("user") ||
      request.nextUrl.searchParams.get("profile") ||
      request.nextUrl.searchParams.get("url") ||
      "";
    const limit = parseBoundedInteger(request.nextUrl.searchParams.get("limit"), 24, 1, 120);
    const maxPages = parseBoundedInteger(
      request.nextUrl.searchParams.get("pages"),
      Math.ceil(limit / 12),
      1,
      10,
    );
    const refresh = request.nextUrl.searchParams.get("refresh");
    const result = await resolveInstagramProfileReels(profile, {
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit,
      maxPages,
      forceRefresh: refresh === "1" || refresh === "true" || refresh === "force",
    });
    return NextResponse.json({
      status: true,
      success: true,
      result,
      resultado: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível capturar os Reels.";
    return NextResponse.json({ status: false, success: false, message, mensagem: message }, { status: 502 });
  }
});
