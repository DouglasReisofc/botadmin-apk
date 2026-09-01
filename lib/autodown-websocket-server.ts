import type { Server as HttpServer, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";

import { WebSocketServer, type WebSocket } from "next/dist/compiled/ws";

import {
  AUTODOWN_WS_PATH,
  dispatchNextAutoDownJob,
  getAutoDownStateSnapshot,
  isAutoDownAuthConfigured,
  isAutoDownAuthTokenValid,
  registerAutoDownClient,
  submitAutoDownJobResult,
  unregisterAutoDownClient,
} from "./autodown";

const runtime = globalThis as typeof globalThis & {
  __botadmAutoDownWs?: {
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

const wsRuntime = runtime.__botadmAutoDownWs ?? createRuntimeState();
runtime.__botadmAutoDownWs = wsRuntime;

const preferredPort = Number.parseInt(process.env.PORT || "4478", 10);

const isHttpServerCandidate = (value: unknown): value is HttpServer => {
  if (!value || typeof value !== "object") {
    return false;
  }

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
  if (typeof getActiveHandles !== "function") {
    return [] as HttpServer[];
  }

  return getActiveHandles().filter(isHttpServerCandidate);
};

const chooseServer = () => {
  const servers = getListeningServers();
  if (servers.length === 0) {
    return null;
  }

  const byPort = servers.find((server) => {
    const address = server.address();
    return Boolean(address && typeof address === "object" && address.port === preferredPort);
  });

  return byPort ?? servers[0] ?? null;
};

const isUpgradeForAutoDown = (req: IncomingMessage) => {
  const host = req.headers.host;
  const requestUrl = req.url;
  if (!host || !requestUrl) {
    return false;
  }

  try {
    const pathname = new URL(requestUrl, `http://${host}`).pathname;
    return pathname === AUTODOWN_WS_PATH;
  } catch {
    return false;
  }
};

const readTokenFromRequest = (req: IncomingMessage) => {
  const host = req.headers.host;
  const requestUrl = req.url;
  if (!host || !requestUrl) {
    return null;
  }

  try {
    return new URL(requestUrl, `http://${host}`).searchParams.get("token");
  } catch {
    return null;
  }
};

const rejectUpgrade = (socket: Socket) => {
  try {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  } finally {
    socket.destroy();
  }
};

const wireWebSocketServer = () => {
  if (wsRuntime.initialized) {
    return;
  }

  wsRuntime.initialized = true;

  wsRuntime.wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    let clientId: string | null = null;
    const requestToken = readTokenFromRequest(req);

    socket.on("message", (raw) => {
      let message: Record<string, unknown> | null = null;
      try {
        message = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "JSON invalido." }));
        return;
      }

      if (!clientId) {
        if (message.type !== "hello") {
          socket.send(JSON.stringify({ type: "error", message: "A primeira mensagem precisa ser hello." }));
          socket.close(1008, "hello required");
          return;
        }

        const authToken = message.token ?? message.auth_token ?? requestToken;
        if (!isAutoDownAuthTokenValid(authToken)) {
          socket.send(
            JSON.stringify({
              type: "error",
              message: "Token de autenticacao invalido.",
            }),
          );
          socket.close(1008, "invalid token");
          return;
        }

        clientId = typeof message.client_id === "string" && message.client_id.trim()
          ? message.client_id.trim()
          : `client-${randomUUID()}`;

        registerAutoDownClient(clientId, socket);
        dispatchNextAutoDownJob(clientId);
        return;
      }

      if (message.type === "pong") {
        return;
      }

      if (message.type !== "job_result") {
        socket.send(
          JSON.stringify({
            type: "error",
            message: `Tipo de mensagem nao suportado: ${String(message.type ?? "")}`,
          }),
        );
        return;
      }

      const result = submitAutoDownJobResult(clientId, message);
      if (!result.ok) {
        socket.send(JSON.stringify({ type: "error", message: result.error }));
      }
    });

    socket.on("close", () => {
      if (clientId) {
        unregisterAutoDownClient(clientId);
      }
    });
  });
};

const attachToServer = (server: HttpServer) => {
  if (wsRuntime.attachedServers.has(server)) {
    return true;
  }

  wireWebSocketServer();

  server.on("upgrade", (req, socket, head) => {
    if (!isUpgradeForAutoDown(req)) {
      return;
    }

    if (isAutoDownAuthConfigured() && !isAutoDownAuthTokenValid(readTokenFromRequest(req))) {
      rejectUpgrade(socket);
      return;
    }

    wsRuntime.wss.handleUpgrade(req, socket, head, (ws) => {
      wsRuntime.wss.emit("connection", ws, req);
    });
  });

  wsRuntime.attachedServers.add(server);
  console.info("[autodown] websocket upgrade listener attached", getAutoDownStateSnapshot());
  return true;
};

export const ensureAutoDownWebSocketServer = () => {
  if (wsRuntime.initPromise) {
    return wsRuntime.initPromise;
  }

  wsRuntime.initPromise = (async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const server = chooseServer();
      if (server) {
        return attachToServer(server);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.warn("[autodown] unable to locate Next.js HTTP server for websocket attachment");
    return false;
  })();

  return wsRuntime.initPromise;
};
