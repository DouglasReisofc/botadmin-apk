import mime from "mime-types";

import {
  createStatusPostRecord,
  getStatusContentHistoryForTarget,
  getCampaignTargetLastSuccessAt,
  isBotAdCampaignDispatchable,
  listActiveStatusPostsForTarget,
  listDueBotAdCampaigns,
  listStatusPostsPendingDeletion,
  markStatusPostDeleted,
  parseBotAdCampaignOptions,
  recordCampaignRun,
  scheduleCampaignRetry,
  setCampaignNextRunState,
  touchCampaignRun,
} from "lib/bot-ad-campaigns";
import type { BotAdCampaignRow, BotAdCampaignTargetRow } from "lib/db";
import type { StatusContentHistory } from "lib/bot-ad-campaigns";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import { getInstanceSettings } from "lib/bot-instance-settings";
import { searchMercadoLivre, type MercadoLivreProduct, type MercadoLivreSearchResult } from "lib/apis/mercadolivre";
import { markAffiliateMlLinkUsage, resolveAffiliateMlLinkForUserByItemId } from "lib/affiliate-ml-links";
import {
  getAffiliateMlDispatchContextSnapshot,
  recordAffiliateMlDispatchForContext,
} from "lib/affiliate-ml-dispatch-history";
import {
  getAffiliateMlMessageTemplateForUser,
  renderAffiliateMlMessageTemplate,
  type AffiliateMlMessageTemplateSummary,
} from "lib/affiliate-ml-message-template";
import { resolveStoredMediaBuffer } from "lib/media-storage";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import { describeDateInTimezone, normalizeTimezoneInput } from "lib/timezones";
import {
  deleteStatusUpdate,
  getGroupInfo,
  getGroupInviteInfo,
  getGroupInviteLink,
  joinGroupWithInviteLink,
  sendInteractiveButtons,
  sendMediaMessage,
  sendStatusUpdate,
  sendStickerMessage,
  sendTextMessage,
} from "lib/wuzapi";
import { isTikTokUrl, resolveTikTokMedia } from "lib/tiktok-resolver";
import { isPinterestUrl, resolvePinterestMedia } from "lib/pinterest-resolver";
import { resolveInstagramProfileReels } from "lib/instagram-profile-reels";
import { getOrCreateUserApiKey } from "lib/user-api-keys";
import { createInternalUserRequestHeaders } from "lib/internal-user-request";
import type {
  BotAdCampaignContent,
  BotAdCampaignScheduleConfig,
  BotAdCampaignStatusConfig,
  BotAdCampaignStatusRandomizer,
  BotAdCampaignGroupRandomizer,
  BotAdCampaignGroupDispatchOptions,
  CampaignNextTargetHint,
} from "types/bot-ad-campaigns";
import type { BotGroupAutoResponseMedia } from "types/bot-groups";
import type { InteractiveButton } from "lib/wuzapi";
import type { DivulgacaoInspectionResult } from "types/divulgacao";

const DISPATCH_INTERVAL_MS = Number(process.env.BOT_AD_CAMPAIGN_INTERVAL_MS ?? 45_000);
const STATUS_CLEANUP_INTERVAL_MS = Number(
  process.env.BOT_AD_STATUS_CLEANUP_INTERVAL_MS ?? 5 * 60 * 1000,
);
const CAMPAIGN_BATCH_SIZE = Number(process.env.BOT_AD_CAMPAIGN_BATCH ?? 5);
const CAMPAIGN_CONCURRENCY = Math.max(
  1,
  Number(process.env.BOT_AD_CAMPAIGN_CONCURRENCY ?? 12),
);
const TARGET_DELAY_MIN_MS = Number(process.env.BOT_AD_CAMPAIGN_TARGET_DELAY_MIN_MS ?? 5 * 60_000);
const TARGET_DELAY_MAX_MS = Number(process.env.BOT_AD_CAMPAIGN_TARGET_DELAY_MAX_MS ?? 10 * 60_000);
const CONTENT_DELAY_MIN_MS = Number(process.env.BOT_AD_CAMPAIGN_CONTENT_DELAY_MIN_MS ?? 1_200);
const CONTENT_DELAY_MAX_MS = Number(process.env.BOT_AD_CAMPAIGN_CONTENT_DELAY_MAX_MS ?? 4_000);
const RETRY_INTERVAL_SECONDS = Math.max(
  5,
  Number(process.env.BOT_AD_CAMPAIGN_RETRY_SECONDS ?? 60),
);
const JOIN_DELAY_MS = Math.max(0, Number(process.env.BOT_AD_CAMPAIGN_JOIN_DELAY_MS ?? 2_500));
const RETRYABLE_SEND_STATUSES = new Set([408, 429, 499, 500, 502, 503, 504]);
const RETRYABLE_SEND_MESSAGES = [
  "Client Closed Request",
  "ECONNRESET",
  "ETIMEDOUT",
  "socket hang up",
  "network error",
];
const DEFAULT_STATUS_DAILY_LIMIT = 3;
const AFFILIATE_ML_SEARCH_CACHE_TTL_MS = 90_000;
const AFFILIATE_ML_TEMPLATE_CACHE_TTL_MS = 120_000;
const DEFAULT_AFFILIATE_ML_LIMIT = 20;
const AFFILIATE_ML_CATEGORY_HISTORY_LIMIT = 4;
const AFFILIATE_ML_CAMPAIGN_DISPATCH_ENABLED =
  process.env.ENABLE_AFFILIATE_ML_CAMPAIGN_DISPATCH === "1";

type AffiliateMlFilter = "relevance" | "cheapest" | "free_shipping" | "sold" | "random";
type AffiliateMlContent = Extract<BotAdCampaignContent, { type: "affiliate_ml" }>;

const affiliateMlSearchCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<MercadoLivreSearchResult>;
  }
>();
const affiliateMlTemplateCache = new Map<
  number,
  {
    expiresAt: number;
    promise: Promise<AffiliateMlMessageTemplateSummary>;
  }
>();
const dynamicGroupInviteCache = new Map<
  string,
  { url: string; expiresAt: number }
>();

const runtime = globalThis as typeof globalThis & { __botAdCampaignDispatcherStarted?: boolean };
let dispatcherStarted = runtime.__botAdCampaignDispatcherStarted ?? false;
let dispatchCycleRunning = false;
let cleanupCycleRunning = false;
const activeCampaignIds = new Set<number>();

const log = (message: string, extra?: Record<string, unknown>) => {
  console.log(`[BotAdCampaignDispatcher] ${message}`, extra ?? {});
};

const normalizeAffiliateMlFilter = (value: unknown): AffiliateMlFilter => {
  if (typeof value !== "string") {
    return "relevance";
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "relevance" ||
    normalized === "cheapest" ||
    normalized === "free_shipping" ||
    normalized === "sold" ||
    normalized === "random"
  ) {
    return normalized;
  }
  return "relevance";
};

const clampAffiliateMlLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AFFILIATE_ML_LIMIT;
  }
  return Math.max(1, Math.min(50, Math.floor(parsed)));
};

const normalizeAffiliateMlItemId = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
  return normalized || null;
};

const normalizeAffiliateMlCategoryId = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().toUpperCase().replace(/\s+/g, "");
  return normalized || null;
};

const normalizeAffiliateMlTargetKey = (target: BotAdCampaignTargetRow): string => {
  if (target.id && Number.isFinite(target.id)) {
    return `target:${target.id}`;
  }
  if (target.group_id && Number.isFinite(target.group_id)) {
    return `group:${target.group_id}`;
  }
  if (target.remote_id && target.remote_id.trim()) {
    return `remote:${target.remote_id.trim().toLowerCase()}`;
  }
  if (target.invite_link && target.invite_link.trim()) {
    return `invite:${target.invite_link.trim().toLowerCase()}`;
  }
  if (target.target_id && target.target_id.trim()) {
    return `group-ad:${target.target_id.trim().toLowerCase()}`;
  }
  return `campaign:${target.campaign_id}`;
};

const clampAffiliateMlDispatchIntervalMinutes = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(1440, Math.floor(parsed)));
};

const getAffiliateMlCacheKey = (userId: number, content: AffiliateMlContent): string => {
  const filter = normalizeAffiliateMlFilter(content.filter);
  const limit = clampAffiliateMlLimit(content.limit);
  const preferAvailable = content.preferAvailable !== false;
  return [
    userId,
    content.query.trim().toLowerCase(),
    filter,
    String(limit),
    preferAvailable ? "1" : "0",
  ].join("|");
};

const getCachedAffiliateMlSearch = async (
  userId: number,
  content: AffiliateMlContent,
): Promise<MercadoLivreSearchResult> => {
  const cacheKey = getAffiliateMlCacheKey(userId, content);
  const now = Date.now();
  const existing = affiliateMlSearchCache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  const promise = searchMercadoLivre(content.query, {
    userId,
    limit: clampAffiliateMlLimit(content.limit),
  });
  affiliateMlSearchCache.set(cacheKey, {
    expiresAt: now + AFFILIATE_ML_SEARCH_CACHE_TTL_MS,
    promise,
  });

  setTimeout(() => {
    const current = affiliateMlSearchCache.get(cacheKey);
    if (current && current.promise === promise) {
      affiliateMlSearchCache.delete(cacheKey);
    }
  }, AFFILIATE_ML_SEARCH_CACHE_TTL_MS + 500);

  return promise;
};

const getCachedAffiliateMlMessageTemplate = async (
  userId: number,
): Promise<AffiliateMlMessageTemplateSummary> => {
  const now = Date.now();
  const existing = affiliateMlTemplateCache.get(userId);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  const promise = getAffiliateMlMessageTemplateForUser(userId);
  affiliateMlTemplateCache.set(userId, {
    expiresAt: now + AFFILIATE_ML_TEMPLATE_CACHE_TTL_MS,
    promise,
  });

  setTimeout(() => {
    const current = affiliateMlTemplateCache.get(userId);
    if (current && current.promise === promise) {
      affiliateMlTemplateCache.delete(userId);
    }
  }, AFFILIATE_ML_TEMPLATE_CACHE_TTL_MS + 500);

  return promise;
};

