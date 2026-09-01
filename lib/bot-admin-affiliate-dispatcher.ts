import { getInstanceSettings } from "lib/bot-instance-settings";
import { getInstanceForUser } from "lib/bot-instances";
import { getGroupByIdForUser } from "lib/bot-groups";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import {
  listEnabledBotAdminAffiliateAutoSharesForRun,
  markBotAdminAffiliateAutoShareRun,
  resolveDueBotAdminAffiliateAutoShareGroupIds,
  type BotAdminAffiliateAutoShareMediaItem,
  type BotAdminAffiliateAutoShareWorkerEntry,
} from "lib/bot-admin-affiliates";
import { sendInteractiveButtons, sendMediaMessage, sendTextMessage } from "lib/wuzapi";

const DISPATCH_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.BOT_ADMIN_AFFILIATE_DISPATCH_INTERVAL_MS ?? 120_000),
);
const DISPATCH_BATCH_SIZE = Math.max(
  1,
  Number(process.env.BOT_ADMIN_AFFILIATE_DISPATCH_BATCH ?? 25),
);
const DISPATCH_FOOTER = "Bot Admin afiliados";
const DISPATCH_TITLE = "*_BotAdmin_*";

type DispatchClient = {
  baseUrl: string;
  token: string;
};

const runtime = globalThis as typeof globalThis & {
  __botAdminAffiliateDispatcherStarted?: boolean;
};

let dispatcherStarted = runtime.__botAdminAffiliateDispatcherStarted ?? false;
let dispatchCycleRunning = false;

const log = (message: string, extra?: Record<string, unknown>) => {
  console.log(`[BotAdminAffiliateDispatcher] ${message}`, extra ?? {});
};

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const bodyWithReferralLink = (messageText: string, referralLink: string): string => {
  const cleanMessage = messageText.trim();
  const normalizedBody = cleanMessage.toLowerCase();
  const normalizedUrl = referralLink.trim().toLowerCase();
  if (normalizedUrl && normalizedBody.includes(normalizedUrl)) {
    return cleanMessage;
  }
  return [cleanMessage, "", `Link: ${referralLink}`].filter(Boolean).join("\n").trim();
};

const pickRandomMedia = (
  mediaItems: BotAdminAffiliateAutoShareMediaItem[] | null | undefined,
): BotAdminAffiliateAutoShareMediaItem | null => {
  const validItems = Array.isArray(mediaItems)
    ? mediaItems.filter((item) => item && (item.path || item.url))
    : [];
  if (validItems.length === 0) {
    return null;
  }
  return validItems[Math.floor(Math.random() * validItems.length)] ?? null;
};

const sendAffiliateMessage = async ({
  client,
  groupJid,
  messageText,
  ctaText,
  referralLink,
  includeButtons,
  mediaItem,
}: {
  client: DispatchClient;
  groupJid: string;
  messageText: string;
  ctaText: string;
  referralLink: string;
  includeButtons: boolean;
  mediaItem?: BotAdminAffiliateAutoShareMediaItem | null;
}): Promise<void> => {
  const body = messageText.trim();
  const fallbackBody = bodyWithReferralLink(body, referralLink);
  const buttonLabel = ctaText.trim() || "Conhecer BotAdmin";
  const mediaSource = mediaItem?.url || mediaItem?.path || "";

  if (includeButtons && mediaItem?.mediaType !== "audio") {
    try {
      await sendInteractiveButtons(client, {
        to: groupJid,
        title: DISPATCH_TITLE,
        body,
        footer: DISPATCH_FOOTER,
        headerMedia: mediaItem?.mediaType === "image" || mediaItem?.mediaType === "video" || mediaItem?.mediaType === "document"
          ? {
              type: mediaItem.mediaType,
              media: mediaSource,
              mimeType: mediaItem.mimeType,
              fileName: mediaItem.fileName,
            }
          : null,
        buttonType: "native",
        buttons: [
          {
            id: "bot_admin_affiliate_open",
            text: buttonLabel,
            type: "cta_url",
            url: referralLink,
          },
        ],
      });
      return;
    } catch (error) {
      log("Falha ao enviar botão CTA; usando fallback em texto", {
        groupJid,
        error: normalizeErrorMessage(error),
      });
    }
  }

  if (mediaItem && mediaSource) {
    try {
      await sendMediaMessage(client, {
        to: groupJid,
        media: mediaSource,
        mediaType: mediaItem.mediaType,
        mimeType: mediaItem.mimeType,
        filename: mediaItem.fileName,
        caption: mediaItem.mediaType === "audio" ? null : fallbackBody,
      });
      if (mediaItem.mediaType === "audio") {
        await sendTextMessage(client, {
          to: groupJid,
          body: fallbackBody,
        });
      }
      return;
    } catch (error) {
      log("Falha ao enviar mídia da divulgação; usando fallback em texto", {
        groupJid,
        mediaType: mediaItem.mediaType,
        error: normalizeErrorMessage(error),
      });
    }
  }

  await sendTextMessage(client, {
    to: groupJid,
    body: fallbackBody,
  });
};

