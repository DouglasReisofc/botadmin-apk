import { normalizeJid } from "../whatsapp";
import type { NormalizedMessage, NormalizedWebhookPayload } from "./types";

const toRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? value as Record<string, any> : {};
const firstString = (...values: unknown[]): string | null =>
  values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() ?? null;
const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    if ((typeof value === "number" || typeof value === "string") && value !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};
const normalizeTimestampMs = (value: number | null): number | null =>
  value && Number.isFinite(value) && value > 0 ? (value > 10 ** 12 ? value : value * 1000) : null;

export type PollVoteDetails = {
  pollId: string;
  selectedOptionHashes: string[];
  participantJid: string;
  participantIsLid: boolean;
  displayName?: string | null;
  timestamp?: Date;
};

const collectSelectedOptionHashes = (value: unknown): string[] => {
  if (!value && value !== 0) {
    return [];
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) {
        out.push(entry.trim());
        continue;
      }
      if (entry && typeof entry === "object") {
        const rec = toRecord(entry);
        const hash = firstString(
          rec.hash,
          rec.Hash,
          rec.optionHash,
          rec.OptionHash,
          rec.id,
          rec.Id,
        );
        if (hash && hash.trim()) {
          out.push(hash.trim());
        }
      }
    }
    return out;
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
};

