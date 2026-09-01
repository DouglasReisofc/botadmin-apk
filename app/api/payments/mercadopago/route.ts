import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getMercadoPagoNotificationUrl, upsertMercadoPagoPixConfig } from "lib/payments";

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

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
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

    const sanitizedAccessToken = typeof accessToken === "string" ? accessToken : "";
    const sanitizedDisplayName = typeof displayName === "string" ? displayName : null;
    const sanitizedPublicKey = typeof publicKey === "string" ? publicKey : null;
    const sanitizedPixKey = typeof pixKey === "string" ? pixKey : null;
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

    const config = await upsertMercadoPagoPixConfig({
      userId: user.id,
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
      config,
    });
  } catch (error) {
    console.error("Failed to update Mercado Pago config", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações de pagamento." },
      { status: 500 },
    );
  }
}