const processAutoShareEntry = async (
  entry: BotAdminAffiliateAutoShareWorkerEntry,
): Promise<void> => {
  let sentCount = 0;
  const errors: string[] = [];
  const dueGroupIds = resolveDueBotAdminAffiliateAutoShareGroupIds(entry.autoShare);

  for (const groupId of dueGroupIds) {
    try {
      const group = await getGroupByIdForUser(entry.userId, groupId);
      if (!group || !group.remoteId || group.status !== "active") {
        throw new Error("Grupo indisponível para divulgação.");
      }
      if (group.metadata?.adminsOnly) {
        throw new Error("Grupo fechado para membros; divulgação automática ignorada.");
      }

      const instance = await getInstanceForUser(entry.userId, group.instanceId);
      if (!instance?.serverBaseUrl || !instance?.token || instance.sessionStatus !== "conectado") {
        throw new Error("Instância do grupo não está conectada.");
      }

      const guard = await resolveBotAutomationGuard({
        userId: entry.userId,
        instanceId: instance.id,
        groupId: group.id,
      });
      if (guard.blocked) {
        continue;
      }

      let nativeButtonsEnabled = false;
      try {
        const settings = await getInstanceSettings(instance.id);
        nativeButtonsEnabled = Boolean(settings.commandToggles.nativeButtons);
      } catch (error) {
        log("Falha ao carregar configuração de botões nativos", {
          userId: entry.userId,
          instanceId: instance.id,
          error: normalizeErrorMessage(error),
        });
      }

      await sendAffiliateMessage({
        client: {
          baseUrl: instance.serverBaseUrl,
          token: instance.token,
        },
        groupJid: group.remoteId,
        messageText: entry.autoShare.messageText,
        ctaText: entry.autoShare.ctaText,
        referralLink: entry.referralLink,
        includeButtons: nativeButtonsEnabled,
        mediaItem: pickRandomMedia(entry.autoShare.mediaItems),
      });

      sentCount += 1;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      errors.push(`grupo ${groupId}: ${message}`);
      log("Falha no disparo de Bot Admin afiliados", {
        userId: entry.userId,
        groupId,
        error: message,
      });
    }
  }

  if (sentCount <= 0) {
    throw new Error(errors[0] ?? "Nenhum grupo apto para divulgação automática.");
  }

  await markBotAdminAffiliateAutoShareRun({ userId: entry.userId });
};

const runDispatchCycle = async (): Promise<void> => {
  if (dispatchCycleRunning) {
    return;
  }
  dispatchCycleRunning = true;

  try {
    const entries = await listEnabledBotAdminAffiliateAutoSharesForRun(DISPATCH_BATCH_SIZE);
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    for (const entry of entries) {
      try {
        await processAutoShareEntry(entry);
      } catch (error) {
        await markBotAdminAffiliateAutoShareRun({
          userId: entry.userId,
          error,
        }).catch(() => {
          // Evita que um erro de escrita interrompa os demais usuários do ciclo.
        });
        log("Falha geral no ciclo de Bot Admin afiliados", {
          userId: entry.userId,
          error: normalizeErrorMessage(error),
        });
      }
    }
  } finally {
    dispatchCycleRunning = false;
  }
};

export const startBotAdminAffiliateDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  runtime.__botAdminAffiliateDispatcherStarted = true;

  void runDispatchCycle();

  const timer = setInterval(() => {
    void runDispatchCycle();
  }, DISPATCH_INTERVAL_MS);

  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }

  log("Dispatcher iniciado", {
    intervalMs: DISPATCH_INTERVAL_MS,
    batch: DISPATCH_BATCH_SIZE,
  });
};
