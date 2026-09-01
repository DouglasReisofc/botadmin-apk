import fs from "fs";
import path from "path";
import mime from "mime-types";

import {
  MegaCredentialsError,
  clearMegaSessionCache,
  getMegaCredentialSecret,
  saveMegaSessionCache,
} from "./admin-mega-credentials";

type MegaModule = {
  File: {
    fromURL: (link: string, extra?: { api?: MegaApi }) => MegaFile;
  };
  Storage: MegaStorageConstructor;
};

type MegaApi = {
  sid?: string;
  request?: (...args: unknown[]) => unknown;
};

type MegaFile = {
  name?: string | null;
  size?: number;
  loadAttributes: () => Promise<void>;
  download: () => NodeJS.ReadableStream;
};

type MegaStorageOptions = {
  email: string;
  password: string;
  autoload?: boolean;
  autologin?: boolean;
  keepalive?: boolean;
};

type MegaStorageJSON = {
  key: string;
  sid: string;
  name: string;
  user: string;
  options?: MegaStorageOptions;
};

type MegaStorage = {
  api: MegaApi;
  options?: MegaStorageOptions;
  login: () => Promise<MegaStorage>;
  reload?: (force?: boolean) => Promise<unknown>;
  getAccountInfo?: () => Promise<unknown>;
  close?: () => Promise<void>;
  toJSON: () => MegaStorageJSON;
};

type MegaStorageConstructor = {
  new (options: MegaStorageOptions): MegaStorage;
  fromJSON: (snapshot: MegaStorageJSON) => MegaStorage;
};

type ExternalMegaAccount = {
  email: string;
  password: string;
  status?: string | null;
};

type MegaAccountSource = "manual" | "external";

type MegaAccountContext = {
  email: string;
  password: string;
  source: MegaAccountSource;
  endpointUrl: string | null;
  sessionEmail: string | null;
  sessionPayload: string | null;
};

class MegaAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MegaAuthenticationError";
  }
}

export type MegaDownloadResult = {
  filename: string;
  filePath: string;
  publicPath: string;
  size: number | null;
  mimeType: string;
};

const EXTERNAL_CACHE_TTL = 60_000;
const FAILED_ACCOUNT_TTL = 10 * 60 * 1000;
const EXTERNAL_FETCH_TIMEOUT = 10_000;

let megaModuleCache: MegaModule | null = null;
let activeStorage: { email: string; storage: MegaStorage } | null = null;
let storagePromise: Promise<MegaStorage> | null = null;
let storagePromiseEmail: string | null = null;

type FileTypeModule = {
  fileTypeFromFile?: (path: string) => Promise<{ mime: string; ext: string } | undefined>;
  fileTypeFromBuffer?: (buffer: Uint8Array) => Promise<{ mime: string; ext: string } | undefined>;
  fromBuffer?: (buffer: Uint8Array) => Promise<{ mime: string; ext: string } | undefined>;
};

let fileTypeModuleCache: FileTypeModule | null | undefined;
const externalAccountCache = new Map<string, { fetchedAt: number; accounts: ExternalMegaAccount[] }>();
const failedExternalAccounts = new Map<string, Map<string, number>>();

const loadMegaModule = (): MegaModule => {
  if (megaModuleCache) {
    return megaModuleCache;
  }

  try {
    const mod = eval("require")("megajs") as MegaModule;
    megaModuleCache = mod;
    return mod;
  } catch (_error) {
    throw new Error("Dependência megajs não encontrada. Instale com `npm install megajs`.");
  }
};

const loadFileTypeModule = (): FileTypeModule | null => {
  if (fileTypeModuleCache !== undefined) {
    return fileTypeModuleCache;
  }
  try {
    fileTypeModuleCache = eval("require")("file-type") as FileTypeModule;
  } catch {
    fileTypeModuleCache = null;
  }
  return fileTypeModuleCache;
};

