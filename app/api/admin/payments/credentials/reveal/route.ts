import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getAdminMercadoPagoCheckoutConfig,
  getAdminMercadoPagoPixConfig,
  getAdminPoloPagPixConfig,
} from "lib/admin-payments";
import { ensureUserTable, getDb } from "lib/db";

type CredentialProvider =
  | "mercadopago_pix"
  | "mercadopago_checkout"
  | "polopag_pix";

type PasswordRow = RowDataPacket & { password: string };
type AttemptBucket = { failures: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;
const PROVIDERS = new Set<CredentialProvider>([
  "mercadopago_pix",
  "mercadopago_checkout",
  "polopag_pix",
]);

declare global {
  // Mantém o limitador entre recargas do módulo no mesmo processo.
  // eslint-disable-next-line no-var
  var __adminCredentialRevealAttempts: Map<string, AttemptBucket> | undefined;
}

const attempts = globalThis.__adminCredentialRevealAttempts ?? new Map<string, AttemptBucket>();
globalThis.__adminCredentialRevealAttempts = attempts;

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });

const requestAddress = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "unknown";

const getBucket = (key: string) => {
  const now = Date.now();
  if (attempts.size > 500) {
    for (const [candidate, bucket] of attempts) {
      if (bucket.resetAt <= now) attempts.delete(candidate);
    }
  }
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { failures: 0, resetAt: now + WINDOW_MS };
    attempts.set(key, fresh);
    return fresh;
  }
  return current;
};

const credentialsFor = async (provider: CredentialProvider) => {
  if (provider === "mercadopago_pix") {
    const config = await getAdminMercadoPagoPixConfig();
    return {
      accessToken: config.accessToken,
      publicKey: config.publicKey ?? "",
      pixKey: config.pixKey ?? "",
    };
  }
  if (provider === "mercadopago_checkout") {
    const config = await getAdminMercadoPagoCheckoutConfig();
    return {
      accessToken: config.accessToken,
      publicKey: config.publicKey ?? "",
      marketplaceClientId: config.marketplaceClientId ?? "",
      marketplaceClientSecret: config.marketplaceClientSecret ?? "",
    };
  }
  const config = await getAdminPoloPagPixConfig();
  return { apiKey: config.apiKey };
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ message: "Não autenticado." }, 401);
    if (user.role !== "admin" || user.isImpersonated) {
      return json({ message: "Acesso restrito ao administrador autenticado." }, 403);
    }

    const body = await request.json().catch(() => null);
    const password = body && typeof body.password === "string" ? body.password : "";
    const rawProvider = body && typeof body.provider === "string" ? body.provider : "";
    if (!PROVIDERS.has(rawProvider as CredentialProvider)) {
      return json({ message: "Provedor de credenciais inválido." }, 400);
    }
    if (!password || password.length > 256) {
      return json({ message: "Informe sua senha administrativa." }, 400);
    }

    const attemptKey = `${user.id}:${requestAddress(request)}`;
    const bucket = getBucket(attemptKey);
    if (bucket.failures >= MAX_FAILURES) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1_000));
      const response = json(
        { message: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." },
        429,
      );
      response.headers.set("Retry-After", String(retryAfter));
      return response;
    }

    await ensureUserTable();
    const db = getDb();
    const [rows] = await db.query<PasswordRow[]>(
      "SELECT password FROM users WHERE id = ? AND role = 'admin' AND is_active = 1 LIMIT 1",
      [user.id],
    );
    const passwordHash = Array.isArray(rows) && rows.length > 0 ? rows[0]?.password : null;
    const valid = typeof passwordHash === "string" && passwordHash.length > 0
      ? await bcrypt.compare(password, passwordHash)
      : false;

    if (!valid) {
      bucket.failures += 1;
      attempts.set(attemptKey, bucket);
      return json({ message: "Senha administrativa incorreta." }, 401);
    }

    attempts.delete(attemptKey);
    const provider = rawProvider as CredentialProvider;
    const credentials = await credentialsFor(provider);
    console.info("[admin-credentials] payment credentials revealed", {
      adminUserId: user.id,
      provider,
    });
    return json({ credentials });
  } catch (error) {
    console.error("Failed to reveal protected payment credentials", error);
    return json({ message: "Não foi possível confirmar a senha agora." }, 500);
  }
}
