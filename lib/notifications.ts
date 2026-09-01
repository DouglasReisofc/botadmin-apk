import type { PaymentCharge } from "types/payments";
import type { UserNotification } from "types/notifications";
import type { RowDataPacket } from "mysql2";

import { sendEmail, EmailNotConfiguredError, EmailDeliveryError } from "./email";
import { getAdminEmailTemplate } from "./admin-email-templates";
import { renderEmailTemplate } from "./email-template";
import { createUserNotification } from "./user-notifications";
import { emitUserNotificationCreated } from "./realtime";
import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  ANDROID_NOTIFICATION_SOUND,
  type AndroidPushOptions,
  sendPushNotificationToUser,
} from "./push-notifications";
import { getAdminBotConfig } from "./admin-bot-config";
import {
  DEFAULT_USER_NOTIFICATION_AUDIO_SETTINGS,
  getUserNotificationAudioSettings,
} from "./notification-audio-settings";
import { buildTtsUrlForText, sanitizeSpeechVoice } from "./notification-audio";
import {
  DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  DEFAULT_NOTIFICATION_BOT_NAME,
  DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
} from "data/notification-audio";
import { ensureUserTable, getDb } from "./db";
import { getSessionUserById } from "./users";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const formatCurrency = (amount: number) => currencyFormatter.format(amount);

const ensureBotName = (botName: string | undefined | null) =>
  botName?.trim().length ? botName.trim() : DEFAULT_NOTIFICATION_BOT_NAME;

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const toAmountLabel = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatCurrency(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const normalizeTemplate = (value: string | undefined | null, fallback: string) => {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const renderTemplate = (template: string, context: Record<string, string>): string =>
  template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key) => {
    const replacement = context[key];
    return typeof replacement === "string" && replacement.length > 0 ? replacement : "";
  });

type AdminNotificationTarget = {
  id: number;
  name: string | null;
  email: string | null;
};

const ADMIN_RECIPIENT_CACHE_TTL_MS = 60_000;
let adminRecipientCache:
  | { expiresAt: number; targets: AdminNotificationTarget[] }
  | null = null;

const USER_ROLE_CACHE_TTL_MS = 60_000;
const userRoleCache = new Map<number, { role: "admin" | "user"; expiresAt: number }>();

const getCachedUserRole = async (userId: number): Promise<"admin" | "user" | null> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  const cached = userRoleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.role;
  }

  try {
    const user = await getSessionUserById(userId);
    if (!user) {
      userRoleCache.delete(userId);
      return null;
    }
    const entry = { role: user.role, expiresAt: Date.now() + USER_ROLE_CACHE_TTL_MS };
    userRoleCache.set(userId, entry);
    return entry.role;
  } catch (error) {
    console.error("[notifications] Falha ao obter role do usuário para push", {
      userId,
      error,
    });
    return null;
  }
};

const getActiveAdminNotificationTargets = async (): Promise<AdminNotificationTarget[]> => {
  if (adminRecipientCache && adminRecipientCache.expiresAt > Date.now()) {
    return adminRecipientCache.targets;
  }

  try {
    await ensureUserTable();
    const db = getDb();
    const [rows] = await db.query<
      (RowDataPacket & { id: number; name: string | null; email: string | null })[]
    >(
      `
        SELECT id, name, email
        FROM users
        WHERE role = 'admin' AND is_active = 1
      `,
    );

    const targets = Array.isArray(rows)
      ? rows
          .map((row) => ({
            id: Number(row.id),
            name: row.name ?? null,
            email: row.email ?? null,
          }))
          .filter((target) => Number.isFinite(target.id) && target.id > 0)
      : [];

    adminRecipientCache = {
      targets,
      expiresAt: Date.now() + ADMIN_RECIPIENT_CACHE_TTL_MS,
    };

    return targets;
  } catch (error) {
    console.error("[notifications] Falha ao listar administradores para notificações", error);
    adminRecipientCache = null;
    return [];
  }
};

const dispatchAdminNotification = async (options: {
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  route?: string;
}) => {
  const targets = await getActiveAdminNotificationTargets();
  if (targets.length === 0) {
    return;
  }

  let baseMetadata: Record<string, unknown> | null = options.metadata
    ? { ...options.metadata }
    : null;
  const route = typeof options.route === "string" ? options.route.trim() : "";
  if (route) {
    if (baseMetadata) {
      if (!("route" in baseMetadata)) {
        baseMetadata.route = route;
      }
    } else {
      baseMetadata = { route };
    }
  }

  await Promise.all(
    targets.map(async (admin) => {
      try {
        const notification = await createUserNotification({
          userId: admin.id,
          type: options.type,
          title: options.title,
          message: options.message,
          metadata: baseMetadata,
        });
        emitRealtimeNotification(notification);
      } catch (error) {
        console.error("[notifications] Falha ao criar notificação para admin", {
          adminId: admin.id,
          error,
        });
      }
    }),
  );
};

const resolveBuyerLabel = (payload: {
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerUserId?: number | null;
}) => {
  if (typeof payload.buyerName === "string" && payload.buyerName.trim()) {
    return payload.buyerName.trim();
  }
  if (typeof payload.buyerEmail === "string" && payload.buyerEmail.trim()) {
    return payload.buyerEmail.trim();
  }
  if (typeof payload.buyerUserId === "number" && Number.isFinite(payload.buyerUserId)) {
    return `Usuário #${payload.buyerUserId}`;
  }
  return "Cliente";
};

