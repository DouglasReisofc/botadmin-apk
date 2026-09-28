import assert from "node:assert/strict";
import { deliverScheduledAdOnce, scheduledAdOccurrenceKey } from "../lib/scheduled-ad-delivery";

async function main() {
  const entries = new Set<string>();
  const store = {
    claim: async (key: string) => {
      if (entries.has(key)) return false;
      entries.add(key);
      return true;
    },
    release: async (key: string) => { entries.delete(key); },
  };
  let deliveries = 0;
  const deliver = async () => { deliveries++; return { delivered: true, unauthorized: false }; };
  const key = scheduledAdOccurrenceKey(1638, "ad-1", "2026-09-28:12:00");
  await Promise.all(Array.from({ length: 20 }, () => deliverScheduledAdOnce(key, deliver, store)));
  assert.equal(deliveries, 1, "Concurrent workers must deliver one occurrence only");
  await deliverScheduledAdOnce(key, deliver, store);
  assert.equal(deliveries, 1, "Stale settings/restarts must not repeat the occurrence");
  await deliverScheduledAdOnce(scheduledAdOccurrenceKey(1638, "ad-2", "2026-09-28:12:00"), deliver, store);
  await deliverScheduledAdOnce(scheduledAdOccurrenceKey(1638, "ad-1", "2026-09-29:12:00"), deliver, store);
  assert.equal(deliveries, 3, "Different ads and days must remain independent");
  const failedKey = `${key}:failed`;
  await deliverScheduledAdOnce(failedKey, async () => ({ delivered: false, unauthorized: false }), store);
  await deliverScheduledAdOnce(failedKey, deliver, store);
  assert.equal(deliveries, 4, "Confirmed failure must allow retry");
  await deliverScheduledAdOnce(`${key}:unavailable`, deliver, { ...store, claim: async () => null });
  assert.equal(deliveries, 4, "Protection outage must not send without idempotency");
  console.log("Scheduled ad delivery: concurrency, stale state, independent ads, retry and outage passed.");
}
void main();
