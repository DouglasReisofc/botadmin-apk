import { createHmac, timingSafeEqual } from "node:crypto";

const INTERNAL_SCOPE = "botadmin-status-media";
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const getSigningSecret = (): string | null => {
  const candidates = [
    process.env.BOTADMIN_INTERNAL_API_KEY,
    process.env.INTERNAL_API_KEY,
    process.env.JWT_SECRET,
  ];
  return candidates.find((value) => value?.trim())?.trim() ?? null;
};

const signatureFor = (userId: number, timestamp: string, secret: string): string =>
  createHmac("sha256", secret)
    .update(`${INTERNAL_SCOPE}:${userId}:${timestamp}`)
    .digest("hex");

export const createInternalUserRequestHeaders = (
  userId: number,
): Record<string, string> => {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error("Assinatura interna do BotAdmin não configurada.");
  }
  const timestamp = String(Date.now());
  return {
    "x-botadmin-user-id": String(userId),
    "x-botadmin-timestamp": timestamp,
    "x-botadmin-signature": signatureFor(userId, timestamp, secret),
  };
};

export const resolveInternalUserId = (request: Request): number | null => {
  const secret = getSigningSecret();
  if (!secret) return null;
  const rawUserId = request.headers.get("x-botadmin-user-id")?.trim() ?? "";
  const timestamp = request.headers.get("x-botadmin-timestamp")?.trim() ?? "";
  const signature = request.headers.get("x-botadmin-signature")?.trim() ?? "";
  const userId = Number(rawUserId);
  const timestampMs = Number(timestamp);
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return null;
  }
  const expected = signatureFor(userId, timestamp, secret);
  const receivedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
    ? userId
    : null;
};
