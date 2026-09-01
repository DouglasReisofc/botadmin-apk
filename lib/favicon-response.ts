import path from "path";
import { readFile } from "fs/promises";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { AdminSiteSettings } from "types/admin-site";
import { getAdminSiteSettings } from "lib/admin-site";
import { getPublicAppBaseUrl } from "lib/meta";
import { getR2UploadObject } from "lib/r2-uploads";
import { servePublicFile } from "lib/serve-public-file";
import { UPLOADS_STORAGE_ROOT } from "lib/uploads";

const DEFAULT_THEME_COLOR = "#10664f";
const DEFAULT_BACKGROUND_COLOR = "#ffffff";

type FaviconKind =
  | "ico"
  | "svg"
  | "png16"
  | "png32"
  | "png48"
  | "png96"
  | "android192"
  | "android512"
  | "apple"
  | "manifest";

const FALLBACK_FILES: Record<FaviconKind, { file: string; type: string }> = {
  ico: { file: "favicon.ico", type: "image/x-icon" },
  svg: { file: "favicon.svg", type: "image/svg+xml" },
  png16: { file: "favicon-16x16.png", type: "image/png" },
  png32: { file: "favicon-32x32.png", type: "image/png" },
  png48: { file: "favicon-48x48.png", type: "image/png" },
  png96: { file: "android-chrome-96x96.png", type: "image/png" },
  android192: { file: "android-chrome-192x192.png", type: "image/png" },
  android512: { file: "android-chrome-512x512.png", type: "image/png" },
  apple: { file: "apple-touch-icon.png", type: "image/png" },
  manifest: { file: "site.webmanifest", type: "application/manifest+json" },
};

const FAVICON_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

const FAVICON_PNG_SIZES: Partial<Record<FaviconKind, number>> = {
  png16: 16,
  png32: 32,
  png48: 48,
  png96: 96,
  android192: 192,
  android512: 512,
  apple: 180,
};

const resolveAssetUrl = (settings: AdminSiteSettings, kind: FaviconKind): string | null => {
  const assets = settings.faviconAssets ?? null;
  switch (kind) {
    case "ico":
      return assets?.icoUrl ?? null;
    case "svg":
      return assets?.svgUrl ?? null;
    case "png16":
      return assets?.png16Url ?? null;
    case "png32":
      return assets?.png32Url ?? null;
    case "png48":
      return assets?.png48Url ?? null;
    case "png96":
      return assets?.png96Url ?? assets?.androidChrome192Url ?? null;
    case "android192":
      return assets?.androidChrome192Url ?? null;
    case "android512":
      return assets?.androidChrome512Url ?? null;
    case "apple":
      return (
        assets?.appleTouchIconUrl ??
        settings.mobileAppIconUrl ??
        settings.logoUrl ??
        null
      );
    case "manifest":
      return assets?.manifestUrl ?? null;
    default:
      return null;
  }
};

const FAVORITES_ROOT = path.join(process.cwd(), "resources", "favicons");
const OFFICIAL_FAVICON_SOURCE = path.join(
  process.cwd(),
  "flutter_panel",
  "assets",
  "brand",
  "botadmin-icon.png",
);

const normalizeUploadsAbsolutePath = (url: string | null | undefined): string | null => {
  if (!url) {
    return null;
  }

  const normalized = normalizePublicAssetPath(url);
  if (!normalized) {
    return null;
  }

  if (!normalized.startsWith("uploads/")) {
    return null;
  }

  const relative = normalized.slice("uploads/".length);
  return path.join(UPLOADS_STORAGE_ROOT, relative);
};

const normalizePublicAssetPath = (url: string | null | undefined): string | null => {
  if (!url) {
    return null;
  }

  const trimmed = url.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return trimmed.replace(/^\/+/, "");
  }
};

const resolvePublicAssetUrl = (req: NextRequest, url: string): URL | null => {
  const publicBaseUrl = getPublicAppBaseUrl();
  const normalized = normalizePublicAssetPath(url);
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("uploads/")) {
    return new URL(`/${normalized}`, publicBaseUrl);
  }

  try {
    const target = new URL(url, req.url);
    const targetHost = target.hostname.toLowerCase();
    if (targetHost === "localhost" || targetHost === "127.0.0.1") {
      return new URL(`${target.pathname}${target.search}`, publicBaseUrl);
    }
    return target;
  } catch {
    return null;
  }
};

