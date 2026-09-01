import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getAdminPoloPagPixConfig,
  protectAdminPoloPagPixConfig,
  upsertAdminPoloPagPixConfig,
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

    const config = await getAdminPoloPagPixConfig();
    return NextResponse.json(
      { config: protectAdminPoloPagPixConfig(config) },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Failed to load admin PoloPag config", error);
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
      apiKey,
      isActive,
      displayName,
      pixExpirationMinutes,
      amountOptions,
      instructions,
      webhookUrl,
    } = body as Record<string, unknown>;

    const currentConfig = await getAdminPoloPagPixConfig();
    const clearCredential = (body as Record<string, unknown>).clearCredential === true;
    const providedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    const sanitizedApiKey = clearCredential ? "" : providedApiKey || currentConfig.apiKey;
    const sanitizedDisplayName = typeof displayName === "string" ? displayName : null;
    const sanitizedInstructions = typeof instructions === "string" ? instructions : null;
    const sanitizedWebhookUrl = typeof webhookUrl === "string" ? webhookUrl : null;

    const expirationMinutes = typeof pixExpirationMinutes === "number"
      ? pixExpirationMinutes
      : typeof pixExpirationMinutes === "string" && pixExpirationMinutes.trim()
        ? Number.parseInt(pixExpirationMinutes, 10)
        : undefined;

    const desiredActive = Boolean(isActive);
    const amountList = parseAmountOptions(amountOptions);

    if (!sanitizedApiKey.trim() && desiredActive) {
      return NextResponse.json(
        { message: "Informe a chave da API da PoloPag para ativar o Pix." },
        { status: 400 },
      );
    }

    const config = await upsertAdminPoloPagPixConfig({
      isActive: desiredActive,
      displayName: sanitizedDisplayName,
      apiKey: sanitizedApiKey,
      pixExpirationMinutes: expirationMinutes,
      amountOptions: amountList,
      instructions: sanitizedInstructions,
      webhookUrl: sanitizedWebhookUrl,
    });

    return NextResponse.json({
      message: "Configurações do PoloPag Pix atualizadas com sucesso.",
      config: protectAdminPoloPagPixConfig(config),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("Failed to update admin PoloPag config", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações de pagamento." },
      { status: 500 },
    );
  }
}