const pickAffiliateMlProduct = (
  products: MercadoLivreProduct[],
  content: AffiliateMlContent,
): MercadoLivreProduct | null => {
  if (!Array.isArray(products) || products.length === 0) {
    return null;
  }
  const preferAvailable = content.preferAvailable !== false;
  const available = products.filter((product) => product.disponivel !== false);
  const pool = preferAvailable && available.length > 0 ? available : products;
  if (pool.length === 0) {
    return null;
  }

  const filter = normalizeAffiliateMlFilter(content.filter);
  const withNumericPrice = pool.filter(
    (product) => typeof product.preco === "number" && Number.isFinite(product.preco),
  );

  if (filter === "cheapest") {
    const source = withNumericPrice.length > 0 ? withNumericPrice : pool;
    return [...source].sort((left, right) => (left.preco ?? Number.MAX_SAFE_INTEGER) - (right.preco ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
  }

  if (filter === "free_shipping") {
    const freeShipping = pool.filter((product) => product.freteGratis === true);
    if (freeShipping.length > 0) {
      const source = freeShipping.filter((product) => typeof product.preco === "number");
      if (source.length > 0) {
        return [...source].sort((left, right) => (left.preco ?? Number.MAX_SAFE_INTEGER) - (right.preco ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
      }
      return freeShipping[0] ?? null;
    }
    return pool[0] ?? null;
  }

  if (filter === "sold") {
    return [...pool].sort((left, right) => {
      const soldDiff = (right.vendidos ?? 0) - (left.vendidos ?? 0);
      if (soldDiff !== 0) {
        return soldDiff;
      }
      const leftPrice = typeof left.preco === "number" ? left.preco : Number.MAX_SAFE_INTEGER;
      const rightPrice = typeof right.preco === "number" ? right.preco : Number.MAX_SAFE_INTEGER;
      return leftPrice - rightPrice;
    })[0] ?? null;
  }

  if (filter === "random") {
    const index = Math.floor(Math.random() * pool.length);
    return pool[index] ?? pool[0] ?? null;
  }

  return pool[0] ?? null;
};

const resolveAffiliateMlConditionLabel = (condition: string | null): string => {
  if (!condition) return "";
  const normalized = condition.toLowerCase();
  if (normalized === "new") return "Novo";
  if (normalized === "used") return "Usado";
  return condition;
};

const buildAffiliateMlMessageFallback = (
  content: AffiliateMlContent,
  product: MercadoLivreProduct,
): { body: string; url: string | null } => {
  const lines: string[] = ["🛒 *Mercado Livre*"];
  const intro = typeof content.introText === "string" ? content.introText.trim() : "";
  if (intro) {
    lines.push(intro, "");
  } else {
    lines.push(`🔎 Busca: ${content.query}`);
    lines.push("");
  }

  if (product.titulo) {
    lines.push(`📦 *${product.titulo}*`);
  }
  if (product.descricaoCurta && product.descricaoCurta !== product.titulo) {
    lines.push(`📝 ${product.descricaoCurta}`);
  }
  if (product.precoFormatado) {
    lines.push(`💰 ${product.precoFormatado}`);
  }
  if (product.precoParcelado) {
    lines.push(`💳 ${product.precoParcelado}`);
  }
  if (product.precoAntigoFormatado && product.precoAntigoFormatado !== product.precoFormatado) {
    lines.push(`💸 Antes: ${product.precoAntigoFormatado}`);
  }
  if (typeof product.vendidos === "number" && product.vendidos > 0) {
    lines.push(`📈 Vendidos: ${product.vendidos}`);
  }
  if (typeof product.estoque === "number" && product.estoque >= 0) {
    lines.push(`📦 Estoque: ${product.estoque}`);
  }
  if (product.freteGratis) {
    lines.push("🚚 Frete grátis");
  } else if (product.freteTexto) {
    lines.push(`🚚 ${product.freteTexto}`);
  }
  if (product.condicao) {
    const conditionLabel = resolveAffiliateMlConditionLabel(product.condicao);
    lines.push(`📌 Condição: ${conditionLabel}`);
  }
  if (product.garantia) {
    lines.push(`🛡️ Garantia: ${product.garantia}`);
  }
  if (product.vendedor.nickname || product.vendedor.id) {
    lines.push(`🏪 Vendedor: ${product.vendedor.nickname ?? `ID ${product.vendedor.id}`}`);
  }

  return {
    body: lines.filter(Boolean).join("\n"),
    url: product.url ?? null,
  };
};

const buildAffiliateMlMessage = async (
  userId: number,
  content: AffiliateMlContent,
  product: MercadoLivreProduct,
  finalUrl: string,
): Promise<{ body: string; url: string | null }> => {
  const fallback = buildAffiliateMlMessageFallback(content, product);

  try {
    const template = await getCachedAffiliateMlMessageTemplate(userId);
    const introText =
      typeof content.introText === "string" && content.introText.trim()
        ? content.introText.trim()
        : `🔎 Busca: ${content.query}`;
    const shippingText = product.freteGratis ? "Frete grátis" : product.freteTexto ?? "";
    const sellerText = product.vendedor.nickname || product.vendedor.id ? product.vendedor.nickname ?? `ID ${product.vendedor.id}` : "";
    const oldPriceText =
      product.precoAntigoFormatado && product.precoAntigoFormatado !== product.precoFormatado
        ? product.precoAntigoFormatado
        : "";
    const descriptionText =
      product.descricaoCurta && product.descricaoCurta !== product.titulo ? product.descricaoCurta : "";
    const rendered = renderAffiliateMlMessageTemplate(template.items, {
      intro_text: introText,
      query: content.query,
      titulo: product.titulo ?? "",
      descricao: descriptionText,
      preco_formatado: product.precoFormatado ?? "",
      preco_parcelado: product.precoParcelado ?? "",
      preco_antigo_formatado: oldPriceText,
      vendidos: typeof product.vendidos === "number" && product.vendidos > 0 ? String(product.vendidos) : "",
      estoque: typeof product.estoque === "number" && product.estoque >= 0 ? String(product.estoque) : "",
      frete: shippingText,
      condicao: resolveAffiliateMlConditionLabel(product.condicao),
      garantia: product.garantia ?? "",
      vendedor: sellerText,
      url: finalUrl,
      item_id: product.id ?? "",
    }).trim();
    if (!rendered) {
      return fallback;
    }
    return {
      body: rendered,
      url: product.url ?? null,
    };
  } catch {
    return fallback;
  }
};

const normalizeStatusMention = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("@")) {
    const lowered = trimmed.toLowerCase();
    if (lowered.endsWith("@c.us")) {
      return `${lowered.slice(0, -5)}@s.whatsapp.net`;
    }
    return lowered;
  }
  const digits = trimmed.replace(/\D+/g, "");
  if (!digits) {
    return null;
  }
  return `${digits}@s.whatsapp.net`;
};

const sanitizeStatusMentions = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const mentions = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeStatusMention(entry);
    if (!normalized) {
      continue;
    }
    mentions.add(normalizeJid(normalized));
    if (mentions.size >= 256) {
      break;
    }
  }
  return mentions.size > 0 ? Array.from(mentions.values()) : null;
};

const mergeStatusConfigs = (
  targetConfig?: BotAdCampaignStatusConfig | null,
  contentConfig?: BotAdCampaignStatusConfig | null,
): BotAdCampaignStatusConfig | null => {
  if (!targetConfig && !contentConfig) {
    return null;
  }
  const mentions = sanitizeStatusMentions(
    contentConfig?.mentions ?? targetConfig?.mentions ?? null,
  );
  const allowReshare =
    typeof contentConfig?.allowReshare === "boolean"
      ? contentConfig.allowReshare
      : typeof targetConfig?.allowReshare === "boolean"
        ? targetConfig.allowReshare
        : null;
  return {
    visibility: contentConfig?.visibility ?? targetConfig?.visibility ?? null,
    deleteAfterMinutes:
      contentConfig?.deleteAfterMinutes ??
      targetConfig?.deleteAfterMinutes ??
      null,
    deleteAt: contentConfig?.deleteAt ?? targetConfig?.deleteAt ?? null,
    whitelist: contentConfig?.whitelist ?? targetConfig?.whitelist ?? null,
    blacklist: contentConfig?.blacklist ?? targetConfig?.blacklist ?? null,
    mentions,
    allowReshare,
    scheduleSlot:
      typeof contentConfig?.scheduleSlot === "number"
        ? contentConfig.scheduleSlot
        : typeof targetConfig?.scheduleSlot === "number"
          ? targetConfig.scheduleSlot
          : null,
  };
};

