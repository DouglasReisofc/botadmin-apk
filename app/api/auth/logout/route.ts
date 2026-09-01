import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE, SESSION_COOKIE, clearSessionCookie, revokeSession } from "lib/auth";

const getCookieHeaderValues = (cookieHeader: string | null, name: string) => {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) return null;
      const key = entry.slice(0, separatorIndex).trim();
      if (key !== name) return null;
      const rawValue = entry.slice(separatorIndex + 1).trim();
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    })
    .filter((value): value is string => Boolean(value));
};

const revokeSessionBestEffort = async (sessionId: string) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      revokeSession(sessionId),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 1500);
      }),
    ]);
  } catch (error) {
    console.warn("[auth/logout] Falha ao revogar sessão", { sessionId, error });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export async function POST() {
  const headerList = await headers();
  const cookieContext = {
    forwardedProto: headerList.get("x-forwarded-proto"),
    host: headerList.get("host"),
  };
  const cookieStore = await cookies();
  const rawCookieHeader = headerList.get("cookie");
  const sessionIds = new Set<string>([
    cookieStore.get(SESSION_COOKIE)?.value,
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    ...getCookieHeaderValues(rawCookieHeader, SESSION_COOKIE),
    ...getCookieHeaderValues(rawCookieHeader, ADMIN_SESSION_COOKIE),
  ].filter((value): value is string => Boolean(value)));

  await Promise.all(Array.from(sessionIds).map(revokeSessionBestEffort));

  const response = NextResponse.json({ message: "Logout realizado com sucesso." });
  clearSessionCookie(response, cookieContext);
  return response;
}

export const GET = POST;

