import { constants, readFileSync } from "fs";
import { access, mkdir, readFile, writeFile, copyFile, readdir } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

const DIST_DIR = path.join(process.cwd(), "dist/mobile");
const INDEX_FILE = path.join(DIST_DIR, "index.html");
const RESOURCES_DIR = path.join(process.cwd(), "resources");
const RES_LOGO_SRC = path.join(RESOURCES_DIR, "logo_src");

const TEMPLATE_PATH = path.join(process.cwd(), "public/mobile-placeholder.html");
const ANDROID_GOOGLE_SERVICES_SOURCE = path.join(
  process.cwd(),
  "data/firebase/google-services.json",
);
const ANDROID_GOOGLE_SERVICES_TARGET = path.join(
  process.cwd(),
  "android/app/google-services.json",
);
const SOUND_SOURCE_DIR = path.join(process.cwd(), "public/sounds");
const ANDROID_SOUND_TARGET_DIR = path.join(
  process.cwd(),
  "android/app/src/main/res/raw",
);

const SOUND_EXTENSIONS = new Set([".mp3", ".ogg", ".m4a", ".wav"]);

const SOUND_ALIASES: Record<string, string> = {
  storebot_push_sound: "general-notification",
};

const sanitizeResourceName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

type CopiedSound = {
  source: string;
  ext: string;
};

async function runCommand(cmd: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`))));
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fetchAndGenerateIcons(serverUrl?: string): Promise<void> {
  try {
    if (!serverUrl) return;
    const base = serverUrl.replace(/\/$/, "");
    // 1) Try direct stable file under uploads (preferred)
    let didDownload = false;
    try {
      const url = `${base}/uploads/admin/mobile/app-icon.png`;
      const r = await fetch(url, { headers: { Accept: "image/*" } });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        await mkdir(RESOURCES_DIR, { recursive: true });
        await writeFile(RES_LOGO_SRC, buf);
        didDownload = true;
      }
    } catch {}

    // 1b) If base is not available or failed, try hardcoded absolute URL as last-resort
    if (!didDownload) {
      try {
        const direct = "https://botadmin.shop/uploads/admin/mobile/app-icon.png";
        const r = await fetch(direct, { headers: { Accept: "image/*" } });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          await mkdir(RESOURCES_DIR, { recursive: true });
          await writeFile(RES_LOGO_SRC, buf);
          didDownload = true;
        }
      } catch {}
    }

    // 2) Fallback: fetch site settings and download mobileAppIconUrl or logoUrl
    if (!didDownload) {
      try {
        const settingsUrl = `${base}/api/public/site`;
        const rs = await fetch(settingsUrl, { headers: { Accept: "application/json" } });
        if (rs.ok) {
          const json: any = await rs.json();
          const candidate: string | undefined =
            (json?.settings?.mobileAppIconUrl as string | undefined) ||
            (json?.settings?.logoUrl as string | undefined);
          if (candidate && /^https?:\/\//i.test(candidate)) {
            const ri = await fetch(candidate);
            if (ri.ok) {
              const buf = Buffer.from(await ri.arrayBuffer());
              await mkdir(RESOURCES_DIR, { recursive: true });
              await writeFile(RES_LOGO_SRC, buf);
              didDownload = true;
            }
          }
        }
      } catch {}
    }

    if (!didDownload) return;

    // Generate resources/icon.png from resources/logo_src
    const generator = path.join(process.cwd(), "scripts/ci-generate-icon.js");
    if (await fileExists(generator)) {
      await runCommand(process.platform === "win32" ? "node.exe" : "node", [generator], { cwd: process.cwd() });
    }

    // Generate adaptive icons for Android
    const bin = process.platform === "win32" ? "npx.cmd" : "npx";
    await runCommand(bin, ["--yes", "@capacitor/assets", "generate", "--android"], { cwd: process.cwd() });
    // Remove duplicate splash resource if both splash.xml and splash.png were generated in the same folder
    const drawableDir = path.join(process.cwd(), "android/app/src/main/res/drawable");
    try {
      const splashXml = path.join(drawableDir, "splash.xml");
      const splashPng = path.join(drawableDir, "splash.png");
      if (await fileExists(splashXml) && await fileExists(splashPng)) {
        await (await import("fs/promises")).rm(splashPng, { force: true });
      }
    } catch {}
    console.log("[mobile-prepare] Ícone atualizado a partir do painel e assets Android gerados.");
  } catch (error) {
    console.warn("[mobile-prepare] Falha ao atualizar ícone remoto.");
    if (error instanceof Error) console.warn(error.message);
  }
}

async function syncAndroidNotificationSounds(): Promise<void> {
  try {
    await access(SOUND_SOURCE_DIR, constants.F_OK);
  } catch {
    // No custom sounds shipped with the web bundle
    return;
  }

  await mkdir(ANDROID_SOUND_TARGET_DIR, { recursive: true });

  const entries = await readdir(SOUND_SOURCE_DIR, { withFileTypes: true });
  const copied = new Map<string, CopiedSound>();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!SOUND_EXTENSIONS.has(extension)) {
      continue;
    }

    const baseName = path.basename(entry.name, extension);
    const sanitized = sanitizeResourceName(baseName);
    if (!sanitized || copied.has(sanitized)) {
      continue;
    }

    const sourcePath = path.join(SOUND_SOURCE_DIR, entry.name);
    const targetPath = path.join(ANDROID_SOUND_TARGET_DIR, `${sanitized}${extension}`);

    try {
      await copyFile(sourcePath, targetPath);
      copied.set(sanitized, { source: sourcePath, ext: extension });
    } catch (error) {
      console.warn(
        `[mobile-prepare] Falha ao copiar som ${entry.name} para recursos Android:`,
        error,
      );
    }
  }

  for (const [alias, original] of Object.entries(SOUND_ALIASES)) {
    const normalizedOriginal = sanitizeResourceName(original);
    if (!normalizedOriginal) {
      continue;
    }

    const metadata = copied.get(normalizedOriginal);
    if (!metadata) {
      continue;
    }

    const targetPath = path.join(ANDROID_SOUND_TARGET_DIR, `${alias}${metadata.ext}`);

    try {
      await copyFile(metadata.source, targetPath);
    } catch (error) {
      console.warn(
        `[mobile-prepare] Falha ao criar alias de som ${alias} (${original}):`,
        error,
      );
    }
  }
}

async function loadTemplate(): Promise<string> {
  try {
    await access(TEMPLATE_PATH, constants.F_OK);
    return await readFile(TEMPLATE_PATH, "utf8");
  } catch (error) {
    return "";
  }
}

function buildHtmlTemplate(remoteUrl: string | undefined, fallbackTemplate: string): string {
  if (fallbackTemplate.trim()) {
    return fallbackTemplate;
  }

  const safeUrl = remoteUrl?.trim();

  if (!safeUrl) {
    return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>StoreBot Dashboard</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 2rem; background: #f8f9fa; color: #212529; }
      main { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 2rem; box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.1); }
      h1 { font-size: 1.5rem; margin-bottom: 1rem; }
      p { line-height: 1.5; }
      code { background: #f1f3f5; padding: 0.25rem 0.5rem; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Configuração pendente</h1>
      <p>
        Defina a variável <code>NEXT_PUBLIC_CAP_SERVER_URL</code> para apontar o endereço
        público do dashboard antes de gerar o aplicativo.
      </p>
      <p>
        Isso permite que o Capacitor carregue automaticamente a versão web mais recente no
        aplicativo nativo.
      </p>
    </main>
  </body>
</html>`;
  }

  const htmlSafeUrl = safeUrl
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>StoreBot Dashboard</title>
    <meta http-equiv="refresh" content="0;url=${htmlSafeUrl}" />
  </head>
  <body>
    <script>
      const target = ${JSON.stringify(safeUrl)};
      if (typeof window !== "undefined") {
        window.location.replace(target);
      }
    </script>
    <p style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; margin-top: 2rem; color: #495057;">
      Redirecionando para ${htmlSafeUrl}...
    </p>
  </body>