export const notifyAdminsOfPlanPayment = async (payload: {
  planName: string;
  amount: number;
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerUserId?: number | null;
  paymentReference?: string | null;
}) => {
  const amountLabel = formatCurrency(payload.amount);
  const buyerLabel = resolveBuyerLabel(payload);

  await dispatchAdminNotification({
    type: "admin_plan_payment",
    title: `Assinatura confirmada - ${payload.planName}`,
    message: `${buyerLabel} confirmou o pagamento de ${amountLabel}.`,
    metadata: {
      planName: payload.planName,
      amount: payload.amount,
      amountLabel,
      buyerName: payload.buyerName ?? null,
      buyerEmail: payload.buyerEmail ?? null,
      buyerUserId: payload.buyerUserId ?? null,
      paymentReference: payload.paymentReference ?? null,
    },
    route: "/dashboard/admin/users",
  });
};

export const notifyAdminsOfPlanAddon = async (payload: {
  planName: string;
  amount: number;
  addonSummary: string;
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerUserId?: number | null;
  paymentReference?: string | null;
}) => {
  const amountLabel = formatCurrency(payload.amount);
  const buyerLabel = resolveBuyerLabel(payload);
  const summary = payload.addonSummary.trim() || "add-ons";

  await dispatchAdminNotification({
    type: "admin_plan_addon",
    title: `Add-ons confirmados - ${payload.planName}`,
    message: `${buyerLabel} ativou ${summary} (${amountLabel}).`,
    metadata: {
      planName: payload.planName,
      amount: payload.amount,
      amountLabel,
      addonSummary: summary,
      buyerName: payload.buyerName ?? null,
      buyerEmail: payload.buyerEmail ?? null,
      buyerUserId: payload.buyerUserId ?? null,
      paymentReference: payload.paymentReference ?? null,
    },
    route: "/dashboard/admin/users",
  });
};

export const notifyAdminsOfApiRequestPurchase = async (payload: {
  amount: number;
  requestAmount: number;
  planName?: string | null;
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerUserId?: number | null;
  paymentReference?: string | null;
}) => {
  const amountLabel = formatCurrency(payload.amount);
  const buyerLabel = resolveBuyerLabel(payload);
  const requests =
    Number.isFinite(payload.requestAmount) && payload.requestAmount > 0
      ? Math.floor(payload.requestAmount)
      : 0;
  const requestLabel = requests > 0 ? requests.toLocaleString("pt-BR") : null;
  const packageLabel =
    (payload.planName && payload.planName.trim()) || (requestLabel ? `${requestLabel} requisições` : "Pacote de API");

  await dispatchAdminNotification({
    type: "admin_api_request_package",
    title: `${packageLabel} confirmado`,
    message: `${buyerLabel} confirmou o pagamento de ${amountLabel}.`,
    metadata: {
      planName: payload.planName ?? null,
      packageLabel,
      amount: payload.amount,
      amountLabel,
      requestAmount: requests,
      requestLabel,
      buyerName: payload.buyerName ?? null,
      buyerEmail: payload.buyerEmail ?? null,
      buyerUserId: payload.buyerUserId ?? null,
      paymentReference: payload.paymentReference ?? null,
    },
    route: "/dashboard/admin/users",
  });
};

