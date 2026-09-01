import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createBotAdminMcpServer } from "lib/mcp/botadmin-server";
import { validateBotAdminMcpOAuthAccessToken } from "lib/mcp/oauth";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization,content-type,mcp-protocol-version,mcp-session-id,x-botadmin-mcp-token",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const getBearerToken = (req: Request): string | null => {
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  return req.headers.get("x-botadmin-mcp-token")?.trim() || null;
};

const isLocalRequest = (req: Request): boolean => {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host.startsWith("[::1]:");
};

const authorize = async (req: Request): Promise<{ publicMode: boolean } | Response> => {
  const expected = process.env.BOTADMIN_MCP_TOKEN?.trim();
  if (!expected) {
    if (isLocalRequest(req)) {
      return { publicMode: false };
    }
    return new Response(JSON.stringify({ error: "Configure BOTADMIN_MCP_TOKEN before exposing MCP." }), {
      status: 503,
      headers: {
        "content-type": "application/json",
        ...corsHeaders,
      },
    });
  }
  const received = getBearerToken(req);
  if (received && received === expected) {
    return { publicMode: false };
  }
  const oauthToken = await validateBotAdminMcpOAuthAccessToken(received);
  if (oauthToken) {
    return { publicMode: oauthToken.mode !== "full" };
  }
  return new Response(JSON.stringify({ error: "Unauthorized MCP request." }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      ...corsHeaders,
    },
  });
};

const handleMcpRequest = async (req: Request): Promise<Response> => {
  const authorization = await authorize(req);
  if (authorization instanceof Response) {
    return authorization;
  }

  const server = createBotAdminMcpServer({ publicMode: authorization.publicMode });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(req);
  return withCors(response);
};

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
