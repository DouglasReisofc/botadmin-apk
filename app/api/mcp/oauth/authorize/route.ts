import { NextRequest } from "next/server";

import {
  createBotAdminMcpOAuthCode,
  getBotAdminMcpOAuthClientId,
  isValidBotAdminMcpOAuthClient,
} from "lib/mcp/oauth";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

const jsonError = (message: string, status = 400) =>
  Response.json({ error: "invalid_request", error_description: message }, { status, headers: corsHeaders });

const redirectError = (redirectUri: string | null, message: string, state: string | null, status = 302) => {
  if (!redirectUri) {
    return jsonError(message, status === 302 ? 400 : status);
  }
  const target = new URL(redirectUri);
  target.searchParams.set("error", "invalid_request");
  target.searchParams.set("error_description", message);
  if (state) {
    target.searchParams.set("state", state);
  }
  return Response.redirect(target, status);
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const responseType = params.get("response_type")?.trim();
  const clientId = params.get("client_id")?.trim();
  const redirectUri = params.get("redirect_uri")?.trim();
  const state = params.get("state")?.trim() || null;
  const codeChallenge = params.get("code_challenge")?.trim();
  const rawCodeChallengeMethod = params.get("code_challenge_method")?.trim() || "S256";
  const codeChallengeMethod = rawCodeChallengeMethod.toUpperCase() === "S256" ? "S256" : rawCodeChallengeMethod.toLowerCase();
  const scope = params.get("scope")?.trim() || "mcp:public";

  if (responseType !== "code") {
    return redirectError(redirectUri ?? null, "response_type deve ser code.", state);
  }
  if (!isValidBotAdminMcpOAuthClient(clientId)) {
    return redirectError(redirectUri ?? null, `client_id invalido. Use ${getBotAdminMcpOAuthClientId()}.`, state);
  }
  if (!redirectUri) {
    return jsonError("redirect_uri obrigatorio.");
  }
  if (!codeChallenge) {
    return redirectError(redirectUri, "PKCE code_challenge obrigatorio.", state);
  }
  if (codeChallengeMethod !== "S256" && codeChallengeMethod !== "plain") {
    return redirectError(redirectUri, "code_challenge_method deve ser S256 ou plain.", state);
  }

  try {
    const code = await createBotAdminMcpOAuthCode({
      clientId: clientId!,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope,
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (state) {
      target.searchParams.set("state", state);
    }
    return Response.redirect(target, 302);
  } catch (error) {
    return redirectError(
      redirectUri,
      error instanceof Error ? error.message : "Falha ao criar authorization code.",
      state,
    );
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
