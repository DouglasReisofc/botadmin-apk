import { sendTextMessage, type MetaWebhookCredentials } from "./meta";
import {
  buildSupportThreadSummary,
  closeSupportThread,
  getMinutesLeftIn24hWindow,
  getSupportThreadByWhatsapp,
  listSupportThreads,
  markSupportReminderSent,
  recordSupportMessage,
  serializeSupportMessage,
  setSupportHandlingMode,
} from "./support";
import { getWebhookRowForUser } from "./webhooks";
import { emitSupportMessageEvent, emitSupportThreadUpdate } from "./realtime";

const REMINDER_THRESHOLD_MINUTES = 15;
const REMINDER_MESSAGE = "Olá! Para mantermos seu atendimento ativo envie uma nova mensagem com sua dúvida.";
const HUMAN_NUDGE_MINUTES = 30;
const HUMAN_NUDGE_MESSAGE = "Estamos com volume alto no momento, mas não esquecemos de você. Se preferir, você pode usar o menu para comprar ou consultar informações imediatamente.";

const toMetaCredentials = (row: Awaited<ReturnType<typeof getWebhookRowForUser>>): MetaWebhookCredentials | null => {
  if (!row?.access_token || !row?.phone_number_id) {
    return null;
  }
  return {
    access_token: row.access_token,
    phone_number_id: row.phone_number_id,
  };
};

export const dispatchSupportReminders = async (userId: number) => {
  try {
    const threads = await listSupportThreads(userId);
    if (threads.length === 0) {
      return;
    }

    const threadsToClose: typeof threads = [];
    const reminderCandidates: typeof threads = [];

    for (const thread of threads) {
      if (thread.status !== "open") {
        continue;
      }

      const { within24h, minutesLeft } = await getMinutesLeftIn24hWindow(userId, thread.whatsappId);

      if (!within24h || minutesLeft <= 0) {
        threadsToClose.push(thread);
        continue;
      }

      if (thread.handlingMode !== "bot" || thread.reminderSentAt) {
        continue;
      }

      if (minutesLeft > REMINDER_THRESHOLD_MINUTES) {
        continue;
      }

      reminderCandidates.push(thread);
    }

    if (threadsToClose.length > 0) {
      await Promise.all(
        threadsToClose.map(async (thread) => {
          try {
            await closeSupportThread(userId, thread.whatsappId);
            const latestThread = await getSupportThreadByWhatsapp(userId, thread.whatsappId);
            const summary = await buildSupportThreadSummary(
              userId,
              latestThread
                ? latestThread
                : {
                    ...thread,
                    status: "closed",
                    handlingMode: "bot",
                    reminderSentAt: null,
                  },
            );
            emitSupportThreadUpdate({ userId, thread: summary });
          } catch (innerError) {
            console.error("Failed to auto-close support thread", innerError);
          }
        }),
      );
    }

    // Nudge de 30min em modo automático próximo do fim da janela
    if (reminderCandidates.length > 0) {
      const webhookRow = await getWebhookRowForUser(userId);
      const credentials = toMetaCredentials(webhookRow);

      if (credentials) {
        await Promise.all(
          reminderCandidates.map(async (thread) => {
            try {
              await sendTextMessage({ webhook: credentials, to: thread.whatsappId, text: REMINDER_MESSAGE });
              const messageRecord = await recordSupportMessage({
                userId,
                whatsappId: thread.whatsappId,
                direction: "outbound",
                messageType: "text",
                text: REMINDER_MESSAGE,
                senderRole: "system",
              });
              await markSupportReminderSent(userId, thread.whatsappId);

              const latestThread = await getSupportThreadByWhatsapp(userId, thread.whatsappId);
              const serializedMessage = serializeSupportMessage(messageRecord.message);
              const summary = await buildSupportThreadSummary(userId, latestThread ?? messageRecord.thread);
              emitSupportMessageEvent({ userId, whatsappId: thread.whatsappId, message: serializedMessage });
              emitSupportThreadUpdate({ userId, thread: summary });
            } catch (innerError) {
              console.error("Failed to dispatch support reminder", innerError);
            }
          }),
        );
      }
    }

    // Nudge de 30 minutos sem resposta no modo humanizado
    const humanNudges = await Promise.all(
      threads.map(async (thread) => {
        if (thread.status !== "open" || thread.handlingMode !== "human" || thread.reminderSentAt) {
          return null;
        }
        // Carrega a última mensagem
        try {
          const latest = await getSupportThreadByWhatsapp(userId, thread.whatsappId);
          if (!latest) return null;

          // Vamos buscar a última mensagem rapidamente
          // Nota: consulta direta para evitar trazer todo o histórico
          const dbLatest = await (async () => {
            try {
              const db = (await import("./db")).getDb();
              const [rows] = await db.query<Array<{ direction: string; timestamp: Date }>>(
                `SELECT direction, timestamp FROM user_support_messages WHERE thread_id = ? ORDER BY timestamp DESC LIMIT 1`,
                [latest.id],
              );
              return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
            } catch {
              return null;
            }
          })();

          if (!dbLatest) return null;
          const lastTs = new Date(dbLatest.timestamp).getTime();
          const diffMin = Math.floor((Date.now() - lastTs) / 60000);
          if (dbLatest.direction === "inbound" && diffMin >= HUMAN_NUDGE_MINUTES) {
            return thread;
          }
        } catch (err) {
          console.error("Failed to evaluate human nudge", err);
        }
        return null;
      }),
    );

    const dueHuman = humanNudges.filter((t): t is NonNullable<typeof t> => Boolean(t));
    if (dueHuman.length > 0) {
      const webhookRow = await getWebhookRowForUser(userId);
      const credentials = toMetaCredentials(webhookRow);
      if (credentials) {
        await Promise.all(
          dueHuman.map(async (thread) => {
            try {
              await sendTextMessage({ webhook: credentials, to: thread.whatsappId, text: HUMAN_NUDGE_MESSAGE });
              const messageRecord = await recordSupportMessage({
                userId,
                whatsappId: thread.whatsappId,
                direction: "outbound",
                messageType: "text",
                text: HUMAN_NUDGE_MESSAGE,
                senderRole: "system",
              });
              const botThread = await setSupportHandlingMode(userId, thread.whatsappId, "bot");
              await markSupportReminderSent(userId, thread.whatsappId);
              const serializedMessage = serializeSupportMessage(messageRecord.message);
              const summary = await buildSupportThreadSummary(
                userId,
                botThread ?? messageRecord.thread,
              );
              emitSupportMessageEvent({ userId, whatsappId: thread.whatsappId, message: serializedMessage });
              emitSupportThreadUpdate({ userId, thread: summary });
            } catch (err) {
              console.error("Failed to send human nudge", err);
            }
          }),
        );
      }
    }
  } catch (error) {
    console.error("Failed to process support reminders", error);
  }
};