const ensureBuffer = async (paths: Array<string | null>, resize?: number) => {
  for (const candidate of paths) {
    if (!candidate) continue;
    try {
      const data = await readFile(candidate);
      if (resize) {
        const sharp = (await import("sharp")).default;
        return sharp(data)
          .resize(resize, resize, { fit: "cover" })
          .png()
          .toBuffer();
      }
      return data;
    } catch {
      // try next candidate
    }
  }
  return null;
};

const readUploadBuffer = async (url: string | null | undefined): Promise<Buffer | null> => {
  const normalized = normalizePublicAssetPath(url);
  if (!normalized || !normalized.startsWith("uploads/")) {
    return null;
  }

  const absolute = normalizeUploadsAbsolutePath(normalized);
  if (absolute) {
    try {
      return await readFile(absolute);
    } catch {
      // try R2 below
    }
  }

  const object = await getR2UploadObject(normalized).catch((error) => {
    console.warn("[favicon] Falha ao ler upload do R2", { path: normalized, error });
    return null;
  });

  return object?.buffer ?? null;
};

const readFirstUploadBuffer = async (urls: Array<string | null | undefined>): Promise<Buffer | null> => {
  for (const url of urls) {
    const buffer = await readUploadBuffer(url);
    if (buffer) {
      return buffer;
    }
  }
  return null;
};

const getLogoFirstSources = (settings: AdminSiteSettings): Array<string | null | undefined> => {
  const assets = settings.faviconAssets ?? null;
  return [
    settings.logoUrl,
    settings.faviconUrl,
    settings.mobileAppIconUrl,
    assets?.androidChrome512Url,
    assets?.androidChrome192Url,
    assets?.png96Url,
    assets?.png48Url,
    assets?.png32Url,
    assets?.png16Url,
  ];
};

const buildPngBufferFromLogo = async (
  settings: AdminSiteSettings,
  kind: FaviconKind,
): Promise<Buffer | null> => {
  const size = FAVICON_PNG_SIZES[kind];
  if (!size) {
    return null;
  }

  const baseBuffer =
    await ensureBuffer([OFFICIAL_FAVICON_SOURCE]) ??
    await readFirstUploadBuffer(getLogoFirstSources(settings));
  if (!baseBuffer) {
    return null;
  }

  try {
    const sharp = (await import("sharp")).default;
    return sharp(baseBuffer)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch (error) {
    console.warn("[favicon] Falha ao gerar PNG a partir da logo", { kind, error });
    return null;
  }
};

const buildIcoBuffer = async (settings: AdminSiteSettings): Promise<Buffer | null> => {
  const assets = settings.faviconAssets ?? null;

  const baseBuffer =
    await ensureBuffer([OFFICIAL_FAVICON_SOURCE]) ??
    await readFirstUploadBuffer(getLogoFirstSources(settings)) ??
    await ensureBuffer([
      normalizeUploadsAbsolutePath(assets?.androidChrome512Url),
      normalizeUploadsAbsolutePath(assets?.androidChrome192Url),
      normalizeUploadsAbsolutePath(assets?.png96Url),
      normalizeUploadsAbsolutePath(assets?.png48Url),
      normalizeUploadsAbsolutePath(assets?.png32Url),
      normalizeUploadsAbsolutePath(assets?.png16Url),
      path.join(FAVORITES_ROOT, "android-chrome-512x512.png"),
    ]);
  if (!baseBuffer) {
    return null;
  }

  const sharp = (await import("sharp")).default;
  const [png16, png32, png48] = await Promise.all([
    sharp(baseBuffer)
      .resize(16, 16, { fit: "cover" })
      .png()
      .toBuffer(),
    sharp(baseBuffer)
      .resize(32, 32, { fit: "cover" })
      .png()
      .toBuffer(),
    sharp(baseBuffer)
      .resize(48, 48, { fit: "cover" })
      .png()
      .toBuffer(),
  ]);

  const pngToIco = (await import("png-to-ico")).default as (
    inputs: Array<Buffer | string>,
  ) => Promise<Buffer>;

  try {
    return await pngToIco([png16, png32, png48]);
  } catch (error) {
    console.error("Failed to build ICO from assets", error);
    return null;
  }
};

const buildSvgBufferFromLogo = async (settings: AdminSiteSettings): Promise<Buffer | null> => {
  const pngBuffer = await buildPngBufferFromLogo(settings, "png96");
  if (!pngBuffer) {
    return null;
  }

  const encoded = pngBuffer.toString("base64");
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    `<image href="data:image/png;base64,${encoded}" width="96" height="96"/>`,
    "</svg>",
  ].join("");

  return Buffer.from(svg, "utf-8");
};