const buildNotificationSpeakText = (
  notification: UserNotification,
  options: {
    botName: string;
    purchaseTemplate: string;
    balanceTemplate: string;
  },
): string | undefined => {
  const metadata = (notification.metadata ?? {}) as Record<string, unknown>;
  const botName = ensureBotName(options.botName);
  const purchaseTemplate = normalizeTemplate(
    options.purchaseTemplate,
    DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  );
  const balanceTemplate = normalizeTemplate(
    options.balanceTemplate,
    DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  );

  const customerLabel =
    toTrimmedString(metadata.customerName)
    || toTrimmedString(metadata.customer)
    || toTrimmedString(metadata.customerWhatsapp)
    || "Cliente";

  const isPlanOrApiNotification =
    notification.type === "plan_payment"
    || notification.type === "api_request_package"
    || notification.type === "admin_api_request_package";

  if (notification.type === "bot_purchase" || isPlanOrApiNotification) {
    const category =
      toTrimmedString(metadata.categoryName)
      || toTrimmedString(metadata.category)
      || toTrimmedString(metadata.planName)
      || toTrimmedString(metadata.packageLabel)
      || (notification.type === "plan_payment" ? "plano" : "");
    const amountLabel = toAmountLabel(metadata.amount);
    const requestLabel = toTrimmedString(metadata.requestLabel)
      || (Number.isFinite(metadata.requestAmount as number)
        ? Number(metadata.requestAmount).toLocaleString("pt-BR")
        : "");
    const context = {
      bot_name: botName,
      category_name: category || "produto",
      customer_name: customerLabel,
      amount: amountLabel ?? "",
      requests: requestLabel ?? "",
    } satisfies Record<string, string>;

    const rendered = renderTemplate(purchaseTemplate, context).replace(/\s+/g, " ").trim();

    if (rendered) {
      return rendered;
    }

    return `${customerLabel} realizou uma compra no bot ${botName}`.trim();
  }

  if (notification.type === "customer_balance_credit") {
    const amountLabel = toAmountLabel(metadata.amount) ?? toAmountLabel(metadata.creditAmount);
    const balanceLabel = toAmountLabel(metadata.customerBalance);
    const context = {
      bot_name: botName,
      customer_name: customerLabel,
      amount: amountLabel ?? "saldo",
      balance: balanceLabel ?? "",
    } satisfies Record<string, string>;

    const rendered = renderTemplate(balanceTemplate, context).replace(/\s+/g, " ").trim();

    if (rendered) {
      return rendered;
    }

    return amountLabel
      ? `${customerLabel} adicionou ${amountLabel} no bot ${botName}`.trim()
      : `${customerLabel} adicionou saldo no bot ${botName}`.trim();
  }

  if (notification.type === "balance_topup") {
    const amountLabel = toAmountLabel(metadata.amount);
    const balanceLabel = toAmountLabel(metadata.balance);
    const parts = ["Saldo adicionado", `no painel ${botName}`];
    if (amountLabel) {
      parts.push(`no valor de ${amountLabel}`);
    }
    if (balanceLabel) {
      parts.push(`Saldo disponível ${balanceLabel}`);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  if (notification.type === "bot_sale") {
    const amountLabel = toAmountLabel(metadata.amount);
    const method = toTrimmedString(metadata.paymentMethod);
    const parts = ["Venda confirmada", `no bot ${botName}`];
    if (amountLabel) {
      parts.push(`valor ${amountLabel}`);
    }
    if (method) {
      parts.push(`via ${method}`);
    }
    const customer = toTrimmedString(metadata.customer);
    if (customer) {
      parts.push(`para ${customer}`);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  const fallback = notification.message?.trim() || notification.title?.trim();
  return fallback && fallback.length > 0 ? fallback : undefined;
};

const resolveNotificationSound = (notification: UserNotification): string => {
  if (notification.type === "bot_purchase" || notification.type === "plan_payment") {
    return "purchase_notification";
  }

  if (notification.type === "api_request_package" || notification.type === "admin_api_request_package") {
    return "purchase_notification";
  }

  if (notification.type === "customer_balance_credit") {
    return "coin";
  }

  return ANDROID_NOTIFICATION_SOUND;
};

const NOTIFICATION_SOUND_ASSET_MAP: Record<string, string[]> = {
  purchase_notification: [
    "/sounds/nfcpayments_core_dark_sound_nfc.mp3",
    "/sounds/purchase-notification.mp3",
    "/sounds/coin.mp3",
  ],
  coin: [
    "/sounds/visa_sound.mp3",
    "/sounds/general-notification.mp3",
    "/sounds/coin.mp3",
  ],
  [ANDROID_NOTIFICATION_SOUND]: [
    "/sounds/general-notification.mp3",
    "/sounds/notificacao.mp3",
    "/sounds/coin.mp3",
  ],
};

const buildTtsProxyUrl = (text: string, voice: string): string | undefined => {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return undefined;
  }

  try {
    const baseUrl = getAppBaseUrl();
    const url = new URL("/api/tts-proxy", `${baseUrl}/`);
    url.searchParams.set("texto", normalizedText);
    if (voice.trim()) {
      url.searchParams.set("voz", voice.trim());
    }
    return url.toString();
  } catch (error) {
    console.error("[notifications] Falha ao montar URL do proxy de TTS", error);
    return undefined;
  }
};

const buildNotificationSoundUrl = (sound: string | null | undefined): string | undefined => {
  if (!sound) {
    return undefined;
  }

  const normalized = sound.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const candidates = [
    ...(NOTIFICATION_SOUND_ASSET_MAP[normalized] ?? []),
  ];

  const hyphenated = normalized.replace(/_/g, "-");
  const dashedCandidate = `/sounds/${hyphenated}.mp3`;
  const underscoredCandidate = `/sounds/${normalized}.mp3`;

  if (!candidates.includes(underscoredCandidate)) {
    candidates.push(underscoredCandidate);
  }
  if (hyphenated !== normalized && !candidates.includes(dashedCandidate)) {
    candidates.push(dashedCandidate);
  }

  const baseUrl = getAppBaseUrl();

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }

    const relative = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return `${baseUrl}${relative}`;
  }

  return undefined;
};

const normalizeBaseUrl = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const hasScheme = /^https?:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    const normalized = url.toString().replace(/\/+$/, "");
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return undefined;
  }
};

const getAppBaseUrl = () => {
  const candidates = [
    normalizeBaseUrl(process.env.NOTIFICATIONS_APP_URL),
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL),
    normalizeBaseUrl(process.env.APP_URL),
    normalizeBaseUrl(process.env.VERCEL_URL),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return "https://botadmin.shop";
};

const replacePlaceholders = (template: string, context: Record<string, string>): string =>
  template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key) => {
    const value = context[key];
    return typeof value === "string" ? value : match;
  });

const buildEmailFromTemplate = async (
  key: string,
  fallback: {
    subject: string;
    heading: string;
    bodyHtml: string;
    ctaLabel?: string | null;
    ctaUrl?: string | null;
    footerText?: string | null;
  },
  context: Record<string, string>,
) => {
  const storedTemplate = await getAdminEmailTemplate(key);
  const template = storedTemplate ?? {
    key,
    name: key,
    subject: fallback.subject,
    heading: fallback.heading,
    bodyHtml: fallback.bodyHtml,
    ctaLabel: fallback.ctaLabel ?? null,
    ctaUrl: fallback.ctaUrl ?? null,
    footerText: fallback.footerText ?? null,
    updatedAt: new Date().toISOString(),
  };

  const subject = replacePlaceholders(template.subject, context);
  const heading = replacePlaceholders(template.heading, context);
  const bodyHtml = replacePlaceholders(template.bodyHtml, context);
  const ctaLabel = template.ctaLabel ? replacePlaceholders(template.ctaLabel, context) : null;
  const ctaUrl = template.ctaUrl ? replacePlaceholders(template.ctaUrl, context) : null;
  const footerText = template.footerText ? replacePlaceholders(template.footerText, context) : null;

  const html = renderEmailTemplate({
    heading,
    bodyHtml,
    ctaLabel,
    ctaUrl,
    footerText,
  });

  return {
    subject,
    html,
  };
};

