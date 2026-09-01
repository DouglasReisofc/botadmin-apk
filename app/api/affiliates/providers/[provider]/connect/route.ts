import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createAffiliateOAuthAuthorizationUrl } from "lib/affiliate-connections";

type RouteContext = { params: Promise<{ provider: string }> | { provider: string } };
const isLocalHostLike = (host: string): boolean => /^(localhost|127\.0\.0\.1|::1)(:\d+)?$/i.test(host);

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const provider = String(params.provider || "").trim();
    const payload = await request.json().catch(() => ({}));
    const returnTo = typeof payload?.returnTo === "string" ? payload.returnTo : null;
    const forwardedProto = String(request.headers.get("x-forwarded-proto") || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    const forwardedHost = String(request.headers.get("x-forwarded-host") || "")
      .split(",")[0]
      .trim();
    const directHost = String(request.headers.get("host") || "")
      .split(",")[0]
      .trim();
    const candidateHost = forwardedHost || directHost;
    const fallbackScheme = isLocalHostLike(candidateHost) ? "http" : "https";
    const rawProtocol = request.nextUrl.protocol.replace(":", "").trim().toLowerCase();
    const scheme =
      forwardedProto === "http" || forwardedProto === "https"
        ? forwardedProto
        : rawProtocol === "http" || rawProtocol === "https"
          ? rawProtocol
          : fallbackScheme;
    const requestOrigin =
      candidateHost && /^[a-z0-9.-]+(?::\d+)?$/i.test(candidateHost)
        ? `${scheme}://${candidateHost}`
        : request.nextUrl.origin;

    const result = await createAffiliateOAuthAuthorizationUrl(user.id, provider, returnTo, {
      redirectUriOrigin: requestOrigin,
    });
    return NextResponse.json({ status: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível iniciar a autorização OAuth.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
