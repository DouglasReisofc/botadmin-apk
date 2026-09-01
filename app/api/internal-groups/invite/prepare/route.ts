import { NextResponse } from "next/server";

import {
  INTERNAL_GROUP_INVITE_COOKIE,
  internalGroupInviteCookieOptions,
  signInternalGroupInviteCookie,
} from "lib/internal-group-invite-intent";
import { getPublicAppBaseUrl } from "lib/meta";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!token || token.length > 256) {
    return NextResponse.json({ message: "Convite inválido." }, { status: 400 });
  }
  const response = NextResponse.redirect(
    new URL(`/g/${encodeURIComponent(token)}?prepared=1`, getPublicAppBaseUrl()),
  );
  response.cookies.set(
    INTERNAL_GROUP_INVITE_COOKIE,
    signInternalGroupInviteCookie(token),
    internalGroupInviteCookieOptions(),
  );
  return response;
}
