import type { BotAutoResponse } from "./bot-auto-responses";

export type BotInstanceAutoResponseCounters = Record<
  string,
  Record<
    string,
    {
      count: number;
      updatedAt: string;
    }
  >
>;

export type BotInstanceCommandToggles = {
  autoresposta: boolean;
  prefixoPv: boolean;
  pvCommandAllowlist: string[] | null;
  nativeButtons: boolean;
  recoverDeletedMessages: boolean;
  keepDeletedChatsInHistory: boolean;
  persistentMediaStorage: boolean;
  notifyOnlinePresence: boolean;
  onlinePresenceMonitorJids: string[] | null;
  stickerPack: string | null;
  stickerAuthor: string | null;
};

export type BotInstanceSettings = {
  instanceId: number;
  commandToggles: BotInstanceCommandToggles;
  autoResponses: BotAutoResponse[];
  autoResponseCounters: BotInstanceAutoResponseCounters;
  createdAt: string;
  updatedAt: string;
};
