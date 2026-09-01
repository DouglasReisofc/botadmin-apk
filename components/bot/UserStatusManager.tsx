"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconCalendarTime,
  IconCameraPlus,
  IconLink,
  IconLoader2,
  IconMovie,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";

import styles from "./UserStatusManager.module.css";

import type { BotInstance, BotInstanceProfile } from "types/bot-instances";

type StatusContentConfig = {
  mentions?: string[] | null;
  allowReshare?: boolean | null;
};

type DiscoverableStatusGroup = {
  remoteId: string;
  name: string;
  participantsCount: number;
  announceOnly?: boolean;
  instanceIsAdmin?: boolean;
  mentionable?: boolean;
};

type DiscoverableStatusContact = {
  jid: string;
  phone: string;
  name: string;
  shortName?: string | null;
  pushName?: string | null;
};

type BroadcastRecipient = {
  jid: string;
  phone: string;
  name: string;
};

type MentionPickerState = {
  open: boolean;
  target: "composer" | "campaign" | null;
  targetId: string | null;
  instanceId: number | null;
  mode: "choice" | "people" | "groups";
  selectedMentions: string[];
  search: string;
};

type StatusPost = {
  id: string;
  campaignId: string | null;
  campaignName: string;
  campaignScheduleKind: string | null;
  instanceId: number;
  instanceName: string;
  messageId: string | null;
  createdAt: string | null;
  deleteAt: string | null;
  errorMessage: string | null;
  content: {
    id: string;
    type: "text" | "image" | "video" | "document";
    text: string;
    caption: string;
    mediaUrl: string;
    config?: StatusContentConfig | null;
  } | null;
  isPending?: boolean;
};

type CampaignStatusContentPreview = {
  id: string;
  statusType: "text" | "image" | "video" | "document";
  text: string;
  caption: string;
  mediaUrl: string;
};

type StatusCampaign = {
  id: string;
  numericId: number;
  name: string;
  status: string;
  scheduleKind: string;
  nextRunAt: string | null;
  instanceIds: number[];
  contentCount?: number;
  statusContents?: CampaignStatusContentPreview[];
  options?: {
    statusRandomizer?: {
      enabled: boolean;
      perRunCount?: number | null;
      perDayCount?: number | null;
    } | null;
    scheduleRandomizer?: {
      enabled: boolean;
      jitterMinutes?: number | null;
      reshuffleDaily?: boolean;
      windowStartHour?: number | null;
      windowEndHour?: number | null;
    } | null;
  } | null;
};

type CampaignDetail = {
  id: string;
  name: string;
  instanceId: number | null;
  schedule: {
    kind: "manual" | "immediate" | "once" | "recurring" | "window";
    everyMinutes?: number | null;
    timezone?: string | null;
    atTimes?: string[] | null;
    runAt?: string;
    daysOfWeek?: number[] | null;
    startAt?: string | null;
    endAt?: string | null;
  };
  options?: StatusCampaign["options"];
  contents: Array<{
    id: string;
    type: "status";
    statusType: "text" | "image" | "video" | "document";
    text?: string | null;
    caption?: string | null;
    media?: {
      url?: string | null;
      path?: string | null;
      mimeType?: string | null;
      fileName?: string | null;
    } | null;
    config?: StatusContentConfig | null;
  }>;
};

type FeedResponse = {
  posts: StatusPost[];
  receivedStatuses?: ReceivedWhatsappStatus[];
  campaigns: StatusCampaign[];
};

type ReceivedWhatsappStatus = {
  id: number;
  instanceId: number;
  messageId: string | null;
  authorJid: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  type: "text" | "image" | "video" | "audio" | "sticker" | "document" | string;
  text: string | null;
  caption: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  timestamp: string;
  expiresAt: string;
};

type ComposerMode = "manual" | "scheduled";

const MAX_COMPOSER_ITEMS = 50;

type LinkProvider =
  | "tiktok"
  | "douyin"
  | "pinterest"
  | "instagram"
  | "facebook"
  | "kwai"
  | "shopee"
  | "youtube"
  | "threads"
  | "generic";

type ComposerItem = {
  id: string;
  type: "text" | "image" | "video";
  text: string;
  caption: string;
  mediaUrl: string;
  mediaPath: string;
  mediaMimeType: string;
  mediaFileName: string;
  mentionsInput: string;
  allowReshare: boolean;
};

type LinkResolutionState = {
  processing: boolean;
  provider?: LinkProvider;
  message?: string | null;
  error?: string | null;
  previewUrl?: string | null;
  thumbnail?: string | null;
  title?: string | null;
  lastUrl?: string | null;
};

type UploadState = {
  uploading: boolean;
  message?: string | null;
  error?: string | null;
};

type TmdbModalState = {
  open: boolean;
  itemId: string | null;
  query: string;
  loading: boolean;
  error: string | null;
  result: {
    title: string;
    overview: string;
    poster: string | null;
    caption: string;
  } | null;
};

type Props = {
  instances: BotInstance[];
  preferredInstanceId?: number | null;
  onPreferredInstanceChange?: (instanceId: number | null) => void;
  apiKey?: string | null;
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toPtDate = (value: string | null | undefined) => {
  if (!value) return "agora mesmo";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "agora mesmo";
  return parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

const toPtTime = (value: string | null | undefined) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "ST";

const TIKTOK_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:tiktok\.com|vm\.tiktok\.com)/i;
const DOUYIN_URL_REGEX = /(?:https?:\/\/)?(?:(?:www|m|v)\.)?(?:douyin\.com|iesdouyin\.com|ixigua\.com)/i;
const PINTEREST_URL_REGEX = /(?:https?:\/\/)?(?:[a-z]+\.)?(?:pinterest\.com|pin\.it|pinimg\.com)/i;

const detectMediaLinkProvider = (value?: string | null): LinkProvider | null => {
  if (!value) {
    return null;
  }
  const input = value.trim();
  if (!input) {
    return null;
  }
  if (DOUYIN_URL_REGEX.test(input)) return "douyin";
  if (TIKTOK_URL_REGEX.test(input)) return "tiktok";
  if (PINTEREST_URL_REGEX.test(input)) return "pinterest";

  try {
    const host = new URL(input).hostname.toLowerCase();
    if (host.includes("instagram.com") || host.includes("instagr.am")) return "instagram";
    if (host.includes("facebook.com") || host.includes("fb.watch") || host === "fb.com") return "facebook";
    if (host.includes("kwai") || host.includes("kuaishou")) return "kwai";
    if (host.includes("shopee") || host.includes("shp.ee")) return "shopee";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    if (host.includes("threads.net") || host.includes("threads.com")) return "threads";
    return "generic";
  } catch {
    return null;
  }
};

const normalizeMentionsList = (value: string | string[] | null | undefined): string[] => {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;]+/)
      : [];
  const mentions = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }
    mentions.add(normalized);
    if (mentions.size >= 256) {
      break;
    }
  }
  return Array.from(mentions.values());
};

const summarizeMentions = (mentions: string[] | null | undefined): string => {
  const normalized = normalizeMentionsList(mentions ?? []);
  if (normalized.length === 0) {
    return "Nenhuma menção configurada.";
  }
  if (normalized.length <= 3) {
    return normalized.join(", ");
  }
  return `${normalized.slice(0, 3).join(", ")} +${normalized.length - 3}`;
};

const getReceivedStatusTitle = (status: ReceivedWhatsappStatus) =>
  status.authorName?.trim() ||
  status.authorJid?.split("@")[0] ||
  "Contato";

const getReceivedStatusPreview = (status: ReceivedWhatsappStatus) => {
  const text = status.caption?.trim() || status.text?.trim();
  if (text) return text;
  if (status.type === "image") return "Imagem";
  if (status.type === "video") return "Vídeo";
  if (status.type === "audio") return "Áudio";
  if (status.type === "sticker") return "Figurinha";
  if (status.type === "document") return "Documento";
  return "Status";
};

const mapStatusConfigForComposer = (value?: StatusContentConfig | null) => {
  const mentions = normalizeMentionsList(value?.mentions ?? []);
  return {
    mentionsInput: mentions.join(", "),
    allowReshare: typeof value?.allowReshare === "boolean" ? value.allowReshare : true,
  };
};

const buildStatusConfigFromComposer = (item: ComposerItem): StatusContentConfig => {
  const mentions = normalizeMentionsList(item.mentionsInput);
  return {
    mentions: mentions.length > 0 ? mentions : null,
    allowReshare: item.allowReshare,
  };
};

const createEmptyComposerItem = (type: ComposerItem["type"] = "text"): ComposerItem => ({
  id: uid(),
  type,
  text: "",
  caption: "",
  mediaUrl: "",
  mediaPath: "",
  mediaMimeType: "",
  mediaFileName: "",
  mentionsInput: "",
  allowReshare: true,
});

const mapPostContentToComposerItem = (post: StatusPost): ComposerItem => {
  const content = post.content;
  if (!content) {
    return createEmptyComposerItem("text");
  }
  const config = mapStatusConfigForComposer(content.config ?? null);
  if (content.type === "text") {
    return {
      ...createEmptyComposerItem("text"),
      text: content.text || "",
      caption: "",
      ...config,
    };
  }
  return {
    ...createEmptyComposerItem(content.type === "video" ? "video" : "image"),
    text: "",
    caption: content.caption || "",
    mediaUrl: content.mediaUrl || "",
    ...config,
  };
};

const normalizeTimesInput = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter((entry) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(entry)),
    ),
  ).sort((left, right) => left.localeCompare(right));

const STATUS_INSTANCE_PROFILE_CACHE_KEY = "botadmin:status-instance-profile-cache:v1";
const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isScheduledCampaignKind = (value: string | null | undefined) =>
  value === "recurring" || value === "window" || value === "once";

const getStatusPostTitle = (post: StatusPost) => {
  if (!isScheduledCampaignKind(post.campaignScheduleKind)) {
    return "Status manual";
  }
  const normalizedName = post.campaignName.trim();
  return normalizedName || "Status programado";
};

const scheduleKindLabel = (kind: string) => {
  if (kind === "recurring") return "Recorrente";
  if (kind === "window") return "Janela";
  if (kind === "once") return "Única";
  if (kind === "manual") return "Manual";
  return kind || "Programado";
};

const getStatusBubbleBadge = (type: "text" | "image" | "video" | "document") => {
  if (type === "video") return "VID";
  if (type === "document") return "DOC";
  if (type === "image") return "IMG";
  return "TXT";
};

const mapPostToStatusContentPayload = (post: StatusPost): Array<Record<string, unknown>> => {
  const content = post.content;
  if (!content) {
    throw new Error("Este status não tem conteúdo para repostar.");
  }
  const config = content.config ?? null;

  if (content.type === "text") {
    const text = content.text.trim();
    if (!text) {
      throw new Error("Este status de texto está vazio e não pode ser repostado.");
    }
    return [
      {
        id: uid(),
        type: "status",
        statusType: "text",
        text,
        config,
      },
    ];
  }

  const mediaUrl = content.mediaUrl.trim();
  if (!mediaUrl) {
    throw new Error("Este status de mídia não possui URL para repostagem.");
  }

  return [
    {
      id: uid(),
      type: "status",
      statusType: content.type,
      caption: content.caption.trim() || null,
      config,
      media: {
        url: mediaUrl,
      },
    },
  ];
};

const mapComposerItemToOptimisticContent = (item: ComposerItem): StatusPost["content"] => {
  const config = buildStatusConfigFromComposer(item);
  if (item.type === "text") {
    return {
      id: uid(),
      type: "text",
      text: item.text.trim(),
      caption: "",
      mediaUrl: "",
      config,
    };
  }
  return {
    id: uid(),
    type: item.type,
    text: "",
    caption: item.caption.trim(),
    mediaUrl: item.mediaUrl.trim() || item.mediaPath.trim(),
    config,
  };
};

const normalizeCampaignDetail = (payload: unknown): CampaignDetail | null => {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { campaign?: unknown };
  if (!root.campaign || typeof root.campaign !== "object") return null;
  const campaign = root.campaign as Record<string, unknown>;
  const targets = Array.isArray(campaign.targets) ? campaign.targets : [];
  const statusTarget = targets.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).type === "status" &&
      typeof (entry as Record<string, unknown>).instanceId === "number",
  ) as Record<string, unknown> | undefined;
  const rawContents = Array.isArray(campaign.contents) ? campaign.contents : [];
  const contents: CampaignDetail["contents"] = rawContents
    .filter((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).type === "status")
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const mediaRaw =
        record.media && typeof record.media === "object" ? (record.media as Record<string, unknown>) : null;
      const configRaw =
        record.config && typeof record.config === "object"
          ? (record.config as Record<string, unknown>)
          : null;
      return {
        id: typeof record.id === "string" && record.id.trim() ? record.id : uid(),
        type: "status" as const,
        statusType:
          record.statusType === "video"
            ? "video"
            : record.statusType === "image"
              ? "image"
              : record.statusType === "document"
                ? "document"
                : "text",
        text: typeof record.text === "string" ? record.text : "",
        caption: typeof record.caption === "string" ? record.caption : "",
        media: mediaRaw
          ? {
              url: typeof mediaRaw.url === "string" ? mediaRaw.url : null,
              path: typeof mediaRaw.path === "string" ? mediaRaw.path : null,
              mimeType: typeof mediaRaw.mimeType === "string" ? mediaRaw.mimeType : null,
              fileName: typeof mediaRaw.fileName === "string" ? mediaRaw.fileName : null,
            }
          : null,
        config: configRaw
          ? {
              mentions: normalizeMentionsList(
                Array.isArray(configRaw.mentions)
                  ? (configRaw.mentions as string[])
                  : Array.isArray(configRaw.Mentions)
                    ? (configRaw.Mentions as string[])
                    : [],
              ),
              allowReshare:
                typeof configRaw.allowReshare === "boolean"
                  ? configRaw.allowReshare
                  : typeof configRaw.allow_reshare === "boolean"
                    ? configRaw.allow_reshare
                    : true,
            }
          : {
              mentions: [],
              allowReshare: true,
            },
      };
    });
  if (!Array.isArray(contents) || contents.length === 0) return null;

  const scheduleRaw =
    campaign.schedule && typeof campaign.schedule === "object" ? (campaign.schedule as Record<string, unknown>) : {};
  const optionsRaw =
    campaign.options && typeof campaign.options === "object"
      ? (campaign.options as StatusCampaign["options"])
      : null;

  return {
    id: typeof campaign.id === "string" ? campaign.id : "",
    name: typeof campaign.name === "string" ? campaign.name : "Programação de status",
    instanceId:
      typeof statusTarget?.instanceId === "number" && Number.isFinite(statusTarget.instanceId)
        ? Number(statusTarget.instanceId)
        : null,
    schedule: {
      kind:
        scheduleRaw.kind === "immediate"
          ? "immediate"
          : scheduleRaw.kind === "once"
            ? "once"
            : scheduleRaw.kind === "recurring"
              ? "recurring"
              : scheduleRaw.kind === "window"
                ? "window"
                : "manual",
      everyMinutes:
        typeof scheduleRaw.everyMinutes === "number" && Number.isFinite(scheduleRaw.everyMinutes)
          ? scheduleRaw.everyMinutes
          : null,
      timezone: typeof scheduleRaw.timezone === "string" ? scheduleRaw.timezone : null,
      atTimes: Array.isArray(scheduleRaw.atTimes)
        ? scheduleRaw.atTimes.filter((entry): entry is string => typeof entry === "string")
        : null,
      runAt: typeof scheduleRaw.runAt === "string" ? scheduleRaw.runAt : undefined,
      daysOfWeek: Array.isArray(scheduleRaw.daysOfWeek)
        ? scheduleRaw.daysOfWeek.filter((entry): entry is number => typeof entry === "number")
        : null,
      startAt: typeof scheduleRaw.startAt === "string" ? scheduleRaw.startAt : null,
      endAt: typeof scheduleRaw.endAt === "string" ? scheduleRaw.endAt : null,
    },
    options: optionsRaw,
    contents,
  };
};

