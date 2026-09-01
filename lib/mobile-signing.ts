import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

const SECURE_DIR = path.resolve(process.cwd(), "storage", "secure", "mobile");
const KEYSTORE_ENC_PATH = path.join(SECURE_DIR, "android-keystore.enc");
const META_ENC_PATH = path.join(SECURE_DIR, "android-keystore-meta.enc");

export type AndroidKeystoreMeta = {
  keyAlias: string;
  keyPassword: string;
  storePassword: string;
  updatedAt: string;
};

const ensureSecureDir = async () => {
  await fs.mkdir(SECURE_DIR, { recursive: true });
};

const getEncryptionKey = (): Buffer => {
  const raw = (process.env.MOBILE_ENCRYPTION_KEY || process.env.JWT_SECRET || "").trim();
  if (!raw) {
    throw new Error(
      "Defina MOBILE_ENCRYPTION_KEY ou JWT_SECRET para criptografar o keystore armazenado."
    );
  }
  // Derive 32-byte key
  return crypto.createHash("sha256").update(raw, "utf8").digest();
};

const encryptBuffer = (plaintext: Buffer): Buffer => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
};

const decryptBuffer = (payload: Buffer): Buffer => {
  const key = getEncryptionKey();
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const saveAndroidKeystore = async (
  keystoreFile: File,
  meta: { keyAlias: string; keyPassword: string; storePassword: string },
): Promise<AndroidKeystoreMeta> => {
  if (!(keystoreFile instanceof File)) {
    throw new Error("Arquivo de keystore inválido.");
  }

  const buffer = Buffer.from(await keystoreFile.arrayBuffer());
  if (buffer.length < 1_024 || buffer.length > 20 * 1024 * 1024) {
    // sanity bounds: 1KB..20MB
    // Most JKS/PKCS12 files will be a few KB
  }

  const now = new Date().toISOString();
  const metaPayload: AndroidKeystoreMeta = {
    keyAlias: meta.keyAlias.trim(),
    keyPassword: meta.keyPassword,
    storePassword: meta.storePassword,
    updatedAt: now,
  };

  await ensureSecureDir();

  await fs.writeFile(KEYSTORE_ENC_PATH, encryptBuffer(buffer));
  await fs.writeFile(META_ENC_PATH, encryptBuffer(Buffer.from(JSON.stringify(metaPayload), "utf8")));

  return metaPayload;
};

export const deleteAndroidKeystore = async (): Promise<void> => {
  try { await fs.unlink(KEYSTORE_ENC_PATH); } catch {}
  try { await fs.unlink(META_ENC_PATH); } catch {}
};

export const getAndroidSigningStatus = async (): Promise<{ hasKeystore: boolean; updatedAt: string | null; keyAlias?: string }> => {
  const has = await fileExists(META_ENC_PATH) && await fileExists(KEYSTORE_ENC_PATH);
  if (!has) return { hasKeystore: false, updatedAt: null };
  try {
    const metaEnc = await fs.readFile(META_ENC_PATH);
    const meta = JSON.parse(decryptBuffer(metaEnc).toString("utf8")) as AndroidKeystoreMeta;
    return { hasKeystore: true, updatedAt: meta.updatedAt ?? null, keyAlias: meta.keyAlias };
  } catch {
    return { hasKeystore: true, updatedAt: null };
  }
};

export const getAndroidKeystoreForCi = async (): Promise<{
  base64: string;
  keyAlias: string;
  keyPassword: string;
  storePassword: string;
  updatedAt: string | null;
} | null> => {
  if (!(await fileExists(META_ENC_PATH)) || !(await fileExists(KEYSTORE_ENC_PATH))) {
    return null;
  }

  const [metaEnc, ksEnc] = await Promise.all([
    fs.readFile(META_ENC_PATH),
    fs.readFile(KEYSTORE_ENC_PATH),
  ]);

  const meta = JSON.parse(decryptBuffer(metaEnc).toString("utf8")) as AndroidKeystoreMeta;
  const keystore = decryptBuffer(ksEnc);

  return {
    base64: keystore.toString("base64"),
    keyAlias: meta.keyAlias,
    keyPassword: meta.keyPassword,
    storePassword: meta.storePassword,
    updatedAt: meta.updatedAt ?? null,
  };
};
