import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getAdminMercadoPagoCheckoutConfig,
  upsertAdminMercadoPagoCheckoutConfig,
} from "lib/admin-payments";
import { getPublicAppBaseUrl } from "lib/meta";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
};

const redirectUri = () =>
  `${getPublicAppBaseUrl().replace(/\/$/, "")}/api/payments/mercadopago/oauth/callback`;

const protectMarketplaceConfig = (
  config: Awaited<ReturnType<typeof getAdminMercadoPagoCheckoutConfig>>,
) => {
  const hasClientId = Boolean(config.marketplaceClientId?.trim());
  const hasClientSecret = Boolean(config.marketplaceClientSecret?.trim());

  return {
    displayName: "Mercado Pago Marketplace / Split",
    isActive: hasClientId && hasClientSecret,
    isConfigured: hasClientId && hasClientSecret,
    marketplaceClientId: config.marketplaceClientId ?? "",
    marketplaceClientSecret: "",
    credentialFields: {
      marketplaceClientId: hasClientId,
      marketplaceClientSecret: hasClientSecret,
    },
    redirectUri: redirectUri(),
    updatedAt: config.updatedAt,
  };
};

const ensureAdmin = async () => {
  const user = await getCurrentUser();
  if (!user) return { error: "Não autenticado.", status: 401 } as const;
  if (user.role !== "admin" || user.isImpersonated) {
    return { error: "Acesso restrito ao administrador autenticado.", status: 403 } as const;
  }
  return { user } as const;
};

export async function GET() {
  try {
    const auth = await ensureAdmin();
    if ("error" in auth) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    const config = await getAdminMercadoPagoCheckoutConfig();
    return NextResponse.json(
      { config: protectMarketplaceConfig(config) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("Failed to load Mercado Pago marketplace credentials", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as credenciais do Marketplace." },
      { status: 500, headers: noStoreHeaders },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await ensureAdmin();
    if ("error" in auth) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const current = await getAdminMercadoPagoCheckoutConfig();
    const data = body as Record<string, unknown>;
    const clear = data.clearMarketplaceCredentials === true;
    const providedClientId = typeof data.marketplaceClientId === "string"
      ? data.marketplaceClientId.trim()
      : "";
    const providedClientSecret = typeof data.marketplaceClientSecret === "string"
      ? data.marketplaceClientSecret.trim()
      : "";
    const marketplaceClientId = clear
      ? ""
      : providedClientId || current.marketplaceClientId || "";
    const marketplaceClientSecret = clear
      ? ""
      : providedClientSecret || current.marketplaceClientSecret || "";

    if (!clear && (!marketplaceClientId || !marketplaceClientSecret)) {
      return NextResponse.json(
        { message: "Informe o Client ID e o Client Secret do aplicativo Mercado Pago." },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const config = await upsertAdminMercadoPagoCheckoutConfig({
      isActive: current.isActive,
      displayName: current.displayName,
      accessToken: current.accessToken,
      publicKey: current.publicKey,
      notificationUrl: current.notificationUrl,
      amountOptions: current.amountOptions,
      allowedPaymentTypes: current.allowedPaymentTypes,
      allowedPaymentMethods: current.allowedPaymentMethods,
      marketplaceClientId,
      marketplaceClientSecret,
      clearMarketplaceCredentials: clear,
    });

    return NextResponse.json(
      {
        message: clear
          ? "Credenciais do Mercado Pago Marketplace removidas."
          : "Credenciais do Mercado Pago Marketplace salvas com sucesso.",
        config: protectMarketplaceConfig(config),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("Failed to update Mercado Pago marketplace credentials", error);
    return NextResponse.json(
      { message: "Não foi possível salvar as credenciais do Marketplace." },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
