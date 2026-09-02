import { useEffect } from "react";

import { DashboardApp, DashboardErrorBoundary } from "./App";
import { AdminApp } from "./AdminApp";
import InternalGroupInviteRoute from "./InternalGroupInvite";
import { LandingPage } from "./LandingPage";

const productionOrigin = "https://botadmin.shop";

const isDashboardPath = (pathname: string) =>
  pathname.startsWith("/dashboard/react") || pathname.startsWith("/dashboard/user");

// Support both the clean local route and the static production mount used by
// the React bundle.  The latter is important when the server serves the app
// from `/dashboard/react/` and a browser opens `/dashboard/react/admin`.
const isAdminPath = (pathname: string) =>
  pathname.startsWith("/dashboard/admin") || pathname.startsWith("/dashboard/react/admin");

const internalInviteToken = (pathname: string) => {
  const match = pathname.match(/^\/g\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

const isPublicPath = (pathname: string) =>
  pathname === "/" ||
  pathname === "/index.html" ||
  [
    "/comandos",
    "/tutorials",
    "/grupos-oficiais",
    "/robo-afiliados",
    "/termos",
    "/privacidade",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);

/**
 * On the production host, public pages remain owned by the original Next
 * application. On localhost, the landing is mirrored from that application
 * and authentication/dashboard routes stay inside this isolated React build
 * so local testing can never jump into the Flutter deployment.
 */
function OriginalApplicationRoute() {
  useEffect(() => {
    const destination = new URL(
      `${location.pathname}${location.search}${location.hash}`,
      productionOrigin,
    );

    // In production the server routes public pages before this dashboard
    // bundle. This guard primarily handles Vite's local SPA fallback.
    if (location.origin !== productionOrigin) {
      location.replace(destination.toString());
    }
  }, []);

  return (
    <main className="original-route-loader" aria-live="polite">
      <span />
      <b>Abrindo BotAdmin…</b>
    </main>
  );
}

export default function RouterApp() {
  // Vite is an isolated React homologation server. Never send its root or
  // authentication paths to production: keeping the whole local origin in
  // React makes `http://localhost:5173` immediately testable. The production
  // host still falls through to the original Next application below.
  if (isLocalHost) {
    const inviteToken = internalInviteToken(location.pathname);
    if (inviteToken) return <InternalGroupInviteRoute token={inviteToken} />;
    if (isAdminPath(location.pathname)) return <AdminApp />;
    if (isDashboardPath(location.pathname)) return <DashboardErrorBoundary><DashboardApp /></DashboardErrorBoundary>;
    // Public pages stay inside the isolated React app as well. This prevents
    // a local navigation (for example /comandos or /tutorials) from falling
    // through to the dashboard auth shell or the production Flutter host.
    if (isPublicPath(location.pathname)) return <LandingPage />;
    return <DashboardErrorBoundary><DashboardApp /></DashboardErrorBoundary>;
  }
  if (isAdminPath(location.pathname)) return <AdminApp />;
  if (isDashboardPath(location.pathname)) return <DashboardErrorBoundary><DashboardApp /></DashboardErrorBoundary>;
  return <OriginalApplicationRoute />;
}
