import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

import type { MobileArtifactsPayload } from "types/mobile-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOTADMIN_APK_GITHUB_LATEST =
  "https://api.github.com/repos/DouglasReisofc/botadmin-apk/releases/latest";

const manifestPath = path.join(process.cwd(), "data/mobile-artifacts.json");

async function readLocalAndroidUrl(): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, "utf8"),
    ) as MobileArtifactsPayload;
    const url = manifest.android?.url?.trim();
    if (!url || url === "/api/mobile/download/android") return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const response = await fetch(BOTADMIN_APK_GITHUB_LATEST, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "BotAdminWebDownload/1.0",
      },
    });
    if (!response.ok) {
      const localUrl = await readLocalAndroidUrl();
      if (localUrl) {
        const redirect = NextResponse.redirect(new URL(localUrl, request.url), 302);
        redirect.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        redirect.headers.set("Pragma", "no-cache");
        redirect.headers.set("X-BotAdmin-Mobile-Source", "botadmin-artifact");
        return redirect;
      }
      return NextResponse.json({ message: "Release do APK indisponível." }, { status: 502 });
    }

    const release = await response.json();
    const asset = Array.isArray(release?.assets)
      ? release.assets
          .filter(
            (candidate: any) =>
              typeof candidate?.name === "string" &&
              candidate.name.toLowerCase().endsWith(".apk") &&
              typeof candidate?.browser_download_url === "string",
          )
          .sort((left: any, right: any) => {
            const leftBotAdmin = String(left.name).toLowerCase().includes("botadmin") ? 1 : 0;
            const rightBotAdmin = String(right.name).toLowerCase().includes("botadmin") ? 1 : 0;
            return rightBotAdmin - leftBotAdmin || Number(right.size ?? 0) - Number(left.size ?? 0);
          })[0]
      : null;

    if (!asset?.browser_download_url) {
      return NextResponse.json({ message: "APK não encontrado na release." }, { status: 404 });
    }

    const redirect = NextResponse.redirect(new URL(asset.browser_download_url), 302);
    redirect.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    redirect.headers.set("Pragma", "no-cache");
    redirect.headers.set("X-BotAdmin-Mobile-Source", "github-release");
    redirect.headers.set("X-BotAdmin-Mobile-Asset", String(asset.name));
    return redirect;
  } catch (error) {
    console.error("[mobile-download] failed to resolve GitHub APK", error);
    return NextResponse.json({ message: "Falha ao localizar a release do APK." }, { status: 502 });
  }
}