const emitRealtimeNotification = (notification: UserNotification) => {
  emitUserNotificationCreated({
    userId: notification.userId,
    notification: {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      metadata: notification.metadata ?? null,
    },
  });

  void (async () => {
    try {
      if (notification.type.startsWith("admin_")) {
        const role = await getCachedUserRole(notification.userId);
        if (role !== "admin") {
          return;
        }
      }

      const [config, audioSettings] = await Promise.all([
        getAdminBotConfig().catch((error) => {
          console.error("[notifications] Falha ao carregar bot config para push", error);
          return null;
        }),
        getUserNotificationAudioSettings(notification.userId).catch((error) => {
          console.error(
            "[notifications] Falha ao carregar preferências de áudio do usuário",
            error,
          );
          return null;
        }),
      ]);

      const botName = ensureBotName(config?.botName ?? null);
      const speakText = buildNotificationSpeakText(notification, {
        botName,
        purchaseTemplate: config?.purchaseVoiceTemplate,
        balanceTemplate: config?.balanceVoiceTemplate,
      });

      const resolvedAudioSettings = audioSettings ?? DEFAULT_USER_NOTIFICATION_AUDIO_SETTINGS;

      const androidOptions: AndroidPushOptions = {
        sound: resolvedAudioSettings.soundsEnabled
          ? resolveNotificationSound(notification)
          : null,
      };

      if (androidOptions.sound) {
        const normalizedSound = androidOptions.sound.trim();
        androidOptions.soundUrl = buildNotificationSoundUrl(androidOptions.sound);
        if (normalizedSound && normalizedSound !== ANDROID_NOTIFICATION_SOUND) {
          androidOptions.channelId = `${ANDROID_NOTIFICATION_CHANNEL_ID}.${normalizedSound}`;
        } else {
          androidOptions.channelId = ANDROID_NOTIFICATION_CHANNEL_ID;
        }
      } else {
        androidOptions.channelId = ANDROID_NOTIFICATION_CHANNEL_ID;
        androidOptions.soundUrl = undefined;
      }

      if (resolvedAudioSettings.ttsEnabled && speakText) {
        const speechVoice = sanitizeSpeechVoice(resolvedAudioSettings.speechVoice);
        const speakUrl =
          buildTtsUrlForText(speakText, speechVoice) || buildTtsProxyUrl(speakText, speechVoice);

        androidOptions.speakText = speakText;
        androidOptions.speechMode = "api";
        androidOptions.speechVoice = speechVoice;
        androidOptions.speakUrl = speakUrl;
      }

      // Enviar imagem da categoria apenas para Android em compras
      if (notification.type === "bot_purchase") {
        try {
          const meta = (notification.metadata ?? {}) as Record<string, unknown>;
          const catNameRaw = typeof meta.categoryName === "string" ? meta.categoryName.trim() : "";
          if (catNameRaw) {
            const { getCategoriesForUser } = await import("./catalog");
            const { resolveUploadedFileUrl } = await import("./uploads");
            const { getAppBaseUrl } = await import("./meta");
            const list = await getCategoriesForUser(notification.userId).catch(() => []);
            const found = list.find((c) => (c.name || "").trim().toLowerCase() === catNameRaw.toLowerCase());
            if (found?.imagePath) {
              const relative = resolveUploadedFileUrl(found.imagePath);
              const absolute = `${getAppBaseUrl()}${relative.startsWith("/") ? "" : "/"}${relative}`;
              androidOptions.imageUrl = absolute;
            }
          }
        } catch (e) {
          console.warn("[notifications] Falha ao resolver imagem da categoria para push", e);
        }
      }

      // Sugerir uma rota de destino por tipo
  let targetUrl = "/dashboard/user";
  switch (notification.type) {
    case "bot_purchase":
      targetUrl = "/dashboard/user/compras";
      break;
    case "plan_payment":
      targetUrl = "/dashboard/user/grupos";
      break;
    case "api_request_package":
      targetUrl = "/dashboard/user/apirest";
      break;
    case "admin_plan_payment":
    case "admin_plan_addon":
      targetUrl = "/dashboard/admin/users";
      break;
    case "admin_api_request_package":
      targetUrl = "/dashboard/admin/users";
      break;
        case "bot_sale":
          targetUrl = "/dashboard/user/pagamentos/historico";
          break;
        case "customer_balance_credit":
          targetUrl = "/dashboard/user/clientes";
          break;
        case "support_opened":
          targetUrl = "/dashboard/user/conversas";
          break;
      }

      await sendPushNotificationToUser(notification.userId, {
        title: notification.title,
        body: notification.message,
        data: {
          notificationId: String(notification.id),
          type: notification.type,
          targetUrl,
        },
        android: androidOptions,
      });
    } catch (error) {
      console.error("[notifications] Falha ao disparar push", error);
    }
  })();
};

export const buildGenericNotificationEmail = async ({
  subject,
  message,
  userName,
}: {
  subject: string;
  message: string;
  userName: string;
}) =>
  buildEmailFromTemplate(
    "generic_notification",
    {
      subject: "{{subject}}",
      heading: "Olá!",
      bodyHtml: "<p>Olá, <strong>{{userName}}</strong>!</p><p>{{message}}</p>",
      footerText: "Equipe StoreBot",
    },
    {
      subject,
      message,
      userName,
    },
  );

