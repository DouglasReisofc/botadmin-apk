import crypto from "node:crypto";
import { cookies } from "next/headers";

/** Durable invite intent shared by the web auth flow and the native bridge. */
export const INTERNAL_GROUP_INVITE_COOKIE = "botadmin_pending_group_invite";
const MAX_AGE_SECONDS = 24 * 60 * 60;

const inviteSecret = () => {
  const candidates = [
    process.env.INVITE_COOKIE_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.AUTH_SECRET,
    process.env.JWT_SECRET,
    process.env.APP_SECRET,
  ];
  const configured = candidates.find((value) => typeof value === "string" && value.trim());
  if (configured) return configured!.trim();
  // Keep local development deterministic while still preventing tampering in
  // a running process. Production should always provide one of the secrets.
  return crypto.createHash("sha256").update(`${process.cwd()}::botadmin-invite-intent`).digest("hex");
};

const signature = (token: string) =>
  crypto.createHmac("sha256", inviteSecret()).update(token).digest("base64url");

export const signInternalGroupInviteCookie = (token: string) =>
  `${token}.${signature(token)}`;

export const verifyInternalGroupInviteCookie = (value: string | null | undefined) => {
  const raw = value?.trim() ?? "";
  const separator = raw.lastIndexOf(".");
  if (separator <= 0 || separator === raw.length - 1) return null;
  const token = raw.slice(0, separator);
  const received = raw.slice(separator + 1);
  if (token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const expected = signature(token);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return token;
};

export const readPendingInternalGroupInvite = async () => {
  const store = await cookies();
  return verifyInternalGroupInviteCookie(store.get(INTERNAL_GROUP_INVITE_COOKIE)?.value);
};

export const internalGroupInviteCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: MAX_AGE_SECONDS,
  path: "/",
});
