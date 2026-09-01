import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

import { getAdminMobileSettings } from "lib/admin-mobile";
import { getPublicAppBaseUrl } from "lib/meta";
import type { MobileArtifactsPayload } from "../../../../types/mobile-artifacts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const manifestPath = path.join(process.cwd(), "data/mobile-artifacts.json");
const BOTADMIN_APK_GITHUB_LATEST =
  "https://api.github.com/repos/DouglasReisofc/botadmin-apk/releases/latest";

type GithubApkRelease = {
  versionName: string | null;
  versionCode: number;
  minVersionCode: number | null;
  url: string | null;
  assetName: string | null;
  sizeBytes: number;
  updatedAt: string | null;
  releaseNotes: string | null;
};

type AndroidUpdateSource = {
  versionName: string | null;
  versionCode: number;
  minVersionCode: number | null;
  url: string | null;
  assetName: string | null;
  sizeBytes: number;
  updatedAt: string | null;
  releaseNotes: string | null;
  fromGithub: boolean;
};

async function readManifest(): Promise<MobileArtifactsPayload> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw) as MobileArtifactsPayload;
  } catch (_error) {
    return {} as MobileArtifactsPayload;
  }
}

function readReleaseString(body: string, keys: string[]): string | null {
  for (const key of keys) {
    const match = body.match(new RegExp(`^\\s*${key}\\s*[:=]\\s*(.+?)\\s*$`, "im"));
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return null;
}

function readReleaseNumber(body: string, keys: string[]): number | null {
  const value = readReleaseString(body, keys);
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readVersionCodeFromText(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match =
    value.match(/(?:versionCode|version_code|code|codigo|c[oó]digo)[\s._-]*(\d+)/i) ??
    value.match(/\+(\d+)(?:\D|$)/);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanReleaseNotes(body: string): string | null {
  const clean = body
    .split(/\r?\n/)
    .filter((line) => !/^\s*(versionName|version|versao|versão|versionCode|version_code|codigo|código|minVersionCode|min_version_code|minCode|required|obrigatorio|obrigatório)\s*[:=]/i.test(line))
    .join("\n")
    .trim();
  return clean || null;
}

async function readGithubApkRelease(): Promise<GithubApkRelease | null> {
  try {
    const response = await fetch(BOTADMIN_APK_GITHUB_LATEST, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "BotAdminMobileUpdate/1.0",
      },
    });
    if (!response.ok) return null;
    const release = await response.json();
    if (release?.draft || release?.prerelease) return null;
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const apkAsset = assets
      .filter((asset: any) => typeof asset?.name === "string" && asset.name.toLowerCase().endsWith(".apk"))
      .sort((a: any, b: any) => {
        const aBotAdmin = String(a?.name ?? "").toLowerCase().includes("botadmin") ? 1 : 0;
        const bBotAdmin = String(b?.name ?? "").toLowerCase().includes("botadmin") ? 1 : 0;
        return bBotAdmin - aBotAdmin || Number(b?.size ?? 0) - Number(a?.size ?? 0);
      })[0];
    if (!apkAsset?.browser_download_url) return null;

    const body = typeof release?.body === "string" ? release.body : "";
    const versionName =
      readReleaseString(body, ["versionName", "version", "versao", "versão"]) ??
      (typeof release?.tag_name === "string" ? release.tag_name.replace(/^v/i, "").trim() : null);
    const versionCode =
      readReleaseNumber(body, ["versionCode", "version_code", "codigo", "código"]) ??
      readVersionCodeFromText(apkAsset.name) ??
      readVersionCodeFromText(release?.tag_name) ??
      0;
    const minVersionCode =
      readReleaseNumber(body, ["minVersionCode", "min_version_code", "minCode"]) ??
      (versionCode > 0 ? versionCode : null);

    return {
      versionName,
      versionCode,
      minVersionCode,
      url: apkAsset.browser_download_url,
      assetName: apkAsset.name ?? null,
      sizeBytes: Number(apkAsset.size ?? 0),
      updatedAt: apkAsset.updated_at ?? release?.published_at ?? release?.created_at ?? null,
      releaseNotes: cleanReleaseNotes(body) ?? (typeof release?.name === "string" ? release.name : null),
    };
  } catch (error) {
    console.error("[mobile-update] failed to load GitHub release", error);
    return null;
  }
}

function chooseAndroidUpdateSource(
  manifest: MobileArtifactsPayload,
  mobile: Awaited<ReturnType<typeof getAdminMobileSettings>>,
  github: GithubApkRelease | null,
): AndroidUpdateSource {
  const artifact = manifest.android || null;
  const artifactSource: AndroidUpdateSource | null = artifact
    ? {
        versionName: artifact.versionName ?? mobile.versionName ?? null,
        versionCode: artifact.versionCode ?? 0,
        minVersionCode:
          artifact.minVersionCode ?? mobile.minVersionCode ?? null,
        url: artifact.url ?? null,
        assetName: artifact.fileName ?? null,
        sizeBytes: artifact.sizeBytes ?? 0,
        updatedAt: artifact.updatedAt ?? mobile.updatedAt ?? null,
        releaseNotes:
          artifact.notes ??
          artifact.details ??
          manifest.details ??
          mobile.releaseNotes ??
          null,
        fromGithub: false,
      }
    : null;

  const githubSource: AndroidUpdateSource | null = github
    ? {
        ...github,
        fromGithub: true,
      }
    : null;

  if (githubSource && artifactSource) {
    return githubSource.versionCode >= artifactSource.versionCode
      ? githubSource
      : artifactSource;
  }

  return githubSource ?? artifactSource ?? {
    versionName: mobile.versionName ?? null,
    versionCode: mobile.versionCode ?? 0,
    minVersionCode: mobile.minVersionCode ?? null,
    url: null,
    assetName: null,
    sizeBytes: 0,
    updatedAt: mobile.updatedAt ?? null,
    releaseNotes: mobile.releaseNotes ?? null,
    fromGithub: false,
  };
}

function readPositiveInt(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const currentVersionCode = readPositiveInt(
      url.searchParams.get("currentVersionCode") ??
        url.searchParams.get("versionCode") ??
        url.searchParams.get("buildNumber"),
    );
    const [mobile, manifest, github] = await Promise.all([
      getAdminMobileSettings(),
      readManifest(),
      readGithubApkRelease(),
    ]);

    const selected = chooseAndroidUpdateSource(manifest, mobile, github);
    const minCode = selected.minVersionCode ?? mobile.minVersionCode ?? null;
    const updateAvailable =
      selected.versionCode > 0 &&
      (currentVersionCode > 0 ? selected.versionCode > currentVersionCode : true);
    const required =
      updateAvailable &&
      (currentVersionCode > 0
        ? typeof minCode === "number" && minCode > currentVersionCode
        : selected.fromGithub || (typeof minCode === "number" && minCode > 0));
    const selectedUrl = selected.url
      ? selected.fromGithub
        ? new URL(selected.url, getPublicAppBaseUrl()).toString()
        : new URL('/api/mobile/download/android', getPublicAppBaseUrl()).toString()
      : null;

    return NextResponse.json({
      android: {
        latest: {
          versionName: selected.versionName,
          versionCode: selected.versionCode,
          url: selectedUrl,
          downloadUrl: selectedUrl,
          sizeBytes: selected.sizeBytes,
          updatedAt: selected.updatedAt,
          assetName: selected.assetName,
        },
        preferredMode: selected.url ? "file" : manifest.preferredAndroidMode || (manifest.androidStoreUrl ? "store" : "file"),
        storeUrl: selected.url ? null : manifest.androidStoreUrl || null,
        currentVersionCode,
        updateAvailable,
        minVersionCode: minCode,
        required,
        releaseNotes: selected.releaseNotes,
      },
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    console.error('[mobile-update] failed to load policy', error);
    return NextResponse.json({ message: 'Falha ao ler política de atualização.' }, { status: 500 });
  }
}