export const sendWelcomeEmail = async (payload: {
  userId: number;
  userName: string;
  userEmail: string;
}) => {
  if (!payload.userEmail) {
    return;
  }

  const subject = "Bem-vindo ao StoreBot";
  const plainMessage = `Olá, ${payload.userName || "bem-vindo"}!\n\nSua conta no StoreBot foi criada com sucesso. Acesse o painel para configurar categorias, produtos e habilitar os pagamentos.`;

  try {
    const { subject: finalSubject, html } = await buildEmailFromTemplate(
      "welcome_user",
      {
        subject: "{{subject}}",
        heading: "Bem-vindo ao StoreBot!",
        bodyHtml:
          `<p>Olá, <strong>{{userName}}</strong>! 👋</p>
           <p>Sua conta foi criada com sucesso. Acesse o painel para configurar categorias, produtos e habilitar os pagamentos.</p>
           <p>Se precisar de ajuda, conte com a nossa equipe.</p>`,
        ctaLabel: "Ir para o painel",
        ctaUrl: "{{dashboardUrl}}",
        footerText: "Equipe StoreBot",
      },
      {
        subject,
        userName: payload.userName,
        dashboardUrl: `${getAppBaseUrl()}/dashboard/user`,
      },
    );

    await sendEmail({
      to: payload.userEmail,
      subject: finalSubject,
      text: plainMessage,
      html,
    });

    await createUserNotification({
      userId: payload.userId,
      type: "welcome",
      title: subject,
      message: plainMessage,
    });
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      console.warn("[notifications] SMTP não configurado. E-mail de boas-vindas não enviado.");
      return;
    }

    if (error instanceof EmailDeliveryError) {
      console.error("[notifications] Falha ao enviar e-mail de boas-vindas", error);
      return;
    }

    console.error("[notifications] Erro inesperado ao enviar e-mail de boas-vindas", error);
  }
};

export const sendBalanceTopUpNotification = async (payload: {
  userId: number;
  userName: string;
  userEmail: string;
  amount: number;
  newBalance: number;
}) => {
  if (!payload.userEmail) {
    return;
  }

  const subject = `Saldo adicionado - ${formatCurrency(payload.amount)}`;
  const message = `Recebemos a confirmação da adição de saldo no valor de ${formatCurrency(payload.amount)}. Seu novo saldo é ${formatCurrency(payload.newBalance)}.`;

  try {
    const { subject: finalSubject, html } = await buildGenericNotificationEmail({
      subject,
      message,
      userName: payload.userName,
    });

    await sendEmail({
      to: payload.userEmail,
      subject: finalSubject,
      text: message,
      html,
    });

    const notification = await createUserNotification({
      userId: payload.userId,
      type: "balance_topup",
      title: subject,
      message,
      metadata: {
        amount: payload.amount,
        balance: payload.newBalance,
      },
    });

    emitRealtimeNotification(notification);
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      console.warn("[notifications] SMTP não configurado. Notificação de saldo não enviada.");
      return;
    }

    if (error instanceof EmailDeliveryError) {
      console.error("[notifications] Falha ao enviar notificação de saldo", error);
      return;
    }

    console.error("[notifications] Erro inesperado ao enviar e-mail de saldo", error);
  }
};

export const sendCustomerBalanceCreditNotification = async (payload: {
  userId: number;
  userName: string;
  userEmail: string | null;
  amount: number;
  customerName: string | null;
  customerWhatsapp: string | null;
  newCustomerBalance: number;
}) => {
  const customerLabel = payload.customerName?.trim()
    || payload.customerWhatsapp?.trim()
    || "Cliente do bot";

  const subject = `Cliente adicionou saldo - ${formatCurrency(payload.amount)}`;
  const messageLines = [
    `O cliente ${customerLabel} adicionou saldo de ${formatCurrency(payload.amount)}.`,
    `Saldo atual do cliente: ${formatCurrency(payload.newCustomerBalance)}.`,
  ];

  try {
    if (payload.userEmail) {
      const { subject: finalSubject, html } = await buildEmailFromTemplate(
        "customer_balance_credit",
        {
          subject: `{{subject}}`,
          heading: "Novo crédito realizado",
          bodyHtml:
            `<p>Olá, <strong>{{userName}}</strong>! Um cliente acabou de adicionar saldo.</p>
             <p><strong>{{customer}}</strong> creditou <strong>{{amount}}</strong> na carteira.</p>
             <p>Saldo atual do cliente: <strong>{{customerBalance}}</strong>.</p>`,
          ctaLabel: "Gerenciar clientes",
          ctaUrl: "{{customersUrl}}",
          footerText: "Notificação automática do StoreBot",
        },
        {
          subject,
          userName: payload.userName,
          customer: customerLabel,
          amount: formatCurrency(payload.amount),
          customerBalance: formatCurrency(payload.newCustomerBalance),
          customersUrl: `${getAppBaseUrl()}/dashboard/user/clientes`,
        },
      );

      await sendEmail({
        to: payload.userEmail,
        subject: finalSubject,
        text: messageLines.join("\n"),
        html,
      });
    }

    const notification = await createUserNotification({
      userId: payload.userId,
      type: "customer_balance_credit",
      title: subject,
      message: messageLines.join(" "),
      metadata: {
        amount: payload.amount,
        customerName: payload.customerName,
        customerWhatsapp: payload.customerWhatsapp,
        customerBalance: payload.newCustomerBalance,
      },
    });

    emitRealtimeNotification(notification);
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      console.warn("[notifications] SMTP não configurado. Notificação de crédito ignorada.");
      return;
    }

    if (error instanceof EmailDeliveryError) {
      console.error("[notifications] Falha ao enviar notificação de crédito", error);
      return;
    }

    console.error("[notifications] Erro inesperado ao notificar crédito", error);
  }
};

