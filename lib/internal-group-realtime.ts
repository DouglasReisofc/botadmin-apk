import { EventEmitter } from "events";

import { redisKey, redisPublish, redisSubscribe } from "lib/redis";

export type InternalGroupRealtimeEvent = {
  groupId: number;
  actorUserId: number;
  targetUserId?: number | null;
  action?: string | null;
  type:
    | "message.created"
    | "message.receipt"
    | "message.deleted"
    | "message.pinned"
    | "messages.cleared"
    | "group.updated"
    | "group.deleted"
    | "member.updated";
  messageId?: number | null;
  at: string;
};

declare global {
  var __botadminInternalGroupEvents: EventEmitter | undefined;
}

const CHANNEL = redisKey("realtime", "internal-groups");
const ORIGIN = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
let subscribed = false;

export const getInternalGroupEventBus = () => {
  if (!globalThis.__botadminInternalGroupEvents) {
    globalThis.__botadminInternalGroupEvents = new EventEmitter();
    // A single process can legitimately host the conversation-list socket and
    // an open-chat socket for every member of a large group.
    globalThis.__botadminInternalGroupEvents.setMaxListeners(10000);
  }
  if (!subscribed) {
    subscribed = true;
    void redisSubscribe<{ origin: string; event: InternalGroupRealtimeEvent }>(CHANNEL, (payload) => {
      if (payload.origin === ORIGIN) return;
      globalThis.__botadminInternalGroupEvents?.emit("event", payload.event);
    });
  }
  return globalThis.__botadminInternalGroupEvents;
};

export const emitInternalGroupEvent = (
  event: Omit<InternalGroupRealtimeEvent, "at"> & { at?: string },
) => {
  const normalized: InternalGroupRealtimeEvent = {
    ...event,
    at: event.at ?? new Date().toISOString(),
  };
  getInternalGroupEventBus().emit("event", normalized);
  void redisPublish(CHANNEL, { origin: ORIGIN, event: normalized });
};