const applyStatusPrivacyForInstance = async (
  _client: { baseUrl: string; token: string },
  _instanceId: number,
  _config?: BotAdCampaignStatusConfig | null,
): Promise<void> => {
  // Ajuste solicitado: não tentamos mais mudar a privacidade do status através da API,
  // pois o endpoint atual da instância está rejeitando as chamadas e impedindo o envio.
  // Mantemos apenas o envio e a limpeza automática posteriormente.
  return;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const directStatus = (error as { status?: unknown }).status;
  if (typeof directStatus === "number") {
    return directStatus;
  }
  const responseStatus = (error as { response?: { status?: unknown } }).response?.status;
  if (typeof responseStatus === "number") {
    return responseStatus;
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string") {
    const match = message.match(/\b(\d{3})\b/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

const isRetryableSendError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status && RETRYABLE_SEND_STATUSES.has(status)) {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string") {
    const normalized = message.toLowerCase();
    return RETRYABLE_SEND_MESSAGES.some((needle) => normalized.includes(needle.toLowerCase()));
  }
  return false;
};

const runWithRetry = async <T>(
  label: string,
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> => {
  const attempts = Math.max(1, options.attempts ?? 2);
  const delayMs = Math.max(250, options.delayMs ?? 1_500);
  try {
    return await fn();
  } catch (error) {
    if (attempts <= 1 || !isRetryableSendError(error)) {
      throw error;
    }
    log("Falha temporaria ao enviar. Tentando novamente.", {
      label,
      status: getErrorStatus(error),
      error: error instanceof Error ? error.message : String(error),
    });
    await sleep(delayMs);
    return fn();
  }
};

const getRandomTargetDelay = (
  totalTargets = 1,
  processedTargets = 0,
  options?: BotAdCampaignGroupDispatchOptions | null,
) => {
  const configuredMin = Number(options?.targetDelayMinMinutes);
  const configuredMax = Number(options?.targetDelayMaxMinutes);
  const hasConfiguredDelay = Number.isFinite(configuredMin) && configuredMin > 0;
  const baseMin = hasConfiguredDelay
    ? Math.max(60_000, configuredMin * 60_000)
    : Math.max(0, TARGET_DELAY_MIN_MS);
  const baseMax = hasConfiguredDelay
    ? Math.max(baseMin, (Number.isFinite(configuredMax) ? configuredMax : configuredMin) * 60_000)
    : Math.max(baseMin, TARGET_DELAY_MAX_MS);
  if (baseMax === 0) {
    return 0;
  }

  if (hasConfiguredDelay) {
    return Math.floor(baseMin + Math.random() * (baseMax - baseMin + 1));
  }

  const MAX_DELAY = 30 * 60_000; // 30 minutos
  const loadMultiplier = totalTargets <= 3 ? 1 : Math.min(8, 1 + totalTargets / 6);
  const staggerMinutes = Math.min(10, Math.max(0, processedTargets)) * 60_000;
  const randomJitter = Math.floor(Math.random() * 2 * 60_000); // até ±2 min extras

  let adjustedMin = baseMin * loadMultiplier + staggerMinutes;
  let adjustedMax = baseMax * loadMultiplier + staggerMinutes + randomJitter + 5 * 60_000;

  adjustedMin = Math.min(MAX_DELAY, adjustedMin);
  adjustedMax = Math.min(MAX_DELAY, Math.max(adjustedMin + 60_000, adjustedMax));

  const randomDelta = Math.floor(Math.random() * (adjustedMax - adjustedMin + 1));
  return Math.floor(adjustedMin + randomDelta);
};

const resolveDynamicGroupInviteUrl = async (
  campaign: BotAdCampaignRow,
  button: NonNullable<Extract<BotAdCampaignContent, { type: "buttons" }>["ctaButtons"]>[number],
): Promise<string | undefined> => {
  if (button.urlSource !== "group_invite") {
    return button.url ?? undefined;
  }
  const groupId = Number(button.groupId);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new Error(`O botão ${button.text} não possui um grupo válido.`);
  }
  const cacheKey = `${campaign.user_id}:${groupId}`;
  const cached = dynamicGroupInviteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  const group = await getGroupByIdForUser(campaign.user_id, groupId);
  if (!group?.remoteId) {
    throw new Error(`O grupo configurado no botão ${button.text} não foi encontrado.`);
  }
  const instance = await getInstanceForUser(campaign.user_id, group.instanceId);
  let resolvedUrl: string | null = null;
  if (instance?.sessionStatus === "conectado") {
    try {
      resolvedUrl = await getGroupInviteLink(
        { baseUrl: instance.serverBaseUrl, token: instance.token },
        { groupJid: group.remoteId },
      );
    } catch (error) {
      log("Falha ao atualizar link dinâmico; avaliando link salvo.", {
        campaignId: campaign.id,
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  resolvedUrl ??= group.inviteLink?.trim() || button.url?.trim() || null;
  if (!resolvedUrl) {
    throw new Error(`Não foi possível obter o convite atualizado para ${group.name}.`);
  }
  dynamicGroupInviteCache.set(cacheKey, {
    url: resolvedUrl,
    expiresAt: Date.now() + 5 * 60_000,
  });
  return resolvedUrl;
};

const getRandomContentDelay = () => {
  const min = Math.max(0, CONTENT_DELAY_MIN_MS);
  const max = Math.max(min, CONTENT_DELAY_MAX_MS);
  if (max === 0) {
    return 0;
  }
  if (max === min) {
    return min;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
};

const shuffleArray = <T>(input: T[]): T[] => {
  const items = [...input];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
};

const normalizeJid = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.includes("@")) {
    return trimmed;
  }
  return `${trimmed}@s.whatsapp.net`;
};

const parseTimeToMinutes = (value: string): number | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
};

const resolveRemainingDailySlots = (
  schedule?: BotAdCampaignScheduleConfig | null,
  now: Date = new Date(),
): number => {
  if (!schedule) {
    return 1;
  }
  const times =
    schedule.kind === "window"
      ? schedule.atTimes
      : schedule.kind === "recurring" && Array.isArray(schedule.atTimes)
        ? schedule.atTimes
        : null;
  if (!times || times.length === 0) {
    return 1;
  }
  const minutes = Array.from(
    new Set(
      times
        .map((entry) => parseTimeToMinutes(entry))
        .filter((entry): entry is number => Number.isFinite(entry)),
    ),
  ).sort((left, right) => left - right);
  if (minutes.length === 0) {
    return 1;
  }
  const timezone = normalizeTimezoneInput(schedule.timezone ?? null) ?? "UTC";
  const local = describeDateInTimezone(now, timezone);
  const currentMinute = local.hour * 60 + local.minute;
  const remaining = minutes.filter((entry) => entry >= currentMinute - 5).length;
  return Math.max(1, remaining);
};

const selectContentsForCurrentScheduleSlot = (
  contents: BotAdCampaignContent[],
  schedule?: BotAdCampaignScheduleConfig | null,
  now: Date = new Date(),
): BotAdCampaignContent[] => {
  const statusContents = contents.filter((content) => content.type === "status");
  const assigned = statusContents.filter(
    (content) =>
      typeof content.config?.scheduleSlot === "number" &&
      Number.isFinite(content.config.scheduleSlot),
  );
  if (assigned.length === 0 || schedule?.kind !== "window" || !schedule.atTimes?.length) {
    return statusContents;
  }
  const slots = schedule.atTimes
    .map((value, index) => ({ index, minutes: parseTimeToMinutes(value) }))
    .filter((slot): slot is { index: number; minutes: number } => slot.minutes !== null);
  if (slots.length === 0) return [];
  const timezone = normalizeTimezoneInput(schedule.timezone ?? null) ?? "UTC";
  const local = describeDateInTimezone(now, timezone);
  const currentMinute = local.hour * 60 + local.minute;
  slots.sort((left, right) => {
    const leftDelta = Math.min(
      Math.abs(left.minutes - currentMinute),
      1440 - Math.abs(left.minutes - currentMinute),
    );
    const rightDelta = Math.min(
      Math.abs(right.minutes - currentMinute),
      1440 - Math.abs(right.minutes - currentMinute),
    );
    return leftDelta - rightDelta;
  });
  const activeSlot = slots[0]?.index;
  if (activeSlot === undefined) return [];
  return assigned.filter(
    (content) => Math.floor(Number(content.config?.scheduleSlot)) === activeSlot,
  );
};

export const selectStatusContentsForTarget = (
  contents: BotAdCampaignContent[],
  randomizer?: BotAdCampaignStatusRandomizer | null,
  history?: StatusContentHistory | null,
  context?: { schedule?: BotAdCampaignScheduleConfig | null; now?: Date },
): BotAdCampaignContent[] => {
  const statusContents = selectContentsForCurrentScheduleSlot(
    contents,
    context?.schedule ?? null,
    context?.now ?? new Date(),
  );
  if (statusContents.length === 0) {
    return [];
  }
  const allStatusContents = contents.filter((content) => content.type === "status");
  const preferredIds = new Set(
    allStatusContents
      .filter((content) => Boolean(content.alwaysSendWhenRandomized))
      .map((content) => content.id),
  );
  const usageCounts = history?.usageCounts ?? {};
  const dailyUsageCounts = history?.dailyUsageCounts ?? {};
  const sentToday = history?.dailySentCount ?? 0;
  const repeatingSchedule =
    context?.schedule?.kind === "window" ||
    context?.schedule?.kind === "recurring";
  const configuredDailyLimitRaw =
    randomizer?.dailyLimit ??
    randomizer?.perDayCount ??
    (repeatingSchedule ? DEFAULT_STATUS_DAILY_LIMIT : null);
  const configuredDailyLimit =
    configuredDailyLimitRaw && configuredDailyLimitRaw > 0
      ? Math.max(1, Math.floor(configuredDailyLimitRaw))
      : null;
  const remainingForDay =
    configuredDailyLimit !== null
      ? Math.max(0, configuredDailyLimit - sentToday)
      : null;
  if (remainingForDay === 0) {
    return [];
  }

  const ensurePreferred = randomizer?.ensurePreferredDaily !== false;
  const preferredAlreadySent = [...preferredIds].some(
    (contentId) => (dailyUsageCounts[contentId] ?? 0) > 0,
  );
  const eligiblePreferred = statusContents.filter((content) =>
    preferredIds.has(content.id),
  );

  // If the preferred item belongs to a later fixed schedule slot, keep one
  // daily quota slot available instead of exhausting the limit beforehand.
  const mustReservePreferredSlot =
    ensurePreferred &&
    preferredIds.size > 0 &&
    !preferredAlreadySent &&
    eligiblePreferred.length === 0 &&
    remainingForDay !== null;
  const availableNow =
    remainingForDay !== null
      ? Math.max(0, remainingForDay - (mustReservePreferredSlot ? 1 : 0))
      : statusContents.length;
  if (availableNow === 0) {
    return [];
  }

  const configuredPerRun =
    randomizer?.perRunCount && randomizer.perRunCount > 0
      ? Math.min(
          statusContents.length,
          Math.max(1, Math.floor(randomizer.perRunCount)),
        )
      : randomizer?.enabled
        ? 1
        : statusContents.some(
              (content) =>
                content.type === "status" &&
                content.config?.instagramProfile?.automatic === true,
            )
          ? Math.max(
              1,
              statusContents.filter(
                (content) =>
                  content.type !== "status" ||
                  content.config?.instagramProfile?.automatic !== true,
              ).length + 1,
            )
          : statusContents.length;
  const remainingSlots = resolveRemainingDailySlots(
    context?.schedule ?? null,
    context?.now ?? new Date(),
  );
  const perRunByQuota =
    remainingForDay !== null && randomizer?.perDayCount != null
      ? Math.max(
          1,
          Math.ceil(remainingForDay / Math.max(1, remainingSlots)),
        )
      : configuredPerRun;
  const maxPerRun =
    remainingForDay !== null
      ? Math.min(
          statusContents.length,
          availableNow,
          Math.max(configuredPerRun, perRunByQuota),
        )
      : configuredPerRun;
  if (maxPerRun <= 0) {
    return [];
  }

  const sortByLeastUsed = (
    left: BotAdCampaignContent,
    right: BotAdCampaignContent,
  ) => {
    const dailyDiff =
      (dailyUsageCounts[left.id] ?? 0) - (dailyUsageCounts[right.id] ?? 0);
    if (dailyDiff !== 0) {
      return dailyDiff;
    }
    const totalDiff =
      (usageCounts[left.id] ?? 0) - (usageCounts[right.id] ?? 0);
    if (totalDiff !== 0) {
      return totalDiff;
    }
    return Math.random() - 0.5;
  };

  const selected: BotAdCampaignContent[] = [];
  if (ensurePreferred && !preferredAlreadySent && eligiblePreferred.length > 0) {
    selected.push([...eligiblePreferred].sort(sortByLeastUsed)[0]);
  }

  const candidatePool = statusContents.filter(
    (content) => !selected.some((selectedItem) => selectedItem.id === content.id),
  );
  if (randomizer?.enabled) {
    candidatePool.sort(sortByLeastUsed);
  }
  const required = Math.max(0, maxPerRun - selected.length);
  selected.push(...candidatePool.slice(0, required));

  const allowedIds = new Set<string>();
  selected.forEach((content) => allowedIds.add(content.id));

  const lastContentId = history?.lastContentId ?? null;
  if (
    randomizer?.enabled &&
    lastContentId &&
    allowedIds.has(lastContentId) &&
    !preferredIds.has(lastContentId) &&
    allowedIds.size > 1
  ) {
    allowedIds.delete(lastContentId);
    for (const candidate of candidatePool) {
      if (candidate.id === lastContentId) {
        continue;
      }
      if (!allowedIds.has(candidate.id)) {
        allowedIds.add(candidate.id);
        break;
      }
    }
    if (allowedIds.size === 0) {
      allowedIds.add(lastContentId);
    }
  }

  if (allowedIds.size === 0 && statusContents.length > 0) {
    allowedIds.add(statusContents[0].id);
  }

  return statusContents.filter((content) => allowedIds.has(content.id));
};

const selectGroupContentsForTarget = (
  contents: BotAdCampaignContent[],
  randomizer?: BotAdCampaignGroupRandomizer | null,
): BotAdCampaignContent[] => {
  const groupContents = contents.filter((content) => content.type !== "status");
  if (groupContents.length === 0) {
    return [];
  }
  if (!randomizer || !randomizer.enabled) {
    return groupContents;
  }
  const perRunCount =
    randomizer.perRunCount && randomizer.perRunCount > 0
      ? Math.min(groupContents.length, Math.max(1, Math.floor(randomizer.perRunCount)))
      : Math.min(groupContents.length, 2);
  const shuffled = shuffleArray(groupContents);
  return shuffled.slice(0, perRunCount);
};

const parseJsonArray = <T>(value: string | null): T[] => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const parseStatusConfig = (value: string | null): BotAdCampaignStatusConfig | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const asStringList = (raw: unknown): string[] | null => {
      if (!Array.isArray(raw)) {
        return null;
      }
      const next = raw
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim());
      return next.length > 0 ? next.slice(0, 256) : null;
    };
    return {
      visibility:
        typeof record.visibility === "string"
          ? (record.visibility as BotAdCampaignStatusConfig["visibility"])
          : null,
      deleteAfterMinutes:
        typeof record.deleteAfterMinutes === "number" && Number.isFinite(record.deleteAfterMinutes)
          ? Math.max(1, Math.floor(record.deleteAfterMinutes))
          : null,
      deleteAt: typeof record.deleteAt === "string" ? record.deleteAt : null,
      whitelist: asStringList(record.whitelist),
      blacklist: asStringList(record.blacklist),
      mentions: sanitizeStatusMentions(record.mentions ?? record.Mentions),
      allowReshare:
        typeof record.allowReshare === "boolean"
          ? record.allowReshare
          : typeof record.allow_reshare === "boolean"
            ? record.allow_reshare
            : null,
      scheduleSlot:
        typeof record.scheduleSlot === "number" && Number.isFinite(record.scheduleSlot)
          ? Math.max(0, Math.floor(record.scheduleSlot))
          : null,
    };
  } catch {
    return null;
  }
};

