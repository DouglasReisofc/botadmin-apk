import type { BotInstance } from "types/bot-instances";
import type { BotInstanceSettings } from "types/bot-instance-settings";
import type { BotGroup, BotGroupSettings } from "types/bot-groups";
import { redisDel, redisGetJson, redisKey, redisPublish, redisSetJson, redisSubscribe } from "lib/redis";

const DEFAULT_TTL_MS = Number.isFinite(Number(process.env.BOT_CACHE_TTL_MS))
  ? Math.max(1_000, Math.floor(Number(process.env.BOT_CACHE_TTL_MS)))
  : 60_000;

const parseTtl = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
};

type CacheEntry<T> =
  | { value: T; expiresAt: number }
  | { promise: Promise<T> };

const now = () => Date.now();

const instanceSettingsCache = new Map<number, CacheEntry<BotInstanceSettings>>();
const groupSettingsCache = new Map<number, CacheEntry<BotGroupSettings>>();
const groupByJidCache = new Map<string, CacheEntry<BotGroup | null>>();
const instanceByTokenCache = new Map<string, CacheEntry<BotInstance | null>>();
let invalidationSubscriberStarted = false;

const buildGroupKey = (instanceId: number, remoteId: string) => `${instanceId}:${remoteId}`;
const INVALIDATION_CHANNEL = redisKey("cache", "invalidate");

type InvalidationPayload =
  | { cache: "instance-settings"; key?: number }
  | { cache: "group-settings"; key?: number }
  | { cache: "group-by-remote"; key?: string; instanceId?: number; remoteId?: string }
  | { cache: "instance-by-token"; key?: string };

const applyInvalidation = (payload: InvalidationPayload) => {
  if (payload.cache === "instance-settings") {
    if (payload.key === undefined) instanceSettingsCache.clear();
    else instanceSettingsCache.delete(payload.key);
  } else if (payload.cache === "group-settings") {
    if (payload.key === undefined) groupSettingsCache.clear();
    else groupSettingsCache.delete(payload.key);
  } else if (payload.cache === "group-by-remote") {
    if (payload.key) {
      groupByJidCache.delete(payload.key);
    } else if (payload.instanceId === undefined && payload.remoteId === undefined) {
      groupByJidCache.clear();
    } else {
      for (const key of groupByJidCache.keys()) {
        const [inst, jid] = key.split(":");
        if (
          (payload.instanceId === undefined || Number(inst) === payload.instanceId) &&
          (payload.remoteId === undefined || jid === payload.remoteId)
        ) {
          groupByJidCache.delete(key);
        }
      }
    }
  } else if (payload.cache === "instance-by-token") {
    if (payload.key === undefined) instanceByTokenCache.clear();
    else instanceByTokenCache.delete(payload.key);
  }
};

const startInvalidationSubscriber = () => {
  if (invalidationSubscriberStarted) return;
  invalidationSubscriberStarted = true;
  void redisSubscribe<InvalidationPayload>(INVALIDATION_CHANNEL, applyInvalidation);
};

