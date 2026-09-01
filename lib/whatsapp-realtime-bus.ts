import { EventEmitter } from "events";

import { redisKey, redisPublish, redisSubscribe } from "lib/redis";
import type { WhatsappRealtimeEvent } from "lib/whatsapp-conversations";

const runtime = globalThis as typeof globalThis & {
  __botadmWhatsappRealtimeBus?: EventEmitter;
  __botadmWhatsappRealtimeRedisStarted?: boolean;
};

const ORIGIN_ID = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
const CHANNEL = redisKey("realtime", "whatsapp");

const getBus = () => {
  if (!runtime.__botadmWhatsappRealtimeBus) {
    runtime.__botadmWhatsappRealtimeBus = new EventEmitter();
    runtime.__botadmWhatsappRealtimeBus.setMaxListeners(2000);
  }
  return runtime.__botadmWhatsappRealtimeBus;
};

const userChannel = (userId: number) => `whatsapp:user:${userId}`;

type RedisWhatsappRealtimeEvent = {
  origin: string;
  userId: number;
  event: WhatsappRealtimeEvent;
};

const startRedisSubscriber = () => {
  if (runtime.__botadmWhatsappRealtimeRedisStarted) return;
  runtime.__botadmWhatsappRealtimeRedisStarted = true;
  void redisSubscribe<RedisWhatsappRealtimeEvent>(CHANNEL, (message) => {
    if (message.origin === ORIGIN_ID) return;
    getBus().emit(userChannel(message.userId), message.event);
  });
};

export type SerializedWhatsappRealtimeEvent = {
  type: string;
  eventType: string;
  sequenceId: number;
  instanceId: number;
  chatJid: string;
  messageId: string | null;
  occurredAt: string;
  createdAt: string;
  payload: Record<string, unknown>;
  message?: unknown;
  thread?: unknown;
};

export const serializeWhatsappRealtimeEvent = (
  event: WhatsappRealtimeEvent,
): SerializedWhatsappRealtimeEvent => {
  const payload = event.payload ?? {};
  const message = payload.message && typeof payload.message === "object"
    ? payload.message as Record<string, unknown>
    : null;
  const occurredAt =
    typeof message?.timestamp === "string" && message.timestamp.trim()
      ? message.timestamp
      : event.createdAt;
  return {
    type: event.eventType,
    eventType: event.eventType,
    sequenceId: event.id,
    instanceId: event.instanceId,
    chatJid: event.chatJid,
    messageId: event.messageId,
    occurredAt,
    createdAt: event.createdAt,
    payload,
    message: payload.message,
    thread: payload.thread,
  };
};

export const publishWhatsappRealtimeEvent = (event: WhatsappRealtimeEvent) => {
  startRedisSubscriber();
  getBus().emit(userChannel(event.userId), event);
  void redisPublish(CHANNEL, { origin: ORIGIN_ID, userId: event.userId, event });
};

export const subscribeWhatsappRealtimeEvents = (
  userId: number,
  listener: (event: WhatsappRealtimeEvent) => void,
) => {
  startRedisSubscriber();
  const bus = getBus();
  const channel = userChannel(userId);
  bus.on(channel, listener);
  return () => {
    bus.off(channel, listener);
  };
};
