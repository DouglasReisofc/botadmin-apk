import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getMercadoPagoPixConfigForUser,
  getPoloPagPixConfigForUser,
  upsertMercadoPagoPixConfig,
  upsertPoloPagPixConfig,
} from "lib/payments";

const MERCADO_PAGO_CREDENTIALS_URL =
  "https://www.mercadopago.com.br/developers/panel/app";

const maskCredential = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length <= 8) return "••••••••";
  return `${normalized.slice(0, 4)}••••${normalized.slice(-4)}`;
};

const loadSettings = async (userId: number) => {
  const [mercadoPago, poloPag] = await Promise.all([
    getMercadoPagoPixConfigForUser(userId),
    getPoloPagPixConfigForUser(userId),
  ]);
  const mercadoPagoReady =
    mercadoPago.isConfigured &&
    mercadoPago.isActive &&
    Boolean(mercadoPago.accessToken);
  const poloPagReady =
    poloPag.isConfigured && poloPag.isActive && Boolean(poloPag.apiKey);

  return {
    configured: mercadoPagoReady || poloPagReady,
    activeProvider: poloPagReady
      ? "polopag_pix"
      : mercadoPagoReady
        ? "mercadopago_pix"
        : null,
    mercadoPago: {
      isActive: mercadoPago.isActive,
      isConfigured: mercadoPago.isConfigured,
      credentialMask: maskCredential(mercadoPago.accessToken),
      pixExpirationMinutes: mercadoPago.pixExpirationMinutes,
      updatedAt: mercadoPago.updatedAt,
    },
    poloPag: {
      isActive: poloPag.isActive,
      isConfigured: poloPag.isConfigured,
      credentialMask: maskCredential(poloPag.apiKey),
      pixExpirationMinutes: poloPag.pixExpirationMinutes,
      updatedAt: poloPag.updatedAt,
    },
    links: {
      mercadoPagoCredentials: MERCADO_PAGO_CREDENTIALS_URL,
    },
  };
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  try {
    return NextResponse.json({ settings: await loadSettings(user.id) });
  } catch (error) {
    console.error("[raffles] failed to load payment settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as credenciais de pagamento." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body) {
    return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
  }

  const provider =
    body.provider === "polopag_pix" ? "polopag_pix" : "mercadopago_pix";
  const credential =
    typeof body.credential === "string" ? body.credential.trim() : "";
  const expirationRaw = Number(body.pixExpirationMinutes ?? 30);
  const pixExpirationMinutes = Number.isFinite(expirationRaw)
    ? Math.min(1440, Math.max(5, Math.trunc(expirationRaw)))
    : 30;

  try {
    const [currentMercadoPago, currentPoloPag] = await Promise.all([
      getMercadoPagoPixConfigForUser(user.id),
      getPoloPagPixConfigForUser(user.id),
    ]);

    if (provider === "mercadopago_pix") {
      const accessToken = credential || currentMercadoPago.accessToken;
      if (!accessToken) {
        return NextResponse.json(
          { message: "Informe o Access Token do Mercado Pago." },
          { status: 400 },
        );
      }
      await Promise.all([
        upsertMercadoPagoPixConfig({
          userId: user.id,
          isActive: true,
          displayName: currentMercadoPago.displayName,
          accessToken,
          publicKey: currentMercadoPago.publicKey,
          pixKey: currentMercadoPago.pixKey,
          pixExpirationMinutes,
          amountOptions: currentMercadoPago.amountOptions,
          instructions: currentMercadoPago.instructions,
        }),
        currentPoloPag.isConfigured
          ? upsertPoloPagPixConfig({
              userId: user.id,
              isActive: false,
              displayName: currentPoloPag.displayName,
              apiKey: currentPoloPag.apiKey,
              pixExpirationMinutes: currentPoloPag.pixExpirationMinutes,
              amountOptions: currentPoloPag.amountOptions,
              instructions: currentPoloPag.instructions,
              webhookUrl: currentPoloPag.webhookUrl,
            })
          : Promise.resolve(null),
      ]);
    } else {
      const apiKey = credential || currentPoloPag.apiKey;
      if (!apiKey) {
        return NextResponse.json(
          { message: "Informe a chave da API da PoloPag." },
          { status: 400 },
        );
      }
      await Promise.all([
        upsertPoloPagPixConfig({
          userId: user.id,
          isActive: true,
          displayName: currentPoloPag.displayName,
          apiKey,
          pixExpirationMinutes,
          amountOptions: currentPoloPag.amountOptions,
          instructions: currentPoloPag.instructions,
          webhookUrl: currentPoloPag.webhookUrl,
        }),
        currentMercadoPago.isConfigured
          ? upsertMercadoPagoPixConfig({
              userId: user.id,
              isActive: false,
              displayName: currentMercadoPago.displayName,
              accessToken: currentMercadoPago.accessToken,
              publicKey: currentMercadoPago.publicKey,
              pixKey: currentMercadoPago.pixKey,
              pixExpirationMinutes:
                currentMercadoPago.pixExpirationMinutes,
              amountOptions: currentMercadoPago.amountOptions,
              instructions: currentMercadoPago.instructions,
            })
          : Promise.resolve(null),
      ]);
    }

    return NextResponse.json({
      message: "Recebimento da rifa configurado.",
      settings: await loadSettings(user.id),
    });
  } catch (error) {
    console.error("[raffles] failed to update payment settings", error);
    return NextResponse.json(
      { message: "Não foi possível salvar as credenciais de pagamento." },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
