"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Spinner,
  Stack,
  Table,
} from "react-bootstrap";
import { IconCalendar, IconClock, IconPlus, IconSearch, IconTrash, IconMovie } from "@tabler/icons-react";

import type {
  BotAdCampaign,
  BotAdCampaignContent,
  BotAdCampaignOptions,
  BotAdCampaignStatusConfig,
  BotAdCampaignTargetAudience,
  BotAdCampaignTargetInput,
  GroupAdCampaignMeta,
} from "types/bot-ad-campaigns";
import type { BotInstance } from "types/bot-instances";
import type { BotGroup } from "types/bot-groups";
import type { DivulgacaoInspectionResult } from "types/divulgacao";
import CampaignGroupDiscoveryModal, { CampaignDiscoverySelection } from "./CampaignGroupDiscoveryModal";

type Feedback = { type: "success" | "danger" | "info"; message: string };
type CampaignMode = "all" | "groups" | "status";

const MAX_CONTENT_ITEMS = 25;

type ReplyButtonDraft = {
  id: string;
  text: string;
  label?: string;
};

type CtaButtonDraft = {
  id: string;
  text: string;
  type: "cta_url" | "cta_call" | "cta_copy";
  url?: string;
  phoneNumber?: string;
  copyCode?: string;
};

type DraftCampaignContent = {
  id: string;
  type: "text" | "image" | "video" | "audio" | "document" | "status" | "buttons" | "affiliate_ml";
  statusType: "text" | "image" | "video" | "document";
  text?: string;
  caption?: string;
  mediaUrl?: string;
  mediaPath?: string;
  mediaFileName?: string;
  mediaMimeType?: string;
  mentionAll?: boolean;
  mentionsText?: string;
  statusDeleteAfter?: number;
  buttonStyle?: "reply" | "cta";
  buttonTitle?: string;
  buttonBody?: string;
  buttonFooter?: string;
  replyButtons?: ReplyButtonDraft[];
  ctaButtons?: CtaButtonDraft[];
  buttonHeaderKind?: "image" | "video";
  buttonHeaderUrl?: string;
  buttonHeaderPath?: string;
  buttonHeaderFileName?: string;
  buttonHeaderMimeType?: string;
  alwaysSendWhenRandomized?: boolean;
  affiliateQuery?: string;
  affiliateFilter?: "relevance" | "cheapest" | "free_shipping" | "sold" | "random";
  affiliateLimit?: number;
  affiliatePreferAvailable?: boolean;
  affiliateIncludeImage?: boolean;
  affiliateIncludeUrlButton?: boolean;
  affiliateRequireLink?: boolean;
  affiliateIntroText?: string;
  affiliateDispatchEnabled?: boolean;
  affiliateDispatchIntervalMinutes?: number;
  affiliateCategoryRotationEnabled?: boolean;
};

type DraftCampaign = {
  id?: string;
  name: string;
  description: string;
  scheduleKind: "manual" | "immediate" | "once" | "recurring" | "window";
  everyMinutes?: number;
  times?: string;
  timezone?: string;
  startAt?: string;
  endAt?: string;
  contents: DraftCampaignContent[];
  targets: TargetFormState[];
  statusRandomizerEnabled: boolean;
  statusRandomizerCount: number | null;
  groupRandomizerEnabled: boolean;
  groupRandomizerCount: number | null;
};

type TargetFormState = {
  id: string;
  instanceId: string;
  type: "group" | "status";
  groupId: string;
  origin: "saved" | "discovery";
  remoteId?: string;
  inviteLink?: string;
  inviteCode?: string;
  audience?: BotAdCampaignTargetAudience | null;
  inspection?: DivulgacaoInspectionResult | null;
  mentionAll: boolean;
  mentions: string;
};

type LinkPreviewProvider = "tiktok" | "pinterest";

type ContentLinkPreview = {
  provider: LinkPreviewProvider;
  kind: "image" | "video";
  resolvedUrl?: string | null;
  thumbnail?: string | null;
  title?: string | null;
};

type ContentLinkState = {
  provider?: LinkPreviewProvider;
  processing: boolean;
  message?: string | null;
  error?: string | null;
  lastUrl?: string | null;
  preview?: ContentLinkPreview | null;
};

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createReplyButtonDraft = (index = 1): ReplyButtonDraft => ({
  id: `reply-${index}-${Math.random().toString(36).slice(2, 7)}`,
  text: `Opção ${index}`,
  label: `Opção ${index}`,
});

const createCtaButtonDraft = (index = 1): CtaButtonDraft => ({
  id: `cta-${index}-${Math.random().toString(36).slice(2, 7)}`,
  text: `Botão ${index}`,
  type: "cta_url",
  url: "",
});

const emptyContent = (type: DraftCampaignContent["type"] = "text"): DraftCampaignContent => {
  const base: DraftCampaignContent = {
    id: uuid(),
    type,
    statusType: type === "status" ? "text" : "text",
    mentionAll: false,
    mentionsText: "",
    mediaPath: "",
    mediaUrl: "",
    mediaFileName: "",
    mediaMimeType: "",
    alwaysSendWhenRandomized: false,
  };
  if (type === "status") {
    return { ...base, type: "status", statusType: "text" };
  }
  if (type === "buttons") {
    return {
      ...base,
      type: "buttons",
      buttonStyle: "reply",
      buttonTitle: "",
      buttonBody: "",
      buttonFooter: "",
      replyButtons: [createReplyButtonDraft(1)],
      ctaButtons: [createCtaButtonDraft(1)],
      buttonHeaderKind: "image",
      buttonHeaderUrl: "",
      buttonHeaderPath: "",
      buttonHeaderFileName: "",
      buttonHeaderMimeType: "",
    };
  }
  if (type === "affiliate_ml") {
    return {
      ...base,
      type: "affiliate_ml",
      affiliateQuery: "",
      affiliateFilter: "relevance",
      affiliateLimit: 20,
      affiliatePreferAvailable: true,
      affiliateIncludeImage: true,
      affiliateIncludeUrlButton: true,
      affiliateRequireLink: true,
      affiliateIntroText: "",
      affiliateDispatchEnabled: true,
      affiliateDispatchIntervalMinutes: 15,
      affiliateCategoryRotationEnabled: true,
    };
  }
  return base;
};

const emptyDraft = (): DraftCampaign => ({
  name: "",
  description: "",
  scheduleKind: "recurring",
  everyMinutes: 1440,
  contents: [],
  targets: [],
  statusRandomizerEnabled: false,
  statusRandomizerCount: 1,
  groupRandomizerEnabled: false,
  groupRandomizerCount: 2,
});

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
};

const TIKTOK_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:tiktok\.com|vm\.tiktok\.com)/i;
const PINTEREST_URL_REGEX = /(?:https?:\/\/)?(?:[a-z]+\.)?(?:pinterest\.com|pin\.it|pinimg\.com)/i;

const isTikTokUrl = (value?: string | null) => (value ? TIKTOK_URL_REGEX.test(value) : false);
const isPinterestUrl = (value?: string | null) => (value ? PINTEREST_URL_REGEX.test(value) : false);

const detectMediaLinkProvider = (value?: string | null): LinkPreviewProvider | null => {
  if (!value) {
    return null;
  }
  if (isTikTokUrl(value)) {
    return "tiktok";
  }
  if (isPinterestUrl(value)) {
    return "pinterest";
  }
  return null;
};


const formatSchedule = (campaign: BotAdCampaign) => {
  const { schedule } = campaign;
  switch (schedule.kind) {
    case "manual":
      return "Manual";
    case "immediate":
      return "Imediato";
    case "once":
      return `Único · ${formatDateTime(schedule.runAt ?? campaign.startAt)}`;
    case "recurring":
      if (schedule.atTimes && schedule.atTimes.length > 0) {
        return `Recorrente · ${schedule.atTimes.join(", ")}`;
      }
      return `Recorrente · ${schedule.everyMinutes ?? 1440} min`;
    case "window":
      return `Janela · ${schedule.atTimes?.join(", ") ?? ""}`;
    default:
      return schedule.kind;
  }
};

const campaignKind = (campaign: BotAdCampaign): "group" | "status" | "mixed" | "unknown" => {
  const hasGroup = campaign.targets.some((target) => target.type === "group");
  const hasStatus = campaign.targets.some((target) => target.type === "status");
  if (hasGroup && hasStatus) return "mixed";
  if (hasGroup) return "group";
  if (hasStatus) return "status";
  return "unknown";
};

const campaignMatchesMode = (campaign: BotAdCampaign, mode: CampaignMode): boolean => {
  if (mode === "all") return true;
  const kind = campaignKind(campaign);
  if (mode === "groups") return kind === "group" || kind === "mixed";
  return kind === "status";
};

const buildDraftContentFromContent = (content: BotAdCampaignContent): DraftCampaignContent => {
  const base: DraftCampaignContent = {
    id: content.id ?? uuid(),
    type: content.type === "status" ? "status" : (content.type as DraftCampaignContent["type"]),
    statusType:
      content.type === "status"
        ? content.statusType === "document"
          ? "image"
          : content.statusType
        : "text",
    mentionAll: "mentionAll" in content ? content.mentionAll ?? false : false,
    mentionsText: "mentions" in content ? (content.mentions ?? []).join(", ") : "",
    alwaysSendWhenRandomized:
      content.type === "status" ? Boolean(content.alwaysSendWhenRandomized) : false,
  };

  if (content.type === "text") {
    base.text = content.text ?? "";
  } else if (
    content.type === "image" ||
    content.type === "video" ||
    content.type === "audio" ||
    content.type === "document"
  ) {
    base.caption = content.caption ?? "";
    base.mediaPath = content.media?.path ?? "";
    base.mediaUrl = content.media?.url ?? "";
    base.mediaFileName = content.media?.fileName ?? "";
    base.mediaMimeType = content.media?.mimeType ?? "";
  } else if (content.type === "status") {
    base.statusType = content.statusType;
    base.text = content.text ?? "";
    base.caption = content.caption ?? "";
    base.mediaPath = content.media?.path ?? "";
    base.mediaUrl = content.media?.url ?? "";
    base.mediaFileName = content.media?.fileName ?? "";
    base.mediaMimeType = content.media?.mimeType ?? "";
    base.statusDeleteAfter = content.config?.deleteAfterMinutes ?? undefined;
  } else if (content.type === "buttons") {
    base.type = "buttons";
    base.buttonStyle = content.style ?? "reply";
    base.buttonTitle = content.title ?? "";
    base.buttonBody = content.body ?? "";
    base.buttonFooter = content.footer ?? "";
    base.replyButtons =
      Array.isArray(content.replyButtons) && content.replyButtons.length > 0
        ? content.replyButtons.map((button) => ({
            id: button.id,
            text: button.label ?? button.text ?? button.id,
            label: button.label ?? button.text ?? button.id,
          }))
        : [createReplyButtonDraft(1)];
    base.ctaButtons =
      Array.isArray(content.ctaButtons) && content.ctaButtons.length > 0
        ? content.ctaButtons.map((button) => ({
            id: button.id,
            text: button.text,
            type: button.type,
            url: button.url ?? undefined,
            phoneNumber: button.phoneNumber ?? undefined,
            copyCode: button.copyCode ?? undefined,
          }))
        : [createCtaButtonDraft(1)];
    const header = content.headerMedia ?? null;
    if (header) {
      base.buttonHeaderKind = header.mediaType === "video" ? "video" : "image";
      base.buttonHeaderUrl = header.url ?? "";
      base.buttonHeaderPath = header.path ?? "";
      base.buttonHeaderFileName = header.fileName ?? "";
      base.buttonHeaderMimeType = header.mimeType ?? "";
    } else {
      base.buttonHeaderKind = "image";
      base.buttonHeaderUrl = "";
      base.buttonHeaderPath = "";
      base.buttonHeaderFileName = "";
      base.buttonHeaderMimeType = "";
    }
  } else if (content.type === "affiliate_ml") {
    base.type = "affiliate_ml";
    base.affiliateQuery = content.query ?? "";
    base.affiliateFilter = content.filter ?? "relevance";
    base.affiliateLimit = typeof content.limit === "number" ? content.limit : 20;
    base.affiliatePreferAvailable = content.preferAvailable !== false;
    base.affiliateIncludeImage = content.includeImage !== false;
    base.affiliateIncludeUrlButton = content.includeUrlButton !== false;
    base.affiliateRequireLink = content.requireAffiliateLink !== false;
    base.affiliateIntroText = content.introText ?? "";
    base.affiliateDispatchEnabled = content.dispatchEnabled !== false;
    base.affiliateDispatchIntervalMinutes =
      typeof content.dispatchIntervalMinutes === "number" && Number.isFinite(content.dispatchIntervalMinutes)
        ? Math.max(0, Math.min(1440, Math.floor(content.dispatchIntervalMinutes)))
        : 0;
    base.affiliateCategoryRotationEnabled = content.categoryRotationEnabled !== false;
  }

  return base;
};

const buildDraftFromCampaign = (campaign?: BotAdCampaign | null): DraftCampaign => {
  if (!campaign) {
    return emptyDraft();
  }
  const contents =
    campaign.contents.length > 0
      ? campaign.contents.map(buildDraftContentFromContent)
      : [emptyContent()];
  const statusRandomizer = campaign.options?.statusRandomizer ?? null;
  const groupRandomizer = campaign.options?.groupRandomizer ?? null;

  const base: DraftCampaign = {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description ?? "",
    scheduleKind: campaign.schedule.kind,
    contents,
    targets:
      campaign.targets.length > 0
        ? campaign.targets.map((target) => {
            return {
              id: target.id ?? uuid(),
              instanceId: String(target.instanceId),
              type: target.type,
              groupId: target.groupId ? String(target.groupId) : "",
              origin: target.inviteLink ? "discovery" : "saved",
              remoteId: target.remoteId ?? "",
              inviteLink: target.inviteLink ?? "",
              inviteCode: target.inviteCode ?? "",
              audience: target.audience ?? null,
              inspection: target.inspection ?? null,
              mentionAll: Boolean(target.mentionAll),
              mentions: (target.mentions ?? []).join(", "),
            };
          })
        : [],
    statusRandomizerEnabled: Boolean(statusRandomizer?.enabled),
    statusRandomizerCount: statusRandomizer?.perRunCount ?? 1,
    groupRandomizerEnabled: Boolean(groupRandomizer?.enabled),
    groupRandomizerCount: groupRandomizer?.perRunCount ?? 2,
  };

  if (campaign.schedule.kind === "recurring") {
    base.everyMinutes = campaign.schedule.everyMinutes ?? 1440;
    base.times = campaign.schedule.atTimes?.join(", ");
  }
  if (campaign.schedule.kind === "window") {
    base.times = campaign.schedule.atTimes?.join(", ");
  }
  base.timezone = campaign.timezone ?? campaign.schedule.timezone ?? undefined;
  const resolvedStart =
    campaign.schedule.kind === "once"
      ? campaign.schedule.runAt ?? campaign.startAt ?? undefined
      : campaign.startAt ?? undefined;
  base.startAt = resolvedStart;
  base.endAt = campaign.endAt ?? undefined;
  return base;
};

const buildSchedulePayload = (draft: DraftCampaign) => {
  switch (draft.scheduleKind) {
    case "manual":
      return { kind: "manual" } as BotAdCampaign["schedule"];
    case "immediate":
      return { kind: "immediate" } as BotAdCampaign["schedule"];
    case "once":
      if (!draft.startAt) {
        throw new Error("Defina a data/hora inicial para o envio único.");
      }
      return {
        kind: "once",
        runAt: new Date(draft.startAt).toISOString(),
      } as BotAdCampaign["schedule"];
    case "recurring": {
      const atTimes = draft.times
        ? draft.times
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      return {
        kind: "recurring",
        everyMinutes: draft.everyMinutes ?? 1440,
        atTimes,
        timezone: draft.timezone ?? undefined,
      } as BotAdCampaign["schedule"];
    }
    case "window": {
      const atTimes = draft.times
        ? draft.times
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      return {
        kind: "window",
        atTimes,
        timezone: draft.timezone ?? undefined,
      } as BotAdCampaign["schedule"];
    }
    default:
      return { kind: "manual" } as BotAdCampaign["schedule"];
  }
};

const splitListInput = (value?: string): string[] =>
  value
    ? value
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const splitMentionsInput = (value?: string): string[] => splitListInput(value);

const normalizeLinkInput = (value: string): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    return null;
  }
};

const detectStatusTypeFromLink = (url: string): DraftCampaignContent["statusType"] => {
  const lower = url.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|avif)(?:$|\?)/.test(lower)) {
    return "image";
  }
  return "video";
};

const STATUS_VISIBILITY_LABELS: Record<string, string> = {
  contacts: "Contatos",
  all: "Todos",
  nobody: "Somente eu",
  whitelist: "Lista branca",
  blacklist: "Lista preta",
};

const describeStatusVisibility = (
  config?: BotAdCampaignStatusConfig | null,
): string => {
  const visibility = config?.visibility ?? "contacts";
  const base = STATUS_VISIBILITY_LABELS[visibility] ?? visibility;
  if (visibility === "whitelist") {
    const count = config?.whitelist?.length ?? 0;
    return count > 0 ? `${base} (${count})` : base;
  }
  if (visibility === "blacklist") {
    const count = config?.blacklist?.length ?? 0;
    return count > 0 ? `${base} (${count})` : base;
  }
  return base;
};

const buildStatusConfigPayload = (
  entry: DraftCampaignContent,
): BotAdCampaignStatusConfig | undefined => {
  if (!entry.statusDeleteAfter) {
    return undefined;
  }
  return {
    deleteAfterMinutes: entry.statusDeleteAfter,
  };
};