type InviteMeta = { inviteCode: string; inviteLink: string };

const resolveInviteMetaForTarget = (
  target: BotAdCampaignTargetRow,
): InviteMeta | null => {
  if (target.invite_link) {
    const code = extractInviteCode(target.invite_link);
    if (code) {
      return { inviteCode: code, inviteLink: target.invite_link };
    }
  }
  if (target.invite_code) {
    return {
      inviteCode: target.invite_code,
      inviteLink: `https://chat.whatsapp.com/${target.invite_code}`,
    };
  }
  return null;
};

const normalizeInviteInspection = (
  invite: InviteMeta,
  payload: unknown,
): DivulgacaoInspectionResult => {
  const now = new Date().toISOString();
  const baseRecord =
    payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)
      ? (payload as Record<string, unknown>).data
      : payload;
  const record = (baseRecord || {}) as Record<string, any>;

  const normalizeString = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return null;
  };

  const groupJid =
    normalizeString(record?.JID) ||
    normalizeString(record?.jid) ||
    normalizeString(record?.Id) ||
    normalizeString(record?.id) ||
    (record && typeof record === "object" && normalizeString((record as Record<string, unknown>).remoteId)) ||
    null;

  const groupName =
    normalizeString(record?.Name) ||
    normalizeString(record?.name) ||
    normalizeString(record?.Subject) ||
    normalizeString(record?.subject) ||
    null;

  const adminsOnly =
    Boolean(record?.IsAnnounce) ||
    Boolean(record?.AnnounceOnly) ||
    Boolean(record?.announce) ||
    Boolean(record?.adminsOnly);
  const locked = Boolean(record?.IsLocked) || Boolean(record?.locked);
  const joinApproval =
    Boolean(record?.IsJoinApprovalRequired) ||
    Boolean(record?.isJoinApprovalRequired) ||
    Boolean(record?.MembershipApprovalMode) ||
    Boolean(record?.membershipApprovalMode);
  const ephemeral =
    Boolean(record?.IsEphemeral) ||
    Boolean(record?.ephemeral) ||
    Boolean(record?.DisappearingTimer) ||
    Boolean(record?.disappearingTimer);

  let memberCount: number | null = null;
  if (Array.isArray(record?.Participants)) {
    memberCount = record?.Participants.length;
  } else if (typeof record?.memberCount === "number") {
    memberCount = record?.memberCount;
  }

  const owner =
    normalizeString(record?.OwnerJID) ||
    normalizeString(record?.OwnerNumber) ||
    normalizeString(record?.owner) ||
    null;

  return {
    inviteCode: invite.inviteCode,
    inviteLink: invite.inviteLink,
    groupJid,
    groupName,
    adminsOnly,
    locked,
    joinApprovalRequired: joinApproval,
    ephemeralEnabled: ephemeral,
    memberCount,
    owner,
    inspectedAt: now,
    raw: record ?? null,
  };
};

const normalizeMentionParticipant = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeJid(value);
  return normalized || null;
};

const extractMentionCandidate = (entry: unknown): string | null => {
  if (typeof entry === "string" && entry.trim()) {
    return normalizeMentionParticipant(entry.trim());
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const candidates = [
    record.id,
    record.Id,
    record.ID,
    record.jid,
    record.JID,
    record._serialized,
    record.participant,
    record.Participant,
    record.user,
    record.User,
    record.phone,
    record.Phone,
    record.number,
    record.Number,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const normalized = normalizeMentionParticipant(candidate.trim());
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
};

const extractMentionList = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const mentions = new Set<string>();
  raw.forEach((entry) => {
    const id = extractMentionCandidate(entry);
    if (id) {
      mentions.add(id);
    }
  });
  return Array.from(mentions.values());
};

type GroupParticipantSnapshot = {
  jid: string;
  isAdmin: boolean;
};

const unwrapGroupInfoPayload = (value: unknown): Record<string, unknown> => {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return {};
    }
    const record = current as Record<string, unknown>;
    const nested = record.data ?? record.Data ?? record.result ?? record.Result ?? record.info ?? record.Info;
    if (!nested || nested === current) {
      return record;
    }
    current = nested;
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : {};
};

const extractGroupParticipantSnapshot = (payload: unknown): GroupParticipantSnapshot[] => {
  const record = unwrapGroupInfoPayload(payload);
  const raw = record.Participants ?? record.participants ?? [];
  if (!Array.isArray(raw)) {
    return [];
  }
  const participants = new Map<string, GroupParticipantSnapshot>();
  raw.forEach((entry) => {
    const jid = extractMentionCandidate(entry);
    if (!jid) return;
    const participant = entry && typeof entry === "object"
      ? (entry as Record<string, unknown>)
      : {};
    const isAdmin = Boolean(
      participant.IsAdmin ??
        participant.isAdmin ??
        participant.IsSuperAdmin ??
        participant.isSuperAdmin ??
        participant.SuperAdmin ??
        participant.superAdmin,
    );
    const previous = participants.get(jid);
    participants.set(jid, { jid, isAdmin: isAdmin || previous?.isAdmin === true });
  });

  const owner = extractMentionCandidate(
    record.OwnerPN ?? record.ownerPN ?? record.OwnerJID ?? record.ownerJID ?? record.Owner ?? record.owner,
  );
  if (owner) {
    participants.set(owner, { jid: owner, isAdmin: true });
  }
  return Array.from(participants.values());
};

const extractAudienceTitle = (target: BotAdCampaignTargetRow): string | null => {
  if (!target.audience_meta) {
    return null;
  }
  try {
    const parsed = JSON.parse(target.audience_meta) as Record<string, unknown>;
    const title = parsed?.title;
    if (typeof title === "string" && title.trim()) {
      return title.trim();
    }
  } catch {
    /* ignore */
  }
  return null;
};

const fetchGroupParticipantsForMentions = async (
  client: { baseUrl: string; token: string },
  groupJid: string,
): Promise<GroupParticipantSnapshot[]> => {
  try {
    const info = await getGroupInfo<Record<string, unknown>>(client, groupJid);
    return extractGroupParticipantSnapshot(info);
  } catch (error) {
    console.warn("[BotAdCampaignDispatcher] Falha ao obter participantes para menção", {
      groupJid,
      error,
    });
    return [];
  }
};

const ensureTargetInviteAvailability = async (
  client: { baseUrl: string; token: string },
  target: BotAdCampaignTargetRow,
): Promise<DivulgacaoInspectionResult | null> => {
  const invite = resolveInviteMetaForTarget(target);
  if (!invite) {
    return parseTargetInspection(target);
  }
  const payload = await getGroupInviteInfo(client, invite.inviteCode);
  const inspection = normalizeInviteInspection(invite, payload);
  if (!inspection.groupJid) {
    throw new Error("Não foi possível identificar o grupo pelo convite antes do envio.");
  }
  if (inspection.joinApprovalRequired) {
    throw new Error("O grupo exige aprovação antes de permitir novos envios.");
  }
  (target as BotAdCampaignTargetRow).remote_id = inspection.groupJid;
  (target as any).inspection_json = JSON.stringify(inspection);
  return inspection;
};

const parseTargetInspection = (target: BotAdCampaignTargetRow): DivulgacaoInspectionResult | null =>
  parseJsonValue<DivulgacaoInspectionResult>(target.inspection_json);

const extractInviteCode = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/chat\.whatsapp\.com\/([A-Za-z0-9-_]+)/i);
  const code = match?.[1] ?? trimmed.split("/").pop();
  return code ? code.replace(/\s+/g, "") : null;
};

const ensureGroupMembership = async (
  client: { baseUrl: string; token: string },
  target: BotAdCampaignTargetRow,
): Promise<boolean> => {
  const link = target.invite_link ?? null;
  const code = target.invite_code ?? extractInviteCode(link);
  if (!code) {
    return false;
  }
  try {
    await joinGroupWithInviteLink(client, code);
    (target as { __joinedAt?: number }).__joinedAt = Date.now();
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status ?? (error as { response?: { status?: number } }).response?.status;
    if (status && status !== 409) {
      throw error;
    }
    return false;
  }
};

const parseJsonValue = <T>(value: string | null): T | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
};

const combineMentions = (
  content: BotAdCampaignContent,
  target: BotAdCampaignTargetRow,
  groupParticipants?: string[],
  groupAdmins?: Set<string>,
): string[] => {
  const mentions = new Set<string>();
  const applyList = (source?: string[] | null) => {
    if (!Array.isArray(source)) {
      return;
    }
    source.forEach((jid) => {
      if (typeof jid === "string" && jid.trim()) {
        mentions.add(normalizeJid(jid));
      }
    });
  };

  if (target.mention_all === 1 && Array.isArray(groupParticipants)) {
    applyList(groupParticipants);
  }
  applyList(target.mention_list ? parseJsonArray<string>(target.mention_list) : []);

  if ("mentionAll" in content && content.mentionAll && Array.isArray(groupParticipants)) {
    applyList(groupParticipants);
  }
  if ("mentions" in content) {
    applyList(content.mentions ?? []);
  }

  if (target.exclude_admins === 1 && groupAdmins && groupAdmins.size > 0) {
    groupAdmins.forEach((jid) => mentions.delete(normalizeJid(jid)));
  }

  return Array.from(mentions.values());
};

const buildTargetHint = (
  target: BotAdCampaignTargetRow,
  waitMs?: number | null,
): CampaignNextTargetHint => {
  const title =
    extractAudienceTitle(target) ||
    (target.target_type === "status"
      ? "Status"
      : target.invite_link || target.remote_id || (target.group_id ? `Grupo ${target.group_id}` : null)) ||
    `Destino ${target.target_id}`;
  return {
    targetId: target.target_id,
    targetType: target.target_type === "status" ? "status" : "group",
    instanceId: target.instance_id,
    groupId: target.group_id ?? null,
    remoteId: target.remote_id ?? null,
    inviteLink: target.invite_link ?? null,
    title,
    etaSeconds: typeof waitMs === "number" ? Math.max(0, Math.round(waitMs / 1000)) : null,
  };
};

type PreparedTargetStatus = { ready: boolean; error?: string };

const participantMatchesInstance = (
  participant: string,
  candidates: Array<string | null | undefined>,
): boolean => {
  const normalizedParticipant = normalizeJid(participant);
  if (!normalizedParticipant) return false;
  return candidates.some((candidate) => {
    if (!candidate) return false;
    const normalizedCandidate = normalizeJid(candidate);
    return Boolean(
      normalizedCandidate &&
        (normalizedParticipant === normalizedCandidate ||
          normalizedParticipant.endsWith(normalizedCandidate) ||
          normalizedCandidate.endsWith(normalizedParticipant)),
    );
  });
};

