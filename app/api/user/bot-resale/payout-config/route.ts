import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getBotResalePayoutConfigForClient,
  getBotResalePayoutConfigForUser,
  upsertBotResalePayoutConfig,
} from "lib/bot-resale-payout-config";
import { validateMercadoPagoAccessToken } from "lib/mercadopago";
import type { BotResalePayoutMode } from "types/payments";

const parseMode = (value: unknown): BotResalePayoutMode | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "automatic" || normalized === "manual") {
    return normalized;
  }
  return null;
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const config = await getBotResalePayoutConfigForClient(user.id);
    return NextResponse.json({ config });
  } catch (error) {
    console.error("[bot-resale/payout-config] GET failed", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a configuração de pagamentos." },
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const record = body as Record<string, unknown>;
    const mode = parseMode(record.mode);
    if (!mode) {
      return NextResponse.json({ message: "Modo de pagamento inválido." }, { status: 400 });
    }

    if (mode === "manual") {
      const pixKey = typeof record.pixKey === "string" ? record.pixKey.trim() : "";
      const pixKeyConfirm = typeof record.pixKeyConfirm === "string" ? record.pixKeyConfirm.trim() : "";
      const recipientFullName = typeof record.recipientFullName === "string"
        ? record.recipientFullName.trim()
        : "";

      if (!pixKey) {
        return NextResponse.json({ message: "Informe a chave Pix." }, { status: 400 });
      }
      if (!recipientFullName) {
        return NextResponse.json({ message: "Informe o nome completo do recebedor." }, { status: 400 });
      }
      if (!pixKeyConfirm) {
        return NextResponse.json({ message: "Confirme a chave Pix." }, { status: 400 });
      }
      if (pixKey !== pixKeyConfirm) {
        return NextResponse.json({ message: "As chaves Pix informadas não conferem." }, { status: 400 });
      }

      const config = await upsertBotResalePayoutConfig({
        userId: user.id,
        mode: "manual",
        pixKey,
        recipientFullName,
        isActive: true,
      });

      return NextResponse.json({
        message: "Pagamentos manual configurados com sucesso.",
        config: await getBotResalePayoutConfigForClient(user.id),
      });
    }

    const accessTokenInput = typeof record.accessToken === "string" ? record.accessToken.trim() : "";
    const existing = await getBotResalePayoutConfigForUser(user.id);
    const accessToken = accessTokenInput || existing.accessToken || "";
    if (!accessToken) {
      return NextResponse.json(
        { message: "Informe o access token do Mercado Pago." },
        { status: 400 },
      );
    }

    const validatedAccount = accessTokenInput
      ? await validateMercadoPagoAccessToken(accessToken)
      : existing.mercadoPagoAccount
        ? {
            id: existing.mercadoPagoAccount.id,
            nickname: existing.mercadoPagoAccount.nickname,
            email: existing.mercadoPagoAccount.email,
            firstName: existing.mercadoPagoAccount.firstName,
            lastName: existing.mercadoPagoAccount.lastName,
            countryId: existing.mercadoPagoAccount.countryId,
            siteId: existing.mercadoPagoAccount.siteId,
            validatedAt: existing.mercadoPagoAccount.validatedAt ?? new Date().toISOString(),
          }
        : await validateMercadoPagoAccessToken(accessToken);

    await upsertBotResalePayoutConfig({
      userId: user.id,
      mode: "automatic",
      accessToken,
      mercadoPagoAccount: validatedAccount,
      isActive: true,
    });

    return NextResponse.json({
      message: "Token validado e pagamentos automático configurados com sucesso.",
      config: await getBotResalePayoutConfigForClient(user.id),
      mercadoPagoAccount: validatedAccount,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Não foi possível salvar a configuração de pagamentos.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";