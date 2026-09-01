export async function register() {
  if (process.env.YT_SEARCH_DEBUG !== "1" && process.env.DEBUG === "release") {
    process.env.DEBUG = "0";
  }

  const isBuildPhase =
    process.env.NEXT_PHASE === "phase-production-build" || process.env.NEXT_PHASE === "phase-export";

  if (!isBuildPhase && process.env.NEXT_RUNTIME !== "edge") {
    await import("lib/server-bootstrap");
    const { ensureBotFlowRealtimeWebSocketServer } = await import("lib/bot-flow-realtime-websocket-server");
    await ensureBotFlowRealtimeWebSocketServer();
  }
}
