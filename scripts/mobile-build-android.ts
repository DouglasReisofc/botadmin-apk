import { spawn } from "child_process";
import { constants, createWriteStream } from "fs";
import { access, appendFile, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

import { ensureMobileAssets } from "./mobile-prepare";
import type { MobileArtifactsPayload } from "../types/mobile-artifacts";
import { getAdminMobileSettings } from "../lib/admin-mobile";
import { getAdminFirebaseSettings } from "../lib/admin-firebase";
import { getAndroidKeystoreForCi } from "../lib/mobile-signing";

const manifestPath = path.join(process.cwd(), "data/mobile-artifacts.json");
const shouldBuildBundle =
  process.argv.includes("--bundle") || process.env.MOBILE_BUILD_INCLUDE_BUNDLE === "1";
const useDockerForGradle =
  process.env.MOBILE_BUILD_DOCKER === "1" ||
  (process.platform === "linux" && process.arch !== "x64");
const jobId = (process.env.MOBILE_BUILD_JOB_ID || "").trim();
const containerNameFor = (task: string) => {
  const id = jobId && /^[a-zA-Z0-9-]+$/.test(jobId) ? jobId : "adhoc";
  return `mobile-build-${id}-${task}`;
};

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

async function readFileIfExists(filePath: string): Promise<Buffer | null> {
  try {
    const data = await readFile(filePath);
    return data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

async function readManifest(manifestPath: string): Promise<MobileArtifactsPayload> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw) as MobileArtifactsPayload;
  } catch (error) {
    return {};
  }
}

async function writeManifest(
  manifestPath: string,
  manifest: MobileArtifactsPayload
): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

type AndroidArtifactKind = "apk" | "aab";

async function updateManifestWithAndroidArtifact(options: {
  kind: AndroidArtifactKind;
  artifactPath: string;
  publicUrl: string;
  versionName?: string | null;
  versionCode?: number | null;
}): Promise<void> {
  const stats = await stat(options.artifactPath);
  const manifest = await readManifest(manifestPath);

  const entry = {
    platform: "android" as const,
    type: options.kind,
    fileName: path.basename(options.artifactPath),
    url: options.publicUrl,
    sizeBytes: stats.size,
    updatedAt: new Date().toISOString(),
    buildType: "release" as const,
    versionName: options.versionName ?? undefined,
    versionCode: options.versionCode ?? undefined,
  };

  if (options.kind === "apk") {
    manifest.android = entry;
  } else {
    manifest.androidBundle = entry;
  }

  await writeManifest(manifestPath, manifest);
}

async function copyApkToPublic(apkSource: string): Promise<string> {
  const downloadsDir = path.join(process.cwd(), "public/downloads/android");
  await mkdir(downloadsDir, { recursive: true });

  const targetPath = path.join(downloadsDir, "app-release.apk");
  await copyFile(apkSource, targetPath);

  return targetPath;
}

async function copyAabToPublic(bundleSource: string): Promise<string> {
  const downloadsDir = path.join(process.cwd(), "public/downloads/android");
  await mkdir(downloadsDir, { recursive: true });

  const targetPath = path.join(downloadsDir, "app-release.aab");
  await copyFile(bundleSource, targetPath);

  return targetPath;
}

const toPosixPath = (input: string): string =>
  input.split(path.sep).join(path.posix.sep);

const mapPathToWorkspace = (target: string): string => {
  const root = process.cwd();
  if (!target.startsWith(root)) {
    return target;
  }
  const relative = path.relative(root, target);
  return path.posix.join("/workspace", toPosixPath(relative));
};

