import { NextRequest } from "next/server";

import {
  exchangeBotAdminMcpOAuthCode,
  getBotAdminMcpOAuthClientId,
  isValidBotAdminMcpOAuthClient,
} from "lib/mcp/oauth";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

const jsonError = (message: string, status = 400) =>
  Response.json(
    { error: status === 401 ? "invalid_client" : "invalid_grant", error_description: message },
    { status, headers: corsHeaders },
  );

const readBasicClientId = (req: NextRequest): string | null => {
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const match = auth.match(/^Basic\s+(.+)$/i);
  if (!match?.[1]) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    return decoded.split(":")[0]?.trim() || null;
  } catch {
    return null;
  }
};

const readBodyParams = async (req: NextRequest) => {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    return new URLSearchParams(
      Object.entries(body as Record<string, unknown>)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
  }
  const text = await req.text();
  return new URLSearchParams(text);
};

export async function POST(req: NextRequest) {
  const params = await readBodyParams(req);
  const grantType = params.get("grant_type")?.trim();
  const code = params.get("code")?.trim();
  const redirectUri = params.get("redirect_uri")?.trim();
  const clientId = params.get("client_id")?.trim() || readBasicClientId(req);
  const codeVerifier = params.get("code_verifier")?.trim();

  if (grantType !== "authorization_code") {
    return jsonError("grant_type deve ser authorization_code.");
  }
  if (!isValidBotAdminMcpOAuthClient(clientId)) {
    return jsonError(`client_id invalido. Use ${getBotAdminMcpOAuthClientId()}.`, 401);
  }
  if (!code || !redirectUri || !codeVerifier) {
    return jsonError("code, redirect_uri e code_verifier sao obrigatorios.");
  }

  try {
    const result = await exchangeBotAdminMcpOAuthCode({
      code,
      clientId: clientId!,
      redirectUri,
      codeVerifier,
    });
    return Response.json(
      {
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        scope: result.token.scope,
      },
      { headers: { "cache-control": "no-store", pragma: "no-cache", ...corsHeaders } },
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Falha ao trocar authorization code.");
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
