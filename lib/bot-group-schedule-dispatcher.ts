import { getDb } from "lib/db";
import type { ResultSetHeader } from "mysql2/promise";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import { invalidateGroupSettingsCache } from "lib/bot-events/cache";
import {
  markCloseDispatch,
  markOpenDispatch,
  shouldCloseGroupAt,
  shouldOpenGroupAt,
} from "lib/bot-group-schedule";
import {
  sendTextMessage,
  setMessagesAdminsOnly,
  type WuzapiClient,
} from "lib/wuzapi";
import { resolveTimezonePreference } from "lib/timezones";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import type { BotGroupScheduleConfig } from "types/bot-groups";
import {
  dispatchInternalGroupAutomationMessage,
  setInternalGroupAdminsOnly,
} from "lib/internal-groups";

type ScheduleDispatcherRow = {
  group_id: number;
  user_id: number;
  instance_id: number | null;
  remote_id: string;
  base_url: string | null;
  token: string | null;
  session_status: string | null;
  internal_group_id: number | null;
  owner_timezone: string | null;
  owner_whatsapp: string | null;
  schedule_config: string | null;
};

// Check frequently enough that a minute boundary is not missed when the
// process starts at an arbitrary second. Database claims keep multiple slots
// idempotent, so the shorter cadence only improves punctuality.
const DISPATCH_INTERVAL_MS = 10_000;
const DEFAULT_CLOSE_MESSAGE = "🚫 Grupo fechado automaticamente conforme programação.";
const DEFAULT_OPEN_MESSAGE = "✅ Grupo aberto automaticamente conforme programação.";

const runtime = globalThis as typeof globalThis & {
  __scheduleDispatcherStarted?: boolean;
  __scheduleDispatchInFlight?: Set<string>;
};

let dispatcherStarted = runtime.__scheduleDispatcherStarted ?? false;
let cycleRunning = false;
const scheduleDispatchInFlight =
  runtime.__scheduleDispatchInFlight ?? new Set<string>();
runtime.__scheduleDispatchInFlight = scheduleDispatchInFlight;

const resolveScheduleMessage = (message: string | null | undefined, fallback: string): string | null => {
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (trimmed.length > 0) {
    return trimmed;
  }
  return fallback;
};

const persistScheduleConfig = async (groupId: number, scheduleConfig: BotGroupScheduleConfig) => {
  await upsertGroupSettings(groupId, { scheduleConfig });
  invalidateGroupSettingsCache(groupId);
};

