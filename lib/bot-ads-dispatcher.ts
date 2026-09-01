import { getDb } from "lib/db";
import type { RowDataPacket } from "mysql2";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import {
  sendInteractiveButtons,
  sendMediaMessage,
  sendStickerMessage,
  sendTextMessage,
  type InteractiveButton,
  type WuzapiClient,
} from "lib/wuzapi";
import { getInstanceSettings } from "lib/bot-instance-settings";
import { resolveStoredMediaBuffer } from "lib/media-storage";
import { resolveTimezonePreference } from "lib/timezones";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import type { BotGroupAd } from "types/bot-groups";
import { dispatchInternalGroupAutomationMessage } from "lib/internal-groups";

type AdsDispatcherRow = RowDataPacket & {
  group_id: number;
  user_id: number;
  instance_id: number | null;
  remote_id: string;
  participants: string | null;
  base_url: string | null;
  token: string | null;
  session_status: string | null;
  internal_group_id: number | null;
  owner_timezone: string | null;
  owner_whatsapp: string | null;
};

// Keep scheduled transmissions close to their configured minute instead of
// waiting up to a full minute for the next dispatcher cycle.
const ADS_DISPATCH_INTERVAL_MS = 15_000;
const ADS_TIME_WINDOW_MINUTES = 5;
const ENV_ADS_DISPATCH_TIMEZONE = process.env.ADS_DISPATCH_TIMEZONE ?? null;
const ADS_MAX_MENTION_COUNT = Number.isFinite(Number(process.env.ADS_MAX_MENTION_COUNT))
  ? Math.max(1, Math.floor(Number(process.env.ADS_MAX_MENTION_COUNT)))
  : 32;

const globalRuntime = globalThis as typeof globalThis & {
  __botAdsDispatcherStarted?: boolean;
};
let dispatcherStarted = globalRuntime.__botAdsDispatcherStarted ?? false;
let cycleRunning = false;

const isUnauthorizedError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status === 401) {
    return true;
  }
  const response = (error as { response?: unknown }).response;
  if (response && typeof response === "object") {
    const responseCode = (response as { code?: unknown }).code;
    if (typeof responseCode === "number" && responseCode === 401) {
      return true;
    }
    const responseError = (response as { error?: unknown }).error;
    if (typeof responseError === "string" && responseError.trim().toLowerCase() === "unauthorized") {
      return true;
    }
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message.toLowerCase().includes("unauthorized")) {
    return true;
  }
  return false;
};

type SendAdResult = {
  delivered: boolean;
  unauthorized: boolean;
};

const frequencyToMs = (value: string | null | undefined): number => {
  if (typeof value !== "string") {
    return 24 * 60 * 60 * 1000;
  }
  const match = value.trim().match(/^(\d{1,4})([mhd])$/i);
  if (!match) {
    return 24 * 60 * 60 * 1000;
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return 24 * 60 * 60 * 1000;
  }
  switch (unit) {
    case "m":
      return amount * 60 * 1000;
    case "h":
      return amount * 60 * 60 * 1000;
    case "d":
      return amount * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
};

const normalizeTimeToken = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = /^([0-2]?\d):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
};

const sanitizeTimes = (entries: unknown): string[] => {
  if (!Array.isArray(entries)) {
    return [];
  }
  const normalized = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const normalizedEntry =
      typeof entry === "string" ? normalizeTimeToken(entry) : null;
    if (!normalizedEntry) continue;
    if (normalized.has(normalizedEntry)) continue;
    normalized.add(normalizedEntry);
    out.push(normalizedEntry);
    if (out.length >= 10) break;
  }
  return out;
};

