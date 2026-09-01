import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createMobileAppAuthToken } from "lib/mobile-app-auth";
import { getPartnerPanelAccess } from "lib/reseller-program";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "ba_flutter_bundle";
const WEB_CLIENT_COOKIE_NAME = "ba_user_web_client";

const reactBundleRoot = () =>
  path.join(process.cwd(), "public", "dashboard", "react");

const wantsReactWebClient = (request: Request, partnerMode: boolean) => {
  if (partnerMode) return false;
  const url = new URL(request.url);
  if (url.searchParams.get("flutter") === "1") return false;
  if (url.searchParams.get("react") === "1") return true;
  const configuredClient = process.env.BOTADMIN_USER_WEB_CLIENT
    ?.trim()
    .toLowerCase();
  if (configuredClient === "flutter") return false;
  if (configuredClient === "react") return true;
  const clientCookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((entry) => entry.trim().split("=", 2) as [string, string])
    .find(([name]) => name === WEB_CLIENT_COOKIE_NAME)?.[1];
  if (clientCookie === "flutter") return false;
  if (clientCookie === "react") return true;
  // Durante a homologação o React só é ligado por query, cookie ou variável
  // de ambiente. Assim o painel Flutter em produção e os apps Android/Windows
  // continuam intactos até a migração web ser aprovada.
  return false;
};

const buildReactHeaders = (request: Request, html: string) => {
  const hash = html.match(/\/dashboard\/react\/assets\/index-([a-z0-9_-]+)\.js/i)?.[1] ?? "unknown";
  const url = new URL(request.url);
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store, no-cache, max-age=0, must-revalidate",
    "x-botadmin-web-client": "react",
    "x-botadmin-react-bundle": hash,
    Vary: "Cookie, User-Agent",
    "CDN-Cache-Control": "no-store",
    "Surrogate-Control": "no-store",
  });
  if (url.searchParams.get("react") === "1") {
    const secure = url.protocol === "https:" ? "; Secure" : "";
    headers.append(
      "set-cookie",
      `${WEB_CLIENT_COOKIE_NAME}=react; Path=/dashboard; Max-Age=31536000; SameSite=Lax${secure}`,
    );
  } else if (url.searchParams.get("flutter") === "1") {
    headers.append(
      "set-cookie",
      `${WEB_CLIENT_COOKIE_NAME}=; Path=/dashboard; Max-Age=0; SameSite=Lax`,
    );
  }
  return headers;
};

const readBundleVersion = (html: string) => {
  const match = html.match(/main\.dart\.([a-z0-9-]+)\.js/i);
  return match?.[1] ?? "unknown";
};

const buildFlutterHeaders = (request: Request, html: string) => {
  const version = readBundleVersion(html);
  const cookies = request.headers.get("cookie") ?? "";
  const hasCurrentBundleCookie = cookies
    .split(";")
    .some(
      (entry) =>
        entry.trim() === `${COOKIE_NAME}=${encodeURIComponent(version)}`,
    );
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store, no-cache, max-age=0, must-revalidate",
    "x-botadmin-flutter-bundle": version,
  });

  if (!hasCurrentBundleCookie) {
    headers.append(
      "set-cookie",
      `${COOKIE_NAME}=${encodeURIComponent(version)}; Path=/dashboard; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  }

  return headers;
};

const resolveRedirectUrl = (request: Request, pathname: string) => {
  const url = new URL(request.url);
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host =
    forwardedHost ||
    request.headers.get("host")?.split(",")[0]?.trim() ||
    url.host;
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const internalPorts = new Set(
    [process.env.PORT, "4322", "3000", "3001"].filter(Boolean),
  );
  const normalizePublicHost = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return trimmed;
    }
    try {
      const parsed = new URL(
        `${forwardedProto === "http" ? "http" : "https"}://${trimmed}`,
      );
      if (
        internalPorts.has(parsed.port) &&
        parsed.hostname !== "localhost" &&
        parsed.hostname !== "127.0.0.1"
      ) {
        parsed.port = "";
      }
      return parsed.host;
    } catch {
      return trimmed.replace(/:(?:4322|3000|3001)$/u, "");
    }
  };

  if (host) {
    url.host = normalizePublicHost(host);
  }

  if (forwardedProto === "http" || forwardedProto === "https") {
    url.protocol = `${forwardedProto}:`;
  }

  if (url.hostname === "0.0.0.0" || url.hostname === "::") {
    url.hostname = "127.0.0.1";
  }
  if (
    internalPorts.has(url.port) &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  ) {
    url.port = "";
  }

  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url;
};

