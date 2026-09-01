import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";

import { createSession, normalizeUserRole, setSessionCookie } from "lib/auth";
import { ensureUserTable, getDb, type UserRow } from "lib/db";
import { consumeGoogleOAuthState, exchangeGoogleCode, googleProfile, storeGoogleSheetConnection } from "lib/google-oauth";
import { getPartnerPanelAccess } from "lib/reseller-program";

export const dynamic = "force-dynamic";

const publicUrl = () => (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://botadmin.shop").replace(/\/+$/, "");

const failure = (reason: string) => {
  const url = new URL("/sign-in", publicUrl());
  url.searchParams.set("google", reason);
  return NextResponse.redirect(url);
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const denied = url.searchParams.get("error");
  if (denied) return failure("cancelled");
  try {
    const state = await consumeGoogleOAuthState(url.searchParams.get("state") ?? "");
    const code = url.searchParams.get("code") ?? "";
    if (!code) return failure("missing_code");
    const token = await exchangeGoogleCode(code);
    const profile = await googleProfile(token.access_token!);
    if (state.purpose === "sheets") {
      if (!state.userId) throw new Error("Sessão da conexão Google não encontrada.");
      await storeGoogleSheetConnection({ userId: state.userId, email: profile.email, refreshToken: token.refresh_token, scope: token.scope });
      return NextResponse.redirect(new URL("/dashboard/user?googleSheets=connected", publicUrl()));
    }
    await ensureUserTable();
    const db = getDb();
    const [rows] = await db.query<(UserRow & RowDataPacket)[]>("SELECT * FROM users WHERE email = ? LIMIT 1", [profile.email]);
    let user = rows[0] ?? null;
    if (!user) {
      const password = await bcrypt.hash(randomBytes(36).toString("base64url"), 12);
      const [result] = await db.query<{ insertId: number }>(
        "INSERT INTO users (name,email,password,role,is_active,balance,password_missing) VALUES (?,?,?,'user',1,0,1)",
        [profile.name, profile.email, password],
      );
      const [created] = await db.query<(UserRow & RowDataPacket)[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [result.insertId]);
      user = created[0] ?? null;
    }
    if (!user || !user.is_active) return failure("inactive");
    const session = await createSession(Number(user.id), 30);
    const isAdmin = normalizeUserRole(user.role) === "admin";
    const partnerAccess = isAdmin ? null : await getPartnerPanelAccess(Number(user.id));
    const destination = isAdmin
      ? "/dashboard/admin"
      : partnerAccess
        ? "/dashboard/partner"
        : state.returnPath;
    const response = NextResponse.redirect(new URL(destination, publicUrl()));
    const headerList = await headers();
    setSessionCookie(response, session.id, session.expiresAt, { forwardedProto: headerList.get("x-forwarded-proto"), host: headerList.get("host") });
    return response;
  } catch (error) {
    console.error("Google login callback failed", error);
    return failure("failed");
  }
}