const loadWithCache = async <K, T>(
  cache: Map<K, CacheEntry<T>>,
  key: K,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
  redisCacheKey?: string,
): Promise<T> => {
  startInvalidationSubscriber();
  if (ttlMs <= 0) {
    return loader();
  }

  const entry = cache.get(key);
  if (entry) {
    if ("value" in entry) {
      if (entry.expiresAt > now()) {
        return entry.value;
      }
    } else {
      return entry.promise;
    }
  }

  if (redisCacheKey) {
    const sharedValue = await redisGetJson<T>(redisCacheKey);
    if (sharedValue !== null) {
      cache.set(key, { value: sharedValue, expiresAt: now() + ttlMs });
      return sharedValue;
    }
  }

  const pending = loader()
    .then(async (value) => {
      cache.set(key, { value, expiresAt: now() + ttlMs });
      if (redisCacheKey) {
        await redisSetJson(redisCacheKey, value, ttlMs);
      }
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, { promise: pending });
  return pending;
};

const INSTANCE_SETTINGS_CACHE_TTL_MS = parseTtl(
  process.env.BOT_INSTANCE_SETTINGS_CACHE_TTL_MS,
  10_000,
);
const GROUP_SETTINGS_CACHE_TTL_MS = parseTtl(
  process.env.BOT_GROUP_SETTINGS_CACHE_TTL_MS,
  10_000,
);

export const getCachedInstanceSettings = async (instanceId: number) =>
  loadWithCache(
    instanceSettingsCache,
    instanceId,
    async () => {
      const { getInstanceSettings } = await import("lib/bot-instance-settings");
      return getInstanceSettings(instanceId);
    },
    INSTANCE_SETTINGS_CACHE_TTL_MS,
    redisKey("cache", "instance-settings", instanceId),
  );

export const invalidateInstanceSettingsCache = (instanceId?: number) => {
  if (instanceId === undefined) {
    instanceSettingsCache.clear();
    void redisPublish(INVALIDATION_CHANNEL, { cache: "instance-settings" });
    return;
  }
  instanceSettingsCache.delete(instanceId);
  void redisDel(redisKey("cache", "instance-settings", instanceId));
  void redisPublish(INVALIDATION_CHANNEL, { cache: "instance-settings", key: instanceId });
};

export const getCachedGroupSettings = async (groupId: number) =>
  loadWithCache(
    groupSettingsCache,
    groupId,
    async () => {
      const { getGroupSettings } = await import("lib/bot-group-settings");
      return getGroupSettings(groupId);
    },
    GROUP_SETTINGS_CACHE_TTL_MS,
    redisKey("cache", "group-settings", groupId),
  );

export const invalidateGroupSettingsCache = (groupId?: number) => {
  if (groupId === undefined) {
    groupSettingsCache.clear();
    void redisPublish(INVALIDATION_CHANNEL, { cache: "group-settings" });
    return;
  }
  groupSettingsCache.delete(groupId);
  void redisDel(redisKey("cache", "group-settings", groupId));
  void redisPublish(INVALIDATION_CHANNEL, { cache: "group-settings", key: groupId });
};

export const getCachedGroupByRemoteId = async (instanceId: number, remoteId: string) =>
  loadWithCache(groupByJidCache, buildGroupKey(instanceId, remoteId), async () => {
    const { getGroupForInstanceByRemoteId } = await import("lib/bot-groups");
    return getGroupForInstanceByRemoteId(instanceId, remoteId);
  }, DEFAULT_TTL_MS, redisKey("cache", "group-by-remote", instanceId, remoteId));

export const invalidateGroupByRemoteIdCache = (instanceId?: number, remoteId?: string) => {
  if (instanceId === undefined || remoteId === undefined) {
    if (instanceId === undefined && remoteId === undefined) {
      groupByJidCache.clear();
      void redisPublish(INVALIDATION_CHANNEL, { cache: "group-by-remote" });
      return;
    }
    for (const key of groupByJidCache.keys()) {
      const [inst, jid] = key.split(":");
      if (
        (instanceId === undefined || Number(inst) === instanceId) &&
        (remoteId === undefined || jid === remoteId)
      ) {
        groupByJidCache.delete(key);
      }
    }
    void redisPublish(INVALIDATION_CHANNEL, { cache: "group-by-remote", instanceId, remoteId });
    return;
  }
  const key = buildGroupKey(instanceId, remoteId);
  groupByJidCache.delete(key);
  void redisDel(redisKey("cache", "group-by-remote", instanceId, remoteId));
  void redisPublish(INVALIDATION_CHANNEL, { cache: "group-by-remote", key });
};

export const getCachedInstanceByToken = async (token: string) =>
  loadWithCache(instanceByTokenCache, token, async () => {
    const { getInstanceByToken } = await import("lib/bot-instances");
    return getInstanceByToken(token);
  }, DEFAULT_TTL_MS, redisKey("cache", "instance-by-token", token));

export const invalidateInstanceByTokenCache = (token?: string) => {
  if (token === undefined) {
    instanceByTokenCache.clear();
    void redisPublish(INVALIDATION_CHANNEL, { cache: "instance-by-token" });
    return;
  }
  instanceByTokenCache.delete(token);
  void redisDel(redisKey("cache", "instance-by-token", token));
  void redisPublish(INVALIDATION_CHANNEL, { cache: "instance-by-token", key: token });
};
