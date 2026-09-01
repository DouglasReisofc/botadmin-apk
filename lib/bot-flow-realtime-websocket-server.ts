import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { WebSocketServer, type WebSocket } from "next/dist/compiled/ws";

import { authenticateSocket } from "lib/realtime";
import {
  serializeBotFlowRealtimeEvent,
  subscribeBotFlowRealtimeEvents,
} from "lib/bot-flow-realtime-bus";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePrefix = rawBasePath && rawBasePath !== "/"
  ? (rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`)
  : "";
export const BOT_FLOW_REALTIME_WS_PATH = `${basePrefix}/ws/bot-flows`;

const runtime = globalThis as typeof globalThis & {
  __botadmBotFlowRealtimeWs?: {
    attachedServers: WeakSet<HttpServer>;
    wss: WebSocketServer;
    initPromise: Promise<boolean> | null;
    initialized: boolean;
  };
};

const createRuntimeState = () => ({
  attachedServers: new WeakSet<HttpServer>(),
  wss: new WebSocketServer({ noServer: true }),
  initPromise: null as Promise<boolean> | null,
  initialized: false,
});

const wsRuntime = runtime.__botadmBotFlowRealtimeWs ?? createRuntimeState();
runtime.__botadmBotFlowRealtimeWs = wsRuntime;

const preferredPort = Number.parseInt(process.env.PORT || "4478", 10);

const isHttpServerCandidate = (value: unknown): value is HttpServer => {
  if (!value || typeof value !== "object") return false;
  const server = value as Partial<HttpServer> & { listening?: boolean };
  return (
    typeof server.on === "function" &&
    typeof server.address === "function" &&
    typeof server.listeners === "function" &&
    Boolean(server.listening)
  );
};

const getListeningServers = () => {
  const getActiveHandles = (process as typeof process & { _getActiveHandles?: () => unknown[] })._getActiveHandles;
  if (typeof getActiveHandles !== "function") return [] as HttpServer[];
  return getActiveHandles().filter(isHttpServerCandidate);
};

const chooseServer = () => {
  const servers = getListeningServers();
  if (servers.length === 0) return null;
  return servers.find((server) => {
    const address = server.address();
    return Boolean(address && typeof address === "object" && address.port === preferredPort);
  }) ?? servers[0] ?? null;
};

const getRequestUrl = (req: IncomingMessage) => {
  const host = req.headers.host;
  const requestUrl = req.url;
  if (!host || !requestUrl) return null;
  try {
    return new URL(requestUrl, `http://${host}`);
  } catch {
    return null;
  }
};

const isUpgradeForBotFlowRealtime = (req: IncomingMessage) =>
  getRequestUrl(req)?.pathname === BOT_FLOW_REALTIME_WS_PATH;

const rejectUpgrade = (socket: Socket, statusCode = 401, message = "Unauthorized") => {
  try {
    socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  } finally {
    socket.destroy();
  }
};

const sendJson = (socket: WebSocket, payload: unknown) => {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
};

const handleConnection = async (socket: WebSocket, req: IncomingMessage) => {
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const close = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  socket.on("close", close);
  socket.on("error", close);
  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw)) as Record<string, unknown>;
      if (message.type === "ping") {
        sendJson(socket, { type: "pong", at: new Date().toISOString() });
        return;
      }
      // Flux changes are broadcast only after a persisted API save. This prevents
      // stale unsaved editor previews from overwriting a newer action in another session.
    } catch {
      // Malformed client messages do not affect the realtime stream.
    }
  });

  const user = await authenticateSocket(req.headers.cookie);
  if (!user) {
    sendJson(socket, { type: "error", message: "Sessao invalida." });
    socket.close(1008, "invalid session");
    close();
    return;
  }
  sendJson(socket, {
    type: "hello",
    status: "connected",
    path: BOT_FLOW_REALTIME_WS_PATH,
    at: new Date().toISOString(),
  });

  unsubscribe = subscribeBotFlowRealtimeEvents(user.id, (event) => {
    sendJson(socket, serializeBotFlowRealtimeEvent(event));
  });

  heartbeat = setInterval(() => {
    sendJson(socket, { type: "ping", at: new Date().toISOString() });
  }, 25_000);
};

const wireWebSocketServer = () => {
  if (wsRuntime.initialized) return;
  wsRuntime.initialized = true;
  wsRuntime.wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    void handleConnection(socket, req);
  });
};

const attachToServer = (server: HttpServer) => {
  if (wsRuntime.attachedServers.has(server)) return true;
  wireWebSocketServer();

  server.on("upgrade", (req, socket, head) => {
    if (!isUpgradeForBotFlowRealtime(req)) return;
    if (!req.headers.cookie) {
      rejectUpgrade(socket as Socket);
      return;
    }
    wsRuntime.wss.handleUpgrade(req, socket, head, (ws) => {
      wsRuntime.wss.emit("connection", ws, req);
    });
  });

  wsRuntime.attachedServers.add(server);
  console.info("[bot-flows-realtime] websocket upgrade listener attached", {
    path: BOT_FLOW_REALTIME_WS_PATH,
  });
  return true;
};

export const ensureBotFlowRealtimeWebSocketServer = () => {
  if (wsRuntime.initPromise) return wsRuntime.initPromise;

  wsRuntime.initPromise = (async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const server = chooseServer();
      if (server) return attachToServer(server);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.warn("[bot-flows-realtime] unable to locate Next.js HTTP server for websocket attachment");
    return false;
  })();

  return wsRuntime.initPromise;
};
