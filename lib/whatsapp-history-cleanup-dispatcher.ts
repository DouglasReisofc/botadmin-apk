import { cleanupExpiredFreeWhatsappConversationHistory } from "lib/whatsapp-conversations";

const runtime = globalThis as typeof globalThis & {
  __whatsappHistoryCleanupDispatcherStarted?: boolean;
};

const DEFAULT_HISTORY_RETENTION_HOURS = 24 * 365 * 10;
let running = false;

const intervalMs = Math.max(
  15 * 60 * 1000,
  Number(process.env.WHATSAPP_HISTORY_CLEANUP_INTERVAL_MS || 60 * 60 * 1000),
);

const maxAgeHours = Math.max(
  1,
  Number(process.env.WHATSAPP_FREE_HISTORY_MAX_AGE_HOURS || DEFAULT_HISTORY_RETENTION_HOURS),
);

const runCleanup = async () => {
  if (running) return;
  running = true;
  try {
    const result = await cleanupExpiredFreeWhatsappConversationHistory(maxAgeHours);
    if (result.messagesDeleted > 0 || result.threadsDeleted > 0 || result.eventsDeleted > 0) {
      console.info("[whatsapp-history-cleanup] histórico gratuito limpo", result);
    }
  } catch (error) {
    console.error("[whatsapp-history-cleanup] falha ao limpar histórico gratuito", error);
  } finally {
    running = false;
  }
};

export const startWhatsappHistoryCleanupDispatcher = () => {
  if (runtime.__whatsappHistoryCleanupDispatcherStarted) return;
  runtime.__whatsappHistoryCleanupDispatcherStarted = true;
  setTimeout(runCleanup, 90_000).unref?.();
  setInterval(runCleanup, intervalMs).unref?.();
};
