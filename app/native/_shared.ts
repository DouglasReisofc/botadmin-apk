import { NextRequest, NextResponse } from "next/server";

import { isAutoDownNativeAuthTokenValid } from "lib/autodown";

export const getNativeToken = (req: NextRequest): string | null => {
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    return bearer;
  }
  return (
    req.headers.get("x-autodown-token")?.trim() ||
    req.nextUrl.searchParams.get("token")?.trim() ||
    null
  );
};

export const authorizeNative = (req: NextRequest): NextResponse | null => {
  if (isAutoDownNativeAuthTokenValid(getNativeToken(req))) {
    return null;
  }
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
};

export const readBooleanFlag = (value: string | null): boolean | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
};
