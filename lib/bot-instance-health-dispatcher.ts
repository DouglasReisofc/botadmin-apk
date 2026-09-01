import {
  listInstancesForAdmin,
  performInstanceAction,
  refreshInstanceStatus,
} from "lib/bot-instances";
import type { BotInstanceAdminSummary } from "types/bot-instances";

const runtime = globalThis as typeof globalThis & {
  __botInstanceHealthDispatcherStarted?: boolean;
};

const HEALTH_INTERVAL_MS = Math.max(
  20_000,
  Number(process.env.BOT_INSTANCE_HEALTH_INTERVAL_MS ?? 30_000),
);
const HEALTH_CONCURRENCY = Math.max(
  1,
  Math.min(12, Number(process.env.BOT_INSTANCE_HEALTH_CONCURRENCY ?? 6)),
);
const OFFLINE_CONFIRMATIONS = Math.max(
  1,
  Math.min(5, Number(process.env.BOT_INSTANCE_OFFLINE_CONFIRMATIONS ?? 2)),
);
const RECONNECT_SETTLE_MS = Math.max(
  500,
  Math.min(15_000, Number(process.env.BOT_INSTANCE_RECONNECT_SETTLE_MS ?? 2_000)),
);

const offlineChecks = new Map<number, number>();
let cycleRunning = false;

const isLicenseActive = (instance: BotInstanceAdminSummary): boolean => {
  if (!instance.expiresAt) return true;
  const expiresAt = new Date(instance.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, durationMs);
    timer.unref?.();
  });

const checkInstance = async (instance: BotInstanceAdminSummary) => {
  if (instance.desiredSessionState === "disconnected") {
    offlineChecks.delete(instance.id);
    return;
  }
  if (!isLicenseActive(instance)) {
    offlineChecks.delete(instance.id);
    return;
  }

  const wasExpectedOnline =
    instance.sessionStatus === "conectado" ||
    instance.sessionStatus === "inicializando" ||
    offlineChecks.has(instance.id);
  if (!wasExpectedOnline) return;

  // A QR/pairing state requires the account owner. Reconnecting it in a loop
  // would continuously replace the code and make pairing harder.
  if (
    instance.sessionStatus === "aguardando_qr" ||
    instance.sessionStatus === "aguardando_pareamento"
  ) {
    offlineChecks.delete(instance.id);
    return;
  }

  try {
    const liveStatus = await refreshInstanceStatus(instance.userId, instance.id);
    if (liveStatus === "conectado") {
      offlineChecks.delete(instance.id);
      return;
    }
    if (liveStatus === "aguardando_qr" || liveStatus === "aguardando_pareamento") {
      offlineChecks.delete(instance.id);
      return;
    }

    let confirmations = (offlineChecks.get(instance.id) ?? 0) + 1;
    offlineChecks.set(instance.id, confirmations);
    if (confirmations < OFFLINE_CONFIRMATIONS) {
      await wait(1_000);
      const confirmedStatus = await refreshInstanceStatus(instance.userId, instance.id);
      if (confirmedStatus === "conectado") {
        offlineChecks.delete(instance.id);
        return;
      }
      if (confirmedStatus === "aguardando_qr" || confirmedStatus === "aguardando_pareamento") {
        offlineChecks.delete(instance.id);
        return;
      }
      confirmations += 1;
      offlineChecks.set(instance.id, confirmations);
      if (confirmations < OFFLINE_CONFIRMATIONS) return;
    }

    console.warn("[bot-instance-health] sessão offline confirmada; reconectando", {
      instanceId: instance.id,
      name: instance.name,
      confirmations,
    });
    await performInstanceAction(instance.userId, instance.id, "connect", {
      respectDesiredState: true,
    });
    await wait(RECONNECT_SETTLE_MS);
    const reconnectedStatus = await refreshInstanceStatus(instance.userId, instance.id);
    if (reconnectedStatus === "conectado") {
      offlineChecks.delete(instance.id);
      console.info("[bot-instance-health] sessão recuperada", {
        instanceId: instance.id,
        name: instance.name,
      });
      return;
    }

    // Keep the counter at the threshold so a later cycle retries without
    // waiting for the full confirmation window again.
    offlineChecks.set(instance.id, OFFLINE_CONFIRMATIONS);
  } catch (error) {
    console.error("[bot-instance-health] falha ao verificar/reconectar sessão", {
      instanceId: instance.id,
      name: instance.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const runPool = async (instances: BotInstanceAdminSummary[]) => {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(HEALTH_CONCURRENCY, instances.length) },
    async () => {
      while (nextIndex < instances.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await checkInstance(instances[currentIndex]);
      }
    },
  );
  await Promise.all(workers);
};

const runHealthCycle = async () => {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const instances = await listInstancesForAdmin({ includeSystem: false });
    await runPool(instances);
  } catch (error) {
    console.error("[bot-instance-health] falha no ciclo de disponibilidade", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cycleRunning = false;
  }
};

export const startBotInstanceHealthDispatcher = () => {
  if (runtime.__botInstanceHealthDispatcherStarted) return;
  runtime.__botInstanceHealthDispatcherStarted = true;
  setTimeout(() => void runHealthCycle(), 15_000).unref?.();
  setInterval(() => void runHealthCycle(), HEALTH_INTERVAL_MS).unref?.();
};
