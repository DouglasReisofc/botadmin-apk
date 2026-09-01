import {
  listDueSisregWatchers,
  listSisregWatchersPendingDigest,
  markSisregDailyNotification,
  markSisregWatcherFailure,
  markSisregWatcherSuccess,
  removeSisregWatcherById,
  tryLockSisregWatcher,
} from "lib/sisreg-watchers";
import { isSisregStatusApproved, querySisregStatus } from "lib/sisreg";
import { sendTextMessage, type WuzapiClient } from "lib/wuzapi";
import { logSisregResult } from "lib/sisreg-log";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";

const DISPATCH_INTERVAL_MS = 60_000;
const BATCH_LIMIT = 15;
const DAILY_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAILY_DIGEST_HOUR = 7;
const DAILY_DIGEST_BATCH_LIMIT = 50;

const globalRuntime = globalThis as typeof globalThis & {
  __sisregWatcherDispatcherStarted?: boolean;
};

let dispatcherStarted = globalRuntime.__sisregWatcherDispatcherStarted ?? false;
let cycleRunning = false;

const formatIntervalLabel = (intervalMs: number): string => {
  const totalMinutes = Math.max(1, Math.round(intervalMs / 60_000));
  if (totalMinutes % (24 * 60) === 0) {
    const days = totalMinutes / (24 * 60);
    return days === 1 ? "1 dia" : `${days} dias`;
  }
  if (totalMinutes % 60 === 0) {
    const hours = totalMinutes / 60;
    return hours === 1 ? "1 hora" : `${hours} horas`;
  }
  return totalMinutes === 1 ? "1 minuto" : `${totalMinutes} minutos`;
};

const makeChatId = (digits: string): string => {
  const sanitized = (digits || "").replace(/\D+/g, "");
  if (!sanitized) {
    return digits.includes("@") ? digits : "";
  }
  return sanitized.includes("@") ? sanitized : `${sanitized}@c.us`;
};

const shouldSendDailyReminder = (lastNotifiedAt: Date | null, now: Date): boolean => {
  if (!lastNotifiedAt) {
    return true;
  }
  return now.getTime() - lastNotifiedAt.getTime() >= DAILY_REMINDER_INTERVAL_MS;
};

const buildDailyReminderMessage = (payload: {
  code: string;
  unit: string;
  status: string | null;
  intervalLabel: string;
}): string => {
  const lines = [
    "🕒 *Atualização diária do SisReg*",
    "",
    `🔢 *Código:* ${payload.code}`,
    `🏥 *Unidade:* ${payload.unit}`,
    "",
    "📋 *Situação atual:*",
    payload.status ?? "Sem retorno fornecido pelo SisReg.",
    "",
    `Continuaremos monitorando a cada ${payload.intervalLabel} e avisaremos assim que houver alteração.`,
  ];
  return lines.join("\n");
};

const getStartOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const buildDigestMessage = (
  entries: Array<{ code: string; unit: string; status: string | null; error?: string | null }>,
): string => {
  const lines: string[] = ["🌅 *Resumo diário do SisReg*", ""];
  for (const entry of entries) {
    const emoji = entry.error ? "⚠️" : entry.status && isSisregStatusApproved(entry.status) ? "✅" : "🕓";
    lines.push(`${emoji} *${entry.code}*`);
    lines.push(`🏥 ${entry.unit}`);
    if (entry.error) {
      lines.push(`⚠️ ${entry.error}`);
    } else {
      lines.push(`📋 ${entry.status ?? "Status não informado pelo SisReg."}`);
    }
    lines.push("");
  }
  lines.push(
    "Continuamos monitorando automaticamente. Assim que houver atualização ou aprovação, enviaremos outro aviso.",
  );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

const runSisregWatcherCycle = async () => {
  if (cycleRunning) {
    return;
  }
  cycleRunning = true;

  try {
    await sendSisregDailyDigestIfNeeded();
    const candidates = await listDueSisregWatchers(BATCH_LIMIT);
    if (!candidates.length) {
      return;
    }

    for (const watcher of candidates) {
      try {
        const locked = await tryLockSisregWatcher(watcher.id);
        if (!locked) {
          continue;
        }

        const intervalMs = Math.max(60_000, watcher.interval_seconds * 1000);
        const guard = await resolveBotAutomationGuard({
          userId: watcher.user_id,
          instanceId: watcher.instance_id,
        });
        if (guard.blocked) {
          await markSisregWatcherFailure(watcher.id, intervalMs);
          continue;
        }

        const client: WuzapiClient | null =
          watcher.base_url && watcher.token ? { baseUrl: watcher.base_url, token: watcher.token } : null;
        if (!client) {
          console.warn("[SisregWatcher] Instância sem credenciais válidas para envio", {
            watcherId: watcher.id,
            instanceId: watcher.instance_id,
          });
          await markSisregWatcherFailure(watcher.id, intervalMs);
          continue;
        }

        const now = new Date();
        let currentStatus: string | null = null;
        let unitResolved = watcher.unit_resolved || watcher.unit_hint || "";

        try {
          const result = await querySisregStatus(watcher.code, unitResolved);
          currentStatus = result.status;
          unitResolved = result.unit;
          const intervalLabel = formatIntervalLabel(intervalMs);
          logSisregResult({
            context: "watcher",
            watcherId: watcher.id,
            instanceId: watcher.instance_id,
            contactDigits: watcher.contact_digits,
            code: watcher.code,
            unitHint: watcher.unit_hint,
            unitResolved,
            status: currentStatus,
            intervalLabel,
            checkedAt: now,
          });
          await markSisregWatcherSuccess(watcher.id, intervalMs, currentStatus, now);

          if (isSisregStatusApproved(currentStatus)) {
            const chatId = makeChatId(watcher.contact_digits);
            if (!chatId) {
              console.warn("[SisregWatcher] Não foi possível determinar o contato destino", {
                watcherId: watcher.id,
                contactDigits: watcher.contact_digits,
              });
            } else {
              const messageLines = [
                "✅ *Consulta SisReg atualizada*",
                `• Código: ${watcher.code}`,
                `• Unidade: ${unitResolved}`,
                `• Situação: ${currentStatus}`,
                "",
                "O monitoramento foi finalizado automaticamente.",
              ];
              try {
                await sendTextMessage(client, {
                  to: chatId,
                  body: messageLines.join("\n"),
                });
              } catch (error) {
                console.error("[SisregWatcher] Falha ao notificar aprovação", {
                  watcherId: watcher.id,
                  chatId,
                  error,
                });
                // Mantém o watcher ativo para tentar novamente
                continue;
              }
            }

            await removeSisregWatcherById(watcher.id);
            continue;
          }

          const shouldNotifyDaily =
            Boolean(watcher.contact_digits) &&
            shouldSendDailyReminder(watcher.daily_notified_at, now);

          if (shouldNotifyDaily) {
            const chatId = makeChatId(watcher.contact_digits);
            if (!chatId) {
              console.warn("[SisregWatcher] Não foi possível enviar atualização diária", {
                watcherId: watcher.id,
                contactDigits: watcher.contact_digits,
              });
            } else {
              const dailyMessage = buildDailyReminderMessage({
                code: watcher.code,
                unit: unitResolved,
                status: currentStatus,
                intervalLabel,
              });
              try {
                await sendTextMessage(client, {
                  to: chatId,
                  body: dailyMessage,
                });
                await markSisregDailyNotification(watcher.id, now);
              } catch (error) {
                console.error("[SisregWatcher] Falha ao enviar lembrete diário", {
                  watcherId: watcher.id,
                  chatId,
                  error,
                });
              }
            }
          }
        } catch (error) {
          console.error("[SisregWatcher] Falha ao consultar status", {
            watcherId: watcher.id,
            instanceId: watcher.instance_id,
            error,
          });
          await markSisregWatcherFailure(watcher.id, intervalMs);
        }
      } catch (error) {
        console.error("[SisregWatcher] Erro ao processar acompanhamento", {
          watcherId: watcher.id,
          error,
        });
      }
    }
  } catch (error) {
    console.error("[SisregWatcher] Falha no ciclo de processamento", { error });
  } finally {
    cycleRunning = false;
  }
};

const sendSisregDailyDigestIfNeeded = async () => {
  const now = new Date();
  if (now.getHours() < DAILY_DIGEST_HOUR) {
    return;
  }

  const startOfDay = getStartOfDay(now);

  while (true) {
    const pending = await listSisregWatchersPendingDigest(DAILY_DIGEST_BATCH_LIMIT, startOfDay);
    if (!pending.length) {
      break;
    }

    const groups = new Map<
      string,
      {
        client: WuzapiClient | null;
        watchers: typeof pending;
      }
    >();

    for (const watcher of pending) {
      const key = `${watcher.instance_id}:${watcher.contact_digits ?? ""}`;
      if (!groups.has(key)) {
        const client =
          watcher.base_url && watcher.token ? { baseUrl: watcher.base_url, token: watcher.token } : null;
        groups.set(key, { client, watchers: [] });
      }
      groups.get(key)!.watchers.push(watcher);
    }

    for (const { client, watchers } of groups.values()) {
      const firstWatcher = watchers[0];
      if (firstWatcher) {
        const guard = await resolveBotAutomationGuard({
          userId: firstWatcher.user_id,
          instanceId: firstWatcher.instance_id,
        });
        if (guard.blocked) {
          continue;
        }
      }

      if (!client) {
        console.warn("[SisregDigest] Instância sem credenciais válidas", {
          instanceId: watchers[0]?.instance_id,
        });
        continue;
      }
      const chatId = makeChatId(watchers[0]?.contact_digits ?? "");
      if (!chatId) {
        console.warn("[SisregDigest] Destinatário inválido para digest", {
          instanceId: watchers[0]?.instance_id,
          contact: watchers[0]?.contact_digits,
        });
        continue;
      }

      const summaryEntries: Array<{ code: string; unit: string; status: string | null; error?: string | null }> =
        [];

      for (const watcher of watchers) {
        try {
          const result = await querySisregStatus(watcher.code, watcher.unit_resolved || watcher.unit_hint || "");
          summaryEntries.push({
            code: watcher.code,
            unit: result.unit,
            status: result.status,
          });
          await markSisregWatcherSuccess(
            watcher.id,
            Math.max(60_000, watcher.interval_seconds * 1000),
            result.status,
            now,
          );
          logSisregResult({
            context: "watcher",
            watcherId: watcher.id,
            instanceId: watcher.instance_id,
            contactDigits: watcher.contact_digits,
            code: watcher.code,
            unitHint: watcher.unit_hint,
            unitResolved: result.unit,
            status: result.status,
            intervalLabel: formatIntervalLabel(watcher.interval_seconds * 1000),
            checkedAt: now,
          });
        } catch (error) {
          console.error("[SisregDigest] Falha ao consultar status para digest", {
            watcherId: watcher.id,
            code: watcher.code,
            error,
          });
          summaryEntries.push({
            code: watcher.code,
            unit: watcher.unit_resolved || watcher.unit_hint || "-",
            status: null,
            error:
              error instanceof Error && error.message
                ? error.message
                : "Não consegui consultar o SisReg agora.",
          });
        }
      }

      if (!summaryEntries.length) {
        continue;
      }

      const message = buildDigestMessage(summaryEntries);

      try {
        await sendTextMessage(client, {
          to: chatId,
          body: message,
        });
        await Promise.all(watchers.map((watcher) => markSisregDailyNotification(watcher.id, now)));
      } catch (error) {
        console.error("[SisregDigest] Falha ao enviar resumo diário", {
          instanceId: watchers[0]?.instance_id,
          contact: watchers[0]?.contact_digits,
          error,
        });
      }
    }
  }
};

export const startSisregWatcherDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  globalRuntime.__sisregWatcherDispatcherStarted = true;
  runSisregWatcherCycle().catch((error) => {
    console.error("[SisregWatcher] Erro inicial", { error });
  });
  setInterval(() => {
    runSisregWatcherCycle().catch((error) => {
      console.error("[SisregWatcher] Erro no intervalo", { error });
    });
  }, DISPATCH_INTERVAL_MS);
};
