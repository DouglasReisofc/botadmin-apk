import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { saveUploadedFile, resolveUploadedFileUrl } from "lib/uploads";
import type { MobileArtifactsPayload, MobileArtifact } from "../../../../types/mobile-artifacts";
import { getAdminMobileSettings } from "lib/admin-mobile";

const manifestPath = path.join(process.cwd(), "data/mobile-artifacts.json");

async function readManifest(): Promise<MobileArtifactsPayload> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw) as MobileArtifactsPayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeManifest(payload: MobileArtifactsPayload): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }
    const manifest = await readManifest();
    return NextResponse.json(manifest);
  } catch (error) {
    console.error("[admin-mobile-artifacts] GET failed", error);
    return NextResponse.json({ message: "Falha ao carregar artefatos." }, { status: 500 });
  }
}

const sanitizeUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const u = new URL(trimmed);
    if (!/^https?:$/i.test(u.protocol)) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
};

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const form = await request.formData();
    const manifest = await readManifest();

    // Details text
    const details = (form.get("details") as string | null)?.toString().trim() || undefined;
    if (details !== undefined) {
      manifest.details = details || undefined;
    }

    // Helper to build artifact from uploaded file
  const buildArtifact = async (platform: MobileArtifact["platform"], file: File, fixedBaseName: string): Promise<MobileArtifact> => {
      const original = file.name || fixedBaseName;
      const ext = path.extname(original).toLowerCase() || (platform === "android" ? ".apk" : platform === "ios" ? ".ipa" : ".exe");
      const fixedName = `${fixedBaseName}${ext}`;
      const stored = await saveUploadedFile(file, "admin/mobile", { convertToWebp: false, fixedFileName: fixedName });
      const sizeBytes = file.size;
      const updatedAt = new Date().toISOString();
      const type = (ext.replace(/^\./, "") as MobileArtifact["type"]) || (platform === "android" ? "apk" : platform === "ios" ? "ipa" : "exe");
      const mobile = await getAdminMobileSettings().catch(() => null);
      // saveUploadedFile returns like 'uploads/admin/mobile/<file>'
      // but we need a URL path
      return {
        platform,
        type,
        fileName: fixedName,
        url: resolveUploadedFileUrl(stored),
        sizeBytes,
        updatedAt,
        buildType: "release",
        versionName: mobile?.versionName,
        versionCode: mobile?.versionCode,
      };
    };

    // Android
    const androidMode = (form.get("androidMode") as string | null)?.toLowerCase();
    if (androidMode === "store" || androidMode === "file") {
      manifest.preferredAndroidMode = androidMode as MobileArtifactsPayload["preferredAndroidMode"];
    }
    const androidStoreUrl = sanitizeUrl(form.get("androidStoreUrl"));
    if (androidStoreUrl !== undefined) {
      manifest.androidStoreUrl = androidStoreUrl || undefined;
    }
    const removeAndroidFile = String(form.get("removeAndroidFile") || "").toLowerCase() === "true";
    const androidFile = form.get("androidFile");
    if (androidFile instanceof File && androidFile.size > 0) {
      manifest.android = await buildArtifact("android", androidFile, "android-app");
    } else if (removeAndroidFile) {
      manifest.android = undefined;
    }

    // iOS
    const iosMode = (form.get("iosMode") as string | null)?.toLowerCase();
    if (iosMode === "store" || iosMode === "file") {
      manifest.preferredIosMode = iosMode as MobileArtifactsPayload["preferredIosMode"];
    }
    const iosStoreUrl = sanitizeUrl(form.get("iosStoreUrl"));
    if (iosStoreUrl !== undefined) {
      manifest.iosStoreUrl = iosStoreUrl || undefined;
    }
    const removeIosFile = String(form.get("removeIosFile") || "").toLowerCase() === "true";
    const iosFile = form.get("iosFile");
    if (iosFile instanceof File && iosFile.size > 0) {
      manifest.ios = await buildArtifact("ios", iosFile, "ios-app");
    } else if (removeIosFile) {
      manifest.ios = undefined;
    }

    // Windows
    const windowsMode = (form.get("windowsMode") as string | null)?.toLowerCase();
    if (windowsMode === "store" || windowsMode === "file") {
      manifest.preferredWindowsMode = windowsMode as MobileArtifactsPayload["preferredWindowsMode"];
    }
    const windowsStoreUrl = sanitizeUrl(form.get("windowsStoreUrl"));
    if (windowsStoreUrl !== undefined) {
      manifest.windowsStoreUrl = windowsStoreUrl || undefined;
    }
    const removeWindowsFile = String(form.get("removeWindowsFile") || "").toLowerCase() === "true";
    const windowsFile = form.get("windowsFile");
    if (windowsFile instanceof File && windowsFile.size > 0) {
      // keep original extension (exe/msi/zip)
      const original = windowsFile.name || "windows-app.exe";
      const ext = path.extname(original).toLowerCase() || ".exe";
      const base = "windows-app";
      const fixedName = `${base}${ext}`;
      const stored = await saveUploadedFile(windowsFile, "admin/mobile", { convertToWebp: false, fixedFileName: fixedName });
      manifest.windows = {
        platform: "windows",
        type: (ext.replace(/^\./, "") as MobileArtifact["type"]) || "exe",
        fileName: fixedName,
        url: resolveUploadedFileUrl(stored),
        sizeBytes: windowsFile.size,
        updatedAt: new Date().toISOString(),
        buildType: "release",
      };
    } else if (removeWindowsFile) {
      manifest.windows = undefined;
    }

    await writeManifest(manifest);
    return NextResponse.json({ message: "Distribuição do app atualizada.", manifest });
  } catch (error) {
    console.error("[admin-mobile-artifacts] PUT failed", error);
    return NextResponse.json({ message: "Não foi possível salvar as opções de download." }, { status: 500 });
  }
}
