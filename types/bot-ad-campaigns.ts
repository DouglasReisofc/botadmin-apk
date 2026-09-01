import type {
  BotGroupAutoResponseMedia,
  BotGroupCtaButton,
  BotGroupWelcomeReplyButton,
} from "./bot-groups";
import type { DivulgacaoInspectionResult } from "./divulgacao";

export type BotAdCampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

export type BotAdCampaignTargetType = "group" | "status";

export type BotAdCampaignScheduleKind = "manual" | "immediate" | "once" | "recurring" | "window";

export type BotAdCampaignScheduleConfig =
  | {
      kind: "manual";
    }
  | {
      kind: "immediate";
    }
  | {
      kind: "once";
      runAt: string;
    }
  | {
      kind: "recurring";
      everyMinutes?: number | null;
      timezone?: string | null;
      atTimes?: string[] | null;
      daysOfWeek?: number[] | null;
      startAt?: string | null;
      endAt?: string | null;
    }
  | {
      kind: "window";
      timezone?: string | null;
      atTimes: string[];
      daysOfWeek?: number[] | null;
      startAt?: string | null;
      endAt?: string | null;
    };

export type BotAdCampaignStatusVisibility =
  | "all"
  | "contacts"
  | "nobody"
  | "whitelist"
  | "blacklist";

export type BotAdCampaignStatusConfig = {
  deleteAfterMinutes?: number | null;
  deleteAt?: string | null;
  visibility?: BotAdCampaignStatusVisibility | null;
  whitelist?: string[] | null;
  blacklist?: string[] | null;
  mentions?: string[] | null;
  allowReshare?: boolean | null;
  /** Index in schedule.atTimes used when each status has its own time. */
  scheduleSlot?: number | null;
  /** Documento não destrutivo usado para reabrir o editor visual. */
  visualEditor?: Record<string, unknown> | null;
  /** Link original resolvido somente quando o status for realmente enviado. */
  sourceUrl?: string | null;
  /** Capa leve usada apenas na interface; nunca é enviada como status. */
  previewUrl?: string | null;
  /** Fonte dinâmica que escolhe Reels públicos do perfil sem importá-los. */
  instagramProfile?: {
    username: string;
    automatic: boolean;
    analyzeWithGemini?: boolean | null;
  } | null;
};

export type BotAdCampaignStatusRandomizer = {
  enabled: boolean;
  perRunCount?: number | null;
  /** Legacy daily quota kept for existing campaigns. */
  perDayCount?: number | null;
  /** Hard daily quota per campaign/status target, even without randomization. */
  dailyLimit?: number | null;
  /** Reserves one daily quota slot for a marked preferred status. */
  ensurePreferredDaily?: boolean | null;
};

export type BotAdCampaignGroupRandomizer = {
  enabled: boolean;
  perRunCount?: number | null;
};

export type BotAdCampaignScheduleRandomizer = {
  enabled: boolean;
  jitterMinutes?: number | null;
  reshuffleDaily?: boolean;
  windowStartHour?: number | null;
  windowEndHour?: number | null;
};

export type BotAdCampaignGroupDispatchOptions = {
  targetMode?: "selected" | "all_open" | null;
  targetDelayMinMinutes?: number | null;
  targetDelayMaxMinutes?: number | null;
  prioritizeNeverSent?: boolean | null;
};

export type BotAdCampaignStatusCommand = {
  enabled: boolean;
  command: string;
  captionProvider?: "gemini" | "auto" | "chatgpt" | null;
};

export type BotAdCampaignOptions = {
  statusRandomizer?: BotAdCampaignStatusRandomizer | null;
  groupRandomizer?: BotAdCampaignGroupRandomizer | null;
  scheduleRandomizer?: BotAdCampaignScheduleRandomizer | null;
  groupDispatch?: BotAdCampaignGroupDispatchOptions | null;
  statusCommand?: BotAdCampaignStatusCommand | null;
} | null;

