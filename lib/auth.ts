import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import {
  ensureSessionTable,
  ensureUserTable,
  getDb,
  SessionRow,
  UserRow,
} from "lib/db";
import type { SessionUser } from "types/auth";
import { normalizeTimezoneInput } from "lib/timezones";

const ADMIN_ROLE_ALIASES = new Set([
  "admin",
  "administrator",
  "administrador",
  "superadmin",
  "super-admin",
  "super_admin",
]);

const normalizeAvatarUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = trimmed.replace(/^\/+/, "").replace(/\\/g, "/");
  return `/${sanitized}`;
};

export const normalizeUserRole = (value: unknown): "admin" | "user" => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (ADMIN_ROLE_ALIASES.has(normalized)) {
      return "admin";
    }

    if (normalized === "user" || normalized === "usuario" || normalized === "customer") {
      return "user";
    }
  }

  return "user";
};

const mapUserRowToSessionUser = (user: UserRow): SessionUser => ({
  id: Number(user.id),
  name: user.name ?? "",
  email: user.email ?? null,
  role: normalizeUserRole(user.role),
  isActive: Boolean(user.is_active),
  whatsappNumber: user.whatsapp_number ?? null,
  timezone: normalizeTimezoneInput(user.timezone) ?? null,
  avatarUrl: normalizeAvatarUrl(user.avatar_path ?? null),
  needsCredentialsCompletion: Boolean(user.needs_credentials_completion),
  passwordMissing: Boolean(user.password_missing),
  isImpersonated: false,
  impersonatorUserId: null,
  canReturnToAdmin: false,
});

export const SESSION_COOKIE = "sb_session";
export const ADMIN_SESSION_COOKIE = "sb_admin_session";
const DEFAULT_SESSION_TTL_DAYS = 7;

type CookieConfigContext = {
  forwardedProto?: string | null;
  host?: string | null;
};

type ResolvedCookieConfig = ReturnType<typeof resolveCookieConfig>;

const resolveCookieConfig = (context: CookieConfigContext = {}) => {
  const explicit = (process.env.COOKIE_SECURE || "").trim().toLowerCase();
  let secure: boolean | undefined;

  if (explicit === "true" || explicit === "1") secure = true;
  if (explicit === "false" || explicit === "0") secure = false;

  const forwardedProto = context.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (secure === undefined && forwardedProto === "https") secure = true;
  if (secure === undefined && forwardedProto === "http") secure = false;

  const hostHeader = context.host?.toLowerCase() ?? "";
  if (
    secure === undefined &&
    hostHeader &&
    (hostHeader.startsWith("localhost") ||
      hostHeader.startsWith("127.") ||
      hostHeader.endsWith(".local"))
  ) {
    secure = false;
  }

  if (secure === undefined) {
    const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_CAP_SERVER_URL || "").trim();
    if (appUrl) secure = appUrl.startsWith("https://");
  }

  if (secure === undefined) secure = process.env.NODE_ENV === "production";

  const rawSameSite = (process.env.COOKIE_SAMESITE || "").trim().toLowerCase();
const isMobileCap = (process.env.NEXT_PUBLIC_CAP || "").trim().toLowerCase() === "android";

let sameSite: "lax" | "strict" | "none" =
  (rawSameSite === "none" || rawSameSite === "lax" || rawSameSite === "strict")
    ? (rawSameSite as any)
    : (isMobileCap ? "none" : "lax");

// Fallback: SameSite=None exige Secure=true. Em dev (http), degrade para Lax.
if (sameSite === "none" && !secure) {
  sameSite = "lax";
}
return {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
  };
};

