import type {
  BotAutoResponse,
  BotAutoResponseButtons,
  BotAutoResponseMedia,
  BotAutoResponseVcard,
  BotAutoResponseCtaButton,
} from "./bot-auto-responses";

export type BotGroupStatus = "active" | "disabled";

export type BotGroupParticipant = {
  id: string;
  admin: "superadmin" | "admin" | "member";
  name?: string | null;
  displayName?: string | null;
  pushName?: string | null;
  phone?: string | null;
  imageUrl?: string | null;
  avatarUrl?: string | null;
};

export type BotGroupShare = {
  id: number;
  groupId: number;
  ownerUserId: number;
  sharedUserId: number;
  grantedByUserId: number | null;
  role: "admin";
  name: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BotGroup = {
  id: number;
  userId: number;
  instanceId: number;
  instanceName: string;
  instancePhone: string;
  slot: number;
  remoteId: string;
  inviteCode: string | null;
  inviteLink: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  owner: string | null;
  awaitingApproval: boolean;
  awaitingEntry: boolean;
  status: BotGroupStatus;
  participants: BotGroupParticipant[];
  participantCount?: number;
  accessRole?: "owner" | "shared_admin";
  sharedWith?: BotGroupShare[];
  metadata: BotGroupMetadata;
  createdAt: string;
  updatedAt: string;
};

export type BotGroupPayload = {
  instanceId: number;
  invite?: string;
  remoteId?: string;
  slot?: number;
};

export type BotGroupMetadata = {
  adminsOnly: boolean;
  locked: boolean;
  ephemeral: string | null;
  menuBackgroundPath: string | null;
  menuBackgroundUrl: string | null;
  activatedAt?: string | null;
  lastActivatedAt?: string | null;
  lastDeactivatedAt?: string | null;
  botPausedPreserveAccess?: boolean;
  botPausedPreserveAccessAt?: string | null;
  botPausedPreserveAccessReason?: string | null;
  licensePlanId?: number | null;
  licensePlanName?: string | null;
  licenseStartsAt?: string | null;
  licenseExpiresAt?: string | null;
  licenseLastPaidAt?: string | null;
  licenseDurationDays?: number | null;
  licenseSource?: string | null;
  licenseSubscriptionId?: number | null;
  licenseBasePlanSlot?: number | null;
  licenseRemovedAt?: string | null;
  licenseTransferredToGroupId?: number | null;
  licenseTransferredFromGroupId?: number | null;
  licensePaymentReference?: string | null;
  licensePaymentReferences?: string[];
};

export type BotGroupMenuTexts = {
  main: string[];
  admin: string[];
  comandos: string[];
  outros: string[];
  downloads: string[];
  ativacoes: string[];
  jogos: string[];
};

export type BotGroupMenuCardKind = "main" | "admin" | "downloads" | "fun";

export type BotGroupMenuListRow = {
  id: string;
  title: string;
  description: string | null;
  command: string;
};

export type BotGroupMenuListSection = {
  id: string;
  title: string;
  rows: BotGroupMenuListRow[];
};

export type BotGroupMenuButtonType = "reply" | "url" | "copy";

export type BotGroupMenuButton = {
  id: string;
  type: BotGroupMenuButtonType;
  label: string;
  value: string;
};

export type BotGroupMenuCard = {
  id: string;
  kind: BotGroupMenuCardKind;
  title: string | null;
  description: string | null;
  footerText: string | null;
  listButtonText: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  sections: BotGroupMenuListSection[] | null;
  buttons: BotGroupMenuButton[] | null;
};

export type BotGroupMenuCarousel = {
  cards: BotGroupMenuCard[];
};

export type BotGroupStaticMessage = {
  text: string | null;
  media: BotGroupAutoResponseMedia | null;
  updatedAt: string;
};

export type BotGroupAiMemoryEntry = {
  role: "user" | "assistant";
  author: string | null;
  authorId?: string | null;
  content: string;
  createdAt: string;
  replyTo?: string | null;
};

export type BotGroupCommandToggles = {
  autoresposta: boolean;
  botinterage: boolean;
  vozbotinterage: boolean;
  ouviraudiobotinterage: boolean;
  lerimagem: boolean;
  autosticker: boolean;
  autodownloader: boolean;
  bemvindo: boolean;
  despedida: boolean;
  antisticker: boolean;
  antimage: boolean;
  antvideo: boolean;
  antaudio: boolean;
  antdoc: boolean;
  antvcard: boolean;
  // Legado (botadmin)
  moderacaocomia: boolean;
  antilink: boolean; // espelha campo de topo
  antilinkgp: boolean; // espelha antilinkGroupInvite
  antipalavras: boolean;
  banextremo: boolean; // espelha campo de topo
  bangringos: boolean;
  antinsfwimagem: boolean;
  proibirnsfw: boolean;
  soadm: boolean;
  brincadeiras: boolean;
  linkmembro: boolean;
};

export type BotGroupModerationActionKey =
  | "antilink"
  | "antilinkgp"
  | "banextremo"
  | "antipalavras"
  | "bangringos"
  | "antinsfwimagem"
  | "proibirnsfw"
  | "antisticker"
  | "antimage"
  | "antvideo"
  | "antaudio"
  | "antdoc"
  | "antvcard";

export type BotGroupModerationActionConfig = {
  deleteMessage: boolean;
  registerInfraction: boolean;
  banUser: boolean;
  maxInfractions?: number | null;
};

export type BotGroupModerationActions = Partial<
  Record<BotGroupModerationActionKey, BotGroupModerationActionConfig>
>;

export type BotGroupWelcomeConfig = {
  enabled: boolean;
  caption: string;
  mediaUrl: string | null;
  mediaPath: string | null;
  useParticipantProfilePhoto: boolean;
  asSticker: boolean;
  updatedAt: string | null;
  // New: optional list of extra attachments to send in welcome
  // Kept inside welcome_config JSON column; no schema migration required.
  attachments?: BotGroupWelcomeAttachment[];
  replyButtons?: BotGroupWelcomeButtonTemplate | null;
};

export type BotGroupFarewellConfig = BotGroupWelcomeConfig;

export type BotGroupWelcomeAttachment =
  | ({
      kind: "image" | "video" | "audio" | "document" | "sticker";
      url: string | null;
      path: string | null;
      fileName: string | null;
      mimeType: string | null;
      caption: string | null;
    })
  | ({
      kind: "vcard";
      name: string;
      vcard: string;
    });

export type BotGroupAutoResponseMedia = BotAutoResponseMedia;

export type BotGroupAutoResponseVcard = BotAutoResponseVcard;

export type BotGroupAutoResponse = BotAutoResponse;

export type BotGroupWelcomeReplyButton = {
  id: string;
  label: string;
  type?: "quick_reply" | "cta_url" | "cta_call" | "cta_copy";
  command?: string | null;
  args?: string | null;
  url?: string | null;
  phoneNumber?: string | null;
  copyCode?: string | null;
};

export type BotGroupWelcomeButtonTemplate = {
  enabled: boolean;
  position?: "before_attachments" | "after_attachments";
  body: string;
  footer?: string | null;
  buttons: BotGroupWelcomeReplyButton[];
  updatedAt: string | null;
};

export type BotGroupBroadcastTemplate = {
  type: "text" | "media" | "button_reply" | "button_cta";
  body: string;
  title?: string | null;
  footer?: string | null;
  mediaUrl?: string | null;
  mediaPath?: string | null;
  mediaType?: "image" | "video" | "audio" | "document";
  buttons?: BotGroupWelcomeButtonTemplate["buttons"];
  ctaButtons?: BotGroupCtaButton[];
  headerMediaUrl?: string | null;
  headerMediaPath?: string | null;
  mentionAll?: boolean;
  mentionList?: string[] | null;
  updatedAt: string | null;
};

export type BotGroupCtaButton = BotAutoResponseCtaButton;

export type BotGroupMarkMessage = {
  caption: string | null;
  media: BotGroupAutoResponseMedia | null;
  updatedAt: string;
};

export type BotGroupAd = {
  id: string;
  enabled?: boolean;
  caption: string;
  mentionAll: boolean;
  scheduleType: "frequency" | "times";
  frequency?: string | null;
  times?: string[];
  lastSentAt: string | null;
  sentTimes?: Record<string, string>;
  media: BotGroupAutoResponseMedia | null;
  responseButtons?: BotAutoResponseButtons | null;
  interactiveButtons?: BotGroupWelcomeReplyButton[] | null;
  createdAt: string;
  updatedAt: string;
};

export type BotGroupHorapgConfig = {
  enabled: boolean;
  times: string[];
  imageUrl: string | null;
  imagePath: string | null;
  sentTimes: Record<string, string>;
  lastSentAt: string | null;
  mentionAll?: boolean;
  timezone?: string | null;
};

export type BotGroupScheduleConfig = {
  closeEnabled: boolean;
  closeTimes: string[];
  closeMessage: string | null;
  closeSentTimes: Record<string, string>;
  openEnabled: boolean;
  openTimes: string[];
  openMessage: string | null;
  openSentTimes: Record<string, string>;
  timezone: string | null;
  lastCloseAt: string | null;
  lastOpenAt: string | null;
};

export type BotGroupAntiInactivityConfig = {
  enabled: boolean;
  days: number;
  scanIntervalHours: number;
  removeLimit: number;
  lastRunAt: string | null;
  lastRemovedCount: number;
  lastError: string | null;
  updatedAt: string | null;
};

export type BotGroupAntispamConfig = {
  burstLimit: number;
  burstWindowSeconds: number;
  repeatLimit: number;
  repeatWindowSeconds: number;
  infractionResetDays: number;
};

export type BotGroupCoinsConfig = {
  enabled: boolean;
  currencyName: string;
  monetizationOnly: boolean;
  interactiveShopEnabled: boolean;
  earnings: {
    message: {
      enabled: boolean;
      amount: number;
      messagesPerReward: number;
      cooldownSec: number;
      minLength: number;
      maxPerDay: number;
    };
    daily: {
      enabled: boolean;
      amount: number;
    };
    levelUp: {
      enabled: boolean;
      amount: number;
    };
  };
  leveling: {
    xpPerMessage: number;
    levelStep: number;
  };
  penalties: {
    infraction: {
      enabled: boolean;
      amount: number;
    };
  };
  spending: {
    defaultCostsByCategory: {
      downloads: number;
      media: number;
    };
    commandCosts: Record<string, number>;
    autoDownloaderCost: number;
    autoStickerCost: number;
  };
  notifications: {
    mode: "group_reply" | "private" | "silent";
    includeBalance: boolean;
  };
  premium: BotGroupPremiumConfig;
  robbery: BotGroupCoinsRobberyConfig;
  shopItems: BotGroupCoinShopItem[];
  topup: BotGroupCoinsTopupConfig;
  rewards: {
    weekly: {
      enabled: boolean;
      amount: number;
      top: number;
      minMessages: number;
      announce: boolean;
    };
    monthly: {
      enabled: boolean;
      amount: number;
      top: number;
      minMessages: number;
      announce: boolean;
    };
  };
};

export type BotGroupPremiumPlan = {
  key: string;
  label: string;
  price: number;
  durationDays: number;
  enabled: boolean;
  description?: string | null;
};

export type BotGroupPremiumConfig = {
  enabled: boolean;
  plans: BotGroupPremiumPlan[];
  price: number;
  durationDays: number;
  commandKeys: string[];
  bypassCoinCosts: boolean;
};

export type BotGroupCoinsRobberyConfig = {
  enabled: boolean;
  cooldownHours: number;
  targetCooldownHours: number;
  attemptCost: number;
  failPenalty: number;
  minAttackerBalance: number;
  minTargetBalance: number;
  stealPercentMin: number;
  stealPercentMax: number;
  minSteal: number;
  maxSteal: number;
};

export type BotGroupCoinShopItem = {
  key: string;
  label: string;
  icon: string;
  price: number;
  durationDays: number;
  uses: number;
  type: "reduce" | "block" | "attack";
  reducePercent?: number;
  reflectPenalty?: number;
  successBonusPercent?: number;
  stealBonusPercent?: number;
  resetTarget?: boolean;
  description?: string;
  enabled?: boolean;
  aliases?: string[];
};

export type BotGroupCoinsTopupConfig = {
  enabled: boolean;
  coinsPerCurrency: number;
  minCoins: number;
  maxCoins: number;
  allowPix: boolean;
  allowCheckout: boolean;
};

export type BotGroupCoinMember = {
  memberJid: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  xp: number;
  level: number;
  lastAwardAt: string | null;
  lastMessageAt: string | null;
  dailyDate: string | null;
  dailyEarned: number;
};

export type BotGroupCoinLedgerEntry = {
  id: number;
  groupId: number;
  memberJid: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type BotGroupSettings = {
  groupId: number;
  antilink: boolean;
  antilinkGroupInvite: boolean;
  banExtremo: boolean;
  autoRead: boolean;
  allowedLinks: string[];
  featureFlags: Record<string, boolean>;
  moderationActions: BotGroupModerationActions;
  allowedDdis: string[];
  antifakeMessage: string;
  bannedWords: string[];
  antipalavrasMaxInfractions: number;
  language: string;
  commandPrefixes: string[];
  allowCommandsWithoutPrefix: boolean;
  commandToggles: BotGroupCommandToggles;
  commandAliases?: Record<string, string[]>; // aliases configuráveis por comando (canônico -> lista)
  menuTexts: BotGroupMenuTexts;
  menuCarousel: BotGroupMenuCarousel;
  welcomeConfig: BotGroupWelcomeConfig;
  farewellConfig: BotGroupFarewellConfig;
  autoResponses: BotGroupAutoResponse[];
  ads: BotGroupAd[];
  horapgConfig: BotGroupHorapgConfig;
  scheduleConfig: BotGroupScheduleConfig;
  antiInactivityConfig: BotGroupAntiInactivityConfig;
  antispamConfig: BotGroupAntispamConfig;
  premium: BotGroupPremiumConfig;
  botCoins: BotGroupCoinsConfig;
  lastMarkMessage: BotGroupMarkMessage | null;
  lastBroadcastTemplate: BotGroupBroadcastTemplate | null;
  rulesMessage: BotGroupStaticMessage | null;
  tableMessage: BotGroupStaticMessage | null;
  mutedMembers: string[];
  muteBanLimit: number;
  blacklist: string[];
  aiProvider: "groq" | "openai" | "chatgpt_system";
  groqKeys: string[];
  openAiApiKey: string | null;
  aiPrompt: string;
  aiToolsPrompt: string;
  aiVoice: string | null;
  aiModel: string | null;
  aiMemory: BotGroupAiMemoryEntry[];
  aiLastInteractionAt: string | null;
  unknownCommandTemplate: string | null;
  planRenewalAdminsOnly: boolean;
  planRenewalSilent: boolean;
  maxInfractions: number;
  createdAt: string;
  updatedAt: string;
};

export type BotGroupInfraction = {
  id: number;
  groupId: number;
  memberJid: string;
  reason: string;
  count: number;
  createdAt: string;
  lastOccurredAt: string;
};

export type BotGroupMuteEntry = {
  groupId: number;
  memberJid: string;
  banAfterMessages: number;
  deletedCount: number;
  lastWarnedCount: number;
  mutedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
