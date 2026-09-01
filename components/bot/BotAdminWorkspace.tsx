"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { BOT_INTERAGE_CHATGPT_PHONE_MODEL } from "lib/botinterage-chatgpt-phone";
import {
  IconApi,
  IconArrowBackUp,
  IconArrowLeft,
  IconBrandWhatsapp,
  IconCamera,
  IconChartBar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconCoin,
  IconCommand,
  IconCopy,
  IconCreditCard,
  IconCrown,
  IconDeviceMobile,
  IconDeviceFloppy,
  IconDotsVertical,
  IconExternalLink,
  IconLoader2,
  IconLink,
  IconLogout2,
  IconMenu2,
  IconMessages,
  IconPhone,
  IconPlus,
  IconPencil,
  IconQrcode,
  IconRefresh,
  IconRotateClockwise2,
  IconSearch,
  IconSettings,
  IconShield,
  IconShoppingCart,
  IconSpeakerphone,
  IconSparkles,
  IconTrash,
  IconUsersGroup,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { getAssetPath } from "helper/assetPath";
import LottieAnimation from "components/site/LottieAnimation";
import WhatsAppConversationsClient from "components/whatsapp/WhatsAppConversationsClient";
import BotAdminAffiliateWalletDropdown from "components/payments/BotAdminAffiliateWalletDropdown";

import styles from "./BotAdminWorkspace.module.css";
import type { ApiEndpointSection, ApiKeySnapshot } from "components/apirest/UserApiRestClient";
import { DEFAULT_COMMAND_ALIASES } from "resources/default-command-aliases";
import { DEFAULT_MENU_TEXTS } from "resources/default-menu-texts";

import type { BotAdCampaign, GroupAdCampaignMeta } from "types/bot-ad-campaigns";
import type {
  BotGroup,
  BotGroupAutoResponse,
  BotGroupMenuTexts,
  BotGroupSettings,
  BotGroupCoinMember,
  BotGroupCoinLedgerEntry,
  BotGroupCoinsConfig,
  BotGroupPremiumConfig,
  BotGroupWelcomeButtonTemplate,
  BotGroupWelcomeReplyButton,
} from "types/bot-groups";
import type { BotInstance, BotInstanceProfile, BotInstanceStatus } from "types/bot-instances";

type WhatsappRealtimeEnvelope = {
  type?: string;
  eventType?: string;
  instanceId?: number;
  chatJid?: string;
  payload?: {
    status?: BotInstanceStatus;
    action?: string | null;
    deletedMessageId?: string | null;
    phone?: string | null;
    instance?: {
      id?: number;
      name?: string | null;
      phone?: string | null;
    } | null;
    [key: string]: unknown;
  };
};

const buildWhatsappRealtimeWebSocketUrl = (afterSequenceId = 0) => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const suffix = afterSequenceId > 0 ? `?after=${encodeURIComponent(String(afterSequenceId))}` : "";
  return `${protocol}//${window.location.host}/ws/whatsapp${suffix}`;
};
import type {
  PaymentMethodProvider,
  PaymentMethodSummary,
} from "types/payments";
import type {
  AffiliateMercadoLivreLink,
  AffiliateMlAutoSyncConfig,
  AffiliateMlGroupDispatch,
  AffiliateProviderSummary,
} from "types/affiliates";
import type {
  PlanAddonSelection,
  PlanCheckoutResponse,
  SubscriptionPlan,
  UserPlanAddon,
  UserPlanLimits,
  UserPlanStatus,
} from "types/plans";

const UserApiRestClient = dynamic(() => import("components/apirest/UserApiRestClient"), {
  ssr: false,
});
const UserAdCampaignManager = dynamic(() => import("components/bot/UserAdCampaignManager"), {
  ssr: false,
});
const UserStatusManager = dynamic(() => import("components/bot/UserStatusManager"), {
  ssr: false,
});
const BotAdminAffiliateManager = dynamic(() => import("components/payments/BotAdminAffiliateManager"), {
  ssr: false,
});
const UserFlowBuilder = dynamic(() => import("components/bot/UserFlowBuilder"), {
  ssr: false,
});
const UserAppDownloadClient = dynamic(() => import("components/users/UserAppDownloadClient"), {
  ssr: false,
});

type Section =
  | "groups"
  | "instances"
  | "conversations"
  | "broadcasts"
  | "flows"
  | "affiliates"
  | "apirest"
  | "campaigns"
  | "status"
  | "app";
type GroupTab = "activity" | "automation" | "premium";
type AffiliateTab = "account" | "products" | "message_model" | "dispatch" | "insights";
type MobileView = "list" | "detail";

type GroupConfig = {
  name: string;
  description: string;
  antilink: boolean;
  antilinkgp: boolean;
  antispam: boolean;
  antipalavras: boolean;
  autoresposta: boolean;
  autosticker: boolean;
  autodownloader: boolean;
  antiInactivity: boolean;
  bemvindo: boolean;
  despedida: boolean;
  soadm: boolean;
  botinterage: boolean;
  vozbotinterage: boolean;
  lerimagem: boolean;
  antisticker: boolean;
  antimage: boolean;
  antvideo: boolean;
  antaudio: boolean;
  antdoc: boolean;
  antvcard: boolean;
  moderacaocomia: boolean;
  banextremo: boolean;
  bangringos: boolean;
  antinsfwimagem: boolean;
  proibirnsfw: boolean;
  brincadeiras: boolean;
  linkmembro: boolean;
  adminsOnly: boolean;
  locked: boolean;
  welcomeEnabled: boolean;
  farewellEnabled: boolean;
  scheduleCloseEnabled: boolean;
  scheduleOpenEnabled: boolean;
  scheduleCloseTimes: string;
  scheduleOpenTimes: string;
  scheduleCloseMessage: string;
  scheduleOpenMessage: string;
  scheduleTimezone: string;
};

type PairingInfo = { linkingCode?: string; qrCode?: string; alreadyConnected?: boolean };
type PairingMode = "auto" | "code" | "qr";

type InstanceProfileFormState = {
  displayName: string;
  phone: string;
  pushName: string;
  statusText: string;
};

type PairingModalState = {
  instanceId: number;
  instanceName: string;
  mode: PairingMode;
  loading: boolean;
  data?: PairingInfo;
  error?: string;
};

type PairingMethodModalState = {
  instanceId: number;
  instanceName: string;
  forceReconnect?: boolean;
};

type GroupActivityEntry = {
  id: string;
  timestamp: string;
  reason: string;
  action: string;
  participant?: string | null;
  pushName?: string | null;
  messageText?: string | null;
  links?: string[];
  evidenceUrl?: string | null;
  evidenceKind?: string | null;
  nsfw?: {
    porn: number;
    hentai: number;
    sexy: number;
    total: number;
    dominant?: "porn" | "hentai" | "sexy";
    dominantScore?: number;
  } | null;
  remainingInfractions?: number;
  instanceName?: string | null;
};

type GroupParticipant = {
  id: string;
  admin: "superadmin" | "admin" | "member";
};

type GroupParticipantImportJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

type GroupParticipantImportJob = {
  id: number;
  userId: number;
  targetGroupId: number;
  targetGroupName: string | null;
  sourceGroupId: number;
  sourceGroupName: string | null;
  targetInstanceId: number;
  status: GroupParticipantImportJobStatus;
  cancelRequested: boolean;
  excludeAdmins: boolean;
  delayMs: number;
  jitterMs: number;
  batchSize: number;
  maxMembers: number;
  sourceTotal: number;
  totalCandidates: number;
  pendingCount: number;
  processedCount: number;
  addedCount: number;
  failedCount: number;
  ignoredAdmins: number;
  ignoredInvalid: number;
  ignoredAlreadyInTarget: number;
  ignoredOwnInstance: number;
  queueTrimmedCount: number;
  progressPercent: number;
  lastError: string | null;
  lastMessage: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
};

type AffiliateMlResolverConfig = {
  provider: "mercadolivre";
  hasCookie: boolean;
  cookieHint: string | null;
  hasCsrfToken: boolean;
  tag: string | null;
  enabled: boolean;
  isValid: boolean | null;
  lastError: string | null;
  lastValidatedAt: string | null;
  updatedAt: string | null;
};

type AffiliateMlImportProduct = {
  itemId: string;
  title: string | null;
  permalink: string | null;
  thumbnail: string | null;
  categoryId: string | null;
  price: number | null;
  currencyId: string | null;
  commissionRate: string | null;
  ratingStar: string | null;
  available: boolean | null;
  affiliateUrl: string | null;
  sourceLabel?: string | null;
  sourceMeta?: string | null;
};

type AffiliateImportJobStatus = "running" | "cancelling" | "completed" | "cancelled" | "failed";

type AffiliateImportBackgroundJob = {
  id: number;
  provider: string;
  total: number;
  processed: number;
  imported: number;
  failed: number;
  progressPercent: number;
  status: AffiliateImportJobStatus;
  startedAt: string;
  finishedAt: string | null;
  lastMessage: string | null;
  lastError: string | null;
};

type AffiliateMlImportMode = "standard" | "promotions" | "aggressive";

type AffiliateMlImportCategoryPreset = {
  key: string;
  label: string;
  query: string;
  shopeeQuery?: string;
  hint: string;
  shopeeCategoryId?: number | null;
};

type AffiliateDispatchModalState = {
  dispatchId: number | null;
  instanceId: string;
  groupId: string;
  delayMinutes: string;
  categoryRotationEnabled: boolean;
  enabled: boolean;
};

type AffiliateMlEditModalState = {
  itemId: string;
  affiliateUrl: string;
  note: string;
  couponCode: string;
  couponDetails: string;
  title: string;
  productUrl: string;
  imageUrl: string;
};

type AffiliateMlMessageTemplateItem = {
  key: string;
  label: string;
  hint: string;
  enabled: boolean;
  text: string;
};

type AffiliateMlMessageTemplate = {
  provider: "mercadolivre";
  items: AffiliateMlMessageTemplateItem[];
  buttonLabel: string;
  footerText: string;
  providerTitle: string;
  updatedAt: string | null;
};

type AffiliateProviderCredentialModalState = {
  provider: string;
  label: string;
  accountName: string;
  appId: string;
  clientSecret: string;
  appToken: string;
  connectionId: number | null;
};

type ShopeePerformanceStatusCounter = {
  status: string;
  count: number;
};

type ShopeePerformanceOrderItem = {
  itemId: string | null;
  itemName: string | null;
  qty: number | null;
  itemPrice: number | null;
  actualAmount: number | null;
  refundAmount: number | null;
  itemCommission: number | null;
  itemTotalCommission: number | null;
  itemSellerCommission: number | null;
  itemShopeeCommissionCapped: number | null;
  attributionType: string | null;
  campaignPartnerName: string | null;
  campaignType: string | null;
  fraudStatus: string | null;
};

type ShopeePerformanceOrder = {
  orderId: string | null;
  shopType: string | null;
  orderStatus: string | null;
  items: ShopeePerformanceOrderItem[];
};

type ShopeePerformanceEntry = {
  clickTime: number | null;
  purchaseTime: number | null;
  conversionId: string | null;
  conversionStatus: string | null;
  grossCommission: number | null;
  sellerCommission: number | null;
  shopeeCommissionCapped: number | null;
  totalCommission: number | null;
  netCommission: number | null;
  buyerType: string | null;
  device: string | null;
  productType: string | null;
  referrer: string | null;
  orders: ShopeePerformanceOrder[];
};

type ShopeePerformancePayload = {
  paging: {
    page: number | null;
    limit: number;
    hasNextPage: boolean;
    scrollId: string | null;
  };
  summary: {
    rows: number;
    conversions: number;
    orders: number;
    items: number;
    totalCommission: number;
    netCommission: number;
    clicksWithPurchase: number;
    conversionStatus: ShopeePerformanceStatusCounter[];
    orderStatus: ShopeePerformanceStatusCounter[];
  };
  entries: ShopeePerformanceEntry[];
};

type ShopeeOfferCampaignEntry = {
  offerName: string | null;
  offerType: number | null;
  offerLink: string | null;
  originalLink: string | null;
  imageUrl: string | null;
  commissionRate: string | null;
  categoryId: string | null;
  collectionId: string | null;
  periodStartTime: number | null;
  periodEndTime: number | null;
};

type ShopeeShopOfferEntry = {
  shopId: string | null;
  shopName: string | null;
  offerLink: string | null;
  originalLink: string | null;
  imageUrl: string | null;
  commissionRate: string | null;
  ratingStar: string | null;
  shopType: string | null;
  sellerCommCoveRatio: string | null;
  remainingBudget: string | null;
  periodStartTime: number | null;
  periodEndTime: number | null;
};

type ShopeeOffersPayload = {
  campaigns: {
    paging: {
      page: number | null;
      limit: number;
      hasNextPage: boolean;
    };
    entries: ShopeeOfferCampaignEntry[];
  };
  shopOffers: {
    paging: {
      page: number | null;
      limit: number;
      hasNextPage: boolean;
    };
    entries: ShopeeShopOfferEntry[];
  };
};

type ShopeeFeedMode = "FULL" | "DELTA";

type ShopeeFeedEntry = {
  datafeedId: string;
  referenceId: string | null;
  datafeedName: string | null;
  description: string | null;
  totalCount: number;
  date: string | null;
  feedMode: ShopeeFeedMode | null;
};

type ShopeeFeedDataRow = {
  columnsRaw: string;
  columns: Record<string, unknown> | null;
  updateType: string | null;
  itemId: string | null;
  productLink: string | null;
  offerLink: string | null;
  title: string | null;
  price: number | null;
  salePrice: number | null;
};

type ShopeeFeedDataPayload = {
  pageInfo: {
    offset: number;
    limit: number;
    totalCount: number;
    hasMore: boolean;
  };
  rows: ShopeeFeedDataRow[];
};

type GroupEditModalState = {
  field: "name" | "description";
  value: string;
};

type InstanceDeleteModalState = {
  instanceId: number;
  instanceName: string;
  strategy: "delete_all" | "keep_active";
  linkedGroups: number;
};

type AutomationModalKey =
  | "welcome"
  | "farewell"
  | "autoresposta"
  | "allowedLinks"
  | "bannedWords"
  | "moderation"
  | "blacklist"
  | "schedule"
  | "antiInactivity"
  | "horapg"
  | "botinterage"
  | "menus";

type BotCoinsModalKey =
  | "general"
  | "earnings"
  | "leveling"
  | "rewards"
  | "penalties"
  | "spending"
  | "premium"
  | "premiumPlans"
  | "premiumCommands"
  | "notifications"
  | "robbery"
  | "shop"
  | "topup";

type MenuTextKey = keyof BotGroupMenuTexts;

type WelcomeDraft = {
  enabled: boolean;
  caption: string;
  mediaUrl: string;
  useParticipantProfilePhoto: boolean;
  asSticker: boolean;
  attachments: NonNullable<BotGroupSettings["welcomeConfig"]["attachments"]>;
  replyButtons: BotGroupWelcomeButtonTemplate | null;
};

type FarewellDraft = WelcomeDraft;

type WelcomeEditorField =
  | "caption"
  | "media"
  | "attachments"
  | "buttons";

type WelcomeExpandedMedia = {
  url: string;
  kind: "image" | "video" | "audio" | "document" | "sticker";
  title: string;
};

type NewAutoResponseDraft = {
  triggers: string;
  responseText: string;
  matchMode: "contains" | "equals";
  responseMedia: BotGroupAutoResponse["responseMedia"];
};

type ScheduleDraft = {
  closeEnabled: boolean;
  openEnabled: boolean;
  closeTimes: string;
  openTimes: string;
  closeMessage: string;
  openMessage: string;
  timezone: string;
};

type AntiInactivityDraft = {
  enabled: boolean;
  days: string;
  scanIntervalHours: string;
  removeLimit: string;
};

type ModerationDraft = {
  maxInfractions: string;
  antipalavrasMaxInfractions: string;
  antispamBurstLimit: string;
  antispamBurstWindowSeconds: string;
  antispamResetDays: string;
};

type HorapgDraft = {
  enabled: boolean;
  times: string;
  imageUrl: string;
  mentionAll: boolean;
  timezone: string;
};

type BotInterageDraft = {
  enabled: boolean;
  mentionOnly: boolean;
  voiceEnabled: boolean;
  imageEnabled: boolean;
  aiPrompt: string;
  aiToolsPrompt: string;
  aiModel: string;
  aiVoice: string;
};

type BotInterageModelOption = {
  value: string;
  label: string;
  source: "private" | "free" | "current" | "chatgpt-phone";
};

type BotInterageVoiceOption = {
  value: string;
  label: string;
  source: "private" | "free" | "current";
  description?: string | null;
};

type ServerSummary = {
  id: number;
  name: string;
  apiType: string;
};

type DiscoverableGroupItem = {
  remoteId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  owner: string | null;
  participantsCount: number;
  linkedGroupId: number | null;
  inviteLink: string | null;
};

type ApiRequestPlanSummary = {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  requestAmount: number;
  isActive?: boolean;
  orderIndex?: number;
};

type GroupLifecycle = "active" | "expired" | "inactive";
type GroupActionMode = "activate" | "renew";
type QuickCheckoutMode =
  | "group_activation"
  | "group_renewal"
  | "instance_renewal"
  | "instance_creation"
  | "profile_unlimited";

type QuickCheckoutContext = {
  mode: QuickCheckoutMode;
  title: string;
  description: string;
  planId: number;
  includePlan: boolean;
  requiresFlows?: boolean;
  addonExpiresAt?: string | null;
  addons: {
    instance: number;
    group: number;
  };
  groupId?: number;
  instanceId?: number;
};

type GroupExpiryTone = "success" | "warning" | "danger";

type GroupExpiryInfo = {
  expiresAt: string;
  daysRemaining: number;
  tone: GroupExpiryTone;
  badgeText: string;
  detailText: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const GROUP_IMAGE_RESYNC_COOLDOWN_MS = 10 * 60 * 1000;
const GROUP_LICENSE_DURATION_ORDER = [1, 30, 365] as const;

const toTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const isProfileLicenseActive = (value: string | null | undefined, now = Date.now()): boolean => {
  const timestamp = toTimestamp(value);
  return timestamp !== null && timestamp > now;
};

const formatCoverageDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("pt-BR");
};

const buildAddonExpiryInfo = (expiresAt: string | null | undefined): GroupExpiryInfo | null => {
  const expiryTs = toTimestamp(expiresAt);
  if (!expiresAt || expiryTs === null) return null;

  const now = Date.now();
  const expired = expiryTs < now;
  const daysRemaining = expired ? 0 : Math.max(0, Math.ceil((expiryTs - now) / DAY_IN_MS));
  const tone: GroupExpiryTone = expired
    ? "danger"
    : daysRemaining <= 2
      ? "danger"
      : daysRemaining <= 7
        ? "warning"
        : "success";

  return {
    expiresAt,
    daysRemaining,
    tone,
    badgeText: expired ? "Vencido" : daysRemaining === 1 ? "1 dia" : `${daysRemaining} dias`,
    detailText: `Plano do perfil · ${expired ? "Venceu em" : "Vence em"} ${formatCoverageDateTime(expiresAt)}`,
  };
};

const getGroupLicensePlanLabel = (durationDays: number): string => {
  if (durationDays <= 1) return "Diário";
  if (durationDays >= 365) return "Anual";
  return "Mensal";
};

const sortGroupLicensePlans = (items: SubscriptionPlan[]): SubscriptionPlan[] =>
  items.slice().sort((left, right) => {
    const leftIndex = GROUP_LICENSE_DURATION_ORDER.indexOf(left.durationDays as (typeof GROUP_LICENSE_DURATION_ORDER)[number]);
    const rightIndex = GROUP_LICENSE_DURATION_ORDER.indexOf(right.durationDays as (typeof GROUP_LICENSE_DURATION_ORDER)[number]);
    const safeLeft = leftIndex >= 0 ? leftIndex : GROUP_LICENSE_DURATION_ORDER.length;
    const safeRight = rightIndex >= 0 ? rightIndex : GROUP_LICENSE_DURATION_ORDER.length;
    if (safeLeft !== safeRight) return safeLeft - safeRight;
    if (left.durationDays !== right.durationDays) return left.durationDays - right.durationDays;
    return left.price - right.price;
  });

const sortAddonsByCoverageOrder = (addons: UserPlanAddon[]) =>
  addons
    .slice()
    .sort((left, right) => {
      const leftTs = toTimestamp(left.purchasedAt) ?? Number.MAX_SAFE_INTEGER;
      const rightTs = toTimestamp(right.purchasedAt) ?? Number.MAX_SAFE_INTEGER;
      if (leftTs !== rightTs) {
        return leftTs - rightTs;
      }
      return left.id - right.id;
    });

const isAddonExpired = (addon: UserPlanAddon | null | undefined): boolean => {
  if (!addon?.expiresAt) {
    return false;
  }
  const expiryTs = toTimestamp(addon.expiresAt);
  return expiryTs !== null && expiryTs < Date.now();
};

const findAddonForCoverageIndex = (addons: UserPlanAddon[], index: number): UserPlanAddon | null => {
  if (!Number.isFinite(index) || index <= 0) {
    return null;
  }
  let counter = 0;
  for (const addon of addons) {
    const quantity = Math.max(0, Math.floor(Number(addon.quantity ?? 0)));
    for (let unit = 0; unit < quantity; unit += 1) {
      counter += 1;
      if (counter === index) {
        return addon;
      }
    }
  }
  return null;
};

const ACTIVATION_ITEMS = [
  { key: "antilink", label: "Antilink", hint: "Bloqueia links não permitidos no grupo." },
  { key: "antilinkgp", label: "Antilink GP", hint: "Bloqueia convites de outros grupos." },
  { key: "antispam", label: "Antispam", hint: "Aplica filtros para mensagens repetitivas e spam." },
  { key: "antipalavras", label: "Antipalavras", hint: "Bloqueia palavras proibidas configuradas." },
  { key: "autoresposta", label: "Autoresposta", hint: "Responde automaticamente conforme gatilhos." },
  { key: "autosticker", label: "Autosticker", hint: "Converte mídia recebida em figurinha." },
  { key: "autodownloader", label: "Autodownloader", hint: "Baixa mídias automaticamente por comando." },
  { key: "antiInactivity", label: "Remover inativos automaticamente", hint: "Remove membros após o período sem interação configurado." },
  { key: "despedida", label: "Saída", hint: "Envia mensagem quando alguém sai do grupo." },
  { key: "botinterage", label: "Bot Interage", hint: "Permite respostas de IA de interação no grupo." },
  { key: "vozbotinterage", label: "Voz IA", hint: "Respostas por voz para interações inteligentes." },
  { key: "lerimagem", label: "Leitura de Imagem", hint: "Analisa imagens para respostas automáticas." },
  { key: "antisticker", label: "Anti Sticker", hint: "Bloqueia envio de stickers quando ativo." },
  { key: "antimage", label: "Anti Imagem", hint: "Bloqueia envio de imagens no grupo." },
  { key: "antvideo", label: "Anti Vídeo", hint: "Bloqueia envio de vídeos no grupo." },
  { key: "antaudio", label: "Anti Áudio", hint: "Bloqueia envio de áudios no grupo." },
  { key: "antdoc", label: "Anti Documento", hint: "Bloqueia envio de documentos no grupo." },
  { key: "antvcard", label: "Anti Contato", hint: "Bloqueia envio de contato/vCard no grupo." },
  { key: "moderacaocomia", label: "Moderação com IA", hint: "Usa IA para ajudar na moderação." },
  { key: "banextremo", label: "Ban Extremo", hint: "Aplica penalidade máxima em infrações." },
  { key: "bangringos", label: "Ban Gringos", hint: "Filtro de idioma/perfil conforme regra atual." },
  { key: "antinsfwimagem", label: "Anti NSFW Imagem", hint: "Bloqueia imagens impróprias automaticamente." },
  { key: "proibirnsfw", label: "Proibir NSFW", hint: "Bloqueia conteúdos NSFW em geral." },
  { key: "soadm", label: "Somente ADM", hint: "Limita comandos para administradores." },
  { key: "brincadeiras", label: "Brincadeiras", hint: "Ativa comandos de diversão no grupo." },
  { key: "linkmembro", label: "Link de membro", hint: "Permite comandos de convite para membros." },
] as const;

const DISPLAY_ACTIVATION_ITEMS = ACTIVATION_ITEMS.filter((item) => item.key !== "proibirnsfw");

const BOTCOINS_SHORTCUTS: Array<{
  key: BotCoinsModalKey;
  label: string;
  hint: string;
  icon: typeof IconCoin;
  animationPath: string;
}> = [
  {
    key: "premiumPlans",
    label: "Planos",
    hint: "Valores, validade e até 3 opções.",
    icon: IconCreditCard,
    animationPath: "/animations/botadmin/PremiumPlanAnimation.json",
  },
  {
    key: "premiumCommands",
    label: "Comandos",
    hint: "Comandos exclusivos para assinantes.",
    icon: IconCommand,
    animationPath: "/animations/botadmin/CommandsOrange.json",
  },
];

const BOTCOINS_EARNING_SHORTCUTS = new Set<BotCoinsModalKey>([
  "earnings",
  "leveling",
  "rewards",
  "penalties",
]);

const BOTCOINS_GAME_SHORTCUTS = new Set<BotCoinsModalKey>();

const ACTIVATION_MODAL_BY_KEY: Partial<Record<ActivationKey, AutomationModalKey>> = {
  bemvindo: "welcome",
  despedida: "farewell",
  autoresposta: "autoresposta",
  antilink: "allowedLinks",
  antilinkgp: "allowedLinks",
  banextremo: "allowedLinks",
  antispam: "moderation",
  antipalavras: "bannedWords",
  botinterage: "botinterage",
  vozbotinterage: "botinterage",
  lerimagem: "botinterage",
  antiInactivity: "antiInactivity",
};

const MENU_TEXT_KEYS: MenuTextKey[] = [
  "main",
  "admin",
  "comandos",
  "outros",
  "downloads",
  "ativacoes",
  "jogos",
];

const MENU_TEXT_LABELS: Record<MenuTextKey, { title: string; description: string }> = {
  main: {
    title: "Menu principal",
    description: "Texto base enviado quando o usuário chama o comando principal.",
  },
  admin: {
    title: "Menu admin",
    description: "Comandos e instruções voltados aos administradores.",
  },
  comandos: {
    title: "Menu comandos",
    description: "Resumo dos comandos mais usados para membros.",
  },
  outros: {
    title: "Menu outros",
    description: "Mensagem complementar com atalhos e avisos gerais.",
  },
  downloads: {
    title: "Menu downloads",
    description: "Atalhos de download de mídia e conversões.",
  },
  ativacoes: {
    title: "Menu ativações",
    description: "Guia das ativações e automações do bot.",
  },
  jogos: {
    title: "Menu jogos",
    description: "Sessão de entretenimento e comandos recreativos.",
  },
};

type GroupCommandCategory =
  | "menu"
  | "automation"
  | "moderation"
  | "downloads"
  | "media"
  | "integrations"
  | "general";

type GroupCommandCatalogItem = {
  command: string;
  aliases: string[];
  description: string;
  category: GroupCommandCategory;
};

type GroupCommandCatalogSection = {
  key: GroupCommandCategory;
  title: string;
  description: string;
  items: GroupCommandCatalogItem[];
};

const GROUP_COMMAND_CATEGORY_META: Record<GroupCommandCategory, { title: string; description: string }> = {
  menu: {
    title: "Menu e conta",
    description: "Comandos de navegação e atalhos principais do robô no grupo.",
  },
  automation: {
    title: "Automações e IA",
    description: "Recursos automáticos, respostas inteligentes e configurações do bot.",
  },
  moderation: {
    title: "Moderação e administração",
    description: "Comandos para administrar membros, regras e segurança do grupo.",
  },
  downloads: {
    title: "Downloads e streaming",
    description: "Comandos para baixar áudio, vídeo e mídia de plataformas externas.",
  },
  media: {
    title: "Mídia e figurinhas",
    description: "Ferramentas para stickers, cards, frases e conteúdo visual.",
  },
  integrations: {
    title: "Integrações",
    description: "Comandos de integrações externas e automações especializadas.",
  },
  general: {
    title: "Utilidades",
    description: "Comandos auxiliares e funções diversas do robô.",
  },
};

const GROUP_COMMAND_CATEGORY_ORDER: GroupCommandCategory[] = [
  "menu",
  "automation",
  "moderation",
  "downloads",
  "media",
  "integrations",
  "general",
];

const MENU_ACCOUNT_COMMANDS = new Set([
  "menu",
  "comandos",
  "menuadm",
  "menubotcoins",
  "vencimento",
  "idiomas",
  "prefix",
  "id",
]);

const AUTOMATION_COMMANDS = new Set([
  "autoresposta",
  "addautorepo",
  "rmautorepo",
  "listaautorepo",
  "botinterage",
  "vozbotinterage",
  "lerimagem",
  "autosticker",
  "autodownloader",
  "bemvindo",
  "despedida",
  "keygroq",
  "promptbot",
  "fundomenu",
  "fundobemvindo",
  "legendabemvindo",
  "antiafk",
  "removerinativosauto",
  "ranking",
  "meuranking",
  "resetarranking",
  "horapg",
  "addhorapg",
  "fecharauto",
  "abrirauto",
  "horariotz",
]);

const MODERATION_COMMANDS = new Set([
  "ban",
  "mute",
  "unmute",
  "apagar",
  "antiafk",
  "removerinativos",
  "antilink",
  "antilinkgp",
  "banextremo",
  "antisticker",
  "antimage",
  "antvideo",
  "antaudio",
  "antdoc",
  "antvcard",
  "permitirlink",
  "removerlink",
  "addblacklist",
  "rmblacklist",
  "rmgringos",
  "addregras",
  "regras",
  "addtabela",
  "tabela",
  "marcar",
  "mencionar",
  "linkgp",
]);

const DOWNLOAD_COMMANDS = new Set([
  "yt",
  "ytmp3",
  "ytmp4",
  "tomp3",
  "play",
  "tiktok",
  "kwai",
  "shopee",
  "savepin",
  "spotify",
  "spotifydl",
  "soundcloud",
  "bandcamp",
  "mixcloud",
  "twitterspaces",
  "twitch",
  "rumble",
  "odysee",
  "dailymotion",
  "facebook",
  "mediafire",
  "insta",
]);

const MEDIA_COMMANDS = new Set([
  "attp",
  "attp2",
  "attp3",
  "sticker",
  "sticker2",
  "rename",
  "frase",
  "frase2",
  "frase3",
  "frase4",
  "gerarfrase",
  "frasenovideo",
  "frasenovideo2",
]);

const INTEGRATION_COMMANDS = new Set(["sisreg", "rmsisreg", "revelar"]);

const GROUP_COMMAND_DESCRIPTION_OVERRIDES: Record<string, string> = {
  menu: "Abre o menu principal do robô para o usuário.",
  comandos: "Lista os comandos disponíveis para o usuário.",
  menuadm: "Abre o menu exclusivo de administração do grupo.",
  vencimento: "Mostra validade/cobertura do plano do grupo.",
  idiomas: "Exibe idiomas disponíveis do bot (quando ativo).",
  prefix: "Configura o prefixo dos comandos no grupo.",
  id: "Exibe IDs úteis da conversa, usuário ou grupo.",
  antilink: "Liga/desliga bloqueio de links comuns no grupo.",
  antilinkgp: "Liga/desliga bloqueio de links de convite de grupo.",
  banextremo: "Aumenta a severidade da moderação de links.",
  autoresposta: "Ativa ou desativa respostas automáticas.",
  addautorepo: "Adiciona uma nova autoresposta ao grupo.",
  rmautorepo: "Remove uma autoresposta cadastrada.",
  listaautorepo: "Lista todas as autorespostas cadastradas.",
  frase: "Gera card de frase com layout padrão.",
  frase2: "Gera variação de card de frase.",
  frase3: "Gera card de frase com outro template.",
  frase4: "Gera card de frase com estilo adicional.",
  gerarfrase: "Busca frase pronta por tema/palavra-chave.",
  frasenovideo: "Aplica texto/frase em vídeo.",
  frasenovideo2: "Variação do comando de frase em vídeo.",
  addregras: "Salva/atualiza as regras oficiais do grupo.",
  regras: "Exibe as regras oficiais do grupo.",
  addtabela: "Salva/atualiza a tabela/comunicado fixo.",
  tabela: "Exibe tabela/comunicado configurado.",
  botinterage: "Ativa o assistente de IA para respostas no grupo.",
  vozbotinterage: "Ativa respostas da IA em formato de áudio.",
  lerimagem: "Permite leitura/análise de imagem com IA.",
  autosticker: "Converte mídia recebida em sticker automaticamente.",
  autodownloader: "Baixa mídia automaticamente a partir de links.",
  shopee: "Baixa vídeos do Shopee a partir do link.",
  premium: "Mostra o status da assinatura premium no grupo.",
  comprarpremium: "Assina ou renova o premium via Pix ou checkout configurado.",
  bemvindo: "Ativa/desativa mensagem de boas-vindas.",
  despedida: "Ativa/desativa mensagem de saída.",
  addblacklist: "Adiciona número à blacklist do grupo.",
  rmblacklist: "Remove número da blacklist do grupo.",
  rmgringos: "Restringe membros por DDI permitido.",
  antisticker: "Bloqueia envio de figurinhas no grupo.",
  antimage: "Bloqueia envio de imagens no grupo.",
  antvideo: "Bloqueia envio de vídeos no grupo.",
  antaudio: "Bloqueia envio de áudio no grupo.",
  antdoc: "Bloqueia envio de documentos no grupo.",
  antvcard: "Bloqueia envio de contatos/vCard no grupo.",
  ranking: "Mostra ranking de interação do grupo.",
  horapg: "Mostra horários pagantes configurados.",
  addhorapg: "Define horários pagantes automáticos.",
  fecharauto: "Configura fechamento automático do grupo.",
  abrirauto: "Configura abertura automática do grupo.",
  horariotz: "Define timezone para rotinas automáticas.",
  yt: "Pesquisa conteúdo no YouTube.",
  ytmp3: "Baixa áudio do YouTube.",
  ytmp4: "Baixa vídeo do YouTube.",
  tomp3: "Converte mídia enviada para MP3.",
  play: "Busca e retorna mídia do YouTube por nome.",
  tiktok: "Baixa mídia do TikTok.",
  kwai: "Baixa mídia do Kwai.",
  savepin: "Baixa mídia do Pinterest.",
  spotify: "Baixa ou processa conteúdo do Spotify.",
  spotifydl: "Variação de download para Spotify.",
  soundcloud: "Baixa mídia do SoundCloud.",
  bandcamp: "Baixa mídia do Bandcamp.",
  mixcloud: "Baixa mídia do Mixcloud.",
  twitterspaces: "Baixa áudio de Twitter/X Spaces.",
  twitch: "Baixa mídia da Twitch.",
  rumble: "Baixa mídia do Rumble.",
  odysee: "Baixa mídia do Odysee/LBRY.",
  dailymotion: "Baixa mídia do Dailymotion.",
  facebook: "Baixa mídia do Facebook.",
  mediafire: "Baixa arquivo por link Mediafire.",
  insta: "Baixa mídia do Instagram.",
  attp: "Gera figurinha animada de texto.",
  attp2: "Variação de figurinha animada com texto.",
  attp3: "Outra variação de figurinha animada.",
  sticker: "Converte mídia em figurinha.",
  sticker2: "Variação de criação de figurinha.",
  rename: "Renomeia figurinha/metadados da mídia.",
  mute: "Silencia membro temporariamente.",
  unmute: "Remove silenciamento de membro.",
  ban: "Remove membro do grupo.",
  apagar: "Apaga mensagem respondida quando possível.",
  permitirlink: "Adiciona link à lista de permitidos.",
  removerlink: "Remove link da lista de permitidos.",
  keygroq: "Configura chave da IA Groq para o grupo.",
  promptbot: "Define prompt personalizado da IA.",
  fundomenu: "Define imagem de fundo do menu do bot.",
  fundobemvindo: "Define imagem da mensagem de boas-vindas.",
  legendabemvindo: "Define legenda/texto da mensagem de boas-vindas.",
  marcar: "Menciona todos os membros do grupo.",
  mencionar: "Faz menção oculta/coletiva no grupo.",
  linkgp: "Exibe ou gera link oficial de convite do grupo.",
  antiafk: "Ativa remoção automática de membros sem falar.",
  removerinativos: "Remove agora membros sem interação pelo número de dias informado.",
  removerinativosauto: "Ativa, desativa ou configura a remoção automática de inativos.",
  meuranking: "Mostra posição individual no ranking.",
  resetarranking: "Reseta ranking de interação do grupo.",
  sisreg: "Consulta ou inicia integração SisReg.",
  rmsisreg: "Remove/encerra configuração SisReg ativa.",
  revelar: "Revela informações ocultas conforme recurso ativo.",
};

const resolveGroupCommandCategory = (command: string): GroupCommandCategory => {
  if (MENU_ACCOUNT_COMMANDS.has(command)) return "menu";
  if (AUTOMATION_COMMANDS.has(command)) return "automation";
  if (MODERATION_COMMANDS.has(command)) return "moderation";
  if (DOWNLOAD_COMMANDS.has(command)) return "downloads";
  if (MEDIA_COMMANDS.has(command)) return "media";
  if (INTEGRATION_COMMANDS.has(command)) return "integrations";
  return "general";
};

const resolveGroupCommandDescription = (command: string, category: GroupCommandCategory): string => {
  const explicit = GROUP_COMMAND_DESCRIPTION_OVERRIDES[command];
  if (explicit) return explicit;
  if (category === "downloads") return "Comando voltado para download/processamento de mídia.";
  if (category === "automation") return "Comando de automação e comportamento do robô no grupo.";
  if (category === "moderation") return "Comando administrativo de moderação e segurança do grupo.";
  if (category === "menu") return "Comando de navegação e informações do usuário.";
  if (category === "media") return "Comando para criação/edição de conteúdo visual ou áudio.";
  if (category === "integrations") return "Comando de integração externa do bot.";
  return "Comando disponível no robô para este grupo.";
};

const REMOVED_BOTCOINS_COMMAND_KEYS = new Set([
  "coins",
  "coinsrank",
  "menubotcoins",
  "comprarcoins",
  "bcshop",
  "comprarbc",
  "minhasdefesas",
  "defesabc",
  "roubarbc",
]);

const PREMIUM_COMMAND_KEYS = ["premium", "comprarpremium"] as const;

const BOTCOINS_COMMAND_HELP = PREMIUM_COMMAND_KEYS.map((command) => ({
  command,
  description: resolveGroupCommandDescription(command, resolveGroupCommandCategory(command)),
}));

const resolveBotCoinsDefaultCost = (config: BotGroupCoinsConfig | null, command: string): number => {
  if (!config) return 0;
  if (DOWNLOAD_COMMANDS.has(command)) {
    return Number(config.spending.defaultCostsByCategory?.downloads ?? 0);
  }
  if (MEDIA_COMMANDS.has(command)) {
    return Number(config.spending.defaultCostsByCategory?.media ?? 0);
  }
  return 0;
};

const COIN_LEDGER_REASON_LABELS: Record<string, string> = {
  message: "Mensagem",
  daily: "Bônus diário",
  level_up: "Level up",
  command_cost: "Comando",
  autodownloader: "Auto downloader",
  autosticker: "Auto sticker",
  infraction: "Infração",
  premium_subscription: "Assinatura premium",
  admin_adjust: "Ajuste admin",
  weekly_reward: "Ranking semanal",
  monthly_reward: "Ranking mensal",
  coin_purchase: "Compra de BotCoins",
  admin_reset: "Reset admin",
};

const formatCoinLedgerReason = (entry: BotGroupCoinLedgerEntry): string => {
  const base = COIN_LEDGER_REASON_LABELS[entry.reason] ?? entry.reason;
  if (entry.reason === "command_cost") {
    const command =
      entry.metadata && typeof entry.metadata.command === "string"
        ? entry.metadata.command
        : "";
    return command ? `${base}: ${command}` : base;
  }
  return base;
};

const GROUP_COMMAND_CATALOG: GroupCommandCatalogSection[] = (() => {
  const items: GroupCommandCatalogItem[] = Object.entries(DEFAULT_COMMAND_ALIASES)
    .map(([commandRaw, aliasesRaw]) => {
      const command = commandRaw.trim().toLowerCase();
      if (!command) return null;
      if (REMOVED_BOTCOINS_COMMAND_KEYS.has(command)) return null;
      const aliases = Array.from(
        new Set(
          (Array.isArray(aliasesRaw) ? aliasesRaw : [])
            .map((entry) => String(entry ?? "").trim().toLowerCase())
            .filter((entry) => entry.length > 0),
        ),
      );
      const category = resolveGroupCommandCategory(command);
      return {
        command,
        aliases: aliases.length > 0 ? aliases : [command],
        description: resolveGroupCommandDescription(command, category),
        category,
      } satisfies GroupCommandCatalogItem;
    })
    .filter((entry): entry is GroupCommandCatalogItem => Boolean(entry))
    .sort((left, right) => left.command.localeCompare(right.command, "pt-BR"));

  return GROUP_COMMAND_CATEGORY_ORDER.map((category) => {
    const meta = GROUP_COMMAND_CATEGORY_META[category];
    return {
      key: category,
      title: meta.title,
      description: meta.description,
      items: items.filter((item) => item.category === category),
    } satisfies GroupCommandCatalogSection;
  }).filter((section) => section.items.length > 0);
})();

type ActivationKey = (typeof ACTIVATION_ITEMS)[number]["key"];

interface BotAdminWorkspaceProps {
  preloadedSections: Section[];
  initialInstances: BotInstance[];
  initialGroups: BotGroup[];
  servers: ServerSummary[];
  plans: SubscriptionPlan[];
  planStatus: UserPlanStatus;
  planLimits: UserPlanLimits;
  userId: number;
  userName: string;
  userEmail: string;
  userBalance: number;
  userAddons: UserPlanAddon[];
  paymentMethods: PaymentMethodSummary[];
  apiRestSnapshot: ApiKeySnapshot;
  apiRestSections: ApiEndpointSection[];
  apiRestBaseUrl: string;
  apiRestPlans: ApiRequestPlanSummary[];
  initialCampaigns: BotAdCampaign[];
  initialGroupAdCampaignMeta: GroupAdCampaignMeta[];
  userApiKey: string;
  initialAffiliateProviders: AffiliateProviderSummary[];
  brandSiteName?: string;
  brandLogoUrl?: string | null;
  brandUpdatedAt?: string | null;
  isAdminUser: boolean;
  botInterageAllowed: boolean;
  botInterageTtsAllowed: boolean;
  initialFlowImportText?: string;
}

const resolveSection = (value: string | null, fallback: Section = "conversations"): Section => {
  if (value === "groups") {
    return "conversations";
  }
  if (
    value === "affiliates" ||
    value === "instances" ||
    value === "conversations" ||
    value === "broadcasts" ||
    value === "flows" ||
    value === "apirest" ||
    value === "campaigns" ||
    value === "status" ||
    value === "app"
  ) {
    return value;
  }
  return fallback;
};

const resolveAffiliateTab = (value: string | null, fallback: AffiliateTab = "account"): AffiliateTab => {
  if (
    value === "account" ||
    value === "products" ||
    value === "message_model" ||
    value === "dispatch" ||
    value === "insights"
  ) {
    return value;
  }
  return fallback;
};

const resolveGroupTab = (value: string | null, fallback: GroupTab = "automation"): GroupTab => {
  if (value === "activity" || value === "automation" || value === "premium") {
    return value;
  }
  if (value === "commands") {
    return "automation";
  }
  return fallback;
};

const isModuleSection = (section: Section) =>
  section === "conversations" ||
  section === "broadcasts" ||
  section === "flows" ||
  section === "apirest" ||
  section === "status" ||
  section === "app";

const DASHBOARD_MOBILE_VIEW_STORAGE_KEY = "botadmin.dashboard.mobileView";
const DASHBOARD_GROUP_DETAILS_STORAGE_KEY = "botadmin.dashboard.groupDetailsOpen";
const BOT_ADMIN_AFFILIATE_PROVIDER_KEY = "botadmin";
const BOT_ADMIN_AFFILIATE_SEARCH_TEXT =
  "bot admin botadmin afiliados indicacao indicação comissao comissão divulgação automatica grupos";
const AUTO_PROFILE_GROUP_LICENSE_SOURCES = new Set(["profile_plan", "base_plan"]);

const isAutoProfileGroupLicenseSource = (value: string | null | undefined) => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return AUTO_PROFILE_GROUP_LICENSE_SOURCES.has(normalized);
};

const getIndividualGroupLicenseExpiresAt = (group: BotGroup | null | undefined): string | null => {
  if (!group || isAutoProfileGroupLicenseSource(group.metadata?.licenseSource)) {
    return null;
  }
  return group.metadata?.licenseExpiresAt ?? null;
};

const isIndividualGroupLicenseActive = (group: BotGroup | null | undefined, now = Date.now()) => {
  const expiresAt = getIndividualGroupLicenseExpiresAt(group);
  const expiresTs = toTimestamp(expiresAt);
  return expiresTs !== null && expiresTs > now;
};

const hasPausedResumeAccess = (group: BotGroup | null | undefined) => {
  if (group?.metadata?.botPausedPreserveAccess === true) {
    return true;
  }
  return Boolean(
    group?.metadata?.lastDeactivatedAt &&
      !getIndividualGroupLicenseExpiresAt(group) &&
      !group.metadata.licenseRemovedAt &&
      !group.metadata.licenseTransferredToGroupId,
  );
};

const DASHBOARD_SECTION_STORAGE_KEY = "botadmin.dashboard.section";
const DASHBOARD_GROUP_STORAGE_KEY = "botadmin.dashboard.groupId";
const DASHBOARD_GROUP_TAB_STORAGE_KEY = "botadmin.dashboard.groupTab";

const statusLabel: Record<BotInstanceStatus, string> = {
  conectado: "Conectado",
  desconectado: "Desconectado",
  aguardando_qr: "Aguardando QR",
  aguardando_pareamento: "Aguardando pareamento",
  inicializando: "Inicializando",
};
const isConnectedInstanceStatus = (status: BotInstanceStatus) => status === "conectado";

const resolveAffiliateProviderStatusLabel = (provider: AffiliateProviderSummary): string => {
  if (provider.provider === "shopee") {
    return provider.connected ? "Conectado" : "Desconectado";
  }
  if (provider.connected) return "Conectado";
  if (provider.status === "expired") return "Expirado";
  if (provider.status === "error") return "Erro";
  if (provider.status === "unavailable" && !provider.implemented) return "Em breve";
  return "Desconectado";
};

const INSTANCE_CAPABILITY_HIGHLIGHTS = [
  "Antilink inteligente, bloqueio por palavras e moderação automática.",
  "Comandos para baixar músicas, vídeos e mídias direto no grupo.",
  "Auto respostas, boas-vindas, menus dinâmicos e ações por palavra-chave.",
  "Sorteios, anúncios programados e automações avançadas para comunidades.",
  "Integrações com IA para respostas, voz e leitura de imagem.",
] as const;

const activityReasonLabel = (reason: string) => {
  if (reason === "link") return "Antilink";
  if (reason === "banned_word") return "Antipalavras";
  if (reason === "media") return "Mídia";
  if (reason === "spam") return "Antispam";
  return reason || "Regra";
};

const activityActionLabel = (action: string) => {
  if (action === "ban") return "Banido";
  if (action === "warn") return "Advertência";
  if (action === "delete") return "Removido";
  return action || "Ação";
};

type ActivityEvidenceKind = "image" | "video" | "audio" | "document";

type ActivityNsfwSummary = {
  porn: number;
  hentai: number;
  sexy: number;
  total: number;
  dominant: "porn" | "hentai" | "sexy";
  dominantScore: number;
};

const normalizeActivityScore = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
};

const parseNsfwSummaryFromText = (raw: string | null | undefined): ActivityNsfwSummary | null => {
  const source = typeof raw === "string" ? raw : "";
  if (!source) return null;
  const match = source.match(/NSFW\[([^\]]+)\]/i);
  if (!match?.[1]) return null;
  const parsed: Record<string, number> = {};
  for (const piece of match[1].split(",")) {
    const [keyRaw, valueRaw] = piece.split("=").map((item) => item.trim());
    if (!keyRaw) continue;
    parsed[keyRaw.toLowerCase()] = normalizeActivityScore(valueRaw);
  }
  const porn = parsed.porn ?? 0;
  const hentai = parsed.hentai ?? 0;
  const sexy = parsed.sexy ?? 0;
  const total = parsed.total ?? parsed.nsfw ?? 0;
  const ranked = [
    ["porn", porn],
    ["hentai", hentai],
    ["sexy", sexy],
  ] as const;
  ranked.sort((left, right) => right[1] - left[1]);
  return {
    porn,
    hentai,
    sexy,
    total,
    dominant: ranked[0]?.[0] ?? "porn",
    dominantScore: ranked[0]?.[1] ?? 0,
  };
};

const resolveActivityNsfwSummary = (entry: GroupActivityEntry): ActivityNsfwSummary | null => {
  const nsfw = entry.nsfw;
  if (nsfw && typeof nsfw === "object") {
    const porn = normalizeActivityScore(nsfw.porn);
    const hentai = normalizeActivityScore(nsfw.hentai);
    const sexy = normalizeActivityScore(nsfw.sexy);
    const total = normalizeActivityScore(nsfw.total);
    const dominant =
      nsfw.dominant === "hentai" || nsfw.dominant === "sexy" || nsfw.dominant === "porn"
        ? nsfw.dominant
        : ([
            ["porn", porn],
            ["hentai", hentai],
            ["sexy", sexy],
          ] as const).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "porn";
    const dominantScore = normalizeActivityScore(nsfw.dominantScore ?? nsfw[dominant]);
    return {
      porn,
      hentai,
      sexy,
      total,
      dominant,
      dominantScore,
    };
  }
  return parseNsfwSummaryFromText(entry.messageText);
};

const stripNsfwMarkerFromMessage = (raw: string | null | undefined): string => {
  const source = typeof raw === "string" ? raw : "";
  if (!source) return "";
  return source
    .replace(/\s*\|?\s*NSFW\[[^\]]+\]\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const activityNsfwCategoryLabel = (key: ActivityNsfwSummary["dominant"]): string => {
  if (key === "porn") return "Pornografia";
  if (key === "hentai") return "Hentai";
  return "Conteúdo sensual";
};

const formatActivityScore = (value: number): string => `${Math.round(normalizeActivityScore(value) * 100)}%`;

const inferActivityEvidenceKind = (
  link: string | null | undefined,
  explicitKind?: string | null,
): ActivityEvidenceKind | null => {
  const normalizedKind = String(explicitKind ?? "").trim().toLowerCase();
  if (normalizedKind === "sticker" || normalizedKind === "image") return "image";
  if (normalizedKind === "video") return "video";
  if (normalizedKind === "audio") return "audio";
  if (normalizedKind === "document") return "document";

  const raw = String(link ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const cleanPath = parsed.pathname.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(cleanPath)) return "image";
    if (/\.(mp4|webm|mov|mkv|avi|m4v)$/.test(cleanPath)) return "video";
    if (/\.(mp3|wav|ogg|m4a|aac|opus|flac|amr)$/.test(cleanPath)) return "audio";
    return "document";
  } catch {
    return null;
  }
};

const resolveActivityEvidenceUrl = (entry: GroupActivityEntry): string | null => {
  const direct = typeof entry.evidenceUrl === "string" ? entry.evidenceUrl.trim() : "";
  if (direct) {
    return direct;
  }
  if (entry.reason !== "media" || !Array.isArray(entry.links)) {
    return null;
  }
  for (const link of entry.links) {
    const normalized = typeof link === "string" ? link.trim() : "";
    if (!normalized) continue;
    const kind = inferActivityEvidenceKind(normalized, entry.evidenceKind);
    if (kind) {
      return normalized;
    }
  }
  return null;
};

const _coinReasonLabel = (reason: string) => {
  switch (reason) {
    case "message":
      return "Mensagem";
    case "daily":
      return "Diário";
    case "level_up":
      return "Level Up";
    case "command_cost":
      return "Comando";
    case "autodownloader":
      return "Auto Downloader";
    case "autosticker":
      return "Autosticker";
    case "infraction":
      return "Infração";
    case "admin_adjust":
      return "Ajuste manual";
    default:
      return reason || "Movimento";
  }
};

const parseError = async (response: Response) => {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? "Não foi possível concluir a ação.";
};

const AFFILIATE_ML_DEFAULT_DIRECT_TEMPLATE_TEXT = [
  "🛒 *_Mercado Livre_*",
  "📦 *{{titulo}}*",
  "",
  "💰 de ~{{preco_antigo_formatado}}~ por *{{preco_formatado}}*",
  "💳 {{preco_parcelado}}",
  "📈 Vendidos: {{vendidos}}",
  "📦 Estoque: {{estoque}}",
  "🚚 {{frete}}",
  "🛡️ {{garantia}}",
  "📌 Condição: {{condicao}}",
  "🏷️ Cupom: *{{cupom}}*",
  "🧾 {{cupom_detalhes}}",
].join("\n");
const AFFILIATE_ML_DEFAULT_PROVIDER_TITLE = "*_Mercado Livre_*";
const AFFILIATE_ML_DEFAULT_BUTTON_TEXT = "🔗 Acessar oferta";
const AFFILIATE_ML_DISPATCH_FOOTER_TEXT = "Oferta automática de afiliado";

const DEFAULT_AFFILIATE_ML_MESSAGE_TEMPLATE_ITEMS: AffiliateMlMessageTemplateItem[] = [
  {
    key: "header",
    label: "Cabeçalho",
    hint: "Linha principal da oferta.",
    enabled: false,
    text: "🛒 *_Mercado Livre_*",
  },
  {
    key: "intro",
    label: "Abertura",
    hint: "Texto principal da oferta enviado no grupo.",
    enabled: true,
    text: AFFILIATE_ML_DEFAULT_DIRECT_TEMPLATE_TEXT,
  },
  {
    key: "title",
    label: "Título do produto",
    hint: "Nome principal do item.",
    enabled: false,
    text: "📦 *{{titulo}}*",
  },
  {
    key: "description",
    label: "Descrição curta",
    hint: "Resumo opcional do anúncio.",
    enabled: false,
    text: "📝 {{descricao}}",
  },
  {
    key: "price",
    label: "Preço",
    hint: "Preço atual do anúncio.",
    enabled: false,
    text: "💰 *Por: {{preco_formatado}}*",
  },
  {
    key: "installments",
    label: "Parcelamento",
    hint: "Condição de parcelamento quando existir.",
    enabled: false,
    text: "💳 {{preco_parcelado}}",
  },
  {
    key: "old_price",
    label: "Preço antigo",
    hint: "Mostra preço anterior quando houver promoção.",
    enabled: false,
    text: "💸 De: ~{{preco_antigo_formatado}}~",
  },
  {
    key: "sold",
    label: "Vendidos",
    hint: "Quantidade vendida do item.",
    enabled: false,
    text: "📈 Vendidos: {{vendidos}}",
  },
  {
    key: "stock",
    label: "Estoque",
    hint: "Quantidade disponível.",
    enabled: false,
    text: "📦 Estoque: {{estoque}}",
  },
  {
    key: "shipping",
    label: "Frete",
    hint: "Frete grátis ou texto de frete.",
    enabled: false,
    text: "🚚 {{frete}}",
  },
  {
    key: "condition",
    label: "Condição",
    hint: "Novo, usado ou condição personalizada.",
    enabled: false,
    text: "📌 Condição: {{condicao}}",
  },
  {
    key: "warranty",
    label: "Garantia",
    hint: "Informação de garantia do anúncio.",
    enabled: false,
    text: "🛡️ {{garantia}}",
  },
  {
    key: "seller",
    label: "Vendedor",
    hint: "Nome ou ID do vendedor.",
    enabled: false,
    text: "🏪 Vendedor: {{vendedor}}",
  },
  {
    key: "cta",
    label: "Chamada final",
    hint: "Texto final. Se usar {{url}}, ele aparece no corpo.",
    enabled: false,
    text: "🔗 {{url}}",
  },
];

const AFFILIATE_ML_IMPORT_CATEGORY_PRESETS: AffiliateMlImportCategoryPreset[] = [
  {
    key: "all_categories",
    label: "Todas categorias (automático)",
    query: "__ALL_CATEGORIES__",
    shopeeQuery: "__ALL_CATEGORIES__",
    hint: "Faz varredura ampla por tendências gerais do Mercado Livre.",
    shopeeCategoryId: null,
  },
  {
    key: "manual",
    label: "Somente palavra-chave",
    query: "",
    shopeeQuery: "",
    hint: "Use apenas o termo digitado no campo abaixo.",
    shopeeCategoryId: null,
  },
  {
    key: "eletronicos",
    label: "Eletrônicos",
    query: "celular smartphone notebook eletronicos",
    shopeeQuery: "eletronicos",
    hint: "Celulares, notebooks e acessórios de alto giro.",
    shopeeCategoryId: 100636,
  },
  {
    key: "eletrodomesticos",
    label: "Eletrodomésticos",
    query: "air fryer cafeteira liquidificador eletrodomesticos",
    shopeeQuery: "eletrodomesticos",
    hint: "Itens de casa com alta procura e ticket médio acessível.",
    shopeeCategoryId: 100632,
  },
  {
    key: "games",
    label: "Games",
    query: "videogame headset gamer controle ps5 xbox",
    shopeeQuery: "games",
    hint: "Consoles, acessórios gamer e periféricos.",
    shopeeCategoryId: 100634,
  },
  {
    key: "moda",
    label: "Moda",
    query: "moda feminina masculina tenis roupa",
    shopeeQuery: "moda",
    hint: "Roupas, tênis e acessórios com alto volume diário.",
    shopeeCategoryId: 100011,
  },
  {
    key: "beleza",
    label: "Beleza",
    query: "perfume maquiagem skincare beleza",
    shopeeQuery: "beleza",
    hint: "Perfumes, skincare e maquiagem em tendência.",
    shopeeCategoryId: 100630,
  },
  {
    key: "saude",
    label: "Saúde e Suplementos",
    query: "whey creatina vitamina suplemento",
    shopeeQuery: "suplementos",
    hint: "Suplementos e itens de saúde com demanda recorrente.",
    shopeeCategoryId: 100001,
  },
  {
    key: "casa",
    label: "Casa e Decoração",
    query: "decoracao casa cozinha organizador",
    shopeeQuery: "casa decoracao",
    hint: "Utilidades domésticas, organização e decoração.",
    shopeeCategoryId: 100721,
  },
  {
    key: "ferramentas",
    label: "Ferramentas",
    query: "ferramenta furadeira parafusadeira",
    shopeeQuery: "ferramentas",
    hint: "Equipamentos para obra e manutenção.",
    shopeeCategoryId: 100715,
  },
  {
    key: "automotivo",
    label: "Automotivo",
    query: "acessorios carro automotivo central multimidia",
    shopeeQuery: "automotivo",
    hint: "Acessórios automotivos com alta rotação.",
    shopeeCategoryId: 102187,
  },
  {
    key: "bebes",
    label: "Bebês e Infantil",
    query: "fralda carrinho bebe brinquedo infantil",
    shopeeQuery: "bebes",
    hint: "Produtos infantis com compras frequentes.",
    shopeeCategoryId: 101011,
  },
  {
    key: "pet",
    label: "Pet Shop",
    query: "racao pet brinquedo cachorro gato",
    shopeeQuery: "pet",
    hint: "Itens pet com consumo recorrente.",
    shopeeCategoryId: 100631,
  },
  {
    key: "smart_home",
    label: "Smart Home",
    query: "camera wifi lampada inteligente alexa",
    shopeeQuery: "casa inteligente",
    hint: "Casa inteligente e segurança residencial.",
    shopeeCategoryId: null,
  },
];

const DEFAULT_AFFILIATE_ML_IMPORT_PRESET_KEY =
  AFFILIATE_ML_IMPORT_CATEGORY_PRESETS.find((entry) => entry.key === "eletronicos")?.key ??
  AFFILIATE_ML_IMPORT_CATEGORY_PRESETS[0]?.key ??
  "";
const AFFILIATE_ML_TEMPLATE_MAX_TEXT = 4000;
const AFFILIATE_LINKS_FETCH_LIMIT = 5000;
const AFFILIATE_PRODUCTS_IMPORT_MAX_LIMIT = 2000;
const AFFILIATE_IMPORT_CHUNK_SIZE = 120;
const AFFILIATE_PRODUCT_DISPLAY_LIMIT_OPTIONS = [100, 200, 500, 1000, 2000, 0] as const;
const AFFILIATE_AUTO_SYNC_MAX_DISCOVERY_TERMS = 30;
const AFFILIATE_AUTO_SYNC_MAX_DISCOVERY_CATEGORIES = 24;
const AFFILIATE_AUTO_SYNC_DISCOVERY_CATEGORY_PRESETS = AFFILIATE_ML_IMPORT_CATEGORY_PRESETS.filter(
  (entry) => entry.key !== "all_categories" && entry.key !== "manual",
);

const createDefaultAffiliateMlMessageTemplate = (): AffiliateMlMessageTemplate => ({
  provider: "mercadolivre",
  items: DEFAULT_AFFILIATE_ML_MESSAGE_TEMPLATE_ITEMS.map((entry) => ({ ...entry })),
  buttonLabel: AFFILIATE_ML_DEFAULT_BUTTON_TEXT,
  footerText: AFFILIATE_ML_DISPATCH_FOOTER_TEXT,
  providerTitle: AFFILIATE_ML_DEFAULT_PROVIDER_TITLE,
  updatedAt: null,
});

const createDefaultAffiliateMlAutoSyncConfig = (): AffiliateMlAutoSyncConfig => ({
  provider: "mercadolivre",
  enabled: false,
  refreshExisting: true,
  discoverNew: false,
  targetImportLimit: 50,
  intervalMinutes: 45,
  discoveryTerms: [],
  discoveryCategories: [],
  lastRunAt: null,
  lastError: null,
  updatedAt: null,
});

const SHOPEE_INSIGHTS_PERIOD_OPTIONS = [7, 15, 30, 60, 90] as const;
const SHOPEE_OFFER_SORT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mais novos" },
  { value: 2, label: "Maior comissão" },
  { value: 3, label: "Terminando em breve" },
  { value: 4, label: "Destaques 4" },
  { value: 5, label: "Destaques 5" },
  { value: 6, label: "Destaques 6" },
  { value: 7, label: "Destaques 7" },
  { value: 8, label: "Destaques 8" },
  { value: 9, label: "Destaques 9" },
];
const SHOPEE_FEED_PREVIEW_LIMIT_OPTIONS = [30, 100, 200, 500] as const;

const createDefaultShopeePerformancePayload = (): ShopeePerformancePayload => ({
  paging: {
    page: null,
    limit: 100,
    hasNextPage: false,
    scrollId: null,
  },
  summary: {
    rows: 0,
    conversions: 0,
    orders: 0,
    items: 0,
    totalCommission: 0,
    netCommission: 0,
    clicksWithPurchase: 0,
    conversionStatus: [],
    orderStatus: [],
  },
  entries: [],
});

const createDefaultShopeeOffersPayload = (): ShopeeOffersPayload => ({
  campaigns: {
    paging: {
      page: 1,
      limit: 20,
      hasNextPage: false,
    },
    entries: [],
  },
  shopOffers: {
    paging: {
      page: 1,
      limit: 20,
      hasNextPage: false,
    },
    entries: [],
  },
});

const normalizeAffiliateMlMessageTemplateItems = (items: unknown): AffiliateMlMessageTemplateItem[] => {
  const sourceArray = Array.isArray(items) ? items : [];
  const sourceByKey = new Map<string, Record<string, unknown>>();
  sourceArray.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const key = typeof (entry as { key?: unknown }).key === "string" ? String((entry as { key: string }).key).trim() : "";
    if (!key || sourceByKey.has(key)) return;
    sourceByKey.set(key, entry as Record<string, unknown>);
  });

  return DEFAULT_AFFILIATE_ML_MESSAGE_TEMPLATE_ITEMS.map((fallback) => {
    const source = sourceByKey.get(fallback.key);
    return {
      key: fallback.key,
      label: fallback.label,
      hint: fallback.hint,
      enabled: typeof source?.enabled === "boolean" ? source.enabled : fallback.enabled,
      text:
        typeof source?.text === "string"
          ? source.text.replace(/\r\n/g, "\n").slice(0, AFFILIATE_ML_TEMPLATE_MAX_TEXT)
          : fallback.text,
    };
  });
};

const normalizeAffiliateMlMessageTemplate = (value: unknown): AffiliateMlMessageTemplate => {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const provider = source?.provider === "mercadolivre" ? "mercadolivre" : "mercadolivre";
  const updatedAt = typeof source?.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt : null;
  const buttonLabel =
    typeof source?.buttonLabel === "string" && source.buttonLabel.trim()
      ? source.buttonLabel.trim().slice(0, 40)
      : AFFILIATE_ML_DEFAULT_BUTTON_TEXT;
  const footerText =
    typeof source?.footerText === "string" && source.footerText.trim()
      ? source.footerText.trim().slice(0, 120)
      : AFFILIATE_ML_DISPATCH_FOOTER_TEXT;
  const providerTitle =
    typeof source?.providerTitle === "string" && source.providerTitle.trim()
      ? source.providerTitle.trim().slice(0, 80)
      : typeof source?.provider_title === "string" && source.provider_title.trim()
        ? source.provider_title.trim().slice(0, 80)
      : AFFILIATE_ML_DEFAULT_PROVIDER_TITLE;
  return {
    provider,
    items: normalizeAffiliateMlMessageTemplateItems(source?.items),
    buttonLabel,
    footerText,
    providerTitle,
    updatedAt,
  };
};

const normalizeAutoSyncList = (
  value: unknown,
  options: {
    maxItems: number;
    maxItemLength: number;
    numericOnly?: boolean;
  },
): string[] => {
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.map((entry) => String(entry ?? "")).join(",")
        : "";
  if (!raw.trim()) return [];
  const unique = new Set<string>();
  for (const chunk of raw.split(/[\n,;|]+/g)) {
    if (unique.size >= options.maxItems) break;
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const normalized = options.numericOnly
      ? trimmed.replace(/[^\d]/g, "")
      : trimmed.replace(/\s+/g, " ");
    if (!normalized) continue;
    unique.add(normalized.slice(0, options.maxItemLength));
  }
  return Array.from(unique);
};

const normalizeAffiliateMlAutoSyncConfig = (value: unknown): AffiliateMlAutoSyncConfig => {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const fallback = createDefaultAffiliateMlAutoSyncConfig();
  const targetImportLimit = Number(source?.targetImportLimit);
  const intervalMinutes = Number(source?.intervalMinutes);
  const provider = source?.provider === "shopee" ? "shopee" : "mercadolivre";
  const discoveryTerms = normalizeAutoSyncList(source?.discoveryTerms ?? source?.discovery_terms, {
    maxItems: AFFILIATE_AUTO_SYNC_MAX_DISCOVERY_TERMS,
    maxItemLength: 120,
  });
  const discoveryCategories = normalizeAutoSyncList(
    source?.discoveryCategories ?? source?.discovery_categories,
    {
      maxItems: AFFILIATE_AUTO_SYNC_MAX_DISCOVERY_CATEGORIES,
      maxItemLength: 40,
    },
  );
  return {
    provider,
    enabled: typeof source?.enabled === "boolean" ? source.enabled : fallback.enabled,
    refreshExisting:
      typeof source?.refreshExisting === "boolean"
        ? source.refreshExisting
        : fallback.refreshExisting,
    discoverNew:
      typeof source?.discoverNew === "boolean" ? source.discoverNew : fallback.discoverNew,
    targetImportLimit:
      Number.isFinite(targetImportLimit) && targetImportLimit > 0
        ? Math.max(10, Math.min(2000, Math.floor(targetImportLimit)))
        : fallback.targetImportLimit,
    intervalMinutes:
      Number.isFinite(intervalMinutes) && intervalMinutes > 0
        ? Math.max(10, Math.min(720, Math.floor(intervalMinutes)))
        : fallback.intervalMinutes,
    discoveryTerms,
    discoveryCategories,
    lastRunAt:
      typeof source?.lastRunAt === "string" && source.lastRunAt.trim()
        ? source.lastRunAt
        : fallback.lastRunAt,
    lastError:
      typeof source?.lastError === "string" && source.lastError.trim()
        ? source.lastError
        : fallback.lastError,
    updatedAt:
      typeof source?.updatedAt === "string" && source.updatedAt.trim()
        ? source.updatedAt
        : fallback.updatedAt,
  };
};

const createDefaultGroupParticipantImportJob = (): GroupParticipantImportJob => ({
  id: 0,
  userId: 0,
  targetGroupId: 0,
  targetGroupName: null,
  sourceGroupId: 0,
  sourceGroupName: null,
  targetInstanceId: 0,
  status: "queued",
  cancelRequested: false,
  excludeAdmins: true,
  delayMs: 6500,
  jitterMs: 3000,
  batchSize: 2,
  maxMembers: 0,
  sourceTotal: 0,
  totalCandidates: 0,
  pendingCount: 0,
  processedCount: 0,
  addedCount: 0,
  failedCount: 0,
  ignoredAdmins: 0,
  ignoredInvalid: 0,
  ignoredAlreadyInTarget: 0,
  ignoredOwnInstance: 0,
  queueTrimmedCount: 0,
  progressPercent: 0,
  lastError: null,
  lastMessage: null,
  createdAt: null,
  startedAt: null,
  finishedAt: null,
  updatedAt: null,
});

const normalizeGroupParticipantImportJob = (value: unknown): GroupParticipantImportJob | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id = Number(source.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const fallback = createDefaultGroupParticipantImportJob();
  const statusRaw = String(source.status ?? "").trim().toLowerCase();
  const status: GroupParticipantImportJobStatus =
    statusRaw === "queued" ||
    statusRaw === "running" ||
    statusRaw === "paused" ||
    statusRaw === "cancelling" ||
    statusRaw === "completed" ||
    statusRaw === "cancelled" ||
    statusRaw === "failed"
      ? statusRaw
      : "queued";
  const numberValue = (input: unknown, min = 0, max = Number.MAX_SAFE_INTEGER, fallbackValue = 0) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  };
  const textValue = (input: unknown): string | null =>
    typeof input === "string" && input.trim() ? input.trim() : null;

  return {
    ...fallback,
    id: Math.floor(id),
    userId: numberValue(source.userId, 0, Number.MAX_SAFE_INTEGER, 0),
    targetGroupId: numberValue(source.targetGroupId, 0, Number.MAX_SAFE_INTEGER, 0),
    targetGroupName: textValue(source.targetGroupName),
    sourceGroupId: numberValue(source.sourceGroupId, 0, Number.MAX_SAFE_INTEGER, 0),
    sourceGroupName: textValue(source.sourceGroupName),
    targetInstanceId: numberValue(source.targetInstanceId, 0, Number.MAX_SAFE_INTEGER, 0),
    status,
    cancelRequested: Boolean(source.cancelRequested),
    excludeAdmins: source.excludeAdmins !== false,
    delayMs: numberValue(source.delayMs, 1200, 60000, fallback.delayMs),
    jitterMs: numberValue(source.jitterMs, 0, 30000, fallback.jitterMs),
    batchSize: numberValue(source.batchSize, 1, 5, fallback.batchSize),
    maxMembers: numberValue(source.maxMembers, 0, 5000, fallback.maxMembers),
    sourceTotal: numberValue(source.sourceTotal, 0, Number.MAX_SAFE_INTEGER, 0),
    totalCandidates: numberValue(source.totalCandidates, 0, Number.MAX_SAFE_INTEGER, 0),
    pendingCount: numberValue(source.pendingCount, 0, Number.MAX_SAFE_INTEGER, 0),
    processedCount: numberValue(source.processedCount, 0, Number.MAX_SAFE_INTEGER, 0),
    addedCount: numberValue(source.addedCount, 0, Number.MAX_SAFE_INTEGER, 0),
    failedCount: numberValue(source.failedCount, 0, Number.MAX_SAFE_INTEGER, 0),
    ignoredAdmins: numberValue(source.ignoredAdmins, 0, Number.MAX_SAFE_INTEGER, 0),
    ignoredInvalid: numberValue(source.ignoredInvalid, 0, Number.MAX_SAFE_INTEGER, 0),
    ignoredAlreadyInTarget: numberValue(source.ignoredAlreadyInTarget, 0, Number.MAX_SAFE_INTEGER, 0),
    ignoredOwnInstance: numberValue(source.ignoredOwnInstance, 0, Number.MAX_SAFE_INTEGER, 0),
    queueTrimmedCount: numberValue(source.queueTrimmedCount, 0, Number.MAX_SAFE_INTEGER, 0),
    progressPercent: numberValue(source.progressPercent, 0, 100, 0),
    lastError: textValue(source.lastError),
    lastMessage: textValue(source.lastMessage),
    createdAt: textValue(source.createdAt),
    startedAt: textValue(source.startedAt),
    finishedAt: textValue(source.finishedAt),
    updatedAt: textValue(source.updatedAt),
  };
};

const buildAffiliateMlDirectTemplateTextFromItems = (items: AffiliateMlMessageTemplateItem[]): string => {
  const collectLines = (sourceItems: AffiliateMlMessageTemplateItem[]) => {
    const lines: string[] = [];
    sourceItems.forEach((item) => {
      if (!item.enabled) return;
      const text = (item.text || "").replace(/\r\n/g, "\n").trim();
      if (!text) return;
      if (item.key === "intro" && lines.length > 0) {
        lines.push("");
      }
      lines.push(text);
    });
    return lines;
  };

  const lines = collectLines(items);
  if (lines.length === 0) {
    return collectLines(DEFAULT_AFFILIATE_ML_MESSAGE_TEMPLATE_ITEMS).join("\n").slice(0, AFFILIATE_ML_TEMPLATE_MAX_TEXT);
  }
  return lines.join("\n").slice(0, AFFILIATE_ML_TEMPLATE_MAX_TEXT);
};

const buildAffiliateMlItemsFromDirectTemplateText = (text: string): AffiliateMlMessageTemplateItem[] => {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .slice(0, AFFILIATE_ML_TEMPLATE_MAX_TEXT)
    .trim();

  return DEFAULT_AFFILIATE_ML_MESSAGE_TEMPLATE_ITEMS.map((entry) => {
    if (entry.key !== "intro") {
      return {
        ...entry,
        enabled: false,
      };
    }
    return {
      ...entry,
      enabled: normalized.length > 0,
      text: normalized,
    };
  });
};

const bool = (value: unknown) => value === true || value === "true" || value === 1 || value === "1";
const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const classNames = (...items: Array<string | false | null | undefined>) => items.filter(Boolean).join(" ");
const MOBILE_BREAKPOINT = 980;
const INSTANCE_PREFERENCE_STORAGE_KEY = "botadmin:preferred-instance-id";
const WHATSAPP_WEB_GUIDE_ASSETS = {
  android: "/uploads/tutorials/whatsapp-web/android-whatsapp-web.gif",
  ios: "/uploads/tutorials/whatsapp-web/ios-whatsapp-web.gif",
} as const;

const resolveInitialInstanceId = (instances: BotInstance[]): number | null => {
  const fallback = instances[0]?.id ?? null;
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(INSTANCE_PREFERENCE_STORAGE_KEY);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && instances.some((instance) => instance.id === parsed)) {
    return parsed;
  }
  return fallback;
};

const parseTimesText = (value: string) =>
  value
    .split(/[\n,; ]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const parseMultilineItems = (value: string) =>
  value
    .split(/\r?\n|,|;/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const parseMenuLines = (value: string) =>
  value
    .split(/[\r\n]+/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);

const buildMenuTextsDraftFromSettings = (
  settings?: BotGroupSettings | null,
): Record<MenuTextKey, string> =>
  MENU_TEXT_KEYS.reduce<Record<MenuTextKey, string>>((acc, key) => {
    const values = settings?.menuTexts?.[key];
    const fallback = DEFAULT_MENU_TEXTS[key];
    const resolved = Array.isArray(values) && values.length > 0 ? values : fallback;
    acc[key] = resolved.join("\n");
    return acc;
  }, {
    main: "",
    admin: "",
    comandos: "",
    outros: "",
    downloads: "",
    ativacoes: "",
    jogos: "",
  });

const resolveUploadedMediaUrl = (url?: string | null, path?: string | null) => {
  if (typeof url === "string" && url.trim().length > 0) {
    return url.trim();
  }
  if (typeof path === "string" && path.trim().length > 0) {
    const normalized = path.trim().replace(/^\/+/, "");
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
    return `/${normalized}`;
  }
  return "";
};

const inferUploadMediaType = (file: File): "image" | "video" | "audio" | "document" => {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

const inferMediaTypeFromUrl = (
  value: string,
): "image" | "video" | "audio" | "document" | "sticker" => {
  const normalized = value.toLowerCase().split("?")[0].split("#")[0];
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(normalized)) return "image";
  if (/\.(mp4|webm|mov|mkv|avi|m4v)$/.test(normalized)) return "video";
  if (/\.(mp3|wav|ogg|m4a|aac|opus)$/.test(normalized)) return "audio";
  if (/\.webp$/.test(normalized)) return "sticker";
  return "document";
};

const getWelcomeAttachmentLabel = (kind?: unknown) =>
  kind === "audio"
    ? "Áudio"
    : kind === "document"
      ? "Documento"
      : kind === "video"
        ? "Vídeo"
        : kind === "sticker"
          ? "Sticker"
          : "Imagem";

const getWelcomeButtonFamily = (type?: BotGroupWelcomeReplyButton["type"]) =>
  type === "cta_url" || type === "cta_call" || type === "cta_copy" ? "action" : "reply";

const getWelcomeButtonFamilyName = (family: ReturnType<typeof getWelcomeButtonFamily>) =>
  family === "action" ? "ações externas" : "respostas rápidas";

const createWelcomeReplyButton = (): BotGroupWelcomeReplyButton => ({
  id: `btn_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  label: "",
  type: "quick_reply",
  command: "",
  args: "",
  url: "",
  phoneNumber: "",
  copyCode: "",
});

const createWelcomeReplyButtonsTemplate = (): BotGroupWelcomeButtonTemplate => ({
  enabled: true,
  position: "before_attachments",
  body: "Bem-vindo ao grupo {{nomeGrupo}}!",
  footer: "Selecione uma opção abaixo.",
  buttons: [createWelcomeReplyButton()],
  updatedAt: null,
});

const cloneWelcomeAttachments = (
  attachments?: BotGroupSettings["welcomeConfig"]["attachments"] | null,
): NonNullable<BotGroupSettings["welcomeConfig"]["attachments"]> =>
  Array.isArray(attachments)
    ? (attachments.map((entry) => ({ ...(entry as any) })) as NonNullable<
        BotGroupSettings["welcomeConfig"]["attachments"]
      >)
    : [];

const canonicalWelcomeMediaRef = (value: string | null | undefined): string => {
  const rawValue = (value ?? "").trim();
  if (!rawValue) return "";
  try {
    const parsed = new URL(rawValue);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return rawValue.replace(/^\/+/, "");
  }
};

const filterWelcomeExtraAttachments = (
  attachments: NonNullable<BotGroupSettings["welcomeConfig"]["attachments"]>,
  primaryMediaUrl?: string | null,
  primaryMediaPath?: string | null,
): NonNullable<BotGroupSettings["welcomeConfig"]["attachments"]> => {
  const primaryRefs = new Set(
    [primaryMediaUrl, primaryMediaPath].map((entry) => canonicalWelcomeMediaRef(entry)).filter(Boolean),
  );
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const item = attachment as any;
    const ref = canonicalWelcomeMediaRef(item.path) || canonicalWelcomeMediaRef(item.url);
    if (!ref) {
      return true;
    }
    if (primaryRefs.has(ref) || seen.has(ref)) {
      return false;
    }
    seen.add(ref);
    return true;
  });
};

const resolveWelcomeAttachmentPreviewUrl = (attachment: unknown) => {
  const item = attachment as Record<string, unknown> | null;
  if (!item) return "";
  const url = typeof item.url === "string" ? item.url : null;
  const path = typeof item.path === "string" ? item.path : null;
  return resolveUploadedMediaUrl(url, path);
};

const sanitizeWelcomeButtonsTemplate = (
  template: BotGroupWelcomeButtonTemplate | null,
): BotGroupWelcomeButtonTemplate | null => {
  if (!template?.enabled) {
    return null;
  }
  const validButtons = (Array.isArray(template.buttons) ? template.buttons : [])
    .map((button, index) => {
      const type = button.type ?? "quick_reply";
      const base: BotGroupWelcomeReplyButton = {
        id: button.id?.trim() || `btn_${index + 1}`,
        label: button.label?.trim() || "",
        type,
      };
      if (type === "cta_url") {
        base.url = button.url?.trim() || null;
      } else if (type === "cta_call") {
        base.phoneNumber = button.phoneNumber?.trim() || null;
      } else if (type === "cta_copy") {
        base.copyCode = button.copyCode?.trim() || null;
      } else {
        base.command = button.command?.trim() || "";
        base.args = button.args?.trim() || null;
      }
      return base;
    })
    .filter((button) => {
      if (!button.id || !button.label) return false;
      if (button.type === "cta_url") return Boolean(button.url);
      if (button.type === "cta_call") return Boolean(button.phoneNumber);
      if (button.type === "cta_copy") return Boolean(button.copyCode);
      return Boolean(button.command);
    });
  const firstFamily = validButtons.length > 0 ? getWelcomeButtonFamily(validButtons[0].type) : null;
  const buttons = firstFamily
    ? validButtons.filter((button) => getWelcomeButtonFamily(button.type) === firstFamily).slice(0, 3)
    : [];
  if (!buttons.length) {
    return null;
  }
  return {
    enabled: true,
    position: template.position === "after_attachments" ? "after_attachments" : "before_attachments",
    body: "",
    footer: null,
    buttons,
    updatedAt: new Date().toISOString(),
  };
};

const buildWelcomeSettingsPayload = (draft: WelcomeDraft) => ({
  welcomeConfig: {
    enabled: draft.enabled,
    caption: draft.caption.trim(),
    mediaUrl: draft.mediaUrl.trim() || null,
    useParticipantProfilePhoto: draft.useParticipantProfilePhoto,
    asSticker: draft.asSticker,
    attachments: filterWelcomeExtraAttachments(
      draft.attachments,
      draft.mediaUrl,
      draft.mediaUrl,
    ),
    replyButtons: sanitizeWelcomeButtonsTemplate(draft.replyButtons),
  },
  commandToggles: { bemvindo: draft.enabled },
});

const buildFarewellSettingsPayload = (draft: FarewellDraft) => ({
  farewellConfig: {
    enabled: draft.enabled,
    caption: draft.caption.trim(),
    mediaUrl: draft.mediaUrl.trim() || null,
    useParticipantProfilePhoto: draft.useParticipantProfilePhoto,
    asSticker: draft.asSticker,
    attachments: filterWelcomeExtraAttachments(
      draft.attachments,
      draft.mediaUrl,
      draft.mediaUrl,
    ),
    replyButtons: null,
  },
  commandToggles: { despedida: draft.enabled },
});

const createNewAutoResponseDraft = (
  matchMode: NewAutoResponseDraft["matchMode"] = "contains",
): NewAutoResponseDraft => ({
  triggers: "",
  responseText: "",
  matchMode,
  responseMedia: null,
});

const defaultConfig = (group: BotGroup): GroupConfig => ({
  name: group.name,
  description: group.description ?? "",
  antilink: false,
  antilinkgp: false,
  antispam: false,
  antipalavras: false,
  autoresposta: false,
  autosticker: false,
  autodownloader: false,
  antiInactivity: false,
  bemvindo: false,
  despedida: false,
  soadm: false,
  botinterage: false,
  vozbotinterage: false,
  lerimagem: false,
  antisticker: false,
  antimage: false,
  antvideo: false,
  antaudio: false,
  antdoc: false,
  antvcard: false,
  moderacaocomia: false,
  banextremo: false,
  bangringos: false,
  antinsfwimagem: false,
  proibirnsfw: false,
  brincadeiras: false,
  linkmembro: false,
  adminsOnly: group.metadata?.adminsOnly ?? false,
  locked: group.metadata?.locked ?? false,
  welcomeEnabled: false,
  farewellEnabled: false,
  scheduleCloseEnabled: false,
  scheduleOpenEnabled: false,
  scheduleCloseTimes: "",
  scheduleOpenTimes: "",
  scheduleCloseMessage: "",
  scheduleOpenMessage: "",
  scheduleTimezone: "",
});

const mapSettingsToConfig = (group: BotGroup, settings: Partial<BotGroupSettings>): GroupConfig => {
  const commandToggles = settings.commandToggles ?? {};
  const featureFlags = settings.featureFlags ?? {};
  const welcomeConfig = settings.welcomeConfig ?? {};
  const scheduleConfig = settings.scheduleConfig ?? {};
  const closeTimes = Array.isArray(scheduleConfig.closeTimes) ? scheduleConfig.closeTimes.join(", ") : "";
  const openTimes = Array.isArray(scheduleConfig.openTimes) ? scheduleConfig.openTimes.join(", ") : "";
  const nsfwEnabled =
    bool(commandToggles.antinsfwimagem) ||
    bool(commandToggles.proibirnsfw) ||
    bool(featureFlags.antinsfwimagem) ||
    bool(featureFlags.proibirnsfw);

  return {
    name: group.name,
    description: group.description ?? "",
    antilink: bool(settings.antilink),
    antilinkgp: bool(settings.antilinkGroupInvite) || bool(commandToggles.antilinkgp),
    antispam: bool(featureFlags.antispam),
    antipalavras: bool(featureFlags.antipalavras) || bool(commandToggles.antipalavras),
    autoresposta: bool(commandToggles.autoresposta),
    autosticker: bool(commandToggles.autosticker),
    autodownloader: bool(commandToggles.autodownloader),
    antiInactivity: bool(settings.antiInactivityConfig?.enabled),
    bemvindo: bool(commandToggles.bemvindo),
    despedida: bool(commandToggles.despedida),
    soadm: bool(commandToggles.soadm) || bool(featureFlags.soadm),
    botinterage: bool(commandToggles.botinterage),
    vozbotinterage: bool(commandToggles.vozbotinterage),
    lerimagem: bool(commandToggles.lerimagem),
    antisticker: bool(commandToggles.antisticker),
    antimage: bool(commandToggles.antimage),
    antvideo: bool(commandToggles.antvideo),
    antaudio: bool(commandToggles.antaudio),
    antdoc: bool(commandToggles.antdoc),
    antvcard: bool(commandToggles.antvcard),
    moderacaocomia: bool(commandToggles.moderacaocomia),
    banextremo: bool(commandToggles.banextremo) || bool(settings.banExtremo),
    bangringos: bool(commandToggles.bangringos) || bool(featureFlags.bangringos),
    antinsfwimagem: nsfwEnabled,
    proibirnsfw: nsfwEnabled,
    brincadeiras: bool(commandToggles.brincadeiras),
    linkmembro: bool(commandToggles.linkmembro),
    adminsOnly: group.metadata?.adminsOnly ?? false,
    locked: group.metadata?.locked ?? false,
    welcomeEnabled: bool(welcomeConfig.enabled) || bool(commandToggles.bemvindo),
    farewellEnabled: bool(settings.farewellConfig?.enabled) || bool(commandToggles.despedida),
    scheduleCloseEnabled: bool(scheduleConfig.closeEnabled),
    scheduleOpenEnabled: bool(scheduleConfig.openEnabled),
    scheduleCloseTimes: closeTimes,
    scheduleOpenTimes: openTimes,
    scheduleCloseMessage: typeof scheduleConfig.closeMessage === "string" ? scheduleConfig.closeMessage : "",
    scheduleOpenMessage: typeof scheduleConfig.openMessage === "string" ? scheduleConfig.openMessage : "",
    scheduleTimezone: typeof scheduleConfig.timezone === "string" ? scheduleConfig.timezone : "",
  };
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((token) => {
      const firstChar = Array.from(token)[0] ?? "";
      const normalized = firstChar
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "");
      return /^[a-z0-9]$/i.test(normalized) ? normalized.toUpperCase() : "";
    })
    .join("") || "GR";

const extractFirstUrl = (text: string | null | undefined) => {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
};

const withCacheBust = (url: string, seed: string | number) => {
  if (!url) return url;
  if (/^(data:|blob:)/i.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(String(seed))}`;
};

const resolveProviderLogoUrl = (rawValue: string | null | undefined): string | null => {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return trimmed;
  }
  return getAssetPath(trimmed);
};

const resolveQrImageSrc = (rawValue: string | null | undefined): string | null => {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) return trimmed;
  return `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
};

const PROVIDER_PRIORITY: readonly PaymentMethodProvider[] = [
  "mercadopago_pix",
  "polopag_pix",
  "mercadopago_checkout",
] as const;
const PROVIDER_LABELS: Record<PaymentMethodProvider, string> = {
  mercadopago_pix: "Mercado Pago PIX",
  polopag_pix: "PoloPag PIX",
  mercadopago_checkout: "Checkout (cartão/Pix)",
};
const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("pt-BR");
};
const formatCurrency = (value: number) => moneyFormatter.format(Number.isFinite(value) ? value : 0);
const normalizeAffiliateImportWarning = (value: string | null | undefined): string => {
  if (typeof value !== "string") return "";
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const chunks = compact
    .split(/\s*\.\s*/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (/[.!?]$/.test(entry) ? entry : `${entry}.`));
  return Array.from(new Set(chunks)).join(" ").trim();
};
const summarizeAffiliateImportWarning = (value: string | null | undefined): string | null => {
  const normalized = normalizeAffiliateImportWarning(value);
  if (!normalized) return null;
  const words = normalized.split(/\s+/);
  if (words.length <= 22) return normalized;
  return `${words.slice(0, 22).join(" ")}...`;
};
const formatEpochDateTime = (value: number | null | undefined) => {
  if (!Number.isFinite(value || NaN) || (value || 0) <= 0) return "—";
  return formatDateTime(new Date(Number(value) * 1000).toISOString());
};
const resolveShopeeOfferTypeLabel = (value: number | null | undefined) => {
  if (value === 1) return "Homepage";
  if (value === 2) return "Campanha";
  if (value === 3) return "Loja";
  if (value === 4) return "Categoria";
  if (value === 0) return "Geral";
  return value == null ? "—" : `Tipo ${value}`;
};
const normalizeParticipantDigits = (value: string): string => value.replace(/\D/g, "");
const normalizeIdentityDigits = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.includes("@")) {
    const [localPart] = normalized.split("@");
    return normalizeParticipantDigits((localPart ?? "").split(":")[0] ?? "");
  }
  return normalizeParticipantDigits(normalized.split(":")[0] ?? "");
};
const hasPhoneDigitsMatch = (left: string, right: string): boolean => {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 8 && right.length >= 8) {
    return left.endsWith(right) || right.endsWith(left);
  }
  return false;
};
const formatParticipantDisplay = (participantId: string): string => {
  const normalized = participantId.trim();
  if (normalized.includes("@")) {
    const [localPart] = normalized.split("@");
    const digits = normalizeParticipantDigits(localPart ?? "");
    if (digits) return digits;
    return (localPart ?? normalized).trim() || normalized;
  }
  const digits = normalizeParticipantDigits(normalized);
  return digits || normalized;
};
const participantAvatarLabel = (participantId: string): string => {
  const display = formatParticipantDisplay(participantId);
  const digits = normalizeParticipantDigits(display);
  if (digits.length >= 2) return digits.slice(-2);
  if (digits.length === 1) return digits;
  return initials(display);
};
const participantRoleLabel = (role: GroupParticipant["admin"]) => {
  if (role === "superadmin") return "Dono do grupo";
  if (role === "admin") return "Admin do grupo";
  return "Membro";
};
const cloneBotCoinsConfig = (value: BotGroupCoinsConfig | null | undefined): BotGroupCoinsConfig | null => {
  if (!value) return null;
  const cloned = (typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))) as BotGroupCoinsConfig;
  cloned.premium = {
    enabled: false,
    plans: [
      {
        key: "p30",
        label: "Premium 30 dias",
        price: 100,
        durationDays: 30,
        enabled: true,
        description: "Acesso premium por 30 dias.",
      },
      {
        key: "p60",
        label: "Premium 60 dias",
        price: 180,
        durationDays: 60,
        enabled: true,
        description: "Acesso premium por 60 dias.",
      },
      {
        key: "p90",
        label: "Premium 90 dias",
        price: 250,
        durationDays: 90,
        enabled: true,
        description: "Acesso premium por 90 dias.",
      },
    ],
    price: 100,
    durationDays: 30,
    commandKeys: [],
    bypassCoinCosts: true,
    ...(cloned.premium ?? {}),
    plans: Array.isArray(cloned.premium?.plans) && cloned.premium.plans.length > 0
      ? cloned.premium.plans.slice(0, 3)
      : [
          {
            key: "p30",
            label: `Premium ${cloned.premium?.durationDays ?? 30} dias`,
            price: Number(cloned.premium?.price ?? 100),
            durationDays: Number(cloned.premium?.durationDays ?? 30),
            enabled: true,
            description: "Acesso premium configurado pelo administrador.",
          },
        ],
    commandKeys: Array.isArray(cloned.premium?.commandKeys) ? [...cloned.premium.commandKeys] : [],
  };
  cloned.interactiveShopEnabled = false;
  cloned.robbery = { ...(cloned.robbery ?? {}), enabled: false } as BotGroupCoinsConfig["robbery"];
  cloned.shopItems = [];
  return cloned;
};
const clonePremiumConfig = (value: BotGroupPremiumConfig | null | undefined): BotGroupPremiumConfig => {
  const fallback: BotGroupPremiumConfig = {
    enabled: false,
    plans: [
      {
        key: "p30",
        label: "Premium 30 dias",
        price: 100,
        durationDays: 30,
        enabled: true,
        description: "Acesso premium por 30 dias.",
      },
      {
        key: "p60",
        label: "Premium 60 dias",
        price: 180,
        durationDays: 60,
        enabled: true,
        description: "Acesso premium por 60 dias.",
      },
      {
        key: "p90",
        label: "Premium 90 dias",
        price: 250,
        durationDays: 90,
        enabled: true,
        description: "Acesso premium por 90 dias.",
      },
    ],
    price: 100,
    durationDays: 30,
    commandKeys: [],
    bypassCoinCosts: true,
  };
  const source = value ?? fallback;
  const cloned = (typeof structuredClone === "function"
    ? structuredClone(source)
    : JSON.parse(JSON.stringify(source))) as BotGroupPremiumConfig;
  const plans = Array.isArray(cloned.plans) && cloned.plans.length > 0 ? cloned.plans.slice(0, 3) : fallback.plans;
  return {
    ...fallback,
    ...cloned,
    plans,
    commandKeys: Array.isArray(cloned.commandKeys) ? [...cloned.commandKeys] : [],
  };
};
const normalizeEphemeralValue = (value: string | null | undefined): "off" | "24h" | "7d" | "90d" => {
  if (value === "24h" || value === "7d" || value === "90d") return value;
  return "off";
};
const ephemeralLabel = (value: string | null | undefined) => {
  if (!value || value === "off") return "Desativado";
  if (value === "24h") return "24 horas";
  if (value === "7d") return "7 dias";
  if (value === "90d") return "90 dias";
  return value;
};

const campaignKind = (campaign: BotAdCampaign): "group" | "status" | "mixed" | "unknown" => {
  const hasGroup = campaign.targets.some((target) => target.type === "group");
  const hasStatus = campaign.targets.some((target) => target.type === "status");
  if (hasGroup && hasStatus) return "mixed";
  if (hasGroup) return "group";
  if (hasStatus) return "status";
  return "unknown";
};

const BotAdminWorkspace = ({
  preloadedSections,
  initialInstances,
  initialGroups,
  servers,
  plans,
  planStatus,
  planLimits,
  userId,
  userName,
  userEmail,
  userBalance,
  userAddons,
  paymentMethods,
  apiRestSnapshot,
  apiRestSections,
  apiRestBaseUrl,
  apiRestPlans,
  initialCampaigns,
  initialGroupAdCampaignMeta,
  userApiKey,
  initialAffiliateProviders,
  brandSiteName,
  brandLogoUrl,
  brandUpdatedAt,
  isAdminUser,
  botInterageAllowed,
  botInterageTtsAllowed,
  initialFlowImportText = "",
}: BotAdminWorkspaceProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultSection = initialInstances.length === 0 ? "instances" : "conversations";

  const [section, setSection] = useState<Section>(defaultSection);
  const [loadedSections, setLoadedSections] = useState<Section[]>(() =>
    Array.from(new Set(preloadedSections)),
  );
  const preloadedSectionSet = useMemo(() => new Set<Section>(loadedSections), [loadedSections]);
  const [groupTab, setGroupTab] = useState<GroupTab>(() =>
    typeof window === "undefined"
      ? "automation"
      : resolveGroupTab(window.localStorage.getItem(DASHBOARD_GROUP_TAB_STORAGE_KEY)),
  );
  const [mobileView, setMobileView] = useState<MobileView>(() =>
    typeof window === "undefined"
      ? "list"
      : (window.localStorage.getItem(DASHBOARD_MOBILE_VIEW_STORAGE_KEY) as MobileView) || "list",
  );
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [conversationsMobileChatOpen, setConversationsMobileChatOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [resaleWalletBalance, setResaleWalletBalance] = useState<number | null>(
    Number.isFinite(Number(userBalance)) ? Number(userBalance) : null,
  );
  const [loadingResaleWallet, setLoadingResaleWallet] = useState(false);

  const [instances, setInstances] = useState<BotInstance[]>(initialInstances);
  const [groups, setGroups] = useState<BotGroup[]>(initialGroups);
  const [affiliateProviders, setAffiliateProviders] = useState<AffiliateProviderSummary[]>(
    initialAffiliateProviders,
  );
  const [affiliateSearch, setAffiliateSearch] = useState("");
  const [selectedAffiliateProviderKey, setSelectedAffiliateProviderKey] = useState<string>(
    () =>
      searchParams.get("botAdminAffiliate") === "1" ||
      searchParams.get("affiliate") === BOT_ADMIN_AFFILIATE_PROVIDER_KEY ||
      searchParams.get("affiliateTab") === "dispatch"
        ? BOT_ADMIN_AFFILIATE_PROVIDER_KEY
        : initialAffiliateProviders[0]?.provider ?? BOT_ADMIN_AFFILIATE_PROVIDER_KEY,
  );
  const [affiliateTab, setAffiliateTab] = useState<AffiliateTab>(() =>
    resolveAffiliateTab(searchParams.get("affiliateTab")),
  );
  const [loadingAffiliateProviders, setLoadingAffiliateProviders] = useState(false);
  const [affiliateActionProvider, setAffiliateActionProvider] = useState<string | null>(null);
  const [affiliateProviderCredentialModal, setAffiliateProviderCredentialModal] =
    useState<AffiliateProviderCredentialModalState | null>(null);
  const [savingAffiliateProviderCredential, setSavingAffiliateProviderCredential] = useState(false);
  const [affiliateMlLinks, setAffiliateMlLinks] = useState<AffiliateMercadoLivreLink[]>([]);
  const [loadingAffiliateMlLinks, setLoadingAffiliateMlLinks] = useState(false);
  const [syncingAffiliateMlLinks, setSyncingAffiliateMlLinks] = useState(false);
  const [savingAffiliateMlLink, setSavingAffiliateMlLink] = useState(false);
  const [removingAffiliateMlItemId, setRemovingAffiliateMlItemId] = useState<string | null>(null);
  const [togglingAffiliateMlItemId, setTogglingAffiliateMlItemId] = useState<string | null>(null);
  const [affiliateMlLinkInput, setAffiliateMlLinkInput] = useState("");
  const [affiliateMlLinkNote, setAffiliateMlLinkNote] = useState("");
  const [affiliateMlResolver, setAffiliateMlResolver] = useState<AffiliateMlResolverConfig>({
    provider: "mercadolivre",
    hasCookie: false,
    cookieHint: null,
    hasCsrfToken: false,
    tag: null,
    enabled: false,
    isValid: null,
    lastError: null,
    lastValidatedAt: null,
    updatedAt: null,
  });
  const [loadingAffiliateMlResolver, setLoadingAffiliateMlResolver] = useState(false);
  const [savingAffiliateMlResolver, setSavingAffiliateMlResolver] = useState(false);
  const [togglingAffiliateMlResolver, setTogglingAffiliateMlResolver] = useState(false);
  const [clearingAffiliateMlResolver, setClearingAffiliateMlResolver] = useState(false);
  const [affiliateMlCookieInput, setAffiliateMlCookieInput] = useState("");
  const [affiliateMlTagInput, setAffiliateMlTagInput] = useState("");
  const [isAffiliateMlCreateModalOpen, setIsAffiliateMlCreateModalOpen] = useState(false);
  const [isAffiliateMlImportModalOpen, setIsAffiliateMlImportModalOpen] = useState(false);
  const [searchingAffiliateMlImportProducts, setSearchingAffiliateMlImportProducts] = useState(false);
  const [importingAffiliateMlProducts, setImportingAffiliateMlProducts] = useState(false);
  const [affiliateMlImportCategoryQuery, setAffiliateMlImportCategoryQuery] = useState("");
  const [affiliateMlImportPresetKey, setAffiliateMlImportPresetKey] = useState(
    DEFAULT_AFFILIATE_ML_IMPORT_PRESET_KEY,
  );
  const [affiliateMlImportLimit, setAffiliateMlImportLimit] = useState("120");
  const [affiliateMlImportMode, setAffiliateMlImportMode] = useState<AffiliateMlImportMode>("promotions");
  const [affiliateMlImportProducts, setAffiliateMlImportProducts] = useState<AffiliateMlImportProduct[]>([]);
  const [affiliateMlImportSelectedIds, setAffiliateMlImportSelectedIds] = useState<Record<string, boolean>>({});
  const [affiliateMlImportNote, setAffiliateMlImportNote] = useState("");
  const [affiliateMlImportWarning, setAffiliateMlImportWarning] = useState<string | null>(null);
  const [affiliateMlImportWarningExpanded, setAffiliateMlImportWarningExpanded] = useState(false);
  const [affiliateMlImportShowResultsOnly, setAffiliateMlImportShowResultsOnly] = useState(false);
  const [affiliateImportJob, setAffiliateImportJob] = useState<AffiliateImportBackgroundJob | null>(null);
  const [cancellingAffiliateImportJob, setCancellingAffiliateImportJob] = useState(false);
  const [affiliateMlListCategoryFilter, setAffiliateMlListCategoryFilter] = useState<string>("all");
  const [affiliateMlSelectedItemIds, setAffiliateMlSelectedItemIds] = useState<Record<string, boolean>>({});
  const [affiliateMlDisplayLimitInput, setAffiliateMlDisplayLimitInput] = useState<string>("100");
  const [removingAffiliateMlBulk, setRemovingAffiliateMlBulk] = useState(false);
  const [affiliateMlAutoSyncConfig, setAffiliateMlAutoSyncConfig] = useState<AffiliateMlAutoSyncConfig>(
    createDefaultAffiliateMlAutoSyncConfig,
  );
  const [affiliateMlAutoSyncTargetInput, setAffiliateMlAutoSyncTargetInput] = useState<string>(
    String(createDefaultAffiliateMlAutoSyncConfig().targetImportLimit),
  );
  const [affiliateAutoSyncTermsInput, setAffiliateAutoSyncTermsInput] = useState<string>("");
  const [affiliateAutoSyncCategoryKeysInput, setAffiliateAutoSyncCategoryKeysInput] = useState<string[]>([]);
  const [isAffiliateAutoSyncFiltersModalOpen, setIsAffiliateAutoSyncFiltersModalOpen] = useState(false);
  const [loadingAffiliateMlAutoSync, setLoadingAffiliateMlAutoSync] = useState(false);
  const [savingAffiliateMlAutoSync, setSavingAffiliateMlAutoSync] = useState(false);
  const [affiliateMlEditModal, setAffiliateMlEditModal] = useState<AffiliateMlEditModalState | null>(null);
  const [savingAffiliateMlEditModal, setSavingAffiliateMlEditModal] = useState(false);
  const [affiliateMlGroupDispatches, setAffiliateMlGroupDispatches] = useState<AffiliateMlGroupDispatch[]>([]);
  const [loadingAffiliateMlGroupDispatches, setLoadingAffiliateMlGroupDispatches] = useState(false);
  const [savingAffiliateMlGroupDispatchId, setSavingAffiliateMlGroupDispatchId] = useState<number | null>(null);
  const [removingAffiliateMlGroupDispatchId, setRemovingAffiliateMlGroupDispatchId] = useState<number | null>(null);
  const [affiliateMlDispatchInstanceIdInput, setAffiliateMlDispatchInstanceIdInput] = useState<string>("");
  const [affiliateMlDispatchGroupIdInput, setAffiliateMlDispatchGroupIdInput] = useState<string>("");
  const [affiliateMlDispatchDelayInput, setAffiliateMlDispatchDelayInput] = useState<string>("15");
  const [affiliateMlDispatchCategoryRotationInput, setAffiliateMlDispatchCategoryRotationInput] = useState(true);
  const [affiliateDispatchModal, setAffiliateDispatchModal] = useState<AffiliateDispatchModalState | null>(null);
  const [affiliateMlMessageTemplate, setAffiliateMlMessageTemplate] = useState<AffiliateMlMessageTemplate>(
    createDefaultAffiliateMlMessageTemplate,
  );
  const [affiliateMlVisualTemplateText, setAffiliateMlVisualTemplateText] = useState<string>(() =>
    buildAffiliateMlDirectTemplateTextFromItems(createDefaultAffiliateMlMessageTemplate().items),
  );
  const [affiliateMlTemplateButtonText, setAffiliateMlTemplateButtonText] = useState<string>(
    createDefaultAffiliateMlMessageTemplate().buttonLabel,
  );
  const [affiliateMlTemplateFooterText, setAffiliateMlTemplateFooterText] = useState<string>(
    createDefaultAffiliateMlMessageTemplate().footerText,
  );
  const [affiliateMlTemplateProviderTitle, setAffiliateMlTemplateProviderTitle] = useState<string>(
    createDefaultAffiliateMlMessageTemplate().providerTitle,
  );
  const [loadingAffiliateMlMessageTemplate, setLoadingAffiliateMlMessageTemplate] = useState(false);
  const [savingAffiliateMlMessageTemplate, setSavingAffiliateMlMessageTemplate] = useState(false);
  const [loadingShopeePerformance, setLoadingShopeePerformance] = useState(false);
  const [loadingShopeeOffers, setLoadingShopeeOffers] = useState(false);
  const [loadingAffiliateOfficialOffers, setLoadingAffiliateOfficialOffers] = useState(false);
  const [loadingShopeeFeeds, setLoadingShopeeFeeds] = useState(false);
  const [loadingShopeeFeedData, setLoadingShopeeFeedData] = useState(false);
  const [shopeePerformancePeriodDaysInput, setShopeePerformancePeriodDaysInput] = useState<string>("30");
  const [shopeePerformanceLimitInput, setShopeePerformanceLimitInput] = useState<string>("100");
  const [shopeePerformance, setShopeePerformance] = useState<ShopeePerformancePayload>(
    createDefaultShopeePerformancePayload,
  );
  const [shopeeOfferKeywordInput, setShopeeOfferKeywordInput] = useState<string>("");
  const [shopeeOfferSortInput, setShopeeOfferSortInput] = useState<string>("2");
  const [shopeeOfferLimitInput, setShopeeOfferLimitInput] = useState<string>("20");
  const [shopeeOffers, setShopeeOffers] = useState<ShopeeOffersPayload>(
    createDefaultShopeeOffersPayload,
  );
  const [shopeeFeedPreviewLimitInput, setShopeeFeedPreviewLimitInput] = useState<string>("100");
  const [shopeeFeedsByMode, setShopeeFeedsByMode] = useState<Record<ShopeeFeedMode, ShopeeFeedEntry[]>>({
    FULL: [],
    DELTA: [],
  });
  const [shopeeSelectedFeedMode, setShopeeSelectedFeedMode] = useState<ShopeeFeedMode>("FULL");
  const [shopeeSelectedFeedId, setShopeeSelectedFeedId] = useState<string>("");
  const [shopeeFeedData, setShopeeFeedData] = useState<ShopeeFeedDataPayload | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(() =>
    resolveInitialInstanceId(initialInstances),
  );
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(() => {
    if (typeof window === "undefined") {
      return initialGroups[0]?.id ?? null;
    }
    const raw = window.localStorage.getItem(DASHBOARD_GROUP_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && initialGroups.some((group) => group.id === parsed)) {
      return parsed;
    }
    return initialGroups[0]?.id ?? null;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [instanceProfiles, setInstanceProfiles] = useState<Record<number, BotInstanceProfile>>({});
  const [groupSettingsById, setGroupSettingsById] = useState<Record<number, BotGroupSettings>>({});
  const [groupActivityById, setGroupActivityById] = useState<Record<number, GroupActivityEntry[]>>({});
  const [groupParticipantsById, setGroupParticipantsById] = useState<Record<number, GroupParticipant[]>>({});
  const [loadingActivityGroupId, setLoadingActivityGroupId] = useState<number | null>(null);
  const [resettingActivityGroupId, setResettingActivityGroupId] = useState<number | null>(null);
  const [activityActionMenuEntryId, setActivityActionMenuEntryId] = useState<string | null>(null);
  const [activityActionBusyKey, setActivityActionBusyKey] = useState<string | null>(null);
  const [loadingParticipantsGroupId, setLoadingParticipantsGroupId] = useState<number | null>(null);
  const [groupConfigs, setGroupConfigs] = useState<Record<number, GroupConfig>>({});
  const [brokenGroupImages, setBrokenGroupImages] = useState<Record<number, boolean>>({});
  const [brokenInstanceImages, setBrokenInstanceImages] = useState<Record<number, boolean>>({});
  const [pairingMethodModal, setPairingMethodModal] = useState<PairingMethodModalState | null>(null);
  const [pairingModal, setPairingModal] = useState<PairingModalState | null>(null);
  const pairingRequestIdRef = useRef(0);
  const pairingModalRef = useRef<PairingModalState | null>(null);
  const shopeeInsightsAutoLoadKeyRef = useRef("");
  const instanceProfileHydratedRef = useRef<string | null>(null);
  const botCoinsDraftRef = useRef<BotGroupCoinsConfig | null>(null);
  const botCoinsDraftGroupIdRef = useRef<number | null>(null);
  const botCoinsLastSavedRef = useRef<string | null>(null);
  const botCoinsAutoSaveTimeoutRef = useRef<number | null>(null);
  const welcomeAutoSaveTimeoutRef = useRef<number | null>(null);
  const welcomeAutoSaveLastSignatureRef = useRef("");
  const [automationModal, setAutomationModal] = useState<AutomationModalKey | null>(null);
  const [automationModalSaving, setAutomationModalSaving] = useState(false);
  const [automationModalError, setAutomationModalError] = useState<string | null>(null);
  const [botCoinsModal, setBotCoinsModal] = useState<BotCoinsModalKey | null>(null);
  const [botCoinsDraft, setBotCoinsDraft] = useState<BotGroupCoinsConfig | null>(null);
  const [botCoinsSaving, setBotCoinsSaving] = useState(false);
  const [coinMembers, setCoinMembers] = useState<BotGroupCoinMember[]>([]);
  const [coinMembersLoading, setCoinMembersLoading] = useState(false);
  const [coinMemberSearch, setCoinMemberSearch] = useState("");
  const [coinMemberModal, setCoinMemberModal] = useState<BotGroupCoinMember | null>(null);
  const [coinMemberResetting, setCoinMemberResetting] = useState<string | null>(null);
  const [showBotCoinsCommandHelp, setShowBotCoinsCommandHelp] = useState(false);
  const [coinLedgerEntries, setCoinLedgerEntries] = useState<BotGroupCoinLedgerEntry[]>([]);
  const [coinLedgerLoading, setCoinLedgerLoading] = useState(false);
  const [coinLedgerMember, setCoinLedgerMember] = useState<string | null>(null);
  const [coinAdjustModal, setCoinAdjustModal] = useState<{ memberJid: string } | null>(null);
  const [coinAdjustValue, setCoinAdjustValue] = useState("");
  const [coinAdjustReason, setCoinAdjustReason] = useState("");
	  const [welcomeDraft, setWelcomeDraft] = useState<WelcomeDraft>({
	    enabled: false,
	    caption: "",
	    mediaUrl: "",
    useParticipantProfilePhoto: false,
	    asSticker: false,
	    attachments: [],
	    replyButtons: null,
  });
  const [farewellDraft, setFarewellDraft] = useState<FarewellDraft>({
    enabled: false,
    caption: "",
    mediaUrl: "",
    useParticipantProfilePhoto: false,
    asSticker: false,
    attachments: [],
    replyButtons: null,
  });
  const [welcomeEditorField, setWelcomeEditorField] = useState<WelcomeEditorField | null>(null);
  const [welcomeButtonEditorIndex, setWelcomeButtonEditorIndex] = useState(0);
  const [welcomePhoneMenuOpen, setWelcomePhoneMenuOpen] = useState(false);
  const [welcomeExpandedMedia, setWelcomeExpandedMedia] = useState<WelcomeExpandedMedia | null>(null);
  const [welcomeAutoSaving, setWelcomeAutoSaving] = useState(false);
  const [autoResponsesDraft, setAutoResponsesDraft] = useState<BotGroupAutoResponse[]>([]);
  const [newAutoResponseDraft, setNewAutoResponseDraft] = useState<NewAutoResponseDraft>(
    createNewAutoResponseDraft("contains"),
  );
  const [allowedLinksDraft, setAllowedLinksDraft] = useState("");
  const [bannedWordsDraft, setBannedWordsDraft] = useState("");
  const [moderationDraft, setModerationDraft] = useState<ModerationDraft>({
    maxInfractions: "3",
    antipalavrasMaxInfractions: "5",
    antispamBurstLimit: "5",
    antispamBurstWindowSeconds: "12",
    antispamResetDays: "7",
  });
  const [blacklistDraft, setBlacklistDraft] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>({
    closeEnabled: false,
    openEnabled: false,
    closeTimes: "",
    openTimes: "",
    closeMessage: "",
    openMessage: "",
    timezone: "",
  });
  const [antiInactivityDraft, setAntiInactivityDraft] = useState<AntiInactivityDraft>({
    enabled: false,
    days: "30",
    scanIntervalHours: "24",
    removeLimit: "20",
  });
  const [horapgDraft, setHorapgDraft] = useState<HorapgDraft>({
    enabled: false,
    times: "",
    imageUrl: "",
    mentionAll: false,
    timezone: "",
  });
  const [botInterageDraft, setBotInterageDraft] = useState<BotInterageDraft>({
    enabled: false,
    mentionOnly: false,
    voiceEnabled: false,
    imageEnabled: false,
    aiPrompt: "",
    aiToolsPrompt: "",
    aiModel: "",
    aiVoice: "",
  });
  const [botInterageModelOptions, setBotInterageModelOptions] = useState<BotInterageModelOption[]>([]);
  const [botInterageVoiceOptions, setBotInterageVoiceOptions] = useState<BotInterageVoiceOption[]>([]);
  const [botInterageModelMode, setBotInterageModelMode] = useState<"private" | "free">("free");
  const [botInterageVoiceMode, setBotInterageVoiceMode] = useState<"private" | "free">("free");
  const [botInterageOptionsLoading, setBotInterageOptionsLoading] = useState(false);
  const [menuTextsDraft, setMenuTextsDraft] = useState<Record<MenuTextKey, string>>(
    () => buildMenuTextsDraftFromSettings(),
  );
  const [instanceProfileForm, setInstanceProfileForm] = useState<InstanceProfileFormState>({
    displayName: initialInstances[0]?.name ?? "",
    phone: initialInstances[0]?.phone ?? "",
    pushName: "",
    statusText: "",
  });
  const [loadingInstanceProfileId, setLoadingInstanceProfileId] = useState<number | null>(null);
  const [savingInstanceProfileId, setSavingInstanceProfileId] = useState<number | null>(null);
  const [uploadingInstancePhotoId, setUploadingInstancePhotoId] = useState<number | null>(null);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [busyInstanceId, setBusyInstanceId] = useState<number | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaigns, setCampaigns] = useState<BotAdCampaign[]>(initialCampaigns);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(initialCampaigns[0]?.id ?? null);
  const [campaignCreateRequestKey, setCampaignCreateRequestKey] = useState(0);
  const [campaignRefreshRequestKey, setCampaignRefreshRequestKey] = useState(0);
  const [groupFilterInstanceId, setGroupFilterInstanceId] = useState<number | null>(
    () => resolveInitialInstanceId(initialInstances),
  );
  const [syncingGroups, setSyncingGroups] = useState(false);
  const [savingActivationKey, setSavingActivationKey] = useState<ActivationKey | null>(null);
  const [updatingGroupStatus, setUpdatingGroupStatus] = useState(false);
  const [savingGroupMeta, setSavingGroupMeta] = useState(false);
  const [savingPlanRenewalAccess, setSavingPlanRenewalAccess] = useState(false);
  const [detailsPanelOpen, setDetailsPanelOpen] = useState<boolean>(() =>
    typeof window === "undefined"
      ? false
      : window.localStorage.getItem(DASHBOARD_GROUP_DETAILS_STORAGE_KEY) === "1",
  );
  const [groupEditModal, setGroupEditModal] = useState<GroupEditModalState | null>(null);
  const [instanceDeleteModal, setInstanceDeleteModal] = useState<InstanceDeleteModalState | null>(null);
  const [deletingInstanceId, setDeletingInstanceId] = useState<number | null>(null);
  const [groupLinkModal, setGroupLinkModal] = useState<{
    groupId: number;
    groupName: string;
    instanceId: string;
  } | null>(null);
  const [linkingGroupId, setLinkingGroupId] = useState<number | null>(null);
  const [participantSearch, setParticipantSearch] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [showAllParticipants, setShowAllParticipants] = useState(false);
  const [applyingParticipantBlacklist, setApplyingParticipantBlacklist] = useState(false);
  const [participantImportModalOpen, setParticipantImportModalOpen] = useState(false);
  const [participantImportSourceGroupId, setParticipantImportSourceGroupId] = useState("");
  const [participantImportExcludeAdmins, setParticipantImportExcludeAdmins] = useState(true);
  const [participantImportDelayMs, setParticipantImportDelayMs] = useState("6500");
  const [participantImportJitterMs, setParticipantImportJitterMs] = useState("3000");
  const [participantImportBatchSize, setParticipantImportBatchSize] = useState("2");
  const [participantImportMaxMembers, setParticipantImportMaxMembers] = useState("0");
  const [importingParticipants, setImportingParticipants] = useState(false);
  const [participantImportJob, setParticipantImportJob] = useState<GroupParticipantImportJob | null>(null);
  const [loadingParticipantImportJob, setLoadingParticipantImportJob] = useState(false);
  const [cancellingParticipantImportJob, setCancellingParticipantImportJob] = useState(false);
  const [updatingParticipantImportJob, setUpdatingParticipantImportJob] = useState(false);
  const participantImportLastSettledRef = useRef<string | null>(null);
  const participantImportDraftSyncJobIdRef = useRef<number | null>(null);
  const participantImportPollInFlightRef = useRef(false);
  const participantImportPollRequestRef = useRef(0);
  const participantImportGroupIdRef = useRef<number | null>(null);
  const affiliateImportJobCounterRef = useRef(0);
  const affiliateImportCancelRequestedRef = useRef(false);
  const affiliateImportAbortControllerRef = useRef<AbortController | null>(null);
  const [groupMetaDraft, setGroupMetaDraft] = useState({
    adminsOnly: false,
    locked: false,
    ephemeral: "off",
  });
  const [isCreateInstanceModalOpen, setIsCreateInstanceModalOpen] = useState(false);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [creatingGroupFromInvite, setCreatingGroupFromInvite] = useState(false);
  const [groupInviteForm, setGroupInviteForm] = useState({
    instanceId: "",
    invite: "",
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [quickCheckoutContext, setQuickCheckoutContext] = useState<QuickCheckoutContext | null>(null);
  const [quickCheckoutProvider, setQuickCheckoutProvider] = useState<PaymentMethodProvider>("mercadopago_pix");
  const [quickCheckoutPending, setQuickCheckoutPending] = useState<PlanCheckoutResponse | null>(null);
	  const [quickCheckoutGenerating, setQuickCheckoutGenerating] = useState(false);
	  const [quickCheckoutError, setQuickCheckoutError] = useState<string | null>(null);
	  const [quickCheckoutSuccess, setQuickCheckoutSuccess] = useState<string | null>(null);
  const [quickCheckoutUseBalance, setQuickCheckoutUseBalance] = useState(false);
  const [transferLicenseModalGroupId, setTransferLicenseModalGroupId] = useState<number | null>(null);
  const [transferLicenseTargetGroupId, setTransferLicenseTargetGroupId] = useState("");
  const [transferLicenseBusy, setTransferLicenseBusy] = useState(false);
  const [transferLicenseError, setTransferLicenseError] = useState<string | null>(null);
	  const [pairingGuideOpen, setPairingGuideOpen] = useState(false);
  const [pairingGuidePlatform, setPairingGuidePlatform] = useState<keyof typeof WHATSAPP_WEB_GUIDE_ASSETS>("android");
	  const previousSelectedGroupIdRef = useRef<number | null>(null);
	  const syncingBrokenGroupIdsRef = useRef<Set<number>>(new Set());
	  const brokenGroupImageSyncAttemptsRef = useRef<Record<number, { url: string | null; attemptedAt: number }>>({});
	  const groupAutoSyncTimestampsRef = useRef<Record<number, number>>({});
  const groupPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const instancePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const lazySectionBootstrapRef = useRef<{
    groups: boolean;
    affiliatesGroups: boolean;
    campaigns: boolean;
    status: boolean;
  }>({
    groups: false,
    affiliatesGroups: false,
    campaigns: false,
    status: false,
  });

  const [instanceForm, setInstanceForm] = useState({
    serverId: servers[0]?.id ? String(servers[0].id) : "",
    name: "",
    phone: "",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const querySection = url.searchParams.get("section");
    const hasFlowImport = Boolean(
      url.searchParams.get("flow_share") ||
      url.searchParams.get("share_code") ||
      url.searchParams.get("import_flow"),
    );
    const nextSection = hasFlowImport
      ? "flows"
      : url.searchParams.has("section")
      ? resolveSection(querySection, defaultSection)
      : resolveSection(window.localStorage.getItem(DASHBOARD_SECTION_STORAGE_KEY), defaultSection);

    setSection(nextSection);
    window.localStorage.setItem(DASHBOARD_SECTION_STORAGE_KEY, nextSection);

    if (url.searchParams.has("section")) {
      url.searchParams.delete("section");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [defaultSection, searchParams]);

  useEffect(() => {
    setLoadedSections((current) => {
      const next = new Set<Section>(current);
      preloadedSections.forEach((entry) => next.add(entry));
      return next.size === current.length ? current : Array.from(next);
    });
  }, [preloadedSections]);

  useEffect(() => {
    if (
      section !== "apirest" &&
      section !== "campaigns" &&
      section !== "status"
    ) {
      return;
    }
    setLoadedSections((current) => {
      if (current.includes(section)) {
        return current;
      }
      return [...current, section];
    });
  }, [section]);

  useEffect(() => {
    const providerFromQuery = (searchParams?.get("provider") || "").trim().toLowerCase();
    if (providerFromQuery) {
      setSelectedAffiliateProviderKey(providerFromQuery);
    }
  }, [searchParams]);

  useEffect(() => {
    const oauthStatus = (searchParams?.get("oauth") || "").trim().toLowerCase();
    if (!oauthStatus) return;
    const rawMessage = searchParams?.get("oauth_message");
    const message = (rawMessage || "").trim();
    if (oauthStatus === "success") {
      setFeedback({
        ok: true,
        text: message || "Conta de afiliado conectada com sucesso.",
      });
      return;
    }
    if (oauthStatus === "error") {
      setFeedback({
        ok: false,
        text: message || "Não foi possível conectar a conta de afiliado.",
      });
    }
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handleChange = () => setIsMobileViewport(mediaQuery.matches);

    handleChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DASHBOARD_GROUP_TAB_STORAGE_KEY, groupTab);
  }, [groupTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DASHBOARD_MOBILE_VIEW_STORAGE_KEY, mobileView);
  }, [mobileView]);

  useEffect(() => {
    if (section !== "conversations") {
      setConversationsMobileChatOpen(false);
    }
  }, [section]);

  useEffect(() => {
    if (conversationsMobileChatOpen) {
      setQuickActionsOpen(false);
    }
  }, [conversationsMobileChatOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DASHBOARD_GROUP_DETAILS_STORAGE_KEY, detailsPanelOpen ? "1" : "0");
  }, [detailsPanelOpen]);

  useEffect(() => {
    if (!feedback || typeof window === "undefined") return;
    const timer = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (isMobileViewport && mobileView === "list" && detailsPanelOpen) {
      setDetailsPanelOpen(false);
    }
  }, [detailsPanelOpen, isMobileViewport, mobileView]);

  useEffect(() => {
    if (instances.length > 0 && (!selectedInstanceId || !instances.some((item) => item.id === selectedInstanceId))) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  useEffect(() => {
    if (instances.length === 0) {
      setGroupFilterInstanceId(null);
      return;
    }
    if (groupFilterInstanceId === null || groupFilterInstanceId === 0) {
      return;
    }
    if (!instances.some((item) => item.id === groupFilterInstanceId)) {
      setGroupFilterInstanceId(instances[0].id);
    }
  }, [groupFilterInstanceId, instances]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  participantImportGroupIdRef.current = selectedGroup?.id ?? null;
  const selectedGroupIdSafe = selectedGroup?.id ?? null;
  const selectedGroupAdminsOnly = selectedGroup?.metadata?.adminsOnly ?? false;
  const selectedGroupLocked = selectedGroup?.metadata?.locked ?? false;
  const selectedGroupEphemeral = normalizeEphemeralValue(selectedGroup?.metadata?.ephemeral);
  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );
  const profileInstances = useMemo(
    () => instances.filter((instance) => instance.purpose === "profile"),
    [instances],
  );
  const switchActiveProfile = useCallback(
    (profileId: number) => {
      const targetInstance = instances.find((instance) => instance.id === profileId) ?? null;
      setSelectedInstanceId(profileId);
      setGroupFilterInstanceId(targetInstance?.purpose === "admin_system" ? null : profileId);
      setSelectedGroupId((currentGroupId) => {
        if (targetInstance?.purpose === "admin_system") return null;
        const currentGroup = groups.find((group) => group.id === currentGroupId) ?? null;
        if (currentGroup?.instanceId === profileId) return currentGroupId;
        return groups.find((group) => group.instanceId === profileId)?.id ?? null;
      });
      setProfileSwitcherOpen(false);
      if (isMobileViewport) {
        setMobileView("list");
      }
    },
    [groups, instances, isMobileViewport],
  );
  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId],
  );
  const selectedInstanceProfile = useMemo(
    () => (selectedInstance ? instanceProfiles[selectedInstance.id] ?? null : null),
    [instanceProfiles, selectedInstance],
  );
  const selectedConfig = useMemo(
    () => (selectedGroup ? groupConfigs[selectedGroup.id] ?? defaultConfig(selectedGroup) : null),
    [groupConfigs, selectedGroup],
  );
  const selectedGroupSettings = useMemo(
    () => (selectedGroup ? groupSettingsById[selectedGroup.id] ?? null : null),
    [groupSettingsById, selectedGroup],
  );
  const visibleActivationItems = useMemo(() => DISPLAY_ACTIVATION_ITEMS, []);
  const commandPrefix = useMemo(() => {
    const prefixes = selectedGroupSettings?.commandPrefixes;
    if (!Array.isArray(prefixes) || prefixes.length === 0) return "/";
    const firstValid = prefixes.find((entry) => typeof entry === "string" && entry.trim().length > 0);
    return firstValid?.trim() || "/";
  }, [selectedGroupSettings]);
  const botCoinsCurrencyLabel = "R$";
  const visibleBotCoinsShortcuts = useMemo(() => BOTCOINS_SHORTCUTS, []);
  const premiumCommandOptions = useMemo(
    () =>
      GROUP_COMMAND_CATALOG.flatMap((section) =>
        section.items.map((item) => ({
          ...item,
          sectionKey: section.key,
          sectionTitle: section.title,
        })),
      ),
    [botInterageAllowed],
  );
  const activeCoinMember = useMemo(() => {
    if (!coinMemberModal) return null;
    return coinMembers.find((member) => member.memberJid === coinMemberModal.memberJid) ?? coinMemberModal;
  }, [coinMemberModal, coinMembers]);
  const selectedGroupActivity = useMemo(
    () => (selectedGroup ? groupActivityById[selectedGroup.id] ?? [] : []),
    [groupActivityById, selectedGroup],
  );
  const selectedGroupParticipants = useMemo(
    () =>
      selectedGroup
        ? groupParticipantsById[selectedGroup.id] ?? selectedGroup.participants ?? []
        : [],
    [groupParticipantsById, selectedGroup],
  );
  const selectedGroupParticipantsCount = useMemo(() => {
    if (!selectedGroup) return 0;
    const loadedParticipants = groupParticipantsById[selectedGroup.id];
    if (Array.isArray(loadedParticipants) && loadedParticipants.length > 0) {
      return loadedParticipants.length;
    }
    if (typeof selectedGroup.participantCount === "number" && selectedGroup.participantCount >= 0) {
      return selectedGroup.participantCount;
    }
    return Array.isArray(selectedGroup.participants) ? selectedGroup.participants.length : 0;
  }, [groupParticipantsById, selectedGroup]);
  const selectedGroupAllowsAdminEdits = useMemo(() => {
    if (!selectedGroup) return false;
    const instanceDigits = normalizeParticipantDigits(selectedGroup.instancePhone ?? "");
    if (!instanceDigits) return true;

    const ownerDigits = normalizeIdentityDigits(selectedGroup.owner ?? "");
    if (hasPhoneDigitsMatch(instanceDigits, ownerDigits)) {
      return true;
    }

    if (!ownerDigits && selectedGroupParticipantsCount === 0) {
      return true;
    }

    const hasAdminParticipantData = selectedGroupParticipants.some((participant) => participant.admin !== "member");
    if (!ownerDigits && !hasAdminParticipantData) {
      return true;
    }

    return selectedGroupParticipants.some((participant) => {
      if (participant.admin === "member") return false;
      const participantDigits = normalizeIdentityDigits(participant.id);
      return hasPhoneDigitsMatch(instanceDigits, participantDigits);
    });
  }, [selectedGroup, selectedGroupParticipants, selectedGroupParticipantsCount]);
  const filteredParticipants = useMemo(() => {
    const needle = participantSearch.trim().toLowerCase();
    if (!needle) return selectedGroupParticipants;
    return selectedGroupParticipants.filter((participant) => {
      const participantText = `${participant.id} ${formatParticipantDisplay(participant.id)}`.toLowerCase();
      return participantText.includes(needle);
    });
  }, [participantSearch, selectedGroupParticipants]);
  const participantImportSourceGroups = useMemo(() => {
    if (!selectedGroup) return [];
    return groups
      .filter(
        (group) =>
          group.id !== selectedGroup.id &&
          (group.status === "active" || group.status === "disabled"),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [groups, selectedGroup]);
  const participantImportJobActive = useMemo(
    () =>
      Boolean(
        participantImportJob &&
          (participantImportJob.status === "queued" ||
            participantImportJob.status === "running" ||
            participantImportJob.status === "paused" ||
            participantImportJob.status === "cancelling"),
      ),
    [participantImportJob],
  );
  const participantImportJobHasWarnings = useMemo(
    () =>
      Boolean(
        participantImportJob &&
          participantImportJob.status === "completed" &&
          (participantImportJob.failedCount > 0 || Boolean(participantImportJob.lastError)),
      ),
    [participantImportJob],
  );
  const participantImportJobStatusLabel = useMemo(() => {
    if (!participantImportJob) return "Sem processo ativo";
    switch (participantImportJob.status) {
      case "queued":
        return "Na fila";
      case "running":
        return "Em execução";
      case "paused":
        return "Pausado";
      case "cancelling":
        return "Cancelando";
      case "completed":
        return participantImportJobHasWarnings ? "Concluído com falhas" : "Concluído";
      case "cancelled":
        return "Cancelado";
      case "failed":
        return "Falhou";
      default:
        return "Desconhecido";
    }
  }, [participantImportJob, participantImportJobHasWarnings]);
  const participantImportJobStatusClassName = useMemo(() => {
    if (!participantImportJob) return styles.instanceStatusPending;
    if (participantImportJob.status === "failed" || participantImportJob.status === "cancelled") {
      return styles.instanceStatusDisconnected;
    }
    if (participantImportJob.status === "completed") {
      return participantImportJobHasWarnings ? styles.instanceStatusWarning : styles.instanceStatusConnected;
    }
    return styles.instanceStatusPending;
  }, [participantImportJob, participantImportJobHasWarnings]);
  const participantImportProgressStateClassName = useMemo(() => {
    if (!participantImportJob) return styles.participantImportProgressSuccess;
    if (participantImportJob.status === "failed" || participantImportJob.status === "cancelled") {
      return styles.participantImportProgressError;
    }
    if (participantImportJob.status === "completed" && participantImportJobHasWarnings) {
      return styles.participantImportProgressWarning;
    }
    return styles.participantImportProgressSuccess;
  }, [participantImportJob, participantImportJobHasWarnings]);
  const participantImportNotificationVisible = useMemo(
    () => participantImportJobActive,
    [participantImportJobActive],
  );
  const visibleParticipants = useMemo(
    () => (showAllParticipants ? filteredParticipants : filteredParticipants.slice(0, 18)),
    [filteredParticipants, showAllParticipants],
  );
  const renderAutomationMediaPreview = (
    media: BotGroupAutoResponse["responseMedia"] | null,
    fallbackUrl?: string | null,
  ) => {
    const urlFromFallback = typeof fallbackUrl === "string" ? resolveUploadedMediaUrl(fallbackUrl, null) : "";
    const url = media
      ? resolveUploadedMediaUrl(media.url, media.path)
      : urlFromFallback;
    if (!url) return null;

    const mediaType = media?.mediaType ?? inferMediaTypeFromUrl(url);
    let fileLabel = media?.fileName?.trim() || "";
    if (!fileLabel) {
      const rawSegment = url.split("/").pop() || "";
      try {
        fileLabel = decodeURIComponent(rawSegment);
      } catch {
        fileLabel = rawSegment;
      }
    }
    if (!fileLabel) {
      fileLabel = "arquivo";
    }

    return (
      <div className={styles.automationMediaPreviewBox}>
        {mediaType === "image" || mediaType === "sticker" ? (
          <img src={url} alt="Pré-visualização da mídia" className={styles.automationMediaPreviewAsset} />
        ) : null}
        {mediaType === "video" ? (
          <video controls preload="metadata" className={styles.automationMediaPreviewAsset}>
            <source src={url} />
          </video>
        ) : null}
        {mediaType === "audio" ? (
          <audio controls preload="metadata" className={styles.automationMediaPreviewAudio}>
            <source src={url} />
          </audio>
        ) : null}
        {mediaType === "document" ? (
          <a href={url} target="_blank" rel="noreferrer" className={styles.automationMediaPreviewFile}>
            Abrir arquivo: {fileLabel}
          </a>
        ) : null}
      </div>
    );
  };

  useEffect(() => {
    if (!selectedGroup) {
      previousSelectedGroupIdRef.current = null;
      return;
    }

    if (previousSelectedGroupIdRef.current !== selectedGroup.id) {
      if (previousSelectedGroupIdRef.current === null) {
        previousSelectedGroupIdRef.current = selectedGroup.id;
        return;
      }
      setDetailsPanelOpen(!isMobileViewport);
      previousSelectedGroupIdRef.current = selectedGroup.id;
    }
  }, [isMobileViewport, selectedGroup]);

  const filteredGroups = useMemo(() => {
    const scopedGroups =
      groupFilterInstanceId === null
        ? groups
        : groupFilterInstanceId === 0
          ? groups.filter((group) => group.instanceId === 0)
          : groups.filter((group) => group.instanceId === groupFilterInstanceId);
    const needle = groupSearch.trim().toLowerCase();
    if (!needle) return scopedGroups;
    return scopedGroups.filter((group) => `${group.name} ${group.instanceName}`.toLowerCase().includes(needle));
  }, [groupFilterInstanceId, groupSearch, groups]);

  const filteredCampaigns = useMemo(() => {
    const visibleCampaigns = campaigns.filter((campaign) => {
      const kind = campaignKind(campaign);
      return kind === "group" || kind === "mixed";
    });
    const needle = campaignSearch.trim().toLowerCase();
    if (!needle) return visibleCampaigns;
    return visibleCampaigns.filter((campaign) => campaign.name.toLowerCase().includes(needle));
  }, [campaignSearch, campaigns]);
  const filteredAffiliateProviders = useMemo(() => {
    const needle = affiliateSearch.trim().toLowerCase();
    if (!needle) return affiliateProviders;
    return affiliateProviders.filter((provider) =>
      `${provider.label} ${provider.description}`.toLowerCase().includes(needle),
    );
  }, [affiliateProviders, affiliateSearch]);
  const botAdminAffiliateVisible = useMemo(() => {
    const needle = affiliateSearch.trim().toLowerCase();
    if (!needle) return true;
    return BOT_ADMIN_AFFILIATE_SEARCH_TEXT.includes(needle);
  }, [affiliateSearch]);
  const selectedAffiliateProvider = useMemo(
    () => {
      if (selectedAffiliateProviderKey === BOT_ADMIN_AFFILIATE_PROVIDER_KEY) {
        return null;
      }
      return (
        affiliateProviders.find((provider) => provider.provider === selectedAffiliateProviderKey) ??
        affiliateProviders[0] ??
        null
      );
    },
    [affiliateProviders, selectedAffiliateProviderKey],
  );
  const selectedAffiliateProviderAccount = useMemo(() => {
    if (!selectedAffiliateProvider) return null;
    const accounts = Array.isArray(selectedAffiliateProvider.accounts)
      ? selectedAffiliateProvider.accounts
      : [];
    return (
      accounts.find((entry) => entry.selected) ||
      (selectedAffiliateProvider.selectedConnectionId !== null
        ? accounts.find((entry) => entry.id === selectedAffiliateProvider.selectedConnectionId)
        : null) ||
      accounts[0] ||
      null
    );
  }, [selectedAffiliateProvider]);
  const selectedAffiliateProviderConnectionId = useMemo(() => {
    const raw = Number(selectedAffiliateProviderAccount?.id);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.floor(raw);
  }, [selectedAffiliateProviderAccount]);
  const isAffiliateAutomationProvider =
    selectedAffiliateProvider?.provider === "mercadolivre" ||
    selectedAffiliateProvider?.provider === "shopee";
  const isAffiliateShopeeProvider = selectedAffiliateProvider?.provider === "shopee";
  const isAffiliateResolverProvider = selectedAffiliateProvider?.provider === "mercadolivre";
  const affiliateApiBasePath =
    selectedAffiliateProvider?.provider === "shopee"
      ? "/api/affiliates/shopee"
      : "/api/affiliates/mercadolivre";
  const shopeePerformancePeriodDays = useMemo(() => {
    const parsed = Number(shopeePerformancePeriodDaysInput);
    if (!Number.isFinite(parsed)) return 30;
    return Math.max(1, Math.min(365, Math.floor(parsed)));
  }, [shopeePerformancePeriodDaysInput]);
  const shopeePerformanceLimit = useMemo(() => {
    const parsed = Number(shopeePerformanceLimitInput);
    if (!Number.isFinite(parsed)) return 100;
    return Math.max(1, Math.min(200, Math.floor(parsed)));
  }, [shopeePerformanceLimitInput]);
  const shopeeOfferSortType = useMemo(() => {
    const parsed = Number(shopeeOfferSortInput);
    if (!Number.isFinite(parsed)) return 2;
    return Math.max(1, Math.min(9, Math.floor(parsed)));
  }, [shopeeOfferSortInput]);
  const shopeeOfferLimit = useMemo(() => {
    const parsed = Number(shopeeOfferLimitInput);
    if (!Number.isFinite(parsed)) return 20;
    return Math.max(1, Math.min(50, Math.floor(parsed)));
  }, [shopeeOfferLimitInput]);
  const shopeeFeedPreviewLimit = useMemo(() => {
    const parsed = Number(shopeeFeedPreviewLimitInput);
    if (!Number.isFinite(parsed)) return 100;
    return Math.max(1, Math.min(500, Math.floor(parsed)));
  }, [shopeeFeedPreviewLimitInput]);
  const shopeeSelectedFeedEntries = useMemo(
    () => shopeeFeedsByMode[shopeeSelectedFeedMode] || [],
    [shopeeFeedsByMode, shopeeSelectedFeedMode],
  );
  const shopeeSelectedFeed = useMemo(
    () => shopeeSelectedFeedEntries.find((entry) => entry.datafeedId === shopeeSelectedFeedId) || null,
    [shopeeSelectedFeedEntries, shopeeSelectedFeedId],
  );
  const selectedAffiliateMlImportPreset = useMemo(
    () =>
      AFFILIATE_ML_IMPORT_CATEGORY_PRESETS.find((preset) => preset.key === affiliateMlImportPresetKey) ??
      null,
    [affiliateMlImportPresetKey],
  );
  const affiliateMlEffectiveImportQuery = useMemo(() => {
    const presetTerm =
      selectedAffiliateProvider?.provider === "shopee"
        ? selectedAffiliateMlImportPreset?.shopeeQuery?.trim() ?? selectedAffiliateMlImportPreset?.query?.trim() ?? ""
        : selectedAffiliateMlImportPreset?.query?.trim() ?? "";
    const typedTerm = affiliateMlImportCategoryQuery.trim();
    if (presetTerm === "__ALL_CATEGORIES__") {
      return typedTerm || "__ALL_CATEGORIES__";
    }
    if (presetTerm && typedTerm) {
      return `${presetTerm} ${typedTerm}`.trim();
    }
    return typedTerm || presetTerm;
  }, [affiliateMlImportCategoryQuery, selectedAffiliateMlImportPreset, selectedAffiliateProvider?.provider]);
  const importedAffiliateMlItemIds = useMemo(
    () =>
      new Set(
        affiliateMlLinks
          .map((entry) => String(entry.itemId || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    [affiliateMlLinks],
  );
  const selectedAffiliateMlImportCount = useMemo(
    () =>
      affiliateMlImportProducts.filter(
        (entry) =>
          Boolean(affiliateMlImportSelectedIds[entry.itemId]) &&
          Boolean(entry.affiliateUrl) &&
          !importedAffiliateMlItemIds.has(String(entry.itemId || "").trim().toUpperCase()),
      ).length,
    [affiliateMlImportProducts, affiliateMlImportSelectedIds, importedAffiliateMlItemIds],
  );
  const affiliateMlImportAlreadyImportedCount = useMemo(
    () =>
      affiliateMlImportProducts.filter((entry) =>
        importedAffiliateMlItemIds.has(String(entry.itemId || "").trim().toUpperCase()),
      ).length,
    [affiliateMlImportProducts, importedAffiliateMlItemIds],
  );
  const affiliateMlImportSelectableCount = useMemo(
    () =>
      affiliateMlImportProducts.filter(
        (entry) =>
          Boolean(entry.affiliateUrl) &&
          !importedAffiliateMlItemIds.has(String(entry.itemId || "").trim().toUpperCase()),
      ).length,
    [affiliateMlImportProducts, importedAffiliateMlItemIds],
  );
  const affiliateMlImportWarningSummary = useMemo(
    () => summarizeAffiliateImportWarning(affiliateMlImportWarning),
    [affiliateMlImportWarning],
  );
  const affiliateImportJobActive = useMemo(
    () =>
      Boolean(
        affiliateImportJob &&
          (affiliateImportJob.status === "running" || affiliateImportJob.status === "cancelling"),
      ),
    [affiliateImportJob],
  );
  const affiliateImportJobStatusLabel = useMemo(() => {
    if (!affiliateImportJob) return "Sem importação";
    switch (affiliateImportJob.status) {
      case "running":
        return "Importando";
      case "cancelling":
        return "Cancelando";
      case "completed":
        return affiliateImportJob.failed > 0 ? "Concluído com falhas" : "Concluído";
      case "cancelled":
        return "Cancelado";
      case "failed":
        return "Falhou";
      default:
        return "Desconhecido";
    }
  }, [affiliateImportJob]);
  const affiliateImportJobStatusClassName = useMemo(() => {
    if (!affiliateImportJob) return styles.instanceStatusPending;
    if (affiliateImportJob.status === "failed" || affiliateImportJob.status === "cancelled") {
      return styles.instanceStatusDisconnected;
    }
    if (affiliateImportJob.status === "completed") {
      return affiliateImportJob.failed > 0 ? styles.instanceStatusWarning : styles.instanceStatusConnected;
    }
    return styles.instanceStatusPending;
  }, [affiliateImportJob]);
  const affiliateImportProgressClassName = useMemo(() => {
    if (!affiliateImportJob) return styles.participantImportProgressSuccess;
    if (affiliateImportJob.status === "failed" || affiliateImportJob.status === "cancelled") {
      return styles.participantImportProgressError;
    }
    if (affiliateImportJob.status === "completed" && affiliateImportJob.failed > 0) {
      return styles.participantImportProgressWarning;
    }
    return styles.participantImportProgressSuccess;
  }, [affiliateImportJob]);
  const affiliateMlCategoryFilterOptions = useMemo(() => {
    const counters = new Map<string, number>();
    affiliateMlLinks.forEach((entry) => {
      const key = entry.categoryId && entry.categoryId.trim() ? entry.categoryId.trim().toUpperCase() : "__NO_CATEGORY__";
      counters.set(key, (counters.get(key) || 0) + 1);
    });

    const options = Array.from(counters.entries())
      .map(([value, count]) => ({
        value,
        label: value === "__NO_CATEGORY__" ? `Sem categoria (${count})` : `${value} (${count})`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

    return [{ value: "all", label: "Todas categorias" }, ...options];
  }, [affiliateMlLinks]);
  const filteredAffiliateMlLinks = useMemo(() => {
    if (affiliateMlListCategoryFilter === "all") return affiliateMlLinks;
    if (affiliateMlListCategoryFilter === "__NO_CATEGORY__") {
      return affiliateMlLinks.filter((entry) => !entry.categoryId || !entry.categoryId.trim());
    }
    return affiliateMlLinks.filter(
      (entry) =>
        entry.categoryId &&
        entry.categoryId.trim().toUpperCase() === affiliateMlListCategoryFilter,
    );
  }, [affiliateMlLinks, affiliateMlListCategoryFilter]);
  const affiliateMlDisplayLimit = useMemo(() => {
    const raw = affiliateMlDisplayLimitInput.trim().toLowerCase();
    if (!raw || raw === "all" || raw === "todos" || raw === "0") {
      return 0;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return 100;
    }
    return Math.max(20, Math.min(5000, Math.floor(parsed)));
  }, [affiliateMlDisplayLimitInput]);
  const visibleAffiliateMlLinks = useMemo(() => {
    if (affiliateMlDisplayLimit <= 0) {
      return filteredAffiliateMlLinks;
    }
    return filteredAffiliateMlLinks.slice(0, affiliateMlDisplayLimit);
  }, [affiliateMlDisplayLimit, filteredAffiliateMlLinks]);
  const selectedAffiliateMlCount = useMemo(
    () => filteredAffiliateMlLinks.filter((entry) => Boolean(affiliateMlSelectedItemIds[entry.itemId])).length,
    [affiliateMlSelectedItemIds, filteredAffiliateMlLinks],
  );
  const allVisibleAffiliateMlSelected = useMemo(
    () =>
      visibleAffiliateMlLinks.length > 0 &&
      visibleAffiliateMlLinks.every((entry) => Boolean(affiliateMlSelectedItemIds[entry.itemId])),
    [affiliateMlSelectedItemIds, visibleAffiliateMlLinks],
  );
  const affiliateMlDispatchMapByGroupId = useMemo(() => {
    const map = new Map<number, AffiliateMlGroupDispatch>();
    affiliateMlGroupDispatches.forEach((entry) => {
      map.set(entry.groupId, entry);
    });
    return map;
  }, [affiliateMlGroupDispatches]);
  const affiliateAutoSyncSelectedCategoryLabels = useMemo(() => {
    const presetByKey = new Map(
      AFFILIATE_AUTO_SYNC_DISCOVERY_CATEGORY_PRESETS.map((entry) => [entry.key, entry] as const),
    );
    return affiliateMlAutoSyncConfig.discoveryCategories
      .map((key) => {
        const normalizedKey = String(key || "").trim();
        if (!normalizedKey) return null;
        const preset = presetByKey.get(normalizedKey);
        return preset ? preset.label : normalizedKey;
      })
      .filter((entry): entry is string => Boolean(entry));
  }, [affiliateMlAutoSyncConfig.discoveryCategories]);
  const affiliateAutoSyncFiltersSummary = useMemo(() => {
    const categoriesSummary =
      affiliateAutoSyncSelectedCategoryLabels.length > 0
        ? `${affiliateAutoSyncSelectedCategoryLabels.length} categoria(s)`
        : "todas as categorias padrão";
    const termsSummary =
      affiliateMlAutoSyncConfig.discoveryTerms.length > 0
        ? `${affiliateMlAutoSyncConfig.discoveryTerms.length} palavra(s)-chave`
        : "sem palavras-chave extras";
    return `${categoriesSummary} + ${termsSummary}`;
  }, [affiliateAutoSyncSelectedCategoryLabels.length, affiliateMlAutoSyncConfig.discoveryTerms.length]);
  const affiliateMlCookieStatus = useMemo(() => {
    if (affiliateMlResolver.isValid === true) {
      return {
        label: affiliateMlResolver.enabled ? "Cookie válido (ativo)" : "Cookie válido (desativado)",
        className: styles.instanceStatusConnected,
      };
    }
    if (affiliateMlResolver.isValid === false) {
      return {
        label: "Cookie inválido",
        className: styles.instanceStatusDisconnected,
      };
    }
    if (affiliateMlResolver.hasCookie) {
      return {
        label: "Cookie pendente",
        className: styles.instanceStatusDisconnected,
      };
    }
    return {
      label: "Sem cookie",
      className: styles.instanceStatusDisconnected,
    };
  }, [affiliateMlResolver.enabled, affiliateMlResolver.hasCookie, affiliateMlResolver.isValid]);
  const hasOrphanGroups = useMemo(() => groups.some((group) => group.instanceId === 0), [groups]);

  useEffect(() => {
    if (groupFilterInstanceId !== 0) return;
    if (hasOrphanGroups) return;
    if (instances.length > 0) {
      setGroupFilterInstanceId(instances[0].id);
    } else {
      setGroupFilterInstanceId(null);
    }
  }, [groupFilterInstanceId, hasOrphanGroups, instances]);

  const availablePaymentProviders = useMemo(
    () =>
      PROVIDER_PRIORITY.filter((provider) =>
        paymentMethods.some((summary) => summary.provider === provider && summary.isActive && summary.isConfigured),
      ),
    [paymentMethods],
  );
  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const groupLicensePlans = useMemo(() => {
    const exactPlans = plans.filter((plan) =>
      plan.isActive &&
      GROUP_LICENSE_DURATION_ORDER.includes(plan.durationDays as (typeof GROUP_LICENSE_DURATION_ORDER)[number]),
    );
    return sortGroupLicensePlans(exactPlans.length > 0 ? exactPlans : plans.filter((plan) => plan.isActive));
  }, [plans]);
  const profilePlanOptions = useMemo(
    () =>
      plans
        .filter((plan) => plan.isActive)
        .slice()
        .sort((left, right) => {
          const priceDiff = left.price - right.price;
          if (priceDiff !== 0) return priceDiff;
          return left.durationDays - right.durationDays;
        }),
    [plans],
  );
  const defaultGroupLicensePlan = useMemo(
    () => groupLicensePlans.find((plan) => plan.durationDays === 30) ?? groupLicensePlans[0] ?? null,
    [groupLicensePlans],
  );
  const checkoutPlan = useMemo(() => {
    if (planStatus.plan) {
      return planById.get(planStatus.plan.id) ?? planStatus.plan;
    }
    return defaultGroupLicensePlan ?? plans.find((plan) => plan.isActive) ?? null;
  }, [defaultGroupLicensePlan, planById, planStatus.plan, plans]);
	  const hasActiveUserPlan = useMemo(() => {
	    if (isAdminUser) return true;
	    if (planStatus.status !== "active" || !planStatus.plan) return false;
	    const periodEndTs = toTimestamp(planStatus.currentPeriodEnd ?? null);
	    return periodEndTs === null || periodEndTs > Date.now();
	  }, [isAdminUser, planStatus.currentPeriodEnd, planStatus.plan, planStatus.status]);
	  const selectedProfileHasActiveLicense = Boolean(selectedInstance && isProfileLicenseActive(selectedInstance.expiresAt));
	  const canUseFlows = isAdminUser || hasActiveUserPlan || selectedProfileHasActiveLicense;
  const instanceById = useMemo(() => new Map(instances.map((instance) => [instance.id, instance])), [instances]);
  const connectedInstances = useMemo(
    () => instances.filter((instance) => instance.sessionStatus === "conectado"),
    [instances],
  );
	  const sortedActiveGroupsBySlot = useMemo(
	    () =>
	      groups
	        .filter((group) => group.status === "active")
	        .slice()
	        .sort((left, right) => {
	          const slotDiff = left.slot - right.slot;
	          if (slotDiff !== 0) return slotDiff;
	          return left.id - right.id;
	        }),
	    [groups],
	  );
  const resolveNextActiveGroupSlot = useCallback(
    (excludedGroupId?: number | null) => {
      const usedSlots = new Set<number>();
      for (const group of sortedActiveGroupsBySlot) {
        if (excludedGroupId && group.id === excludedGroupId) {
          continue;
        }
        const slot = Math.floor(Number(group.slot ?? 0));
        if (Number.isFinite(slot) && slot > 0) {
          usedSlots.add(slot);
        }
      }

      let slot = 1;
      while (usedSlots.has(slot)) {
        slot += 1;
      }
      return slot;
    },
    [sortedActiveGroupsBySlot],
  );
  const sortedInstancesByCreation = useMemo(
    () =>
      profileInstances
        .slice()
        .sort((left, right) => {
          const leftTs = Date.parse(left.createdAt);
          const rightTs = Date.parse(right.createdAt);
          const safeLeft = Number.isFinite(leftTs) ? leftTs : 0;
          const safeRight = Number.isFinite(rightTs) ? rightTs : 0;
          if (safeLeft === safeRight) return left.id - right.id;
          return safeLeft - safeRight;
        }),
    [profileInstances],
  );
  const sortedInstanceAddonsByCoverage = useMemo(
    () => sortAddonsByCoverageOrder(userAddons.filter((addon) => addon.type === "instance")),
    [userAddons],
  );
  const activeProfileSlotLimit = useMemo(() => {
    if (hasActiveUserPlan) {
      return Number.MAX_SAFE_INTEGER;
    }
    const baseLimit =
      planStatus.status === "active" && planStatus.plan
        ? Math.max(0, Math.floor(planLimits.instanceLimit || planStatus.plan.instanceLimit || 0))
        : Math.max(0, Math.floor(planLimits.instanceLimit || 0));
    const activeAddons = sortedInstanceAddonsByCoverage.filter((addon) => !isAddonExpired(addon)).length;
    return Math.max(1, baseLimit + activeAddons);
  }, [hasActiveUserPlan, planLimits.instanceLimit, planStatus.plan, planStatus.status, sortedInstanceAddonsByCoverage]);
  const profileUsageLabel = isAdminUser
    ? `${profileInstances.length} perfis · ilimitado`
    : hasActiveUserPlan
      ? `${profileInstances.length} perfis · plano ativo`
    : `${profileInstances.length}/${activeProfileSlotLimit} perfis`;
  const countOverflowForLimit = useCallback((limit: number, count: number) => {
    if (limit <= 0) return 0;
    return Math.max(0, count - limit);
  }, []);

	  const isInstanceOutOfCoverage = useCallback(
	    (instance: BotInstance | null | undefined) => {
	      if (!instance) return true;
	      if (isAdminUser || instance.purpose === "admin_system") return false;
	      if (isProfileLicenseActive(instance.expiresAt)) return false;
	      if (hasActiveUserPlan) return false;
	      const baseInstanceLimit =
	        planStatus.status === "active" && planStatus.plan
	          ? Math.max(0, Math.floor(planStatus.plan.instanceLimit || 0))
	          : 0;

	      const instancePosition = sortedInstancesByCreation.findIndex((entry) => entry.id === instance.id) + 1;
	      const effectivePosition = instancePosition > 0 ? instancePosition : sortedInstancesByCreation.length + 1;
      if (effectivePosition <= baseInstanceLimit) {
        return false;
      }
      const addon = findAddonForCoverageIndex(sortedInstanceAddonsByCoverage, effectivePosition - baseInstanceLimit);
      return !addon || isAddonExpired(addon);
    },
	    [hasActiveUserPlan, isAdminUser, planStatus.plan, planStatus.status, sortedInstanceAddonsByCoverage, sortedInstancesByCreation],
	  );

  const isInstanceExpired = useCallback(
    (instance: BotInstance | null | undefined) => {
      return isInstanceOutOfCoverage(instance);
    },
    [isInstanceOutOfCoverage],
  );

  const profilePlanCoveredGroupIds = useMemo(() => {
    const coveredIds = new Set<number>();
	    if (isAdminUser || hasActiveUserPlan) {
	      groups.forEach((group) => coveredIds.add(group.id));
	      return coveredIds;
	    }
	    groups.forEach((group) => {
	      const linkedInstance = instanceById.get(group.instanceId) ?? null;
	      if (isProfileLicenseActive(linkedInstance?.expiresAt ?? null)) {
	        coveredIds.add(group.id);
	      }
	    });
	    return coveredIds;
	  }, [groups, hasActiveUserPlan, instanceById, isAdminUser]);

  const isGroupCoveredByProfilePlan = useCallback(
    (group: BotGroup | null | undefined) => Boolean(group && profilePlanCoveredGroupIds.has(group.id)),
    [profilePlanCoveredGroupIds],
  );

  const isGroupOutOfCoverage = useCallback(
    (group: BotGroup | null | undefined) => {
      if (!group) return true;
      if (isGroupCoveredByProfilePlan(group)) return false;
      if (hasPausedResumeAccess(group)) return false;
      const expiryTs = toTimestamp(getIndividualGroupLicenseExpiresAt(group));
      return expiryTs === null || expiryTs < Date.now();
    },
    [isGroupCoveredByProfilePlan],
  );

  const canManageInstanceWhatsappProfile = useCallback(
    (instance: BotInstance | null | undefined) =>
      Boolean(instance && isConnectedInstanceStatus(instance.sessionStatus) && !isInstanceExpired(instance)),
    [isInstanceExpired],
  );
  const selectedInstanceCanManageProfile = useMemo(
    () => canManageInstanceWhatsappProfile(selectedInstance),
    [canManageInstanceWhatsappProfile, selectedInstance],
  );
	  const resolveGroupLifecycle = useCallback(
	    (group: BotGroup): GroupLifecycle => {
	      const linkedInstance = instanceById.get(group.instanceId) ?? null;
	      const instanceExpired = isInstanceExpired(linkedInstance);
	      const groupExpired = isGroupOutOfCoverage(group);
	      if (instanceExpired) {
	        return "expired";
	      }
	      if (groupExpired) {
	        return getIndividualGroupLicenseExpiresAt(group) ? "expired" : "inactive";
	      }

	      return "active";
	    },
	    [
	      instanceById,
	      isGroupOutOfCoverage,
	      isInstanceExpired,
	    ],
	  );
  const resolveGroupExpiryInfo = useCallback(
    (group: BotGroup): GroupExpiryInfo | null => {
      const linkedInstance = instanceById.get(group.instanceId) ?? null;
      const groupLicenseExpiresAt = getIndividualGroupLicenseExpiresAt(group);

      const info = buildAddonExpiryInfo(groupLicenseExpiresAt);
      if (!info) {
        return null;
      }

	      const sourceLabel = (() => {
	        const source = group.metadata?.licenseSource?.trim().toLowerCase() ?? "";
	        if (source === "bot_resale") return "Renovação do perfil via WhatsApp";
	        if (source === "group_purchase") return "Compra legada do grupo";
	        if (linkedInstance?.licenseSalesEnabled) return "Renovação do perfil via WhatsApp";
	        return "Licença legada do grupo";
	      })();

      const expired = (toTimestamp(info.expiresAt) ?? 0) < Date.now();
      return {
        ...info,
        detailText: `${sourceLabel} · ${expired ? "Venceu em" : "Vence em"} ${formatCoverageDateTime(info.expiresAt)}`,
      };
    },
    [instanceById, planStatus.currentPeriodEnd, planStatus.plan, planStatus.status],
  );
  const selectedGroupExpiryInfo = useMemo(
    () => (selectedGroup ? resolveGroupExpiryInfo(selectedGroup) : null),
    [resolveGroupExpiryInfo, selectedGroup],
  );
  const transferLicenseSourceGroup = useMemo(
    () => groups.find((group) => group.id === transferLicenseModalGroupId) ?? null,
    [groups, transferLicenseModalGroupId],
  );
  const transferLicenseTargetGroups = useMemo(
    () =>
      groups
        .filter((group) => group.id !== transferLicenseModalGroupId && !isIndividualGroupLicenseActive(group))
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [groups, transferLicenseModalGroupId],
  );
  const affiliateDispatchCoveredGroups = useMemo(() => {
    const sortedActiveGroups = groups
      .filter(
        (group) =>
          group.status === "active" &&
          Boolean(group.remoteId) &&
          Number.isFinite(group.instanceId) &&
          group.instanceId > 0,
      )
      .slice()
      .sort((left, right) => {
        const slotDiff = left.slot - right.slot;
        if (slotDiff !== 0) return slotDiff;
        return left.id - right.id;
      });

    return sortedActiveGroups.filter((group) => {
      const linkedInstance = instanceById.get(group.instanceId) ?? null;
      if (!linkedInstance || linkedInstance.sessionStatus !== "conectado" || isInstanceExpired(linkedInstance)) {
        return false;
      }
      if (isGroupOutOfCoverage(group)) {
        return false;
      }
      return true;
    });
  }, [groups, instanceById, isGroupOutOfCoverage, isInstanceExpired]);
  const activeConversationGroupJids = useMemo(
    () =>
	      groups
	        .filter((group) => {
	          if (!group.remoteId) return false;
	          return resolveGroupLifecycle(group) === "active";
	        })
	        .map((group) => group.remoteId),
	    [groups, resolveGroupLifecycle],
	  );
  const affiliateDispatchAvailableInstances = useMemo(
    () =>
      connectedInstances.filter(
        (instance) =>
          !isInstanceExpired(instance) &&
          affiliateDispatchCoveredGroups.some((group) => group.instanceId === instance.id),
      ),
    [affiliateDispatchCoveredGroups, connectedInstances, isInstanceExpired],
  );
  const affiliateDispatchCreatableGroups = useMemo(
    () => affiliateDispatchCoveredGroups.filter((group) => !affiliateMlDispatchMapByGroupId.has(group.id)),
    [affiliateDispatchCoveredGroups, affiliateMlDispatchMapByGroupId],
  );
  const affiliateMlDispatchGroups = useMemo(() => {
    const selectedInstanceId = Number(affiliateMlDispatchInstanceIdInput);
    const hasSelectedInstance = Number.isFinite(selectedInstanceId) && selectedInstanceId > 0;
    return affiliateDispatchCoveredGroups
      .filter((group) => !hasSelectedInstance || group.instanceId === selectedInstanceId)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [affiliateDispatchCoveredGroups, affiliateMlDispatchInstanceIdInput]);
  const buildAffiliateDispatchGroupsForInstance = useCallback(
    (instanceIdValue: number | string | null | undefined, currentGroupId?: number | null) => {
      const selectedInstanceId = Number(instanceIdValue);
      const hasSelectedInstance = Number.isFinite(selectedInstanceId) && selectedInstanceId > 0;
      const currentGroup =
        currentGroupId && Number.isFinite(currentGroupId) && currentGroupId > 0
          ? groups.find((group) => group.id === currentGroupId) ?? null
          : null;
      const allowed = affiliateDispatchCoveredGroups.filter((group) => {
        if (hasSelectedInstance && group.instanceId !== selectedInstanceId) {
          return false;
        }
        return !affiliateMlDispatchMapByGroupId.has(group.id) || group.id === currentGroupId;
      });
      const merged = new Map<number, BotGroup>();
      if (currentGroup && (!hasSelectedInstance || currentGroup.instanceId === selectedInstanceId)) {
        merged.set(currentGroup.id, currentGroup);
      }
      allowed.forEach((group) => {
        merged.set(group.id, group);
      });
      return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
    },
    [affiliateDispatchCoveredGroups, affiliateMlDispatchMapByGroupId, groups],
  );
  const affiliateDispatchModalGroups = useMemo(
    () =>
      affiliateDispatchModal
        ? buildAffiliateDispatchGroupsForInstance(affiliateDispatchModal.instanceId, Number(affiliateDispatchModal.groupId))
        : [],
    [affiliateDispatchModal, buildAffiliateDispatchGroupsForInstance],
  );

	  const groupActionLabel = useCallback(
	    (group: BotGroup) => {
	      const lifecycle = resolveGroupLifecycle(group);
	      if (lifecycle === "active" && group.status !== "active") return "Ativar robô";
	      return lifecycle === "inactive" ? "Assinar perfil" : "Renovar perfil";
	    },
	    [resolveGroupLifecycle],
	  );
		  const groupActivationLabel = useCallback(
		    (group: BotGroup) => {
		      const lifecycle = resolveGroupLifecycle(group);
		      if (lifecycle === "active") return group.status === "active" ? "Plano ativo" : "Robô pausado";
		      if (lifecycle === "expired") return "Plano vencido";
		      return "Plano necessário";
		    },
		    [resolveGroupLifecycle],
		  );
  const groupTierLabel = useCallback(
    (group: BotGroup) => {
      const lifecycle = resolveGroupLifecycle(group);
      const hasGroupLicense = Boolean(group.metadata?.licenseExpiresAt);
	      if (lifecycle === "active") return hasGroupLicense ? "Licença ativa" : "Liberado";
	      if (lifecycle === "expired") return hasGroupLicense ? "Licença vencida" : "Plano vencido";
	      return hasGroupLicense ? "Sem licença" : "Padrão";
    },
    [resolveGroupLifecycle],
  );

  const closeQuickCheckout = useCallback(() => {
    if (quickCheckoutGenerating) return;
    setQuickCheckoutContext(null);
    setQuickCheckoutPending(null);
    setQuickCheckoutError(null);
    setQuickCheckoutSuccess(null);
    setQuickCheckoutUseBalance(false);
  }, [quickCheckoutGenerating]);

  const quickCheckoutRequiresPayment = useCallback((context: QuickCheckoutContext | null | undefined) => {
    if (isAdminUser) return false;
    if (!context) return false;
    if (context.mode === "instance_renewal") {
      return context.includePlan || context.addons.group > 0 || context.addons.instance > 0;
    }
    if (
      hasActiveUserPlan &&
      (context.mode === "instance_creation" ||
        context.mode === "profile_unlimited")
    ) {
      return false;
    }
    return context.includePlan || context.addons.group > 0 || context.addons.instance > 0;
  }, [hasActiveUserPlan, isAdminUser]);

  useEffect(() => {
    if (section !== "groups") {
      return;
    }
    if (filteredGroups.length === 0) {
      setSelectedGroupId(null);
      return;
    }
    if (!selectedGroupId || !filteredGroups.some((item) => item.id === selectedGroupId)) {
      setSelectedGroupId(filteredGroups[0].id);
    }
  }, [filteredGroups, section, selectedGroupId]);

  useEffect(() => {
    if (section !== "affiliates") {
      return;
    }
    if (selectedAffiliateProviderKey === BOT_ADMIN_AFFILIATE_PROVIDER_KEY && botAdminAffiliateVisible) {
      return;
    }
    if (filteredAffiliateProviders.length === 0) {
      setSelectedAffiliateProviderKey(botAdminAffiliateVisible ? BOT_ADMIN_AFFILIATE_PROVIDER_KEY : "");
      return;
    }
    if (
      !selectedAffiliateProviderKey ||
      !filteredAffiliateProviders.some((item) => item.provider === selectedAffiliateProviderKey)
    ) {
      setSelectedAffiliateProviderKey(
        botAdminAffiliateVisible ? BOT_ADMIN_AFFILIATE_PROVIDER_KEY : filteredAffiliateProviders[0].provider,
      );
    }
  }, [botAdminAffiliateVisible, filteredAffiliateProviders, section, selectedAffiliateProviderKey]);

  useEffect(() => {
    if (section !== "affiliates") {
      return;
    }
    if (
      searchParams.get("botAdminAffiliate") === "1" ||
      searchParams.get("affiliate") === BOT_ADMIN_AFFILIATE_PROVIDER_KEY
    ) {
      setSelectedAffiliateProviderKey(BOT_ADMIN_AFFILIATE_PROVIDER_KEY);
      setAffiliateTab("dispatch");
    }
  }, [searchParams, section]);

  useEffect(() => {
    if (section !== "affiliates") {
      return;
    }
    const requestedTab = resolveAffiliateTab(searchParams.get("affiliateTab"), affiliateTab);
    if (requestedTab !== affiliateTab) {
      setAffiliateTab(requestedTab);
    }
  }, [affiliateTab, searchParams, section]);

  useEffect(() => {
    if (section !== "campaigns") {
      return;
    }
    if (filteredCampaigns.length === 0) {
      setSelectedCampaignId(null);
      return;
    }
    if (!selectedCampaignId || !filteredCampaigns.some((item) => item.id === selectedCampaignId)) {
      setSelectedCampaignId(filteredCampaigns[0].id);
    }
  }, [filteredCampaigns, section, selectedCampaignId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (selectedInstanceId != null && instances.some((instance) => instance.id === selectedInstanceId)) {
      window.localStorage.setItem(INSTANCE_PREFERENCE_STORAGE_KEY, String(selectedInstanceId));
      return;
    }
    window.localStorage.removeItem(INSTANCE_PREFERENCE_STORAGE_KEY);
  }, [instances, selectedInstanceId]);

  const sectionHasDetail =
    section === "groups"
      ? Boolean(selectedGroup)
      : section === "instances"
        ? Boolean(selectedInstance)
        : section === "campaigns"
          ? true
        : section === "affiliates"
          ? selectedAffiliateProviderKey === BOT_ADMIN_AFFILIATE_PROVIDER_KEY || Boolean(selectedAffiliateProvider)
          : true;
  const showMobileDetailPane =
    isMobileViewport &&
    (isModuleSection(section) || (mobileView === "detail" && sectionHasDetail));

  const changeSection = useCallback(
    (next: Section) => {
      setSection(next);
      setMobileMenuOpen(false);
      setProfileSwitcherOpen(false);
      setQuickActionsOpen(false);
      setMobileView("list");
      if (next !== "groups") {
        setDetailsPanelOpen(false);
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DASHBOARD_SECTION_STORAGE_KEY, next);
      }
    },
    [],
  );

  const openBotAdminAffiliateSection = useCallback(() => {
    setSelectedAffiliateProviderKey(BOT_ADMIN_AFFILIATE_PROVIDER_KEY);
    setAffiliateTab("dispatch");
    changeSection("affiliates");
    if (isMobileViewport) {
      setMobileView("detail");
    }
  }, [changeSection, isMobileViewport]);

  const loadResaleWalletBalance = useCallback(async () => {
    setLoadingResaleWallet(true);
    try {
      const response = await fetch("/api/user/bot-resale/wallet", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return;
      }
      const balance = Number(data?.wallet?.balance);
      setResaleWalletBalance(Number.isFinite(balance) ? balance : 0);
    } catch {
      // ignore temporary errors for header badge
    } finally {
      setLoadingResaleWallet(false);
    }
  }, []);

  useEffect(() => {
    void loadResaleWalletBalance();
  }, [loadResaleWalletBalance]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleWalletRefresh = () => {
      void loadResaleWalletBalance();
    };
    window.addEventListener("purchase:created", handleWalletRefresh as EventListener);
    window.addEventListener("bot-resale:wallet-updated", handleWalletRefresh as EventListener);
    return () => {
      window.removeEventListener("purchase:created", handleWalletRefresh as EventListener);
      window.removeEventListener("bot-resale:wallet-updated", handleWalletRefresh as EventListener);
    };
  }, [loadResaleWalletBalance]);

  const openQuickSupport = useCallback(() => {
    setQuickActionsOpen(false);
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("user-support:open", {
        detail: { whatsappId: null },
        cancelable: true,
      }),
    );
  }, []);

  const openQuickNewConversation = useCallback(() => {
    setQuickActionsOpen(false);
    changeSection("conversations");
    if (isMobileViewport) {
      setMobileView("list");
    }
  }, [changeSection, isMobileViewport]);

  const advanceOnboardingFor = useCallback((_stepId: string) => {}, []);

  useEffect(() => {
    pairingModalRef.current = pairingModal;
  }, [pairingModal]);

  const closeCreateInstanceModal = useCallback(
    (_options: { cancelOnboarding?: boolean } = {}) => {
      setIsCreateInstanceModalOpen(false);
    },
    [],
  );

  const handleLogout = useCallback(async () => {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), 2200) : null;
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        signal: controller?.signal,
      });
    } catch {
      // segue para redirecionamento mesmo em falha de rede
    } finally {
      if (timeout) window.clearTimeout(timeout);
      if (typeof window !== "undefined") {
        window.location.replace("/sign-in?logout=1");
      } else {
        router.replace("/sign-in");
      }
    }
  }, [router]);

  const refreshInstances = useCallback(async () => {
    const response = await fetch("/api/bot-instances", { cache: "no-store" });
    if (!response.ok) throw new Error(await parseError(response));
    const payload = (await response.json()) as { instances?: BotInstance[] };
    const nextInstances = payload.instances ?? [];
    setInstances(nextInstances);
    return nextInstances;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let refreshTimer: number | null = null;

    const scheduleRefresh = () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshInstances().catch(() => undefined);
      }, 350);
    };

    const applyInstanceStatus = (event: WhatsappRealtimeEnvelope) => {
      const eventType = event.eventType ?? event.type;
      if (eventType !== "instance.status") {
        return;
      }

      const instanceId = Number(event.instanceId ?? event.payload?.instance?.id);
      const status = event.payload?.status;
      const isKnownStatus =
        status === "conectado" ||
        status === "desconectado" ||
        status === "aguardando_qr" ||
        status === "aguardando_pareamento" ||
        status === "inicializando";

      if (!Number.isFinite(instanceId) || instanceId <= 0) {
        scheduleRefresh();
        return;
      }

      if (!isKnownStatus) {
        scheduleRefresh();
        return;
      }

      const nextPhone = event.payload?.phone ?? event.payload?.instance?.phone ?? null;
      const nextName = event.payload?.instance?.name ?? null;
      let found = false;

      setInstances((current) =>
        current.map((instance) => {
          if (instance.id !== instanceId) {
            return instance;
          }
          found = true;
          return {
            ...instance,
            sessionStatus: status,
            phone: nextPhone ? String(nextPhone) : instance.phone,
            name: nextName ? String(nextName) : instance.name,
            lastStatusSync: new Date().toISOString(),
          };
        }),
      );

      if (!found || status === "conectado" || status === "desconectado") {
        scheduleRefresh();
      }

      if (status === "conectado" && pairingModalRef.current?.instanceId === instanceId) {
        pairingRequestIdRef.current += 1;
        setPairingModal(null);
        setPairingMethodModal(null);
        setPairingGuideOpen(false);
        setBusyInstanceId(null);
        setFeedback({ ok: true, text: "Conexão estabelecida. Pareamento concluído." });
      }
    };

    const dispatchConversationRealtime = (event: WhatsappRealtimeEnvelope) => {
      const eventType = event.eventType ?? event.type;
      if (
        eventType !== "chat.action" &&
        eventType !== "message.action" &&
        eventType !== "conversation.message.upserted" &&
        eventType !== "status.update"
      ) {
        return;
      }
      window.dispatchEvent(new CustomEvent("botadmin:whatsapp-conversation-realtime", { detail: event }));
    };

    const connect = async () => {
      if (disposed) return;
      let afterSequenceId = 0;
      try {
        const response = await fetch("/api/whatsapp-realtime/events?limit=1", { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { latestSequenceId?: number };
          afterSequenceId = Number(payload.latestSequenceId ?? 0) || 0;
        }
      } catch {
        afterSequenceId = 0;
      }

      if (disposed) return;
      socket = new WebSocket(buildWhatsappRealtimeWebSocketUrl(afterSequenceId));
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as WhatsappRealtimeEnvelope;
          if (event.type === "ping") {
            socket?.send(JSON.stringify({ type: "pong", at: new Date().toISOString() }));
            return;
          }
          applyInstanceStatus(event);
          dispatchConversationRealtime(event);
        } catch {
          // Ignore malformed realtime frames; status polling remains as fallback.
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          void connect();
        }, 1800);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      socket?.close();
    };
  }, [refreshInstances]);

  const refreshGroups = useCallback(async () => {
    const response = await fetch("/api/bot-groups", { cache: "no-store" });
    if (!response.ok) throw new Error(await parseError(response));
    const payload = (await response.json()) as { groups?: BotGroup[] };
    const nextGroups = payload.groups ?? [];
    setGroups(nextGroups);
    return nextGroups;
  }, []);

  useEffect(() => {
    if (section !== "groups") return;
    if (groups.length > 0 && instances.length > 0) return;
    if (lazySectionBootstrapRef.current.groups) return;
    lazySectionBootstrapRef.current.groups = true;
    if (groups.length === 0) {
      void refreshGroups().catch(() => undefined);
    }
    if (instances.length === 0) {
      void refreshInstances().catch(() => undefined);
    }
  }, [groups.length, instances.length, refreshGroups, refreshInstances, section]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (groups.length > 0 && instances.length > 0) return;
    if (lazySectionBootstrapRef.current.affiliatesGroups) return;
    lazySectionBootstrapRef.current.affiliatesGroups = true;
    if (groups.length === 0) {
      void refreshGroups().catch(() => undefined);
    }
    if (instances.length === 0) {
      void refreshInstances().catch(() => undefined);
    }
  }, [groups.length, instances.length, refreshGroups, refreshInstances, section]);

  useEffect(() => {
    if (section !== "campaigns") return;
    if (groups.length > 0 && instances.length > 0) return;
    if (lazySectionBootstrapRef.current.campaigns) return;
    lazySectionBootstrapRef.current.campaigns = true;
    if (groups.length === 0) {
      void refreshGroups().catch(() => undefined);
    }
    if (instances.length === 0) {
      void refreshInstances().catch(() => undefined);
    }
  }, [groups.length, instances.length, refreshGroups, refreshInstances, section]);

  useEffect(() => {
    if (section !== "status") return;
    if (instances.length > 0) return;
    if (lazySectionBootstrapRef.current.status) return;
    lazySectionBootstrapRef.current.status = true;
    void refreshInstances().catch(() => undefined);
  }, [instances.length, refreshInstances, section]);

  const refreshAffiliateProviders = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setLoadingAffiliateProviders(true);
      }
      try {
        const response = await fetch("/api/affiliates/providers", { cache: "no-store" });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          status?: boolean;
          providers?: AffiliateProviderSummary[];
        };
        setAffiliateProviders(Array.isArray(payload.providers) ? payload.providers : []);
      } finally {
        if (!options.silent) {
          setLoadingAffiliateProviders(false);
        }
      }
    },
    [],
  );

  const refreshAffiliateMlLinks = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setLoadingAffiliateMlLinks(true);
      }
      try {
        const quickLimit = Math.max(
          240,
          Math.min(
            1200,
            (affiliateMlDisplayLimit > 0 ? affiliateMlDisplayLimit : 300) * 2,
          ),
        );
        const initialLimit = options.silent
          ? AFFILIATE_LINKS_FETCH_LIMIT
          : Math.min(AFFILIATE_LINKS_FETCH_LIMIT, quickLimit);
        const response = await fetch(`${affiliateApiBasePath}/links?limit=${initialLimit}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { status?: boolean; links?: AffiliateMercadoLivreLink[] };
        const initialLinks = Array.isArray(payload.links) ? payload.links : [];
        setAffiliateMlLinks(initialLinks);

        if (
          !options.silent &&
          initialLimit < AFFILIATE_LINKS_FETCH_LIMIT &&
          initialLinks.length >= initialLimit
        ) {
          void (async () => {
            try {
              const fullResponse = await fetch(
                `${affiliateApiBasePath}/links?limit=${AFFILIATE_LINKS_FETCH_LIMIT}`,
                { cache: "no-store" },
              );
              if (!fullResponse.ok) return;
              const fullPayload = (await fullResponse.json()) as {
                status?: boolean;
                links?: AffiliateMercadoLivreLink[];
              };
              const fullLinks = Array.isArray(fullPayload.links) ? fullPayload.links : [];
              if (fullLinks.length > initialLinks.length) {
                setAffiliateMlLinks(fullLinks);
              }
            } catch {
              // fallback: mantém a lista inicial mais leve
            }
          })();
        }
      } finally {
        if (!options.silent) {
          setLoadingAffiliateMlLinks(false);
        }
      }
    },
    [affiliateApiBasePath, affiliateMlDisplayLimit],
  );

  const syncAffiliateMlLinks = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setSyncingAffiliateMlLinks(true);
      }
      try {
        const response = await fetch(`${affiliateApiBasePath}/links/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 2000 }),
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          message?: string;
          summary?: { checked?: number; updated?: number; failed?: number };
        };
        await refreshAffiliateMlLinks({ silent: true });
        if (!options.silent) {
          const checked = Number(payload.summary?.checked || 0);
          const updated = Number(payload.summary?.updated || 0);
          setFeedback({
            ok: true,
            text:
              payload.message ||
              `Atualização concluída. ${updated} de ${checked} produto(s) sincronizado(s).`,
          });
        }
      } catch (error) {
        if (!options.silent) {
          setFeedback({
            ok: false,
            text:
              error instanceof Error
                ? error.message
                : "Não foi possível atualizar os produtos afiliados agora.",
          });
        }
      } finally {
        if (!options.silent) {
          setSyncingAffiliateMlLinks(false);
        }
      }
    },
    [affiliateApiBasePath, refreshAffiliateMlLinks],
  );

  const refreshAffiliateMlMessageTemplate = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setLoadingAffiliateMlMessageTemplate(true);
      }
      try {
        const response = await fetch(`${affiliateApiBasePath}/message-template`, { cache: "no-store" });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          template?: unknown;
        };
        const normalized = normalizeAffiliateMlMessageTemplate(payload.template);
        setAffiliateMlMessageTemplate(normalized);
        setAffiliateMlVisualTemplateText(buildAffiliateMlDirectTemplateTextFromItems(normalized.items));
        setAffiliateMlTemplateButtonText(normalized.buttonLabel);
        setAffiliateMlTemplateFooterText(normalized.footerText);
        setAffiliateMlTemplateProviderTitle(normalized.providerTitle);
      } finally {
        if (!options.silent) {
          setLoadingAffiliateMlMessageTemplate(false);
        }
      }
    },
    [affiliateApiBasePath],
  );

  const refreshAffiliateMlAutoSyncConfig = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setLoadingAffiliateMlAutoSync(true);
      }
      try {
        const response = await fetch(`${affiliateApiBasePath}/auto-sync`, { cache: "no-store" });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { config?: unknown };
        const normalized = normalizeAffiliateMlAutoSyncConfig(payload.config);
        setAffiliateMlAutoSyncConfig(normalized);
        setAffiliateMlAutoSyncTargetInput(String(normalized.targetImportLimit));
        setAffiliateAutoSyncTermsInput(normalized.discoveryTerms.join("\n"));
        setAffiliateAutoSyncCategoryKeysInput(normalized.discoveryCategories);
      } finally {
        if (!options.silent) {
          setLoadingAffiliateMlAutoSync(false);
        }
      }
    },
    [affiliateApiBasePath],
  );

  const refreshShopeePerformance = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!isAffiliateShopeeProvider) return;
      if (!options.silent) {
        setLoadingShopeePerformance(true);
      }
      try {
        const now = Math.floor(Date.now() / 1000);
        const start = now - shopeePerformancePeriodDays * 24 * 60 * 60;
        const query = new URLSearchParams({
          limit: String(shopeePerformanceLimit),
          purchaseTimeStart: String(start),
          purchaseTimeEnd: String(now),
        });
        const response = await fetch(`/api/affiliates/shopee/performance?${query.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          paging?: ShopeePerformancePayload["paging"];
          summary?: ShopeePerformancePayload["summary"];
          entries?: ShopeePerformancePayload["entries"];
        };

        const summaryRaw = payload.summary;
        const normalizeCounter = (value: unknown): ShopeePerformanceStatusCounter[] => {
          if (!Array.isArray(value)) return [];
          return value
            .map((entry) => ({
              status:
                typeof (entry as { status?: unknown }).status === "string"
                  ? (entry as { status: string }).status
                  : "UNKNOWN",
              count: Math.max(0, Math.floor(Number((entry as { count?: unknown }).count) || 0)),
            }))
            .filter((entry) => entry.count > 0);
        };

        setShopeePerformance({
          paging: {
            page:
              typeof payload.paging?.page === "number" && Number.isFinite(payload.paging.page)
                ? Math.floor(payload.paging.page)
                : null,
            limit:
              typeof payload.paging?.limit === "number" && Number.isFinite(payload.paging.limit)
                ? Math.max(1, Math.floor(payload.paging.limit))
                : shopeePerformanceLimit,
            hasNextPage: Boolean(payload.paging?.hasNextPage),
            scrollId:
              typeof payload.paging?.scrollId === "string" && payload.paging.scrollId.trim()
                ? payload.paging.scrollId
                : null,
          },
          summary: {
            rows: Math.max(0, Math.floor(Number(summaryRaw?.rows) || 0)),
            conversions: Math.max(0, Math.floor(Number(summaryRaw?.conversions) || 0)),
            orders: Math.max(0, Math.floor(Number(summaryRaw?.orders) || 0)),
            items: Math.max(0, Math.floor(Number(summaryRaw?.items) || 0)),
            totalCommission: Number(Number(summaryRaw?.totalCommission || 0).toFixed(4)),
            netCommission: Number(Number(summaryRaw?.netCommission || 0).toFixed(4)),
            clicksWithPurchase: Math.max(0, Math.floor(Number(summaryRaw?.clicksWithPurchase) || 0)),
            conversionStatus: normalizeCounter(summaryRaw?.conversionStatus),
            orderStatus: normalizeCounter(summaryRaw?.orderStatus),
          },
          entries: Array.isArray(payload.entries) ? payload.entries : [],
        });
      } catch (error) {
        if (!options.silent) {
          setFeedback({
            ok: false,
            text: error instanceof Error ? error.message : "Não foi possível carregar as comissões da Shopee.",
          });
        }
      } finally {
        if (!options.silent) {
          setLoadingShopeePerformance(false);
        }
      }
    },
    [isAffiliateShopeeProvider, shopeePerformanceLimit, shopeePerformancePeriodDays],
  );

  const refreshShopeeOffers = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!isAffiliateShopeeProvider) return;
      if (!options.silent) {
        setLoadingShopeeOffers(true);
      }
      try {
        const query = new URLSearchParams({
          campaignLimit: String(shopeeOfferLimit),
          shopLimit: String(shopeeOfferLimit),
          sortType: String(shopeeOfferSortType),
        });
        const keyword = shopeeOfferKeywordInput.trim();
        if (keyword) query.set("keyword", keyword);

        const response = await fetch(`/api/affiliates/shopee/offers?${query.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          campaigns?: ShopeeOffersPayload["campaigns"];
          shopOffers?: ShopeeOffersPayload["shopOffers"];
        };

        setShopeeOffers({
          campaigns: {
            paging: {
              page:
                typeof payload.campaigns?.paging?.page === "number"
                  ? Math.floor(payload.campaigns.paging.page)
                  : 1,
              limit:
                typeof payload.campaigns?.paging?.limit === "number"
                  ? Math.max(1, Math.floor(payload.campaigns.paging.limit))
                  : shopeeOfferLimit,
              hasNextPage: Boolean(payload.campaigns?.paging?.hasNextPage),
            },
            entries: Array.isArray(payload.campaigns?.entries) ? payload.campaigns.entries : [],
          },
          shopOffers: {
            paging: {
              page:
                typeof payload.shopOffers?.paging?.page === "number"
                  ? Math.floor(payload.shopOffers.paging.page)
                  : 1,
              limit:
                typeof payload.shopOffers?.paging?.limit === "number"
                  ? Math.max(1, Math.floor(payload.shopOffers.paging.limit))
                  : shopeeOfferLimit,
              hasNextPage: Boolean(payload.shopOffers?.paging?.hasNextPage),
            },
            entries: Array.isArray(payload.shopOffers?.entries) ? payload.shopOffers.entries : [],
          },
        });
      } catch (error) {
        if (!options.silent) {
          setFeedback({
            ok: false,
            text: error instanceof Error ? error.message : "Não foi possível carregar as campanhas da Shopee.",
          });
        }
      } finally {
        if (!options.silent) {
          setLoadingShopeeOffers(false);
        }
      }
    },
    [isAffiliateShopeeProvider, shopeeOfferKeywordInput, shopeeOfferLimit, shopeeOfferSortType],
  );

  const refreshShopeeFeeds = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!isAffiliateShopeeProvider) return;
      if (!options.silent) {
        setLoadingShopeeFeeds(true);
      }
      try {
        const response = await fetch("/api/affiliates/shopee/feeds?mode=all", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          feedsByMode?: Partial<Record<ShopeeFeedMode, ShopeeFeedEntry[]>>;
        };

        const nextFeeds: Record<ShopeeFeedMode, ShopeeFeedEntry[]> = {
          FULL: Array.isArray(payload.feedsByMode?.FULL) ? payload.feedsByMode.FULL : [],
          DELTA: Array.isArray(payload.feedsByMode?.DELTA) ? payload.feedsByMode.DELTA : [],
        };

        setShopeeFeedsByMode(nextFeeds);

        const nextMode =
          nextFeeds[shopeeSelectedFeedMode].length > 0
            ? shopeeSelectedFeedMode
            : nextFeeds.FULL.length > 0
              ? "FULL"
              : nextFeeds.DELTA.length > 0
                ? "DELTA"
                : shopeeSelectedFeedMode;
        if (nextMode !== shopeeSelectedFeedMode) {
          setShopeeSelectedFeedMode(nextMode);
        }

        const hasCurrentSelection = nextFeeds[nextMode].some(
          (entry) => entry.datafeedId === shopeeSelectedFeedId,
        );
        if (!hasCurrentSelection) {
          setShopeeSelectedFeedId(nextFeeds[nextMode][0]?.datafeedId || "");
          setShopeeFeedData(null);
        }
      } catch (error) {
        if (!options.silent) {
          setFeedback({
            ok: false,
            text: error instanceof Error ? error.message : "Não foi possível carregar os feeds da Shopee.",
          });
        }
      } finally {
        if (!options.silent) {
          setLoadingShopeeFeeds(false);
        }
      }
    },
    [isAffiliateShopeeProvider, shopeeSelectedFeedId, shopeeSelectedFeedMode],
  );

  const refreshShopeeFeedData = useCallback(
    async (
      options: { silent?: boolean; feedId?: string; mode?: ShopeeFeedMode } = {},
    ) => {
      if (!isAffiliateShopeeProvider) return;
      const feedId = String(options.feedId || shopeeSelectedFeedId || "").trim();
      const mode = options.mode || shopeeSelectedFeedMode;
      if (!feedId) {
        setShopeeFeedData(null);
        return;
      }
      if (!options.silent) {
        setLoadingShopeeFeedData(true);
      }
      try {
        const query = new URLSearchParams({
          mode,
          datafeedId: feedId,
          offset: "0",
          limit: String(shopeeFeedPreviewLimit),
        });
        const response = await fetch(`/api/affiliates/shopee/feeds?${query.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { feedData?: ShopeeFeedDataPayload | null };
        setShopeeFeedData(payload.feedData ?? null);
      } catch (error) {
        if (!options.silent) {
          setFeedback({
            ok: false,
            text: error instanceof Error ? error.message : "Não foi possível carregar os dados do feed selecionado.",
          });
        }
      } finally {
        if (!options.silent) {
          setLoadingShopeeFeedData(false);
        }
      }
    },
    [isAffiliateShopeeProvider, shopeeFeedPreviewLimit, shopeeSelectedFeedId, shopeeSelectedFeedMode],
  );

  const saveAffiliateMlAutoSyncConfig = useCallback(
    async (patch: {
      enabled?: boolean;
      refreshExisting?: boolean;
      discoverNew?: boolean;
      targetImportLimit?: number;
      discoveryTerms?: string[];
      discoveryCategories?: string[];
    }) => {
      setSavingAffiliateMlAutoSync(true);
      try {
        const response = await fetch(`${affiliateApiBasePath}/auto-sync`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { config?: unknown; message?: string };
        const normalized = normalizeAffiliateMlAutoSyncConfig(payload.config);
        setAffiliateMlAutoSyncConfig(normalized);
        setAffiliateMlAutoSyncTargetInput(String(normalized.targetImportLimit));
        setAffiliateAutoSyncTermsInput(normalized.discoveryTerms.join("\n"));
        setAffiliateAutoSyncCategoryKeysInput(normalized.discoveryCategories);
        setFeedback({
          ok: true,
          text: payload.message || "Configuração de varredura automática atualizada.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível salvar a configuração de varredura automática.",
        });
      } finally {
        setSavingAffiliateMlAutoSync(false);
      }
    },
    [affiliateApiBasePath],
  );

  const openAffiliateAutoSyncFiltersModal = useCallback(() => {
    setAffiliateAutoSyncTermsInput(affiliateMlAutoSyncConfig.discoveryTerms.join("\n"));
    setAffiliateAutoSyncCategoryKeysInput(affiliateMlAutoSyncConfig.discoveryCategories);
    setIsAffiliateAutoSyncFiltersModalOpen(true);
  }, [affiliateMlAutoSyncConfig.discoveryCategories, affiliateMlAutoSyncConfig.discoveryTerms]);

  const saveAffiliateAutoSyncFilters = useCallback(async () => {
    const discoveryTerms = normalizeAutoSyncList(affiliateAutoSyncTermsInput, {
      maxItems: AFFILIATE_AUTO_SYNC_MAX_DISCOVERY_TERMS,
      maxItemLength: 120,
    });
    const discoveryCategories = normalizeAutoSyncList(affiliateAutoSyncCategoryKeysInput, {
      maxItems: AFFILIATE_AUTO_SYNC_MAX_DISCOVERY_CATEGORIES,
      maxItemLength: 40,
    });
    await saveAffiliateMlAutoSyncConfig({
      discoveryTerms,
      discoveryCategories,
    });
    setIsAffiliateAutoSyncFiltersModalOpen(false);
  }, [affiliateAutoSyncCategoryKeysInput, affiliateAutoSyncTermsInput, saveAffiliateMlAutoSyncConfig]);

  const refreshAffiliateMlGroupDispatches = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setLoadingAffiliateMlGroupDispatches(true);
      }
      try {
        const response = await fetch(`${affiliateApiBasePath}/group-dispatches`, { cache: "no-store" });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          dispatches?: AffiliateMlGroupDispatch[];
        };
        setAffiliateMlGroupDispatches(Array.isArray(payload.dispatches) ? payload.dispatches : []);
      } finally {
        if (!options.silent) {
          setLoadingAffiliateMlGroupDispatches(false);
        }
      }
    },
    [affiliateApiBasePath],
  );

  const saveAffiliateMlMessageTemplate = useCallback(async () => {
    setSavingAffiliateMlMessageTemplate(true);
    try {
      const itemsToPersist = buildAffiliateMlItemsFromDirectTemplateText(affiliateMlVisualTemplateText);
      const response = await fetch(`${affiliateApiBasePath}/message-template`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: itemsToPersist.map((entry) => ({
            key: entry.key,
            enabled: entry.enabled,
            text: entry.text,
          })),
          buttonLabel: affiliateMlTemplateButtonText.trim(),
          footerText: affiliateMlTemplateFooterText.trim(),
          providerTitle: affiliateMlTemplateProviderTitle.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      const payload = (await response.json()) as {
        template?: unknown;
        message?: string;
      };
      const normalized = normalizeAffiliateMlMessageTemplate(payload.template);
      setAffiliateMlMessageTemplate(normalized);
      setAffiliateMlVisualTemplateText(buildAffiliateMlDirectTemplateTextFromItems(normalized.items));
      setAffiliateMlTemplateButtonText(normalized.buttonLabel);
      setAffiliateMlTemplateFooterText(normalized.footerText);
      setAffiliateMlTemplateProviderTitle(normalized.providerTitle);
      setFeedback({
        ok: true,
        text: payload.message || "Modelo de mensagem salvo com sucesso.",
      });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível salvar o modelo de mensagem.",
      });
    } finally {
      setSavingAffiliateMlMessageTemplate(false);
    }
  }, [
    affiliateApiBasePath,
    affiliateMlTemplateButtonText,
    affiliateMlTemplateFooterText,
    affiliateMlTemplateProviderTitle,
    affiliateMlVisualTemplateText,
  ]);

  const upsertAffiliateMlGroupDispatch = useCallback(
    async (payload: {
      instanceId: number;
      groupId: number;
      delayMinutes?: number;
      categoryRotationEnabled?: boolean;
      enabled?: boolean;
    }) => {
      const groupId = Number(payload.groupId);
      if (!Number.isFinite(groupId) || groupId <= 0) {
        setFeedback({ ok: false, text: "Selecione um grupo válido para ativar o envio." });
        return;
      }
      const delayMinutes =
        payload.delayMinutes === undefined
          ? undefined
          : Math.max(1, Math.min(1440, Math.floor(Number(payload.delayMinutes) || 15)));

      setSavingAffiliateMlGroupDispatchId((current) => current ?? 0);
      try {
        const response = await fetch(`${affiliateApiBasePath}/group-dispatches`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instanceId: payload.instanceId,
            groupId,
            delayMinutes,
            categoryRotationEnabled:
              typeof payload.categoryRotationEnabled === "boolean"
                ? payload.categoryRotationEnabled
                : true,
            enabled: typeof payload.enabled === "boolean" ? payload.enabled : true,
          }),
        });
        if (!response.ok) throw new Error(await parseError(response));
        const result = (await response.json()) as {
          dispatch?: AffiliateMlGroupDispatch;
          message?: string;
        };
        if (result.dispatch) {
          setAffiliateMlGroupDispatches((current) => {
            const byId = new Map(current.map((entry) => [entry.id, entry] as const));
            byId.set(result.dispatch!.id, result.dispatch!);
            return Array.from(byId.values()).sort(
              (left, right) =>
                new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
            );
          });
        } else {
          await refreshAffiliateMlGroupDispatches({ silent: true });
        }
        setFeedback({
          ok: true,
          text: result.message || "Ativação de envio salva com sucesso.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível salvar a ativação de envio.",
        });
      } finally {
        setSavingAffiliateMlGroupDispatchId(null);
      }
    },
    [affiliateApiBasePath, refreshAffiliateMlGroupDispatches],
  );

  const updateAffiliateMlGroupDispatch = useCallback(
    async (
      dispatchId: number,
      payload: {
        instanceId?: number;
        groupId?: number;
        enabled?: boolean;
        delayMinutes?: number;
        categoryRotationEnabled?: boolean;
      },
    ) => {
      const normalizedDispatchId = Number(dispatchId);
      if (!Number.isFinite(normalizedDispatchId) || normalizedDispatchId <= 0) return;

      setSavingAffiliateMlGroupDispatchId(Math.floor(normalizedDispatchId));
      try {
        const response = await fetch(
          `${affiliateApiBasePath}/group-dispatches/${Math.floor(normalizedDispatchId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok) throw new Error(await parseError(response));
        const result = (await response.json()) as {
          dispatch?: AffiliateMlGroupDispatch;
          message?: string;
        };
        if (result.dispatch) {
          setAffiliateMlGroupDispatches((current) =>
            current.map((entry) => (entry.id === result.dispatch!.id ? result.dispatch! : entry)),
          );
        } else {
          await refreshAffiliateMlGroupDispatches({ silent: true });
        }
        setFeedback({
          ok: true,
          text: result.message || "Ativação de envio atualizada.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível atualizar a ativação.",
        });
      } finally {
        setSavingAffiliateMlGroupDispatchId(null);
      }
    },
    [affiliateApiBasePath, refreshAffiliateMlGroupDispatches],
  );

  const removeAffiliateMlGroupDispatch = useCallback(async (dispatch: AffiliateMlGroupDispatch) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Remover ativação do grupo ${dispatch.groupName}?`);
      if (!confirmed) return;
    }
    setRemovingAffiliateMlGroupDispatchId(dispatch.id);
    try {
      const response = await fetch(
        `${affiliateApiBasePath}/group-dispatches/${dispatch.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await parseError(response));
      setAffiliateMlGroupDispatches((current) => current.filter((entry) => entry.id !== dispatch.id));
      setFeedback({ ok: true, text: "Ativação removida com sucesso." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível remover a ativação.",
      });
    } finally {
      setRemovingAffiliateMlGroupDispatchId(null);
    }
  }, [affiliateApiBasePath]);

  const openAffiliateDispatchCreateModal = useCallback(() => {
    const preferredGroup = affiliateDispatchCreatableGroups[0] ?? null;
    if (!preferredGroup) {
      setFeedback({
        ok: false,
        text:
          affiliateDispatchAvailableInstances.length === 0
            ? "Nenhum grupo VIP ativo com instância conectada está disponível para criar ativação."
            : "Todos os grupos VIP ativos elegíveis já possuem ativação cadastrada.",
      });
      return;
    }
    setAffiliateDispatchModal({
      dispatchId: null,
      instanceId: String(preferredGroup.instanceId),
      groupId: String(preferredGroup.id),
      delayMinutes: String(
        Math.max(
          1,
          Math.floor(Number(affiliateMlDispatchDelayInput) || 15),
        ),
      ),
      categoryRotationEnabled: affiliateMlDispatchCategoryRotationInput,
      enabled: true,
    });
  }, [
    affiliateDispatchAvailableInstances.length,
    affiliateDispatchCreatableGroups,
    affiliateMlDispatchCategoryRotationInput,
    affiliateMlDispatchDelayInput,
  ]);

  const openAffiliateDispatchEditModal = useCallback((entry: AffiliateMlGroupDispatch) => {
    setAffiliateDispatchModal({
      dispatchId: entry.id,
      instanceId: String(entry.instanceId),
      groupId: String(entry.groupId),
      delayMinutes: String(Math.max(1, Math.floor(entry.delayMinutes))),
      categoryRotationEnabled: entry.categoryRotationEnabled,
      enabled: entry.enabled,
    });
  }, []);

  const saveAffiliateDispatchModal = useCallback(async () => {
    if (!affiliateDispatchModal) return;
    const instanceId = Number(affiliateDispatchModal.instanceId);
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      setFeedback({ ok: false, text: "Selecione uma instância válida para salvar a ativação." });
      return;
    }
    const groupId = Number(affiliateDispatchModal.groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      setFeedback({ ok: false, text: "Selecione um grupo válido para salvar a ativação." });
      return;
    }
    const parsedDelay = Number(affiliateDispatchModal.delayMinutes);
    const delayMinutes = Number.isFinite(parsedDelay)
      ? Math.max(1, Math.min(1440, Math.floor(parsedDelay)))
      : 15;
    setAffiliateMlDispatchInstanceIdInput(String(instanceId));
    setAffiliateMlDispatchGroupIdInput(String(groupId));
    setAffiliateMlDispatchDelayInput(String(delayMinutes));
    setAffiliateMlDispatchCategoryRotationInput(affiliateDispatchModal.categoryRotationEnabled);
    if (affiliateDispatchModal.dispatchId && affiliateDispatchModal.dispatchId > 0) {
      await updateAffiliateMlGroupDispatch(affiliateDispatchModal.dispatchId, {
        groupId,
        instanceId,
        enabled: affiliateDispatchModal.enabled,
        delayMinutes,
        categoryRotationEnabled: affiliateDispatchModal.categoryRotationEnabled,
      });
    } else {
      await upsertAffiliateMlGroupDispatch({
        instanceId,
        groupId,
        enabled: affiliateDispatchModal.enabled,
        delayMinutes,
        categoryRotationEnabled: affiliateDispatchModal.categoryRotationEnabled,
      });
    }
    setAffiliateDispatchModal(null);
  }, [affiliateDispatchModal, updateAffiliateMlGroupDispatch, upsertAffiliateMlGroupDispatch]);

  const searchAffiliateMlImportProducts = useCallback(async (
    options: {
      queryOverride?: string;
      append?: boolean;
      silent?: boolean;
      sourceLabel?: string;
      sourceMeta?: string;
    } = {},
  ) => {
    const append = options.append === true;
    const silent = options.silent === true;
    const overrideQuery = typeof options.queryOverride === "string" ? options.queryOverride.trim() : "";
    const sourceLabel =
      typeof options.sourceLabel === "string" && options.sourceLabel.trim()
        ? options.sourceLabel.trim()
        : null;
    const sourceMeta =
      typeof options.sourceMeta === "string" && options.sourceMeta.trim()
        ? options.sourceMeta.trim()
        : null;
    const categoryName = overrideQuery || affiliateMlEffectiveImportQuery;
    const allCategories = categoryName === "__ALL_CATEGORIES__";
    const selectedShopeeCategoryId =
      selectedAffiliateProvider?.provider === "shopee" && !overrideQuery
        ? Number(selectedAffiliateMlImportPreset?.shopeeCategoryId)
        : NaN;
    const hasShopeeCategoryId = Number.isFinite(selectedShopeeCategoryId) && selectedShopeeCategoryId > 0;
    const parsedLimit = Number(affiliateMlImportLimit);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(AFFILIATE_PRODUCTS_IMPORT_MAX_LIMIT, Math.trunc(parsedLimit)))
      : 120;
    if (!categoryName) {
      if (!silent) {
        setFeedback({
          ok: false,
          text: "Selecione uma categoria pré-definida ou digite uma palavra-chave para importar produtos.",
        });
      }
      return 0;
    }
    if (!silent) {
      setSearchingAffiliateMlImportProducts(true);
    }
    try {
      const query = new URLSearchParams({
        categoryName,
        autoAffiliate: "true",
        preferHighDemand: "true",
        mode: affiliateMlImportMode,
        limit: String(limit),
      });
      if (hasShopeeCategoryId) {
        query.set("categoryId", String(Math.trunc(selectedShopeeCategoryId)));
      }
      if (allCategories) {
        query.set("allCategories", "true");
      }
      const response = await fetch(`${affiliateApiBasePath}/products?${query.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as {
        products?: Array<{
          itemId?: string;
          title?: string | null;
          permalink?: string | null;
          thumbnail?: string | null;
          categoryId?: string | null;
          price?: number | null;
          currencyId?: string | null;
          commissionRate?: string | null;
          ratingStar?: string | null;
          available?: boolean | null;
          affiliateUrl?: string | null;
        }>;
        autoAffiliate?: {
          warning?: string;
          generated?: number;
          tag?: string;
        };
        warning?: string | null;
      };
      const products = (() => {
        const byItemId = new Map<string, AffiliateMlImportProduct>();
        const seenAffiliateUrls = new Set<string>();
        (Array.isArray(payload.products) ? payload.products : [])
          .map((entry) => ({
            itemId: typeof entry.itemId === "string" ? entry.itemId.trim().toUpperCase() : "",
            title: typeof entry.title === "string" ? entry.title : null,
            permalink: typeof entry.permalink === "string" ? entry.permalink : null,
            thumbnail: typeof entry.thumbnail === "string" ? entry.thumbnail : null,
            categoryId: typeof entry.categoryId === "string" ? entry.categoryId : null,
            price: typeof entry.price === "number" ? entry.price : null,
            currencyId: typeof entry.currencyId === "string" ? entry.currencyId : null,
            commissionRate: typeof entry.commissionRate === "string" ? entry.commissionRate : null,
            ratingStar: typeof entry.ratingStar === "string" ? entry.ratingStar : null,
            available: typeof entry.available === "boolean" ? entry.available : null,
            affiliateUrl: typeof entry.affiliateUrl === "string" ? entry.affiliateUrl : null,
            sourceLabel,
            sourceMeta,
          }))
          .forEach((entry) => {
            if (!entry.itemId) return;
            const urlKey = entry.affiliateUrl ? entry.affiliateUrl.trim().toLowerCase() : "";
            if (byItemId.has(entry.itemId)) return;
            if (urlKey && seenAffiliateUrls.has(urlKey)) return;
            byItemId.set(entry.itemId, entry);
            if (urlKey) seenAffiliateUrls.add(urlKey);
          });
        return Array.from(byItemId.values());
      })();
      if (append) {
        setAffiliateMlImportProducts((current) => {
          const byItemId = new Map(current.map((entry) => [entry.itemId, entry] as const));
          const seenAffiliateUrls = new Set(
            current
              .map((entry) => (entry.affiliateUrl ? entry.affiliateUrl.trim().toLowerCase() : ""))
              .filter(Boolean),
          );
          products.forEach((entry) => {
            if (!entry.itemId) return;
            const urlKey = entry.affiliateUrl ? entry.affiliateUrl.trim().toLowerCase() : "";
            if (byItemId.has(entry.itemId)) return;
            if (urlKey && seenAffiliateUrls.has(urlKey)) return;
            byItemId.set(entry.itemId, entry);
            if (urlKey) seenAffiliateUrls.add(urlKey);
          });
          return Array.from(byItemId.values());
        });
        // Mantém seleção manual para o usuário escolher com base na prévia.
      } else {
        setAffiliateMlImportProducts(products);
        setAffiliateMlImportSelectedIds({});
      }
      if (products.length > 0) {
        setAffiliateMlImportShowResultsOnly(true);
      } else if (!append) {
        setAffiliateMlImportShowResultsOnly(false);
      }
      const mergedWarning = [payload.warning, payload.autoAffiliate?.warning]
        .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
        .join(" ");
      const normalizedMergedWarning = normalizeAffiliateImportWarning(mergedWarning);
      if (append) {
        setAffiliateMlImportWarning((current) => {
          const combined = normalizeAffiliateImportWarning([current, normalizedMergedWarning].filter(Boolean).join(" "));
          return combined || null;
        });
      } else {
        setAffiliateMlImportWarning(normalizedMergedWarning || null);
      }
      if (payload.autoAffiliate?.tag) {
        setAffiliateMlTagInput((current) => current || payload.autoAffiliate?.tag || "");
      }
      return products.length;
    } catch (error) {
      if (!silent) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível consultar produtos para importação.",
        });
      }
      return 0;
    } finally {
      if (!silent) {
        setSearchingAffiliateMlImportProducts(false);
      }
    }
  }, [
    affiliateApiBasePath,
    affiliateMlEffectiveImportQuery,
    affiliateMlImportLimit,
    affiliateMlImportMode,
    selectedAffiliateMlImportPreset?.shopeeCategoryId,
    selectedAffiliateProvider?.provider,
  ]);

  const loadShopeeOfficialOffersToImportList = useCallback(async () => {
    if (!isAffiliateShopeeProvider) return;
    setLoadingAffiliateOfficialOffers(true);
    try {
      const query = new URLSearchParams({
        campaignLimit: String(Math.max(10, Math.min(50, shopeeOfferLimit))),
        shopLimit: String(Math.max(10, Math.min(50, shopeeOfferLimit))),
        sortType: String(shopeeOfferSortType),
      });
      const keyword = shopeeOfferKeywordInput.trim();
      if (keyword) query.set("keyword", keyword);

      const response = await fetch(`/api/affiliates/shopee/offers?${query.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as {
        campaigns?: ShopeeOffersPayload["campaigns"];
        shopOffers?: ShopeeOffersPayload["shopOffers"];
      };

      const normalizedOffers: ShopeeOffersPayload = {
        campaigns: {
          paging: {
            page:
              typeof payload.campaigns?.paging?.page === "number"
                ? Math.floor(payload.campaigns.paging.page)
                : 1,
            limit:
              typeof payload.campaigns?.paging?.limit === "number"
                ? Math.max(1, Math.floor(payload.campaigns.paging.limit))
                : shopeeOfferLimit,
            hasNextPage: Boolean(payload.campaigns?.paging?.hasNextPage),
          },
          entries: Array.isArray(payload.campaigns?.entries) ? payload.campaigns.entries : [],
        },
        shopOffers: {
          paging: {
            page:
              typeof payload.shopOffers?.paging?.page === "number"
                ? Math.floor(payload.shopOffers.paging.page)
                : 1,
            limit:
              typeof payload.shopOffers?.paging?.limit === "number"
                ? Math.max(1, Math.floor(payload.shopOffers.paging.limit))
                : shopeeOfferLimit,
            hasNextPage: Boolean(payload.shopOffers?.paging?.hasNextPage),
          },
          entries: Array.isArray(payload.shopOffers?.entries) ? payload.shopOffers.entries : [],
        },
      };
      setShopeeOffers(normalizedOffers);

      const cleanTerm = (value: string | null | undefined): string => {
        return String(value || "")
          .replace(/new\s+bau\s+comm\s*-\s*/gi, "")
          .replace(/[_\-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      };
      const terms = Array.from(
        new Set(
          [
            keyword,
            ...normalizedOffers.campaigns.entries.map((entry) => cleanTerm(entry.offerName)),
            ...normalizedOffers.shopOffers.entries.map((entry) => cleanTerm(entry.shopName)),
          ]
            .map((entry) => entry.trim())
            .filter((entry) => entry.length >= 3),
        ),
      ).slice(0, 8);

      if (terms.length === 0) {
        setFeedback({
          ok: false,
          text: "As ofertas oficiais não retornaram termos úteis para buscar produtos agora.",
        });
        return;
      }

      let totalLoaded = 0;
      for (const term of terms) {
        const count = await searchAffiliateMlImportProducts({
          queryOverride: term,
          append: true,
          silent: true,
          sourceLabel: "Ofertas oficiais Shopee",
          sourceMeta: term,
        });
        totalLoaded += count;
      }

      setFeedback({
        ok: true,
        text:
          totalLoaded > 0
            ? `Ofertas oficiais carregadas. ${terms.length} termo(s) usados para montar a lista de produtos.`
            : "Ofertas oficiais carregadas, mas não retornaram produtos válidos para importação agora.",
      });
      if (totalLoaded > 0) {
        setAffiliateMlImportShowResultsOnly(true);
      }
    } catch (error) {
      setFeedback({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as ofertas oficiais da Shopee.",
      });
    } finally {
      setLoadingAffiliateOfficialOffers(false);
    }
  }, [
    isAffiliateShopeeProvider,
    searchAffiliateMlImportProducts,
    shopeeOfferKeywordInput,
    shopeeOfferLimit,
    shopeeOfferSortType,
  ]);

  const importSelectedAffiliateMlProducts = useCallback(() => {
    if (importingAffiliateMlProducts || affiliateImportJobActive) {
      setFeedback({ ok: false, text: "Já existe uma importação em andamento. Aguarde ou cancele para iniciar outra." });
      return;
    }
    const selectedProducts = Array.from(
      new Map(
        affiliateMlImportProducts
          .filter(
            (entry) =>
              Boolean(affiliateMlImportSelectedIds[entry.itemId]) &&
              Boolean(entry.affiliateUrl) &&
              !importedAffiliateMlItemIds.has(String(entry.itemId || "").trim().toUpperCase()),
          )
          .map((entry) => [entry.itemId, entry]),
      ).values(),
    );
    if (selectedProducts.length === 0) {
      setFeedback({ ok: false, text: "Selecione pelo menos um produto com link afiliado válido para importar." });
      return;
    }

    const note = affiliateMlImportNote.trim() || null;
    const providerLabel = selectedAffiliateProvider?.label || "Afiliados";
    const total = selectedProducts.length;
    const jobId = affiliateImportJobCounterRef.current + 1;
    affiliateImportJobCounterRef.current = jobId;

    affiliateImportCancelRequestedRef.current = false;
    affiliateImportAbortControllerRef.current = null;
    setCancellingAffiliateImportJob(false);
    setImportingAffiliateMlProducts(true);
    setAffiliateMlImportWarningExpanded(false);
    setAffiliateMlImportShowResultsOnly(false);
    setIsAffiliateMlImportModalOpen(false);
    setAffiliateImportJob({
      id: jobId,
      provider: providerLabel,
      total,
      processed: 0,
      imported: 0,
      failed: 0,
      progressPercent: 0,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastMessage: `Importação iniciada em background (${total} item(ns)).`,
      lastError: null,
    });
    setFeedback({
      ok: true,
      text: `Importação iniciada em background (${total} item(ns)). Você pode sair do modal e acompanhar o progresso na lista de produtos.`,
    });

    void (async () => {
      let processed = 0;
      let imported = 0;
      let failed = 0;
      let lastError: string | null = null;
      const errorSamples: string[] = [];
      const chunks: Array<typeof selectedProducts> = [];
      for (let offset = 0; offset < selectedProducts.length; offset += AFFILIATE_IMPORT_CHUNK_SIZE) {
        chunks.push(selectedProducts.slice(offset, offset + AFFILIATE_IMPORT_CHUNK_SIZE));
      }

      const setJobState = (
        updater: (current: AffiliateImportBackgroundJob) => AffiliateImportBackgroundJob,
      ) => {
        setAffiliateImportJob((current) => {
          if (!current || current.id !== jobId) return current;
          return updater(current);
        });
      };

      for (let index = 0; index < chunks.length; index += 1) {
        if (affiliateImportCancelRequestedRef.current) {
          break;
        }
        const chunk = chunks[index]!;
        const controller = new AbortController();
        affiliateImportAbortControllerRef.current = controller;

        let chunkImported = 0;
        let chunkFailed = 0;
        let chunkError: string | null = null;
        try {
          const response = await fetch(`${affiliateApiBasePath}/links/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              entries: chunk.map((entry) => ({
                itemId: entry.itemId,
                affiliateUrl: entry.affiliateUrl,
                note,
                title: entry.title,
                productUrl: entry.permalink,
                imageUrl: entry.thumbnail,
                categoryId: entry.categoryId,
                priceAmount: entry.price,
                currencyId: entry.currencyId,
                commissionRate: entry.commissionRate,
                ratingStar: entry.ratingStar,
                available: entry.available,
              })),
            }),
          });
          if (!response.ok) {
            throw new Error(await parseError(response));
          }
          const payload = (await response.json()) as {
            imported?: number;
            failed?: number;
            errors?: string[];
          };
          chunkImported =
            typeof payload.imported === "number"
              ? Math.max(0, Math.min(chunk.length, Math.floor(payload.imported)))
              : chunk.length;
          chunkFailed =
            typeof payload.failed === "number"
              ? Math.max(0, Math.min(chunk.length, Math.floor(payload.failed)))
              : Math.max(0, chunk.length - chunkImported);
          if (Array.isArray(payload.errors) && payload.errors.length > 0) {
            chunkError = String(payload.errors[0] || "").trim() || null;
          }
        } catch (error) {
          const isAbort =
            error instanceof DOMException
              ? error.name === "AbortError"
              : error instanceof Error
                ? error.name === "AbortError"
                : false;
          if (isAbort && affiliateImportCancelRequestedRef.current) {
            break;
          }
          chunkFailed = chunk.length;
          chunkError =
            error instanceof Error ? error.message : "Falha ao importar um lote de produtos.";
        } finally {
          affiliateImportAbortControllerRef.current = null;
        }

        processed += chunk.length;
        imported += chunkImported;
        failed += chunkFailed;
        if (chunkError) {
          lastError = chunkError;
          if (errorSamples.length < 3) {
            errorSamples.push(chunkError);
          }
        }
        const progressPercent =
          total > 0 ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : 0;
        const chunkNumber = index + 1;
        const chunkTotal = chunks.length;
        setJobState((current) => ({
          ...current,
          processed,
          imported,
          failed,
          progressPercent,
          lastError,
          lastMessage:
            processed >= total
              ? "Finalizando importação..."
              : `Lote ${chunkNumber}/${chunkTotal} concluído. ${processed}/${total} processado(s).`,
        }));
      }

      const cancelled = affiliateImportCancelRequestedRef.current;
      affiliateImportCancelRequestedRef.current = false;
      affiliateImportAbortControllerRef.current = null;
      setCancellingAffiliateImportJob(false);

      if (imported > 0) {
        await refreshAffiliateMlLinks({ silent: true });
      }

      const status: AffiliateImportJobStatus = cancelled
        ? "cancelled"
        : failed > 0 && imported === 0
          ? "failed"
          : "completed";
      const progressPercent = total > 0 ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : 0;
      const finalMessage = cancelled
        ? `Importação cancelada. Processados: ${processed}/${total}.`
        : status === "failed"
          ? "Importação falhou em todos os lotes."
          : failed > 0
            ? `Importação concluída com ressalvas. ${imported} importado(s), ${failed} com falha.`
            : `Importação concluída com sucesso. ${imported} produto(s) importado(s).`;

      setAffiliateImportJob((current) => {
        if (!current || current.id !== jobId) return current;
        return {
          ...current,
          processed,
          imported,
          failed,
          progressPercent,
          status,
          finishedAt: new Date().toISOString(),
          lastMessage: finalMessage,
          lastError: lastError || null,
        };
      });
      setImportingAffiliateMlProducts(false);

      const extraError = errorSamples.length > 0 ? ` Motivo: ${errorSamples[0]}` : "";
      setFeedback({
        ok: status === "completed" && failed === 0,
        text: `${finalMessage}${extraError}`.trim(),
      });
    })();
  }, [
    affiliateApiBasePath,
    affiliateImportJobActive,
    affiliateMlImportNote,
    affiliateMlImportProducts,
    affiliateMlImportSelectedIds,
    importedAffiliateMlItemIds,
    importingAffiliateMlProducts,
    refreshAffiliateMlLinks,
    selectedAffiliateProvider?.label,
  ]);

  const cancelAffiliateImportJob = useCallback(() => {
    if (!affiliateImportJobActive) return;
    affiliateImportCancelRequestedRef.current = true;
    setCancellingAffiliateImportJob(true);
    setAffiliateImportJob((current) => {
      if (!current) return current;
      if (current.status !== "running" && current.status !== "cancelling") return current;
      return {
        ...current,
        status: "cancelling",
        lastMessage: "Cancelamento solicitado. Finalizando lote atual...",
      };
    });
    affiliateImportAbortControllerRef.current?.abort();
  }, [affiliateImportJobActive]);

  const dismissAffiliateImportJob = useCallback(() => {
    if (affiliateImportJobActive) return;
    setAffiliateImportJob(null);
  }, [affiliateImportJobActive]);

  const appendShopeeFeedPreviewToImportProducts = useCallback(() => {
    if (!isAffiliateShopeeProvider) return;
    const rows = Array.isArray(shopeeFeedData?.rows) ? shopeeFeedData.rows : [];
    const prepared = rows
      .map((row) => {
        const itemId = String(row.itemId || "").trim().replace(/[^\d]/g, "");
        const affiliateUrl = typeof row.offerLink === "string" ? row.offerLink.trim() : "";
        if (!itemId || !affiliateUrl) return null;
        const price =
          typeof row.salePrice === "number" && Number.isFinite(row.salePrice)
            ? row.salePrice
            : typeof row.price === "number" && Number.isFinite(row.price)
              ? row.price
              : null;
        return {
          itemId,
          title: typeof row.title === "string" ? row.title.trim() || null : null,
          permalink: typeof row.productLink === "string" ? row.productLink : null,
          thumbnail: null,
          categoryId: null,
          price,
          currencyId: "BRL",
          commissionRate: null,
          ratingStar: null,
          available: true,
          affiliateUrl,
        } satisfies AffiliateMlImportProduct;
      })
      .filter((entry): entry is AffiliateMlImportProduct => Boolean(entry));

    if (prepared.length === 0) {
      setFeedback({
        ok: false,
        text: "O preview do feed não trouxe itens com itemId e link de oferta válido para importar.",
      });
      return;
    }

    const nextSelection: Record<string, boolean> = {};
    setAffiliateMlImportProducts((current) => {
      const byItemId = new Map(current.map((entry) => [entry.itemId, entry] as const));
      const seenAffiliate = new Set(
        current
          .map((entry) => (entry.affiliateUrl ? entry.affiliateUrl.trim().toLowerCase() : ""))
          .filter(Boolean),
      );
      let added = 0;

      prepared.forEach((entry) => {
        const affiliateKey = entry.affiliateUrl ? entry.affiliateUrl.trim().toLowerCase() : "";
        if (!entry.itemId || byItemId.has(entry.itemId)) return;
        if (affiliateKey && seenAffiliate.has(affiliateKey)) return;
        byItemId.set(entry.itemId, entry);
        if (affiliateKey) {
          seenAffiliate.add(affiliateKey);
        }
        nextSelection[entry.itemId] = true;
        added += 1;
      });

      if (added === 0) {
        setFeedback({
          ok: false,
          text: "Nenhum item novo foi adicionado do feed (provável duplicidade com itens já listados).",
        });
      } else {
        setFeedback({
          ok: true,
          text: `${added} produto(s) do feed oficial adicionados na seleção de importação.`,
        });
      }

      return Array.from(byItemId.values());
    });

    if (Object.keys(nextSelection).length > 0) {
      setAffiliateMlImportSelectedIds((current) => ({
        ...current,
        ...nextSelection,
      }));
    }
  }, [isAffiliateShopeeProvider, shopeeFeedData]);

  const refreshAffiliateMlResolver = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setLoadingAffiliateMlResolver(true);
      }
      try {
        const response = await fetch("/api/affiliates/mercadolivre/resolver", { cache: "no-store" });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          status?: boolean;
          resolver?: AffiliateMlResolverConfig;
        };
        if (payload.resolver && typeof payload.resolver === "object") {
          setAffiliateMlResolver({
            provider: "mercadolivre",
            hasCookie: Boolean(payload.resolver.hasCookie),
            cookieHint: payload.resolver.cookieHint ?? null,
            hasCsrfToken: Boolean(payload.resolver.hasCsrfToken),
            tag: payload.resolver.tag ?? null,
            enabled: Boolean(payload.resolver.enabled),
            isValid:
              typeof payload.resolver.isValid === "boolean" ? payload.resolver.isValid : null,
            lastError: payload.resolver.lastError ?? null,
            lastValidatedAt: payload.resolver.lastValidatedAt ?? null,
            updatedAt: payload.resolver.updatedAt ?? null,
          });
          setAffiliateMlTagInput((current) => current || payload.resolver?.tag || "");
        }
      } finally {
        if (!options.silent) {
          setLoadingAffiliateMlResolver(false);
        }
      }
    },
    [],
  );

  const saveAffiliateMlLink = useCallback(async () => {
    const value = affiliateMlLinkInput.trim();
    if (!value) {
      setFeedback({ ok: false, text: "Informe o link de afiliado antes de salvar." });
      return;
    }
    setSavingAffiliateMlLink(true);
    try {
      const response = await fetch(`${affiliateApiBasePath}/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ affiliateUrl: value, note: affiliateMlLinkNote.trim() || null }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      await refreshAffiliateMlLinks({ silent: true });
      setAffiliateMlLinkInput("");
      setAffiliateMlLinkNote("");
      setIsAffiliateMlCreateModalOpen(false);
      setFeedback({ ok: true, text: "Link afiliado salvo com sucesso." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível salvar o link afiliado.",
      });
    } finally {
      setSavingAffiliateMlLink(false);
    }
  }, [affiliateApiBasePath, affiliateMlLinkInput, affiliateMlLinkNote, refreshAffiliateMlLinks]);

  const openAffiliateMlEditModal = useCallback((entry: AffiliateMercadoLivreLink) => {
    setAffiliateMlEditModal({
      itemId: entry.itemId,
      affiliateUrl: entry.affiliateUrl || "",
      note: entry.note || "",
      couponCode: entry.couponCode || "",
      couponDetails: entry.couponDetails || "",
      title: entry.title || "",
      productUrl: entry.productUrl || "",
      imageUrl: entry.imageUrl || "",
    });
  }, []);

  const saveAffiliateMlEdit = useCallback(async () => {
    if (!affiliateMlEditModal) return;
    const affiliateUrl = affiliateMlEditModal.affiliateUrl.trim();
    if (!affiliateUrl) {
      setFeedback({ ok: false, text: "Informe o link afiliado antes de salvar as alterações." });
      return;
    }
    setSavingAffiliateMlEditModal(true);
    try {
      const response = await fetch(
        `${affiliateApiBasePath}/links/${encodeURIComponent(affiliateMlEditModal.itemId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            affiliateUrl,
            note: affiliateMlEditModal.note.trim() || null,
            couponCode: affiliateMlEditModal.couponCode.trim() || null,
            couponDetails: affiliateMlEditModal.couponDetails.trim() || null,
            title: affiliateMlEditModal.title.trim() || null,
            productUrl: affiliateMlEditModal.productUrl.trim() || null,
            imageUrl: affiliateMlEditModal.imageUrl.trim() || null,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      await refreshAffiliateMlLinks({ silent: true });
      setAffiliateMlEditModal(null);
      setFeedback({ ok: true, text: "Produto afiliado atualizado com sucesso." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível atualizar o produto afiliado.",
      });
    } finally {
      setSavingAffiliateMlEditModal(false);
    }
  }, [affiliateApiBasePath, affiliateMlEditModal, refreshAffiliateMlLinks]);

  const toggleAffiliateMlLinkActive = useCallback(
    async (entry: AffiliateMercadoLivreLink) => {
      const nextIsActive = entry.isActive === false;
      setTogglingAffiliateMlItemId(entry.itemId);
      try {
        const response = await fetch(
          `${affiliateApiBasePath}/links/${encodeURIComponent(entry.itemId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              isActive: nextIsActive,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(await parseError(response));
        }
        const payload = (await response.json().catch(() => null)) as {
          link?: AffiliateMercadoLivreLink;
        } | null;
        setAffiliateMlLinks((current) =>
          current.map((item) => {
            if (item.itemId !== entry.itemId) return item;
            if (payload?.link) return payload.link;
            return {
              ...item,
              isActive: nextIsActive,
              updatedAt: new Date().toISOString(),
            };
          }),
        );
        setFeedback({
          ok: true,
          text: nextIsActive
            ? "Produto reativado com sucesso."
            : "Produto desativado com sucesso.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível atualizar o status do produto.",
        });
      } finally {
        setTogglingAffiliateMlItemId((current) =>
          current === entry.itemId ? null : current,
        );
      }
    },
    [affiliateApiBasePath],
  );

  const removeAffiliateMlLink = useCallback(async (itemId: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Remover o link afiliado do item ${itemId}?`);
      if (!confirmed) return;
    }
    setRemovingAffiliateMlItemId(itemId);
    try {
      const response = await fetch(
        `${affiliateApiBasePath}/links/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      await refreshAffiliateMlLinks({ silent: true });
      setAffiliateMlSelectedItemIds((current) => {
        if (!current[itemId]) return current;
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      setFeedback({ ok: true, text: "Link afiliado removido com sucesso." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível remover o link afiliado.",
      });
    } finally {
      setRemovingAffiliateMlItemId(null);
    }
  }, [affiliateApiBasePath, refreshAffiliateMlLinks]);

  const removeAffiliateMlLinksBulk = useCallback(
    async (params: { all?: boolean; itemIds?: string[] }) => {
      const all = params.all === true;
      const itemIds = Array.from(
        new Set((Array.isArray(params.itemIds) ? params.itemIds : []).map((entry) => String(entry || "").trim()).filter(Boolean)),
      );
      if (!all && itemIds.length === 0) {
        setFeedback({ ok: false, text: "Selecione ao menos um produto para remover." });
        return;
      }
      if (typeof window !== "undefined") {
        const confirmed = window.confirm(
          all
            ? "Remover todos os produtos desta conta afiliada?"
            : `Remover ${itemIds.length} produto(s) selecionado(s)?`,
        );
        if (!confirmed) return;
      }

      setRemovingAffiliateMlBulk(true);
      try {
        const response = await fetch(`${affiliateApiBasePath}/links`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            all
              ? { all: true }
              : { itemIds },
          ),
        });
        if (!response.ok) {
          throw new Error(await parseError(response));
        }
        const payload = (await response.json().catch(() => null)) as { removed?: number; message?: string } | null;
        await refreshAffiliateMlLinks({ silent: true });
        if (all) {
          setAffiliateMlSelectedItemIds({});
        } else {
          setAffiliateMlSelectedItemIds((current) => {
            const next = { ...current };
            itemIds.forEach((itemId) => {
              delete next[itemId];
            });
            return next;
          });
        }
        const removed = Number(payload?.removed || 0);
        setFeedback({
          ok: true,
          text: payload?.message || `${removed} produto(s) removido(s).`,
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível remover os produtos selecionados.",
        });
      } finally {
        setRemovingAffiliateMlBulk(false);
      }
    },
    [affiliateApiBasePath, refreshAffiliateMlLinks],
  );

  const saveAffiliateMlResolver = useCallback(async () => {
    if (!affiliateMlCookieInput.trim() && !affiliateMlResolver.hasCookie) {
      setFeedback({ ok: false, text: "Cole o cookie do Mercado Livre antes de salvar." });
      return;
    }
    setSavingAffiliateMlResolver(true);
    try {
      const response = await fetch("/api/affiliates/mercadolivre/resolver", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save",
          cookie: affiliateMlCookieInput.trim() || undefined,
          tag: affiliateMlTagInput,
        }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as {
        resolver?: AffiliateMlResolverConfig;
        message?: string;
      };
      if (payload.resolver && typeof payload.resolver === "object") {
        setAffiliateMlResolver({
          provider: "mercadolivre",
          hasCookie: Boolean(payload.resolver.hasCookie),
          cookieHint: payload.resolver.cookieHint ?? null,
          hasCsrfToken: Boolean(payload.resolver.hasCsrfToken),
          tag: payload.resolver.tag ?? null,
          enabled: Boolean(payload.resolver.enabled),
          isValid:
            typeof payload.resolver.isValid === "boolean" ? payload.resolver.isValid : null,
          lastError: payload.resolver.lastError ?? null,
          lastValidatedAt: payload.resolver.lastValidatedAt ?? null,
          updatedAt: payload.resolver.updatedAt ?? null,
        });
        setAffiliateMlTagInput(payload.resolver.tag ?? "");
      }
      setFeedback({
        ok: true,
        text: payload.message || "Cookie do resolvedor salvo e validado com sucesso.",
      });
    } catch (error) {
      setFeedback({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar/validar o cookie do resolvedor.",
      });
    } finally {
      setSavingAffiliateMlResolver(false);
    }
  }, [
    affiliateMlCookieInput,
    affiliateMlResolver.hasCookie,
    affiliateMlTagInput,
  ]);

  const toggleAffiliateMlResolverEnabled = useCallback(async () => {
    const nextEnabled = !affiliateMlResolver.enabled;
    if (nextEnabled && affiliateMlResolver.isValid !== true) {
      setFeedback({
        ok: false,
        text: "Para ativar o resolvedor, primeiro salve um cookie válido.",
      });
      return;
    }
    setTogglingAffiliateMlResolver(true);
    try {
      const response = await fetch("/api/affiliates/mercadolivre/resolver", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "set_enabled",
          enabled: nextEnabled,
        }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as {
        resolver?: AffiliateMlResolverConfig;
        message?: string;
      };
      if (payload.resolver && typeof payload.resolver === "object") {
        setAffiliateMlResolver({
          provider: "mercadolivre",
          hasCookie: Boolean(payload.resolver.hasCookie),
          cookieHint: payload.resolver.cookieHint ?? null,
          hasCsrfToken: Boolean(payload.resolver.hasCsrfToken),
          tag: payload.resolver.tag ?? null,
          enabled: Boolean(payload.resolver.enabled),
          isValid:
            typeof payload.resolver.isValid === "boolean" ? payload.resolver.isValid : null,
          lastError: payload.resolver.lastError ?? null,
          lastValidatedAt: payload.resolver.lastValidatedAt ?? null,
          updatedAt: payload.resolver.updatedAt ?? null,
        });
        setAffiliateMlTagInput(payload.resolver.tag ?? "");
      }
      setFeedback({
        ok: true,
        text: payload.message || (nextEnabled ? "Resolvedor ativado." : "Resolvedor desativado."),
      });
    } catch (error) {
      setFeedback({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o estado do resolvedor.",
      });
    } finally {
      setTogglingAffiliateMlResolver(false);
    }
  }, [affiliateMlResolver.enabled, affiliateMlResolver.isValid]);

  const clearAffiliateMlResolver = useCallback(async () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Deseja remover o cookie do resolvedor automático do Mercado Livre?",
      );
      if (!confirmed) return;
    }
    setClearingAffiliateMlResolver(true);
    try {
      const response = await fetch("/api/affiliates/mercadolivre/resolver", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      await refreshAffiliateMlResolver({ silent: true });
      setAffiliateMlCookieInput("");
      setAffiliateMlTagInput("");
      setFeedback({ ok: true, text: "Cookie do resolvedor removido com sucesso." });
    } catch (error) {
      setFeedback({
        ok: false,
        text:
          error instanceof Error ? error.message : "Não foi possível limpar o cookie do resolvedor.",
      });
    } finally {
      setClearingAffiliateMlResolver(false);
    }
  }, [refreshAffiliateMlResolver]);

  const startAffiliateOAuth = useCallback(
    async (provider: string) => {
      setAffiliateActionProvider(provider);
      try {
        const returnTo = `/dashboard/user?section=affiliates&provider=${encodeURIComponent(provider)}`;
        const response = await fetch(`/api/affiliates/providers/${encodeURIComponent(provider)}/connect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ returnTo }),
        });
        if (!response.ok) {
          throw new Error(await parseError(response));
        }
        const payload = (await response.json()) as {
          status?: boolean;
          authorizationUrl?: string;
          message?: string;
        };
        if (!payload.status || !payload.authorizationUrl) {
          throw new Error(payload.message || "Não foi possível iniciar a conexão OAuth.");
        }
        window.location.href = payload.authorizationUrl;
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível iniciar a conexão OAuth.",
        });
      } finally {
        setAffiliateActionProvider(null);
      }
    },
    [],
  );

  const selectAffiliateProviderAccount = useCallback(
    async (provider: string, connectionId: number) => {
      setAffiliateActionProvider(provider);
      try {
        const response = await fetch(`/api/affiliates/providers/${encodeURIComponent(provider)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "select_account",
            connectionId,
          }),
        });
        if (!response.ok) {
          throw new Error(await parseError(response));
        }
        await refreshAffiliateProviders({ silent: true });
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível selecionar a conta.",
        });
      } finally {
        setAffiliateActionProvider(null);
      }
    },
    [refreshAffiliateProviders],
  );

  const openAffiliateProviderCredentialsModal = useCallback((provider: AffiliateProviderSummary) => {
    setAffiliateProviderCredentialModal({
      provider: provider.provider,
      label: provider.label,
      accountName: "",
      appId: "",
      clientSecret: "",
      appToken: "",
      connectionId: null,
    });
  }, []);

  const saveAffiliateProviderCredentials = useCallback(async () => {
    if (!affiliateProviderCredentialModal) return;
    const provider = affiliateProviderCredentialModal.provider;
    const appId = affiliateProviderCredentialModal.appId.trim();
    const clientSecret = affiliateProviderCredentialModal.clientSecret.trim();
    if (!appId || !clientSecret) {
      setFeedback({
        ok: false,
        text: "Informe AppID e Senha/Secret para salvar a conta.",
      });
      return;
    }

    setSavingAffiliateProviderCredential(true);
    setAffiliateActionProvider(provider);
    try {
      const response = await fetch(`/api/affiliates/providers/${encodeURIComponent(provider)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save_credentials",
          accountName: affiliateProviderCredentialModal.accountName.trim() || null,
          appId,
          clientSecret,
          appToken: affiliateProviderCredentialModal.appToken.trim() || null,
          connectionId: affiliateProviderCredentialModal.connectionId,
          select: true,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      await refreshAffiliateProviders({ silent: true });
      setAffiliateProviderCredentialModal(null);
      setFeedback({
        ok: true,
        text: "Conta adicionada/atualizada com sucesso.",
      });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível salvar as credenciais da conta.",
      });
    } finally {
      setSavingAffiliateProviderCredential(false);
      setAffiliateActionProvider(null);
    }
  }, [affiliateProviderCredentialModal, refreshAffiliateProviders]);

  const refreshAffiliateToken = useCallback(
    async (provider: string) => {
      setAffiliateActionProvider(provider);
      try {
        const response = await fetch(`/api/affiliates/providers/${encodeURIComponent(provider)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "refresh",
            connectionId: selectedAffiliateProviderConnectionId,
          }),
        });
        if (!response.ok) {
          throw new Error(await parseError(response));
        }
        await refreshAffiliateProviders({ silent: true });
        setFeedback({ ok: true, text: "Token da conta de afiliado atualizado com sucesso." });
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível atualizar o token da conta.",
        });
      } finally {
        setAffiliateActionProvider(null);
      }
    },
    [refreshAffiliateProviders, selectedAffiliateProviderConnectionId],
  );

  const disconnectAffiliateProvider = useCallback(
    async (provider: string) => {
      if (typeof window !== "undefined") {
        const confirmed = window.confirm(
          "Deseja desconectar esta conta de afiliado? Você poderá reconectar a qualquer momento.",
        );
        if (!confirmed) return;
      }
      setAffiliateActionProvider(provider);
      try {
        const search = new URLSearchParams();
        if (selectedAffiliateProviderConnectionId !== null) {
          search.set("connectionId", String(selectedAffiliateProviderConnectionId));
        }
        const response = await fetch(
          `/api/affiliates/providers/${encodeURIComponent(provider)}${search.toString() ? `?${search.toString()}` : ""}`,
          {
            method: "DELETE",
          },
        );
        if (!response.ok) {
          throw new Error(await parseError(response));
        }
        await refreshAffiliateProviders({ silent: true });
        setFeedback({ ok: true, text: "Conta de afiliado desconectada com sucesso." });
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível desconectar a conta.",
        });
      } finally {
        setAffiliateActionProvider(null);
      }
    },
    [refreshAffiliateProviders, selectedAffiliateProviderConnectionId],
  );

  const openAffiliateMlImportModal = useCallback(() => {
    if (importingAffiliateMlProducts || affiliateImportJobActive) {
      setFeedback({
        ok: false,
        text: "Já existe uma importação em andamento. Aguarde a conclusão ou cancele no card de progresso.",
      });
      return;
    }
    setAffiliateMlImportShowResultsOnly(false);
    setAffiliateMlImportWarningExpanded(false);
    setIsAffiliateMlImportModalOpen(true);
  }, [affiliateImportJobActive, importingAffiliateMlProducts]);

  useEffect(() => {
    if (section !== "affiliates") return;
    void refreshAffiliateProviders({ silent: true });
  }, [refreshAffiliateProviders, section]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (!isAffiliateAutomationProvider) return;
    void refreshAffiliateMlLinks({ silent: true });
  }, [isAffiliateAutomationProvider, refreshAffiliateMlLinks, section, selectedAffiliateProvider?.connected]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (!isAffiliateResolverProvider) return;
    void refreshAffiliateMlResolver({ silent: true });
  }, [isAffiliateResolverProvider, refreshAffiliateMlResolver, section, selectedAffiliateProvider?.connected]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (!isAffiliateAutomationProvider) return;
    void refreshAffiliateMlMessageTemplate({ silent: true });
  }, [
    isAffiliateAutomationProvider,
    refreshAffiliateMlMessageTemplate,
    section,
    selectedAffiliateProvider?.connected,
  ]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (!isAffiliateAutomationProvider) return;
    void refreshAffiliateMlGroupDispatches({ silent: true });
  }, [
    isAffiliateAutomationProvider,
    refreshAffiliateMlGroupDispatches,
    section,
    selectedAffiliateProvider?.connected,
  ]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (!isAffiliateAutomationProvider) return;
    void refreshAffiliateMlAutoSyncConfig({ silent: true });
  }, [
    isAffiliateAutomationProvider,
    refreshAffiliateMlAutoSyncConfig,
    section,
    selectedAffiliateProvider?.connected,
  ]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (!isAffiliateShopeeProvider) return;
    if (affiliateTab !== "insights") return;
    const autoLoadKey = `${selectedAffiliateProvider?.provider || ""}:${selectedAffiliateProviderConnectionId || 0}:${selectedAffiliateProvider?.connected ? 1 : 0}:${section}:${affiliateTab}`;
    if (shopeeInsightsAutoLoadKeyRef.current === autoLoadKey) return;
    shopeeInsightsAutoLoadKeyRef.current = autoLoadKey;
    void refreshShopeePerformance({ silent: true });
  }, [
    affiliateTab,
    isAffiliateShopeeProvider,
    selectedAffiliateProvider?.provider,
    selectedAffiliateProviderConnectionId,
    refreshShopeePerformance,
    section,
    selectedAffiliateProvider?.connected,
  ]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (!isAffiliateShopeeProvider) return;
    if (affiliateTab !== "products") return;
    if (!isAffiliateMlImportModalOpen) return;
    // Modal simplificado: carregamento manual das ofertas oficiais para evitar peso desnecessário.
  }, [
    affiliateTab,
    isAffiliateMlImportModalOpen,
    isAffiliateShopeeProvider,
    section,
  ]);

  useEffect(() => {
    setAffiliateMlImportWarningExpanded(false);
  }, [affiliateMlImportWarning]);

  useEffect(
    () => () => {
      affiliateImportAbortControllerRef.current?.abort();
      affiliateImportAbortControllerRef.current = null;
      affiliateImportCancelRequestedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (section === "affiliates" && isAffiliateShopeeProvider && affiliateTab === "insights") return;
    shopeeInsightsAutoLoadKeyRef.current = "";
  }, [affiliateTab, isAffiliateShopeeProvider, section]);

  useEffect(() => {
    if (section !== "affiliates") return;
    if (!isAffiliateShopeeProvider) return;
    if (affiliateTab !== "insights") return;
    if (!shopeeSelectedFeedId) {
      setShopeeFeedData(null);
      return;
    }
    void refreshShopeeFeedData({ silent: true });
  }, [
    affiliateTab,
    isAffiliateShopeeProvider,
    refreshShopeeFeedData,
    section,
    shopeeFeedPreviewLimit,
    shopeeSelectedFeedId,
    shopeeSelectedFeedMode,
  ]);

  useEffect(() => {
    if (isAffiliateAutomationProvider) return;
    setAffiliateMlLinks([]);
    setAffiliateMlSelectedItemIds({});
    setAffiliateMlLinkInput("");
    setAffiliateMlLinkNote("");
    setAffiliateMlResolver({
      provider: "mercadolivre",
      hasCookie: false,
      cookieHint: null,
      hasCsrfToken: false,
      tag: null,
      enabled: false,
      isValid: null,
      lastError: null,
      lastValidatedAt: null,
      updatedAt: null,
    });
    setAffiliateMlCookieInput("");
    setAffiliateMlTagInput("");
    setIsAffiliateMlCreateModalOpen(false);
    setIsAffiliateMlImportModalOpen(false);
    affiliateImportCancelRequestedRef.current = true;
    affiliateImportAbortControllerRef.current?.abort();
    affiliateImportAbortControllerRef.current = null;
    setAffiliateMlImportCategoryQuery("");
    setAffiliateMlImportPresetKey(DEFAULT_AFFILIATE_ML_IMPORT_PRESET_KEY);
    setAffiliateMlImportLimit("120");
    setAffiliateMlImportMode("promotions");
    setAffiliateMlImportProducts([]);
    setAffiliateMlImportSelectedIds({});
    setAffiliateMlImportNote("");
    setAffiliateMlImportWarning(null);
    setAffiliateMlImportWarningExpanded(false);
    setAffiliateMlImportShowResultsOnly(false);
    setImportingAffiliateMlProducts(false);
    setCancellingAffiliateImportJob(false);
    setAffiliateImportJob(null);
    setAffiliateMlListCategoryFilter("all");
    setSyncingAffiliateMlLinks(false);
    const fallbackAutoSync = createDefaultAffiliateMlAutoSyncConfig();
    setAffiliateMlAutoSyncConfig(fallbackAutoSync);
    setAffiliateMlAutoSyncTargetInput(String(fallbackAutoSync.targetImportLimit));
    setAffiliateAutoSyncTermsInput("");
    setAffiliateAutoSyncCategoryKeysInput([]);
    setIsAffiliateAutoSyncFiltersModalOpen(false);
    setLoadingAffiliateMlAutoSync(false);
    setSavingAffiliateMlAutoSync(false);
    setAffiliateMlEditModal(null);
    setSavingAffiliateMlEditModal(false);
    setAffiliateMlGroupDispatches([]);
    setLoadingAffiliateMlGroupDispatches(false);
    setSavingAffiliateMlGroupDispatchId(null);
    setRemovingAffiliateMlGroupDispatchId(null);
    setAffiliateMlDispatchInstanceIdInput("");
    setAffiliateMlDispatchGroupIdInput("");
    setAffiliateMlDispatchDelayInput("15");
    setAffiliateMlDispatchCategoryRotationInput(true);
    setAffiliateDispatchModal(null);
    const fallbackTemplate = createDefaultAffiliateMlMessageTemplate();
    setAffiliateMlMessageTemplate(fallbackTemplate);
    setAffiliateMlVisualTemplateText(buildAffiliateMlDirectTemplateTextFromItems(fallbackTemplate.items));
    setAffiliateMlTemplateButtonText(fallbackTemplate.buttonLabel);
    setAffiliateMlTemplateFooterText(fallbackTemplate.footerText);
    setAffiliateMlTemplateProviderTitle(fallbackTemplate.providerTitle);
  }, [isAffiliateAutomationProvider]);

  useEffect(() => {
    if (isAffiliateShopeeProvider) return;
    shopeeInsightsAutoLoadKeyRef.current = "";
    setLoadingShopeePerformance(false);
    setLoadingShopeeOffers(false);
    setLoadingShopeeFeeds(false);
    setLoadingShopeeFeedData(false);
    setShopeePerformancePeriodDaysInput("30");
    setShopeePerformanceLimitInput("100");
    setShopeePerformance(createDefaultShopeePerformancePayload());
    setShopeeOfferKeywordInput("");
    setShopeeOfferSortInput("2");
    setShopeeOfferLimitInput("20");
    setShopeeOffers(createDefaultShopeeOffersPayload());
    setShopeeFeedPreviewLimitInput("100");
    setShopeeFeedsByMode({ FULL: [], DELTA: [] });
    setShopeeSelectedFeedMode("FULL");
    setShopeeSelectedFeedId("");
    setShopeeFeedData(null);
  }, [isAffiliateShopeeProvider]);

  useEffect(() => {
    setAffiliateTab("account");
    setAffiliateDispatchModal(null);
    setIsAffiliateAutoSyncFiltersModalOpen(false);
  }, [selectedAffiliateProvider?.provider]);

  useEffect(() => {
    if (!isAffiliateAutomationProvider) return;

    const currentInstanceId = Number(affiliateMlDispatchInstanceIdInput);
    if (
      Number.isFinite(currentInstanceId) &&
      currentInstanceId > 0 &&
      affiliateDispatchAvailableInstances.some((instance) => instance.id === currentInstanceId)
    ) {
      return;
    }

    const preferredInstance = affiliateDispatchCreatableGroups[0]?.instanceId ?? affiliateDispatchAvailableInstances[0]?.id ?? null;
    const nextValue = preferredInstance ? String(preferredInstance) : "";
    if (nextValue !== affiliateMlDispatchInstanceIdInput) {
      setAffiliateMlDispatchInstanceIdInput(nextValue);
    }
  }, [
    affiliateDispatchAvailableInstances,
    affiliateDispatchCreatableGroups,
    affiliateMlDispatchInstanceIdInput,
    isAffiliateAutomationProvider,
  ]);

  useEffect(() => {
    if (!isAffiliateAutomationProvider) return;

    const currentGroupId = Number(affiliateMlDispatchGroupIdInput);
    if (
      Number.isFinite(currentGroupId) &&
      currentGroupId > 0 &&
      affiliateMlDispatchGroups.some((group) => group.id === currentGroupId)
    ) {
      return;
    }

    const preferredGroup =
      affiliateMlDispatchGroups.find((group) => !affiliateMlDispatchMapByGroupId.has(group.id)) ??
      affiliateMlDispatchGroups[0] ??
      null;
    const nextValue = preferredGroup ? String(preferredGroup.id) : "";
    if (nextValue !== affiliateMlDispatchGroupIdInput) {
      setAffiliateMlDispatchGroupIdInput(nextValue);
    }
  }, [
    affiliateMlDispatchGroupIdInput,
    affiliateMlDispatchGroups,
    affiliateMlDispatchMapByGroupId,
    isAffiliateAutomationProvider,
  ]);

  useEffect(() => {
    if (!affiliateDispatchModal) return;

    const currentInstanceId = Number(affiliateDispatchModal.instanceId);
    const hasValidInstance =
      Number.isFinite(currentInstanceId) &&
      currentInstanceId > 0 &&
      affiliateDispatchAvailableInstances.some((instance) => instance.id === currentInstanceId);
    const nextInstanceId =
      hasValidInstance
        ? currentInstanceId
        : affiliateDispatchAvailableInstances[0]?.id ?? null;
    const modalGroups = buildAffiliateDispatchGroupsForInstance(
      nextInstanceId,
      Number(affiliateDispatchModal.groupId),
    );
    const currentGroupId = Number(affiliateDispatchModal.groupId);
    const hasValidGroup =
      Number.isFinite(currentGroupId) &&
      currentGroupId > 0 &&
      modalGroups.some((group) => group.id === currentGroupId);
    const nextGroupId = hasValidGroup ? currentGroupId : modalGroups[0]?.id ?? null;
    const nextInstanceValue = nextInstanceId ? String(nextInstanceId) : "";
    const nextGroupValue = nextGroupId ? String(nextGroupId) : "";

    if (
      nextInstanceValue !== affiliateDispatchModal.instanceId ||
      nextGroupValue !== affiliateDispatchModal.groupId
    ) {
      setAffiliateDispatchModal((current) =>
        current
          ? {
              ...current,
              instanceId: nextInstanceValue,
              groupId: nextGroupValue,
            }
          : current,
      );
    }
  }, [
    affiliateDispatchAvailableInstances,
    affiliateDispatchModal,
    affiliateDispatchModalGroups,
    buildAffiliateDispatchGroupsForInstance,
  ]);

  const openQuickCheckout = useCallback(
    (context: QuickCheckoutContext) => {
      setQuickCheckoutContext(context);
      setQuickCheckoutProvider(availablePaymentProviders[0] ?? "mercadopago_pix");
      setQuickCheckoutPending(null);
      setQuickCheckoutError(null);
      setQuickCheckoutSuccess(null);
      setQuickCheckoutUseBalance(false);
    },
    [availablePaymentProviders],
  );

	  const buildGroupCheckoutContext = useCallback(
	    (group: BotGroup, mode: GroupActionMode): QuickCheckoutContext | null => {
	      const plan = profilePlanOptions[0] ?? checkoutPlan;
	      if (!plan) {
	        return null;
	      }
		
		      return {
		        mode: "profile_unlimited",
		        title: mode === "activate" ? "Assinar perfil" : "Renovar perfil",
		        description: "Uma assinatura ativa libera todos os grupos, perfis e funcionalidades do painel. Storage continua separado.",
	        planId: plan.id,
	        includePlan: true,
	        addons: {
	          group: 0,
	          instance: 0,
	        },
	        groupId: group.id,
	        instanceId: group.instanceId,
      };
    },
    [
	      checkoutPlan,
	      profilePlanOptions,
				    ],
			  );

  const buildInstanceCheckoutContext = useCallback(
    (mode: "renew" | "create", instance?: BotInstance | null): QuickCheckoutContext | null => {
      const requiredPosition =
        mode === "create"
          ? profileInstances.length + 1
          : instance
            ? sortedInstancesByCreation.findIndex((entry) => entry.id === instance.id) + 1
            : 1;
      void requiredPosition;
      const plan = profilePlanOptions[0] ?? checkoutPlan;
      if (!plan) {
        return null;
      }
      const includePlan = true;
      const title = mode === "renew" ? "Renovar plano do perfil" : "Escolher plano do perfil";
      const description =
        mode === "renew"
          ? "Escolha o plano mensal que manterá este perfil e seus recursos ativos."
          : "Escolha o plano mensal para liberar este novo perfil e os recursos do painel.";

      return {
        mode: mode === "renew" ? "instance_renewal" : "instance_creation",
        title,
        description,
        planId: plan.id,
        includePlan,
        addons: {
          group: 0,
          instance: 0,
        },
        instanceId: instance?.id,
      };
    },
    [
	      checkoutPlan,
	      profileInstances.length,
	      profilePlanOptions,
	      sortedInstancesByCreation,
    ],
  );

  const openFlowPlanCheckout = useCallback(() => {
    const plan = profilePlanOptions[0];
    if (!plan) {
      setFeedback({ ok: false, text: "Nenhum plano ativo está disponível no momento." });
      return;
    }

    openQuickCheckout({
      mode: "profile_unlimited",
      title: "Liberar fluxos",
      description: "Escolha uma assinatura mensal para liberar todos os perfis, grupos e funcionalidades.",
      planId: plan.id,
      includePlan: true,
      requiresFlows: true,
      addons: {
        group: 0,
        instance: 0,
      },
      instanceId: selectedInstanceId ?? undefined,
    });
  }, [openQuickCheckout, profilePlanOptions, selectedInstanceId]);

  const loadInstanceProfile = useCallback(
    async (instanceId: number, { silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setLoadingInstanceProfileId(instanceId);
      }
      try {
        const response = await fetch(`/api/bot-instances/${instanceId}/profile`, { cache: "no-store" });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { profile?: BotInstanceProfile };
        if (payload.profile) {
          setInstanceProfiles((current) => ({
            ...current,
            [instanceId]: payload.profile!,
          }));
          setBrokenInstanceImages((current) => {
            if (!current[instanceId]) return current;
            const next = { ...current };
            delete next[instanceId];
            return next;
          });
        }
      } catch (error) {
        if (!silent) {
          setFeedback({
            ok: false,
            text: error instanceof Error ? error.message : "Não foi possível carregar o perfil da conexão.",
          });
        }
      } finally {
        if (!silent) {
          setLoadingInstanceProfileId((current) => (current === instanceId ? null : current));
        }
      }
    },
    [],
  );

  const loadGroupSettingsSnapshot = useCallback(
    async (groupId: number) => {
      const response = await fetch(`/api/bot-groups/${groupId}/settings`, { cache: "no-store" });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { settings?: BotGroupSettings };
      if (!payload.settings) return null;

      setGroupSettingsById((current) => ({
        ...current,
        [groupId]: payload.settings!,
      }));
      setGroupConfigs((current) => {
        const group = groups.find((entry) => entry.id === groupId);
        if (!group) return current;
        return {
          ...current,
          [groupId]: mapSettingsToConfig(group, payload.settings!),
        };
      });
      return payload.settings;
    },
    [groups],
  );

  const loadGroupActivity = useCallback(
    async (groupId: number, { silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setLoadingActivityGroupId(groupId);
      }
      try {
        const response = await fetch(`/api/bot-groups/${groupId}/activity?limit=80`, { cache: "no-store" });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { entries?: GroupActivityEntry[] };
        setGroupActivityById((current) => ({
          ...current,
          [groupId]: Array.isArray(payload.entries) ? payload.entries : [],
        }));
      } catch (error) {
        if (!silent) {
          setFeedback({
            ok: false,
            text:
              error instanceof Error
                ? error.message
                : "Não foi possível carregar o histórico de ações do grupo.",
          });
        }
      } finally {
        if (!silent) {
          setLoadingActivityGroupId((current) => (current === groupId ? null : current));
        }
      }
    },
    [],
  );

  const resetGroupActivity = useCallback(
    async (groupId: number) => {
      const group = groups.find((entry) => entry.id === groupId);
      const confirmed = window.confirm(
        `Limpar o histórico de ações do grupo${group?.name ? ` "${group.name}"` : ""}?`,
      );
      if (!confirmed) return;
      setResettingActivityGroupId(groupId);
      try {
        const response = await fetch(`/api/bot-groups/${groupId}/activity`, { method: "DELETE" });
        if (!response.ok) throw new Error(await parseError(response));
        setGroupActivityById((current) => ({
          ...current,
          [groupId]: [],
        }));
        setFeedback({ ok: true, text: "Histórico do grupo limpo com sucesso." });
      } catch (error) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível limpar o histórico do grupo.",
        });
      } finally {
        setResettingActivityGroupId((current) => (current === groupId ? null : current));
      }
    },
    [groups],
  );

  const loadGroupParticipants = useCallback(
    async (
      groupId: number,
      { silent = false, refresh = false }: { silent?: boolean; refresh?: boolean } = {},
    ) => {
      if (!silent) {
        setLoadingParticipantsGroupId(groupId);
      }
      try {
        const query = refresh ? "?refresh=1" : "";
        const response = await fetch(`/api/bot-groups/${groupId}/participants${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { participants?: GroupParticipant[] };
        setGroupParticipantsById((current) => ({
          ...current,
          [groupId]: Array.isArray(payload.participants) ? payload.participants : [],
        }));
      } catch (error) {
        if (!silent) {
          setFeedback({
            ok: false,
            text:
              error instanceof Error
                ? error.message
                : "Não foi possível carregar os membros do grupo.",
          });
        }
      } finally {
        if (!silent) {
          setLoadingParticipantsGroupId((current) => (current === groupId ? null : current));
        }
      }
    },
    [],
  );

  const syncBrokenGroupImage = useCallback(async (groupId: number, failedUrl: string | null | undefined) => {
	    if (syncingBrokenGroupIdsRef.current.has(groupId)) {
	      return;
	    }
	    const normalizedFailedUrl = failedUrl?.trim() || null;
	    const lastAttempt = brokenGroupImageSyncAttemptsRef.current[groupId];
	    if (
	      lastAttempt &&
	      lastAttempt.url === normalizedFailedUrl &&
	      Date.now() - lastAttempt.attemptedAt < GROUP_IMAGE_RESYNC_COOLDOWN_MS
	    ) {
	      return;
	    }
	    brokenGroupImageSyncAttemptsRef.current[groupId] = {
	      url: normalizedFailedUrl,
	      attemptedAt: Date.now(),
	    };
	    syncingBrokenGroupIdsRef.current.add(groupId);
	    try {
	      const response = await fetch(`/api/bot-groups/${groupId}/sync?reason=image`, { method: "POST" });
	      if (!response.ok) return;
	      const payload = (await response.json()) as { group?: BotGroup };
	      if (payload.group) {
	        setGroups((current) => current.map((group) => (group.id === groupId ? payload.group! : group)));
	        const nextImageUrl = payload.group.imageUrl?.trim() || null;
	        if (nextImageUrl && nextImageUrl !== normalizedFailedUrl) {
	          setBrokenGroupImages((current) => {
	            const next = { ...current };
	            delete next[groupId];
	            return next;
	          });
	        }
	      }
	    } catch {
	      // keep fallback avatar
	    } finally {
	      syncingBrokenGroupIdsRef.current.delete(groupId);
	    }
	  }, []);

	  const handleGroupImageError = useCallback(
	    (groupId: number, imageUrl?: string | null) => {
	      setBrokenGroupImages((current) => {
	        if (current[groupId]) return current;
	        return { ...current, [groupId]: true };
	      });
	      void syncBrokenGroupImage(groupId, imageUrl);
	    },
	    [syncBrokenGroupImage],
	  );

  useEffect(() => {
    if (section !== "instances" || !selectedInstance) {
      return;
    }
    void loadInstanceProfile(selectedInstance.id, { silent: true });
  }, [loadInstanceProfile, section, selectedInstance]);

  useEffect(() => {
    if (!pairingModal && section !== "instances" && section !== "groups") {
      return;
    }

    const refreshStatuses = async () => {
      try {
        await refreshInstances();
      } catch {
        // silent polling
      }
    };

    void refreshStatuses();
    const intervalMs = pairingModal ? 1000 : 4000;
    const intervalId = window.setInterval(() => {
      void refreshStatuses();
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pairingModal, refreshInstances, section]);

  useEffect(() => {
    if (!selectedInstance) {
      setInstanceProfileForm({ displayName: "", phone: "", pushName: "", statusText: "" });
      instanceProfileHydratedRef.current = null;
      return;
    }
    const profile = instanceProfiles[selectedInstance.id];
    const hydrateKey = `${selectedInstance.id}:${profile?.updatedAt ?? "no-profile"}`;
    if (instanceProfileHydratedRef.current === hydrateKey) {
      return;
    }
    instanceProfileHydratedRef.current = hydrateKey;
    setInstanceProfileForm({
      displayName: selectedInstance.name,
      phone: selectedInstance.phone,
      pushName: profile?.pushName ?? "",
      statusText: profile?.statusText ?? "",
    });
  }, [instanceProfiles, selectedInstance?.id, selectedInstance?.name, selectedInstance?.phone]);

  useEffect(() => {
    const load = async () => {
      if (!selectedGroup || groupConfigs[selectedGroup.id]) return;
      try {
        const response = await fetch(`/api/bot-groups/${selectedGroup.id}/settings`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { settings?: BotGroupSettings };
        if (!payload.settings) return;
        const settings = payload.settings;

        setGroupSettingsById((current) => ({
          ...current,
          [selectedGroup.id]: settings,
        }));

        setGroupConfigs((current) => ({
          ...current,
          [selectedGroup.id]: mapSettingsToConfig(selectedGroup, settings),
        }));
      } catch {
        // keep defaults
      }
    };
    void load();
  }, [groupConfigs, selectedGroup]);

  useEffect(() => {
    if (!selectedGroupSettings) {
      setBotCoinsDraft(null);
      botCoinsDraftGroupIdRef.current = null;
      botCoinsLastSavedRef.current = null;
      return;
    }
    if (
      botCoinsDraftGroupIdRef.current === selectedGroupSettings.groupId &&
      botCoinsDraftRef.current
    ) {
      return;
    }
    const nextDraft = cloneBotCoinsConfig(selectedGroupSettings.botCoins);
    if (nextDraft) {
      nextDraft.premium = clonePremiumConfig(selectedGroupSettings.premium);
      nextDraft.earnings.message.enabled = false;
      nextDraft.earnings.daily.enabled = false;
      nextDraft.earnings.levelUp.enabled = false;
      nextDraft.rewards.weekly.enabled = false;
      nextDraft.rewards.monthly.enabled = false;
      nextDraft.spending.commandCosts = {};
      nextDraft.shopItems = [];
    }
    setBotCoinsDraft(nextDraft);
    botCoinsDraftGroupIdRef.current = selectedGroupSettings.groupId;
    botCoinsLastSavedRef.current = nextDraft ? JSON.stringify(nextDraft) : null;
  }, [selectedGroupSettings]);

  useEffect(() => {
    botCoinsDraftRef.current = botCoinsDraft;
  }, [botCoinsDraft]);

  useEffect(() => {
    if (!selectedGroup) return;
    setGroupConfigs((current) => {
      const existing = current[selectedGroup.id];
      if (!existing) return current;
      return {
        ...current,
        [selectedGroup.id]: {
          ...existing,
          name: selectedGroup.name,
          description: selectedGroup.description ?? "",
          adminsOnly: selectedGroup.metadata?.adminsOnly ?? existing.adminsOnly,
          locked: selectedGroup.metadata?.locked ?? existing.locked,
        },
      };
    });
  }, [selectedGroup]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (selectedGroupId !== null) {
      window.localStorage.setItem(DASHBOARD_GROUP_STORAGE_KEY, String(selectedGroupId));
      return;
    }
    window.localStorage.removeItem(DASHBOARD_GROUP_STORAGE_KEY);
  }, [selectedGroupId]);

  useEffect(() => {
    setSelectedParticipantIds([]);
    setParticipantSearch("");
    setShowAllParticipants(false);
    setParticipantImportModalOpen(false);
    setParticipantImportSourceGroupId("");
    setParticipantImportJob(null);
    setLoadingParticipantImportJob(false);
    setCancellingParticipantImportJob(false);
    participantImportLastSettledRef.current = null;
    setActivityActionMenuEntryId(null);
    setActivityActionBusyKey(null);

    if (!selectedGroupIdSafe) {
      return;
    }
  }, [selectedGroupIdSafe]);

  useEffect(() => {
    if (!selectedGroupIdSafe) return;
    setGroupMetaDraft({
      adminsOnly: selectedGroupAdminsOnly,
      locked: selectedGroupLocked,
      ephemeral: selectedGroupEphemeral,
    });
  }, [selectedGroupAdminsOnly, selectedGroupEphemeral, selectedGroupIdSafe, selectedGroupLocked]);

  useEffect(() => {
    if (section !== "groups" || !selectedGroup?.id) {
      return;
    }
    void loadGroupParticipants(selectedGroup.id, { silent: true });
  }, [loadGroupParticipants, section, selectedGroup?.id]);

  useEffect(() => {
    if (groupTab !== "premium") {
      setCoinLedgerEntries([]);
      setCoinLedgerMember(null);
    }
  }, [groupTab]);

  useEffect(() => {
    if (!botCoinsModal) return;
    if (visibleBotCoinsShortcuts.some((item) => item.key === botCoinsModal)) return;
    setBotCoinsModal("premiumPlans");
  }, [botCoinsModal, visibleBotCoinsShortcuts]);

  useEffect(() => {
    setSelectedParticipantIds((current) =>
      current.filter((id) => selectedGroupParticipants.some((participant) => participant.id === id)),
    );
  }, [selectedGroupParticipants]);

  useEffect(() => {
    if (!participantImportModalOpen) return;
    if (participantImportSourceGroups.length === 0) {
      setParticipantImportSourceGroupId("");
      return;
    }
    const selectedId = Number.parseInt(participantImportSourceGroupId, 10);
    if (
      Number.isFinite(selectedId) &&
      participantImportSourceGroups.some((group) => group.id === selectedId)
    ) {
      return;
    }
    setParticipantImportSourceGroupId(String(participantImportSourceGroups[0]!.id));
  }, [participantImportModalOpen, participantImportSourceGroupId, participantImportSourceGroups]);

  useEffect(() => {
    if (affiliateMlListCategoryFilter === "all") return;
    if (
      affiliateMlCategoryFilterOptions.some((entry) => entry.value === affiliateMlListCategoryFilter)
    ) {
      return;
    }
    setAffiliateMlListCategoryFilter("all");
  }, [affiliateMlCategoryFilterOptions, affiliateMlListCategoryFilter]);

  useEffect(() => {
    const validItemIds = new Set(filteredAffiliateMlLinks.map((entry) => entry.itemId));
    setAffiliateMlSelectedItemIds((current) => {
      const nextEntries = Object.entries(current).filter(([itemId, selected]) => selected && validItemIds.has(itemId));
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [filteredAffiliateMlLinks]);

  useEffect(() => {
    if (!quickCheckoutContext || !quickCheckoutPending) {
      return;
    }

    const paymentId = quickCheckoutPending.providerPaymentId;
    let active = true;

    const onApproved = async () => {
      if (!active) return;
      setQuickCheckoutSuccess("Pagamento aprovado. Atualizando sua conta...");
      setQuickCheckoutPending(null);
      setQuickCheckoutError(null);

      if (quickCheckoutContext.mode === "group_activation" || quickCheckoutContext.mode === "group_renewal") {
        if (quickCheckoutContext.groupId) {
          await setGroupActivation(true, quickCheckoutContext.groupId);
        } else {
          await refreshGroups();
        }
      } else if (quickCheckoutContext.mode === "instance_creation") {
        await refreshInstances().catch(() => undefined);
        if (quickCheckoutContext.instanceId) {
          setSelectedInstanceId(quickCheckoutContext.instanceId);
          setFeedback({
            ok: true,
            text: "Perfil liberado. Você já pode conectar e parear.",
          });
          if (isMobileViewport) {
            setMobileView("detail");
          }
        } else {
          setIsCreateInstanceModalOpen(true);
        }
      } else if (quickCheckoutContext.mode === "profile_unlimited") {
        if (quickCheckoutContext.groupId) {
          await setGroupActivation(true, quickCheckoutContext.groupId);
        } else {
          await refreshGroups().catch(() => undefined);
        }
        await refreshInstances().catch(() => undefined);
      } else {
        await refreshInstances().catch(() => undefined);
      }

      router.refresh();
      window.setTimeout(() => {
        if (!active) return;
        setQuickCheckoutContext(null);
        setQuickCheckoutSuccess(null);
      }, 1400);
    };

    const poll = async () => {
      try {
        const response = await fetch(`/api/user/plan/status?paymentId=${encodeURIComponent(paymentId)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as { status?: string } | null;
        const status = String(payload?.status ?? "").toLowerCase();
        if (status === "approved") {
          await onApproved();
        }
      } catch {
        // segue polling
      }
    };

    const kickoff = window.setTimeout(() => {
      void poll();
    }, 1800);
    const interval = window.setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      active = false;
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [isMobileViewport, quickCheckoutContext, quickCheckoutPending, refreshGroups, refreshInstances, router]);

  const runInstanceAction = async (instanceId: number, action: "restart" | "logout") => {
    setBusyInstanceId(instanceId);
    try {
      const response = await fetch(`/api/bot-instances/${instanceId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      await refreshInstances();
      setFeedback({ ok: true, text: "Ação executada com sucesso." });
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Erro ao executar ação." });
    } finally {
      setBusyInstanceId(null);
    }
  };

  const toggleInstanceLicenseSales = async (instanceId: number, enabled: boolean) => {
    setBusyInstanceId(instanceId);
    try {
      const response = await fetch(`/api/bot-instances/${instanceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseSalesEnabled: enabled }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { instance?: BotInstance };
      if (payload.instance) {
        const updatedInstance = payload.instance;
        setInstances((current) =>
          current.map((instance) => (instance.id === updatedInstance.id ? updatedInstance : instance)),
        );
      } else {
        await refreshInstances();
      }
	      setFeedback({
	        ok: true,
	        text: enabled
	          ? "Renovação do perfil pelo WhatsApp ativada para este perfil."
	          : "Renovação do perfil pelo WhatsApp desativada para este perfil.",
	      });
    } catch (error) {
      setFeedback({
        ok: false,
	      text: error instanceof Error ? error.message : "Erro ao atualizar renovação do perfil pelo WhatsApp.",
      });
    } finally {
      setBusyInstanceId(null);
    }
  };

  const closePairingModal = useCallback(() => {
    pairingRequestIdRef.current += 1;
    setPairingModal(null);
    setPairingGuideOpen(false);
    setPairingGuidePlatform("android");
    setBusyInstanceId(null);
  }, []);

  useEffect(() => {
    if (!pairingModal) {
      return;
    }
    const connectedInstance = instances.find(
      (instance) => instance.id === pairingModal.instanceId && instance.sessionStatus === "conectado",
    );
    if (connectedInstance) {
      closePairingModal();
      setFeedback({ ok: true, text: "Conexão estabelecida. Pareamento concluído." });
    }
  }, [closePairingModal, instances, pairingModal]);

  const openPairingMethodModal = (instanceId: number) => {
    advanceOnboardingFor("instances-pair");
    const targetInstance = instances.find((instance) => instance.id === instanceId) ?? null;
    const forceReconnect =
      targetInstance?.purpose === "admin_system" && targetInstance.sessionStatus === "conectado";
    if (targetInstance?.sessionStatus === "conectado" && !forceReconnect) {
      setFeedback({ ok: true, text: "Este perfil já está conectado." });
      return;
    }

    setPairingMethodModal({
      instanceId,
      instanceName: targetInstance?.name ?? "Conexão",
      forceReconnect,
    });
  };

  const generatePairing = async (
    instanceId: number,
    mode: PairingMode = "auto",
    forceReconnect = false,
  ) => {
    const targetInstance = instances.find((instance) => instance.id === instanceId) ?? null;
    const isAdminSystemReconnect = targetInstance?.purpose === "admin_system" && forceReconnect;
    if (targetInstance?.sessionStatus === "conectado" && !isAdminSystemReconnect) {
      setFeedback({ ok: true, text: "Este perfil já está conectado." });
      return;
    }

    const requestId = (pairingRequestIdRef.current += 1);
    const instanceName = targetInstance?.name ?? "Conexão";
    setPairingGuideOpen(false);
    setPairingGuidePlatform("android");
    setPairingMethodModal(null);
    setPairingModal({
      instanceId,
      instanceName,
      mode,
      loading: true,
    });
    setBusyInstanceId(instanceId);
    try {
      const response = await fetch(
        targetInstance?.purpose === "admin_system"
          ? "/api/admin/system-instance/pair"
          : `/api/bot-instances/${instanceId}/pair`,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, forceReconnect: isAdminSystemReconnect }),
        },
      );
      if (pairingRequestIdRef.current !== requestId) {
        return;
      }
      if (!response.ok) {
        const message = await parseError(response);
        if (response.status === 402) {
          setPairingMethodModal(null);
          setPairingModal(null);
          const context = buildInstanceCheckoutContext("renew", targetInstance);
          if (context && quickCheckoutRequiresPayment(context)) {
            openQuickCheckout(context);
          }
          setFeedback({ ok: false, text: message });
          return;
        }
        throw new Error(message);
      }
      const payload = (await response.json()) as { data?: PairingInfo };
      const pairingData = payload.data ?? {};
      if (pairingData.alreadyConnected) {
        closePairingModal();
        await refreshInstances();
        setFeedback({
          ok: true,
          text: isAdminSystemReconnect
            ? "A sessão antiga ainda está ativa. Desconecte no WhatsApp e tente novamente."
            : "Este perfil já está conectado.",
        });
        return;
      }
      setPairingModal({
        instanceId,
        instanceName,
        mode,
        loading: false,
        data: pairingData,
        error:
          !pairingData.linkingCode && !pairingData.qrCode
            ? "Nenhum código de pareamento foi retornado. Tente novamente em alguns segundos."
            : undefined,
      });
      await refreshInstances();
      await loadInstanceProfile(instanceId, { silent: true });
      setFeedback({
        ok: true,
        text: isAdminSystemReconnect
          ? "Sessão antiga reiniciada. Use o pareamento para conectar o novo número."
          : "Perfil iniciado e pareamento atualizado.",
      });
    } catch (error) {
      if (pairingRequestIdRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : "Erro ao gerar pareamento.";
      setPairingModal({
        instanceId,
        instanceName,
        mode,
        loading: false,
        error: message,
      });
      setFeedback({ ok: false, text: message });
    } finally {
      if (pairingRequestIdRef.current === requestId) {
        setBusyInstanceId(null);
      }
    }
  };

  const saveInstanceProfile = async (
    options: { resetAdminSession?: boolean; pairAfterSave?: boolean } = {},
  ) => {
    if (!selectedInstance) return;
    const isAdminSystemInstance = selectedInstance.purpose === "admin_system";
    const resetAdminSession = isAdminSystemInstance && options.resetAdminSession === true;
    const canManageWhatsappProfile = canManageInstanceWhatsappProfile(selectedInstance);
    setSavingInstanceProfileId(selectedInstance.id);
    try {
      const trimmedName = instanceProfileForm.displayName.trim();
      const rawPhone = instanceProfileForm.phone.trim();
      const normalizedPhone = rawPhone.replace(/\D/g, "");
      const nameChanged = Boolean(trimmedName) && trimmedName !== selectedInstance.name;
      const phoneChanged = Boolean(normalizedPhone) && normalizedPhone !== selectedInstance.phone;

      const profile = instanceProfiles[selectedInstance.id];
      const nextPushName = instanceProfileForm.pushName.trim();
      const nextStatusText = instanceProfileForm.statusText.trim();
      const pushNameChanged =
        canManageWhatsappProfile && nextPushName !== (profile?.pushName ?? "");
      const statusChanged =
        canManageWhatsappProfile && nextStatusText !== (profile?.statusText ?? "");

      if (resetAdminSession && normalizedPhone.length < 10) {
        setFeedback({ ok: false, text: "Informe o número do WhatsApp com DDI e DDD para parear outro número." });
        return;
      }

      if (!nameChanged && !phoneChanged && !pushNameChanged && !statusChanged && !resetAdminSession) {
        setFeedback({ ok: false, text: "Nenhuma alteração informada." });
        return;
      }

      if (nameChanged || phoneChanged || resetAdminSession) {
        const updatePayload: Record<string, string | boolean> = {};
        if (nameChanged) updatePayload.name = trimmedName;
        if (phoneChanged) updatePayload.phone = rawPhone;
        if (resetAdminSession) {
          updatePayload.resetSession = true;
          if (!updatePayload.name) updatePayload.name = trimmedName || selectedInstance.name;
          if (!updatePayload.phone) updatePayload.phone = rawPhone || selectedInstance.phone;
        }
        const response = await fetch(
          isAdminSystemInstance
            ? "/api/admin/system-instance"
            : `/api/bot-instances/${selectedInstance.id}`,
          {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatePayload),
          },
        );
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { instance?: BotInstance };
        if (payload.instance) {
          setInstances((current) =>
            current.map((instance) => (instance.id === payload.instance!.id ? payload.instance! : instance)),
          );
        } else {
          await refreshInstances();
        }
      }

      if (pushNameChanged || statusChanged) {
        const profilePayload: Record<string, unknown> = {};
        if (pushNameChanged) profilePayload.pushName = nextPushName;
        if (statusChanged) profilePayload.statusText = nextStatusText;

        const response = await fetch(`/api/bot-instances/${selectedInstance.id}/profile`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profilePayload),
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as { instance?: BotInstance; profile?: BotInstanceProfile };
        if (payload.instance) {
          setInstances((current) =>
            current.map((instance) => (instance.id === payload.instance!.id ? payload.instance! : instance)),
          );
        }
        if (payload.profile) {
          setInstanceProfiles((current) => ({
            ...current,
            [selectedInstance.id]: payload.profile!,
          }));
        } else {
          await loadInstanceProfile(selectedInstance.id, { silent: true });
        }
      }

      const basicsChanged = nameChanged || phoneChanged;
      const profileChanged = pushNameChanged || statusChanged;
      let message = "Dados da conexão atualizados.";
      if (!canManageWhatsappProfile && basicsChanged) {
        const basicsLabel =
          nameChanged && phoneChanged ? "Nome e número" : nameChanged ? "Nome" : "Número";
        message = `${basicsLabel} atualizado${nameChanged && phoneChanged ? "s" : ""}. Para editar perfil/foto do WhatsApp, conecte primeiro.`;
      } else if (basicsChanged && !profileChanged) {
        message = "Dados da conexão atualizados.";
      }
      setFeedback({ ok: true, text: message });
      if (options.pairAfterSave && isAdminSystemInstance) {
        await generatePairing(selectedInstance.id, "auto", true);
      }
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível salvar os dados da conexão.",
      });
    } finally {
      setSavingInstanceProfileId((current) => (current === selectedInstance.id ? null : current));
    }
  };

  const uploadInstancePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedInstance) return;
    if (!canManageInstanceWhatsappProfile(selectedInstance)) {
      event.target.value = "";
      setFeedback({
        ok: false,
        text: "Conecte e regularize esta conexão antes de alterar foto do WhatsApp.",
      });
      return;
    }
    const photo = event.target.files?.[0];
    if (!photo) return;

    setUploadingInstancePhotoId(selectedInstance.id);
    try {
      const formData = new FormData();
      formData.append("photo", photo);

      const response = await fetch(`/api/bot-instances/${selectedInstance.id}/profile`, {
        method: "PATCH",
        body: formData,
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { profile?: BotInstanceProfile };
      if (payload.profile) {
        setInstanceProfiles((current) => ({
          ...current,
          [selectedInstance.id]: payload.profile!,
        }));
      } else {
        await loadInstanceProfile(selectedInstance.id, { silent: true });
      }
      setFeedback({ ok: true, text: "Foto da conexão atualizada." });
    } catch (error) {
      setFeedback({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a foto. Use imagem JPG para o perfil.",
      });
    } finally {
      event.target.value = "";
      setUploadingInstancePhotoId((current) => (current === selectedInstance.id ? null : current));
    }
  };

  const removeInstancePhoto = async () => {
    if (!selectedInstance) return;
    if (!canManageInstanceWhatsappProfile(selectedInstance)) {
      setFeedback({
        ok: false,
        text: "Conecte e regularize esta conexão antes de remover foto do WhatsApp.",
      });
      return;
    }
    setUploadingInstancePhotoId(selectedInstance.id);
    try {
      const response = await fetch(`/api/bot-instances/${selectedInstance.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removePhoto: true }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { profile?: BotInstanceProfile };
      if (payload.profile) {
        setInstanceProfiles((current) => ({
          ...current,
          [selectedInstance.id]: payload.profile!,
        }));
      } else {
        await loadInstanceProfile(selectedInstance.id, { silent: true });
      }
      setBrokenInstanceImages((current) => {
        const next = { ...current };
        delete next[selectedInstance.id];
        return next;
      });
      setFeedback({ ok: true, text: "Foto da conexão removida." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível remover a foto da conexão.",
      });
    } finally {
      setUploadingInstancePhotoId((current) => (current === selectedInstance.id ? null : current));
    }
  };

  const createInstance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreatingInstance(true);
    try {
      const response = await fetch("/api/bot-instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: Number(instanceForm.serverId),
          name: instanceForm.name.trim(),
          phone: instanceForm.phone.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      const payload = (await response.json()) as {
        instance?: BotInstance;
        requiresInstanceAddonPayment?: boolean;
        requiresProfilePayment?: boolean;
      };
      setInstanceForm((current) => ({ ...current, name: "", phone: "" }));
      await refreshInstances();
      const createdInstance = payload.instance ?? null;
      if (createdInstance?.id) {
        setSelectedInstanceId(createdInstance.id);
      }
      advanceOnboardingFor("instances-create-submit");
      closeCreateInstanceModal();
      if (isMobileViewport) {
        setMobileView("detail");
      }
      const requiresProfilePayment =
        payload.requiresProfilePayment ?? payload.requiresInstanceAddonPayment ?? false;
      if (requiresProfilePayment && createdInstance) {
        const context = buildInstanceCheckoutContext("create", createdInstance);
        if (context && quickCheckoutRequiresPayment(context)) {
          openQuickCheckout(context);
          setFeedback({
            ok: false,
            text: "Perfil criado, mas está fora da franquia atual. Finalize o pagamento para conectar.",
          });
          return;
        }
      }
      setFeedback({ ok: true, text: "Perfil criado. Agora toque em Conectar e parear." });
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Erro ao criar perfil." });
    } finally {
      setCreatingInstance(false);
    }
  };

  const loadDiscoverableGroups = useCallback(async (instanceId: number) => {
    const response = await fetch(`/api/bot-instances/${instanceId}/groups`, { cache: "no-store" });
    if (!response.ok) throw new Error(await parseError(response));
    const payload = (await response.json()) as { groups?: DiscoverableGroupItem[] };
    return Array.isArray(payload.groups) ? payload.groups : [];
  }, []);

  const createGroupFromDiscovery = useCallback(
    async (instanceId: number, group: DiscoverableGroupItem) => {
      const response = await fetch("/api/bot-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId,
          remoteId: group.remoteId,
          invite: group.inviteLink ?? undefined,
        }),
      });
      if (!response.ok) {
        if (response.status === 409) return false;
        throw new Error(await parseError(response));
      }
      return true;
    },
    [],
  );

  const syncGroupsFromInstances = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      advanceOnboardingFor("groups-sync");
      const connectedInstances = instances.filter((instance) => instance.sessionStatus === "conectado");
      if (connectedInstances.length === 0) {
        if (!silent) {
          setFeedback({ ok: false, text: "Conecte ao menos um WhatsApp para sincronizar os grupos." });
        }
        return;
      }

      setSyncingGroups(true);
      let linkedCount = 0;
      let firstError: string | null = null;

      try {
        for (const instance of connectedInstances) {
          try {
            const discovered = await loadDiscoverableGroups(instance.id);
            for (const group of discovered) {
              if (group.linkedGroupId) continue;
              try {
                const linked = await createGroupFromDiscovery(instance.id, group);
                if (linked) linkedCount += 1;
              } catch (error) {
                if (!firstError) {
                  firstError =
                    error instanceof Error ? error.message : "Não foi possível vincular todos os grupos.";
                }
              }
            }
          } catch (error) {
            if (!firstError) {
              firstError =
                error instanceof Error ? error.message : "Não foi possível consultar os grupos dos WhatsApps conectados.";
            }
          }
        }

        await refreshGroups();
        if (!silent) {
          if (firstError && linkedCount === 0) {
            setFeedback({ ok: false, text: firstError });
          } else if (linkedCount > 0) {
            setFeedback({ ok: true, text: `${linkedCount} grupo(s) sincronizado(s) com sucesso.` });
          } else {
            setFeedback({ ok: true, text: "Todos os grupos já estavam sincronizados." });
          }
        }
      } finally {
        setSyncingGroups(false);
      }
    },
    [advanceOnboardingFor, createGroupFromDiscovery, instances, loadDiscoverableGroups, refreshGroups],
  );

	  useEffect(() => {
	    if (section !== "groups" || !selectedGroup?.id) {
	      return;
	    }
	    if (!selectedGroup.imageUrl || !brokenGroupImages[selectedGroup.id]) {
	      return;
	    }
	    const now = Date.now();
	    const lastSyncAt = groupAutoSyncTimestampsRef.current[selectedGroup.id] ?? 0;
	    if (now - lastSyncAt < 60_000) {
	      return;
	    }
	    groupAutoSyncTimestampsRef.current[selectedGroup.id] = now;
	    void syncBrokenGroupImage(selectedGroup.id, selectedGroup.imageUrl);
	  }, [brokenGroupImages, section, selectedGroup?.id, selectedGroup?.imageUrl, syncBrokenGroupImage]);

  useEffect(() => {
    if (section !== "groups" || groupTab !== "activity" || !selectedGroup?.id) {
      return;
    }

    void loadGroupActivity(selectedGroup.id);
    const intervalId = window.setInterval(() => {
      void loadGroupActivity(selectedGroup.id, { silent: true });
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [groupTab, loadGroupActivity, section, selectedGroup?.id]);

  const patchGroupConfig = useCallback((patch: Partial<GroupConfig>) => {
    if (!selectedGroup) return;
    setGroupConfigs((current) => ({
      ...current,
      [selectedGroup.id]: {
        ...(current[selectedGroup.id] ?? defaultConfig(selectedGroup)),
        ...patch,
      },
    }));
  }, [selectedGroup]);

  const ensureGroupAdminPermission = useCallback(() => {
    if (selectedGroupAllowsAdminEdits) {
      return true;
    }
    setFeedback({
      ok: false,
      text: "Esta conexão não é administradora deste grupo. Somente admins podem editar dados e foto.",
    });
    return false;
  }, [selectedGroupAllowsAdminEdits]);

  const updateGroupMeta = async (patch: Partial<typeof groupMetaDraft>) => {
    if (!selectedGroup) return;
    if (!ensureGroupAdminPermission()) return;
    const previous = { ...groupMetaDraft };
    const next = {
      adminsOnly:
        typeof patch.adminsOnly === "boolean" ? patch.adminsOnly : groupMetaDraft.adminsOnly,
      locked: typeof patch.locked === "boolean" ? patch.locked : groupMetaDraft.locked,
      ephemeral:
        typeof patch.ephemeral === "string"
          ? normalizeEphemeralValue(patch.ephemeral)
          : groupMetaDraft.ephemeral,
    };
    setGroupMetaDraft(next);
    setSavingGroupMeta(true);
    try {
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminsOnly: next.adminsOnly,
          locked: next.locked,
          ephemeral: next.ephemeral,
        }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { group?: BotGroup };
      if (payload.group) {
        setGroups((current) => current.map((entry) => (entry.id === selectedGroup.id ? payload.group! : entry)));
        patchGroupConfig({
          adminsOnly: payload.group.metadata?.adminsOnly ?? next.adminsOnly,
          locked: payload.group.metadata?.locked ?? next.locked,
        });
        setGroupMetaDraft({
          adminsOnly: payload.group.metadata?.adminsOnly ?? next.adminsOnly,
          locked: payload.group.metadata?.locked ?? next.locked,
          ephemeral: normalizeEphemeralValue(payload.group.metadata?.ephemeral),
        });
      } else {
        await refreshGroups();
      }
    } catch (error) {
      setGroupMetaDraft(previous);
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível atualizar as configurações do grupo.",
      });
    } finally {
      setSavingGroupMeta(false);
    }
  };

  const openGroupEdit = (field: GroupEditModalState["field"]) => {
    if (!selectedGroup || !selectedConfig) return;
    if (!ensureGroupAdminPermission()) return;
    setGroupEditModal({
      field,
      value: field === "name" ? selectedConfig.name : selectedConfig.description,
    });
  };

  const saveGroupEdit = async () => {
    if (!selectedGroup || !groupEditModal) return;
    if (!ensureGroupAdminPermission()) return;
    const value = groupEditModal.value.trim();
    if (groupEditModal.field === "name" && value.length < 2) {
      setFeedback({ ok: false, text: "Nome do grupo precisa ter ao menos 2 caracteres." });
      return;
    }
    setSavingGroup(true);
    try {
      const payload =
        groupEditModal.field === "name"
          ? { name: value }
          : { description: value.length > 0 ? value : null };
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await parseError(response));
      const result = (await response.json()) as { group?: BotGroup };
      if (result.group) {
        setGroups((current) =>
          current.map((entry) => (entry.id === selectedGroup.id ? result.group! : entry)),
        );
      } else {
        await refreshGroups();
      }
      patchGroupConfig(
        groupEditModal.field === "name"
          ? { name: value }
          : { description: value.length > 0 ? value : "" },
      );
      setGroupEditModal(null);
      setFeedback({ ok: true, text: "Dados do grupo atualizados." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível salvar os dados do grupo.",
      });
    } finally {
      setSavingGroup(false);
    }
  };

  const toggleParticipantSelection = (participantId: string) => {
    setSelectedParticipantIds((current) =>
      current.includes(participantId)
        ? current.filter((id) => id !== participantId)
        : [...current, participantId],
    );
  };

  const enforceDigitsRemovalFromGroup = async (groupId: number, digits: string[]) => {
    const response = await fetch(`/api/bot-groups/${groupId}/blacklist/enforce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digits }),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    const payload = (await response.json().catch(() => null)) as
      | { removed?: string[]; failed?: string[]; message?: string }
      | null;
    return {
      removed: Array.isArray(payload?.removed) ? payload!.removed : [],
      failed: Array.isArray(payload?.failed) ? payload!.failed : [],
    };
  };

  const addDigitsToBlacklistAndEnforce = async (groupId: number, digits: string[]) => {
    let settings = selectedGroupSettings;
    if (!settings || settings.groupId !== groupId) {
      settings = await loadGroupSettingsSnapshot(groupId);
    }
    const existing = Array.isArray(settings?.blacklist)
      ? settings.blacklist.map(normalizeParticipantDigits).filter(Boolean)
      : [];
    const merged = Array.from(new Set([...existing, ...digits]));
    await patchGroupSettings(groupId, { blacklist: merged });
    const removal = await enforceDigitsRemovalFromGroup(groupId, digits);
    setBlacklistDraft(merged.join("\n"));
    return {
      merged,
      removed: removal.removed,
      failed: removal.failed,
    };
  };

  const addSelectedParticipantsToBlacklist = async () => {
    if (!selectedGroup || selectedParticipantIds.length === 0) return;
    setApplyingParticipantBlacklist(true);
    try {
      const selectedDigits = Array.from(
        new Set(
          selectedParticipantIds
            .map(normalizeParticipantDigits)
            .filter((digits) => digits.length > 0),
        ),
      );
      if (selectedDigits.length === 0) {
        setFeedback({ ok: false, text: "Nenhum membro válido selecionado." });
        return;
      }
      const result = await addDigitsToBlacklistAndEnforce(selectedGroup.id, selectedDigits);
      setSelectedParticipantIds([]);
      if (result.failed.length > 0) {
        setFeedback({
          ok: true,
          text: `Blacklist atualizada. ${result.failed.length} membro(s) não puderam ser removidos agora.`,
        });
      } else {
        setFeedback({ ok: true, text: "Membros adicionados à blacklist e removidos do grupo." });
      }
      await loadGroupParticipants(selectedGroup.id, { silent: true, refresh: true });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível atualizar a blacklist de membros.",
      });
    } finally {
      setApplyingParticipantBlacklist(false);
    }
  };

  const openParticipantImportModal = useCallback(() => {
    if (!selectedGroup) return;
    if (!selectedGroupAllowsAdminEdits) {
      setFeedback({
        ok: false,
        text: "A conexão precisa ser administradora do grupo para adicionar novos membros.",
      });
      return;
    }
    if (participantImportSourceGroups.length === 0) {
      setFeedback({
        ok: false,
        text: "Nenhum grupo elegível encontrado para importar membros.",
      });
      return;
    }
    if (participantImportJobActive) {
      setParticipantImportModalOpen(true);
      return;
    }
    setParticipantImportSourceGroupId((current) =>
      current && participantImportSourceGroups.some((group) => group.id === Number(current))
        ? current
        : String(participantImportSourceGroups[0]!.id),
    );
    setParticipantImportModalOpen(true);
  }, [
    participantImportJobActive,
    participantImportSourceGroups,
    selectedGroup,
    selectedGroupAllowsAdminEdits,
  ]);

  const refreshParticipantImportJob = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const groupId = selectedGroup?.id ?? null;
      if (!groupId) {
        participantImportPollRequestRef.current += 1;
        participantImportPollInFlightRef.current = false;
        setParticipantImportJob(null);
        return null;
      }
      if (options.silent && participantImportPollInFlightRef.current) {
        return null;
      }
      const requestId = participantImportPollRequestRef.current + 1;
      participantImportPollRequestRef.current = requestId;
      participantImportPollInFlightRef.current = true;
      if (!options.silent) {
        setLoadingParticipantImportJob(true);
      }
      try {
        const response = await fetch(`/api/bot-groups/${groupId}/participants/import`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await parseError(response));
        const payload = (await response.json()) as {
          job?: unknown;
        };
        const normalized = normalizeGroupParticipantImportJob(payload.job);
        if (
          participantImportPollRequestRef.current === requestId &&
          participantImportGroupIdRef.current === groupId
        ) {
          setParticipantImportJob(normalized);
        }
        return normalized;
      } catch (error) {
        if (!options.silent) {
          setFeedback({
            ok: false,
            text:
              error instanceof Error
                ? error.message
                : "Não foi possível consultar o status da importação de membros.",
          });
        }
        return null;
      } finally {
        if (participantImportPollRequestRef.current === requestId) {
          participantImportPollInFlightRef.current = false;
        }
        if (!options.silent) {
          setLoadingParticipantImportJob(false);
        }
      }
    },
    [selectedGroup?.id],
  );

  const cancelParticipantImportJob = useCallback(
    async (jobId?: number) => {
      if (!selectedGroup?.id) return;
      setCancellingParticipantImportJob(true);
      try {
        const response = await fetch(`/api/bot-groups/${selectedGroup.id}/participants/import`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "cancel",
            jobId: jobId && Number.isFinite(jobId) ? Math.floor(jobId) : undefined,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; job?: unknown }
          | null;
        if (!response.ok) {
          const message =
            typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : await parseError(response);
          throw new Error(message);
        }
        const normalized = normalizeGroupParticipantImportJob(payload?.job);
        if (normalized) {
          setParticipantImportJob(normalized);
        }
        setFeedback({
          ok: true,
          text:
            typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : "Cancelamento solicitado para a importação de membros.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível cancelar a importação de membros.",
        });
      } finally {
        setCancellingParticipantImportJob(false);
      }
    },
    [selectedGroup?.id],
  );

  const pauseParticipantImportJob = useCallback(
    async (jobId?: number) => {
      if (!selectedGroup?.id) return;
      setUpdatingParticipantImportJob(true);
      try {
        const response = await fetch(`/api/bot-groups/${selectedGroup.id}/participants/import`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "pause",
            jobId: jobId && Number.isFinite(jobId) ? Math.floor(jobId) : undefined,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; job?: unknown }
          | null;
        if (!response.ok) {
          const message =
            typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : await parseError(response);
          throw new Error(message);
        }
        const normalized = normalizeGroupParticipantImportJob(payload?.job);
        if (normalized) {
          setParticipantImportJob(normalized);
        }
        setFeedback({
          ok: true,
          text:
            typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : "Processo pausado.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível pausar a adição de membros.",
        });
      } finally {
        setUpdatingParticipantImportJob(false);
      }
    },
    [selectedGroup?.id],
  );

  const resumeParticipantImportJob = useCallback(
    async (jobId?: number) => {
      if (!selectedGroup?.id) return;
      setUpdatingParticipantImportJob(true);
      try {
        const response = await fetch(`/api/bot-groups/${selectedGroup.id}/participants/import`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "resume",
            jobId: jobId && Number.isFinite(jobId) ? Math.floor(jobId) : undefined,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; job?: unknown }
          | null;
        if (!response.ok) {
          const message =
            typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : await parseError(response);
          throw new Error(message);
        }
        const normalized = normalizeGroupParticipantImportJob(payload?.job);
        if (normalized) {
          setParticipantImportJob(normalized);
        }
        setFeedback({
          ok: true,
          text:
            typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : "Processo retomado.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível retomar a adição de membros.",
        });
      } finally {
        setUpdatingParticipantImportJob(false);
      }
    },
    [selectedGroup?.id],
  );

  const updateParticipantImportRuntime = useCallback(
    async (jobId?: number) => {
      if (!selectedGroup?.id) return;
      setUpdatingParticipantImportJob(true);
      try {
        const response = await fetch(`/api/bot-groups/${selectedGroup.id}/participants/import`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "update",
            jobId: jobId && Number.isFinite(jobId) ? Math.floor(jobId) : undefined,
            delayMs: Number(participantImportDelayMs),
            jitterMs: Number(participantImportJitterMs),
            batchSize: Number(participantImportBatchSize),
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; job?: unknown }
          | null;
        if (!response.ok) {
          const message =
            typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : await parseError(response);
          throw new Error(message);
        }
        const normalized = normalizeGroupParticipantImportJob(payload?.job);
        if (normalized) {
          setParticipantImportJob(normalized);
        }
        setFeedback({
          ok: true,
          text:
            typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : "Ritmo atualizado.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível atualizar o ritmo da adição.",
        });
      } finally {
        setUpdatingParticipantImportJob(false);
      }
    },
    [participantImportBatchSize, participantImportDelayMs, participantImportJitterMs, selectedGroup?.id],
  );

  const importParticipantsFromAnotherGroup = useCallback(async () => {
    if (!selectedGroup) return;
    if (participantImportJobActive) {
      setFeedback({
        ok: false,
        text: "Já existe um processo em andamento para este grupo. Cancele antes de iniciar outro.",
      });
      return;
    }
    let sourceGroupId = Number.parseInt(participantImportSourceGroupId, 10);
    if ((!Number.isFinite(sourceGroupId) || sourceGroupId <= 0) && participantImportSourceGroups.length > 0) {
      sourceGroupId = participantImportSourceGroups[0]!.id;
      setParticipantImportSourceGroupId(String(sourceGroupId));
    }
    if (!Number.isFinite(sourceGroupId) || sourceGroupId <= 0) {
      setFeedback({ ok: false, text: "Selecione um grupo de origem válido." });
      return;
    }
    setImportingParticipants(true);
    try {
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/participants/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceGroupId,
          excludeAdmins: participantImportExcludeAdmins,
          delayMs: Number(participantImportDelayMs),
          jitterMs: Number(participantImportJitterMs),
          batchSize: Number(participantImportBatchSize),
          maxMembers: Number(participantImportMaxMembers),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            job?: unknown;
          }
        | null;
      if (!response.ok) {
        const message =
          typeof payload?.message === "string" && payload.message.trim()
            ? payload.message.trim()
            : await parseError(response);
        throw new Error(message);
      }
      const normalized = normalizeGroupParticipantImportJob(payload?.job);
      if (normalized) {
        setParticipantImportJob(normalized);
      }
      setParticipantImportModalOpen(false);
      setFeedback({
        ok: true,
        text:
          typeof payload?.message === "string" && payload.message.trim()
            ? payload.message.trim()
            : "Processo iniciado em background. Acompanhe o progresso em tempo real.",
      });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível importar membros agora.",
      });
    } finally {
      setImportingParticipants(false);
    }
  }, [
    participantImportJobActive,
    participantImportBatchSize,
    participantImportDelayMs,
    participantImportExcludeAdmins,
    participantImportJitterMs,
    participantImportMaxMembers,
    participantImportSourceGroups,
    participantImportSourceGroupId,
    selectedGroup,
  ]);

  useEffect(() => {
    if (!participantImportModalOpen) return;
    if (participantImportJobActive) return;
    if (participantImportSourceGroups.length === 0) return;
    if (
      participantImportSourceGroupId &&
      participantImportSourceGroups.some((group) => group.id === Number(participantImportSourceGroupId))
    ) {
      return;
    }
    setParticipantImportSourceGroupId(String(participantImportSourceGroups[0]!.id));
  }, [
    participantImportJobActive,
    participantImportModalOpen,
    participantImportSourceGroupId,
    participantImportSourceGroups,
  ]);

  useEffect(() => {
    if (section !== "groups" || !selectedGroup?.id) return;
    void refreshParticipantImportJob();
  }, [refreshParticipantImportJob, section, selectedGroup?.id]);

  useEffect(() => {
    if (section !== "groups" || !selectedGroup?.id) return;
    const intervalMs = participantImportJobActive ? 2200 : participantImportJob ? 7500 : 12000;
    const intervalId = window.setInterval(() => {
      void refreshParticipantImportJob({ silent: true });
    }, intervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    participantImportJob,
    participantImportJob?.id,
    participantImportJob?.status,
    participantImportJobActive,
    refreshParticipantImportJob,
    section,
    selectedGroup?.id,
  ]);

  useEffect(() => {
    if (!participantImportJob) return;
    if (participantImportDraftSyncJobIdRef.current === participantImportJob.id) return;
    participantImportDraftSyncJobIdRef.current = participantImportJob.id;
    setParticipantImportDelayMs(String(participantImportJob.delayMs || 6500));
    setParticipantImportJitterMs(String(participantImportJob.jitterMs || 3000));
    setParticipantImportBatchSize(String(participantImportJob.batchSize || 2));
  }, [participantImportJob]);

  useEffect(() => {
    if (!selectedGroup?.id || !participantImportJob) return;
    if (
      !(
        participantImportJob.status === "completed" ||
        participantImportJob.status === "cancelled" ||
        participantImportJob.status === "failed"
      )
    ) {
      return;
    }
    const settledKey = `${participantImportJob.id}:${participantImportJob.status}`;
    if (participantImportLastSettledRef.current === settledKey) return;
    participantImportLastSettledRef.current = settledKey;

    void Promise.all([
      loadGroupParticipants(selectedGroup.id, { silent: true, refresh: true }),
      refreshGroups().catch(() => undefined),
    ]);
  }, [loadGroupParticipants, participantImportJob, refreshGroups, selectedGroup?.id]);

  useEffect(() => {
    if (!participantImportJob) return;
    if (
      participantImportJob.status !== "completed" &&
      participantImportJob.status !== "cancelled" &&
      participantImportJob.status !== "failed"
    ) {
      return;
    }
    setCancellingParticipantImportJob(false);
    setUpdatingParticipantImportJob(false);
  }, [participantImportJob]);

  const runActivityParticipantAction = async (
    entry: GroupActivityEntry,
    mode: "remove" | "blacklist",
  ) => {
    if (!selectedGroup) return;
    const participantDigits = normalizeIdentityDigits(entry.participant ?? "");
    if (!participantDigits) {
      setFeedback({ ok: false, text: "Não foi possível identificar o número deste registro." });
      return;
    }
    const ownDigits = normalizeParticipantDigits(selectedGroup.instancePhone ?? "");
    if (participantDigits === ownDigits) {
      setFeedback({ ok: false, text: "Não é permitido aplicar esta ação no próprio número da instância." });
      return;
    }

    const busyKey = `${entry.id}:${mode}`;
    setActivityActionBusyKey(busyKey);
    try {
      if (mode === "blacklist") {
        const result = await addDigitsToBlacklistAndEnforce(selectedGroup.id, [participantDigits]);
        const failed = result.failed.includes(participantDigits);
        setFeedback({
          ok: !failed,
          text: failed
            ? "Usuário adicionado à blacklist, mas não foi possível removê-lo agora."
            : "Usuário removido e adicionado à blacklist.",
        });
      } else {
        const result = await enforceDigitsRemovalFromGroup(selectedGroup.id, [participantDigits]);
        const failed = result.failed.includes(participantDigits);
        setFeedback({
          ok: !failed,
          text: failed ? "Não foi possível remover o usuário do grupo agora." : "Usuário removido do grupo.",
        });
      }
      await loadGroupParticipants(selectedGroup.id, { silent: true, refresh: true });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível aplicar a ação para este usuário.",
      });
    } finally {
      setActivityActionBusyKey(null);
      setActivityActionMenuEntryId(null);
    }
  };

	  const setGroupActivation = useCallback(
	    async (
        active: boolean,
        explicitGroupId?: number,
        slotNumber?: number | null,
        groupOverride?: BotGroup | null,
      ) => {
		      const targetGroupId = explicitGroupId ?? selectedGroup?.id ?? null;
		      if (!targetGroupId) return;
		      const targetGroup = groupOverride ?? groups.find((group) => group.id === targetGroupId) ?? null;
	      setUpdatingGroupStatus(true);
	      try {
        const response = await fetch(`/api/bot-groups/${targetGroupId}`, {
	          method: "PATCH",
	          headers: { "Content-Type": "application/json" },
	          body: JSON.stringify({
	            status: active ? "active" : "disabled",
	            ...(active && slotNumber ? { slot: slotNumber } : {}),
	          }),
	        });
        const payload = (await response.clone().json().catch(() => null)) as
          | { message?: string; group?: BotGroup }
          | null;
        if (!response.ok) {
          const message =
            typeof payload?.message === "string" && payload.message.trim().length > 0
              ? payload.message
              : await parseError(response);
          if (response.status === 402 && active && targetGroup) {
            const checkoutContext = buildGroupCheckoutContext(targetGroup, "activate");
            if (checkoutContext) {
              openQuickCheckout(checkoutContext);
            } else {
              setFeedback({
                ok: false,
                text: "Assine um plano ativo para liberar seus grupos.",
              });
            }
            return;
          }
          throw new Error(message);
        }

        if (payload?.group) {
          setGroups((current) => current.map((group) => (group.id === targetGroupId ? payload.group! : group)));
        } else {
          setGroups((current) =>
            current.map((group) => (group.id === targetGroupId ? { ...group, status: active ? "active" : "disabled" } : group)),
          );
        }

	        await refreshGroups().catch(() => undefined);
	        setFeedback({ ok: true, text: `Grupo ${active ? "ativado" : "desativado"} com sucesso.` });
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível atualizar o status do grupo.",
        });
      } finally {
        setUpdatingGroupStatus(false);
      }
    },
    [buildGroupCheckoutContext, groups, openQuickCheckout, refreshGroups, selectedGroup?.id],
  );

		  const handleGroupActionClick = async (group: BotGroup) => {
			    const lifecycle = resolveGroupLifecycle(group);
	    if (lifecycle === "inactive" || (lifecycle === "active" && group.status !== "active")) {
	      await setGroupActivation(true, group.id, undefined, group);
	      return;
	    }
    const context = buildGroupCheckoutContext(group, lifecycle === "inactive" ? "activate" : "renew");
    if (!context) {
      setFeedback({
        ok: false,
        text: "Nenhum plano está disponível no momento.",
      });
      return;
    }
	    openQuickCheckout(context);
	  };

  const openTransferLicenseModal = (group: BotGroup) => {
    if (!isIndividualGroupLicenseActive(group)) {
      setFeedback({ ok: false, text: "Este grupo não possui assinatura ativa para transferir." });
      return;
    }
    const firstTarget = groups
      .filter((candidate) => candidate.id !== group.id && !isIndividualGroupLicenseActive(candidate))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))[0];
    setTransferLicenseModalGroupId(group.id);
    setTransferLicenseTargetGroupId(firstTarget ? String(firstTarget.id) : "");
    setTransferLicenseError(null);
  };

  const closeTransferLicenseModal = () => {
    if (transferLicenseBusy) return;
    setTransferLicenseModalGroupId(null);
    setTransferLicenseTargetGroupId("");
    setTransferLicenseError(null);
  };

  const submitTransferLicense = async () => {
    if (!transferLicenseSourceGroup) return;
    const targetGroupId = Number.parseInt(transferLicenseTargetGroupId, 10);
    if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) {
      setTransferLicenseError("Selecione o novo grupo que receberá a assinatura.");
      return;
    }
    setTransferLicenseBusy(true);
    setTransferLicenseError(null);
    try {
      const response = await fetch(`/api/bot-groups/${transferLicenseSourceGroup.id}/transfer-license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetGroupId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; sourceGroup?: BotGroup; targetGroup?: BotGroup }
        | null;
      if (!response.ok || !payload?.targetGroup) {
        throw new Error(payload?.message ?? "Não foi possível transferir a assinatura.");
      }

      setGroups((current) =>
        current.map((group) => {
          if (payload.sourceGroup && group.id === payload.sourceGroup.id) return payload.sourceGroup;
          if (payload.targetGroup && group.id === payload.targetGroup.id) return payload.targetGroup;
          return group;
        }),
      );
      await refreshGroups().catch(() => undefined);
      setSelectedGroupId(payload.targetGroup.id);
      changeSection("groups");
      setMobileView("detail");
      setFeedback({ ok: true, text: "Assinatura transferida. Abrimos o novo grupo para configuração." });
      setTransferLicenseModalGroupId(null);
      setTransferLicenseTargetGroupId("");
    } catch (error) {
      setTransferLicenseError(error instanceof Error ? error.message : "Não foi possível transferir a assinatura.");
    } finally {
      setTransferLicenseBusy(false);
    }
  };

  const resolveConversationWorkspaceGroup = async (groupId: number) => {
    let nextGroups = groups;
    if (!nextGroups.some((group) => group.id === groupId)) {
      nextGroups = await refreshGroups();
    }
    if (instances.length === 0) {
      await refreshInstances().catch(() => undefined);
    }
    const group = nextGroups.find((entry) => entry.id === groupId) ?? null;
    if (!group) {
      setFeedback({ ok: false, text: "Grupo não encontrado para esta conversa." });
    }
    return group;
  };

  const handleConversationGroupActiveToggle = async (groupId: number, active: boolean) => {
    const group = await resolveConversationWorkspaceGroup(groupId);
    if (!group) return;
    setSelectedGroupId(group.id);
    await setGroupActivation(active, group.id, undefined, group);
  };

  const handleConversationGroupLicenseTransfer = async (groupId: number) => {
    const group = await resolveConversationWorkspaceGroup(groupId);
    if (!group) return;
    setSelectedGroupId(group.id);
    openTransferLicenseModal(group);
  };

  const handleInstanceEditClick = (instance: BotInstance) => {
    setSelectedInstanceId(instance.id);
    if (section !== "instances") {
      changeSection("instances");
    }
    setProfileSwitcherOpen(false);
    if (isMobileViewport) {
      setMobileView("detail");
    }
  };

  const handleInstanceRenewClick = (instance: BotInstance) => {
    if (isAdminUser || instance.purpose === "admin_system") {
      setFeedback({ ok: true, text: "Perfil liberado para administrador, sem cobrança." });
      changeSection("instances");
      setMobileView("detail");
      return;
    }
    const context = buildInstanceCheckoutContext("renew", instance);
    if (!context) {
      setFeedback({
        ok: false,
        text: "Nenhum plano de perfil está disponível no momento.",
      });
      return;
    }
    openQuickCheckout(context);
  };

  const handleCreateProfileClick = () => {
    if (isAdminUser || hasActiveUserPlan) {
      handleOpenCreateInstanceModal();
      return;
    }
    const context = buildInstanceCheckoutContext("create");
    if (!context) {
      setFeedback({
        ok: false,
        text: "Nenhum plano de perfil está disponível no momento.",
      });
      return;
    }
    if (quickCheckoutRequiresPayment(context)) {
      openQuickCheckout(context);
      return;
    }
    handleOpenCreateInstanceModal();
  };

  const openDeleteInstanceModal = (instance: BotInstance) => {
    setFeedback({
      ok: false,
      text: "Perfis WhatsApp não podem mais ser excluídos. Desconecte o WhatsApp ou renomeie o perfil para reutilizar.",
    });
  };

  const closeDeleteInstanceModal = () => {
    if (deletingInstanceId) return;
    setInstanceDeleteModal(null);
  };

  const confirmDeleteInstance = async () => {
    if (!instanceDeleteModal) return;
    const { instanceId, linkedGroups } = instanceDeleteModal;
    const strategy = linkedGroups > 0 ? instanceDeleteModal.strategy : "delete_all";
    setDeletingInstanceId(instanceId);
    try {
      const response = await fetch(`/api/bot-instances/${instanceId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupStrategy: strategy }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível excluir a conexão.");
      }

      const refreshedInstances = await refreshInstances();
      await refreshGroups().catch(() => undefined);

      if (selectedInstanceId === instanceId) {
        const fallback = refreshedInstances[0]?.id ?? null;
        setSelectedInstanceId(fallback);
        if (isMobileViewport) {
          setMobileView(fallback ? "detail" : "list");
        }
      }

      setInstanceDeleteModal(null);
      setFeedback({
        ok: true,
        text: payload?.message ?? "Conexão excluída com sucesso.",
      });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível excluir a conexão.",
      });
    } finally {
      setDeletingInstanceId(null);
    }
  };

  const handleOpenCreateInstanceModal = () => {
    advanceOnboardingFor("instances-create");
    setIsCreateInstanceModalOpen(true);
  };

  const handleOpenCreateGroupModal = () => {
    if (connectedInstances.length === 0) {
      setFeedback({
        ok: false,
        text: "Conecte um WhatsApp Web antes de adicionar grupos por convite.",
      });
      changeSection("instances");
      return;
    }

    const preferredInstance =
      selectedInstanceId &&
      connectedInstances.some((instance) => instance.id === selectedInstanceId)
        ? selectedInstanceId
        : connectedInstances[0]?.id ?? null;

    setGroupInviteForm({
      instanceId: preferredInstance ? String(preferredInstance) : "",
      invite: "",
    });
    setIsCreateGroupModalOpen(true);
  };

  const closeCreateGroupModal = () => {
    if (creatingGroupFromInvite) return;
    setIsCreateGroupModalOpen(false);
  };

  const createGroupByInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const instanceId = Number(groupInviteForm.instanceId);
    const invite = groupInviteForm.invite.trim();

    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      setFeedback({ ok: false, text: "Selecione um WhatsApp conectado." });
      return;
    }
    if (!invite) {
      setFeedback({ ok: false, text: "Informe o link de convite do grupo." });
      return;
    }

    setCreatingGroupFromInvite(true);
    try {
      const response = await fetch("/api/bot-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId,
          invite,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const payload = (await response.json()) as { group?: BotGroup; message?: string };
      await refreshGroups();

      if (payload.group?.id) {
        setSelectedGroupId(payload.group.id);
      }
      setSelectedInstanceId(instanceId);
      setIsCreateGroupModalOpen(false);

      if (isMobileViewport) {
        setMobileView("detail");
      }

      setFeedback({
        ok: true,
        text: payload.message ?? "Grupo vinculado com sucesso.",
      });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível vincular o grupo pelo convite.",
      });
    } finally {
      setCreatingGroupFromInvite(false);
    }
  };

  const openLinkGroupModal = (group: BotGroup) => {
    if (connectedInstances.length === 0) {
      setFeedback({
        ok: false,
        text: "Conecte um WhatsApp Web antes de vincular este grupo.",
      });
      changeSection("instances");
      return;
    }
    const preferredInstance =
      selectedInstanceId && connectedInstances.some((instance) => instance.id === selectedInstanceId)
        ? selectedInstanceId
        : connectedInstances[0].id;
    setGroupLinkModal({
      groupId: group.id,
      groupName: group.name,
      instanceId: String(preferredInstance),
    });
  };

  const closeLinkGroupModal = () => {
    if (linkingGroupId) return;
    setGroupLinkModal(null);
  };

  const confirmLinkGroup = async () => {
    if (!groupLinkModal) return;
    const instanceId = Number(groupLinkModal.instanceId);
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      setFeedback({ ok: false, text: "Selecione uma conexão válida." });
      return;
    }

    setLinkingGroupId(groupLinkModal.groupId);
    try {
      const response = await fetch(`/api/bot-groups/${groupLinkModal.groupId}/instance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      await refreshGroups();
      setSelectedGroupId(groupLinkModal.groupId);
      setSelectedInstanceId(instanceId);
      setGroupFilterInstanceId(instanceId);
      setGroupLinkModal(null);
      if (isMobileViewport) {
        setMobileView("detail");
      }
      setFeedback({ ok: true, text: payload?.message ?? "Grupo vinculado com sucesso." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível vincular o grupo.",
      });
    } finally {
      setLinkingGroupId(null);
    }
  };

  const handleCreateInstanceServerFocus = () => {
    advanceOnboardingFor("instances-create-server");
  };

  const handleCreateInstanceServerChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextServerId = event.target.value;
    setInstanceForm((current) => ({ ...current, serverId: nextServerId }));
    if (nextServerId) {
      advanceOnboardingFor("instances-create-server");
    }
  };

  const handleCreateInstanceNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextName = event.target.value;
    setInstanceForm((current) => ({ ...current, name: nextName }));
    if (nextName.trim().length >= 3) {
      advanceOnboardingFor("instances-create-name");
    }
  };

  const handleCreateInstancePhoneChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextPhone = event.target.value;
    setInstanceForm((current) => ({ ...current, phone: nextPhone }));
    const phoneDigits = nextPhone.replace(/\D/g, "");
    if (phoneDigits.length >= 8) {
      advanceOnboardingFor("instances-create-phone");
    }
  };

  const copyPaymentValue = async (value: string, successText: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await navigator.clipboard.writeText(trimmed);
      setFeedback({ ok: true, text: successText });
    } catch {
      setFeedback({ ok: false, text: "Não foi possível copiar automaticamente." });
    }
  };

  const createQuickCheckout = async () => {
    if (!quickCheckoutContext) return;
    if (!quickCheckoutRequiresPayment(quickCheckoutContext)) {
      setQuickCheckoutContext(null);
      setFeedback({ ok: true, text: "Nenhum pagamento adicional é necessário para esta ação." });
      return;
    }

    const plan = planById.get(quickCheckoutContext.planId) ?? checkoutPlan;
    if (!plan) {
      setQuickCheckoutError("Nenhum plano disponível para gerar o pagamento.");
      return;
    }
    const estimatedAmount =
      (quickCheckoutContext.includePlan ? plan.price : 0) +
      quickCheckoutContext.addons.instance * plan.addonInstancePrice +
      quickCheckoutContext.addons.group * (plan.addonGroupPrice > 0 ? plan.addonGroupPrice : plan.price);
    const canUseBalanceForCheckout =
      !quickCheckoutContext.includePlan &&
      (quickCheckoutContext.mode === "group_activation" || quickCheckoutContext.mode === "group_renewal");
    const localBalanceApplied = quickCheckoutUseBalance && canUseBalanceForCheckout
      ? Math.min(Math.max(0, Number(resaleWalletBalance ?? userBalance ?? 0) || 0), estimatedAmount)
      : 0;
    const localAmountDue = Math.max(0, estimatedAmount - localBalanceApplied);
    if (localAmountDue > 0 && !availablePaymentProviders.includes(quickCheckoutProvider)) {
      setQuickCheckoutError("Selecione uma forma de pagamento disponível.");
      return;
    }

    const selections: PlanAddonSelection[] = [];
    if (quickCheckoutContext.addons.instance > 0) {
      selections.push({ type: "instance", quantity: quickCheckoutContext.addons.instance });
    }
    if (quickCheckoutContext.addons.group > 0) {
      selections.push({ type: "group", quantity: quickCheckoutContext.addons.group });
    }
    const checkoutMetadataContext = {
      mode: quickCheckoutContext.mode,
      groupId: quickCheckoutContext.groupId,
      instanceId: quickCheckoutContext.instanceId,
      activateGroupOnApproval:
        quickCheckoutContext.mode === "group_activation" ||
        quickCheckoutContext.mode === "group_renewal",
    };

    setQuickCheckoutGenerating(true);
    setQuickCheckoutError(null);
    setQuickCheckoutSuccess(null);
    setQuickCheckoutPending(null);

    try {
      const endpoint = quickCheckoutContext.includePlan
        ? "/api/user/plan/checkout"
        : "/api/user/plan/addons/checkout";
	      const body = quickCheckoutContext.includePlan
	        ? {
	            planId: plan.id,
	            provider: quickCheckoutProvider,
	            addons: selections,
	            context: checkoutMetadataContext,
	          }
	        : {
	            planId: plan.id,
	            provider: quickCheckoutProvider,
	            addons: selections,
	            subscriptionId: planStatus.subscriptionId ?? undefined,
	            addonExpiresAt: quickCheckoutContext.addonExpiresAt ?? undefined,
	            context: checkoutMetadataContext,
            useBalance: quickCheckoutUseBalance && canUseBalanceForCheckout,
	          };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as
        | { message?: string; checkout?: PlanCheckoutResponse; paidWithBalance?: boolean; balance?: number }
        | null;

      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível gerar o pagamento.");
      }
      if (data?.paidWithBalance) {
        if (typeof data.balance === "number" && Number.isFinite(data.balance)) {
          setResaleWalletBalance(data.balance);
        }
        window.dispatchEvent(new CustomEvent("bot-resale:wallet-updated"));
        setQuickCheckoutSuccess(data.message ?? "Assinatura ativada usando saldo.");
        setQuickCheckoutPending(null);
        if (quickCheckoutContext.groupId) {
          const refreshedGroups = await refreshGroups().catch(() => groups);
          const targetGroup = refreshedGroups.find((group) => group.id === quickCheckoutContext.groupId) ?? null;
          if (targetGroup) {
            setSelectedGroupId(targetGroup.id);
            changeSection("groups");
            if (isMobileViewport) {
              setMobileView("detail");
            }
          }
        } else {
          await refreshGroups().catch(() => undefined);
          await refreshInstances().catch(() => undefined);
        }
        router.refresh();
        window.setTimeout(() => {
          setQuickCheckoutContext(null);
          setQuickCheckoutSuccess(null);
          setQuickCheckoutUseBalance(false);
        }, 1300);
        return;
      }
      if (!data?.checkout) {
        throw new Error(data?.message ?? "Não foi possível gerar o pagamento.");
      }

      setQuickCheckoutPending(data.checkout);
      if (typeof data.balance === "number" && Number.isFinite(data.balance)) {
        setResaleWalletBalance(data.balance);
      }
      window.dispatchEvent(new CustomEvent("bot-resale:wallet-updated"));
    } catch (error) {
      setQuickCheckoutError(
        error instanceof Error ? error.message : "Não foi possível gerar o pagamento.",
      );
    } finally {
      setQuickCheckoutGenerating(false);
    }
  };

	  const quickCheckoutPlan = useMemo(() => {
	    if (!quickCheckoutContext) return null;
	    return planById.get(quickCheckoutContext.planId) ?? checkoutPlan;
	  }, [checkoutPlan, planById, quickCheckoutContext]);

  const quickCheckoutIsGroupLicense =
    quickCheckoutContext?.mode === "group_activation" || quickCheckoutContext?.mode === "group_renewal";
  const quickCheckoutIsProfilePlan =
    quickCheckoutContext?.mode === "instance_creation" ||
    quickCheckoutContext?.mode === "instance_renewal" ||
    quickCheckoutContext?.mode === "profile_unlimited";
  const quickCheckoutGroupUnitPrice = quickCheckoutPlan
    ? quickCheckoutPlan.addonGroupPrice > 0
      ? quickCheckoutPlan.addonGroupPrice
      : quickCheckoutPlan.price
    : 0;

  const quickCheckoutEstimatedAmount = useMemo(() => {
    if (!quickCheckoutContext || !quickCheckoutPlan) return 0;
	    const planAmount = quickCheckoutContext.includePlan ? quickCheckoutPlan.price : 0;
	    const addonAmount =
      quickCheckoutContext.addons.instance * quickCheckoutPlan.addonInstancePrice +
      quickCheckoutContext.addons.group * (quickCheckoutPlan.addonGroupPrice > 0 ? quickCheckoutPlan.addonGroupPrice : quickCheckoutPlan.price);
    return planAmount + addonAmount;
  }, [quickCheckoutContext, quickCheckoutPlan]);

  const quickCheckoutCanUseBalance = Boolean(quickCheckoutContext && !quickCheckoutContext.includePlan && quickCheckoutIsGroupLicense);
  const quickCheckoutAvailableBalance = Math.max(0, Number(resaleWalletBalance ?? userBalance ?? 0) || 0);
  const quickCheckoutBalanceApplied = quickCheckoutUseBalance && quickCheckoutCanUseBalance
    ? Math.min(quickCheckoutAvailableBalance, quickCheckoutEstimatedAmount)
    : 0;
  const quickCheckoutAmountDue = Math.max(0, quickCheckoutEstimatedAmount - quickCheckoutBalanceApplied);

  const quickCheckoutQrImageSrc = useMemo(
    () => resolveQrImageSrc(quickCheckoutPending?.qrCodeBase64),
    [quickCheckoutPending?.qrCodeBase64],
  );

  const buildActivationPayload = (key: ActivationKey, value: boolean) => {
    switch (key) {
      case "antilink":
        return { antilink: value, commandToggles: { antilink: value }, featureFlags: { bloqueiolinks: value } };
      case "antilinkgp":
        return { antilinkGroupInvite: value, commandToggles: { antilinkgp: value } };
      case "antispam":
        return { featureFlags: { antispam: value } };
      case "antipalavras":
        return { featureFlags: { antipalavras: value }, commandToggles: { antipalavras: value } };
      case "autoresposta":
        return { commandToggles: { autoresposta: value } };
      case "autosticker":
        return { commandToggles: { autosticker: value } };
      case "autodownloader":
        return { commandToggles: { autodownloader: value } };
      case "antiInactivity":
        return { antiInactivityConfig: { enabled: value } };
      case "despedida":
        return { commandToggles: { despedida: value }, farewellConfig: { enabled: value } };
      case "soadm":
        return { commandToggles: { soadm: value }, featureFlags: { soadm: value } };
      case "botinterage":
        return { commandToggles: { botinterage: value } };
      case "vozbotinterage":
        return { commandToggles: { vozbotinterage: value } };
      case "lerimagem":
        return { commandToggles: { lerimagem: value } };
      case "antisticker":
        return { commandToggles: { antisticker: value } };
      case "antimage":
        return { commandToggles: { antimage: value } };
      case "antvideo":
        return { commandToggles: { antvideo: value } };
      case "antaudio":
        return { commandToggles: { antaudio: value } };
      case "antdoc":
        return { commandToggles: { antdoc: value } };
      case "antvcard":
        return { commandToggles: { antvcard: value } };
      case "moderacaocomia":
        return { commandToggles: { moderacaocomia: value } };
      case "banextremo":
        return { banExtremo: value, commandToggles: { banextremo: value } };
      case "bangringos":
        return { commandToggles: { bangringos: value }, featureFlags: { bangringos: value } };
      case "antinsfwimagem":
        return {
          commandToggles: { antinsfwimagem: value, proibirnsfw: value },
          featureFlags: { antinsfwimagem: value, proibirnsfw: value },
        };
      case "proibirnsfw":
        return {
          commandToggles: { antinsfwimagem: value, proibirnsfw: value },
          featureFlags: { antinsfwimagem: value, proibirnsfw: value },
        };
      case "brincadeiras":
        return { commandToggles: { brincadeiras: value } };
      case "linkmembro":
        return { commandToggles: { linkmembro: value } };
      default:
        return {};
    }
  };

  const toggleActivation = async (key: ActivationKey, nextValue: boolean) => {
    if (!selectedGroup || !selectedConfig) return;
    const previous = selectedConfig[key];
    patchGroupConfig({ [key]: nextValue } as Partial<GroupConfig>);
    setSavingActivationKey(key);
    try {
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildActivationPayload(key, nextValue)),
      });
      if (!response.ok) throw new Error(await parseError(response));
      setFeedback({ ok: true, text: `${ACTIVATION_ITEMS.find((item) => item.key === key)?.label ?? "Ativação"} atualizada.` });
    } catch (error) {
      patchGroupConfig({ [key]: previous } as Partial<GroupConfig>);
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível atualizar a ativação.",
      });
    } finally {
      setSavingActivationKey(null);
    }
  };

  const applySettingsSnapshot = useCallback(
    (groupId: number, settings: BotGroupSettings) => {
      setGroupSettingsById((current) => ({
        ...current,
        [groupId]: settings,
      }));
      setGroupConfigs((current) => {
        const group = groups.find((entry) => entry.id === groupId);
        if (!group) return current;
        return {
          ...current,
          [groupId]: mapSettingsToConfig(group, settings),
        };
      });
    },
    [groups],
  );

  const patchGroupSettings = useCallback(
    async (groupId: number, payload: Record<string, unknown>) => {
      const response = await fetch(`/api/bot-groups/${groupId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await parseError(response));
      const result = (await response.json()) as { settings?: BotGroupSettings };
      if (result.settings) {
        applySettingsSnapshot(groupId, result.settings);
      }
      return result.settings ?? null;
    },
    [applySettingsSnapshot],
  );

  const persistWelcomeDraft = useCallback(
    async (draft: WelcomeDraft, options: { feedback?: boolean } = {}) => {
      if (!selectedGroup) return;
      const payload = buildWelcomeSettingsPayload(draft);
      const signature = JSON.stringify(payload);
      welcomeAutoSaveLastSignatureRef.current = signature;
      setWelcomeAutoSaving(true);
      setAutomationModalError(null);
      try {
        await patchGroupSettings(selectedGroup.id, payload);
        patchGroupConfig({ welcomeEnabled: draft.enabled, bemvindo: draft.enabled });
        if (options.feedback) {
          setFeedback({
            ok: true,
            text: draft.enabled ? "Boas-vindas ativadas." : "Boas-vindas desativadas.",
          });
        }
      } catch (error) {
        welcomeAutoSaveLastSignatureRef.current = "";
        setAutomationModalError(
          error instanceof Error ? error.message : "Não foi possível salvar as boas-vindas.",
        );
      } finally {
        setWelcomeAutoSaving(false);
      }
    },
    [patchGroupSettings, patchGroupConfig, selectedGroup],
  );

  const toggleWelcomeEnabled = () => {
    setWelcomeDraft((current) => {
      const next = { ...current, enabled: !current.enabled };
      void persistWelcomeDraft(next, { feedback: true });
      return next;
    });
  };

  const toggleWelcomeParticipantProfilePhoto = () => {
    setWelcomeDraft((current) => {
      const enabled = !current.useParticipantProfilePhoto;
      return {
        ...current,
        useParticipantProfilePhoto: enabled,
        asSticker: enabled ? false : current.asSticker,
      };
    });
  };

  const toggleWelcomeAsSticker = () => {
    setWelcomeDraft((current) => {
      const enabled = !current.asSticker;
      return {
        ...current,
        asSticker: enabled,
        useParticipantProfilePhoto: enabled ? false : current.useParticipantProfilePhoto,
      };
    });
  };

  const toggleFarewellParticipantProfilePhoto = () => {
    setFarewellDraft((current) => {
      const enabled = !current.useParticipantProfilePhoto;
      return {
        ...current,
        useParticipantProfilePhoto: enabled,
        asSticker: enabled ? false : current.asSticker,
      };
    });
  };

  const toggleFarewellAsSticker = () => {
    setFarewellDraft((current) => {
      const enabled = !current.asSticker;
      return {
        ...current,
        asSticker: enabled,
        useParticipantProfilePhoto: enabled ? false : current.useParticipantProfilePhoto,
      };
    });
  };

  useEffect(() => {
    if (automationModal !== "welcome" || !selectedGroup) {
      if (welcomeAutoSaveTimeoutRef.current !== null) {
        window.clearTimeout(welcomeAutoSaveTimeoutRef.current);
        welcomeAutoSaveTimeoutRef.current = null;
      }
      return;
    }
    const signature = JSON.stringify(buildWelcomeSettingsPayload(welcomeDraft));
    if (signature === welcomeAutoSaveLastSignatureRef.current) {
      return;
    }
    if (welcomeAutoSaveTimeoutRef.current !== null) {
      window.clearTimeout(welcomeAutoSaveTimeoutRef.current);
    }
    welcomeAutoSaveTimeoutRef.current = window.setTimeout(() => {
      welcomeAutoSaveTimeoutRef.current = null;
      void persistWelcomeDraft(welcomeDraft);
    }, 700);
    return () => {
      if (welcomeAutoSaveTimeoutRef.current !== null) {
        window.clearTimeout(welcomeAutoSaveTimeoutRef.current);
        welcomeAutoSaveTimeoutRef.current = null;
      }
    };
  }, [automationModal, persistWelcomeDraft, selectedGroup, welcomeDraft]);

  const updatePlanRenewalAccess = useCallback(
    async (nextAdminsOnly: boolean) => {
      if (!selectedGroup) return;
      setSavingPlanRenewalAccess(true);
      try {
        await patchGroupSettings(selectedGroup.id, {
          planRenewalAdminsOnly: nextAdminsOnly,
        });
        setFeedback({
          ok: true,
          text: nextAdminsOnly
            ? "Renovação restrita aos administradores neste grupo."
            : "Renovação liberada para qualquer membro neste grupo.",
        });
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error
            ? error.message
            : "Não foi possível atualizar a permissão de renovação.",
        });
      } finally {
        setSavingPlanRenewalAccess(false);
      }
    },
    [patchGroupSettings, selectedGroup],
  );

  const updateBotCoinsDraft = useCallback(
    (updater: (draft: BotGroupCoinsConfig) => void) => {
      setBotCoinsDraft((current) => {
        if (!current) return current;
        const next = cloneBotCoinsConfig(current);
        if (!next) return current;
        updater(next);
        return next;
      });
    },
    [],
  );

  const saveBotCoinsConfig = useCallback(
    async (options?: { silent?: boolean; draft?: BotGroupCoinsConfig | null }) => {
      const draft = options?.draft ?? botCoinsDraft;
      if (!selectedGroup || !draft) return false;
      setBotCoinsSaving(true);
      try {
        await patchGroupSettings(selectedGroup.id, { premium: draft.premium });
        botCoinsLastSavedRef.current = JSON.stringify(draft);
        if (!options?.silent) {
          setFeedback({ ok: true, text: "Configurações de Premium salvas." });
        }
        return true;
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível salvar o Premium.",
        });
        return false;
      } finally {
        setBotCoinsSaving(false);
      }
    },
    [botCoinsDraft, patchGroupSettings, selectedGroup],
  );

  const updatePremiumDraftAndSave = useCallback(
    async (updater: (premium: BotGroupPremiumConfig, draft: BotGroupCoinsConfig) => void) => {
      if (!botCoinsDraft) return;
      const next = cloneBotCoinsConfig(botCoinsDraft);
      if (!next) return;
      updater(next.premium, next);
      setBotCoinsDraft(next);
      await saveBotCoinsConfig({ silent: true, draft: next });
    },
    [botCoinsDraft, saveBotCoinsConfig],
  );

  const loadCoinMembers = useCallback(async () => {
    if (!selectedGroup) return;
    setCoinMembersLoading(true);
    try {
      const params = new URLSearchParams();
      if (coinMemberSearch.trim()) params.set("search", coinMemberSearch.trim());
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/coins?${params.toString()}`);
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { members?: BotGroupCoinMember[] };
      setCoinMembers(Array.isArray(payload.members) ? payload.members : []);
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível carregar os BotCoins.",
      });
    } finally {
      setCoinMembersLoading(false);
    }
  }, [coinMemberSearch, selectedGroup]);

  const loadCoinLedger = useCallback(async (memberJid?: string | null) => {
    if (!selectedGroup) return;
    setCoinLedgerLoading(true);
    try {
      const params = new URLSearchParams();
      if (memberJid) params.set("memberJid", memberJid);
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/coins/ledger?${params.toString()}`);
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { entries?: BotGroupCoinLedgerEntry[] };
      setCoinLedgerEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setCoinLedgerMember(memberJid ?? null);
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível carregar o histórico de BotCoins.",
      });
    } finally {
      setCoinLedgerLoading(false);
    }
  }, [selectedGroup]);

  const submitCoinAdjustment = useCallback(async () => {
    if (!selectedGroup || !coinAdjustModal) return;
    const delta = Number(coinAdjustValue);
    if (!Number.isFinite(delta) || delta === 0) {
      setFeedback({ ok: false, text: "Informe um valor válido para ajustar." });
      return;
    }
    try {
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/coins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberJid: coinAdjustModal.memberJid,
          delta,
          reason: coinAdjustReason || null,
        }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      setFeedback({ ok: true, text: "BotCoins ajustados com sucesso." });
      setCoinAdjustModal(null);
      setCoinAdjustValue("");
      setCoinAdjustReason("");
      await loadCoinMembers();
      if (coinLedgerMember && coinLedgerMember === coinAdjustModal.memberJid) {
        await loadCoinLedger(coinAdjustModal.memberJid);
      }
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível ajustar o BotCoins.",
      });
    }
  }, [
    coinAdjustModal,
    coinAdjustReason,
    coinAdjustValue,
    coinLedgerMember,
    loadCoinLedger,
    loadCoinMembers,
    selectedGroup,
  ]);

  const openCoinMemberModal = useCallback((member: BotGroupCoinMember) => {
    setCoinMemberModal(member);
    setCoinLedgerEntries([]);
    setCoinLedgerMember(null);
  }, []);

  const closeCoinMemberModal = useCallback(() => {
    setCoinMemberModal(null);
    setCoinLedgerEntries([]);
    setCoinLedgerMember(null);
  }, []);

  const resetCoinMember = useCallback(
    async (memberJid: string) => {
      if (!selectedGroup) return;
      const display = formatParticipantDisplay(memberJid);
      const confirmed = window.confirm(
        `Resetar ${display}? O saldo, XP, nível, histórico e itens ativos serão zerados.`,
      );
      if (!confirmed) return;
      setCoinMemberResetting(memberJid);
      try {
        const response = await fetch(`/api/bot-groups/${selectedGroup.id}/coins`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberJid, action: "reset" }),
        });
        if (!response.ok) throw new Error(await parseError(response));
        setFeedback({ ok: true, text: "Usuário resetado com sucesso." });
        await loadCoinMembers();
        if (coinLedgerMember && coinLedgerMember === memberJid) {
          await loadCoinLedger(memberJid);
        }
      } catch (error) {
        setFeedback({
          ok: false,
          text: error instanceof Error ? error.message : "Não foi possível resetar o usuário.",
        });
      } finally {
        setCoinMemberResetting(null);
      }
    },
    [coinLedgerMember, loadCoinLedger, loadCoinMembers, selectedGroup],
  );

  const openCoinAdjustModal = useCallback((memberJid: string, preset?: string | number) => {
    setCoinAdjustModal({ memberJid });
    setCoinAdjustValue(preset !== undefined ? String(preset) : "");
    setCoinAdjustReason("");
  }, []);

  const updateBotCoinsCommandCost = useCallback(
    (command: string, rawValue: string) => {
      const normalized = canonicalizeCommandText(command) || command.toLowerCase();
      updateBotCoinsDraft((draft) => {
        const sanitized = rawValue.replace(/[^\d]/g, "");
        if (!sanitized) {
          delete draft.spending.commandCosts[normalized];
          return;
        }
        const value = Math.max(0, Math.floor(Number.parseInt(sanitized, 10)));
        draft.spending.commandCosts[normalized] = value;
      });
    },
    [updateBotCoinsDraft],
  );

  const addPremiumPlan = useCallback(() => {
    updateBotCoinsDraft((draft) => {
      const plans = Array.isArray(draft.premium.plans) ? draft.premium.plans : [];
      if (plans.length >= 3) return;
      const nextIndex = plans.length + 1;
      draft.premium.plans = [
        ...plans,
        {
          key: `p${nextIndex}`,
          label: `Premium ${nextIndex}`,
          price: 100,
          durationDays: 30,
          enabled: true,
          description: "",
        },
      ];
    });
  }, [updateBotCoinsDraft]);

  const removePremiumPlan = useCallback(
    (index: number) => {
      updateBotCoinsDraft((draft) => {
        const plans = Array.isArray(draft.premium.plans) ? [...draft.premium.plans] : [];
        plans.splice(index, 1);
        draft.premium.plans = plans;
      });
    },
    [updateBotCoinsDraft],
  );

  const addBotCoinsShopItem = useCallback(() => {
    updateBotCoinsDraft((draft) => {
      if (!Array.isArray(draft.shopItems)) {
        draft.shopItems = [];
      }
      let index = draft.shopItems.length + 1;
      let key = `item${index}`;
      const existingKeys = new Set(draft.shopItems.map((item) => item.key));
      while (existingKeys.has(key)) {
        index += 1;
        key = `item${index}`;
      }
      draft.shopItems.push({
        key,
        label: "Novo item",
        icon: "🛡️",
        price: 10,
        durationDays: 3,
        uses: 3,
        type: "block",
        reflectPenalty: 2,
        reducePercent: 0,
        successBonusPercent: 0,
        stealBonusPercent: 0,
        resetTarget: false,
        description: "",
        enabled: true,
        aliases: [key],
      });
    });
  }, [updateBotCoinsDraft]);

  const removeBotCoinsShopItem = useCallback(
    (index: number) => {
      updateBotCoinsDraft((draft) => {
        if (!Array.isArray(draft.shopItems)) return;
        draft.shopItems.splice(index, 1);
      });
    },
    [updateBotCoinsDraft],
  );

  useEffect(() => {
    if (groupTab !== "premium" || !selectedGroup) {
      return;
    }
    return;
  }, [groupTab, loadCoinMembers, selectedGroup]);

  useEffect(() => {
    if (!selectedGroup || !botCoinsDraft) {
      return;
    }
    const serialized = JSON.stringify(botCoinsDraft);
    if (serialized === botCoinsLastSavedRef.current) {
      return;
    }
    if (botCoinsAutoSaveTimeoutRef.current) {
      window.clearTimeout(botCoinsAutoSaveTimeoutRef.current);
    }
    botCoinsAutoSaveTimeoutRef.current = window.setTimeout(async () => {
      const currentDraft = botCoinsDraftRef.current;
      if (!currentDraft || !selectedGroup) return;
      const currentSerialized = JSON.stringify(currentDraft);
      if (currentSerialized === botCoinsLastSavedRef.current) return;
      const ok = await saveBotCoinsConfig({ silent: true, draft: currentDraft });
      if (ok) {
        botCoinsLastSavedRef.current = currentSerialized;
      }
    }, 900);
    return () => {
      if (botCoinsAutoSaveTimeoutRef.current) {
        window.clearTimeout(botCoinsAutoSaveTimeoutRef.current);
      }
    };
  }, [botCoinsDraft, saveBotCoinsConfig, selectedGroup]);

  const loadBotInterageOptions = useCallback(
    async (groupId: number, currentModel: string, currentVoice: string) => {
      setBotInterageOptionsLoading(true);
      try {
        const [modelsResponse, voicesResponse] = await Promise.all([
          fetch(`/api/botinterage/models?groupId=${groupId}`, { cache: "no-store" }),
          fetch(`/api/botinterage/tts/voices?groupId=${groupId}`, { cache: "no-store" }),
        ]);

        if (!modelsResponse.ok) {
          throw new Error(await parseError(modelsResponse));
        }
        if (!voicesResponse.ok) {
          throw new Error(await parseError(voicesResponse));
        }

        const modelsPayload = (await modelsResponse.json().catch(() => null)) as
          | {
              mode?: "private" | "free";
              privateModels?: Array<{ id?: string; label?: string }>;
              freeModels?: Array<{ id?: string; label?: string }>;
            }
          | null;
        const voicesPayload = (await voicesResponse.json().catch(() => null)) as
          | {
              mode?: "private" | "free";
              privateVoices?: Array<{ voiceId?: string; name?: string; slug?: string | null; description?: string | null }>;
              freeVoices?: Array<{ value?: string; label?: string }>;
            }
          | null;

        const nextModelOptions: BotInterageModelOption[] = [];
        const seenModels = new Set<string>();
        const pushModel = (value: string, label: string, source: BotInterageModelOption["source"]) => {
          const normalized = value.trim();
          if (!normalized || seenModels.has(normalized)) return;
          seenModels.add(normalized);
          nextModelOptions.push({ value: normalized, label, source });
        };

        const modelMode = modelsPayload?.mode === "private" ? "private" : "free";
        setBotInterageModelMode(modelMode);
        if (botInterageAllowed) {
          pushModel(
            BOT_INTERAGE_CHATGPT_PHONE_MODEL,
            "BotInterage ChatGPT (celular + MCP)",
            "chatgpt-phone",
          );
        }
        if (Array.isArray(modelsPayload?.privateModels)) {
          for (const entry of modelsPayload.privateModels) {
            const value = typeof entry?.id === "string" ? entry.id : "";
            const label = typeof entry?.label === "string" && entry.label.trim() ? entry.label : value;
            pushModel(value, label, "private");
          }
        }
        if (Array.isArray(modelsPayload?.freeModels)) {
          for (const entry of modelsPayload.freeModels) {
            const value = typeof entry?.id === "string" ? entry.id : "";
            const label = typeof entry?.label === "string" && entry.label.trim() ? entry.label : value;
            pushModel(value, label, "free");
          }
        }

        const normalizedCurrentModel = currentModel.trim();
        if (normalizedCurrentModel && !seenModels.has(normalizedCurrentModel)) {
          pushModel(normalizedCurrentModel, `${normalizedCurrentModel} (atual)`, "current");
        }
        setBotInterageModelOptions(nextModelOptions);

        const nextVoiceOptions: BotInterageVoiceOption[] = [];
        const seenVoices = new Set<string>();
        const pushVoice = (
          value: string,
          label: string,
          source: BotInterageVoiceOption["source"],
          description?: string | null,
        ) => {
          const normalized = value.trim();
          if (!normalized || seenVoices.has(normalized)) return;
          seenVoices.add(normalized);
          nextVoiceOptions.push({ value: normalized, label, source, description: description ?? null });
        };

        const voiceMode = voicesPayload?.mode === "private" ? "private" : "free";
        setBotInterageVoiceMode(voiceMode);
        if (Array.isArray(voicesPayload?.privateVoices)) {
          for (const entry of voicesPayload.privateVoices) {
            const value = typeof entry?.voiceId === "string" ? entry.voiceId : "";
            const label = typeof entry?.name === "string" && entry.name.trim() ? entry.name : value;
            const slug = typeof entry?.slug === "string" && entry.slug.trim() ? entry.slug.trim() : "";
            const description = typeof entry?.description === "string" ? entry.description : null;
            pushVoice(value, slug ? `${label} (${slug})` : label, "private", description);
          }
        }
        if (Array.isArray(voicesPayload?.freeVoices)) {
          for (const entry of voicesPayload.freeVoices) {
            const value = typeof entry?.value === "string" ? entry.value : "";
            const label = typeof entry?.label === "string" && entry.label.trim() ? entry.label : value;
            pushVoice(value, label, "free");
          }
        }

        const normalizedCurrentVoice = currentVoice.trim();
        if (normalizedCurrentVoice && !seenVoices.has(normalizedCurrentVoice)) {
          pushVoice(normalizedCurrentVoice, `${normalizedCurrentVoice} (atual)`, "current");
        }
        setBotInterageVoiceOptions(nextVoiceOptions);
      } catch (error) {
        setBotInterageModelOptions((current) => {
          if (current.length > 0) return current;
          const fallback = currentModel.trim();
          return fallback ? [{ value: fallback, label: `${fallback} (atual)`, source: "current" }] : [];
        });
        setBotInterageVoiceOptions((current) => {
          if (current.length > 0) return current;
          const fallback = currentVoice.trim();
          return fallback ? [{ value: fallback, label: `${fallback} (atual)`, source: "current" }] : [];
        });
        setBotInterageModelMode("free");
        setBotInterageVoiceMode("free");
        setAutomationModalError(
          error instanceof Error ? error.message : "Não foi possível carregar os seletores de IA/TTS.",
        );
      } finally {
        setBotInterageOptionsLoading(false);
      }
    },
    [],
  );

  const openAutomationEditor = async (key: AutomationModalKey) => {
    if (!selectedGroup) return;
    setAutomationModalError(null);
    setAutomationModalSaving(false);
    setWelcomeEditorField(null);
    setWelcomePhoneMenuOpen(false);

    let settings = selectedGroupSettings;
    if (!settings) {
      try {
        settings = await loadGroupSettingsSnapshot(selectedGroup.id);
      } catch (error) {
        setAutomationModalError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os dados para configuração.",
        );
      }
    }

    if (settings) {
      const nextWelcomeDraft: WelcomeDraft = {
        enabled: settings.welcomeConfig.enabled || settings.commandToggles.bemvindo,
        caption: settings.welcomeConfig.caption ?? "",
        mediaUrl: resolveUploadedMediaUrl(
          settings.welcomeConfig.mediaUrl,
          settings.welcomeConfig.mediaPath,
        ),
        useParticipantProfilePhoto: settings.welcomeConfig.useParticipantProfilePhoto ?? false,
        asSticker: settings.welcomeConfig.asSticker ?? false,
        attachments: filterWelcomeExtraAttachments(
          cloneWelcomeAttachments(settings.welcomeConfig.attachments),
          settings.welcomeConfig.mediaUrl,
          settings.welcomeConfig.mediaPath,
        ),
        replyButtons: settings.welcomeConfig.replyButtons
          ? {
              ...settings.welcomeConfig.replyButtons,
              buttons: settings.welcomeConfig.replyButtons.buttons.map((button) => ({ ...button })),
            }
          : null,
      };
      welcomeAutoSaveLastSignatureRef.current = JSON.stringify(buildWelcomeSettingsPayload(nextWelcomeDraft));
      setWelcomeDraft(nextWelcomeDraft);
      const nextFarewellDraft: FarewellDraft = {
        enabled: settings.farewellConfig?.enabled || settings.commandToggles.despedida || false,
        caption: settings.farewellConfig?.caption ?? "",
        mediaUrl: resolveUploadedMediaUrl(
          settings.farewellConfig?.mediaUrl,
          settings.farewellConfig?.mediaPath,
        ),
        useParticipantProfilePhoto: settings.farewellConfig?.useParticipantProfilePhoto ?? false,
        asSticker: settings.farewellConfig?.asSticker ?? false,
        attachments: filterWelcomeExtraAttachments(
          cloneWelcomeAttachments(settings.farewellConfig?.attachments),
          settings.farewellConfig?.mediaUrl,
          settings.farewellConfig?.mediaPath,
        ),
        replyButtons: null,
      };
      setFarewellDraft(nextFarewellDraft);
      setAutoResponsesDraft(Array.isArray(settings.autoResponses) ? settings.autoResponses : []);
      setNewAutoResponseDraft(createNewAutoResponseDraft("contains"));
      setAllowedLinksDraft(Array.isArray(settings.allowedLinks) ? settings.allowedLinks.join("\n") : "");
      setBannedWordsDraft(Array.isArray(settings.bannedWords) ? settings.bannedWords.join("\n") : "");
      setModerationDraft({
        maxInfractions: String(Math.max(1, Number(settings.maxInfractions ?? 3) || 3)),
        antipalavrasMaxInfractions: String(
          Math.max(1, Number(settings.antipalavrasMaxInfractions ?? 5) || 5),
        ),
        antispamBurstLimit: String(Math.max(2, Number(settings.antispamConfig?.burstLimit ?? 5) || 5)),
        antispamBurstWindowSeconds: String(
          Math.max(2, Number(settings.antispamConfig?.burstWindowSeconds ?? 12) || 12),
        ),
        antispamResetDays: String(Math.max(1, Number(settings.antispamConfig?.infractionResetDays ?? 7) || 7)),
      });
      setBlacklistDraft(Array.isArray(settings.blacklist) ? settings.blacklist.join("\n") : "");
      setScheduleDraft({
        closeEnabled: settings.scheduleConfig.closeEnabled ?? false,
        openEnabled: settings.scheduleConfig.openEnabled ?? false,
        closeTimes: Array.isArray(settings.scheduleConfig.closeTimes)
          ? settings.scheduleConfig.closeTimes.join(", ")
          : "",
        openTimes: Array.isArray(settings.scheduleConfig.openTimes)
          ? settings.scheduleConfig.openTimes.join(", ")
          : "",
        closeMessage: settings.scheduleConfig.closeMessage ?? "",
        openMessage: settings.scheduleConfig.openMessage ?? "",
        timezone: settings.scheduleConfig.timezone ?? "",
      });
      setAntiInactivityDraft({
        enabled: settings.antiInactivityConfig?.enabled ?? false,
        days: String(Math.max(1, Number(settings.antiInactivityConfig?.days ?? 30) || 30)),
        scanIntervalHours: String(
          Math.max(1, Number(settings.antiInactivityConfig?.scanIntervalHours ?? 24) || 24),
        ),
        removeLimit: String(Math.max(1, Number(settings.antiInactivityConfig?.removeLimit ?? 20) || 20)),
      });
      setHorapgDraft({
        enabled: settings.horapgConfig.enabled ?? false,
        times: Array.isArray(settings.horapgConfig.times) ? settings.horapgConfig.times.join(", ") : "",
        imageUrl: settings.horapgConfig.imageUrl ?? "",
        mentionAll: settings.horapgConfig.mentionAll ?? false,
        timezone: settings.horapgConfig.timezone ?? "",
      });
      setBotInterageDraft({
        enabled: settings.commandToggles.botinterage ?? false,
        mentionOnly:
          settings.featureFlags?.botInterageMentionOnly === true ||
          settings.featureFlags?.iaSomenteMencao === true ||
          settings.featureFlags?.iaConversas === false,
        voiceEnabled: settings.commandToggles.vozbotinterage ?? false,
        imageEnabled: settings.commandToggles.lerimagem ?? false,
        aiPrompt: settings.aiPrompt ?? "",
        aiToolsPrompt: isAdminUser ? (settings.aiToolsPrompt ?? "") : "",
        aiModel: settings.aiModel ?? "",
        aiVoice: settings.aiVoice ?? "",
      });
      setMenuTextsDraft(buildMenuTextsDraftFromSettings(settings));
    } else {
      setMenuTextsDraft(buildMenuTextsDraftFromSettings());
      setAllowedLinksDraft("");
      setModerationDraft({
        maxInfractions: "3",
        antipalavrasMaxInfractions: "5",
        antispamBurstLimit: "5",
        antispamBurstWindowSeconds: "12",
        antispamResetDays: "7",
      });
      setAntiInactivityDraft({
        enabled: false,
        days: "30",
        scanIntervalHours: "24",
        removeLimit: "20",
      });
    }

    setAutomationModal(key);
    if (key === "botinterage") {
      void loadBotInterageOptions(
        selectedGroup.id,
        settings?.aiModel ?? "",
        settings?.aiVoice ?? "",
      );
    }
  };

  const addAutoResponseDraft = () => {
    const triggers = parseMultilineItems(newAutoResponseDraft.triggers);
    const responseText = newAutoResponseDraft.responseText.trim();
    if (triggers.length === 0 || responseText.length === 0) {
      setAutomationModalError("Informe gatilho e resposta para adicionar a autoresposta.");
      return;
    }

    const now = new Date().toISOString();
    const item: BotGroupAutoResponse = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      triggers,
      responseText,
      matchMode: newAutoResponseDraft.matchMode,
      responseMedia: newAutoResponseDraft.responseMedia,
      responseVcard: null,
      createdAt: now,
      updatedAt: now,
    };

    setAutoResponsesDraft((current) => [item, ...current]);
    setNewAutoResponseDraft(createNewAutoResponseDraft(newAutoResponseDraft.matchMode));
    setAutomationModalError(null);
  };

  const removeAutoResponseDraft = (id: string) => {
    setAutoResponsesDraft((current) => current.filter((entry) => entry.id !== id));
  };

  const uploadWelcomeMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedGroup) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setAutomationModalSaving(true);
    setAutomationModalError(null);
    try {
      const formData = new FormData();
      formData.append("media", file);

      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/welcome-media`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { settings?: BotGroupSettings };
      if (payload.settings) {
        applySettingsSnapshot(selectedGroup.id, payload.settings);
        setWelcomeDraft((current) => ({
          ...current,
          mediaUrl: resolveUploadedMediaUrl(
            payload.settings?.welcomeConfig.mediaUrl,
            payload.settings?.welcomeConfig.mediaPath,
          ),
        }));
      }
      setFeedback({ ok: true, text: "Mídia de bem-vindo enviada." });
    } catch (error) {
      setAutomationModalError(
        error instanceof Error ? error.message : "Não foi possível enviar a mídia de bem-vindo.",
      );
    } finally {
      setAutomationModalSaving(false);
      event.target.value = "";
    }
  };

  const uploadFarewellMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedGroup) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setAutomationModalSaving(true);
    setAutomationModalError(null);
    try {
      const formData = new FormData();
      formData.append("media", file);

      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/farewell-media`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { settings?: BotGroupSettings };
      if (payload.settings) {
        applySettingsSnapshot(selectedGroup.id, payload.settings);
        setFarewellDraft((current) => ({
          ...current,
          mediaUrl: resolveUploadedMediaUrl(
            payload.settings?.farewellConfig.mediaUrl,
            payload.settings?.farewellConfig.mediaPath,
          ),
        }));
      }
      setFeedback({ ok: true, text: "Mídia de saída enviada." });
    } catch (error) {
      setAutomationModalError(
        error instanceof Error ? error.message : "Não foi possível enviar a mídia de saída.",
      );
    } finally {
      setAutomationModalSaving(false);
      event.target.value = "";
    }
  };

  const uploadWelcomeAttachment = async (
    event: ChangeEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (!selectedGroup) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setAutomationModalSaving(true);
    setAutomationModalError(null);
    try {
      const currentAttachment = welcomeDraft.attachments[index] as any;
      const selectedKind = typeof currentAttachment?.kind === "string" ? currentAttachment.kind : "";
      const mediaType = selectedKind === "sticker" ? "sticker" : inferUploadMediaType(file);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mediaType", mediaType);
      if (currentAttachment?.path) {
        formData.append("previousPath", currentAttachment.path);
      }
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/welcome-attachments/upload`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as {
        media?: { path?: string; url?: string | null; mimeType?: string | null; fileName?: string | null };
      };
      const path = payload.media?.path?.trim();
      if (!path) {
        throw new Error("Retorno inválido ao salvar o anexo.");
      }
      const previewUrl =
        typeof payload.media?.url === "string" && payload.media.url.trim()
          ? payload.media.url.trim()
          : resolveUploadedMediaUrl(null, path);
      setWelcomeDraft((current) => {
        const attachments = cloneWelcomeAttachments(current.attachments);
        const previous = (attachments[index] as any) ?? {};
        attachments[index] = {
          ...previous,
          kind: mediaType,
          path,
          url: previewUrl,
          fileName: payload.media?.fileName ?? file.name,
          mimeType: payload.media?.mimeType ?? file.type ?? null,
          caption: previous.caption ?? null,
        } as any;
        return { ...current, attachments };
      });
      setFeedback({ ok: true, text: "Anexo de boas-vindas enviado." });
    } catch (error) {
      setAutomationModalError(
        error instanceof Error ? error.message : "Não foi possível enviar o anexo.",
      );
    } finally {
      setAutomationModalSaving(false);
      event.target.value = "";
    }
  };

  const patchWelcomeAttachmentDraft = (index: number, patch: Record<string, unknown>) => {
    setWelcomeDraft((current) => {
      const attachments = cloneWelcomeAttachments(current.attachments);
      attachments[index] = { ...((attachments[index] as any) ?? {}), ...patch } as any;
      return { ...current, attachments };
    });
  };

  const addWelcomeAttachmentDraft = () => {
    setWelcomeDraft((current) => ({
      ...current,
      attachments: [
        ...cloneWelcomeAttachments(current.attachments),
        { kind: "document", url: null, path: null, fileName: null, mimeType: null, caption: null },
      ],
    }));
    setWelcomeEditorField("attachments");
  };

  const removeWelcomeAttachmentDraft = (index: number) => {
    setWelcomeDraft((current) => {
      const attachments = cloneWelcomeAttachments(current.attachments);
      attachments.splice(index, 1);
      return { ...current, attachments };
    });
  };

  const moveWelcomeAttachmentDraft = (index: number, direction: "up" | "down") => {
    setWelcomeDraft((current) => {
      const attachments = cloneWelcomeAttachments(current.attachments);
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || index >= attachments.length || nextIndex < 0 || nextIndex >= attachments.length) {
        return current;
      }
      const [item] = attachments.splice(index, 1);
      attachments.splice(nextIndex, 0, item);
      return { ...current, attachments };
    });
  };

  const setWelcomeMainMessagePosition = (position: "before_attachments" | "after_attachments") => {
    setWelcomeDraft((current) => {
      if (!current.replyButtons) {
        return current;
      }
      return {
        ...current,
        replyButtons: {
          ...current.replyButtons,
          position,
          body: "",
          footer: null,
          buttons: current.replyButtons.buttons.map((button) => ({ ...button })),
        },
      };
    });
  };

  const moveWelcomeMainMessage = (direction: "up" | "down") => {
    const currentPosition =
      welcomeDraft.replyButtons?.position === "after_attachments" ? "after_attachments" : "before_attachments";
    if (direction === "down" && currentPosition === "before_attachments" && welcomeDraft.attachments.length > 0) {
      setWelcomeMainMessagePosition("after_attachments");
    }
    if (direction === "up" && currentPosition === "after_attachments") {
      setWelcomeMainMessagePosition("before_attachments");
    }
  };

  const updateWelcomeButtonsDraft = (updater: (draft: BotGroupWelcomeButtonTemplate) => void) => {
    setWelcomeDraft((current) => {
      const draft = current.replyButtons
        ? {
            ...current.replyButtons,
            buttons: current.replyButtons.buttons.map((button) => ({ ...button })),
          }
        : createWelcomeReplyButtonsTemplate();
      updater(draft);
      return { ...current, replyButtons: draft };
    });
  };

  const updateWelcomeButtonDraft = (
    index: number,
    patch: Partial<BotGroupWelcomeReplyButton>,
  ) => {
    updateWelcomeButtonsDraft((draft) => {
      const currentButton = draft.buttons[index] ?? createWelcomeReplyButton();
      draft.buttons[index] = { ...currentButton, ...patch };
    });
  };

  const updateWelcomeButtonTypeDraft = (
    index: number,
    nextType: BotGroupWelcomeReplyButton["type"],
  ) => {
    const buttons = welcomeDraft.replyButtons?.buttons ?? [];
    const lockedFamily = buttons
      .map((button, idx) => (idx === index ? null : getWelcomeButtonFamily(button.type)))
      .find((family): family is ReturnType<typeof getWelcomeButtonFamily> => Boolean(family));
    const nextFamily = getWelcomeButtonFamily(nextType);
    if (lockedFamily && lockedFamily !== nextFamily) {
      setAutomationModalError(
        `Nesta mensagem use somente ${getWelcomeButtonFamilyName(lockedFamily)}. Crie outra mensagem para outro tipo de botão.`,
      );
      return;
    }
    setAutomationModalError(null);
    updateWelcomeButtonDraft(index, { type: nextType });
  };

  const addWelcomeButtonDraft = () => {
    let nextIndex = 0;
    setWelcomeDraft((current) => {
      const draft = current.replyButtons
        ? {
            ...current.replyButtons,
            enabled: true,
            body: "",
            footer: null,
            position: current.replyButtons.position === "after_attachments" ? "after_attachments" as const : "before_attachments" as const,
            buttons: current.replyButtons.buttons.map((button) => ({ ...button })),
          }
        : createWelcomeReplyButtonsTemplate();
      draft.body = "";
      draft.footer = null;
      draft.position = draft.position === "after_attachments" ? "after_attachments" : "before_attachments";
      if (draft.buttons.length < 3) {
        nextIndex = draft.buttons.length;
        draft.buttons.push(createWelcomeReplyButton());
      } else {
        nextIndex = Math.max(0, draft.buttons.length - 1);
      }
      return { ...current, replyButtons: draft };
    });
    setWelcomeButtonEditorIndex(nextIndex);
    setWelcomeEditorField("buttons");
  };

  const removeWelcomeButtonDraft = (index: number) => {
    updateWelcomeButtonsDraft((draft) => {
      draft.buttons = draft.buttons.filter((_, idx) => idx !== index);
    });
    setWelcomeButtonEditorIndex((current) => Math.max(0, Math.min(current, index - 1)));
  };

  const openWelcomeButtonEditor = (index: number) => {
    updateWelcomeButtonsDraft((draft) => {
      draft.enabled = true;
      draft.body = "";
      draft.footer = null;
      draft.position = draft.position === "after_attachments" ? "after_attachments" : "before_attachments";
      if (!draft.buttons[index]) {
        draft.buttons[index] = createWelcomeReplyButton();
      }
    });
    setWelcomeButtonEditorIndex(index);
    setWelcomeEditorField("buttons");
  };

  const uploadAutoResponseMedia = async (
    event: ChangeEvent<HTMLInputElement>,
    autoResponseId: string,
  ) => {
    if (!selectedGroup) return;
    const file = event.target.files?.[0];
    if (!file) return;

    const previous = autoResponsesDraft.find((entry) => entry.id === autoResponseId) ?? null;
    if (!previous) return;

    setAutomationModalSaving(true);
    setAutomationModalError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mediaType", inferUploadMediaType(file));
      if (previous.responseMedia?.path) {
        formData.append("previousPath", previous.responseMedia.path);
      }

      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/auto-responses/upload`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as {
        media?: { path?: string | null; url?: string | null; fileName?: string | null; mimeType?: string | null };
      };
      if (!payload.media) {
        throw new Error("Retorno inválido ao salvar a mídia da autoresposta.");
      }

      const mediaType = inferUploadMediaType(file);
      setAutoResponsesDraft((current) =>
        current.map((entry) =>
          entry.id === autoResponseId
            ? {
                ...entry,
                responseMedia: {
                  mediaType,
                  path: payload.media?.path ?? null,
                  url: payload.media?.url ?? null,
                  fileName: payload.media?.fileName ?? file.name,
                  mimeType: payload.media?.mimeType ?? file.type ?? null,
                  caption: entry.responseMedia?.caption ?? null,
                },
                updatedAt: new Date().toISOString(),
              }
            : entry,
        ),
      );

      setFeedback({ ok: true, text: "Mídia da autoresposta enviada." });
    } catch (error) {
      setAutomationModalError(
        error instanceof Error ? error.message : "Não foi possível enviar a mídia da autoresposta.",
      );
    } finally {
      setAutomationModalSaving(false);
      event.target.value = "";
    }
  };

  const uploadNewAutoResponseMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedGroup) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setAutomationModalSaving(true);
    setAutomationModalError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mediaType", inferUploadMediaType(file));
      if (newAutoResponseDraft.responseMedia?.path) {
        formData.append("previousPath", newAutoResponseDraft.responseMedia.path);
      }

      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/auto-responses/upload`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as {
        media?: { path?: string | null; url?: string | null; fileName?: string | null; mimeType?: string | null };
      };
      if (!payload.media) {
        throw new Error("Retorno inválido ao salvar a mídia da autoresposta.");
      }

      const mediaType = inferUploadMediaType(file);
      setNewAutoResponseDraft((current) => ({
        ...current,
        responseMedia: {
          mediaType,
          path: payload.media?.path ?? null,
          url: payload.media?.url ?? null,
          fileName: payload.media?.fileName ?? file.name,
          mimeType: payload.media?.mimeType ?? file.type ?? null,
          caption: current.responseMedia?.caption ?? null,
        },
      }));
      setFeedback({ ok: true, text: "Mídia da nova autoresposta enviada." });
    } catch (error) {
      setAutomationModalError(
        error instanceof Error ? error.message : "Não foi possível enviar a mídia da autoresposta.",
      );
    } finally {
      setAutomationModalSaving(false);
      event.target.value = "";
    }
  };

  const clearAutoResponseMedia = (autoResponseId: string) => {
    setAutoResponsesDraft((current) =>
      current.map((entry) =>
        entry.id === autoResponseId
          ? { ...entry, responseMedia: null, updatedAt: new Date().toISOString() }
          : entry,
      ),
    );
  };

  const clearNewAutoResponseMedia = () => {
    setNewAutoResponseDraft((current) => ({ ...current, responseMedia: null }));
  };

  const uploadMenuBackground = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedGroup) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setAutomationModalSaving(true);
    setAutomationModalError(null);
    try {
      const formData = new FormData();
      formData.append("background", file);
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/background`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { group?: BotGroup };
      if (payload.group) {
        setGroups((current) => current.map((group) => (group.id === selectedGroup.id ? payload.group! : group)));
      } else {
        await refreshGroups().catch(() => undefined);
      }
      setFeedback({ ok: true, text: "Imagem de fundo do menu atualizada." });
    } catch (error) {
      setAutomationModalError(
        error instanceof Error ? error.message : "Não foi possível atualizar a imagem de fundo do menu.",
      );
    } finally {
      setAutomationModalSaving(false);
      event.target.value = "";
    }
  };

  const removeMenuBackground = async () => {
    if (!selectedGroup) return;

    setAutomationModalSaving(true);
    setAutomationModalError(null);
    try {
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/background`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = (await response.json()) as { group?: BotGroup };
      if (payload.group) {
        setGroups((current) => current.map((group) => (group.id === selectedGroup.id ? payload.group! : group)));
      } else {
        await refreshGroups().catch(() => undefined);
      }
      setFeedback({ ok: true, text: "Imagem de fundo do menu removida." });
    } catch (error) {
      setAutomationModalError(
        error instanceof Error ? error.message : "Não foi possível remover a imagem de fundo do menu.",
      );
    } finally {
      setAutomationModalSaving(false);
    }
  };

  const saveAutomationModal = async () => {
    if (!selectedGroup || !automationModal) return;
    setAutomationModalSaving(true);
    setAutomationModalError(null);
    try {
      if (automationModal === "welcome") {
        await patchGroupSettings(selectedGroup.id, buildWelcomeSettingsPayload(welcomeDraft));
        patchGroupConfig({ welcomeEnabled: welcomeDraft.enabled, bemvindo: welcomeDraft.enabled });
        setFeedback({ ok: true, text: "Configuração de boas-vindas atualizada." });
      } else if (automationModal === "farewell") {
        await patchGroupSettings(selectedGroup.id, buildFarewellSettingsPayload(farewellDraft));
        patchGroupConfig({
          farewellEnabled: farewellDraft.enabled,
          despedida: farewellDraft.enabled,
        });
        setFeedback({ ok: true, text: "Configuração de saída atualizada." });
      } else if (automationModal === "autoresposta") {
        const currentAutorespostaEnabled =
          selectedGroupSettings?.commandToggles.autoresposta ?? selectedConfig?.autoresposta ?? false;
        const nextAutorespostaEnabled = currentAutorespostaEnabled || autoResponsesDraft.length > 0;
        await patchGroupSettings(selectedGroup.id, {
          autoResponses: autoResponsesDraft,
          commandToggles: { autoresposta: nextAutorespostaEnabled },
        });
        patchGroupConfig({ autoresposta: nextAutorespostaEnabled });
        setFeedback({ ok: true, text: "Autorespostas atualizadas." });
      } else if (automationModal === "allowedLinks") {
        const allowedLinks = parseMultilineItems(allowedLinksDraft);
        await patchGroupSettings(selectedGroup.id, { allowedLinks });
        setAllowedLinksDraft(allowedLinks.join("\n"));
        setFeedback({ ok: true, text: "Links permitidos do antilink atualizados." });
      } else if (automationModal === "bannedWords") {
        const bannedWords = parseMultilineItems(bannedWordsDraft);
        const currentAntipalavrasEnabled =
          selectedGroupSettings?.commandToggles.antipalavras ??
          selectedGroupSettings?.featureFlags.antipalavras ??
          selectedConfig?.antipalavras ??
          false;
        const nextAntipalavrasEnabled = currentAntipalavrasEnabled || bannedWords.length > 0;
        await patchGroupSettings(selectedGroup.id, {
          bannedWords,
          featureFlags: { antipalavras: nextAntipalavrasEnabled },
          commandToggles: { antipalavras: nextAntipalavrasEnabled },
        });
        setFeedback({ ok: true, text: "Lista de palavras proibidas atualizada." });
      } else if (automationModal === "moderation") {
        const parseLimit = (value: string, fallback: number) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
          }
          return Math.min(parsed, 20);
        };
        const parseBoundedLimit = (value: string, fallback: number, min: number, max: number) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < min) {
            return fallback;
          }
          return Math.max(min, Math.min(parsed, max));
        };
        const maxInfractions = parseLimit(
          moderationDraft.maxInfractions,
          Math.max(1, Number(selectedGroupSettings?.maxInfractions ?? 3) || 3),
        );
        const antipalavrasMaxInfractions = parseLimit(
          moderationDraft.antipalavrasMaxInfractions,
          Math.max(1, Number(selectedGroupSettings?.antipalavrasMaxInfractions ?? 5) || 5),
        );
        const antispamBurstLimit = parseBoundedLimit(
          moderationDraft.antispamBurstLimit,
          Math.max(2, Number(selectedGroupSettings?.antispamConfig?.burstLimit ?? 5) || 5),
          2,
          50,
        );
        const antispamBurstWindowSeconds = parseBoundedLimit(
          moderationDraft.antispamBurstWindowSeconds,
          Math.max(2, Number(selectedGroupSettings?.antispamConfig?.burstWindowSeconds ?? 12) || 12),
          2,
          60,
        );
        const antispamResetDays = parseBoundedLimit(
          moderationDraft.antispamResetDays,
          Math.max(1, Number(selectedGroupSettings?.antispamConfig?.infractionResetDays ?? 7) || 7),
          1,
          365,
        );

        await patchGroupSettings(selectedGroup.id, {
          maxInfractions,
          antipalavrasMaxInfractions,
          antispamConfig: {
            burstLimit: antispamBurstLimit,
            burstWindowSeconds: antispamBurstWindowSeconds,
            infractionResetDays: antispamResetDays,
          },
        });
        setModerationDraft({
          maxInfractions: String(maxInfractions),
          antipalavrasMaxInfractions: String(antipalavrasMaxInfractions),
          antispamBurstLimit: String(antispamBurstLimit),
          antispamBurstWindowSeconds: String(antispamBurstWindowSeconds),
          antispamResetDays: String(antispamResetDays),
        });
        setFeedback({ ok: true, text: "Regras de infração atualizadas." });
      } else if (automationModal === "blacklist") {
        const blacklist = parseMultilineItems(blacklistDraft).map((entry) =>
          entry.replace(/\D+/g, ""),
        ).filter((entry) => entry.length > 0);
        await patchGroupSettings(selectedGroup.id, { blacklist });
        setFeedback({ ok: true, text: "Lista de bloqueio atualizada." });
      } else if (automationModal === "schedule") {
        await patchGroupSettings(selectedGroup.id, {
          scheduleConfig: {
            closeEnabled: scheduleDraft.closeEnabled,
            openEnabled: scheduleDraft.openEnabled,
            closeTimes: parseTimesText(scheduleDraft.closeTimes),
            openTimes: parseTimesText(scheduleDraft.openTimes),
            closeMessage: scheduleDraft.closeMessage.trim() || null,
            openMessage: scheduleDraft.openMessage.trim() || null,
            timezone: scheduleDraft.timezone.trim() || null,
          },
        });
        patchGroupConfig({
          scheduleCloseEnabled: scheduleDraft.closeEnabled,
          scheduleOpenEnabled: scheduleDraft.openEnabled,
          scheduleCloseTimes: scheduleDraft.closeTimes,
          scheduleOpenTimes: scheduleDraft.openTimes,
          scheduleCloseMessage: scheduleDraft.closeMessage,
          scheduleOpenMessage: scheduleDraft.openMessage,
          scheduleTimezone: scheduleDraft.timezone,
        });
        setFeedback({ ok: true, text: "Configuração de abertura e fechamento atualizada." });
      } else if (automationModal === "antiInactivity") {
        const parseBoundedInt = (value: string, fallback: number, min: number, max: number) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed)) {
            return fallback;
          }
          return Math.max(min, Math.min(max, parsed));
        };
        const days = parseBoundedInt(antiInactivityDraft.days, 30, 1, 365);
        const scanIntervalHours = parseBoundedInt(antiInactivityDraft.scanIntervalHours, 24, 1, 168);
        const removeLimit = parseBoundedInt(antiInactivityDraft.removeLimit, 20, 1, 100);
        await patchGroupSettings(selectedGroup.id, {
          antiInactivityConfig: {
            enabled: antiInactivityDraft.enabled,
            days,
            scanIntervalHours,
            removeLimit,
          },
        });
        setAntiInactivityDraft({
          enabled: antiInactivityDraft.enabled,
          days: String(days),
          scanIntervalHours: String(scanIntervalHours),
          removeLimit: String(removeLimit),
        });
        patchGroupConfig({ antiInactivity: antiInactivityDraft.enabled });
        setFeedback({ ok: true, text: "Remoção automática de inativos atualizada." });
      } else if (automationModal === "horapg") {
        await patchGroupSettings(selectedGroup.id, {
          horapgConfig: {
            enabled: horapgDraft.enabled,
            times: parseTimesText(horapgDraft.times),
            imageUrl: horapgDraft.imageUrl.trim() || null,
            mentionAll: horapgDraft.mentionAll,
            timezone: horapgDraft.timezone.trim() || null,
          },
        });
        setFeedback({ ok: true, text: "Horários pagantes atualizados." });
      } else if (automationModal === "botinterage") {
        const normalizedAiVoice = botInterageDraft.aiVoice.trim();
        await patchGroupSettings(selectedGroup.id, {
          aiPrompt: botInterageDraft.aiPrompt.trim(),
          aiToolsPrompt: isAdminUser ? botInterageDraft.aiToolsPrompt.trim() : undefined,
          aiModel: botInterageDraft.aiModel.trim() || null,
          aiVoice:
            normalizedAiVoice.length > 0 ? normalizedAiVoice : null,
          featureFlags: {
            botInterageMentionOnly: botInterageDraft.mentionOnly,
            iaSomenteMencao: botInterageDraft.mentionOnly,
            iaConversas: !botInterageDraft.mentionOnly,
          },
          commandToggles: {
            botinterage: botInterageDraft.enabled,
            vozbotinterage: botInterageDraft.voiceEnabled,
            lerimagem: botInterageDraft.imageEnabled,
          },
        });
        patchGroupConfig({
          botinterage: botInterageDraft.enabled,
          vozbotinterage: botInterageDraft.voiceEnabled,
          lerimagem: botInterageDraft.imageEnabled,
        });
        setFeedback({ ok: true, text: "Configuração do Bot Interage atualizada." });
      } else if (automationModal === "menus") {
        const menuTextsPayload = MENU_TEXT_KEYS.reduce<BotGroupMenuTexts>((acc, key) => {
          acc[key] = parseMenuLines(menuTextsDraft[key] ?? "");
          return acc;
        }, { ...DEFAULT_MENU_TEXTS });
        await patchGroupSettings(selectedGroup.id, {
          menuTexts: menuTextsPayload,
        });
        setFeedback({ ok: true, text: "Menus do bot atualizados com sucesso." });
      }

      setAutomationModal(null);
    } catch (error) {
      setAutomationModalError(
        error instanceof Error ? error.message : "Não foi possível salvar esta configuração.",
      );
    } finally {
      setAutomationModalSaving(false);
    }
  };

  const handleGroupPhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedGroup) return;
    if (!ensureGroupAdminPermission()) {
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);

      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/photo`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await parseError(response));
      await refreshGroups();
      setFeedback({ ok: true, text: "Foto do grupo atualizada com sucesso." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível atualizar a foto do grupo.",
      });
    } finally {
      event.target.value = "";
      setUploadingPhoto(false);
    }
  };

  const removeGroupPhoto = async () => {
    if (!selectedGroup) return;
    if (!ensureGroupAdminPermission()) return;
    setUploadingPhoto(true);
    try {
      const response = await fetch(`/api/bot-groups/${selectedGroup.id}/photo`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await parseError(response));
      await refreshGroups();
      setFeedback({ ok: true, text: "Foto do grupo removida com sucesso." });
    } catch (error) {
      setFeedback({
        ok: false,
        text: error instanceof Error ? error.message : "Não foi possível remover a foto do grupo.",
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const groupPrimaryLink = useMemo(
    () => extractFirstUrl(selectedConfig?.description) ?? selectedGroup?.inviteLink ?? null,
    [selectedConfig?.description, selectedGroup?.inviteLink],
  );

  const sectionTitle =
    section === "groups"
      ? "Grupos"
      : section === "instances"
        ? "Perfil WhatsApp"
        : section === "conversations"
          ? "Conversas"
          : section === "broadcasts"
            ? "Transmissões"
          : section === "flows"
            ? "Fluxos"
            : section === "affiliates"
              ? "Afiliados"
              : section === "apirest"
                ? "API REST"
                : section === "campaigns"
                  ? "Anúncios"
                  : section === "status"
                    ? "Status"
                    : "Aplicativo";
  const renderDeferredModuleLoader = (label: string) => (
    <div className={styles.moduleLoadingState} role="status" aria-live="polite">
      <IconLoader2 size={18} className={classNames(styles.spin, styles.moduleLoadingIcon)} />
      <span>Carregando dados de {label.toLowerCase()}...</span>
    </div>
  );
  const brandName = brandSiteName?.trim() || "Bot Admin";
  const renderBrandNameLabel = (textClassName?: string, neonClassName?: string) => {
    const adminMatch = brandName.match(/^(.*?)(\s*)(admin)$/i);
    if (!adminMatch) {
      return <span className={textClassName}>{brandName}</span>;
    }

    return (
      <span className={textClassName}>
        {adminMatch[1]}
        {adminMatch[2]}
        <span className={neonClassName}>Admin</span>
      </span>
    );
  };
  const rawBrandLogo = brandLogoUrl?.trim() || "/images/brand/logo/logo-icon.svg";
  const brandLogoSource = /^https?:\/\//i.test(rawBrandLogo) ? rawBrandLogo : getAssetPath(rawBrandLogo);
  const brandLogo = withCacheBust(brandLogoSource, brandUpdatedAt ?? rawBrandLogo);

  const renderProfileSwitcherAvatar = (_avatarClassName: string, imageClassName: string, fallbackClassName: string) => {
    if (selectedInstanceProfile?.avatarUrl && selectedInstance && !brokenInstanceImages[selectedInstance.id]) {
      return (
        <img
          src={withCacheBust(selectedInstanceProfile.avatarUrl, selectedInstance.updatedAt)}
          alt={selectedInstance.name}
          className={imageClassName}
          onError={() => {
            if (!selectedInstance) return;
            setBrokenInstanceImages((current) => ({ ...current, [selectedInstance.id]: true }));
            void loadInstanceProfile(selectedInstance.id, { silent: true });
          }}
        />
      );
    }

    return (
      <span className={fallbackClassName}>
        {selectedInstance ? initials(selectedInstance.name) : <IconBrandWhatsapp size={16} />}
      </span>
    );
  };

  const profileSwitcherPopoverBody = (
    <>
      <div className={styles.profileSwitcherHeader}>
        <strong>Trocar perfil</strong>
        <small>{profileUsageLabel}</small>
      </div>
      <div className={styles.profileSwitcherList}>
        {profileInstances.length === 0 ? (
          <div className={styles.profileSwitcherEmpty}>Crie um perfil para conectar um WhatsApp.</div>
        ) : (
          profileInstances.map((instance) => {
            const profile = instanceProfiles[instance.id];
            const active = selectedInstanceId === instance.id;
            return (
              <button
                key={instance.id}
                type="button"
                className={classNames(styles.profileSwitcherItem, active && styles.profileSwitcherItemActive)}
                onClick={() => switchActiveProfile(instance.id)}
              >
                {profile?.avatarUrl && !brokenInstanceImages[instance.id] ? (
                  <img
                    src={withCacheBust(profile.avatarUrl, instance.updatedAt)}
                    alt={instance.name}
                    className={styles.profileSwitcherItemAvatarImage}
                    loading="lazy"
                    onError={() => {
                      setBrokenInstanceImages((current) => ({ ...current, [instance.id]: true }));
                      void loadInstanceProfile(instance.id, { silent: true });
                    }}
                  />
                ) : (
                  <span className={styles.profileSwitcherItemAvatar}>{initials(instance.name)}</span>
                )}
                <span className={styles.profileSwitcherItemText}>
                  <strong>{instance.name}</strong>
                  <small>{instance.phone || "Sem número"}</small>
                </span>
                {active ? <IconCheck size={15} /> : null}
              </button>
            );
          })
        )}
      </div>
      <button
        type="button"
        className={styles.profileSwitcherCreate}
        onClick={() => {
          setProfileSwitcherOpen(false);
          handleCreateProfileClick();
        }}
      >
        <IconPlus size={14} />
        Novo perfil
      </button>
      <button
        type="button"
        className={styles.profileSwitcherManage}
        onClick={() => {
          setProfileSwitcherOpen(false);
          changeSection("instances");
        }}
      >
        <IconSettings size={14} />
        Gerenciar perfis
      </button>
    </>
  );

  const renderWalletHeaderButton = (compact = false) => (
    <BotAdminAffiliateWalletDropdown
      triggerClassName={classNames(
        styles.walletHeaderBtn,
        compact && styles.walletHeaderBtnCompact,
      )}
      triggerIconClassName={classNames(loadingResaleWallet && styles.spin, styles.walletHeaderIcon)}
      triggerBalanceClassName={styles.walletHeaderBalance}
      triggerBalance={resaleWalletBalance ?? 0}
      triggerIconSize={compact ? 15 : 17}
      triggerLoading={loadingResaleWallet}
      showTriggerBalance
      triggerTitle="Carteira BotAdmin"
    />
  );

  const renderGlobalRenewProfileButton = (compact = false, closeMobileMenuAfterClick = false) => {
    if (!selectedInstance) {
      return null;
    }

    return (
      <button
        type="button"
        className={classNames(
          styles.globalRenewProfileButton,
          compact && styles.globalRenewProfileButtonCompact,
        )}
        onClick={() => {
          if (closeMobileMenuAfterClick) {
            setMobileMenuOpen(false);
          }
          handleInstanceRenewClick(selectedInstance);
        }}
        disabled={busyInstanceId === selectedInstance.id}
        aria-label="Renovar perfil"
        title="Renovar perfil"
      >
        {busyInstanceId === selectedInstance.id ? (
          <IconLoader2 size={compact ? 15 : 16} className={styles.spin} />
        ) : (
          <IconCreditCard size={compact ? 15 : 16} />
        )}
        <span>Renovar perfil</span>
      </button>
    );
  };

  const mobileMenuItems: Array<{ id: Section; label: string; subtitle: string; icon: ReactNode }> = [
    { id: "conversations", label: "Conversas", subtitle: "Chats, grupos, canais e controles", icon: <IconMessages size={18} /> },
    { id: "broadcasts", label: "Transmissões", subtitle: "Listas e mensagens para contatos", icon: <IconUsersGroup size={18} /> },
    { id: "instances", label: "Perfil WhatsApp", subtitle: "Perfil ativo e pareamento", icon: <IconBrandWhatsapp size={18} /> },
    { id: "flows", label: "Fluxos", subtitle: "Automações do perfil atual", icon: <IconSparkles size={18} /> },
    { id: "affiliates", label: "Afiliados", subtitle: "Produtos e disparos", icon: <IconShoppingCart size={18} /> },
    { id: "status", label: "Status", subtitle: "Postagens e monitoramento", icon: <IconCamera size={18} /> },
    { id: "app", label: "Aplicativo", subtitle: "Baixar APK Android", icon: <IconDeviceMobile size={18} /> },
    { id: "apirest", label: "API REST", subtitle: "Chaves e endpoints", icon: <IconApi size={18} /> },
  ];

  return (
    <div className={styles.appShell}>
      <header
        className={classNames(
          styles.globalTopBar,
          isMobileViewport &&
            section === "conversations" &&
            conversationsMobileChatOpen &&
            styles.globalTopBarHiddenOnChat,
        )}
      >
        <div className={styles.globalTopBarStart}>
          {isMobileViewport ? (
            <button
              type="button"
              className={styles.mobileMenuButton}
              onClick={() => {
                setProfileSwitcherOpen(false);
                setMobileMenuOpen(true);
              }}
              aria-label="Abrir menu"
              title="Abrir menu"
            >
              <IconMenu2 size={22} />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className={styles.globalTopBarBrand}
          onClick={() => changeSection("conversations")}
          aria-label={`${brandName} — ir para conversas`}
          title="Ir para conversas"
        >
          <img src={brandLogo} alt="" className={styles.globalTopBarBrandLogo} aria-hidden="true" />
          {renderBrandNameLabel(styles.globalTopBarBrandText, styles.globalTopBarBrandNeon)}
        </button>

        <div className={styles.globalTopBarEnd}>
          {!isMobileViewport ? renderGlobalRenewProfileButton(false) : null}
          {renderWalletHeaderButton(isMobileViewport)}
          {isMobileViewport ? (
            <button
              type="button"
              className={classNames(
                styles.mobileTopProfileSwitcher,
                profileSwitcherOpen && styles.mobileTopProfileSwitcherActive,
              )}
              onClick={() => {
                setMobileMenuOpen(false);
                setProfileSwitcherOpen((open) => !open);
              }}
              aria-label="Trocar perfil WhatsApp"
              title="Trocar perfil"
              aria-expanded={profileSwitcherOpen}
            >
              {renderProfileSwitcherAvatar(
                styles.mobileTopProfileAvatar,
                styles.mobileTopProfileAvatarImage,
                styles.mobileTopProfileAvatar,
              )}
              <span
                className={classNames(
                  styles.mobileTopProfileDot,
                  selectedInstance && isConnectedInstanceStatus(selectedInstance.sessionStatus) && styles.mobileTopProfileDotOnline,
                )}
              />
            </button>
          ) : null}
        </div>
      </header>

      {isMobileViewport && profileSwitcherOpen ? (
        <button
          type="button"
          className={styles.profileSwitcherBackdrop}
          onClick={() => setProfileSwitcherOpen(false)}
          aria-label="Fechar seletor de perfil"
        />
      ) : null}
      {isMobileViewport && profileSwitcherOpen ? (
        <div className={styles.profileSwitcherPopoverMobile}>{profileSwitcherPopoverBody}</div>
      ) : null}
      {isMobileViewport && mobileMenuOpen ? (
        <button
          type="button"
          className={styles.mobileDrawerBackdrop}
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Fechar menu"
        />
      ) : null}
      {isMobileViewport ? (
        <aside className={classNames(styles.mobileDrawer, mobileMenuOpen && styles.mobileDrawerOpen)} aria-label="Menu principal">
          <header className={styles.mobileDrawerHeader}>
            <div>
              <strong>Menu do BotAdmin</strong>
              <span>{sectionTitle}</span>
            </div>
            <button
              type="button"
              className={styles.mobileDrawerClose}
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
            >
              <IconX size={18} />
            </button>
          </header>
          {selectedInstance ? (
            <div className={styles.mobileDrawerPrimaryAction}>
              {renderGlobalRenewProfileButton(false, true)}
            </div>
          ) : null}
          <nav className={styles.mobileDrawerList}>
            {mobileMenuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={classNames(styles.mobileDrawerItem, section === item.id && styles.mobileDrawerItemActive)}
                onClick={() => {
                  if (item.id === "affiliates") {
                    openBotAdminAffiliateSection();
                    return;
                  }
                  changeSection(item.id);
                }}
              >
                <span className={styles.mobileDrawerIcon}>
                  {item.icon}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.subtitle}</small>
                </span>
              </button>
            ))}
          </nav>
          <footer className={styles.mobileDrawerFooter}>
            <button type="button" onClick={() => void handleLogout()}>
              <IconLogout2 size={18} />
              <span>Sair da conta</span>
            </button>
          </footer>
        </aside>
      ) : null}

      <div
        className={classNames(
          styles.shell,
          isMobileViewport && styles.shellMobile,
          isMobileViewport &&
            section === "conversations" &&
            conversationsMobileChatOpen &&
            styles.shellMobileChatOpen,
          section === "status" && styles.shellStatusFocus,
          section === "flows" && styles.shellFlowFocus,
          section === "flows" && "botadmin-flow-root",
        )}
      >
      <aside className={classNames(styles.rail, section === "flows" && styles.railHidden)}>
        <div className={styles.profileSwitcher}>
          <button
            type="button"
            className={classNames(styles.profileSwitcherButton, profileSwitcherOpen && styles.profileSwitcherButtonActive)}
            onClick={() => setProfileSwitcherOpen((open) => !open)}
            title="Trocar perfil WhatsApp"
            aria-label="Trocar perfil WhatsApp"
            aria-expanded={profileSwitcherOpen}
          >
            {renderProfileSwitcherAvatar(
              styles.profileSwitcherAvatar,
              styles.profileSwitcherAvatarImage,
              styles.profileSwitcherAvatar,
            )}
            <span
              className={classNames(
                styles.profileSwitcherDot,
                selectedInstance && isConnectedInstanceStatus(selectedInstance.sessionStatus) && styles.profileSwitcherDotOnline,
              )}
            />
          </button>
          {profileSwitcherOpen && !isMobileViewport ? (
            <div className={styles.profileSwitcherPopover}>{profileSwitcherPopoverBody}</div>
          ) : null}
        </div>
        <button
          type="button"
          className={classNames(styles.railBtn, quickActionsOpen && styles.railBtnActive)}
          onClick={() => setQuickActionsOpen((open) => !open)}
          title="Ações rápidas"
          aria-label="Ações rápidas"
          aria-expanded={quickActionsOpen}
        >
          <IconPlus size={19} />
        </button>
        <button
          className={classNames(styles.railBtn, section === "instances" && styles.railBtnActive)}
          onClick={() => changeSection("instances")}
          title="Perfil WhatsApp"
        >
          <IconBrandWhatsapp size={18} />
        </button>
        <button
          className={classNames(styles.railBtn, section === "conversations" && styles.railBtnActive)}
          onClick={() => changeSection("conversations")}
          title="Conversas"
        >
          <IconMessages size={18} />
        </button>
        <button
          className={classNames(styles.railBtn, section === "broadcasts" && styles.railBtnActive)}
          onClick={() => changeSection("broadcasts")}
          title="Transmissões"
        >
          <IconUsersGroup size={18} />
        </button>
        <button
          className={classNames(styles.railBtn, section === "flows" && styles.railBtnActive)}
          onClick={() => changeSection("flows")}
          title="Fluxos"
        >
          <IconSparkles size={18} />
        </button>
        <button
          className={classNames(styles.railBtn, section === "affiliates" && styles.railBtnActive)}
          onClick={openBotAdminAffiliateSection}
          title="Bot Admin afiliados"
        >
          <IconShoppingCart size={18} />
        </button>
        <button
          className={classNames(styles.railBtn, section === "status" && styles.railBtnActive)}
          onClick={() => changeSection("status")}
          title="Status"
        >
          <IconCamera size={18} />
        </button>
        <button
          className={classNames(styles.railBtn, section === "app" && styles.railBtnActive)}
          onClick={() => changeSection("app")}
          title="Aplicativo"
        >
          <IconDeviceMobile size={18} />
        </button>
        <button
          className={classNames(styles.railBtn, section === "apirest" && styles.railBtnActive)}
          onClick={() => changeSection("apirest")}
          title="API REST"
        >
          <IconApi size={18} />
        </button>
        <button
          type="button"
          className={styles.railFooter}
          onClick={() => void handleLogout()}
          title="Sair"
        >
          <IconLogout2 size={16} />
        </button>
      </aside>

      <section
        className={classNames(
          styles.leftPane,
          section === "status" && styles.leftPaneStatusHidden,
          section === "flows" && styles.leftPaneStatusHidden,
          section === "conversations" && styles.leftPaneStatusHidden,
          showMobileDetailPane && styles.mobilePaneHidden,
        )}
      >
        <header className={styles.paneHeader}>
          <div className={styles.paneHeaderTitles}>
            <h2>{sectionTitle}</h2>
          </div>
          <div className={styles.headerActions}>
            {section === "groups" ? (
              <>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={handleOpenCreateGroupModal}
                  title="Adicionar grupo por link de convite"
                >
                  <IconLink size={14} />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => void syncGroupsFromInstances()}
                  title="Sincronizar grupos"
                  disabled={syncingGroups}
                >
                  {syncingGroups ? <IconLoader2 size={14} className={styles.spin} /> : <IconRefresh size={14} />}
                </button>
              </>
            ) : null}
            {section === "campaigns" ? (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setCampaignRefreshRequestKey((current) => current + 1)}
                title="Atualizar campanhas"
              >
                <IconRefresh size={14} />
              </button>
            ) : null}
            {section === "campaigns" ? (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => {
                  setSelectedCampaignId(null);
                  setCampaignCreateRequestKey((current) => current + 1);
                  if (isMobileViewport) {
                    setMobileView("detail");
                  }
                }}
                title="Nova campanha"
              >
                <IconPlus size={14} />
              </button>
            ) : null}
            {section === "affiliates" ? (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => void refreshAffiliateProviders()}
                title="Atualizar integrações de afiliados"
                disabled={loadingAffiliateProviders}
              >
                {loadingAffiliateProviders ? (
                  <IconLoader2 size={14} className={styles.spin} />
                ) : (
                  <IconRefresh size={14} />
                )}
              </button>
            ) : null}
          </div>
        </header>

        {section === "instances" ? (
          <div className={styles.instanceManageToolbar}>
            <span className={styles.instanceManageToolbarMeta}>{profileUsageLabel}</span>
            <button
              type="button"
              className={styles.instanceManageCreateBtn}
              onClick={handleCreateProfileClick}
            >
              <IconPlus size={14} />
              Novo perfil
            </button>
          </div>
        ) : null}

        {section === "groups" || section === "affiliates" || section === "campaigns" ? (
          <label className={styles.searchBox}>
            <IconSearch size={14} />
            <input
              value={
                section === "groups"
                  ? groupSearch
                  : section === "affiliates"
                      ? affiliateSearch
                      : campaignSearch
              }
              onChange={(event) => {
                if (section === "groups") {
                  setGroupSearch(event.target.value);
                  return;
                }
                if (section === "affiliates") {
                  setAffiliateSearch(event.target.value);
                  return;
                }
                setCampaignSearch(event.target.value);
              }}
              placeholder={
                section === "groups"
                  ? "Pesquisar grupos"
                  : section === "affiliates"
                      ? "Pesquisar afiliados e plataformas"
                      : "Pesquisar campanhas"
              }
            />
          </label>
        ) : null}

        {section === "groups" ? (
          <label className={styles.instanceSelector}>
            <span className={styles.instanceSelectorLabel}>
              <IconBrandWhatsapp size={14} />
              WhatsApp selecionado
            </span>
            <select
              value={groupFilterInstanceId === null ? "" : String(groupFilterInstanceId)}
              onChange={(event) => {
                const raw = event.target.value;
                if (!raw) {
                  setGroupFilterInstanceId(null);
                  return;
                }
                const parsed = Number(raw);
                setGroupFilterInstanceId(Number.isFinite(parsed) ? parsed : null);
              }}
              disabled={instances.length === 0}
            >
              {instances.length === 0 ? (
                <option value="">Sem WhatsApps conectados</option>
              ) : (
                <>
                  <option value="">Todos os WhatsApps</option>
                  {hasOrphanGroups ? <option value="0">Sem conexão vinculada</option> : null}
                </>
              )}
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className={styles.listArea}>
        {section === "groups"
            ? filteredGroups.map((group) => {
	                const isOrphanGroup = group.instanceId <= 0;
	                const groupLifecycle = resolveGroupLifecycle(group);
	                const groupExpiryInfo = resolveGroupExpiryInfo(group);
	                const showGroupRowAction = groupLifecycle === "active" && group.status !== "active";
	                return (
                <div
                  key={group.id}
                  className={classNames(
                    styles.listItemRow,
                    styles.listItemRowGroup,
                    selectedGroupId === group.id && styles.listItemRowActive,
                  )}
                >
                  <button
                    type="button"
                    className={classNames(styles.listItem, styles.listItemMain, selectedGroupId === group.id && styles.listItemActive)}
                    onClick={() => {
                      setSelectedGroupId(group.id);
                      if (isMobileViewport) {
                        setMobileView("detail");
                      }
                    }}
                  >
                    {group.imageUrl && !brokenGroupImages[group.id] ? (
                      <img
                        src={group.imageUrl}
                        alt={group.name}
                        className={styles.avatarImage}
                        loading="lazy"
	                        onError={() => handleGroupImageError(group.id, group.imageUrl)}
                      />
                    ) : (
                      <div className={styles.avatar}>{initials(group.name)}</div>
                    )}
                    <div className={styles.listText}>
                      <div className={styles.nameLine}>
                        <span className={styles.groupName}>{group.name}</span>
                      </div>
                      <div className={styles.metaLine}>
                        <span>{group.instanceName}</span>
                        <span className={styles.metaBadges}>
                          <span
                            className={classNames(
                              styles.tierBadge,
                              groupLifecycle === "active"
                                ? styles.tierBadgeVip
                                : groupLifecycle === "expired"
                                  ? styles.tierBadgeExpired
                                  : styles.tierBadgeDefault,
                            )}
                          >
                            {groupLifecycle === "active" ? (
                              <IconCrown size={12} className={styles.tierCrownIcon} />
                            ) : null}
                            {groupTierLabel(group)}
                          </span>
                          {groupExpiryInfo ? (
                            <span
                              className={classNames(
                                styles.expiryBadge,
                                groupExpiryInfo.tone === "success"
                                  ? styles.expiryBadgeSuccess
                                  : groupExpiryInfo.tone === "warning"
                                    ? styles.expiryBadgeWarning
                                    : styles.expiryBadgeDanger,
                              )}
                              title={groupExpiryInfo.detailText}
                            >
                              {groupExpiryInfo.badgeText}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  </button>
	                  {isOrphanGroup ? (
	                    <button
	                      type="button"
	                      className={classNames(styles.listItemAction, styles.listItemActionCompact, styles.listItemActionPrimary)}
                      onClick={() => openLinkGroupModal(group)}
                    >
                      Vincular
                    </button>
	                  ) : showGroupRowAction ? (
	                    <button
	                      type="button"
	                      className={classNames(
	                        styles.listItemAction,
	                        styles.listItemActionCompact,
	                        resolveGroupLifecycle(group) === "inactive" ? styles.listItemActionPrimary : styles.listItemActionGhost,
	                      )}
                      onClick={() => void handleGroupActionClick(group)}
                      disabled={updatingGroupStatus}
	                    >
	                      {groupActionLabel(group)}
	                    </button>
	                  ) : null}
                </div>
              );
            })
            : null}
          {section === "groups" && filteredGroups.length === 0 ? (
            <article className={styles.moduleHintCard}>
              <strong>Nenhum grupo neste WhatsApp</strong>
              <p>Troque o WhatsApp selecionado ou sincronize os grupos para atualizar a lista.</p>
            </article>
          ) : null}
          {section === "instances"
            ? profileInstances.map((instance) => {
                const profile = instanceProfiles[instance.id];
                const active = selectedInstanceId === instance.id;
                return (
                  <button
                    key={instance.id}
                    type="button"
                    className={classNames(styles.instanceManageRow, active && styles.instanceManageRowActive)}
                    onClick={() => handleInstanceEditClick(instance)}
                  >
                    {profile?.avatarUrl && !brokenInstanceImages[instance.id] ? (
                      <img
                        src={withCacheBust(profile.avatarUrl, instance.updatedAt)}
                        alt={instance.name}
                        className={styles.instanceManageRowAvatar}
                        loading="lazy"
                        onError={() => {
                          setBrokenInstanceImages((current) => ({ ...current, [instance.id]: true }));
                          void loadInstanceProfile(instance.id, { silent: true });
                        }}
                      />
                    ) : (
                      <span className={styles.instanceManageRowAvatarFallback}>
                        <IconBrandWhatsapp size={16} />
                      </span>
                    )}
                    <span className={styles.instanceManageRowText}>
                      <strong>{instance.name}</strong>
                      <small>{instance.phone || "Sem número"}</small>
                    </span>
                    <IconChevronRight size={16} className={styles.instanceManageRowChevron} />
                  </button>
                );
              })
            : null}
          {section === "affiliates" && botAdminAffiliateVisible ? (
            <div
              className={classNames(
                styles.listItemRow,
                styles.listItemRowInstance,
                selectedAffiliateProviderKey === BOT_ADMIN_AFFILIATE_PROVIDER_KEY && styles.listItemRowActive,
              )}
            >
              <button
                type="button"
                className={classNames(
                  styles.listItem,
                  styles.listItemMain,
                  selectedAffiliateProviderKey === BOT_ADMIN_AFFILIATE_PROVIDER_KEY && styles.listItemActive,
                )}
                onClick={() => {
                  setSelectedAffiliateProviderKey(BOT_ADMIN_AFFILIATE_PROVIDER_KEY);
                  setAffiliateTab("dispatch");
                  if (isMobileViewport) {
                    setMobileView("detail");
                  }
                }}
              >
                <img
                  src={brandLogo}
                  alt={brandName}
                  className={classNames(styles.avatarImage, styles.providerLogoAvatar)}
                />
                <div className={styles.listText}>
                  <strong>Bot Admin afiliados</strong>
                  <div className={styles.instanceMetaLine}>
                    <span>Indicação profissional</span>
                    <span className={classNames(styles.instanceStatusTag, styles.instanceStatusConnected)}>
                      Nativo
                    </span>
                  </div>
                  <small className={styles.instanceExpiryText}>
                    Link fixo, comissões e divulgação automática nos grupos.
                  </small>
                </div>
              </button>
            </div>
          ) : null}
          {section === "affiliates"
            ? filteredAffiliateProviders.map((provider) => (
                <div
                  key={provider.provider}
                  className={classNames(
                    styles.listItemRow,
                    styles.listItemRowInstance,
                    selectedAffiliateProvider?.provider === provider.provider && styles.listItemRowActive,
                  )}
                >
                  <button
                    type="button"
                    className={classNames(
                      styles.listItem,
                      styles.listItemMain,
                      selectedAffiliateProvider?.provider === provider.provider && styles.listItemActive,
                    )}
                    onClick={() => {
                      setSelectedAffiliateProviderKey(provider.provider);
                      if (isMobileViewport) {
                        setMobileView("detail");
                      }
                    }}
                  >
                    {provider.logoUrl ? (
                      <img
                        src={withCacheBust(
                          resolveProviderLogoUrl(provider.logoUrl) || provider.logoUrl,
                          provider.updatedAt ?? provider.provider,
                        )}
                        alt={`Logo ${provider.label}`}
                        className={classNames(styles.avatarImage, styles.providerLogoAvatar)}
                      />
                    ) : (
                      <div className={styles.avatar}>
                        <IconShoppingCart size={14} />
                      </div>
                    )}
                    <div className={styles.listText}>
                      <strong>{provider.label}</strong>
                      <div className={styles.instanceMetaLine}>
                        <span>{provider.connected ? provider.accountName || "Conta conectada" : "Conta não conectada"}</span>
                        <span
                          className={classNames(
                            styles.instanceStatusTag,
                            provider.connected ? styles.instanceStatusConnected : styles.instanceStatusDisconnected,
                          )}
                        >
                          {provider.connected
                            ? "Conectado"
                            : resolveAffiliateProviderStatusLabel(provider)}
                        </span>
                      </div>
                      <small className={styles.instanceExpiryText}>
                        {provider.connected
                          ? `Atualizado em: ${provider.updatedAt ? formatDateTime(provider.updatedAt) : "agora"}`
                          : provider.description}
                      </small>
                    </div>
                  </button>
                </div>
              ))
            : null}
          {section === "campaigns"
            ? filteredCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className={classNames(
                    styles.listItemRow,
                    styles.listItemRowInstance,
                    selectedCampaignId === campaign.id && styles.listItemRowActive,
                  )}
                >
                  <button
                    type="button"
                    className={classNames(
                      styles.listItem,
                      styles.listItemMain,
                      selectedCampaignId === campaign.id && styles.listItemActive,
                    )}
                    onClick={() => {
                      setSelectedCampaignId(campaign.id);
                      if (isMobileViewport) {
                        setMobileView("detail");
                      }
                    }}
                  >
                    <div className={styles.avatar}>
                      <IconSpeakerphone size={14} />
                    </div>
                    <div className={styles.listText}>
                      <strong>{campaign.name || "Campanha sem nome"}</strong>
                      <div className={styles.instanceMetaLine}>
                        <span
                          className={classNames(
                            styles.instanceStatusTag,
                            campaign.status === "running" || campaign.status === "scheduled"
                              ? styles.instanceStatusConnected
                              : styles.instanceStatusDisconnected,
                          )}
                        >
                          {campaign.status}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              ))
            : null}
          {section === "instances" && instances.length === 0 ? (
            <article className={styles.moduleHintCard}>
              <strong>Nenhum perfil WhatsApp criado</strong>
              <p>Crie seu primeiro perfil para abrir o QR Code ou código de pareamento do WhatsApp.</p>
              <button type="button" className={styles.primaryButton} onClick={handleCreateProfileClick}>
                <IconPlus size={14} />
                Criar perfil e conectar WhatsApp
              </button>
            </article>
          ) : null}
          {section === "instances" && instances.length === 0 ? (
            <article className={classNames(styles.moduleHintCard, styles.featureShowcaseCard)}>
              <strong>Mais que conexão: automação profissional completa para WhatsApp</strong>
              <p>
                O Bot Admin já entra pronto para operação pesada, com recursos avançados de moderação,
                automação e distribuição de conteúdo.
              </p>
              <ul className={styles.featureShowcaseList}>
                {INSTANCE_CAPABILITY_HIGHLIGHTS.map((item) => (
                  <li key={item}>
                    <IconCheck size={13} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
          {section === "affiliates" && affiliateProviders.length === 0 && !botAdminAffiliateVisible ? (
            <article className={styles.moduleHintCard}>
              <strong>Carregando integrações de afiliados</strong>
              <p>Atualizando provedores disponíveis para conexão.</p>
            </article>
          ) : null}
          {section === "affiliates" && affiliateProviders.length > 0 && filteredAffiliateProviders.length === 0 && !botAdminAffiliateVisible ? (
            <article className={styles.moduleHintCard}>
              <strong>Nenhuma plataforma encontrada</strong>
              <p>Ajuste a busca para localizar a integração desejada.</p>
            </article>
          ) : null}
          {section === "campaigns" && filteredCampaigns.length === 0 ? (
            <article className={styles.moduleHintCard}>
              <strong>Nenhuma campanha encontrada</strong>
              <p>Crie uma nova campanha para começar.</p>
            </article>
          ) : null}
          {section === "apirest"
            ? (
                <article className={styles.moduleHintCard}>
                  <strong>API REST</strong>
                  <p>
                    Gerencie API key, quota diária e compra de pacotes de requisições.
                  </p>
                </article>
              )
            : null}
          {section === "app"
            ? (
                <article className={styles.moduleHintCard}>
                  <strong>Aplicativo Android</strong>
                  <p>
                    Baixe o APK oficial do BotAdmin e use o painel direto pelo aplicativo.
                  </p>
                </article>
              )
            : null}
        </div>

      </section>

      <section
        className={classNames(
          styles.rightPane,
          section === "status" && styles.rightPaneStatusExpanded,
          section === "conversations" && styles.rightPaneStatusExpanded,
          section === "flows" && styles.rightPaneFlowExpanded,
          isMobileViewport && !showMobileDetailPane && styles.mobilePaneHidden,
        )}
      >
        {feedback ? (
          <div className={classNames(styles.feedback, feedback.ok && styles.feedbackOk)}>
            <span className={styles.feedbackText}>
              {feedback.ok ? <IconCheck size={14} /> : null}
              {feedback.text}
            </span>
            <button
              type="button"
              className={styles.feedbackDismiss}
              onClick={() => setFeedback(null)}
              aria-label="Fechar notificação"
            >
              <IconX size={12} />
            </button>
          </div>
        ) : null}

        {section === "conversations" ? (
          <WhatsAppConversationsClient
            embedded
            brandName={brandName}
            brandLogo={brandLogo}
            preferredInstanceId={selectedInstanceId}
            activeGroupChatJids={activeConversationGroupJids}
            onPreferredInstanceChange={(instanceId) => {
              if (instanceId && instanceId > 0) {
                switchActiveProfile(instanceId);
              }
	            }}
	            onToggleGroupActive={handleConversationGroupActiveToggle}
	            onMobileChatOpenChange={setConversationsMobileChatOpen}
	          />
        ) : null}

        {section === "broadcasts" ? (
          <div className={styles.moduleWorkspace}>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                <div>
                  <div className={styles.moduleHeaderBrand}>
                    <img src={brandLogo} alt={brandName} className={styles.headerBrandLogo} />
                    <span>{brandName}</span>
                  </div>
                  <h3>Transmissões</h3>
                  <p>Listas de contatos, mensagens reutilizáveis e disparos com intervalo variável.</p>
                </div>
              </div>
            </header>
            <div className={styles.moduleContent}>
              <div className={styles.moduleHintCard}>
                <strong>Listas personalizadas</strong>
                <p>Selecione uma lista para conversar e enviar uma mensagem para todos os seus contatos.</p>
              </div>
            </div>
          </div>
        ) : null}

        {section === "groups" && selectedGroup && selectedConfig ? (
          <>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                {isMobileViewport ? (
                  <button
                    type="button"
                    className={styles.mobileBackButton}
                    onClick={() => {
                      setDetailsPanelOpen(false);
                      setMobileView("list");
                    }}
                    aria-label="Voltar para lista"
                  >
                    <IconArrowLeft size={18} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.headerGroupTrigger}
                  onClick={() => setDetailsPanelOpen(true)}
                  aria-label="Abrir dados do grupo"
                >
                  {selectedGroup.imageUrl && !brokenGroupImages[selectedGroup.id] ? (
                    <img
                      src={selectedGroup.imageUrl}
                      alt={selectedGroup.name}
                      className={styles.detailHeaderAvatarImage}
	                      onError={() => handleGroupImageError(selectedGroup.id, selectedGroup.imageUrl)}
                    />
                  ) : (
                    <div className={styles.detailHeaderAvatar}>{initials(selectedGroup.name)}</div>
                  )}
                    <div className={styles.headerGroupText}>
                      <h3>{selectedConfig.name}</h3>
                      <div className={styles.headerGroupMetaRow}>
                        <small>{selectedGroupParticipantsCount} membros</small>
                        <span className={styles.metaBadges}>
                          <span
                            className={classNames(
                              styles.tierBadge,
                              resolveGroupLifecycle(selectedGroup) === "active"
                                ? styles.tierBadgeVip
                                : resolveGroupLifecycle(selectedGroup) === "expired"
                                  ? styles.tierBadgeExpired
                                  : styles.tierBadgeDefault,
                            )}
                          >
                            {resolveGroupLifecycle(selectedGroup) === "active" ? (
                              <IconCrown size={12} className={styles.tierCrownIcon} />
                            ) : null}
                            {groupTierLabel(selectedGroup)}
                          </span>
                          {selectedGroupExpiryInfo ? (
                            <span
                              className={classNames(
                                styles.expiryBadge,
                                selectedGroupExpiryInfo.tone === "success"
                                  ? styles.expiryBadgeSuccess
                                  : selectedGroupExpiryInfo.tone === "warning"
                                    ? styles.expiryBadgeWarning
                                    : styles.expiryBadgeDanger,
                              )}
                              title={selectedGroupExpiryInfo.detailText}
                            >
                              {selectedGroupExpiryInfo.badgeText}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  </button>
              </div>
              <div className={styles.detailHeaderActions}>
                <button type="button" className={styles.iconBtn} title="Buscar no grupo">
                  <IconSearch size={16} />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setDetailsPanelOpen((value) => !value)}
                  title={detailsPanelOpen ? "Ocultar dados do grupo" : "Abrir dados do grupo"}
                >
                  <IconDotsVertical size={16} />
                </button>
              </div>
            </header>

            <div className={styles.groupWorkspace}>
              <div className={styles.groupMain}>
                <div className={styles.tabRow}>
                  <button
                    className={classNames(styles.tabBtn, groupTab === "activity" && styles.tabBtnActive)}
                    onClick={() => setGroupTab("activity")}
                  >
                    <IconSpeakerphone size={14} />
                    Atividade
                  </button>
                  <button
                    className={classNames(styles.tabBtn, groupTab === "automation" && styles.tabBtnActive)}
                    onClick={() => setGroupTab("automation")}
                  >
                    <IconSettings size={14} />
                    Ativações
                  </button>
                  <button
                    className={classNames(styles.tabBtn, groupTab === "premium" && styles.tabBtnActive)}
                    onClick={() => setGroupTab("premium")}
                  >
                    <IconCrown size={14} />
                    Premium
                  </button>
                </div>

                {participantImportJob && participantImportNotificationVisible ? (
                  <div className={styles.groupImportNotification}>
                    <div className={styles.participantImportStatusHead}>
                      <strong>Adição de membros em background</strong>
                      <div className={styles.participantImportStatusHeadActions}>
                        <span
                          className={classNames(
                            styles.instanceStatusTag,
                            participantImportJobStatusClassName,
                          )}
                        >
                          {participantImportJobStatusLabel}
                        </span>
                      </div>
                    </div>
                    <div className={classNames(styles.participantImportProgress, participantImportProgressStateClassName)}>
                      <span style={{ width: `${Math.max(0, Math.min(100, participantImportJob.progressPercent))}%` }} />
                    </div>
                    <small className={styles.instanceHeaderMeta}>
                      Processados: {participantImportJob.processedCount}/{Math.max(participantImportJob.totalCandidates, participantImportJob.processedCount)} ·
                      {" "}Adicionados: {participantImportJob.addedCount} ·
                      {" "}Falhas: {participantImportJob.failedCount} ·
                      {" "}Já no grupo: {participantImportJob.ignoredAlreadyInTarget}
                    </small>
                    {participantImportJob.lastMessage ? (
                      <small className={styles.instanceHeaderMeta}>{participantImportJob.lastMessage}</small>
                    ) : null}
                    {participantImportJob.lastError ? (
                      <small className={styles.errorInline}>{participantImportJob.lastError}</small>
                    ) : null}
                    {participantImportJobActive ? (
                      <div className={styles.groupImportRuntimeControls}>
                        <label>
                          Delay (ms)
                          <input
                            type="number"
                            min={1200}
                            max={60000}
                            value={participantImportDelayMs}
                            onChange={(event) => setParticipantImportDelayMs(event.target.value)}
                            disabled={updatingParticipantImportJob || cancellingParticipantImportJob}
                          />
                        </label>
                        <label>
                          Variação (ms)
                          <input
                            type="number"
                            min={0}
                            max={30000}
                            value={participantImportJitterMs}
                            onChange={(event) => setParticipantImportJitterMs(event.target.value)}
                            disabled={updatingParticipantImportJob || cancellingParticipantImportJob}
                          />
                        </label>
                        <label>
                          Lote máximo
                          <input
                            type="number"
                            min={1}
                            max={5}
                            value={participantImportBatchSize}
                            onChange={(event) => setParticipantImportBatchSize(event.target.value)}
                            disabled={updatingParticipantImportJob || cancellingParticipantImportJob}
                          />
                        </label>
                      </div>
                    ) : null}
                    <div className={styles.groupImportActionRow}>
                      <button
                        type="button"
                        className={classNames(styles.ghostButton, styles.compactButton)}
                        onClick={openParticipantImportModal}
                        disabled={importingParticipants || loadingParticipantImportJob}
                      >
                        <IconUsersGroup size={14} />
                        Detalhes
                      </button>
                      {!participantImportJobActive ? (
                        <button
                          type="button"
                          className={classNames(styles.primaryButton, styles.compactButton)}
                          onClick={() => {
                            setParticipantImportModalOpen(true);
                          }}
                          disabled={
                            importingParticipants ||
                            loadingParticipantImportJob ||
                            participantImportSourceGroups.length === 0
                          }
                        >
                          {importingParticipants ? (
                            <IconLoader2 size={14} className={styles.spin} />
                          ) : (
                            <IconUsersGroup size={14} />
                          )}
                          Novo envio
                        </button>
                      ) : null}
                      {participantImportJobActive ? (
                        <button
                          type="button"
                          className={classNames(styles.ghostButton, styles.compactButton)}
                          onClick={() => void updateParticipantImportRuntime(participantImportJob.id)}
                          disabled={updatingParticipantImportJob || cancellingParticipantImportJob}
                        >
                          {updatingParticipantImportJob ? <IconLoader2 size={14} className={styles.spin} /> : <IconDeviceFloppy size={14} />}
                          Salvar ritmo
                        </button>
                      ) : null}
                      {participantImportJob.status === "paused" ? (
                        <button
                          type="button"
                          className={classNames(styles.ghostButton, styles.compactButton)}
                          onClick={() => void resumeParticipantImportJob(participantImportJob.id)}
                          disabled={updatingParticipantImportJob || cancellingParticipantImportJob}
                        >
                          {updatingParticipantImportJob ? <IconLoader2 size={14} className={styles.spin} /> : <IconRotateClockwise2 size={14} />}
                          Retomar
                        </button>
                      ) : participantImportJobActive ? (
                        <button
                          type="button"
                          className={classNames(styles.ghostButton, styles.compactButton)}
                          onClick={() => void pauseParticipantImportJob(participantImportJob.id)}
                          disabled={updatingParticipantImportJob || cancellingParticipantImportJob || participantImportJob.status === "cancelling"}
                        >
                          {updatingParticipantImportJob ? <IconLoader2 size={14} className={styles.spin} /> : <IconSettings size={14} />}
                          Pausar
                        </button>
                      ) : null}
                      {participantImportJobActive ? (
                        <button
                          type="button"
                          className={classNames(styles.ghostButton, styles.compactButton, styles.dangerButton)}
                          onClick={() => void cancelParticipantImportJob(participantImportJob.id)}
                          disabled={cancellingParticipantImportJob || updatingParticipantImportJob}
                        >
                          {cancellingParticipantImportJob ? <IconLoader2 size={14} className={styles.spin} /> : <IconX size={14} />}
                          Cancelar
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {groupTab === "activity" ? (
                  <>
                    <div className={styles.feedBox}>
                      <div className={styles.activityFeedHeader}>
                        <div>
                          <strong>Histórico de ações do grupo</strong>
                          <p>Banimentos, advertências e ações de moderação executadas pelo bot.</p>
                        </div>
                        <div className={styles.activityFeedActions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => void resetGroupActivity(selectedGroup.id)}
                            title="Limpar histórico"
                            disabled={resettingActivityGroupId === selectedGroup.id}
                          >
                            {resettingActivityGroupId === selectedGroup.id ? (
                              <IconLoader2 size={14} className={styles.spin} />
                            ) : (
                              <IconTrash size={14} />
                            )}
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => void loadGroupActivity(selectedGroup.id)}
                            title="Atualizar histórico"
                            disabled={loadingActivityGroupId === selectedGroup.id}
                          >
                            {loadingActivityGroupId === selectedGroup.id ? (
                              <IconLoader2 size={14} className={styles.spin} />
                            ) : (
                              <IconRefresh size={14} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className={styles.activityEventList}>
                      {selectedGroupActivity.length === 0 ? (
                        <article className={styles.activityEventEmpty}>
                          Nenhuma ação registrada até agora para este grupo.
                        </article>
                      ) : null}
                      {selectedGroupActivity.map((entry) => {
                        const evidenceUrl = resolveActivityEvidenceUrl(entry);
                        const evidenceKind = inferActivityEvidenceKind(evidenceUrl, entry.evidenceKind);
                        const nsfwSummary = resolveActivityNsfwSummary(entry);
                        const cleanMessageText = stripNsfwMarkerFromMessage(entry.messageText);
                        const displayMessageText =
                          cleanMessageText || (entry.messageText ? entry.messageText.trim() : "");
                        const participantDigits = normalizeIdentityDigits(entry.participant ?? "");
                        const canShowActionMenu = participantDigits.length >= 5;
                        const isMenuOpen = activityActionMenuEntryId === entry.id;
                        const removeBusy = activityActionBusyKey === `${entry.id}:remove`;
                        const blacklistBusy = activityActionBusyKey === `${entry.id}:blacklist`;
                        const menuBusy = removeBusy || blacklistBusy;
                        const normalizedEvidence = evidenceUrl ? evidenceUrl.trim() : "";
                        const displayLinks = (entry.links ?? []).filter((link) => {
                          const normalized = String(link ?? "").trim();
                          return normalized.length > 0 && normalized !== normalizedEvidence;
                        });

                        return (
                          <article key={entry.id} className={styles.activityEventCard}>
                            <header className={styles.activityEventHeader}>
                              <div className={styles.activityEventBadges}>
                                <span className={styles.activityReasonBadge}>{activityReasonLabel(entry.reason)}</span>
                                <span className={styles.activityActionBadge}>{activityActionLabel(entry.action)}</span>
                              </div>
                              <div className={styles.activityEventHeaderRight}>
                                <time>{new Date(entry.timestamp).toLocaleString("pt-BR")}</time>
                                {canShowActionMenu ? (
                                  <div className={styles.activityEventQuickAction}>
                                    <button
                                      type="button"
                                      className={styles.iconBtn}
                                      title="Ações rápidas do usuário"
                                      onClick={() =>
                                        setActivityActionMenuEntryId((current) =>
                                          current === entry.id ? null : entry.id,
                                        )
                                      }
                                      disabled={menuBusy}
                                    >
                                      {menuBusy ? (
                                        <IconLoader2 size={14} className={styles.spin} />
                                      ) : (
                                        <IconDotsVertical size={14} />
                                      )}
                                    </button>
                                    {isMenuOpen ? (
                                      <div className={styles.activityEventQuickActionMenu}>
                                        <button
                                          type="button"
                                          className={styles.activityQuickActionButton}
                                          onClick={() => void runActivityParticipantAction(entry, "remove")}
                                          disabled={menuBusy}
                                        >
                                          Remover usuário do grupo
                                        </button>
                                        <button
                                          type="button"
                                          className={styles.activityQuickActionButton}
                                          onClick={() => void runActivityParticipantAction(entry, "blacklist")}
                                          disabled={menuBusy}
                                        >
                                          Adicionar à blacklist e remover
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </header>

                            <div className={styles.activityEventMeta}>
                              <span><strong>Usuário:</strong> {entry.pushName || entry.participant || "-"}</span>
                              {entry.instanceName ? <span><strong>WhatsApp:</strong> {entry.instanceName}</span> : null}
                              {typeof entry.remainingInfractions === "number" ? (
                                <span><strong>Infrações restantes:</strong> {entry.remainingInfractions}</span>
                              ) : null}
                            </div>

                            {nsfwSummary ? (
                              <div className={styles.activityNsfwCard}>
                                <div className={styles.activityNsfwHeader}>
                                  <strong>Detecção NSFW</strong>
                                  <span className={styles.activityNsfwCategory}>
                                    {activityNsfwCategoryLabel(nsfwSummary.dominant)}
                                  </span>
                                </div>
                                <div className={styles.activityNsfwScores}>
                                  <span>Pornografia: {formatActivityScore(nsfwSummary.porn)}</span>
                                  <span>Hentai: {formatActivityScore(nsfwSummary.hentai)}</span>
                                  <span>Sensual: {formatActivityScore(nsfwSummary.sexy)}</span>
                                  <span>Total: {formatActivityScore(nsfwSummary.total)}</span>
                                </div>
                              </div>
                            ) : null}

                            {evidenceUrl ? (
                              <div className={styles.activityEvidenceCard}>
                                <strong>Evidência salva:</strong>
                                <div className={styles.activityEvidencePreview}>
                                  {evidenceKind === "image" ? (
                                    <a href={evidenceUrl} target="_blank" rel="noreferrer" className={styles.activityEvidenceAnchor}>
                                      <img
                                        src={evidenceUrl}
                                        alt="Evidência de moderação"
                                        className={styles.activityEvidenceImage}
                                        loading="lazy"
                                      />
                                    </a>
                                  ) : evidenceKind === "video" ? (
                                    <video
                                      src={evidenceUrl}
                                      className={styles.activityEvidenceVideo}
                                      controls
                                      preload="metadata"
                                      playsInline
                                    />
                                  ) : null}
                                  <a href={evidenceUrl} target="_blank" rel="noreferrer" className={styles.activityEvidenceLink}>
                                    Abrir mídia armazenada
                                  </a>
                                </div>
                              </div>
                            ) : null}

                            {displayLinks.length > 0 ? (
                              <div className={styles.activityEventLinks}>
                                <strong>Links detectados:</strong>
                                <ul>
                                  {displayLinks.map((link) => (
                                    <li key={`${entry.id}-${link}`}>{link}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {displayMessageText ? (
                              <p className={styles.activityEventMessage}>
                                <strong>Mensagem:</strong> {displayMessageText}
                              </p>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </>
                ) : null}

                {groupTab === "premium" ? (
                  <>
                    <div className={styles.feedBox}>
                      <div className={styles.activityFeedHeader}>
                        <div>
                          <strong>Premium do grupo</strong>
                          <p>Assinatura interna para liberar comandos e funções selecionadas aos membros pagantes.</p>
                        </div>
                        {botCoinsSaving ? (
                          <span className={styles.botCoinsSaving}>
                            <IconLoader2 size={14} className={styles.spin} />
                            Salvando...
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {!botCoinsDraft ? (
                      <article className={styles.activityEventEmpty}>
                        Carregando configurações de Premium...
                      </article>
                    ) : (
                      <>
                        <div className={styles.botCoinsGrid}>
                          <section className={styles.botCoinsSection}>
                            <header className={styles.botCoinsSectionHeader}>
                              <strong>Premium</strong>
                              <p>Controle a venda do acesso premium e escolha quais comandos exigem assinatura.</p>
                            </header>
                            <div className={styles.botCoinsForm}>
                              <label className={styles.toggleField}>
                                <span>Ativar Premium</span>
                                <button
                                  type="button"
                                  className={classNames(styles.toggleSwitch, botCoinsDraft.premium.enabled && styles.toggleSwitchOn)}
                                  aria-pressed={botCoinsDraft.premium.enabled}
                                  onClick={() =>
                                    updatePremiumDraftAndSave((premium) => {
                                      premium.enabled = !premium.enabled;
                                    })
                                  }
                                >
                                  <span />
                                </button>
                              </label>
                              <div className={styles.participantActions}>
                                <span>
                                  {(botCoinsDraft.premium.plans ?? []).filter((plan) => plan.enabled !== false).length} plano(s) ativo(s)
                                  {" "}· {(botCoinsDraft.premium.commandKeys ?? []).length} comando(s)
                                </span>
                              </div>
                            </div>
                          </section>
                        </div>
                        <div className={classNames(styles.automationShortcutGrid, styles.premiumShortcutGrid)}>
                          {visibleBotCoinsShortcuts.map((item) => {
                            const ShortcutIcon = item.icon;
                            return (
                              <button
                                key={item.key}
                                type="button"
                                className={classNames(styles.ghostButton, styles.botCoinsShortcutButton)}
                                onClick={() => setBotCoinsModal(item.key)}
                              >
                                <span className={styles.botCoinsShortcutIcon} aria-hidden="true">
                                  <LottieAnimation
                                    path={getAssetPath(item.animationPath)}
                                    title={item.label}
                                  />
                                </span>
                                <span className={styles.botCoinsShortcutText}>
                                  <strong>{item.label}</strong>
                                  <small>{item.hint}</small>
                                </span>
                                <ShortcutIcon size={16} className={styles.botCoinsShortcutFallbackIcon} />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                ) : null}

                {groupTab === "automation" ? (
                  <>
                    {resolveGroupLifecycle(selectedGroup) !== "active" ? (
                      <div className={styles.disabledNotice}>
		                        {resolveGroupLifecycle(selectedGroup) === "expired"
		                          ? "A assinatura do perfil está vencida. Renove para liberar as automações."
		                          : "Assine qualquer plano para liberar as automações deste e dos demais grupos."}
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={() => void handleGroupActionClick(selectedGroup)}
                          disabled={updatingGroupStatus}
                        >
                          {updatingGroupStatus ? (
                            <IconLoader2 size={14} className={styles.spin} />
                          ) : (
                            groupActionLabel(selectedGroup)
                          )}
                        </button>
                      </div>
                    ) : null}
                    <div className={styles.automationShortcutGrid}>
	                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("welcome")}>
	                        Bem-vindo
	                      </button>
	                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("farewell")}>
	                        Saída
	                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("schedule")}>
                        Abrir/fechar automático
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("allowedLinks")}>
                        Links permitidos
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("moderation")}>
                        Infrações
                      </button>
	                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("autoresposta")}>
	                        Autoresposta
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("bannedWords")}>
                        Palavras proibidas
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("blacklist")}>
                        Lista de bloqueio
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("antiInactivity")}>
                        AntiAFK
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("horapg")}>
                        Horários pagantes
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("botinterage")}>
                        Bot Interage
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => void openAutomationEditor("menus")}>
                        Menus do bot
                      </button>
                    </div>
                    <div className={styles.activationList}>
                      {visibleActivationItems.map((item) => {
                        const checked = selectedConfig[item.key];
                        const saving = savingActivationKey === item.key;
                        const modalKey = ACTIVATION_MODAL_BY_KEY[item.key];
                        return (
                          <article key={item.key} className={styles.activationRow}>
                            <div>
                              <strong>{item.label}</strong>
                              <p>{item.hint}</p>
                            </div>
                            <div className={styles.activationRowActions}>
                              {modalKey ? (
                                <button
                                  type="button"
                                  className={styles.activationConfigButton}
                                  onClick={() => void openAutomationEditor(modalKey)}
                                  disabled={resolveGroupLifecycle(selectedGroup) !== "active"}
                                  title="Editar configuração"
                                >
                                  <IconSettings size={14} />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={classNames(styles.toggleSwitch, checked && styles.toggleSwitchOn)}
                                aria-pressed={checked}
                                onClick={() => void toggleActivation(item.key, !checked)}
                                disabled={saving || resolveGroupLifecycle(selectedGroup) !== "active"}
                              >
                                {saving ? <IconLoader2 size={14} className={styles.spin} /> : <span />}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </>
                ) : null}

              </div>

              {detailsPanelOpen ? (
                <>
                  {isMobileViewport ? (
                    <button
                      type="button"
                      className={styles.groupDetailsBackdrop}
                      onClick={() => setDetailsPanelOpen(false)}
                      aria-label="Fechar dados do grupo"
                    />
                  ) : null}
                  <aside
                    className={classNames(styles.groupDetailsPanel, isMobileViewport && styles.groupDetailsPanelMobile)}
                    onClick={isMobileViewport ? (event) => event.stopPropagation() : undefined}
                  >
                    <header className={styles.groupDetailsHeader}>
                      <div className={styles.groupDetailsHeaderText}>
                        <h4>Dados do grupo</h4>
                        <small>{selectedGroup.instanceName}</small>
                      </div>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => setDetailsPanelOpen(false)}
                        aria-label="Fechar dados do grupo"
                      >
                        ×
                      </button>
                    </header>

                    <div className={styles.groupDetailsHero}>
                      <div className={styles.groupDetailsAvatarWrap}>
                        {selectedGroup.imageUrl && !brokenGroupImages[selectedGroup.id] ? (
                          <img
                            src={selectedGroup.imageUrl}
                            alt={selectedGroup.name}
                            className={styles.groupDetailsAvatarImage}
	                            onError={() => handleGroupImageError(selectedGroup.id, selectedGroup.imageUrl)}
                          />
                        ) : (
                          <div className={styles.groupDetailsAvatar}>{initials(selectedGroup.name)}</div>
                        )}
                        <input
                          ref={groupPhotoInputRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(event) => void handleGroupPhotoUpload(event)}
                        />
                        <div className={styles.groupDetailsAvatarActions}>
                          <button
                            type="button"
                            className={styles.groupInlineEditBtn}
                            onClick={() => groupPhotoInputRef.current?.click()}
                            title="Trocar foto do grupo"
                            disabled={uploadingPhoto || !selectedGroupAllowsAdminEdits}
                          >
                            {uploadingPhoto ? <IconLoader2 size={13} className={styles.spin} /> : <IconPencil size={13} />}
                          </button>
                          <button
                            type="button"
                            className={styles.groupInlineEditBtn}
                            onClick={() => void removeGroupPhoto()}
                            title="Remover foto do grupo"
                            disabled={uploadingPhoto || !selectedGroupAllowsAdminEdits}
                          >
                            <IconTrash size={13} />
                          </button>
                        </div>
                      </div>
                      <div className={styles.groupDetailsNameRow}>
                        <h5>{selectedConfig.name}</h5>
                        <button
                          type="button"
                          className={styles.groupInlineEditBtn}
                          onClick={() => openGroupEdit("name")}
                          title="Editar nome do grupo"
                          disabled={!selectedGroupAllowsAdminEdits}
                        >
                          <IconPencil size={14} />
                        </button>
                      </div>
                      <p>
                        Grupo · {selectedGroupParticipantsCount} membros
                        <span className={styles.metaBadges}>
                          <span
                            className={classNames(
                              styles.tierBadge,
                              resolveGroupLifecycle(selectedGroup) === "active"
                                ? styles.tierBadgeVip
                                : resolveGroupLifecycle(selectedGroup) === "expired"
                                  ? styles.tierBadgeExpired
                                  : styles.tierBadgeDefault,
                            )}
                          >
                            {resolveGroupLifecycle(selectedGroup) === "active" ? (
                              <IconCrown size={12} className={styles.tierCrownIcon} />
                            ) : null}
                            {groupTierLabel(selectedGroup)}
                          </span>
                          {selectedGroupExpiryInfo ? (
                            <span
                              className={classNames(
                                styles.expiryBadge,
                                selectedGroupExpiryInfo.tone === "success"
                                  ? styles.expiryBadgeSuccess
                                  : selectedGroupExpiryInfo.tone === "warning"
                                    ? styles.expiryBadgeWarning
                                    : styles.expiryBadgeDanger,
                              )}
                              title={selectedGroupExpiryInfo.detailText}
                            >
                              {selectedGroupExpiryInfo.badgeText}
                            </span>
                          ) : null}
                        </span>
                      </p>
                    </div>

                    {!selectedGroupAllowsAdminEdits ? (
                      <div className={styles.groupPermissionNotice}>
                        Esta conexão não é administradora do grupo. Edições de nome, descrição, foto e configurações ficam bloqueadas.
                      </div>
                    ) : null}

                    <section className={styles.groupDetailsSection}>
                      <div className={styles.groupSectionTitleRow}>
                        <h5>Descrição</h5>
                        <button
                          type="button"
                          className={styles.groupInlineEditBtn}
                          onClick={() => openGroupEdit("description")}
                          title="Editar descrição do grupo"
                          disabled={!selectedGroupAllowsAdminEdits}
                        >
                          <IconPencil size={14} />
                        </button>
                      </div>
                      {groupPrimaryLink ? (
                        <a href={groupPrimaryLink} target="_blank" rel="noreferrer" className={styles.groupDescriptionLink}>
                          {groupPrimaryLink}
                        </a>
                      ) : null}
                      <p className={styles.groupDescriptionText}>
                        {selectedConfig.description?.trim() || "Sem descrição configurada para este grupo."}
                      </p>
                    </section>

                    <section className={styles.groupDetailsSection}>
                      <h5>Configuração do grupo</h5>
                      <div className={styles.groupMetaList}>
                        <span><strong>WhatsApp:</strong> {selectedGroup.instanceName}</span>
                        <span><strong>Status:</strong> {groupActivationLabel(selectedGroup)}</span>
                        <span><strong>ID remoto:</strong> {selectedGroup.remoteId}</span>
                        <span>
                          <strong>Criado em:</strong>{" "}
                          {new Date(selectedGroup.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>

                      <div className={styles.groupActivationActions}>
                        {resolveGroupLifecycle(selectedGroup) !== "active" || selectedGroup.status !== "active" ? (
                          <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => void handleGroupActionClick(selectedGroup)}
                            disabled={updatingGroupStatus}
                          >
                            {updatingGroupStatus ? (
                              <IconLoader2 size={14} className={styles.spin} />
                            ) : (
                              groupActionLabel(selectedGroup)
                            )}
                          </button>
                        ) : null}
                        {resolveGroupLifecycle(selectedGroup) === "active" && selectedGroup.status === "active" ? (
                          <button
                            type="button"
                            className={styles.ghostButton}
                            onClick={() => void setGroupActivation(false)}
                            disabled={updatingGroupStatus}
                          >
                            Desativar grupo
                          </button>
                        ) : null}
                      </div>
                      <div className={styles.groupMetaControls}>
                        <div className={styles.groupMetaControlRow}>
                          <div>
                            <strong>Somente administradores podem enviar mensagens</strong>
                            <p>Restringe mensagens para admins do grupo.</p>
                          </div>
                          <button
                            type="button"
                            className={classNames(styles.toggleSwitch, groupMetaDraft.adminsOnly && styles.toggleSwitchOn)}
                            aria-pressed={groupMetaDraft.adminsOnly}
                            onClick={() => void updateGroupMeta({ adminsOnly: !groupMetaDraft.adminsOnly })}
                            disabled={savingGroupMeta || !selectedGroupAllowsAdminEdits}
                          >
                            <span />
                          </button>
                        </div>
                        <div className={styles.groupMetaControlRow}>
                          <div>
                            <strong>Travar configurações do grupo</strong>
                            <p>Impede alterações de configuração por membros.</p>
                          </div>
                          <button
                            type="button"
                            className={classNames(styles.toggleSwitch, groupMetaDraft.locked && styles.toggleSwitchOn)}
                            aria-pressed={groupMetaDraft.locked}
                            onClick={() => void updateGroupMeta({ locked: !groupMetaDraft.locked })}
                            disabled={savingGroupMeta || !selectedGroupAllowsAdminEdits}
                          >
                            <span />
                          </button>
                        </div>
                        <div className={styles.groupMetaControlRow}>
                          <div>
	                            <strong>Renovação do perfil somente por administradores</strong>
	                            <p>
	                              Desligado por padrão: qualquer membro pode tocar em Renovar perfil e gerar o Pix.
	                            </p>
                          </div>
                          <button
                            type="button"
                            className={classNames(
                              styles.toggleSwitch,
                              selectedGroupSettings?.planRenewalAdminsOnly && styles.toggleSwitchOn,
                            )}
                            aria-pressed={Boolean(selectedGroupSettings?.planRenewalAdminsOnly)}
                            onClick={() =>
                              void updatePlanRenewalAccess(!selectedGroupSettings?.planRenewalAdminsOnly)
                            }
                            disabled={savingPlanRenewalAccess || !selectedGroupSettings}
                          >
                            {savingPlanRenewalAccess ? <IconLoader2 size={14} className={styles.spin} /> : <span />}
                          </button>
                        </div>
                        <label className={styles.groupMetaSelectLabel}>
                          <span>Duração das mensagens temporárias</span>
                          <select
                            value={groupMetaDraft.ephemeral}
                            onChange={(event) =>
                              setGroupMetaDraft((current) => ({
                                ...current,
                                ephemeral: normalizeEphemeralValue(event.target.value),
                              }))
                            }
                            disabled={savingGroupMeta || !selectedGroupAllowsAdminEdits}
                          >
                            <option value="off">Desativado</option>
                            <option value="24h">24 horas</option>
                            <option value="7d">7 dias</option>
                            <option value="90d">90 dias</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className={classNames(styles.ghostButton, styles.compactButton)}
                          onClick={() => void updateGroupMeta({ ephemeral: groupMetaDraft.ephemeral })}
                          disabled={savingGroupMeta || !selectedGroupAllowsAdminEdits}
                        >
                          {savingGroupMeta ? <IconLoader2 size={14} className={styles.spin} /> : <IconDeviceFloppy size={14} />}
                          Salvar duração
                        </button>
                        <small className={styles.groupEphemeralHint}>
                          Atual: {ephemeralLabel(selectedGroup.metadata?.ephemeral)}
                        </small>
                      </div>
                    </section>

                    <section className={styles.groupDetailsSection}>
                      <div className={styles.groupSectionTitleRow}>
                        <h5>Membros do grupo</h5>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => void loadGroupParticipants(selectedGroup.id, { refresh: true })}
                          disabled={loadingParticipantsGroupId === selectedGroup.id}
                          title="Atualizar membros"
                        >
                          {loadingParticipantsGroupId === selectedGroup.id ? (
                            <IconLoader2 size={14} className={styles.spin} />
                          ) : (
                            <IconRefresh size={14} />
                          )}
                        </button>
                      </div>
                      <label className={styles.participantSearchBox}>
                        <IconSearch size={14} />
                        <input
                          value={participantSearch}
                          onChange={(event) => setParticipantSearch(event.target.value)}
                          placeholder="Pesquisar por número ou JID"
                        />
                      </label>
                      <div className={styles.participantActions}>
                        <span>{selectedParticipantIds.length} selecionado(s)</span>
                        <div className={styles.participantActionButtons}>
                          <button
                            type="button"
                            className={classNames(styles.ghostButton, styles.compactButton)}
                            onClick={openParticipantImportModal}
                            disabled={
                              importingParticipants ||
                              loadingParticipantImportJob ||
                              cancellingParticipantImportJob ||
                              updatingParticipantImportJob ||
                              !selectedGroupAllowsAdminEdits ||
                              participantImportSourceGroups.length === 0
                            }
                            title={
                              participantImportSourceGroups.length === 0
                                ? "Nenhum grupo de origem elegível"
                                : "Importar membros de outro grupo da conta"
                            }
                          >
                            {importingParticipants || loadingParticipantImportJob || cancellingParticipantImportJob || updatingParticipantImportJob ? (
                              <IconLoader2 size={14} className={styles.spin} />
                            ) : (
                              <IconUsersGroup size={14} />
                            )}
                            {participantImportJobActive ? "Acompanhar adição" : "Adicionar membros"}
                          </button>
                          {participantImportJobActive && participantImportJob ? (
                            <button
                              type="button"
                              className={classNames(styles.ghostButton, styles.compactButton, styles.dangerButton)}
                              onClick={() => void cancelParticipantImportJob(participantImportJob.id)}
                              disabled={cancellingParticipantImportJob || importingParticipants || updatingParticipantImportJob}
                            >
                              {cancellingParticipantImportJob ? (
                                <IconLoader2 size={14} className={styles.spin} />
                              ) : (
                                <IconX size={14} />
                              )}
                              Cancelar adição
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={classNames(styles.primaryButton, styles.compactButton)}
                            onClick={() => void addSelectedParticipantsToBlacklist()}
                            disabled={selectedParticipantIds.length === 0 || applyingParticipantBlacklist}
                          >
                            {applyingParticipantBlacklist ? (
                              <IconLoader2 size={14} className={styles.spin} />
                            ) : (
                              <IconCheck size={14} />
                            )}
                            Bloquear selecionados
                          </button>
                          {selectedParticipantIds.length > 0 ? (
                            <button
                              type="button"
                              className={classNames(styles.ghostButton, styles.compactButton)}
                              onClick={() => setSelectedParticipantIds([])}
                              disabled={applyingParticipantBlacklist}
                            >
                              Limpar seleção
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {participantImportJob ? (
                        <div className={styles.participantImportStatusCard}>
                          <div className={styles.participantImportStatusHead}>
                            <strong>Adição em background</strong>
                            <span
                              className={classNames(
                                styles.instanceStatusTag,
                                participantImportJobStatusClassName,
                              )}
                            >
                              {participantImportJobStatusLabel}
                            </span>
                          </div>
                          <div className={classNames(styles.participantImportProgress, participantImportProgressStateClassName)}>
                            <span style={{ width: `${Math.max(0, Math.min(100, participantImportJob.progressPercent))}%` }} />
                          </div>
                          <small className={styles.instanceHeaderMeta}>
                            Processados: {participantImportJob.processedCount}/{Math.max(participantImportJob.totalCandidates, participantImportJob.processedCount)} ·
                            {" "}Adicionados: {participantImportJob.addedCount} ·
                            {" "}Falhas: {participantImportJob.failedCount} ·
                            {" "}Já no grupo: {participantImportJob.ignoredAlreadyInTarget}
                          </small>
                          {participantImportJob.lastMessage ? (
                            <small className={styles.instanceHeaderMeta}>{participantImportJob.lastMessage}</small>
                          ) : null}
                          {participantImportJob.lastError ? (
                            <small className={styles.errorInline}>{participantImportJob.lastError}</small>
                          ) : null}
                        </div>
                      ) : null}
                      <div className={styles.participantList}>
                        {filteredParticipants.length === 0 ? (
                          <p className={styles.participantListEmpty}>
                            Nenhum membro encontrado para este filtro.
                          </p>
                        ) : (
                          visibleParticipants.map((participant) => {
                            const isSelected = selectedParticipantIds.includes(participant.id);
                            const displayId = formatParticipantDisplay(participant.id);
                            const roleLabel = participantRoleLabel(participant.admin);
                            return (
                              <button
                                key={participant.id}
                                type="button"
                                className={classNames(
                                  styles.participantRow,
                                  isSelected && styles.participantRowSelected,
                                )}
                                onClick={() => toggleParticipantSelection(participant.id)}
                              >
                                <div className={styles.participantAvatar}>{participantAvatarLabel(participant.id)}</div>
                                <div className={styles.participantText}>
                                  <strong>{displayId}</strong>
                                  <small>{roleLabel}</small>
                                </div>
                                {participant.admin !== "member" ? (
                                  <span className={styles.participantRoleBadge}>{roleLabel}</span>
                                ) : null}
                              </button>
                            );
                          })
                        )}
                      </div>
                      {filteredParticipants.length > visibleParticipants.length ? (
                        <button
                          type="button"
                          className={classNames(styles.ghostButton, styles.compactButton, styles.participantExpandButton)}
                          onClick={() => setShowAllParticipants(true)}
                        >
                          Ver tudo (mais {filteredParticipants.length - visibleParticipants.length})
                        </button>
                      ) : null}
                      {showAllParticipants && filteredParticipants.length > 18 ? (
                        <button
                          type="button"
                          className={classNames(styles.ghostButton, styles.compactButton, styles.participantExpandButton)}
                          onClick={() => setShowAllParticipants(false)}
                        >
                          Mostrar menos
                        </button>
                      ) : null}
                    </section>
                  </aside>
                </>
              ) : null}
            </div>
          </>
        ) : null}

        {section === "instances" && selectedInstance ? (
          <>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                {isMobileViewport ? (
                  <button
                    type="button"
                    className={styles.mobileBackButton}
                    onClick={() => setMobileView("list")}
                    aria-label="Voltar para lista"
                  >
                    <IconArrowLeft size={18} />
                  </button>
                ) : null}
                <div>
                  <h3>{selectedInstance.name}</h3>
                  <small className={styles.instanceHeaderMeta}>
                    <span>{selectedInstance.phone}</span>
                    <span
                      className={classNames(
                        styles.instanceExpiryText,
                        isInstanceExpired(selectedInstance) && styles.instanceExpiryTextExpired,
                      )}
                    >
                      Validade: {formatDateTime(selectedInstance.expiresAt)}
                    </span>
                    <span
                      className={classNames(
                        styles.instanceStatusTag,
                        isConnectedInstanceStatus(selectedInstance.sessionStatus)
                          ? styles.instanceStatusConnected
                          : styles.instanceStatusDisconnected,
                      )}
                    >
                      {statusLabel[selectedInstance.sessionStatus]}
                    </span>
                  </small>
                </div>
              </div>
            </header>

            <div className={styles.instanceWorkspace}>
              <section className={styles.instanceProfileCard}>
                <div className={styles.instanceIdentity}>
                  {selectedInstanceProfile?.avatarUrl && !brokenInstanceImages[selectedInstance.id] ? (
                    <img
                      src={withCacheBust(selectedInstanceProfile.avatarUrl, selectedInstance.updatedAt)}
                      alt={selectedInstance.name}
                      className={styles.instanceProfileAvatarImage}
                      onError={() => {
                        setBrokenInstanceImages((current) => ({ ...current, [selectedInstance.id]: true }));
                      }}
                    />
                  ) : (
                    <div className={styles.instanceProfileAvatar}>
                      <IconBrandWhatsapp size={18} />
                    </div>
                  )}
                  <div className={styles.instanceIdentityText}>
                    <strong>{selectedInstance.name}</strong>
                    <span
                      className={classNames(
                        styles.instanceStatusTag,
                        isConnectedInstanceStatus(selectedInstance.sessionStatus)
                          ? styles.instanceStatusConnected
                          : styles.instanceStatusDisconnected,
                      )}
                    >
                      {statusLabel[selectedInstance.sessionStatus]}
                    </span>
                    {selectedInstanceProfile?.jid ? <small>{selectedInstanceProfile.jid}</small> : null}
                    <small
                      className={classNames(
                        styles.instanceExpiryText,
                        isInstanceExpired(selectedInstance) && styles.instanceExpiryTextExpired,
                      )}
                    >
                      Validade: {formatDateTime(selectedInstance.expiresAt)}
                    </small>
                  </div>
                </div>

	                <div className={styles.instanceLicenseToggle}>
	                  <div className={styles.instanceLicenseToggleText}>
	                    <strong>Renovação do perfil pelo WhatsApp</strong>
	                    <small>
	                      Quando ativa, o aviso de plano vencido envia botão para renovar o perfil inteiro.
	                    </small>
	                  </div>
                  <button
                    type="button"
                    className={classNames(
                      styles.toggleSwitch,
                      selectedInstance.licenseSalesEnabled && styles.toggleSwitchOn,
                    )}
                    onClick={() =>
                      void toggleInstanceLicenseSales(
                        selectedInstance.id,
                        !selectedInstance.licenseSalesEnabled,
                      )
                    }
                    disabled={busyInstanceId === selectedInstance.id}
	                    aria-label="Alternar renovação do perfil pelo WhatsApp"
                    aria-pressed={selectedInstance.licenseSalesEnabled}
                  >
                    <span />
                  </button>
                </div>

                <div className={styles.instancePhotoActions}>
                  <input
                    ref={instancePhotoInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => void uploadInstancePhoto(event)}
                    disabled={!selectedInstanceCanManageProfile}
                  />
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => instancePhotoInputRef.current?.click()}
                    disabled={uploadingInstancePhotoId === selectedInstance.id || !selectedInstanceCanManageProfile}
                  >
                    {uploadingInstancePhotoId === selectedInstance.id ? (
                      <IconLoader2 size={14} className={styles.spin} />
                    ) : (
                      <IconCamera size={14} />
                    )}
                    Trocar foto
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => void removeInstancePhoto()}
                    disabled={uploadingInstancePhotoId === selectedInstance.id || !selectedInstanceCanManageProfile}
                  >
                    <IconTrash size={14} />
                    Remover foto
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => void loadInstanceProfile(selectedInstance.id)}
                    disabled={loadingInstanceProfileId === selectedInstance.id || !selectedInstanceCanManageProfile}
                  >
                    {loadingInstanceProfileId === selectedInstance.id ? (
                      <IconLoader2 size={14} className={styles.spin} />
                    ) : (
                      <IconRefresh size={14} />
                    )}
                    Atualizar perfil
                  </button>
                </div>

                <div className={styles.instanceProfileGrid}>
                  <label>
                    Nome do perfil
                    <input
                      value={instanceProfileForm.displayName}
                      onChange={(event) =>
                        setInstanceProfileForm((current) => ({ ...current, displayName: event.target.value }))
                      }
                      placeholder="Nome interno para organização"
                      disabled={savingInstanceProfileId === selectedInstance.id}
                    />
                  </label>
                  <label>
                    Número do WhatsApp
                    <input
                      value={instanceProfileForm.phone}
                      onChange={(event) =>
                        setInstanceProfileForm((current) => ({ ...current, phone: event.target.value }))
                      }
                      placeholder="5592999999999"
                      disabled={savingInstanceProfileId === selectedInstance.id}
                    />
                  </label>
                  <label>
                    Nome no WhatsApp
                    <input
                      value={instanceProfileForm.pushName}
                      onChange={(event) =>
                        setInstanceProfileForm((current) => ({ ...current, pushName: event.target.value }))
                      }
                      placeholder="Nome exibido no perfil do WhatsApp"
                      disabled={!selectedInstanceCanManageProfile || savingInstanceProfileId === selectedInstance.id}
                    />
                  </label>
                  <label className={styles.instanceProfileGridFull}>
                    Recado / status
                    <textarea
                      rows={3}
                      value={instanceProfileForm.statusText}
                      onChange={(event) =>
                        setInstanceProfileForm((current) => ({ ...current, statusText: event.target.value }))
                      }
                      placeholder="Texto do recado da conta"
                      disabled={!selectedInstanceCanManageProfile || savingInstanceProfileId === selectedInstance.id}
                    />
                  </label>
                </div>

                <div className={styles.instanceProfileSaveActions}>
                  <button
                    type="button"
                    className={classNames(styles.primaryButton, styles.instanceSaveButton)}
                    onClick={() => void saveInstanceProfile()}
                    disabled={savingInstanceProfileId === selectedInstance.id}
                  >
                    {savingInstanceProfileId === selectedInstance.id ? (
                      <IconLoader2 size={14} className={styles.spin} />
                    ) : (
                      <IconDeviceFloppy size={14} />
                    )}
                    Salvar dados
                  </button>
                  {selectedInstance.purpose === "admin_system" ? (
                    <button
                      type="button"
                      className={classNames(styles.ghostButton, styles.instanceSaveButton)}
                      onClick={() =>
                        void saveInstanceProfile({ resetAdminSession: true, pairAfterSave: true })
                      }
                      disabled={savingInstanceProfileId === selectedInstance.id || busyInstanceId === selectedInstance.id}
                    >
                      {savingInstanceProfileId === selectedInstance.id || busyInstanceId === selectedInstance.id ? (
                        <IconLoader2 size={14} className={styles.spin} />
                      ) : (
                        <IconQrcode size={14} />
                      )}
                      Salvar e parear outro número
                    </button>
                  ) : null}
                </div>
              </section>

              <div className={classNames(styles.actions, styles.instanceActionsCentered)}>
                <button
                  className={styles.primaryButton}
                  onClick={() => openPairingMethodModal(selectedInstance.id)}
                  disabled={busyInstanceId === selectedInstance.id}
                >
                  {busyInstanceId === selectedInstance.id ? (
                    <IconLoader2 size={14} className={styles.spin} />
                  ) : (
                    <IconQrcode size={14} />
                  )}
                  {selectedInstance.purpose === "admin_system" &&
                  isConnectedInstanceStatus(selectedInstance.sessionStatus)
                    ? "Parear outro número"
                    : "Conectar e parear"}
                </button>
                <button
                  className={styles.ghostButton}
                  onClick={() => void runInstanceAction(selectedInstance.id, "restart")}
                  disabled={busyInstanceId === selectedInstance.id}
                >
                  <IconRotateClockwise2 size={14} />
                  Reiniciar
                </button>
                <button
                  className={styles.ghostButton}
                  onClick={() => void runInstanceAction(selectedInstance.id, "logout")}
                  disabled={busyInstanceId === selectedInstance.id}
                >
                  <IconLogout2 size={14} />
                  Logout
                </button>
                <button
                  className={styles.ghostButton}
                  onClick={() => handleInstanceRenewClick(selectedInstance)}
                  disabled={busyInstanceId === selectedInstance.id}
                >
                  <IconCreditCard size={14} />
                  Renovar perfil
                </button>
              </div>
            </div>
          </>
        ) : null}

        {section === "affiliates" && selectedAffiliateProviderKey === BOT_ADMIN_AFFILIATE_PROVIDER_KEY ? (
          <>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                {isMobileViewport ? (
                  <button
                    type="button"
                    className={styles.mobileBackButton}
                    onClick={() => setMobileView("list")}
                    aria-label="Voltar para lista"
                  >
                    <IconArrowLeft size={18} />
                  </button>
                ) : null}
                <div>
                  <h3>Bot Admin afiliados</h3>
                  <small className={styles.instanceHeaderMeta}>
                    <span>Link fixo, comissões e divulgação automática</span>
                    <span className={classNames(styles.instanceStatusTag, styles.instanceStatusConnected)}>
                      Nativo
                    </span>
                  </small>
                </div>
              </div>
            </header>

            <div className={styles.instanceWorkspace}>
              <BotAdminAffiliateManager
                showAutoShare
                logoUrl={brandLogo}
                brandName={brandName}
                groups={groups.map((group) => ({
                  id: group.id,
                  name: group.name,
                  instanceName: group.instanceName,
                  instancePhone: group.instancePhone,
                  status: group.status,
                  adminsOnly: Boolean(group.metadata?.adminsOnly),
                  locked: Boolean(group.metadata?.locked),
                }))}
              />
            </div>
          </>
        ) : null}

        {section === "affiliates" && selectedAffiliateProviderKey !== BOT_ADMIN_AFFILIATE_PROVIDER_KEY && selectedAffiliateProvider ? (
          <>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                {isMobileViewport ? (
                  <button
                    type="button"
                    className={styles.mobileBackButton}
                    onClick={() => setMobileView("list")}
                    aria-label="Voltar para lista"
                  >
                    <IconArrowLeft size={18} />
                  </button>
                ) : null}
                <div>
                  <h3>{selectedAffiliateProvider.label}</h3>
                  <small className={styles.instanceHeaderMeta}>
                    <span>{selectedAffiliateProvider.connected ? "Conta conectada" : "Conta desconectada"}</span>
                    <span
                      className={classNames(
                        styles.instanceStatusTag,
                        selectedAffiliateProvider.connected
                          ? styles.instanceStatusConnected
                          : styles.instanceStatusDisconnected,
                      )}
                    >
                      {selectedAffiliateProvider.connected
                        ? "Conectado"
                        : resolveAffiliateProviderStatusLabel(selectedAffiliateProvider)}
                    </span>
                  </small>
                </div>
              </div>
            </header>

            <div className={styles.instanceWorkspace}>
              {isAffiliateAutomationProvider ? (
                <div className={styles.tabRow}>
                  <button
                    type="button"
                    className={classNames(styles.tabBtn, affiliateTab === "account" && styles.tabBtnActive)}
                    onClick={() => setAffiliateTab("account")}
                  >
                    <IconSettings size={14} />
                    Conta
                  </button>
                  <button
                    type="button"
                    className={classNames(styles.tabBtn, affiliateTab === "products" && styles.tabBtnActive)}
                    onClick={() => setAffiliateTab("products")}
                  >
                    <IconShoppingCart size={14} />
                    Produtos
                  </button>
                  <button
                    type="button"
                    className={classNames(styles.tabBtn, affiliateTab === "dispatch" && styles.tabBtnActive)}
                    onClick={() => setAffiliateTab("dispatch")}
                  >
                    <IconSpeakerphone size={14} />
                    Disparos
                  </button>
                  <button
                    type="button"
                    className={classNames(styles.tabBtn, affiliateTab === "message_model" && styles.tabBtnActive)}
                    onClick={() => setAffiliateTab("message_model")}
                  >
                    <IconPencil size={14} />
                    Modelo de mensagem
                  </button>
                  {isAffiliateShopeeProvider ? (
                    <button
                      type="button"
                      className={classNames(styles.tabBtn, affiliateTab === "insights" && styles.tabBtnActive)}
                      onClick={() => setAffiliateTab("insights")}
                    >
                      <IconChartBar size={14} />
                      Insights Shopee
                    </button>
                  ) : null}
                </div>
              ) : null}

              {(!isAffiliateAutomationProvider || affiliateTab === "account") ? (
                <section className={styles.instanceProfileCard}>
                  <div className={styles.instanceIdentity}>
                    {selectedAffiliateProvider.logoUrl ? (
                      <img
                        src={withCacheBust(
                          resolveProviderLogoUrl(selectedAffiliateProvider.logoUrl) || selectedAffiliateProvider.logoUrl,
                          selectedAffiliateProvider.updatedAt ?? selectedAffiliateProvider.provider,
                        )}
                        alt={`Logo ${selectedAffiliateProvider.label}`}
                        className={classNames(
                          styles.instanceProfileAvatarImage,
                          styles.providerLogoAvatarLarge,
                        )}
                      />
                    ) : (
                      <div className={styles.instanceProfileAvatar}>
                        <IconShoppingCart size={18} />
                      </div>
                    )}
                    <div className={styles.instanceIdentityText}>
                      <strong>{selectedAffiliateProvider.label}</strong>
                      <span
                        className={classNames(
                          styles.instanceStatusTag,
                          selectedAffiliateProvider.connected
                            ? styles.instanceStatusConnected
                            : styles.instanceStatusDisconnected,
                        )}
                      >
                        {selectedAffiliateProvider.connected ? "Conectado" : "Desconectado"}
                      </span>
                      <small>{selectedAffiliateProvider.description}</small>
                    </div>
                  </div>

                  {(selectedAffiliateProvider.supportsOAuth ||
                    selectedAffiliateProvider.provider === "shopee" ||
                    (Array.isArray(selectedAffiliateProvider.accounts) &&
                      selectedAffiliateProvider.accounts.length > 0)) ? (
                    <div className={styles.affiliateAccountToolbar}>
                      <div className={styles.affiliateAccountToolbarActions}>
                        {selectedAffiliateProvider.supportsOAuth ? (
                          <>
                            <button
                              className={styles.primaryButton}
                              onClick={() => void startAffiliateOAuth(selectedAffiliateProvider.provider)}
                              disabled={
                                affiliateActionProvider === selectedAffiliateProvider.provider ||
                                !selectedAffiliateProvider.enabled
                              }
                            >
                              {affiliateActionProvider === selectedAffiliateProvider.provider ? (
                                <IconLoader2 size={14} className={styles.spin} />
                              ) : (
                                <IconPlus size={14} />
                              )}
                              Conectar nova conta
                            </button>
                            <button
                              className={styles.ghostButton}
                              onClick={() => void refreshAffiliateToken(selectedAffiliateProvider.provider)}
                              disabled={
                                affiliateActionProvider === selectedAffiliateProvider.provider ||
                                selectedAffiliateProviderConnectionId === null ||
                                !selectedAffiliateProvider.connected
                              }
                            >
                              <IconRefresh size={14} />
                              Atualizar token
                            </button>
                            <button
                              className={classNames(styles.ghostButton, styles.dangerButton)}
                              onClick={() => void disconnectAffiliateProvider(selectedAffiliateProvider.provider)}
                              disabled={
                                affiliateActionProvider === selectedAffiliateProvider.provider ||
                                selectedAffiliateProviderConnectionId === null
                              }
                            >
                              <IconTrash size={14} />
                              Remover conta ativa
                            </button>
                          </>
                        ) : null}

                        {!selectedAffiliateProvider.supportsOAuth &&
                        selectedAffiliateProvider.provider === "shopee" ? (
                          <>
                            <button
                              className={styles.primaryButton}
                              onClick={() => openAffiliateProviderCredentialsModal(selectedAffiliateProvider)}
                              disabled={affiliateActionProvider === selectedAffiliateProvider.provider}
                            >
                              {affiliateActionProvider === selectedAffiliateProvider.provider ? (
                                <IconLoader2 size={14} className={styles.spin} />
                              ) : (
                                <IconPlus size={14} />
                              )}
                              Adicionar conta
                            </button>
                            <button
                              className={classNames(styles.ghostButton, styles.dangerButton)}
                              onClick={() => void disconnectAffiliateProvider(selectedAffiliateProvider.provider)}
                              disabled={
                                affiliateActionProvider === selectedAffiliateProvider.provider ||
                                selectedAffiliateProviderConnectionId === null
                              }
                            >
                              <IconTrash size={14} />
                              Remover conta ativa
                            </button>
                          </>
                        ) : null}
                      </div>
                      {Array.isArray(selectedAffiliateProvider.accounts) &&
                      selectedAffiliateProvider.accounts.length > 0 ? (
                        <label className={styles.affiliateAccountSelectorCompact}>
                          <span>Conta ativa</span>
                          <select
                            value={String(selectedAffiliateProviderAccount?.id ?? "")}
                            onChange={(event) => {
                              const nextConnectionId = Math.floor(Number(event.target.value));
                              if (!Number.isFinite(nextConnectionId) || nextConnectionId <= 0) return;
                              void selectAffiliateProviderAccount(
                                selectedAffiliateProvider.provider,
                                nextConnectionId,
                              );
                            }}
                            disabled={affiliateActionProvider === selectedAffiliateProvider.provider}
                          >
                            {selectedAffiliateProvider.accounts.map((account) => (
                              <option
                                key={`affiliate-provider-account-${selectedAffiliateProvider.provider}-${account.id}`}
                                value={String(account.id)}
                              >
                                {account.accountName || account.accountId || `Conta #${account.id}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}

                  <div className={styles.instanceProfileGrid}>
                    <label>
                      Plataforma
                      <input value={selectedAffiliateProvider.label} readOnly />
                    </label>
                    <label>
                      Conta afiliada
                      <input
                        value={selectedAffiliateProvider.accountName || selectedAffiliateProvider.accountId || "—"}
                        readOnly
                      />
                    </label>
                    <label>
                      Expiração do token
                      <input value={selectedAffiliateProvider.expiresAt ? formatDateTime(selectedAffiliateProvider.expiresAt) : "—"} readOnly />
                    </label>
                    <label className={styles.instanceProfileGridFull}>
                      Escopos conectados
                      <textarea
                        rows={3}
                        value={
                          selectedAffiliateProvider.scopes.length > 0
                            ? selectedAffiliateProvider.scopes.join(", ")
                            : "Escopos padrão da aplicação."
                        }
                        readOnly
                      />
                    </label>
                    {selectedAffiliateProvider.lastError ? (
                      <label className={styles.instanceProfileGridFull}>
                        Último erro
                        <textarea rows={3} value={selectedAffiliateProvider.lastError} readOnly />
                      </label>
                    ) : null}
                  </div>

                  {selectedAffiliateProvider.provider === "mercadolivre" ? (
                    <>
                      <div className={styles.instanceIdentityText}>
                        <strong>Resolvedor automático por cookie</strong>
                        <small>
                          Para usar autoAffiliate na importação por termo, o usuário precisa ter cookie válido do Link Builder.
                        </small>
                      </div>
                      <div className={styles.instanceProfileGrid}>
                        <div className={classNames(styles.instanceProfileGridFull, styles.affiliateResolverHeaderRow)}>
                          <span
                            className={classNames(
                              styles.instanceStatusTag,
                              affiliateMlCookieStatus.className,
                            )}
                          >
                            {affiliateMlCookieStatus.label}
                          </span>
                          <div className={styles.affiliateResolverHeaderActions}>
                            <button
                              className={styles.primaryButton}
                              onClick={() => void saveAffiliateMlResolver()}
                              disabled={savingAffiliateMlResolver || loadingAffiliateMlResolver}
                            >
                              {savingAffiliateMlResolver ? (
                                <IconLoader2 size={14} className={styles.spin} />
                              ) : (
                                <IconDeviceFloppy size={14} />
                              )}
                              Salvar cookie
                            </button>
                            <button
                              className={classNames(styles.ghostButton, styles.dangerButton)}
                              onClick={() => void clearAffiliateMlResolver()}
                              disabled={clearingAffiliateMlResolver || !affiliateMlResolver.hasCookie}
                            >
                              {clearingAffiliateMlResolver ? (
                                <IconLoader2 size={14} className={styles.spin} />
                              ) : (
                                <IconTrash size={14} />
                              )}
                              Limpar cookie
                            </button>
                          </div>
                        </div>
                        <label className={styles.instanceProfileGridFull}>
                          Cookie da sessão Mercado Livre
                          <textarea
                            rows={4}
                            value={affiliateMlCookieInput}
                            onChange={(event) => setAffiliateMlCookieInput(event.target.value)}
                            placeholder="cole aqui: nome=valor; nome2=valor2; ..."
                          />
                        </label>
                        <label>
                          Tag afiliada (editável)
                          <input
                            value={affiliateMlTagInput}
                            onChange={(event) => setAffiliateMlTagInput(event.target.value)}
                            placeholder="ex.: reisdouglas20220807225431"
                          />
                        </label>
                        <label>
                          Última validação
                          <input value={formatDateTime(affiliateMlResolver.lastValidatedAt)} readOnly />
                        </label>
                        <label className={classNames(styles.instanceProfileGridFull, styles.toggleField)}>
                          <span>Ativar resolvedor automático</span>
                          <button
                            type="button"
                            className={classNames(
                              styles.toggleSwitch,
                              affiliateMlResolver.enabled && styles.toggleSwitchOn,
                            )}
                            aria-pressed={affiliateMlResolver.enabled}
                            onClick={() => void toggleAffiliateMlResolverEnabled()}
                            disabled={
                              savingAffiliateMlResolver ||
                              loadingAffiliateMlResolver ||
                              togglingAffiliateMlResolver ||
                              (!affiliateMlResolver.enabled && affiliateMlResolver.isValid !== true)
                            }
                          >
                            <span />
                          </button>
                        </label>
                        <label className={styles.instanceProfileGridFull}>
                          Mensagem do resolvedor
                          <textarea
                            rows={2}
                            value={
                              affiliateMlResolver.lastError ||
                              (affiliateMlResolver.hasCookie
                                ? affiliateMlResolver.enabled
                                  ? "Cookie válido e resolvedor ativo para geração automática."
                                  : "Cookie válido. Ative o toggle para usar o resolvedor automático."
                                : "Nenhum cookie salvo.")
                            }
                            readOnly
                          />
                        </label>
                        <label className={styles.instanceProfileGridFull}>
                          Informações detectadas
                          <input
                            value={`cookie: ${affiliateMlResolver.hasCookie ? "ok" : "não"} | csrf: ${affiliateMlResolver.hasCsrfToken ? "ok" : "não"} | tag: ${affiliateMlResolver.tag || "não definida"}`}
                            readOnly
                          />
                        </label>
                        <label className={styles.instanceProfileGridFull}>
                          Cookies detectados (nomes)
                          <input value={affiliateMlResolver.cookieHint || "—"} readOnly />
                        </label>
                      </div>
                    </>
                  ) : null}
                </section>
              ) : null}

              {isAffiliateAutomationProvider && affiliateTab === "products" ? (
                <section className={styles.instanceProfileCard}>
                  <div className={styles.instanceIdentityText}>
                    <strong>Produtos afiliados</strong>
                    <small>Cards salvos para uso rápido de afiliados.</small>
                  </div>
                  <div className={styles.affiliateProductsToolbar}>
                    <button
                      className={classNames(styles.primaryButton, styles.affiliateButtonCompact)}
                      onClick={() => setIsAffiliateMlCreateModalOpen(true)}
                      disabled={!selectedAffiliateProvider.connected}
                    >
                      <IconPlus size={14} />
                      Criar produto
                    </button>
                    <button
                      className={classNames(styles.ghostButton, styles.affiliateButtonCompact)}
                      onClick={() => openAffiliateMlImportModal()}
                      disabled={!selectedAffiliateProvider.connected || importingAffiliateMlProducts || affiliateImportJobActive}
                    >
                      <IconApi size={14} />
                      Importar produtos
                    </button>
                    <button
                      className={classNames(styles.ghostButton, styles.affiliateButtonCompact)}
                      onClick={() => void syncAffiliateMlLinks()}
                      disabled={loadingAffiliateMlLinks || syncingAffiliateMlLinks}
                    >
                      {syncingAffiliateMlLinks ? (
                        <IconLoader2 size={14} className={styles.spin} />
                      ) : (
                        <IconRefresh size={14} />
                      )}
                      Atualizar lista
                    </button>
                    <label className={styles.affiliateCategoryFilterField}>
                      <span>Filtrar categoria</span>
                      <select
                        value={affiliateMlListCategoryFilter}
                        onChange={(event) => setAffiliateMlListCategoryFilter(event.target.value)}
                        disabled={loadingAffiliateMlLinks}
                      >
                        {affiliateMlCategoryFilterOptions.map((entry) => (
                          <option key={`affiliate-category-filter-${entry.value}`} value={entry.value}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.affiliateCategoryFilterField}>
                      <span>Exibir</span>
                      <select
                        value={affiliateMlDisplayLimitInput}
                        onChange={(event) => setAffiliateMlDisplayLimitInput(event.target.value)}
                        disabled={loadingAffiliateMlLinks}
                      >
                        {AFFILIATE_PRODUCT_DISPLAY_LIMIT_OPTIONS.map((option) => (
                          <option key={`affiliate-display-limit-${option}`} value={String(option)}>
                            {option === 0 ? "Todos" : `${option} itens`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {affiliateImportJob ? (
                    <div className={styles.groupImportNotification}>
                      <div className={styles.participantImportStatusHead}>
                        <strong>Importação de produtos em background</strong>
                        <div className={styles.participantImportStatusHeadActions}>
                          <span
                            className={classNames(
                              styles.instanceStatusTag,
                              affiliateImportJobStatusClassName,
                            )}
                          >
                            {affiliateImportJobStatusLabel}
                          </span>
                          {!affiliateImportJobActive ? (
                            <button
                              type="button"
                              className={classNames(styles.iconBtn, styles.participantImportDismissButton)}
                              onClick={dismissAffiliateImportJob}
                              aria-label="Ocultar notificação de importação"
                            >
                              <IconX size={14} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className={classNames(styles.participantImportProgress, affiliateImportProgressClassName)}>
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, affiliateImportJob.progressPercent))}%`,
                          }}
                        />
                      </div>
                      <small className={styles.instanceHeaderMeta}>
                        Processados: {affiliateImportJob.processed}/{Math.max(affiliateImportJob.total, affiliateImportJob.processed)} ·
                        {" "}Importados: {affiliateImportJob.imported} ·
                        {" "}Falhas: {affiliateImportJob.failed}
                      </small>
                      {affiliateImportJob.lastMessage ? (
                        <small className={styles.instanceHeaderMeta}>{affiliateImportJob.lastMessage}</small>
                      ) : null}
                      {affiliateImportJob.lastError ? (
                        <small className={styles.errorInline}>{affiliateImportJob.lastError}</small>
                      ) : null}
                      <div className={styles.groupImportActionRow}>
                        {affiliateImportJobActive ? (
                          <button
                            type="button"
                            className={classNames(styles.ghostButton, styles.compactButton, styles.dangerButton)}
                            onClick={cancelAffiliateImportJob}
                            disabled={cancellingAffiliateImportJob}
                          >
                            {cancellingAffiliateImportJob ? (
                              <IconLoader2 size={14} className={styles.spin} />
                            ) : (
                              <IconX size={14} />
                            )}
                            Cancelar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={classNames(styles.ghostButton, styles.compactButton)}
                            onClick={() => void refreshAffiliateMlLinks({ silent: true })}
                          >
                            <IconRefresh size={14} />
                            Atualizar lista
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                  <div className={styles.affiliateProductsBulkToolbar}>
                    <small className={styles.affiliateProductCounter}>
                      Exibindo {visibleAffiliateMlLinks.length} de {filteredAffiliateMlLinks.length} item(ns)
                      {affiliateMlLinks.length !== filteredAffiliateMlLinks.length ? ` (total: ${affiliateMlLinks.length})` : ""}
                      {" · "}
                      {selectedAffiliateMlCount} selecionado(s)
                    </small>
                    <div className={styles.affiliateProductBulkActions}>
                      <button
                        className={classNames(styles.ghostButton, styles.affiliateButtonCompact)}
                        onClick={() =>
                          setAffiliateMlSelectedItemIds((current) => {
                            const next = { ...current };
                            if (allVisibleAffiliateMlSelected) {
                              visibleAffiliateMlLinks.forEach((entry) => {
                                delete next[entry.itemId];
                              });
                              return next;
                            }
                            visibleAffiliateMlLinks.forEach((entry) => {
                              next[entry.itemId] = true;
                            });
                            return next;
                          })
                        }
                        disabled={visibleAffiliateMlLinks.length === 0 || loadingAffiliateMlLinks || removingAffiliateMlBulk}
                      >
                        <IconCheck size={14} />
                        {allVisibleAffiliateMlSelected ? "Desmarcar exibidos" : "Selecionar exibidos"}
                      </button>
                      <button
                        className={classNames(styles.ghostButton, styles.affiliateButtonCompact)}
                        onClick={() => setAffiliateMlSelectedItemIds({})}
                        disabled={selectedAffiliateMlCount === 0 || removingAffiliateMlBulk}
                      >
                        Limpar seleção
                      </button>
                      <button
                        className={classNames(styles.ghostButton, styles.dangerButton, styles.affiliateButtonCompact)}
                        onClick={() =>
                          void removeAffiliateMlLinksBulk({
                            itemIds: Object.keys(affiliateMlSelectedItemIds).filter((itemId) => affiliateMlSelectedItemIds[itemId]),
                          })
                        }
                        disabled={selectedAffiliateMlCount === 0 || removingAffiliateMlBulk || loadingAffiliateMlLinks}
                      >
                        {removingAffiliateMlBulk ? <IconLoader2 size={14} className={styles.spin} /> : <IconTrash size={14} />}
                        Remover selecionados
                      </button>
                      <button
                        className={classNames(styles.ghostButton, styles.dangerButton, styles.affiliateButtonCompact)}
                        onClick={() => void removeAffiliateMlLinksBulk({ all: true })}
                        disabled={affiliateMlLinks.length === 0 || removingAffiliateMlBulk || loadingAffiliateMlLinks}
                      >
                        <IconTrash size={14} />
                        Remover todos
                      </button>
                    </div>
                  </div>
                  <div className={styles.affiliateAutoSyncCompact}>
                    <div className={styles.affiliateAutoSyncCompactInfo}>
                      <strong>Varredura automática</strong>
                      <small>
                        {affiliateMlAutoSyncConfig.enabled
                          ? affiliateMlAutoSyncConfig.refreshExisting && affiliateMlAutoSyncConfig.discoverNew
                            ? "Atualiza existentes + captura novos."
                            : affiliateMlAutoSyncConfig.refreshExisting
                              ? "Somente atualiza produtos existentes."
                              : affiliateMlAutoSyncConfig.discoverNew
                                ? "Somente captura novos produtos."
                                : "Sem ações selecionadas."
                          : "Desativada."}
                        {" "}
                        Última varredura: {formatDateTime(affiliateMlAutoSyncConfig.lastRunAt)}.
                      </small>
                      <small>Filtros ativos: {affiliateAutoSyncFiltersSummary}.</small>
                      {affiliateMlAutoSyncConfig.lastError ? (
                        <small className={styles.errorInline}>
                          Último erro da varredura: {affiliateMlAutoSyncConfig.lastError}
                        </small>
                      ) : null}
                    </div>
                    <div className={styles.affiliateAutoSyncCompactActions}>
                      <button
                        type="button"
                        className={classNames(styles.ghostButton, styles.affiliateButtonCompact)}
                        onClick={() =>
                          void saveAffiliateMlAutoSyncConfig({
                            enabled: !affiliateMlAutoSyncConfig.enabled,
                          })
                        }
                        disabled={savingAffiliateMlAutoSync || loadingAffiliateMlAutoSync}
                      >
                        {affiliateMlAutoSyncConfig.enabled ? "Desativar varredura" : "Ativar varredura"}
                      </button>
                      <button
                        type="button"
                        className={classNames(styles.ghostButton, styles.affiliateButtonCompact)}
                        onClick={openAffiliateAutoSyncFiltersModal}
                        disabled={savingAffiliateMlAutoSync || loadingAffiliateMlAutoSync}
                      >
                        <IconSettings size={14} />
                        Configurar varredura
                      </button>
                    </div>
                  </div>
                  <div className={styles.affiliateProductListWrap}>
                    {loadingAffiliateMlLinks ? (
                      <small className={styles.instanceHeaderMeta}>Carregando produtos afiliados...</small>
                    ) : filteredAffiliateMlLinks.length === 0 ? (
                      <small className={styles.instanceHeaderMeta}>
                        {affiliateMlLinks.length === 0
                          ? "Nenhum produto cadastrado ainda. Use Criar produto ou Importar produtos para montar os cards."
                          : "Nenhum produto para o filtro de categoria selecionado."}
                      </small>
                    ) : (
                      <div className={styles.affiliateProductList}>
                        {visibleAffiliateMlLinks.map((entry) => (
                          <article
                            key={`${entry.itemId}-${entry.id}`}
                            className={classNames(
                              styles.affiliateProductCard,
                              affiliateMlSelectedItemIds[entry.itemId] && styles.affiliateProductCardSelected,
                            )}
                          >
                            <label className={styles.affiliateProductSelectWrap}>
                              <input
                                type="checkbox"
                                checked={Boolean(affiliateMlSelectedItemIds[entry.itemId])}
                                onChange={(event) =>
                                  setAffiliateMlSelectedItemIds((current) => ({
                                    ...current,
                                    [entry.itemId]: event.target.checked,
                                  }))
                                }
                                disabled={removingAffiliateMlBulk || removingAffiliateMlItemId === entry.itemId}
                              />
                            </label>
                            <div className={styles.affiliateProductMedia}>
                              {entry.imageUrl ? (
                                <img
                                  src={entry.imageUrl}
                                  alt={entry.title || entry.itemId}
                                  className={styles.affiliateProductImage}
                                />
                              ) : (
                                <div className={styles.affiliateProductImageFallback}>
                                  <IconShoppingCart size={18} />
                                </div>
                              )}
                            </div>
                            <div className={styles.affiliateProductBody}>
                              <div className={styles.affiliateProductHeader}>
                                <strong title={entry.title || entry.itemId}>{entry.title || entry.itemId}</strong>
                                <span
                                  className={classNames(
                                    styles.instanceStatusTag,
                                    entry.isActive !== false
                                      ? styles.instanceStatusConnected
                                      : styles.instanceStatusDisconnected,
                                  )}
                                >
                                  {entry.isActive !== false ? "Ativo" : "Inativo"}
                                </span>
                              </div>
                              <small className={styles.affiliateProductMeta}>Item: {entry.itemId}</small>
                              <small className={styles.affiliateProductMeta}>
                                Categoria: {entry.categoryId || "Sem categoria"}
                              </small>
                              <small className={styles.affiliateProductMeta}>
                                Estoque:
                                {" "}
                                {entry.available === null
                                  ? "Não verificado"
                                  : entry.available
                                    ? "Disponível"
                                    : "Indisponível"}
                              </small>
                              {entry.priceFormatted || entry.priceAmount !== null ? (
                                <small className={styles.affiliateProductMeta}>
                                  Preço: {entry.priceFormatted || `R$ ${formatCurrency(entry.priceAmount ?? 0)}`}
                                </small>
                              ) : null}
                              {entry.commissionRate ? (
                                <small className={styles.affiliateProductMeta}>
                                  Comissão: {entry.commissionRate}
                                </small>
                              ) : null}
                              {entry.ratingStar ? (
                                <small className={styles.affiliateProductMeta}>
                                  ⭐ Avaliação: {entry.ratingStar}
                                </small>
                              ) : null}
                              {entry.note ? (
                                <small className={styles.affiliateProductMeta}>{entry.note}</small>
                              ) : null}
                              {entry.couponCode ? (
                                <small className={styles.affiliateProductMeta}>
                                  Cupom: {entry.couponCode}
                                </small>
                              ) : null}
                              {entry.couponDetails ? (
                                <small className={styles.affiliateProductMeta}>{entry.couponDetails}</small>
                              ) : null}
                              <div className={styles.affiliateProductLinks}>
                                <a
                                  href={entry.productUrl || entry.affiliateUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Abrir produto
                                </a>
                                <a href={entry.affiliateUrl} target="_blank" rel="noreferrer">
                                  Link afiliado
                                </a>
                                <small>Atualizado em: {formatDateTime(entry.updatedAt)}</small>
                              </div>
                            </div>
                            <div className={styles.affiliateProductCardActions}>
                              <label className={styles.affiliateProductToggle}>
                                <span>{entry.isActive !== false ? "Ativo" : "Inativo"}</span>
                                <button
                                  type="button"
                                  className={classNames(
                                    styles.toggleSwitch,
                                    entry.isActive !== false && styles.toggleSwitchOn,
                                  )}
                                  onClick={() => void toggleAffiliateMlLinkActive(entry)}
                                  disabled={
                                    removingAffiliateMlBulk ||
                                    removingAffiliateMlItemId === entry.itemId ||
                                    togglingAffiliateMlItemId === entry.itemId
                                  }
                                  aria-label={entry.isActive !== false ? "Desativar produto" : "Ativar produto"}
                                  title={entry.isActive !== false ? "Desativar produto" : "Ativar produto"}
                                >
                                  <span />
                                </button>
                              </label>
                              <button
                                className={styles.ghostButton}
                                onClick={() => openAffiliateMlEditModal(entry)}
                                disabled={
                                  removingAffiliateMlBulk ||
                                  removingAffiliateMlItemId === entry.itemId ||
                                  togglingAffiliateMlItemId === entry.itemId
                                }
                              >
                                <IconPencil size={14} />
                                Editar
                              </button>
                              <button
                                className={classNames(styles.ghostButton, styles.dangerButton)}
                                onClick={() => void removeAffiliateMlLink(entry.itemId)}
                                disabled={
                                  removingAffiliateMlBulk ||
                                  removingAffiliateMlItemId === entry.itemId ||
                                  togglingAffiliateMlItemId === entry.itemId
                                }
                              >
                                {removingAffiliateMlItemId === entry.itemId ? (
                                  <IconLoader2 size={14} className={styles.spin} />
                                ) : (
                                  <IconTrash size={14} />
                                )}
                                Remover
                              </button>
                            </div>
                          </article>
                        ))}
                        {visibleAffiliateMlLinks.length < filteredAffiliateMlLinks.length ? (
                          <small className={styles.instanceHeaderMeta}>
                            Mostrando os primeiros {visibleAffiliateMlLinks.length} itens. Ajuste o campo
                            {" "}
                            <strong>Exibir</strong>
                            {" "}
                            para ver mais.
                          </small>
                        ) : null}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {isAffiliateShopeeProvider && isAffiliateAutomationProvider && affiliateTab === "insights" ? (
                <section className={styles.instanceProfileCard}>
                  <div className={styles.instanceIdentityText}>
                    <strong>Insights Shopee</strong>
                    <small>
                      Painel de performance oficial com comissões e conversões da Open API da Shopee.
                    </small>
                  </div>

                  <div className={styles.affiliateShopeePanel}>
                    <div className={styles.affiliateShopeePanelHeader}>
                      <strong>Comissões e conversões</strong>
                      <div className={styles.affiliateShopeeControlRow}>
                        <label className={styles.affiliateShopeeField}>
                          <span>Período (dias)</span>
                          <select
                            value={shopeePerformancePeriodDaysInput}
                            onChange={(event) => setShopeePerformancePeriodDaysInput(event.target.value)}
                            disabled={loadingShopeePerformance}
                          >
                            {SHOPEE_INSIGHTS_PERIOD_OPTIONS.map((entry) => (
                              <option key={`shopee-performance-days-${entry}`} value={String(entry)}>
                                {entry} dias
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.affiliateShopeeField}>
                          <span>Limite de linhas</span>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={shopeePerformanceLimitInput}
                            onChange={(event) => setShopeePerformanceLimitInput(event.target.value)}
                            onBlur={() => setShopeePerformanceLimitInput(String(shopeePerformanceLimit))}
                            disabled={loadingShopeePerformance}
                          />
                        </label>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => void refreshShopeePerformance()}
                          disabled={loadingShopeePerformance}
                        >
                          {loadingShopeePerformance ? (
                            <IconLoader2 size={14} className={styles.spin} />
                          ) : (
                            <IconRefresh size={14} />
                          )}
                          Atualizar comissões
                        </button>
                      </div>
                    </div>

                    <div className={styles.affiliateShopeeStatsGrid}>
                      <article className={styles.affiliateShopeeStatCard}>
                        <small>Conversões</small>
                        <strong>{shopeePerformance.summary.conversions}</strong>
                      </article>
                      <article className={styles.affiliateShopeeStatCard}>
                        <small>Pedidos</small>
                        <strong>{shopeePerformance.summary.orders}</strong>
                      </article>
                      <article className={styles.affiliateShopeeStatCard}>
                        <small>Itens</small>
                        <strong>{shopeePerformance.summary.items}</strong>
                      </article>
                      <article className={styles.affiliateShopeeStatCard}>
                        <small>Comissão total</small>
                        <strong>{formatCurrency(shopeePerformance.summary.totalCommission)}</strong>
                      </article>
                      <article className={styles.affiliateShopeeStatCard}>
                        <small>Comissão líquida</small>
                        <strong>{formatCurrency(shopeePerformance.summary.netCommission)}</strong>
                      </article>
                      <article className={styles.affiliateShopeeStatCard}>
                        <small>Cliques com compra</small>
                        <strong>{shopeePerformance.summary.clicksWithPurchase}</strong>
                      </article>
                    </div>

                    <div className={styles.affiliateShopeeCountersGrid}>
                      <div className={styles.affiliateShopeeCounterBlock}>
                        <small>Status de conversão</small>
                        <div className={styles.affiliateShopeeCounterTags}>
                          {shopeePerformance.summary.conversionStatus.length > 0 ? (
                            shopeePerformance.summary.conversionStatus.map((entry) => (
                              <span key={`shopee-conversion-status-${entry.status}`} className={styles.instanceStatusTag}>
                                {entry.status}: {entry.count}
                              </span>
                            ))
                          ) : (
                            <span className={styles.instanceStatusTag}>Sem dados</span>
                          )}
                        </div>
                      </div>
                      <div className={styles.affiliateShopeeCounterBlock}>
                        <small>Status de pedido</small>
                        <div className={styles.affiliateShopeeCounterTags}>
                          {shopeePerformance.summary.orderStatus.length > 0 ? (
                            shopeePerformance.summary.orderStatus.map((entry) => (
                              <span key={`shopee-order-status-${entry.status}`} className={styles.instanceStatusTag}>
                                {entry.status}: {entry.count}
                              </span>
                            ))
                          ) : (
                            <span className={styles.instanceStatusTag}>Sem dados</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={styles.affiliateShopeeTableWrap}>
                      {shopeePerformance.entries.length === 0 ? (
                        <small className={styles.instanceHeaderMeta}>
                          Nenhum registro de conversão no período selecionado.
                        </small>
                      ) : (
                        <table className={styles.affiliateShopeeTable}>
                          <thead>
                            <tr>
                              <th>Conversão</th>
                              <th>Compra</th>
                              <th>Status</th>
                              <th>Comissão</th>
                              <th>Pedido/item</th>
                              <th>Origem</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shopeePerformance.entries.map((entry, index) => {
                              const firstOrder = entry.orders[0] || null;
                              const firstItem = firstOrder?.items?.[0] || null;
                              const firstItemName = firstItem?.itemName || "—";
                              const firstItemCommission =
                                firstItem && typeof firstItem.itemTotalCommission === "number"
                                  ? formatCurrency(firstItem.itemTotalCommission)
                                  : "—";
                              return (
                                <tr key={`shopee-conversion-row-${entry.conversionId || index}-${entry.clickTime || 0}`}>
                                  <td>
                                    <strong>{entry.conversionId || "—"}</strong>
                                    <small>{formatEpochDateTime(entry.clickTime)}</small>
                                  </td>
                                  <td>
                                    <strong>{formatEpochDateTime(entry.purchaseTime)}</strong>
                                    <small>{entry.orders.length} pedido(s)</small>
                                  </td>
                                  <td>
                                    <strong>{entry.conversionStatus || "—"}</strong>
                                    <small>{firstOrder?.orderStatus || "—"}</small>
                                  </td>
                                  <td>
                                    <strong>{formatCurrency(entry.totalCommission || 0)}</strong>
                                    <small>Líquida: {formatCurrency(entry.netCommission || 0)}</small>
                                  </td>
                                  <td>
                                    <strong>{firstItemName}</strong>
                                    <small>{firstItemCommission}</small>
                                  </td>
                                  <td>
                                    <strong>{entry.device || "—"}</strong>
                                    <small>{entry.referrer || entry.buyerType || "—"}</small>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {false ? (
                    <>
                  <div className={styles.affiliateShopeePanel}>
                    <div className={styles.affiliateShopeePanelHeader}>
                      <strong>Campanhas e ofertas oficiais</strong>
                      <div className={styles.affiliateShopeeControlRow}>
                        <label className={styles.affiliateShopeeField}>
                          <span>Palavra-chave</span>
                          <input
                            value={shopeeOfferKeywordInput}
                            onChange={(event) => setShopeeOfferKeywordInput(event.target.value)}
                            placeholder="Ex.: beleza, games, eletrônicos..."
                            disabled={loadingShopeeOffers}
                          />
                        </label>
                        <label className={styles.affiliateShopeeField}>
                          <span>Ordenação</span>
                          <select
                            value={shopeeOfferSortInput}
                            onChange={(event) => setShopeeOfferSortInput(event.target.value)}
                            disabled={loadingShopeeOffers}
                          >
                            {SHOPEE_OFFER_SORT_OPTIONS.map((entry) => (
                              <option key={`shopee-offer-sort-${entry.value}`} value={String(entry.value)}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.affiliateShopeeField}>
                          <span>Limite por bloco</span>
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={shopeeOfferLimitInput}
                            onChange={(event) => setShopeeOfferLimitInput(event.target.value)}
                            onBlur={() => setShopeeOfferLimitInput(String(shopeeOfferLimit))}
                            disabled={loadingShopeeOffers}
                          />
                        </label>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => void refreshShopeeOffers()}
                          disabled={loadingShopeeOffers}
                        >
                          {loadingShopeeOffers ? (
                            <IconLoader2 size={14} className={styles.spin} />
                          ) : (
                            <IconRefresh size={14} />
                          )}
                          Atualizar ofertas
                        </button>
                      </div>
                    </div>

                    <div className={styles.affiliateShopeeOfferSections}>
                      <div className={styles.affiliateShopeeOfferBlock}>
                        <div className={styles.affiliateShopeeOfferHeader}>
                          <strong>Campanhas Shopee (shopeeOfferV2)</strong>
                          <small>{shopeeOffers.campaigns.entries.length} campanha(s)</small>
                        </div>
                        <div className={styles.affiliateShopeeCardGrid}>
                          {shopeeOffers.campaigns.entries.length > 0 ? (
                            shopeeOffers.campaigns.entries.map((entry, index) => (
                              <article className={styles.affiliateShopeeOfferCard} key={`shopee-campaign-${entry.offerLink || index}`}>
                                <strong>{entry.offerName || "Campanha sem nome"}</strong>
                                <small>Tipo: {resolveShopeeOfferTypeLabel(entry.offerType)}</small>
                                <small>Comissão: {entry.commissionRate || "—"}</small>
                                <small>Início: {formatEpochDateTime(entry.periodStartTime)}</small>
                                <small>Fim: {formatEpochDateTime(entry.periodEndTime)}</small>
                                <div className={styles.affiliateProductLinks}>
                                  {entry.offerLink ? (
                                    <a href={entry.offerLink} target="_blank" rel="noreferrer">
                                      Abrir oferta
                                    </a>
                                  ) : null}
                                  {entry.originalLink ? (
                                    <a href={entry.originalLink} target="_blank" rel="noreferrer">
                                      Link original
                                    </a>
                                  ) : null}
                                </div>
                              </article>
                            ))
                          ) : (
                            <small className={styles.instanceHeaderMeta}>Nenhuma campanha retornada no momento.</small>
                          )}
                        </div>
                      </div>

                      <div className={styles.affiliateShopeeOfferBlock}>
                        <div className={styles.affiliateShopeeOfferHeader}>
                          <strong>Ofertas de lojas (shopOfferV2)</strong>
                          <small>{shopeeOffers.shopOffers.entries.length} loja(s)</small>
                        </div>
                        <div className={styles.affiliateShopeeCardGrid}>
                          {shopeeOffers.shopOffers.entries.length > 0 ? (
                            shopeeOffers.shopOffers.entries.map((entry, index) => (
                              <article className={styles.affiliateShopeeOfferCard} key={`shopee-shop-offer-${entry.offerLink || entry.shopId || index}`}>
                                <strong>{entry.shopName || "Loja sem nome"}</strong>
                                <small>Shop ID: {entry.shopId || "—"}</small>
                                <small>Comissão: {entry.commissionRate || "—"}</small>
                                <small>Rating: {entry.ratingStar || "—"}</small>
                                <small>Cobertura seller: {entry.sellerCommCoveRatio || "—"}</small>
                                <div className={styles.affiliateProductLinks}>
                                  {entry.offerLink ? (
                                    <a href={entry.offerLink} target="_blank" rel="noreferrer">
                                      Abrir oferta
                                    </a>
                                  ) : null}
                                  {entry.originalLink ? (
                                    <a href={entry.originalLink} target="_blank" rel="noreferrer">
                                      Link original
                                    </a>
                                  ) : null}
                                </div>
                              </article>
                            ))
                          ) : (
                            <small className={styles.instanceHeaderMeta}>Nenhuma oferta de loja retornada no momento.</small>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles.affiliateShopeePanel}>
                    <div className={styles.affiliateShopeePanelHeader}>
                      <strong>Feeds oficiais de catálogo (FULL e DELTA)</strong>
                      <div className={styles.affiliateShopeeControlRow}>
                        <label className={styles.affiliateShopeeField}>
                          <span>Modo do feed</span>
                          <select
                            value={shopeeSelectedFeedMode}
                            onChange={(event) =>
                              setShopeeSelectedFeedMode(event.target.value === "DELTA" ? "DELTA" : "FULL")
                            }
                            disabled={loadingShopeeFeeds}
                          >
                            <option value="FULL">FULL (catálogo completo)</option>
                            <option value="DELTA">DELTA (novos/remoções)</option>
                          </select>
                        </label>
                        <label className={styles.affiliateShopeeField}>
                          <span>Datafeed</span>
                          <select
                            value={shopeeSelectedFeedId}
                            onChange={(event) => setShopeeSelectedFeedId(event.target.value)}
                            disabled={loadingShopeeFeeds || shopeeSelectedFeedEntries.length === 0}
                          >
                            {shopeeSelectedFeedEntries.length === 0 ? (
                              <option value="">Nenhum feed disponível</option>
                            ) : (
                              shopeeSelectedFeedEntries.map((entry) => (
                                <option key={`shopee-feed-${entry.datafeedId}`} value={entry.datafeedId}>
                                  {(entry.datafeedName || entry.datafeedId).slice(0, 70)}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <label className={styles.affiliateShopeeField}>
                          <span>Preview de linhas</span>
                          <select
                            value={shopeeFeedPreviewLimitInput}
                            onChange={(event) => setShopeeFeedPreviewLimitInput(event.target.value)}
                            disabled={loadingShopeeFeedData}
                          >
                            {SHOPEE_FEED_PREVIEW_LIMIT_OPTIONS.map((entry) => (
                              <option key={`shopee-feed-preview-limit-${entry}`} value={String(entry)}>
                                {entry}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => void refreshShopeeFeeds()}
                          disabled={loadingShopeeFeeds}
                        >
                          {loadingShopeeFeeds ? (
                            <IconLoader2 size={14} className={styles.spin} />
                          ) : (
                            <IconRefresh size={14} />
                          )}
                          Atualizar feeds
                        </button>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => void refreshShopeeFeedData()}
                          disabled={loadingShopeeFeedData || !shopeeSelectedFeedId}
                        >
                          {loadingShopeeFeedData ? (
                            <IconLoader2 size={14} className={styles.spin} />
                          ) : (
                            <IconApi size={14} />
                          )}
                          Carregar preview
                        </button>
                      </div>
                    </div>

                    <small className={styles.instanceHeaderMeta}>
                      Feeds FULL: {shopeeFeedsByMode.FULL.length} | DELTA: {shopeeFeedsByMode.DELTA.length} | Feed selecionado:{" "}
                      {shopeeSelectedFeed?.datafeedName || shopeeSelectedFeedId || "—"}
                    </small>

                    <div className={styles.affiliateShopeeTableWrap}>
                      {!shopeeFeedData || shopeeFeedData.rows.length === 0 ? (
                        <small className={styles.instanceHeaderMeta}>
                          Selecione um feed e clique em carregar preview para visualizar os itens.
                        </small>
                      ) : (
                        <table className={styles.affiliateShopeeTable}>
                          <thead>
                            <tr>
                              <th>Item</th>
                              <th>Título</th>
                              <th>Preço</th>
                              <th>Tipo</th>
                              <th>Links</th>
                              <th>Campos</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shopeeFeedData.rows.map((row, index) => (
                              <tr key={`shopee-feed-row-${row.itemId || index}`}>
                                <td>
                                  <strong>{row.itemId || "—"}</strong>
                                </td>
                                <td>
                                  <strong>{row.title || "—"}</strong>
                                </td>
                                <td>
                                  <strong>
                                    {typeof row.salePrice === "number"
                                      ? formatCurrency(row.salePrice)
                                      : typeof row.price === "number"
                                        ? formatCurrency(row.price)
                                        : "—"}
                                  </strong>
                                </td>
                                <td>
                                  <strong>{row.updateType || "FULL"}</strong>
                                </td>
                                <td>
                                  <div className={styles.affiliateProductLinks}>
                                    {row.productLink ? (
                                      <a href={row.productLink} target="_blank" rel="noreferrer">
                                        Produto
                                      </a>
                                    ) : null}
                                    {row.offerLink ? (
                                      <a href={row.offerLink} target="_blank" rel="noreferrer">
                                        Oferta
                                      </a>
                                    ) : null}
                                  </div>
                                </td>
                                <td>
                                  <small>
                                    {row.columns ? `${Object.keys(row.columns).length} campo(s)` : "Sem JSON"}
                                  </small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    {shopeeFeedData ? (
                      <small className={styles.instanceHeaderMeta}>
                        Offset: {shopeeFeedData.pageInfo.offset} | Limite: {shopeeFeedData.pageInfo.limit} | Total:{" "}
                        {shopeeFeedData.pageInfo.totalCount} | Há mais:{" "}
                        {shopeeFeedData.pageInfo.hasMore ? "sim" : "não"}
                      </small>
                    ) : null}
                  </div>
                    </>
                  ) : null}
                </section>
              ) : null}

              {isAffiliateAutomationProvider && affiliateTab === "dispatch" ? (
                <>
                  <section className={styles.instanceProfileCard}>
                    <div className={styles.instanceIdentityText}>
                      <strong>Disparos automáticos</strong>
                      <small>
                        Crie ativações por grupo para enviar produtos em rodízio com temporizador.
                      </small>
                    </div>

                    <div className={styles.affiliateDispatchToolbar}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={openAffiliateDispatchCreateModal}
                        disabled={savingAffiliateMlGroupDispatchId !== null || affiliateDispatchCreatableGroups.length === 0}
                      >
                        <IconPlus size={14} />
                        Nova ativação
                      </button>
                      <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() => void refreshAffiliateMlGroupDispatches()}
                        disabled={loadingAffiliateMlGroupDispatches || savingAffiliateMlGroupDispatchId !== null}
                      >
                        {loadingAffiliateMlGroupDispatches ? (
                          <IconLoader2 size={14} className={styles.spin} />
                        ) : (
                          <IconRefresh size={14} />
                        )}
                        Atualizar ativações
                      </button>
                    </div>

                    <div className={styles.affiliateDispatchList}>
                      {loadingAffiliateMlGroupDispatches ? (
                        <small className={styles.instanceHeaderMeta}>Carregando ativações...</small>
                      ) : affiliateMlGroupDispatches.length === 0 ? (
                        <small className={styles.instanceHeaderMeta}>
                          Nenhuma ativação criada. Selecione um grupo acima e adicione.
                        </small>
                      ) : (
                        affiliateMlGroupDispatches.map((entry) => (
                          <article key={`affiliate-dispatch-${entry.id}`} className={styles.affiliateDispatchCard}>
                            <div className={styles.affiliateDispatchHeader}>
                              <div>
                                <strong>{entry.groupName}</strong>
                                <small>
                                  Instância: {instanceById.get(entry.instanceId)?.name || instanceById.get(entry.instanceId)?.phone || `#${entry.instanceId}`}
                                  {" · "}
                                  Delay: {Math.max(1, Math.floor(entry.delayMinutes))} min
                                  {" · "}
                                  Categoria: {entry.categoryRotationEnabled ? "rodízio ativo" : "livre"}
                                </small>
                              </div>
                              <span
                                className={classNames(
                                  styles.instanceStatusTag,
                                  entry.enabled ? styles.instanceStatusConnected : styles.instanceStatusDisconnected,
                                )}
                              >
                                {entry.enabled ? "Ativo" : "Pausado"}
                              </span>
                            </div>
                            <div className={styles.affiliateDispatchMeta}>
                              <small>Último envio: {formatDateTime(entry.lastSentAt)}</small>
                              {entry.lastItemId ? <small>Último item: {entry.lastItemId}</small> : null}
                              {entry.lastError ? <small className={styles.errorInline}>{entry.lastError}</small> : null}
                            </div>
                            <div className={styles.affiliateDispatchActions}>
                              <button
                                type="button"
                                className={styles.ghostButton}
                                onClick={() =>
                                  void updateAffiliateMlGroupDispatch(entry.id, {
                                    enabled: !entry.enabled,
                                  })
                                }
                                disabled={savingAffiliateMlGroupDispatchId === entry.id}
                              >
                                {savingAffiliateMlGroupDispatchId === entry.id ? (
                                  <IconLoader2 size={14} className={styles.spin} />
                                ) : (
                                  <IconSpeakerphone size={14} />
                                )}
                                {entry.enabled ? "Pausar" : "Ativar"}
                              </button>
                              <button
                                type="button"
                                className={styles.ghostButton}
                                onClick={() => openAffiliateDispatchEditModal(entry)}
                                disabled={savingAffiliateMlGroupDispatchId === entry.id}
                              >
                                <IconPencil size={14} />
                                Editar
                              </button>
                              <button
                                type="button"
                                className={classNames(styles.ghostButton, styles.dangerButton)}
                                onClick={() => void removeAffiliateMlGroupDispatch(entry)}
                                disabled={removingAffiliateMlGroupDispatchId === entry.id}
                              >
                                {removingAffiliateMlGroupDispatchId === entry.id ? (
                                  <IconLoader2 size={14} className={styles.spin} />
                                ) : (
                                  <IconTrash size={14} />
                                )}
                                Remover
                              </button>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                </>
              ) : null}

              {isAffiliateAutomationProvider && affiliateTab === "message_model" ? (
                <section className={styles.instanceProfileCard}>
                  <div className={styles.instanceIdentityText}>
                    <strong>Modelo de mensagem</strong>
                    <small>Edite o template que será enviado nos disparos de afiliados para os grupos.</small>
                  </div>
                  <div className={styles.affiliateTemplateHeader}>
                    <small className={styles.instanceHeaderMeta}>
                      Última atualização: {formatDateTime(affiliateMlMessageTemplate.updatedAt)}
                    </small>
                    <button
                      className={styles.primaryButton}
                      onClick={() => void saveAffiliateMlMessageTemplate()}
                      disabled={savingAffiliateMlMessageTemplate || loadingAffiliateMlMessageTemplate}
                    >
                      {savingAffiliateMlMessageTemplate ? (
                        <IconLoader2 size={14} className={styles.spin} />
                      ) : (
                        <IconDeviceFloppy size={14} />
                      )}
                      Salvar modelo
                    </button>
                  </div>

                  <div className={styles.affiliateTemplateWhatsappWrap}>
                    <div className={styles.affiliateTemplateWhatsappShell}>
                      <div className={styles.affiliateTemplateWhatsappHeader}>Seu modelo</div>
                      <div className={styles.affiliateTemplateWhatsappWallpaper}>
                        <article className={styles.affiliateTemplateWhatsappCard}>
                          <span className={styles.affiliateTemplateWhatsappFrom}>Você</span>
                          <div className={styles.affiliateTemplateWhatsappImageWrap}>
                            <img
                              src={brandLogo}
                              alt={brandName}
                              className={styles.affiliateTemplateWhatsappImage}
                            />
                          </div>
                          <textarea
                            rows={14}
                            value={affiliateMlVisualTemplateText}
                            onChange={(event) =>
                              setAffiliateMlVisualTemplateText(
                                event.target.value.slice(0, AFFILIATE_ML_TEMPLATE_MAX_TEXT),
                              )
                            }
                            placeholder="Digite o texto direto aqui. Use variáveis como {{titulo}}, {{preco_formatado}} e {{url}} (o {{url}} só entra quando botões estiverem desativados)."
                            className={styles.affiliateTemplateWhatsappEditor}
                            disabled={savingAffiliateMlMessageTemplate || loadingAffiliateMlMessageTemplate}
                          />
                          <span className={styles.affiliateTemplateWhatsappFooter}>
                            {affiliateMlTemplateFooterText.trim() || AFFILIATE_ML_DISPATCH_FOOTER_TEXT}
                          </span>
                          <span className={styles.affiliateTemplateWhatsappTime}>08:50</span>
                          <button
                            type="button"
                            className={styles.affiliateTemplateWhatsappButton}
                            tabIndex={-1}
                          >
                            {affiliateMlTemplateButtonText.trim() || AFFILIATE_ML_DEFAULT_BUTTON_TEXT}
                          </button>
                        </article>
                        <div className={styles.affiliateTemplateWhatsappMetaEditor}>
                          <label>
                            Título do provedor (API)
                            <input
                              value={affiliateMlTemplateProviderTitle}
                              onChange={(event) =>
                                setAffiliateMlTemplateProviderTitle(event.target.value.slice(0, 80))
                              }
                              placeholder={AFFILIATE_ML_DEFAULT_PROVIDER_TITLE}
                              disabled={savingAffiliateMlMessageTemplate || loadingAffiliateMlMessageTemplate}
                            />
                          </label>
                          <label>
                            Texto do botão
                            <input
                              value={affiliateMlTemplateButtonText}
                              onChange={(event) =>
                                setAffiliateMlTemplateButtonText(event.target.value.slice(0, 40))
                              }
                              placeholder={AFFILIATE_ML_DEFAULT_BUTTON_TEXT}
                              disabled={savingAffiliateMlMessageTemplate || loadingAffiliateMlMessageTemplate}
                            />
                          </label>
                          <label>
                            Rodapé
                            <input
                              value={affiliateMlTemplateFooterText}
                              onChange={(event) =>
                                setAffiliateMlTemplateFooterText(event.target.value.slice(0, 120))
                              }
                              placeholder={AFFILIATE_ML_DISPATCH_FOOTER_TEXT}
                              disabled={savingAffiliateMlMessageTemplate || loadingAffiliateMlMessageTemplate}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

            </div>
          </>
        ) : null}

        {section === "flows" ? (
          <div className={styles.flowWorkspace}>
            {canUseFlows ? (
              <UserFlowBuilder
                instances={instances}
                groups={groups}
                preferredInstanceId={selectedInstanceId}
                initialImportText={initialFlowImportText}
                onExit={() => changeSection("conversations")}
              />
            ) : (
              <div className={styles.moduleWorkspace}>
                <header className={styles.detailHeader}>
                  <div className={styles.detailHeaderMain}>
                    <div>
                      <div className={styles.moduleHeaderBrand}>
                        <img src={brandLogo} alt={brandName} className={styles.headerBrandLogo} />
                        <span>{brandName}</span>
                      </div>
                      <h3>Fluxos</h3>
                      <small>O plano atual não libera o construtor de automações.</small>
                    </div>
                  </div>
                </header>
                <div className={styles.moduleContent}>
                  <div className={styles.emptyState}>
                    <IconSparkles size={34} />
                    <strong>Ative um plano com fluxos</strong>
                    <span>
                      Conecte o WhatsApp normalmente e escolha um plano mensal para criar, importar e editar fluxos.
                    </span>
                    <button type="button" className={styles.primaryButton} onClick={openFlowPlanCheckout}>
                      Escolher plano
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {section === "apirest" ? (
          <div className={styles.moduleWorkspace}>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                <div>
                  <div className={styles.moduleHeaderBrand}>
                    <img src={brandLogo} alt={brandName} className={styles.headerBrandLogo} />
                    <span>{brandName}</span>
                  </div>
                  <h3>API REST</h3>
                  <small>Token, endpoints, limites e compra de pacote de requisições.</small>
                </div>
              </div>
            </header>
            <div className={styles.moduleContent}>
              {preloadedSectionSet.has("apirest") ? (
                <UserApiRestClient
                  initialSnapshot={apiRestSnapshot}
                  sections={apiRestSections}
                  baseUrl={apiRestBaseUrl}
                  plans={apiRestPlans}
                  paymentMethods={paymentMethods}
                />
              ) : (
                renderDeferredModuleLoader("API REST")
              )}
            </div>
          </div>
        ) : null}

        {section === "campaigns" ? (
          <div className={styles.moduleWorkspace}>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                {isMobileViewport ? (
                  <button
                    type="button"
                    className={styles.mobileBackButton}
                    onClick={() => setMobileView("list")}
                    aria-label="Voltar para lista"
                  >
                    <IconArrowLeft size={18} />
                  </button>
                ) : null}
                <div>
                  <h3>{selectedCampaign?.name || "Campanhas"}</h3>
                  <small className={styles.instanceHeaderMeta}>
                    <span>
                      {selectedCampaign
                        ? "Campanha selecionada"
                        : "Selecione uma campanha na lista à esquerda ou crie uma nova."}
                    </span>
                    {selectedCampaign ? (
                      <span
                        className={classNames(
                          styles.instanceStatusTag,
                          selectedCampaign.status === "running" || selectedCampaign.status === "scheduled"
                            ? styles.instanceStatusConnected
                            : styles.instanceStatusDisconnected,
                        )}
                      >
                        {selectedCampaign.status}
                      </span>
                    ) : null}
                  </small>
                </div>
              </div>
            </header>
            <div className={styles.moduleContent}>
              {preloadedSectionSet.has("campaigns") ? (
                <UserAdCampaignManager
                  initialCampaigns={initialCampaigns}
                  instances={instances}
                  groups={groups}
                  initialGroupAdCampaignMeta={initialGroupAdCampaignMeta}
                  apiKey={userApiKey}
                  mode="groups"
                  preferredInstanceId={selectedInstanceId}
                  layout="detail"
                  selectedCampaignId={selectedCampaignId}
                  onSelectedCampaignIdChange={setSelectedCampaignId}
                  onCampaignsChange={setCampaigns}
                  createRequestKey={campaignCreateRequestKey}
                  refreshRequestKey={campaignRefreshRequestKey}
                />
              ) : (
                renderDeferredModuleLoader("Campanhas")
              )}
            </div>
          </div>
        ) : null}

        {section === "status" ? (
          <div className={styles.moduleWorkspace}>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                <div>
                  <div className={styles.moduleHeaderBrand}>
                    <img src={brandLogo} alt={brandName} className={styles.headerBrandLogo} />
                    <span>{brandName}</span>
                  </div>
                  <h3>Status do WhatsApp</h3>
                </div>
              </div>
            </header>
            <div className={styles.moduleContent}>
              {preloadedSectionSet.has("status") ? (
                <UserStatusManager
                  instances={instances}
                  preferredInstanceId={selectedInstanceId}
                  onPreferredInstanceChange={(instanceId) => {
                    if (instanceId && instanceId > 0) {
                      switchActiveProfile(instanceId);
                    }
                  }}
                  apiKey={userApiKey}
                />
              ) : (
                renderDeferredModuleLoader("Status")
              )}
            </div>
          </div>
        ) : null}

        {section === "app" ? (
          <div className={styles.moduleWorkspace}>
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                <div>
                  <div className={styles.moduleHeaderBrand}>
                    <img src={brandLogo} alt={brandName} className={styles.headerBrandLogo} />
                    <span>{brandName}</span>
                  </div>
                  <h3>Aplicativo BotAdmin</h3>
                  <small>Baixe o APK Android e acesse o painel direto pelo app.</small>
                </div>
              </div>
            </header>
            <div className={styles.moduleContent}>
              <UserAppDownloadClient embedded />
            </div>
          </div>
        ) : null}
      </section>
      </div>

      {quickActionsOpen ? (
        <div
          className={styles.quickActionBackdrop}
          onClick={() => setQuickActionsOpen(false)}
          role="presentation"
        >
          <section
            className={styles.quickActionSheet}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Ações rápidas"
          >
            <div className={styles.quickActionHandle} />
            <header className={styles.quickActionHeader}>
              <div>
                <strong>Ações rápidas</strong>
                <span>Conversas e suporte sem sair do painel</span>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setQuickActionsOpen(false)}
                aria-label="Fechar ações rápidas"
              >
                <IconX size={16} />
              </button>
            </header>
            <button type="button" className={styles.quickActionItem} onClick={openQuickNewConversation}>
              <span className={styles.quickActionIcon}>
                <IconMessages size={20} />
              </span>
              <span>
                <strong>Nova conversa</strong>
                <small>Abrir conversas sincronizadas do perfil atual</small>
              </span>
            </button>
            <button type="button" className={styles.quickActionItem} onClick={openQuickSupport}>
              <span className={styles.quickActionIcon}>
                <IconSpeakerphone size={20} />
              </span>
              <span>
                <strong>Pedir suporte</strong>
                <small>Chat interno direto com o painel do admin</small>
              </span>
            </button>
          </section>
        </div>
      ) : null}

      {isMobileViewport && section === "conversations" && !conversationsMobileChatOpen ? (
        <button
          type="button"
          className={styles.quickActionFab}
          onClick={() => setQuickActionsOpen(true)}
          aria-label="Ações rápidas"
          title="Ações rápidas"
        >
          <IconPlus size={28} />
        </button>
      ) : null}

      {affiliateProviderCredentialModal ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (savingAffiliateProviderCredential) return;
            setAffiliateProviderCredentialModal(null);
          }}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Adicionar conta de afiliado"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Adicionar conta</h3>
                <p>{affiliateProviderCredentialModal.label}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setAffiliateProviderCredentialModal(null)}
                disabled={savingAffiliateProviderCredential}
                aria-label="Fechar modal de conta"
              >
                <IconX size={16} />
              </button>
            </header>
            <form
              className={styles.modalForm}
              onSubmit={(event) => {
                event.preventDefault();
                void saveAffiliateProviderCredentials();
              }}
            >
              <label>
                Nome da conta (opcional)
                <input
                  value={affiliateProviderCredentialModal.accountName}
                  onChange={(event) =>
                    setAffiliateProviderCredentialModal((current) =>
                      current ? { ...current, accountName: event.target.value } : current,
                    )
                  }
                  placeholder="Ex.: Shopee principal"
                  autoFocus
                />
              </label>
              <label>
                AppID
                <input
                  value={affiliateProviderCredentialModal.appId}
                  onChange={(event) =>
                    setAffiliateProviderCredentialModal((current) =>
                      current ? { ...current, appId: event.target.value } : current,
                    )
                  }
                  placeholder="Ex.: 18384400942"
                />
              </label>
              <label>
                Senha / Secret
                <input
                  value={affiliateProviderCredentialModal.clientSecret}
                  onChange={(event) =>
                    setAffiliateProviderCredentialModal((current) =>
                      current ? { ...current, clientSecret: event.target.value } : current,
                    )
                  }
                  placeholder="Cole o secret da Open API"
                />
              </label>
              <label>
                App Token (opcional)
                <input
                  value={affiliateProviderCredentialModal.appToken}
                  onChange={(event) =>
                    setAffiliateProviderCredentialModal((current) =>
                      current ? { ...current, appToken: event.target.value } : current,
                    )
                  }
                  placeholder="Se aplicável para sua conta"
                />
              </label>
            </form>
            <footer className={classNames(styles.modalFormFooter, styles.affiliateModalFooter)}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => setAffiliateProviderCredentialModal(null)}
                disabled={savingAffiliateProviderCredential}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void saveAffiliateProviderCredentials()}
                disabled={savingAffiliateProviderCredential}
              >
                {savingAffiliateProviderCredential ? (
                  <IconLoader2 size={14} className={styles.spin} />
                ) : (
                  <IconDeviceFloppy size={14} />
                )}
                Salvar conta
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {isAffiliateAutoSyncFiltersModalOpen ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (savingAffiliateMlAutoSync) return;
            setIsAffiliateAutoSyncFiltersModalOpen(false);
          }}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Filtros da varredura automática"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Varredura automática</h3>
                <p>Ative/desative a varredura e ajuste as regras de captura de produtos.</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setIsAffiliateAutoSyncFiltersModalOpen(false)}
                disabled={savingAffiliateMlAutoSync}
                aria-label="Fechar filtros da varredura"
              >
                <IconX size={16} />
              </button>
            </header>
            <div className={styles.modalForm}>
              <div className={styles.affiliateAutoSyncModalGrid}>
                <label className={styles.toggleField}>
                  <span>Ativar varredura automática</span>
                  <button
                    type="button"
                    className={classNames(
                      styles.toggleSwitch,
                      affiliateMlAutoSyncConfig.enabled && styles.toggleSwitchOn,
                    )}
                    aria-pressed={affiliateMlAutoSyncConfig.enabled}
                    onClick={() =>
                      void saveAffiliateMlAutoSyncConfig({
                        enabled: !affiliateMlAutoSyncConfig.enabled,
                      })
                    }
                    disabled={savingAffiliateMlAutoSync || loadingAffiliateMlAutoSync}
                  >
                    <span />
                  </button>
                </label>
                <label className={styles.toggleField}>
                  <span>Atualizar produtos já existentes</span>
                  <button
                    type="button"
                    className={classNames(
                      styles.toggleSwitch,
                      affiliateMlAutoSyncConfig.refreshExisting && styles.toggleSwitchOn,
                    )}
                    aria-pressed={affiliateMlAutoSyncConfig.refreshExisting}
                    onClick={() => {
                      const nextRefreshExisting = !affiliateMlAutoSyncConfig.refreshExisting;
                      if (
                        affiliateMlAutoSyncConfig.enabled &&
                        !nextRefreshExisting &&
                        !affiliateMlAutoSyncConfig.discoverNew
                      ) {
                        setFeedback({
                          ok: false,
                          text: "Ative ao menos uma ação da varredura: atualizar existentes ou capturar novos.",
                        });
                        return;
                      }
                      void saveAffiliateMlAutoSyncConfig({
                        refreshExisting: nextRefreshExisting,
                      });
                    }}
                    disabled={savingAffiliateMlAutoSync || loadingAffiliateMlAutoSync || !affiliateMlAutoSyncConfig.enabled}
                  >
                    <span />
                  </button>
                </label>
                <label className={styles.toggleField}>
                  <span>Capturar novos produtos automaticamente</span>
                  <button
                    type="button"
                    className={classNames(
                      styles.toggleSwitch,
                      affiliateMlAutoSyncConfig.discoverNew && styles.toggleSwitchOn,
                    )}
                    aria-pressed={affiliateMlAutoSyncConfig.discoverNew}
                    onClick={() => {
                      const nextDiscoverNew = !affiliateMlAutoSyncConfig.discoverNew;
                      if (
                        affiliateMlAutoSyncConfig.enabled &&
                        !nextDiscoverNew &&
                        !affiliateMlAutoSyncConfig.refreshExisting
                      ) {
                        setFeedback({
                          ok: false,
                          text: "Ative ao menos uma ação da varredura: atualizar existentes ou capturar novos.",
                        });
                        return;
                      }
                      void saveAffiliateMlAutoSyncConfig({
                        discoverNew: nextDiscoverNew,
                      });
                    }}
                    disabled={savingAffiliateMlAutoSync || loadingAffiliateMlAutoSync || !affiliateMlAutoSyncConfig.enabled}
                  >
                    <span />
                  </button>
                </label>
                <label>
                  Meta de novos por varredura
                  <input
                    type="number"
                    min={10}
                    max={2000}
                    value={affiliateMlAutoSyncTargetInput}
                    onChange={(event) => setAffiliateMlAutoSyncTargetInput(event.target.value)}
                    onBlur={() => {
                      const parsed = Number(affiliateMlAutoSyncTargetInput);
                      const value = Number.isFinite(parsed)
                        ? Math.max(10, Math.min(2000, Math.floor(parsed)))
                        : affiliateMlAutoSyncConfig.targetImportLimit;
                      setAffiliateMlAutoSyncTargetInput(String(value));
                      if (value !== affiliateMlAutoSyncConfig.targetImportLimit) {
                        void saveAffiliateMlAutoSyncConfig({ targetImportLimit: value });
                      }
                    }}
                    disabled={
                      savingAffiliateMlAutoSync ||
                      loadingAffiliateMlAutoSync ||
                      !affiliateMlAutoSyncConfig.enabled ||
                      !affiliateMlAutoSyncConfig.discoverNew
                    }
                  />
                </label>
              </div>
              <small className={styles.instanceHeaderMeta}>
                A varredura adiciona novos produtos sem apagar os antigos. Quando o item já existe, ele só é
                atualizado.
              </small>
              <label>
                Categorias preferenciais
                <div className={styles.affiliateAutoSyncCategoryList}>
                  {AFFILIATE_AUTO_SYNC_DISCOVERY_CATEGORY_PRESETS.map((preset) => {
                    const active = affiliateAutoSyncCategoryKeysInput.includes(preset.key);
                    return (
                      <button
                        key={`auto-sync-category-${preset.key}`}
                        type="button"
                        className={classNames(
                          styles.ghostButton,
                          styles.affiliateAutoSyncCategoryChip,
                          active && styles.affiliateAutoSyncCategoryChipActive,
                        )}
                        onClick={() =>
                          setAffiliateAutoSyncCategoryKeysInput((current) => {
                            const next = new Set(current);
                            if (next.has(preset.key)) {
                              next.delete(preset.key);
                              return Array.from(next);
                            }
                            if (next.size >= AFFILIATE_AUTO_SYNC_MAX_DISCOVERY_CATEGORIES) {
                              setFeedback({
                                ok: false,
                                text: `Limite de ${AFFILIATE_AUTO_SYNC_MAX_DISCOVERY_CATEGORIES} categorias nos filtros automáticos.`,
                              });
                              return current;
                            }
                            next.add(preset.key);
                            return Array.from(next);
                          })
                        }
                        disabled={savingAffiliateMlAutoSync}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <small className={styles.instanceHeaderMeta}>
                  Se nada for marcado, o sistema usa as categorias/tendências padrão.
                </small>
              </label>
              <label>
                Palavras-chave adicionais (opcional)
                <textarea
                  rows={6}
                  className={styles.affiliateAutoSyncKeywordsInput}
                  value={affiliateAutoSyncTermsInput}
                  onChange={(event) => setAffiliateAutoSyncTermsInput(event.target.value)}
                  placeholder="Ex.: whey, creatina, xbox, iphone, perfume..."
                  disabled={savingAffiliateMlAutoSync}
                />
                <small className={styles.instanceHeaderMeta}>
                  Separe por vírgula, ponto e vírgula ou quebra de linha.
                </small>
              </label>
            </div>
            <footer className={classNames(styles.modalFormFooter, styles.affiliateModalFooter)}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => setIsAffiliateAutoSyncFiltersModalOpen(false)}
                disabled={savingAffiliateMlAutoSync}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void saveAffiliateAutoSyncFilters()}
                disabled={savingAffiliateMlAutoSync}
              >
                {savingAffiliateMlAutoSync ? (
                  <IconLoader2 size={14} className={styles.spin} />
                ) : (
                  <IconDeviceFloppy size={14} />
                )}
                Salvar configuração
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {affiliateDispatchModal ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (savingAffiliateMlGroupDispatchId !== null) return;
            setAffiliateDispatchModal(null);
          }}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Configurar ativação de disparos"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>{affiliateDispatchModal.dispatchId ? "Editar ativação" : "Nova ativação"}</h3>
                <p>Selecione uma instância conectada e um grupo VIP ativo para o disparo.</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setAffiliateDispatchModal(null)}
                disabled={savingAffiliateMlGroupDispatchId !== null}
                aria-label="Fechar modal de ativação"
              >
                <IconX size={16} />
              </button>
            </header>
            <div className={styles.modalForm}>
              <label>
                Instância conectada
                <select
                  value={affiliateDispatchModal.instanceId}
                  onChange={(event) =>
                    setAffiliateDispatchModal((current) =>
                      current ? { ...current, instanceId: event.target.value, groupId: "" } : current,
                    )
                  }
                  disabled={savingAffiliateMlGroupDispatchId !== null}
                >
                  {affiliateDispatchAvailableInstances.length === 0 ? (
                    <option value="">Nenhuma instância elegível disponível</option>
                  ) : (
                    affiliateDispatchAvailableInstances.map((instance) => (
                      <option key={`affiliate-dispatch-modal-instance-${instance.id}`} value={String(instance.id)}>
                        {instance.name || instance.phone || `Instância ${instance.id}`}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label>
                Grupo de destino
                <select
                  value={affiliateDispatchModal.groupId}
                  onChange={(event) =>
                    setAffiliateDispatchModal((current) =>
                      current ? { ...current, groupId: event.target.value } : current,
                    )
                  }
                  disabled={savingAffiliateMlGroupDispatchId !== null}
                >
                  {affiliateDispatchModalGroups.length === 0 ? (
                    <option value="">Nenhum grupo ativo disponível</option>
                  ) : (
                    affiliateDispatchModalGroups.map((group) => (
                      <option key={`affiliate-dispatch-modal-group-${group.id}`} value={String(group.id)}>
                        {group.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label>
                Delay entre envios (minutos)
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={affiliateDispatchModal.delayMinutes}
                  onChange={(event) =>
                    setAffiliateDispatchModal((current) =>
                      current ? { ...current, delayMinutes: event.target.value } : current,
                    )
                  }
                  disabled={savingAffiliateMlGroupDispatchId !== null}
                />
              </label>
              <label className={styles.toggleField}>
                <span>Separar por categoria (rodízio)</span>
                <button
                  type="button"
                  className={classNames(
                    styles.toggleSwitch,
                    affiliateDispatchModal.categoryRotationEnabled && styles.toggleSwitchOn,
                  )}
                  aria-pressed={affiliateDispatchModal.categoryRotationEnabled}
                  onClick={() =>
                    setAffiliateDispatchModal((current) =>
                      current
                        ? {
                            ...current,
                            categoryRotationEnabled: !current.categoryRotationEnabled,
                          }
                        : current,
                    )
                  }
                  disabled={savingAffiliateMlGroupDispatchId !== null}
                >
                  <span />
                </button>
              </label>
              <label className={styles.toggleField}>
                <span>Ativação ligada</span>
                <button
                  type="button"
                  className={classNames(styles.toggleSwitch, affiliateDispatchModal.enabled && styles.toggleSwitchOn)}
                  aria-pressed={affiliateDispatchModal.enabled}
                  onClick={() =>
                    setAffiliateDispatchModal((current) =>
                      current
                        ? {
                            ...current,
                            enabled: !current.enabled,
                          }
                        : current,
                    )
                  }
                  disabled={savingAffiliateMlGroupDispatchId !== null}
                >
                  <span />
                </button>
              </label>
            </div>
            <footer className={classNames(styles.modalFormFooter, styles.affiliateModalFooter)}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => setAffiliateDispatchModal(null)}
                disabled={savingAffiliateMlGroupDispatchId !== null}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void saveAffiliateDispatchModal()}
                disabled={savingAffiliateMlGroupDispatchId !== null}
              >
                {savingAffiliateMlGroupDispatchId !== null ? (
                  <IconLoader2 size={14} className={styles.spin} />
                ) : (
                  <IconDeviceFloppy size={14} />
                )}
                Salvar ativação
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {isAffiliateMlCreateModalOpen ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (savingAffiliateMlLink) return;
            setIsAffiliateMlCreateModalOpen(false);
          }}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Criar produto afiliado"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Criar produto afiliado</h3>
                <p>{selectedAffiliateProvider?.label || "Mercado Livre"}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setIsAffiliateMlCreateModalOpen(false)}
                disabled={savingAffiliateMlLink}
                aria-label="Fechar criação de produto"
              >
                <IconX size={16} />
              </button>
            </header>
            <form
              className={styles.modalForm}
              onSubmit={(event) => {
                event.preventDefault();
                void saveAffiliateMlLink();
              }}
            >
              <label>
                Link de afiliado
                <input
                  value={affiliateMlLinkInput}
                  onChange={(event) => setAffiliateMlLinkInput(event.target.value)}
                  placeholder={
                    selectedAffiliateProvider?.provider === "shopee"
                      ? "https://s.shopee.com.br/..."
                      : "https://meli.la/..."
                  }
                  autoFocus
                />
              </label>
              <label>
                Observação (opcional)
                <input
                  value={affiliateMlLinkNote}
                  onChange={(event) => setAffiliateMlLinkNote(event.target.value)}
                  placeholder="Ex.: oferta relâmpago da noite"
                />
              </label>
            </form>
            <footer className={classNames(styles.modalFormFooter, styles.affiliateModalFooter)}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => setIsAffiliateMlCreateModalOpen(false)}
                disabled={savingAffiliateMlLink}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void saveAffiliateMlLink()}
                disabled={savingAffiliateMlLink}
              >
                {savingAffiliateMlLink ? <IconLoader2 size={14} className={styles.spin} /> : <IconPlus size={14} />}
                Criar produto
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {affiliateMlEditModal ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (savingAffiliateMlEditModal) return;
            setAffiliateMlEditModal(null);
          }}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Editar produto afiliado"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Editar produto afiliado</h3>
                <p>Item {affiliateMlEditModal.itemId}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setAffiliateMlEditModal(null)}
                disabled={savingAffiliateMlEditModal}
                aria-label="Fechar edição de produto"
              >
                <IconX size={16} />
              </button>
            </header>
            <form
              className={styles.modalForm}
              onSubmit={(event) => {
                event.preventDefault();
                void saveAffiliateMlEdit();
              }}
            >
              <label>
                Link afiliado
                <input
                  value={affiliateMlEditModal.affiliateUrl}
                  onChange={(event) =>
                    setAffiliateMlEditModal((current) =>
                      current ? { ...current, affiliateUrl: event.target.value } : current,
                    )
                  }
                  placeholder={
                    selectedAffiliateProvider?.provider === "shopee"
                      ? "https://s.shopee.com.br/..."
                      : "https://meli.la/..."
                  }
                  autoFocus
                />
              </label>
              <label>
                Título exibido (opcional)
                <input
                  value={affiliateMlEditModal.title}
                  onChange={(event) =>
                    setAffiliateMlEditModal((current) =>
                      current ? { ...current, title: event.target.value } : current,
                    )
                  }
                  placeholder="Ex.: Oferta relâmpago"
                />
              </label>
              <label>
                URL da foto (opcional)
                <input
                  value={affiliateMlEditModal.imageUrl}
                  onChange={(event) =>
                    setAffiliateMlEditModal((current) =>
                      current ? { ...current, imageUrl: event.target.value } : current,
                    )
                  }
                  placeholder="https://.../imagem.jpg"
                />
              </label>
              <label>
                URL do produto (opcional)
                <input
                  value={affiliateMlEditModal.productUrl}
                  onChange={(event) =>
                    setAffiliateMlEditModal((current) =>
                      current ? { ...current, productUrl: event.target.value } : current,
                    )
                  }
                  placeholder={
                    selectedAffiliateProvider?.provider === "shopee"
                      ? "https://shopee.com.br/product/..."
                      : "https://www.mercadolivre.com.br/..."
                  }
                />
              </label>
              <label>
                Observação (opcional)
                <input
                  value={affiliateMlEditModal.note}
                  onChange={(event) =>
                    setAffiliateMlEditModal((current) =>
                      current ? { ...current, note: event.target.value } : current,
                    )
                  }
                  placeholder="Ex.: cupom ativo hoje"
                />
              </label>
              <label>
                Cupom (opcional)
                <input
                  value={affiliateMlEditModal.couponCode}
                  onChange={(event) =>
                    setAffiliateMlEditModal((current) =>
                      current ? { ...current, couponCode: event.target.value } : current,
                    )
                  }
                  placeholder="Ex.: VESTIRBEM"
                />
              </label>
              <label>
                Detalhes do cupom (opcional)
                <input
                  value={affiliateMlEditModal.couponDetails}
                  onChange={(event) =>
                    setAffiliateMlEditModal((current) =>
                      current ? { ...current, couponDetails: event.target.value } : current,
                    )
                  }
                  placeholder="Ex.: válido até 23:59 • compra mínima R$ 79"
                />
              </label>
            </form>
            <footer className={classNames(styles.modalFormFooter, styles.affiliateModalFooter)}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => setAffiliateMlEditModal(null)}
                disabled={savingAffiliateMlEditModal}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void saveAffiliateMlEdit()}
                disabled={savingAffiliateMlEditModal}
              >
                {savingAffiliateMlEditModal ? (
                  <IconLoader2 size={14} className={styles.spin} />
                ) : (
                  <IconDeviceFloppy size={14} />
                )}
                Salvar alterações
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {isAffiliateMlImportModalOpen ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (importingAffiliateMlProducts || searchingAffiliateMlImportProducts || loadingAffiliateOfficialOffers) return;
            setAffiliateMlImportWarningExpanded(false);
            setAffiliateMlImportShowResultsOnly(false);
            setIsAffiliateMlImportModalOpen(false);
          }}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.affiliateImportModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Importar produtos por termo"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Importar produtos</h3>
                <p>Busque, visualize e selecione somente os produtos que deseja importar.</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => {
                  setAffiliateMlImportWarningExpanded(false);
                  setAffiliateMlImportShowResultsOnly(false);
                  setIsAffiliateMlImportModalOpen(false);
                }}
                disabled={importingAffiliateMlProducts || searchingAffiliateMlImportProducts || loadingAffiliateOfficialOffers}
                aria-label="Fechar importação de produtos"
              >
                <IconX size={16} />
              </button>
            </header>

            <div
              className={classNames(
                styles.affiliateImportBody,
                affiliateMlImportShowResultsOnly && affiliateMlImportProducts.length > 0
                  ? styles.affiliateImportBodyResults
                  : "",
              )}
            >
              {!affiliateMlImportShowResultsOnly || affiliateMlImportProducts.length === 0 ? (
                <div className={styles.modalForm}>
                  <label>
                    Categoria pré-definida
                    <select
                      value={affiliateMlImportPresetKey}
                      onChange={(event) => setAffiliateMlImportPresetKey(event.target.value)}
                    >
                      {AFFILIATE_ML_IMPORT_CATEGORY_PRESETS.map((preset) => (
                        <option key={preset.key} value={preset.key}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <small className={styles.affiliateImportPresetHint}>
                      {selectedAffiliateMlImportPreset?.hint || "Selecione uma categoria para usar como base da busca."}
                    </small>
                  </label>
                  <label>
                    Palavra-chave adicional (opcional)
                    <input
                      value={affiliateMlImportCategoryQuery}
                      onChange={(event) => setAffiliateMlImportCategoryQuery(event.target.value)}
                      placeholder="Ex.: iphone 15, air fryer 12l, perfume..."
                    />
                  </label>
                  <label>
                    Modo de garimpo
                    <select
                      value={affiliateMlImportMode}
                      onChange={(event) => setAffiliateMlImportMode(event.target.value as AffiliateMlImportMode)}
                    >
                      <option value="promotions">Promoções (Recomendado)</option>
                      <option value="aggressive">Agressivo (mais volume)</option>
                      <option value="standard">Padrão (somente termo base)</option>
                    </select>
                  </label>
                  <label>
                    Limite de produtos (1 a 2000)
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={affiliateMlImportLimit}
                      onChange={(event) => setAffiliateMlImportLimit(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              <div className={styles.affiliateImportControlRow}>
                <small className={styles.affiliateImportEffectiveTerm}>
                  {affiliateMlImportShowResultsOnly && affiliateMlImportProducts.length > 0
                    ? `Resultados: ${affiliateMlImportProducts.length} produto(s)`
                    : `Busca atual: ${affiliateMlEffectiveImportQuery === "__ALL_CATEGORIES__" ? "Todas categorias" : affiliateMlEffectiveImportQuery || "—"}`}
                </small>
                {affiliateMlImportProducts.length > 0 ? (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setAffiliateMlImportShowResultsOnly((current) => !current)}
                    disabled={searchingAffiliateMlImportProducts || importingAffiliateMlProducts}
                  >
                    {affiliateMlImportShowResultsOnly ? "Mostrar filtros" : "Ocultar filtros"}
                  </button>
                ) : null}
                {isAffiliateShopeeProvider ? (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => void loadShopeeOfficialOffersToImportList()}
                    disabled={loadingAffiliateOfficialOffers || searchingAffiliateMlImportProducts || importingAffiliateMlProducts}
                  >
                    {loadingAffiliateOfficialOffers ? (
                      <IconLoader2 size={14} className={styles.spin} />
                    ) : (
                      <IconApi size={14} />
                    )}
                    Carregar ofertas oficiais
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void searchAffiliateMlImportProducts()}
                  disabled={
                    searchingAffiliateMlImportProducts ||
                    loadingAffiliateOfficialOffers ||
                    !affiliateMlEffectiveImportQuery
                  }
                >
                  {searchingAffiliateMlImportProducts ? (
                    <IconLoader2 size={14} className={styles.spin} />
                  ) : (
                    <IconSearch size={14} />
                  )}
                  Buscar produtos
                </button>
              </div>
              {isAffiliateShopeeProvider && (!affiliateMlImportShowResultsOnly || affiliateMlImportProducts.length === 0) ? (
                <small className={styles.instanceHeaderMeta}>
                  Dica: use <strong>Carregar ofertas oficiais</strong> para montar a lista com base nas campanhas/lojas da Shopee e depois escolha os produtos para importar.
                </small>
              ) : null}
              {isAffiliateShopeeProvider &&
              (!affiliateMlImportShowResultsOnly || affiliateMlImportProducts.length === 0) &&
              (shopeeOffers.campaigns.entries.length > 0 || shopeeOffers.shopOffers.entries.length > 0) ? (
                <small className={styles.affiliateImportEffectiveTerm}>
                  Ofertas oficiais carregadas: {shopeeOffers.campaigns.entries.length} campanha(s) e{" "}
                  {shopeeOffers.shopOffers.entries.length} oferta(s) de loja.
                </small>
              ) : null}

              {affiliateMlImportWarningSummary ? (
                <div className={styles.affiliateImportWarning}>
                  <div className={styles.affiliateImportWarningHeader}>
                    <small>{affiliateMlImportWarningSummary}</small>
                    {affiliateMlImportWarning &&
                    affiliateMlImportWarningSummary !== affiliateMlImportWarning ? (
                      <button
                        type="button"
                        className={styles.affiliateImportWarningToggle}
                        onClick={() =>
                          setAffiliateMlImportWarningExpanded((current) => !current)
                        }
                      >
                        {affiliateMlImportWarningExpanded ? "Ocultar detalhes" : "Ver detalhes"}
                      </button>
                    ) : null}
                  </div>
                  {affiliateMlImportWarningExpanded && affiliateMlImportWarning ? (
                    <small className={styles.affiliateImportWarningDetails}>
                      {affiliateMlImportWarning}
                    </small>
                  ) : null}
                </div>
              ) : null}

              <div className={styles.affiliateImportListActions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    affiliateMlImportProducts.forEach((entry) => {
                      const itemKey = String(entry.itemId || "").trim().toUpperCase();
                      if (entry.affiliateUrl && itemKey && !importedAffiliateMlItemIds.has(itemKey)) {
                        next[entry.itemId] = true;
                      }
                    });
                    setAffiliateMlImportSelectedIds(next);
                  }}
                  disabled={affiliateMlImportProducts.length === 0 || importingAffiliateMlProducts}
                >
                  Selecionar todos válidos
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setAffiliateMlImportSelectedIds({})}
                  disabled={affiliateMlImportProducts.length === 0 || importingAffiliateMlProducts}
                >
                  Limpar seleção
                </button>
                <small>
                  {selectedAffiliateMlImportCount} selecionado(s) • {affiliateMlImportSelectableCount} disponível(is) •{" "}
                  {affiliateMlImportAlreadyImportedCount} já importado(s)
                </small>
              </div>

              <div
                className={classNames(
                  styles.affiliateImportList,
                  affiliateMlImportShowResultsOnly && affiliateMlImportProducts.length > 0
                    ? styles.affiliateImportListExpanded
                    : "",
                )}
              >
                {searchingAffiliateMlImportProducts ? (
                  <p className={styles.affiliateImportEmpty}>Consultando produtos em alta demanda...</p>
                ) : affiliateMlImportProducts.length === 0 ? (
                  <p className={styles.affiliateImportEmpty}>
                    Nenhum produto listado. Digite um termo e clique em buscar.
                  </p>
                ) : (
                  affiliateMlImportProducts.map((entry) => {
                    const itemKey = String(entry.itemId || "").trim().toUpperCase();
                    const isImported = itemKey ? importedAffiliateMlItemIds.has(itemKey) : false;
                    const hasAffiliateLink = Boolean(entry.affiliateUrl);
                    const canSelect = hasAffiliateLink && !isImported;
                    const currencyPrefix =
                      entry.currencyId && entry.currencyId.toUpperCase() !== "BRL"
                        ? `${entry.currencyId.toUpperCase()} `
                        : "R$ ";
                    return (
                      <label
                        key={entry.itemId}
                        className={classNames(
                          styles.affiliateImportItem,
                          isImported ? styles.affiliateImportItemImported : "",
                          !hasAffiliateLink ? styles.affiliateImportItemUnavailable : "",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(affiliateMlImportSelectedIds[entry.itemId]) && canSelect}
                          disabled={!canSelect || importingAffiliateMlProducts}
                          onChange={(event) =>
                            setAffiliateMlImportSelectedIds((current) => ({
                              ...current,
                              [entry.itemId]: event.target.checked,
                            }))
                          }
                        />
                        <div className={styles.affiliateImportItemBody}>
                          <div className={styles.affiliateImportItemPreviewRow}>
                            <div className={styles.affiliateImportItemThumb}>
                              {entry.thumbnail ? (
                                <img src={entry.thumbnail} alt={entry.title || entry.itemId} loading="lazy" />
                              ) : (
                                <span>{selectedAffiliateProvider?.label?.slice(0, 2).toUpperCase() || "AF"}</span>
                              )}
                            </div>
                            <div className={styles.affiliateImportItemMain}>
                              <strong title={entry.title || entry.itemId}>{entry.title || entry.itemId}</strong>
                              <div className={styles.affiliateImportItemBadges}>
                                <span className={styles.instanceStatusTag}>Item: {entry.itemId}</span>
                                {entry.commissionRate ? (
                                  <span className={styles.instanceStatusTag}>
                                    Comissão: {entry.commissionRate}
                                  </span>
                                ) : null}
                                {entry.ratingStar ? (
                                  <span className={styles.instanceStatusTag}>⭐ {entry.ratingStar}</span>
                                ) : null}
                                {isImported ? (
                                  <span className={classNames(styles.instanceStatusTag, styles.instanceStatusTagNeutral)}>
                                    Já importado
                                  </span>
                                ) : null}
                                {!hasAffiliateLink ? (
                                  <span className={classNames(styles.instanceStatusTag, styles.instanceStatusTagDanger)}>
                                    Sem link afiliado
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className={styles.affiliateImportItemMetaGrid}>
                            {entry.price !== null ? (
                              <small>
                                Preço: {currencyPrefix}
                                {formatCurrency(entry.price)}
                              </small>
                            ) : (
                              <small>Preço: —</small>
                            )}
                            <small>Categoria: {entry.categoryId || "—"}</small>
                            <small>
                              Status:{" "}
                              {entry.available === null
                                ? "—"
                                : entry.available
                                  ? "Disponível"
                                  : "Indisponível"}
                            </small>
                            {entry.sourceLabel ? (
                              <small>
                                Origem: {entry.sourceLabel}
                                {entry.sourceMeta ? ` (${entry.sourceMeta})` : ""}
                              </small>
                            ) : null}
                          </div>

                          <small
                            className={
                              entry.affiliateUrl ? styles.affiliateImportLinkOk : styles.affiliateImportLinkMissing
                            }
                          >
                            {isImported
                              ? "Este produto já está importado no painel (não pode ser selecionado novamente)."
                              : entry.affiliateUrl
                                ? "Link afiliado disponível para importar."
                                : "Sem link afiliado disponível para importação."}
                          </small>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <footer className={classNames(styles.modalFormFooter, styles.affiliateModalFooter)}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => {
                  setAffiliateMlImportWarningExpanded(false);
                  setAffiliateMlImportShowResultsOnly(false);
                  setIsAffiliateMlImportModalOpen(false);
                }}
                disabled={importingAffiliateMlProducts}
              >
                Fechar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void importSelectedAffiliateMlProducts()}
                disabled={importingAffiliateMlProducts || selectedAffiliateMlImportCount === 0}
              >
                {importingAffiliateMlProducts ? (
                  <IconLoader2 size={14} className={styles.spin} />
                ) : (
                  <IconShoppingCart size={14} />
                )}
                Importar selecionados
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {groupEditModal ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (savingGroup) return;
            setGroupEditModal(null);
          }}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Editar dados do grupo"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>{groupEditModal.field === "name" ? "Editar nome do grupo" : "Editar descrição"}</h3>
                <p>{selectedGroup?.name}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setGroupEditModal(null)}
                disabled={savingGroup}
                aria-label="Fechar edição"
              >
                <IconX size={16} />
              </button>
            </header>
            <div className={styles.automationModalBody}>
              <label className={styles.automationFormGrid}>
                {groupEditModal.field === "name" ? "Nome do grupo" : "Descrição"}
                {groupEditModal.field === "name" ? (
                  <input
                    value={groupEditModal.value}
                    onChange={(event) =>
                      setGroupEditModal((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                    placeholder="Nome do grupo"
                    autoFocus
                  />
                ) : (
                  <textarea
                    rows={8}
                    value={groupEditModal.value}
                    onChange={(event) =>
                      setGroupEditModal((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                    placeholder="Descrição do grupo"
                    autoFocus
                  />
                )}
              </label>
            </div>
            <footer className={styles.modalFormFooter}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => setGroupEditModal(null)}
                disabled={savingGroup}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void saveGroupEdit()}
                disabled={savingGroup}
              >
                {savingGroup ? <IconLoader2 size={14} className={styles.spin} /> : <IconDeviceFloppy size={14} />}
                Salvar
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {participantImportModalOpen ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob) return;
            setParticipantImportModalOpen(false);
          }}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Adicionar membros de outro grupo"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Adicionar membros de outro grupo</h3>
                <p>Importe membros de qualquer grupo da conta com delay e variação automática para reduzir risco.</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setParticipantImportModalOpen(false)}
                disabled={importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob}
                aria-label="Fechar importação de membros"
              >
                <IconX size={16} />
              </button>
            </header>

            <form
              className={styles.modalForm}
              onSubmit={(event) => {
                event.preventDefault();
                void importParticipantsFromAnotherGroup();
              }}
            >
              {participantImportJob ? (
                <div className={styles.participantImportStatusCard}>
                  <div className={styles.participantImportStatusHead}>
                    <strong>Processo atual</strong>
                    <span
                      className={classNames(
                        styles.instanceStatusTag,
                        participantImportJobStatusClassName,
                      )}
                    >
                      {participantImportJobStatusLabel}
                    </span>
                  </div>
                  <div className={classNames(styles.participantImportProgress, participantImportProgressStateClassName)}>
                    <span style={{ width: `${Math.max(0, Math.min(100, participantImportJob.progressPercent))}%` }} />
                  </div>
                  <small className={styles.instanceHeaderMeta}>
                    Processados: {participantImportJob.processedCount}/{Math.max(participantImportJob.totalCandidates, participantImportJob.processedCount)} ·
                    {" "}Adicionados: {participantImportJob.addedCount} ·
                    {" "}Falhas: {participantImportJob.failedCount}
                  </small>
                  {participantImportJob.lastMessage ? (
                    <small className={styles.instanceHeaderMeta}>{participantImportJob.lastMessage}</small>
                  ) : null}
                  {participantImportJob.lastError ? (
                    <small className={styles.errorInline}>{participantImportJob.lastError}</small>
                  ) : null}
                  {!participantImportJobActive ? (
                    <div className={styles.groupImportActionRow}>
                      <button
                        type="button"
                        className={classNames(styles.primaryButton, styles.compactButton)}
                        onClick={() => void importParticipantsFromAnotherGroup()}
                        disabled={
                          importingParticipants ||
                          participantImportSourceGroups.length === 0 ||
                          !participantImportSourceGroupId
                        }
                      >
                        {importingParticipants ? (
                          <IconLoader2 size={14} className={styles.spin} />
                        ) : (
                          <IconUsersGroup size={14} />
                        )}
                        Iniciar novo envio
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <label>
                Grupo de origem
                <select
                  value={participantImportSourceGroupId}
                  onChange={(event) => setParticipantImportSourceGroupId(event.target.value)}
                  disabled={
                    importingParticipants ||
                    cancellingParticipantImportJob ||
                    updatingParticipantImportJob ||
                    participantImportSourceGroups.length === 0 ||
                    participantImportJobActive
                  }
                  required
                >
                  <option value="">Selecione</option>
                  {participantImportSourceGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.instanceName || `Instância ${group.instanceId}`})
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.toggleField}>
                Não extrair administradores
                <button
                  type="button"
                  className={classNames(
                    styles.toggleSwitch,
                    participantImportExcludeAdmins && styles.toggleSwitchOn,
                  )}
                  onClick={() => setParticipantImportExcludeAdmins((current) => !current)}
                  disabled={importingParticipants || participantImportJobActive || cancellingParticipantImportJob || updatingParticipantImportJob}
                  aria-pressed={participantImportExcludeAdmins}
                >
                  <span />
                </button>
              </label>

              <label>
                Delay base entre requisições (ms)
                <input
                  type="number"
                  min={1200}
                  max={60000}
                  value={participantImportDelayMs}
                  onChange={(event) => setParticipantImportDelayMs(event.target.value)}
                  disabled={importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob}
                />
              </label>

              <label>
                Variação aleatória do delay (ms)
                <input
                  type="number"
                  min={0}
                  max={30000}
                  value={participantImportJitterMs}
                  onChange={(event) => setParticipantImportJitterMs(event.target.value)}
                  disabled={importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob}
                />
              </label>

              <label>
                Máximo por requisição (variação automática)
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={participantImportBatchSize}
                  onChange={(event) => setParticipantImportBatchSize(event.target.value)}
                  disabled={importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob}
                />
                <small className={styles.instanceHeaderMeta}>
                  O sistema alterna automaticamente entre 1 e este valor.
                </small>
              </label>

              <label>
                Limite de adição por execução (0 = todos)
                <input
                  type="number"
                  min={0}
                  max={5000}
                  value={participantImportMaxMembers}
                  onChange={(event) => setParticipantImportMaxMembers(event.target.value)}
                  disabled={importingParticipants || participantImportJobActive || cancellingParticipantImportJob || updatingParticipantImportJob}
                />
              </label>

              {participantImportSourceGroups.length === 0 ? (
                <small className={styles.instanceHeaderMeta}>
                  Nenhum grupo elegível encontrado para importar membros.
                </small>
              ) : null}
            </form>

            <footer className={styles.modalFormFooter}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => setParticipantImportModalOpen(false)}
                disabled={importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob}
              >
                Cancelar
              </button>
              {participantImportJobActive && participantImportJob ? (
                <button
                  type="button"
                  className={classNames(styles.ghostButton, styles.modalFooterButton)}
                  onClick={() => void updateParticipantImportRuntime(participantImportJob.id)}
                  disabled={importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob}
                >
                  {updatingParticipantImportJob ? (
                    <IconLoader2 size={14} className={styles.spin} />
                  ) : (
                    <IconDeviceFloppy size={14} />
                  )}
                  Salvar ajustes
                </button>
              ) : null}
              {participantImportJobActive && participantImportJob ? (
                participantImportJob.status === "paused" ? (
                  <button
                    type="button"
                    className={classNames(styles.ghostButton, styles.modalFooterButton)}
                    onClick={() => void resumeParticipantImportJob(participantImportJob.id)}
                    disabled={importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob}
                  >
                    {updatingParticipantImportJob ? (
                      <IconLoader2 size={14} className={styles.spin} />
                    ) : (
                      <IconRotateClockwise2 size={14} />
                    )}
                    Retomar
                  </button>
                ) : (
                  <button
                    type="button"
                    className={classNames(styles.ghostButton, styles.modalFooterButton)}
                    onClick={() => void pauseParticipantImportJob(participantImportJob.id)}
                    disabled={
                      importingParticipants ||
                      cancellingParticipantImportJob ||
                      updatingParticipantImportJob ||
                      participantImportJob.status === "cancelling"
                    }
                  >
                    {updatingParticipantImportJob ? (
                      <IconLoader2 size={14} className={styles.spin} />
                    ) : (
                      <IconSettings size={14} />
                    )}
                    Pausar
                  </button>
                )
              ) : null}
              {participantImportJobActive && participantImportJob ? (
                <button
                  type="button"
                  className={classNames(styles.ghostButton, styles.modalFooterButton, styles.dangerButton)}
                  onClick={() => void cancelParticipantImportJob(participantImportJob.id)}
                  disabled={importingParticipants || cancellingParticipantImportJob || updatingParticipantImportJob}
                >
                  {cancellingParticipantImportJob ? (
                    <IconLoader2 size={14} className={styles.spin} />
                  ) : (
                    <IconX size={14} />
                  )}
                  Cancelar processo
                </button>
              ) : null}
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void importParticipantsFromAnotherGroup()}
                disabled={
                  importingParticipants ||
                  cancellingParticipantImportJob ||
                  updatingParticipantImportJob ||
                  participantImportJobActive ||
                  participantImportSourceGroups.length === 0 ||
                  !participantImportSourceGroupId
                }
              >
                {importingParticipants ? (
                  <IconLoader2 size={14} className={styles.spin} />
                ) : (
                  <IconUsersGroup size={14} />
                )}
                Iniciar adição
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {pairingMethodModal ? (
        <div className={styles.modalOverlay} onClick={() => setPairingMethodModal(null)} role="presentation">
          <div
            className={classNames(styles.modalCard, styles.pairingChoiceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Escolha o tipo de pareamento"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>{pairingMethodModal.forceReconnect ? "Parear outro número" : "Escolha como conectar"}</h3>
                <p>{pairingMethodModal.instanceName}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setPairingMethodModal(null)}
                aria-label="Fechar escolha de pareamento"
              >
                <IconX size={16} />
              </button>
            </header>
            {pairingMethodModal.forceReconnect ? (
              <p className={styles.modalHint}>
                A sessão atual será encerrada para liberar o pareamento com outro WhatsApp.
              </p>
            ) : null}
            <div className={styles.pairingMethodOptions}>
              <button
                type="button"
                className={styles.pairingMethodCard}
                onClick={() =>
                  void generatePairing(
                    pairingMethodModal.instanceId,
                    "qr",
                    pairingMethodModal.forceReconnect === true,
                  )
                }
              >
                <IconQrcode size={18} />
                <div>
                  <strong>QR Code</strong>
                  <p>Recomendado para evitar erros de número. Abra o WhatsApp e escaneie com a câmera.</p>
                </div>
              </button>
              <button
                type="button"
                className={styles.pairingMethodCard}
                onClick={() =>
                  void generatePairing(
                    pairingMethodModal.instanceId,
                    "code",
                    pairingMethodModal.forceReconnect === true,
                  )
                }
              >
                <IconDeviceMobile size={18} />
                <div>
                  <strong>Código de pareamento</strong>
                  <p>Use quando preferir digitar o código no celular sem ler QR.</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pairingModal ? (
        <div
          className={styles.modalOverlay}
          onClick={closePairingModal}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.pairingModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Conexão do WhatsApp Web"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Conectar WhatsApp Web</h3>
                <p>{pairingModal.instanceName}</p>
              </div>
              <div className={styles.modalHeaderButtons}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setPairingGuideOpen((current) => !current)}
                  aria-label="Abrir mini tutorial de conexão no celular"
                  title="Mini tutorial (Android / iPhone)"
                >
                  <IconDeviceMobile size={16} />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={closePairingModal}
                  aria-label="Fechar modal de pareamento"
                >
                  <IconX size={16} />
                </button>
              </div>
            </header>

            {pairingGuideOpen ? (
              <section className={styles.pairingGuidePanel} aria-label="Mini tutorial de conexão do WhatsApp Web">
                <div className={styles.pairingGuideHeader}>
                  <strong>Como conectar no WhatsApp Web</strong>
                  <span>Escolha seu celular:</span>
                </div>
                <div className={styles.pairingGuideTabs}>
                  <button
                    type="button"
                    className={classNames(styles.pairingGuideTab, pairingGuidePlatform === "android" && styles.pairingGuideTabActive)}
                    onClick={() => setPairingGuidePlatform("android")}
                  >
                    Android
                  </button>
                  <button
                    type="button"
                    className={classNames(styles.pairingGuideTab, pairingGuidePlatform === "ios" && styles.pairingGuideTabActive)}
                    onClick={() => setPairingGuidePlatform("ios")}
                  >
                    iPhone (iOS)
                  </button>
                </div>
                <div className={styles.pairingGuideMediaWrap}>
                  <img
                    src={WHATSAPP_WEB_GUIDE_ASSETS[pairingGuidePlatform]}
                    alt={
                      pairingGuidePlatform === "android"
                        ? "Tutorial em GIF para conectar WhatsApp Web no Android"
                        : "Tutorial em GIF para conectar WhatsApp Web no iPhone"
                    }
                    className={styles.pairingGuideMedia}
                    loading="lazy"
                  />
                </div>
                <p className={styles.pairingGuideHint}>
                  No seu celular, abra o WhatsApp e vá em <strong>Aparelhos conectados</strong> para ler o QR Code.
                </p>
              </section>
            ) : null}

            <div className={styles.pairingModalBody}>
              {pairingModal.loading ? (
                <div className={styles.pairingLoading}>
                  <IconLoader2 size={18} className={styles.spin} />
                  {pairingModal.mode === "qr"
                    ? "Gerando QR Code de pareamento..."
                    : pairingModal.mode === "code"
                      ? "Gerando código de pareamento..."
                      : "Gerando dados de pareamento..."}
                </div>
              ) : null}

              {!pairingModal.loading && pairingModal.error ? (
                <div className={styles.modalError}>{pairingModal.error}</div>
              ) : null}

              {!pairingModal.loading && pairingModal.data?.linkingCode ? (
                <div className={styles.pairingValueBox}>
                  <strong>Código de pareamento</strong>
                  <code className={styles.pairingValueCode}>{pairingModal.data.linkingCode}</code>
                </div>
              ) : null}

              {!pairingModal.loading && pairingModal.data?.qrCode ? (
                <div className={styles.pairingValueBox}>
                  <strong>QR Code</strong>
                  {pairingModal.data.qrCode.startsWith("data:image") ||
                  /^https?:\/\//i.test(pairingModal.data.qrCode) ? (
                    <img src={pairingModal.data.qrCode} alt="QR Code de pareamento" className={styles.pairingQrImage} />
                  ) : (
                    <code className={styles.pairingValueCode}>{pairingModal.data.qrCode}</code>
                  )}
                </div>
              ) : null}

              {!pairingModal.loading &&
              !pairingModal.error &&
              !pairingModal.data?.linkingCode &&
              !pairingModal.data?.qrCode ? (
                <p className={styles.pairingPlaceholder}>
                  Nenhum dado de pareamento disponível no momento.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isCreateGroupModalOpen ? (
        <div className={styles.modalOverlay} onClick={closeCreateGroupModal} role="presentation">
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Adicionar grupo por convite"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Adicionar grupo por convite</h3>
                <p>Cole o link de convite para vincular um novo grupo ao bot.</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeCreateGroupModal}
                disabled={creatingGroupFromInvite}
                aria-label="Fechar modal de grupo por convite"
              >
                <IconX size={16} />
              </button>
            </header>

            <form className={styles.modalForm} onSubmit={createGroupByInvite}>
              <label>
                WhatsApp conectado
                <select
                  value={groupInviteForm.instanceId}
                  onChange={(event) =>
                    setGroupInviteForm((current) => ({ ...current, instanceId: event.target.value }))
                  }
                  required
                >
                  <option value="">Selecione</option>
                  {instances
                    .filter((instance) => instance.sessionStatus === "conectado")
                    .map((instance) => (
                      <option key={instance.id} value={instance.id}>
                        {instance.name}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                Link de convite do grupo
                <input
                  value={groupInviteForm.invite}
                  onChange={(event) =>
                    setGroupInviteForm((current) => ({ ...current, invite: event.target.value }))
                  }
                  placeholder="https://chat.whatsapp.com/..."
                  required
                />
              </label>

              <div className={styles.modalFormFooter}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={closeCreateGroupModal}
                  disabled={creatingGroupFromInvite}
                >
                  Cancelar
                </button>
                <button type="submit" className={styles.primaryButton} disabled={creatingGroupFromInvite}>
                  {creatingGroupFromInvite ? <IconLoader2 size={14} className={styles.spin} /> : <IconPlus size={14} />}
                  Adicionar grupo
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {groupLinkModal ? (
        <div className={styles.modalOverlay} onClick={closeLinkGroupModal} role="presentation">
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Vincular grupo à conexão"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Vincular grupo</h3>
                <p>Selecione a conexão que administra este grupo.</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeLinkGroupModal}
                disabled={linkingGroupId === groupLinkModal.groupId}
                aria-label="Fechar modal de vínculo"
              >
                <IconX size={16} />
              </button>
            </header>

            <div className={styles.modalForm}>
              <label>
                Grupo
                <input value={groupLinkModal.groupName} readOnly />
              </label>
              <label>
                WhatsApp conectado
                <select
                  value={groupLinkModal.instanceId}
                  onChange={(event) =>
                    setGroupLinkModal((current) =>
                      current ? { ...current, instanceId: event.target.value } : current,
                    )
                  }
                  required
                >
                  <option value="">Selecione</option>
                  {connectedInstances.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className={styles.modalFormFooter}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={closeLinkGroupModal}
                  disabled={linkingGroupId === groupLinkModal.groupId}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void confirmLinkGroup()}
                  disabled={linkingGroupId === groupLinkModal.groupId}
                >
                  {linkingGroupId === groupLinkModal.groupId ? (
                    <IconLoader2 size={14} className={styles.spin} />
                  ) : (
                    <IconPlus size={14} />
                  )}
                  Vincular grupo
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateInstanceModalOpen ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (creatingInstance) return;
            closeCreateInstanceModal({ cancelOnboarding: true });
          }}
          role="presentation"
        >
          <div
          className={classNames(styles.modalCard, styles.createInstanceModalCard)}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Criar perfil de WhatsApp"
        >
            <header className={styles.modalHeader}>
              <div>
                <h3>Novo perfil WhatsApp</h3>
                <p>Cada perfil tem sua própria instância, conversas, fluxos, status e configurações.</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => closeCreateInstanceModal({ cancelOnboarding: true })}
                disabled={creatingInstance}
                aria-label="Fechar modal de criação"
              >
                <IconX size={16} />
              </button>
            </header>

            <form className={styles.modalForm} onSubmit={createInstance}>
              <label>
                Servidor
                <select
                  value={instanceForm.serverId}
                  onFocus={handleCreateInstanceServerFocus}
                  onChange={handleCreateInstanceServerChange}
                  required
                >
                  <option value="">Selecione</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Nome do perfil
                <input
                  value={instanceForm.name}
                  onChange={handleCreateInstanceNameChange}
                  placeholder="Ex.: WhatsApp Comercial"
                  required
                />
              </label>

              <label>
                Número do WhatsApp
                <input
                  value={instanceForm.phone}
                  onChange={handleCreateInstancePhoneChange}
                  placeholder="5592999999999"
                  required
                />
              </label>

              <div className={styles.modalFormFooter}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => closeCreateInstanceModal({ cancelOnboarding: true })}
                  disabled={creatingInstance}
                >
                  Cancelar
                </button>
                <button type="submit" className={styles.primaryButton} disabled={creatingInstance}>
                  {creatingInstance ? <IconLoader2 size={14} className={styles.spin} /> : <IconPlus size={14} />}
                  Criar perfil
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {instanceDeleteModal ? (
        <div className={styles.modalOverlay} onClick={closeDeleteInstanceModal} role="presentation">
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Excluir conexão"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Excluir conexão</h3>
                <p>{instanceDeleteModal.instanceName}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeDeleteInstanceModal}
                disabled={deletingInstanceId === instanceDeleteModal.instanceId}
                aria-label="Fechar modal de exclusão"
              >
                <IconX size={16} />
              </button>
            </header>

            <div className={styles.automationModalBody}>
              {instanceDeleteModal.linkedGroups > 0 ? (
                <>
                  <p className={styles.instanceDeleteIntro}>
                    Escolha o que fazer com os grupos vinculados a esta conexão ({instanceDeleteModal.linkedGroups}).
                  </p>
                  <label className={styles.instanceDeleteOption}>
                    <input
                      type="radio"
                      name="instance-delete-mode"
                      value="keep_active"
                      checked={instanceDeleteModal.strategy === "keep_active"}
                      onChange={() =>
                        setInstanceDeleteModal((current) =>
                          current ? { ...current, strategy: "keep_active" } : current,
                        )
                      }
                      disabled={deletingInstanceId === instanceDeleteModal.instanceId}
                    />
                    <div>
                      <strong>Manter grupos ativos/vencidos para novo vínculo</strong>
                      <span>
                        Grupos com histórico ativo serão preservados para reconexão futura. Grupos nunca ativados serão removidos.
                      </span>
                    </div>
                  </label>
                  <label className={styles.instanceDeleteOption}>
                    <input
                      type="radio"
                      name="instance-delete-mode"
                      value="delete_all"
                      checked={instanceDeleteModal.strategy === "delete_all"}
                      onChange={() =>
                        setInstanceDeleteModal((current) =>
                          current ? { ...current, strategy: "delete_all" } : current,
                        )
                      }
                      disabled={deletingInstanceId === instanceDeleteModal.instanceId}
                    />
                    <div>
                      <strong>Excluir conexão e todos os grupos vinculados</strong>
                      <span>
                        Remove tudo desta conexão imediatamente para manter o painel totalmente limpo.
                      </span>
                    </div>
                  </label>
                </>
              ) : (
                <p className={styles.instanceDeleteIntro}>
                  Não há grupos vinculados a esta conexão. A exclusão será imediata.
                </p>
              )}
            </div>

            <footer className={styles.modalFormFooter}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={closeDeleteInstanceModal}
                disabled={deletingInstanceId === instanceDeleteModal.instanceId}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton, styles.dangerPrimaryButton)}
                onClick={() => void confirmDeleteInstance()}
                disabled={deletingInstanceId === instanceDeleteModal.instanceId}
              >
                {deletingInstanceId === instanceDeleteModal.instanceId ? (
                  <IconLoader2 size={14} className={styles.spin} />
                ) : (
                  <IconTrash size={14} />
                )}
                Excluir conexão
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {transferLicenseModalGroupId ? (
        <div className={styles.modalOverlay} onClick={closeTransferLicenseModal} role="presentation">
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Transferir assinatura do grupo"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Transferir assinatura</h3>
                <p>
                  Mova o plano ativo de {transferLicenseSourceGroup?.name ?? "grupo atual"} para outro grupo do painel.
                </p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeTransferLicenseModal}
                disabled={transferLicenseBusy}
                aria-label="Fechar modal de transferência"
              >
                <IconX size={16} />
              </button>
            </header>
            <div className={styles.modalForm}>
              {transferLicenseError ? <div className={styles.modalError}>{transferLicenseError}</div> : null}
              <label>
                Novo grupo
                <select
                  value={transferLicenseTargetGroupId}
                  onChange={(event) => setTransferLicenseTargetGroupId(event.target.value)}
                  disabled={transferLicenseBusy || transferLicenseTargetGroups.length === 0}
                >
                  {transferLicenseTargetGroups.length === 0 ? (
                    <option value="">Nenhum grupo sem assinatura disponível</option>
                  ) : null}
                  {transferLicenseTargetGroups.map((group) => (
                    <option key={`transfer-license-target-${group.id}`} value={String(group.id)}>
                      {group.name} · {group.instanceName}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.quickPaymentNotice}>
                O grupo de origem perde a assinatura e o grupo escolhido passa a ficar ativo com a mesma validade.
              </div>
            </div>
            <footer className={styles.modalFormFooter}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={closeTransferLicenseModal}
                disabled={transferLicenseBusy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void submitTransferLicense()}
                disabled={transferLicenseBusy || transferLicenseTargetGroups.length === 0}
              >
                {transferLicenseBusy ? <IconLoader2 size={14} className={styles.spin} /> : <IconArrowBackUp size={14} />}
                Transferir
              </button>
            </footer>
          </div>
        </div>
      ) : null}

	      {quickCheckoutContext ? (
	        <div
	          className={styles.modalOverlay}
          onClick={closeQuickCheckout}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.quickPaymentModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Pagamento rápido"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>{quickCheckoutContext.title}</h3>
                <p>{quickCheckoutContext.description}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeQuickCheckout}
                disabled={quickCheckoutGenerating}
                aria-label="Fechar modal de pagamento"
              >
                <IconX size={16} />
              </button>
            </header>

            <div className={styles.quickPaymentBody}>
              {quickCheckoutError ? <div className={styles.modalError}>{quickCheckoutError}</div> : null}
              {quickCheckoutSuccess ? (
                <div className={classNames(styles.quickPaymentNotice, styles.quickPaymentNoticeSuccess)}>
                  {quickCheckoutSuccess}
                </div>
              ) : null}

	              {quickCheckoutPlan ? (
	                <div className={styles.quickPaymentSummary}>
	                  {quickCheckoutIsGroupLicense && !quickCheckoutPending ? (
		                    <label className={styles.quickPaymentProviderLabel}>
		                      Plano legado do grupo
	                      <select
	                        value={String(quickCheckoutContext.planId)}
	                        onChange={(event) => {
	                          const planId = Number.parseInt(event.target.value, 10);
	                          if (!Number.isFinite(planId) || planId <= 0) return;
	                          setQuickCheckoutContext((current) =>
	                            current ? { ...current, planId } : current,
	                          );
	                        }}
	                        disabled={quickCheckoutGenerating}
	                      >
	                        {groupLicensePlans.map((plan) => (
	                          <option key={plan.id} value={plan.id}>
	                            {getGroupLicensePlanLabel(plan.durationDays)} - {formatCurrency(plan.addonGroupPrice > 0 ? plan.addonGroupPrice : plan.price)}
	                          </option>
	                        ))}
	                      </select>
	                    </label>
	                  ) : null}
                    {quickCheckoutIsProfilePlan && !quickCheckoutPending ? (
                      <label className={styles.quickPaymentProviderLabel}>
                        Plano do perfil
                        <select
                          value={String(quickCheckoutContext.planId)}
                          onChange={(event) => {
                            const planId = Number.parseInt(event.target.value, 10);
                            if (!Number.isFinite(planId) || planId <= 0) return;
                            setQuickCheckoutContext((current) =>
                              current ? { ...current, planId } : current,
                            );
                          }}
                          disabled={quickCheckoutGenerating}
                        >
                          {profilePlanOptions.map((plan) => (
                              <option key={plan.id} value={plan.id}>
                                {plan.name} - {formatCurrency(plan.price)}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
	                  {quickCheckoutContext.includePlan ? (
	                    <div className={styles.quickPaymentSummaryLine}>
	                      <span>
	                          {quickCheckoutIsGroupLicense
	                            ? getGroupLicensePlanLabel(quickCheckoutPlan.durationDays)
                            : quickCheckoutIsProfilePlan
                              ? quickCheckoutPlan.name
                              : "Renovação do plano"}
                        </span>
	                      <strong>{formatCurrency(quickCheckoutPlan.price)}</strong>
	                    </div>
	                  ) : null}
                    {quickCheckoutIsProfilePlan ? (
                      <div className={styles.quickPaymentSummaryLine}>
                        <span>Libera perfis, grupos e funcionalidades</span>
                        <strong>{quickCheckoutPlan.durationDays} dias</strong>
                      </div>
                    ) : null}
	                  {quickCheckoutContext.addons.instance > 0 ? (
	                    <div className={styles.quickPaymentSummaryLine}>
	                      <span>Perfil adicional × {quickCheckoutContext.addons.instance}</span>
	                      <strong>{formatCurrency(quickCheckoutContext.addons.instance * quickCheckoutPlan.addonInstancePrice)}</strong>
                    </div>
                  ) : null}
                  {quickCheckoutContext.addons.group > 0 ? (
                    <div className={styles.quickPaymentSummaryLine}>
	                      <span>Licença legada de grupo × {quickCheckoutContext.addons.group}</span>
                      <strong>{formatCurrency(quickCheckoutContext.addons.group * quickCheckoutGroupUnitPrice)}</strong>
                    </div>
                  ) : null}
                  <div className={classNames(styles.quickPaymentSummaryLine, styles.quickPaymentSummaryTotal)}>
                    <span>Total</span>
	                    <strong>{formatCurrency(quickCheckoutEstimatedAmount)}</strong>
                  </div>
                  {!quickCheckoutPending && quickCheckoutCanUseBalance && quickCheckoutEstimatedAmount > 0 ? (
                    <label className={styles.quickPaymentBalanceToggle}>
                      <span>
                        <strong>Usar saldo do painel</strong>
                        <small>
                          Disponível: {formatCurrency(quickCheckoutAvailableBalance)}
                          {quickCheckoutUseBalance && quickCheckoutBalanceApplied > 0
                            ? ` · será usado ${formatCurrency(quickCheckoutBalanceApplied)}`
                            : ""}
                        </small>
                      </span>
                      <button
                        type="button"
                        className={classNames(styles.toggleSwitch, quickCheckoutUseBalance && styles.toggleSwitchOn)}
                        aria-pressed={quickCheckoutUseBalance}
                        onClick={() => setQuickCheckoutUseBalance((current) => !current)}
                        disabled={quickCheckoutGenerating || quickCheckoutAvailableBalance <= 0}
                      >
                        <span />
                      </button>
                    </label>
                  ) : null}
                  {quickCheckoutUseBalance && quickCheckoutBalanceApplied > 0 ? (
                    <>
                      <div className={styles.quickPaymentSummaryLine}>
                        <span>Saldo aplicado</span>
                        <strong>-{formatCurrency(quickCheckoutBalanceApplied)}</strong>
                      </div>
                      <div className={classNames(styles.quickPaymentSummaryLine, styles.quickPaymentSummaryTotal)}>
                        <span>Restante a pagar</span>
                        <strong>{formatCurrency(quickCheckoutAmountDue)}</strong>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className={styles.quickPaymentNotice}>
                  Nenhum plano disponível para gerar o pagamento.
                </div>
              )}

              {!quickCheckoutPending && quickCheckoutAmountDue > 0 ? (
                <label className={styles.quickPaymentProviderLabel}>
                  Forma de pagamento
                  <select
                    value={quickCheckoutProvider}
                    onChange={(event) => setQuickCheckoutProvider(event.target.value as PaymentMethodProvider)}
                    disabled={quickCheckoutGenerating}
                  >
                    {availablePaymentProviders.map((provider) => (
                      <option key={provider} value={provider}>
                        {PROVIDER_LABELS[provider]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {quickCheckoutPending ? (
                <div className={styles.quickPaymentResult}>
                  <p>
	                    Pagamento criado. Valor de <strong>{formatCurrency(quickCheckoutPending.amount ?? quickCheckoutEstimatedAmount)}</strong>.
                  </p>
                  <p>
                    {quickCheckoutPending.expiresAt
                      ? `Cobrança válida até ${formatDateTime(quickCheckoutPending.expiresAt)}.`
                      : "A confirmação é automática após o pagamento."}
                  </p>
                  <p>Assim que o pagamento for aprovado, a liberação é feita automaticamente nesta tela.</p>

                  {quickCheckoutQrImageSrc ? (
                    <img
                      src={quickCheckoutQrImageSrc}
                      alt="QR Code Pix"
                      className={styles.quickPaymentQr}
                    />
                  ) : null}

                  {quickCheckoutPending.qrCode ? (
                    <label className={styles.quickPaymentCodeLabel}>
                      Código Pix
                      <textarea rows={4} readOnly value={quickCheckoutPending.qrCode} />
                    </label>
                  ) : null}

                  <div className={styles.quickPaymentActions}>
                    {quickCheckoutPending.qrCode ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void copyPaymentValue(quickCheckoutPending.qrCode ?? "", "Código Pix copiado.")}
                      >
                        Copiar código Pix
                      </button>
                    ) : null}
                    {quickCheckoutPending.ticketUrl ? (
                      <a
                        href={quickCheckoutPending.ticketUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.ghostButton}
                      >
                        Abrir link de pagamento
                      </a>
                    ) : null}
                    {quickCheckoutPending.ticketUrl ? (
                      <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() =>
                          void copyPaymentValue(
                            quickCheckoutPending.ticketUrl ?? "",
                            "Link de pagamento copiado.",
                          )
                        }
                      >
                        Copiar link
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <footer className={styles.modalFormFooter}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={closeQuickCheckout}
                disabled={quickCheckoutGenerating}
              >
                {quickCheckoutPending ? "Fechar" : "Cancelar"}
              </button>
              {!quickCheckoutPending ? (
                <button
                  type="button"
                  className={classNames(
                    styles.primaryButton,
                    styles.modalFooterButton,
                    styles.quickPaymentGenerateButton,
                  )}
                  onClick={() => void createQuickCheckout()}
                  disabled={quickCheckoutGenerating || !quickCheckoutPlan}
                >
                  {quickCheckoutGenerating ? <IconLoader2 size={14} className={styles.spin} /> : <IconCreditCard size={14} />}
                  {quickCheckoutAmountDue <= 0 && quickCheckoutUseBalance ? "Confirmar com saldo" : "Gerar pagamento"}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {coinMemberModal ? (
        <div
          className={styles.modalOverlay}
          onClick={closeCoinMemberModal}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.botCoinsMemberModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes de BotCoins"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Detalhes do membro</h3>
                <p>BotCoins e histórico do usuário</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeCoinMemberModal}
                aria-label="Fechar detalhes do membro"
              >
                <IconX size={16} />
              </button>
            </header>

            {(() => {
              const member = activeCoinMember ?? coinMemberModal;
              if (!member) return null;
              const display = formatParticipantDisplay(member.memberJid);
              const dailyDateLabel = member.dailyDate
                ? new Date(member.dailyDate).toLocaleDateString("pt-BR")
                : "—";
              const ledgerVisible = coinLedgerMember === member.memberJid;
              return (
                <>
                  <div className={styles.botCoinsMemberModalBody}>
                    <div className={styles.botCoinsMemberSummary}>
                      <div className={styles.avatarBadge}>{participantAvatarLabel(display)}</div>
                      <div className={styles.botCoinsMemberSummaryText}>
                        <strong>{display}</strong>
                        <small>{member.memberJid}</small>
                      </div>
                    </div>

                    <div className={styles.botCoinsMemberStats}>
                      <div className={styles.botCoinsMemberStatCard}>
                        <span>Saldo</span>
                        <strong>
                          {member.balance} {botCoinsCurrencyLabel}
                        </strong>
                      </div>
                      <div className={styles.botCoinsMemberStatCard}>
                        <span>Nível</span>
                        <strong>{member.level}</strong>
                      </div>
                      <div className={styles.botCoinsMemberStatCard}>
                        <span>XP</span>
                        <strong>{member.xp}</strong>
                      </div>
                      <div className={styles.botCoinsMemberStatCard}>
                        <span>Total ganho</span>
                        <strong>
                          {member.totalEarned} {botCoinsCurrencyLabel}
                        </strong>
                      </div>
                      <div className={styles.botCoinsMemberStatCard}>
                        <span>Total gasto</span>
                        <strong>
                          {member.totalSpent} {botCoinsCurrencyLabel}
                        </strong>
                      </div>
                      <div className={styles.botCoinsMemberStatCard}>
                        <span>Ganho no dia</span>
                        <strong>
                          {member.dailyEarned} {botCoinsCurrencyLabel}
                        </strong>
                      </div>
                    </div>

                    <div className={styles.botCoinsMemberMetaList}>
                      <span>Último ganho: {formatDateTime(member.lastAwardAt)}</span>
                      <span>Última mensagem: {formatDateTime(member.lastMessageAt)}</span>
                      <span>Data diária: {dailyDateLabel}</span>
                    </div>

                    <div className={styles.botCoinsMemberActionRow}>
                      <button
                        type="button"
                        className={classNames(styles.primaryButton, styles.compactButton)}
                        onClick={() => {
                          closeCoinMemberModal();
                          openCoinAdjustModal(member.memberJid, 1);
                        }}
                      >
                        + Adicionar saldo
                      </button>
                      <button
                        type="button"
                        className={classNames(styles.ghostButton, styles.compactButton)}
                        onClick={() => {
                          closeCoinMemberModal();
                          openCoinAdjustModal(member.memberJid, -1);
                        }}
                      >
                        - Remover saldo
                      </button>
                      <button
                        type="button"
                        className={classNames(styles.ghostButton, styles.compactButton)}
                        onClick={() => {
                          if (ledgerVisible) {
                            setCoinLedgerMember(null);
                            setCoinLedgerEntries([]);
                            return;
                          }
                          void loadCoinLedger(member.memberJid);
                        }}
                        disabled={coinLedgerLoading}
                      >
                        {ledgerVisible ? "Ocultar histórico" : "Ver histórico"}
                      </button>
                      <button
                        type="button"
                        className={classNames(styles.ghostButton, styles.compactButton, styles.dangerButton)}
                        onClick={() => void resetCoinMember(member.memberJid)}
                        disabled={coinMemberResetting === member.memberJid}
                      >
                        {coinMemberResetting === member.memberJid ? (
                          <IconLoader2 size={14} className={styles.spin} />
                        ) : null}
                        Resetar usuário
                      </button>
                    </div>

                    {ledgerVisible ? (
                      <div className={styles.botCoinsMemberLedger}>
                        <div className={styles.botCoinsMemberLedgerHeader}>
                          <strong>Histórico</strong>
                          <button
                            type="button"
                            className={classNames(styles.ghostButton, styles.compactButton)}
                            onClick={() => void loadCoinLedger(member.memberJid)}
                            disabled={coinLedgerLoading}
                          >
                            {coinLedgerLoading ? (
                              <IconLoader2 size={14} className={styles.spin} />
                            ) : (
                              <IconRefresh size={14} />
                            )}
                            Atualizar
                          </button>
                        </div>
                        <div className={styles.botCoinsLedgerList}>
                          {coinLedgerLoading ? (
                            <p className={styles.botCoinsEmpty}>Carregando histórico...</p>
                          ) : coinLedgerEntries.length === 0 ? (
                            <p className={styles.botCoinsEmpty}>Nenhum lançamento encontrado.</p>
                          ) : (
                            coinLedgerEntries.map((entry) => {
                              const deltaLabel = entry.delta > 0 ? `+${entry.delta}` : `${entry.delta}`;
                              const deltaClass =
                                entry.delta >= 0 ? styles.botCoinsLedgerPositive : styles.botCoinsLedgerNegative;
                              const metaParts: string[] = [
                                new Date(entry.createdAt).toLocaleString("pt-BR"),
                                `Saldo: ${entry.balanceAfter}`,
                              ];
                              if (entry.reason === "level_up" && entry.metadata && typeof entry.metadata.levelGained === "number") {
                                metaParts.push(`Níveis: ${entry.metadata.levelGained}`);
                              }
                              return (
                                <article key={entry.id} className={styles.botCoinsLedgerRow}>
                                  <header className={styles.botCoinsLedgerHeader}>
                                    <strong>{formatCoinLedgerReason(entry)}</strong>
                                    <span className={classNames(styles.botCoinsLedgerDelta, deltaClass)}>
                                      {deltaLabel} {botCoinsCurrencyLabel}
                                    </span>
                                  </header>
                                  <div className={styles.botCoinsLedgerMeta}>
                                    {metaParts.map((item) => (
                                      <span key={`${entry.id}-${item}`}>{item}</span>
                                    ))}
                                  </div>
                                </article>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <footer className={styles.modalFormFooter}>
                    <button
                      type="button"
                      className={classNames(styles.ghostButton, styles.modalFooterButton)}
                      onClick={closeCoinMemberModal}
                    >
                      Fechar
                    </button>
                  </footer>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {coinAdjustModal ? (
        <div
          className={styles.modalOverlay}
          onClick={() => setCoinAdjustModal(null)}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.createInstanceModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Ajustar BotCoins"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>Ajustar BotCoins</h3>
                <p>Membro: {formatParticipantDisplay(coinAdjustModal.memberJid)}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setCoinAdjustModal(null)}
                aria-label="Fechar ajuste de BotCoins"
              >
                <IconX size={16} />
              </button>
            </header>

            <form
              className={styles.modalForm}
              onSubmit={(event) => {
                event.preventDefault();
                void submitCoinAdjustment();
              }}
            >
              <label>
                Valor do ajuste (use negativo para remover)
                <input
                  type="number"
                  value={coinAdjustValue}
                  onChange={(event) => setCoinAdjustValue(event.target.value)}
                  placeholder="Ex: 10 ou -5"
                />
              </label>
              <label>
                Motivo (opcional)
                <input
                  value={coinAdjustReason}
                  onChange={(event) => setCoinAdjustReason(event.target.value)}
                  placeholder="Admin ajuste manual"
                />
              </label>
            </form>

            <footer className={styles.modalFormFooter}>
              <button
                type="button"
                className={classNames(styles.ghostButton, styles.modalFooterButton)}
                onClick={() => setCoinAdjustModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={classNames(styles.primaryButton, styles.modalFooterButton)}
                onClick={() => void submitCoinAdjustment()}
              >
                <IconDeviceFloppy size={14} />
                Salvar ajuste
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {automationModal ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (automationModalSaving) return;
            setAutomationModal(null);
          }}
          role="presentation"
        >
          <div
            className={
              automationModal === "welcome"
                ? styles.welcomeEditorModalCard
                : classNames(styles.modalCard, styles.automationModalCard)
            }
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Configuração de automação"
          >
            {automationModal === "welcome" ? null : (
              <header className={styles.modalHeader}>
                <div>
                  <h3>
	                    {automationModal === "autoresposta"
	                      ? "Configurar autoresposta"
	                      : automationModal === "farewell"
	                        ? "Configurar saída"
	                      : automationModal === "botinterage"
                        ? "Bot interage (IA)"
                      : automationModal === "allowedLinks"
                        ? "Links permitidos"
                      : automationModal === "bannedWords"
                        ? "Palavras proibidas"
                        : automationModal === "moderation"
                          ? "Regras de infração"
                        : automationModal === "blacklist"
                          ? "Lista de bloqueio"
                        : automationModal === "schedule"
                          ? "Abrir e fechar grupo"
                        : automationModal === "antiInactivity"
                          ? "AntiAFK"
                        : automationModal === "menus"
                          ? "Menus do bot"
                          : "Horários pagantes"}
                  </h3>
                  <p>{selectedGroup?.name}</p>
                </div>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setAutomationModal(null)}
                  disabled={automationModalSaving}
                  aria-label="Fechar modal de automação"
                >
                  <IconX size={16} />
                </button>
              </header>
            )}

            <div className={styles.automationModalBody}>
              {automationModalError ? <div className={styles.modalError}>{automationModalError}</div> : null}

	              {automationModal === "welcome" ? (
	                <div className={styles.welcomePhoneEditorLayout}>
                  <aside className={styles.welcomePhoneShell} aria-label="Preview da mensagem de boas-vindas">
                    <div className={styles.welcomePhoneScreen}>
                      <div className={styles.welcomePhoneStatus}>
                        <span>11:14</span>
                        <span>4G</span>
                      </div>
                      <div className={styles.welcomePhoneConfigBar}>
                        <label className={styles.welcomePhoneToggle}>
                          <span>Boas-vindas</span>
                          <button
                            type="button"
                            className={classNames(styles.toggleSwitch, welcomeDraft.enabled && styles.toggleSwitchOn)}
                            aria-pressed={welcomeDraft.enabled}
                            onClick={toggleWelcomeEnabled}
                            disabled={automationModalSaving || welcomeAutoSaving}
                          >
                            <span />
                          </button>
                          <small>{welcomeAutoSaving ? "Salvando..." : "Salvo automaticamente"}</small>
                        </label>
                        <button
                          type="button"
                          className={styles.welcomePhoneCloseButton}
                          onClick={() => setAutomationModal(null)}
                          disabled={automationModalSaving}
                          aria-label="Fechar configuração de boas-vindas"
                        >
                          <IconX size={16} />
                        </button>
                      </div>
                      <header className={styles.welcomePhoneHeader}>
                        <span className={styles.welcomePhoneBack}>‹</span>
                        <div className={styles.welcomePhoneAvatar}>
                          {selectedGroup?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={selectedGroup.imageUrl} alt="" />
                          ) : (
                            <span>{(selectedGroup?.name ?? "G").slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                        <strong>{selectedGroup?.name ?? "Grupo"}</strong>
                        <div className={styles.welcomePhoneMenuWrap}>
                          <button
                            type="button"
                            className={styles.welcomePhoneDots}
                            onClick={() => setWelcomePhoneMenuOpen((current) => !current)}
                            aria-expanded={welcomePhoneMenuOpen}
                            aria-label="Abrir menu de boas-vindas"
                          >
                            ⋮
                          </button>
                          {welcomePhoneMenuOpen ? (
                            <div className={styles.welcomePhoneDropdown}>
                              <button
                                type="button"
                                onClick={() => {
                                  setWelcomePhoneMenuOpen(false);
                                  addWelcomeAttachmentDraft();
                                }}
                              >
                                <IconPlus size={14} />
                                Adicionar nova mensagem
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setWelcomePhoneMenuOpen(false);
                                  setWelcomeEditorField("media");
                                }}
                              >
                                <IconCamera size={14} />
                                Editar mídia principal
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setWelcomePhoneMenuOpen(false);
                                  setWelcomeEditorField("caption");
                                }}
                              >
                                <IconPencil size={14} />
                                Editar texto principal
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setWelcomePhoneMenuOpen(false);
                                  openWelcomeButtonEditor(0);
                                }}
                              >
                                <IconArrowBackUp size={14} />
                                Configurar botões
                              </button>
                            </div>
                          ) : null}
	                        </div>
	                      </header>

	                      <div className={styles.welcomePhoneMediaOptions}>
	                        <label className={styles.welcomePhoneOptionToggle}>
	                          <span>
	                            <IconCamera size={14} />
	                            Foto da pessoa
	                          </span>
	                          <button
	                            type="button"
	                            className={classNames(
	                              styles.toggleSwitch,
	                              welcomeDraft.useParticipantProfilePhoto && styles.toggleSwitchOn,
	                            )}
	                            aria-pressed={welcomeDraft.useParticipantProfilePhoto}
	                            onClick={toggleWelcomeParticipantProfilePhoto}
	                            disabled={automationModalSaving || welcomeAutoSaving}
	                          >
	                            <span />
	                          </button>
	                        </label>
	                        <label className={styles.welcomePhoneOptionToggle}>
	                          <span>Sticker</span>
	                          <button
	                            type="button"
	                            className={classNames(styles.toggleSwitch, welcomeDraft.asSticker && styles.toggleSwitchOn)}
	                            aria-pressed={welcomeDraft.asSticker}
	                            onClick={toggleWelcomeAsSticker}
	                            disabled={automationModalSaving || welcomeAutoSaving}
	                          >
	                            <span />
	                          </button>
	                        </label>
	                      </div>

	                      <div className={styles.welcomePhoneChat}>
	                        {(() => {
                          const mainAfterAttachments = welcomeDraft.replyButtons?.position === "after_attachments";
                          const canMoveMain = Boolean(welcomeDraft.replyButtons && welcomeDraft.attachments.length > 0);
                          const renderMainBubble = () => (
                            <section className={styles.welcomeBubble}>
                              {canMoveMain ? (
                                <div className={styles.welcomeBubbleMoveControls}>
                                  <button
                                    type="button"
                                    onClick={() => moveWelcomeMainMessage("up")}
                                    disabled={!mainAfterAttachments}
                                    aria-label="Mover mensagem principal para cima"
                                  >
                                    <IconChevronUp size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveWelcomeMainMessage("down")}
                                    disabled={mainAfterAttachments}
                                    aria-label="Mover mensagem principal para baixo"
                                  >
                                    <IconChevronDown size={13} />
                                  </button>
                                </div>
                              ) : null}
                              <span className={styles.welcomePreviewSender}>
                                {selectedGroup?.instanceName || "Bot"}
                              </span>
	                              {welcomeDraft.useParticipantProfilePhoto ? (
	                                <button
	                                  type="button"
	                                  className={styles.welcomeProfilePhotoPreview}
	                                  onClick={toggleWelcomeParticipantProfilePhoto}
	                                >
	                                  <span className={styles.welcomeProfilePhotoFrame}>
	                                    <IconUsersGroup size={32} />
	                                  </span>
	                                  <span>
	                                    <strong>Foto do participante</strong>
	                                    <small>Imagem com legenda</small>
	                                  </span>
	                                </button>
                              ) : welcomeDraft.mediaUrl ? (
                                <div className={styles.welcomePreviewMedia}>
                                  <button
                                    type="button"
                                    className={styles.welcomeMediaExpandButton}
                                    onClick={() =>
                                      setWelcomeExpandedMedia({
                                        url: welcomeDraft.mediaUrl,
                                        kind: inferMediaTypeFromUrl(welcomeDraft.mediaUrl),
                                        title: "Mídia principal",
                                      })
                                    }
                                    aria-label="Expandir mídia principal"
                                  >
                                    {renderAutomationMediaPreview(null, welcomeDraft.mediaUrl)}
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.welcomePencilButton}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setWelcomeEditorField("media");
                                    }}
                                    aria-label="Editar mídia principal"
                                  >
                                    <IconPencil size={14} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.welcomeAddPreviewBlock}
                                  onClick={() => setWelcomeEditorField("media")}
                                >
                                  <IconCamera size={16} />
                                  Adicionar mídia
                                </button>
                              )}

                              <div className={styles.welcomePreviewText}>
                                <p>
                                  {welcomeDraft.caption.trim() ||
                                    "Olá {{nome}}, seja bem-vindo ao {{nomeGrupo}}!"}
                                </p>
                                <button
                                  type="button"
                                  className={styles.welcomePencilButton}
                                  onClick={() => setWelcomeEditorField("caption")}
                                  aria-label="Editar texto de boas-vindas"
                                >
                                  <IconPencil size={14} />
                                </button>
                              </div>

                              {welcomeDraft.replyButtons?.enabled && welcomeDraft.replyButtons.buttons.length > 0 ? (
                                <div className={styles.welcomePreviewButtons}>
                                  {welcomeDraft.replyButtons.buttons.map((button, index) => {
                                    const buttonType = button.type ?? "quick_reply";
                                    const icon =
                                      buttonType === "cta_url" ? (
                                        <IconExternalLink size={15} />
                                      ) : buttonType === "cta_call" ? (
                                        <IconPhone size={15} />
                                      ) : buttonType === "cta_copy" ? (
                                        <IconCopy size={15} />
                                      ) : (
                                        <IconArrowBackUp size={15} />
                                      );
                                    return (
                                      <div key={button.id || index} className={styles.welcomeQuickButtonRow}>
                                        <button
                                          type="button"
                                          className={styles.welcomeButtonDeleteInline}
                                          onClick={() => removeWelcomeButtonDraft(index)}
                                          aria-label={`Remover botão ${index + 1}`}
                                        >
                                          <IconTrash size={13} />
                                        </button>
                                        <div className={styles.welcomeQuickButton} aria-label={button.label.trim() || `Botão ${index + 1}`}>
                                          <span className={styles.welcomeQuickButtonIcon}>{icon}</span>
                                          <span className={styles.welcomeQuickButtonLabel}>
                                            {button.label.trim() || `Botão ${index + 1}`}
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          className={styles.welcomeButtonEditInline}
                                          onClick={() => openWelcomeButtonEditor(index)}
                                          aria-label={`Editar botão ${index + 1}`}
                                        >
                                          <IconPencil size={13} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                  {(welcomeDraft.replyButtons?.buttons.length ?? 0) < 3 ? (
                                    <button
                                      type="button"
                                      className={styles.welcomeButtonAddBottom}
                                      onClick={addWelcomeButtonDraft}
                                      aria-label="Adicionar botão"
                                    >
                                      <IconPlus size={14} />
                                      Adicionar botão
                                    </button>
                                  ) : null}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.welcomeAddPreviewBlock}
                                  onClick={() => openWelcomeButtonEditor(0)}
                                >
                                  <IconPlus size={16} />
                                  Adicionar botões
                                </button>
                              )}

                              <time>11:14 AM</time>
                            </section>
                          );
                          const renderAttachmentBubbles = () =>
                            welcomeDraft.attachments.length > 0 ? (
                              <div className={styles.welcomeExtraBubbleList}>
                                {welcomeDraft.attachments.map((attachment, index) => {
                                  const item = attachment as any;
                                  const attachmentKind = getWelcomeAttachmentLabel(item.kind);
                                  const attachmentPreviewRef = resolveWelcomeAttachmentPreviewUrl(item);
                                  const normalizedKind =
                                    item.kind === "video" ||
                                    item.kind === "audio" ||
                                    item.kind === "document" ||
                                    item.kind === "sticker"
                                      ? item.kind
                                      : "image";
                                  const title = item.fileName || item.caption || `${attachmentKind} configurado`;
                                  return (
                                    <section
                                      key={`${item.path ?? item.url ?? index}`}
                                      className={classNames(styles.welcomeBubble, styles.welcomeAttachmentBubble)}
                                    >
                                      <div className={styles.welcomeBubbleMoveControls}>
                                        <button
                                          type="button"
                                          onClick={() => moveWelcomeAttachmentDraft(index, "up")}
                                          disabled={index === 0}
                                          aria-label="Mover mensagem para cima"
                                        >
                                          <IconChevronUp size={13} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => moveWelcomeAttachmentDraft(index, "down")}
                                          disabled={index === welcomeDraft.attachments.length - 1}
                                          aria-label="Mover mensagem para baixo"
                                        >
                                          <IconChevronDown size={13} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => removeWelcomeAttachmentDraft(index)}
                                          aria-label="Remover mensagem extra"
                                        >
                                          <IconTrash size={13} />
                                        </button>
                                      </div>
                                      <button
                                        type="button"
                                        className={styles.welcomeAttachmentPreviewItem}
                                        onClick={() => {
                                          if (attachmentPreviewRef) {
                                            setWelcomeExpandedMedia({
                                              url: attachmentPreviewRef,
                                              kind: normalizedKind,
                                              title,
                                            });
                                          }
                                        }}
                                        disabled={!attachmentPreviewRef}
                                        aria-label="Abrir mídia da mensagem"
                                      >
                                        {attachmentPreviewRef ? (
                                          <div className={styles.welcomeAttachmentMediaThumb}>
                                            {renderAutomationMediaPreview(null, attachmentPreviewRef)}
                                          </div>
                                        ) : null}
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.welcomeAttachmentEditButton}
                                        onClick={() => setWelcomeEditorField("attachments")}
                                        aria-label="Editar mensagem extra"
                                      >
                                        <IconPencil size={13} />
                                      </button>
                                      <time>{index === 0 ? "11:15 AM" : "11:16 AM"}</time>
                                    </section>
                                  );
                                })}
                              </div>
                            ) : null;

                          return (
                            <>
                              {!mainAfterAttachments ? renderMainBubble() : null}
                              {renderAttachmentBubbles()}
                              {mainAfterAttachments ? renderMainBubble() : null}
                            </>
	                          );
	                        })()}
	                      </div>
	                      <footer className={styles.welcomePhoneFooter}>
	                        <label className={styles.welcomeFooterToggle}>
	                          <button
	                            type="button"
	                            className={classNames(
	                              styles.checkboxButton,
	                              welcomeDraft.useParticipantProfilePhoto && styles.checkboxButtonChecked,
	                            )}
	                            aria-pressed={welcomeDraft.useParticipantProfilePhoto}
	                            onClick={toggleWelcomeParticipantProfilePhoto}
	                            disabled={automationModalSaving || welcomeAutoSaving}
	                          >
	                            {welcomeDraft.useParticipantProfilePhoto ? <IconCheck size={15} /> : null}
	                          </button>
	                          Foto perfil
	                        </label>
	                        <label className={styles.welcomeFooterToggle}>
	                          <button
	                            type="button"
	                            className={classNames(styles.checkboxButton, welcomeDraft.asSticker && styles.checkboxButtonChecked)}
	                            aria-pressed={welcomeDraft.asSticker}
	                            onClick={toggleWelcomeAsSticker}
	                            disabled={automationModalSaving || welcomeAutoSaving}
	                          >
	                            {welcomeDraft.asSticker ? <IconCheck size={15} /> : null}
	                          </button>
	                          Sticker
	                        </label>
	                        <button
	                          type="button"
	                          className={styles.primaryButton}
	                          onClick={() => void saveAutomationModal()}
	                          disabled={automationModalSaving || welcomeAutoSaving}
	                        >
	                          {automationModalSaving || welcomeAutoSaving ? (
	                            <IconLoader2 size={14} className={styles.spin} />
	                          ) : null}
	                          Salvar boas-vindas
	                        </button>
	                      </footer>
	                    </div>
	                  </aside>

                  {welcomeExpandedMedia ? (
                    <div
                      className={styles.welcomeMediaLightbox}
                      onClick={() => setWelcomeExpandedMedia(null)}
                      role="presentation"
                    >
                      <div
                        className={styles.welcomeMediaLightboxCard}
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Visualizar mídia de boas-vindas"
                      >
                        <header>
                          <strong>{welcomeExpandedMedia.title}</strong>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => setWelcomeExpandedMedia(null)}
                            aria-label="Fechar visualização da mídia"
                          >
                            <IconX size={16} />
                          </button>
                        </header>
                        <div className={styles.welcomeMediaLightboxBody}>
                          {welcomeExpandedMedia.kind === "image" || welcomeExpandedMedia.kind === "sticker" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={welcomeExpandedMedia.url} alt={welcomeExpandedMedia.title} />
                          ) : null}
                          {welcomeExpandedMedia.kind === "video" ? (
                            <video controls autoPlay src={welcomeExpandedMedia.url} />
                          ) : null}
                          {welcomeExpandedMedia.kind === "audio" ? (
                            <audio controls autoPlay src={welcomeExpandedMedia.url} />
                          ) : null}
                          {welcomeExpandedMedia.kind === "document" ? (
                            <a href={welcomeExpandedMedia.url} target="_blank" rel="noreferrer">
                              Abrir documento
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {welcomeEditorField ? (
                    <div className={styles.welcomeEditorOverlay} onClick={() => setWelcomeEditorField(null)} role="presentation">
                      <div
                        className={styles.welcomeEditorCard}
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Editar boas-vindas"
                      >
                        <header className={styles.welcomeEditorHeader}>
                          <div>
                            <strong>
                              {welcomeEditorField === "caption"
                                ? "Editar texto"
                                : welcomeEditorField === "media"
                                  ? "Editar mídia"
                                  : welcomeEditorField === "attachments"
                                    ? "Editar áudio e anexos"
                                    : "Editar botões"}
                            </strong>
                            <small>As alterações entram no preview antes de salvar.</small>
                          </div>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => setWelcomeEditorField(null)}
                            aria-label="Fechar edição"
                          >
                            <IconX size={16} />
                          </button>
                        </header>

                        <div className={styles.welcomeEditorBody}>
                          {welcomeEditorField === "caption" ? (
                            <label>
                              Texto de boas-vindas
                              <textarea
                                rows={8}
                                value={welcomeDraft.caption}
                                onChange={(event) =>
                                  setWelcomeDraft((current) => ({ ...current, caption: event.target.value }))
                                }
                                placeholder="Olá {{nome}}, seja bem-vindo ao {{nomeGrupo}}!"
                              />
                            </label>
                          ) : null}

                          {welcomeEditorField === "media" ? (
                            <div className={styles.welcomeEditorGrid}>
                              <label>
                                URL de mídia
                                <input
                                  value={welcomeDraft.mediaUrl}
                                  onChange={(event) =>
                                    setWelcomeDraft((current) => ({ ...current, mediaUrl: event.target.value }))
                                  }
                                  placeholder="https://..."
                                />
                              </label>
                              <div className={styles.automationInlineActions}>
                                <label className={classNames(styles.ghostButton, styles.compactButton)}>
                                  <input
                                    type="file"
                                    accept="image/*,video/*,audio/*,application/*"
                                    hidden
                                    onChange={(event) => void uploadWelcomeMedia(event)}
                                  />
                                  {automationModalSaving ? <IconLoader2 size={14} className={styles.spin} /> : <IconCamera size={14} />}
                                  Enviar arquivo
                                </label>
                                <button
                                  type="button"
                                  className={classNames(styles.ghostButton, styles.compactButton)}
                                  onClick={() => setWelcomeDraft((current) => ({ ...current, mediaUrl: "" }))}
                                  disabled={automationModalSaving || !welcomeDraft.mediaUrl}
                                >
                                  Limpar mídia
                                </button>
                              </div>
                              <label className={styles.toggleField}>
                                <span>Usar foto de perfil da pessoa</span>
                                <button
                                  type="button"
                                  className={classNames(
                                    styles.toggleSwitch,
                                    welcomeDraft.useParticipantProfilePhoto && styles.toggleSwitchOn,
                                  )}
	                                  aria-pressed={welcomeDraft.useParticipantProfilePhoto}
	                                  onClick={toggleWelcomeParticipantProfilePhoto}
	                                  disabled={automationModalSaving}
	                                >
                                  <span />
                                </button>
                              </label>
                              {renderAutomationMediaPreview(null, welcomeDraft.mediaUrl)}
                              <label className={styles.toggleField}>
                                <span>Enviar como sticker</span>
                                <button
	                                  type="button"
	                                  className={classNames(styles.toggleSwitch, welcomeDraft.asSticker && styles.toggleSwitchOn)}
	                                  aria-pressed={welcomeDraft.asSticker}
	                                  onClick={toggleWelcomeAsSticker}
	                                  disabled={automationModalSaving}
	                                >
                                  <span />
                                </button>
                              </label>
                            </div>
                          ) : null}

                          {welcomeEditorField === "attachments" ? (
                            <div className={styles.welcomeEditorGrid}>
                              {welcomeDraft.attachments.length === 0 ? (
                                <p className={styles.emptyState}>Nenhum áudio ou anexo extra configurado.</p>
                              ) : null}
                              {welcomeDraft.attachments.map((attachment, index) => {
                                const item = attachment as any;
                                return (
                                  <article key={`${item.path ?? item.url ?? index}`} className={styles.welcomeAttachmentRow}>
                                    <div className={styles.welcomeAttachmentRowHeader}>
                                      <strong>Anexo {index + 1}</strong>
                                      <div>
                                        <button
                                          type="button"
                                          className={styles.iconBtn}
                                          onClick={() => moveWelcomeAttachmentDraft(index, "up")}
                                          disabled={index === 0}
                                          aria-label="Mover anexo para cima"
                                        >
                                          ↑
                                        </button>
                                        <button
                                          type="button"
                                          className={styles.iconBtn}
                                          onClick={() => moveWelcomeAttachmentDraft(index, "down")}
                                          disabled={index === welcomeDraft.attachments.length - 1}
                                          aria-label="Mover anexo para baixo"
                                        >
                                          ↓
                                        </button>
                                        <button
                                          type="button"
                                          className={classNames(styles.iconBtn, styles.dangerIconBtn)}
                                          onClick={() => removeWelcomeAttachmentDraft(index)}
                                          aria-label="Remover anexo"
                                        >
                                          <IconTrash size={14} />
                                        </button>
                                      </div>
                                    </div>
                                    <div className={styles.welcomeEditorTwoCols}>
                                      <div className={styles.welcomeDetectedMediaType}>
                                        <span>Tipo detectado</span>
                                        <strong>{getWelcomeAttachmentLabel(item.kind)}</strong>
                                      </div>
                                      <label>
                                        Arquivo
                                        <input
                                          type="file"
                                          accept="image/*,video/*,audio/*,application/*"
                                          onChange={(event) => void uploadWelcomeAttachment(event, index)}
                                        />
                                      </label>
                                    </div>
                                    {resolveWelcomeAttachmentPreviewUrl(item) ? (
                                      <div className={styles.welcomeAttachmentEditorPreview}>
                                        {renderAutomationMediaPreview(null, resolveWelcomeAttachmentPreviewUrl(item))}
                                      </div>
                                    ) : (
                                      <div className={styles.emptyState}>Envie um arquivo para visualizar esta mensagem.</div>
                                    )}
                                    <label>
                                      Legenda do anexo
                                      <input
                                        value={item.caption ?? ""}
                                        onChange={(event) => patchWelcomeAttachmentDraft(index, { caption: event.target.value })}
                                        placeholder="Legenda opcional"
                                      />
                                    </label>
                                  </article>
                                );
                              })}
                              <button type="button" className={styles.welcomeEditTile} onClick={addWelcomeAttachmentDraft}>
                                <IconPlus size={16} />
                                Adicionar outro anexo
                              </button>
                            </div>
                          ) : null}

                          {welcomeEditorField === "buttons"
                            ? (() => {
                                const buttons = welcomeDraft.replyButtons?.buttons ?? [];
                                return (
                                  <div className={styles.welcomeEditorGrid}>
                                    {buttons.length === 0 ? (
                                      <p className={styles.emptyState}>Nenhum botão configurado.</p>
                                    ) : null}
                                    {buttons.map((button, index) => {
                                      const lockedButtonFamily = buttons
                                        .map((entry, idx) => (idx === index ? null : getWelcomeButtonFamily(entry.type)))
                                        .find((family): family is ReturnType<typeof getWelcomeButtonFamily> => Boolean(family));
                                      const canChooseType = (type: BotGroupWelcomeReplyButton["type"]) =>
                                        !lockedButtonFamily || getWelcomeButtonFamily(type) === lockedButtonFamily;
                                      return (
                                        <article key={button.id || index} className={styles.welcomeButtonRow}>
                                          <div className={styles.welcomeAttachmentRowHeader}>
                                            <strong>Botão {index + 1}</strong>
                                            <button
                                              type="button"
                                              className={classNames(styles.iconBtn, styles.dangerIconBtn)}
                                              onClick={() => removeWelcomeButtonDraft(index)}
                                              aria-label={`Remover botão ${index + 1}`}
                                            >
                                              <IconTrash size={14} />
                                            </button>
                                          </div>
                                          <div className={styles.welcomeEditorTwoCols}>
                                            <label>
                                              Título do botão
                                              <input
                                                value={button.label}
                                                onChange={(event) => updateWelcomeButtonDraft(index, { label: event.target.value })}
                                                placeholder="Ex: Entrar no site"
                                              />
                                            </label>
                                            <label>
                                              Tipo do botão
                                              <select
                                                value={button.type ?? "quick_reply"}
                                                onChange={(event) =>
                                                  updateWelcomeButtonTypeDraft(
                                                    index,
                                                    event.target.value as BotGroupWelcomeReplyButton["type"],
                                                  )
                                                }
                                              >
                                                <option value="quick_reply" disabled={!canChooseType("quick_reply")}>
                                                  Resposta rápida
                                                </option>
                                                <option value="cta_url" disabled={!canChooseType("cta_url")}>
                                                  Abrir link
                                                </option>
                                                <option value="cta_call" disabled={!canChooseType("cta_call")}>
                                                  Ligar
                                                </option>
                                                <option value="cta_copy" disabled={!canChooseType("cta_copy")}>
                                                  Copiar código
                                                </option>
                                              </select>
                                            </label>
                                          </div>
                                          <p className={styles.welcomeButtonFamilyHint}>
                                            {lockedButtonFamily
                                              ? `Esta mensagem está usando ${getWelcomeButtonFamilyName(lockedButtonFamily)}. O WhatsApp não deve misturar respostas rápidas com ações externas no mesmo bloco.`
                                              : "Use até 3 respostas rápidas ou até 3 ações externas. Para evitar falha no WhatsApp, não misture os dois tipos no mesmo bloco."}
                                          </p>
                                          {button.type === "cta_url" ? (
                                            <label>
                                              Link
                                              <input
                                                value={button.url ?? ""}
                                                onChange={(event) => updateWelcomeButtonDraft(index, { url: event.target.value })}
                                                placeholder="https://..."
                                              />
                                            </label>
                                          ) : button.type === "cta_call" ? (
                                            <label>
                                              Telefone
                                              <input
                                                value={button.phoneNumber ?? ""}
                                                onChange={(event) => updateWelcomeButtonDraft(index, { phoneNumber: event.target.value })}
                                                placeholder="5599999999999"
                                              />
                                            </label>
                                          ) : button.type === "cta_copy" ? (
                                            <label>
                                              Código para copiar
                                              <input
                                                value={button.copyCode ?? ""}
                                                onChange={(event) => updateWelcomeButtonDraft(index, { copyCode: event.target.value })}
                                                placeholder="PIX, cupom ou código"
                                              />
                                            </label>
                                          ) : (
                                            <div className={styles.welcomeEditorTwoCols}>
                                              <label>
                                                Comando
                                                <input
                                                  value={button.command ?? ""}
                                                  onChange={(event) => updateWelcomeButtonDraft(index, { command: event.target.value })}
                                                  placeholder="menu"
                                                />
                                              </label>
                                              <label>
                                                Argumentos
                                                <input
                                                  value={button.args ?? ""}
                                                  onChange={(event) => updateWelcomeButtonDraft(index, { args: event.target.value })}
                                                  placeholder="Opcional"
                                                />
                                              </label>
                                            </div>
                                          )}
                                        </article>
                                      );
                                    })}

                                    <button
                                      type="button"
                                      className={styles.welcomeEditTile}
                                      onClick={addWelcomeButtonDraft}
                                      disabled={(welcomeDraft.replyButtons?.buttons.length ?? 0) >= 3}
                                    >
                                      <IconPlus size={16} />
                                      Adicionar outro botão
                                    </button>
                                  </div>
                                );
                              })()
                            : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
	                </div>
	              ) : null}

	              {automationModal === "farewell" ? (
	                <div className={styles.automationFormGrid}>
	                  <label className={styles.toggleField}>
	                    <span>Mensagem de saída</span>
	                    <button
	                      type="button"
	                      className={classNames(styles.toggleSwitch, farewellDraft.enabled && styles.toggleSwitchOn)}
	                      aria-pressed={farewellDraft.enabled}
	                      onClick={() => setFarewellDraft((current) => ({ ...current, enabled: !current.enabled }))}
	                      disabled={automationModalSaving}
	                    >
	                      <span />
	                    </button>
	                  </label>
	                  <label className={styles.toggleField}>
	                    <span>Enviar foto de perfil da pessoa</span>
	                    <button
	                      type="button"
	                      className={classNames(
	                        styles.toggleSwitch,
	                        farewellDraft.useParticipantProfilePhoto && styles.toggleSwitchOn,
	                      )}
	                      aria-pressed={farewellDraft.useParticipantProfilePhoto}
	                      onClick={toggleFarewellParticipantProfilePhoto}
	                      disabled={automationModalSaving}
	                    >
	                      <span />
	                    </button>
	                  </label>
	                  <label>
	                    URL de imagem personalizada
	                    <input
	                      value={farewellDraft.mediaUrl}
	                      onChange={(event) =>
	                        setFarewellDraft((current) => ({ ...current, mediaUrl: event.target.value }))
	                      }
	                      placeholder="https://..."
	                      disabled={automationModalSaving || farewellDraft.useParticipantProfilePhoto}
	                    />
	                  </label>
	                  <div className={styles.automationInlineActions}>
	                    <label className={classNames(styles.ghostButton, styles.compactButton)}>
	                      <input
	                        type="file"
	                        accept="image/*,video/*,audio/*,application/*"
	                        hidden
	                        onChange={(event) => void uploadFarewellMedia(event)}
	                        disabled={farewellDraft.useParticipantProfilePhoto}
	                      />
	                      {automationModalSaving ? <IconLoader2 size={14} className={styles.spin} /> : <IconCamera size={14} />}
	                      Enviar arquivo
	                    </label>
	                    <button
	                      type="button"
	                      className={classNames(styles.ghostButton, styles.compactButton)}
	                      onClick={() => setFarewellDraft((current) => ({ ...current, mediaUrl: "" }))}
	                      disabled={automationModalSaving || !farewellDraft.mediaUrl}
	                    >
	                      Limpar mídia
	                    </button>
	                  </div>
	                  {farewellDraft.useParticipantProfilePhoto ? (
	                    <div className={styles.welcomeProfilePhotoPreview}>
	                      <span className={styles.welcomeProfilePhotoFrame}>
	                        <IconUsersGroup size={32} />
	                      </span>
	                      <span>
	                        <strong>Foto do participante</strong>
	                        <small>Imagem com legenda</small>
	                      </span>
	                    </div>
	                  ) : (
	                    renderAutomationMediaPreview(null, farewellDraft.mediaUrl)
	                  )}
	                  <label className={styles.toggleField}>
	                    <span>Enviar como sticker</span>
	                    <button
	                      type="button"
	                      className={classNames(styles.toggleSwitch, farewellDraft.asSticker && styles.toggleSwitchOn)}
	                      aria-pressed={farewellDraft.asSticker}
	                      onClick={toggleFarewellAsSticker}
	                      disabled={automationModalSaving || farewellDraft.useParticipantProfilePhoto}
	                    >
	                      <span />
	                    </button>
	                  </label>
	                  <label>
	                    Legenda da saída
	                    <textarea
	                      rows={7}
	                      value={farewellDraft.caption}
	                      onChange={(event) =>
	                        setFarewellDraft((current) => ({ ...current, caption: event.target.value }))
	                      }
	                      placeholder="👋 {{pushName}} saiu do grupo."
	                    />
	                  </label>
	                </div>
	              ) : null}

	              {automationModal === "autoresposta" ? (
                <div className={styles.automationFormGrid}>
                  <div className={styles.automationInlineGroup}>
                    <label>
                      Gatilhos (separe por vírgula)
                      <input
                        value={newAutoResponseDraft.triggers}
                        onChange={(event) =>
                          setNewAutoResponseDraft((current) => ({ ...current, triggers: event.target.value }))
                        }
                        placeholder="oi, menu, comandos"
                      />
                    </label>
                    <label>
                      Modo de comparação
                      <select
                        value={newAutoResponseDraft.matchMode}
                        onChange={(event) =>
                          setNewAutoResponseDraft((current) => ({
                            ...current,
                            matchMode: event.target.value === "equals" ? "equals" : "contains",
                          }))
                        }
                      >
                        <option value="contains">Contém</option>
                        <option value="equals">Exato</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Resposta
                    <textarea
                      rows={4}
                      value={newAutoResponseDraft.responseText}
                      onChange={(event) =>
                        setNewAutoResponseDraft((current) => ({ ...current, responseText: event.target.value }))
                      }
                      placeholder="Texto que o bot vai responder"
                    />
                  </label>
                  <div className={styles.automationInlineActions}>
                    <label className={classNames(styles.ghostButton, styles.compactButton)}>
                      <input
                        type="file"
                        accept="image/*,video/*,audio/*,application/*"
                        hidden
                        onChange={(event) => void uploadNewAutoResponseMedia(event)}
                      />
                      {automationModalSaving ? <IconLoader2 size={14} className={styles.spin} /> : <IconCamera size={14} />}
                      Mídia da resposta
                    </label>
                    {newAutoResponseDraft.responseMedia ? (
                      <button
                        type="button"
                        className={classNames(styles.ghostButton, styles.compactButton)}
                        onClick={clearNewAutoResponseMedia}
                      >
                        Limpar mídia
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={classNames(styles.primaryButton, styles.compactButton)}
                      onClick={addAutoResponseDraft}
                    >
                      <IconPlus size={14} />
                      Adicionar resposta
                    </button>
                  </div>
                  {renderAutomationMediaPreview(newAutoResponseDraft.responseMedia)}

                  <div className={styles.autoResponseList}>
                    {autoResponsesDraft.length === 0 ? (
                      <p className={styles.pairingPlaceholder}>Nenhuma autoresposta cadastrada.</p>
                    ) : (
                      autoResponsesDraft.map((entry) => (
                        <article key={entry.id} className={styles.autoResponseItem}>
                          <div>
                            <strong>{entry.triggers.join(", ")}</strong>
                            <p>{entry.responseText}</p>
                          </div>
                          <div className={styles.automationInlineActions}>
                            <label className={classNames(styles.ghostButton, styles.compactButton)}>
                              <input
                                type="file"
                                accept="image/*,video/*,audio/*,application/*"
                                hidden
                                onChange={(event) => void uploadAutoResponseMedia(event, entry.id)}
                              />
                              {automationModalSaving ? <IconLoader2 size={14} className={styles.spin} /> : <IconCamera size={14} />}
                              Mídia
                            </label>
                            {entry.responseMedia ? (
                              <button
                                type="button"
                                className={classNames(styles.ghostButton, styles.compactButton)}
                                onClick={() => clearAutoResponseMedia(entry.id)}
                              >
                                Remover mídia
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={classNames(styles.ghostButton, styles.compactButton)}
                              onClick={() => removeAutoResponseDraft(entry.id)}
                            >
                              Remover resposta
                            </button>
                          </div>
                          {renderAutomationMediaPreview(entry.responseMedia)}
                        </article>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {automationModal === "allowedLinks" ? (
                <div className={styles.automationFormGrid}>
                  <label>
                    Links ou domínios permitidos (um por linha)
                    <textarea
                      rows={12}
                      value={allowedLinksDraft}
                      onChange={(event) => setAllowedLinksDraft(event.target.value)}
                      placeholder={"seudominio.com\nhttps://siteconfiavel.com/pagina\nchat.whatsapp.com/grupo-oficial"}
                    />
                  </label>
                  <small className={styles.automationSubHint}>
                    Quando o antilink estiver ativo, qualquer link que bater nessa lista será ignorado pela moderação.
                    Use domínio completo ou link direto, um por linha.
                  </small>
                </div>
              ) : null}

              {automationModal === "bannedWords" ? (
                <label className={styles.automationFormGrid}>
                  Palavras proibidas (uma por linha)
                  <textarea
                    rows={12}
                    value={bannedWordsDraft}
                    onChange={(event) => setBannedWordsDraft(event.target.value)}
                    placeholder="palavra1&#10;palavra2"
                  />
                </label>
              ) : null}

              {automationModal === "moderation" ? (
                <div className={styles.automationFormGrid}>
                  <label>
                    Limite de infrações (links + antispam) para banimento
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={moderationDraft.maxInfractions}
                      onChange={(event) =>
                        setModerationDraft((current) => ({ ...current, maxInfractions: event.target.value }))
                      }
                      placeholder="3"
                    />
                  </label>
                  <label>
                    Limite de infrações para palavras proibidas
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={moderationDraft.antipalavrasMaxInfractions}
                      onChange={(event) =>
                        setModerationDraft((current) => ({
                          ...current,
                          antipalavrasMaxInfractions: event.target.value,
                        }))
                      }
                      placeholder="5"
                    />
                  </label>
                  <label>
                    Mensagens em sequência para disparar antispam
                    <input
                      type="number"
                      min={2}
                      max={50}
                      value={moderationDraft.antispamBurstLimit}
                      onChange={(event) =>
                        setModerationDraft((current) => ({
                          ...current,
                          antispamBurstLimit: event.target.value,
                        }))
                      }
                      placeholder="5"
                    />
                  </label>
                  <label>
                    Janela de detecção do antispam (segundos)
                    <input
                      type="number"
                      min={2}
                      max={60}
                      value={moderationDraft.antispamBurstWindowSeconds}
                      onChange={(event) =>
                        setModerationDraft((current) => ({
                          ...current,
                          antispamBurstWindowSeconds: event.target.value,
                        }))
                      }
                      placeholder="12"
                    />
                  </label>
                  <label>
                    Reset automático das infrações (dias)
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={moderationDraft.antispamResetDays}
                      onChange={(event) =>
                        setModerationDraft((current) => ({
                          ...current,
                          antispamResetDays: event.target.value,
                        }))
                      }
                      placeholder="7"
                    />
                  </label>
                  <small className={styles.automationSubHint}>
                    No primeiro flood o robô avisa. Na segunda ocorrência ele registra infração; ao atingir o
                    limite, remove automaticamente.
                  </small>
                </div>
              ) : null}

              {automationModal === "blacklist" ? (
                <label className={styles.automationFormGrid}>
                  Números bloqueados (um por linha)
                  <textarea
                    rows={12}
                    value={blacklistDraft}
                    onChange={(event) => setBlacklistDraft(event.target.value)}
                    placeholder="5592999999999"
                  />
                </label>
              ) : null}

              {automationModal === "schedule" ? (
                <div className={styles.automationFormGrid}>
                  <label className={styles.toggleField}>
                    <span>Ativar fechamento automático</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, scheduleDraft.closeEnabled && styles.toggleSwitchOn)}
                      aria-pressed={scheduleDraft.closeEnabled}
                      onClick={() =>
                        setScheduleDraft((current) => ({ ...current, closeEnabled: !current.closeEnabled }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                  <label className={styles.toggleField}>
                    <span>Ativar abertura automática</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, scheduleDraft.openEnabled && styles.toggleSwitchOn)}
                      aria-pressed={scheduleDraft.openEnabled}
                      onClick={() =>
                        setScheduleDraft((current) => ({ ...current, openEnabled: !current.openEnabled }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                  <label>
                    Fechar às (HH:MM)
                    <input
                      value={scheduleDraft.closeTimes}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({ ...current, closeTimes: event.target.value }))
                      }
                      placeholder="22:00, 23:30"
                    />
                  </label>
                  <label>
                    Abrir às (HH:MM)
                    <input
                      value={scheduleDraft.openTimes}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({ ...current, openTimes: event.target.value }))
                      }
                      placeholder="06:00, 08:00"
                    />
                  </label>
                  <label>
                    Mensagem ao fechar
                    <textarea
                      value={scheduleDraft.closeMessage}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({ ...current, closeMessage: event.target.value }))
                      }
                      placeholder="🚫 Grupo fechado automaticamente conforme programação."
                      rows={3}
                    />
                  </label>
                  <label>
                    Mensagem ao abrir
                    <textarea
                      value={scheduleDraft.openMessage}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({ ...current, openMessage: event.target.value }))
                      }
                      placeholder="✅ Grupo aberto automaticamente conforme programação."
                      rows={3}
                    />
                  </label>
                  <label>
                    Timezone
                    <input
                      value={scheduleDraft.timezone}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({ ...current, timezone: event.target.value }))
                      }
                      placeholder="America/Sao_Paulo"
                    />
                  </label>
                </div>
              ) : null}

              {automationModal === "antiInactivity" ? (
                <div className={styles.automationFormGrid}>
                  <label className={styles.toggleField}>
                    <span>Ativar AntiAFK</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, antiInactivityDraft.enabled && styles.toggleSwitchOn)}
                      aria-pressed={antiInactivityDraft.enabled}
                      onClick={() =>
                        setAntiInactivityDraft((current) => ({ ...current, enabled: !current.enabled }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                  <label>
                    Dias sem falar
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={antiInactivityDraft.days}
                      onChange={(event) =>
                        setAntiInactivityDraft((current) => ({ ...current, days: event.target.value }))
                      }
                      placeholder="30"
                    />
                  </label>
                  <label>
                    Intervalo da varredura (horas)
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={antiInactivityDraft.scanIntervalHours}
                      onChange={(event) =>
                        setAntiInactivityDraft((current) => ({ ...current, scanIntervalHours: event.target.value }))
                      }
                      placeholder="24"
                    />
                  </label>
                  <label>
                    Máximo de remoções por varredura
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={antiInactivityDraft.removeLimit}
                      onChange={(event) =>
                        setAntiInactivityDraft((current) => ({ ...current, removeLimit: event.target.value }))
                      }
                      placeholder="20"
                    />
                  </label>
                  <p className={styles.mutedHelp}>
                    O AntiAFK usa o último horário em que cada participante falou no grupo. Administradores e a própria conexão do bot são preservados.
                  </p>
                </div>
              ) : null}

              {automationModal === "horapg" ? (
                <div className={styles.automationFormGrid}>
                  <label className={styles.toggleField}>
                    <span>Ativar horários pagantes</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, horapgDraft.enabled && styles.toggleSwitchOn)}
                      aria-pressed={horapgDraft.enabled}
                      onClick={() =>
                        setHorapgDraft((current) => ({ ...current, enabled: !current.enabled }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                  <label>
                    Horários (HH:MM)
                    <input
                      value={horapgDraft.times}
                      onChange={(event) =>
                        setHorapgDraft((current) => ({ ...current, times: event.target.value }))
                      }
                      placeholder="09:00, 14:30, 20:00"
                    />
                  </label>
                  <label>
                    URL da imagem (opcional)
                    <input
                      value={horapgDraft.imageUrl}
                      onChange={(event) =>
                        setHorapgDraft((current) => ({ ...current, imageUrl: event.target.value }))
                      }
                      placeholder="https://..."
                    />
                  </label>
                  <label>
                    Timezone
                    <input
                      value={horapgDraft.timezone}
                      onChange={(event) =>
                        setHorapgDraft((current) => ({ ...current, timezone: event.target.value }))
                      }
                      placeholder="America/Sao_Paulo"
                    />
                  </label>
                  <label className={styles.toggleField}>
                    <span>Mencionar todos</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, horapgDraft.mentionAll && styles.toggleSwitchOn)}
                      aria-pressed={horapgDraft.mentionAll}
                      onClick={() =>
                        setHorapgDraft((current) => ({ ...current, mentionAll: !current.mentionAll }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                </div>
              ) : null}

              {automationModal === "botinterage" ? (
                <div className={styles.automationFormGrid}>
                  <label className={styles.toggleField}>
                    <span>Ativar bot interage (IA)</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botInterageDraft.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botInterageDraft.enabled}
                      onClick={() =>
                        setBotInterageDraft((current) => ({ ...current, enabled: !current.enabled }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                  <label className={styles.toggleField}>
                    <span>Responder só quando mencionarem o robô</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botInterageDraft.mentionOnly && styles.toggleSwitchOn)}
                      aria-pressed={botInterageDraft.mentionOnly}
                      onClick={() =>
                        setBotInterageDraft((current) => ({ ...current, mentionOnly: !current.mentionOnly }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                  <label className={styles.toggleField}>
                    <span>Responder com áudio</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botInterageDraft.voiceEnabled && styles.toggleSwitchOn)}
                      aria-pressed={botInterageDraft.voiceEnabled}
                      onClick={() =>
                        setBotInterageDraft((current) => ({ ...current, voiceEnabled: !current.voiceEnabled }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                  <label className={styles.toggleField}>
                    <span>Leitura de imagem</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botInterageDraft.imageEnabled && styles.toggleSwitchOn)}
                      aria-pressed={botInterageDraft.imageEnabled}
                      onClick={() =>
                        setBotInterageDraft((current) => ({ ...current, imageEnabled: !current.imageEnabled }))
                      }
                      disabled={automationModalSaving}
                    >
                      <span />
                    </button>
                  </label>
                  <label>
                    Prompt da IA
                    <textarea
                      rows={5}
                      value={botInterageDraft.aiPrompt}
                      onChange={(event) =>
                        setBotInterageDraft((current) => ({ ...current, aiPrompt: event.target.value }))
                      }
                      placeholder="Comportamento padrão do bot..."
                    />
                  </label>
                  {isAdminUser ? (
                    <label>
                      Instruções das tools/comandos da IA
                      <textarea
                        rows={5}
                        value={botInterageDraft.aiToolsPrompt}
                        onChange={(event) =>
                          setBotInterageDraft((current) => ({ ...current, aiToolsPrompt: event.target.value }))
                        }
                        placeholder="Regras para quando a IA puder usar comandos internos, como baixar música ou vídeo..."
                      />
                      <span className={styles.automationSubHint}>
                        Separado do prompt normal: use este campo só para regras de ferramentas e comandos internos.
                      </span>
                    </label>
                  ) : null}
                  <label>
                    Modelo Groq (opcional)
                    <select
                      value={botInterageDraft.aiModel}
                      onChange={(event) =>
                        setBotInterageDraft((current) => ({ ...current, aiModel: event.target.value }))
                      }
                      disabled={automationModalSaving || botInterageOptionsLoading}
                    >
                      <option value="">Padrão Groq</option>
                      {botInterageModelOptions.map((option) => (
                        <option key={`model-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {botInterageDraft.aiModel === BOT_INTERAGE_CHATGPT_PHONE_MODEL ? (
                      <span className={styles.automationSubHint}>
                        Usa o app ChatGPT no celular pelo relay do BotAdmin. Para o MCP entrar no contexto,
                        deixe o conector BotAdmin selecionado na conversa atual do ChatGPT mobile.
                      </span>
                    ) : null}
                  </label>
                  <label>
                    Voz do áudio
                    <select
                      value={botInterageDraft.aiVoice}
                      onChange={(event) =>
                        setBotInterageDraft((current) => ({ ...current, aiVoice: event.target.value }))
                      }
                      disabled={automationModalSaving || botInterageOptionsLoading}
                    >
                      <option value="">Padrão TikTok TTS</option>
                      {botInterageVoiceOptions.map((option) => (
                        <option key={`voice-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className={styles.automationSubHint}>Usa as vozes estáveis do TikTok TTS.</span>
                  </label>
                  {botInterageOptionsLoading ? (
                    <span className={styles.automationSubHint}>
                      Carregando opções de modelo e voz...
                    </span>
                  ) : null}
                </div>
              ) : null}

              {automationModal === "menus" ? (
                <div className={styles.automationFormGrid}>
                  <div className={styles.menuBackgroundPanel}>
                    <div>
                      <strong>Imagem de fundo do menu</strong>
                      <p>Essa imagem é usada quando o usuário abre os menus pelo WhatsApp.</p>
                    </div>
                    {selectedGroup?.metadata?.menuBackgroundUrl ? (
                      <img
                        src={withCacheBust(selectedGroup.metadata.menuBackgroundUrl, selectedGroup.updatedAt)}
                        alt="Fundo do menu"
                        className={styles.menuBackgroundPreview}
                      />
                    ) : (
                      <p className={styles.pairingPlaceholder}>Nenhuma imagem de fundo configurada.</p>
                    )}
                    <div className={styles.automationInlineActions}>
                      <label className={classNames(styles.ghostButton, styles.compactButton)}>
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(event) => void uploadMenuBackground(event)}
                        />
                        {automationModalSaving ? <IconLoader2 size={14} className={styles.spin} /> : <IconCamera size={14} />}
                        Enviar imagem
                      </label>
                      {selectedGroup?.metadata?.menuBackgroundUrl ? (
                        <button
                          type="button"
                          className={classNames(styles.ghostButton, styles.compactButton)}
                          onClick={() => void removeMenuBackground()}
                          disabled={automationModalSaving}
                        >
                          Remover imagem
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.menuTextEditorList}>
                    {MENU_TEXT_KEYS.map((key) => (
                      <label key={key} className={styles.menuTextEditorCard}>
                        <span className={styles.menuTextEditorTitle}>{MENU_TEXT_LABELS[key].title}</span>
                        <small>{MENU_TEXT_LABELS[key].description}</small>
                        <textarea
                          rows={key === "main" || key === "admin" || key === "comandos" ? 7 : 5}
                          value={menuTextsDraft[key]}
                          onChange={(event) =>
                            setMenuTextsDraft((current) => ({ ...current, [key]: event.target.value }))
                          }
                          placeholder="Uma linha por item do menu."
                          disabled={automationModalSaving}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {automationModal === "welcome" ? null : (
              <footer className={styles.modalFormFooter}>
                <button
                  type="button"
                  className={classNames(styles.ghostButton, styles.modalFooterButton)}
                  onClick={() => setAutomationModal(null)}
                  disabled={automationModalSaving}
                >
                  Fechar
                </button>
                <button
                  type="button"
                  className={classNames(styles.primaryButton, styles.modalFooterButton)}
                  onClick={() => void saveAutomationModal()}
                  disabled={automationModalSaving}
                >
                  {automationModalSaving ? <IconLoader2 size={14} className={styles.spin} /> : <IconDeviceFloppy size={14} />}
                  Salvar configuração
                </button>
              </footer>
            )}
          </div>
        </div>
      ) : null}

      {botCoinsModal && botCoinsDraft ? (
        <div
          className={styles.modalOverlay}
          onClick={() => setBotCoinsModal(null)}
          role="presentation"
        >
          <div
            className={classNames(styles.modalCard, styles.automationModalCard, styles.botCoinsModalCard)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Configuração de Premium"
          >
            <header className={styles.modalHeader}>
              <div>
                <h3>
                  {BOTCOINS_SHORTCUTS.find((item) => item.key === botCoinsModal)?.label ?? "Configurar Premium"}
                </h3>
                <p>{selectedGroup?.name}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setBotCoinsModal(null)}
                aria-label="Fechar modal Premium"
              >
                <IconX size={16} />
              </button>
            </header>

            <div className={styles.automationModalBody}>
              {botCoinsSaving ? (
                <div className={styles.botCoinsSaving}>
                  <IconLoader2 size={14} className={styles.spin} />
                  Salvando...
                </div>
              ) : null}

              {botCoinsModal === "general" ? (
                <div className={styles.botCoinsForm}>
                  <label className={styles.toggleField}>
                    <span>BotCoins ativo neste grupo</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.enabled}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          draft.enabled = !draft.enabled;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                  <label>
                    Nome da moeda
                    <input
                      value={botCoinsDraft.currencyName}
                      onChange={(event) =>
                        updateBotCoinsDraft((draft) => {
                          draft.currencyName = event.target.value;
                        })
                      }
                      placeholder="BotCoins"
                    />
                  </label>
                  <label className={styles.toggleField}>
                    <span>Ganhar moedas por XP/interação</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.earnings.message.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.earnings.message.enabled}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          const next = !draft.earnings.message.enabled;
                          draft.earnings.message.enabled = next;
                          draft.earnings.daily.enabled = next;
                          draft.earnings.levelUp.enabled = next;
                          draft.rewards.weekly.enabled = next;
                          draft.rewards.monthly.enabled = next;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                </div>
              ) : null}

              {botCoinsModal === "earnings" ? (
                <div className={styles.botCoinsForm}>
                  <label className={styles.toggleField}>
                    <span>Ganhar por mensagem válida</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.earnings.message.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.earnings.message.enabled}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          draft.earnings.message.enabled = !draft.earnings.message.enabled;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                  <div className={styles.botCoinsFieldGrid}>
                    <label>
                      Moedas por ganho
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.earnings.message.amount}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.earnings.message.amount = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Mensagens por ganho
                      <input
                        type="number"
                        min={10}
                        step={1}
                        value={botCoinsDraft.earnings.message.messagesPerReward}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.earnings.message.messagesPerReward = Number(event.target.value || 1);
                          })
                        }
                      />
                    </label>
                    <label>
                      Cooldown (segundos)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.earnings.message.cooldownSec}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.earnings.message.cooldownSec = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Mínimo de caracteres
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={botCoinsDraft.earnings.message.minLength}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.earnings.message.minLength = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Máximo por dia
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.earnings.message.maxPerDay}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.earnings.message.maxPerDay = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className={styles.toggleField}>
                    <span>Bônus diário (1ª mensagem do dia)</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.earnings.daily.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.earnings.daily.enabled}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          draft.earnings.daily.enabled = !draft.earnings.daily.enabled;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                  <label>
                    Moedas do bônus diário
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={botCoinsDraft.earnings.daily.amount}
                      onChange={(event) =>
                        updateBotCoinsDraft((draft) => {
                          draft.earnings.daily.amount = Number(event.target.value || 0);
                        })
                      }
                    />
                  </label>
                  <label className={styles.toggleField}>
                    <span>Bônus por level up</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.earnings.levelUp.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.earnings.levelUp.enabled}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          draft.earnings.levelUp.enabled = !draft.earnings.levelUp.enabled;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                  <label>
                    Moedas por nível
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={botCoinsDraft.earnings.levelUp.amount}
                      onChange={(event) =>
                        updateBotCoinsDraft((draft) => {
                          draft.earnings.levelUp.amount = Number(event.target.value || 0);
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}

              {botCoinsModal === "leveling" ? (
                <div className={styles.botCoinsForm}>
                  <div className={styles.botCoinsFieldGrid}>
                    <label>
                      XP por mensagem
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.leveling.xpPerMessage}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.leveling.xpPerMessage = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      XP por nível (step)
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={botCoinsDraft.leveling.levelStep}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.leveling.levelStep = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                  </div>
                  <small className={styles.botCoinsHint}>
                    Fórmula: nível = floor(XP / step) + 1
                  </small>
                </div>
              ) : null}

              {botCoinsModal === "rewards" ? (
                <div className={styles.botCoinsModalStack}>
                  <div className={styles.botCoinsModalSection}>
                    <header className={styles.botCoinsSectionHeader}>
                      <strong>Recompensas semanais</strong>
                      <p>Premie o top do ranking de mensagens da semana.</p>
                    </header>
                    <div className={styles.botCoinsForm}>
                      <label className={styles.toggleField}>
                        <span>Ativar recompensa semanal</span>
                        <button
                          type="button"
                          className={classNames(
                            styles.toggleSwitch,
                            botCoinsDraft.rewards.weekly.enabled && styles.toggleSwitchOn,
                          )}
                          aria-pressed={botCoinsDraft.rewards.weekly.enabled}
                          onClick={() =>
                            updateBotCoinsDraft((draft) => {
                              draft.rewards.weekly.enabled = !draft.rewards.weekly.enabled;
                            })
                          }
                        >
                          <span />
                        </button>
                      </label>
                      <div className={styles.botCoinsFieldGrid}>
                        <label>
                          Moedas por ganhador
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={botCoinsDraft.rewards.weekly.amount}
                            onChange={(event) =>
                              updateBotCoinsDraft((draft) => {
                                draft.rewards.weekly.amount = Number(event.target.value || 0);
                              })
                            }
                          />
                        </label>
                        <label>
                          Top semanal
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={botCoinsDraft.rewards.weekly.top}
                            onChange={(event) =>
                              updateBotCoinsDraft((draft) => {
                                draft.rewards.weekly.top = Number(event.target.value || 1);
                              })
                            }
                          />
                        </label>
                        <label>
                          Mínimo de mensagens
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={botCoinsDraft.rewards.weekly.minMessages}
                            onChange={(event) =>
                              updateBotCoinsDraft((draft) => {
                                draft.rewards.weekly.minMessages = Number(event.target.value || 0);
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className={styles.toggleField}>
                        <span>Avisar o grupo ao premiar</span>
                        <button
                          type="button"
                          className={classNames(
                            styles.toggleSwitch,
                            botCoinsDraft.rewards.weekly.announce && styles.toggleSwitchOn,
                          )}
                          aria-pressed={botCoinsDraft.rewards.weekly.announce}
                          onClick={() =>
                            updateBotCoinsDraft((draft) => {
                              draft.rewards.weekly.announce = !draft.rewards.weekly.announce;
                            })
                          }
                        >
                          <span />
                        </button>
                      </label>
                    </div>
                  </div>

                  <div className={styles.botCoinsModalSection}>
                    <header className={styles.botCoinsSectionHeader}>
                      <strong>Recompensas mensais</strong>
                      <p>Premie o top do ranking de mensagens do mês.</p>
                    </header>
                    <div className={styles.botCoinsForm}>
                      <label className={styles.toggleField}>
                        <span>Ativar recompensa mensal</span>
                        <button
                          type="button"
                          className={classNames(
                            styles.toggleSwitch,
                            botCoinsDraft.rewards.monthly.enabled && styles.toggleSwitchOn,
                          )}
                          aria-pressed={botCoinsDraft.rewards.monthly.enabled}
                          onClick={() =>
                            updateBotCoinsDraft((draft) => {
                              draft.rewards.monthly.enabled = !draft.rewards.monthly.enabled;
                            })
                          }
                        >
                          <span />
                        </button>
                      </label>
                      <div className={styles.botCoinsFieldGrid}>
                        <label>
                          Moedas por ganhador
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={botCoinsDraft.rewards.monthly.amount}
                            onChange={(event) =>
                              updateBotCoinsDraft((draft) => {
                                draft.rewards.monthly.amount = Number(event.target.value || 0);
                              })
                            }
                          />
                        </label>
                        <label>
                          Top mensal
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={botCoinsDraft.rewards.monthly.top}
                            onChange={(event) =>
                              updateBotCoinsDraft((draft) => {
                                draft.rewards.monthly.top = Number(event.target.value || 1);
                              })
                            }
                          />
                        </label>
                        <label>
                          Mínimo de mensagens
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={botCoinsDraft.rewards.monthly.minMessages}
                            onChange={(event) =>
                              updateBotCoinsDraft((draft) => {
                                draft.rewards.monthly.minMessages = Number(event.target.value || 0);
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className={styles.toggleField}>
                        <span>Avisar o grupo ao premiar</span>
                        <button
                          type="button"
                          className={classNames(
                            styles.toggleSwitch,
                            botCoinsDraft.rewards.monthly.announce && styles.toggleSwitchOn,
                          )}
                          aria-pressed={botCoinsDraft.rewards.monthly.announce}
                          onClick={() =>
                            updateBotCoinsDraft((draft) => {
                              draft.rewards.monthly.announce = !draft.rewards.monthly.announce;
                            })
                          }
                        >
                          <span />
                        </button>
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              {botCoinsModal === "penalties" ? (
                <div className={styles.botCoinsForm}>
                  <label className={styles.toggleField}>
                    <span>Descontar por infração</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.penalties.infraction.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.penalties.infraction.enabled}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          draft.penalties.infraction.enabled = !draft.penalties.infraction.enabled;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                  <label>
                    Moedas descontadas por infração
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={botCoinsDraft.penalties.infraction.amount}
                      onChange={(event) =>
                        updateBotCoinsDraft((draft) => {
                          draft.penalties.infraction.amount = Number(event.target.value || 0);
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}

              {botCoinsModal === "spending" ? (
                <div className={styles.botCoinsModalStack}>
                  <div className={styles.botCoinsForm}>
                    <div className={styles.botCoinsFieldGrid}>
                      <label>
                        Downloads (padrão)
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={botCoinsDraft.spending.defaultCostsByCategory.downloads}
                          onChange={(event) =>
                            updateBotCoinsDraft((draft) => {
                              draft.spending.defaultCostsByCategory.downloads = Number(event.target.value || 0);
                            })
                          }
                        />
                      </label>
                      <label>
                        Mídia (padrão)
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={botCoinsDraft.spending.defaultCostsByCategory.media}
                          onChange={(event) =>
                            updateBotCoinsDraft((draft) => {
                              draft.spending.defaultCostsByCategory.media = Number(event.target.value || 0);
                            })
                          }
                        />
                      </label>
                      <label>
                        Auto downloader
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={botCoinsDraft.spending.autoDownloaderCost}
                          onChange={(event) =>
                            updateBotCoinsDraft((draft) => {
                              draft.spending.autoDownloaderCost = Number(event.target.value || 0);
                            })
                          }
                        />
                      </label>
                      <label>
                        Auto sticker
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={botCoinsDraft.spending.autoStickerCost}
                          onChange={(event) =>
                            updateBotCoinsDraft((draft) => {
                              draft.spending.autoStickerCost = Number(event.target.value || 0);
                            })
                          }
                        />
                      </label>
                    </div>
                    <small className={styles.botCoinsHint}>
                      Use 0 para deixar a ação gratuita. Limpe o campo para usar o padrão.
                    </small>
                  </div>
                  <div className={styles.botCoinsModalHeaderRow}>
                    <div>
                      <strong>Comandos BotCoins</strong>
                      <p className={styles.botCoinsHint}>
                        Atalhos disponíveis para o usuário no grupo.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={classNames(styles.ghostButton, styles.compactButton)}
                      onClick={() => setShowBotCoinsCommandHelp((current) => !current)}
                    >
                      {showBotCoinsCommandHelp ? "Ocultar comandos" : "Ver comandos"}
                    </button>
                  </div>
                  {showBotCoinsCommandHelp ? (
                    <div className={styles.botCoinsCommandHelp}>
                      {BOTCOINS_COMMAND_HELP.map((item) => (
                        <div key={item.command} className={styles.botCoinsCommandHelpRow}>
                          <code>{commandPrefix}{item.command}</code>
                          <span>{item.description}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className={styles.botCoinsCommandCatalog}>
                    {GROUP_COMMAND_CATALOG.map((section) => (
                      <details key={section.key} className={styles.botCoinsCommandSection}>
                        <summary className={styles.botCoinsCommandSummary}>
                          <span>{section.title}</span>
                          <small>{section.items.length} comandos</small>
                        </summary>
                        <div className={styles.botCoinsCommandList}>
                          {section.items.map((item) => {
                            const overrideCost = botCoinsDraft.spending.commandCosts[item.command];
                            const defaultCost = resolveBotCoinsDefaultCost(botCoinsDraft, item.command);
                            const defaultLabel =
                              defaultCost > 0 ? `${defaultCost} ${botCoinsCurrencyLabel}` : "Grátis";
                            return (
                              <label key={item.command} className={styles.botCoinsCommandRow}>
                                <div>
                                  <code>{commandPrefix}{item.command}</code>
                                  <small>Padrão: {defaultLabel}</small>
                                </div>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={overrideCost ?? ""}
                                  placeholder={defaultCost > 0 ? String(defaultCost) : ""}
                                  onChange={(event) =>
                                    updateBotCoinsCommandCost(item.command, event.target.value)
                                  }
                                />
                              </label>
                            );
                          })}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              ) : null}

              {botCoinsModal === "premiumPlans" ? (
                <div className={styles.botCoinsForm}>
                  <div className={styles.botCoinsModalHeaderRow}>
                    <div>
                      <strong>Planos premium</strong>
                      <p className={styles.botCoinsHint}>
                        Crie até 3 planos. Eles aparecem no menu de compra do grupo.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={classNames(styles.ghostButton, styles.compactButton)}
                      onClick={() =>
                        updatePremiumDraftAndSave((premium) => {
                          const plans = Array.isArray(premium.plans) ? premium.plans : [];
                          const nextIndex = Math.min(plans.length + 1, 3);
                          if (plans.length >= 3) return;
                          premium.plans = [
                            ...plans,
                            {
                              key: `p${nextIndex}`,
                              label: `Premium ${nextIndex}`,
                              price: 0,
                              durationDays: 30,
                              enabled: true,
                              description: null,
                            },
                          ];
                        })
                      }
                      disabled={(botCoinsDraft.premium.plans ?? []).length >= 3}
                    >
                      <IconPlus size={14} />
                      Adicionar plano
                    </button>
                  </div>
                  <div className={styles.botCoinsItemsList}>
                    {(botCoinsDraft.premium.plans ?? []).length === 0 ? (
                      <p className={styles.botCoinsEmpty}>Nenhum plano premium cadastrado.</p>
                    ) : (
                      botCoinsDraft.premium.plans.map((plan, index) => (
                        <article key={`${plan.key}-${index}`} className={styles.botCoinsItemCard}>
                          <div className={styles.botCoinsItemHeader}>
                            <strong>Plano {index + 1}</strong>
                            <div className={styles.botCoinsItemActions}>
                              <button
                                type="button"
                                className={classNames(styles.toggleSwitch, plan.enabled !== false && styles.toggleSwitchOn)}
                                aria-pressed={plan.enabled !== false}
                                onClick={() =>
                                  updatePremiumDraftAndSave((premium) => {
                                    if (!premium.plans[index]) return;
                                    premium.plans[index].enabled = !(premium.plans[index].enabled !== false);
                                  })
                                }
                              >
                                <span />
                              </button>
                              <button
                                type="button"
                                className={styles.iconButton}
                                onClick={() =>
                                  updatePremiumDraftAndSave((premium) => {
                                    const plans = Array.isArray(premium.plans) ? [...premium.plans] : [];
                                    plans.splice(index, 1);
                                    premium.plans = plans;
                                  })
                                }
                                aria-label="Remover plano"
                              >
                                <IconTrash size={14} />
                              </button>
                            </div>
                          </div>
                          <div className={styles.botCoinsItemGrid}>
                            <label>
                              Nome
                              <input
                                value={plan.label}
                                onChange={(event) =>
                                  updateBotCoinsDraft((draft) => {
                                    if (!draft.premium.plans[index]) return;
                                    draft.premium.plans[index].label = event.target.value;
                                  })
                                }
                              />
                            </label>
                            <label>
                              Chave
                              <input
                                value={plan.key}
                                onChange={(event) =>
                                  updateBotCoinsDraft((draft) => {
                                    if (!draft.premium.plans[index]) return;
                                    draft.premium.plans[index].key = canonicalizeCommandText(event.target.value) || `p${index + 1}`;
                                  })
                                }
                              />
                            </label>
                            <label>
                              Valor (R$)
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={plan.price}
                                onChange={(event) =>
                                  updateBotCoinsDraft((draft) => {
                                    if (!draft.premium.plans[index]) return;
                                    draft.premium.plans[index].price = Number(event.target.value || 0);
                                    if (index === 0) draft.premium.price = Number(event.target.value || 0);
                                  })
                                }
                              />
                            </label>
                            <label>
                              Dias
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={plan.durationDays}
                                onChange={(event) =>
                                  updateBotCoinsDraft((draft) => {
                                    if (!draft.premium.plans[index]) return;
                                    draft.premium.plans[index].durationDays = Number(event.target.value || 1);
                                    if (index === 0) draft.premium.durationDays = Number(event.target.value || 1);
                                  })
                                }
                              />
                            </label>
                            <label className={styles.botCoinsItemFull}>
                              Descrição
                              <textarea
                                rows={2}
                                value={plan.description ?? ""}
                                onChange={(event) =>
                                  updateBotCoinsDraft((draft) => {
                                    if (!draft.premium.plans[index]) return;
                                    draft.premium.plans[index].description = event.target.value;
                                  })
                                }
                              />
                            </label>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {botCoinsModal === "premiumCommands" ? (
                <div className={styles.botCoinsForm}>
                  <div className={styles.botCoinsCommandHeader}>
                    <div>
                      <strong>Comandos exclusivos do premium</strong>
                      <p>Adicione pelo seletor os comandos que só usuários premium poderão usar.</p>
                    </div>
                  </div>
                  <div className={styles.botCoinsForm}>
                    <label>
                      Adicionar comando premium
                      <select
                        value=""
                        onChange={(event) => {
                          const command = event.target.value;
                          if (!command) return;
                          updatePremiumDraftAndSave((premium) => {
                            const current = new Set(premium.commandKeys ?? []);
                            current.add(command);
                            premium.commandKeys = [...current].sort();
                          });
                        }}
                      >
                        <option value="">Selecione um comando</option>
                        {premiumCommandOptions
                          .filter((item) => !botCoinsDraft.premium.commandKeys.includes(item.command))
                          .map((item) => (
                            <option key={item.command} value={item.command}>
                              {commandPrefix}{item.command}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className={styles.botCoinsCommandList}>
                      {(botCoinsDraft.premium.commandKeys ?? []).length === 0 ? (
                        <p className={styles.botCoinsEmpty}>Nenhum comando premium selecionado.</p>
                      ) : (
                        (botCoinsDraft.premium.commandKeys ?? []).map((command) => {
                          return (
                            <div key={command} className={styles.botCoinsCommandRow}>
                              <div>
                                <code>{commandPrefix}{command}</code>
                              </div>
                              <button
                                type="button"
                                className={classNames(styles.iconBtn, styles.dangerIconBtn)}
                                onClick={() =>
                                  updatePremiumDraftAndSave((premium) => {
                                    premium.commandKeys = (premium.commandKeys ?? []).filter((item) => item !== command);
                                  })
                                }
                                aria-label={`Remover ${commandPrefix}${command}`}
                              >
                                <IconTrash size={14} />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {botCoinsModal === "notifications" ? (
                <div className={styles.botCoinsForm}>
                  <label>
                    Modo de aviso
                    <select
                      value={botCoinsDraft.notifications.mode}
                      onChange={(event) => {
                        const mode = event.target.value;
                        updateBotCoinsDraft((draft) => {
                          if (mode === "group_reply" || mode === "private" || mode === "silent") {
                            draft.notifications.mode = mode;
                          }
                        });
                      }}
                    >
                      <option value="group_reply">Responder no grupo</option>
                      <option value="private">Avisar no privado</option>
                      <option value="silent">Silencioso</option>
                    </select>
                  </label>
                  <label className={styles.toggleField}>
                    <span>Incluir saldo atual nas mensagens</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.notifications.includeBalance && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.notifications.includeBalance}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          draft.notifications.includeBalance = !draft.notifications.includeBalance;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                </div>
              ) : null}

              {botCoinsModal === "robbery" ? (
                <div className={styles.botCoinsForm}>
                  <label className={styles.toggleField}>
                    <span>Permitir roubo de BotCoins</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.robbery.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.robbery.enabled}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          draft.robbery.enabled = !draft.robbery.enabled;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                  <div className={styles.botCoinsFieldGrid}>
                    <label>
                      Cooldown do ladrão (horas)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.robbery.cooldownHours}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.cooldownHours = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Cooldown do alvo (horas)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.robbery.targetCooldownHours}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.targetCooldownHours = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Custo da tentativa
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.robbery.attemptCost}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.attemptCost = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Penalidade por falha
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.robbery.failPenalty}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.failPenalty = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Saldo mínimo do ladrão
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.robbery.minAttackerBalance}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.minAttackerBalance = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Saldo mínimo do alvo
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.robbery.minTargetBalance}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.minTargetBalance = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Percentual mínimo (%)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={botCoinsDraft.robbery.stealPercentMin}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.stealPercentMin = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Percentual máximo (%)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={botCoinsDraft.robbery.stealPercentMax}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.stealPercentMax = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Roubo mínimo
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.robbery.minSteal}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.minSteal = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                    <label>
                      Roubo máximo
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={botCoinsDraft.robbery.maxSteal}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.robbery.maxSteal = Number(event.target.value || 0);
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {botCoinsModal === "shop" ? (
                <div className={styles.botCoinsModalStack}>
                  <div className={styles.botCoinsModalHeaderRow}>
                    <div>
                      <strong>Itens da loja</strong>
                      <p className={styles.botCoinsHint}>Configure defesas e ataques compráveis com BotCoins.</p>
                    </div>
                    <button
                      type="button"
                      className={classNames(styles.ghostButton, styles.compactButton)}
                      onClick={addBotCoinsShopItem}
                    >
                      <IconPlus size={14} />
                      Adicionar item
                    </button>
                  </div>
                  <div className={styles.botCoinsItemsList}>
                    {botCoinsDraft.shopItems.length === 0 ? (
                      <p className={styles.botCoinsEmpty}>Nenhum item cadastrado.</p>
                    ) : (
                      botCoinsDraft.shopItems.map((item, index) => {
                        const aliasValue = Array.isArray(item.aliases) ? item.aliases.join(", ") : "";
                        return (
                          <article key={`${item.key}-${index}`} className={styles.botCoinsItemCard}>
                            <div className={styles.botCoinsItemHeader}>
                              <div>
                                <strong>{item.label || "Item"}</strong>
                                <small>{item.key}</small>
                              </div>
                              <div className={styles.botCoinsItemActions}>
                                <label className={styles.toggleField}>
                                  <span>Ativo</span>
                                  <button
                                    type="button"
                                    className={classNames(styles.toggleSwitch, item.enabled !== false && styles.toggleSwitchOn)}
                                    aria-pressed={item.enabled !== false}
                                    onClick={() =>
                                      updateBotCoinsDraft((draft) => {
                                        if (!draft.shopItems[index]) return;
                                        draft.shopItems[index].enabled = !(draft.shopItems[index].enabled !== false);
                                      })
                                    }
                                  >
                                    <span />
                                  </button>
                                </label>
                                <button
                                  type="button"
                                  className={classNames(styles.iconBtn, styles.dangerIconBtn)}
                                  onClick={() => removeBotCoinsShopItem(index)}
                                  aria-label="Remover item"
                                >
                                  <IconTrash size={14} />
                                </button>
                              </div>
                            </div>
                            <div className={styles.botCoinsItemGrid}>
                              <label>
                                Ícone
                                <input
                                  value={item.icon ?? ""}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      draft.shopItems[index].icon = event.target.value;
                                    })
                                  }
                                  placeholder="🛡️"
                                />
                              </label>
                              <label>
                                Nome
                                <input
                                  value={item.label ?? ""}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      draft.shopItems[index].label = event.target.value;
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Chave
                                <input
                                  value={item.key ?? ""}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      draft.shopItems[index].key = event.target.value.toLowerCase();
                                    })
                                  }
                                  placeholder="colete"
                                />
                              </label>
                              <label>
                                Preço ({botCoinsCurrencyLabel})
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.price ?? 0}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      draft.shopItems[index].price = Number(event.target.value || 0);
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Duração (dias)
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={item.durationDays ?? 1}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      draft.shopItems[index].durationDays = Number(event.target.value || 1);
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Usos
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={item.uses ?? 1}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      draft.shopItems[index].uses = Number(event.target.value || 1);
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Tipo
                                <select
                                  value={item.type}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      const nextType = event.target.value;
                                      draft.shopItems[index].type =
                                        nextType === "block" ? "block" : nextType === "attack" ? "attack" : "reduce";
                                    })
                                  }
                                >
                                  <option value="reduce">Reduz roubo</option>
                                  <option value="block">Bloqueia roubo</option>
                                  <option value="attack">Ataque</option>
                                </select>
                              </label>
                              {item.type === "reduce" ? (
                                <label>
                                  Redução (%)
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={item.reducePercent ?? 0}
                                    onChange={(event) =>
                                      updateBotCoinsDraft((draft) => {
                                        if (!draft.shopItems[index]) return;
                                        draft.shopItems[index].reducePercent = Number(event.target.value || 0);
                                      })
                                    }
                                  />
                                </label>
                              ) : item.type === "block" ? (
                                <label>
                                  Punição no ladrão
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={item.reflectPenalty ?? 0}
                                    onChange={(event) =>
                                      updateBotCoinsDraft((draft) => {
                                        if (!draft.shopItems[index]) return;
                                        draft.shopItems[index].reflectPenalty = Number(event.target.value || 0);
                                      })
                                    }
                                  />
                                </label>
                              ) : (
                                <>
                                  <label>
                                    Bônus de sucesso (%)
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={1}
                                      value={item.successBonusPercent ?? 0}
                                      onChange={(event) =>
                                        updateBotCoinsDraft((draft) => {
                                          if (!draft.shopItems[index]) return;
                                          draft.shopItems[index].successBonusPercent = Number(event.target.value || 0);
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Bônus de roubo (%)
                                    <input
                                      type="number"
                                      min={0}
                                      max={300}
                                      step={1}
                                      value={item.stealBonusPercent ?? 0}
                                      onChange={(event) =>
                                        updateBotCoinsDraft((draft) => {
                                          if (!draft.shopItems[index]) return;
                                          draft.shopItems[index].stealBonusPercent = Number(event.target.value || 0);
                                        })
                                      }
                                    />
                                  </label>
                                  <label className={styles.toggleField}>
                                    <span>Resetar alvo ao sucesso</span>
                                    <button
                                      type="button"
                                      className={classNames(
                                        styles.toggleSwitch,
                                        item.resetTarget && styles.toggleSwitchOn,
                                      )}
                                      aria-pressed={Boolean(item.resetTarget)}
                                      onClick={() =>
                                        updateBotCoinsDraft((draft) => {
                                          if (!draft.shopItems[index]) return;
                                          draft.shopItems[index].resetTarget = !draft.shopItems[index].resetTarget;
                                        })
                                      }
                                    >
                                      <span />
                                    </button>
                                  </label>
                                </>
                              )}
                              <label className={styles.botCoinsItemFull}>
                                Descrição
                                <input
                                  value={item.description ?? ""}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      draft.shopItems[index].description = event.target.value;
                                    })
                                  }
                                  placeholder="Breve descrição do item"
                                />
                              </label>
                              <label className={styles.botCoinsItemFull}>
                                Aliases (separe por vírgula)
                                <input
                                  value={aliasValue}
                                  onChange={(event) =>
                                    updateBotCoinsDraft((draft) => {
                                      if (!draft.shopItems[index]) return;
                                      draft.shopItems[index].aliases = event.target.value
                                        .split(/[,;\\n]+/)
                                        .map((entry) => entry.trim())
                                        .filter(Boolean);
                                    })
                                  }
                                  placeholder="colete, armadura"
                                />
                              </label>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}

              {botCoinsModal === "topup" ? (
                <div className={styles.botCoinsForm}>
                  <label className={styles.toggleField}>
                    <span>Permitir compra de BotCoins</span>
                    <button
                      type="button"
                      className={classNames(styles.toggleSwitch, botCoinsDraft.topup.enabled && styles.toggleSwitchOn)}
                      aria-pressed={botCoinsDraft.topup.enabled}
                      onClick={() =>
                        updateBotCoinsDraft((draft) => {
                          draft.topup.enabled = !draft.topup.enabled;
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                  <div className={styles.botCoinsFieldGrid}>
                    <label>
                      BotCoins por R$1
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={botCoinsDraft.topup.coinsPerCurrency}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.topup.coinsPerCurrency = Number(event.target.value || 1);
                          })
                        }
                      />
                    </label>
                    <label>
                      Mínimo por compra
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={botCoinsDraft.topup.minCoins}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.topup.minCoins = Number(event.target.value || 1);
                          })
                        }
                      />
                    </label>
                    <label>
                      Máximo por compra
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={botCoinsDraft.topup.maxCoins}
                        onChange={(event) =>
                          updateBotCoinsDraft((draft) => {
                            draft.topup.maxCoins = Number(event.target.value || 1);
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className={styles.botCoinsFieldGrid}>
                    <label className={styles.toggleField}>
                      <span>Permitir Pix</span>
                      <button
                        type="button"
                        className={classNames(styles.toggleSwitch, botCoinsDraft.topup.allowPix && styles.toggleSwitchOn)}
                        aria-pressed={botCoinsDraft.topup.allowPix}
                        onClick={() =>
                          updateBotCoinsDraft((draft) => {
                            draft.topup.allowPix = !draft.topup.allowPix;
                            if (draft.topup.allowPix) {
                              draft.topup.allowCheckout = false;
                            }
                          })
                        }
                      >
                        <span />
                      </button>
                    </label>
                    <label className={styles.toggleField}>
                      <span>Permitir checkout</span>
                      <button
                        type="button"
                        className={classNames(styles.toggleSwitch, botCoinsDraft.topup.allowCheckout && styles.toggleSwitchOn)}
                        aria-pressed={botCoinsDraft.topup.allowCheckout}
                        onClick={() =>
                          updateBotCoinsDraft((draft) => {
                            draft.topup.allowCheckout = !draft.topup.allowCheckout;
                            if (draft.topup.allowCheckout) {
                              draft.topup.allowPix = false;
                            }
                          })
                        }
                      >
                        <span />
                      </button>
                    </label>
                  </div>
                  <small className={styles.botCoinsHint}>
                    Apenas um método pode ficar ativo por vez. Usa o gate de pagamento deste painel.
                  </small>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BotAdminWorkspace;
