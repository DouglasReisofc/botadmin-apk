//import modules libraries
import type { Metadata, Viewport } from "next";
import { getAdminSiteSettings } from "lib/admin-site";
import { getPublicAppBaseUrl } from "lib/meta";
import { Public_Sans } from "next/font/google";
import "lib/server-bootstrap";

// import lightweight public styles
import "styles/public.scss";
import "styles/theme-toggle.css";
import { ThemeProvider } from "components/theme/ThemeProvider";
import { themeBootstrapScript } from "components/theme/theme-script";
import NativeAppOpenScript from "components/mobile/NativeAppOpenScript";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  display: "swap",
});

const FAVICON_ASSET_VERSION = "botadmin-logo-20260723d";
const versionedFaviconUrl = (url: string) => `${url}?v=${FAVICON_ASSET_VERSION}`;
const FALLBACK_FAVICON = versionedFaviconUrl("/favicon.ico");
const FALLBACK_FAVICON_16 = versionedFaviconUrl("/favicon-16x16.png");
const FALLBACK_FAVICON_32 = versionedFaviconUrl("/favicon-32x32.png");
const FALLBACK_FAVICON_48 = versionedFaviconUrl("/favicon-48x48.png");
const FALLBACK_FAVICON_96 = versionedFaviconUrl("/android-chrome-96x96.png");
const FALLBACK_APPLE_ICON = versionedFaviconUrl("/apple-touch-icon.png");
const FALLBACK_KEYWORDS = [
  "bot whatsapp",
  "automação whatsapp",
  "bot admin",
  "moderar grupos whatsapp",
];

type MetadataIcons = NonNullable<Metadata["icons"]>;

const createIconSet = (): MetadataIcons => ({
  icon: [],
  shortcut: [],
  apple: [],
});

const pushUniqueIcon = <T extends { url: string; sizes?: string; type?: string }>(list: T[], entry: T) => {
  if (
    !list.some(
      (item) =>
        item.url === entry.url &&
        (item.sizes ?? "") === (entry.sizes ?? "") &&
        (item.type ?? "") === (entry.type ?? ""),
    )
  ) {
    list.push(entry);
  }
};

const applyFallbackIcons = (icons: MetadataIcons): MetadataIcons => {
  if (
    !icons.icon.some(
      (icon) =>
        (icon.sizes ?? "").toLowerCase() === "any" || (icon.type ?? "") === "image/x-icon",
    )
  ) {
    pushUniqueIcon(icons.icon, {
      url: FALLBACK_FAVICON,
      rel: "icon",
      sizes: "any",
      type: "image/x-icon",
    });
  }

  if (!icons.icon.some((icon) => icon.sizes === "16x16")) {
    pushUniqueIcon(icons.icon, { url: FALLBACK_FAVICON_16, type: "image/png", sizes: "16x16" });
  }

  if (!icons.icon.some((icon) => icon.sizes === "32x32")) {
    pushUniqueIcon(icons.icon, { url: FALLBACK_FAVICON_32, type: "image/png", sizes: "32x32" });
  }

  if (!icons.icon.some((icon) => icon.sizes === "48x48")) {
    pushUniqueIcon(icons.icon, { url: FALLBACK_FAVICON_48, type: "image/png", sizes: "48x48" });
  }

  if (!icons.icon.some((icon) => icon.sizes === "96x96")) {
    pushUniqueIcon(icons.icon, { url: FALLBACK_FAVICON_96, type: "image/png", sizes: "96x96" });
  }

  // Não adicionamos rel="shortcut icon" para evitar duplicidade de ICO.

  if (!icons.apple.length) {
    pushUniqueIcon(icons.apple, {
      url: FALLBACK_APPLE_ICON,
      sizes: "180x180",
      type: "image/png",
    } as (typeof icons.apple)[number]);
  }

  return icons;
};

const resolveFallbackIcons = (): MetadataIcons => applyFallbackIcons(createIconSet());
const DEFAULT_THEME_COLOR = "#10664f";
const FALLBACK_OG_IMAGE = "/images/png/dasher-ai.png";
const dashboardServiceWorkerCleanupScript = `
(function () {
  var markerKey = "botadmin-dashboard-sw-cleanup-version";
  var cleanupVersion = "20260723-dashboard-sw-reset-v2";

  try {
    if (window.localStorage && window.localStorage.getItem(markerKey) === cleanupVersion) {
      return;
    }
  } catch (_) {}

  function rememberCleanup() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(markerKey, cleanupVersion);
      }
    } catch (_) {}
  }

  function clearDashboardCaches() {
    if (!("caches" in window) || !window.caches.keys) {
      return Promise.resolve();
    }
    return window.caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        var name = String(key || "").toLowerCase();
        if (
          name.indexOf("flutter") !== -1 ||
          name.indexOf("botadmin") !== -1 ||
          name.indexOf("dashboard") !== -1
        ) {
          return window.caches.delete(key);
        }
        return Promise.resolve(false);
      }));
    });
  }

  if (!("serviceWorker" in navigator)) {
    clearDashboardCaches().finally(rememberCleanup);
    return;
  }

  navigator.serviceWorker.getRegistrations()
    .then(function (registrations) {
      return Promise.all(registrations.map(function (registration) {
        var scope = String(registration.scope || "");
        if (scope.indexOf("/dashboard/user/") !== -1) {
          return registration.unregister();
        }
        return Promise.resolve(false);
      }));
    })
    .then(clearDashboardCaches)
    .finally(rememberCleanup);
})();
`;

