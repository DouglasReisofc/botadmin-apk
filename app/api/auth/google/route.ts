import { NextResponse } from "next/server";

import { createGoogleOAuthState, googleAuthorizationUrl, googleScopes } from "lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const next = url.searchParams.get("next") ?? "/dashboard/user";
    const state = await createGoogleOAuthState({ purpose: "login", returnPath: next });
    return NextResponse.redirect(googleAuthorizationUrl({ state, scopes: googleScopes.login }));
  } catch (error) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("google", "config_error");
    console.error("Failed to start Google login", error);
    return NextResponse.redirect(url);
  }
}
