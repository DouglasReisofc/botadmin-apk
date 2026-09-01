import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { WebSocketServer, type WebSocket } from "next/dist/compiled/ws";

import { authenticateSocket } from "lib/realtime";
import { getInternalGroupEventBus, type InternalGroupRealtimeEvent } from "lib/internal-group-realtime";
import { listInternalGroupIdsForUser } from "lib/internal-groups";
import {
  getLatestWhatsappRealtimeSequence,
  listWhatsappRealtimeEvents,
} from "lib/whatsapp-conversations";
import {
  serializeWhatsappRealtimeEvent,
  subscribeWhatsappRealtimeEvents,
} from "lib/whatsapp-realtime-bus";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePrefix = rawBasePath && rawBasePath !== "/"
  ? (rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`)
  : "";
export const WHATSAPP_REALTIME_WS_PATH = `${basePrefix}/ws/whatsapp`;

const runtime = globalThis as typeof globalThis & {
  __botadmWhatsappRealtimeWs?: {
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

const wsRuntime = runtime.__botadmWhatsappRealtimeWs ?? createRuntimeState();
runtime.__botadmWhatsappRealtimeWs = wsRuntime;

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

const getRequestUrl = (req: IncomingMessage) => {
  const host = req.headers.host;
  const requestUrl = req.url;
  if (!host || !requestUrl) {
    return null;
  }

  try {
    return new URL(requestUrl, `http://${host}`);
  } catch {
    return null;
  }
};

const isUpgradeForWhatsappRealtime = (req: IncomingMessage) =>
  getRequestUrl(req)?.pathname === WHATSAPP_REALTIME_WS_PATH;

const readAfterSequence = (req: IncomingMessage) => {
  const url = getRequestUrl(req);
  const parsed = Number.parseInt(url?.searchParams.get("after") ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

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
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let unsubscribeInternal: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let poller: NodeJS.Timeout | null = null;
  let lastSequenceId = readAfterSequence(req);
  let polling = false;

  const close = () => {
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (poller) {
      clearInterval(poller);
      poller = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubscribeInternal) {
      unsubscribeInternal();
      unsubscribeInternal = null;
    }
  };

  socket.on("close", close);
  socket.on("error", close);
  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw)) as Record<string, unknown>;
      if (message.type === "ping") {
        sendJson(socket, { type: "pong", at: new Date().toISOString() });
      }
    } catch {
      // The client can ignore server-driven mode; malformed client messages do not affect delivery.
    }
  });

  const user = await authenticateSocket(req.headers.cookie);
  if (!user) {
    sendJson(socket, { type: "error", message: "Sessao invalida." });
    socket.close(1008, "invalid session");
    close();
    return;
  }

  const latestSequenceId = await getLatestWhatsappRealtimeSequence(user.id).catch(() => 0);
  sendJson(socket, {
    type: "hello",
    status: "connected",
    sequenceId: latestSequenceId,
    latestSequenceId,
    path: WHATSAPP_REALTIME_WS_PATH,
  });

  const sendEvent = (event: Awaited<ReturnType<typeof listWhatsappRealtimeEvents>>[number]) => {
    if (event.id <= lastSequenceId) return;
    lastSequenceId = event.id;
    sendJson(socket, serializeWhatsappRealtimeEvent(event));
  };

  const loadAndSendBacklog = async (limit = 500) => {
    if (polling || closed) return;
    polling = true;
    try {
      const events = await listWhatsappRealtimeEvents(user.id, { after: lastSequenceId, limit });
      for (const event of events) {
        if (closed) return;
        sendEvent(event);
      }
    } catch (error) {
      console.warn("[whatsapp-realtime] failed to load websocket backlog", {
        userId: user.id,
        after: lastSequenceId,
        error,
      });
    } finally {
      polling = false;
    }
  };

  const backlog = await listWhatsappRealtimeEvents(user.id, { after: lastSequenceId, limit: 500 }).catch((error) => {
    console.warn("[whatsapp-realtime] failed to load websocket backlog", {
      userId: user.id,
      after: lastSequenceId,
      error,
    });
    return [];
  });
  for (const event of backlog) {
    if (closed) return;
    sendEvent(event);
  }

  unsubscribe = subscribeWhatsappRealtimeEvents(user.id, (event) => {
    sendEvent(event);
  });

  let internalGroupIds = await listInternalGroupIdsForUser(user.id).catch(() => new Set<number>());
  let refreshingInternalGroups: Promise<void> | null = null;
  const refreshInternalGroups = () => {
    if (refreshingInternalGroups) return refreshingInternalGroups;
    refreshingInternalGroups = listInternalGroupIdsForUser(user.id)
      .then((ids) => {
        internalGroupIds = ids;
      })
      .catch((error) => {
        console.warn("[internal-groups] failed to refresh websocket memberships", {
          userId: user.id,
          error,
        });
      })
      .finally(() => {
        refreshingInternalGroups = null;
      });
    return refreshingInternalGroups;
  };
  const sendInternalEvent = async (event: InternalGroupRealtimeEvent) => {
    const targetsCurrentUser = Number(event.targetUserId ?? 0) === user.id;
    if (targetsCurrentUser && event.action === "join") {
      await refreshInternalGroups();
    }
    if (!internalGroupIds.has(event.groupId)) return;
    sendJson(socket, {
      type: `internal-group.${event.type}`,
      eventType: `internal-group.${event.type}`,
      sequenceId: 0,
      instanceId: 0,
      chatJid: `internal-group:${event.groupId}`,
      messageId: event.messageId ?? null,
      payload: event,
      at: event.at,
    });
    if (
      targetsCurrentUser &&
      ["leave", "remove", "ban"].includes(event.action ?? "")
    ) {
      await refreshInternalGroups();
    }
  };
  const internalBus = getInternalGroupEventBus();
  const internalListener = (event: InternalGroupRealtimeEvent) => {
    void sendInternalEvent(event);
  };
  internalBus.on("event", internalListener);
  unsubscribeInternal = () => internalBus.off("event", internalListener);

  heartbeat = setInterval(() => {
    sendJson(socket, { type: "ping", at: new Date().toISOString() });
  }, 25_000);

  poller = setInterval(() => {
    void loadAndSendBacklog(200);
  }, 1000);
};

const wireWebSocketServer = () => {
  if (wsRuntime.initialized) {
    return;
  }

  wsRuntime.initialized = true;
  wsRuntime.wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    void handleConnection(socket, req);
  });
};

const attachToServer = (server: HttpServer) => {
  if (wsRuntime.attachedServers.has(server)) {
    return true;
  }

  wireWebSocketServer();

  server.on("upgrade", (req, socket, head) => {
    if (!isUpgradeForWhatsappRealtime(req)) {
      return;
    }

    if (!req.headers.cookie) {
      rejectUpgrade(socket);
      return;
    }

    wsRuntime.wss.handleUpgrade(req, socket, head, (ws) => {
      wsRuntime.wss.emit("connection", ws, req);
    });
  });

  wsRuntime.attachedServers.add(server);
  console.info("[whatsapp-realtime] websocket upgrade listener attached", {
    path: WHATSAPP_REALTIME_WS_PATH,
  });
  return true;
};

export const ensureWhatsappRealtimeWebSocketServer = () => {
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

    console.warn("[whatsapp-realtime] unable to locate Next.js HTTP server for websocket attachment");
    return false;
  })();

  return wsRuntime.initPromise;
};
