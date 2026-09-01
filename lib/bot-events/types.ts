import type { BotInstance } from "types/bot-instances";

export type NormalizedWebhookPayload = {
  raw: Record<string, unknown>;
  type: string;
  event: string;
  data: Record<string, unknown>;
  token: string | null;
  instance: Record<string, unknown> | null;
};

export type BotEventContext = {
  instance: BotInstance;
  transportInstance?: BotInstance;
};

export type NormalizedMessage = {
  id: string | null;
  chatId: string | null;
  senderJid: string | null;
  pushName?: string | null;
  displayName?: string | null;
  senderName?: string | null;
  fromMe: boolean;
  text: string | null;
  caption: string | null;
  messageType: string | null;
  participant: string | null;
  mentionedJids?: string[];
  mentionsInstance?: boolean;
  links: string[];
  timestamp?: number | null;
  quotedParticipant?: string | null;
  quotedMessageId?: string | null;
  quotedInstance?: boolean;
  buttonResponse?: NormalizedButtonResponse | null;
  raw: Record<string, unknown>;
};

export type NormalizedButtonResponse = {
  kind: "reply_button" | "native_flow";
  id: string | null;
  text: string | null;
  paramsJson?: string | null;
  params?: Record<string, unknown> | null;
};
