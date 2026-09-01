export type BotSweepstakeOption = {
  hash: string;
  name: string;
};

export type BotSweepstakeParticipant = {
  jid: string;
  hash: string;
  displayName: string | null;
  joinedAt: string;
  lastVoteAt: string | null;
};

export type BotSweepstakeStatus = "active" | "completed" | "cancelled";

export type BotSweepstake = {
  id: number;
  instanceId: number;
  groupJid: string;
  pollMessageId: string;
  pollId: string;
  question: string;
  joinOptionHash: string;
  options: BotSweepstakeOption[];
  participants: BotSweepstakeParticipant[];
  winners: BotSweepstakeParticipant[];
  maxParticipants: number | null;
  winnersCount: number;
  status: BotSweepstakeStatus;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  concludedAt: string | null;
  metadata: Record<string, unknown> | null;
  messageKey: string | null;
};

export type BotSweepstakeWithInstance = BotSweepstake & {
  userId: number;
  groupId: number | null;
  instance: {
    id: number;
    baseUrl: string;
    token: string;
    phone: string;
    sessionStatus: string | null;
  };
};
