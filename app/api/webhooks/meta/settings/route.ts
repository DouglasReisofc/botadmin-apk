import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getWebhookRowForUser, updateWebhookConfig } from "lib/webhooks";

const MAX_VERIFY_TOKEN = 128;
const MAX_APP_ID = 64;
const MAX_BUSINESS_ACCOUNT_ID = 64;
const MAX_PHONE_NUMBER_ID = 64;
const MAX_ACCESS_TOKEN = 4096;

const sanitizeRequiredString = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const sanitizeOptionalString = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const maskToken = (value: string | null | undefined) => {
  const token = value?.trim() ?? "";
  if (!token) {
    return null;
  }
  if (token.length <= 10) {
    return "********";
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
};

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const webhook = await getWebhookRowForUser(user.id);
    if (!webhook) {
      return NextResponse.json({ webhook: null });
    }

    return NextResponse.json({
      webhook: {
        id: webhook.id,
        verifyToken: webhook.verify_token,
        appId: webhook.app_id,
        businessAccountId: webhook.business_account_id,
        phoneNumberId: webhook.phone_number_id,
        accessTokenPresent: Boolean(webhook.access_token),
        accessTokenPreview: maskToken(webhook.access_token),
        updatedAt: webhook.updated_at?.toISOString?.() ?? webhook.updated_at,
        lastEventAt: webhook.last_event_at?.toISOString?.() ?? webhook.last_event_at ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to load webhook settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações do webhook." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);

    if (!payload) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const verifyToken = sanitizeRequiredString(payload.verifyToken, MAX_VERIFY_TOKEN);

    if (!verifyToken) {
      return NextResponse.json(
        { message: "Informe um verify token válido." },
        { status: 400 },
      );
    }

    const appId = sanitizeOptionalString(payload.appId, MAX_APP_ID);
    const businessAccountId = sanitizeOptionalString(
      payload.businessAccountId,
      MAX_BUSINESS_ACCOUNT_ID,
    );
    const phoneNumberId = sanitizeOptionalString(payload.phoneNumberId, MAX_PHONE_NUMBER_ID);
    const currentWebhook = await getWebhookRowForUser(user.id);
    const accessToken =
      "accessToken" in payload
        ? sanitizeOptionalString(payload.accessToken, MAX_ACCESS_TOKEN)
        : currentWebhook?.access_token ?? null;

    const webhook = await updateWebhookConfig(user.id, {
      verifyToken,
      appId,
      businessAccountId,
      phoneNumberId,
      accessToken,
    });

    if (!webhook) {
      return NextResponse.json(
        { message: "Não foi possível atualizar o webhook." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: "Configurações do webhook atualizadas com sucesso.",
      webhook,
    });
  } catch (error) {
    console.error("Failed to update webhook settings", error);
    return NextResponse.json(
      { message: "Não foi possível salvar as configurações do webhook." },
      { status: 500 },
    );
  }
}