const shouldTryNativeAppOpen = (request: Request) => {
  const url = new URL(request.url);
  if (
    url.searchParams.get("web") === "1" ||
    url.searchParams.get("noapp") === "1"
  ) {
    return false;
  }
  const ua = request.headers.get("user-agent") ?? "";
  return (
    /Android/i.test(ua) && /Mobile|wv|Chrome|SamsungBrowser|Firefox/i.test(ua)
  );
};

const injectNativeAppOpen = (html: string, deepLink: string) => {
  const payload = JSON.stringify(deepLink);
  const script = `
  <script>
    (function () {
      try {
        if (window.location.hash === "#web") return;
        var key = "ba-native-app-open-attempt";
        var now = Date.now();
        var last = Number(sessionStorage.getItem(key) || "0");
        if (last && now - last < 30000) return;
        sessionStorage.setItem(key, String(now));
        var deepLink = ${payload};
        var parsed = new URL(deepLink);
        var fallback = new URL(window.location.href);
        // Keep the browser fallback out of the visible query string. The hash
        // also prevents a second native-open attempt without cache state.
        fallback.search = "";
        fallback.hash = "web";
        var intentPath = parsed.host + parsed.pathname + parsed.search;
        var link = "intent://" + intentPath + "#Intent;scheme=botadmin;package=com.botadmin.shop;S.browser_fallback_url=" + encodeURIComponent(fallback.href) + ";end";
        setTimeout(function () {
          window.location.href = link;
        }, 350);
      } catch (e) {}
    })();
  </script>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${script}\n</head>`)
    : `${script}\n${html}`;
};

export async function GET(request: Request) {
  const user = await getCurrentUser();
  const partnerMode = new URL(request.url).searchParams.get("partner") === "1";

  if (!user) {
    return NextResponse.redirect(resolveRedirectUrl(request, "/sign-in"));
  }

  if (user.role !== "user") {
    return NextResponse.redirect(
      resolveRedirectUrl(request, "/dashboard/admin"),
    );
  }

  // Parceiros usam o mesmo bundle Flutter responsivo do painel do usuário.
  // O parâmetro é interno e só é aceito após a sessão ser validada acima.
  const partnerAccess = await getPartnerPanelAccess(user.id);
  if (partnerMode && !partnerAccess) {
    return NextResponse.redirect(
      resolveRedirectUrl(request, "/dashboard/user"),
    );
  }
  if (partnerAccess && !partnerMode) {
    return NextResponse.redirect(
      resolveRedirectUrl(request, "/dashboard/partner"),
    );
  }

  if (wantsReactWebClient(request, partnerMode)) {
    const htmlPath = path.join(reactBundleRoot(), "index.html");
    let html: string;
    try {
      html = await fs.readFile(htmlPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return NextResponse.json(
        {
          message:
            "Bundle React ausente. Execute npm run web-panel:build antes de ativar o cliente web.",
        },
        { status: 503 },
      );
    }
    if (shouldTryNativeAppOpen(request)) {
      const { token } = await createMobileAppAuthToken(user.id);
      const deepLink = `botadmin://auth?token=${encodeURIComponent(token)}&next=${encodeURIComponent("/dashboard/user")}`;
      html = injectNativeAppOpen(html, deepLink);
    }
    return new Response(html, { headers: buildReactHeaders(request, html) });
  }

  const htmlPath = path.join(
    process.cwd(),
    "public",
    "dashboard",
    "user",
    "index.html",
  );
  let html = await fs.readFile(htmlPath, "utf8");

  if (shouldTryNativeAppOpen(request)) {
    const { token } = await createMobileAppAuthToken(user.id);
    const deepLink = `botadmin://auth?token=${encodeURIComponent(token)}&next=${encodeURIComponent("/dashboard/user")}`;
    html = injectNativeAppOpen(html, deepLink);
  }

  return new Response(html, {
    headers: (() => {
      const headers = buildFlutterHeaders(request, html);
      headers.set("Vary", "Cookie, User-Agent");
      headers.set("CDN-Cache-Control", "no-store");
      headers.set("Surrogate-Control", "no-store");
      return headers;
    })(),
  });
}
