import { getDb } from "lib/db";
import { getGroupSettings, normalizeScheduleConfigEntry } from "lib/bot-group-settings";
import { invalidateGroupSettingsCache } from "lib/bot-events/cache";
import { getLatestGroupScheduleAction, markCloseDispatch, markOpenDispatch } from "lib/bot-group-schedule";
import { getGroupInfo, sendTextMessage, setMessagesAdminsOnly, type WuzapiClient } from "lib/wuzapi";
import { resolveTimezonePreference } from "lib/timezones";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import { dispatchInternalGroupAutomationMessage } from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";

type ScheduleDispatcherRow = {
  group_id: number;
  user_id: number;
  instance_id: number | null;
  remote_id: string;
  base_url: string | null;
  token: string | null;
  internal_group_id: number | null;
  owner_timezone: string | null;
  owner_whatsapp: string | null;
  schedule_config: string | null;
};

const DISPATCH_INTERVAL_MS = 10_000;
const runtime = globalThis as typeof globalThis & { __scheduleDispatcherStarted?: boolean };
let cycleRunning = false;

// Row locks are released on process/connection death. A crash must never leave
// a persisted "sent" marker for an action that has not reached WhatsApp.
export const runScheduleDispatchCycle = async () => {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const db = getDb();
    const [rows] = await db.query<ScheduleDispatcherRow[]>(`
      SELECT g.id AS group_id, g.user_id, g.instance_id, g.remote_id,
        i.base_url, i.token, u.timezone AS owner_timezone,
        u.whatsapp_number AS owner_whatsapp, ig.id AS internal_group_id, s.schedule_config
      FROM bot_groups g
      LEFT JOIN bot_instances i ON i.id = g.instance_id
      LEFT JOIN internal_groups ig ON ig.bot_group_id = g.id
      JOIN users u ON u.id = g.user_id
      JOIN bot_group_settings s ON s.group_id = g.id
      WHERE g.status = 'active'
        AND ((ig.id IS NOT NULL AND ig.is_active = 1 AND ig.bot_enabled = 1)
          OR i.session_status = 'conectado')
        AND s.schedule_config IS NOT NULL
    `);
    for (const row of rows) {
      const isInternal = Number(row.internal_group_id ?? 0) > 0;
      if (!row.remote_id || (!isInternal && (!row.base_url || !row.token))) continue;
      try {
        const candidateConfig = normalizeScheduleConfigEntry(row.schedule_config);
        if (!candidateConfig.openEnabled && !candidateConfig.closeEnabled) continue;
        if (!isInternal) {
          const guard = await resolveBotAutomationGuard({ userId: row.user_id, instanceId: row.instance_id!, groupId: row.group_id });
          if (guard.blocked) continue;
        }
        const settings = await getGroupSettings(row.group_id);
        const timezone = resolveTimezonePreference({
          preferred: [settings.scheduleConfig?.timezone, settings.horapgConfig?.timezone],
          ownerTimezone: row.owner_timezone, ownerWhatsapp: row.owner_whatsapp,
        });
        const connection = await db.getConnection();
        let notification: string | null = null;
        const client: WuzapiClient = { baseUrl: row.base_url ?? "", token: row.token ?? "" };
        try {
          await connection.beginTransaction();
          // Skip a group already being handled by another slot rather than
          // queueing behind it. Read fresh settings after acquiring the lock.
          const [locked] = await connection.query<Array<{ schedule_config: string | null }>>(`
            SELECT schedule_config FROM bot_group_settings WHERE group_id = ? FOR UPDATE SKIP LOCKED
          `, [row.group_id]);
          if (!locked.length) { await connection.rollback(); continue; }
          const config = normalizeScheduleConfigEntry(locked[0].schedule_config);
          const effectiveTimezone = resolveTimezonePreference({ preferred: [config.timezone, timezone] });
          const decision = getLatestGroupScheduleAction(config, new Date(), { timezone: effectiveTimezone });
          if (!decision?.run) { await connection.rollback(); continue; }
          const onlyAdmins = decision.action === "close";
          let alreadyApplied = false;
          if (isInternal) {
            const [groups] = await connection.query<Array<{ admins_only: number | boolean }>>(
              "SELECT admins_only FROM internal_groups WHERE bot_group_id = ? AND is_active = 1 AND bot_enabled = 1 FOR UPDATE", [row.group_id]);
            if (!groups.length) { await connection.rollback(); continue; }
            alreadyApplied = Boolean(groups[0].admins_only) === onlyAdmins;
            if (!alreadyApplied) await connection.query("UPDATE internal_groups SET admins_only = ?, updated_at = NOW() WHERE bot_group_id = ?", [onlyAdmins ? 1 : 0, row.group_id]);
          } else {
            // Bound how long this one settings row can be locked by HTTP I/O.
            const signal = AbortSignal.timeout(12_000);
            const response = await getGroupInfo<{ data?: { IsAnnounce?: boolean }; IsAnnounce?: boolean }>(client, row.remote_id, signal);
            const info = response.data ?? response;
            if (typeof info?.IsAnnounce !== "boolean") throw new Error("Não foi possível verificar o estado atual do grupo");
            alreadyApplied = info.IsAnnounce === onlyAdmins;
            if (!alreadyApplied) {
              await setMessagesAdminsOnly(client, { groupJid: row.remote_id, onlyAdmins, signal });
              const verified = await getGroupInfo<{ data?: { IsAnnounce?: boolean }; IsAnnounce?: boolean }>(client, row.remote_id, signal);
              if ((verified.data ?? verified).IsAnnounce !== onlyAdmins) throw new Error("WhatsApp ainda não confirmou o estado programado");
            }
          }
          const nextConfig = decision.action === "close"
            ? markCloseDispatch(config, decision.clock, decision.context)
            : markOpenDispatch(config, decision.clock, decision.context);
          await connection.query("UPDATE bot_group_settings SET schedule_config = ? WHERE group_id = ?", [JSON.stringify(nextConfig), row.group_id]);
          await connection.commit();
          invalidateGroupSettingsCache(row.group_id);
          if (isInternal && !alreadyApplied) emitInternalGroupEvent({ groupId: Number(row.internal_group_id), actorUserId: row.user_id, type: "group.updated", action: "schedule.applied" });
          console.info("[ScheduleDispatcher] Estado programado confirmado", {
            groupId: row.group_id, action: decision.action, date: decision.context.dateIso,
            clock: decision.clock, overdueMinutes: decision.overdueMinutes, alreadyApplied,
          });
          // Do not spam old announcements after an outage or announce a change
          // which an administrator already made. Notification failure must not
          // roll back a successful state change or repeat the WhatsApp action.
          if (!alreadyApplied && decision.overdueMinutes <= 3) {
            notification = config[`${decision.action}Message`]?.trim() || (onlyAdmins
              ? "🚫 Grupo fechado automaticamente conforme programação."
              : "✅ Grupo aberto automaticamente conforme programação.");
          }
        } catch (error) {
          await connection.rollback().catch(() => undefined);
          throw error;
        } finally {
          connection.release();
        }
        if (notification) {
          try {
            if (isInternal) await dispatchInternalGroupAutomationMessage(row.group_id, notification);
            else await sendTextMessage(client, { to: row.remote_id, body: notification });
          } catch (error) {
            console.error("[ScheduleDispatcher] Estado aplicado; falha somente no aviso", { groupId: row.group_id, error });
          }
        }
      } catch (error) {
        console.error("[ScheduleDispatcher] Erro ao processar grupo", { groupId: row.group_id, error });
      }
    }
  } catch (error) {
    console.error("[ScheduleDispatcher] Falha no ciclo", { error });
  } finally {
    cycleRunning = false;
  }
};

export const startScheduleDispatcher = () => {
  if (runtime.__scheduleDispatcherStarted) return;
  runtime.__scheduleDispatcherStarted = true;
  void runScheduleDispatchCycle();
  setInterval(() => { void runScheduleDispatchCycle(); }, DISPATCH_INTERVAL_MS);
};
