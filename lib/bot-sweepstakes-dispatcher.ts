import {
  buildSweepstakeAnnouncement,
  finalizeSweepstake,
  listDueSweepstakes,
  pickSweepstakeWinners,
  type BotSweepstakeParticipant,
  type BotSweepstakeWithInstance,
} from "lib/bot-sweepstakes";
import { deleteMessageForEveryone, resolveWhatsappLidProfiles, resolveWhatsappLidsToPhones, sendMediaMessage, sendTextMessage } from "lib/wuzapi";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import { getDb } from "lib/db";
import { normalizeJid } from "lib/whatsapp";
import { deleteWhatsappConversationMessageForUser } from "lib/whatsapp-conversations";

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

  const client = { baseUrl: sweepstake.instance.baseUrl, token: sweepstake.instance.token };
  // Vote updates may persist the LID as bare digits, without the @lid suffix.
  const lidWinners = winners.filter((winner) =>
    winner.jid.toLowerCase().endsWith("@lid") || /^\d{14,}$/.test(winner.jid),
  );
  const lidPhones = lidWinners.length
    ? await resolveWhatsappLidsToPhones(client, lidWinners.map((winner) => winner.jid)).catch(() => new Map<string, string>())
    : new Map<string, string>();
  const lidProfiles = lidWinners.length
    ? await resolveWhatsappLidProfiles(client, lidWinners.map((winner) => winner.jid)).catch(() => new Map())
    : new Map();
  const [groupRows] = await getDb().query<Array<{ participants: unknown }>>(
    "SELECT participants FROM bot_groups WHERE id = ? LIMIT 1", [sweepstake.groupId],
  );
  let groupParticipants: Array<Record<string, unknown>> = [];
  try {
    const raw = groupRows[0]?.participants;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) groupParticipants = parsed.filter((entry) => entry && typeof entry === "object");
  } catch { /* Use the vote display name if the group snapshot is unavailable. */ }
  const resolvedWinners = winners.map((winner) => {
    const lidDigits = lidWinners.includes(winner) ? normalizeJid(winner.jid) : null;
    const resolvedPhoneFromLid = lidDigits ? lidPhones.get(lidDigits) ?? lidProfiles.get(lidDigits)?.phone ?? null : null;
    const participant = groupParticipants.find((entry) =>
      [entry.id, entry.jid, entry.phone].some((value) =>
        typeof value === "string" && (value === winner.jid || (resolvedPhoneFromLid && normalizeJid(value) === resolvedPhoneFromLid)),
      ),
    );
    const participantPhone = participant
      ? [participant.phone, participant.id, participant.jid]
          .map((value) => typeof value === "string" && !value.toLowerCase().endsWith("@lid") ? normalizeJid(value) : null)
          .find(Boolean) ?? null
      : null;
    const bareWinnerPhone = !lidDigits && !winner.jid.toLowerCase().includes("@lid")
      ? normalizeJid(winner.jid)
      : null;
    const phone = lidDigits ? resolvedPhoneFromLid ?? participantPhone : participantPhone ?? bareWinnerPhone;
    const jid = phone
      ? `${phone.replace(/@(s\.whatsapp\.net|c\.us)$/i, "")}@s.whatsapp.net`
      : winner.jid;
    const name = [participant?.name, participant?.displayName, participant?.pushName, lidDigits ? lidProfiles.get(lidDigits)?.name : null, winner.displayName]
      .find((value) => typeof value === "string" && value.trim() && !/@lid\b/i.test(value)) as string | undefined;
    return { ...winner, jid, displayName: name?.trim() || null };
  });
  const announcement = buildSweepstakeAnnouncement(sweepstake, resolvedWinners);
  const metadata = sweepstake.metadata && typeof sweepstake.metadata === "object"
    ? sweepstake.metadata as Record<string, unknown>
    : {};
  const template = typeof metadata.winnerMessageTemplate === "string"
    ? metadata.winnerMessageTemplate.trim()
    : "";
  const body = template
    ? resolvedWinners.map((winner) => template
      .replace(/\{\{\s*pushname\s*\}\}/gi, winner.displayName?.trim() || normalizeJid(winner.jid))
      .replace(/\{\{\s*numero\s*\}\}/gi, normalizeJid(winner.jid))
      .replace(/\{\{\s*jid\s*\}\}/gi, winner.jid)
      .replace(/\{\{\s*premio\s*\}\}/gi, sweepstake.question)
      .replace(/\{\{\s*participantes\s*\}\}/gi, String(sweepstake.participants.length))
      .replace(/\{\{\s*ganhadores\s*\}\}/gi, String(resolvedWinners.length))
      .trim()).join("\n\n")
    : announcement.body;
  const mediaUrl = typeof metadata.winnerMediaUrl === "string" && metadata.winnerMediaUrl.trim()
    ? (/^https?:\/\//i.test(metadata.winnerMediaUrl.trim())
      ? metadata.winnerMediaUrl.trim()
      : `https://botadmin.shop/${metadata.winnerMediaUrl.trim().replace(/^\/+/, "")}`)
    : "https://botadmin.shop/botadmin-landing/sweepstake-winner-v1.png";
  await sendMediaMessage(client, {
    to: sweepstake.groupJid,
    media: mediaUrl,
    mediaType: "image",
    mimeType: "image/png",
    filename: "parabens-voce-venceu.png",
    caption: body,
    mentions: announcement.mentions,
    useExternalUrl: true,
  }).catch(async () => {
    await sendTextMessage(client, { to: sweepstake.groupJid, body, mentions: announcement.mentions });
  });
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

  const botPhone = String(sweepstake.instance.phone || "").replace(/\D+/g, "");
  const botLids = sweepstake.participants
    .filter((entry) => entry.jid.toLowerCase().endsWith("@lid") || /^\d{14,}$/.test(entry.jid))
    .map((entry) => entry.jid);
  const resolvedBotLids = botLids.length && sweepstake.instance.baseUrl && sweepstake.instance.token
    ? await resolveWhatsappLidsToPhones(
      { baseUrl: sweepstake.instance.baseUrl, token: sweepstake.instance.token },
      botLids,
    ).catch(() => new Map<string, string>())
    : new Map<string, string>();
  const participants = sweepstake.participants.filter((entry) => {
    const direct = normalizeJid(entry.jid).replace(/\D+/g, "");
    const resolved = resolvedBotLids.get(entry.jid.replace(/@lid$/i, ""))?.replace(/\D+/g, "") || "";
    return !(botPhone && (direct === botPhone || resolved === botPhone));
  });
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
    const client = { baseUrl: sweepstake.instance.baseUrl, token: sweepstake.instance.token };
    if (sweepstake.instance.baseUrl && sweepstake.instance.token && sweepstake.pollMessageId) {
      await deleteMessageForEveryone(client, {
        chatId: sweepstake.groupJid,
        messageId: sweepstake.pollMessageId,
        fromMe: true,
      }).catch((error) => console.warn("[sweepstakes] failed to delete finished poll", { sweepstakeId: sweepstake.id, error }));
    }
    await deleteWhatsappConversationMessageForUser(
      sweepstake.userId,
      sweepstake.instance.id,
      sweepstake.groupJid,
      sweepstake.pollMessageId,
    ).catch((error) => console.warn("[sweepstakes] failed to delete poll from panel", { sweepstakeId: sweepstake.id, error }));
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