</html>`;
}

export async function ensureMobileAssets(): Promise<void> {
  // Load .env from project root so this script picks up variables when run via npm scripts
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx <= 0) continue;
      const k = t.slice(0, idx).trim();
      const v = t.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n");
      if (process.env[k] == null) process.env[k] = v;
    }
  } catch {
    // .env not present or unreadable; ignore
  }

  await mkdir(DIST_DIR, { recursive: true });

  const template = await loadTemplate();
  const serverUrl =
    process.env.NEXT_PUBLIC_CAP_SERVER_URL?.trim() || process.env.APP_URL?.trim() || undefined;
  const html = buildHtmlTemplate(serverUrl, template);

  await writeFile(INDEX_FILE, html, "utf8");

  // Try to fetch current app icon from admin panel and generate adaptive icons
  await fetchAndGenerateIcons(serverUrl).catch((error) => {
    console.warn("[mobile-prepare] Ícone remoto não pôde ser aplicado:", error instanceof Error ? error.message : String(error));
  });

  // Keep android/app/google-services.json in sync (copy if available in repo data, then patch)
  let hadSource = false;
  try {
    await access(ANDROID_GOOGLE_SERVICES_SOURCE, constants.F_OK);
    await copyFile(ANDROID_GOOGLE_SERVICES_SOURCE, ANDROID_GOOGLE_SERVICES_TARGET);
    hadSource = true;
  } catch {
    // no uploaded file in data/
  }

  // Patch package_name on the target when present
  try {
    await access(ANDROID_GOOGLE_SERVICES_TARGET, constants.F_OK);
    const pkg = (process.env.APP_PACKAGE || process.env.APP_ID || "").trim();
    if (pkg) {
      const raw = await readFile(ANDROID_GOOGLE_SERVICES_TARGET, "utf8");
      const json = JSON.parse(raw) as any;
      if (Array.isArray(json.client)) {
        for (const c of json.client) {
          if (c?.client_info?.android_client_info) {
            c.client_info.android_client_info.package_name = pkg;
          }
        }
        await writeFile(ANDROID_GOOGLE_SERVICES_TARGET, JSON.stringify(json, null, 2) + "\n", "utf8");
      }
    }
  } catch {
    // ignore when target does not exist or patch fails
  }

  await syncAndroidNotificationSounds().catch((error) => {
    console.error("[mobile-prepare] Falha ao sincronizar sons de notificação:", error);
  });
}

if (process.argv[1]?.endsWith("mobile-prepare.ts")) {
  ensureMobileAssets().catch((error) => {
    console.error("Falha ao preparar assets móveis:", error);
    process.exit(1);
  });
}
