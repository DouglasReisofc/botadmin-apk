import Redis from "ioredis";

declare global {
  var __botadmRedisClient: Redis | null | undefined;
  var __botadmRedisSubscriber: Redis | null | undefined;
}

const DEFAULT_REDIS_URL = "redis://127.0.0.1:7779/0";
const DEFAULT_PREFIX = "botadmin:local";

export const isRedisEnabled = () => {
  const value = (process.env.REDIS_ENABLED ?? "1").trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
};

export const getRedisPrefix = () => {
  const raw = (process.env.REDIS_PREFIX ?? DEFAULT_PREFIX).trim();
  return raw.replace(/:+$/g, "") || DEFAULT_PREFIX;
};

export const redisKey = (...parts: Array<string | number | null | undefined>) =>
  [getRedisPrefix(), ...parts.filter((part) => part !== null && part !== undefined).map(String)]
    .join(":")
    .replace(/:{2,}/g, ":");

const createRedis = () => {
  const url = (process.env.REDIS_URL ?? DEFAULT_REDIS_URL).trim() || DEFAULT_REDIS_URL;
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
};

export const getRedis = () => {
  if (!isRedisEnabled()) return null;
  if (!globalThis.__botadmRedisClient) {
    globalThis.__botadmRedisClient = createRedis();
  }
  return globalThis.__botadmRedisClient;
};

export const getRedisSubscriber = () => {
  if (!isRedisEnabled()) return null;
  if (!globalThis.__botadmRedisSubscriber) {
    globalThis.__botadmRedisSubscriber = createRedis();
  }
  return globalThis.__botadmRedisSubscriber;
};

const ensureConnected = async (client: Redis) => {
  if (client.status === "ready") return client;
  if (client.status === "wait" || client.status === "end") {
    await client.connect();
  }
  return client;
};

export const redisGetJson = async <T>(key: string): Promise<T | null> => {
  const redis = getRedis();
  if (!redis) return null;
  try {
    await ensureConnected(redis);
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    console.warn("[redis] get failed", { key, error });
    return null;
  }
};

export const redisSetJson = async (key: string, value: unknown, ttlMs: number) => {
  const redis = getRedis();
  if (!redis || ttlMs <= 0) return;
  try {
    await ensureConnected(redis);
    await redis.set(key, JSON.stringify(value), "PX", ttlMs);
  } catch (error) {
    console.warn("[redis] set failed", { key, error });
  }
};

export const redisSetIfAbsent = async (
  key: string,
  value: string,
  ttlMs: number,
): Promise<boolean | null> => {
  const redis = getRedis();
  if (!redis || ttlMs <= 0) return null;
  try {
    await ensureConnected(redis);
    const result = await redis.set(key, value, "PX", ttlMs, "NX");
    return result === "OK";
  } catch (error) {
    console.warn("[redis] set nx failed", { key, error });
    return null;
  }
};

export const redisDel = async (...keys: string[]) => {
  const redis = getRedis();
  if (!redis || keys.length === 0) return;
  try {
    await ensureConnected(redis);
    await redis.del(...keys);
  } catch (error) {
    console.warn("[redis] del failed", { keys, error });
  }
};

export const redisPublish = async (channel: string, payload: unknown) => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await ensureConnected(redis);
    await redis.publish(channel, JSON.stringify(payload));
  } catch (error) {
    console.warn("[redis] publish failed", { channel, error });
  }
};

export const redisSubscribe = async <T>(
  channel: string,
  listener: (payload: T) => void,
) => {
  const subscriber = getRedisSubscriber();
  if (!subscriber) return () => {};
  const handler = (messageChannel: string, message: string) => {
    if (messageChannel !== channel) return;
    try {
      listener(JSON.parse(message) as T);
    } catch (error) {
      console.warn("[redis] invalid pubsub payload", { channel, error });
    }
  };
  try {
    await ensureConnected(subscriber);
    subscriber.on("message", handler);
    await subscriber.subscribe(channel);
  } catch (error) {
    subscriber.off("message", handler);
    console.warn("[redis] subscribe failed", { channel, error });
    return () => {};
  }
  return () => {
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.off("message", handler);
  };
};

export const withRedisLock = async <T>(
  name: string,
  ttlMs: number,
  task: () => Promise<T> | T,
): Promise<T | null> => {
  const redis = getRedis();
  if (!redis) return task();
  const key = redisKey("lock", name);
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try {
    await ensureConnected(redis);
    const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
    if (acquired !== "OK") return null;
    try {
      return await task();
    } finally {
      await redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          token,
        )
        .catch(() => {});
    }
  } catch (error) {
    console.warn("[redis] lock failed; running task without distributed lock", { name, error });
    return task();
  }
};

export const startRedisSingleton = (
  name: string,
  start: () => void,
  options: { ttlMs?: number; renewEveryMs?: number } = {},
) => {
  const redis = getRedis();
  const ttlMs = Math.max(5_000, options.ttlMs ?? 60_000);
  const renewEveryMs = Math.max(1_000, Math.min(options.renewEveryMs ?? Math.floor(ttlMs / 3), ttlMs - 1));
  const key = redisKey("singleton", name);
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  if (!redis) {
    start();
    return;
  }

  let started = false;
  const startOnce = () => {
    if (started) return;
    started = true;
    start();
  };

  const acquireAndStart = async (): Promise<void> => {
    if (started) return;
    try {
      await ensureConnected(redis);
      const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
      if (acquired !== "OK") {
        console.info("[redis] singleton already held; retrying dispatcher", {
          name,
          retryInMs: renewEveryMs,
        });
        const retryTimer = setTimeout(() => {
          void acquireAndStart();
        }, renewEveryMs);
        retryTimer.unref?.();
        return;
      }
      const timer = setInterval(() => {
        void redis
          .eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
            1,
            key,
            token,
            String(ttlMs),
          )
          .catch((error) => {
            console.warn("[redis] singleton renew failed", { name, error });
          });
      }, renewEveryMs);
      timer.unref?.();
      startOnce();
    } catch (error) {
      console.warn("[redis] singleton unavailable; starting dispatcher without distributed lease", {
        name,
        error,
      });
      startOnce();
    }
  };

  void acquireAndStart();
};