const detectMimeTypeFromFile = async (filePath: string): Promise<string | null> => {
  const mod = loadFileTypeModule();
  if (!mod) {
    return null;
  }

  if (typeof mod.fileTypeFromFile === "function") {
    try {
      const result = await mod.fileTypeFromFile(filePath);
      if (result?.mime) {
        return result.mime;
      }
    } catch {
      /* ignore errors */
    }
  }

  try {
    const handle = await fs.promises.open(filePath, "r");
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
    await handle.close();
    if (bytesRead > 0) {
      const chunk = buffer.subarray(0, bytesRead);
      if (typeof mod.fileTypeFromBuffer === "function") {
        try {
          const result = await mod.fileTypeFromBuffer(chunk);
          if (result?.mime) {
            return result.mime;
          }
        } catch {
          /* ignore errors */
        }
      }
      if (typeof mod.fromBuffer === "function") {
        try {
          const result = await mod.fromBuffer(chunk);
          if (result?.mime) {
            return result.mime;
          }
        } catch {
          /* ignore errors */
        }
      }
    }
  } catch {
    /* ignore read errors */
  }

  return null;
};

const normalizeEmail = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const isAccountTemporarilyFailed = (url: string, email: string): boolean => {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  const bucket = failedExternalAccounts.get(url);
  if (!bucket) {
    return false;
  }

  const failureAt = bucket.get(normalized);
  if (!failureAt) {
    return false;
  }

  if (Date.now() - failureAt > FAILED_ACCOUNT_TTL) {
    bucket.delete(normalized);
    if (bucket.size === 0) {
      failedExternalAccounts.delete(url);
    }
    return false;
  }

  return true;
};

const markExternalAccountAsFailed = (url: string, email: string): void => {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return;
  }

  let bucket = failedExternalAccounts.get(url);
  if (!bucket) {
    bucket = new Map();
    failedExternalAccounts.set(url, bucket);
  }
  bucket.set(normalized, Date.now());
};

