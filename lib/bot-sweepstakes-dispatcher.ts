import {
  buildSweepstakeAnnouncement,
  finalizeSweepstake,
  listDueSweepstakes,
  pickSweepstakeWinners,
  refreshSweepstake,
  renderSweepstakeWinnerMessage,
  type BotSweepstakeParticipant,
  type BotSweepstakeWithInstance,
} from "lib/bot-sweepstakes";
import { resolveWhatsappLidProfiles, resolveWhatsappLidsToPhones, sendMediaMessage, sendTextMessage } from "lib/wuzapi";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import { getDb } from "lib/db";
import { normalizeJid } from "lib/whatsapp";
import { cleanupSweepstakePoll } from "lib/sweepstake-poll-cleanup";

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
  const announcement = resolvedWinners.length > 0
    ? buildSweepstakeAnnouncement(sweepstake, resolvedWinners)
    : buildSweepstakeAnnouncement(sweepstake, []);
  const metadata = sweepstake.metadata && typeof sweepstake.metadata === "object"
    ? sweepstake.metadata as Record<string, unknown>
    : {};
  const template = typeof metadata.winnerMessageTemplate === "string"
    ? metadata.winnerMessageTemplate.trim()
    : "";
  const body = resolvedWinners.length > 0 && template
    ? resolvedWinners.map((winner) => renderSweepstakeWinnerMessage(template, winner, sweepstake, resolvedWinners.length)).join("\n\n")
    : announcement.body;
  const mediaUrl = metadata.winnerMediaUrl === null ? null : typeof metadata.winnerMediaUrl === "string" && metadata.winnerMediaUrl.trim()
    ? (/^https?:\/\//i.test(metadata.winnerMediaUrl.trim())
      ? metadata.winnerMediaUrl.trim()
      : `https://botadmin.shop/${metadata.winnerMediaUrl.trim().replace(/^\/+/, "")}`)
    : "https://botadmin.shop/botadmin-landing/sweepstake-winner-v1.png";
  if (resolvedWinners.length === 0 || !mediaUrl) {
    await sendTextMessage(client, { to: sweepstake.groupJid, body, mentions: announcement.mentions });
    return;
  }
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

  // The due-list snapshot can predate poll votes arriving through another
  // instance. Draw from the latest persisted participants, not that snapshot.
  const latest = await refreshSweepstake(sweepstake.id);
  if (!latest || latest.status !== "active") return;
  sweepstake = { ...sweepstake, ...latest };

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
    await announceSweepstakeResult(sweepstake, winners);
  } catch (error) {
    console.error("[sweepstakes] Failed to announce sweepstake result", {
      sweepstakeId: sweepstake.id,
      group: sweepstake.groupJid,
      error,
    });
  } finally {
    let cleanupPending = false;
    await cleanupSweepstakePoll({ baseUrl: sweepstake.instance.baseUrl, token: sweepstake.instance.token }, {
      userId: sweepstake.userId, instanceId: sweepstake.instance.id,
      groupJid: sweepstake.groupJid, pollMessageId: sweepstake.pollMessageId, phone: sweepstake.instance.phone,
    }).catch((error) => { cleanupPending = true; console.warn("[sweepstakes] poll cleanup pending", { sweepstakeId: sweepstake.id, error }); });
    await finalizeSweepstake(sweepstake.id, {
      status: "completed",
      winners,
      concludedAt,
      metadata: {
        ...(sweepstake.metadata ?? {}),
        participantsCount: participants.length,
        winnersCount: winners.length,
        announcedAt: concludedAt.toISOString(),
        cleanupPending,
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
    for (const entry of await listDueSweepstakes(DISPATCH_MAX_BATCH, true)) {
      try {
        await cleanupSweepstakePoll({ baseUrl: entry.instance.baseUrl, token: entry.instance.token }, {
          userId: entry.userId, instanceId: entry.instance.id, groupJid: entry.groupJid,
          pollMessageId: entry.pollMessageId, phone: entry.instance.phone,
        });
        await getDb().query("UPDATE bot_sweepstakes SET metadata = ? WHERE id = ?", [
          JSON.stringify({ ...entry.metadata, cleanupPending: false, pollRemovedAt: new Date().toISOString() }), entry.id,
        ]);
      } catch (error) {
        console.warn("[sweepstakes] retry poll cleanup failed", { sweepstakeId: entry.id, error });
      }
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
