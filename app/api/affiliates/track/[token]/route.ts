import { NextRequest, NextResponse } from "next/server";

import {
  incrementAffiliateLinkClickMetric,
  parseAffiliateTrackingToken,
  resolveAffiliateTrackedDestination,
} from "lib/affiliate-link-tracking";

type RouteContext = { params: Promise<{ token: string }> | { token: string } };

const normalizeDestinationUrl = (value: string): string | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const params = await Promise.resolve(context.params);
    const payload = parseAffiliateTrackingToken(params.token);
    if (!payload) {
      return NextResponse.json({ status: false, message: "Token de rastreio inválido." }, { status: 400 });
    }

    const destinationRaw = await resolveAffiliateTrackedDestination(payload);
    const destination = destinationRaw ? normalizeDestinationUrl(destinationRaw) : null;
    if (!destination) {
      return NextResponse.json({ status: false, message: "Link afiliado não encontrado." }, { status: 404 });
    }

    await incrementAffiliateLinkClickMetric({
      userId: payload.u,
      provider: payload.p,
      itemId: payload.i,
    }).catch(() => undefined);

    return NextResponse.redirect(destination, { status: 307 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao redirecionar link afiliado.";
    return NextResponse.json({ status: false, message }, { status: 500 });
  }
}
