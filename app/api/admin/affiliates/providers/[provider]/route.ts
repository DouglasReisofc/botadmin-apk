import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { listAdminAffiliateProviderSettings, updateAdminAffiliateProviderSettings } from "lib/admin-affiliate-providers";
import type { AdminAffiliateProviderUpdatePayload } from "types/admin-affiliates";

type RouteContext = { params: Promise<{ provider: string }> | { provider: string } };

const resolveProviderFromParams = async (context: RouteContext): Promise<string> => {
  const params = await Promise.resolve(context.params);
  return String(params.provider || "").trim();
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Nao autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ status: false, message: "Acesso restrito." }, { status: 403 });
    }

    const provider = await resolveProviderFromParams(context);
    const settings = await listAdminAffiliateProviderSettings();
    const item = settings.find((entry) => entry.provider === provider);
    if (!item) {
      return NextResponse.json({ status: false, message: "Provedor invalido." }, { status: 404 });
    }

    return NextResponse.json({ status: true, provider: item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar o provedor.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Nao autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ status: false, message: "Acesso restrito." }, { status: 403 });
    }

    const provider = await resolveProviderFromParams(context);
    const payload = (await request.json().catch(() => ({}))) as AdminAffiliateProviderUpdatePayload;
    const updated = await updateAdminAffiliateProviderSettings(provider, payload);
    return NextResponse.json({
      status: true,
      message: "Configuracao do provedor atualizada com sucesso.",
      provider: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel atualizar o provedor.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