const validateLiveGroupTarget = async (
  client: { baseUrl: string; token: string },
  target: BotAdCampaignTargetRow,
  groupJid: string,
  instanceIdentity: Array<string | null | undefined>,
): Promise<void> => {
  let info: Record<string, unknown>;
  try {
    info = await getGroupInfo<Record<string, unknown>>(client, groupJid);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `A instância não participa mais do grupo ou não conseguiu consultar o destino: ${message}`,
    );
  }

  const invite = resolveInviteMetaForTarget(target) ?? { inviteCode: "", inviteLink: "" };
  const inspection = normalizeInviteInspection(invite, info);
  const participants = extractGroupParticipantSnapshot(info);
  const admins = new Set(
    participants.filter((participant) => participant.isAdmin).map((participant) => participant.jid),
  );
  const instanceIsAdmin = participants.some(
    (participant) =>
      participant.isAdmin && participantMatchesInstance(participant.jid, instanceIdentity),
  );

  if (inspection.adminsOnly && !instanceIsAdmin) {
    throw new Error("O grupo está fechado e a instância não é administradora.");
  }

  target.remote_id = inspection.groupJid || groupJid;
  target.inspection_json = JSON.stringify({
    ...inspection,
    groupJid: inspection.groupJid || groupJid,
    memberCount: participants.length || inspection.memberCount,
  });
  (target as { __groupParticipants?: string[] }).__groupParticipants = participants.map(
    (participant) => participant.jid,
  );
  (target as { __groupAdmins?: Set<string> }).__groupAdmins = admins;
};

const prepareTargetForDispatch = async (
  campaign: BotAdCampaignRow,
  target: BotAdCampaignTargetRow,
  cache: Map<string, PreparedTargetStatus>,
): Promise<PreparedTargetStatus> => {
  const cached = cache.get(target.target_id);
  if (cached) {
    return cached;
  }
  if (target.target_type === "status") {
    const result: PreparedTargetStatus = { ready: true };
    (target as { __preflightReady?: boolean }).__preflightReady = true;
    cache.set(target.target_id, result);
    return result;
  }
  try {
    const instance = await getInstanceForUser(campaign.user_id, target.instance_id);
    if (!instance) {
      throw new Error("Instância não encontrada para pré-validação.");
    }
    if (instance.sessionStatus !== "conectado") {
      throw new Error("A instância está desconectada e o envio foi ignorado.");
    }
    const client = { baseUrl: instance.serverBaseUrl, token: instance.token };
    const inspection = await ensureTargetInviteAvailability(client, target);
    if (inspection) {
      (target as { __preflightInspection?: DivulgacaoInspectionResult }).__preflightInspection = inspection;
    }
    const joined = await ensureGroupMembership(client, target);
    if (joined && JOIN_DELAY_MS > 0) {
      await sleep(JOIN_DELAY_MS);
    }
    const groupJid =
      target.remote_id ??
      inspection?.groupJid ??
      (target.group_id
        ? (await getGroupByIdForUser(campaign.user_id, target.group_id))?.remoteId ?? null
        : null);
    if (!groupJid) {
      throw new Error("Não foi possível identificar o grupo antes do envio.");
    }
    await validateLiveGroupTarget(client, target, groupJid, [instance.phone, instance.remoteId]);
    const result: PreparedTargetStatus = { ready: true };
    (target as { __preflightReady?: boolean }).__preflightReady = true;
    cache.set(target.target_id, result);
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao validar o grupo antes do envio.";
    const result: PreparedTargetStatus = { ready: false, error: message };
    cache.set(target.target_id, result);
    (target as { __preflightReady?: boolean }).__preflightReady = false;
    (target as { __preflightError?: string }).__preflightError = message;
    log("Pré-validação falhou para destino", {
      campaignId: campaign.id,
      targetId: target.id,
      error: message,
    });
    return result;
  }
};

const resolveGroupRecipient = async (
  campaign: BotAdCampaignRow,
  target: BotAdCampaignTargetRow,
): Promise<{ jid: string; participants: string[] }> => {
  if (target.remote_id) {
    return { jid: target.remote_id, participants: [] };
  }

  if (target.group_id) {
    const group = await getGroupByIdForUser(campaign.user_id, target.group_id);
    if (group?.remoteId) {
      const participants =
        Array.isArray(group.participants) && group.participants.length > 0
          ? group.participants.map((participant) => normalizeJid(participant.id))
          : [];
      return { jid: group.remoteId, participants };
    }
  }

  const inspection = parseTargetInspection(target);
  if (inspection?.groupJid) {
    return { jid: inspection.groupJid, participants: [] };
  }

  throw new Error("Destino do grupo inválido.");
};

const guessMimeFromContent = (content: BotAdCampaignContent, overrideSource?: string | null) => {
  const media = "media" in content ? content.media : null;
  const candidates = [
    media?.mimeType,
    media?.fileName,
    media?.path,
    overrideSource,
    media?.url,
    content.caption,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const lookup = mime.lookup(candidate);
      if (lookup) {
        return lookup;
      }
    }
  }
  return undefined;
};

const getPreferredMediaKindForContent = (
  content: BotAdCampaignContent,
): "image" | "video" | undefined => {
  if (content.type === "image" || content.type === "video") {
    return content.type;
  }
  if (content.type === "status") {
    if (content.statusType === "image" || content.statusType === "video") {
      return content.statusType;
    }
  }
  return undefined;
};

type ResolvedMediaSource = {
  data: Buffer | string;
  mimeType?: string | null;
  fileName?: string | null;
  sourceUrl?: string | null;
};

const isInstagramUrl = (value: string): boolean => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am";
  } catch {
    return false;
  }
};

const resolveInstagramMediaSource = async (
  userId: number,
  sourceUrl: string,
): Promise<ResolvedMediaSource> => {
  const baseUrl = (process.env.REST_INTERNAL_BASE_URL?.trim() ||
    `http://127.0.0.1:${process.env.PORT?.trim() || "4322"}`).replace(/\/+$/, "");
  const endpoint = new URL("/api/rest/instagram", `${baseUrl}/`);
  endpoint.searchParams.set("url", sourceUrl);
  const apiKey = await getOrCreateUserApiKey(userId);
  const fallbackKey =
    process.env.INTERNAL_API_KEY?.trim() ||
    process.env.BOTADMIN_INTERNAL_API_KEY?.trim() ||
    process.env.USER_API_FALLBACK_KEY?.trim() ||
    "";
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      ...(apiKey.apiKey || fallbackKey
        ? { "x-api-key": apiKey.apiKey || fallbackKey }
        : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || !payload || payload.status === false) {
    throw new Error(
      payload?.mensagem || payload?.message || `Resolvedor do Instagram retornou HTTP ${response.status}.`,
    );
  }
  const result = payload.resultado ?? payload.data ?? payload;
  const urls = Array.isArray(result?.urls) ? result.urls : [];
  const directUrl =
    urls.find((entry: unknown) => typeof entry === "string" && /^https?:\/\//i.test(entry)) ||
    result?.url ||
    result?.download;
  if (typeof directUrl !== "string" || !/^https?:\/\//i.test(directUrl)) {
    throw new Error("O Instagram não devolveu a mídia deste Reel.");
  }
  return {
    data: directUrl,
    mimeType: "video/mp4",
    fileName: "instagram-reel.mp4",
    sourceUrl,
  };
};

const resolveRemoteStatusMediaSource = async (
  userId: number,
  sourceUrl: string,
): Promise<ResolvedMediaSource> => {
  const baseUrl = (process.env.REST_INTERNAL_BASE_URL?.trim() ||
    `http://127.0.0.1:${process.env.PORT?.trim() || "4322"}`).replace(/\/+$/, "");
  const endpoint = new URL("/api/bot-status/resolve-link", `${baseUrl}/`);
  endpoint.searchParams.set("url", sourceUrl);
  endpoint.searchParams.set("persist", "0");
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      ...createInternalUserRequestHeaders(userId),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || payload?.success !== true || !payload?.result?.url) {
    throw new Error(
      payload?.message || `Resolvedor de mídia retornou HTTP ${response.status}.`,
    );
  }
  const result = payload.result;
  return {
    data: result.url,
    mimeType: result.mimeType ?? null,
    fileName: result.fileName ?? null,
    sourceUrl,
  };
};

const TIKTOK_MEDIA_CACHE_TTL_MS = 5 * 60 * 1000;
const tikTokMediaCache = new Map<string, { expiresAt: number; promise: Promise<ResolvedMediaSource | null> }>();

const getCachedTikTokMedia = (url: string) => {
  const entry = tikTokMediaCache.get(url);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    tikTokMediaCache.delete(url);
    return null;
  }
  return entry.promise;
};

const setCachedTikTokMedia = (url: string, promise: Promise<ResolvedMediaSource | null>) => {
  const expiresAt = Date.now() + TIKTOK_MEDIA_CACHE_TTL_MS;
  tikTokMediaCache.set(url, { expiresAt, promise });
  setTimeout(() => {
    const current = tikTokMediaCache.get(url);
    if (current && current.promise === promise) {
      tikTokMediaCache.delete(url);
    }
  }, TIKTOK_MEDIA_CACHE_TTL_MS + 500);
};

const resolveTikTokMediaSource = async (url: string): Promise<ResolvedMediaSource | null> => {
  const cached = getCachedTikTokMedia(url);
  if (cached) {
    return cached;
  }
  const promise = resolveTikTokMedia(url)
    .then((media) => {
      if (!media?.url) {
        return null;
      }
      return {
        data: media.url,
        mimeType: media.mimeType ?? undefined,
        fileName: media.fileName ?? undefined,
        sourceUrl: media.url,
      } satisfies ResolvedMediaSource;
    })
    .catch((error) => {
      console.error("[BotAdCampaignDispatcher] Falha ao resolver mídia do TikTok", {
        url,
        error,
      });
      return null;
    });
  setCachedTikTokMedia(url, promise);
  return promise;
};

const resolveMediaSource = async (
  content: BotAdCampaignContent,
  userId?: number,
): Promise<ResolvedMediaSource | null> => {
  if (!("media" in content) || !content.media) {
    return null;
  }
  const preferredKind = getPreferredMediaKindForContent(content);
  if (content.media.path) {
    const buffer = await resolveStoredMediaBuffer(content.media.path);
    return {
      data: buffer,
      mimeType: content.media.mimeType ?? null,
      fileName: content.media.fileName ?? null,
      sourceUrl: content.media.url ?? null,
    };
  }
  if (content.media.url) {
    const originalSource =
      content.type === "status" && content.config?.sourceUrl
        ? content.config.sourceUrl
        : content.media.url;
    if (isInstagramUrl(originalSource)) {
      if (!userId) throw new Error("Usuário da programação não identificado.");
      return resolveInstagramMediaSource(userId, originalSource);
    }
    if (isTikTokUrl(content.media.url)) {
      const resolved = await resolveTikTokMediaSource(content.media.url);
      if (!resolved) {
        throw new Error("Não foi possível resolver o link do TikTok informado.");
      }
      return resolved;
    }
    if (isPinterestUrl(content.media.url)) {
      const resolved = await resolvePinterestMedia(content.media.url, preferredKind);
      return {
        data: resolved.url,
        mimeType: resolved.mimeType ?? content.media.mimeType ?? null,
        fileName: content.media.fileName ?? null,
        sourceUrl: resolved.url,
      };
    }
    if (
      content.type === "status" &&
      content.config?.sourceUrl &&
      content.config.sourceUrl === originalSource
    ) {
      if (!userId) throw new Error("Usuário da programação não identificado.");
      return resolveRemoteStatusMediaSource(userId, originalSource);
    }
    return {
      data: content.media.url,
      mimeType: content.media.mimeType ?? null,
      fileName: content.media.fileName ?? null,
      sourceUrl: content.media.url,
    };
  }
  return null;
};

