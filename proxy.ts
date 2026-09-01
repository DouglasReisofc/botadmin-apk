import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const shouldRewriteToFaviconCheck = (req: NextRequest): boolean => {
  if (req.nextUrl.pathname !== "/") {
    return false;
  }
  const ua = req.headers.get("user-agent")?.toLowerCase() ?? "";
  if (!ua) {
    return false;
  }
  return ua.includes("realfavicongenerator") || ua.includes("faviconchecker");
};

const shouldIgnoreStaleServerAction = (req: NextRequest): boolean => {
  if (req.method !== "POST") {
    return false;
  }
  const actionId = req.headers.get("next-action")?.trim();
  return actionId === "x";
};

export function proxy(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  if (host === "www.botadmin.shop") {
    const url = req.nextUrl.clone();
    url.hostname = "botadmin.shop";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  if (shouldIgnoreStaleServerAction(req)) {
    return new NextResponse(null, { status: 204 });
  }

  if (shouldRewriteToFaviconCheck(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/favicon-check";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"],
};
