export type UserRaffleStatus =
  | "draft"
  | "active"
  | "selling"
  | "sold_out"
  | "completed"
  | "cancelled";

export type UserRaffleTicketStatus = "available" | "reserved" | "paid" | "cancelled";

export type UserRaffleTicket = {
  number: number;
  status: UserRaffleTicketStatus;
  customerName: string | null;
  customerWhatsapp: string | null;
  chargePublicId: string | null;
  reservedAt: string | null;
  paidAt: string | null;
  groupJid: string | null;
};

export type UserRaffleWinner = {
  number: number;
  customerName: string | null;
  customerWhatsapp: string | null;
  chargePublicId: string | null;
  drawnAt: string;
};

export type UserRaffleGroupTarget = {
  groupId: number;
  remoteId: string;
  name: string | null;
  instanceId: number | null;
};

export type UserRaffleAnnouncementMedia = {
  path: string;
  url: string;
  mediaType: "image" | "video" | "audio" | "document";
  mimeType: string | null;
  fileName: string | null;
};

export type UserRaffleAnnouncementButton = {
  id: string;
  text: string;
  type: "quick_reply" | "cta_url" | "cta_copy";
  value: string;
};

export type UserRaffleAnnouncementSettings = {
  message: string | null;
  media: UserRaffleAnnouncementMedia | null;
  mentionAll: boolean;
  buttons: UserRaffleAnnouncementButton[];
};

export type UserRaffleFinalizationSettings = {
  message: string | null;
};

export type UserRafflePurchaseMenuSettings = {
  title: string;
  description: string;
  buttonText: string;
  footerText: string;
  cardTitleTemplate: string;
  rowTitleTemplate: string;
  rowDescriptionTemplate: string;
};

export type UserRaffleMetadata = Record<string, unknown> & {
  announcement?: UserRaffleAnnouncementSettings | null;
  finalization?: UserRaffleFinalizationSettings | null;
  purchaseMenu?: UserRafflePurchaseMenuSettings | null;
};

export type UserRaffle = {
  id: number;
  userId: number;
  title: string;
  description: string | null;
  price: number;
  numbersTotal: number;
  winnersCount: number;
  status: UserRaffleStatus;
  tickets: UserRaffleTicket[];
  groups: UserRaffleGroupTarget[];
  groupJids: string[];
  reservedCount: number;
  soldCount: number;
  winners: UserRaffleWinner[];
  metadata: UserRaffleMetadata | null;
  drawnAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserRaffleSummary = {
  id: number;
  title: string;
  description: string | null;
  price: number;
  numbersTotal: number;
  winnersCount: number;
  status: UserRaffleStatus;
  reservedCount: number;
  soldCount: number;
  availableCount: number;
  groups: UserRaffleGroupTarget[];
  winners: UserRaffleWinner[];
  announcement: UserRaffleAnnouncementSettings;
  finalization: UserRaffleFinalizationSettings;
  purchaseMenu: UserRafflePurchaseMenuSettings;
  drawnAt: string | null;
  createdAt: string;
  updatedAt: string;
};