export const sendUserSaleNotification = async (payload: {
  userName: string;
  userEmail: string;
  charge: PaymentCharge;
}) => {
  if (!payload.userEmail) {
    return;
  }

  const amountLabel = formatCurrency(payload.charge.amount);
  const methodLabel = payload.charge.provider === "mercadopago_checkout"
    ? "Mercado Pago Checkout"
    : payload.charge.provider === "mercadopago_pix"
      ? "Mercado Pago Pix"
      : payload.charge.provider;

  const customerInfo = payload.charge.customerName || payload.charge.customerWhatsapp;
  const appUrl = `${getAppBaseUrl()}/dashboard/user/pagamentos`;
  try {
    const context = {
      userName: payload.userName || "",
      amount: amountLabel,
      paymentMethod: methodLabel,
      customer: customerInfo ?? "Cliente não identificado",
      salesUrl: appUrl,
    } satisfies Record<string, string>;

    const { subject, html } = await buildEmailFromTemplate(
      "bot_sale_notification",
      {
        subject: `Nova venda recebida - ${amountLabel}`,
        heading: "Venda aprovada!",
        bodyHtml:
          `<p>Olá, <strong>{{userName}}</strong>! Uma nova venda foi confirmada no seu bot pelo valor de <strong>{{amount}}</strong>.</p><p>Forma de pagamento: <strong>{{paymentMethod}}</strong>.</p><p>Cliente: {{customer}}</p>`,
        ctaLabel: "Ver detalhes",
        ctaUrl: "{{salesUrl}}",
        footerText: "Continue oferecendo a melhor experiência para os seus clientes.",
      },
      context,
    );

    const textLines = [
      `Olá, ${context.userName || "vendedor"}!`,
      `Uma nova venda foi confirmada no seu bot pelo valor de ${context.amount}.`,
      `Forma de pagamento: ${context.paymentMethod}.`,
      `Cliente: ${context.customer}.`,
      `Veja detalhes: ${context.salesUrl}`,
    ];

    await sendEmail({
      to: payload.userEmail,
      subject,
      text: textLines.join("\n"),
      html,
    });

    const notification = await createUserNotification({
      userId: payload.charge.userId,
      type: "bot_sale",
      title: subject,
      message: `${context.amount} - ${context.paymentMethod}`,
      metadata: {
        paymentId: payload.charge.providerPaymentId,
        amount: payload.charge.amount,
        paymentMethod: context.paymentMethod,
        customer: context.customer,
      },
    });

    emitRealtimeNotification(notification);
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      console.warn("[notifications] SMTP não configurado. Notificação não enviada.");
      return;
    }

    if (error instanceof EmailDeliveryError) {
      console.error("[notifications] Falha ao enviar notificação de venda", error);
      return;
    }

    console.error("[notifications] Erro inesperado ao enviar e-mail", error);
  }
};

export const sendBotProductPurchaseNotification = async (payload: {
  userId: number;
  userName: string;
  userEmail: string | null;
  categoryName: string;
  amount: number;
  customerName?: string | null;
  customerWhatsapp?: string | null;
  customerBalanceAfter?: number | null;
  productDetails?: string | null;
}) => {
  const amountLabel = formatCurrency(payload.amount);
  const customerLabel = payload.customerName?.trim()
    || payload.customerWhatsapp?.trim()
    || "Cliente do bot";
  const subject = `Nova compra no bot - ${payload.categoryName}`;

  try {
    if (payload.userEmail) {
      const { subject: finalSubject, html } = await buildEmailFromTemplate(
        "bot_product_purchase",
        {
          subject: `{{subject}}`,
          heading: "Compra concluída!",
          bodyHtml:
            `<p>Olá, <strong>{{userName}}</strong>! Uma nova compra foi registrada no bot.</p>
             <p>Categoria: <strong>{{categoryName}}</strong></p>
             <p>Cliente: <strong>{{customer}}</strong></p>
             <p>Valor debitado: <strong>{{amount}}</strong></p>
             {{productDetails}}
             {{customerBalance}}`,
          ctaLabel: "Ver histórico de compras",
          ctaUrl: "{{purchasesUrl}}",
          footerText: "Notificação automática do StoreBot",
        },
        {
          subject,
          userName: payload.userName,
          categoryName: payload.categoryName,
          customer: customerLabel,
          amount: amountLabel,
          productDetails: payload.productDetails
            ? `<p>Detalhes do produto:<br /><strong>${payload.productDetails}</strong></p>`
            : "",
          customerBalance: typeof payload.customerBalanceAfter === "number"
            ? `<p>Saldo restante do cliente: <strong>${formatCurrency(payload.customerBalanceAfter)}</strong></p>`
            : "",
          purchasesUrl: `${getAppBaseUrl()}/dashboard/user/compras`,
        },
      );

      const textParts = [
        `Olá, ${payload.userName || "administrador"}!`,
        `Cliente: ${customerLabel}.`,
        `Categoria: ${payload.categoryName}.`,
        `Valor debitado: ${amountLabel}.`,
      ];

      if (payload.productDetails) {
        textParts.push(`Detalhes do produto: ${payload.productDetails}`);
      }

      if (typeof payload.customerBalanceAfter === "number") {
        textParts.push(`Saldo restante do cliente: ${formatCurrency(payload.customerBalanceAfter)}`);
      }

      textParts.push(`Veja mais em ${getAppBaseUrl()}/dashboard/user/compras`);

      await sendEmail({
        to: payload.userEmail,
        subject: finalSubject,
        text: textParts.join("\n"),
        html,
      });
    }

    const metadata: Record<string, unknown> = {
      amount: payload.amount,
      categoryName: payload.categoryName,
      customerName: payload.customerName ?? null,
      customerWhatsapp: payload.customerWhatsapp ?? null,
    };

    if (typeof payload.customerBalanceAfter === "number") {
      metadata.customerBalanceAfter = payload.customerBalanceAfter;
    }

    if (payload.productDetails) {
      metadata.productDetails = payload.productDetails;
    }

    const notification = await createUserNotification({
      userId: payload.userId,
      type: "bot_purchase",
      title: subject,
      message: `${customerLabel} - ${amountLabel}`,
      metadata,
    });

    emitRealtimeNotification(notification);
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      console.warn("[notifications] SMTP não configurado. Notificação de compra ignorada.");
      return;
    }

    if (error instanceof EmailDeliveryError) {
      console.error("[notifications] Falha ao enviar notificação de compra", error);
      return;
    }

    console.error("[notifications] Erro inesperado ao notificar compra", error);
  }
};