const getCookieHost = (host: string | null | undefined) =>
  (host ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase()
    .replace(/:\d+$/, "") ?? "";

const getCookieDomainCandidates = (host: string | null | undefined) => {
  const normalizedHost = getCookieHost(host);
  if (
    !normalizedHost ||
    normalizedHost === "localhost" ||
    normalizedHost.startsWith("127.") ||
    normalizedHost.startsWith("[") ||
    normalizedHost.endsWith(".local")
  ) {
    return [];
  }

  const withoutWww = normalizedHost.replace(/^www\./, "");
  const candidates = new Set<string>([normalizedHost, `.${normalizedHost}`]);
  if (withoutWww !== normalizedHost) {
    candidates.add(withoutWww);
    candidates.add(`.${withoutWww}`);
  }

  const labels = withoutWww.split(".").filter(Boolean);
  if (labels.length >= 2) {
    const rootDomain = labels.slice(-2).join(".");
    candidates.add(rootDomain);
    candidates.add(`.${rootDomain}`);
  }

  return Array.from(candidates);
};

const serializeExpiredCookie = (
  name: string,
  options: {
    domain?: string;
    config: ResolvedCookieConfig;
    secureOverride?: boolean;
  },
) => {
  const parts = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
  ];
  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }
  if (options.secureOverride ?? options.config.secure) {
    parts.push("Secure");
  }
  parts.push(`SameSite=${options.config.sameSite}`);
  return parts.join("; ");
};

const getExpirationDate = (days = DEFAULT_SESSION_TTL_DAYS) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
};

const toSeconds = (milliseconds: number) => Math.max(Math.floor(milliseconds / 1000), 0);

export const setSessionCookie = (
  response: NextResponse,
  sessionId: string,
  expiresAt: Date,
  context?: CookieConfigContext,
) => {
  const maxAge = toSeconds(expiresAt.getTime() - Date.now());

  response.cookies.set({
    name: SESSION_COOKIE,
    value: sessionId,
    maxAge,
    ...resolveCookieConfig(context),
  });
};

export const clearSessionCookie = (
  response: NextResponse,
  context?: CookieConfigContext,
) => {
  const config = resolveCookieConfig(context);
  const cookieNames = [SESSION_COOKIE, ADMIN_SESSION_COOKIE];

  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    maxAge: 0,
    ...config,
  });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    maxAge: 0,
    ...config,
  });

  const domains = getCookieDomainCandidates(context?.host);
  for (const name of cookieNames) {
    response.headers.append("Set-Cookie", serializeExpiredCookie(name, { config }));
    for (const domain of domains) {
      response.headers.append("Set-Cookie", serializeExpiredCookie(name, { config, domain }));
      if (!config.secure) {
        response.headers.append("Set-Cookie", serializeExpiredCookie(name, {
          config,
          domain,
          secureOverride: true,
        }));
      }
    }
  }
};

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const setAdminSessionReferenceCookie = (
  response: NextResponse,
  sessionId: string | null,
  expiresAt: Date | string | null,
  context?: CookieConfigContext,
) => {
  if (!sessionId || !expiresAt) {
    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: "",
      maxAge: 0,
      ...resolveCookieConfig(context),
    });
    return;
  }

  const expiresDate = toDate(expiresAt);
  if (!expiresDate) {
    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: "",
      maxAge: 0,
      ...resolveCookieConfig(context),
    });
    return;
  }

  const maxAge = toSeconds(expiresDate.getTime() - Date.now());

  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: sessionId,
    maxAge,
    ...resolveCookieConfig(context),
  });
};