const toAbsoluteUrl = (baseUrl: string, value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};

export async function generateMetadata(): Promise<Metadata> {
  const isCI = (process.env.CI || "").toLowerCase() === "true";
  const baseUrl = getPublicAppBaseUrl();
  const metadataBase = new URL(baseUrl);

  if (isCI) {
    // Evita tocar no banco durante build em pipelines (GitHub Actions)
    return {
      title: "BotAdmin",
      description:
        "Projeto completo com landing page, autenticação e dashboards para administradores e usuários.",
      metadataBase,
      icons: resolveFallbackIcons(),
      manifest: "/site.webmanifest",
      appleWebApp: { capable: true, title: "BotAdmin" },
      keywords: FALLBACK_KEYWORDS,
      openGraph: {
        title: "BotAdmin",
        description:
          "Projeto completo com landing page, autenticação e dashboards para administradores e usuários.",
        url: baseUrl,
        siteName: "BotAdmin",
        type: "website",
        images: [{ url: new URL(FALLBACK_OG_IMAGE, baseUrl).toString() }],
      },
      twitter: {
        card: "summary_large_image",
        title: "BotAdmin",
        description:
          "Projeto completo com landing page, autenticação e dashboards para administradores e usuários.",
        images: [new URL(FALLBACK_OG_IMAGE, baseUrl).toString()],
      },
    };
  }

  try {
    const settings = await getAdminSiteSettings();
    const siteName = settings.siteName ?? "BotAdmin";
    const title = settings.seoTitle ?? siteName;
    const description =
      settings.seoDescription ??
      settings.tagline ??
      "Projeto completo com landing page, autenticação e dashboards para administradores e usuários.";
    const keywords = settings.seoKeywords.length > 0 ? settings.seoKeywords : undefined;
    const highlightKeywords =
      settings.seoHighlightKeywords.length > 0 ? settings.seoHighlightKeywords : undefined;

    const manifestUrl = "/site.webmanifest";
    const finalIcons = resolveFallbackIcons();

    const ogImageCandidate =
      toAbsoluteUrl(baseUrl, settings.seoImageUrl) ??
      toAbsoluteUrl(baseUrl, settings.heroImageUrl ?? settings.logoUrl) ??
      new URL(FALLBACK_OG_IMAGE, baseUrl).toString();
    const ogImages = ogImageCandidate ? [{ url: ogImageCandidate }] : undefined;

    return {
      title,
      description,
      metadataBase,
      keywords,
      icons: finalIcons,
      manifest: manifestUrl,
      appleWebApp: {
        capable: true,
        title: settings.siteName ?? title,
        statusBarStyle: "default",
      },
      openGraph: {
        title,
        description,
        url: baseUrl,
        siteName,
        type: "website",
        images: ogImages,
        tags: highlightKeywords,
      },
      twitter: {
        card: ogImages ? "summary_large_image" : "summary",
        title,
        description,
        images: ogImages?.map((image) => image.url),
      },
      other:
        highlightKeywords && highlightKeywords.length > 0
          ? { "data-highlight-keywords": highlightKeywords.join(", ") }
          : undefined,
    };
  } catch {
    return {
      title: "BotAdmin",
      description:
        "Projeto completo com landing page, autenticação e dashboards para administradores e usuários.",
      metadataBase,
      keywords: FALLBACK_KEYWORDS,
      icons: resolveFallbackIcons(),
      manifest: "/site.webmanifest",
      appleWebApp: { capable: true, title: "BotAdmin" },
      openGraph: {
        title: "BotAdmin",
        description:
          "Projeto completo com landing page, autenticação e dashboards para administradores e usuários.",
        url: baseUrl,
        siteName: "BotAdmin",
        type: "website",
        images: [{ url: new URL(FALLBACK_OG_IMAGE, baseUrl).toString() }],
      },
      twitter: {
        card: "summary_large_image",
        title: "BotAdmin",
        description:
          "Projeto completo com landing page, autenticação e dashboards para administradores e usuários.",
        images: [new URL(FALLBACK_OG_IMAGE, baseUrl).toString()],
      },
    };
  }
}

export const generateViewport = async (): Promise<Viewport> => ({
  themeColor: DEFAULT_THEME_COLOR,
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="expanded" suppressHydrationWarning data-theme="dark" data-bs-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <script dangerouslySetInnerHTML={{ __html: dashboardServiceWorkerCleanupScript }} />
        <NativeAppOpenScript />
      </head>
      <body className={`${publicSans.variable}`} suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