const expandAutomaticInstagramContents = async (
  contents: BotAdCampaignContent[],
): Promise<BotAdCampaignContent[]> => {
  const output = contents.filter(
    (content) =>
      content.type !== "status" || content.config?.instagramProfile?.automatic !== true,
  );
  const generators = contents.filter(
    (content): content is Extract<BotAdCampaignContent, { type: "status" }> =>
      content.type === "status" && content.config?.instagramProfile?.automatic === true,
  );
  for (const generator of generators) {
    const profile = generator.config?.instagramProfile;
    if (!profile?.username) continue;
    const resolved = await resolveInstagramProfileReels(profile.username, {
      limit: 1200,
      maxPages: 100,
    });
    for (const reel of resolved.reels) {
      output.push({
        ...generator,
        id: `${generator.id}:instagram:${reel.shortcode}`,
        statusType: "video",
        caption: reel.caption || generator.caption || null,
        media: {
          url: reel.permalink,
          mimeType: "video/mp4",
          fileName: `instagram-${reel.shortcode}.mp4`,
        },
        config: {
          ...generator.config,
          sourceUrl: reel.permalink,
          previewUrl: reel.thumbnail,
          instagramProfile: {
            ...profile,
            automatic: true,
          },
        },
      });
    }
  }
  return output;
};

const resolveButtonHeaderMedia = async (
  media?: BotGroupAutoResponseMedia | null,
): Promise<Parameters<typeof sendInteractiveButtons>[1]["headerMedia"]> => {
  if (!media) {
    return null;
  }
  if (media.path) {
    const buffer = await resolveStoredMediaBuffer(media.path);
    if (!buffer) {
      return null;
    }
    return {
      type: media.mediaType ?? "image",
      media: buffer,
      mimeType: media.mimeType ?? undefined,
      fileName: media.fileName ?? undefined,
      sourceUrl: media.url ?? media.path,
    };
  }
  if (media.url) {
    return {
      type: media.mediaType ?? "image",
      media: media.url,
      mimeType: media.mimeType ?? undefined,
      fileName: media.fileName ?? undefined,
      sourceUrl: media.url,
    };
  }
  return null;
};

const bufferToDataUrl = (buffer: Buffer, mimeType?: string): string => {
  const fallback = mimeType ?? "application/octet-stream";
  return `data:${fallback};base64,${buffer.toString("base64")}`;
};

const sendAffiliateMlContent = async ({
  client,
  jid,
  mentions,
  campaign,
  target,
  content,
  nativeButtonsEnabled,
}: {
  client: { baseUrl: string; token: string };
  jid: string;
  mentions: string[];
  campaign: BotAdCampaignRow;
  target: BotAdCampaignTargetRow;
  content: AffiliateMlContent;
  nativeButtonsEnabled: boolean;
}): Promise<void> => {
  if (!AFFILIATE_ML_CAMPAIGN_DISPATCH_ENABLED) {
    log("Envio affiliate_ml por campanhas desativado. Use Afiliados > Mercado Livre > Disparos.", {
      campaignId: campaign.id,
      targetId: target.id,
      contentId: content.id,
    });
    return;
  }

  if (content.dispatchEnabled === false) {
    log("Envio afiliado ML desativado por toggle do conteúdo.", {
      campaignId: campaign.id,
      targetId: target.id,
      contentId: content.id,
    });
    return;
  }

  const targetKey = normalizeAffiliateMlTargetKey(target);
  const history = await getAffiliateMlDispatchContextSnapshot({
    userId: campaign.user_id,
    campaignId: campaign.id,
    targetId: target.id,
    targetKey,
    contentId: content.id,
    recentCategoryLimit: AFFILIATE_ML_CATEGORY_HISTORY_LIMIT,
  });
  const dispatchIntervalMinutes = clampAffiliateMlDispatchIntervalMinutes(
    content.dispatchIntervalMinutes,
  );
  if (dispatchIntervalMinutes > 0 && history.lastSentAt) {
    const lastSentAt = new Date(history.lastSentAt).getTime();
    if (Number.isFinite(lastSentAt)) {
      const elapsedMs = Date.now() - lastSentAt;
      const minWaitMs = dispatchIntervalMinutes * 60_000;
      if (elapsedMs < minWaitMs) {
        const remainingSeconds = Math.max(1, Math.ceil((minWaitMs - elapsedMs) / 1000));
        log("Envio afiliado ML pulado por temporizador de segurança.", {
          campaignId: campaign.id,
          targetId: target.id,
          contentId: content.id,
          remainingSeconds,
        });
        return;
      }
    }
  }

  const searchResult = await getCachedAffiliateMlSearch(campaign.user_id, content);
  const products = Array.isArray(searchResult.produtos) ? searchResult.produtos : [];
  let candidateProducts = products;

  if (content.categoryRotationEnabled !== false && history.recentCategoryIds.length > 0) {
    const blockedCategories = new Set(history.recentCategoryIds);
    const withoutRecentCategories = candidateProducts.filter((entry) => {
      const categoryId = normalizeAffiliateMlCategoryId(entry.categoriaId);
      if (!categoryId) return true;
      return !blockedCategories.has(categoryId);
    });
    if (withoutRecentCategories.length > 0) {
      candidateProducts = withoutRecentCategories;
    }
  }

  if (history.lastItemId) {
    const withoutLastItem = candidateProducts.filter(
      (entry) => normalizeAffiliateMlItemId(entry.id) !== history.lastItemId,
    );
    if (withoutLastItem.length > 0) {
      candidateProducts = withoutLastItem;
    }
  }

  const product = pickAffiliateMlProduct(candidateProducts, content);
  if (!product) {
    throw new Error(`Nenhum produto encontrado para "${content.query}".`);
  }

  const productItemId = normalizeAffiliateMlItemId(product.id);
  const productCategoryId = normalizeAffiliateMlCategoryId(product.categoriaId);
  const requireAffiliateLink = content.requireAffiliateLink !== false;
  const mappedAffiliateLink =
    productItemId ? await resolveAffiliateMlLinkForUserByItemId(campaign.user_id, productItemId) : null;
  const fallbackUrl = product.url ?? null;
  const finalUrl = (() => {
    if (mappedAffiliateLink?.affiliateUrl) {
      return mappedAffiliateLink.affiliateUrl;
    }
    return requireAffiliateLink ? null : fallbackUrl;
  })();
  if (!finalUrl) {
    throw new Error(
      `Produto ${productItemId ?? "(sem ID)"} sem link afiliado cadastrado. Cadastre em Afiliados > Mercado Livre > Links afiliados.`,
    );
  }

  const persistDispatchHistory = async () => {
    try {
      await recordAffiliateMlDispatchForContext({
        userId: campaign.user_id,
        campaignId: campaign.id,
        targetId: target.id,
        targetKey,
        contentId: content.id,
        query: content.query,
        itemId: productItemId,
        categoryId: productCategoryId,
        affiliateUrl: finalUrl,
        productUrl: product.url ?? null,
      });
    } catch (error) {
      console.warn("[BotAdCampaignDispatcher] Falha ao persistir histórico de envio afiliado ML", {
        campaignId: campaign.id,
        targetId: target.id,
        contentId: content.id,
        error,
      });
    }
  };

  const messagePayload = await buildAffiliateMlMessage(campaign.user_id, content, product, finalUrl);
  if (mappedAffiliateLink?.affiliateUrl && productItemId) {
    void markAffiliateMlLinkUsage(campaign.user_id, productItemId).catch((error) => {
      console.warn("[BotAdCampaignDispatcher] Falha ao atualizar uso do link afiliado", {
        campaignId: campaign.id,
        itemId: productItemId,
        error,
      });
    });
  }
  const includeButton = nativeButtonsEnabled && content.includeUrlButton !== false;
  const bodyWithLink = (() => {
    if (includeButton) {
      return messagePayload.body;
    }
    if (messagePayload.body.toLowerCase().includes(finalUrl.toLowerCase())) {
      return messagePayload.body;
    }
    return [messagePayload.body, "", `🔗 ${finalUrl}`].filter(Boolean).join("\n");
  })();

  if (includeButton) {
    try {
      await runWithRetry("sendAffiliateMlButtons", () =>
        sendInteractiveButtons(client, {
          to: jid,
          title: "Mercado Livre",
          body: bodyWithLink,
          footer: "Toque no botão para abrir o produto.",
          buttonType: "native",
          mentions,
          headerMedia:
            content.includeImage !== false && product.imagem
              ? {
                  type: "image",
                  media: product.imagem,
                  mimeType: "image/jpeg",
                }
              : null,
          buttons: [
            {
              id: "affiliate_ml_open_offer",
              text: "🔗 Abrir oferta",
              type: "cta_url",
              url: finalUrl,
            },
          ],
        }),
      );
      await persistDispatchHistory();
      return;
    } catch (error) {
      console.error("[BotAdCampaignDispatcher] Falha ao enviar botão URL afiliado ML", {
        campaignId: campaign.id,
        error,
      });
    }
  }

  if (content.includeImage !== false && product.imagem) {
    try {
      await runWithRetry("sendAffiliateMlImage", () =>
        sendMediaMessage(client, {
          to: jid,
          media: product.imagem,
          mediaType: "image",
          mimeType: "image/jpeg",
          filename: "mercadolivre-produto.jpg",
          caption: bodyWithLink,
          mentions,
        }),
      );
      await persistDispatchHistory();
      return;
    } catch (error) {
      console.error("[BotAdCampaignDispatcher] Falha ao enviar imagem afiliado ML", {
        campaignId: campaign.id,
        error,
      });
    }
  }

  await runWithRetry("sendAffiliateMlText", () =>
    sendTextMessage(client, {
      to: jid,
      body: bodyWithLink,
      mentions,
    }),
  );
  await persistDispatchHistory();
};