async function runGradleTask(
  androidDir: string,
  task: "assembleRelease" | "bundleRelease",
  javaEnv?: NodeJS.ProcessEnv,
): Promise<void> {
  const cacheBase = path.join(process.cwd(), ".gradle-cache");
  const cacheSuffix = jobId || "adhoc";
  const gradleUserHomeHost = path.join(cacheBase, `user-${cacheSuffix}`);
  const gradleProjectCacheHost = path.join(cacheBase, `project-${cacheSuffix}`);
  await mkdir(gradleUserHomeHost, { recursive: true }).catch(() => {});
  await mkdir(gradleProjectCacheHost, { recursive: true }).catch(() => {});
  await rm(path.join(gradleProjectCacheHost, "fileHashes"), { recursive: true, force: true }).catch(() => {});

  const projectCacheDirArg = useDockerForGradle
    ? mapPathToWorkspace(gradleProjectCacheHost)
    : gradleProjectCacheHost;

  const gradleArgs = [
    "--console=plain",
    "--stacktrace",
    "--warning-mode",
    "all",
    "--no-parallel",
    "--max-workers=1",
    "--project-cache-dir",
    projectCacheDirArg,
    task,
  ];

  if (!useDockerForGradle) {
    const gradleExecutable =
      process.platform === "win32"
        ? path.join(androidDir, "gradlew.bat")
        : path.join(androidDir, "gradlew");
    await runCommand(gradleExecutable, ["--no-daemon", ...gradleArgs], {
      cwd: androidDir,
      env: {
        ...process.env,
        ...javaEnv,
        GRADLE_USER_HOME: gradleUserHomeHost,
        GRADLE_OPTS: "-Xmx768m -Dfile.encoding=UTF-8",
        JAVA_TOOL_OPTIONS: "-Xmx768m -XX:MaxMetaspaceSize=192m",
        MOBILE_SKIP_GRADLE_PREPARE: "1",
      },
    });
    return;
  }

  console.log("[mobile] Executando Gradle dentro de Docker (linux/amd64)...");

  // Pre-flight: garantir suporte a emulação amd64 (binfmt/qemu) e a imagem disponível
  const ensureDockerAmd64Support = async () => {
    try {
      await runCommand(
        "docker",
        [
          "run",
          "--rm",
          "--platform",
          "linux/amd64",
          "alpine:3.20",
          "uname",
          "-m",
        ],
      );
    } catch (error) {
      console.warn("[mobile] Suporte a linux/amd64 ausente. Instalando binfmt via tonistiigi/binfmt...");
      try {
        await runCommand(
          "docker",
          [
            "run",
            "--rm",
            "--privileged",
            "tonistiigi/binfmt",
            "--install",
            "all",
          ],
        );
        // Revalidar
        await runCommand(
          "docker",
          [
            "run",
            "--rm",
            "--platform",
            "linux/amd64",
            "alpine:3.20",
            "uname",
            "-m",
          ],
        );
      } catch (e) {
        throw new Error(
          "[mobile] Não foi possível habilitar suporte a linux/amd64 (binfmt). Verifique permissões do Docker (necessita --privileged).",
        );
      }
    }
  };

  const dockerPullImage = async (image: string) => {
    try {
      await runCommand("docker", ["pull", "--platform", "linux/amd64", image]);
    } catch {
      // 'docker run' fará o pull on-demand. Apenas logar aviso.
      console.warn(`[mobile] Aviso: falha ao executar docker pull para ${image}. Prosseguindo.`);
    }
  };

  const dockerImage = process.env.MOBILE_BUILD_DOCKER_IMAGE || "ghcr.io/cirruslabs/android-sdk:35";
  const workspaceDir = process.cwd();
  const envPairs: string[] = [];
  const containerName = containerNameFor(task);
  const gradleUserHomeContainer = mapPathToWorkspace(gradleUserHomeHost);
  const gradleProjectCacheContainer = mapPathToWorkspace(gradleProjectCacheHost);

  const keystorePath = process.env.ANDROID_KEYSTORE;
  if (keystorePath) {
    envPairs.push("-e", `ANDROID_KEYSTORE=${mapPathToWorkspace(keystorePath)}`);
  }
  const signingEnvKeys = [
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_ALIAS_PASSWORD",
  ];
  for (const key of signingEnvKeys) {
    const value = process.env[key];
    if (value && value.trim()) {
      envPairs.push("-e", `${key}=${value}`);
    }
  }
  envPairs.push("-e", `GRADLE_USER_HOME=${gradleUserHomeContainer}`);
  envPairs.push("-e", `GRADLE_PROJECT_CACHE_DIR=${gradleProjectCacheContainer}`);
  envPairs.push("-e", "GRADLE_OPTS=-Xmx768m -Dfile.encoding=UTF-8");
  envPairs.push("-e", "JAVA_TOOL_OPTIONS=-Xmx768m -XX:MaxMetaspaceSize=192m");
  envPairs.push("-e", "MOBILE_SKIP_GRADLE_PREPARE=1");

  // Executa preflight checks
  await ensureDockerAmd64Support();
  await dockerPullImage(dockerImage);

  // Remove contêiner com o mesmo nome se sobrou de execução anterior
  try {
    await runCommand("docker", ["rm", "-f", containerName]);
  } catch {
    // ignore
  }

  const dockerArgs = [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--name",
    containerName,
    "-v",
    `${workspaceDir}:/workspace`,
    "-w",
    "/workspace/android",
    ...envPairs,
    dockerImage,
    "bash",
    "-lc",
    `rm -f /workspace/android/.gradle/8.*/fileHashes/fileHashes.lock || true; \
     rm -f "${gradleProjectCacheContainer}/fileHashes/fileHashes.lock" || true; \
     ./gradlew --no-daemon ${gradleArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`,
  ];

  const tryRun = async (attempt: number) => {
    try {
      await runCommand("docker", dockerArgs, { cwd: workspaceDir });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const conflict = /already in use by container/i.test(msg) || /exited with code 125/.test(msg);
      if (attempt === 0 && conflict) {
        // Limpa contêiner e tenta novamente uma vez
        try { await runCommand("docker", ["rm", "-f", containerName]); } catch {}
        await runCommand("docker", dockerArgs, { cwd: workspaceDir });
        return;
      }
      throw e;
    }
  };

  await tryRun(0);
}

// --- Helpers to load settings/keystore from API when DB/local storage are not accessible ---
function tryUnquote(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadDotEnvIfPresent(): Promise<void> {
  try {
    const envPath = path.join(process.cwd(), ".env");
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = tryUnquote(trimmed.slice(idx + 1));
      if (process.env[key] == null) {
        // rudimentary unescape for embedded \n in quoted values
        process.env[key] = val.replace(/\\n/g, "\n");
      }
    }
  } catch {
    // ignore when .env is not present
  }
}

const normalizeBaseUrl = (raw?: string | null) => {
  const v = raw?.trim();
  if (!v) return undefined;
  return v.endsWith("/") ? v.slice(0, -1) : v;
};

const escapeGithubEnvValue = (value: string) => value.replace(/\r/g, "").replace(/\n/g, "\\n");

async function exportToGithubEnv(vars: Record<string, string | undefined>): Promise<void> {
  const file = process.env.GITHUB_ENV;
  if (!file) {
    console.warn("[mobile] GITHUB_ENV não está definido; variáveis serão expostas via arquivo auxiliar.");
    return;
  }
  const entries = Object.entries(vars).filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0,
  );
  if (!entries.length) {
    return;
  }
  console.log(`[mobile] Exportando ${entries.length} variáveis para ${file}`);
  const payload = entries.map(([key, value]) => `${key}=${escapeGithubEnvValue(value!.trim())}`).join("\n");
  await appendFile(file, `${payload}\n`);
}