const buildManifestJson = async (settings: AdminSiteSettings) => {
  let manifest: Record<string, unknown> | null = null;

  try {
    const fallbackPath = path.join(FAVORITES_ROOT, "site.webmanifest");
    const raw = await readFile(fallbackPath, "utf-8");
    manifest = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    console.error("Failed to load fallback manifest", error);
    manifest = {};
  }

  const pickFirstText = (...values: Array<string | null | undefined>) => {
    for (const value of values) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
    return "";
  };

  const siteName = pickFirstText(settings.siteName, manifest.name as string) || "BotAdmin";
  const shortName = pickFirstText(settings.siteName, manifest.short_name as string) || siteName;
  const descriptionText = pickFirstText(
    settings.seoDescription,
    settings.tagline,
    settings.heroSubtitle,
    manifest.description as string,
  );

  manifest.name = siteName;
  manifest.short_name = shortName;
  if (descriptionText) {
    manifest.description = descriptionText;
  } else if (manifest.description) {
    delete manifest.description;
  }

  const themeColor =
    (typeof manifest.theme_color === "string" && manifest.theme_color.trim()) || DEFAULT_THEME_COLOR;
  const backgroundColor =
    (typeof manifest.background_color === "string" && manifest.background_color.trim()) ||
    DEFAULT_BACKGROUND_COLOR;

  manifest.theme_color = themeColor;
  manifest.background_color = backgroundColor;
  manifest.start_url = typeof manifest.start_url === "string" && manifest.start_url.trim().length > 0
    ? manifest.start_url
    : "/";
  manifest.scope = typeof manifest.scope === "string" && manifest.scope.trim().length > 0
    ? manifest.scope
    : "/";
  manifest.lang =
    (typeof manifest.lang === "string" && manifest.lang.trim()) || "pt-BR";
  manifest.icons = [
    {
      src: "/android-chrome-192x192.png?v=botadmin-logo-20260723d",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/android-chrome-512x512.png?v=botadmin-logo-20260723d",
      sizes: "512x512",
      type: "image/png",
    },
    {
      src: "/apple-touch-icon.png?v=botadmin-logo-20260723d",
      sizes: "180x180",
      type: "image/png",
      purpose: "any",
    },
  ];

  return manifest;
};

export const handleFaviconRequest = async (
  req: NextRequest,
  kind: FaviconKind,
) => {
  let settings: AdminSiteSettings | null = null;
  try {
    settings = await getAdminSiteSettings();
  } catch (error) {
    console.warn("[favicon] Falha ao carregar configurações do site; usando fallback", error);
  }

  if (!settings) {
    const fallback = FALLBACK_FILES[kind];
    return servePublicFile(fallback.file, fallback.type);
  }

  if (kind === "ico") {
    const icoBuffer = await buildIcoBuffer(settings);
    if (icoBuffer) {
      return new NextResponse(icoBuffer, {
        headers: {
          "Content-Type": "image/x-icon",
          "Cache-Control": FAVICON_CACHE_CONTROL,
        },
      });
    }
  }

  if (kind === "svg") {
    const svgBuffer = await buildSvgBufferFromLogo(settings);
    if (svgBuffer) {
      return new NextResponse(svgBuffer, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": FAVICON_CACHE_CONTROL,
        },
      });
    }
  }

  const pngBuffer = await buildPngBufferFromLogo(settings, kind);
  if (pngBuffer) {
    return new NextResponse(pngBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": FAVICON_CACHE_CONTROL,
      },
    });
  }

  const resolvedUrl = resolveAssetUrl(settings, kind);
  const fallback = FALLBACK_FILES[kind];

  if (kind === "manifest") {
    const manifest = await buildManifestJson(settings);
    return new NextResponse(JSON.stringify(manifest, null, 2), {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  }

  if (resolvedUrl) {
    const target = resolvePublicAssetUrl(req, resolvedUrl);
    const current = new URL(req.url);
    if (target && (target.pathname !== current.pathname || target.search !== current.search)) {
      return NextResponse.redirect(target, { status: 302 });
    }
  }

  return servePublicFile(fallback.file, fallback.type);
};
