import {
  dispatchAdminCampaign,
  listAdminCampaignsReadyForDispatch,
  listDueScheduledAdminCampaigns,
  markAdminCampaignError,
  startAdminCampaign,
} from "lib/admin-campaigns";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_SCHEDULE_BATCH = 5;
const DEFAULT_DISPATCH_BATCH = 5;

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const DISPATCH_INTERVAL_MS = parsePositiveInt(
  process.env.ADMIN_CAMPAIGN_DISPATCH_INTERVAL_MS,
  DEFAULT_INTERVAL_MS,
);

const MAX_CONCURRENT_DISPATCH = parsePositiveInt(
  process.env.ADMIN_CAMPAIGN_MAX_CONCURRENT,
  DEFAULT_MAX_CONCURRENT,
);

const SCHEDULE_BATCH_LIMIT = parsePositiveInt(
  process.env.ADMIN_CAMPAIGN_SCHEDULE_BATCH,
  DEFAULT_SCHEDULE_BATCH,
);

const DISPATCH_BATCH_LIMIT = parsePositiveInt(
  process.env.ADMIN_CAMPAIGN_DISPATCH_BATCH,
  DEFAULT_DISPATCH_BATCH,
);

const runtime = globalThis as typeof globalThis & {
  __adminCampaignDispatcherStarted?: boolean;
};

let dispatcherStarted = runtime.__adminCampaignDispatcherStarted ?? false;
let cycleRunning = false;
const inFlightCampaigns = new Set<string>();

const runScheduleStep = async () => {
  if (SCHEDULE_BATCH_LIMIT <= 0) {
    return;
  }

  const dueCampaigns = await listDueScheduledAdminCampaigns(SCHEDULE_BATCH_LIMIT);
  if (dueCampaigns.length === 0) {
    return;
  }

  for (const campaignId of dueCampaigns) {
    try {
      await startAdminCampaign(campaignId);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível iniciar a campanha agendada.";

      // Se a campanha ainda não possui contatos, mantemos como agendada apenas registrando no log.
      if (message.includes("Adicione contatos pendentes")) {
        console.warn("[AdminCampaignDispatcher] Campanha agendada sem contatos pendentes", {
          campaignId,
        });
        continue;
      }

      await markAdminCampaignError(campaignId, message).catch((markError) => {
        console.error("[AdminCampaignDispatcher] Falha ao registrar erro da campanha", {
          campaignId,
          error: markError,
        });
      });

      console.error("[AdminCampaignDispatcher] Falha ao iniciar campanha agendada", {
        campaignId,
        error,
      });
    }
  }
};

const dispatchCampaignAsync = (campaignId: string) => {
  if (inFlightCampaigns.has(campaignId)) {
    return;
  }
  inFlightCampaigns.add(campaignId);

  dispatchAdminCampaign(campaignId)
    .catch((error) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Falha ao processar a campanha.";
      markAdminCampaignError(campaignId, message).catch((markError) => {
        console.error("[AdminCampaignDispatcher] Falha ao registrar erro da campanha", {
          campaignId,
          error: markError,
        });
      });
      console.error("[AdminCampaignDispatcher] Falha ao despachar campanha", {
        campaignId,
        error,
      });
    })
    .finally(() => {
      inFlightCampaigns.delete(campaignId);
    });
};

const runDispatchStep = async () => {
  if (MAX_CONCURRENT_DISPATCH <= 0 || DISPATCH_BATCH_LIMIT <= 0) {
    return;
  }

  const availableSlots = MAX_CONCURRENT_DISPATCH - inFlightCampaigns.size;
  if (availableSlots <= 0) {
    return;
  }

  const batchSize = Math.min(availableSlots, DISPATCH_BATCH_LIMIT);
  const campaigns = await listAdminCampaignsReadyForDispatch(batchSize);

  for (const campaignId of campaigns) {
    if (inFlightCampaigns.size >= MAX_CONCURRENT_DISPATCH) {
      break;
    }
    dispatchCampaignAsync(campaignId);
  }
};

const runAdminCampaignCycle = async () => {
  if (cycleRunning) {
    return;
  }
  cycleRunning = true;
  try {
    await runScheduleStep();
    await runDispatchStep();
  } catch (error) {
    console.error("[AdminCampaignDispatcher] Falha ao executar ciclo", { error });
  } finally {
    cycleRunning = false;
  }
};

export const startAdminCampaignDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }

  dispatcherStarted = true;
  runtime.__adminCampaignDispatcherStarted = true;

  runAdminCampaignCycle().catch((error) => {
    console.error("[AdminCampaignDispatcher] Erro inicial", { error });
  });

  setInterval(() => {
    runAdminCampaignCycle().catch((error) => {
      console.error("[AdminCampaignDispatcher] Erro no intervalo", { error });
    });
  }, DISPATCH_INTERVAL_MS);
};
