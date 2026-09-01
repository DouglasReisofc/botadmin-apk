export const runtime = "nodejs";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createBotAdminMcpServer } from "lib/mcp/botadmin-server";

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

const handlePublicMcpRequest = async (req: Request): Promise<Response> => {
  const server = createBotAdminMcpServer({ publicMode: true });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(req);
  return withCors(response);
};

export const GET = handlePublicMcpRequest;
export const POST = handlePublicMcpRequest;
export const DELETE = handlePublicMcpRequest;

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