const fetchExternalAccounts = async (url: string): Promise<ExternalMegaAccount[]> => {
  const cache = externalAccountCache.get(url);
  const now = Date.now();
  if (cache && now - cache.fetchedAt < EXTERNAL_CACHE_TTL) {
    return cache.accounts;
  }

  if (typeof fetch !== "function") {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_FETCH_TIMEOUT);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[mega] Endpoint externo retornou status ${response.status}`);
      return [];
    }

    const data = await response.json().catch(() => ({}));
    const accounts = Array.isArray((data as { accounts?: unknown })?.accounts)
      ? ((data as { accounts?: ExternalMegaAccount[] }).accounts ?? [])
      : [];

    const normalized = accounts
      .map((account) => ({
        email: typeof account?.email === "string" ? account.email.trim() : "",
        password: typeof account?.password === "string" ? account.password.trim() : "",
        status: typeof account?.status === "string" ? account.status.trim().toLowerCase() : null,
      }))
      .filter((account) => account.email && account.password);

    externalAccountCache.set(url, { accounts: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn("[mega] Falha ao consultar endpoint externo", { url, error });
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

const pickExternalAccount = async (
  url: string,
  excludedEmails: Set<string>,
): Promise<ExternalMegaAccount | null> => {
  const accounts = await fetchExternalAccounts(url);
  for (const account of accounts) {
    if (account.status && account.status !== "valid") {
      continue;
    }
    const normalized = normalizeEmail(account.email);
    if (!normalized || excludedEmails.has(normalized)) {
      continue;
    }
    if (isAccountTemporarilyFailed(url, account.email)) {
      continue;
    }
    return account;
  }
  return null;
};

const resolveMegaAccount = async (excludedEmails: Set<string>): Promise<MegaAccountContext> => {
  const secret = await getMegaCredentialSecret();

  if (secret.externalAccountsEnabled && secret.externalAccountsUrl) {
    const account = await pickExternalAccount(secret.externalAccountsUrl, excludedEmails);
    if (account) {
      return {
        email: account.email,
        password: account.password,
        source: "external",
        endpointUrl: secret.externalAccountsUrl,
        sessionEmail: secret.sessionEmail,
        sessionPayload: secret.sessionPayload,
      };
    }
  }

  if (secret.email && secret.password) {
    const normalizedManual = normalizeEmail(secret.email);
    if (!normalizedManual || !excludedEmails.has(normalizedManual)) {
      return {
        email: secret.email,
        password: secret.password,
        source: "manual",
        endpointUrl: null,
        sessionEmail: secret.sessionEmail,
        sessionPayload: secret.sessionPayload,
      };
    }
  }

  throw new MegaCredentialsError("Credenciais do Mega não configuradas.", 503);
};

const parseSessionSnapshot = (payload: string | null): MegaStorageJSON | null => {
  if (!payload) {
    return null;
  }
  try {
    const snapshot = JSON.parse(payload);
    if (snapshot && typeof snapshot === "object" && typeof snapshot.sid === "string") {
      return snapshot as MegaStorageJSON;
    }
  } catch (_error) {
    /* ignore invalid payload */
  }
  return null;
};

const saveSessionSnapshot = async (storage: MegaStorage, email: string): Promise<void> => {
  try {
    const snapshot = storage.toJSON?.();
    if (snapshot && snapshot.sid) {
      await saveMegaSessionCache(email, JSON.stringify(snapshot));
    }
  } catch (error) {
    console.warn("[mega] Não foi possível salvar a sessão do Mega", error);
  }
};

const closeActiveStorageIfDifferent = async (normalizedEmail: string | null): Promise<void> => {
  if (!activeStorage) {
    return;
  }
  const currentNormalized = normalizeEmail(activeStorage.email);
  if (normalizedEmail && currentNormalized === normalizedEmail) {
    return;
  }
  try {
    await activeStorage.storage.close?.();
  } catch {
    /* ignore shutdown errors */
  } finally {
    activeStorage = null;
  }
};

const acquireStorageForAccount = async (account: MegaAccountContext): Promise<MegaStorage> => {
  const normalizedEmail = normalizeEmail(account.email);
  if (!normalizedEmail) {
    throw new MegaCredentialsError("Conta do Mega inválida.", 503);
  }

  if (activeStorage && normalizeEmail(activeStorage.email) === normalizedEmail) {
    return activeStorage.storage;
  }
  if (storagePromise && storagePromiseEmail === normalizedEmail) {
    return storagePromise;
  }

  const createStorage = async (): Promise<MegaStorage> => {
    const { Storage } = loadMegaModule();

    await closeActiveStorageIfDifferent(normalizedEmail);

    const snapshot = normalizeEmail(account.sessionEmail) === normalizedEmail
      ? parseSessionSnapshot(account.sessionPayload)
      : null;

    if (snapshot) {
      try {
        const restored = Storage.fromJSON(snapshot) as MegaStorage;
        restored.options = { ...(restored.options ?? {}), keepalive: true };
        if (typeof restored.reload === "function") {
          await restored.reload().catch(async () => {
            if (typeof restored.getAccountInfo === "function") {
              await restored.getAccountInfo();
            }
          });
        }
        activeStorage = { email: account.email, storage: restored };
        return restored;
      } catch (error) {
        console.warn("[mega] Sessão salva inválida, refazendo login", error);
        await clearMegaSessionCache().catch(() => undefined);
      }
    }

    try {
      const storage = new Storage({
        email: account.email,
        password: account.password,
        autoload: false,
        autologin: false,
        keepalive: true,
      }) as MegaStorage;
      await storage.login();
      if (typeof storage.reload === "function") {
        await storage.reload().catch(() => undefined);
      }
      await saveSessionSnapshot(storage, account.email);
      activeStorage = { email: account.email, storage };
      return storage;
    } catch (error) {
      throw new MegaAuthenticationError(
        error instanceof Error ? error.message : "Falha ao autenticar no Mega.",
      );
    }
  };

  storagePromiseEmail = normalizedEmail;
  storagePromise = createStorage();
  try {
    const storage = await storagePromise;
    return storage;
  } finally {
    storagePromise = null;
    storagePromiseEmail = null;
  }
};

const sanitizeFileName = (value: string): string => {
  const sanitized = value.replace(/[\\/"|:*?<>]+/g, "_").replace(/[\r\n]+/g, "").trim();
  if (!sanitized) {
    return `mega_${Date.now()}`;
  }
  return sanitized.slice(0, 200);
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const ensureUniqueFileName = async (dir: string, filename: string): Promise<string> => {
  const parsed = path.parse(filename);
  let candidate = filename;
  let counter = 1;

  while (await fileExists(path.join(dir, candidate))) {
    candidate = `${parsed.name}_${counter}${parsed.ext}`;
    counter += 1;
  }

  return candidate;
};

const performDownload = async (storage: MegaStorage, link: string): Promise<MegaDownloadResult> => {
  const { File } = loadMegaModule();
  const file = File.fromURL(link, { api: storage.api });
  await file.loadAttributes();

  const tmpDir = path.join(process.cwd(), "public", "tmp");
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const originalName = typeof file.name === "string" && file.name ? file.name : `mega_${Date.now()}`;
  const sanitizedName = sanitizeFileName(path.basename(originalName));
  const uniqueName = await ensureUniqueFileName(tmpDir, sanitizedName);
  const outputPath = path.join(tmpDir, uniqueName);

  let writeStream: fs.WriteStream | null = null;
  let downloaded = false;
  try {
    writeStream = fs.createWriteStream(outputPath);
    await new Promise<void>((resolve, reject) => {
      const stream = file.download();
      stream.pipe(writeStream!);
      stream.on("error", reject);
      writeStream!.on("error", reject);
      writeStream!.on("finish", () => resolve());
    });
    downloaded = true;
  } catch (error) {
    throw error instanceof Error ? error : new Error("Falha ao baixar arquivo do Mega.");
  } finally {
    if (writeStream) {
      writeStream.close();
    }
    if (!downloaded) {
      try {
        await fs.promises.rm(outputPath, { force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  const stats = await fs.promises.stat(outputPath);
  const size = Number.isFinite(stats.size) ? stats.size : null;
  const detectedMimeType = await detectMimeTypeFromFile(outputPath);
  const mimeType =
    detectedMimeType || (mime.lookup(uniqueName) as string | false) || "application/octet-stream";
  const publicPath = `/tmp/${encodeURIComponent(uniqueName)}`;

  return {
    filename: uniqueName,
    filePath: outputPath,
    publicPath,
    size,
    mimeType,
  };
};

export const downloadMegaFileToPublic = async (link: string): Promise<MegaDownloadResult> => {
  if (!link || typeof link !== "string" || !link.trim()) {
    throw new Error("Informe um link válido do Mega.");
  }

  const trimmedLink = link.trim();
  const excludedEmails = new Set<string>();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let account: MegaAccountContext;
    try {
      account = await resolveMegaAccount(excludedEmails);
    } catch (error) {
      lastError = error;
      break;
    }

    try {
      const storage = await acquireStorageForAccount(account);
      return await performDownload(storage, trimmedLink);
    } catch (error) {
      lastError = error;
      if (error instanceof MegaAuthenticationError) {
        const normalized = normalizeEmail(account.email);
        if (normalized) {
          excludedEmails.add(normalized);
        }
        if (account.source === "external" && account.endpointUrl) {
          markExternalAccountAsFailed(account.endpointUrl, account.email);
        }
        await clearMegaSessionCache().catch(() => undefined);
        continue;
      }
      throw error;
    }
  }

  if (lastError instanceof MegaCredentialsError) {
    throw lastError;
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Falha ao baixar arquivo do Mega.");
};
