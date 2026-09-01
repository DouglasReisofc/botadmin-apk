import {
  buildSweepstakeAnnouncement,
  finalizeSweepstake,
  listDueSweepstakes,
  pickSweepstakeWinners,
  type BotSweepstakeParticipant,
  type BotSweepstakeWithInstance,
} from "lib/bot-sweepstakes";
import { sendTextMessage } from "lib/wuzapi";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";

const DISPATCH_INTERVAL_MS = Number.parseInt(
  process.env.SWEEPSTAKES_DISPATCH_INTERVAL_MS ?? "",
  10,
) || 30_000;

const DISPATCH_MAX_BATCH = Number.parseInt(
  process.env.SWEEPSTAKES_DISPATCH_BATCH ?? "",
  10,
) || 20;

const globalSweepstakesRuntime = globalThis as typeof globalThis & {
  __botSweepstakesDispatcherStarted?: boolean;
};
let dispatcherStarted = globalSweepstakesRuntime.__botSweepstakesDispatcherStarted ?? false;
let dispatcherRunning = false;
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NEXT_PHASE === "phase-export";

const announceSweepstakeResult = async (
  sweepstake: BotSweepstakeWithInstance,
  winners: BotSweepstakeParticipant[],
): Promise<void> => {
  if (!sweepstake.instance.baseUrl || !sweepstake.instance.token) {
    return;
  }
  if (!sweepstake.userId || !sweepstake.groupId) {
    return;
  }

  const guard = await resolveBotAutomationGuard({
    userId: sweepstake.userId,
    instanceId: sweepstake.instance.id,
    groupId: sweepstake.groupId,
  });
  if (guard.blocked) {
    return;
  }

  const announcement = buildSweepstakeAnnouncement(sweepstake, winners);
  await sendTextMessage(
    {
      baseUrl: sweepstake.instance.baseUrl,
      token: sweepstake.instance.token,
    },
    {
      to: sweepstake.groupJid,
      body: announcement.body,
      mentions: announcement.mentions,
    },
  );
};

const processDueSweepstake = async (sweepstake: BotSweepstakeWithInstance) => {
  if (!sweepstake.userId || !sweepstake.groupId) {
    return;
  }

  const guard = await resolveBotAutomationGuard({
    userId: sweepstake.userId,
    instanceId: sweepstake.instance.id,
    groupId: sweepstake.groupId,
  });
  if (guard.blocked) {
    return;
  }

  const participants = sweepstake.participants;
  const winners = pickSweepstakeWinners(participants, sweepstake.winnersCount);
  const concludedAt = new Date();

  try {
    if (participants.length > 0) {
      await announceSweepstakeResult(sweepstake, winners);
    } else {
      // Nem todos os provedores permitem enviar mensagens vazias,
      // mas ainda assim registramos o encerramento sem participantes.
      await announceSweepstakeResult(
        sweepstake,
        winners,
      ).catch(() => Promise.resolve());
    }
  } catch (error) {
    console.error("[sweepstakes] Failed to announce sweepstake result", {
      sweepstakeId: sweepstake.id,
      group: sweepstake.groupJid,
      error,
    });
  } finally {
    await finalizeSweepstake(sweepstake.id, {
      status: "completed",
      winners,
      concludedAt,
      metadata: {
        participantsCount: participants.length,
        winnersCount: winners.length,
        announcedAt: concludedAt.toISOString(),
      },
    });
  }
};

const runSweepstakesCycle = async () => {
  if (dispatcherRunning) {
    return;
  }

  dispatcherRunning = true;
  try {
    const due = await listDueSweepstakes(DISPATCH_MAX_BATCH);
    for (const entry of due) {
      await processDueSweepstake(entry);
    }
  } catch (error) {
    console.error("[sweepstakes] cycle error", error);
  } finally {
    dispatcherRunning = false;
  }
};

const startSweepstakesDispatcher = () => {
  if (process.env.ENABLE_BOT_DISPATCHERS === "false") {
    return;
  }
  if (dispatcherStarted) {
    return;
  }

  dispatcherStarted = true;
  globalSweepstakesRuntime.__botSweepstakesDispatcherStarted = true;

  // Primeira execução imediata
  runSweepstakesCycle().catch((error) => {
    console.error("[sweepstakes] initial cycle error", error);
  });

  setInterval(() => {
    void runSweepstakesCycle();
  }, DISPATCH_INTERVAL_MS);
};

// Route modules are imported while Next collects page data. Starting a timer
// there would open a database connection during `next build`, producing noisy
// ECONNREFUSED errors and leaving a worker alive in the build process. The
// runtime bootstrap starts dispatchers after the server is actually running.
if (!isBuildPhase) startSweepstakesDispatcher();