const resolveEnvValue = (...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const DEFAULT_KEYSTORE_CANDIDATES = [
  "botadmin-release.jks",
  "botadmin-release.keystore",
  "android/app/release.keystore",
];

async function loadLocalKeystoreFromWorkspace(): Promise<{
  base64: string;
  keyAlias: string;
  keyPassword: string;
  storePassword: string;
  updatedAt: string | null;
} | null> {
  const candidateSet = new Set<string>();
  const configured = resolveEnvValue("CI_ANDROID_KEYSTORE_FILE", "ANDROID_KEYSTORE_FILE");
  if (configured) {
    candidateSet.add(configured);
  }
  for (const candidate of DEFAULT_KEYSTORE_CANDIDATES) {
    candidateSet.add(candidate);
  }

  const keyAlias = resolveEnvValue("CI_ANDROID_KEY_ALIAS", "ANDROID_KEY_ALIAS");
  const keyPassword = resolveEnvValue("CI_ANDROID_KEY_ALIAS_PASSWORD", "ANDROID_KEY_ALIAS_PASSWORD", "ANDROID_KEY_PASSWORD");
  const storePassword = resolveEnvValue("CI_ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEYSTORE_PASSWORD");

  for (const relativePath of candidateSet) {
    const absolutePath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(process.cwd(), relativePath);
    if (!(await fileExists(absolutePath))) {
      continue;
    }
    if (!keyAlias || !keyPassword || !storePassword) {
      console.warn("[mobile] Keystore local encontrado, mas alias ou senhas n�o foram definidos nas vari�veis de ambiente.");
      return null;
    }
    const bytes = await readFile(absolutePath);
    console.log(`[mobile] Utilizando keystore local encontrado em ${absolutePath}`);
    return {
      base64: bytes.toString("base64"),
      keyAlias,
      keyPassword,
      storePassword,
      updatedAt: null,
    };
  }

  return null;
}

async function fetchInternalJson<T>(endpoint: string): Promise<T> {
  const token = process.env.MOBILE_CI_TOKEN?.trim();
  const base = normalizeBaseUrl(process.env.APP_URL) || normalizeBaseUrl(process.env.NEXT_PUBLIC_CAP_SERVER_URL);
  if (!token || !base) {
    throw new Error("Internal API base/token not configured");
  }
  const url = `${base}${endpoint}`;
  const r = await fetch(url, { headers: { "x-internal-token": token, Accept: "application/json" } });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} ${r.statusText}`);
  }
  return (await r.json()) as T;
}

async function syncAdminSettingsWithEnv(): Promise<void> {
  try {
    // Prefer HTTP (server) when available to avoid local DB connectivity issues
    let settings: {
      appName: string;
      packageName: string;
      versionCode: number;
      versionName: string;
      serverUrl: string | null;
    };

    try {
      settings = await fetchInternalJson("/api/internal/mobile/settings");
    } catch {
      // Fallback to direct DB (local environment)
      settings = await getAdminMobileSettings();
    }
    const sanitize = (value: string | null | undefined) => value?.trim() || undefined;
    const appName = sanitize(settings.appName);
    const packageName = sanitize(settings.packageName) ?? "com.botadmin.shop";
    const requestedVersionName = sanitize(process.env.MOBILE_BUILD_VERSION_NAME);
    const requestedVersionCode = Number.parseInt(process.env.MOBILE_BUILD_VERSION_CODE ?? "", 10);
    const versionName = requestedVersionName ?? sanitize(settings.versionName) ?? "1.0";
    const versionCode = Number.isFinite(requestedVersionCode) && requestedVersionCode > 0
      ? requestedVersionCode
      : Number.isFinite(settings.versionCode) && settings.versionCode > 0
      ? settings.versionCode
      : 1;
    const serverUrl = sanitize(settings.serverUrl);

    if (appName) {
      process.env.APP_NAME = appName;
    }
    process.env.APP_PACKAGE = packageName;
    process.env.APP_ID = packageName;
    process.env.APP_VERSION_NAME = versionName;
    process.env.APP_VERSION_CODE = String(versionCode);

    if (serverUrl) {
      process.env.NEXT_PUBLIC_CAP_SERVER_URL = serverUrl;
    }

    console.log(`[mobile] Configurações carregadas do painel: ${packageName} (${versionName})`);
  } catch (error) {
    console.warn("[mobile] Não foi possível carregar configurações do painel. Prosseguindo com variáveis de ambiente atuais.");
    if (error instanceof Error) {
      console.warn(error.message);
    }
  }
}

const FIREBASE_DATA_DIR = path.join(process.cwd(), "data", "firebase");
const GOOGLE_SERVICES_PATH = path.join(FIREBASE_DATA_DIR, "google-services.json");

type FirebaseBootstrapPayload = {
  googleServicesBase64: string | null;
  web: {
    apiKey: string | null;
    authDomain: string | null;
    projectId: string | null;
    storageBucket: string | null;
    messagingSenderId: string | null;
    appId: string | null;
    measurementId: string | null;
    vapidKey: string | null;
  } | null;
};

async function loadLocalFirebaseSnapshot(): Promise<FirebaseBootstrapPayload | null> {
  try {
    const settings = await getAdminFirebaseSettings().catch(() => null);
    let googleServicesBase64: string | null = null;
    try {
      const raw = await readFile(GOOGLE_SERVICES_PATH);
      if (raw.length > 0) {
        googleServicesBase64 = raw.toString("base64");
      }
    } catch {
      // arquivo ausente é aceitável
    }

    if (!settings && !googleServicesBase64) {
      return null;
    }

    return {
      googleServicesBase64,
      web: settings
        ? {
            apiKey: settings.webApiKey,
            authDomain: settings.webAuthDomain,
            projectId: settings.webProjectId ?? settings.projectId ?? null,
            storageBucket: settings.webStorageBucket,
            messagingSenderId: settings.webMessagingSenderId,
            appId: settings.webAppId,
            measurementId: settings.webMeasurementId,
            vapidKey: settings.vapidKey,
          }
        : null,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.warn("[mobile] Falha ao carregar configurações do Firebase locais.");
      console.warn(error.message);
    }
    return null;
  }
}

async function syncFirebaseSettings(): Promise<void> {
  try {
    let snapshot: FirebaseBootstrapPayload | null = null;

    try {
      snapshot = await fetchInternalJson<FirebaseBootstrapPayload>(
        "/api/internal/firebase/settings",
      );
    } catch (error) {
      console.warn("[mobile] Falha ao carregar Firebase via API interna. Tentando snapshot local...");
      if (error instanceof Error) {
        console.warn(error.message);
      }
      snapshot = await loadLocalFirebaseSnapshot();
    }

    if (!snapshot) {
      console.warn(
        "[mobile] Nenhuma configuração Firebase encontrada. Prosseguindo sem atualizar variáveis de ambiente.",
      );
      return;
    }

    const { web, googleServicesBase64 } = snapshot;

    if (web) {
      const assign = (key: string, value: string | null) => {
        if (value?.trim()) {
          process.env[key] = value.trim();
        }
      };
      assign("NEXT_PUBLIC_FIREBASE_API_KEY", web.apiKey);
      assign("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", web.authDomain);
      assign("NEXT_PUBLIC_FIREBASE_PROJECT_ID", web.projectId);
      assign("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", web.storageBucket);
      assign("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", web.messagingSenderId);
      assign("NEXT_PUBLIC_FIREBASE_APP_ID", web.appId);
      assign("NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID", web.measurementId);
      assign("NEXT_PUBLIC_FIREBASE_VAPID_KEY", web.vapidKey);
    }

    if (googleServicesBase64) {
      const buffer = Buffer.from(googleServicesBase64, "base64");
      try {
        await mkdir(FIREBASE_DATA_DIR, { recursive: true });
        let shouldWrite = true;
        try {
          const current = await readFile(GOOGLE_SERVICES_PATH);
          shouldWrite = !current.equals(buffer);
        } catch {
          // arquivo ainda não existe
        }

        if (shouldWrite) {
          await writeFile(GOOGLE_SERVICES_PATH, buffer);
          console.log(
            `[mobile] google-services.json sincronizado a partir do painel (${buffer.length} bytes).`,
          );
        }
      } catch (error) {
        console.warn("[mobile] Falha ao atualizar google-services.json localmente.");
        if (error instanceof Error) {
          console.warn(error.message);
        }
      }
    }
  } catch (error) {
    console.warn("[mobile] Erro inesperado ao sincronizar configurações do Firebase.");
    if (error instanceof Error) {
      console.warn(error.message);
    }
  }
}

async function ensureAndroidSigningMaterial(): Promise<void> {
  try {
    const hasExplicitSigningEnv =
      !!process.env.ANDROID_KEYSTORE &&
      !!process.env.ANDROID_KEYSTORE_PASSWORD &&
      !!process.env.ANDROID_KEY_ALIAS &&
      !!process.env.ANDROID_KEY_ALIAS_PASSWORD;
    if (hasExplicitSigningEnv) {
      console.log("[mobile] Keystore Android definido por ambiente. Mantendo assinatura explicita.");
      return;
    }

    // Try server-kept keystore via internal API first
    let payload: {
      base64: string;
      keyAlias: string;
      keyPassword: string;
      storePassword: string;
      updatedAt: string | null;
    } | null = null;

    try {
      payload = await fetchInternalJson("/api/internal/mobile/keystore");
    } catch (error) {
      if (error instanceof Error) {
        console.warn("[mobile] Falha ao buscar keystore via API interna:", error.message);
      } else {
        console.warn("[mobile] Falha ao buscar keystore via API interna.");
      }
    }

    if (!payload) {
      try {
        payload = await getAndroidKeystoreForCi();
        if (payload) {
          console.log("[mobile] Keystore carregado do armazenamento seguro local.");
        }
      } catch (error) {
        if (error instanceof Error) {
          console.warn("[mobile] Falha ao acessar keystore do armazenamento seguro local:", error.message);
        }
      }
    }

    if (!payload) {
      payload = await loadLocalKeystoreFromWorkspace();
    }

    if (!payload) {
      console.log("[mobile] Nenhum keystore Android configurado no painel. Build continuar sem assinatura.");
      return;
    }

    const cacheDir = path.join(process.cwd(), ".cache/mobile");
    await mkdir(cacheDir, { recursive: true });
    const keystorePath = path.join(cacheDir, "android-keystore.jks");
    const buffer = Buffer.from(payload.base64, "base64");
    await writeFile(keystorePath, buffer);
    const signingEnvPath = path.join(cacheDir, "android-signing.env");

    process.env.ANDROID_KEYSTORE = keystorePath;
    process.env.ANDROID_KEYSTORE_PASSWORD = payload.storePassword;
    process.env.ANDROID_KEY_ALIAS = payload.keyAlias;
    process.env.ANDROID_KEY_ALIAS_PASSWORD = payload.keyPassword;
    await exportToGithubEnv({
      ANDROID_KEYSTORE: keystorePath,
      ANDROID_KEYSTORE_PASSWORD: payload.storePassword,
      ANDROID_KEY_ALIAS: payload.keyAlias,
      ANDROID_KEY_ALIAS_PASSWORD: payload.keyPassword,
    });
    const envFilePayload = [
      `ANDROID_KEYSTORE=${escapeGithubEnvValue(keystorePath)}`,
      `ANDROID_KEYSTORE_PASSWORD=${escapeGithubEnvValue(payload.storePassword)}`,
      `ANDROID_KEY_ALIAS=${escapeGithubEnvValue(payload.keyAlias)}`,
      `ANDROID_KEY_ALIAS_PASSWORD=${escapeGithubEnvValue(payload.keyPassword)}`,
    ].join("\n");
    await writeFile(signingEnvPath, `${envFilePayload}\n`, "utf8");

    if (payload.updatedAt) {
      console.log(`[mobile] Keystore aplicado (atualizado em ${payload.updatedAt}).`);
    } else {
      console.log(`[mobile] Keystore aplicado (alias ${payload.keyAlias}).`);
    }
  } catch (error) {
    console.warn("[mobile] Falha ao preparar keystore para assinatura automática.");
    if (error instanceof Error) {
      console.warn(error.message);
    }
  }
}

async function prepareBuildEnvironment(): Promise<void> {
  await loadDotEnvIfPresent();
  await syncAdminSettingsWithEnv();
  await syncFirebaseSettings();
  await ensureAndroidSigningMaterial();
}
function resolveCapacitorBinary(): string {
  const binName = process.platform === "win32" ? "cap.cmd" : "cap";
  return path.join(process.cwd(), "node_modules", ".bin", binName);
}

async function ensurePackageInstalled(packageName: string): Promise<void> {
  const packagePath = path.join(process.cwd(), "node_modules", ...packageName.split("/"));

  if (await fileExists(packagePath)) {
    return;
  }

  let spec = packageName;

  try {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const versionRange =
      packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName];

    if (versionRange) {
      spec = `${packageName}@${versionRange}`;
    }
  } catch (error) {
    // Ignora falhas ao ler o package.json e tenta instalar com o nome simples
  }

  console.log(`[mobile] Instalando dependência ausente ${spec}...`);
  await runCommand("npm", ["install", "--no-save", spec], { cwd: process.cwd() });
}

async function runCapacitor(args: string[]): Promise<void> {
  await ensurePackageInstalled("@capacitor/cli");

  const capacitorBin = resolveCapacitorBinary();

  if (await fileExists(capacitorBin)) {
    await runCommand(capacitorBin, args, { cwd: process.cwd() });
    return;
  }

  await runCommand("npx", ["--yes", "@capacitor/cli", ...args], { cwd: process.cwd() });
}

async function syncCapacitorAndroid(): Promise<void> {
  try {
    await runCapacitor(["sync", "android"]);
    return;
  } catch (error) {
    console.warn("[mobile] Falha ao executar 'cap sync android'. Tentando fallback offline...");
    if (error instanceof Error) {
      console.warn(error.message);
    }
  }

  try {
    await runCapacitor(["copy", "android"]);
    console.log("[mobile] Capacitor assets atualizados via 'cap copy android'.");
  } catch (copyError) {
    console.error("[mobile] Fallback 'cap copy android' também falhou.");
    if (copyError instanceof Error) {
      throw copyError;
    }
    throw new Error(String(copyError));
  }
}

async function hydrateAndroidGoogleServices(androidAppDir: string): Promise<void> {
  try {
    const targetPath = path.join(androidAppDir, "google-services.json");
    const candidatePaths = [
      GOOGLE_SERVICES_PATH,
      path.join(process.cwd(), "google-services.json"),
    ];

    let sourcePath: string | null = null;
    let buffer: Buffer | null = null;

    for (const candidate of candidatePaths) {
      const data = await readFileIfExists(candidate);
      if (data) {
        sourcePath = candidate;
        buffer = data;
        break;
      }
    }

    if (!buffer) {
      if (await fileExists(targetPath)) {
        return;
      }
      console.warn("[mobile] google-services.json não encontrado para copiar para android/app.");
      return;
    }

    let updatedBuffer = buffer;
    const packageName = process.env.APP_PACKAGE?.trim() || process.env.APP_ID?.trim();

    if (packageName) {
      try {
        const json = JSON.parse(buffer.toString("utf8")) as {
          client?: Array<{
            client_info?: { android_client_info?: { package_name?: string } };
          }>;
        };

        const clients = Array.isArray(json.client) ? json.client : [];
        const hasMatchingClient = clients.some(
          (client) => client.client_info?.android_client_info?.package_name === packageName,
        );

        if (!hasMatchingClient && clients.length === 1) {
          const androidInfo = clients[0]?.client_info?.android_client_info;
          if (androidInfo) {
            androidInfo.package_name = packageName;
            updatedBuffer = Buffer.from(`${JSON.stringify(json, null, 2)}\n`, "utf8");
            console.log(
              `[mobile] Ajustando package_name do google-services.json para ${packageName}.`,
            );
          }
        }
      } catch (error) {
        console.warn("[mobile] Não foi possível validar o package_name do google-services.json.");
        if (error instanceof Error) {
          console.warn(error.message);
        }
      }
    }

    let shouldWrite = true;
    try {
      const current = await readFile(targetPath);
      shouldWrite = !current.equals(updatedBuffer);
    } catch {
      // Arquivo ainda não existe
    }

    if (!shouldWrite) {
      return;
    }

    await writeFile(targetPath, updatedBuffer);

    if (sourcePath) {
      console.log(
        `[mobile] google-services.json atualizado em android/app a partir de ${path.relative(
          process.cwd(),
          sourcePath,
        )}.`,
      );
    } else {
      console.log("[mobile] google-services.json atualizado em android/app.");
    }
  } catch (error) {
    console.warn("[mobile] Falha ao preparar google-services.json para o projeto Android.");
    if (error instanceof Error) {
      console.warn(error.message);
    }
  }
}

async function removeSplashAssetConflicts(androidDir: string): Promise<void> {
  try {
    const resDir = path.join(androidDir, "app", "src", "main", "res");
    const baseSplash = path.join(resDir, "drawable", "splash.xml");

    if (!(await fileExists(baseSplash))) {
      return;
    }

    const removedPaths: string[] = [];
    const resourceDirs = await readdir(resDir, { withFileTypes: true });

    for (const entry of resourceDirs) {
      if (!entry.isDirectory() || !entry.name.startsWith("drawable")) {
        continue;
      }

      const dirPath = path.join(resDir, entry.name);
      const files = await readdir(dirPath);

      for (const file of files) {
        if (!file.toLowerCase().startsWith("splash.")) {
          continue;
        }

        if (file === "splash.xml") {
          continue;
        }

        const target = path.join(dirPath, file);
        await rm(target, { force: true });
        removedPaths.push(path.relative(androidDir, target));
      }
    }

    if (removedPaths.length > 0) {
      console.log(
        `[mobile] Removendo resources de splash duplicados: ${removedPaths
          .map((p) => p.replace(/\\/g, "/"))
          .join(", ")}`,
      );
    }
  } catch (error) {
    console.warn("[mobile] Falha ao inspecionar e remover resources de splash duplicados.");
    if (error instanceof Error) {
      console.warn(error.message);
    }
  }
}

async function ensureAndroidProject(androidDir: string): Promise<boolean> {
  let androidExists = true;

  try {
    await access(androidDir, constants.F_OK);
  } catch (error) {
    androidExists = false;
  }

  if (!androidExists) {
    console.log("[mobile] Projeto Android não encontrado. Adicionando plataforma automaticamente...");

    try {
      await ensurePackageInstalled("@capacitor/android");
      await runCapacitor(["add", "android"]);
    } catch (error) {
      console.error("[mobile] Falha ao adicionar a plataforma Android via Capacitor.");
      console.error(error);
      return false;
    }
  }

  const gradleExecutable = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  const gradlePath = path.join(androidDir, gradleExecutable);

  try {
    await access(gradlePath, constants.F_OK);
  } catch (error) {
    console.warn(
      "[mobile] Arquivo gradlew não encontrado. Execute `npx cap add android` manualmente para completar a configuração."
    );
    return false;
  }

  return true;
}

function normalizeDistributionUrl(rawUrl: string): string {
  return rawUrl.replace(/\\\//g, "/").replace(/\\:/g, ":");
}

async function ensureGradleWrapperJar(androidDir: string): Promise<void> {
  try {
    const capacitorSettingsPath = path.join(androidDir, "capacitor.settings.gradle");
    if (!(await fileExists(capacitorSettingsPath))) {
      console.warn(
        "[mobile] capacitor.settings.gradle não encontrado; sincronize a plataforma Android com o Capacitor antes de restaurar o Gradle wrapper."
      );
      return;
    }

    const wrapperDir = path.join(androidDir, "gradle", "wrapper");
    const wrapperJarPath = path.join(wrapperDir, "gradle-wrapper.jar");

    if (await fileExists(wrapperJarPath)) {
      return;
    }

    const propertiesPath = path.join(wrapperDir, "gradle-wrapper.properties");

    if (!(await fileExists(propertiesPath))) {
      console.warn(
        "[mobile] gradle-wrapper.properties não encontrado; não foi possível recuperar gradle-wrapper.jar automaticamente."
      );
      return;
    }

    const propertiesContent = await readFile(propertiesPath, "utf8");
    const distributionLine = propertiesContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("distributionUrl="));

    if (!distributionLine) {
      console.warn(
        "[mobile] Não foi possível identificar a versão do Gradle em gradle-wrapper.properties."
      );
      return;
    }

    const rawUrl = distributionLine.slice("distributionUrl=".length).trim();
    const distributionUrl = normalizeDistributionUrl(rawUrl);
    const versionMatch = distributionUrl.match(/gradle-([\w.-]+)-(bin|all)\.zip$/i);
    const gradleVersion = versionMatch?.[1];

    if (!gradleVersion) {
      console.warn(
        "[mobile] Não foi possível identificar a versão do Gradle em gradle-wrapper.properties."
      );
      return;
    }

    const cacheDir = path.join(process.cwd(), ".cache/mobile/gradle");
    await mkdir(cacheDir, { recursive: true });

    let distributionFileName: string;
    try {
      const url = new URL(distributionUrl);
      distributionFileName = path.basename(url.pathname);
    } catch {
      distributionFileName = `gradle-${gradleVersion}.zip`;
    }

    const distributionArchivePath = path.join(cacheDir, distributionFileName);

    if (!(await fileExists(distributionArchivePath))) {
      console.log(`[mobile] Baixando distribuição do Gradle (${distributionFileName})...`);
      await downloadFile(distributionUrl, distributionArchivePath);
    }

    const gradleDir = path.join(cacheDir, `gradle-${gradleVersion}`);
    const gradleExecutableName = process.platform === "win32" ? "gradle.bat" : "gradle";
    const gradleBin = path.join(gradleDir, "bin", gradleExecutableName);

    if (!(await fileExists(gradleBin))) {
      await rm(gradleDir, { recursive: true, force: true });
      console.log(`[mobile] Extraindo distribuição Gradle para ${gradleDir}...`);
      await runCommand("unzip", ["-q", distributionArchivePath, "-d", cacheDir]);
    }

    if (!(await fileExists(gradleBin))) {
      console.warn("[mobile] Não foi possível preparar o executável do Gradle para restaurar o wrapper.");
      return;
    }

    const javaEnv = await ensureJavaEnv(21);

    console.log(`[mobile] Restaurando gradle-wrapper.jar com Gradle ${gradleVersion}...`);
    await runCommand(gradleBin, ["-p", androidDir, "wrapper", `--gradle-version=${gradleVersion}`], {
      cwd: androidDir,
      env: { ...process.env, ...javaEnv },
    });

    if (!(await fileExists(wrapperJarPath))) {
      console.warn(
        "[mobile] Gradle não gerou gradle-wrapper.jar automaticamente. Verifique a configuração do projeto."
      );
    }
  } catch (error) {
    console.warn("[mobile] Falha ao garantir gradle-wrapper.jar disponível para o build.");
    if (error instanceof Error) {
      console.warn(error.message);
    }
  }
}

async function resolveAndroidSdkPath(androidDir: string): Promise<string | null> {
  if (process.env.ANDROID_SDK_ROOT) {
    const v = process.env.ANDROID_SDK_ROOT.trim();
    if (v) return v;
  }

  if (process.env.ANDROID_HOME) {
    const v = process.env.ANDROID_HOME.trim();
    if (v) return v;
  }

  const localPropertiesPath = path.join(androidDir, "local.properties");

  if (await fileExists(localPropertiesPath)) {
    const content = await readFile(localPropertiesPath, "utf8");
    const sdkLine = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("sdk.dir="));

    if (sdkLine) {
      const rawPath = sdkLine.slice("sdk.dir=".length);
      const normalized = rawPath.replace(/\\\\/g, "\\").replace(/\\:/g, ":");
      return normalized;
    }
  }

  const fallbackCandidates = [
    "/usr/local/lib/android/sdk",
    "/opt/android-sdk",
    process.env.HOME ? path.join(process.env.HOME, "Android", "Sdk") : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of fallbackCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function serializeLocalProperties(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

async function ensureLocalPropertiesSdk(androidDir: string, sdkPath: string): Promise<void> {
  const localPropertiesPath = path.join(androidDir, "local.properties");
  const existingEntries: Record<string, string> = {};

  if (await fileExists(localPropertiesPath)) {
    const raw = await readFile(localPropertiesPath, "utf8");

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const [key, ...rest] = trimmed.split("=");
      if (!key) continue;

      existingEntries[key] = rest.join("=");
    }
  }

  const normalizedPath = sdkPath.trim().replace(/\\/g, "\\\\");

  if (existingEntries["sdk.dir"] === normalizedPath) {
    return;
  }

  existingEntries["sdk.dir"] = normalizedPath;

  await writeFile(localPropertiesPath, `${serializeLocalProperties(existingEntries)}\n`, "utf8");

  console.log(`[mobile] local.properties atualizado com sdk.dir=${normalizedPath}`);
}

async function collectCommandOutput(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      // Use direct spawn to avoid quoting issues with spaces in paths on Windows
      shell: false,
    });

    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(output));
      }
    });
  });
}

async function detectJavaMajorVersion(javaExecutable: string): Promise<number | null> {
  try {
    const output = await collectCommandOutput(javaExecutable, ["-version"]);
    const match = output.match(/version\s+"(?<version>[^"]+)/);

    if (!match?.groups?.version) {
      return null;
    }

    const [major] = match.groups.version.split(".");
    const parsed = Number.parseInt(major, 10);

    if (Number.isNaN(parsed)) {
      return null;
    }

    // For older version strings such as 1.8.0
    if (parsed === 1) {
      const minor = match.groups.version.split(".")[1];
      return minor ? Number.parseInt(minor, 10) : parsed;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

async function downloadFile(url: string, destination: string): Promise<void> {
  try {
    const response = await fetch(url);

    if (!response.ok || !response.body) {
      throw new Error(`Falha ao baixar ${url}: ${response.status} ${response.statusText}`);
    }

    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(destination));
    return;
  } catch (primaryError) {
    const errorMessage =
      primaryError instanceof Error ? primaryError.message : typeof primaryError === "string" ? primaryError : "erro desconhecido";
    console.warn(`[mobile] Falha ao baixar via fetch (${errorMessage}). Tentando curl...`);
    await rm(destination, { force: true });

    try {
      await runCommand("curl", ["-fL", "-o", destination, url]);
      return;
    } catch (curlError) {
      const curlMessage =
        curlError instanceof Error ? curlError.message : typeof curlError === "string" ? curlError : "erro desconhecido";
      console.warn(`[mobile] Falha ao baixar via curl (${curlMessage}). Tentando wget...`);
      await rm(destination, { force: true });
      await runCommand("wget", ["-O", destination, url]);
    }
  }
}

function resolveJdkDownloadUrl(): { url: string; archiveExt: "tar.gz" } {
  const supportedPlatforms: Record<NodeJS.Platform, { os: string; arch: Record<NodeJS.Architecture, string> }> = {
    linux: {
      os: "linux",
      arch: {
        x64: "x64",
        arm64: "aarch64",
      },
    },
    darwin: {
      os: "mac",
      arch: {
        x64: "x64",
        arm64: "aarch64",
      },
    },
  };

  const platformConfig = supportedPlatforms[process.platform];

  if (!platformConfig) {
    throw new Error(
      "[mobile] Download automático do JDK 21 não suportado nesta plataforma. Configure JAVA_HOME manualmente com uma instalação do JDK 21."
    );
  }

  const architecture = platformConfig.arch[process.arch];

  if (!architecture) {
    throw new Error(
      "[mobile] Arquitetura não suportada para download automático do JDK 21. Configure JAVA_HOME manualmente."
    );
  }

  const url = `https://api.adoptium.net/v3/binary/latest/21/ga/${platformConfig.os}/${architecture}/jdk/hotspot/normal/eclipse`;

  return { url, archiveExt: "tar.gz" };
}

