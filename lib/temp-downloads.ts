import crypto from "crypto";
import path from "path";

import { getAppBaseUrl } from "lib/meta";

const TMP_DIR = path.join(process.cwd(), "public", "tmp");

const getSecretCandidates = (): (string | undefined)[] => [
  process.env.TEMP_DOWNLOAD_SECRET,
  process.env.INTERNAL_API_KEY,
  process.env.BOTADMIN_INTERNAL_API_KEY,
  process.env.USER_API_FALLBACK_KEY,
  process.env.APP_SECRET,
  process.env.JWT_SECRET,
  process.env.NEXTAUTH_SECRET,
];

const getTempDownloadSecret = (): string => {
  const secret = getSecretCandidates().find((entry) => typeof entry === "string" && entry.trim());
  if (!secret) {
    throw new Error(
      "TEMP_DOWNLOAD_SECRET is not configured. Set TEMP_DOWNLOAD_SECRET or INTERNAL_API_KEY.",
    );
  }
  return secret.trim();
};

const signFilename = (filename: string): string => {
  const secret = getTempDownloadSecret();
  return crypto.createHmac("sha256", secret).update(filename).digest("hex");
};

export const buildTempDownloadUrl = (filename: string): string => {
  const baseUrl = getAppBaseUrl();
  const url = new URL("/api/tmp-download", baseUrl);
  url.searchParams.set("file", filename);
  url.searchParams.set("sig", signFilename(filename));
  return url.toString();
};

export const verifyTempDownloadSignature = (filename: string, signature: string | null): boolean => {
  if (!filename || !signature) {
    return false;
  }
  try {
    const expected = signFilename(filename);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

export const getTempDownloadFilePath = (filename: string): string => {
  return path.join(TMP_DIR, filename);
};
