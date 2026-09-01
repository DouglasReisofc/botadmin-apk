import { EventEmitter } from "events";

import { redisKey, redisPublish, redisSubscribe } from "lib/redis";
import type { BotFlow } from "types/bot-flows";

const runtime = globalThis as typeof globalThis & {
  __botadmBotFlowRealtimeBus?: EventEmitter;
  __botadmBotFlowRealtimeSequence?: number;
  __botadmBotFlowRealtimeRedisStarted?: boolean;
};

const ORIGIN_ID = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
const CHANNEL = redisKey("realtime", "bot-flows");

const getBus = () => {
  if (!runtime.__botadmBotFlowRealtimeBus) {
    runtime.__botadmBotFlowRealtimeBus = new EventEmitter();
    runtime.__botadmBotFlowRealtimeBus.setMaxListeners(2000);
  }
  return runtime.__botadmBotFlowRealtimeBus;
};

const nextSequenceId = () => {
  const current = runtime.__botadmBotFlowRealtimeSequence ?? 0;
  const next = current + 1;
  runtime.__botadmBotFlowRealtimeSequence = next;
  return next;
};

const userChannel = (userId: number) => `bot-flows:user:${userId}`;

type RedisBotFlowRealtimeEvent = {
  origin: string;
  userId: number;
  event: BotFlowRealtimeEvent;
};

const startRedisSubscriber = () => {
  if (runtime.__botadmBotFlowRealtimeRedisStarted) return;
  runtime.__botadmBotFlowRealtimeRedisStarted = true;
  void redisSubscribe<RedisBotFlowRealtimeEvent>(CHANNEL, (message) => {
    if (message.origin === ORIGIN_ID) return;
    getBus().emit(userChannel(message.userId), message.event);
  });
};

export type BotFlowRealtimeEventType = "flow.created" | "flow.updated" | "flow.deleted";

export type BotFlowRealtimeEvent = {
  type: BotFlowRealtimeEventType;
  eventType: BotFlowRealtimeEventType;
  sequenceId: number;
  userId: number;
  flowId: number;
  createdAt: string;
  sourceClientId?: string;
  flow?: BotFlow;
};

export const publishBotFlowRealtimeEvent = (
  userId: number,
  eventType: BotFlowRealtimeEventType,
  flowId: number,
  flow?: BotFlow,
  options: { sourceClientId?: string } = {},
) => {
  startRedisSubscriber();
  const event: BotFlowRealtimeEvent = {
    type: eventType,
    eventType,
    sequenceId: nextSequenceId(),
    userId,
    flowId,
    flow,
    sourceClientId: options.sourceClientId,
    createdAt: new Date().toISOString(),
  };
  getBus().emit(userChannel(userId), event);
  void redisPublish(CHANNEL, { origin: ORIGIN_ID, userId, event });
};

export const subscribeBotFlowRealtimeEvents = (
  userId: number,
  listener: (event: BotFlowRealtimeEvent) => void,
) => {
  startRedisSubscriber();
  const bus = getBus();
  const channel = userChannel(userId);
  bus.on(channel, listener);
  return () => {
    bus.off(channel, listener);
  };
};

export const serializeBotFlowRealtimeEvent = (event: BotFlowRealtimeEvent) => ({
  type: event.type,
  eventType: event.eventType,
  sequenceId: event.sequenceId,
  flowId: event.flowId,
  createdAt: event.createdAt,
  sourceClientId: event.sourceClientId,
  flow: event.flow,
});
