import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getAdminWebhookDetails,
  getRecentAdminWebhookEvents,
  updateAdminWebhookConfig,
} from "lib/admin-webhooks";

const MAX_VERIFY_TOKEN = 128;
const MAX_APP_ID = 64;
const MAX_BUSINESS_ACCOUNT_ID = 64;
const MAX_PHONE_NUMBER_ID = 64;
const MAX_ACCESS_TOKEN = 4096;
const MAX_PHONE_NUMBER = 32;

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

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const [webhook, events] = await Promise.all([
      getAdminWebhookDetails(),
      getRecentAdminWebhookEvents(25),
    ]);

    return NextResponse.json({ webhook, events });
  } catch (error) {
    console.error("Failed to load admin webhook", error);
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

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
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
    const accessToken = sanitizeOptionalString(payload.accessToken, MAX_ACCESS_TOKEN);
    const phoneNumber = sanitizeOptionalString(payload.phoneNumber, MAX_PHONE_NUMBER);

    const webhook = await updateAdminWebhookConfig({
      verifyToken,
      appId,
      businessAccountId,
      phoneNumberId,
      phoneNumber,
      accessToken,
    });

    return NextResponse.json({
      message: "Configurações do webhook atualizadas com sucesso.",
      webhook,
    });
  } catch (error) {
    console.error("Failed to update admin webhook", error);
    return NextResponse.json(
      { message: "Não foi possível salvar as configurações do webhook." },
      { status: 500 },
    );
  }
}