export const sendPlanPurchaseNotification = async (payload: {
  planName: string;
  amount: number;
  buyerName: string;
  buyerEmail: string | null;
  buyerUserId?: number | null;
  paymentReference?: string | null;
  adminRecipients?: string[];
}) => {
  const normalizedEmail = typeof payload.buyerEmail === "string" ? payload.buyerEmail.trim() : "";
  const fallbackEmail =
    normalizedEmail ||
    (typeof payload.buyerUserId === "number" && Number.isFinite(payload.buyerUserId)
      ? `cliente+${payload.buyerUserId}@storebot.app`
      : "");

  const amountLabel = formatCurrency(payload.amount);
  const appUrl = `${getAppBaseUrl()}/dashboard/user`;
  const context = {
    planName: payload.planName,
    amount: amountLabel,
    userName: payload.buyerName || normalizedEmail || fallbackEmail || "Cliente",
    dashboardUrl: appUrl,
  } satisfies Record<string, string>;
  const subject = `Pagamento confirmado - Plano ${payload.planName}`;

  // As notificações internas não podem depender da configuração ou entrega de e-mail.
  if (typeof payload.buyerUserId === "number" && Number.isFinite(payload.buyerUserId)) {
    const notification = await createUserNotification({
      userId: payload.buyerUserId,
      type: "plan_payment",
      title: subject,
      message: `${context.planName} - ${context.amount}`,
      metadata: {
        planName: context.planName,
        amount: payload.amount,
        paymentReference: payload.paymentReference ?? null,
      },
    });

    emitRealtimeNotification(notification);
  }

  await notifyAdminsOfPlanPayment({
    planName: payload.planName,
    amount: payload.amount,
    buyerName: payload.buyerName,
    buyerEmail: payload.buyerEmail,
    buyerUserId: payload.buyerUserId ?? null,
    paymentReference: payload.paymentReference ?? null,
  });

  try {
    const { html } = await buildEmailFromTemplate(
      "plan_payment_confirmation",
      {
        subject: `Pagamento confirmado - Plano ${payload.planName}`,
        heading: "Acesso liberado!",
        bodyHtml:
          `<p>Olá, <strong>{{userName}}</strong>! Recebemos a confirmação do pagamento do plano <strong>{{planName}}</strong> no valor de <strong>{{amount}}</strong>.</p><p>Seu acesso ao StoreBot foi liberado imediatamente. Comece agora mesmo a configurar suas automações e aproveite os recursos exclusivos do plano selecionado.</p>`,
        ctaLabel: "Ir para o painel",
        ctaUrl: "{{dashboardUrl}}",
        footerText: "Precisa de ajuda? Responda este e-mail e nossa equipe entrará em contato.",
      },
      context,
    );

    const text = [
      `Olá, ${context.userName}!`,
      `Pagamento do plano ${context.planName} confirmado no valor de ${context.amount}.`,
      `Acesse o painel: ${context.dashboardUrl}`,
    ].join("\n");

    if (normalizedEmail) {
      await sendEmail({
        to: normalizedEmail,
        subject,
        text,
        html,
      });
    }

    if (payload.adminRecipients && payload.adminRecipients.length > 0) {
      await sendEmail({
        to: payload.adminRecipients,
        subject: `Nova assinatura confirmada - ${payload.planName}`,
        text: `O usuário ${context.userName} concluiu a assinatura do plano ${context.planName} no valor de ${context.amount}.`,
        html: renderEmailTemplate({
          heading: "Nova assinatura registrada",
          bodyHtml: `<p>O usuário <strong>${context.userName}</strong> concluiu a assinatura do plano <strong>${context.planName}</strong> no valor de <strong>${context.amount}</strong>.</p>`,
          ctaLabel: "Ver usuários",
          ctaUrl: `${getAppBaseUrl()}/dashboard/admin/users`,
          footerText: "Notificação automática StoreBot",
        }),
      });
    }
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      console.warn("[notifications] SMTP não configurado. Notificação de assinatura não enviada.");
      return;
    }

    if (error instanceof EmailDeliveryError) {
      console.error("[notifications] Falha ao enviar notificação de assinatura", error);
      return;
    }

    console.error("[notifications] Erro inesperado ao enviar e-mail de assinatura", error);
  }
};

export const sendApiRequestPurchaseNotification = async (payload: {
  userId: number;
  userName: string;
  userEmail: string | null;
  amount: number;
  requestAmount: number;
  planName?: string | null;
}) => {
  const normalizedName = payload.userName?.trim() || "Cliente";
  const normalizedEmail = typeof payload.userEmail === "string" ? payload.userEmail.trim() : "";
  const requests = Number.isFinite(payload.requestAmount)
    ? Math.max(0, Math.floor(payload.requestAmount))
    : 0;
  const requestLabel = requests > 0 ? requests.toLocaleString("pt-BR") : null;
  const packageLabel =
    (payload.planName && payload.planName.trim()) || (requestLabel ? `${requestLabel} requisições` : "Pacote de requisições");
  const amountLabel = formatCurrency(payload.amount);

  const lines = [
    `${packageLabel} liberado com sucesso.`,
    requestLabel ? `${requestLabel} requisições foram adicionadas ao seu limite.` : null,
    `Valor confirmado: ${amountLabel}.`,
  ].filter(Boolean) as string[];
  const message = lines.join(" ");

  try {
    if (normalizedEmail) {
      const { subject, html } = await buildGenericNotificationEmail({
        subject: `Limite de API atualizado - ${packageLabel}`,
        message,
        userName: normalizedName,
      });

      await sendEmail({
        to: normalizedEmail,
        subject,
        text: message,
        html,
      });
    }

    const notification = await createUserNotification({
      userId: payload.userId,
      type: "api_request_package",
      title: `Limite de API atualizado`,
      message,
      metadata: {
        planName: payload.planName ?? null,
        packageLabel,
        requestAmount: requests,
        requestLabel,
        amount: payload.amount,
        amountLabel,
      },
    });

    emitRealtimeNotification(notification);
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      console.warn("[notifications] SMTP não configurado. Notificação de limite de API ignorada.");
      return;
    }

    if (error instanceof EmailDeliveryError) {
      console.error("[notifications] Falha ao enviar notificação de limite de API", error);
      return;
    }

    console.error("[notifications] Erro inesperado ao notificar limite de API", error);
  }
};

