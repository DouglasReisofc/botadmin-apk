import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import {
  WebSocket as ClientWebSocket,
  WebSocketServer,
  type WebSocket,
} from "next/dist/compiled/ws";

import { getInstanceForUser } from "lib/bot-instances";
import { authenticateSocket } from "lib/realtime";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePrefix = rawBasePath && rawBasePath !== "/"
  ? (rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`)
  : "";
export const WHATSAPP_CALL_MEDIA_WS_PATH = `${basePrefix}/ws/whatsapp-call-media`;
const MAX_AUDIO_BUFFERED_BYTES = 128_000;
const MAX_PENDING_AUDIO_FRAMES = 12;

const runtime = globalThis as typeof globalThis & {
  __botadmWhatsappCallMediaWs?: {
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

const wsRuntime = runtime.__botadmWhatsappCallMediaWs ?? createRuntimeState();
runtime.__botadmWhatsappCallMediaWs = wsRuntime;

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

const isUpgradeForWhatsappCallMedia = (req: IncomingMessage) =>
  getRequestUrl(req)?.pathname === WHATSAPP_CALL_MEDIA_WS_PATH;

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

const parsePositiveInt = (value: string | null) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const readStringParam = (req: IncomingMessage, key: string) => {
  const value = getRequestUrl(req)?.searchParams.get(key)?.trim();
  return value || null;
};

const toBinaryBuffer = (raw: unknown): Buffer | null => {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw) && raw.every(Buffer.isBuffer)) return Buffer.concat(raw);
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
};

const buildEasyZapMediaUrl = (baseUrl: string, token: string, callId: string) => {
  const url = new URL(`/call/${encodeURIComponent(callId)}/media`, baseUrl.replace(/\/+$/, ""));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
};

const handleConnection = async (socket: WebSocket, req: IncomingMessage) => {
  let closed = false;
  let remote: WebSocket | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  const pendingToRemote: Buffer[] = [];

  const closeBoth = (code = 1000, reason = "closed") => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    try {
      remote?.close(code, reason);
    } catch {
      // ignored
    }
    try {
      socket.close(code, reason);
    } catch {
      // ignored
    }
  };

  socket.on("close", () => closeBoth());
  socket.on("error", () => closeBoth(1011, "client error"));

  const user = await authenticateSocket(req.headers.cookie);
  if (!user) {
    sendJson(socket, { type: "error", message: "Sessao invalida." });
    closeBoth(1008, "invalid session");
    return;
  }

  const instanceId = parsePositiveInt(readStringParam(req, "instanceId"));
  const callId = readStringParam(req, "callId");
  if (!instanceId || !callId) {
    sendJson(socket, { type: "error", message: "Chamada invalida." });
    closeBoth(1008, "invalid call");
    return;
  }

  const instance = await getInstanceForUser(user.id, instanceId).catch((error) => {
    console.warn("[whatsapp-call-media] failed to resolve instance", { userId: user.id, instanceId, error });
    return null;
  });
  if (!instance?.serverBaseUrl || !instance.token) {
    sendJson(socket, { type: "error", message: "Instancia sem servidor conectado." });
    closeBoth(1008, "invalid instance");
    return;
  }

  const remoteUrl = buildEasyZapMediaUrl(instance.serverBaseUrl, instance.token, callId);
  remote = new ClientWebSocket(remoteUrl, {
    headers: { token: instance.token },
  }) as WebSocket;

  socket.on("message", (raw, isBinary) => {
    if (closed) return;
    if (!isBinary) return;
    const payload = toBinaryBuffer(raw);
    if (!payload || payload.byteLength === 0) return;
    if (remote?.readyState === 1) {
      if (remote.bufferedAmount > MAX_AUDIO_BUFFERED_BYTES) return;
      remote.send(payload);
      return;
    }
    if (pendingToRemote.length >= MAX_PENDING_AUDIO_FRAMES) {
      pendingToRemote.shift();
    }
    pendingToRemote.push(payload);
  });

  remote.on("open", () => {
    while (pendingToRemote.length > 0 && remote?.readyState === 1) {
      const payload = pendingToRemote.shift();
      if (payload) remote.send(payload);
    }
  });

  remote.on("message", (raw, isBinary) => {
    if (closed) return;
    if (isBinary) {
      const payload = toBinaryBuffer(raw);
      if (payload && socket.readyState === 1 && socket.bufferedAmount <= MAX_AUDIO_BUFFERED_BYTES) socket.send(payload);
      return;
    }

    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    try {
      const message = JSON.parse(text) as Record<string, unknown>;
      if (message.type === "hello") {
        sendJson(socket, { type: "ready", callId });
        return;
      }
      if (typeof message.error === "string") {
        sendJson(socket, { type: "error", message: message.error });
        return;
      }
      sendJson(socket, message);
    } catch {
      // EasyZap sends only control JSON or binary PCM here.
    }
  });

  remote.on("close", () => {
    sendJson(socket, { type: "closed", callId });
    closeBoth(1000, "easyzap closed");
  });
  remote.on("error", (error) => {
    console.warn("[whatsapp-call-media] easyzap media websocket error", {
      userId: user.id,
      instanceId,
      callId,
      error,
    });
    sendJson(socket, { type: "error", message: "Audio da instancia desconectou." });
    closeBoth(1011, "easyzap error");
  });

  heartbeat = setInterval(() => {
    try {
      if (socket.readyState === 1) socket.ping();
      if (remote?.readyState === 1) remote.ping();
    } catch {
      closeBoth(1011, "heartbeat failed");
    }
  }, 15_000);
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
    if (!isUpgradeForWhatsappCallMedia(req)) return;
    if (!req.headers.cookie) {
      rejectUpgrade(socket as Socket);
      return;
    }
    wsRuntime.wss.handleUpgrade(req, socket, head, (ws) => {
      wsRuntime.wss.emit("connection", ws, req);
    });
  });

  wsRuntime.attachedServers.add(server);
  console.info("[whatsapp-call-media] websocket upgrade listener attached", {
    path: WHATSAPP_CALL_MEDIA_WS_PATH,
  });
  return true;
};

export const ensureWhatsappCallMediaWebSocketServer = () => {
  if (wsRuntime.initPromise) return wsRuntime.initPromise;

  wsRuntime.initPromise = (async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const server = chooseServer();
      if (server) return attachToServer(server);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.warn("[whatsapp-call-media] unable to locate Next.js HTTP server for websocket attachment");
    return false;
  })();

  return wsRuntime.initPromise;
};
