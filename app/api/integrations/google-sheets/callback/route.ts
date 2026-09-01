import { NextResponse } from "next/server";

import { consumeGoogleOAuthState, exchangeGoogleCode, googleProfile, storeGoogleSheetConnection } from "lib/google-oauth";

export const dynamic = "force-dynamic";

const destination = (status: "connected" | "error", returnPath = "/dashboard/user") => {
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://botadmin.shop").replace(/\/+$/, "");
  const destination = new URL(returnPath, base);
  destination.searchParams.set("googleSheets", status);
  return destination;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  let returnPath = "/dashboard/user";
  try {
    const state = await consumeGoogleOAuthState(url.searchParams.get("state") ?? "", "sheets");
    returnPath = state.returnPath || returnPath;
    if (url.searchParams.get("error")) throw new Error("A conexão com o Google foi cancelada.");
    if (!state.userId) throw new Error("Sessão da conexão Google não encontrada.");
    const token = await exchangeGoogleCode(url.searchParams.get("code") ?? "");
    const profile = await googleProfile(token.access_token!);
    await storeGoogleSheetConnection({ userId: state.userId, email: profile.email, refreshToken: token.refresh_token, scope: token.scope });
    return NextResponse.redirect(destination("connected", returnPath));
  } catch (error) {
    console.error("Google Sheets callback failed", error);
    return NextResponse.redirect(destination("error", returnPath));
  }
}