export const extractSweepstakePollVote = (
  payload: NormalizedWebhookPayload,
  message: NormalizedMessage,
): PollVoteDetails | null => {
  const dataRecord = toRecord(payload.data);
  const rawRecord = toRecord(message.raw);
  const normalizedRecord = toRecord((payload as Record<string, unknown>).normalized ?? {});
  const infoRecord = toRecord(dataRecord.Info ?? dataRecord.info ?? {});
  const rawSender = toRecord(rawRecord.sender ?? rawRecord.Sender);
  const rawEventSender = toRecord(rawRecord.eventSender ?? rawRecord.EventSender);
  const rawChat = toRecord(rawRecord.chat ?? rawRecord.Chat);
  const rawChatParticipant = toRecord(rawChat.participant ?? rawChat.Participant);

  const pollUpdateCandidates: Record<string, unknown>[] = [];
  const enqueueCandidate = (value: unknown) => {
    if (value && typeof value === "object") {
      const rec = toRecord(value);
      if (Object.keys(rec).length > 0) {
        pollUpdateCandidates.push(rec);
      }
    }
  };

  enqueueCandidate(dataRecord.pollUpdate);
  enqueueCandidate(dataRecord.PollUpdate);
  enqueueCandidate((dataRecord.Message as Record<string, unknown> | undefined)?.pollUpdateMessage);
  enqueueCandidate((dataRecord.Message as Record<string, unknown> | undefined)?.PollUpdateMessage);
  enqueueCandidate(rawRecord.pollUpdate);
  enqueueCandidate(rawRecord.PollUpdate);
  enqueueCandidate((rawRecord.Message as Record<string, unknown> | undefined)?.pollUpdateMessage);
  enqueueCandidate((rawRecord.Message as Record<string, unknown> | undefined)?.PollUpdateMessage);
  enqueueCandidate((message.raw as Record<string, unknown> | undefined)?.pollUpdate);
  enqueueCandidate((message.raw as Record<string, unknown> | undefined)?.PollUpdate);

  let pollId: string | null = null;
  let participantCandidate: string | null = null;
  let selectedOptionHashes: string[] = [];
  let hasDecryptedSelection = false;
  let timestampCandidate: number | null = null;

  for (const candidate of pollUpdateCandidates) {
    const creationKey = toRecord(
      candidate.pollCreationMessageKey ??
        candidate.PollCreationMessageKey ??
        candidate.messageKey ??
        candidate.MessageKey ??
        candidate.key ??
        candidate.Key,
    );

    if (!pollId) {
      pollId = firstString(
        creationKey.ID,
        creationKey.Id,
        creationKey.id,
        creationKey.messageID,
        creationKey.MessageID,
        creationKey.messageId,
        creationKey.MessageId,
        candidate.pollId,
        candidate.PollId,
      );
    }

    if (!participantCandidate) {
      participantCandidate = firstString(
        candidate.participant,
        candidate.Participant,
      );
    }

    if (!timestampCandidate) {
      const ts = firstNumber(
        creationKey.senderTimestampMS,
        creationKey.SenderTimestampMS,
        candidate.senderTimestampMS,
        candidate.SenderTimestampMS,
      );
      timestampCandidate = normalizeTimestampMs(ts);
    }

    const selection = candidate.selectedOptions ?? candidate.SelectedOptions ??
      candidate.options ?? candidate.Options;
    // An encrypted envelope without a decrypted selection is not a withdrawal.
    // An explicitly empty array, however, means that the voter cleared the vote.
    if (Array.isArray(selection) || typeof selection === "string") {
      hasDecryptedSelection = true;
      selectedOptionHashes = collectSelectedOptionHashes(selection);
    }
  }

  if (!pollId || !hasDecryptedSelection) {
    return null;
  }

  // The participant inside PollCreationMessageKey identifies the poll
  // creator, not the person who just voted. Never use that key as a voter.
  // EasyZap includes it beside the actual event sender. In particular,
  // preferring its @lid made every vote look like an unresolved bot LID and
  // silently discarded the participant before the draw was finalized.
  const participantCandidates = [
    // EasyZap's normalized envelope carries the real voter in sender.jid.
    // Keep these fields ahead of NormalizedMessage.senderJid, which may be
    // derived from PollCreationMessageKey.Participant (the poll creator).
    rawSender.phone,
    rawSender.jid,
    rawSender.id,
    rawSender.user,
    rawEventSender.phone,
    rawEventSender.jid,
    rawEventSender.id,
    rawEventSender.user,
    rawChat.participantJid,
    rawChatParticipant.jid,
    rawChatParticipant.id,
    rawChatParticipant.phone,
    dataRecord.sender,
    dataRecord.Sender,
    dataRecord.author,
    dataRecord.Author,
    dataRecord.senderJid,
    dataRecord.SenderJid,
    normalizedRecord.senderJid,
    normalizedRecord.sender,
    infoRecord.SenderJid,
    infoRecord.senderJid,
    infoRecord.Sender,
    infoRecord.sender,
    normalizedRecord.participant,
    normalizedRecord.Participant,
    normalizedRecord.participantJid,
    normalizedRecord.participant_jid,
    normalizedRecord.participantAlt,
    normalizedRecord.ParticipantAlt,
    infoRecord.ParticipantNormalized,
    infoRecord.participantNormalized,
    infoRecord.Participant,
    infoRecord.participant,
    infoRecord.ParticipantAlt,
    infoRecord.participantAlt,
    message.senderJid,
    message.participant,
    participantCandidate,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const participantRaw = firstString(...participantCandidates);
  const participantIsLid = Boolean(participantRaw && /@lid(?:$|:)/i.test(participantRaw.trim()));
  const participantJid = normalizeJid(participantRaw) || null;

  if (!participantJid) {
    return null;
  }

  const displayName =
    firstString(
      normalizedRecord.displayName,
      normalizedRecord.DisplayName,
      rawSender.name,
      rawSender.pushName,
      rawSender.displayName,
      rawEventSender.name,
      rawEventSender.pushName,
      rawEventSender.displayName,
      infoRecord.DisplayName,
      infoRecord.displayName,
      infoRecord.pushName,
      infoRecord.PushName,
      message.raw?.Info && (message.raw as any).Info?.PushName,
    ) ?? null;

  let voteTimestamp: Date | undefined;
  if (timestampCandidate) {
    voteTimestamp = new Date(timestampCandidate);
  } else if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    const normalizedTs = normalizeTimestampMs(message.timestamp);
    voteTimestamp =
      typeof normalizedTs === "number" ? new Date(normalizedTs) : new Date(message.timestamp * 1000);
  }

  return {
    pollId,
    selectedOptionHashes,
    participantJid,
    participantIsLid,
    displayName,
    timestamp: voteTimestamp,
  };
};


