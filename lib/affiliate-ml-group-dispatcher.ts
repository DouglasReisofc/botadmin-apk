import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import { getInstanceSettings } from "lib/bot-instance-settings";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import {
  listEnabledAffiliateMlGroupDispatchesForRun,
  markAffiliateMlGroupDispatchError,
  markAffiliateMlGroupDispatchSuccess,
  type AffiliateMlGroupDispatchWorkerEntry,
} from "lib/affiliate-ml-group-dispatches";
import {
  listAffiliateMlLinksForUser,
  markAffiliateMlLinkUsage,
  updateAffiliateMlLinkCategoryForUser,
  type AffiliateMlLinkSummary,
} from "lib/affiliate-ml-links";
import {
  getAffiliateMlDispatchContextSnapshot,
  recordAffiliateMlDispatchForContext,
} from "lib/affiliate-ml-dispatch-history";
import {
  getAffiliateMlMessageTemplateForUser,
  renderAffiliateMlMessageTemplate,
  type AffiliateMlMessageTemplateSummary,
} from "lib/affiliate-ml-message-template";
import { searchMercadoLivre, type MercadoLivreProduct } from "lib/apis/mercadolivre";
import { sendInteractiveButtons, sendMediaMessage, sendTextMessage } from "lib/wuzapi";

const DISPATCH_INTERVAL_MS = Math.max(15_000, Number(process.env.AFFILIATE_ML_GROUP_DISPATCH_INTERVAL_MS ?? 45_000));
const DISPATCH_BATCH_SIZE = Math.max(1, Number(process.env.AFFILIATE_ML_GROUP_DISPATCH_BATCH ?? 12));
const TEMPLATE_CACHE_TTL_MS = 120_000;
const CATEGORY_HISTORY_LIMIT = 4;
const HISTORY_CAMPAIGN_ID = 0;
const HISTORY_CONTENT_ID = "affiliate_ml_group_dispatch";
const AFFILIATE_ML_PROVIDER_TITLE = "*_Mercado Livre_*";
const AFFILIATE_ML_DISPATCH_FOOTER = "Clique aqui para acessar 👇";
const AFFILIATE_ML_DISPATCH_BUTTON_LABEL = "Acessar oferta 🔥";
const DISPATCH_DELAY_RANDOM_MIN_FACTOR = 0.8;
const DISPATCH_DELAY_RANDOM_MAX_FACTOR = 1.45;
const DISPATCH_RECENT_USAGE_MIN_MS = 2 * 60_000;
const DISPATCH_RECENT_USAGE_MAX_MS = 35 * 60_000;
const DISPATCH_OLDEST_POOL_WINDOW_MS = 20 * 60_000;

type DispatchClient = {
  baseUrl: string;
  token: string;
};

type ResolvedProduct = {
  id: string | null;
  title: string;
  description: string;
  url: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  priceFormatted: string;
  oldPriceFormatted: string;
  installmentsFormatted: string;
  soldText: string;
  stockText: string;
  shippingText: string;
  conditionText: string;
  warrantyText: string;
  sellerText: string;
};

const templateCache = new Map<
  number,
  {
    expiresAt: number;
    promise: Promise<AffiliateMlMessageTemplateSummary>;
  }
>();

const runtime = globalThis as typeof globalThis & {
  __affiliateMlGroupDispatcherStarted?: boolean;
};

let dispatcherStarted = runtime.__affiliateMlGroupDispatcherStarted ?? false;
let dispatchCycleRunning = false;

const log = (message: string, extra?: Record<string, unknown>) => {
  console.log(`[AffiliateMlGroupDispatcher] ${message}`, extra ?? {});
};

const normalizeItemId = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  return normalized || null;
};

const normalizeCategoryId = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase().replace(/\s+/g, "");
  return normalized || null;
};

const normalizeTargetKey = (entry: AffiliateMlGroupDispatchWorkerEntry): string => {
  return `dispatch:${entry.id}:group:${entry.groupId}`;
};

