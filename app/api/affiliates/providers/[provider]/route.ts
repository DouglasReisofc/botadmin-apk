import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  disconnectAffiliateProviderForUser,
  getAffiliateProviderSummaryForUser,
  refreshAffiliateProviderTokenForUser,
  selectAffiliateProviderConnectionForUser,
  upsertAffiliateProviderCredentialsForUser,
} from "lib/affiliate-connections";

type RouteContext = { params: Promise<{ provider: string }> | { provider: string } };

const resolveProviderFromParams = async (context: RouteContext): Promise<string> => {
  const params = await Promise.resolve(context.params);
  return String(params.provider || "").trim();
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const provider = await resolveProviderFromParams(context);
    const summary = await getAffiliateProviderSummaryForUser(user.id, provider);
    return NextResponse.json({ status: true, provider: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar provedor.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const provider = await resolveProviderFromParams(context);
    const payload = await request.json().catch(() => ({}));
    const action = typeof payload?.action === "string" ? payload.action.trim().toLowerCase() : "refresh";

    if (action === "refresh") {
      const summary = await refreshAffiliateProviderTokenForUser(user.id, provider, {
        connectionId: Number(payload?.connectionId),
      });
      return NextResponse.json({ status: true, provider: summary, message: "Token atualizado com sucesso." });
    }

    if (action === "select_account") {
      const connectionId = Math.floor(Number(payload?.connectionId));
      if (!Number.isFinite(connectionId) || connectionId <= 0) {
        return NextResponse.json({ status: false, message: "Conta inválida para seleção." }, { status: 400 });
      }
      const summary = await selectAffiliateProviderConnectionForUser(user.id, provider, connectionId);
      return NextResponse.json({ status: true, provider: summary, message: "Conta selecionada com sucesso." });
    }

    if (action === "save_credentials") {
      const summary = await upsertAffiliateProviderCredentialsForUser(user.id, provider, {
        appId: payload?.appId,
        clientSecret: payload?.clientSecret,
        appToken: payload?.appToken,
        accountName: payload?.accountName,
        connectionId: payload?.connectionId,
        select: payload?.select,
      });
      return NextResponse.json({
        status: true,
        provider: summary,
        message: "Credenciais da conta salvas com sucesso.",
      });
    }

    return NextResponse.json({ status: false, message: "Ação inválida." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o token.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const provider = await resolveProviderFromParams(context);
    const { searchParams } = new URL(request.url);
    const connectionId = Math.floor(Number(searchParams.get("connectionId")));
    const summary = await disconnectAffiliateProviderForUser(user.id, provider, {
      connectionId: Number.isFinite(connectionId) && connectionId > 0 ? connectionId : null,
    });
    return NextResponse.json({ status: true, provider: summary, message: "Conta desconectada com sucesso." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível desconectar a conta.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
