import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getMercadoPagoNotificationUrl,
} from "lib/payments";
import {
  getAdminMercadoPagoPixConfig,
  protectAdminMercadoPagoPixConfig,
  upsertAdminMercadoPagoPixConfig,
} from "lib/admin-payments";

const parseAmountOptions = (input: unknown): number[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((value) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "string" && value.trim()) {
        const normalized = value.trim().replace(/[^0-9,.-]/g, "");
        const usesComma = normalized.includes(",");
        const sanitized = usesComma
          ? normalized.replace(/\./g, "").replace(/,/g, ".")
          : normalized;
        const parsed = Number.parseFloat(sanitized);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }

      return null;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
};

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const config = await getAdminMercadoPagoPixConfig();
    return NextResponse.json(
      { config: protectAdminMercadoPagoPixConfig(config) },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Failed to load admin Mercado Pago config", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações de pagamento." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      accessToken,
      isActive,
      displayName,
      publicKey,
      pixKey,
      notificationUrl,
      pixExpirationMinutes,
      amountOptions,
      instructions,
    } = body as Record<string, unknown>;

    const currentConfig = await getAdminMercadoPagoPixConfig();
    const clearCredential = (body as Record<string, unknown>).clearCredential === true;
    const providedAccessToken = typeof accessToken === "string" ? accessToken.trim() : "";
    const sanitizedAccessToken = clearCredential
      ? ""
      : providedAccessToken || currentConfig.accessToken;
    const sanitizedDisplayName = typeof displayName === "string" ? displayName : null;
    const hasPublicKey = Object.prototype.hasOwnProperty.call(body, "publicKey");
    const hasPixKey = Object.prototype.hasOwnProperty.call(body, "pixKey");
    const sanitizedPublicKey = hasPublicKey && typeof publicKey === "string"
      ? publicKey
      : currentConfig.publicKey;
    const sanitizedPixKey = hasPixKey && typeof pixKey === "string"
      ? pixKey
      : currentConfig.pixKey;
    const defaultNotificationUrl = getMercadoPagoNotificationUrl();
    const sanitizedNotificationUrl =
      typeof notificationUrl === "string" && notificationUrl.trim().length > 0
        ? notificationUrl
        : defaultNotificationUrl;
    const sanitizedInstructions = typeof instructions === "string" ? instructions : null;

    const expirationMinutes = typeof pixExpirationMinutes === "number"
      ? pixExpirationMinutes
      : typeof pixExpirationMinutes === "string" && pixExpirationMinutes.trim()
        ? Number.parseInt(pixExpirationMinutes, 10)
        : undefined;

    const desiredActive = Boolean(isActive);
    const amountList = parseAmountOptions(amountOptions);

    if (!sanitizedAccessToken.trim() && desiredActive) {
      return NextResponse.json(
        { message: "Informe o access token do Mercado Pago para ativar o Pix." },
        { status: 400 },
      );
    }

    const config = await upsertAdminMercadoPagoPixConfig({
      isActive: desiredActive,
      displayName: sanitizedDisplayName,
      accessToken: sanitizedAccessToken,
      publicKey: sanitizedPublicKey,
      pixKey: sanitizedPixKey,
      notificationUrl: sanitizedNotificationUrl,
      pixExpirationMinutes: expirationMinutes,
      amountOptions: amountList,
      instructions: sanitizedInstructions,
    });

    return NextResponse.json({
      message: "Configurações do Mercado Pago Pix atualizadas com sucesso.",
      config: protectAdminMercadoPagoPixConfig(config),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("Failed to update admin Mercado Pago config", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações de pagamento." },
      { status: 500 },
    );
  }
}