const computeDeterministicDelayFactor = (
  entry: AffiliateMlGroupDispatchWorkerEntry,
  lastSentAtMs: number,
): number => {
  const seed = `${entry.id}:${entry.userId}:${entry.groupId}:${lastSentAtMs}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }
  const normalized = (hash % 1000) / 999;
  return (
    DISPATCH_DELAY_RANDOM_MIN_FACTOR +
    (DISPATCH_DELAY_RANDOM_MAX_FACTOR - DISPATCH_DELAY_RANDOM_MIN_FACTOR) * normalized
  );
};

const resolveConditionLabel = (value: string | null | undefined): string => {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "new") return "Novo";
  if (normalized === "used") return "Usado";
  return value.trim();
};

const getCachedMessageTemplate = async (userId: number): Promise<AffiliateMlMessageTemplateSummary> => {
  const now = Date.now();
  const current = templateCache.get(userId);
  if (current && current.expiresAt > now) {
    return current.promise;
  }

  const promise = getAffiliateMlMessageTemplateForUser(userId);
  templateCache.set(userId, {
    expiresAt: now + TEMPLATE_CACHE_TTL_MS,
    promise,
  });

  setTimeout(() => {
    const active = templateCache.get(userId);
    if (active && active.promise === promise) {
      templateCache.delete(userId);
    }
  }, TEMPLATE_CACHE_TTL_MS + 500);

  return promise;
};

const pickRandom = <T>(items: T[]): T | null => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? items[0] ?? null;
};

const parseTimestampMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const computeRecentUsageCooldownMs = (delayMinutes: number): number => {
  const safeDelayMinutes = Number.isFinite(delayMinutes) && delayMinutes > 0 ? delayMinutes : 1;
  const baseMs = safeDelayMinutes * 60_000;
  return Math.max(
    DISPATCH_RECENT_USAGE_MIN_MS,
    Math.min(DISPATCH_RECENT_USAGE_MAX_MS, Math.round(baseMs * 2.75)),
  );
};

const pickLeastRecentlyUsed = (
  links: AffiliateMlLinkSummary[],
  delayMinutes: number,
): AffiliateMlLinkSummary | null => {
  if (!Array.isArray(links) || links.length === 0) return null;
  const nowMs = Date.now();
  const cooldownMs = computeRecentUsageCooldownMs(delayMinutes);
  const withUsage = links.map((entry) => ({
    entry,
    usedAtMs: parseTimestampMs(entry.lastUsedAt),
  }));
  const cooledPool = withUsage.filter(({ usedAtMs }) => usedAtMs === null || nowMs - usedAtMs >= cooldownMs);
  const sourcePool = cooledPool.length > 0 ? cooledPool : withUsage;

  const neverUsedPool = sourcePool.filter(({ usedAtMs }) => usedAtMs === null).map(({ entry }) => entry);
  if (neverUsedPool.length > 0) {
    return pickRandom(neverUsedPool);
  }

  let oldestUsedAtMs = Number.POSITIVE_INFINITY;
  for (const candidate of sourcePool) {
    if (candidate.usedAtMs !== null) {
      oldestUsedAtMs = Math.min(oldestUsedAtMs, candidate.usedAtMs);
    }
  }
  if (!Number.isFinite(oldestUsedAtMs)) {
    return pickRandom(sourcePool.map(({ entry }) => entry));
  }

  const oldestPool = sourcePool
    .filter(({ usedAtMs }) => usedAtMs !== null && usedAtMs <= oldestUsedAtMs + DISPATCH_OLDEST_POOL_WINDOW_MS)
    .map(({ entry }) => entry);
  return pickRandom(oldestPool.length > 0 ? oldestPool : sourcePool.map(({ entry }) => entry));
};

const pickDispatchLink = (
  links: AffiliateMlLinkSummary[],
  options: {
    recentCategoryIds: string[];
    lastItemId: string | null;
    categoryRotationEnabled: boolean;
    delayMinutes: number;
  },
): AffiliateMlLinkSummary | null => {
  if (!Array.isArray(links) || links.length === 0) {
    return null;
  }

  const active = links.filter((entry) => entry.isActive !== false);
  if (active.length === 0) {
    return null;
  }
  const available = active.filter((entry) => entry.available !== false);
  const basePool = available.length > 0 ? available : active;

  let pool = basePool;

  if (options.categoryRotationEnabled && options.recentCategoryIds.length > 0) {
    const blocked = new Set(options.recentCategoryIds.map((entry) => normalizeCategoryId(entry)).filter(Boolean));
    const filtered = pool.filter((entry) => {
      const categoryId = normalizeCategoryId(entry.categoryId);
      if (!categoryId) return true;
      return !blocked.has(categoryId);
    });
    if (filtered.length > 0) {
      pool = filtered;
    }
  }

  if (options.lastItemId) {
    const filtered = pool.filter((entry) => normalizeItemId(entry.itemId) !== options.lastItemId);
    if (filtered.length > 0) {
      pool = filtered;
    }
  }

  return pickLeastRecentlyUsed(pool, options.delayMinutes) ?? pickRandom(pool);
};

const toResolvedProduct = (link: AffiliateMlLinkSummary, product: MercadoLivreProduct | null): ResolvedProduct => {
  const resolvedTitle =
    (product?.titulo && product.titulo.trim()) ||
    (link.title && link.title.trim()) ||
    `Oferta ${link.itemId}`;
  const description =
    (product?.descricaoCurta && product.descricaoCurta.trim()) ||
    "Confira os detalhes e aproveite enquanto durar.";
  const soldText =
    typeof product?.vendidos === "number" && Number.isFinite(product.vendidos) && product.vendidos > 0
      ? String(product.vendidos)
      : "";
  const stockText =
    typeof product?.estoque === "number" && Number.isFinite(product.estoque) && product.estoque >= 0
      ? String(product.estoque)
      : "";
  const shippingText =
    product?.freteGratis
      ? "Frete grátis"
      : (product?.freteTexto && product.freteTexto.trim()) || "";
  const sellerText =
    (product?.vendedor?.nickname && product.vendedor.nickname.trim()) ||
    (typeof product?.vendedor?.id === "number" ? `ID ${product.vendedor.id}` : "");

  return {
    id: normalizeItemId(product?.id ?? link.itemId),
    title: resolvedTitle,
    description,
    url: (product?.url && product.url.trim()) || link.productUrl || null,
    imageUrl: (product?.imagem && product.imagem.trim()) || link.imageUrl || null,
    categoryId: normalizeCategoryId(product?.categoriaId ?? link.categoryId),
    priceFormatted: (product?.precoFormatado && product.precoFormatado.trim()) || link.priceFormatted || "",
    oldPriceFormatted:
      product?.precoAntigoFormatado && product.precoAntigoFormatado !== product.precoFormatado
        ? product.precoAntigoFormatado
        : "",
    installmentsFormatted: (product?.precoParcelado && product.precoParcelado.trim()) || "",
    soldText,
    stockText,
    shippingText,
    conditionText: resolveConditionLabel(product?.condicao),
    warrantyText: (product?.garantia && product.garantia.trim()) || "",
    sellerText,
  };
};

const resolveProductDetails = async (
  userId: number,
  link: AffiliateMlLinkSummary,
): Promise<ResolvedProduct> => {
  const itemId = normalizeItemId(link.itemId);
  if (!itemId) {
    return toResolvedProduct(link, null);
  }

  try {
    const search = await searchMercadoLivre(itemId, {
      userId,
      limit: 1,
    });
    const firstProduct = Array.isArray(search.produtos) ? search.produtos[0] ?? null : null;
    return toResolvedProduct(link, firstProduct);
  } catch {
    return toResolvedProduct(link, null);
  }
};

const renderMessageBody = async (params: {
  userId: number;
  product: ResolvedProduct;
  couponCode: string;
  couponDetails: string;
  finalUrl: string;
  introText: string;
  queryText: string;
  includeDirectUrlInBody: boolean;
  templateItems?: AffiliateMlMessageTemplateSummary["items"] | null;
}): Promise<string> => {
  const fallbackLines: string[] = ["🛒 *_Mercado Livre_*", `📦 *${params.product.title}*`];

  if (params.introText.trim()) {
    fallbackLines.push("", params.introText.trim());
  }

  if (params.product.oldPriceFormatted && params.product.priceFormatted) {
    fallbackLines.push("", `💰 de ~${params.product.oldPriceFormatted}~ por *${params.product.priceFormatted}*`);
  } else if (params.product.priceFormatted) {
    fallbackLines.push("", `💰 *${params.product.priceFormatted}*`);
  }

  if (params.product.installmentsFormatted) {
    fallbackLines.push(`💳 ${params.product.installmentsFormatted}`);
  }
  if (params.product.soldText) {
    fallbackLines.push(`📈 Vendidos: ${params.product.soldText}`);
  }
  if (params.product.stockText) {
    fallbackLines.push(`📦 Estoque: ${params.product.stockText}`);
  }
  if (params.product.shippingText) {
    fallbackLines.push(`🚚 ${params.product.shippingText}`);
  }
  if (params.product.conditionText) {
    fallbackLines.push(`📌 Condição: ${params.product.conditionText}`);
  }
  if (params.product.warrantyText) {
    fallbackLines.push(`🛡️ ${params.product.warrantyText}`);
  }
  if (params.couponCode) {
    fallbackLines.push(`🏷️ Cupom: *${params.couponCode}*`);
  }
  if (params.couponDetails) {
    fallbackLines.push(`🧾 ${params.couponDetails}`);
  }
  const fallbackBody = fallbackLines.join("\n").trim();

  try {
    const templateItems =
      Array.isArray(params.templateItems) && params.templateItems.length > 0
        ? params.templateItems
        : (await getCachedMessageTemplate(params.userId)).items;
    const rendered = renderAffiliateMlMessageTemplate(templateItems, {
      intro_text: params.introText,
      query: params.queryText,
      titulo: params.product.title,
      descricao: params.product.description,
      preco_formatado: params.product.priceFormatted,
      preco_parcelado: params.product.installmentsFormatted,
      preco_antigo_formatado: params.product.oldPriceFormatted,
      vendidos: params.product.soldText,
      estoque: params.product.stockText,
      frete: params.product.shippingText,
      condicao: params.product.conditionText,
      garantia: params.product.warrantyText,
      vendedor: params.product.sellerText,
      cupom: params.couponCode,
      coupon: params.couponCode,
      cupom_detalhes: params.couponDetails,
      coupon_details: params.couponDetails,
      url: params.includeDirectUrlInBody ? params.finalUrl : "",
      item_id: params.product.id ?? "",
    }).trim();

    return rendered || fallbackBody;
  } catch {
    return fallbackBody;
  }
};

const sendDispatchMessage = async (params: {
  client: DispatchClient;
  groupJid: string;
  body: string;
  finalUrl: string;
  imageUrl: string | null;
  includeButtons: boolean;
  buttonLabel: string;
  footerText: string;
  providerTitle: string;
}): Promise<void> => {
  const normalizedFinalUrl = params.finalUrl.trim().toLowerCase();
  const bodyWithoutDirectUrl =
    params.body
      .split("\n")
      .map((entry) => entry.trimEnd())
      .filter((entry) => {
        const trimmed = entry.trim();
        if (!trimmed) return true;
        const withoutIcon = trimmed.replace(/^🔗\s*/u, "").trim().toLowerCase();
        return withoutIcon !== normalizedFinalUrl;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || params.body.trim();

  const bodyWithLink = bodyWithoutDirectUrl.toLowerCase().includes(normalizedFinalUrl)
    ? bodyWithoutDirectUrl
    : [bodyWithoutDirectUrl, "", `🔗 ${params.finalUrl}`].filter(Boolean).join("\n");
  const footerText = params.footerText.trim() || AFFILIATE_ML_DISPATCH_FOOTER;
  const buttonLabel = params.buttonLabel.trim() || AFFILIATE_ML_DISPATCH_BUTTON_LABEL;
  const providerTitle = params.providerTitle.trim() || AFFILIATE_ML_PROVIDER_TITLE;
  const fallbackBody = [bodyWithLink, "", footerText].filter(Boolean).join("\n").trim();

  if (params.includeButtons) {
    try {
      await sendInteractiveButtons(params.client, {
        to: params.groupJid,
        title: providerTitle,
        body: bodyWithoutDirectUrl,
        footer: footerText,
        buttonType: "native",
        headerMedia:
          params.imageUrl
            ? {
                type: "image",
                media: params.imageUrl,
                mimeType: "image/jpeg",
              }
            : null,
        buttons: [
          {
            id: "affiliate_ml_group_dispatch_open",
            text: buttonLabel,
            type: "cta_url",
            url: params.finalUrl,
          },
        ],
      });
      return;
    } catch {
      if (params.imageUrl) {
        try {
          await sendInteractiveButtons(params.client, {
            to: params.groupJid,
            title: providerTitle,
            body: bodyWithoutDirectUrl,
            footer: footerText,
            buttonType: "native",
            headerMedia: null,
            buttons: [
              {
                id: "affiliate_ml_group_dispatch_open",
                text: buttonLabel,
                type: "cta_url",
                url: params.finalUrl,
              },
            ],
          });
          return;
        } catch {
          // fallback para imagem/texto
        }
      }
    }
  }

  if (params.imageUrl) {
    try {
      await sendMediaMessage(params.client, {
        to: params.groupJid,
        media: params.imageUrl,
        mediaType: "image",
        mimeType: "image/jpeg",
        filename: "mercadolivre-oferta.jpg",
        caption: fallbackBody,
      });
      return;
    } catch {
      // fallback para texto
    }
  }

  await sendTextMessage(params.client, {
    to: params.groupJid,
    body: fallbackBody,
  });
};

const processDispatchEntry = async (
  entry: AffiliateMlGroupDispatchWorkerEntry,
  linksByUserCache: Map<number, Promise<AffiliateMlLinkSummary[]>>,
): Promise<void> => {
  const targetKey = normalizeTargetKey(entry);
  const history = await getAffiliateMlDispatchContextSnapshot({
    userId: entry.userId,
    campaignId: HISTORY_CAMPAIGN_ID,
    targetId: entry.id,
    targetKey,
    contentId: HISTORY_CONTENT_ID,
    recentCategoryLimit: CATEGORY_HISTORY_LIMIT,
  });

  if (history.lastSentAt) {
    const lastSentAtMs = new Date(history.lastSentAt).getTime();
    if (Number.isFinite(lastSentAtMs)) {
      const baseWaitMs = Math.max(1, entry.delayMinutes) * 60_000;
      const randomizedWaitMs = Math.max(
        60_000,
        Math.round(baseWaitMs * computeDeterministicDelayFactor(entry, lastSentAtMs)),
      );
      const elapsedMs = Date.now() - lastSentAtMs;
      if (elapsedMs < randomizedWaitMs) {
        return;
      }
    }
  }

  const group = await getGroupByIdForUser(entry.userId, entry.groupId);
  if (!group || !group.remoteId || group.status !== "active") {
    throw new Error("Grupo indisponível para envio automático.");
  }

  const instance = await getInstanceForUser(entry.userId, group.instanceId || entry.instanceId);
  if (!instance?.serverBaseUrl || !instance?.token) {
    throw new Error("Instância do grupo não está pronta para envio.");
  }

  const guard = await resolveBotAutomationGuard({
    userId: entry.userId,
    instanceId: instance.id,
    groupId: group.id,
  });
  if (guard.blocked) {
    return;
  }

  let nativeButtonsEnabled = false;
  try {
    const instanceSettings = await getInstanceSettings(instance.id);
    nativeButtonsEnabled = Boolean(instanceSettings.commandToggles.nativeButtons);
  } catch (error) {
    log("Falha ao carregar toggle de botões nativos da instância", {
      instanceId: instance.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let linksPromise = linksByUserCache.get(entry.userId);
  if (!linksPromise) {
    linksPromise = listAffiliateMlLinksForUser(entry.userId);
    linksByUserCache.set(entry.userId, linksPromise);
  }
  const links = await linksPromise;
  if (!Array.isArray(links) || links.length === 0) {
    throw new Error("Nenhum produto afiliado salvo para envio automático.");
  }

  const chosenLink = pickDispatchLink(links, {
    recentCategoryIds: history.recentCategoryIds,
    lastItemId: history.lastItemId,
    categoryRotationEnabled: entry.categoryRotationEnabled,
    delayMinutes: entry.delayMinutes,
  });
  if (!chosenLink?.affiliateUrl) {
    throw new Error("Nenhum produto válido disponível para envio.");
  }

  const product = await resolveProductDetails(entry.userId, chosenLink);
  const finalUrl = chosenLink.affiliateUrl;
  const introText = chosenLink.note?.trim() || "";
  const queryText = chosenLink.note?.trim() || "mercado livre";
  const template = await getCachedMessageTemplate(entry.userId).catch(() => null);
  const footerText = template?.footerText?.trim() || AFFILIATE_ML_DISPATCH_FOOTER;
  const buttonLabel = template?.buttonLabel?.trim() || AFFILIATE_ML_DISPATCH_BUTTON_LABEL;
  const providerTitle = template?.providerTitle?.trim() || AFFILIATE_ML_PROVIDER_TITLE;
  const body = await renderMessageBody({
    userId: entry.userId,
    product,
    couponCode: chosenLink.couponCode?.trim() || "",
    couponDetails: chosenLink.couponDetails?.trim() || "",
    finalUrl,
    introText,
    queryText,
    includeDirectUrlInBody: !nativeButtonsEnabled,
    templateItems: template?.items ?? null,
  });

  await sendDispatchMessage({
    client: {
      baseUrl: instance.serverBaseUrl,
      token: instance.token,
    },
    groupJid: group.remoteId,
    body,
    finalUrl,
    imageUrl: product.imageUrl,
    includeButtons: nativeButtonsEnabled,
    footerText,
    buttonLabel,
    providerTitle,
  });

  const itemId = normalizeItemId(product.id ?? chosenLink.itemId);
  const categoryId = normalizeCategoryId(product.categoryId ?? chosenLink.categoryId);
  const chosenLinkHadCategory = Boolean(chosenLink.categoryId);
  const usageTimestamp = new Date().toISOString();
  chosenLink.lastUsedAt = usageTimestamp;
  if (categoryId && !chosenLink.categoryId) {
    chosenLink.categoryId = categoryId;
  }
  if (itemId && normalizeItemId(chosenLink.itemId) !== itemId) {
    const normalizedEntry = links.find((entryLink) => normalizeItemId(entryLink.itemId) === itemId);
    if (normalizedEntry) {
      normalizedEntry.lastUsedAt = usageTimestamp;
      if (categoryId && !normalizedEntry.categoryId) {
        normalizedEntry.categoryId = categoryId;
      }
    }
  }

  if (itemId && categoryId && !chosenLinkHadCategory) {
    await updateAffiliateMlLinkCategoryForUser(entry.userId, itemId, categoryId).catch(() => {
      // sem impacto no envio principal
    });
  }

  await recordAffiliateMlDispatchForContext({
    userId: entry.userId,
    campaignId: HISTORY_CAMPAIGN_ID,
    targetId: entry.id,
    targetKey,
    contentId: HISTORY_CONTENT_ID,
    query: queryText,
    itemId,
    categoryId,
    affiliateUrl: finalUrl,
    productUrl: product.url,
  });

  if (itemId) {
    await markAffiliateMlLinkUsage(entry.userId, itemId).catch(() => {
      // sem impacto no envio principal
    });
  }

  await markAffiliateMlGroupDispatchSuccess({
    userId: entry.userId,
    dispatchId: entry.id,
    groupRemoteId: group.remoteId,
    instanceId: instance.id,
    itemId,
  });
};

const runDispatchCycle = async (): Promise<void> => {
  if (dispatchCycleRunning) {
    return;
  }
  dispatchCycleRunning = true;

  try {
    const entries = await listEnabledAffiliateMlGroupDispatchesForRun(DISPATCH_BATCH_SIZE);
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    const linksByUserCache = new Map<number, Promise<AffiliateMlLinkSummary[]>>();
    for (const entry of entries) {
      try {
        await processDispatchEntry(entry, linksByUserCache);
      } catch (error) {
        await markAffiliateMlGroupDispatchError({
          userId: entry.userId,
          dispatchId: entry.id,
          error,
        }).catch(() => {
          // ignorado para não travar o ciclo
        });
        log("Falha no disparo automático", {
          dispatchId: entry.id,
          userId: entry.userId,
          groupId: entry.groupId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    dispatchCycleRunning = false;
  }
};

export const startAffiliateMlGroupDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  runtime.__affiliateMlGroupDispatcherStarted = true;

  void runDispatchCycle();

  const timer = setInterval(() => {
    void runDispatchCycle();
  }, DISPATCH_INTERVAL_MS);

  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }

  log("Dispatcher de afiliado ML por grupo iniciado", {
    intervalMs: DISPATCH_INTERVAL_MS,
    batch: DISPATCH_BATCH_SIZE,
  });
};