async function ensureLocalJdk21(): Promise<string> {
  const cacheDir = path.join(process.cwd(), ".cache/mobile");
  await mkdir(cacheDir, { recursive: true });

  const { url, archiveExt } = resolveJdkDownloadUrl();
  const archiveName = `jdk-21-${process.platform}-${process.arch}.${archiveExt}`;
  const archivePath = path.join(cacheDir, archiveName);
  const jdkDir = path.join(cacheDir, `jdk-21-${process.platform}-${process.arch}`);
  const javaExecutable = path.join(jdkDir, "bin", process.platform === "win32" ? "java.exe" : "java");

  if (await fileExists(javaExecutable)) {
    const version = await detectJavaMajorVersion(javaExecutable);

    if (version && version >= 21) {
      return jdkDir;
    }
  }

  console.log("[mobile] Baixando JDK 21 para uso temporário no build do Android...");
  await downloadFile(url, archivePath);

  await rm(jdkDir, { force: true, recursive: true });
  await mkdir(jdkDir, { recursive: true });

  if (archiveExt === "tar.gz") {
    await runCommand("tar", ["-xzf", archivePath, "--strip-components=1", "-C", jdkDir], {
      cwd: cacheDir,
    });
  } else {
    throw new Error("[mobile] Formato de arquivo do JDK não suportado para extração automática.");
  }

  const version = await detectJavaMajorVersion(javaExecutable);

  if (!version || version < 21) {
    throw new Error("[mobile] Falha ao validar o JDK 21 baixado automaticamente.");
  }

  return jdkDir;
}