const sendContentToGroup = async ({
  client,
  content,
  target,
  campaign,
  nativeButtonsEnabled,
}: {
  client: { baseUrl: string; token: string };
  content: BotAdCampaignContent;
  target: BotAdCampaignTargetRow;
  campaign: BotAdCampaignRow;
  nativeButtonsEnabled: boolean;
}): Promise<string | null> => {
  const joined = await ensureGroupMembership(client, target);
  if (joined && JOIN_DELAY_MS > 0) {
    await sleep(JOIN_DELAY_MS);
  }
  const joinedAt = (target as { __joinedAt?: number }).__joinedAt;
  if (!joined && joinedAt && JOIN_DELAY_MS > 0) {
    const elapsed = Date.now() - joinedAt;
    if (elapsed < JOIN_DELAY_MS) {
      await sleep(JOIN_DELAY_MS - elapsed);
    }
  }
  const { jid, participants: initialParticipants } = await resolveGroupRecipient(campaign, target);
  const contentMentionAll = "mentionAll" in content ? Boolean(content.mentionAll) : false;
  let participants =
    (target as { __groupParticipants?: string[] }).__groupParticipants ?? initialParticipants;
  let admins = (target as { __groupAdmins?: Set<string> }).__groupAdmins ?? new Set<string>();
  if (
    (target.mention_all === 1 || contentMentionAll || target.exclude_admins === 1) &&
    participants.length === 0
  ) {
    const snapshot = await fetchGroupParticipantsForMentions(client, jid);
    participants = snapshot.map((participant) => participant.jid);
    admins = new Set(
      snapshot.filter((participant) => participant.isAdmin).map((participant) => participant.jid),
    );
  }
  const mentions = combineMentions(content, target, participants, admins);

  if (content.type === "text") {
    const body = content.text?.trim();
    if (!body) {
      throw new Error("Conteúdo de texto vazio.");
    }
    await runWithRetry("sendTextMessage", () => sendTextMessage(client, { to: jid, body, mentions }));
    return null;
  }

  if (content.type === "affiliate_ml") {
    await sendAffiliateMlContent({
      client,
      jid,
      mentions,
      campaign,
      target,
      content,
      nativeButtonsEnabled,
    });
    return null;
  }

  if (content.type === "status") {
    // Status não é enviado para grupos
    return null;
  }

  if (content.type === "buttons") {
    const buttons: InteractiveButton[] = [];
    if (Array.isArray(content.replyButtons) && content.replyButtons.length > 0) {
      content.replyButtons.slice(0, 3).forEach((button) => {
        buttons.push({
          id: button.id,
          text: button.label ?? button.text ?? button.id,
          type: "quick_reply",
        });
      });
    }
    if (Array.isArray(content.ctaButtons) && content.ctaButtons.length > 0) {
      for (const button of content.ctaButtons.slice(0, 3)) {
        const resolvedUrl = await resolveDynamicGroupInviteUrl(campaign, button);
        buttons.push({
          id: button.id,
          text: button.text,
          type: button.type,
          url: resolvedUrl,
          phoneNumber: button.phoneNumber ?? undefined,
          copyCode: button.copyCode ?? undefined,
        });
      }
    }
    if (buttons.length === 0) {
      throw new Error("Nenhum botão válido informado.");
    }
    const headerMedia = await resolveButtonHeaderMedia(content.headerMedia ?? null);
    const normalizedTitle = content.title?.trim();
    const normalizedBody = content.body?.trim() ?? "";
    await runWithRetry("sendInteractiveButtons", () =>
      sendInteractiveButtons(client, {
        to: jid,
        // Do not mirror the body into the title. Native WhatsApp renders both
        // fields, which made body-only ads appear duplicated.
        title:
          normalizedTitle && normalizedTitle !== normalizedBody
            ? normalizedTitle
            : undefined,
        body: normalizedBody || normalizedTitle || "Selecione uma opção",
        footer: content.footer ?? undefined,
        buttons,
        headerMedia,
        buttonType: content.style === "cta" ? "legacy" : "native",
        mentions,
      }),
    );
    return null;
  }

  if (content.type === "sticker") {
    const mediaSource = await resolveMediaSource(content);
    if (!mediaSource || typeof mediaSource.data === "string") {
      throw new Error("Sticker inválido ou não encontrado.");
    }
    await runWithRetry("sendStickerMessage", () =>
      sendStickerMessage(client, {
        to: jid,
        sticker: mediaSource.data,
        mentions,
        mimeType: mediaSource.mimeType ?? content.media?.mimeType ?? "image/webp",
      }),
    );
    return null;
  }

  const supportedMedia = ["image", "video", "audio", "document"] as const;
  if (supportedMedia.includes(content.type as any)) {
    const mediaSource = await resolveMediaSource(content);
    if (!mediaSource) {
      throw new Error("Mídia não encontrada.");
    }
    const sourceUrl = mediaSource.sourceUrl ?? (typeof mediaSource.data === "string" ? mediaSource.data : null);
    const baseMedia = "media" in content ? content.media : null;
    const effectiveMime =
      mediaSource.mimeType ??
      baseMedia?.mimeType ??
      guessMimeFromContent(content, sourceUrl);
    const effectiveFileName = mediaSource.fileName ?? baseMedia?.fileName ?? undefined;

    const messageId = await runWithRetry("sendMediaMessage", () =>
      sendMediaMessage(client, {
        to: jid,
        media: mediaSource.data,
        mediaType: content.type as "image" | "video" | "audio" | "document",
        caption: content.caption ?? null,
        filename: effectiveFileName ?? undefined,
        mimeType: effectiveMime,
        mentions,
      }),
    );
    return messageId;
  }

  throw new Error(`Tipo de conteúdo não suportado: ${content.type}`);
};

const removePreviousStatusPosts = async (
  client: { baseUrl: string; token: string },
  target: BotAdCampaignTargetRow,
) => {
  if (!target.id) {
    return;
  }
  const existing = await listActiveStatusPostsForTarget(target.campaign_id, target.id);
  for (const post of existing) {
    try {
      if (post.message_id) {
        await deleteStatusUpdate(client, { id: post.message_id });
      }
      await markStatusPostDeleted(post.id, post.message_id ?? null);
      log("Status anterior removido antes de novo envio.", {
        campaignId: target.campaign_id,
        targetId: target.id,
        postId: post.id,
      });
    } catch (error) {
      console.error("[BotAdCampaignDispatcher] Falha ao remover status anterior", {
        postId: post.id,
        campaignId: target.campaign_id,
        error,
      });
      await markStatusPostDeleted(
        post.id,
        post.message_id ?? null,
        error instanceof Error ? error.message : "Erro ao remover status anterior",
      );
    }
  }
};

const sendContentToStatus = async ({
  client,
  content,
  target,
  userId,
}: {
  client: { baseUrl: string; token: string };
  content: BotAdCampaignContent;
  target: BotAdCampaignTargetRow;
  userId: number;
}): Promise<string | null> => {
  if (content.type !== "status") {
    return null;
  }

  if (content.statusType === "document") {
    throw new Error("Status de documento não é suportado pela API.");
  }

  const now = new Date();
  let responseId: string | null = null;
  const targetStatusConfig = parseStatusConfig(target.status_config ?? null);
  const effectiveStatusConfig = mergeStatusConfigs(
    targetStatusConfig,
    content.config ?? null,
  );
  const statusMentions = effectiveStatusConfig?.mentions ?? null;
  const allowReshare =
    typeof effectiveStatusConfig?.allowReshare === "boolean"
      ? effectiveStatusConfig.allowReshare
      : null;

  await applyStatusPrivacyForInstance(client, target.instance_id, effectiveStatusConfig);

  if (content.statusType === "text") {
    const body = content.text?.trim() ?? content.caption?.trim();
    if (!body) {
      throw new Error("Status textual vazio.");
    }
    const result = await sendStatusUpdate(client, {
      type: "text",
      text: body,
      mentions: statusMentions,
      allowReshare,
    });
    responseId = result?.Id ?? null;
  } else {
    const mediaSource = await resolveMediaSource(content, userId);
    if (!mediaSource) {
      throw new Error("Mídia do status não encontrada.");
    }
    const sourceUrl = mediaSource.sourceUrl ?? (typeof mediaSource.data === "string" ? mediaSource.data : null);
    const baseMedia = "media" in content ? content.media : null;
    const mimeType =
      mediaSource.mimeType ??
      baseMedia?.mimeType ??
      guessMimeFromContent(content, sourceUrl) ??
      (content.statusType === "video" ? "video/mp4" : "image/jpeg");
    const payloadSource =
      typeof mediaSource.data === "string"
        ? mediaSource.data
        : bufferToDataUrl(mediaSource.data, mimeType);
    const type = content.statusType === "video" ? "video" : "image";
    const result = await sendStatusUpdate(client, {
      type: type === "video" ? "video" : "image",
      [type === "video" ? "video" : "image"]: payloadSource,
      caption: content.caption ?? null,
      mimeType,
      mentions: statusMentions,
      allowReshare,
    });
    responseId = result?.Id ?? null;
  }

  if (responseId) {
    const deleteAfter =
      effectiveStatusConfig?.deleteAfterMinutes ??
      24 * 60;
    const deleteAt = new Date(now.getTime() + deleteAfter * 60_000);
    log("Status enviado com sucesso.", {
      campaignId: target.campaign_id,
      targetId: target.id,
      messageId: responseId,
      visibility: effectiveStatusConfig?.visibility ?? "contacts",
    });
    await createStatusPostRecord(
      target.campaign_id,
      target.id,
      target.instance_id,
      {
        remoteJid: "status@broadcast",
        messageId: responseId,
        deleteAt,
        payload: {
          contentId: content.id,
          config: effectiveStatusConfig ?? null,
          snapshot: {
            statusType: content.statusType,
            text: content.text ?? null,
            caption: content.caption ?? null,
            config: effectiveStatusConfig ?? null,
            media:
              content.media && typeof content.media === "object"
                ? {
                    url: content.media.url ?? null,
                    path: content.media.path ?? null,
                    mimeType: content.media.mimeType ?? null,
                    fileName: content.media.fileName ?? null,
                  }
                : null,
          },
        },
      },
    );
  }

  return responseId;
};

const processCampaignTarget = async (
  campaign: BotAdCampaignRow,
  target: BotAdCampaignTargetRow,
  contents: BotAdCampaignContent[],
  schedule: BotAdCampaignScheduleConfig | null,
  statusRandomizer?: BotAdCampaignStatusRandomizer | null,
  groupRandomizer?: BotAdCampaignGroupRandomizer | null,
) => {
  const instance = await getInstanceForUser(campaign.user_id, target.instance_id);
  if (!instance) {
    throw new Error("Instância não encontrada para este usuário.");
  }
  if (instance.sessionStatus !== "conectado") {
    throw new Error("Instância desconectada. Conecte-a antes de enviar campanhas.");
  }

  const client = {
    baseUrl: instance.serverBaseUrl,
    token: instance.token,
  };
  let nativeButtonsEnabled = false;
  try {
    const instanceSettings = await getInstanceSettings(instance.id);
    nativeButtonsEnabled = Boolean(instanceSettings.commandToggles.nativeButtons);
  } catch (error) {
    console.warn("[BotAdCampaignDispatcher] Falha ao ler configurações da instância para botões nativos", {
      campaignId: campaign.id,
      instanceId: instance.id,
      error,
    });
  }

  const preflightReady = (target as { __preflightReady?: boolean }).__preflightReady;
  const preflightError = (target as { __preflightError?: string }).__preflightError;
  if (preflightReady === false) {
    throw new Error(preflightError || "Destino indisponível.");
  }
  if (target.target_type !== "status" && (target.invite_link || target.invite_code)) {
    if (preflightReady !== true) {
      await ensureTargetInviteAvailability(client, target);
    }
    const joined = await ensureGroupMembership(client, target);
    if (joined && JOIN_DELAY_MS > 0) {
      await sleep(JOIN_DELAY_MS);
    }
    const joinedAt = (target as { __joinedAt?: number }).__joinedAt;
    if (!joined && joinedAt && JOIN_DELAY_MS > 0) {
      const elapsed = Date.now() - joinedAt;
      if (elapsed < JOIN_DELAY_MS) {
        await sleep(JOIN_DELAY_MS - elapsed);
      }
    }
  }

  if (target.target_type !== "status") {
    const recipient = await resolveGroupRecipient(campaign, target);
    await validateLiveGroupTarget(client, target, recipient.jid, [
      instance.phone,
      instance.remoteId,
    ]);
  }

  if (target.target_type !== "status" && target.group_id) {
    const guard = await resolveBotAutomationGuard({
      userId: campaign.user_id,
      instanceId: target.instance_id,
      groupId: target.group_id,
    });
    if (guard.blocked) {
      log("Destino de campanha bloqueado por plano/add-on vencido.", {
        campaignId: campaign.id,
        targetId: target.id,
        groupId: target.group_id,
      });
      return;
    }
  }

  let statusHistory: StatusContentHistory | null = null;
  if (
    target.target_type === "status" &&
    target.id != null &&
    Number.isFinite(target.id)
  ) {
    statusHistory = await getStatusContentHistoryForTarget(target.campaign_id, target.id, {
      timezone:
        schedule?.kind === "window" || schedule?.kind === "recurring"
          ? schedule.timezone ?? "America/Sao_Paulo"
          : "America/Sao_Paulo",
      dayReference: new Date(),
    });
  }

  const expandedContents =
    target.target_type === "status"
      ? await expandAutomaticInstagramContents(contents)
      : contents;
  const executionContents =
    target.target_type === "status"
      ? selectStatusContentsForTarget(expandedContents, statusRandomizer, statusHistory, {
          schedule,
          now: new Date(),
        })
      : selectGroupContentsForTarget(contents, groupRandomizer);

  if (executionContents.length === 0) {
    return;
  }

  for (let contentIndex = 0; contentIndex < executionContents.length; contentIndex += 1) {
    const content = executionContents[contentIndex];
    if (target.target_type === "status" && content.type !== "status") {
      continue;
    }
    if (target.target_type !== "status" && content.type === "status") {
      continue;
    }
    if (target.target_type === "status") {
      await runWithRetry("sendStatusUpdate", () =>
        sendContentToStatus({ client, content, target, userId: campaign.user_id }),
      );
    } else {
      await sendContentToGroup({ client, content, target, campaign, nativeButtonsEnabled });
      if (contentIndex < executionContents.length - 1) {
        const delay = getRandomContentDelay();
        if (delay > 0) {
          log("Aguardando antes do próximo conteúdo do mesmo grupo.", {
            campaignId: campaign.id,
            targetId: target.id,
            delayMs: delay,
          });
          await sleep(delay);
        }
      }
    }
  }
};

