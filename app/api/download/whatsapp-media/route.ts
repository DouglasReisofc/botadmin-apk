import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import { listInstancesForUser } from "lib/bot-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrepareBody = {
  image?: unknown;
  url?: unknown;
  base64?: unknown;
  mimeType?: unknown;
};

const cleanString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const validSource = (source: string): boolean => {
  if (source.startsWith("data:image/")) return source.length <= 2_800_000;
  try {
    const parsed = new URL(source);
    return parsed.protocol === "https:" && source.length <= 4_096;
  } catch {
    return false;
  }
};

export const POST = withUserApiAuth(async (request: NextRequest, _context, auth) => {
  let body: PrepareBody;
  try {
    body = (await request.json()) as PrepareBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Payload JSON inválido." }, { status: 400 });
  }

  const source = cleanString(body.image) || cleanString(body.url) || cleanString(body.base64);
  if (!source || !validSource(source)) {
    return NextResponse.json(
      { ok: false, message: "Informe uma URL HTTPS ou data URL de imagem válida." },
      { status: 400 },
    );
  }

  const instances = await listInstancesForUser(auth.userId);
  const candidates = instances.filter(
    (instance) =>
      Boolean(instance.token && instance.serverBaseUrl) &&
      ["conectado", "connected", "online"].includes(String(instance.sessionStatus).toLowerCase()),
  );
  if (candidates.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Nenhuma sessão WhatsApp conectada está disponível para preparar a mídia." },
      { status: 503 },
    );
  }

  const failures: string[] = [];
  for (const instance of candidates) {
    try {
      const endpoint = new URL("/media/prepare/image", instance.serverBaseUrl).toString();
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          token: instance.token,
        },
        body: JSON.stringify({
          image: source,
          mimeType: cleanString(body.mimeType) || "image/jpeg",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const payload = (await upstream.json()) as Record<string, unknown>;
      const media = (payload.data ?? payload) as Record<string, unknown>;
      if (!upstream.ok || !media.url || !media.directPath || !media.mediaKeyHex) {
        failures.push(`instância ${instance.id}: HTTP ${upstream.status}`);
        continue;
      }
      return NextResponse.json({ ok: true, media });
    } catch (error) {
      failures.push(`instância ${instance.id}: ${error instanceof Error ? error.message : "falha"}`);
    }
  }

  console.error("[whatsapp-media] all preparation instances failed", failures);
  return NextResponse.json(
    { ok: false, message: "Não foi possível preparar a mídia no CDN do WhatsApp." },
    { status: 502 },
  );
});