const claimScheduleDispatch = async (
  groupId: number,
  currentRawConfig: string | null,
  nextConfig: BotGroupScheduleConfig,
): Promise<boolean> => {
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      UPDATE bot_group_settings
      SET schedule_config = ?
      WHERE group_id = ?
        AND schedule_config IS NOT DISTINCT FROM ?
    `,
    [JSON.stringify(nextConfig), groupId, currentRawConfig],
  );
  if (result.affectedRows > 0) {
    invalidateGroupSettingsCache(groupId);
    return true;
  }
  return false;
};

const runScheduleDispatchCycle = async () => {
  if (cycleRunning) {
    return;
  }
  cycleRunning = true;
  try {
    const db = getDb();
    const [rows] = await db.query<ScheduleDispatcherRow[]>(
      `
        SELECT
          g.id AS group_id,
          g.user_id,
          g.instance_id,
          g.remote_id,
          i.base_url,
          i.token,
          i.session_status,
          u.timezone AS owner_timezone,
          u.whatsapp_number AS owner_whatsapp,
          s.schedule_config
          ,ig.id AS internal_group_id
        FROM bot_groups g
        LEFT JOIN bot_instances i ON i.id = g.instance_id
        LEFT JOIN internal_groups ig ON ig.bot_group_id = g.id
        INNER JOIN users u ON u.id = g.user_id
        INNER JOIN bot_group_settings s ON s.group_id = g.id
        WHERE g.status = 'active'
          AND ((ig.id IS NOT NULL AND ig.is_active = 1 AND ig.bot_enabled = 1)
            OR i.session_status = 'conectado')
          AND s.schedule_config IS NOT NULL
      `,
    );

    const now = new Date();

    for (const row of rows) {
      const isInternal = Number(row.internal_group_id ?? 0) > 0;
      if (!row.remote_id || (!isInternal && (!row.base_url || !row.token))) {
        continue;
      }

      try {
        if (!isInternal) {
          const guard = await resolveBotAutomationGuard({
            userId: row.user_id,
            instanceId: row.instance_id!,
            groupId: row.group_id,
          });
          if (guard.blocked) continue;
        }

        const settings = await getGroupSettings(row.group_id);
        const config = settings.scheduleConfig;
        if (
          !config ||
          (!config.closeEnabled || config.closeTimes.length === 0) &&
            (!config.openEnabled || config.openTimes.length === 0)
        ) {
          continue;
        }

        const effectiveTimezone = resolveTimezonePreference({
          preferred: [config.timezone, settings.horapgConfig?.timezone],
          ownerTimezone: row.owner_timezone,
          ownerWhatsapp: row.owner_whatsapp,
        });

        const closeDecision = shouldCloseGroupAt(config, now, { timezone: effectiveTimezone });
        const openDecision = shouldOpenGroupAt(config, now, { timezone: effectiveTimezone });

        const client: WuzapiClient = { baseUrl: row.base_url ?? "", token: row.token ?? "" };
        let updatedConfig = config;
        let changed = false;

        if (closeDecision.run) {
          const dispatchKey = `${row.group_id}:close:${closeDecision.context.dateIso}:${closeDecision.clock}`;
          if (scheduleDispatchInFlight.has(dispatchKey)) {
            continue;
          }
            scheduleDispatchInFlight.add(dispatchKey);
          const previousConfig = updatedConfig;
          const previousRawConfig = row.schedule_config;
          try {
            updatedConfig = markCloseDispatch(updatedConfig, closeDecision.clock, closeDecision.context);
            const claimed = await claimScheduleDispatch(row.group_id, row.schedule_config, updatedConfig);
            if (!claimed) {
              continue;
            }
            row.schedule_config = JSON.stringify(updatedConfig);
            if (isInternal) {
              await setInternalGroupAdminsOnly(row.group_id, true);
            } else {
              await setMessagesAdminsOnly(client, {
                groupJid: row.remote_id,
                onlyAdmins: true,
              });
            }
            const closeMessage = resolveScheduleMessage(updatedConfig.closeMessage, DEFAULT_CLOSE_MESSAGE);
            if (closeMessage) {
              if (isInternal) {
                await dispatchInternalGroupAutomationMessage(row.group_id, closeMessage);
              } else {
                await sendTextMessage(client, { to: row.remote_id, body: closeMessage });
              }
            }
          } catch (error) {
            // The claim is persisted before the remote WhatsApp call to avoid
            // duplicate execution. Roll it back on failure so the next cycle
            // can retry inside the grace window instead of skipping the day.
            await claimScheduleDispatch(
              row.group_id,
              row.schedule_config,
              previousConfig,
            ).catch(() => false);
            updatedConfig = previousConfig;
            row.schedule_config = previousRawConfig;
            console.error("[ScheduleDispatcher] Falha ao fechar grupo automaticamente", {
              groupId: row.group_id,
              error,
            });
          } finally {
            scheduleDispatchInFlight.delete(dispatchKey);
          }
        }

        if (openDecision.run) {
          const dispatchKey = `${row.group_id}:open:${openDecision.context.dateIso}:${openDecision.clock}`;
          if (scheduleDispatchInFlight.has(dispatchKey)) {
            continue;
          }
            scheduleDispatchInFlight.add(dispatchKey);
          const previousConfig = updatedConfig;
          const previousRawConfig = row.schedule_config;
          try {
            updatedConfig = markOpenDispatch(updatedConfig, openDecision.clock, openDecision.context);
            const claimed = await claimScheduleDispatch(row.group_id, row.schedule_config, updatedConfig);
            if (!claimed) {
              continue;
            }
            row.schedule_config = JSON.stringify(updatedConfig);
            if (isInternal) {
              await setInternalGroupAdminsOnly(row.group_id, false);
            } else {
              await setMessagesAdminsOnly(client, {
                groupJid: row.remote_id,
                onlyAdmins: false,
              });
            }
            const openMessage = resolveScheduleMessage(updatedConfig.openMessage, DEFAULT_OPEN_MESSAGE);
            if (openMessage) {
              if (isInternal) {
                await dispatchInternalGroupAutomationMessage(row.group_id, openMessage);
              } else {
                await sendTextMessage(client, { to: row.remote_id, body: openMessage });
              }
            }
          } catch (error) {
            await claimScheduleDispatch(
              row.group_id,
              row.schedule_config,
              previousConfig,
            ).catch(() => false);
            updatedConfig = previousConfig;
            row.schedule_config = previousRawConfig;
            console.error("[ScheduleDispatcher] Falha ao abrir grupo automaticamente", {
              groupId: row.group_id,
              error,
            });
          } finally {
            scheduleDispatchInFlight.delete(dispatchKey);
          }
        }

        if (changed) {
          await upsertGroupSettings(row.group_id, { scheduleConfig: updatedConfig });
          invalidateGroupSettingsCache(row.group_id);
        }
      } catch (error) {
        console.error("[ScheduleDispatcher] Erro ao processar grupo", {
          groupId: row.group_id,
          error,
        });
      }
    }
  } catch (error) {
    console.error("[ScheduleDispatcher] Falha no ciclo", { error });
  } finally {
    cycleRunning = false;
  }
};

export const startScheduleDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  runtime.__scheduleDispatcherStarted = true;
  runScheduleDispatchCycle().catch((error) =>
    console.error("[ScheduleDispatcher] Erro inicial", { error }),
  );
  setInterval(() => {
    runScheduleDispatchCycle().catch((error) =>
      console.error("[ScheduleDispatcher] Erro no intervalo", { error }),
    );
  }, DISPATCH_INTERVAL_MS);
};
