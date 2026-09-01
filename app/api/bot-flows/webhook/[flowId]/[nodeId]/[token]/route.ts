import { NextResponse } from "next/server";

import {
  createBotFlowResult,
  getBotFlowWebhookForPublicToken,
  listWaitingBotFlowWebhookSessions,
  logBotFlowEvent,
  recordBotFlowWebhookEvent,
  updateBotFlowSessionState,
} from "lib/bot-flows";
import { executeBotFlow } from "lib/bot-events/message-handler";
import { getInstanceById } from "lib/bot-instances";
import type { WuzapiClient } from "lib/wuzapi";
import type { BotFlow } from "types/bot-flows";

const parseFlowId = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const parseRequestBody = async (request: Request) => {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await request.text().catch(() => "");
  if (!text) return null;
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  return { raw: text };
};

const flattenVariables = (value: unknown, prefix: string, output: Record<string, string> = {}, depth = 0) => {
  if (value === null || value === undefined || depth > 4) return output;
  if (typeof value !== "object") {
    output[prefix] = String(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((entry, index) => flattenVariables(entry, `${prefix}_${index}`, output, depth + 1));
    return output;
  }
  Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, entry]) => {
    const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (cleanKey) flattenVariables(entry, `${prefix}_${cleanKey}`, output, depth + 1);
  });
  return output;
};

const readPath = (source: unknown, path: string): unknown => {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current = source;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
};

const mappedWebhookVariables = (node: { webhookResponseMappings?: Array<{ path?: string; variable?: string }> }, data: unknown) => {
  const output: Record<string, string> = {};
  for (const mapping of node.webhookResponseMappings ?? []) {
    const variable = String(mapping.variable ?? "").trim();
    const path = String(mapping.path ?? "").trim();
    if (!variable || !path) continue;
    const value = readPath(data, path);
    if (value === undefined || value === null) continue;
    output[variable] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return output;
};

const nextWebhookNodeIds = (flow: BotFlow, nodeId: string) => {
  const seen = new Set<string>();
  return flow.edges
    .filter((edge) => edge.from === nodeId && (!edge.branch || edge.branch === "default"))
    .map((edge) => edge.to)
    .filter((target) => {
      if (!target || seen.has(target)) return false;
      seen.add(target);
      return true;
    });
};

const resumeWaitingWebhookSessions = async (params: {
  eventId: number;
  method: string;
  path: string;
  variables: Record<string, string>;
  resolved: NonNullable<Awaited<ReturnType<typeof getBotFlowWebhookForPublicToken>>>;
}) => {
  if (params.resolved.node.kind !== "webhook_wait") return 0;
  const sessions = await listWaitingBotFlowWebhookSessions({
    flowId: params.resolved.flow.id,
    nodeId: params.resolved.node.id,
    limit: 30,
  });
  let resumed = 0;
  for (const session of sessions) {
    const nextNodeIds = nextWebhookNodeIds(session.flow, params.resolved.node.id);
    const nextNodeId = nextNodeIds[0] ?? null;
    const variables = {
      ...session.variables,
      ...params.variables,
      webhook_event_id: String(params.eventId),
      webhook_method: params.method,
      webhook_path: params.path,
    };
    try {
      await logBotFlowEvent({
        flowId: session.flow.id,
        sessionId: session.id,
        nodeId: params.resolved.node.id,
        message: "Webhook recebido para sessão em espera.",
        payload: { eventId: params.eventId, nextNodeId },
      });
      if (!nextNodeId) {
        await updateBotFlowSessionState({
          sessionId: session.id,
          status: "completed",
          currentNodeId: null,
          variables,
        });
        await createBotFlowResult({
          flow: session.flow,
          sessionId: session.id,
          chatId: session.chatId,
          participantId: session.participantId,
          status: "completed",
          variables,
          transcript: [{ nodeId: params.resolved.node.id, kind: "webhook_wait", eventId: params.eventId }],
        });
        resumed += 1;
        continue;
      }
      const instance = session.flow.instanceId ? await getInstanceById(session.flow.instanceId) : null;
      if (!instance) {
        await updateBotFlowSessionState({
          sessionId: session.id,
          status: "running",
          currentNodeId: nextNodeId,
          variables,
        });
        await logBotFlowEvent({
          flowId: session.flow.id,
          sessionId: session.id,
          nodeId: params.resolved.node.id,
          level: "warn",
          message: "Webhook recebido, mas a instância do fluxo não foi encontrada para retomar automaticamente.",
          payload: { eventId: params.eventId, nextNodeId },
        });
        continue;
      }
      const client: WuzapiClient = {
        baseUrl: instance.serverBaseUrl,
        token: instance.token,
        conversation: {
          userId: instance.userId,
          instanceId: instance.id,
          instanceName: instance.name,
          instancePhone: instance.phone,
        },
      };
      let executed = false;
      for (const targetNodeId of nextNodeIds) {
        executed =
          (await executeBotFlow({
            flow: session.flow,
            client,
            chatId: session.chatId,
            startNodeId: targetNodeId,
            existingSessionId: session.id,
            variables,
          })) || executed;
      }
      if (executed) resumed += 1;
    } catch (error) {
      await updateBotFlowSessionState({
        sessionId: session.id,
        status: "failed",
        currentNodeId: params.resolved.node.id,
        variables,
      });
      await logBotFlowEvent({
        flowId: session.flow.id,
        sessionId: session.id,
        nodeId: params.resolved.node.id,
        level: "error",
        message: error instanceof Error ? error.message : "Falha ao retomar sessão por webhook.",
        payload: { eventId: params.eventId },
      });
    }
  }
  return resumed;
};

async function handle(request: Request, { params }: { params: Promise<{ flowId: string; nodeId: string; token: string }> }) {
  try {
    const { flowId, nodeId, token } = await params;
    const id = parseFlowId(flowId);
    if (!id) {
      return NextResponse.json({ message: "Fluxo inválido." }, { status: 400 });
    }

    const resolved = await getBotFlowWebhookForPublicToken({ flowId: id, nodeId, token });
    if (!resolved) {
      return NextResponse.json({ message: "Webhook não encontrado ou token inválido." }, { status: 404 });
    }

    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const body = await parseRequestBody(request);
    const headers = Object.fromEntries(
      Array.from(request.headers.entries()).filter(([key]) => !["cookie", "authorization"].includes(key.toLowerCase())),
    );
    const eventId = await recordBotFlowWebhookEvent({
      flow: resolved.flow,
      nodeId: resolved.node.id,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      query,
      headers,
      body,
    });

    const variableSource = { query, headers, body };
    const variables = {
      ...flattenVariables(query, "query"),
      ...flattenVariables(body, "body"),
      ...mappedWebhookVariables(resolved.node, variableSource),
    };
    const resumedSessions = await resumeWaitingWebhookSessions({
      eventId,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      variables,
      resolved,
    });
    return NextResponse.json({
      ok: true,
      message: "Webhook recebido.",
      eventId,
      flowId: resolved.flow.id,
      nodeId: resolved.node.id,
      resumedSessions,
      variables,
    });
  } catch (error) {
    console.error("[bot-flows] webhook receive error", error);
    return NextResponse.json({ message: "Não foi possível receber o webhook." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
