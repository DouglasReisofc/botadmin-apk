const runtime = globalThis as typeof globalThis & { __broadcastScheduleDispatcherStarted?: boolean };
export const startBroadcastScheduleDispatcher = () => {
  if (runtime.__broadcastScheduleDispatcherStarted) return;
  runtime.__broadcastScheduleDispatcherStarted = true;
  let running = false;
  // Import on execution, not bootstrap. broadcast-lists also reaches the
  // WhatsApp runtime, so a static import here would create a server-start cycle.
  const run = async () => { if (running) return; running = true; try { const { dispatchDueBroadcastSchedules, dispatchDueBroadcastRuns } = await import("./broadcast-lists"); await dispatchDueBroadcastSchedules(); await dispatchDueBroadcastRuns(); } catch (error) { console.error("[broadcast-schedule] dispatch failed", error); } finally { running = false; } };
  void run(); setInterval(() => void run(), 15_000).unref();
  console.info("[broadcast-schedule] dispatcher iniciado", { intervalMs: 15_000 });
};