const handleCampaign = async (
  campaign: BotAdCampaignRow,
  targets: BotAdCampaignTargetRow[],
) => {
  if (!(await isBotAdCampaignDispatchable(campaign.id))) {
    log("Campanha removida ou pausada antes do processamento; envio ignorado.", {
      campaignId: campaign.id,
    });
    return;
  }
  let contents: BotAdCampaignContent[] = [];
  if (campaign.content_json && campaign.content_json.trim()) {
    try {
      const parsed = JSON.parse(campaign.content_json);
      contents = Array.isArray(parsed) ? (parsed as BotAdCampaignContent[]) : [];
    } catch (error) {
      console.error("[BotAdCampaignDispatcher] Conteúdo inválido na campanha", {
        campaignId: campaign.id,
        error,
      });
    }
  }
  if (contents.length === 0) {
    log("Campanha sem conteúdo. Ignorando.", { campaignId: campaign.id });
    await touchCampaignRun(campaign.id);
    return;
  }
  let schedule: BotAdCampaignScheduleConfig | null = null;
  if (campaign.schedule_config && campaign.schedule_config.trim()) {
    try {
      const parsed = JSON.parse(campaign.schedule_config);
      schedule = parsed && typeof parsed === "object" ? (parsed as BotAdCampaignScheduleConfig) : null;
    } catch {
      schedule = null;
    }
  }

  let successCount = 0;
  let failureCount = 0;
  const options = parseBotAdCampaignOptions(campaign.options_json);
  const statusRandomizer = options?.statusRandomizer ?? null;
  const groupRandomizer = options?.groupRandomizer ?? null;
  const groupDispatch = options?.groupDispatch ?? null;

  const randomizedTargets = shuffleArray(targets);
  if (groupDispatch?.prioritizeNeverSent !== false) {
    const lastSuccessAt = await getCampaignTargetLastSuccessAt(campaign.id);
    randomizedTargets.sort((left, right) => {
      const leftAt = lastSuccessAt.get(left.id) ?? Number.NEGATIVE_INFINITY;
      const rightAt = lastSuccessAt.get(right.id) ?? Number.NEGATIVE_INFINITY;
      return leftAt - rightAt;
    });
  }
  const targetPreparation = new Map<string, PreparedTargetStatus>();
  const setNextRunSafely = async (hintTarget?: BotAdCampaignTargetRow | null, waitMs?: number | null) => {
    try {
      if (hintTarget) {
        await setCampaignNextRunState(campaign.id, new Date(), buildTargetHint(hintTarget, waitMs ?? 0));
      } else {
        await setCampaignNextRunState(campaign.id, new Date(), null);
      }
    } catch (error) {
      log("Falha ao atualizar estado de próximo envio.", {
        campaignId: campaign.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (randomizedTargets.length > 0) {
    await prepareTargetForDispatch(campaign, randomizedTargets[0], targetPreparation);
    await setNextRunSafely(randomizedTargets[0], 0);
  } else {
    await setNextRunSafely(null, 0);
  }

  const scheduleNextTargetWindow = async (currentIndex: number): Promise<void> => {
    const nextIndex = currentIndex + 1;
    while (nextIndex < randomizedTargets.length) {
      const candidate = randomizedTargets[nextIndex];
      const status = await prepareTargetForDispatch(campaign, candidate, targetPreparation);
      if (!status.ready) {
        failureCount += 1;
        await recordCampaignRun(campaign.id, candidate.id, "failed", {
          errorMessage: status.error ?? "Destino indisponível antes do envio.",
        });
        randomizedTargets.splice(nextIndex, 1);
        continue;
      }
      if (candidate.target_type === "group") {
        const waitMs = getRandomTargetDelay(
          randomizedTargets.length,
          currentIndex + 1,
          groupDispatch,
        );
        const etaDate = new Date(Date.now() + waitMs);
        await setCampaignNextRunState(campaign.id, etaDate, buildTargetHint(candidate, waitMs));
        if (waitMs > 0) {
          const waitSeconds = Math.round(waitMs / 1000);
          log("Aguardando antes do próximo destino para evitar padrão robótico.", {
            campaignId: campaign.id,
            waitMs,
            waitSeconds,
            processedTargets: currentIndex + 1,
            totalTargets: randomizedTargets.length,
            nextTargetId: candidate.target_id,
          });
          await sleep(waitMs);
        }
      } else {
        await setCampaignNextRunState(campaign.id, new Date(), buildTargetHint(candidate, 0));
      }
      return;
    }
    await setNextRunSafely(null, 0);
  };

  for (let index = 0; index < randomizedTargets.length; index += 1) {
    if (!(await isBotAdCampaignDispatchable(campaign.id))) {
      log("Campanha pausada ou excluída durante o processamento.", {
        campaignId: campaign.id,
        processedTargets: index,
        totalTargets: randomizedTargets.length,
      });
      return;
    }
    const target = randomizedTargets[index];
    const prepStatus = await prepareTargetForDispatch(campaign, target, targetPreparation);
    if (!prepStatus.ready) {
      failureCount += 1;
      await recordCampaignRun(campaign.id, target.id, "failed", {
        errorMessage: prepStatus.error ?? "Destino indisponível antes do envio.",
      });
      continue;
    }
    try {
      await processCampaignTarget(campaign, target, contents, schedule, statusRandomizer, groupRandomizer);
      await recordCampaignRun(campaign.id, target.id, "success");
      successCount += 1;
    } catch (error) {
      const isRetryable = isRetryableSendError(error);
      const status = getErrorStatus(error);
      console.error("[BotAdCampaignDispatcher] Erro ao processar destino", {
        campaignId: campaign.id,
        targetId: target.id,
        error,
      });
      await recordCampaignRun(campaign.id, target.id, "failed", {
        errorMessage: error instanceof Error ? error.message : "Falha no envio",
        stats: {
          retryable: isRetryable,
          status,
        },
      });
      failureCount += 1;
    }
    await scheduleNextTargetWindow(index);
  }

  if (successCount > 0 || randomizedTargets.length === 0) {
    await touchCampaignRun(campaign.id);
    return;
  }

  if (failureCount > 0) {
    await scheduleCampaignRetry(campaign.id, RETRY_INTERVAL_SECONDS);
    log("Reagendando campanha sem envios concluídos.", {
      campaignId: campaign.id,
      retryInSeconds: RETRY_INTERVAL_SECONDS,
      targets: randomizedTargets.length,
    });
  }
};

const runDispatchCycle = async () => {
  if (dispatchCycleRunning) {
    return;
  }
  dispatchCycleRunning = true;
  try {
    const availableSlots = Math.max(
      0,
      CAMPAIGN_CONCURRENCY - activeCampaignIds.size,
    );
    if (availableSlots === 0) return;
    const campaigns = await listDueBotAdCampaigns(
      Math.max(
        CAMPAIGN_BATCH_SIZE,
        CAMPAIGN_BATCH_SIZE + activeCampaignIds.size,
      ),
    );
    for (const entry of campaigns) {
      const campaignId = entry.campaign.id;
      if (activeCampaignIds.has(campaignId)) continue;
      if (activeCampaignIds.size >= CAMPAIGN_CONCURRENCY) break;
      activeCampaignIds.add(campaignId);
      void handleCampaign(entry.campaign, entry.targets)
        .catch((error) => {
          console.error("[BotAdCampaignDispatcher] Falha isolada na campanha", {
            campaignId,
            error,
          });
        })
        .finally(() => {
          activeCampaignIds.delete(campaignId);
        });
    }
  } catch (error) {
    console.error("[BotAdCampaignDispatcher] Falha ao executar ciclo", error);
  } finally {
    dispatchCycleRunning = false;
  }
};

export const triggerBotAdCampaignDispatchNow = async (): Promise<void> => {
  await runDispatchCycle();
};

const runStatusCleanup = async () => {
  if (cleanupCycleRunning) {
    return;
  }
  cleanupCycleRunning = true;
  try {
    const pending = await listStatusPostsPendingDeletion(25);
    for (const post of pending) {
      try {
        const instance = await getInstanceForUser(post.user_id, post.instance_id);
        if (!instance) {
          throw new Error("Instância não encontrada para remover status.");
        }
        if (!post.message_id) {
          await markStatusPostDeleted(post.id, null, "Identificador do status ausente.");
          continue;
        }
        await deleteStatusUpdate(
          {
            baseUrl: instance.serverBaseUrl,
            token: instance.token,
          },
          { id: post.message_id },
        );
        await markStatusPostDeleted(post.id, post.message_id);
        log("Status removido no WhatsApp.", {
          postId: post.id,
          campaignId: post.campaign_id,
          messageId: post.message_id,
        });
      } catch (error) {
        console.error("[BotAdCampaignDispatcher] Falha ao revogar status", {
          postId: post.id,
          error,
        });
        log("Falha ao remover status no WhatsApp.", {
          postId: post.id,
          campaignId: post.campaign_id,
          error: error instanceof Error ? error.message : error,
        });
        await markStatusPostDeleted(
          post.id,
          post.message_id ?? null,
          error instanceof Error ? error.message : "Erro ao apagar status",
        );
      }
    }
  } finally {
    cleanupCycleRunning = false;
  }
};

export const startBotAdCampaignDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  runtime.__botAdCampaignDispatcherStarted = true;
  log("Dispatcher iniciado.");

  runDispatchCycle().catch((error) => {
    console.error("[BotAdCampaignDispatcher] Erro inicial no ciclo de envio", error);
  });
  setInterval(runDispatchCycle, DISPATCH_INTERVAL_MS);

  runStatusCleanup().catch((error) => {
    console.error("[BotAdCampaignDispatcher] Erro inicial no ciclo de limpeza", error);
  });
  setInterval(runStatusCleanup, STATUS_CLEANUP_INTERVAL_MS);
};
