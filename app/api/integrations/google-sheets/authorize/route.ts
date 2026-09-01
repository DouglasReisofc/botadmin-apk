import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createGoogleOAuthState, googleAuthorizationUrl, googleScopes } from "lib/google-oauth";

export const dynamic = "force-dynamic";

// Flutter stores its session cookie in secure storage. A browser opened for
// OAuth cannot read that store, so the app first creates this short-lived
// authorization URL through its authenticated API client.
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Sua sessão expirou. Entre novamente para conectar o Google Sheets." }, { status: 401 });
    const body = await request.json().catch(() => ({})) as { returnPath?: unknown };
    const returnPath = typeof body.returnPath === "string" ? body.returnPath : "/dashboard/user";
    const state = await createGoogleOAuthState({ purpose: "sheets", userId: user.id, returnPath });
    return NextResponse.json({ authorizationUrl: googleAuthorizationUrl({ state, scopes: googleScopes.sheets, forceConsent: true }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to prepare Google Sheets OAuth", error);
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível iniciar a conexão Google." }, { status: 400 });
  }
}