const parseParticipantIds = (raw: unknown): string[] => {
  if (raw === null || raw === undefined) {
    return [];
  }
  const collectFromArray = (source: unknown[]): string[] => {
    const out: string[] = [];
    for (const entry of source) {
      if (typeof entry === "string" && entry.trim()) {
        out.push(entry.trim());
        continue;
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const idCandidates = [
          record.id,
          record.Id,
          record.ID,
          record.jid,
          record.JID,
          record._serialized,
          record.phone,
          record.Phone,
          record.Number,
        ];
        const idCandidate = idCandidates.find(
          (candidate) => typeof candidate === "string" && candidate.trim(),
        );
        if (typeof idCandidate === "string" && idCandidate.trim()) {
          out.push(idCandidate.trim());
        }
      }
      if (out.length >= 256) {
        break;
      }
    }
    return out;
  };

  if (Array.isArray(raw)) {
    return collectFromArray(raw);
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    if (/^\[object\b/i.test(trimmed)) {
      return [];
    }
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? collectFromArray(parsed) : [];
    } catch {
      return [];
    }
  }

  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.participants)) {
      return collectFromArray(record.participants);
    }
    if (Array.isArray(record.data)) {
      return collectFromArray(record.data);
    }
  }

  return [];
};

const getTimezoneContext = (date: Date, timezone: string) => {
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateParts = dateFormatter.formatToParts(date);
  const timeParts = timeFormatter.formatToParts(date);
  const dateStr = `${dateParts.find((p) => p.type === "year")?.value ?? "0000"}-${
    dateParts.find((p) => p.type === "month")?.value ?? "01"
  }-${dateParts.find((p) => p.type === "day")?.value ?? "01"}`;
  const hour = Number(timeParts.find((p) => p.type === "hour")?.value ?? "00");
  const minute = Number(timeParts.find((p) => p.type === "minute")?.value ?? "00");
  const clock = `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
  return {
    date: dateStr,
    clock,
    minutes: hour * 60 + minute,
  };
};

const buildMentionPayload = (
  baseText: string,
  mentionJids: string[],
): { body: string; mentions: string[] } => {
  if (mentionJids.length === 0) {
    return { body: baseText, mentions: [] };
  }
  const limitedMentions = mentionJids.slice(0, ADS_MAX_MENTION_COUNT);
  const mentionHandles = limitedMentions.map((jid) => `@${jid.replace(/@.+$/, "")}`);
  const mentionText = mentionHandles.join(" ");
  const body = baseText ? `${mentionText}\n${baseText}` : mentionText;
  return { body, mentions: limitedMentions };
};

const sendAdMessage = async ({
  client,
  groupJid,
  ad,
  mentionJids,
  nativeButtonsEnabled,
}: {
  client: WuzapiClient;
  groupJid: string;
  ad: BotGroupAd;
  mentionJids: string[];
  nativeButtonsEnabled: boolean;
}): Promise<SendAdResult> => {
  try {
    const text = (ad.caption ?? "").trim();
    const { body, mentions } = buildMentionPayload(text, mentionJids);
    const buttonTemplate = ad.responseButtons ?? null;
    const mappedInteractiveButtons: InteractiveButton[] = Array.isArray(ad.interactiveButtons)
      ? ad.interactiveButtons.slice(0, 3).flatMap((button, index) => {
          const id = button.id?.trim() || `ad_${ad.id}_${index + 1}`;
          const text = button.label?.trim() || "";
          if (!text) return [];
          if (button.type === "cta_url" && button.url) {
            return [{ id, text, type: "cta_url" as const, url: button.url }];
          }
          if (button.type === "cta_call" && button.phoneNumber) {
            return [{ id, text, type: "cta_call" as const, phoneNumber: button.phoneNumber }];
          }
          if (button.type === "cta_copy" && button.copyCode) {
            return [{ id, text, type: "cta_copy" as const, copyCode: button.copyCode }];
          }
          const command = button.command?.trim().replace(/^[!/#$%&.~]+/, "") || "";
          if (!command) return [];
          const args = button.args?.trim() || "";
          const buttonId = args ? `${command}|${encodeURIComponent(args)}` : command;
          return [{
            id: buttonId,
            text,
            type: "quick_reply" as const,
            payload: {
              id: buttonId,
              buttonId,
              command,
              commandArgs: args || undefined,
              source: "scheduled_ad",
            },
          }];
        })
      : [];
    const mappedLegacyButtons: InteractiveButton[] = buttonTemplate
      ? buttonTemplate.buttons.slice(0, 3).flatMap((button, index) => {
          const id = button.id || `ad_${ad.id}_${index + 1}`;
          if (buttonTemplate.type === "button_reply") {
            return [{ id, text: button.text, type: "quick_reply" as const }];
          }
          if (button.type === "cta_url" && button.url) {
            return [{ id, text: button.text, type: "cta_url" as const, url: button.url }];
          }
          if (button.type === "cta_call" && button.phoneNumber) {
            return [{ id, text: button.text, type: "cta_call" as const, phoneNumber: button.phoneNumber }];
          }
          if (button.type === "cta_copy" && button.copyCode) {
            return [{ id, text: button.text, type: "cta_copy" as const, copyCode: button.copyCode }];
          }
          return [];
        })
      : [];
    const candidateButtons = mappedInteractiveButtons.length > 0
      ? mappedInteractiveButtons
      : mappedLegacyButtons;
    const firstFamily = candidateButtons[0]?.type === "quick_reply" ? "reply" : "action";
    const mappedButtons = candidateButtons.filter((button) =>
      firstFamily === "reply" ? button.type === "quick_reply" : button.type !== "quick_reply",
    );

    const sendButtonsMessage = async (
      fallbackBody: string,
      headerMedia?: Parameters<typeof sendInteractiveButtons>[1]["headerMedia"],
    ) => {
      if (mappedButtons.length === 0) {
        return false;
      }
      await sendInteractiveButtons(client, {
        to: groupJid,
        title: buttonTemplate?.title?.trim() || "ADS",
        body: buttonTemplate?.body?.trim() || fallbackBody || "Selecione uma opção abaixo.",
        footer: buttonTemplate?.footer ?? undefined,
        buttons: mappedButtons,
        buttonType:
          firstFamily === "action" || nativeButtonsEnabled ? "native" : "legacy",
        headerMedia,
        mentions,
      });
      return true;
    };

    if (ad.media) {
      if (ad.media.mediaType === "sticker") {
        const stickerSource = ad.media.path
          ? await resolveStoredMediaBuffer(ad.media.path)
          : ad.media.url ?? null;
        if (!stickerSource) {
          console.warn("[AdsDispatcher] Mídia de anúncio não encontrada para sticker", {
            groupJid,
            adId: ad.id,
          });
          return { delivered: false, unauthorized: false };
        }
        await sendStickerMessage(client, {
          to: groupJid,
          sticker: stickerSource,
          mimeType: ad.media.mimeType ?? "image/webp",
          mentions,
        });
        if (!(await sendButtonsMessage(body)) && body) {
          await sendTextMessage(client, { to: groupJid, body, mentions });
        }
        return { delivered: true, unauthorized: false };
      }

      const mediaSource =
        ad.media.path && !ad.media.url
          ? await resolveStoredMediaBuffer(ad.media.path)
          : null;
      const mediaPayload = mediaSource ?? ad.media.url ?? null;
      if (!mediaPayload) {
        console.warn("[AdsDispatcher] Mídia de anúncio não encontrada", {
          groupJid,
          adId: ad.id,
        });
        return { delivered: false, unauthorized: false };
      }
      const mediaType =
        ad.media.mediaType === "video" ||
        ad.media.mediaType === "audio" ||
        ad.media.mediaType === "document"
          ? ad.media.mediaType
          : "image";
      if (mappedButtons.length > 0 && mediaType !== "audio") {
        await sendButtonsMessage(body || ad.media.caption || "", {
          type: mediaType === "video" || mediaType === "document" ? mediaType : "image",
          media: mediaPayload,
          mimeType: ad.media.mimeType ?? undefined,
          fileName: ad.media.fileName ?? undefined,
        });
        return { delivered: true, unauthorized: false };
      }
      await sendMediaMessage(client, {
        to: groupJid,
        media: mediaPayload,
        mediaType,
        caption: body || ad.media.caption || null,
        filename: ad.media.fileName ?? undefined,
        mimeType: ad.media.mimeType ?? undefined,
        mentions,
      });
      await sendButtonsMessage(body || ad.media.caption || "");
      return { delivered: true, unauthorized: false };
    }

    if (!body) {
      if (await sendButtonsMessage("")) {
        return { delivered: true, unauthorized: false };
      }
      return { delivered: false, unauthorized: false };
    }
    if (!(await sendButtonsMessage(body))) {
      await sendTextMessage(client, { to: groupJid, body, mentions });
    }
    return { delivered: true, unauthorized: false };
  } catch (error) {
    const unauthorized = isUnauthorizedError(error);
    console.error("[AdsDispatcher] Falha ao enviar anúncio", {
      groupJid,
      adId: ad.id,
      unauthorized,
      error,
    });
    return { delivered: false, unauthorized };
  }
};

const runAdsDispatchCycle = async () => {
  if (cycleRunning) {
    return;
  }
  cycleRunning = true;
  try {
    const db = getDb();
    const [rows] = await db.query<AdsDispatcherRow[]>(
      `
        SELECT
          g.id AS group_id,
          g.user_id,
          g.instance_id,
          g.remote_id,
          g.participants,
          i.base_url,
          i.token,
          i.session_status,
          u.timezone AS owner_timezone,
          u.whatsapp_number AS owner_whatsapp
          ,ig.id AS internal_group_id
        FROM bot_groups g
        LEFT JOIN bot_instances i ON i.id = g.instance_id
        LEFT JOIN internal_groups ig ON ig.bot_group_id = g.id
        JOIN users u ON u.id = g.user_id
        JOIN bot_group_settings s ON s.group_id = g.id
        WHERE g.status = 'active'
          AND ((ig.id IS NOT NULL AND ig.is_active = 1 AND ig.bot_enabled = 1)
            OR i.session_status = 'conectado')
          AND JSON_LENGTH(s.ads_config) > 0
      `,
    );

    const now = new Date();
    const nowIso = now.toISOString();

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
        if (!Array.isArray(settings.ads) || settings.ads.length === 0) {
          continue;
        }

        const effectiveTimezone = resolveTimezonePreference({
          preferred: [ENV_ADS_DISPATCH_TIMEZONE, settings.scheduleConfig?.timezone, settings.horapgConfig?.timezone],
          ownerTimezone: row.owner_timezone,
          ownerWhatsapp: row.owner_whatsapp,
        });

        const timezoneContext = getTimezoneContext(now, effectiveTimezone);

        const ads = settings.ads.map((ad) => ({
          ...ad,
          times: Array.isArray(ad.times) ? [...ad.times] : undefined,
          sentTimes: ad.sentTimes ? { ...ad.sentTimes } : undefined,
          media: ad.media ? { ...ad.media } : null,
        }));

        const mentionJids = parseParticipantIds(row.participants).filter((jid) =>
          jid && jid.includes("@"),
        );
        const instanceSettings = isInternal ? null : await getInstanceSettings(row.instance_id!);
        const nativeButtonsEnabled = Boolean(instanceSettings?.commandToggles.nativeButtons);

        let hasChanges = false;
        const client: WuzapiClient = { baseUrl: row.base_url ?? "", token: row.token ?? "" };
        const deliverAd = async (ad: BotGroupAd): Promise<SendAdResult> => {
          if (isInternal) {
            const messageId = await dispatchInternalGroupAutomationMessage(
              row.group_id,
              ad.caption,
              ad.media,
            );
            return { delivered: messageId != null, unauthorized: false };
          }
          return sendAdMessage({
            client,
            groupJid: row.remote_id,
            ad,
            mentionJids: ad.mentionAll ? mentionJids : [],
            nativeButtonsEnabled,
          });
        };

        for (let index = 0; index < ads.length; index += 1) {
          const ad = ads[index];
          if (ad.enabled === false) {
            continue;
          }
          if (ad.scheduleType === "times") {
            const dueTimes: string[] = [];
            const sanitizedTimes = sanitizeTimes(ad.times ?? []);
            ad.times = sanitizedTimes;
            const sentTimes = ad.sentTimes ? { ...ad.sentTimes } : {};
            for (const time of sanitizedTimes) {
              const [hourStr, minuteStr] = time.split(":");
              const targetMinutes = Number(hourStr) * 60 + Number(minuteStr);
              const diff = timezoneContext.minutes - targetMinutes;
              if (diff < 0) {
                // Horário ainda não alcançado
                continue;
              }
              if (sentTimes[time] === timezoneContext.date) {
                // Já enviado hoje
                continue;
              }
              if (diff <= ADS_TIME_WINDOW_MINUTES || !sentTimes[time]) {
                dueTimes.push(time);
                continue;
              }
              // Fora da janela (ex.: após reinício), mas ainda não enviado hoje => envia como catch-up
              dueTimes.push(time);
            }
            if (dueTimes.length === 0) {
              continue;
            }

            for (const time of dueTimes) {
              const result = await deliverAd(ad);
              if (result.delivered) {
                if (!ad.sentTimes) {
                  ad.sentTimes = {};
                }
                ad.sentTimes[time] = timezoneContext.date;
                ad.lastSentAt = nowIso;
                ad.updatedAt = nowIso;
                hasChanges = true;
                continue;
              }
              if (result.unauthorized) {
                ad.enabled = false;
                ad.updatedAt = nowIso;
                hasChanges = true;
                console.warn("[AdsDispatcher] Anúncio desativado automaticamente por unauthorized", {
                  groupId: row.group_id,
                  groupJid: row.remote_id,
                  adId: ad.id,
                });
                break;
              }
            }

            continue;
          }

          const intervalMs = frequencyToMs(ad.frequency);
          const lastSent = ad.lastSentAt ? new Date(ad.lastSentAt) : null;
          const shouldSend =
            !lastSent || Number.isNaN(lastSent.getTime())
              ? true
              : now.getTime() - lastSent.getTime() >= intervalMs;

          if (!shouldSend) {
            continue;
          }

          const result = await deliverAd(ad);
          if (result.delivered) {
            ad.lastSentAt = nowIso;
            ad.updatedAt = nowIso;
            hasChanges = true;
            continue;
          }
          if (result.unauthorized) {
            ad.enabled = false;
            ad.updatedAt = nowIso;
            hasChanges = true;
            console.warn("[AdsDispatcher] Anúncio desativado automaticamente por unauthorized", {
              groupId: row.group_id,
              groupJid: row.remote_id,
              adId: ad.id,
            });
          }
        }

        if (hasChanges) {
          const updated = await upsertGroupSettings(row.group_id, { ads });
          settings.ads = updated.ads;
        }
      } catch (error) {
        console.error("[AdsDispatcher] Falha ao processar anúncios do grupo", {
          groupId: row.group_id,
          error,
        });
      }
    }
  } catch (error) {
    console.error("[AdsDispatcher] Falha ao executar ciclo de anúncios", error);
  } finally {
    cycleRunning = false;
  }
};

export const startAdsDispatcher = () => {
  if (process.env.ENABLE_BOT_DISPATCHERS === "false") {
    return;
  }
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  globalRuntime.__botAdsDispatcherStarted = true;

  void runAdsDispatchCycle();
  setInterval(() => {
    void runAdsDispatchCycle();
  }, ADS_DISPATCH_INTERVAL_MS);
};