export const createSession = async (
  userId: number,
  ttlDays: number = DEFAULT_SESSION_TTL_DAYS,
  options: { impersonatedByUserId?: number | null; impersonatedFromSessionId?: string | null } = {},
) => {
  await ensureSessionTable();
  const db = getDb();
  const sessionId = randomUUID();
  const expiresAt = getExpirationDate(ttlDays);

  await db.query(
    `
      INSERT INTO sessions (id, user_id, expires_at, impersonated_by_user_id, impersonated_from_session_id)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      sessionId,
      userId,
      expiresAt,
      options.impersonatedByUserId ?? null,
      options.impersonatedFromSessionId ?? null,
    ],
  );

  return { id: sessionId, expiresAt };
};

export const revokeSession = async (sessionId: string) => {
  await ensureSessionTable();
  const db = getDb();
  await db.query(
    `
      UPDATE sessions
      SET revoked_at = NOW()
      WHERE id = ?
    `,
    [sessionId],
  );
};

export const revokeSessionsForUser = async (userId: number) => {
  await ensureSessionTable();
  const db = getDb();
  await db.query(
    `
      UPDATE sessions
      SET revoked_at = NOW()
      WHERE user_id = ? AND revoked_at IS NULL
    `,
    [userId],
  );
};

export const revokeSessionsForUserExcept = async (
  userId: number,
  exceptSessionId: string | null,
) => {
  await ensureSessionTable();
  const db = getDb();
  if (exceptSessionId && exceptSessionId.trim()) {
    await db.query(
      `
        UPDATE sessions
        SET revoked_at = NOW()
        WHERE user_id = ? AND revoked_at IS NULL AND id <> ?
      `,
      [userId, exceptSessionId.trim()],
    );
  } else {
    await revokeSessionsForUser(userId);
  }
};


const normalizeDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

export const findActiveSession = async (
  sessionId: string,
): Promise<SessionRow | null> => {
  await ensureSessionTable();
  const db = getDb();
  const [sessions] = await db.query<SessionRow[]>(
    `SELECT * FROM sessions WHERE id = ? LIMIT 1`,
    [sessionId],
  );

  if (!sessions.length) {
    return null;
  }

  const session = sessions[0];
  const expiresAt = normalizeDate(session.expires_at);
  const revokedAt = session.revoked_at ? normalizeDate(session.revoked_at) : null;

  if (revokedAt || expiresAt.getTime() <= Date.now()) {
    await db.query(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
    return null;
  }

  return session;
};

export const getSessionUserById = async (sessionId: string): Promise<SessionUser | null> => {
  if (!sessionId) {
    return null;
  }

  try {
    const session = await findActiveSession(sessionId);
    if (!session) {
      return null;
    }

    await ensureUserTable();
    const db = getDb();
    const [users] = await db.query<UserRow[]>(
      `SELECT id, name, email, role, is_active, whatsapp_number, timezone, avatar_path, needs_credentials_completion, password_missing FROM users WHERE id = ? LIMIT 1`,
      [session.user_id],
    );

    if (!users.length) {
      return null;
    }

    const user = users[0];

    if (!user.is_active) {
      await revokeSession(session.id);
      return null;
    }

    const sessionUser = mapUserRowToSessionUser(user);
    if (session.impersonated_by_user_id != null) {
      sessionUser.isImpersonated = true;
      sessionUser.impersonatorUserId = Number(session.impersonated_by_user_id);
    }
    return sessionUser;
  } catch (error) {
    console.error("Failed to resolve session user", error);
    return null;
  }
};

export const getCurrentUser = async (): Promise<SessionUser | null> => {
  noStore();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionId) {
    return null;
  }

  try {
    const session = await findActiveSession(sessionId);

    if (!session) {
      return null;
    }

    await ensureUserTable();
    const db = getDb();
    const [users] = await db.query<UserRow[]>(
      `SELECT id, name, email, role, is_active, whatsapp_number, timezone, avatar_path, needs_credentials_completion, password_missing FROM users WHERE id = ? LIMIT 1`,
      [session.user_id],
    );

    if (!users.length) {
      return null;
    }

    const user = users[0];

    if (!user.is_active) {
      await revokeSession(session.id);
      return null;
    }

    const resolvedUser = mapUserRowToSessionUser(user);
    if (session.impersonated_by_user_id != null) {
      resolvedUser.isImpersonated = true;
      resolvedUser.impersonatorUserId = Number(session.impersonated_by_user_id);
    }
    const adminSessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
    resolvedUser.canReturnToAdmin = Boolean(adminSessionCookie);
    return resolvedUser;
  } catch (error) {
    console.error("Failed to load current user", error);
    return null;
  }
};






