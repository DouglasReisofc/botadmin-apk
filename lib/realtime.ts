import type { Server as IoServer } from "socket.io";
import { EventEmitter } from "events";

import { SESSION_COOKIE, getSessionUserById } from "lib/auth";
import { redisKey, redisPublish, redisSubscribe } from "lib/redis";
import type { SerializedSupportMessage } from "./support";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePrefix = rawBasePath && rawBasePath !== "/"
  ? (rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`)
  : "";
export const SOCKET_PATH = `${basePrefix}/api/socket/io`;

let ioInstance: IoServer | null = null;

// Simple in-process Event Bus for SSE fallback
let eventBus: EventEmitter | null = null;
let redisSubscriberStarted = false;
const REALTIME_ORIGIN_ID = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
const SUPPORT_REALTIME_CHANNEL = redisKey("realtime", "support");

const realtimeLog = (...args: unknown[]) => {
  try {
    console.info("[realtime]", ...args);
  } catch {
    // ignore logging issues
  }
};

export const registerSocketServer = (server: IoServer) => {
  ioInstance = server;
  realtimeLog("socket server registered");
};

export const getSocketServer = () => ioInstance;

export const getEventBus = () => {
  if (!eventBus) {
    eventBus = new EventEmitter();
    // increase listeners to avoid warning if many clients
    eventBus.setMaxListeners(1000);
  }
  return eventBus;
};

const normalizeWhatsappId = (value: string) => value.trim();

export const buildSupportUserRoom = (userId: number) => `user:${userId}`;

export const buildSupportThreadRoom = (userId: number, whatsappId: string) =>
  `${buildSupportUserRoom(userId)}:thread:${normalizeWhatsappId(whatsappId)}`;

export const parseSessionIdFromCookie = (cookieHeader: string | undefined | null) => {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");
  for (const item of cookies) {
    const [rawName, ...rest] = item.trim().split("=");
    if (rawName === SESSION_COOKIE) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
};

export const authenticateSocket = async (cookieHeader: string | undefined) => {
  const sessionId = parseSessionIdFromCookie(cookieHeader);
  if (!sessionId) {
    return null;
  }

  return getSessionUserById(sessionId);
};

export type SupportThreadUpdatePayload = {
  userId: number;
  thread: {
    whatsappId: string;
    customerName: string | null;
    profileName: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
    status: "open" | "closed";
    within24h: boolean;
    minutesLeft24h: number;
    isAdminThread?: boolean;
    deleted?: boolean;
  };
};

type SupportRedisEvent =
  | { origin: string; event: "support:thread-updated"; payload: SupportThreadUpdatePayload }
  | { origin: string; event: "support:message-created"; payload: SupportMessageCreatedPayload }
  | { origin: string; event: "purchase:created"; payload: PurchaseCreatedPayload }
  | { origin: string; event: "notification:created"; payload: UserNotificationCreatedPayload };

const emitSupportThreadUpdateLocal = (payload: SupportThreadUpdatePayload) => {
  realtimeLog("emit support:thread-updated", payload);
  const server = getSocketServer();
  if (server) {
    const room = buildSupportUserRoom(payload.userId);
    server.to(room).emit("support:thread-updated", payload.thread);
  }
  getEventBus().emit("support:thread-updated", payload);
};

const emitSupportMessageEventLocal = (payload: SupportMessageCreatedPayload) => {
  realtimeLog("emit support:message-created", payload);
  const server = getSocketServer();
  if (server) {
    const threadRoom = buildSupportThreadRoom(payload.userId, payload.whatsappId);
    server.to(threadRoom).emit("support:message-created", {
      whatsappId: payload.whatsappId,
      message: payload.message,
    });
  }
  getEventBus().emit("support:message-created", payload);
};

const emitPurchaseCreatedLocal = (payload: PurchaseCreatedPayload) => {
  realtimeLog("emit purchase:created", payload);
  const server = getSocketServer();
  if (server) {
    const room = buildSupportUserRoom(payload.userId);
    server.to(room).emit("purchase:created", payload.purchase);
  }
  getEventBus().emit("purchase:created", payload);
};

const emitUserNotificationCreatedLocal = (payload: UserNotificationCreatedPayload) => {
  realtimeLog("emit notification:created", payload);
  const server = getSocketServer();
  if (server) {
    const room = buildSupportUserRoom(payload.userId);
    server.to(room).emit("notification:created", payload.notification);
  }
  getEventBus().emit("notification:created", payload);
};

const publishSupportRealtime = (event: SupportRedisEvent["event"], payload: SupportRedisEvent["payload"]) => {
  void redisPublish(SUPPORT_REALTIME_CHANNEL, { origin: REALTIME_ORIGIN_ID, event, payload });
};

const startRedisRealtimeSubscriber = () => {
  if (redisSubscriberStarted) return;
  redisSubscriberStarted = true;
  void redisSubscribe<SupportRedisEvent>(SUPPORT_REALTIME_CHANNEL, (message) => {
    if (message.origin === REALTIME_ORIGIN_ID) return;
    if (message.event === "support:thread-updated") {
      emitSupportThreadUpdateLocal(message.payload);
    } else if (message.event === "support:message-created") {
      emitSupportMessageEventLocal(message.payload);
    } else if (message.event === "purchase:created") {
      emitPurchaseCreatedLocal(message.payload);
    } else if (message.event === "notification:created") {
      emitUserNotificationCreatedLocal(message.payload);
    }
  });
};

export type SupportMessageCreatedPayload = {
  userId: number;
  whatsappId: string;
  message: SerializedSupportMessage;
};

export type PurchaseCreatedPayload = {
  userId: number;
  purchase: {
    categoryName: string;
    categoryPrice: number;
    customerName: string | null;
    customerWhatsapp: string | null;
    purchasedAt: string;
    productDetails?: string | null;
  };
};

export type UserNotificationCreatedPayload = {
  userId: number;
  notification: {
    id: number;
    type: string;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
  };
};

export const emitSupportThreadUpdate = (payload: SupportThreadUpdatePayload) => {
  startRedisRealtimeSubscriber();
  emitSupportThreadUpdateLocal(payload);
  publishSupportRealtime("support:thread-updated", payload);
};

export const emitSupportThreadDeleted = (payload: { userId: number; whatsappId: string }) => {
  emitSupportThreadUpdate({
    userId: payload.userId,
    thread: {
      whatsappId: payload.whatsappId,
      customerName: null,
      profileName: null,
      lastMessagePreview: null,
      lastMessageAt: null,
      status: "closed",
      within24h: false,
      minutesLeft24h: 0,
      deleted: true,
    },
  });
};

export const emitSupportMessageEvent = (payload: SupportMessageCreatedPayload) => {
  startRedisRealtimeSubscriber();
  emitSupportMessageEventLocal(payload);
  publishSupportRealtime("support:message-created", payload);
};

export const emitPurchaseCreated = (payload: PurchaseCreatedPayload) => {
  startRedisRealtimeSubscriber();
  emitPurchaseCreatedLocal(payload);
  publishSupportRealtime("purchase:created", payload);
};

export const emitUserNotificationCreated = (payload: UserNotificationCreatedPayload) => {
  startRedisRealtimeSubscriber();
  emitUserNotificationCreatedLocal(payload);
  publishSupportRealtime("notification:created", payload);
};

export const SSE_PATH = `${basePrefix}/api/support/stream`;
