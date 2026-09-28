import { redisDel, redisKey, redisSetIfAbsent } from "lib/redis";

// Keep the occurrence reserved through delivery AND the subsequent settings
// write. A worker restart or a stale settings snapshot must not resend it.
const OCCURRENCE_TTL_MS = 8 * 24 * 60 * 60 * 1000;

export const scheduledAdOccurrenceKey = (
  groupId: number,
  adId: string,
  occurrence: string,
) => redisKey("scheduled-ad", groupId, encodeURIComponent(adId), encodeURIComponent(occurrence));

type DeliveryResult = { delivered: boolean; unauthorized: boolean };
type DeliveryStore = {
  claim: (key: string, value: string, ttlMs: number) => Promise<boolean | null>;
  release: (key: string) => Promise<unknown>;
};

export const deliverScheduledAdOnce = async (
  key: string,
  deliver: () => Promise<DeliveryResult>,
  store: DeliveryStore = { claim: redisSetIfAbsent, release: redisDel },
): Promise<DeliveryResult | null> => {
  const claimed = await store.claim(key, new Date().toISOString(), OCCURRENCE_TTL_MS);
  // Fail closed: a cache outage must not turn into repeated customer messages.
  if (claimed !== true) {
    if (claimed === null) console.warn("[AdsDispatcher] Occurrence protection unavailable; delivery postponed", { key });
    return null;
  }
  try {
    const result = await deliver();
    if (!result.delivered) await store.release(key);
    return result;
  } catch (error) {
    await store.release(key);
    throw error;
  }
};