const UserStatusManager = ({
  instances,
  preferredInstanceId = null,
  onPreferredInstanceChange,
  apiKey = null,
}: Props) => {
  const [feed, setFeed] = useState<FeedResponse>({ posts: [], receivedStatuses: [], campaigns: [] });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [instanceProfiles, setInstanceProfiles] = useState<Record<number, BotInstanceProfile>>({});
  const [profileCacheLoaded, setProfileCacheLoaded] = useState(false);
  const [brokenInstanceImages, setBrokenInstanceImages] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("manual");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [attachPost, setAttachPost] = useState<StatusPost | null>(null);
  const [previewStatus, setPreviewStatus] = useState<ReceivedWhatsappStatus | null>(null);
  const [attachMode, setAttachMode] = useState<"existing" | "new">("existing");
  const [attachCampaignId, setAttachCampaignId] = useState("");

  const [instanceId, setInstanceId] = useState<string>(() => {
    if (preferredInstanceId != null && instances.some((instance) => instance.id === preferredInstanceId)) {
      return String(preferredInstanceId);
    }
    return instances[0] ? String(instances[0].id) : "";
  });
  const [campaignName, setCampaignName] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"recurring" | "window">("recurring");
  const [everyMinutes, setEveryMinutes] = useState("1440");
  const [times, setTimes] = useState("08:00, 14:00, 20:00");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [contentRandomizerEnabled, setContentRandomizerEnabled] = useState(true);
  const [contentRandomizerCount, setContentRandomizerCount] = useState("1");
  const [scheduleRandomizerEnabled, setScheduleRandomizerEnabled] = useState(false);
  const [scheduleRandomizerJitter, setScheduleRandomizerJitter] = useState("90");
  const [scheduleReshuffleDaily, setScheduleReshuffleDaily] = useState(false);
  const [scheduleWindowStartHour, setScheduleWindowStartHour] = useState("7");
  const [scheduleWindowEndHour, setScheduleWindowEndHour] = useState("22");
  const [composerItems, setComposerItems] = useState<ComposerItem[]>(() => [createEmptyComposerItem("text")]);
  const [composerLinks, setComposerLinks] = useState<Record<string, LinkResolutionState>>({});
  const [composerUploads, setComposerUploads] = useState<Record<string, UploadState>>({});
  const composerLinksRef = useRef<Record<string, LinkResolutionState>>({});
  const feedAbortRef = useRef<AbortController | null>(null);

  const [attachNewName, setAttachNewName] = useState("");
  const [attachNewScheduleKind, setAttachNewScheduleKind] = useState<"recurring" | "window">("recurring");
  const [attachNewEveryMinutes, setAttachNewEveryMinutes] = useState("1440");
  const [attachNewTimes, setAttachNewTimes] = useState("08:00, 14:00, 20:00");
  const [attachNewTimezone, setAttachNewTimezone] = useState("America/Sao_Paulo");

  const [tmdbModal, setTmdbModal] = useState<TmdbModalState>({
    open: false,
    itemId: null,
    query: "",
    loading: false,
    error: null,
    result: null,
  });
  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false);
  const [campaignDetailLoading, setCampaignDetailLoading] = useState(false);
  const [campaignDetailSaving, setCampaignDetailSaving] = useState(false);
  const [campaignDetailError, setCampaignDetailError] = useState<string | null>(null);
  const [campaignDetail, setCampaignDetail] = useState<CampaignDetail | null>(null);
  const [instanceGroupsById, setInstanceGroupsById] = useState<Record<number, DiscoverableStatusGroup[]>>({});
  const [instanceGroupsLoading, setInstanceGroupsLoading] = useState<Record<number, boolean>>({});
  const [instanceGroupsError, setInstanceGroupsError] = useState<Record<number, string | null>>({});
  const [instanceContactsById, setInstanceContactsById] = useState<Record<number, DiscoverableStatusContact[]>>({});
  const [instanceContactsLoading, setInstanceContactsLoading] = useState<Record<number, boolean>>({});
  const [instanceContactsError, setInstanceContactsError] = useState<Record<number, string | null>>({});
  const [mentionPicker, setMentionPicker] = useState<MentionPickerState>({
    open: false,
    target: null,
    targetId: null,
    instanceId: null,
    mode: "choice",
    selectedMentions: [],
    search: "",
  });
  const [createModePickerOpen, setCreateModePickerOpen] = useState(false);
  // Kept closed while transmissions move to their dedicated workspace.
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastSearch, setBroadcastSearch] = useState("");
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastRecipients, setBroadcastRecipients] = useState<BroadcastRecipient[]>([]);
  const [broadcastManualName, setBroadcastManualName] = useState("");
  const [broadcastManualPhone, setBroadcastManualPhone] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);

  const setComposerLinkState = useCallback((itemId: string, updater: (state: LinkResolutionState) => LinkResolutionState) => {
    setComposerLinks((prev) => {
      const next = {
        ...prev,
        [itemId]: updater(prev[itemId] ?? { processing: false }),
      };
      composerLinksRef.current = next;
      return next;
    });
  }, []);

  const clearComposerLinkState = useCallback((itemId: string) => {
    setComposerLinks((prev) => {
      if (!prev[itemId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[itemId];
      composerLinksRef.current = next;
      return next;
    });
  }, []);

  const clearComposerUploadState = useCallback((itemId: string) => {
    setComposerUploads((prev) => {
      if (!prev[itemId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  const updateComposerItem = useCallback((itemId: string, patch: Partial<ComposerItem>) => {
    setComposerItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    );
  }, []);

  const applyFeedSnapshot = useCallback((snapshot: FeedResponse, scopeInstanceId: number | null) => {
    setFeed((current) => {
      const pending = current.posts.filter(
        (post) => post.isPending && (scopeInstanceId == null || post.instanceId === scopeInstanceId),
      );
      const serverPosts = Array.isArray(snapshot.posts) ? snapshot.posts : [];
      const mergedPending = pending.filter((pendingPost) => {
        return !serverPosts.some((serverPost) => {
          if (!pendingPost.campaignId || !serverPost.campaignId) return false;
          if (pendingPost.campaignId !== serverPost.campaignId) return false;
          const pendingText = pendingPost.content?.text?.trim() || "";
          const serverText = serverPost.content?.text?.trim() || "";
          const pendingCaption = pendingPost.content?.caption?.trim() || "";
          const serverCaption = serverPost.content?.caption?.trim() || "";
          return pendingText === serverText && pendingCaption === serverCaption;
        });
      });
      return {
        posts: [...mergedPending, ...serverPosts].slice(0, 160),
        receivedStatuses: Array.isArray(snapshot.receivedStatuses)
          ? snapshot.receivedStatuses
          : current.receivedStatuses ?? [],
        campaigns: Array.isArray(snapshot.campaigns) ? snapshot.campaigns : [],
      };
    });
  }, []);

  const refreshFeed = useCallback(
    async ({
      silent = false,
      instanceIdOverride = null,
    }: {
      silent?: boolean;
      instanceIdOverride?: number | null;
    } = {}): Promise<FeedResponse | null> => {
    let currentController: AbortController | null = null;
    const parsedInstanceId = Number(instanceId);
    const selectedInstanceId =
      Number.isFinite(parsedInstanceId) && parsedInstanceId > 0
        ? parsedInstanceId
        : null;
    const scopeInstanceId =
      typeof instanceIdOverride === "number" && Number.isFinite(instanceIdOverride)
        ? instanceIdOverride
        : selectedInstanceId;
    if (!silent) {
      setLoading(true);
    }
    try {
      feedAbortRef.current?.abort();
      currentController = new AbortController();
      feedAbortRef.current = currentController;
      const endpoint =
        typeof scopeInstanceId === "number"
          ? `/api/bot-status?instanceId=${scopeInstanceId}`
          : "/api/bot-status";
      const response = await fetch(endpoint, { cache: "no-store", signal: currentController.signal });
      const data = (await response.json().catch(() => null)) as FeedResponse | null;
      if (!response.ok || !data) {
        throw new Error("Não foi possível carregar os status.");
      }
      const snapshot: FeedResponse = {
        posts: Array.isArray(data.posts) ? data.posts : [],
        receivedStatuses: Array.isArray(data.receivedStatuses) ? data.receivedStatuses : [],
        campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      };
      applyFeedSnapshot(snapshot, scopeInstanceId);
      return snapshot;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      if (!silent) {
        setMessage({
          ok: false,
          text: error instanceof Error ? error.message : "Erro ao carregar status.",
        });
      }
      return null;
    } finally {
      if (feedAbortRef.current === currentController) {
        feedAbortRef.current = null;
      }
      if (!silent) {
        setLoading(false);
      }
    }
    },
    [applyFeedSnapshot, instanceId],
  );

  const selectedInstance = useMemo(
    () => instances.find((item) => String(item.id) === instanceId) ?? instances[0] ?? null,
    [instanceId, instances],
  );
  const selectedInstanceAvatar = useMemo(() => {
    if (!selectedInstance) return null;
    if (brokenInstanceImages[selectedInstance.id]) return null;
    return instanceProfiles[selectedInstance.id]?.avatarUrl ?? null;
  }, [brokenInstanceImages, instanceProfiles, selectedInstance]);

  const filteredPosts = useMemo(() => {
    const scopedPosts = selectedInstance
      ? feed.posts.filter((post) => post.instanceId === selectedInstance.id)
      : feed.posts;
    const query = search.trim().toLowerCase();
    if (!query) return scopedPosts;
    return scopedPosts.filter((post) => {
      const target =
        `${post.campaignName} ${post.instanceName} ${post.content?.text ?? ""} ${post.content?.caption ?? ""}`.toLowerCase();
      return target.includes(query);
    });
  }, [feed.posts, search, selectedInstance]);

  const receivedStatuses = useMemo(() => {
    const items = Array.isArray(feed.receivedStatuses) ? feed.receivedStatuses : [];
    const scoped = selectedInstance
      ? items.filter((status) => status.instanceId === selectedInstance.id)
      : items;
    const now = Date.now();
    return scoped
      .filter((status) => {
        const expiresAt = Date.parse(status.expiresAt);
        return Number.isNaN(expiresAt) || expiresAt > now;
      })
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  }, [feed.receivedStatuses, selectedInstance]);

  const filteredCampaigns = useMemo(() => {
    if (!selectedInstance) return feed.campaigns;
    return feed.campaigns.filter((campaign) => campaign.instanceIds.includes(selectedInstance.id));
  }, [feed.campaigns, selectedInstance]);
  const attachableCampaigns = useMemo(
    () => filteredCampaigns.filter((campaign) => isScheduledCampaignKind(campaign.scheduleKind)),
    [filteredCampaigns],
  );
  const scheduledCampaigns = useMemo(
    () =>
      filteredCampaigns
        .filter((campaign) => isScheduledCampaignKind(campaign.scheduleKind))
        .sort((left, right) => {
          const leftTs = left.nextRunAt ? Date.parse(left.nextRunAt) : Number.MAX_SAFE_INTEGER;
          const rightTs = right.nextRunAt ? Date.parse(right.nextRunAt) : Number.MAX_SAFE_INTEGER;
          return leftTs - rightTs;
        }),
    [filteredCampaigns],
  );
  const mentionPickerGroups = useMemo(() => {
    if (!mentionPicker.instanceId) {
      return [];
    }
    const source = instanceGroupsById[mentionPicker.instanceId] ?? [];
    const onlyMentionable = source.filter((group) => group.mentionable !== false);
    const query = mentionPicker.search.trim().toLowerCase();
    if (!query) {
      return onlyMentionable;
    }
    return onlyMentionable.filter((group) => {
      const target = `${group.name} ${group.remoteId}`.toLowerCase();
      return target.includes(query);
    });
  }, [instanceGroupsById, mentionPicker.instanceId, mentionPicker.search]);

  const mentionPickerContacts = useMemo(() => {
    if (!mentionPicker.instanceId) {
      return [];
    }
    const source = instanceContactsById[mentionPicker.instanceId] ?? [];
    const query = mentionPicker.search.trim().toLowerCase();
    if (!query) {
      return source;
    }
    return source.filter((contact) => {
      const target = `${contact.name} ${contact.phone} ${contact.jid}`.toLowerCase();
      return target.includes(query);
    });
  }, [instanceContactsById, mentionPicker.instanceId, mentionPicker.search]);
  const broadcastContacts: DiscoverableStatusContact[] = [];


  const loadInstanceProfile = useCallback(async (instanceIdValue: number) => {
    if (!profileCacheLoaded) return;
    if (instanceProfiles[instanceIdValue]?.avatarUrl) return;
    try {
      const response = await fetch(`/api/bot-instances/${instanceIdValue}/profile`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json().catch(() => null)) as { profile?: BotInstanceProfile } | null;
      if (!data?.profile) return;
      setInstanceProfiles((current) => ({ ...current, [instanceIdValue]: data.profile! }));
      setBrokenInstanceImages((current) => {
        if (!current[instanceIdValue]) return current;
        const next = { ...current };
        delete next[instanceIdValue];
        return next;
      });
    } catch {
      // Perfil opcional.
    }
  }, [instanceProfiles, profileCacheLoaded]);

  const loadInstanceGroups = useCallback(async (instanceIdValue: number) => {
    if (!Number.isFinite(instanceIdValue) || instanceIdValue <= 0) {
      return;
    }
    if (instanceGroupsLoading[instanceIdValue]) {
      return;
    }
    if (Array.isArray(instanceGroupsById[instanceIdValue]) && !instanceGroupsError[instanceIdValue]) {
      return;
    }

    setInstanceGroupsLoading((current) => ({ ...current, [instanceIdValue]: true }));
    setInstanceGroupsError((current) => ({ ...current, [instanceIdValue]: null }));
    try {
      const response = await fetch(`/api/bot-instances/${instanceIdValue}/groups`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as
        | {
            groups?: Array<{
              remoteId?: string;
              name?: string;
              participantsCount?: number;
              announceOnly?: boolean;
              instanceIsAdmin?: boolean;
              mentionable?: boolean;
            }>;
            message?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível carregar grupos da instância.");
      }
      const groups = Array.isArray(data?.groups)
        ? data.groups
            .filter(
              (entry): entry is {
                remoteId: string;
                name: string;
                participantsCount: number;
                announceOnly?: boolean;
                instanceIsAdmin?: boolean;
                mentionable?: boolean;
              } =>
                Boolean(entry && typeof entry.remoteId === "string" && entry.remoteId.trim()),
            )
            .map((entry) => ({
              remoteId: entry.remoteId.trim(),
              name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : entry.remoteId.trim(),
              participantsCount:
                typeof entry.participantsCount === "number" && Number.isFinite(entry.participantsCount)
                  ? Math.max(0, Math.floor(entry.participantsCount))
                  : 0,
              announceOnly: entry.announceOnly === true,
              instanceIsAdmin: entry.instanceIsAdmin === true,
              mentionable: entry.mentionable !== false,
            }))
        : [];
      setInstanceGroupsById((current) => ({ ...current, [instanceIdValue]: groups }));
    } catch (error) {
      setInstanceGroupsError((current) => ({
        ...current,
        [instanceIdValue]: error instanceof Error ? error.message : "Falha ao carregar grupos da instância.",
      }));
      setInstanceGroupsById((current) => ({ ...current, [instanceIdValue]: [] }));
    } finally {
      setInstanceGroupsLoading((current) => ({ ...current, [instanceIdValue]: false }));
    }
  }, [instanceGroupsById, instanceGroupsError, instanceGroupsLoading]);

  const loadInstanceContacts = useCallback(async (instanceIdValue: number) => {
    if (!Number.isFinite(instanceIdValue) || instanceIdValue <= 0) {
      return;
    }
    if (instanceContactsLoading[instanceIdValue]) {
      return;
    }
    if (Array.isArray(instanceContactsById[instanceIdValue]) && !instanceContactsError[instanceIdValue]) {
      return;
    }

    setInstanceContactsLoading((current) => ({ ...current, [instanceIdValue]: true }));
    setInstanceContactsError((current) => ({ ...current, [instanceIdValue]: null }));
    try {
      const response = await fetch(`/api/bot-instances/${instanceIdValue}/contacts`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as
        | {
            contacts?: Array<{
              jid?: string;
              phone?: string;
              name?: string;
              shortName?: string | null;
              pushName?: string | null;
            }>;
            message?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível carregar contatos da instância.");
      }
      const contacts = Array.isArray(data?.contacts)
        ? data.contacts
            .filter(
              (entry): entry is {
                jid: string;
                phone: string;
                name: string;
                shortName?: string | null;
                pushName?: string | null;
              } =>
                Boolean(entry && typeof entry.jid === "string" && entry.jid.trim()),
            )
            .map((entry) => ({
              jid: entry.jid.trim(),
              phone: typeof entry.phone === "string" ? entry.phone.trim() : "",
              name:
                typeof entry.name === "string" && entry.name.trim()
                  ? entry.name.trim()
                  : typeof entry.phone === "string" && entry.phone.trim()
                    ? entry.phone.trim()
                    : entry.jid.trim(),
              shortName: typeof entry.shortName === "string" ? entry.shortName.trim() : null,
              pushName: typeof entry.pushName === "string" ? entry.pushName.trim() : null,
            }))
        : [];
      setInstanceContactsById((current) => ({ ...current, [instanceIdValue]: contacts }));
    } catch (error) {
      setInstanceContactsError((current) => ({
        ...current,
        [instanceIdValue]: error instanceof Error ? error.message : "Falha ao carregar contatos da instância.",
      }));
      setInstanceContactsById((current) => ({ ...current, [instanceIdValue]: [] }));
    } finally {
      setInstanceContactsLoading((current) => ({ ...current, [instanceIdValue]: false }));
    }
  }, [instanceContactsById, instanceContactsError, instanceContactsLoading]);

  useEffect(() => {
    const parsed = Number(instanceId);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    void refreshFeed({ instanceIdOverride: parsed });
  }, [instanceId, refreshFeed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRealtime = (event: Event) => {
      const detail = (event as CustomEvent<{
        eventType?: string;
        type?: string;
        instanceId?: number;
      }>).detail;
      const eventType = detail?.eventType ?? detail?.type;
      if (eventType !== "status.update") return;
      const parsed = Number(instanceId);
      const eventInstanceId = Number(detail?.instanceId ?? 0);
      if (Number.isFinite(parsed) && parsed > 0 && eventInstanceId > 0 && eventInstanceId !== parsed) {
        return;
      }
      void refreshFeed({ silent: true });
    };
    window.addEventListener("botadmin:whatsapp-conversation-realtime", handleRealtime);
    return () => {
      window.removeEventListener("botadmin:whatsapp-conversation-realtime", handleRealtime);
    };
  }, [instanceId, refreshFeed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STATUS_INSTANCE_PROFILE_CACHE_KEY);
      if (!raw) {
        setProfileCacheLoaded(true);
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, BotInstanceProfile>;
      if (!parsed || typeof parsed !== "object") {
        setProfileCacheLoaded(true);
        return;
      }
      const next: Record<number, BotInstanceProfile> = {};
      for (const [key, profile] of Object.entries(parsed)) {
        const id = Number(key);
        if (!Number.isFinite(id)) continue;
        if (!profile || typeof profile !== "object") continue;
        next[id] = profile;
      }
      if (Object.keys(next).length > 0) {
        setInstanceProfiles((current) => ({ ...next, ...current }));
      }
    } catch {
      // Cache inválido, segue fluxo normal.
    } finally {
      setProfileCacheLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!profileCacheLoaded) return;
    const allowedIds = new Set(instances.map((instance) => instance.id));
    const serializable: Record<string, BotInstanceProfile> = {};
    for (const [instanceId, profile] of Object.entries(instanceProfiles)) {
      const parsedId = Number(instanceId);
      if (!Number.isFinite(parsedId)) continue;
      if (!allowedIds.has(parsedId)) continue;
      serializable[String(parsedId)] = profile;
    }
    try {
      window.localStorage.setItem(STATUS_INSTANCE_PROFILE_CACHE_KEY, JSON.stringify(serializable));
    } catch {
      // Ignore cache write errors.
    }
  }, [instanceProfiles, instances, profileCacheLoaded]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!attachPost || attachMode !== "existing") return;
    if (attachCampaignId) return;
    const first = attachableCampaigns[0];
    if (first) setAttachCampaignId(first.id);
  }, [attachPost, attachMode, attachCampaignId, attachableCampaigns]);

  useEffect(() => {
    if (instances.length === 0) {
      setInstanceId("");
      return;
    }
    const preferred = preferredInstanceId != null && instances.some((instance) => instance.id === preferredInstanceId)
      ? String(preferredInstanceId)
      : null;
    if (preferred) {
      setInstanceId((current) => (current === preferred ? current : preferred));
      return;
    }
    setInstanceId((current) => {
      if (current && instances.some((instance) => String(instance.id) === current)) {
        return current;
      }
      return String(instances[0].id);
    });
  }, [instances, preferredInstanceId]);

  useEffect(() => {
    if (!selectedInstance) return;
    void loadInstanceProfile(selectedInstance.id);
  }, [loadInstanceProfile, selectedInstance]);

  useEffect(() => {
    if (!mentionPicker.open || !mentionPicker.instanceId) return;
    if (mentionPicker.mode === "people") {
      void loadInstanceContacts(mentionPicker.instanceId);
      return;
    }
    if (mentionPicker.mode === "groups") {
      void loadInstanceGroups(mentionPicker.instanceId);
    }
  }, [loadInstanceContacts, loadInstanceGroups, mentionPicker.instanceId, mentionPicker.mode, mentionPicker.open]);


  useEffect(() => {
    if (!onPreferredInstanceChange) return;
    if (!instanceId) {
      onPreferredInstanceChange(null);
      return;
    }
    const parsed = Number(instanceId);
    if (!Number.isFinite(parsed) || !instances.some((instance) => instance.id === parsed)) {
      return;
    }
    onPreferredInstanceChange(parsed);
  }, [instanceId, instances, onPreferredInstanceChange]);

  useEffect(() => {
    if (!composerOpen && !campaignDetailOpen) return;
    setCreateModePickerOpen(false);
  }, [campaignDetailOpen, composerOpen]);

  useEffect(() => {
    return () => {
      feedAbortRef.current?.abort();
    };
  }, []);

  const resetComposer = useCallback(
    (mode: ComposerMode, initialType: ComposerItem["type"] = "text") => {
      setEditingPostId(null);
      setComposerMode(mode);
      setCampaignName("");
      setScheduleKind("recurring");
      setEveryMinutes("1440");
      setTimes("08:00, 14:00, 20:00");
      setTimezone("America/Sao_Paulo");
      setContentRandomizerEnabled(true);
      setContentRandomizerCount("1");
      setScheduleRandomizerEnabled(false);
      setScheduleRandomizerJitter("90");
      setScheduleReshuffleDaily(false);
      setScheduleWindowStartHour("7");
      setScheduleWindowEndHour("22");
      setComposerItems([createEmptyComposerItem(initialType)]);
      setComposerLinks({});
      composerLinksRef.current = {};
      setComposerUploads({});
    },
    [],
  );

  const openManualComposer = useCallback((initialType: ComposerItem["type"] = "text") => {
    resetComposer("manual", initialType);
    setCampaignDetailOpen(false);
    setCampaignDetail(null);
    setCampaignDetailError(null);
    setComposerOpen(true);
  }, [resetComposer]);

  const openScheduledComposer = useCallback((initialType: ComposerItem["type"] = "text") => {
    resetComposer("scheduled", initialType);
    setCampaignDetailOpen(false);
    setCampaignDetail(null);
    setCampaignDetailError(null);
    setComposerOpen(true);
  }, [resetComposer]);

  const openCreateModePicker = useCallback(() => {
    setCreateModePickerOpen(true);
  }, []);

  const closeCreateModePicker = useCallback(() => {
    setCreateModePickerOpen(false);
  }, []);

  const chooseCreateMode = useCallback((
    mode: "manual" | "scheduled",
    initialType: ComposerItem["type"],
  ) => {
    setCreateModePickerOpen(false);
    if (mode === "scheduled") {
      openScheduledComposer(initialType);
      return;
    }
    openManualComposer(initialType);
  }, [openManualComposer, openScheduledComposer]);

  const closeEditorPane = useCallback(() => {
    setComposerOpen(false);
    setCampaignDetailOpen(false);
    setCampaignDetail(null);
    setCampaignDetailError(null);
    setEditingPostId(null);
  }, []);

  const handlePrimaryInstanceChange = useCallback(
    (nextValue: string) => {
      if (!nextValue || nextValue === instanceId) {
        return;
      }
      closeEditorPane();
      setAttachPost(null);
      setPreviewStatus(null);
      setCreateModePickerOpen(false);
      setMentionPicker({
        open: false,
        target: null,
        targetId: null,
        instanceId: null,
        mode: "choice",
        selectedMentions: [],
        search: "",
      });
      setSearch("");
      setMessage(null);
      setFeed({ posts: [], receivedStatuses: [], campaigns: [] });
      setLoading(true);
      setInstanceId(nextValue);
    },
    [closeEditorPane, instanceId],
  );

  const openEditComposer = useCallback((post: StatusPost) => {
    const content = post.content;
    if (!content) {
      setMessage({ ok: false, text: "Este status não tem conteúdo para editar." });
      return;
    }
    if (content.type === "document") {
      setMessage({ ok: false, text: "Status com documento não pode ser editado neste fluxo." });
      return;
    }
    setEditingPostId(post.id);
    setComposerMode("manual");
    setCampaignName("");
    setInstanceId(String(post.instanceId));
    setScheduleKind("recurring");
    setEveryMinutes("1440");
    setTimes("08:00, 14:00, 20:00");
    setTimezone("America/Sao_Paulo");
    setContentRandomizerEnabled(false);
    setContentRandomizerCount("1");
    setScheduleRandomizerEnabled(false);
    setScheduleRandomizerJitter("90");
    setScheduleReshuffleDaily(false);
    setScheduleWindowStartHour("7");
    setScheduleWindowEndHour("22");
    setComposerItems([mapPostContentToComposerItem(post)]);
    setComposerLinks({});
    composerLinksRef.current = {};
    setComposerUploads({});
    setCampaignDetailOpen(false);
    setCampaignDetail(null);
    setCampaignDetailError(null);
    setComposerOpen(true);
  }, []);

  const openAttachComposer = useCallback((post: StatusPost) => {
    setAttachMode("existing");
    setAttachCampaignId("");
    setAttachPost(post);
  }, []);

  const openCampaignDetail = useCallback(async (campaignId: string) => {
    setComposerOpen(false);
    if (campaignDetailOpen && campaignDetail?.id === campaignId && !campaignDetailLoading) {
      setCampaignDetailOpen(false);
      setCampaignDetail(null);
      setCampaignDetailError(null);
      return;
    }

    setCampaignDetailOpen(true);
    setCampaignDetailLoading(true);
    setCampaignDetailError(null);
    setCampaignDetail(null);
    try {
      const response = await fetch(`/api/bot-ad-campaigns/${campaignId}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((data as { message?: string } | null)?.message ?? "Não foi possível carregar a programação.");
      }
      const normalized = normalizeCampaignDetail(data);
      if (!normalized) {
        throw new Error("A programação não possui status editáveis.");
      }
      setCampaignDetail(normalized);
    } catch (error) {
      setCampaignDetailError(
        error instanceof Error ? error.message : "Não foi possível carregar os detalhes da programação.",
      );
    } finally {
      setCampaignDetailLoading(false);
    }
  }, [campaignDetail?.id, campaignDetailLoading, campaignDetailOpen]);

  const moveCampaignContent = useCallback((contentId: string, direction: "up" | "down") => {
    setCampaignDetail((current) => {
      if (!current) return current;
      const index = current.contents.findIndex((entry) => entry.id === contentId);
      if (index < 0) return current;
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= current.contents.length) return current;
      const nextContents = current.contents.slice();
      const [item] = nextContents.splice(index, 1);
      nextContents.splice(swapIndex, 0, item);
      return { ...current, contents: nextContents };
    });
  }, []);

  const removeCampaignContent = useCallback((contentId: string) => {
    setCampaignDetail((current) => {
      if (!current) return current;
      const nextContents = current.contents.filter((entry) => entry.id !== contentId);
      if (nextContents.length === current.contents.length) return current;
      return { ...current, contents: nextContents };
    });
  }, []);

  const updateCampaignContent = useCallback((contentId: string, patch: Partial<CampaignDetail["contents"][number]>) => {
    setCampaignDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        contents: current.contents.map((entry) => (entry.id === contentId ? { ...entry, ...patch } : entry)),
      };
    });
  }, []);

  const addCampaignContent = useCallback((statusType: CampaignDetail["contents"][number]["statusType"]) => {
    setCampaignDetail((current) => {
      if (!current) return current;
      if (current.contents.length >= 24) {
        return current;
      }
      const nextContent: CampaignDetail["contents"][number] =
        statusType === "text"
          ? {
              id: uid(),
              type: "status",
              statusType: "text",
              text: "",
              caption: "",
              media: null,
              config: { mentions: [], allowReshare: true },
            }
          : {
              id: uid(),
              type: "status",
              statusType,
              text: "",
              caption: "",
              media: { url: null },
              config: { mentions: [], allowReshare: true },
            };
      return {
        ...current,
        contents: [...current.contents, nextContent],
      };
    });
  }, []);

  const saveCampaignDetail = useCallback(async () => {
    if (!campaignDetail) return;
    if (campaignDetail.contents.length === 0) {
      setCampaignDetailError("Adicione ao menos um status dentro da programação.");
      return;
    }
    setCampaignDetailSaving(true);
    setCampaignDetailError(null);
    try {
      const payload = {
        name: campaignDetail.name,
        schedule: campaignDetail.schedule,
        options: campaignDetail.options ?? null,
        contents: campaignDetail.contents,
      };
      const response = await fetch(`/api/bot-ad-campaigns/${campaignDetail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((data as { message?: string } | null)?.message ?? "Não foi possível salvar a programação.");
      }
      setMessage({ ok: true, text: "Programação atualizada com sucesso." });
      await refreshFeed({ silent: true });
    } catch (error) {
      setCampaignDetailError(
        error instanceof Error ? error.message : "Não foi possível salvar a programação.",
      );
    } finally {
      setCampaignDetailSaving(false);
    }
  }, [campaignDetail, refreshFeed]);
  const toggleBroadcastRecipient = useCallback((_contact: DiscoverableStatusContact) => undefined, []);
  const addManualBroadcastRecipient = useCallback(() => undefined, []);
  const sendBroadcast = useCallback(async () => undefined, []);


  const addComposerItem = useCallback((type: ComposerItem["type"]) => {
    setComposerItems((current) => {
      if (current.length >= MAX_COMPOSER_ITEMS) {
        return current;
      }
      return [...current, createEmptyComposerItem(type)];
    });
  }, []);

  const removeComposerItem = useCallback((itemId: string) => {
    setComposerItems((current) => {
      const next = current.filter((item) => item.id !== itemId);
      return next.length > 0 ? next : [createEmptyComposerItem("text")];
    });
    clearComposerLinkState(itemId);
    clearComposerUploadState(itemId);
  }, [clearComposerLinkState, clearComposerUploadState]);

  const resolveMediaLinkForItem = useCallback(async (itemId: string, rawUrl: string) => {
    const trimmed = rawUrl.trim();
    const provider = detectMediaLinkProvider(trimmed);
    if (!trimmed || !provider) {
      clearComposerLinkState(itemId);
      return;
    }

    const previous = composerLinksRef.current[itemId];
    if (previous?.processing) {
      return;
    }
    if (previous?.lastUrl === trimmed && previous?.provider === provider && !previous?.error) {
      return;
    }

    setComposerLinkState(itemId, (state) => ({
      ...state,
      provider,
      processing: true,
      error: null,
      message: null,
      lastUrl: trimmed,
    }));

    try {
      const response = await fetch(`/api/bot-status/resolve-link?url=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            message?: string;
            result?: {
              provider?: LinkProvider;
              mediaType?: "image" | "video";
              url?: string;
              mimeType?: string;
              title?: string | null;
              caption?: string | null;
              thumbnail?: string | null;
              fileName?: string | null;
            };
          }
        | null;

      if (!response.ok || !data?.success || !data.result?.url) {
        throw new Error(data?.message || "Não foi possível resolver o link informado.");
      }

      const resolved = data.result;
      const resolvedType = resolved.mediaType === "video" ? "video" : "image";
      setComposerItems((current) =>
        current.map((item) => {
          if (item.id !== itemId) {
            return item;
          }
          const nextCaption = item.caption.trim() ? item.caption : resolved.caption || "";
          return {
            ...item,
            type: resolvedType,
            mediaUrl: resolved.url || item.mediaUrl,
            mediaPath: "",
            mediaMimeType: resolved.mimeType || "",
            mediaFileName: resolved.fileName || "",
            caption: nextCaption,
          };
        }),
      );

      clearComposerUploadState(itemId);
      setComposerLinkState(itemId, (state) => ({
        ...state,
        provider: (resolved.provider as LinkProvider | undefined) ?? provider,
        processing: false,
        message: `Link de ${((resolved.provider as string) || provider).toUpperCase()} resolvido com sucesso.`,
        error: null,
        previewUrl: resolved.url,
        thumbnail: resolved.thumbnail || null,
        title: resolved.title || null,
        lastUrl: trimmed,
      }));
    } catch (error) {
      setComposerLinkState(itemId, (state) => ({
        ...state,
        provider,
        processing: false,
        message: null,
        error: error instanceof Error ? error.message : "Falha ao resolver o link da mídia.",
        previewUrl: null,
        thumbnail: null,
        title: null,
        lastUrl: trimmed,
      }));
    }
  }, [clearComposerLinkState, clearComposerUploadState, setComposerLinkState]);

  const handleMediaUrlBlur = useCallback((itemId: string, rawValue: string) => {
    const trimmed = rawValue.trim();
    const provider = detectMediaLinkProvider(trimmed);
    if (!trimmed || !provider) {
      return;
    }
    void resolveMediaLinkForItem(itemId, trimmed);
  }, [resolveMediaLinkForItem]);

  const handleMediaUrlChange = useCallback((itemId: string, rawValue: string) => {
    updateComposerItem(itemId, {
      mediaUrl: rawValue,
      mediaPath: "",
      mediaMimeType: "",
      mediaFileName: "",
    });
    const trimmed = rawValue.trim();
    if (!trimmed || !detectMediaLinkProvider(trimmed)) {
      clearComposerLinkState(itemId);
    }
    clearComposerUploadState(itemId);
  }, [clearComposerLinkState, clearComposerUploadState, updateComposerItem]);

  const handleUploadItemMedia = useCallback(async (
    itemId: string,
    file: File | null,
    targetOverride?: Pick<ComposerItem, "type" | "mediaPath">,
  ) => {
    if (!file) {
      return;
    }
    const target = targetOverride ?? composerItems.find((item) => item.id === itemId) ?? null;
    if (!target || target.type === "text") {
      return;
    }

    setComposerUploads((prev) => ({
      ...prev,
      [itemId]: { uploading: true, error: null, message: null },
    }));

    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("mediaType", target.type);
      if (target.mediaPath) {
        formData.set("previousPath", target.mediaPath);
      }

      const response = await fetch("/api/bot-ad-campaigns/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => null)) as
        | {
            message?: string;
            media?: {
              path?: string;
              url?: string;
              fileName?: string;
              mimeType?: string | null;
            };
          }
        | null;

      if (!response.ok || !data?.media?.path) {
        throw new Error(data?.message || "Não foi possível enviar o arquivo da mídia.");
      }

      setComposerItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                mediaPath: data.media?.path || "",
                mediaUrl: data.media?.url || item.mediaUrl,
                mediaFileName: data.media?.fileName || file.name || "",
                mediaMimeType: data.media?.mimeType || file.type || "",
              }
            : item,
        ),
      );

      setComposerUploads((prev) => ({
        ...prev,
        [itemId]: { uploading: false, error: null, message: "Arquivo enviado com sucesso." },
      }));
      clearComposerLinkState(itemId);
    } catch (error) {
      setComposerUploads((prev) => ({
        ...prev,
        [itemId]: {
          uploading: false,
          message: null,
          error: error instanceof Error ? error.message : "Falha ao enviar arquivo.",
        },
      }));
    }
  }, [clearComposerLinkState, composerItems]);

  const handleUploadMultipleMedia = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const hasOnlyEmptyStarter =
      composerItems.length === 1 &&
      composerItems[0].type === "text" &&
      !composerItems[0].text.trim();
    const retainedCount = hasOnlyEmptyStarter ? 0 : composerItems.length;
    const availableSlots = Math.max(0, MAX_COMPOSER_ITEMS - retainedCount);
    const files = Array.from(fileList)
      .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
      .slice(0, availableSlots);
    if (files.length === 0) {
      setMessage({ ok: false, text: `O limite é de ${MAX_COMPOSER_ITEMS} mídias por programação.` });
      return;
    }

    const pendingItems = files.map((file) => ({
      item: createEmptyComposerItem(file.type.startsWith("video/") ? "video" : "image"),
      file,
    }));
    setComposerItems((current) => {
      const onlyEmptyStarter =
        current.length === 1 && current[0].type === "text" && !current[0].text.trim();
      const base = onlyEmptyStarter ? [] : current;
      return [...base, ...pendingItems.map((entry) => entry.item)].slice(0, MAX_COMPOSER_ITEMS);
    });

    // Three parallel uploads keep bulk selection fast without flooding the server.
    for (let index = 0; index < pendingItems.length; index += 3) {
      const batch = pendingItems.slice(index, index + 3);
      await Promise.allSettled(
        batch.map(({ item, file }) =>
          handleUploadItemMedia(item.id, file, { type: item.type, mediaPath: "" }),
        ),
      );
    }
    if (files.length < fileList.length) {
      setMessage({
        ok: false,
        text: `${files.length} mídias foram adicionadas; arquivos não suportados ou acima do limite foram ignorados.`,
      });
    }
  }, [composerItems, handleUploadItemMedia]);

  const clearUploadedMediaForItem = useCallback((itemId: string) => {
    setComposerItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              mediaPath: "",
              mediaFileName: "",
              mediaMimeType: "",
            }
          : item,
      ),
    );
    clearComposerUploadState(itemId);
  }, [clearComposerUploadState]);

  const buildSchedulePayload = useCallback(() => {
    if (composerMode === "manual") {
      return { kind: "manual" as const };
    }
    if (scheduleKind === "window") {
      const atTimes = normalizeTimesInput(times);
      if (atTimes.length === 0) {
        throw new Error("Informe ao menos um horário válido no formato HH:MM.");
      }
      return {
        kind: "window" as const,
        atTimes,
        timezone: timezone.trim() || "America/Sao_Paulo",
      };
    }
    return {
      kind: "recurring" as const,
      everyMinutes: Math.max(5, Number(everyMinutes) || 1440),
      timezone: timezone.trim() || "America/Sao_Paulo",
    };
  }, [composerMode, everyMinutes, scheduleKind, times, timezone]);

  const buildContentsPayload = useCallback(() => {
    const normalized: Array<Record<string, unknown>> = [];

    for (const item of composerItems) {
      const statusConfig = buildStatusConfigFromComposer(item);
      if (item.type === "text") {
        const body = item.text.trim();
        if (!body) {
          throw new Error("Preencha o texto de todos os status de texto.");
        }
        normalized.push({
          id: uid(),
          type: "status",
          statusType: "text",
          text: body,
          config: statusConfig,
        });
        continue;
      }

      const mediaUrl = item.mediaUrl.trim();
      const mediaPath = item.mediaPath.trim();
      if (!mediaUrl && !mediaPath) {
        throw new Error("Informe um link de mídia ou faça upload para todos os status de imagem/vídeo.");
      }

      const mediaPayload: Record<string, unknown> = {};
      if (mediaUrl) {
        mediaPayload.url = mediaUrl;
      }
      if (mediaPath) {
        mediaPayload.path = mediaPath;
      }
      if (item.mediaMimeType.trim()) {
        mediaPayload.mimeType = item.mediaMimeType.trim();
      }
      if (item.mediaFileName.trim()) {
        mediaPayload.fileName = item.mediaFileName.trim();
      }

      normalized.push({
        id: uid(),
        type: "status",
        statusType: item.type,
        caption: item.caption.trim() || null,
        media: mediaPayload,
        config: statusConfig,
      });
    }

    if (normalized.length === 0) {
      throw new Error("Adicione ao menos um status para enviar.");
    }

    return normalized;
  }, [composerItems]);

  const triggerManualRun = useCallback(async (campaignId: string) => {
    let lastMessage = "Status criado, mas o envio manual falhou.";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const runResponse = await fetch(`/api/bot-ad-campaigns/${campaignId}/run-now`, {
        method: "POST",
      });
      const runData = (await runResponse.json().catch(() => ({}))) as { message?: string };
      if (runResponse.ok) {
        return;
      }
      lastMessage = runData?.message || lastMessage;
      if (runResponse.status === 404 && attempt === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 280));
        continue;
      }
      throw new Error(lastMessage);
    }
    throw new Error(lastMessage);
  }, []);

  const insertOptimisticPosts = useCallback(
    (campaignId: string, instance: BotInstance, items: ComposerItem[]) => {
      const createdAt = new Date().toISOString();
      const optimisticPosts = items
        .map((item, index) => {
          const content = mapComposerItemToOptimisticContent(item);
          if (!content) return null;
          if (content.type === "text" && !content.text.trim()) return null;
          if ((content.type === "image" || content.type === "video") && !content.mediaUrl.trim()) return null;
          return {
            id: `pending-${campaignId}-${index}-${Date.now()}`,
            campaignId,
            campaignName: "Status manual",
            campaignScheduleKind: "manual",
            instanceId: instance.id,
            instanceName: instance.name,
            messageId: null,
            createdAt,
            deleteAt: null,
            errorMessage: null,
            content,
            isPending: true,
          } satisfies StatusPost;
        })
        .filter(Boolean) as StatusPost[];

      if (optimisticPosts.length === 0) return;
      setFeed((current) => ({
        posts: [...optimisticPosts, ...current.posts].slice(0, 160),
        receivedStatuses: current.receivedStatuses ?? [],
        campaigns: current.campaigns,
      }));
    },
    [],
  );

  const waitForCampaignPosts = useCallback(
    async (campaignId: string) => {
      for (let attempt = 0; attempt < 7; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 450 : 800));
        const snapshot = await refreshFeed({ silent: true });
        if (snapshot?.posts.some((post) => post.campaignId === campaignId && !post.isPending)) {
          return;
        }
      }
    },
    [refreshFeed],
  );

  const handleCreateStatus = async () => {
    if (!selectedInstance) {
      setMessage({ ok: false, text: "Selecione uma instância conectada." });
      return;
    }

    setBusyId("create-status");
    setMessage(null);
    try {
      const schedule = buildSchedulePayload();
      const contents = buildContentsPayload();
      const statusName =
        composerMode === "scheduled"
          ? campaignName.trim() || `Status programado ${new Date().toLocaleString("pt-BR")}`
          : `status-manual-${selectedInstance.id}-${Date.now()}`;
      const body: Record<string, unknown> = {
        name: statusName,
        description: composerMode === "manual" ? "Envio manual de status." : "Envio programado de status.",
        schedule,
        contents,
        targets: [
          {
            id: uid(),
            type: "status",
            instanceId: selectedInstance.id,
          },
        ],
      };

      if (composerMode === "scheduled") {
        const options: Record<string, unknown> = {};
        const randomizerCount = clampNumber(Number(contentRandomizerCount) || 1, 1, Math.max(1, contents.length));
        options.statusRandomizer = {
          enabled: contentRandomizerEnabled && contents.length > 1,
          perRunCount:
            contentRandomizerEnabled && contents.length > 1 && scheduleKind !== "window"
              ? randomizerCount
              : null,
          perDayCount:
            contentRandomizerEnabled && contents.length > 1 && scheduleKind === "window"
              ? randomizerCount
              : null,
        };
        const jitterMinutes = clampNumber(Number(scheduleRandomizerJitter) || 30, 1, 720);
        options.scheduleRandomizer = {
          enabled: scheduleRandomizerEnabled || scheduleReshuffleDaily,
          jitterMinutes: scheduleRandomizerEnabled ? jitterMinutes : null,
          reshuffleDaily: scheduleReshuffleDaily,
          windowStartHour: clampNumber(Number(scheduleWindowStartHour) || 7, 0, 23),
          windowEndHour: clampNumber(Number(scheduleWindowEndHour) || 22, 0, 23),
        };
        body.options = options;
      }

      const createResponse = await fetch("/api/bot-ad-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const createData = (await createResponse.json().catch(() => ({}))) as {
        message?: string;
        campaign?: { id?: string };
      };
      if (!createResponse.ok) {
        throw new Error(createData.message ?? "Falha ao criar status.");
      }

      const campaignId = createData?.campaign?.id;
      if (!campaignId) {
        throw new Error("Campanha criada sem identificador. Tente novamente.");
      }

      if (composerMode === "manual") {
        insertOptimisticPosts(campaignId, selectedInstance, composerItems);
        await triggerManualRun(campaignId);
        void waitForCampaignPosts(campaignId);
      }

      setMessage({
        ok: true,
        text:
          composerMode === "manual"
            ? editingPostId
              ? "Status atualizado e reenviado com sucesso."
              : "Status enviado com sucesso."
            : "Status programado com sucesso.",
      });
      setComposerOpen(false);
      setEditingPostId(null);
      resetComposer("manual");
      if (composerMode !== "manual") {
        await refreshFeed();
      }
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível criar o status.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRepostStatus = async (post: StatusPost) => {
    setBusyId(`repost-${post.id}`);
    setMessage(null);
    try {
      const contents = mapPostToStatusContentPayload(post);
      const body: Record<string, unknown> = {
        name: `status-manual-${post.instanceId}-${Date.now()}`,
        description: "Repost manual de status.",
        schedule: { kind: "manual" as const },
        contents,
        targets: [
          {
            id: uid(),
            type: "status",
            instanceId: post.instanceId,
          },
        ],
      };

      const createResponse = await fetch("/api/bot-ad-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const createData = (await createResponse.json().catch(() => ({}))) as {
        message?: string;
        campaign?: { id?: string };
      };
      if (!createResponse.ok) {
        throw new Error(createData.message ?? "Não foi possível preparar o repost.");
      }

      const campaignId = createData?.campaign?.id;
      if (!campaignId) {
        throw new Error("Campanha de repost criada sem identificador.");
      }

      const optimisticSourceItem: ComposerItem = {
        id: uid(),
        type: post.content?.type === "video" ? "video" : post.content?.type === "image" ? "image" : "text",
        text: post.content?.text ?? "",
        caption: post.content?.caption ?? "",
        mediaUrl: post.content?.mediaUrl ?? "",
        mediaPath: "",
        mediaMimeType: "",
        mediaFileName: "",
        ...mapStatusConfigForComposer(post.content?.config ?? null),
      };
      const targetInstance = instances.find((entry) => entry.id === post.instanceId) ?? selectedInstance ?? null;
      if (targetInstance) {
        insertOptimisticPosts(campaignId, targetInstance, [optimisticSourceItem]);
      }

      await triggerManualRun(campaignId);
      void waitForCampaignPosts(campaignId);
      setMessage({ ok: true, text: "Status repostado com sucesso." });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível repostar o status.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeletePost = async (post: StatusPost) => {
    setBusyId(`delete-${post.id}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/bot-status/posts/${post.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível excluir o status.");
      }
      setMessage({ ok: true, text: data.message ?? "Status excluído." });
      await refreshFeed();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Falha ao excluir status.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    setBusyId(`delete-campaign-${campaignId}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/bot-ad-campaigns/${campaignId}`, { method: "DELETE" });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível excluir a campanha.");
      }
      if (campaignDetail?.id === campaignId) {
        setCampaignDetailOpen(false);
        setCampaignDetail(null);
        setCampaignDetailError(null);
      }
      setMessage({ ok: true, text: data?.message ?? "Campanha excluída com sucesso." });
      await refreshFeed();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Falha ao excluir campanha.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleAttachStatus = async () => {
    if (!attachPost) return;
    setBusyId(`attach-${attachPost.id}`);
    setMessage(null);
    try {
      if (attachMode === "existing" && !attachCampaignId) {
        throw new Error("Selecione uma programação ativa.");
      }
      const payload =
        attachMode === "existing"
          ? { campaignId: attachCampaignId || null }
          : {
              create: {
                name: attachNewName || `Status programado ${Date.now()}`,
                instanceId: selectedInstance?.id ?? null,
                scheduleKind: attachNewScheduleKind,
                everyMinutes: Number(attachNewEveryMinutes) || 1440,
                times: attachNewTimes,
                timezone: attachNewTimezone,
              },
            };

      const response = await fetch(`/api/bot-status/posts/${attachPost.id}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível vincular o status.");
      }
      setMessage({ ok: true, text: data.message ?? "Status vinculado com sucesso." });
      setAttachPost(null);
      await refreshFeed();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Erro ao vincular status.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const formatTmdbCaption = useCallback((info: {
    title: string;
    date?: string | null;
    rating?: number | null;
    genres?: string | null;
    overview?: string | null;
  }): string => {
    const lines: string[] = [
      `🎬 ${info.title}`,
      info.date ? `📅 ${info.date}` : null,
      info.rating ? `⭐ ${Number(info.rating).toFixed(1)}/10` : null,
      info.genres ? `🏷️ ${info.genres}` : null,
    ].filter((line): line is string => Boolean(line));

    if (info.overview && info.overview.trim()) {
      lines.push("", info.overview.trim());
    }

    lines.push("", "Fonte: TMDB");
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }, []);

  const openTmdbModal = useCallback((itemId: string) => {
    setTmdbModal({
      open: true,
      itemId,
      query: "",
      loading: false,
      error: null,
      result: null,
    });
  }, []);

  const searchTmdb = useCallback(async () => {
    if (!tmdbModal.itemId || !tmdbModal.query.trim()) {
      setTmdbModal((prev) => ({ ...prev, error: "Informe o nome do filme ou série." }));
      return;
    }
    if (!apiKey) {
      setTmdbModal((prev) => ({
        ...prev,
        error: "Gere sua chave de API REST para usar a busca TMDB.",
      }));
      return;
    }

    setTmdbModal((prev) => ({ ...prev, loading: true, error: null, result: null }));
    try {
      const response = await fetch(`/api/rest/tmdb?q=${encodeURIComponent(tmdbModal.query.trim())}`, {
        headers: { accept: "application/json", "x-api-key": apiKey },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.resultado) {
        throw new Error(data?.mensagem || "Nenhum resultado encontrado.");
      }

      const result = data.resultado;
      const caption = formatTmdbCaption({
        title:
          result.title ||
          result.name ||
          result.original_title ||
          result.original_name ||
          "Título não disponível",
        date: result.release_date || result.first_air_date || null,
        rating: typeof result.vote_average === "number" ? result.vote_average : null,
        genres:
          Array.isArray(result.genres) && result.genres.length > 0
            ? result.genres.map((entry: { name?: string }) => entry?.name).filter(Boolean).join(", ")
            : null,
        overview: result.overview || null,
      });

      setTmdbModal((prev) => ({
        ...prev,
        loading: false,
        error: null,
        result: {
          title:
            result.title ||
            result.name ||
            result.original_title ||
            result.original_name ||
            "Título não disponível",
          overview: result.overview || "Nenhuma descrição disponível.",
          poster: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
          caption,
        },
      }));
    } catch (error) {
      setTmdbModal((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Falha ao consultar TMDB.",
      }));
    }
  }, [apiKey, formatTmdbCaption, tmdbModal.itemId, tmdbModal.query]);

  const applyTmdbToItem = useCallback(() => {
    if (!tmdbModal.itemId || !tmdbModal.result) {
      return;
    }
    const nextText =
      tmdbModal.result.caption ||
      formatTmdbCaption({
        title: tmdbModal.result.title,
        overview: tmdbModal.result.overview,
      });

    setComposerItems((current) =>
      current.map((item) => {
        if (item.id !== tmdbModal.itemId) {
          return item;
        }
        if (item.type === "text") {
          return { ...item, text: nextText };
        }
        return { ...item, caption: nextText };
      }),
    );

    setTmdbModal((prev) => ({ ...prev, open: false }));
  }, [formatTmdbCaption, tmdbModal.itemId, tmdbModal.result]);

  const openMentionPicker = useCallback((params: {
    target: "composer" | "campaign";
    targetId: string;
    instanceId: number | null;
    currentMentions: string[] | null | undefined;
  }) => {
    if (!params.instanceId || !Number.isFinite(params.instanceId) || params.instanceId <= 0) {
      setMessage({ ok: false, text: "Selecione uma instância válida para configurar menções." });
      return;
    }
    setMentionPicker({
      open: true,
      target: params.target,
      targetId: params.targetId,
      instanceId: params.instanceId,
      mode: "choice",
      selectedMentions: normalizeMentionsList(params.currentMentions ?? []),
      search: "",
    });
  }, []);

  const closeMentionPicker = useCallback(() => {
    setMentionPicker({
      open: false,
      target: null,
      targetId: null,
      instanceId: null,
      mode: "choice",
      selectedMentions: [],
      search: "",
    });
  }, []);

  const applyMentionPicker = useCallback(() => {
    if (!mentionPicker.targetId || !mentionPicker.target) {
      closeMentionPicker();
      return;
    }
    const normalizedMentions = normalizeMentionsList(mentionPicker.selectedMentions);
    if (mentionPicker.target === "composer") {
      updateComposerItem(mentionPicker.targetId, {
        mentionsInput: normalizedMentions.join(", "),
      });
      closeMentionPicker();
      return;
    }

    setCampaignDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        contents: current.contents.map((content) => {
          if (content.id !== mentionPicker.targetId) {
            return content;
          }
          return {
            ...content,
            config: {
              ...(content.config ?? {}),
              mentions: normalizedMentions,
            },
          };
        }),
      };
    });
    closeMentionPicker();
  }, [closeMentionPicker, mentionPicker.selectedMentions, mentionPicker.target, mentionPicker.targetId, updateComposerItem]);

  const toggleMentionSelection = useCallback((mentionId: string) => {
    setMentionPicker((current) => {
      const normalized = mentionId.trim();
      if (!normalized) {
        return current;
      }
      const exists = current.selectedMentions.includes(normalized);
      return {
        ...current,
        selectedMentions: exists
          ? current.selectedMentions.filter((entry) => entry !== normalized)
          : [...current.selectedMentions, normalized],
      };
    });
  }, []);

  const getAcceptForItem = (item: ComposerItem) => {
    if (item.type === "video") return "video/*";
    if (item.type === "image") return "image/*";
    return "image/*,video/*";
  };
  const mentionScopeInstanceId = mentionPicker.instanceId;
  const mentionPeopleLoading = Boolean(
    mentionScopeInstanceId && instanceContactsLoading[mentionScopeInstanceId],
  );
  const mentionGroupsLoading = Boolean(
    mentionScopeInstanceId && instanceGroupsLoading[mentionScopeInstanceId],
  );
  const mentionPeopleError = mentionScopeInstanceId
    ? instanceContactsError[mentionScopeInstanceId] ?? null
    : null;
  const mentionGroupsError = mentionScopeInstanceId
    ? instanceGroupsError[mentionScopeInstanceId] ?? null
    : null;
  const mentionPeopleTotal = mentionScopeInstanceId
    ? (instanceContactsById[mentionScopeInstanceId]?.length ?? 0)
    : 0;
  const mentionGroupsTotal = mentionScopeInstanceId
    ? (instanceGroupsById[mentionScopeInstanceId]?.length ?? 0)
    : 0;
  const mentionCurrentLoading =
    mentionPicker.mode === "people"
      ? mentionPeopleLoading
      : mentionPicker.mode === "groups"
        ? mentionGroupsLoading
        : false;
  const mentionCurrentError =
    mentionPicker.mode === "people"
      ? mentionPeopleError
      : mentionPicker.mode === "groups"
        ? mentionGroupsError
        : null;
  const hasEditorContent = composerOpen || campaignDetailOpen;

  return (
    <div className={styles.shell}>
      <div className={`${styles.workspace} ${hasEditorContent ? styles.workspaceEditorActive : ""}`.trim()}>
        <div className={styles.listPane}>
      <section className={styles.instanceCard}>
        <div className={styles.instanceRow}>
          <div className={styles.instanceInfo}>
            <strong>Instância de envio</strong>
            <small>{selectedInstance?.phone || "Selecione uma instância"}</small>
          </div>
          <select value={instanceId} onChange={(event) => handlePrimaryInstanceChange(event.target.value)}>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {message ? (
        <div className={message.ok ? styles.feedbackOk : styles.feedbackError}>{message.text}</div>
      ) : null}

      <section className={styles.card}>
        <h4>Status</h4>
        <button
          type="button"
          className={styles.myStatusRow}
          onClick={openCreateModePicker}
        >
          {selectedInstanceAvatar ? (
            <img src={selectedInstanceAvatar} alt={selectedInstance?.name ?? "Meu status"} className={styles.myStatusAvatarImage} />
          ) : (
            <div className={styles.avatar}>{initials(selectedInstance?.name ?? "Meu status")}</div>
          )}
          <div className={styles.myStatusText}>
            <strong>Meu status</strong>
            <small>Novo status manual ou programado</small>
          </div>
          <span className={styles.addBubble}>
            <IconPlus size={14} />
          </span>
        </button>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <h4>Atualizações recentes</h4>
          <small>{receivedStatuses.length} ativos</small>
        </div>
        {receivedStatuses.length === 0 ? (
          <div className={styles.empty}>Nenhum status recebido nas últimas 24 horas.</div>
        ) : (
          <div className={styles.receivedStatusRail}>
            {receivedStatuses.map((status) => {
              const title = getReceivedStatusTitle(status);
              const preview = getReceivedStatusPreview(status);
              return (
                <button
                  type="button"
                  key={`${status.instanceId}-${status.messageId ?? status.id}`}
                  className={styles.receivedStatusItem}
                  onClick={() => setPreviewStatus(status)}
                  title={`${title} - ${toPtDate(status.timestamp)}`}
                >
                  <span className={styles.receivedStatusRing}>
                    {status.mediaUrl && status.type === "image" ? (
                      <img src={status.mediaUrl} alt={title} />
                    ) : status.mediaUrl && status.type === "video" ? (
                      <video src={status.mediaUrl} preload="metadata" muted playsInline />
                    ) : (
                      <span>{initials(title)}</span>
                    )}
                  </span>
                  <strong>{title}</strong>
                  <small>{toPtTime(status.timestamp) || preview}</small>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <h4>Programados</h4>
          <small>{scheduledCampaigns.length} campanhas</small>
        </div>
        <div className={styles.campaignList}>
          {scheduledCampaigns.length === 0 ? (
            <div className={styles.empty}>Nenhuma programação ativa para esta instância.</div>
          ) : (
            scheduledCampaigns.map((campaign) => {
              const previews = (campaign.statusContents ?? []).slice(0, 3);
              const isOpenDetail = campaignDetailOpen && campaignDetail?.id === campaign.id;
              return (
                <article key={campaign.id} className={styles.campaignRow}>
                  <button
                    type="button"
                    className={styles.campaignRowMain}
                    onClick={() => void openCampaignDetail(campaign.id)}
                  >
                    <div className={styles.campaignPreviewStack}>
                      {previews.length > 0 ? (
                        previews.map((content, index) => (
                          <span
                            key={content.id}
                            className={`${styles.campaignPreviewBubble} ${
                              index === 0
                                ? styles.campaignPreviewBubbleA
                                : index === 1
                                  ? styles.campaignPreviewBubbleB
                                  : styles.campaignPreviewBubbleC
                            }`}
                          >
                            {content.statusType === "image" && content.mediaUrl ? (
                              <img src={content.mediaUrl} alt="Prévia do status" />
                            ) : content.statusType === "video" && content.mediaUrl ? (
                              <video src={content.mediaUrl} muted playsInline preload="metadata" aria-label="Prévia em vídeo do status" />
                            ) : (
                              <span>{getStatusBubbleBadge(content.statusType)}</span>
                            )}
                          </span>
                        ))
                      ) : (
                        <span className={`${styles.campaignPreviewBubble} ${styles.campaignPreviewBubbleA}`}>
                          <span>+</span>
                        </span>
                      )}
                    </div>
                    <div className={styles.campaignBody}>
                      <strong>{campaign.name}</strong>
                      <small>
                        {scheduleKindLabel(campaign.scheduleKind)} - {campaign.contentCount ?? campaign.statusContents?.length ?? 0} status
                      </small>
                      <small>{campaign.nextRunAt ? `Próximo envio: ${toPtDate(campaign.nextRunAt)}` : "Sem próximo envio definido"}</small>
                    </div>
                    <span className={styles.inlineHint}>{isOpenDetail ? "Fechar detalhes" : "Abrir detalhes"}</span>
                  </button>
                  <div className={styles.campaignRowActions}>
                    <button
                      type="button"
                      className={styles.inlineIconBtn}
                      onClick={() => void openCampaignDetail(campaign.id)}
                    >
                      <IconPencil size={14} />
                      Editar
                    </button>
                    <button
                      type="button"
                      className={styles.dangerBtn}
                      onClick={() => void handleDeleteCampaign(campaign.id)}
                      disabled={busyId === `delete-campaign-${campaign.id}`}
                    >
                      {busyId === `delete-campaign-${campaign.id}` ? (
                        <IconLoader2 size={14} className={styles.spin} />
                      ) : (
                        <IconTrash size={14} />
                      )}
                      Excluir
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <h4>Recentes</h4>
          <small>{loading ? "Atualizando..." : `${filteredPosts.length} status`}</small>
        </div>
        <label className={styles.searchField}>
          <IconSearch size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar status por nome ou conteúdo"
          />
        </label>
        <div className={styles.postList}>
          {filteredPosts.length === 0 ? (
            <div className={styles.empty}>Nenhum status enviado ainda.</div>
          ) : (
              filteredPosts.map((post) => (
                <article key={post.id} className={styles.postCard}>
                  <div className={styles.postAvatar}>
                    {post.content?.type === "image" && post.content.mediaUrl ? (
                      <img src={post.content.mediaUrl} alt="Prévia do status" className={styles.postAvatarMedia} />
                    ) : post.content?.type === "video" ? (
                      <span>VID</span>
                    ) : post.content?.type === "document" ? (
                      <span>DOC</span>
                    ) : (
                      <span>{post.content?.text?.trim().slice(0, 2).toUpperCase() || initials(post.instanceName)}</span>
                    )}
                    {post.isPending ? <span className={styles.pendingDot} /> : null}
                  </div>
                <div className={styles.postBody}>
                  <div className={styles.postHead}>
                    <strong>{getStatusPostTitle(post)}</strong>
                    <time>{toPtDate(post.createdAt)}</time>
                  </div>
                  {post.isPending ? <small className={styles.pendingText}>Enviando para o WhatsApp...</small> : null}
                  <small>{post.instanceName}</small>
                  {post.content ? (
                    <p className={styles.preview}>
                      {post.content.type === "text"
                        ? post.content.text || "(status textual)"
                        : `${post.content.type.toUpperCase()} · ${post.content.caption || "mídia"}`}
                    </p>
                  ) : (
                    <p className={styles.preview}>Conteúdo não localizado.</p>
                  )}
                  {post.content?.mediaUrl ? (
                    <div className={styles.mediaThumbWrap}>
                      {post.content.type === "video" ? (
                        <video
                          src={post.content.mediaUrl}
                          className={styles.mediaThumbVideo}
                          preload="metadata"
                          muted
                          playsInline
                        />
                      ) : post.content.type === "image" ? (
                        <img src={post.content.mediaUrl} alt="Prévia do status" className={styles.mediaThumb} />
                      ) : (
                        <div className={styles.fileHint}>Documento disponível</div>
                      )}
                    </div>
                  ) : null}
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      onClick={() => void handleRepostStatus(post)}
                      disabled={busyId === `repost-${post.id}`}
                    >
                      {busyId === `repost-${post.id}` ? <IconLoader2 size={14} className={styles.spin} /> : <IconRefresh size={14} />}
                      Repostar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeletePost(post)}
                      disabled={busyId === `delete-${post.id}`}
                    >
                      {busyId === `delete-${post.id}` ? <IconLoader2 size={14} className={styles.spin} /> : <IconTrash size={14} />}
                      Excluir
                    </button>
                    <button type="button" onClick={() => openEditComposer(post)}>
                      <IconPencil size={14} />
                      Editar
                    </button>
                    <button type="button" onClick={() => openAttachComposer(post)}>
                      <IconCalendarTime size={14} />
                      Mover para programado
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

        </div>

        <aside className={`${styles.editorPane} ${!hasEditorContent ? styles.editorPaneIdle : ""}`.trim()}>
          {hasEditorContent ? (
            <div className={styles.editorMobileHeader}>
              <button
                type="button"
                className={styles.editorMobileBack}
                onClick={closeEditorPane}
                aria-label="Voltar para lista de status"
              >
                <IconArrowLeft size={18} />
              </button>
              <div className={styles.editorMobileTitle}>
                <strong>Status do WhatsApp</strong>
                <small>{composerOpen ? "Criar/editar status" : "Editar campanha programada"}</small>
              </div>
            </div>
          ) : null}

          {composerOpen ? (
            <div className={`${styles.modalCard} ${styles.editorCard} ${styles.editorDockCard}`} role="region" aria-label="Editor de status">
            <h4>
              {composerMode === "manual"
                ? editingPostId
                  ? "Editar status manual"
                  : "Novo status manual"
                : "Novo status programado"}
            </h4>

            <label>
              Instância
              <select value={instanceId} onChange={(event) => setInstanceId(event.target.value)}>
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name}
                  </option>
                ))}
              </select>
            </label>

            {composerMode === "scheduled" ? (
              <label>
                Nome da programação
                <input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  placeholder="Ex.: Status da semana"
                />
              </label>
            ) : null}

            {composerMode === "scheduled" ? (
              <>
                <label>
                  Tipo de programação
                  <select value={scheduleKind} onChange={(event) => setScheduleKind(event.target.value as "recurring" | "window")}>
                    <option value="window">Horários do dia (crescente)</option>
                    <option value="recurring">Intervalo contínuo</option>
                  </select>
                </label>
                {scheduleKind === "recurring" ? (
                  <label>
                    Intervalo (minutos)
                    <input value={everyMinutes} onChange={(event) => setEveryMinutes(event.target.value)} />
                  </label>
                ) : (
                  <label>
                    Horários (HH:MM)
                    <input value={times} onChange={(event) => setTimes(event.target.value)} />
                  </label>
                )}
                {scheduleKind === "window" ? (
                  <small className={styles.inlineHint}>
                    Exemplo: 08:00, 12:30, 18:45. O sistema organiza em ordem crescente automaticamente.
                  </small>
                ) : null}
                <label>
                  Timezone
                  <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
                </label>
                <div className={styles.randomizerBlock}>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={contentRandomizerEnabled && composerItems.length > 1}
                      onChange={(event) => setContentRandomizerEnabled(event.target.checked)}
                      disabled={composerItems.length <= 1}
                    />
                    Aleatorizar conteúdos da campanha
                  </label>
                  {contentRandomizerEnabled && composerItems.length > 1 ? (
                    <label>
                      {scheduleKind === "window" ? "Quantidade por dia" : "Quantidade por envio"}
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, composerItems.length)}
                        value={contentRandomizerCount}
                        onChange={(event) => setContentRandomizerCount(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <small className={styles.inlineHint}>
                    {scheduleKind === "window"
                      ? "Defina quantos status do total serao disparados ao longo do dia; o sistema distribui pelos horarios."
                      : "Defina quantos status do total serao disparados em cada execucao."}
                  </small>
                </div>
                <div className={styles.randomizerBlock}>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={scheduleRandomizerEnabled}
                      onChange={(event) => setScheduleRandomizerEnabled(event.target.checked)}
                    />
                    Aleatorizar horario (jitter)
                  </label>
                  {scheduleRandomizerEnabled ? (
                    <label>
                      Variacao maxima (minutos)
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={scheduleRandomizerJitter}
                        onChange={(event) => setScheduleRandomizerJitter(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={scheduleReshuffleDaily}
                      onChange={(event) => setScheduleReshuffleDaily(event.target.checked)}
                    />
                    Redistribuir horarios diariamente
                  </label>
                  {scheduleReshuffleDaily ? (
                    <div className={styles.inlineGridTwo}>
                      <label>
                        Inicio da janela
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={scheduleWindowStartHour}
                          onChange={(event) => setScheduleWindowStartHour(event.target.value)}
                        />
                      </label>
                      <label>
                        Fim da janela
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={scheduleWindowEndHour}
                          onChange={(event) => setScheduleWindowEndHour(event.target.value)}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className={styles.itemList}>
              {composerItems.map((item, index) => {
                const linkState = composerLinks[item.id];
                const uploadState = composerUploads[item.id];
                const resolvedPreview = linkState?.previewUrl || item.mediaUrl || "";
                const thumbnail = linkState?.thumbnail || resolvedPreview;

                return (
                  <div key={item.id} className={styles.itemCard}>
                    <div className={styles.itemHeader}>
                      <strong>Status {index + 1}</strong>
                      <div className={styles.itemHeaderActions}>
                        <select
                          value={item.type}
                          onChange={(event) => {
                            const nextType = event.target.value as ComposerItem["type"];
                            setComposerItems((current) =>
                              current.map((entry) =>
                                entry.id === item.id
                                  ? {
                                      ...entry,
                                      type: nextType,
                                      text: nextType === "text" ? entry.text : "",
                                      caption: nextType === "text" ? "" : entry.caption,
                                    }
                                  : entry,
                              ),
                            );
                          }}
                        >
                          <option value="text">Texto</option>
                          <option value="image">Imagem</option>
                          <option value="video">Vídeo</option>
                        </select>
                        {composerItems.length > 1 ? (
                          <button type="button" onClick={() => removeComposerItem(item.id)} title="Remover item">
                            <IconTrash size={14} />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {item.type === "text" ? (
                      <>
                        <div className={styles.inlineLabelRow}>
                          <span>Texto</span>
                          <button
                            type="button"
                            className={styles.inlineIconBtn}
                            title="Buscar descrição no TMDB"
                            onClick={() => openTmdbModal(item.id)}
                          >
                            <IconMovie size={14} />
                            TMDB
                          </button>
                        </div>
                        <textarea
                          rows={4}
                          value={item.text}
                          onChange={(event) => updateComposerItem(item.id, { text: event.target.value })}
                          placeholder="Escreva o texto do status"
                        />
                      </>
                    ) : (
                      <>
                        <div className={styles.inlineLabelRow}>
                          <span>Link da mídia</span>
                          <button
                            type="button"
                            className={styles.inlineIconBtn}
                            onClick={() => void resolveMediaLinkForItem(item.id, item.mediaUrl)}
                            disabled={linkState?.processing || !item.mediaUrl.trim()}
                            title="Resolver link de mídia"
                          >
                            {linkState?.processing ? <IconLoader2 size={14} className={styles.spin} /> : <IconLink size={14} />}
                            Resolver
                          </button>
                        </div>
                        <input
                          type="url"
                          value={item.mediaUrl}
                          onChange={(event) => handleMediaUrlChange(item.id, event.target.value)}
                          onBlur={(event) => handleMediaUrlBlur(item.id, event.target.value)}
                          placeholder="https://..."
                        />
                        {linkState?.message ? <small className={styles.itemOk}>{linkState.message}</small> : null}
                        {linkState?.error ? <small className={styles.itemError}>{linkState.error}</small> : null}

                        {resolvedPreview ? (
                          <div className={styles.previewWrap}>
                            {item.type === "video" ? (
                              <video
                                controls
                                src={resolvedPreview}
                                poster={thumbnail || undefined}
                                className={styles.previewVideo}
                                preload="metadata"
                              >
                                Seu navegador não suporta preview de vídeo.
                              </video>
                            ) : (
                              <img src={thumbnail || resolvedPreview} alt="Prévia" className={styles.previewImage} />
                            )}
                          </div>
                        ) : null}

                        <div className={styles.inlineLabelRow}>
                          <span>Legenda</span>
                          <button
                            type="button"
                            className={styles.inlineIconBtn}
                            title="Buscar descrição no TMDB"
                            onClick={() => openTmdbModal(item.id)}
                          >
                            <IconMovie size={14} />
                            TMDB
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          value={item.caption}
                          onChange={(event) => updateComposerItem(item.id, { caption: event.target.value })}
                          placeholder="Legenda opcional"
                        />

                        <div className={styles.uploadRow}>
                          <label className={styles.uploadLabel}>
                            <IconUpload size={14} />
                            Upload direto
                            <input
                              type="file"
                              accept={getAcceptForItem(item)}
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0] ?? null;
                                void handleUploadItemMedia(item.id, file);
                                event.currentTarget.value = "";
                              }}
                              disabled={Boolean(uploadState?.uploading)}
                            />
                          </label>
                          {item.mediaPath ? (
                            <button
                              type="button"
                              className={styles.inlineIconBtn}
                              onClick={() => clearUploadedMediaForItem(item.id)}
                              title="Limpar arquivo enviado"
                            >
                              <IconX size={14} />
                              Limpar upload
                            </button>
                          ) : null}
                        </div>
                        {item.mediaPath ? (
                          <small className={styles.fileHint}>
                            Arquivo: {item.mediaFileName || item.mediaPath}
                          </small>
                        ) : null}
                        {uploadState?.message ? <small className={styles.itemOk}>{uploadState.message}</small> : null}
                        {uploadState?.error ? <small className={styles.itemError}>{uploadState.error}</small> : null}
                      </>
                    )}

                    <div className={styles.randomizerBlock}>
                      <label className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={item.allowReshare}
                          onChange={(event) => updateComposerItem(item.id, { allowReshare: event.target.checked })}
                        />
                        Permitir compartilhamento do status
                      </label>
                      <div className={styles.mentionsPickerRow}>
                        <button
                          type="button"
                          className={styles.inlineIconBtn}
                          onClick={() =>
                            openMentionPicker({
                              target: "composer",
                              targetId: item.id,
                              instanceId: selectedInstance?.id ?? null,
                              currentMentions: normalizeMentionsList(item.mentionsInput),
                            })
                          }
                        >
                          Selecionar menções
                        </button>
                        <small className={styles.inlineHint}>
                          {summarizeMentions(normalizeMentionsList(item.mentionsInput))}
                        </small>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.itemAddRow}>
              <button type="button" onClick={() => addComposerItem("text")}>+ Texto</button>
              <button type="button" onClick={() => addComposerItem("image")}>+ Imagem</button>
              <button type="button" onClick={() => addComposerItem("video")}>+ Vídeo</button>
              <label className={styles.uploadLabel}>
                <IconUpload size={14} />
                + Várias mídias
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(event) => {
                    void handleUploadMultipleMedia(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            <div className={styles.modalActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => setComposerOpen(false)}>
                Cancelar
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => void handleCreateStatus()} disabled={busyId === "create-status"}>
                {busyId === "create-status" ? <IconLoader2 size={14} className={styles.spin} /> : null}
                {composerMode === "manual" ? "Enviar agora" : "Salvar programação"}
              </button>
            </div>
            </div>
          ) : campaignDetailOpen ? (
            <div className={`${styles.campaignDetailPanel} ${styles.editorDockCard}`}>
              <div className={styles.campaignDetailHead}>
                <h4>Editar campanha de status</h4>
                <div className={styles.rowActions}>
                  {campaignDetail ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteCampaign(campaignDetail.id)}
                      disabled={busyId === `delete-campaign-${campaignDetail.id}`}
                    >
                      {busyId === `delete-campaign-${campaignDetail.id}` ? (
                        <IconLoader2 size={14} className={styles.spin} />
                      ) : (
                        <IconTrash size={14} />
                      )}
                      Excluir campanha
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (campaignDetailSaving) return;
                      setCampaignDetailOpen(false);
                      setCampaignDetail(null);
                      setCampaignDetailError(null);
                    }}
                  >
                    Fechar
                  </button>
                </div>
              </div>

              {campaignDetailLoading ? (
                <p className={styles.attachHint}>Carregando conteúdos da campanha...</p>
              ) : null}

              {campaignDetailError ? <div className={styles.feedbackError}>{campaignDetailError}</div> : null}

              {campaignDetail && !campaignDetailLoading ? (
                <>
                  <label>
                    Nome da campanha
                    <input
                      value={campaignDetail.name}
                      onChange={(event) =>
                        setCampaignDetail((current) =>
                          current
                            ? {
                                ...current,
                                name: event.target.value,
                              }
                            : current,
                        )
                      }
                    />
                  </label>

                  <div className={styles.randomizerBlock}>
                    <small className={styles.inlineHint}>Programação: {scheduleKindLabel(campaignDetail.schedule.kind)}</small>

                    {campaignDetail.schedule.kind === "recurring" ? (
                      <>
                        {Array.isArray(campaignDetail.schedule.atTimes) && campaignDetail.schedule.atTimes.length > 0 ? (
                          <label>
                            Horários (HH:MM)
                            <input
                              value={campaignDetail.schedule.atTimes.join(", ")}
                              onChange={(event) =>
                                setCampaignDetail((current) =>
                                  current
                                    ? {
                                        ...current,
                                        schedule: {
                                          ...current.schedule,
                                          atTimes: normalizeTimesInput(event.target.value),
                                        },
                                      }
                                    : current,
                                )
                              }
                            />
                          </label>
                        ) : (
                          <label>
                            Intervalo (minutos)
                            <input
                              type="number"
                              min={5}
                              value={String(campaignDetail.schedule.everyMinutes ?? 1440)}
                              onChange={(event) =>
                                setCampaignDetail((current) =>
                                  current
                                    ? {
                                        ...current,
                                        schedule: {
                                          ...current.schedule,
                                          everyMinutes: Math.max(5, Number(event.target.value) || 1440),
                                        },
                                      }
                                    : current,
                                )
                              }
                            />
                          </label>
                        )}
                        <label>
                          Timezone
                          <input
                            value={campaignDetail.schedule.timezone ?? "America/Sao_Paulo"}
                            onChange={(event) =>
                              setCampaignDetail((current) =>
                                current
                                  ? {
                                      ...current,
                                      schedule: {
                                        ...current.schedule,
                                        timezone: event.target.value,
                                      },
                                    }
                                  : current,
                              )
                            }
                          />
                        </label>
                      </>
                    ) : null}

                    {campaignDetail.schedule.kind === "window" ? (
                      <>
                        <label>
                          Horários (HH:MM)
                          <input
                            value={(campaignDetail.schedule.atTimes ?? []).join(", ")}
                            onChange={(event) =>
                              setCampaignDetail((current) =>
                                current
                                  ? {
                                      ...current,
                                      schedule: {
                                        ...current.schedule,
                                        atTimes: normalizeTimesInput(event.target.value),
                                      },
                                    }
                                  : current,
                              )
                            }
                          />
                        </label>
                        <label>
                          Timezone
                          <input
                            value={campaignDetail.schedule.timezone ?? "America/Sao_Paulo"}
                            onChange={(event) =>
                              setCampaignDetail((current) =>
                                current
                                  ? {
                                      ...current,
                                      schedule: {
                                        ...current.schedule,
                                        timezone: event.target.value,
                                      },
                                    }
                                  : current,
                              )
                            }
                          />
                        </label>
                      </>
                    ) : null}
                  </div>

                  <div className={styles.randomizerBlock}>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={Boolean(campaignDetail.options?.statusRandomizer?.enabled)}
                        onChange={(event) =>
                          setCampaignDetail((current) => {
                            if (!current) return current;
                            const nextOptions = { ...(current.options ?? {}) };
                            const existing = nextOptions.statusRandomizer ?? {
                              enabled: false,
                              perRunCount: 1,
                              perDayCount: 1,
                            };
                            const isWindowSchedule = current.schedule.kind === "window";
                            nextOptions.statusRandomizer = {
                              ...existing,
                              enabled: event.target.checked,
                              perRunCount:
                                !isWindowSchedule && event.target.checked ? existing.perRunCount ?? 1 : null,
                              perDayCount:
                                isWindowSchedule && event.target.checked ? existing.perDayCount ?? 1 : null,
                            };
                            return { ...current, options: nextOptions };
                          })
                        }
                      />
                      Aleatorizar conteúdos da campanha
                    </label>
                    {campaignDetail.options?.statusRandomizer?.enabled ? (
                      <label>
                        {campaignDetail.schedule.kind === "window" ? "Quantidade por dia" : "Quantidade por execução"}
                        <input
                          type="number"
                          min={1}
                          max={Math.max(1, campaignDetail.contents.length)}
                          value={String(
                            campaignDetail.schedule.kind === "window"
                              ? campaignDetail.options?.statusRandomizer?.perDayCount ?? 1
                              : campaignDetail.options?.statusRandomizer?.perRunCount ?? 1,
                          )}
                          onChange={(event) =>
                            setCampaignDetail((current) => {
                              if (!current) return current;
                              const nextOptions = { ...(current.options ?? {}) };
                              const existing = nextOptions.statusRandomizer ?? {
                                enabled: true,
                                perRunCount: 1,
                                perDayCount: 1,
                              };
                              const value = clampNumber(
                                Number(event.target.value) || 1,
                                1,
                                Math.max(1, current.contents.length),
                              );
                              const isWindowSchedule = current.schedule.kind === "window";
                              nextOptions.statusRandomizer = {
                                ...existing,
                                perRunCount: isWindowSchedule ? null : value,
                                perDayCount: isWindowSchedule ? value : null,
                              };
                              return { ...current, options: nextOptions };
                            })
                          }
                        />
                      </label>
                    ) : null}
                    <small className={styles.inlineHint}>
                      {campaignDetail.schedule.kind === "window"
                        ? "Nos horários do dia, o sistema alterna e distribui os status para atingir essa quantidade diária."
                        : "Nos envios recorrentes, o sistema envia esta quantidade em cada execução."}
                    </small>
                  </div>

                  <div className={styles.randomizerBlock}>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={Boolean(campaignDetail.options?.scheduleRandomizer?.enabled)}
                        onChange={(event) =>
                          setCampaignDetail((current) => {
                            if (!current) return current;
                            const nextOptions = { ...(current.options ?? {}) };
                            const existing = nextOptions.scheduleRandomizer ?? {
                              enabled: false,
                              jitterMinutes: 30,
                              reshuffleDaily: false,
                              windowStartHour: 7,
                              windowEndHour: 22,
                            };
                            nextOptions.scheduleRandomizer = {
                              ...existing,
                              enabled: event.target.checked,
                            };
                            return { ...current, options: nextOptions };
                          })
                        }
                      />
                      Aleatorizar horário dos envios
                    </label>
                    {campaignDetail.options?.scheduleRandomizer?.enabled ? (
                      <label>
                        Variação máxima (minutos)
                        <input
                          type="number"
                          min={1}
                          max={720}
                          value={String(campaignDetail.options?.scheduleRandomizer?.jitterMinutes ?? 30)}
                          onChange={(event) =>
                            setCampaignDetail((current) => {
                              if (!current) return current;
                              const nextOptions = { ...(current.options ?? {}) };
                              const existing = nextOptions.scheduleRandomizer ?? {
                                enabled: true,
                                jitterMinutes: 30,
                                reshuffleDaily: false,
                                windowStartHour: 7,
                                windowEndHour: 22,
                              };
                              nextOptions.scheduleRandomizer = {
                                ...existing,
                                jitterMinutes: clampNumber(Number(event.target.value) || 30, 1, 720),
                              };
                              return { ...current, options: nextOptions };
                            })
                          }
                        />
                      </label>
                    ) : null}
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={Boolean(campaignDetail.options?.scheduleRandomizer?.reshuffleDaily)}
                        onChange={(event) =>
                          setCampaignDetail((current) => {
                            if (!current) return current;
                            const nextOptions = { ...(current.options ?? {}) };
                            const existing = nextOptions.scheduleRandomizer ?? {
                              enabled: false,
                              jitterMinutes: 30,
                              reshuffleDaily: false,
                              windowStartHour: 7,
                              windowEndHour: 22,
                            };
                            nextOptions.scheduleRandomizer = {
                              ...existing,
                              reshuffleDaily: event.target.checked,
                            };
                            return { ...current, options: nextOptions };
                          })
                        }
                      />
                      Redistribuir horários diariamente
                    </label>
                    {campaignDetail.options?.scheduleRandomizer?.reshuffleDaily ? (
                      <div className={styles.inlineGridTwo}>
                        <label>
                          Início da janela
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={String(campaignDetail.options?.scheduleRandomizer?.windowStartHour ?? 7)}
                            onChange={(event) =>
                              setCampaignDetail((current) => {
                                if (!current) return current;
                                const nextOptions = { ...(current.options ?? {}) };
                                const existing = nextOptions.scheduleRandomizer ?? {
                                  enabled: false,
                                  jitterMinutes: 30,
                                  reshuffleDaily: true,
                                  windowStartHour: 7,
                                  windowEndHour: 22,
                                };
                                nextOptions.scheduleRandomizer = {
                                  ...existing,
                                  windowStartHour: clampNumber(Number(event.target.value) || 7, 0, 23),
                                };
                                return { ...current, options: nextOptions };
                              })
                            }
                          />
                        </label>
                        <label>
                          Fim da janela
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={String(campaignDetail.options?.scheduleRandomizer?.windowEndHour ?? 22)}
                            onChange={(event) =>
                              setCampaignDetail((current) => {
                                if (!current) return current;
                                const nextOptions = { ...(current.options ?? {}) };
                                const existing = nextOptions.scheduleRandomizer ?? {
                                  enabled: false,
                                  jitterMinutes: 30,
                                  reshuffleDaily: true,
                                  windowStartHour: 7,
                                  windowEndHour: 22,
                                };
                                nextOptions.scheduleRandomizer = {
                                  ...existing,
                                  windowEndHour: clampNumber(Number(event.target.value) || 22, 0, 23),
                                };
                                return { ...current, options: nextOptions };
                              })
                            }
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>

                  <div className={styles.itemAddRow}>
                    <button type="button" onClick={() => addCampaignContent("text")}>+ Texto</button>
                    <button type="button" onClick={() => addCampaignContent("image")}>+ Imagem</button>
                    <button type="button" onClick={() => addCampaignContent("video")}>+ Vídeo</button>
                  </div>

                  <div className={styles.itemList}>
                    {campaignDetail.contents.map((content, index) => {
                      const mediaUrl = content.media?.url || "";
                      const contentMentions = normalizeMentionsList(content.config?.mentions ?? []);
                      const contentAllowReshare =
                        typeof content.config?.allowReshare === "boolean" ? content.config.allowReshare : true;
                      return (
                        <div key={content.id} className={styles.itemCard}>
                          <div className={styles.itemHeader}>
                            <strong>Status {index + 1}</strong>
                            <div className={styles.detailActionRow}>
                              <button
                                type="button"
                                className={styles.inlineIconBtn}
                                onClick={() => moveCampaignContent(content.id, "up")}
                                disabled={index === 0}
                              >
                                Subir
                              </button>
                              <button
                                type="button"
                                className={styles.inlineIconBtn}
                                onClick={() => moveCampaignContent(content.id, "down")}
                                disabled={index >= campaignDetail.contents.length - 1}
                              >
                                Descer
                              </button>
                              <button
                                type="button"
                                className={styles.inlineIconBtn}
                                onClick={() => removeCampaignContent(content.id)}
                                disabled={campaignDetail.contents.length <= 1}
                              >
                                Remover
                              </button>
                            </div>
                          </div>

                          <label>
                            Tipo
                            <select
                              value={content.statusType}
                              onChange={(event) => {
                                const nextType = event.target.value as CampaignDetail["contents"][number]["statusType"];
                                if (nextType === "text") {
                                  updateCampaignContent(content.id, {
                                    statusType: "text",
                                    caption: "",
                                    media: null,
                                  });
                                  return;
                                }
                                updateCampaignContent(content.id, {
                                  statusType: nextType,
                                  text: "",
                                  media: content.media ?? { url: mediaUrl || null },
                                });
                              }}
                            >
                              <option value="text">Texto</option>
                              <option value="image">Imagem</option>
                              <option value="video">Vídeo</option>
                              <option value="document">Documento</option>
                            </select>
                          </label>

                          {content.statusType === "text" ? (
                            <label>
                              Texto
                              <textarea
                                rows={4}
                                value={content.text ?? ""}
                                onChange={(event) => updateCampaignContent(content.id, { text: event.target.value })}
                              />
                            </label>
                          ) : (
                            <>
                              <label>
                                URL da mídia/arquivo
                                <input
                                  type="url"
                                  value={mediaUrl}
                                  onChange={(event) =>
                                    updateCampaignContent(content.id, {
                                      media: {
                                        ...(content.media ?? {}),
                                        url: event.target.value.trim() || null,
                                      },
                                    })
                                  }
                                />
                              </label>
                              {mediaUrl ? (
                                <div className={styles.previewWrap}>
                                  {content.statusType === "video" ? (
                                    <video controls src={mediaUrl} className={styles.previewVideo} preload="metadata">
                                      Seu navegador não suporta preview de vídeo.
                                    </video>
                                  ) : content.statusType === "document" ? (
                                    <div className={styles.fileHint}>Arquivo configurado: {mediaUrl}</div>
                                  ) : (
                                    <img src={mediaUrl} alt="Preview do status" className={styles.previewImage} />
                                  )}
                                </div>
                              ) : null}
                              <label>
                                Legenda
                                <textarea
                                  rows={3}
                                  value={content.caption ?? ""}
                                  onChange={(event) => updateCampaignContent(content.id, { caption: event.target.value })}
                                />
                              </label>
                            </>
                          )}

                          <div className={styles.randomizerBlock}>
                            <label className={styles.checkRow}>
                              <input
                                type="checkbox"
                                checked={contentAllowReshare}
                                onChange={(event) =>
                                  updateCampaignContent(content.id, {
                                    config: {
                                      ...(content.config ?? {}),
                                      allowReshare: event.target.checked,
                                    },
                                  })
                                }
                              />
                              Permitir compartilhamento do status
                            </label>
                            <div className={styles.mentionsPickerRow}>
                              <button
                                type="button"
                                className={styles.inlineIconBtn}
                                onClick={() =>
                                  openMentionPicker({
                                    target: "campaign",
                                    targetId: content.id,
                                    instanceId: campaignDetail.instanceId,
                                    currentMentions: contentMentions,
                                  })
                                }
                              >
                                Selecionar menções
                              </button>
                              <small className={styles.inlineHint}>{summarizeMentions(contentMentions)}</small>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className={styles.modalActions}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={() => void saveCampaignDetail()}
                      disabled={campaignDetailSaving || campaignDetailLoading || !campaignDetail}
                    >
                      {campaignDetailSaving ? <IconLoader2 size={14} className={styles.spin} /> : null}
                      Salvar ajustes
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className={styles.editorHintPanel}>
              <h4>Painel de edição</h4>
              <p>Selecione um status/campanha da lista ou clique em Meu status para criar.</p>
            </div>
          )}
        </aside>
      </div>

      {createModePickerOpen ? (
        <div className={styles.modalOverlay} role="presentation" onClick={closeCreateModePicker}>
          <div
            className={`${styles.modalCard} ${styles.createStatusPicker}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-status-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="new-status-title">Novo status</h4>
            <p className={styles.attachHint}>Escolha o formato e depois adicione uma ou várias mídias.</p>

            <div className={styles.createModeGroups}>
              <section className={styles.createModeGroup}>
                <div>
                  <strong>Enviar agora</strong>
                  <small>Publica imediatamente no WhatsApp.</small>
                </div>
                <div className={styles.createTypeGrid}>
                  <button type="button" onClick={() => chooseCreateMode("manual", "text")}>Texto</button>
                  <button type="button" onClick={() => chooseCreateMode("manual", "image")}>Imagem</button>
                  <button type="button" onClick={() => chooseCreateMode("manual", "video")}>Vídeo</button>
                </div>
              </section>

              <section className={styles.createModeGroup}>
                <div>
                  <strong>Programar</strong>
                  <small>Define horários, intervalos e aleatorização.</small>
                </div>
                <div className={styles.createTypeGrid}>
                  <button type="button" onClick={() => chooseCreateMode("scheduled", "text")}>Texto</button>
                  <button type="button" onClick={() => chooseCreateMode("scheduled", "image")}>Imagem</button>
                  <button type="button" onClick={() => chooseCreateMode("scheduled", "video")}>Vídeo</button>
                </div>
              </section>
            </div>

            <p className={styles.createStatusHint}>
              No editor você também pode usar <strong>+ Várias mídias</strong> para enviar um lote inteiro.
            </p>

            <div className={styles.modalActions}>
              <button type="button" className={styles.ghostBtn} onClick={closeCreateModePicker}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}

      {attachPost ? (
        <div className={styles.modalOverlay} role="presentation" onClick={() => setAttachPost(null)}>
          <div className={styles.modalCard} role="dialog" onClick={(event) => event.stopPropagation()}>
            <h4>Adicionar status ao programado</h4>
            <p className={styles.attachHint}>{attachPost.campaignName}</p>

            <div className={styles.switchRow}>
              <button type="button" className={attachMode === "existing" ? styles.switchActive : ""} onClick={() => setAttachMode("existing")}>
                Campanha existente
              </button>
              <button type="button" className={attachMode === "new" ? styles.switchActive : ""} onClick={() => setAttachMode("new")}>
                Nova campanha
              </button>
            </div>

            {attachMode === "existing" ? (
              <label>
                Escolha a campanha
                <select value={attachCampaignId} onChange={(event) => setAttachCampaignId(event.target.value)}>
                  <option value="">{attachableCampaigns.length > 0 ? "Selecione" : "Nenhuma programação encontrada"}</option>
                  {attachableCampaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name} ({campaign.scheduleKind})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label>
                  Nome
                  <input value={attachNewName} onChange={(event) => setAttachNewName(event.target.value)} />
                </label>
                <label>
                  Instância
                  <select value={instanceId} onChange={(event) => setInstanceId(event.target.value)}>
                    {instances.map((instance) => (
                      <option key={instance.id} value={instance.id}>
                        {instance.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipo
                  <select
                    value={attachNewScheduleKind}
                    onChange={(event) => setAttachNewScheduleKind(event.target.value as "recurring" | "window")}
                  >
                    <option value="recurring">Recorrente</option>
                    <option value="window">Horários fixos</option>
                  </select>
                </label>
                {attachNewScheduleKind === "recurring" ? (
                  <label>
                    Intervalo (minutos)
                    <input value={attachNewEveryMinutes} onChange={(event) => setAttachNewEveryMinutes(event.target.value)} />
                  </label>
                ) : (
                  <label>
                    Horários (HH:MM)
                    <input value={attachNewTimes} onChange={(event) => setAttachNewTimes(event.target.value)} />
                  </label>
                )}
                <label>
                  Timezone
                  <input value={attachNewTimezone} onChange={(event) => setAttachNewTimezone(event.target.value)} />
                </label>
              </>
            )}

            <div className={styles.modalActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => setAttachPost(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => void handleAttachStatus()}
                disabled={busyId === `attach-${attachPost.id}`}
              >
                {busyId === `attach-${attachPost.id}` ? <IconLoader2 size={14} className={styles.spin} /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mentionPicker.open ? (
        <div className={styles.modalOverlay} role="presentation" onClick={closeMentionPicker}>
          <div className={`${styles.modalCard} ${styles.mentionModalCard}`} role="dialog" onClick={(event) => event.stopPropagation()}>
            <h4>Configurar menções</h4>
            <p className={styles.attachHint}>
              Escolha se você quer mencionar pessoas ou grupos neste status.
            </p>

            <div className={styles.mentionModeGrid}>
              <button
                type="button"
                className={`${styles.mentionModeCard} ${mentionPicker.mode === "people" ? styles.mentionModeCardActive : ""}`}
                onClick={() => {
                  setMentionPicker((current) => ({
                    ...current,
                    mode: "people",
                    search: "",
                  }));
                  if (mentionPicker.instanceId) {
                    void loadInstanceContacts(mentionPicker.instanceId);
                  }
                }}
              >
                <strong>Pessoas</strong>
                <small>Selecione contatos da instância.</small>
                <span
                  className={`${styles.mentionModeMeta} ${
                    mentionPeopleLoading
                      ? styles.mentionModeMetaLoading
                      : mentionPeopleError
                        ? styles.mentionModeMetaError
                        : ""
                  }`}
                >
                  {mentionPeopleLoading ? (
                    <>
                      <IconLoader2 size={13} className={styles.spin} />
                      Carregando contatos...
                    </>
                  ) : mentionPeopleError ? (
                    "Falha ao carregar contatos"
                  ) : mentionPeopleTotal > 0 ? (
                    `${mentionPeopleTotal} contatos disponíveis`
                  ) : (
                    "Toque para carregar"
                  )}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.mentionModeCard} ${mentionPicker.mode === "groups" ? styles.mentionModeCardActive : ""}`}
                onClick={() => {
                  setMentionPicker((current) => ({
                    ...current,
                    mode: "groups",
                    search: "",
                  }));
                  if (mentionPicker.instanceId) {
                    void loadInstanceGroups(mentionPicker.instanceId);
                  }
                }}
              >
                <strong>Grupos</strong>
                <small>Selecione grupos que podem ser mencionados.</small>
                <span
                  className={`${styles.mentionModeMeta} ${
                    mentionGroupsLoading
                      ? styles.mentionModeMetaLoading
                      : mentionGroupsError
                        ? styles.mentionModeMetaError
                        : ""
                  }`}
                >
                  {mentionGroupsLoading ? (
                    <>
                      <IconLoader2 size={13} className={styles.spin} />
                      Carregando grupos...
                    </>
                  ) : mentionGroupsError ? (
                    "Falha ao carregar grupos"
                  ) : mentionGroupsTotal > 0 ? (
                    `${mentionGroupsTotal} grupos disponíveis`
                  ) : (
                    "Toque para carregar"
                  )}
                </span>
              </button>
            </div>
            <small className={styles.mentionModeHint}>Toque em uma opção para continuar.</small>

            {mentionPicker.mode !== "choice" ? (
              <>
                <div className={styles.mentionSelectionHeader}>
                  <strong>{mentionPicker.mode === "people" ? "Pessoas da instância" : "Grupos da instância"}</strong>
                  <small>{mentionPicker.selectedMentions.length} selecionados</small>
                </div>

                <label className={`${styles.searchField} ${styles.mentionSearchField}`}>
                  <IconSearch size={16} />
                  <input
                    value={mentionPicker.search}
                    onChange={(event) =>
                      setMentionPicker((current) => ({
                        ...current,
                        search: event.target.value,
                      }))
                    }
                    placeholder={
                      mentionPicker.mode === "people"
                        ? "Buscar contato por nome ou número"
                        : "Buscar grupo por nome ou id"
                    }
                  />
                </label>

                <div className={styles.mentionsList}>
                  {mentionCurrentLoading ? (
                    <div className={styles.mentionsLoadingState}>
                      <IconLoader2 size={16} className={styles.spin} />
                      <div>
                        <strong>
                          {mentionPicker.mode === "people"
                            ? "Carregando contatos da instância..."
                            : "Carregando grupos da instância..."}
                        </strong>
                        <small>Isso pode levar alguns segundos.</small>
                      </div>
                    </div>
                  ) : null}

                  {mentionCurrentLoading ? (
                    <div className={styles.mentionsSkeletonList} aria-hidden>
                      <span className={styles.mentionsSkeletonItem} />
                      <span className={styles.mentionsSkeletonItem} />
                      <span className={styles.mentionsSkeletonItem} />
                    </div>
                  ) : null}

                  {!mentionCurrentLoading && mentionCurrentError ? (
                    <div className={styles.feedbackError}>{mentionCurrentError}</div>
                  ) : null}

                  {!mentionCurrentLoading && !mentionCurrentError && mentionPicker.mode === "people" ? (
                    mentionPickerContacts.length === 0 ? (
                      <div className={styles.empty}>Nenhum contato disponível para menção.</div>
                    ) : (
                      mentionPickerContacts.map((contact) => {
                        const selected = mentionPicker.selectedMentions.includes(contact.jid);
                        return (
                          <button
                            key={contact.jid}
                            type="button"
                            className={`${styles.mentionItem} ${selected ? styles.mentionItemSelected : ""}`}
                            onClick={() => toggleMentionSelection(contact.jid)}
                          >
                            <span>
                              <strong>{contact.name}</strong>
                              <small>{contact.phone || contact.jid}</small>
                            </span>
                            <span className={styles.mentionItemAction}>{selected ? "Selecionado" : "Selecionar"}</span>
                          </button>
                        );
                      })
                    )
                  ) : null}

                  {!mentionCurrentLoading && !mentionCurrentError && mentionPicker.mode === "groups" ? (
                    mentionPickerGroups.length === 0 ? (
                      <div className={styles.empty}>Nenhum grupo disponível para menção.</div>
                    ) : (
                      mentionPickerGroups.map((group) => {
                        const selected = mentionPicker.selectedMentions.includes(group.remoteId);
                        return (
                          <button
                            key={group.remoteId}
                            type="button"
                            className={`${styles.mentionItem} ${selected ? styles.mentionItemSelected : ""}`}
                            onClick={() => toggleMentionSelection(group.remoteId)}
                          >
                            <span>
                              <strong>{group.name}</strong>
                              <small>
                                {group.participantsCount} participantes
                                {group.announceOnly ? " · Somente admins" : ""}
                              </small>
                            </span>
                            <span className={styles.mentionItemAction}>{selected ? "Selecionado" : "Selecionar"}</span>
                          </button>
                        );
                      })
                    )
                  ) : null}
                </div>
              </>
            ) : null}

            <div className={styles.modalActions}>
              <button type="button" className={styles.ghostBtn} onClick={closeMentionPicker}>
                Cancelar
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={applyMentionPicker}
                disabled={mentionPicker.mode === "choice"}
              >
                Aplicar menções ({mentionPicker.selectedMentions.length})
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {broadcastOpen ? (
        <div className={styles.modalOverlay} role="presentation" onClick={() => !broadcastSending && setBroadcastOpen(false)}>
          <div className={`${styles.modalCard} ${styles.broadcastModal}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.receivedStatusPreviewHead}>
              <div>
                <strong>Transmissão</strong>
                <small>{broadcastRecipients.length} contato(s) selecionado(s)</small>
              </div>
              <button type="button" className={styles.ghostIconBtn} onClick={() => setBroadcastOpen(false)} disabled={broadcastSending} aria-label="Fechar">
                <IconX size={18} />
              </button>
            </div>
            <label>
              Mensagem
              <textarea rows={5} value={broadcastText} onChange={(event) => setBroadcastText(event.target.value)} placeholder="Digite a mensagem que será enviada aos contatos selecionados" />
            </label>
            <div className={styles.searchField}>
              <IconSearch size={16} />
              <input value={broadcastSearch} onChange={(event) => setBroadcastSearch(event.target.value)} placeholder="Pesquisar contato ou número" />
            </div>
            <div className={styles.broadcastContacts}>
              {selectedInstance && instanceContactsLoading[selectedInstance.id] ? (
                <div className={styles.empty}>Carregando contatos…</div>
              ) : broadcastContacts.length === 0 ? (
                <div className={styles.empty}>Nenhum contato encontrado. Você pode adicioná-lo manualmente abaixo.</div>
              ) : broadcastContacts.slice(0, 300).map((contact) => {
                const selected = broadcastRecipients.some((entry) => entry.jid === contact.jid);
                return (
                  <label key={contact.jid} className={styles.broadcastContactRow}>
                    <input type="checkbox" checked={selected} onChange={() => toggleBroadcastRecipient(contact)} />
                    <span>
                      <strong>{contact.name || contact.phone}</strong>
                      <small>{contact.phone || contact.jid}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className={styles.broadcastManualGrid}>
              <input value={broadcastManualName} onChange={(event) => setBroadcastManualName(event.target.value)} placeholder="Nome (opcional)" />
              <input value={broadcastManualPhone} onChange={(event) => setBroadcastManualPhone(event.target.value)} inputMode="tel" placeholder="Número com DDI e DDD" />
              <button type="button" className={styles.inlineIconBtn} onClick={addManualBroadcastRecipient}>Adicionar</button>
            </div>
            {broadcastRecipients.length > 0 ? (
              <div className={styles.broadcastSelection}>
                {broadcastRecipients.map((recipient) => (
                  <button type="button" key={recipient.jid} onClick={() => setBroadcastRecipients((current) => current.filter((entry) => entry.jid !== recipient.jid))}>
                    {recipient.name || recipient.phone} <IconX size={12} />
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.modalActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => setBroadcastOpen(false)} disabled={broadcastSending}>Cancelar</button>
              <button type="button" className={styles.primaryBtn} onClick={() => void sendBroadcast()} disabled={broadcastSending || broadcastRecipients.length === 0 || !broadcastText.trim()}>
                {broadcastSending ? <IconLoader2 size={14} className={styles.spin} /> : <IconSend size={14} />}
                Enviar para {broadcastRecipients.length || ""} contato(s)
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewStatus ? (
        <div className={styles.modalOverlay} role="presentation" onClick={() => setPreviewStatus(null)}>
          <div className={`${styles.modalCard} ${styles.receivedStatusPreview}`} role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className={styles.receivedStatusPreviewHead}>
              <div>
                <strong>{getReceivedStatusTitle(previewStatus)}</strong>
                <small>{toPtDate(previewStatus.timestamp)}</small>
              </div>
              <button type="button" className={styles.ghostIconBtn} onClick={() => setPreviewStatus(null)} aria-label="Fechar">
                <IconX size={18} />
              </button>
            </div>
            <div className={styles.receivedStatusPreviewBody}>
              {previewStatus.mediaUrl && previewStatus.type === "image" ? (
                <img src={previewStatus.mediaUrl} alt={getReceivedStatusTitle(previewStatus)} />
              ) : previewStatus.mediaUrl && previewStatus.type === "video" ? (
                <video src={previewStatus.mediaUrl} controls autoPlay playsInline />
              ) : previewStatus.mediaUrl && previewStatus.type === "audio" ? (
                <audio src={previewStatus.mediaUrl} controls />
              ) : (
                <div className={styles.receivedStatusTextPreview}>
                  {previewStatus.text?.trim() || previewStatus.caption?.trim() || getReceivedStatusPreview(previewStatus)}
                </div>
              )}
            </div>
            {previewStatus.caption || previewStatus.text ? (
              <p className={styles.receivedStatusCaption}>{previewStatus.caption || previewStatus.text}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {tmdbModal.open ? (
        <div className={styles.modalOverlay} role="presentation" onClick={() => setTmdbModal((prev) => ({ ...prev, open: false }))}>
          <div className={styles.modalCard} role="dialog" onClick={(event) => event.stopPropagation()}>
            <h4>Buscar filme/série (TMDB)</h4>
            <label>
              Nome
              <input
                value={tmdbModal.query}
                onChange={(event) => setTmdbModal((prev) => ({ ...prev, query: event.target.value }))}
                placeholder="Ex.: Rambo"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void searchTmdb();
                  }
                }}
              />
            </label>
            <div className={styles.modalActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => setTmdbModal((prev) => ({ ...prev, open: false }))}>
                Fechar
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => void searchTmdb()} disabled={tmdbModal.loading}>
                {tmdbModal.loading ? <IconLoader2 size={14} className={styles.spin} /> : null}
                Buscar
              </button>
            </div>

            {tmdbModal.error ? <small className={styles.itemError}>{tmdbModal.error}</small> : null}

            {tmdbModal.result ? (
              <div className={styles.tmdbResult}>
                {tmdbModal.result.poster ? (
                  <img src={tmdbModal.result.poster} alt={tmdbModal.result.title} className={styles.tmdbPoster} />
                ) : null}
                <div>
                  <strong>{tmdbModal.result.title}</strong>
                  <p>{tmdbModal.result.overview}</p>
                </div>
              </div>
            ) : null}

            {tmdbModal.result?.caption ? (
              <pre className={styles.tmdbCaption}>{tmdbModal.result.caption}</pre>
            ) : null}

            <div className={styles.modalActions}>
              <button type="button" className={styles.primaryBtn} onClick={applyTmdbToItem} disabled={!tmdbModal.result || !tmdbModal.itemId}>
                Inserir no status
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UserStatusManager;
