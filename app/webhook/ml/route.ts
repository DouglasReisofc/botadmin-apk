import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { completeAffiliateOAuthCallback } from "lib/affiliate-connections";

export const runtime = "nodejs";
export const maxDuration = 60;

const meliTokenHelper = (() => {
  try {
    const helperPath = path.join(process.cwd(), "lib", "integrations", "apis", "funcoes", "meli-token.js");
    return (eval("require") as NodeRequire)(helperPath);
  } catch (error) {
    console.error("[meli-webhook] Não foi possível carregar helper de tokens:", error);
    return null;
  }
})();

const OAUTH_DASHBOARD_FALLBACK = "/dashboard/user?section=affiliates&provider=mercadolivre";

const sanitizeMessageForQuery = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

const buildOAuthRedirectUrl = (
  request: NextRequest,
  returnTo: string | null | undefined,
  status: "success" | "error",
  message?: string | null,
) => {
  const base = new URL(request.url);
  const target = new URL(returnTo && returnTo.startsWith("/") ? returnTo : OAUTH_DASHBOARD_FALLBACK, base.origin);
  target.searchParams.set("section", "affiliates");
  target.searchParams.set("provider", "mercadolivre");
  target.searchParams.set("oauth", status);
  if (message) {
    target.searchParams.set("oauth_message", sanitizeMessageForQuery(message));
  } else {
    target.searchParams.delete("oauth_message");
  }
  return target;
};

export const GET = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error") || searchParams.get("error_description");

  console.log("[meli-webhook] Query params received:", {
    state: state ? `${state.slice(0, 6)}...` : null,
    hasCode: Boolean(code),
    error: error || null,
  });

  if (state) {
    if (error) {
      return NextResponse.redirect(
        buildOAuthRedirectUrl(
          request,
          OAUTH_DASHBOARD_FALLBACK,
          "error",
          "Mercado Livre retornou erro ao autorizar sua conta.",
        ),
      );
    }

    if (!code) {
      return NextResponse.redirect(
        buildOAuthRedirectUrl(
          request,
          OAUTH_DASHBOARD_FALLBACK,
          "error",
          "Código OAuth ausente na resposta do Mercado Livre.",
        ),
      );
    }

    try {
      const result = await completeAffiliateOAuthCallback("mercadolivre", {
        state,
        code,
      });
      return NextResponse.redirect(
        buildOAuthRedirectUrl(request, result.returnTo, "success", "Conta conectada com sucesso."),
      );
    } catch (oauthError: any) {
      const message =
        oauthError instanceof Error && oauthError.message
          ? oauthError.message
          : "Não foi possível concluir a conexão OAuth.";
      return NextResponse.redirect(
        buildOAuthRedirectUrl(request, OAUTH_DASHBOARD_FALLBACK, "error", message),
      );
    }
  }

  if (error) {
    return NextResponse.json(
      {
        status: false,
        message: "Mercado Livre retornou um erro ao autorizar o aplicativo.",
        error,
      },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      {
        status: false,
        message:
          "Nenhum parâmetro ?code foi enviado. Acesse o link de autorização do Mercado Livre antes de chegar aqui.",
      },
      { status: 400 },
    );
  }

  if (meliTokenHelper?.exchangeCodeForTokens) {
    try {
      const tokenData = await meliTokenHelper.exchangeCodeForTokens(code);
      return NextResponse.json({
        status: true,
        message: "Tokens do Mercado Livre atualizados com sucesso.",
        token: {
          expires_at: tokenData.expires_at,
          has_refresh_token: Boolean(tokenData.refresh_token),
        },
      });
    } catch (err: any) {
      console.error("[meli-webhook] Falha ao trocar o código automaticamente:", err?.message || err);
    }
  }

  return NextResponse.json({
    status: true,
    message:
      "Copie o código abaixo e informe ao suporte/desenvolvimento para finalizarmos a troca por tokens.",
    code,
    state,
  });
};

const normalizeNotificationPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return { raw: payload };
  }

  const value = payload as Record<string, unknown>;
  return {
    _id: value._id ?? null,
    topic: value.topic ?? null,
    resource: value.resource ?? null,
    user_id: value.user_id ?? null,
    application_id: value.application_id ?? null,
    attempts: value.attempts ?? null,
    sent: value.sent ?? null,
    received_at: new Date().toISOString(),
  };
};

export const POST = async (request: NextRequest) => {
  let payload: unknown = null;

  try {
    payload = await request.json();
  } catch {
    // Mercado Livre deve receber 200 rapidamente; seguimos mesmo com body inválido.
    payload = null;
  }

  const normalized = normalizeNotificationPayload(payload);
  const headers = {
    "x-request-id": request.headers.get("x-request-id"),
    "x-real-ip": request.headers.get("x-real-ip"),
    "x-forwarded-for": request.headers.get("x-forwarded-for"),
    "user-agent": request.headers.get("user-agent"),
    "content-type": request.headers.get("content-type"),
  };

  console.log("[meli-webhook] Notification received:", {
    headers,
    notification: normalized,
  });

  return NextResponse.json(
    {
      status: true,
      message: "Notification received",
    },
    { status: 200 },
  );
};
