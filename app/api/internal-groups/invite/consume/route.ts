import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  INTERNAL_GROUP_INVITE_COOKIE,
  internalGroupInviteCookieOptions,
} from "lib/internal-group-invite-intent";
import { InternalGroupError, joinInternalGroupByToken } from "lib/internal-groups";
import { getPublicAppBaseUrl } from "lib/meta";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  const publicBaseUrl = getPublicAppBaseUrl();
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.redirect(
      new URL(`/sign-in?next=${encodeURIComponent(`/g/${token}`)}`, publicBaseUrl),
    );
  }
  try {
    const result = await joinInternalGroupByToken(user.id, token);
    const response = NextResponse.redirect(
      new URL(
        `/dashboard/user?section=internalGroups&internalGroupId=${result.group.id}&invite=1`,
        publicBaseUrl,
      ),
    );
    response.cookies.set(INTERNAL_GROUP_INVITE_COOKIE, "", {
      ...internalGroupInviteCookieOptions(),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const message = error instanceof InternalGroupError ? error.message : "Não foi possível entrar neste grupo.";
    return NextResponse.json({ message }, { status: error instanceof InternalGroupError ? error.status : 500 });
  }
}