// Try to find an installed JDK >= desired version on Windows common locations
async function findWindowsJdkHome(minMajor: number): Promise<string | null> {
  const bases = [
    path.join("C:", "Program Files", "Eclipse Adoptium"),
    path.join("C:", "Program Files", "Java"),
    path.join("C:", "Program Files", "Microsoft", "jdk"),
    path.join("C:", "Program Files", "OpenJDK"),
    path.join("C:", "Program Files", "Zulu"),
  ];

  for (const base of bases) {
    try {
      const entries = await readdir(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(base, entry.name);
        const javaExe = path.join(dir, "bin", "java.exe");
        if (await fileExists(javaExe)) {
          const major = await detectJavaMajorVersion(javaExe);
          if (major && major >= minMajor) {
            return dir;
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function ensureJavaEnv(minMajor: number): Promise<NodeJS.ProcessEnv | undefined> {
  const javaHomeEnv = process.env.JAVA_HOME;
  const javaExecutable = javaHomeEnv
    ? path.join(javaHomeEnv, "bin", process.platform === "win32" ? "java.exe" : "java")
    : "java";

  const version = await detectJavaMajorVersion(javaExecutable);

  if (version && version >= minMajor) {
    return undefined;
  }

  if (process.platform === "win32") {
    const jdk = await findWindowsJdkHome(minMajor);
    if (jdk) {
      console.log(`[mobile] JAVA_HOME ajustado para JDK ${minMajor}+ em ${jdk}`);
      return {
        JAVA_HOME: jdk,
        PATH: `${path.join(jdk, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      };
    }
    console.warn(
      `[mobile] JDK ${minMajor}+ não encontrado automaticamente. Configure JAVA_HOME para um JDK ${minMajor} instalado.`,
    );
    return undefined;
  }

  const localJdk = await ensureLocalJdk21();
  console.log(`[mobile] Utilizando JAVA_HOME temporário em ${localJdk}`);

  return {
    JAVA_HOME: localJdk,
    PATH: `${path.join(localJdk, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

async function buildAndroid(): Promise<void> {
  const androidDir = path.join(process.cwd(), "android");
  const androidAppDir = path.join(androidDir, "app");
  const releaseDir = path.join(androidAppDir, "build/outputs/apk/release");
  const primaryApk = path.join(releaseDir, "app-release.apk");
  const unsignedApk = path.join(releaseDir, "app-release-unsigned.apk");
  const bundleDir = path.join(androidAppDir, "build/outputs/bundle/release");
  const primaryBundle = path.join(bundleDir, "app-release.aab");

  await prepareBuildEnvironment();

  await ensureMobileAssets();

  const projectReady = await ensureAndroidProject(androidDir);
  if (!projectReady) {
    return;
  }

  console.log("[mobile] Sincronizando Capacitor (Android)...");
  await syncCapacitorAndroid();

  await removeSplashAssetConflicts(androidDir);

  // Alguns processos do Capacitor podem reescrever o wrapper do Gradle; garanta que o jar exista
  await ensureGradleWrapperJar(androidDir);

  const sdkPath = await resolveAndroidSdkPath(androidDir);

  if (!sdkPath) {
    throw new Error(
      "[mobile] Android SDK não encontrado. Defina ANDROID_SDK_ROOT/ANDROID_HOME ou configure android/local.properties com sdk.dir antes de gerar o APK."
    );
  }

  console.log(`[mobile] Utilizando Android SDK em ${sdkPath}`);

  await ensureLocalPropertiesSdk(androidDir, sdkPath);

  await hydrateAndroidGoogleServices(androidAppDir);

  const mobileSettings = await getAdminMobileSettings().catch(() => null);
  const versionName = process.env.MOBILE_BUILD_VERSION_NAME?.trim() || (mobileSettings?.versionName ?? process.env.APP_VERSION_NAME ?? undefined);
  const versionCodeCandidate =
    process.env.MOBILE_BUILD_VERSION_CODE ? Number.parseInt(process.env.MOBILE_BUILD_VERSION_CODE, 10) : (typeof mobileSettings?.versionCode === "number" ? mobileSettings.versionCode : undefined);
  const versionCode =
    typeof versionCodeCandidate === "number" && Number.isFinite(versionCodeCandidate)
      ? versionCodeCandidate
      : (() => {
          const parsed = Number.parseInt(process.env.APP_VERSION_CODE ?? "", 10);
          return Number.isFinite(parsed) ? parsed : undefined;
        })();

  console.log("[mobile] Gerando APK de release...");
  const javaEnv = useDockerForGradle ? undefined : await ensureJavaEnv(21);
  await runGradleTask(androidDir, "assembleRelease", javaEnv);

  let apkSource = primaryApk;
  if (!(await fileExists(apkSource)) && (await fileExists(unsignedApk))) {
    apkSource = unsignedApk;
  }

  if (!(await fileExists(apkSource))) {
    console.warn(
      "[mobile] APK de release não foi encontrado após o build. Verifique os logs do Gradle para mais detalhes."
    );
    return;
  }

  const publicApkPath = await copyApkToPublic(apkSource);
  const publicApkUrl = "/downloads/android/app-release.apk";

  await updateManifestWithAndroidArtifact({
    kind: "apk",
    artifactPath: publicApkPath,
    publicUrl: publicApkUrl,
    versionName,
    versionCode,
  });

  console.log("[mobile] APK atualizado em", publicApkPath);

  if (shouldBuildBundle) {
    console.log("[mobile] Gerando bundle AAB de release...");
    await runGradleTask(androidDir, "bundleRelease", javaEnv);

    if (!(await fileExists(primaryBundle))) {
      console.warn("[mobile] Bundle AAB de release não encontrado após o build.");
    } else {
      const publicBundlePath = await copyAabToPublic(primaryBundle);
      const publicBundleUrl = "/downloads/android/app-release.aab";

      await updateManifestWithAndroidArtifact({
        kind: "aab",
        artifactPath: publicBundlePath,
        publicUrl: publicBundleUrl,
        versionName,
        versionCode,
      });

      console.log("[mobile] Bundle AAB atualizado em", publicBundlePath);
    }
  }
}

if (process.argv[1]?.endsWith("mobile-build-android.ts")) {
  buildAndroid()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Falha ao gerar o APK do Android:", error);
      process.exit(1);
    });
}