const buildContentsPayload = (contents: DraftCampaignContent[]): BotAdCampaignContent[] => {
  if (!contents || contents.length === 0) {
    throw new Error("Adicione ao menos um conteúdo para a campanha.");
  }

  return contents.map((entry, index) => {
    const mentions = splitMentionsInput(entry.mentionsText);
    const caption = entry.caption?.trim() ?? null;
    const mediaPath = entry.mediaPath?.trim() || null;
    const mediaUrl = entry.mediaUrl?.trim() || null;
    const mediaFileName = entry.mediaFileName?.trim() || null;
    const mediaMimeType = entry.mediaMimeType?.trim() || null;
    const ensureMedia = (
      mediaType: "image" | "video" | "audio" | "document",
    ) => {
      if (mediaPath || mediaUrl) {
        return {
          mediaType,
          path: mediaPath,
          url: mediaUrl,
          caption,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
        };
      }
      throw new Error(`Conteúdo ${index + 1}: informe a URL da mídia ou faça o upload do arquivo.`);
    };

    if (entry.type === "text") {
      const body = entry.text?.trim();
      if (!body) {
        throw new Error(`Conteúdo ${index + 1}: informe o texto.`);
      }
      return {
        id: entry.id || uuid(),
        type: "text",
        text: body,
        mentionAll: Boolean(entry.mentionAll),
        mentions,
      };
    }

    if (entry.type === "image" || entry.type === "video" || entry.type === "audio" || entry.type === "document") {
      return {
        id: entry.id || uuid(),
        type: entry.type,
        caption,
        media: ensureMedia(entry.type === "document" ? "document" : entry.type),
        mentionAll: Boolean(entry.mentionAll),
        mentions,
      };
    }

    if (entry.type === "buttons") {
      const title = entry.buttonTitle?.trim() || null;
      const body = entry.buttonBody?.trim() || title || null;
      if (!body) {
        throw new Error(`Conteúdo ${index + 1}: informe o texto exibido junto aos botões.`);
      }
      const replyButtons = Array.isArray(entry.replyButtons)
        ? entry.replyButtons
            .map((button, idx) => {
              const label = button.text?.trim() || button.label?.trim();
              if (!label) {
                return null;
              }
              return {
                id: button.id?.trim() || `reply-${idx + 1}-${uuid()}`,
                label,
                command: null,
                args: null,
              };
            })
            .filter((button): button is NonNullable<typeof button> => Boolean(button))
        : [];
      const ctaButtons = Array.isArray(entry.ctaButtons)
        ? entry.ctaButtons
            .map((button, idx) => {
              const label = button.text?.trim();
              if (!label) {
                return null;
              }
              const id = button.id?.trim() || `cta-${idx + 1}-${uuid()}`;
              if (button.type === "cta_call") {
                const phone = button.phoneNumber?.trim();
                if (!phone) {
                  throw new Error(`Conteúdo ${index + 1}: informe o telefone do botão de ligação.`);
                }
                return {
                  id,
                  text: label,
                  type: "cta_call" as const,
                  phoneNumber: phone,
                };
              }
              if (button.type === "cta_copy") {
                const code = button.copyCode?.trim();
                if (!code) {
                  throw new Error(`Conteúdo ${index + 1}: informe o código a ser copiado.`);
                }
                return {
                  id,
                  text: label,
                  type: "cta_copy" as const,
                  copyCode: code,
                };
              }
              const urlValue = button.url?.trim();
              if (!urlValue) {
                throw new Error(`Conteúdo ${index + 1}: informe o link do botão CTA.`);
              }
              return {
                id,
                text: label,
                type: "cta_url" as const,
                url: urlValue,
              };
            })
            .filter((button): button is NonNullable<typeof button> => Boolean(button))
        : [];
      if (replyButtons.length === 0 && ctaButtons.length === 0) {
        throw new Error(`Conteúdo ${index + 1}: adicione ao menos um botão.`);
      }
      const buttonStyle = entry.buttonStyle ?? (ctaButtons.length > 0 ? "cta" : "reply");
      if (buttonStyle === "reply" && replyButtons.length === 0) {
        throw new Error(`Conteúdo ${index + 1}: informe ao menos um botão de resposta rápida.`);
      }
      if (buttonStyle === "cta" && ctaButtons.length === 0) {
        throw new Error(`Conteúdo ${index + 1}: informe ao menos um botão CTA.`);
      }
      const headerMedia =
        entry.buttonHeaderPath || entry.buttonHeaderUrl
          ? {
              mediaType: entry.buttonHeaderKind ?? "image",
              path: entry.buttonHeaderPath || null,
              url: entry.buttonHeaderUrl || null,
              fileName: entry.buttonHeaderFileName || null,
              mimeType: entry.buttonHeaderMimeType || null,
              caption: null,
            }
          : null;
      return {
        id: entry.id || uuid(),
        type: "buttons",
        style: buttonStyle,
        title,
        body,
        footer: entry.buttonFooter?.trim() || null,
        replyButtons: buttonStyle === "reply" ? replyButtons : undefined,
        ctaButtons: buttonStyle === "cta" ? ctaButtons : undefined,
        headerMedia,
        mentionAll: Boolean(entry.mentionAll),
        mentions,
      };
    }

    if (entry.type === "affiliate_ml") {
      const query = entry.affiliateQuery?.trim();
      if (!query) {
        throw new Error(`Conteúdo ${index + 1}: informe o termo de busca do Mercado Livre.`);
      }
      const filter = entry.affiliateFilter ?? "relevance";
      const limit =
        typeof entry.affiliateLimit === "number" && Number.isFinite(entry.affiliateLimit)
          ? Math.max(1, Math.min(50, Math.floor(entry.affiliateLimit)))
          : 20;
      const dispatchIntervalMinutes =
        typeof entry.affiliateDispatchIntervalMinutes === "number" &&
        Number.isFinite(entry.affiliateDispatchIntervalMinutes)
          ? Math.max(0, Math.min(1440, Math.floor(entry.affiliateDispatchIntervalMinutes)))
          : 0;
      return {
        id: entry.id || uuid(),
        type: "affiliate_ml",
        query,
        filter,
        limit,
        preferAvailable: entry.affiliatePreferAvailable !== false,
        includeImage: entry.affiliateIncludeImage !== false,
        includeUrlButton: entry.affiliateIncludeUrlButton !== false,
        requireAffiliateLink: entry.affiliateRequireLink !== false,
        introText: entry.affiliateIntroText?.trim() || null,
        dispatchEnabled: entry.affiliateDispatchEnabled !== false,
        dispatchIntervalMinutes,
        categoryRotationEnabled: entry.affiliateCategoryRotationEnabled !== false,
        mentionAll: Boolean(entry.mentionAll),
        mentions,
      };
    }

    if (entry.type === "status") {
      const statusType = entry.statusType ?? "text";
      if (statusType === "text") {
        const body = entry.text?.trim() ?? entry.caption?.trim();
        if (!body) {
          throw new Error(`Conteúdo ${index + 1}: informe o texto do status.`);
        }
        const statusConfig = buildStatusConfigPayload(entry);
        return {
          id: entry.id || uuid(),
          type: "status",
          statusType,
          text: entry.text ?? "",
          caption,
          media: null,
          config: statusConfig,
          alwaysSendWhenRandomized: Boolean(entry.alwaysSendWhenRandomized),
        };
      }

      if (statusType === "document") {
        throw new Error(`Conteúdo ${index + 1}: status de documento não é suportado.`);
      }
      const media = ensureMedia(statusType);
      const statusConfig = buildStatusConfigPayload(entry);
      return {
        id: entry.id || uuid(),
        type: "status",
        statusType,
        text: entry.text ?? "",
        caption,
        media,
        config: statusConfig,
        alwaysSendWhenRandomized: Boolean(entry.alwaysSendWhenRandomized),
      };
    }

    throw new Error(`Conteúdo ${index + 1}: tipo não suportado.`);
  });
};

const buildCampaignOptions = (draft: DraftCampaign): BotAdCampaignOptions | null => {
  const hasOnlyStatusTargets =
    draft.targets.length > 0 && draft.targets.every((target) => target.type === "status");
  const hasOnlyGroupTargets = draft.targets.length > 0 && draft.targets.every((target) => target.type === "group");

  const normalizedStatusCount =
    draft.statusRandomizerCount != null && !Number.isNaN(draft.statusRandomizerCount)
      ? Math.max(1, Math.min(50, Math.floor(draft.statusRandomizerCount)))
      : null;
  const normalizedGroupCount =
    draft.groupRandomizerCount != null && !Number.isNaN(draft.groupRandomizerCount)
      ? Math.max(1, Math.min(5, Math.floor(draft.groupRandomizerCount)))
      : null;

  const options: BotAdCampaignOptions = {};
  if (hasOnlyStatusTargets && draft.statusRandomizerEnabled) {
    options.statusRandomizer = {
      enabled: true,
      perRunCount: normalizedStatusCount ?? 1,
    };
  }
  if (hasOnlyGroupTargets && draft.groupRandomizerEnabled) {
    options.groupRandomizer = {
      enabled: true,
      perRunCount: normalizedGroupCount ?? 2,
    };
  }

  return Object.keys(options).length > 0 ? options : null;
};

const buildCampaignInput = (draft: DraftCampaign, fallbackName: string) => {
  const options = buildCampaignOptions(draft);
  return {
    name: draft.name.trim() || fallbackName,
    description: undefined,
    schedule: buildSchedulePayload(draft),
    contents: buildContentsPayload(draft.contents),
    timezone: draft.timezone?.trim() || undefined,
    startAt: draft.startAt ? new Date(draft.startAt).toISOString() : undefined,
    endAt: draft.endAt ? new Date(draft.endAt).toISOString() : undefined,
    options: options ?? null,
  };
};

type Props = {
  initialCampaigns: BotAdCampaign[];
  instances: BotInstance[];
  groups: BotGroup[];
  initialGroupAdCampaignMeta: GroupAdCampaignMeta[];
  apiKey: string;
  mode?: CampaignMode;
  preferredInstanceId?: number | null;
  layout?: "full" | "detail";
  selectedCampaignId?: string | null;
  onSelectedCampaignIdChange?: (campaignId: string | null) => void;
  onCampaignsChange?: (campaigns: BotAdCampaign[]) => void;
  createRequestKey?: number;
  refreshRequestKey?: number;
};