export type BotAdCampaignContent =
  | {
      id: string;
      type: "text";
      text: string;
      mentionAll?: boolean;
      mentions?: string[];
    }
  | {
      id: string;
      type: "image" | "video" | "audio" | "document" | "sticker";
      caption?: string | null;
      media?: BotGroupAutoResponseMedia | null;
      fileName?: string | null;
      mimeType?: string | null;
      mentionAll?: boolean;
      mentions?: string[];
    }
  | {
      id: string;
      type: "buttons";
      style?: "reply" | "cta" | null;
      title?: string | null;
      body: string;
      footer?: string | null;
      replyButtons?: BotGroupWelcomeReplyButton[];
      ctaButtons?: BotGroupCtaButton[];
      headerMedia?: BotGroupAutoResponseMedia | null;
      mentionAll?: boolean;
      mentions?: string[];
    }
  | {
      id: string;
      type: "affiliate_ml";
      query: string;
      filter?: "relevance" | "cheapest" | "free_shipping" | "sold" | "random";
      limit?: number;
      preferAvailable?: boolean;
      includeImage?: boolean;
      includeUrlButton?: boolean;
      requireAffiliateLink?: boolean;
      introText?: string | null;
      dispatchEnabled?: boolean;
      dispatchIntervalMinutes?: number;
      categoryRotationEnabled?: boolean;
      mentionAll?: boolean;
      mentions?: string[];
    }
  | {
      id: string;
      type: "status";
      statusType: "text" | "image" | "video" | "document";
      text?: string | null;
      caption?: string | null;
      media?: BotGroupAutoResponseMedia | null;
      config?: BotAdCampaignStatusConfig | null;
      alwaysSendWhenRandomized?: boolean;
    };

export type BotAdCampaignTargetAudience = {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  categories?: string[] | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type BotAdCampaignTarget = {
  id: string;
  type: BotAdCampaignTargetType;
  instanceId: number;
  groupId?: number | null;
  remoteId?: string | null;
  inviteCode?: string | null;
  inviteLink?: string | null;
  audience?: BotAdCampaignTargetAudience | null;
  inspection?: DivulgacaoInspectionResult | null;
  mentionAll?: boolean;
  excludeAdmins?: boolean;
  mentions?: string[];
  statusConfig?: BotAdCampaignStatusConfig | null;
};

export type CampaignNextTargetHint = {
  targetId: string;
  targetType: BotAdCampaignTargetType;
  instanceId: number;
  groupId?: number | null;
  remoteId?: string | null;
  inviteLink?: string | null;
  title?: string | null;
  etaSeconds?: number | null;
};

export type BotAdCampaign = {
  id: string;
  numericId: number;
  userId: number;
  name: string;
  description: string | null;
  status: BotAdCampaignStatus;
  schedule: BotAdCampaignScheduleConfig;
  timezone: string | null;
  startAt: string | null;
  endAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  contents: BotAdCampaignContent[];
  targets: BotAdCampaignTarget[];
  options: BotAdCampaignOptions;
  nextTargetHint?: CampaignNextTargetHint | null;
  createdAt: string;
  updatedAt: string;
};

export type GroupAdCampaignMeta = {
  campaignId: string;
  adId: string;
  groupId: number;
  groupName: string;
  instanceId: number;
  instancePhone: string;
  remoteId: string;
};

export type BotAdCampaignInput = {
  name: string;
  description?: string | null;
  schedule?: BotAdCampaignScheduleConfig | null;
  timezone?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  contents?: BotAdCampaignContent[];
  options?: BotAdCampaignOptions;
  status?: BotAdCampaignStatus | null;
};

export type BotAdCampaignTargetInput = Omit<BotAdCampaignTarget, "id"> & {
  id?: string | null;
};

export type CampaignTargetValidationIssue = {
  targetId: string;
  inviteLink?: string | null;
  targetName?: string | null;
  reason: string;
};

export type BotAdCampaignRunStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "skipped";

export type BotAdCampaignRun = {
  id: string;
  campaignId: string;
  targetId: string | null;
  status: BotAdCampaignRunStatus;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  stats: Record<string, unknown> | null;
};
