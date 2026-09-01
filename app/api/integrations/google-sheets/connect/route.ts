import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createGoogleOAuthState, googleAuthorizationUrl, googleScopes } from "lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in?next=/dashboard/user", request.url));
  try {
    const state = await createGoogleOAuthState({ purpose: "sheets", userId: user.id, returnPath: "/dashboard/user" });
    return NextResponse.redirect(googleAuthorizationUrl({ state, scopes: googleScopes.sheets, forceConsent: true }));
  } catch (error) {
    console.error("Failed to start Google Sheets connection", error);
    return NextResponse.redirect(new URL("/dashboard/user?googleSheets=error", request.url));
  }
}