const UserAdCampaignManager = ({
  initialCampaigns,
  instances,
  groups,
  initialGroupAdCampaignMeta,
  apiKey,
  mode = "all",
  preferredInstanceId = null,
  layout = "full",
  selectedCampaignId,
  onSelectedCampaignIdChange,
  onCampaignsChange,
  createRequestKey = 0,
  refreshRequestKey = 0,
}: Props) => {
  const currentMode: CampaignMode = mode === "groups" || mode === "status" ? mode : "all";
  const forcedTargetType: "group" | "status" | null =
    currentMode === "groups" ? "group" : currentMode === "status" ? "status" : null;
  const hasTargetTypeStep = forcedTargetType == null;
  const defaultInstanceId = useMemo(() => {
    if (preferredInstanceId != null && instances.some((instance) => instance.id === preferredInstanceId)) {
      return preferredInstanceId;
    }
    return instances[0]?.id ?? null;
  }, [instances, preferredInstanceId]);

  const buildTargetFormDefaults = useCallback(
    (type: "group" | "status" = "group"): TargetFormState => ({
      id: uuid(),
      instanceId: defaultInstanceId ? String(defaultInstanceId) : "",
      type,
      groupId: "",
      origin: "saved",
      remoteId: "",
      inviteLink: "",
      inviteCode: "",
      audience: null,
      inspection: null,
      mentionAll: false,
      mentions: "",
    }),
    [defaultInstanceId],
  );
  const buildTargetInputFromForm = useCallback(
    (form: TargetFormState): BotAdCampaignTargetInput => {
      const instanceId = Number(form.instanceId);
      if (!Number.isFinite(instanceId)) {
        throw new Error("Selecione a instância do destino.");
      }
      const base: BotAdCampaignTargetInput = {
        id: form.id,
        type: form.type,
        instanceId,
        mentionAll: Boolean(form.mentionAll),
        mentions: form.mentions ? splitMentionsInput(form.mentions) : [],
        inviteLink: form.inviteLink || undefined,
        inviteCode: form.inviteCode || undefined,
        audience: form.audience ?? undefined,
        inspection: form.inspection ?? undefined,
      };
      if (form.type === "group") {
        const parsedGroupId = form.groupId ? Number(form.groupId) : undefined;
        if (form.origin === "discovery") {
          base.groupId = undefined;
          const remoteCandidate = form.remoteId?.trim() || form.inspection?.groupJid || "";
          base.remoteId = remoteCandidate || undefined;
        } else {
          base.groupId = parsedGroupId != null && Number.isFinite(parsedGroupId) ? parsedGroupId : undefined;
          const selectedGroup = form.groupId
            ? groups.find((group) => group.id === Number(form.groupId))
            : null;
          if (selectedGroup?.remoteId) {
            base.remoteId = selectedGroup.remoteId;
          } else {
            base.remoteId = undefined;
          }
          base.inviteLink = undefined;
          base.inviteCode = undefined;
          base.audience = undefined;
          base.inspection = undefined;
        }
        base.statusConfig = undefined;
      } else {
        base.groupId = undefined;
        base.remoteId = undefined;
        base.mentionAll = false;
        base.mentions = [];
        base.statusConfig = undefined;
      }
      return base;
    },
    [groups],
  );

  const [campaigns, setCampaigns] = useState<BotAdCampaign[]>(initialCampaigns);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const firstVisible = initialCampaigns.find((campaign) => campaignMatchesMode(campaign, currentMode));
    return firstVisible?.id ?? null;
  });
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<DraftCampaign>(emptyDraft());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [contentUploads, setContentUploads] = useState<
    Record<string, { uploading: boolean; error?: string | null }>
  >({});
  const [tmdbModal, setTmdbModal] = useState<{
    open: boolean;
    contentId: string | null;
    query: string;
    loading: boolean;
    result: { title: string; overview: string; poster?: string | null; caption?: string } | null;
    error: string | null;
  }>({ open: false, contentId: null, query: "", loading: false, result: null, error: null });
  const [contentLinkStatus, setContentLinkStatus] = useState<Record<string, ContentLinkState>>({});
  const contentLinkStatusRef = useRef<Record<string, ContentLinkState>>({});
  const [contentUploadVisibility, setContentUploadVisibility] = useState<Record<string, boolean>>({});
  const [buttonHeaderUploads, setButtonHeaderUploads] = useState<
    Record<string, { uploading: boolean; error?: string | null }>
  >({});
  const [buttonHeaderVisibility, setButtonHeaderVisibility] = useState<Record<string, boolean>>({});
  const [showBulkLinksModal, setShowBulkLinksModal] = useState(false);
  const [nextContentType, setNextContentType] = useState<DraftCampaignContent["type"]>("text");
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [groupAdCampaignMeta, setGroupAdCampaignMeta] = useState<GroupAdCampaignMeta[]>(
    initialGroupAdCampaignMeta ?? [],
  );
  const [bulkStatusLinks, setBulkStatusLinks] = useState("");
  const [bulkStatusError, setBulkStatusError] = useState<string | null>(null);
  const wizardStepFlow = hasTargetTypeStep
    ? (["targetType", "destinations", "schedule", "content"] as const)
    : (["destinations", "schedule", "content"] as const);
  const wizardStepLabels = hasTargetTypeStep
    ? (["Tipo de destino", "Destinos", "Agendamento", "Conteúdo"] as const)
    : (["Destinos", "Agendamento", "Conteúdo"] as const);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardTargetType, setWizardTargetType] = useState<"group" | "status" | null>(forcedTargetType);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [dateRangeEnabled, setDateRangeEnabled] = useState(false);
  const [manualDispatchingId, setManualDispatchingId] = useState<string | null>(null);
  const [discoveryModalVisible, setDiscoveryModalVisible] = useState(false);
  const [discoveryInstanceId, setDiscoveryInstanceId] = useState<number | null>(null);
  const [reinspectTargetId, setReinspectTargetId] = useState<string | null>(null);
  const destinationCards = useMemo(() => {
    const base = [
      {
        type: "group" as const,
        title: "Grupos do WhatsApp",
        description: "Use quando quiser mandar campanhas completas com menções e botões.",
        hint: "Disponível apenas para instâncias conectadas e grupos sincronizados.",
      },
      {
        type: "status" as const,
        title: "Status do WhatsApp",
        description: "Perfeito para anúncios que somem após 24h ou em ciclos automáticos.",
        hint: "Segue a privacidade padrão da instância e substitui o status anterior automaticamente.",
      },
    ];
    if (currentMode === "groups") return base.filter((card) => card.type === "group");
    if (currentMode === "status") return base.filter((card) => card.type === "status");
    return base;
  }, [currentMode]);
  const scheduleCards = [
    {
      kind: "recurring",
      title: "Recorrente",
      description: "Define intervalo em minutos; reenvia e substitui o status anterior.",
    },
    {
      kind: "window",
      title: "Horários fixos",
      description: "Escolha horários do dia (ex: 08:00/14:00) e a plataforma dispara nesses momentos.",
    },
  ] as const;
  const allowMultipleTargets = instances.length > 1;
  const reachedContentLimit = draft.contents.length >= MAX_CONTENT_ITEMS;
  const normalizeScheduleKind = (value: DraftCampaign["scheduleKind"]): DraftCampaign["scheduleKind"] =>
    value === "window" ? "window" : "recurring";

  useEffect(() => {
    if (!forcedTargetType) {
      return;
    }
    if (wizardTargetType !== forcedTargetType) {
      setWizardTargetType(forcedTargetType);
    }
  }, [forcedTargetType, wizardTargetType]);

  useEffect(() => {
    if (wizardTargetType !== "status") {
      setBulkStatusLinks("");
      setBulkStatusError(null);
    }
  }, [wizardTargetType]);

  const handleSelectTargetType = (type: "group" | "status") => {
    if (forcedTargetType) {
      return;
    }
    setWizardTargetType(type);
    setDraft((prev) => {
      let filteredTargets = prev.targets.filter((target) => target.type === type);
      if (filteredTargets.length === 0) {
        filteredTargets = [buildTargetFormDefaults(type)];
      } else {
        filteredTargets = filteredTargets.map((target) => ({ ...target, type }));
      }
      return {
        ...prev,
        targets: filteredTargets,
      };
    });
    setWizardError(null);
  };
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "paused" | "scheduled" | "draft" | "completed">(
    "all",
  );
  const isDetailLayout = layout === "detail";
  const visibleCampaigns = useMemo(() => {
    const filtered = campaigns.filter((campaign) => campaignMatchesMode(campaign, currentMode));
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return filtered.filter((campaign) => {
      if (statusFilter !== "all" && campaign.status !== statusFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const nameMatch = campaign.name?.toLowerCase().includes(normalizedSearch);
      const descMatch = campaign.description?.toLowerCase().includes(normalizedSearch);
      return Boolean(nameMatch || descMatch);
    });
  }, [campaigns, currentMode, searchTerm, statusFilter]);
  const selectedCampaign = visibleCampaigns.find((campaign) => campaign.id === selectedId) ?? null;
  const selectedCampaignIsActive = Boolean(
    selectedCampaign && !["paused", "cancelled", "completed", "draft"].includes(selectedCampaign.status),
  );
  const selectedCampaignToggleDisabled =
    !selectedCampaign || ["completed", "cancelled"].includes(selectedCampaign.status);

  useEffect(() => {
    if (visibleCampaigns.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }
    if (!selectedId || !visibleCampaigns.some((campaign) => campaign.id === selectedId)) {
      setSelectedId(visibleCampaigns[0]?.id ?? null);
    }
  }, [selectedId, visibleCampaigns]);

  useEffect(() => {
    if (typeof selectedCampaignId === "undefined") return;
    if ((selectedCampaignId ?? null) === (selectedId ?? null)) return;
    setSelectedId(selectedCampaignId ?? null);
  }, [selectedCampaignId, selectedId]);

  useEffect(() => {
    if (!onSelectedCampaignIdChange) return;
    onSelectedCampaignIdChange(selectedId ?? null);
  }, [onSelectedCampaignIdChange, selectedId]);

  useEffect(() => {
    if (!onCampaignsChange) return;
    onCampaignsChange(visibleCampaigns);
  }, [onCampaignsChange, visibleCampaigns]);

  const countdownInfo = useMemo(() => {
    if (!selectedCampaign?.nextRunAt) {
      return null;
    }
    const targetTime = Date.parse(selectedCampaign.nextRunAt);
    if (Number.isNaN(targetTime)) {
      return null;
    }
    const diff = targetTime - nowTs;
    const absSeconds = Math.floor(Math.abs(diff) / 1000);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const seconds = absSeconds % 60;
    const parts = [
      hours > 0 ? `${hours}h` : null,
      `${minutes}m`,
      `${seconds.toString().padStart(2, "0")}s`,
    ]
      .filter(Boolean)
      .join(" ");
    const targetHint = selectedCampaign.nextTargetHint ?? null;
    const targetLabel = targetHint?.title ?? null;
    const targetId = targetHint?.targetId ?? null;
    const prefix = targetLabel
      ? diff >= 0
        ? `Próximo envio para ${targetLabel}${targetId ? ` (#${targetId})` : ""}`
        : `Envio atrasado para ${targetLabel}${targetId ? ` (#${targetId})` : ""}`
      : diff >= 0
        ? "Próximo envio em"
        : "Atrasado há";
    const text = targetLabel && diff >= 0 ? `${prefix} em ${parts}` : `${prefix} ${parts}`;
    return {
      text,
      isLate: diff < 0,
      targetLabel,
      targetId,
    };
  }, [selectedCampaign?.nextRunAt, selectedCampaign?.nextTargetHint, nowTs]);

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    contentLinkStatusRef.current = contentLinkStatus;
  }, [contentLinkStatus]);

  // Auto-save rascunho local para evitar perda em refresh
  useEffect(() => {
    if (!showForm) return;
    const timer = setTimeout(() => {
      try {
        const payload = { draft, wizardTargetType, wizardStep };
        localStorage.setItem("campaign-draft", JSON.stringify(payload));
      } catch {
        /* ignore */
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, wizardTargetType, wizardStep, showForm]);

  // Restaurar rascunho local ao carregar a página (reabre o formulário)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("campaign-draft");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.draft) setDraft(parsed.draft);
      if (parsed?.wizardTargetType) {
        const parsedType = parsed.wizardTargetType as "group" | "status";
        if (!forcedTargetType || parsedType === forcedTargetType) {
          setWizardTargetType(parsedType);
        }
      }
      if (typeof parsed?.wizardStep === "number") {
        const maxStep = wizardStepLabels.length - 1;
        const normalizedStep = Math.max(0, Math.min(maxStep, parsed.wizardStep));
        setWizardStep(normalizedStep);
      }
      setShowForm(true);
    } catch {
      /* ignore */
    }
  }, [forcedTargetType, wizardStepLabels.length]);


  useEffect(() => {
    if (!wizardTargetType) {
      return;
    }
    setDraft((prev) => {
      let modified = false;
      const nextContents = prev.contents.map((content) => {
        if (wizardTargetType === "status") {
          if (content.type === "status") {
            return content;
          }
          modified = true;
          return {
            ...content,
            type: "status",
            statusType: "text",
            text: content.text ?? "",
            caption: "",
            mentionsText: "",
            mentionAll: false,
            statusDeleteAfter: undefined,
          };
        }
        if (content.type !== "status") {
          return content;
        }
        modified = true;
        return {
          ...content,
          type: "text",
          statusType: "text",
          statusDeleteAfter: undefined,
        };
      });
      if (!modified) {
        return prev;
      }
      return { ...prev, contents: nextContents };
    });
  }, [wizardTargetType]);

  useEffect(() => {
    if (wizardTargetType !== "group") {
      return;
    }
    setDraft((prev) => {
      if (prev.contents.length <= 1) {
        return prev;
      }
      return {
        ...prev,
        contents: prev.contents.slice(0, 1),
      };
    });
  }, [wizardTargetType]);

  const scheduleKind = draft.scheduleKind;
  useEffect(() => {
    if (!(wizardTargetType === "status" && scheduleKind === "recurring")) {
      return;
    }
    setDraft((prev) => {
      let changed = false;
      const nextContents = prev.contents.map((content) => {
        if (content.statusDeleteAfter !== undefined && content.statusDeleteAfter !== null) {
          changed = true;
          return { ...content, statusDeleteAfter: undefined };
        }
        return content;
      });
      return changed ? { ...prev, contents: nextContents } : prev;
    });
  }, [wizardTargetType, scheduleKind]);

  useEffect(() => {
    if (scheduleKind === "once" && !dateRangeEnabled) {
      setDateRangeEnabled(true);
    }
  }, [scheduleKind, dateRangeEnabled]);

  useEffect(() => {
    setNextContentType(wizardTargetType === "status" ? "status" : "text");
  }, [wizardTargetType]);

  const instanceMap = useMemo(() => {
    const map = new Map<number, BotInstance>();
    instances.forEach((instance) => map.set(instance.id, instance));
    return map;
  }, [instances]);

  const groupsByInstance = useMemo(() => {
    const map = new Map<number, BotGroup[]>();
    groups.forEach((group) => {
      const list = map.get(group.instanceId) ?? [];
      list.push(group);
      map.set(group.instanceId, list);
    });
    return map;
  }, [groups]);

  const groupAdCampaignMetaMap = useMemo(() => {
    const map = new Map<string, GroupAdCampaignMeta>();
    groupAdCampaignMeta.forEach((entry) => map.set(entry.campaignId, entry));
    return map;
  }, [groupAdCampaignMeta]);

  const getGroupAdInfo = useCallback(
    (campaignId?: string | null) => (campaignId ? groupAdCampaignMetaMap.get(campaignId) ?? null : null),
    [groupAdCampaignMetaMap],
  );

  const refreshCampaigns = useCallback(
    async (options?: { selectId?: string | null }) => {
      try {
        const response = await fetch("/api/bot-ad-campaigns?includeGroupAds=1", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Não foi possível atualizar a lista de campanhas.");
        }
        const data = await response.json();
        const current = Array.isArray(data.campaigns) ? data.campaigns : [];
        const groupAdCampaigns = Array.isArray(data.groupAdCampaigns) ? data.groupAdCampaigns : [];
        const merged = [...current, ...groupAdCampaigns];
        const mergedVisible = merged.filter((campaign) => campaignMatchesMode(campaign, currentMode));
        setCampaigns(merged);
        setGroupAdCampaignMeta(Array.isArray(data.groupAdCampaignMeta) ? data.groupAdCampaignMeta : []);
        setSelectedId((prev) => {
          const desired = options?.selectId ?? prev;
          if (desired && mergedVisible.some((entry) => entry.id === desired)) {
            return desired;
          }
          return mergedVisible[0]?.id ?? null;
        });
      } catch (error) {
        console.error("Failed to refresh campaigns", error);
        setFeedback({
          type: "danger",
          message: (error as Error).message ?? "Não foi possível atualizar a lista de campanhas.",
        });
      }
    },
    [currentMode],
  );

  useEffect(() => {
    void refreshCampaigns();
  }, [refreshCampaigns]);

  const lastRefreshRequestKeyRef = useRef(refreshRequestKey);
  useEffect(() => {
    if (refreshRequestKey === lastRefreshRequestKeyRef.current) return;
    lastRefreshRequestKeyRef.current = refreshRequestKey;
    void refreshCampaigns();
  }, [refreshCampaigns, refreshRequestKey]);

  const handleOpenForm = (campaign?: BotAdCampaign) => {
    setFeedback(null);
    const nextType = forcedTargetType ?? campaign?.targets[0]?.type ?? null;
    const preparedDraft = buildDraftFromCampaign(campaign);
    const normalizedKind = normalizeScheduleKind(preparedDraft.scheduleKind);
    const baseDraft: DraftCampaign = {
      ...preparedDraft,
      scheduleKind: normalizedKind,
      everyMinutes:
        normalizedKind === "recurring"
          ? preparedDraft.everyMinutes && preparedDraft.everyMinutes > 0
            ? preparedDraft.everyMinutes
            : 1440
          : preparedDraft.everyMinutes,
    };
    const filteredTargets =
      nextType != null
        ? baseDraft.targets.filter((target) => target.type === nextType)
        : baseDraft.targets;
    const nextDraft: DraftCampaign = {
      ...baseDraft,
      targets:
        nextType && filteredTargets.length === 0
          ? [buildTargetFormDefaults(nextType)]
          : filteredTargets,
    };
    setDraft(nextDraft);
    setWizardTargetType(nextType);
    setWizardStep(hasTargetTypeStep ? (nextType ? 1 : 0) : 0);
    setWizardError(null);
    setDateRangeEnabled(Boolean(nextDraft.startAt || nextDraft.endAt));
    setShowForm(true);
  };

  const handleCloneCampaign = (campaign: BotAdCampaign) => {
    setFeedback(null);
    const sourceDraft = buildDraftFromCampaign(campaign);
    const targetType = forcedTargetType ?? campaign.targets[0]?.type ?? null;
    const clonedDraft: DraftCampaign = {
      ...sourceDraft,
      id: undefined,
      name: `${campaign.name} (cópia)`,
      description: campaign.description ?? "",
      targets: targetType ? [buildTargetFormDefaults(targetType)] : [],
      scheduleKind: "manual",
      everyMinutes: targetType === "status" ? sourceDraft.everyMinutes : 1440,
      times: "",
      startAt: undefined,
      endAt: undefined,
    };
    setDraft(clonedDraft);
    setWizardTargetType(targetType);
    setWizardStep(hasTargetTypeStep ? (targetType ? 1 : 0) : 0);
    setWizardError(null);
    setDateRangeEnabled(false);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    try { localStorage.removeItem("campaign-draft"); } catch {}
    setDraft(emptyDraft());
    setWizardStep(0);
    setWizardError(null);
    setWizardTargetType(forcedTargetType);
    setDateRangeEnabled(false);
    setContentLinkStatus({});
    contentLinkStatusRef.current = {};
    setContentUploadVisibility({});
    setContentUploads({});
    setBulkStatusLinks("");
    setBulkStatusError(null);
  };

  const lastAutoOpenedCampaignIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isDetailLayout) return;
    const campaignId = selectedCampaign?.id ?? null;
    if (!campaignId) return;
    if (lastAutoOpenedCampaignIdRef.current === campaignId) return;
    lastAutoOpenedCampaignIdRef.current = campaignId;
    handleOpenForm(selectedCampaign);
  }, [isDetailLayout, selectedCampaign]);

  const lastCreateRequestKeyRef = useRef(createRequestKey);
  useEffect(() => {
    if (!isDetailLayout) return;
    if (createRequestKey === lastCreateRequestKeyRef.current) return;
    lastCreateRequestKeyRef.current = createRequestKey;
    handleOpenForm();
  }, [createRequestKey, handleOpenForm, isDetailLayout]);

  const validateStep = (step: number): boolean => {
    const stepKey = wizardStepFlow[Math.min(step, wizardStepFlow.length - 1)];
    if (stepKey === "targetType") {
      if (!wizardTargetType) {
        setWizardError("Escolha se a campanha será enviada para grupos ou status.");
        return false;
      }
    }
    if (stepKey === "destinations") {
      if (draft.targets.length === 0) {
        setWizardError("Adicione ao menos um destino para o disparo.");
        return false;
      }
      for (let index = 0; index < draft.targets.length; index += 1) {
        const target = draft.targets[index];
        if (!target.instanceId) {
          setWizardError(`Destino ${index + 1}: selecione a instância.`);
          return false;
        }
        if (target.type === "group") {
          const isDiscovery = target.origin === "discovery";
          if (!isDiscovery && !target.groupId) {
            setWizardError(`Destino ${index + 1}: escolha o grupo que receberá os envios.`);
            return false;
          }
          if (isDiscovery && !target.inviteLink?.trim()) {
            setWizardError(`Destino ${index + 1}: informe o link público do grupo selecionado.`);
            return false;
          }
        }
      }
    }
    if (stepKey === "schedule") {
      if (draft.scheduleKind === "recurring" && (!draft.everyMinutes || draft.everyMinutes <= 0)) {
        setWizardError("Informe o intervalo em minutos para o envio recorrente.");
        return false;
      }
      if (draft.scheduleKind === "window" && (!draft.times || !draft.times.trim())) {
        setWizardError("Informe pelo menos um horário (HH:MM) para a janela diária.");
        return false;
      }
    }
    if (stepKey === "content" && draft.contents.length === 0) {
      setWizardError("Adicione ao menos um conteúdo antes de salvar.");
      return false;
    }
    setWizardError(null);
    return true;
  };


  const triggerManualDispatch = async (campaignId: string) => {
    if (getGroupAdInfo(campaignId)) {
      setFeedback({
        type: "danger",
        message: "Disparos manuais não estão disponíveis para anúncios vinculados diretamente aos grupos.",
      });
      return false;
    }
    try {
      const response = await fetch(`/api/bot-ad-campaigns/${campaignId}/run-now`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível iniciar o disparo manual.");
      }
      setFeedback({
        type: "success",
        message: data.message ?? "Campanha enviada. Aguarde o processamento.",
      });
      return true;
    } catch (error) {
      console.error("Failed to trigger manual dispatch", error);
      setFeedback({
        type: "danger",
        message: (error as Error).message ?? "Falha ao iniciar disparo manual.",
      });
      return false;
    }
  };

  const parseTimesFromDraft = (value?: string | null) => {
    if (!value) {
      return [];
    }
    const seen = new Set<string>();
    return value
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter((entry) => /^([0-2]?\d):([0-5]\d)$/.test(entry))
      .map((entry) => (entry.length === 4 ? `0${entry}` : entry))
      .filter((entry) => {
        if (seen.has(entry)) return false;
        seen.add(entry);
        return true;
      });
  };

  const minutesToFrequencyToken = (minutes?: number | null) => {
    const value = Number.isFinite(minutes) && minutes && minutes > 0 ? minutes : 1440;
    if (value % 1440 === 0) {
      return `${Math.max(1, Math.floor(value / 1440))}d`;
    }
    if (value % 60 === 0) {
      return `${Math.max(1, Math.floor(value / 60))}h`;
    }
    return `${Math.max(1, Math.floor(value))}m`;
  };

  const saveGroupAdCampaign = async (groupAdInfo: GroupAdCampaignMeta) => {
    const primaryTarget = draft.targets[0];
    const primaryGroupId = primaryTarget?.groupId ? Number(primaryTarget.groupId) : null;
    if (draft.targets.length !== 1 || primaryGroupId !== groupAdInfo.groupId) {
      setFeedback({
        type: "danger",
        message: "Selecione apenas o grupo original para editar este anúncio.",
      });
      setIsSubmitting(false);
      return;
    }
    if (draft.contents.length !== 1) {
      setFeedback({
        type: "danger",
        message: "Anúncios deste tipo aceitam apenas um conteúdo. Remova itens extras antes de salvar.",
      });
      setIsSubmitting(false);
      return;
    }

    const content = draft.contents[0];
    const resolvedScheduleKind = draft.scheduleKind === "window" ? "window" : "recurring";
    const times = parseTimesFromDraft(draft.times ?? "");
    if (resolvedScheduleKind === "window" && !times.length) {
      setFeedback({
        type: "danger",
        message: "Informe pelo menos um horário válido no formato HH:MM.",
      });
      setIsSubmitting(false);
      return;
    }

    let caption = "";
    let mediaPayload: Record<string, unknown> | null = null;
    const resolvedContentType =
      content.type === "status"
        ? (content.statusType === "document" ? "document" : content.statusType)
        : content.type;

    if (resolvedContentType === "text") {
      caption = content.text?.trim() ?? "";
      if (!caption) {
        setFeedback({
          type: "danger",
          message: "Informe o texto do anúncio.",
        });
        setIsSubmitting(false);
        return;
      }
      mediaPayload = null;
    } else {
      if (!content.mediaPath && !content.mediaUrl) {
        setFeedback({
          type: "danger",
          message: "Informe a URL da mídia ou faça o upload do arquivo antes de salvar.",
        });
        setIsSubmitting(false);
        return;
      }
      caption = content.caption ?? "";
      mediaPayload = {
        path: content.mediaPath ?? null,
        url: content.mediaUrl ?? null,
        mediaType: resolvedContentType,
        mimeType: content.mediaMimeType ?? null,
        fileName: content.mediaFileName ?? null,
        caption,
      };
    }

    const payload: Record<string, unknown> = {
      caption,
      mentionAll: Boolean(primaryTarget?.mentionAll || content.mentionAll),
      scheduleType: resolvedScheduleKind === "window" ? "times" : "frequency",
      media: mediaPayload,
    };
    if (payload.scheduleType === "times") {
      payload.times = times;
    } else {
      payload.frequency = minutesToFrequencyToken(draft.everyMinutes);
    }

    try {
      const response = await fetch(`/api/bot-groups/${groupAdInfo.groupId}/ads/${groupAdInfo.adId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível atualizar o anúncio.");
      }
      setFeedback({ type: "success", message: data.message ?? "Anúncio atualizado com sucesso." });
      setShowForm(false);
      await refreshCampaigns({ selectId: groupAdInfo.campaignId });
    } catch (error) {
      console.error("Failed to update group ad campaign", error);
      setFeedback({
        type: "danger",
        message: (error as Error).message ?? "Falha ao atualizar o anúncio do grupo.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteGroupAdCampaign = async (groupAdInfo: GroupAdCampaignMeta) => {
    try {
      const response = await fetch(`/api/bot-groups/${groupAdInfo.groupId}/ads/${groupAdInfo.adId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível excluir o anúncio.");
      }
      setFeedback({ type: "success", message: data.message ?? "Anúncio removido com sucesso." });
      await refreshCampaigns();
    } catch (error) {
      console.error("Failed to delete group ad campaign", error);
      setFeedback({
        type: "danger",
        message: (error as Error).message ?? "Falha ao remover o anúncio do grupo.",
      });
    }
  };

  const handleSaveDraft = async () => {
    for (const step of wizardStepLabels.map((_, index) => index)) {
      if (!validateStep(step)) {
        setWizardStep(step);
        return;
      }
    }
    if (!draft.contents.length) {
      setFeedback({ type: "danger", message: "Adicione pelo menos um conteúdo." });
      return;
    }
    const groupAdInfo = draft.id ? getGroupAdInfo(draft.id) : null;
    const targetsPayload = draft.targets.map((entry) => buildTargetInputFromForm(entry));

    setIsSubmitting(true);
    setFeedback(null);

    if (groupAdInfo) {
      await saveGroupAdCampaign(groupAdInfo);
      return;
    }

    const shouldTriggerStatusImmediately = wizardTargetType === "status" && draft.scheduleKind === "recurring";
    const shouldTriggerAfterSave = shouldTriggerStatusImmediately;
    let payload: ReturnType<typeof buildCampaignInput> & { targets: typeof targetsPayload };
    try {
      const now = new Date();
      const autoName = `${
        currentMode === "status" ? "Status" : "Campanha"
      } ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate(),
      ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes(),
      ).padStart(2, "0")}`;
      payload = {
        ...buildCampaignInput(draft, autoName),
        targets: targetsPayload,
      };
    } catch (error) {
      console.error("Failed to build campaign payload", error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível validar os dados da campanha.",
      });
      setIsSubmitting(false);
      return;
    }
    const url = draft.id ? `/api/bot-ad-campaigns/${draft.id}` : "/api/bot-ad-campaigns";
    const method = draft.id ? "PATCH" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Falha ao salvar a campanha.");
      }
      const savedId =
        data.campaign?.id ??
        (draft.id ? draft.id : Array.isArray(data.campaigns) ? data.campaigns[0]?.id ?? null : null);
      await refreshCampaigns({ selectId: savedId });
      setFeedback({ type: "success", message: data.message ?? "Campanha salva com sucesso." });
      try { localStorage.removeItem("campaign-draft"); } catch {}
      setShowForm(false);
      if (shouldTriggerAfterSave && savedId) {
        await triggerManualDispatch(savedId);
      }
    } catch (error) {
      console.error("Failed to save campaign", error);
      setFeedback({ type: "danger", message: (error as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCampaign = async (campaign: BotAdCampaign) => {
    if (!confirm(`Deseja remover a campanha ${campaign.name || "sem nome"}?`)) {
      return;
    }
    const groupAdInfo = getGroupAdInfo(campaign.id);
    if (groupAdInfo) {
      await deleteGroupAdCampaign(groupAdInfo);
      return;
    }
    // remoção otimista
    setCampaigns((prev) => prev.filter((item) => item.id !== campaign.id));
    if (selectedId === campaign.id) {
      setSelectedId(null);
    }
    (async () => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(`/api/bot-ad-campaigns/${campaign.id}`, { method: "DELETE" });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.message ?? "Não foi possível remover a campanha.");
          }
          await refreshCampaigns();
          setFeedback({ type: "success", message: data.message ?? "Campanha removida." });
          lastError = null;
          break;
        } catch (error) {
          lastError = error as Error;
          console.error("Failed to delete campaign", error);
          if (attempt === 0) {
            continue;
          }
        }
      }
      if (lastError) {
        setFeedback({
          type: "danger",
          message: lastError.message ?? "Falha ao remover a campanha. Tente novamente.",
        });
        void refreshCampaigns();
      }
    })();
  };

  const handleManualResend = async (campaign: BotAdCampaign) => {
    if (getGroupAdInfo(campaign.id)) {
      setFeedback({
        type: "danger",
        message: "Reenvio manual indisponível para campanhas vinculadas diretamente aos grupos.",
      });
      return;
    }
    const hasStatusTarget = campaign.targets.some((target) => target.type === "status");
    const confirmMessage = hasStatusTarget
      ? "Deseja reenviar esta campanha de status? Os status anteriores serão removidos antes do novo envio."
      : "Deseja reenviar esta campanha agora para todos os destinos configurados?";
    if (!confirm(confirmMessage)) {
      return;
    }
    setManualDispatchingId(campaign.id);
    try {
      await triggerManualDispatch(campaign.id);
    } finally {
      setManualDispatchingId(null);
    }
  };

  const handleToggleCampaignStatus = async (campaign: BotAdCampaign, activate: boolean) => {
    if (getGroupAdInfo(campaign.id)) {
      setFeedback({
        type: "info",
        message: "Ative ou pause anúncios antigos diretamente na tela de edição.",
      });
      return;
    }
    setStatusUpdatingId(campaign.id);
    const nextStatus = activate ? "scheduled" : "paused";
    try {
      const response = await fetch(`/api/bot-ad-campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível atualizar o status.");
      }
      await refreshCampaigns({ selectId: campaign.id });
      setFeedback({
        type: "success",
        message: activate ? "Campanha ativada." : "Campanha pausada.",
      });
    } catch (error) {
      console.error("Failed to toggle campaign status", error);
      setFeedback({
        type: "danger",
        message: (error as Error).message ?? "Falha ao atualizar o status da campanha.",
      });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleAddContentBlock = (contentType?: DraftCampaignContent["type"]) => {
    if (draft.contents.length >= MAX_CONTENT_ITEMS) {
      setFeedback({
        type: "info",
        message: `Limite de ${MAX_CONTENT_ITEMS} conteúdos por campanha atingido.`,
      });
      return;
    }
    const resolvedType =
      wizardTargetType === "status" ? "status" : contentType ?? nextContentType ?? "text";
    setDraft((prev) => ({
      ...prev,
      contents: [...prev.contents, emptyContent(resolvedType)],
    }));
  };

  const handleBulkStatusLinksAddition = () => {
    if (wizardTargetType !== "status") {
      setBulkStatusError("Esta função está disponível apenas para campanhas de status.");
      return;
    }
    const lines = bulkStatusLinks
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (!lines.length) {
      setBulkStatusError("Informe ao menos um link para importar.");
      return;
    }
    const existingLinks = new Set(
      draft.contents
        .filter((content) => content.type === "status" && content.mediaUrl)
        .map((content) => content.mediaUrl!.trim().toLowerCase()),
    );
    const newContents: DraftCampaignContent[] = [];
    for (const raw of lines) {
      const normalizedUrl = normalizeLinkInput(raw);
      if (!normalizedUrl) {
        continue;
      }
      const signature = normalizedUrl.toLowerCase();
      if (existingLinks.has(signature)) {
        continue;
      }
      existingLinks.add(signature);
      const detectedType = detectStatusTypeFromLink(normalizedUrl);
      const base = emptyContent("status");
      newContents.push({
        ...base,
        id: uuid(),
        statusType: detectedType,
        mediaUrl: normalizedUrl,
        mediaPath: "",
        mediaFileName: "",
        mediaMimeType: "",
        text: "",
        caption: "",
        alwaysSendWhenRandomized: false,
      });
    }
    if (!newContents.length) {
      setBulkStatusError("Nenhum link válido ou inédito para adicionar.");
      return;
    }
    setDraft((prev) => ({
      ...prev,
      contents: [...prev.contents, ...newContents],
    }));
    setBulkStatusLinks("");
    setBulkStatusError(null);
    setShowBulkLinksModal(false);
    setFeedback({
      type: "success",
      message: `${newContents.length} link${newContents.length > 1 ? "s" : ""} adicionados aos conteúdos.`,
    });
  };

  const handleRemoveContentBlock = (contentId: string) => {
    setDraft((prev) => {
      if (prev.contents.length <= 1) {
        setFeedback({
          type: "danger",
          message: "A campanha precisa ter pelo menos um conteúdo.",
        });
        return prev;
      }
      return {
        ...prev,
        contents: prev.contents.filter((content) => content.id !== contentId),
      };
    });
  };

  const mutateContent = (
    contentId: string,
    updater: (content: DraftCampaignContent) => DraftCampaignContent,
  ) => {
    setDraft((prev) => ({
      ...prev,
      contents: prev.contents.map((content) =>
        content.id === contentId ? updater(content) : content,
      ),
    }));
  };

  const handleContentChange = (
    contentId: string,
    updates: Partial<DraftCampaignContent>,
  ) => {
    mutateContent(contentId, (content) => ({ ...content, ...updates }));
  };

  const handleContentTypeChange = (
    contentId: string,
    nextType: DraftCampaignContent["type"],
  ) => {
    if (wizardTargetType === "status") {
      return;
    }
    handleContentChange(contentId, {
      type: nextType,
      statusType: nextType === "status" ? "text" : "text",
      text: "",
      caption: "",
      mediaPath: "",
      mediaUrl: "",
      mediaFileName: "",
      mediaMimeType: "",
      mentionsText: "",
      mentionAll: false,
      statusDeleteAfter: undefined,
      buttonStyle: nextType === "buttons" ? "reply" : undefined,
      buttonTitle: nextType === "buttons" ? "" : undefined,
      buttonBody: nextType === "buttons" ? "" : undefined,
      buttonFooter: nextType === "buttons" ? "" : undefined,
      replyButtons: nextType === "buttons" ? [createReplyButtonDraft(1)] : undefined,
      ctaButtons: nextType === "buttons" ? [createCtaButtonDraft(1)] : undefined,
      buttonHeaderKind: nextType === "buttons" ? "image" : undefined,
      buttonHeaderUrl: nextType === "buttons" ? "" : undefined,
      buttonHeaderPath: nextType === "buttons" ? "" : undefined,
      buttonHeaderFileName: nextType === "buttons" ? "" : undefined,
      buttonHeaderMimeType: nextType === "buttons" ? "" : undefined,
      affiliateQuery: nextType === "affiliate_ml" ? "" : undefined,
      affiliateFilter: nextType === "affiliate_ml" ? "relevance" : undefined,
      affiliateLimit: nextType === "affiliate_ml" ? 20 : undefined,
      affiliatePreferAvailable: nextType === "affiliate_ml" ? true : undefined,
      affiliateIncludeImage: nextType === "affiliate_ml" ? true : undefined,
      affiliateIncludeUrlButton: nextType === "affiliate_ml" ? true : undefined,
      affiliateRequireLink: nextType === "affiliate_ml" ? true : undefined,
      affiliateIntroText: nextType === "affiliate_ml" ? "" : undefined,
      affiliateDispatchEnabled: nextType === "affiliate_ml" ? true : undefined,
      affiliateDispatchIntervalMinutes: nextType === "affiliate_ml" ? 15 : undefined,
      affiliateCategoryRotationEnabled: nextType === "affiliate_ml" ? true : undefined,
    });
    setButtonHeaderUploads((prev) => {
      if (!prev[contentId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[contentId];
      return next;
    });
    setButtonHeaderVisibility((prev) => {
      if (!prev[contentId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[contentId];
      return next;
    });
  };

  const handleButtonStyleChange = (contentId: string, style: "reply" | "cta") => {
    mutateContent(contentId, (content) => {
      const next: DraftCampaignContent = { ...content, buttonStyle: style };
      if (style === "reply" && (!next.replyButtons || next.replyButtons.length === 0)) {
        next.replyButtons = [createReplyButtonDraft(1)];
      }
      if (style === "cta" && (!next.ctaButtons || next.ctaButtons.length === 0)) {
        next.ctaButtons = [createCtaButtonDraft(1)];
      }
      return next;
    });
  };

  const handleReplyButtonChange = (
    contentId: string,
    index: number,
    updates: Partial<ReplyButtonDraft>,
  ) => {
    mutateContent(contentId, (content) => {
      const buttons = content.replyButtons ? [...content.replyButtons] : [createReplyButtonDraft(1)];
      if (!buttons[index]) {
        buttons[index] = createReplyButtonDraft(index + 1);
      }
      buttons[index] = { ...buttons[index], ...updates };
      return { ...content, replyButtons: buttons };
    });
  };

  const handleAddReplyButton = (contentId: string) => {
    mutateContent(contentId, (content) => {
      const buttons = content.replyButtons ? [...content.replyButtons] : [];
      if (buttons.length >= 3) {
        return content;
      }
      buttons.push(createReplyButtonDraft(buttons.length + 1));
      return { ...content, replyButtons: buttons };
    });
  };

  const handleRemoveReplyButton = (contentId: string, index: number) => {
    mutateContent(contentId, (content) => {
      const buttons = content.replyButtons
        ? content.replyButtons.filter((_, idx) => idx !== index)
        : [];
      return {
        ...content,
        replyButtons: buttons.length > 0 ? buttons : [createReplyButtonDraft(1)],
      };
    });
  };

  const handleCtaButtonChange = (
    contentId: string,
    index: number,
    updates: Partial<CtaButtonDraft>,
  ) => {
    mutateContent(contentId, (content) => {
      const buttons = content.ctaButtons ? [...content.ctaButtons] : [createCtaButtonDraft(1)];
      if (!buttons[index]) {
        buttons[index] = createCtaButtonDraft(index + 1);
      }
      buttons[index] = { ...buttons[index], ...updates };
      return { ...content, ctaButtons: buttons };
    });
  };

  const handleAddCtaButton = (contentId: string) => {
    mutateContent(contentId, (content) => {
      const buttons = content.ctaButtons ? [...content.ctaButtons] : [];
      if (buttons.length >= 3) {
        return content;
      }
      buttons.push(createCtaButtonDraft(buttons.length + 1));
      return { ...content, ctaButtons: buttons };
    });
  };

  const handleRemoveCtaButton = (contentId: string, index: number) => {
    mutateContent(contentId, (content) => {
      const buttons = content.ctaButtons
        ? content.ctaButtons.filter((_, idx) => idx !== index)
        : [];
      return {
        ...content,
        ctaButtons: buttons.length > 0 ? buttons : [createCtaButtonDraft(1)],
      };
    });
  };

  const handleTargetFieldChange = (targetId: string, updates: Partial<TargetFormState>) => {
    setDraft((prev) => ({
      ...prev,
      targets: prev.targets.map((target) =>
        target.id === targetId ? { ...target, ...updates } : target,
      ),
    }));
  };

  const handleAddTargetRow = () => {
    if (!wizardTargetType) {
      setWizardError("Escolha primeiro se o envio será para grupos ou status.");
      setWizardStep(0);
      return;
    }
    if (!allowMultipleTargets && draft.targets.length >= 1) {
      setWizardError("Esta conta possui apenas uma instância conectada, portanto só é possível definir um destino.");
      return;
    }
    setDraft((prev) => ({
      ...prev,
      targets: [...prev.targets, buildTargetFormDefaults(wizardTargetType)],
    }));
  };

  const handleRemoveTargetRow = (targetId: string) => {
    setDraft((prev) => {
      const remaining = prev.targets.filter((target) => target.id !== targetId);
      if (remaining.length === 0) {
        if (!wizardTargetType) {
          return { ...prev, targets: [] };
        }
        return { ...prev, targets: [buildTargetFormDefaults(wizardTargetType)] };
      }
      return {
        ...prev,
        targets: remaining,
      };
    });
  };

  const inspectInviteLink = useCallback(async (instanceId: number, invite: string): Promise<DivulgacaoInspectionResult> => {
    const response = await fetch("/api/divulgacao/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite, instanceId }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(errorPayload?.message ?? "Falha ao validar o grupo.");
    }
    const payload = await response.json();
    if (!payload?.inspection) {
      throw new Error("O servidor não retornou as informações do grupo.");
    }
    return payload.inspection as DivulgacaoInspectionResult;
  }, []);

  const handleDiscoveryApply = useCallback(
    (entries: CampaignDiscoverySelection[]) => {
      if (!entries.length) {
        return;
      }
      setDraft((prev) => {
        const existing = new Set(
          prev.targets
            .map((target) => target.inviteCode?.toLowerCase())
            .filter((code): code is string => Boolean(code)),
        );
        const nextTargets = prev.targets.filter((target) => {
          if (target.type !== "group") {
            return false;
          }
          if (target.origin === "saved") {
            return Boolean(target.groupId);
          }
          if (target.origin === "discovery") {
            return Boolean(target.inviteLink);
          }
          return false;
        });
        entries.forEach(({ instanceId, candidate, inspection }) => {
          if (!inspection.groupJid) {
            return;
          }
          const normalizedCode = candidate.inviteCode?.toLowerCase();
          if (normalizedCode && existing.has(normalizedCode)) {
            return;
          }
          if (normalizedCode) {
            existing.add(normalizedCode);
          }
          nextTargets.push({
            id: uuid(),
            instanceId: String(instanceId),
            type: "group",
            groupId: "",
            origin: "discovery",
            remoteId: inspection.groupJid ?? "",
            inviteLink: candidate.inviteLink,
            inviteCode: candidate.inviteCode,
            audience: {
              title: candidate.title,
              description: candidate.description,
              imageUrl: candidate.imageUrl ?? null,
              categories: candidate.categories ?? null,
              metadata: candidate.metadata ?? null,
            },
            inspection,
            mentionAll: false,
            mentions: "",
          });
        });
        return { ...prev, targets: nextTargets };
      });
      setWizardTargetType("group");
      setWizardStep((prev) => (prev < 1 ? 1 : prev));
      setDiscoveryModalVisible(false);
      setFeedback({ type: "success", message: `${entries.length} grupo(s) foram adicionados à campanha.` });
    },
    [instances, setDraft],
  );

  const openDiscoveryModal = () => {
    if (!instances.length) {
      setFeedback({ type: "danger", message: "Cadastre uma instância antes de importar grupos públicos." });
      return;
    }
    const inferredInstance = draft.targets[0]?.instanceId ? Number(draft.targets[0].instanceId) : defaultInstanceId;
    setDiscoveryInstanceId(inferredInstance ?? defaultInstanceId);
    setDiscoveryModalVisible(true);
  };

  const handleReinspectTarget = async (targetId: string) => {
    const target = draft.targets.find((entry) => entry.id === targetId);
    if (!target || !target.inviteLink) {
      setFeedback({ type: "danger", message: "Este destino não possui link público para revalidar." });
      return;
    }
    const instanceId = Number(target.instanceId);
    if (!Number.isFinite(instanceId)) {
      setFeedback({ type: "danger", message: "Selecione a instância antes de revalidar o grupo." });
      return;
    }
    try {
      setReinspectTargetId(targetId);
      const inspection = await inspectInviteLink(instanceId, target.inviteLink);
      setDraft((prev) => ({
        ...prev,
        targets: prev.targets.map((entry) =>
          entry.id === targetId
            ? {
                ...entry,
                inspection,
                remoteId: inspection.groupJid ?? entry.remoteId,
                inviteCode: inspection.inviteCode ?? entry.inviteCode,
              }
            : entry,
        ),
      }));
      setFeedback({ type: "success", message: "Grupo revalidado com sucesso." });
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao revalidar o grupo.",
      });
    } finally {
      setReinspectTargetId(null);
    }
  };

  const getMediaKindForContent = (content: DraftCampaignContent) => {
    if (content.type === "status") {
      return content.statusType === "text" ? null : content.statusType;
    }
    if (content.type === "text" || content.type === "affiliate_ml") {
      return null;
    }
    return content.type;
  };

  const getAcceptForContent = (content: DraftCampaignContent) => {
    const kind = getMediaKindForContent(content);
    switch (kind) {
      case "image":
        return "image/*";
      case "video":
        return "video/*";
      case "audio":
        return "audio/*";
      case "document":
        return ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*,video/*,audio/*";
      default:
        return undefined;
    }
  };

  const handleContentFileUpload = async (contentId: string, file: File) => {
    setContentUploads((prev) => ({ ...prev, [contentId]: { uploading: true, error: null } }));
    try {
      const currentContent = draft.contents.find((content) => content.id === contentId);
      if (!currentContent) {
        throw new Error("Conteúdo não encontrado.");
      }
      const mediaKind = getMediaKindForContent(currentContent);
      if (!mediaKind) {
        throw new Error("Selecione um tipo de mídia válido antes do upload.");
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("mediaType", mediaKind);
      if (currentContent.mediaPath) {
        formData.append("previousPath", currentContent.mediaPath);
      }

      const response = await fetch("/api/bot-ad-campaigns/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string" ? data.message : "Não foi possível enviar a mídia.",
        );
      }
      const media = data.media as {
        path?: string | null;
        url?: string | null;
        fileName?: string | null;
        mimeType?: string | null;
      };
      setDraft((prev) => ({
        ...prev,
        contents: prev.contents.map((content) =>
          content.id === contentId
            ? {
                ...content,
                mediaPath: media?.path ?? "",
                mediaUrl: media?.url ?? "",
                mediaFileName: media?.fileName ?? file.name,
                mediaMimeType: media?.mimeType ?? file.type ?? "",
              }
            : content,
        ),
      }));
      setContentUploads((prev) => ({ ...prev, [contentId]: { uploading: false, error: null } }));
    } catch (error) {
      console.error("Failed to upload content media", error);
      setContentUploads((prev) => ({
        ...prev,
        [contentId]: {
          uploading: false,
          error: error instanceof Error ? error.message : "Falha ao enviar a mídia.",
        },
      }));
    }
  };

  const handleContentFileChange = (contentId: string, file: File | null) => {
    if (!file) {
      return;
    }
    void handleContentFileUpload(contentId, file);
  };

  const handleRemoveUploadedMedia = (contentId: string) => {
    setDraft((prev) => ({
      ...prev,
      contents: prev.contents.map((content) =>
        content.id === contentId
          ? {
              ...content,
              mediaPath: "",
              mediaUrl: "",
              mediaFileName: "",
              mediaMimeType: "",
            }
          : content,
      ),
    }));
    setContentUploads((prev) => ({ ...prev, [contentId]: { uploading: false, error: null } }));
    setContentUploadVisibility((prev) => ({ ...prev, [contentId]: false }));
    clearContentLinkStatus(contentId);
  };

  const handleButtonHeaderFileUpload = async (contentId: string, file: File) => {
    setButtonHeaderUploads((prev) => ({ ...prev, [contentId]: { uploading: true, error: null } }));
    try {
      const currentContent = draft.contents.find((content) => content.id === contentId);
      if (!currentContent) {
        throw new Error("Conteúdo não encontrado.");
      }
      const mediaKind = currentContent.buttonHeaderKind ?? "image";
      if (!mediaKind) {
        throw new Error("Selecione o tipo da mídia do cabeçalho antes de enviar.");
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mediaType", mediaKind);
      if (currentContent.buttonHeaderPath) {
        formData.append("previousPath", currentContent.buttonHeaderPath);
      }
      const response = await fetch("/api/bot-ad-campaigns/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string" ? data.message : "Não foi possível enviar a mídia.",
        );
      }
      const media = data.media as {
        path?: string | null;
        url?: string | null;
        fileName?: string | null;
        mimeType?: string | null;
      };
      handleContentChange(contentId, {
        buttonHeaderPath: media?.path ?? "",
        buttonHeaderUrl: media?.url ?? "",
        buttonHeaderFileName: media?.fileName ?? file.name,
        buttonHeaderMimeType: media?.mimeType ?? file.type ?? "",
      });
      setButtonHeaderUploads((prev) => ({ ...prev, [contentId]: { uploading: false, error: null } }));
    } catch (error) {
      console.error("Failed to upload header media", error);
      setButtonHeaderUploads((prev) => ({
        ...prev,
        [contentId]: {
          uploading: false,
          error: error instanceof Error ? error.message : "Falha ao enviar a mídia.",
        },
      }));
    }
  };

  const handleButtonHeaderFileChange = (contentId: string, file: File | null) => {
    if (!file) {
      return;
    }
    void handleButtonHeaderFileUpload(contentId, file);
  };

  const handleRemoveButtonHeaderMedia = (contentId: string) => {
    handleContentChange(contentId, {
      buttonHeaderPath: "",
      buttonHeaderUrl: "",
      buttonHeaderFileName: "",
      buttonHeaderMimeType: "",
    });
    setButtonHeaderUploads((prev) => {
      if (!prev[contentId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[contentId];
      return next;
    });
  };

  const applyPreviewMediaKind = useCallback(
    (contentId: string, previewKind: "image" | "video") => {
      setDraft((prev) => ({
        ...prev,
        contents: prev.contents.map((content) => {
          if (content.id !== contentId) {
            return content;
          }
          if (wizardTargetType === "status" || content.type === "status") {
            if (content.statusType === previewKind) {
              return content;
            }
            return {
              ...content,
              statusType: previewKind,
            };
          }
          if (content.type === previewKind) {
            return content;
          }
          return {
            ...content,
            type: previewKind,
          };
        }),
      }));
    },
    [wizardTargetType],
  );

  const clearContentLinkStatus = useCallback((contentId: string) => {
    setContentLinkStatus((prev) => {
      if (!prev[contentId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[contentId];
      return next;
    });
  }, []);

  const resolveTikTokLink = async (contentId: string, link: string) => {
    setContentLinkStatus((prev) => ({
      ...prev,
      [contentId]: {
        provider: "tiktok",
        processing: true,
        error: null,
        message: null,
        lastUrl: prev[contentId]?.lastUrl ?? null,
        preview: prev[contentId]?.preview ?? null,
      },
    }));
    try {
      let data: any = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(`/api/tiktok/preview?url=${encodeURIComponent(link)}`, {
            cache: "no-store",
          });
          data = await response.json().catch(() => ({}));
          if (response.ok && data?.success) {
            break;
          }
          if (attempt === 2) {
            throw new Error(
              typeof data?.message === "string"
                ? data.message
                : "Não foi possível processar o link do TikTok.",
            );
          }
        } catch (err) {
          if (attempt === 2) {
            throw err;
          }
        }
      }
      const normalized = data.normalized as
        | { type: "video"; url?: string | null; thumbnail?: string | null; title?: string | null }
        | { type: "images"; items?: string[]; title?: string | null };
      if (!normalized) {
        throw new Error("O link do TikTok não retornou mídias para visualização.");
      }
      const preview: ContentLinkPreview =
        normalized.type === "video"
          ? {
              provider: "tiktok",
              kind: "video",
              resolvedUrl: normalized.url ?? undefined,
              thumbnail: normalized.thumbnail ?? undefined,
              title: normalized.title ?? undefined,
            }
          : {
              provider: "tiktok",
              kind: "image",
              resolvedUrl: Array.isArray(normalized.items) ? normalized.items[0] ?? undefined : undefined,
              thumbnail: Array.isArray(normalized.items) ? normalized.items[0] ?? undefined : undefined,
              title: normalized.title ?? undefined,
            };
      applyPreviewMediaKind(contentId, preview.kind);
      setContentLinkStatus((prev) => ({
        ...prev,
        [contentId]: {
          provider: "tiktok",
          processing: false,
          message: "Link do TikTok processado para prévia.",
          error: null,
          lastUrl: link,
          preview,
        },
      }));
    } catch (error) {
      console.error("Failed to resolve TikTok link", error);
      setContentLinkStatus((prev) => ({
        ...prev,
        [contentId]: {
          provider: "tiktok",
          processing: false,
          message: null,
          error: error instanceof Error ? error.message : "Falha ao processar o link do TikTok.",
          lastUrl: undefined,
          preview: null,
        },
      }));
    }
  };

  const resolvePinterestLink = async (contentId: string, link: string) => {
    setContentLinkStatus((prev) => ({
      ...prev,
      [contentId]: {
        provider: "pinterest",
        processing: true,
        error: null,
        message: null,
        lastUrl: prev[contentId]?.lastUrl ?? null,
        preview: prev[contentId]?.preview ?? null,
      },
    }));
    try {
      let data: any = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(`/api/pinterest/preview?url=${encodeURIComponent(link)}`, {
            cache: "no-store",
          });
          data = await response.json().catch(() => ({}));
          if (response.ok && data?.success) {
            break;
          }
          if (attempt === 2) {
            throw new Error(
              typeof data?.message === "string"
                ? data.message
                : "Não foi possível processar o link do Pinterest.",
            );
          }
        } catch (err) {
          if (attempt === 2) {
            throw err;
          }
        }
      }
      const normalized = data.normalized as
        | { kind: "video"; url?: string | null; thumbnail?: string | null; title?: string | null }
        | { kind: "image"; url?: string | null; thumbnail?: string | null; title?: string | null };
      if (!normalized) {
        throw new Error("O link do Pinterest não retornou mídias para visualização.");
      }
      const preview: ContentLinkPreview = {
        provider: "pinterest",
        kind: normalized.kind,
        resolvedUrl: normalized.url ?? undefined,
        thumbnail: normalized.thumbnail ?? undefined,
        title: normalized.title ?? undefined,
      };
      applyPreviewMediaKind(contentId, preview.kind);
      setContentLinkStatus((prev) => ({
        ...prev,
        [contentId]: {
          provider: "pinterest",
          processing: false,
          message: "Link do Pinterest processado para prévia.",
          error: null,
          lastUrl: link,
          preview,
        },
      }));
    } catch (error) {
      console.error("Failed to resolve Pinterest link", error);
      setContentLinkStatus((prev) => ({
        ...prev,
        [contentId]: {
          provider: "pinterest",
          processing: false,
          message: null,
          error: error instanceof Error ? error.message : "Falha ao processar o link do Pinterest.",
          lastUrl: undefined,
          preview: null,
        },
      }));
    }
  };

  const handleMediaUrlBlur = useCallback(
    (contentId: string, rawValue: string, options?: { force?: boolean }) => {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        clearContentLinkStatus(contentId);
        return;
      }
      const provider = detectMediaLinkProvider(trimmed);
      if (!provider) {
        clearContentLinkStatus(contentId);
        return;
      }
      const currentState = contentLinkStatusRef.current[contentId];
      if (!options?.force && currentState?.lastUrl === trimmed && currentState?.provider === provider) {
        return;
      }
      if (provider === "tiktok") {
        void resolveTikTokLink(contentId, trimmed);
      } else if (provider === "pinterest") {
        void resolvePinterestLink(contentId, trimmed);
      }
    },
    [clearContentLinkStatus],
  );

  const handleMediaUrlInputChange = (contentId: string, value: string) => {
    handleContentChange(contentId, { mediaUrl: value });
    const trimmed = value.trim();
    if (!trimmed || !detectMediaLinkProvider(trimmed)) {
      clearContentLinkStatus(contentId);
    }
  };

  // TMDB helper para preencher legenda rapidamente
  const formatTmdbCaption = (info: {
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
  };

  const openTmdbModal = (contentId: string) => {
    setTmdbModal((prev) => ({
      ...prev,
      open: true,
      contentId,
      query: "",
      loading: false,
      result: null,
      error: null,
    }));
  };

  const searchTmdb = async () => {
    if (!tmdbModal.contentId || !tmdbModal.query.trim()) {
      setTmdbModal((prev) => ({ ...prev, error: "Informe o nome do filme ou série." }));
      return;
    }
    if (!apiKey) {
      setTmdbModal((prev) => ({ ...prev, error: "Gere sua chave de API REST para usar a busca TMDB." }));
      return;
    }
    setTmdbModal((prev) => ({ ...prev, loading: true, error: null, result: null }));
    try {
      const resp = await fetch(`/api/rest/tmdb?q=${encodeURIComponent(tmdbModal.query.trim())}`, {
        headers: { accept: "application/json", "x-api-key": apiKey },
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.resultado) {
        throw new Error(data?.mensagem || "Nenhum resultado encontrado.");
      }
      const r = data.resultado;
      const caption = formatTmdbCaption({
        title:
          r.title ||
          r.name ||
          r.original_title ||
          r.original_name ||
          "Título não disponível",
        date: r.release_date || r.first_air_date || null,
        rating: typeof r.vote_average === "number" ? r.vote_average : null,
        genres:
          Array.isArray(r.genres) && r.genres.length
            ? r.genres.map((g: any) => g?.name).filter(Boolean).join(", ")
            : null,
        overview: r.overview || null,
      });
      setTmdbModal((prev) => ({
        ...prev,
        loading: false,
        result: {
          title: r.title || r.name || r.original_title || r.original_name || "Título não disponível",
          overview: r.overview || "Nenhuma descrição disponível.",
          poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
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
  };

  const applyTmdbResultToCaption = () => {
    if (!tmdbModal.contentId || !tmdbModal.result) return;
    const text =
      tmdbModal.result.caption ||
      formatTmdbCaption({
        title: tmdbModal.result.title,
        overview: tmdbModal.result.overview,
      });
    handleContentChange(tmdbModal.contentId, { caption: text });
    setTmdbModal((prev) => ({ ...prev, open: false }));
  };

  useEffect(() => {
    if (!showForm) {
      return;
    }
    draft.contents.forEach((content) => {
      const currentLink = content.mediaUrl?.trim();
      if (!currentLink) {
        return;
      }
      const provider = detectMediaLinkProvider(currentLink);
      if (!provider) {
        return;
      }
      const snapshot = contentLinkStatusRef.current[content.id];
      if (
        (snapshot?.lastUrl === currentLink && snapshot?.provider === provider) ||
        snapshot?.processing
      ) {
        return;
      }
      handleMediaUrlBlur(content.id, currentLink, { force: !snapshot });
    });
  }, [showForm, draft.contents, handleMediaUrlBlur]);

  const renderTargets = () => {
    if (!selectedCampaign) {
      return <p className="text-muted">Selecione uma campanha para visualizar os destinos.</p>;
    }
    return (
      <Table responsive striped bordered hover size="sm" className="mb-3">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Instância</th>
            <th>Grupo / destino</th>
            <th>Menções / visibilidade</th>
          </tr>
        </thead>
        <tbody>
          {selectedCampaign.targets.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-muted text-center">
                {currentMode === "status"
                  ? "Nenhum destino configurado ainda. Edite o status para adicionar instâncias."
                  : "Nenhum destino configurado ainda. Edite a campanha para adicionar grupos ou status."}
              </td>
            </tr>
          ) : (
            selectedCampaign.targets.map((target) => {
              const instanceLabel = instanceMap.get(target.instanceId)?.name ?? `Instância ${target.instanceId}`;
              const groupLabel =
                target.type === "group"
                  ? target.audience?.title ??
                    groups.find((group) => group.id === target.groupId)?.name ??
                    target.remoteId ??
                    target.inviteLink ??
                    "Grupo não encontrado"
                  : "Status do WhatsApp";
              return (
                <tr key={target.id}>
                  <td>
                    <Badge bg={target.type === "group" ? "primary" : "success"}>
                      {target.type === "group" ? "Grupo" : "Status"}
                    </Badge>
                  </td>
                  <td>{instanceLabel}</td>
                  <td>
                    <div>{groupLabel}</div>
                    {target.inviteLink && (
                      <small className="text-muted">{target.inviteLink}</small>
                    )}
                  </td>
                  <td>
                    {target.type === "group" ? (
                      target.mentionAll ? (
                        <Badge bg="warning" text="dark">
                          @Todos
                        </Badge>
                      ) : target.mentions && target.mentions.length > 0 ? (
                        target.mentions.join(", ")
                      ) : (
                        "—"
                      )
                    ) : (
                      describeStatusVisibility(target.statusConfig)
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
    );
  };

  const renderTargetTypeStep = () => (
    <>
      <Row className="g-3 mb-4">
        {destinationCards.map((card) => (
          <Col md={6} key={card.type}>
            <Card
              className={`h-100 ${wizardTargetType === card.type ? "border-primary shadow-sm" : ""}`}
              role="button"
              onClick={() => handleSelectTargetType(card.type)}
            >
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <div className="fw-bold">{card.title}</div>
                  {wizardTargetType === card.type && (
                    <Badge bg="primary" pill>
                      Selecionado
                    </Badge>
                  )}
                </div>
                <p className="text-muted mb-1">{card.description}</p>
                <small className="text-secondary">{card.hint}</small>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
      <Alert variant={wizardTargetType ? "success" : "info"}>
        {wizardTargetType
          ? `Você escolheu enviar esta campanha para ${
              wizardTargetType === "group" ? "grupos" : "status"
            }. Avance para configurar os destinos.`
          : "Selecione se a campanha será disparada em grupos ou nos status do WhatsApp."}
      </Alert>
    </>
  );

  const renderDestinationStep = () => {
    if (!wizardTargetType) {
      return (
        <Alert variant="warning">
          Escolha primeiro se a campanha será para grupos ou status. Volte para a etapa anterior.
        </Alert>
      );
    }
    return (
      <>
        <Row className="g-3 mb-4">
          <Col md={12}>
            <Form.Label>Nome</Form.Label>
            <Form.Control
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Promoção especial"
            />
          </Col>
        </Row>
        {wizardTargetType === "group" && (
          <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
            <Button variant="outline-primary" size="sm" onClick={openDiscoveryModal} disabled={!apiKey}>
              <IconPlus size={16} className="me-1" /> Buscar grupos públicos
            </Button>
            {!apiKey && <span className="text-muted small">Gere sua chave de API em Configurações &gt; API REST para habilitar o buscador.</span>}
          </div>
        )}
        {draft.targets.map((target, index) => {
          const availableGroups =
            wizardTargetType === "group" && target.instanceId
              ? groupsByInstance.get(Number(target.instanceId)) ?? []
              : groups;
          return (
            <Card key={target.id} className="mb-3">
              <Card.Header className="d-flex justify-content-between align-items-center">
                <div>
                  <strong>Destino {index + 1}</strong>
                  <small className="d-block text-muted">
                    {wizardTargetType === "group" ? "Envio para grupos" : "Envio para status"}
                  </small>
                </div>
                {draft.targets.length > 1 && (
                  <Button size="sm" variant="outline-danger" onClick={() => handleRemoveTargetRow(target.id)}>
                    <IconTrash size={16} />
                  </Button>
                )}
              </Card.Header>
              <Card.Body>
                <Row className="g-3 align-items-end">
                  <Col md={4}>
                    <Form.Label>Instância</Form.Label>
                    <Form.Select
                      value={target.instanceId}
                      onChange={(event) =>
                        handleTargetFieldChange(target.id, {
                          instanceId: event.target.value,
                          groupId: "",
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {instances.map((instance) => (
                        <option key={instance.id} value={instance.id}>
                          {instance.name}
                        </option>
                      ))}
                    </Form.Select>
                    {wizardTargetType === "group" && (
                      <Form.Check
                        type="switch"
                        id={`mention-target-${target.id}`}
                        label="Mencionar todos"
                        className="mt-2"
                        checked={target.mentionAll}
                        onChange={(event) =>
                          handleTargetFieldChange(target.id, { mentionAll: event.target.checked })
                        }
                      />
                    )}
                  </Col>
                  {wizardTargetType === "group" && target.origin === "saved" && (
                    <>
                      <Col md={4}>
                        <Form.Label>Grupo sincronizado</Form.Label>
                        <Form.Select
                          value={target.groupId}
                          onChange={(event) =>
                            handleTargetFieldChange(target.id, { groupId: event.target.value })
                          }
                        >
                          <option value="">Selecione</option>
                          {availableGroups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </Form.Select>
                      </Col>
                    </>
                  )}
                  {wizardTargetType === "group" && target.origin === "discovery" && (
                    <Col md={12}>
                      <Alert variant="light" className="d-flex flex-column gap-2">
                        <div>
                          <div className="fw-semibold">{target.audience?.title || target.inviteLink}</div>
                          <div className="small text-muted">{target.inviteLink}</div>
                          {target.audience?.description && (
                            <div className="small text-muted mt-1">{target.audience.description}</div>
                          )}
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => handleReinspectTarget(target.id)}
                            disabled={reinspectTargetId === target.id}
                          >
                            {reinspectTargetId === target.id ? (
                              <Spinner animation="border" size="sm" className="me-1" />
                            ) : (
                              <IconSearch size={14} className="me-1" />
                            )}
                            Revalidar link
                          </Button>
                        </div>
                      </Alert>
                    </Col>
                  )}
                  {wizardTargetType === "status" && (
                    <Col md={12}>
                      <Alert variant="info" className="mb-0">
                        Os status seguem a privacidade padrão da instância. Estamos trabalhando para habilitar filtros
                        personalizados em uma atualização futura.
                      </Alert>
                    </Col>
                  )}
                </Row>
              </Card.Body>
            </Card>
          );
        })}
        {allowMultipleTargets || draft.targets.length === 0 ? (
          <div className="text-end">
            <Button
              variant="outline-primary"
              onClick={handleAddTargetRow}
              disabled={!allowMultipleTargets && draft.targets.length >= 1}
            >
              Adicionar outro destino
            </Button>
          </div>
        ) : (
          <Alert variant="info" className="mt-3">
            Apenas uma instância está disponível no momento, portanto só é possível configurar um destino.
          </Alert>
        )}
      </>
    );
  };

  const renderScheduleStep = () => (
    <>
      <Row className="g-3 mb-4">
        {scheduleCards.map((card) => (
          <Col md={4} key={card.kind}>
            <Card
              className={`h-100 ${draft.scheduleKind === card.kind ? "border-primary shadow-sm" : ""}`}
              role="button"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  scheduleKind: card.kind as DraftCampaign["scheduleKind"],
                }))
              }
            >
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <div className="fw-bold">{card.title}</div>
                  {draft.scheduleKind === card.kind && (
                    <Badge bg="primary" pill>
                      Selecionado
                    </Badge>
                  )}
                </div>
                <p className="text-muted mb-0">{card.description}</p>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
      <Row className="g-3 mb-4">
        {draft.scheduleKind === "recurring" && (
          <Col md={4}>
            <Form.Label>Intervalo (minutos)</Form.Label>
            <Form.Control
              type="number"
              min={5}
              value={draft.everyMinutes ? String(draft.everyMinutes) : ""}
              placeholder="1440"
              onChange={(event) => {
                const nextValue = event.target.value;
                setDraft((prev) => ({
                  ...prev,
                  everyMinutes: nextValue === "" ? undefined : Number(nextValue),
                }));
              }}
            />
          </Col>
        )}
        {draft.scheduleKind === "window" && (
          <Col md={4}>
            <Form.Label>Horários (HH:MM)</Form.Label>
            <Form.Control
              value={draft.times ?? ""}
              placeholder="08:00, 12:00, 18:00"
              onChange={(event) => setDraft((prev) => ({ ...prev, times: event.target.value }))}
            />
            <Form.Text className="text-muted">
              Use vírgula para separar vários horários do mesmo dia.
            </Form.Text>
          </Col>
        )}
        <Col md={4}>
          <Form.Label>Fuso horário</Form.Label>
          <Form.Control
            value={draft.timezone ?? ""}
            placeholder="America/Sao_Paulo"
            onChange={(event) => setDraft((prev) => ({ ...prev, timezone: event.target.value }))}
          />
        </Col>
      </Row>
      <div className="p-3 border rounded mb-4 bg-light">
        <Form.Check
          type="switch"
          id="enable-date-range"
          label="Definir início e término do anúncio (opcional)"
          checked={dateRangeEnabled}
          onChange={(event) => {
            const enabled = event.target.checked;
            setDateRangeEnabled(enabled);
            if (!enabled) {
              setDraft((prev) => ({ ...prev, startAt: undefined, endAt: undefined }));
            }
          }}
        />
        {dateRangeEnabled && (
          <Row className="g-3 mt-2">
            <Col md={6}>
              <Form.Label>Início</Form.Label>
              <Form.Control
                type="datetime-local"
                value={draft.startAt ?? ""}
                onChange={(event) => setDraft((prev) => ({ ...prev, startAt: event.target.value }))}
              />
            </Col>
            <Col md={6}>
              <Form.Label>Término</Form.Label>
              <Form.Control
                type="datetime-local"
                value={draft.endAt ?? ""}
                onChange={(event) => setDraft((prev) => ({ ...prev, endAt: event.target.value }))}
              />
            </Col>
          </Row>
        )}
        <Form.Text className="text-muted">
          Se não habilitar, a campanha permanece ativa até ser pausada ou excluída manualmente.
        </Form.Text>
      </div>
      <Alert variant="info">
        Campanhas recorrentes para status substituem o post anterior automaticamente. Assim que você salvar, enviamos o
        primeiro status e seguimos a frequência configurada.
      </Alert>
    </>
  );

  const hideStatusDeleteField = wizardTargetType === "status" && draft.scheduleKind === "recurring";

  const getPreviewKindForContent = (content: DraftCampaignContent): "text" | "image" | "video" | "audio" | "document" => {
    if (content.type === "status") {
      return content.statusType;
    }
    if (content.type === "affiliate_ml") {
      return "text";
    }
    return content.type;
  };

  const renderContentPreviewPanel = (content: DraftCampaignContent, linkState?: ContentLinkState) => {
    if (content.type === "affiliate_ml") {
      return (
        <div className="border rounded p-3 bg-light">
          <div className="fw-semibold mb-1">Prévia dinâmica Mercado Livre</div>
          <small className="text-muted d-block mb-2">
            O produto será escolhido automaticamente no momento do envio.
          </small>
          <div className="small text-muted">
            <div>Busca: {content.affiliateQuery?.trim() || "—"}</div>
            <div>Filtro: {content.affiliateFilter ?? "relevance"}</div>
            <div>Limite: {content.affiliateLimit ?? 20}</div>
            <div>Envio ativo: {content.affiliateDispatchEnabled === false ? "Não" : "Sim"}</div>
            <div>
              Intervalo mínimo entre envios:{" "}
              {Math.max(0, Math.floor(content.affiliateDispatchIntervalMinutes ?? 0))} min
            </div>
            <div>
              Rotação por categoria: {content.affiliateCategoryRotationEnabled === false ? "Não" : "Sim"}
            </div>
            <div>Apenas disponíveis: {content.affiliatePreferAvailable === false ? "Não" : "Sim"}</div>
            <div>Enviar imagem: {content.affiliateIncludeImage === false ? "Não" : "Sim"}</div>
            <div>Botão de URL: {content.affiliateIncludeUrlButton === false ? "Não" : "Sim"}</div>
            <div>Exigir link afiliado cadastrado: {content.affiliateRequireLink === false ? "Não" : "Sim"}</div>
          </div>
          {content.affiliateIntroText?.trim() ? (
            <div className="mt-2 small" style={{ whiteSpace: "pre-wrap" }}>
              Intro: {content.affiliateIntroText}
            </div>
          ) : null}
        </div>
      );
    }

    if (content.type === "buttons") {
      const headerUrl = content.buttonHeaderUrl?.trim();
      const headerKind = content.buttonHeaderKind ?? "image";
      const style = content.buttonStyle ?? "reply";
      const replyButtons = content.replyButtons ?? [];
      const ctaButtons = content.ctaButtons ?? [];
      return (
        <div className="border rounded p-3 bg-light">
          {headerUrl ? (
            <div className="ratio ratio-16x9 bg-dark rounded overflow-hidden mb-3">
              <img
                src={headerUrl}
                alt="Prévia do cabeçalho"
                className="w-100 h-100"
                style={{ objectFit: headerKind === "video" ? "contain" : "cover" }}
              />
            </div>
          ) : null}
          {content.buttonTitle ? <div className="fw-semibold mb-1">{content.buttonTitle}</div> : null}
          <div className="text-break mb-3" style={{ whiteSpace: "pre-wrap" }}>
            {content.buttonBody?.trim() || "Mensagem exibida antes dos botões."}
          </div>
          <div className="d-flex flex-column gap-2">
            {style === "reply"
              ? replyButtons.map((button) => (
                  <Button key={button.id} variant="outline-primary" size="sm" className="w-100" disabled>
                    {button.text || button.label || button.id}
                  </Button>
                ))
              : ctaButtons.map((button) => (
                  <div key={button.id} className="border rounded px-3 py-2 bg-white d-flex justify-content-between">
                    <div>{button.text}</div>
                    <small className="text-muted">
                      {button.type === "cta_url"
                        ? "Abrir link"
                        : button.type === "cta_call"
                          ? "Ligar"
                          : "Copiar"}
                    </small>
                  </div>
                ))}
            {style === "reply" && replyButtons.length === 0 ? (
              <small className="text-muted">Adicione botões para visualizar a prévia.</small>
            ) : null}
            {style === "cta" && ctaButtons.length === 0 ? (
              <small className="text-muted">Cadastre botões CTA para exibir aqui.</small>
            ) : null}
          </div>
          {content.buttonFooter ? (
            <small className="text-muted d-block mt-3">{content.buttonFooter}</small>
          ) : null}
        </div>
      );
    }
    const previewKind = linkState?.preview?.kind ?? getPreviewKindForContent(content);
    const previewTitle = linkState?.preview?.title;
    const resolvedUrl = linkState?.preview?.resolvedUrl ?? content.mediaUrl?.trim() ?? "";
    const thumbnailUrl = linkState?.preview?.thumbnail ?? resolvedUrl;
    const caption = content.caption?.trim();
    const textValue = content.text?.trim() || content.caption?.trim() || "";

    let body: ReactNode = null;
    if (previewKind === "text") {
      body = textValue ? (
        <div className="border rounded bg-white p-3 text-break" style={{ whiteSpace: "pre-wrap" }}>
          {textValue}
        </div>
      ) : (
        <small className="text-muted">Informe o texto para visualizar a prévia.</small>
      );
    } else if (previewKind === "image") {
      if (resolvedUrl || thumbnailUrl) {
        body = (
          <div className="ratio ratio-16x9 bg-dark rounded overflow-hidden">
            <img
              src={resolvedUrl || thumbnailUrl}
              alt="Prévia da imagem"
              className="w-100 h-100"
              style={{ objectFit: "cover" }}
            />
          </div>
        );
      } else {
        body = <small className="text-muted">Adicione o link ou faça upload para gerar a prévia da imagem.</small>;
      }
    } else if (previewKind === "video") {
      if (resolvedUrl) {
        body = (
          <video controls className="w-100 rounded" src={resolvedUrl} poster={thumbnailUrl || undefined}>
            <track kind="captions" />
          </video>
        );
      } else if (thumbnailUrl) {
        body = (
          <div className="ratio ratio-16x9 bg-dark rounded overflow-hidden">
            <img src={thumbnailUrl} alt="Prévia do vídeo" className="w-100 h-100" style={{ objectFit: "cover" }} />
          </div>
        );
      } else {
        body = <small className="text-muted">Informe um link válido para pré-visualizar o vídeo.</small>;
      }
    } else if (previewKind === "audio") {
      body = resolvedUrl ? (
        <audio controls className="w-100" src={resolvedUrl}>
          Seu navegador não suporta o elemento de áudio.
        </audio>
      ) : (
        <small className="text-muted">Forneça o link do áudio para ouvir a prévia.</small>
      );
    } else if (previewKind === "document") {
      body = resolvedUrl ? (
        <div className="d-flex flex-column gap-2">
          <small className="text-muted">Documento pronto para envio.</small>
          <div>
            <a href={resolvedUrl} target="_blank" rel="noreferrer" className="btn btn-outline-primary btn-sm">
              Abrir documento
            </a>
          </div>
        </div>
      ) : (
        <small className="text-muted">Envie o arquivo ou informe o link do documento para gerar a prévia.</small>
      );
    }

    if (!body) {
      body = <small className="text-muted">Prévia indisponível para este tipo de conteúdo.</small>;
    }

    return (
      <div className="border rounded p-3 bg-light">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="fw-semibold">Prévia</span>
          {previewTitle ? <small className="text-muted text-truncate ms-2">{previewTitle}</small> : null}
        </div>
        {body}
        {caption && previewKind !== "text" ? (
          <small className="text-muted d-block mt-2">Legenda: {caption}</small>
        ) : null}
      </div>
    );
  };

  const renderContentStep = () => (
    <>
      <div className="mb-3">
        <h6 className="mb-0">Conteúdos do anúncio</h6>
        <small className="text-muted">
          Combine textos, mídias, status e blocos afiliados. Eles serão disparados na ordem configurada.
        </small>
      </div>
      {wizardTargetType === "status" && (
        <Card className="mb-3">
          <Card.Body className="d-flex flex-column gap-3">
            <div className="d-flex flex-wrap gap-3 justify-content-between">
              <div>
                <Form.Check
                  type="switch"
                  id="status-randomizer-toggle"
                  label="Aleatorizar conteúdos a cada envio"
                  checked={draft.statusRandomizerEnabled}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      statusRandomizerEnabled: event.target.checked,
                    }))
                  }
                />
                <Form.Text className="text-muted">
                  Envia apenas alguns status por execução. Os itens marcados como fixos sempre entram na seleção.
                </Form.Text>
              </div>
              <div style={{ minWidth: 160 }}>
                <Form.Label className="mb-1">Quantidade por envio</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={50}
                  value={draft.statusRandomizerCount ?? ""}
                  disabled={!draft.statusRandomizerEnabled}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((prev) => ({
                      ...prev,
                      statusRandomizerCount:
                        value === ""
                          ? null
                          : Math.max(1, Math.min(50, Math.floor(Number(value)) || 1)),
                    }));
                  }}
                />
              </div>
            </div>
            <Form.Text className="text-muted">
              Defina cada status como fixo para garantir o envio mesmo com a aleatorização ativa.
            </Form.Text>
          </Card.Body>
        </Card>
      )}
      {wizardTargetType === "group" && (
        <Card className="mb-3">
          <Card.Body className="d-flex flex-column gap-3">
            <div className="d-flex flex-wrap gap-3 justify-content-between">
              <div>
                <Form.Check
                  type="switch"
                  id="group-randomizer-toggle"
                  label="Aleatorizar conteúdos para grupos"
                  checked={draft.groupRandomizerEnabled}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      groupRandomizerEnabled: event.target.checked,
                    }))
                  }
                />
                <Form.Text className="text-muted">
                  Dispara somente alguns conteúdos por execução para evitar excesso no grupo.
                </Form.Text>
              </div>
              <div style={{ minWidth: 160 }}>
                <Form.Label className="mb-1">Quantidade por envio</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={5}
                  value={draft.groupRandomizerCount ?? ""}
                  disabled={!draft.groupRandomizerEnabled}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((prev) => ({
                      ...prev,
                      groupRandomizerCount:
                        value === ""
                          ? null
                          : Math.max(1, Math.min(5, Math.floor(Number(value)) || 1)),
                    }));
                  }}
                />
              </div>
            </div>
            <Form.Text className="text-muted">
              Os envios usam um delay humanizado entre conteúdos para reduzir risco de ban.
            </Form.Text>
          </Card.Body>
        </Card>
      )}
      {wizardTargetType === "status" && (
        <Card className="mb-3">
          <Card.Body className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <div className="fw-semibold">Importar vários links</div>
              <small className="text-muted">Cole vários links de status em um passo único.</small>
            </div>
            <Button size="sm" variant="outline-primary" onClick={() => setShowBulkLinksModal(true)}>
              Importar links
            </Button>
          </Card.Body>
        </Card>
      )}
      {draft.contents.map((content, index) => {
        const linkState = contentLinkStatus[content.id];
        const explicitUploadVisibility = contentUploadVisibility[content.id];
        const shouldShowUploadPanel =
          explicitUploadVisibility == null ? Boolean(content.mediaPath) : explicitUploadVisibility;
        const isStandardMediaContent =
          content.type !== "text" &&
          content.type !== "buttons" &&
          content.type !== "affiliate_ml" &&
          !(content.type === "status" && content.statusType === "text");
        const headerVisibilityExplicit = buttonHeaderVisibility[content.id];
        const showHeaderFields =
          headerVisibilityExplicit == null
            ? Boolean(content.buttonHeaderUrl || content.buttonHeaderPath)
            : headerVisibilityExplicit;
        return (
          <Card key={content.id} className="mb-3">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <div>
                Conteúdo {index + 1}
                <small className="text-muted ms-2">
                  {content.type === "status"
                    ? `Status (${content.statusType})`
                    : content.type === "affiliate_ml"
                      ? "Afiliado Mercado Livre (auto)"
                    : content.type.toUpperCase()}
                </small>
              </div>
              <div className="d-flex gap-2">
                {wizardTargetType === "status" ? (
                  <Badge bg="success" className="d-flex align-items-center">
                    Status do WhatsApp
                  </Badge>
                ) : (
                  <Form.Select
                    size="sm"
                    value={content.type}
                    onChange={(event) =>
                      handleContentTypeChange(content.id, event.target.value as DraftCampaignContent["type"])
                    }
                  >
                    <option value="text">Texto</option>
                    <option value="image">Imagem</option>
                    <option value="video">Vídeo</option>
                    <option value="audio">Áudio</option>
                    <option value="document">Documento</option>
                    <option value="buttons">Botões interativos</option>
                    <option value="affiliate_ml">Afiliado ML (auto)</option>
                  </Form.Select>
                )}
                {content.type === "status" && content.alwaysSendWhenRandomized ? (
                  <Badge bg="warning" text="dark" className="d-flex align-items-center">
                    Fixo
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="outline-danger"
                  onClick={() => handleRemoveContentBlock(content.id)}
                  disabled={draft.contents.length <= 1}
                >
                  <IconTrash size={16} />
                </Button>
              </div>
            </Card.Header>
            <Card.Body>
              <Row className="g-3">
                {content.type === "status" && (
                  <Col md={4}>
                    <Form.Label>Tipo de status</Form.Label>
                    <Form.Select
                      value={content.statusType}
                      onChange={(event) =>
                        handleContentChange(content.id, {
                          statusType: event.target.value as DraftCampaignContent["statusType"],
                        })
                      }
                    >
                      <option value="text">Texto</option>
                      <option value="image">Imagem</option>
                      <option value="video">Vídeo</option>
                    </Form.Select>
                  </Col>
                )}
                {content.type === "status" && (
                  <Col md={4}>
                    <Form.Label className="d-block">Envio garantido</Form.Label>
                    <Form.Check
                      type="switch"
                      id={`status-pinned-${content.id}`}
                      label="Enviar sempre (modo aleatório)"
                      checked={Boolean(content.alwaysSendWhenRandomized)}
                      onChange={(event) =>
                        handleContentChange(content.id, {
                          alwaysSendWhenRandomized: event.target.checked,
                        })
                      }
                    />
                    <Form.Text className="text-muted">
                      Mantém este status mesmo quando o modo aleatório está ativado.
                    </Form.Text>
                  </Col>
                )}
                {(content.type === "text" ||
                  (content.type === "status" && content.statusType === "text")) && (
                  <Col md={12}>
                    <Form.Label>Mensagem</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={content.text ?? ""}
                      onChange={(event) => handleContentChange(content.id, { text: event.target.value })}
                    />
                  </Col>
                )}
                {content.type === "affiliate_ml" && (
                  <>
                    <Col md={6}>
                      <Form.Label>Produto para buscar</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="Ex.: iphone 15 256gb"
                        value={content.affiliateQuery ?? ""}
                        onChange={(event) =>
                          handleContentChange(content.id, { affiliateQuery: event.target.value })
                        }
                      />
                    </Col>
                    <Col md={3}>
                      <Form.Label>Filtro</Form.Label>
                      <Form.Select
                        value={content.affiliateFilter ?? "relevance"}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateFilter: event.target.value as DraftCampaignContent["affiliateFilter"],
                          })
                        }
                      >
                        <option value="relevance">Mais relevante</option>
                        <option value="cheapest">Menor preço</option>
                        <option value="free_shipping">Frete grátis</option>
                        <option value="sold">Mais vendido</option>
                        <option value="random">Aleatório</option>
                      </Form.Select>
                    </Col>
                    <Col md={3}>
                      <Form.Label>Limite de busca</Form.Label>
                      <Form.Control
                        type="number"
                        min={1}
                        max={50}
                        value={content.affiliateLimit ?? 20}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateLimit: Math.max(
                              1,
                              Math.min(50, Math.floor(Number(event.target.value) || 20)),
                            ),
                          })
                        }
                      />
                    </Col>
                    <Col md={3}>
                      <Form.Label>Temporizador entre envios (min)</Form.Label>
                      <Form.Control
                        type="number"
                        min={0}
                        max={1440}
                        value={Math.max(0, Math.floor(content.affiliateDispatchIntervalMinutes ?? 15))}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateDispatchIntervalMinutes: Math.max(
                              0,
                              Math.min(1440, Math.floor(Number(event.target.value) || 0)),
                            ),
                          })
                        }
                      />
                      <Form.Text className="text-muted">Use 0 para enviar sem intervalo adicional.</Form.Text>
                    </Col>
                    <Col md={12}>
                      <Form.Label>Texto introdutório (opcional)</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={2}
                        value={content.affiliateIntroText ?? ""}
                        placeholder="Ex.: Oferta automática do dia para o grupo"
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateIntroText: event.target.value,
                          })
                        }
                      />
                      <Form.Text className="text-muted">
                        A montagem final da mensagem usa o Modelo de mensagem com variáveis dinâmicas
                        (ex.: {"{{titulo}}"}, {"{{preco_formatado}}"}, {"{{url}}"}).
                      </Form.Text>
                    </Col>
                    <Col md={4}>
                      <Form.Check
                        type="switch"
                        id={`affiliate-dispatch-enabled-${content.id}`}
                        label="Ativar envio deste bloco"
                        checked={content.affiliateDispatchEnabled !== false}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateDispatchEnabled: event.target.checked,
                          })
                        }
                      />
                    </Col>
                    <Col md={4}>
                      <Form.Check
                        type="switch"
                        id={`affiliate-category-rotation-${content.id}`}
                        label="Separar por categoria"
                        checked={content.affiliateCategoryRotationEnabled !== false}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateCategoryRotationEnabled: event.target.checked,
                          })
                        }
                      />
                    </Col>
                    <Col md={4}>
                      <Form.Check
                        type="switch"
                        id={`affiliate-available-${content.id}`}
                        label="Priorizar produtos disponíveis"
                        checked={content.affiliatePreferAvailable !== false}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliatePreferAvailable: event.target.checked,
                          })
                        }
                      />
                    </Col>
                    <Col md={4}>
                      <Form.Check
                        type="switch"
                        id={`affiliate-image-${content.id}`}
                        label="Enviar imagem do produto"
                        checked={content.affiliateIncludeImage !== false}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateIncludeImage: event.target.checked,
                          })
                        }
                      />
                    </Col>
                    <Col md={4}>
                      <Form.Check
                        type="switch"
                        id={`affiliate-button-${content.id}`}
                        label="Usar botão de URL (se disponível)"
                        checked={content.affiliateIncludeUrlButton !== false}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateIncludeUrlButton: event.target.checked,
                          })
                        }
                      />
                    </Col>
                    <Col md={4}>
                      <Form.Check
                        type="switch"
                        id={`affiliate-require-link-${content.id}`}
                        label="Exigir link afiliado"
                        checked={content.affiliateRequireLink !== false}
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            affiliateRequireLink: event.target.checked,
                          })
                        }
                      />
                    </Col>
                    <Col md={12}>
                      <Form.Text className="text-muted">
                        Quando ativo, o disparo só envia produtos com link afiliado cadastrado no painel. A separação
                        por categoria usa histórico persistente em banco para reduzir repetição entre envios.
                      </Form.Text>
                    </Col>
                  </>
                )}
                {content.type === "buttons" && (
                  <>
                    <Col md={4}>
                      <Form.Label>Estilo dos botões</Form.Label>
                      <Form.Select
                        value={content.buttonStyle ?? "reply"}
                        onChange={(event) =>
                          handleButtonStyleChange(content.id, event.target.value as "reply" | "cta")
                        }
                      >
                        <option value="reply">Respostas rápidas</option>
                        <option value="cta">CTA (link, ligação ou copiar código)</option>
                      </Form.Select>
                    </Col>
                    <Col md={4}>
                      <Form.Label>Título (opcional)</Form.Label>
                      <Form.Control
                        type="text"
                        value={content.buttonTitle ?? ""}
                        onChange={(event) =>
                          handleContentChange(content.id, { buttonTitle: event.target.value })
                        }
                      />
                    </Col>
                    <Col md={4}>
                      <Form.Label>Rodapé (opcional)</Form.Label>
                      <Form.Control
                        type="text"
                        value={content.buttonFooter ?? ""}
                        onChange={(event) =>
                          handleContentChange(content.id, { buttonFooter: event.target.value })
                        }
                      />
                    </Col>
                    <Col md={12}>
                      <Form.Label>Mensagem exibida nos botões</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={content.buttonBody ?? ""}
                        placeholder="Texto principal mostrado antes das opções."
                        onChange={(event) =>
                          handleContentChange(content.id, { buttonBody: event.target.value })
                        }
                      />
                    </Col>
                    <Col md={12}>
                      <div className="d-flex flex-wrap gap-2 align-items-center">
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() =>
                            setButtonHeaderVisibility((prev) => ({
                              ...prev,
                              [content.id]: !showHeaderFields,
                            }))
                          }
                        >
                          {showHeaderFields ? "Ocultar cabeçalho" : "Adicionar mídia no cabeçalho"}
                        </Button>
                        {(content.buttonHeaderPath || content.buttonHeaderUrl) && !showHeaderFields ? (
                          <small className="text-secondary">
                            Cabeçalho atual: {content.buttonHeaderFileName || content.buttonHeaderPath}
                          </small>
                        ) : null}
                      </div>
                    </Col>
                    {showHeaderFields && (
                      <>
                        <Col md={4}>
                          <Form.Label>Tipo da mídia</Form.Label>
                          <Form.Select
                            value={content.buttonHeaderKind ?? "image"}
                            onChange={(event) =>
                              handleContentChange(content.id, {
                                buttonHeaderKind: event.target.value as "image" | "video",
                              })
                            }
                          >
                            <option value="image">Imagem</option>
                            <option value="video">Vídeo</option>
                          </Form.Select>
                        </Col>
                        <Col md={8}>
                          <Form.Label>Link do cabeçalho</Form.Label>
                          <Form.Control
                            type="url"
                            value={content.buttonHeaderUrl ?? ""}
                            placeholder="https://cdn.seudominio.com/capa.png"
                            onChange={(event) =>
                              handleContentChange(content.id, { buttonHeaderUrl: event.target.value })
                            }
                          />
                        </Col>
                        <Col md={12}>
                          <Form.Label className="fw-semibold">Upload opcional</Form.Label>
                          <Form.Control
                            type="file"
                            accept={content.buttonHeaderKind === "video" ? "video/*" : "image/*"}
                            onChange={(event) => {
                              const file = event.target.files?.[0] ?? null;
                              handleButtonHeaderFileChange(content.id, file);
                              event.currentTarget.value = "";
                            }}
                            disabled={buttonHeaderUploads[content.id]?.uploading}
                          />
                          {buttonHeaderUploads[content.id]?.uploading ? (
                            <small className="text-secondary d-flex align-items-center gap-2 mt-2">
                              <Spinner animation="border" size="sm" role="status" /> Enviando mídia...
                            </small>
                          ) : null}
                          {buttonHeaderUploads[content.id]?.error ? (
                            <div className="text-danger small mt-2">
                              {buttonHeaderUploads[content.id]?.error}
                            </div>
                          ) : null}
                          {content.buttonHeaderPath || content.buttonHeaderUrl ? (
                            <Button
                              size="sm"
                              variant="outline-danger"
                              className="mt-2"
                              onClick={() => handleRemoveButtonHeaderMedia(content.id)}
                            >
                              Remover cabeçalho
                            </Button>
                          ) : null}
                        </Col>
                      </>
                    )}
                    <Col md={12}>
                      {(content.buttonStyle ?? "reply") === "reply" ? (
                        <div className="d-flex flex-column gap-2 border rounded p-3">
                          {(content.replyButtons ?? []).map((button, btnIndex) => (
                            <div key={`reply-btn-${button.id}-${btnIndex}`} className="row g-2 align-items-center">
                              <div className="col-md-6">
                                <Form.Control
                                  type="text"
                                  value={button.text}
                                  placeholder={`Opção ${btnIndex + 1}`}
                                  onChange={(event) =>
                                    handleReplyButtonChange(content.id, btnIndex, {
                                      text: event.target.value,
                                      label: event.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div className="col-md-5">
                                <Form.Control
                                  type="text"
                                  value={button.id}
                                  placeholder="ID (opcional)"
                                  onChange={(event) =>
                                    handleReplyButtonChange(content.id, btnIndex, {
                                      id: event.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div className="col-md-1">
                                {(content.replyButtons ?? []).length > 1 ? (
                                  <Button
                                    variant="outline-danger"
                                    size="sm"
                                    onClick={() => handleRemoveReplyButton(content.id, btnIndex)}
                                  >
                                    <IconTrash size={14} />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                          {(content.replyButtons ?? []).length < 3 ? (
                            <Button
                              size="sm"
                              variant="outline-primary"
                              onClick={() => handleAddReplyButton(content.id)}
                            >
                              Adicionar botão
                            </Button>
                          ) : null}
                          <Form.Text className="text-muted">
                            O WhatsApp permite até 3 botões de resposta rápida.
                          </Form.Text>
                        </div>
                      ) : (
                        <div className="d-flex flex-column gap-3 border rounded p-3">
                          {(content.ctaButtons ?? []).map((button, btnIndex) => (
                            <div key={`cta-btn-${button.id}-${btnIndex}`} className="border rounded p-3">
                              <div className="row g-2 align-items-center">
                                <div className="col-md-4">
                                  <Form.Control
                                    type="text"
                                    value={button.text}
                                    placeholder={`Botão ${btnIndex + 1}`}
                                    onChange={(event) =>
                                      handleCtaButtonChange(content.id, btnIndex, {
                                        text: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="col-md-3">
                                  <Form.Select
                                    value={button.type}
                                    onChange={(event) =>
                                      handleCtaButtonChange(content.id, btnIndex, {
                                        type: event.target.value as CtaButtonDraft["type"],
                                      })
                                    }
                                  >
                                    <option value="cta_url">Abrir link</option>
                                    <option value="cta_call">Iniciar ligação</option>
                                    <option value="cta_copy">Copiar código</option>
                                  </Form.Select>
                                </div>
                                <div className="col-md-3">
                                  <Form.Control
                                    type="text"
                                    value={button.id}
                                    placeholder="ID (opcional)"
                                    onChange={(event) =>
                                      handleCtaButtonChange(content.id, btnIndex, {
                                        id: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="col-md-2">
                                  {(content.ctaButtons ?? []).length > 1 ? (
                                    <Button
                                      variant="outline-danger"
                                      size="sm"
                                      onClick={() => handleRemoveCtaButton(content.id, btnIndex)}
                                    >
                                      <IconTrash size={14} />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mt-2">
                                {button.type === "cta_url" ? (
                                  <Form.Control
                                    type="url"
                                    value={button.url ?? ""}
                                    placeholder="https://seusite.com/oferta"
                                    onChange={(event) =>
                                      handleCtaButtonChange(content.id, btnIndex, {
                                        url: event.target.value,
                                      })
                                    }
                                  />
                                ) : button.type === "cta_call" ? (
                                  <Form.Control
                                    type="tel"
                                    value={button.phoneNumber ?? ""}
                                    placeholder="+5511999999999"
                                    onChange={(event) =>
                                      handleCtaButtonChange(content.id, btnIndex, {
                                        phoneNumber: event.target.value,
                                      })
                                    }
                                  />
                                ) : (
                                  <Form.Control
                                    type="text"
                                    value={button.copyCode ?? ""}
                                    placeholder="Código que será copiado"
                                    onChange={(event) =>
                                      handleCtaButtonChange(content.id, btnIndex, {
                                        copyCode: event.target.value,
                                      })
                                    }
                                  />
                                )}
                              </div>
                            </div>
                          ))}
                          {(content.ctaButtons ?? []).length < 3 ? (
                            <Button
                              size="sm"
                              variant="outline-primary"
                              onClick={() => handleAddCtaButton(content.id)}
                            >
                              Adicionar botão
                            </Button>
                          ) : null}
                          <Form.Text className="text-muted">
                            Utilize até 3 CTAs combinando links, ligações ou códigos para copiar.
                          </Form.Text>
                        </div>
                      )}
                    </Col>
                  </>
                )}
                {isStandardMediaContent && (
                  <>
                    <Col md={6}>
                      <Form.Label>Link da mídia (URL)</Form.Label>
                      <Form.Control
                        type="url"
                        value={content.mediaUrl ?? ""}
                        placeholder="https://cdn.seudominio.com/arquivo.mp4"
                        onChange={(event) =>
                          handleMediaUrlInputChange(content.id, event.target.value)
                        }
                        onBlur={(event) => handleMediaUrlBlur(content.id, event.target.value)}
                      />
                      <Form.Text className="text-muted d-block">
                        Preferimos links diretos ou CDN para economizar armazenamento. Links do TikTok são resolvidos
                        automaticamente.
                      </Form.Text>
                      {linkState?.processing ? (
                        <small className="text-secondary d-flex align-items-center gap-2 mt-2">
                          <Spinner animation="border" size="sm" role="status" />
                          {`Processando link do ${linkState.provider === "pinterest" ? "Pinterest" : "TikTok"}...`}
                        </small>
                      ) : null}
                      {linkState?.message ? (
                        <div className="text-success small mt-2">{linkState.message}</div>
                      ) : null}
                      {linkState?.error ? (
                        <div className="text-danger small mt-2">{linkState.error}</div>
                      ) : null}
                    </Col>
                    <Col md={6}>
                      <div className="d-flex align-items-center justify-content-between">
                        <Form.Label className="mb-0">Legenda</Form.Label>
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          className="d-inline-flex align-items-center gap-1"
                          onClick={() => openTmdbModal(content.id)}
                          title="Buscar filme/série no TMDB"
                        >
                          <IconMovie size={16} />
                          TMDB
                        </Button>
                      </div>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={content.caption ?? ""}
                        onChange={(event) =>
                          handleContentChange(content.id, { caption: event.target.value })
                        }
                      />
                      <Form.Text className="text-muted">
                        Dica: use o botão TMDB para preencher rapidamente com sinopse.
                      </Form.Text>
                    </Col>
                    <Col md={12}>
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() =>
                            setContentUploadVisibility((prev) => ({
                              ...prev,
                              [content.id]: !shouldShowUploadPanel,
                            }))
                          }
                        >
                          {shouldShowUploadPanel ? "Ocultar upload opcional" : "Enviar arquivo (opcional)"}
                        </Button>
                        {content.mediaPath && !shouldShowUploadPanel ? (
                          <small className="text-secondary">
                            Arquivo atual: {content.mediaFileName || content.mediaPath}
                          </small>
                        ) : null}
                      </div>
                      {shouldShowUploadPanel && (
                        <div className="border rounded p-3 mt-2 bg-light">
                          <Form.Label className="fw-semibold">Upload opcional</Form.Label>
                          {content.mediaPath ? (
                            <div className="text-secondary small mb-2">
                              Arquivo atual: {content.mediaFileName || content.mediaPath}
                            </div>
                          ) : (
                            <Form.Text className="text-secondary d-block mb-2">
                              Caso prefira, envie o arquivo diretamente. Essa opção consome armazenamento local.
                            </Form.Text>
                          )}
                          <Form.Control
                            type="file"
                            accept={getAcceptForContent(content)}
                            onChange={(event) => {
                              const file = event.target.files?.[0] ?? null;
                              handleContentFileChange(content.id, file);
                              event.currentTarget.value = "";
                            }}
                            disabled={contentUploads[content.id]?.uploading}
                          />
                          {contentUploads[content.id]?.uploading ? (
                            <small className="text-secondary d-flex align-items-center gap-2 mt-2">
                              <Spinner animation="border" size="sm" role="status" /> Enviando mídia...
                            </small>
                          ) : null}
                          {contentUploads[content.id]?.error ? (
                            <div className="text-danger small mt-2">
                              {contentUploads[content.id]?.error}
                            </div>
                          ) : null}
                          {content.mediaPath ? (
                            <Button
                              size="sm"
                              variant="outline-danger"
                              className="mt-2"
                              onClick={() => handleRemoveUploadedMedia(content.id)}
                            >
                              Remover arquivo
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </Col>
                  </>
                )}
              {content.type === "status" && (
                <>
                  {!hideStatusDeleteField ? (
                    <Col md={4}>
                      <Form.Label>Apagar após (min)</Form.Label>
                      <Form.Control
                        type="number"
                        value={content.statusDeleteAfter ?? ""}
                        placeholder="1440"
                        onChange={(event) =>
                          handleContentChange(content.id, {
                            statusDeleteAfter: event.target.value ? Number(event.target.value) : undefined,
                          })
                        }
                      />
                    </Col>
                  ) : (
                    <Col md={12} className="d-flex align-items-end">
                      <small className="text-muted">
                        Em campanhas recorrentes o status anterior é removido automaticamente a cada novo envio.
                      </small>
                    </Col>
                  )}
                </>
              )}
              <Col md={12}>{renderContentPreviewPanel(content, linkState)}</Col>
            </Row>
          </Card.Body>
        </Card>
        );
      })}
    </>
  );

  return (
    <>
      {feedback ? (
        <Alert
          variant={feedback.type === "danger" ? "danger" : feedback.type === "success" ? "success" : "info"}
          className="mb-3"
        >
          {feedback.message}
        </Alert>
      ) : null}
      <Row className="g-3 align-items-stretch">
        {!isDetailLayout ? (
          <Col lg={4}>
            <div className="border rounded-3 bg-white p-3 h-100 d-flex flex-column">
              <Stack gap={2} className="mb-3">
                <Form.Control
                  type="search"
                  placeholder="Buscar campanha..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
                <Form.Select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                >
                  <option value="all">Todos os status</option>
                  <option value="running">Ativos</option>
                  <option value="paused">Pausados</option>
                  <option value="scheduled">Agendados</option>
                  <option value="draft">Rascunhos</option>
                  <option value="completed">Concluídos</option>
                </Form.Select>
              </Stack>
              {visibleCampaigns.length === 0 ? (
                <div className="text-center text-muted py-4">
                  {currentMode === "status"
                    ? "Nenhum status programado."
                    : "Nenhuma campanha cadastrada."}
                </div>
              ) : (
                <div className="d-flex flex-column gap-2" style={{ maxHeight: 620, overflowY: "auto" }}>
                  {visibleCampaigns.map((campaign) => (
                    <button
                      key={campaign.id}
                      type="button"
                      className={`border rounded-3 p-3 text-start w-100 ${
                        selectedId === campaign.id ? "border-success bg-success bg-opacity-10" : "bg-white"
                      }`}
                      onClick={() => {
                        setSelectedId(campaign.id);
                        handleOpenForm(campaign);
                      }}
                    >
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <div className="fw-semibold text-truncate">{campaign.name || "Campanha sem nome"}</div>
                        <Badge
                          bg={
                            campaign.status === "running"
                              ? "success"
                              : campaign.status === "paused"
                                ? "warning"
                                : campaign.status === "scheduled"
                                  ? "info"
                                  : "secondary"
                          }
                          text={campaign.status === "paused" ? "dark" : undefined}
                        >
                          {campaign.status}
                        </Badge>
                      </div>
                      <small className="text-muted d-block">{formatSchedule(campaign)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Col>
        ) : null}
        <Col lg={isDetailLayout ? 12 : 8}>
          {showForm ? (
            <Card className="shadow-sm border-0 h-100">
              <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                  <div className="fw-bold">
                    {draft.id
                      ? currentMode === "status"
                        ? "Editar status"
                        : "Editar campanha"
                      : currentMode === "status"
                        ? "Novo status"
                        : "Nova campanha"}
                  </div>
                </div>
              </Card.Header>
              <Card.Body className="overflow-auto">
                <Form className="d-flex flex-column gap-3">
                  {hasTargetTypeStep ? (
                    <div className="border rounded p-3">
                      <div className="fw-semibold mb-3">Tipo de destino</div>
                      {renderTargetTypeStep()}
                    </div>
                  ) : null}
                  {wizardTargetType ? (
                    <>
                      <div className="border rounded p-3">
                        <div className="fw-semibold mb-3">Destinos</div>
                        {renderDestinationStep()}
                      </div>
                      <div className="border rounded p-3">
                        <div className="fw-semibold mb-3">Agendamento</div>
                        {renderScheduleStep()}
                      </div>
                      <div className="border rounded p-3">
                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                          <div className="fw-semibold">Conteúdo</div>
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            {wizardTargetType !== "status" ? (
                              <Form.Select
                                size="sm"
                                value={nextContentType}
                                onChange={(event) =>
                                  setNextContentType(event.target.value as DraftCampaignContent["type"])
                                }
                              >
                                <option value="text">Texto</option>
                                <option value="image">Imagem</option>
                                <option value="video">Vídeo</option>
                                <option value="audio">Áudio</option>
                                <option value="document">Documento</option>
                                <option value="buttons">Botões interativos</option>
                                <option value="affiliate_ml">Afiliado ML (auto)</option>
                              </Form.Select>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline-primary"
                              disabled={reachedContentLimit}
                              onClick={() =>
                                handleAddContentBlock(wizardTargetType === "status" ? "status" : nextContentType)
                              }
                            >
                              Adicionar conteúdo
                            </Button>
                          </div>
                        </div>
                        {renderContentStep()}
                      </div>
                    </>
                  ) : (
                    <Alert variant="info" className="mb-0">
                      Selecione o tipo de destino para continuar.
                    </Alert>
                  )}
                </Form>
                {wizardError ? (
                  <Alert variant="danger" className="mt-3 mb-0">
                    {wizardError}
                  </Alert>
                ) : null}
              </Card.Body>
              <Card.Footer className="d-flex justify-content-end gap-2">
                <Button variant="outline-secondary" onClick={handleCloseForm}>
                  Cancelar
                </Button>
                <Button variant="primary" onClick={handleSaveDraft} disabled={isSubmitting}>
                  {isSubmitting
                    ? "Salvando..."
                    : currentMode === "status"
                      ? "Salvar status"
                      : "Salvar campanha"}
                </Button>
              </Card.Footer>
            </Card>
          ) : selectedCampaign ? (
            <Card className="shadow-sm border-0 h-100">
              <Card.Header className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div>
                  <h5 className="mb-0">{selectedCampaign.name || "Campanha sem nome"}</h5>
                </div>
                <div className="d-flex gap-2 align-items-center flex-wrap">
                  <Badge bg="light" text="dark" className="text-uppercase">
                    {selectedCampaign.status}
                  </Badge>
                  <Form.Check
                    type="switch"
                    id={`toggle-campaign-${selectedCampaign.id}`}
                    label={selectedCampaignIsActive ? "Ativo" : "Pausado"}
                    checked={selectedCampaignIsActive}
                    disabled={selectedCampaignToggleDisabled || statusUpdatingId === selectedCampaign.id}
                    onChange={(event) => {
                      void handleToggleCampaignStatus(selectedCampaign, event.target.checked);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={manualDispatchingId === selectedCampaign.id}
                    onClick={() => {
                      void handleManualResend(selectedCampaign);
                    }}
                  >
                    {manualDispatchingId === selectedCampaign.id ? "Reenviando..." : "Reenviar"}
                  </Button>
                  <Button size="sm" variant="outline-primary" onClick={() => handleOpenForm(selectedCampaign)}>
                    Configurar
                  </Button>
                  <Button size="sm" variant="outline-success" onClick={() => handleCloneCampaign(selectedCampaign)}>
                    Clonar
                  </Button>
                  <Button size="sm" variant="outline-danger" onClick={() => handleDeleteCampaign(selectedCampaign)}>
                    Remover
                  </Button>
                </div>
              </Card.Header>
              <Card.Body>
                <Row className="g-3 mb-3">
                  <Col md={4}>
                    <Card className="h-100">
                      <Card.Body>
                        <div className="text-muted text-uppercase small">Status</div>
                        <Badge bg="info">{selectedCampaign.status}</Badge>
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col md={4}>
                    <Card className="h-100">
                      <Card.Body>
                        <div className="text-muted text-uppercase small">Próximo envio</div>
                        {selectedCampaign.nextRunAt ? (
                          <>
                            <div className="d-flex align-items-center gap-2">
                              <IconClock size={18} />
                              {formatDateTime(selectedCampaign.nextRunAt)}
                            </div>
                            {countdownInfo ? (
                              <>
                                <small className={`d-block ${countdownInfo.isLate ? "text-danger" : "text-muted"}`}>
                                  {countdownInfo.text}
                                </small>
                                {countdownInfo.targetLabel ? (
                                  <small className="d-block text-muted">
                                    Próximo destino: {countdownInfo.targetLabel}
                                    {countdownInfo.targetId ? ` · ID ${countdownInfo.targetId}` : ""}
                                  </small>
                                ) : null}
                              </>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted">Não agendado</span>
                        )}
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col md={4}>
                    <Card className="h-100">
                      <Card.Body>
                        <div className="text-muted text-uppercase small">Último envio</div>
                        {selectedCampaign.lastRunAt ? (
                          <div className="d-flex align-items-center gap-2">
                            <IconCalendar size={18} />
                            {formatDateTime(selectedCampaign.lastRunAt)}
                          </div>
                        ) : (
                          <span className="text-muted">Ainda não executou</span>
                        )}
                      </Card.Body>
                    </Card>
                  </Col>
                </Row>
                <Accordion defaultActiveKey="targets" className="mb-0">
                  <Accordion.Item eventKey="targets">
                    <Accordion.Header>Destinos</Accordion.Header>
                    <Accordion.Body>{renderTargets()}</Accordion.Body>
                  </Accordion.Item>
                </Accordion>
              </Card.Body>
            </Card>
          ) : (
            <div className="text-muted text-center p-5 border rounded bg-light">
              Selecione ou crie uma campanha.
            </div>
          )}
        </Col>
      </Row>

      <CampaignGroupDiscoveryModal
        show={discoveryModalVisible}
        onHide={() => setDiscoveryModalVisible(false)}
        apiKey={apiKey}
        instances={instances}
        defaultInstanceId={discoveryInstanceId}
        onConfirm={handleDiscoveryApply}
      />
      <Modal
        show={showBulkLinksModal}
        onHide={() => setShowBulkLinksModal(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Importar links de status</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Label className="fw-semibold">Cole um link por linha</Form.Label>
          <Form.Control
            as="textarea"
            rows={6}
            value={bulkStatusLinks}
            placeholder="https://www.tiktok.com/...\nhttps://pin.it/..."
            onChange={(event) => setBulkStatusLinks(event.target.value)}
          />
          {bulkStatusError ? (
            <div className="text-danger small mt-2">{bulkStatusError}</div>
          ) : (
            <Form.Text className="text-muted d-block mt-2">
              Duplicados são ignorados automaticamente. Suporta TikTok e Pinterest.
            </Form.Text>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowBulkLinksModal(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleBulkStatusLinksAddition}>
            Importar
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={tmdbModal.open} onHide={() => setTmdbModal((prev) => ({ ...prev, open: false }))} centered>
        <Modal.Header closeButton>
          <Modal.Title>Buscar filme/série (TMDB)</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Label className="fw-semibold">Nome do filme ou série</Form.Label>
          <Form.Control
            value={tmdbModal.query}
            onChange={(e) => setTmdbModal((prev) => ({ ...prev, query: e.target.value }))}
            placeholder="Ex.: Rambo"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void searchTmdb();
              }
            }}
          />
          <Button className="mt-2" variant="primary" onClick={searchTmdb} disabled={tmdbModal.loading}>
            {tmdbModal.loading ? "Buscando..." : "Buscar"}
          </Button>
          {tmdbModal.error ? <div className="text-danger small mt-2">{tmdbModal.error}</div> : null}
          {tmdbModal.result ? (
            <div className="d-flex gap-3 mt-3">
              {tmdbModal.result.poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tmdbModal.result.poster}
                  alt={tmdbModal.result.title}
                  style={{ width: 120, height: "auto", borderRadius: 8 }}
                />
              ) : null}
              <div>
                <div className="fw-semibold">{tmdbModal.result.title}</div>
                <div className="small text-muted" style={{ whiteSpace: "pre-wrap" }}>
                  {tmdbModal.result.overview}
                </div>
              </div>
            </div>
          ) : null}
          {tmdbModal.result?.caption ? (
            <pre className="small bg-light rounded mt-3 p-2" style={{ whiteSpace: "pre-wrap" }}>
              {tmdbModal.result.caption}
            </pre>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setTmdbModal((prev) => ({ ...prev, open: false }))}>
            Fechar
          </Button>
          <Button
            variant="primary"
            onClick={applyTmdbResultToCaption}
            disabled={!tmdbModal.result || !tmdbModal.contentId}
          >
            Inserir na legenda
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default UserAdCampaignManager;
