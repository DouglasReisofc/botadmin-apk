import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "ba_flutter_bundle";

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

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.redirect(resolveRedirectUrl(request, "/sign-in"));
  }

  if (user.role !== "admin") {
    return NextResponse.redirect(
      resolveRedirectUrl(request, "/dashboard/user"),
    );
  }

  const htmlPath = path.join(
    process.cwd(),
    "public",
    "dashboard",
    "user",
    "index.html",
  );
  const html = await fs.readFile(htmlPath, "utf8");

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