export const sendPlanAddonConfirmationNotification = async (payload: {
  userId: number;
  userName: string;
  userEmail: string | null;
  planName: string;
  addonSummary: string;
  amount: number;
  addonExpiresAt?: string | null;
}) => {
  const summary = payload.addonSummary?.trim() || "add-ons";
  const amountLabel = formatCurrency(payload.amount);
  const expiresLabel = (() => {
    if (!payload.addonExpiresAt) return null;
    const parsed = new Date(payload.addonExpiresAt);
    if (Number.isNaN(parsed.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(parsed);
    } catch {
      return parsed.toISOString();
    }
  })();

  const subject = `Add-ons ativados - ${payload.planName}`;
  const lines = [
    `Os ${summary} do plano ${payload.planName} foram ativados.`,
    `Valor pago: ${amountLabel}.`,
    expiresLabel ? `Validade até ${expiresLabel}.` : null,
  ].filter(Boolean) as string[];
  const message = lines.join(" ");

  try {
    if (payload.userEmail) {
      const { subject: finalSubject, html } = await buildGenericNotificationEmail({
        subject,
        message,
        userName: payload.userName || payload.userEmail,
      });

      await sendEmail({
        to: payload.userEmail,
        subject: finalSubject,
        text: message,
        html,
      });
    }

    const notification = await createUserNotification({
      userId: payload.userId,
      type: "plan_addon_payment",
      title: subject,
      message,
      metadata: {
        planName: payload.planName,
        addonSummary: summary,
        amount: payload.amount,
        addonExpiresAt: payload.addonExpiresAt ?? null,
      },
    });

    emitRealtimeNotification(notification);
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      console.warn("[notifications] SMTP não configurado. Notificação de add-on não enviada.");
      return;
    }
    if (error instanceof EmailDeliveryError) {
      console.error("[notifications] Falha ao enviar e-mail de add-on", error);
      return;
    }
    console.error("[notifications] Erro inesperado ao notificar add-ons", error);
  }
};

export const sendRafflePurchaseNotification = async (payload: {
  userId: number;
  userName: string;
  userEmail: string | null;
  amount: number;
  customerName?: string | null;
  customerWhatsapp?: string | null;
  ticketQuantity?: number | null;
  raffleTitle?: string | null;
  ticketNumbers?: number[] | null;
}) => {
  const amountLabel = formatCurrency(payload.amount);
  const customerLabel = payload.customerName?.trim()
    || payload.customerWhatsapp?.trim()
    || "Cliente do bot";
  const raffleName = (payload.raffleTitle || "Rifa").trim();
  const qty = typeof payload.ticketQuantity === 'number' && payload.ticketQuantity > 0 ? payload.ticketQuantity : null;
  const ticketNumbers = Array.isArray(payload.ticketNumbers)
    ? payload.ticketNumbers
        .map((entry) => Number(entry))
        .filter((entry, index, array) => Number.isFinite(entry) && entry > 0 && array.indexOf(entry) === index)
        .sort((a, b) => a - b)
    : [];
  const numbersLabel = ticketNumbers.length ? ticketNumbers.join(', ') : null;

  const subject = `Pagamento aprovado - ${raffleName}`;
  const lines: string[] = [
    `${customerLabel} confirmou o pagamento da rifa`,
    qty ? `${qty} número(s)` : '',
    `Valor: ${amountLabel}`,
    numbersLabel ? `Números: ${numbersLabel}` : '',
  ].filter(Boolean) as string[];
  const message = lines.join(' • ');

  try {
    if (payload.userEmail) {
      const { subject: finalSubject, html } = await buildEmailFromTemplate(
        "raffle_payment",
        {
          subject: `{{subject}}`,
          heading: "Rifa paga!",
          bodyHtml:
            `<p>Olá, <strong>{{userName}}</strong>! Recebemos a confirmação de pagamento de uma rifa.</p>
             <p>Rifa: <strong>{{raffleName}}</strong></p>
             <p>Cliente: <strong>{{customer}}</strong></p>
             <p>Valor: <strong>{{amount}}</strong></p>
             {{numbersLine}}`,
          ctaLabel: "Ver rifas",
          ctaUrl: "{{rafflesUrl}}",
          footerText: "Notificação automática do StoreBot",
        },
        {
          subject,
          userName: payload.userName,
          raffleName,
          customer: customerLabel,
          amount: amountLabel,
          numbersLine: numbersLabel ? `<p>Números pagos: <strong>${numbersLabel}</strong></p>` : '',
          rafflesUrl: `${getAppBaseUrl()}/dashboard/user/rifas`,
        },
      );

      await sendEmail({
        to: payload.userEmail,
        subject: finalSubject,
        text: `${customerLabel} pagou ${amountLabel} na rifa ${raffleName}`,
        html,
      });
    }

    const notification = await createUserNotification({
      userId: payload.userId,
      type: "bot_purchase",
      title: subject,
      message,
      metadata: {
        amount: payload.amount,
        categoryName: raffleName,
        customerName: payload.customerName ?? null,
        customerWhatsapp: payload.customerWhatsapp ?? null,
        raffle: true,
        ticketQuantity: qty,
        ticketNumbers,
      },
    });

    emitRealtimeNotification(notification);
  } catch (error) {
    console.error('[notifications] Erro ao enviar notificação de rifa', error);
  }
};
