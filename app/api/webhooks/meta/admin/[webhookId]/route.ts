import { NextRequest } from "next/server";

import { getAdminWebhookByPublicId, recordAdminWebhookEvent } from "lib/admin-webhooks";
import { getAdminBotConfig } from "lib/admin-bot-config";
import { getAdminSiteSettings } from "lib/admin-site";
import { verifyEmailWithByteplant } from "lib/email-verification";
import bcrypt from "bcryptjs";
import { ensureUserTable, getDb } from "lib/db";
import {
  activateUserAccount,
  findActiveUserByWhatsappId,
  findUserIdByWhatsappDigits,
  getSessionUserById,
  sanitizeWhatsappDigits,
  updateUserEmail,
  updateUserWhatsappNumber,
} from "lib/users";
import { getSubscriptionPlanById, getUserPlanStatus } from "lib/plans";
import { applyTrialForNewUser } from "lib/plan-trial";
import { listInstancesForUser, createInstanceForUser } from "lib/bot-instances";
import { createGroupForUser, updateGroupInviteForUser } from "lib/bot-groups";
import { formatDate } from "lib/format";
import {
  ADMIN_MENU_BUTTON_IDS,
  ADMIN_PANEL_LIST_IDS,
  ADMIN_INSTANCE_LIST_IDS,
  ADMIN_INSTANCE_NEXT_PREFIX,
  ADMIN_INSTANCE_CREATE_SERVER_PREFIX,
  ADMIN_GROUP_ACTION_LIST_IDS,
  ADMIN_GROUP_ROW_PREFIX,
  ADMIN_GROUP_NEXT_PREFIX,
  ADMIN_GROUP_DELETE_PREFIX,
  ADMIN_GROUP_CONFIRM_DELETE_PREFIX,
  ADMIN_GROUP_CANCEL_DELETE_PREFIX,
  ADMIN_GROUP_DELETE_NEXT_PREFIX,
  ADMIN_GROUP_CREATE_INSTANCE_PREFIX,
  ADMIN_GROUP_EDIT_PREFIX,
  ADMIN_GROUP_BUTTON_IDS,
  ADMIN_SUBSCRIPTION_BUTTON_IDS,
  ADMIN_PLAN_ROW_PREFIX,
  ADMIN_PLAN_PAY_PIX_PREFIX,
  ADMIN_PLAN_PAY_CHECKOUT_PREFIX,
  ADMIN_FLOW_BUTTON_IDS,
  sendAdminMainMenu,
  sendAdminPanelMenu,
  sendAdminGroupActionsMenu,
  sendAdminGroupListMenu,
  sendAdminGroupCreateInstancePicker,
  sendAdminGroupCreatePromptForInstance,
  sendAdminGroupDeletionList,
  sendAdminGroupDeletionPrompt,
  sendAdminGroupDetailsMessage,
  sendAdminGroupEditPrompt,
  handleAdminGroupDeletion,
  sendAdminInstanceListMenu,
  sendAdminInstanceActionsMenu,
  sendAdminInstanceCreateServerPicker,
  sendAdminInstanceCreatePhonePrompt,
  sendAdminInstanceStatusMessage,
  sendAdminInstancePairingMessage,
  sendAdminInstanceDeletionPrompt,
  handleAdminInstanceDeletion,
  handleAdminInstanceSessionAction,
  sendAdminInstanceSetupReminder,
  sendAdminSubscriptionMenu,
  sendAdminPlanDetails,
  sendAdminPlanList,
  sendAdminPlanPayment,
  sendAdminWebPanelLink,
  sendAdminUnknownOptionMessage,
  parseAdminInstanceRowId,
  parseAdminInstanceAction,
  ADMIN_PLAN_PAY_POLOPAG_PREFIX,
  AdminPlanPaymentMethod,
  applyConfigTokens,
} from "lib/admin-bot";
import {
  recordSupportMessage,
  serializeSupportMessage,
  buildSupportThreadSummary,
  getSupportThreadByWhatsapp,
  setSupportHandlingMode,
  mergeSupportThreadAlias,
} from "lib/support";
import { emitSupportMessageEvent, emitSupportThreadUpdate } from "lib/realtime";
import {
  getAppBaseUrl,
  sendInteractiveCtaUrlMessage,
  sendInteractiveReplyButtonsMessage,
  sendMediaMessage,
  sendReactionMessage,
  sendReadReceipt,
  sendTextMessage,
  type MetaWebhookCredentials,
} from "lib/meta";
import { getPendingVerificationByCode, markVerificationAsVerified } from "lib/user-verification";
import {
  confirmSignupWhatsappVerificationFromMessage,
  SignupWhatsappVerificationError,
} from "lib/signup-whatsapp-verification";
import { sendWelcomeEmail } from "lib/notifications";
import { getGroupByIdForUser, syncGroupInfo } from "lib/bot-groups";
import { getAdminBotSession, upsertAdminBotSession, updateAdminBotSessionFlow } from "lib/admin-bot-sessions";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ webhookId: string }> }) {
  const searchParams = new URL(_req.url).searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const { webhookId } = await params;
  const row = await getAdminWebhookByPublicId(webhookId);
  if (!row) {
    return new Response("Not Found", { status: 404 });
  }

  if (mode === "subscribe" && token && token === row.verify_token && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  return new Response("Forbidden", { status: 403 });
}

type MetaWebhookMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    type: "button_reply" | "list_reply";
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
};

type ChangeValue = {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{
    wa_id?: string;
    profile?: { name?: string } | null;
  }>;
  messages?: Array<{
    from?: string;
    type?: string;
  } & Record<string, unknown>>;
  statuses?: Array<{ status?: string }>;
};

type WhatsAppMessage = {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string | null } | null;
  image?: { id?: string; mime_type?: string | null; caption?: string | null } | null;
  document?: { id?: string; mime_type?: string | null; filename?: string | null; caption?: string | null } | null;
  audio?: { id?: string; mime_type?: string | null } | null;
  video?: { id?: string; mime_type?: string | null; caption?: string | null } | null;
  sticker?: { id?: string; caption?: string | null } | null;
  interactive?: {
    type?: "button_reply" | "list_reply";
    button_reply?: { id?: string; title?: string | null } | null;
    list_reply?: { id?: string; title?: string | null; description?: string | null } | null;
  } | null;
  [key: string]: unknown;
};

const resolvePlanPaymentMethod = (rawId: string, title?: string): AdminPlanPaymentMethod | null => {
  const id = (rawId || "").trim().toLowerCase();
  if (id.startsWith(ADMIN_PLAN_PAY_POLOPAG_PREFIX)) {
    return "polopag_pix";
  }
  if (id.startsWith(ADMIN_PLAN_PAY_PIX_PREFIX)) {
    return "mercadopago_pix";
  }
  if (id.startsWith(ADMIN_PLAN_PAY_CHECKOUT_PREFIX)) {
    return "mercadopago_checkout";
  }
  if (id.includes("polopag")) {
    return "polopag_pix";
  }
  if (id.includes("checkout") || id.includes("online")) {
    return "mercadopago_checkout";
  }
  if (id.includes("pix")) {
    return "mercadopago_pix";
  }

  const normalizedTitle = (title || "").trim().toLowerCase();
  if (normalizedTitle.includes("polo")) {
    return "polopag_pix";
  }
  if (normalizedTitle.includes("checkout") || normalizedTitle.includes("cartão") || normalizedTitle.includes("online")) {
    return "mercadopago_checkout";
  }
  if (normalizedTitle.includes("pix")) {
    return "mercadopago_pix";
  }

  return null;
};

const resolveContactName = (value: ChangeValue, waId: string) => {
  if (!Array.isArray(value.contacts)) {
    return null;
  }

  const contact = value.contacts.find((entry) => entry?.wa_id === waId);
  return contact?.profile?.name ?? null;
};

const parseTimestamp = (raw: unknown): number | null => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const isLikelyEmail = (value: string): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length < 6 || normalized.length > 254) {
    return null;
  }
  if (normalized.includes(" ") || normalized.includes("..")) {
    return null;
  }

  const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i;
  if (!emailPattern.test(normalized)) {
    return null;
  }

  const [localPart, domain] = normalized.split("@");
  if (!localPart || !domain) {
    return null;
  }
  if (localPart.startsWith(".") || localPart.endsWith(".")) {
    return null;
  }
  if (domain.startsWith("-") || domain.endsWith("-") || domain.includes("..")) {
    return null;
  }

  return normalized;
};

const resolveInteractiveTitle = (message: WhatsAppMessage | null | undefined) => {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (message.type !== "interactive" || !message.interactive) {
    return null;
  }
  const interactive = message.interactive;
  if (interactive?.type === "button_reply") {
    return interactive.button_reply?.title ?? interactive.button_reply?.id ?? null;
  }
  if (interactive?.type === "list_reply") {
    return interactive.list_reply?.title ?? interactive.list_reply?.id ?? null;
  }
  return null;
};

const extractMessageText = (message: WhatsAppMessage | null | undefined) => {
  if (!message || typeof message !== "object") {
    return null;
  }

  switch (message.type) {
    case "text":
      return message.text?.body ?? null;
    case "interactive":
      return resolveInteractiveTitle(message);
    case "image":
      return message.image?.caption ?? null;
    case "document":
      return message.document?.caption ?? null;
    case "audio":
    case "video":
    case "sticker":
      return (message[message.type as "audio" | "video" | "sticker"] as Record<string, unknown> | undefined)?.caption
        ?? message.type;
    default:
      return null;
  }
};

const simplifyPayload = (message: WhatsAppMessage | null | undefined) => {
  if (!message || typeof message !== "object") {
    return null;
  }

  const base: Record<string, unknown> = {
    id: message.id ?? null,
    type: message.type ?? null,
    timestamp: message.timestamp ?? null,
  };

  if (message.type === "image" && message.image?.id) {
    return {
      ...base,
      mediaId: message.image.id,
      mimeType: message.image.mime_type ?? null,
      caption: message.image.caption ?? null,
      mediaType: "image",
    };
  }
  if (message.type === "document" && message.document?.id) {
    return {
      ...base,
      mediaId: message.document.id,
      mimeType: message.document.mime_type ?? null,
      filename: message.document.filename ?? null,
      caption: message.document.caption ?? null,
      mediaType: "document",
    };
  }
  if (message.type === "audio" && message.audio?.id) {
    return {
      ...base,
      mediaId: message.audio.id,
      mimeType: message.audio.mime_type ?? null,
      mediaType: "audio",
    };
  }
  if (message.type === "video" && message.video?.id) {
    return {
      ...base,
      mediaId: message.video.id,
      mimeType: message.video.mime_type ?? null,
      caption: message.video.caption ?? null,
      mediaType: "video",
    };
  }
  if (message.type === "sticker" && message.sticker?.id) {
    return {
      ...base,
      mediaId: message.sticker.id,
      mediaType: "sticker",
      caption: message.sticker.caption ?? null,
    };
  }
  if (message.type === "interactive") {
    return {
      ...base,
      interactive: message.interactive ?? null,
      selectionTitle: resolveInteractiveTitle(message),
    };
  }

  if (message.type === "text" && message.text?.body) {
    return {
      ...base,
      text: message.text.body,
    };
  }

  try {
    return JSON.parse(JSON.stringify(message));
  } catch {
    return message;
  }
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ webhookId: string }> }) {
  const { webhookId } = await params;
  const row = await getAdminWebhookByPublicId(webhookId);
  if (!row) {
    return new Response("Not Found", { status: 404 });
  }

  const payload = await req.json().catch(() => ({}));
  const eventType = (() => {
    try {
      const change = payload?.entry?.[0]?.changes?.[0];
      const value = change?.value ?? {};
      if (Array.isArray(value.statuses) && value.statuses.length) return "status";
      if (Array.isArray(value.messages) && value.messages.length) return value.messages[0].type || "message";
      return "unknown";
    } catch {
      return "unknown";
    }
  })();

  await recordAdminWebhookEvent(row.id, eventType, payload);

  const credentials: MetaWebhookCredentials = {
    access_token: row.access_token,
    phone_number_id: row.phone_number_id,
  };

  const appUrl = getAppBaseUrl();
  const config = await getAdminBotConfig();

  const handleEntries = async () => {
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const changeValue = (change?.value ?? {}) as ChangeValue;
        const contacts = Array.isArray(changeValue.contacts) ? changeValue.contacts : [];
        const waIdFallback = contacts[0]?.wa_id;

        const messages: MetaWebhookMessage[] = Array.isArray(changeValue.messages) ? changeValue.messages : [];
        for (const msg of messages) {
  const from = (msg.from || waIdFallback || "").trim();
  if (!from) return;

  const incomingMessage = msg as unknown as WhatsAppMessage;
  const contactName = resolveContactName(changeValue, from);
  const timestampSeconds = parseTimestamp((incomingMessage as Record<string, unknown> | undefined)?.timestamp);
  const messageTimestamp = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();

  const msgType = typeof msg.type === "string" ? msg.type.trim().toLowerCase() : "";
  // Somente ignore quando o provedor sinalizar explicitamente interactive sem payload de reply
  const hasNonReplyInteractive = msgType === "interactive" && !msg.interactive;

  const looksInteractive = Boolean(
    msgType === "interactive" || msg.interactive,
  );

  if (hasNonReplyInteractive) {
    return;
  }

  const messageId = typeof msg.id === "string" ? msg.id.trim() : "";
  const sendReactionSafely = async (emoji: "✅" | "❌" | "⌛") => {
    if (!messageId) return;
    try {
      await sendReactionMessage({ webhook: credentials, to: from, messageId, emoji });
    } catch (error) {
      console.warn("[Meta Webhook] Falha ao enviar reação", error);
    }
  };

  if (messageId) {
    await sendReadReceipt({ webhook: credentials, to: from, messageId });
    await sendReactionSafely("⌛");
  }

  let finalReaction: "✅" | "❌" = "✅";
  const markError = () => {
    finalReaction = "❌";
  };

  const toAbsoluteAppUrl = (path: string) => {
    try {
      return new URL(path, appUrl).toString();
    } catch {
      return appUrl;
    }
  };

  const getPrimaryOfficialGroupUrl = async () => {
    try {
      const site = await getAdminSiteSettings();
      const activeGroup = site.officialGroups?.find(
        (group) => group.isActive && group.inviteLink,
      );
      return (
        activeGroup?.inviteLink?.trim() ||
        site.officialGroupInviteLink?.trim() ||
        null
      );
    } catch (error) {
      console.warn("[Meta Webhook] Falha ao carregar grupo oficial do site", error);
      return null;
    }
  };

  const sendSignupCompletionMessage = async () => {
    const groupUrl = await getPrimaryOfficialGroupUrl();
    const siteUrl = toAbsoluteAppUrl("/sign-in");
    const footerText = config.botName?.trim() || "BotAdmin";
    const successText =
      "✅ Cadastro concluído com sucesso.\n\nSeu WhatsApp foi confirmado e o painel já pode liberar seu acesso automaticamente.";

    if (groupUrl) {
      await sendInteractiveCtaUrlMessage({
        webhook: credentials,
        to: from,
        bodyText: `${successText}\n\nEntre no grupo oficial para receber avisos, suporte e novidades.`,
        buttonText: "Entrar no grupo",
        buttonUrl: groupUrl,
        footerText,
      });
      await sendInteractiveCtaUrlMessage({
        webhook: credentials,
        to: from,
        bodyText: "Agora volte ao site para continuar no painel do BotAdmin.",
        buttonText: "Voltar ao site",
        buttonUrl: siteUrl,
        footerText,
      });
      return;
    }

    await sendInteractiveCtaUrlMessage({
      webhook: credentials,
      to: from,
      bodyText: successText,
      buttonText: "Voltar ao site",
      buttonUrl: siteUrl,
      footerText,
    });
  };

  const sendSignupRecoveryMessage = async (message: string) => {
    await sendInteractiveCtaUrlMessage({
      webhook: credentials,
      to: from,
      bodyText: `⚠️ ${message}\n\nUse a recuperação para entrar na conta vinculada a este WhatsApp.`,
      buttonText: "Recuperar acesso",
      buttonUrl: toAbsoluteAppUrl("/forgot-password"),
      footerText: config.botName?.trim() || "BotAdmin",
    });
  };

  const handleRegistrationVerification = async (text: string): Promise<{ handled: boolean; success: boolean }> => {
    if (!text || typeof text !== "string") {
      return { handled: false, success: false };
    }

    const match = text.toUpperCase().match(/\bSB[-\s]?([0-9]{6})\b/);
    if (!match) {
      return { handled: false, success: false };
    }

    const code = `SB-${match[1]}`;
    const verification = await getPendingVerificationByCode(code);
    if (!verification) {
      const senderDigits = sanitizeWhatsappDigits(from);
      try {
        const signupVerification = await confirmSignupWhatsappVerificationFromMessage({
          code: match[1],
          senderDigits,
        });
        if (signupVerification) {
          await sendSignupCompletionMessage();
          return { handled: true, success: true };
        }
      } catch (error) {
        const message =
          error instanceof SignupWhatsappVerificationError
            ? error.message
            : "Não foi possível confirmar este cadastro. Entre em contato com o suporte.";
        if (
          error instanceof SignupWhatsappVerificationError &&
          (error.status === 409 || message.toLowerCase().includes("vinculado"))
        ) {
          await sendSignupRecoveryMessage(message);
        } else {
          await sendTextMessage({
            webhook: credentials,
            to: from,
            text: message,
          });
        }
        return { handled: true, success: false };
      }

      await sendTextMessage({
        webhook: credentials,
        to: from,
        text: "Não encontramos esse código de confirmação. Verifique se ele está correto ou refaça o cadastro para gerar um novo código.",
      });
      return { handled: true, success: false };
    }

    const user = await getSessionUserById(verification.userId);
    if (!user) {
      await sendTextMessage({
        webhook: credentials,
        to: from,
        text: "Não foi possível identificar o usuário vinculado a este código. Entre em contato com o suporte.",
      });
      return { handled: true, success: false };
    }

    const senderDigits = sanitizeWhatsappDigits(from);
    if (!senderDigits) {
      await sendTextMessage({
        webhook: credentials,
        to: from,
        text: "Não foi possível identificar o número que enviou a mensagem. Tente novamente a partir do WhatsApp que deseja vincular.",
      });
      return { handled: true, success: false };
    }

    const existingOwnerId = await findUserIdByWhatsappDigits(senderDigits);
    if (existingOwnerId && existingOwnerId !== user.id) {
      await sendTextMessage({
        webhook: credentials,
        to: from,
        text: "Este número já está vinculado a outra conta. Utilize o mesmo WhatsApp cadastrado ou solicite suporte.",
      });
      return { handled: true, success: false };
    }

    const userDigits = sanitizeWhatsappDigits(user.whatsappNumber ?? "");
    if (userDigits && senderDigits !== userDigits) {
      await sendTextMessage({
        webhook: credentials,
        to: from,
        text: "O código precisa ser enviado a partir do número de WhatsApp cadastrado. Utilize o mesmo número informado no site e tente novamente.",
      });
      return { handled: true, success: false };
    }

    if (!userDigits) {
      await updateUserWhatsappNumber(user.id, `+${senderDigits}`);
    }

    await markVerificationAsVerified(verification.id, { channel: "whatsapp" });
    await activateUserAccount(user.id);

    try {
      await sendWelcomeEmail({ userId: user.id, userName: user.name, userEmail: user.email });
    } catch (notifyError) {
      console.warn("Falha ao enviar e-mail de boas-vindas após verificação", notifyError);
    }

    const firstName = user.name.trim().split(/\s+/)[0] || user.name;
    // Envia o menu principal dentro do WhatsApp (botão de clique), em vez de um link externo
    await sendAdminMainMenu({
      webhook: credentials,
      to: from,
      user,
      config,
      extraInfo: {
        number: (user.whatsappNumber || from),
        planExpiresAt: null,
        planName: null,
        customGreeting: `Sua conta foi ativada com sucesso, ${firstName}! Escolha uma opção para começar.`,
      } as any,
    });

    return { handled: true, success: true };
  };

  const processMessage = async (): Promise<void> => {
    const primaryTextBody = typeof msg.text?.body === "string" ? msg.text.body.trim() : "";
    const verificationResult = await handleRegistrationVerification(primaryTextBody);
    if (verificationResult.handled) {
      finalReaction = verificationResult.success ? "✅" : "❌";
      return;
    }
    // Verifica cadastro
    let user = await findActiveUserByWhatsappId(from);
    const flowSession = await getAdminBotSession(from);
    if (!user) {
      const invalidEmailMsg =
        config.signupEmailInvalidText ||
        "Ops! Esse e-mail parece incompleto. Confere rapidinho e me envia de novo, por favor?";
      // 1) Reconhecimento de e‑mail independente do estado do fluxo
      const plainText = typeof msg.text?.body === "string" ? msg.text.body.trim() : "";
      const emailMatch = plainText.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/i);
      if (emailMatch && emailMatch[0]) {
        const normalizedCandidate = isLikelyEmail(emailMatch[0]);
        if (!normalizedCandidate) {
          await sendTextMessage({ webhook: credentials, to: from, text: invalidEmailMsg });
          finalReaction = "❌";
          return;
        }

        const email = normalizedCandidate.toLowerCase();

        try {
          const site = await getAdminSiteSettings();
          const initialKeys = [...site.emailVerificationApiKeys];
          const verification = await verifyEmailWithByteplant(email, initialKeys);
          if (verification.status === "invalid" || verification.status === "unavailable") {
            await sendTextMessage({ webhook: credentials, to: from, text: invalidEmailMsg });
            finalReaction = "❌";
            return;
          }
        } catch {
          await sendTextMessage({ webhook: credentials, to: from, text: invalidEmailMsg });
          finalReaction = "❌";
          return;
        }

        await ensureUserTable();
        const db = getDb();
        const [exists] = await db.query<any[]>(
          `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`,
          [email],
        );
        const existsRow = Array.isArray(exists) && exists.length > 0 ? exists[0] : null;

        if (!existsRow) {
          // Cria conta com senha temporária
          const digits = sanitizeWhatsappDigits(from);
          const nameFromEmail = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
          const defaultName = `Usuário ${digits?.slice(-4) ?? "WA"}`;
          const chosenName = (contactName && contactName.trim()) ? contactName.trim() : (nameFromEmail || defaultName);
          const tempPassword = Math.random().toString(36).slice(-10);
          const hashed = await bcrypt.hash(tempPassword, 10);
          const [res] = await db.query<any>(
            "INSERT INTO users (name, email, password, role, is_active, whatsapp_number) VALUES (?, ?, ?, 'user', 1, ?)",
            [chosenName, email, hashed, digits ? `+${digits}` : null],
          );
          const newUserId = res?.insertId ?? null;
          if (newUserId) {
            await updateUserWhatsappNumber(newUserId, digits ? `+${digits}` : null);
            await upsertAdminBotSession(from, newUserId).catch(() => {});
            await updateAdminBotSessionFlow(from, null);

            try {
              const trial = await applyTrialForNewUser({
                userId: newUserId,
                userName: chosenName,
                context: "admin_bot_signup",
              });
              if (trial.applied) {
                const mediaUrl = trial.whatsapp?.mediaUrl ?? null;
                const messageBody = trial.whatsapp?.message ?? null;
                if (mediaUrl) {
                  const normalized = mediaUrl.split("?")[0]?.toLowerCase() ?? "";
                  const mediaType = /\.(mp4|mov|m4v|avi|webm)$/.test(normalized) ? "video" : "image";
                  await sendMediaMessage({
                    webhook: credentials,
                    to: from,
                    mediaUrl,
                    mediaType,
                    caption: messageBody ?? undefined,
                  }).catch((error) => {
                    console.error("Failed to send trial media via admin bot", error);
                  });
                } else if (messageBody) {
                  await sendTextMessage({ webhook: credentials, to: from, text: messageBody });
                }
              }
            } catch (error) {
              console.error("Failed to assign/send trial for admin bot signup", error);
            }

            const header = config.signupSuccessHeaderText || "Conta criada com sucesso!";
            const body = (config.signupSuccessBodyText || "Sua conta foi criada. Anote sua senha temporária:") + `\n\nSenha: ${tempPassword}`;
            const button = config.signupSuccessButtonText || "Abrir menu";
            await sendInteractiveReplyButtonsMessage({
              webhook: credentials,
              to: from,
              headerText: header,
              bodyText: body,
              buttons: [{ id: ADMIN_MENU_BUTTON_IDS.home, title: button }],
            });

            const sessionUser = await findActiveUserByWhatsappId(from);
            if (sessionUser) {
              await sendAdminMainMenu({ webhook: credentials, to: from, user: sessionUser, config });
            }
            return;
          }

          await updateAdminBotSessionFlow(from, null);
          await sendTextMessage({ webhook: credentials, to: from, text: "Não foi possível completar o cadastro agora. Tente novamente." });
          return;
        }

        // E‑mail já existe → pedir senha para vincular
        await upsertAdminBotSession(from, 0).catch(() => {});
        await updateAdminBotSessionFlow(from, { name: "signup_password_input", mode: "link", email, userId: existsRow.id });
        await sendInteractiveReplyButtonsMessage({
          webhook: credentials,
          to: from,
          headerText: config.signupHeaderText || "Vincular conta",
          bodyText: config.signupPasswordPromptText || "Envie a senha da sua conta para vincular ao WhatsApp.",
          buttons: [{ id: ADMIN_FLOW_BUTTON_IDS.cancel, title: "Cancelar" }],
        });
        return;
      }
      if (flowSession?.flowState?.name === "signup_email_input" && msg.text?.body) {
        const invalidEmailMsg =
          config.signupEmailInvalidText ||
          "Ops! Esse e-mail parece incompleto. Confere rapidinho e me envia de novo, por favor?";
        const raw = msg.text.body.trim();
        const candidate = isLikelyEmail(raw);
        if (!candidate) {
          await sendTextMessage({ webhook: credentials, to: from, text: invalidEmailMsg });
          finalReaction = "❌";
          return;
        }

        const email = candidate.toLowerCase();

        try {
          const site = await getAdminSiteSettings();
          const initialKeys = [...site.emailVerificationApiKeys];
          const verification = await verifyEmailWithByteplant(email, initialKeys);
          if (verification.status === "invalid" || verification.status === "unavailable") {
            await sendTextMessage({ webhook: credentials, to: from, text: invalidEmailMsg });
            finalReaction = "❌";
            return;
          }
        } catch {
          await sendTextMessage({ webhook: credentials, to: from, text: invalidEmailMsg });
          finalReaction = "❌";
          return;
        }

        await ensureUserTable();
        const db = getDb();
        const [exists] = await db.query<any[]>(
          `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`,
          [email],
        );
        const existsRow = Array.isArray(exists) && exists.length > 0 ? exists[0] : null;

        // Se o e-mail não existir, cria conta automaticamente com senha temporária
        if (!existsRow) {
          const digits = sanitizeWhatsappDigits(from);
          const nameFromEmail = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
          const defaultName = `Usuário ${digits?.slice(-4) ?? "WA"}`;
          const chosenName = (contactName && contactName.trim()) ? contactName.trim() : (nameFromEmail || defaultName);
          const tempPassword = Math.random().toString(36).slice(-10);
          const hashed = await bcrypt.hash(tempPassword, 10);
          const [res] = await db.query<any>(
            "INSERT INTO users (name, email, password, role, is_active, whatsapp_number) VALUES (?, ?, ?, 'user', 1, ?)",
            [chosenName, email, hashed, digits ? `+${digits}` : null],
          );
          const newUserId = res?.insertId ?? null;
          if (newUserId) {
            await updateUserWhatsappNumber(newUserId, digits ? `+${digits}` : null);
            await upsertAdminBotSession(from, newUserId).catch(() => {});
            await updateAdminBotSessionFlow(from, null);

            // Mensagem de sucesso + botão para menu
            const header = config.signupSuccessHeaderText || "Conta criada com sucesso!";
            const body = (config.signupSuccessBodyText || "Sua conta foi criada. Anote sua senha temporária:") + `\n\nSenha: ${tempPassword}`;
            const button = config.signupSuccessButtonText || "Abrir menu";

            await sendInteractiveReplyButtonsMessage({
              webhook: credentials,
              to: from,
              headerText: header,
              bodyText: body,
              buttons: [{ id: ADMIN_MENU_BUTTON_IDS.home, title: button }],
            });

            const sessionUser = await findActiveUserByWhatsappId(from);
            if (sessionUser) {
              await sendAdminMainMenu({ webhook: credentials, to: from, user: sessionUser, config });
            }
            return;
          }

          await updateAdminBotSessionFlow(from, null);
          await sendTextMessage({ webhook: credentials, to: from, text: "Não foi possível completar o cadastro agora. Tente novamente." });
          return;
        }

        // E-mail já existe: pede a senha apenas para vincular
        await updateAdminBotSessionFlow(from, { name: "signup_password_input", mode: "link", email, userId: existsRow.id });
        await sendInteractiveReplyButtonsMessage({
          webhook: credentials,
          to: from,
          headerText: config.signupHeaderText || "Vincular conta",
          bodyText: config.signupPasswordPromptText || "Envie a senha da sua conta para vincular ao WhatsApp.",
          buttons: [{ id: ADMIN_FLOW_BUTTON_IDS.cancel, title: "Cancelar" }],
        });
        return;
      }

      if (flowSession?.flowState?.name === "signup_password_input" && msg.text?.body) {
        const rawPass = msg.text.body.trim();
        if (rawPass.length < 8) {
          await sendTextMessage({
            webhook: credentials,
            to: from,
            text: "A senha deve ter pelo menos 8 caracteres.",
          });
          return;
        }

        const digits = sanitizeWhatsappDigits(from);
        await ensureUserTable();
        const db = getDb();

        let linkedUserId: number | null = null;
        if (flowSession.flowState.mode === "link" && flowSession.flowState.userId) {
          const [rows] = await db.query<any[]>(
            `SELECT id, password, name FROM users WHERE id = ? LIMIT 1`,
            [flowSession.flowState.userId],
          );
          const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          if (!row || !row.password || !(await bcrypt.compare(rawPass, row.password))) {
            await sendTextMessage({
              webhook: credentials,
              to: from,
              text: "Senha incorreta para esse e-mail. Tente novamente.",
            });
            return;
          }
          linkedUserId = row.id;
          // Atualiza o nome do usuário com o push name quando o atual é placeholder
          try {
            const currentName = String(row.name || "").trim();
            const isPlaceholder = /^Usuário\s+\d{2,}$/i.test(currentName) || currentName.length <= 2;
            if (isPlaceholder && contactName && contactName.trim()) {
              await db.query(`UPDATE users SET name = ? WHERE id = ?`, [contactName.trim(), row.id]);
            }
          } catch {}
        } else {
          const hashed = await bcrypt.hash(rawPass, 10);
          const nameFromEmail = String(flowSession.flowState.email || "").split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
          const defaultName = `Usuário ${digits?.slice(-4) ?? "WA"}`;
          const chosenName = (contactName && contactName.trim()) ? contactName.trim() : (nameFromEmail || defaultName);
          const [res] = await db.query<any>(
            "INSERT INTO users (name, email, password, role, is_active, whatsapp_number) VALUES (?, ?, ?, 'user', 1, ?)",
            [chosenName, flowSession.flowState.email, hashed, digits ? `+${digits}` : null],
          );
          linkedUserId = res?.insertId ?? null;
        }

        if (linkedUserId) {
          await updateUserWhatsappNumber(linkedUserId, digits ? `+${digits}` : null);
          await upsertAdminBotSession(from, linkedUserId).catch(() => {});
          await updateAdminBotSessionFlow(from, null);

          const successHeader = config.signupSuccessHeaderText || "Conta criada com sucesso! 🎉";
          const successBody =
            config.signupSuccessBodyText
            || "Você já pode acessar o painel e utilizar todos os recursos do bot administrativo.";
          const successButton =
            config.signupSuccessButtonText || "Abrir menu";

          await sendInteractiveReplyButtonsMessage({
            webhook: credentials,
            to: from,
            headerText: successHeader,
            bodyText: successBody,
            buttons: [{ id: ADMIN_MENU_BUTTON_IDS.home, title: successButton }],
          });

          const sessionUser = await findActiveUserByWhatsappId(from);
          if (sessionUser) {
            await sendAdminMainMenu({ webhook: credentials, to: from, user: sessionUser, config });
          }
          return;
        }
        await updateAdminBotSessionFlow(from, null);
        await sendTextMessage({
          webhook: credentials,
          to: from,
          text: "Não foi possível completar o cadastro agora. Tente novamente.",
        });
        return;
      }

      // Inicia fluxo de cadastro rápido pelo WhatsApp (idempotente)
      // Evita enviar o mesmo prompt duas vezes em caso de eventos duplicados
      if (flowSession?.flowState?.name === "signup_email_input" || flowSession?.flowState?.name === "signup_password_input") {
        return;
      }
      await upsertAdminBotSession(from, 0).catch(() => {});
      await updateAdminBotSessionFlow(from, { name: "signup_email_input" });
      const cfg = config;
      await sendInteractiveReplyButtonsMessage({
        webhook: credentials,
        to: from,
        headerText: cfg.signupHeaderText || "Criar conta",
        bodyText: cfg.signupBodyText || "Me envie seu e-mail para começarmos seu cadastro.",
        buttons: [{ id: ADMIN_FLOW_BUTTON_IDS.cancel, title: "Cancelar" }],
      });
      return;
    }

    const normalizedUserEmail = typeof user.email === "string" ? user.email.trim() : "";
    const isMissingEmailFlow = flowSession?.flowState?.name === "missing_email_input";
    if (!normalizedUserEmail || isMissingEmailFlow) {
      const invalidEmailMsg =
        config.signupEmailInvalidText ||
        "Ops! Esse e-mail parece incompleto. Confere rapidinho e me envia de novo, por favor?";
      const reminderIntro = (() => {
        if (contactName && contactName.trim()) {
          return `Olá, ${contactName.trim()}!`;
        }
        const cleanedName = typeof user.name === "string" ? user.name.trim() : "";
        return cleanedName ? `Olá, ${cleanedName}!` : "Olá!";
      })();
      const reminderBody =
        "Eu preciso do seu e-mail para manter sua conta segura e facilitar a recuperação de senha. Pode me enviar o endereço certinho?";
      const duplicateEmailMsg =
        "Esse e-mail já está vinculado a outra conta. Pode me informar outro endereço, por favor?";

      await upsertAdminBotSession(from, user.id).catch(() => {});
      await updateAdminBotSessionFlow(from, { name: "missing_email_input" });

      const emailCandidate = primaryTextBody;
      if (emailCandidate) {
        const candidate = isLikelyEmail(emailCandidate);
        if (candidate) {
          const email = candidate.toLowerCase();

          try {
            const site = await getAdminSiteSettings();
            const initialKeys = [...site.emailVerificationApiKeys];
            const verification = await verifyEmailWithByteplant(email, initialKeys);
            if (verification.status === "invalid" || verification.status === "unavailable") {
              await sendTextMessage({ webhook: credentials, to: from, text: invalidEmailMsg });
              finalReaction = "❌";
              return;
            }
          } catch {
            await sendTextMessage({ webhook: credentials, to: from, text: invalidEmailMsg });
            finalReaction = "❌";
            return;
          }

          await ensureUserTable();
          const db = getDb();
          const [existingRows] = await db.query<any[]>(
            `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`,
            [email],
          );
          const existingEmailRow =
            Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;

          if (existingEmailRow && Number(existingEmailRow.id) !== user.id) {
            await sendTextMessage({ webhook: credentials, to: from, text: duplicateEmailMsg });
            finalReaction = "❌";
            return;
          }

          await updateUserEmail(user.id, email);
          await updateAdminBotSessionFlow(from, null);
          finalReaction = "✅";

          const successText =
            `Tudo certo! Registrei o e-mail ${email} para manter sua conta segura. Vamos continuar com o que você precisa.`;
          await sendTextMessage({ webhook: credentials, to: from, text: successText });

          const refreshedUser = await findActiveUserByWhatsappId(from);
          if (refreshedUser) {
            user = refreshedUser;
            const statusNow = await getUserPlanStatus(user.id);
            await sendAdminMainMenu({
              webhook: credentials,
              to: from,
              user,
              config,
              extraInfo: {
                number: user.whatsappNumber || from,
                planExpiresAt: statusNow.currentPeriodEnd,
                planName: statusNow.plan?.name ?? null,
              },
            });
          }
          return;
        }
      }

      await sendTextMessage({ webhook: credentials, to: from, text: `${reminderIntro}\n\n${reminderBody}` });
      return;
    }

    const supportWhatsappId = "__admin__";
    await mergeSupportThreadAlias(user.id, from, supportWhatsappId, {
      customerName: contactName ?? user.name ?? null,
      profileName: contactName ?? user.name ?? null,
    });
    let supportThread = await getSupportThreadByWhatsapp(user.id, supportWhatsappId);

    if (supportThread && supportThread.handlingMode === "human") {
      const previousLastAt = supportThread.lastMessageAt ? new Date(supportThread.lastMessageAt).getTime() : null;

      if (!looksInteractive) {
        const inboundRecord = await recordSupportMessage({
          userId: user.id,
          whatsappId: supportWhatsappId,
          direction: "inbound",
          messageType: incomingMessage.type ?? "unknown",
          text: extractMessageText(incomingMessage),
          payload: {
            ...simplifyPayload(incomingMessage),
            contactWhatsapp: from,
          },
          messageId: messageId || null,
          timestamp: messageTimestamp,
          customerName: contactName ?? user.name ?? null,
          profileName: contactName ?? user.name ?? null,
          senderRole: "user",
          senderUserId: user.id,
        });

        const inboundMessage = serializeSupportMessage(inboundRecord.message);
        const inboundSummary = await buildSupportThreadSummary(user.id, inboundRecord.thread);
        emitSupportMessageEvent({
          userId: user.id,
          whatsappId: inboundRecord.thread.whatsappId,
          message: inboundMessage,
        });
        emitSupportThreadUpdate({ userId: user.id, thread: inboundSummary });

        supportThread = inboundRecord.thread;

        const nowTs = (messageTimestamp ?? new Date()).getTime();
        const FIVE_MINUTES = 5 * 60 * 1000;
        if (previousLastAt && nowTs - previousLastAt >= FIVE_MINUTES) {
          const latest = await setSupportHandlingMode(user.id, supportWhatsappId, "bot");
          if (latest) {
            supportThread = latest;
            const summary = await buildSupportThreadSummary(user.id, latest);
            emitSupportThreadUpdate({ userId: user.id, thread: summary });
          }
        } else {
          return;
        }
      } else {
        const latest = await setSupportHandlingMode(user.id, supportWhatsappId, "bot");
        if (latest) {
          supportThread = latest;
          const summary = await buildSupportThreadSummary(user.id, latest);
          emitSupportThreadUpdate({ userId: user.id, thread: summary });
        }
      }
    }

    let planStatus = await getUserPlanStatus(user.id);
    let instanceCount = (await listInstancesForUser(user.id)).length;
    
    const refreshContext = async () => {
      planStatus = await getUserPlanStatus(user.id);
      instanceCount = (await listInstancesForUser(user.id)).length;
    };
    
              const hasActivePlan = () => Boolean(planStatus.plan) && planStatus.status === "active";
    
    let subscriptionPromptSent = false;
    let instanceReminderSent = false;
    
              const ensurePlan = async (): Promise<boolean> => {
                if (hasActivePlan()) {
                  return true;
                }
                if (!subscriptionPromptSent) {
                  await sendAdminSubscriptionMenu({ webhook: credentials, to: from, user, config });
                  subscriptionPromptSent = true;
                }
                return false;
              };
    
              const ensureInstances = async (): Promise<boolean> => {
                if (!(await ensurePlan())) {
                  return false;
                }
                if (instanceCount > 0) {
                  return true;
                }
                if (!instanceReminderSent) {
                  await sendAdminInstanceSetupReminder({ webhook: credentials, to: from, appUrl });
                  instanceReminderSent = true;
                }
                return false;
              };
    
              // Garante sessão do bot administrativo (para gerenciar fluxos)
              await upsertAdminBotSession(from, user.id);
    
              // Fluxo principal
              if (msg.interactive?.type === "button_reply") {
                const replyToId = (() => {
                  try {
                    const raw = msg as any;
                    const ctx = raw?.context || {};
                    const id = (ctx.id || ctx.message_id || "").trim();
                    return id;
                  } catch { return ""; }
                })();
                const id = msg.interactive?.button_reply?.id?.trim() ?? "";
                const title = msg.interactive?.button_reply?.title?.trim() ?? "";
    
                if (!id) {
                  await sendAdminUnknownOptionMessage({ webhook: credentials, to: from });
                  return;
                }
    
                if (id === ADMIN_FLOW_BUTTON_IDS.cancel) {
                  await updateAdminBotSessionFlow(from, null);
                  await sendTextMessage({ webhook: credentials, to: from, text: "Operação cancelada." });
                  return;
                }
    
                if (id === ADMIN_MENU_BUTTON_IDS.panel) {
                  if (!(await ensurePlan())) {
                    return;
                  }
                  await sendAdminPanelMenu({
                    webhook: credentials,
                    to: from,
                    availability: {
                      canManageInstances: true,
                      canManageGroups: hasActivePlan(),
                    },
                  });
                  return;
                }
                if (id === ADMIN_MENU_BUTTON_IDS.home) {
                  const statusNow = await getUserPlanStatus(user.id);
                  await sendAdminMainMenu({
                    webhook: credentials,
                    to: from,
                    user,
                    config,
                    extraInfo: {
                      number: (user.whatsappNumber || from),
                      planExpiresAt: statusNow.currentPeriodEnd,
                      planName: statusNow.plan?.name ?? null,
                    },
                  });
                  return;
                }
    
                if (id === ADMIN_GROUP_BUTTON_IDS.back) {
                  await sendAdminGroupListMenu({ webhook: credentials, to: from, user });
                  return;
                }
    
                // Detalhe do grupo: excluir (botão reply)
                if (id.startsWith(ADMIN_GROUP_DELETE_PREFIX)) {
                  const groupId = Number.parseInt(id.slice(ADMIN_GROUP_DELETE_PREFIX.length), 10);
                  if (Number.isFinite(groupId)) {
                    await sendAdminGroupDeletionPrompt({ webhook: credentials, to: from, groupId });
                  } else {
                    await sendAdminGroupListMenu({ webhook: credentials, to: from, user });
                  }
                  return;
                }
    
                // Detalhe do grupo: editar (botão reply)
                if (id.startsWith(ADMIN_GROUP_EDIT_PREFIX)) {
                  const groupId = Number.parseInt(id.slice(ADMIN_GROUP_EDIT_PREFIX.length), 10);
                  if (Number.isFinite(groupId)) {
                    const group = await getGroupByIdForUser(user.id, groupId);
                    if (group) {
                      await sendAdminGroupEditPrompt({ webhook: credentials, to: from, group });
                      await updateAdminBotSessionFlow(from, { name: "group_switch_input", groupId });
                    } else {
                      await sendAdminGroupListMenu({ webhook: credentials, to: from, user });
                    }
                  }
                  return;
                }
    
                if (id === ADMIN_MENU_BUTTON_IDS.subscription) {
                  const status = await getUserPlanStatus(user.id);
                  if (!status.plan) {
                    await sendAdminPlanList({ webhook: credentials, to: from, config });
                  } else {
                    await sendAdminSubscriptionMenu({ webhook: credentials, to: from, user, config });
                  }
                  await refreshContext();
                  return;
                }
    
                if (id === ADMIN_MENU_BUTTON_IDS.support) {
                  const url = config.supportUrl?.trim() || getAppBaseUrl();
                  const buttonLabel = (config.supportButtonText || "Suporte").trim() || "Suporte";
                  const planStatus = await getUserPlanStatus(user.id);
                  const planRenewLabel = planStatus.currentPeriodEnd
                    ? formatDate(
                        typeof planStatus.currentPeriodEnd === "string"
                          ? planStatus.currentPeriodEnd
                          : planStatus.currentPeriodEnd.toISOString(),
                      )
                    : "Sem plano ativo";
                  const planNameLabel =
                    planStatus.plan?.name?.trim() || "Sem plano ativo";
                  const baseReplacements = {
                    "{{user_first_name}}":
                      (user.name?.trim().split(/\s+/)[0] ?? user.name ?? "").trim(),
                    "{{user_name}}": user.name ?? "",
                    "{{user_number}}": (user.whatsappNumber || from)?.trim?.() ?? "",
                    "{{push_name}}": contactName?.trim() || "",
                    "{{plan_renews_at}}": planRenewLabel,
                    "{{plan_name}}": planNameLabel,
                  } satisfies Record<string, string>;
                  const renderText = (template?: string | null) => {
                    if (!template) return "";
                    return applyConfigTokens(template, config, baseReplacements).trim();
                  };
                  const bodyMessage =
                    renderText(config.supportCtaBodyText) ||
                    renderText(config.menuFooterText ?? "") ||
                    "Toque no botão abaixo para abrir o suporte no site e falar com a nossa equipe.";
                  const footerText =
                    renderText(config.supportCtaFooterText ?? "") ||
                    config.botName?.trim() ||
                    undefined;

                  await sendInteractiveCtaUrlMessage({
                    webhook: credentials,
                    to: from,
                    bodyText: bodyMessage,
                    buttonText: buttonLabel,
                    buttonUrl: url,
                    footerText,
                  });
                  return;
                }
    
                if (id === ADMIN_SUBSCRIPTION_BUTTON_IDS.renew) {
                  const status = await getUserPlanStatus(user.id);
                  if (status.plan) {
                    await sendAdminPlanPayment({ webhook: credentials, to: from, user, plan: status.plan });
                  } else {
                    await sendAdminPlanList({ webhook: credentials, to: from, config });
                  }
                  await refreshContext();
                  return;
                }
    
                if (id === ADMIN_SUBSCRIPTION_BUTTON_IDS.change || id === ADMIN_SUBSCRIPTION_BUTTON_IDS.start) {
                  await sendAdminPlanList({ webhook: credentials, to: from, config });
                  await refreshContext();
                  return;
                }
    
                if (id === ADMIN_SUBSCRIPTION_BUTTON_IDS.details) {
                  const status = await getUserPlanStatus(user.id);
                  await sendAdminPlanDetails({ webhook: credentials, to: from, status, config });
                  return;
                }
    
                // Confirmação/Cancelamento de exclusão de grupo (botões)
                if (id.startsWith(ADMIN_GROUP_CONFIRM_DELETE_PREFIX)) {
                  const groupId = Number.parseInt(id.slice(ADMIN_GROUP_CONFIRM_DELETE_PREFIX.length), 10);
                  if (Number.isFinite(groupId)) {
                    await handleAdminGroupDeletion({ webhook: credentials, to: from, user, groupId });
                  } else {
                    await sendAdminUnknownOptionMessage({ webhook: credentials, to: from });
                  }
                  return;
                }
                if (id.startsWith(ADMIN_GROUP_CANCEL_DELETE_PREFIX)) {
                  await sendAdminGroupDeletionList({ webhook: credentials, to: from, user });
                  return;
                }
    
                const parsedButtonInstance = parseAdminInstanceAction(id);
                if (parsedButtonInstance) {
                  if (parsedButtonInstance.action === "confirmDelete") {
                    if (!(await ensureInstances())) {
                      return;
                    }
                    await handleAdminInstanceDeletion({ webhook: credentials, to: from, user, instanceId: parsedButtonInstance.instanceId });
                    await refreshContext();
                    instanceReminderSent = false;
                    await sendAdminInstanceListMenu({ webhook: credentials, to: from, user });
                    return;
                  }
                  if (parsedButtonInstance.action === "cancelDelete") {
                    if (!(await ensurePlan())) {
                      return;
                    }
                    await sendAdminInstanceActionsMenu({ webhook: credentials, to: from, user, instanceId: parsedButtonInstance.instanceId });
                    return;
                  }
                }
    
                // Pagamento do plano: alguns provedores podem devolver como button_reply
                if (
                  id.startsWith(ADMIN_PLAN_PAY_PIX_PREFIX) ||
                  id.startsWith(ADMIN_PLAN_PAY_POLOPAG_PREFIX) ||
                  id.startsWith(ADMIN_PLAN_PAY_CHECKOUT_PREFIX)
                ) {
                  const methodFromId = resolvePlanPaymentMethod(id, title);
                  const prefix = id.startsWith(ADMIN_PLAN_PAY_CHECKOUT_PREFIX)
                    ? ADMIN_PLAN_PAY_CHECKOUT_PREFIX
                    : id.startsWith(ADMIN_PLAN_PAY_POLOPAG_PREFIX)
                      ? ADMIN_PLAN_PAY_POLOPAG_PREFIX
                      : ADMIN_PLAN_PAY_PIX_PREFIX;
                  const planId = Number.parseInt(id.slice(prefix.length), 10);
                  if (Number.isFinite(planId)) {
                    const plan = await getSubscriptionPlanById(planId);
                    if (plan) {
                      await sendAdminPlanPayment({
                        webhook: credentials,
                        to: from,
                        user,
                        plan,
                        method: methodFromId ?? "mercadopago_pix",
                      });
                      await updateAdminBotSessionFlow(from, { name: "plan_payment_method_pick", planId });
                      return;
                    }
                  }
                  // Se o id não trouxe o plano, tenta mapear pelo replyToId
                  if (replyToId) {
                    const mappedPlanId = await (await import("lib/admin-message-context")).findPlanIdByReplyMessageId(replyToId);
                    if (mappedPlanId) {
                      const plan = await getSubscriptionPlanById(mappedPlanId);
                      if (plan) {
                        await sendAdminPlanPayment({
                          webhook: credentials,
                          to: from,
                          user,
                          plan,
                          method: methodFromId ?? "mercadopago_pix",
                        });
                        await updateAdminBotSessionFlow(from, { name: "plan_payment_method_pick", planId: mappedPlanId });
                        return;
                      }
                    }
                  }
                }

                // Fallback usando título com sessão ativa
                if ((!id && title) || replyToId) {
                  const planSession = await getAdminBotSession(from);
                  const mappedPlanId = replyToId
                    ? await (await import("lib/admin-message-context")).findPlanIdByReplyMessageId(replyToId)
                    : null;
                  if (mappedPlanId || planSession?.flowState?.name === "plan_payment_method_pick") {
                    const inferredMethod = resolvePlanPaymentMethod(id, title) ?? resolvePlanPaymentMethod("", title);
                    const planId = mappedPlanId ?? planSession!.flowState!.planId;
                    const plan = Number.isFinite(planId) ? await getSubscriptionPlanById(planId) : null;
                    if (plan) {
                      await sendAdminPlanPayment({
                        webhook: credentials,
                        to: from,
                        user,
                        plan,
                        method: inferredMethod ?? "mercadopago_pix",
                      });
                      await updateAdminBotSessionFlow(from, { name: "plan_payment_method_pick", planId });
                      return;
                    }
                  }
                }

                await sendAdminUnknownOptionMessage({ webhook: credentials, to: from });
                return;
              }
    
              if (msg.interactive?.type === "list_reply") {
                const id = msg.interactive?.list_reply?.id?.trim() ?? "";
                const title = msg.interactive?.list_reply?.title?.trim() ?? "";
                const replyToId = (() => {
                  try {
                    const raw = msg as any;
                    const ctx = raw?.context || {};
                    const id = (ctx.id || ctx.message_id || "").trim();
                    return id;
                  } catch { return ""; }
                })();

                const mappedPlanId = replyToId
                  ? await (await import("lib/admin-message-context")).findPlanIdByReplyMessageId(replyToId)
                  : null;

                // Tratamento de pagamento: somente se o id tiver prefixos de pagamento
                // ou se o reply fizer referência ao picker salvo (mapping por messageId)
                if (
                  id.startsWith(ADMIN_PLAN_PAY_PIX_PREFIX) ||
                  id.startsWith(ADMIN_PLAN_PAY_POLOPAG_PREFIX) ||
                  id.startsWith(ADMIN_PLAN_PAY_CHECKOUT_PREFIX) ||
                  (replyToId && mappedPlanId)
                ) {
                  const paymentSession = await getAdminBotSession(from);
                  const planId =
                    mappedPlanId
                    ?? (paymentSession?.flowState?.name === "plan_payment_method_pick"
                      ? paymentSession.flowState.planId
                      : null);
                  if (planId) {
                    const plan = await getSubscriptionPlanById(planId);
                    if (plan) {
                      const method =
                        resolvePlanPaymentMethod(id, title) ??
                        resolvePlanPaymentMethod("", title) ??
                        "mercadopago_pix";
                      await sendAdminPlanPayment({ webhook: credentials, to: from, user, plan, method });
                      await updateAdminBotSessionFlow(from, { name: "plan_payment_method_pick", planId });
                      return;
                    }
                  }
                }
    
                if (id === ADMIN_PANEL_LIST_IDS.groups) {
                  if (!(await ensurePlan())) {
                    return;
                  }
                  await sendAdminGroupActionsMenu({ webhook: credentials, to: from });
                  return;
                }
                if (id === ADMIN_PANEL_LIST_IDS.instances) {
                  if (!(await ensurePlan())) {
                    return;
                  }
                  await sendAdminInstanceListMenu({ webhook: credentials, to: from, user });
                  return;
                }
                if (id === ADMIN_PANEL_LIST_IDS.web) {
                  await sendAdminWebPanelLink({ webhook: credentials, to: from });
                  return;
                }
                if (id === ADMIN_PANEL_LIST_IDS.back) {
                  if (!(await ensurePlan())) {
                    return;
                  }
                  await sendAdminMainMenu({ webhook: credentials, to: from, user, config });
                  return;
                }
    
                if (id === ADMIN_INSTANCE_LIST_IDS.create) {
                  if (!(await ensurePlan())) {
                    return;
                  }
                  await sendAdminInstanceCreateServerPicker({ webhook: credentials, to: from });
                  return;
                }
    
                if (id === ADMIN_INSTANCE_LIST_IDS.back) {
                  if (!(await ensurePlan())) {
                    return;
                  }
                  await sendAdminPanelMenu({
                    webhook: credentials,
                    to: from,
                    availability: {
                      canManageInstances: true,
                      canManageGroups: hasActivePlan(),
                    },
                  });
                  return;
                }
    
                if (id.startsWith(ADMIN_INSTANCE_NEXT_PREFIX)) {
                  const page = Number.parseInt(id.slice(ADMIN_INSTANCE_NEXT_PREFIX.length), 10);
                  if (Number.isFinite(page) && page > 0) {
                    await sendAdminInstanceListMenu({ webhook: credentials, to: from, user, page });
                  } else {
                    await sendAdminInstanceListMenu({ webhook: credentials, to: from, user });
                  }
                  return;
                }
    
                if (id.startsWith(ADMIN_INSTANCE_CREATE_SERVER_PREFIX)) {
                  const serverId = Number.parseInt(id.slice(ADMIN_INSTANCE_CREATE_SERVER_PREFIX.length), 10);
                  if (Number.isFinite(serverId)) {
                    await sendAdminInstanceCreatePhonePrompt({ webhook: credentials, to: from, serverId });
                  } else {
                    await sendAdminInstanceCreateServerPicker({ webhook: credentials, to: from });
                  }
                  return;
                }
    
                const instanceRowId = parseAdminInstanceRowId(id);
                if (instanceRowId !== null) {
                  if (!(await ensureInstances())) {
                    return;
                  }
                  await sendAdminInstanceActionsMenu({ webhook: credentials, to: from, user, instanceId: instanceRowId });
                  return;
                }
    
                const instanceAction = parseAdminInstanceAction(id);
                if (instanceAction) {
                  if (instanceAction.action === "back") {
                    if (!(await ensurePlan())) {
                      return;
                    }
                    await sendAdminInstanceListMenu({ webhook: credentials, to: from, user });
                    return;
                  }
    
                  if (!(await ensureInstances())) {
                    return;
                  }
    
                  switch (instanceAction.action) {
                    case "status":
                      await sendAdminInstanceStatusMessage({ webhook: credentials, to: from, user, instanceId: instanceAction.instanceId });
                      break;
                    case "reconnect":
                      await handleAdminInstanceSessionAction({ webhook: credentials, to: from, user, instanceId: instanceAction.instanceId, action: "reconnect" });
                      break;
                    case "disconnect":
                      await handleAdminInstanceSessionAction({ webhook: credentials, to: from, user, instanceId: instanceAction.instanceId, action: "disconnect" });
                      break;
                    case "connect":
                      await handleAdminInstanceSessionAction({ webhook: credentials, to: from, user, instanceId: instanceAction.instanceId, action: "connect" });
                      break;
                    case "pair":
                      await sendAdminInstancePairingMessage({ webhook: credentials, to: from, user, instanceId: instanceAction.instanceId });
                      break;
                    case "delete":
                      await sendAdminInstanceDeletionPrompt({ webhook: credentials, to: from, user, instanceId: instanceAction.instanceId });
                      break;
                    default:
                      await sendAdminUnknownOptionMessage({ webhook: credentials, to: from });
                      break;
                  }
                  return;
                }
    
                if (Object.values(ADMIN_GROUP_ACTION_LIST_IDS).includes(id as (typeof ADMIN_GROUP_ACTION_LIST_IDS)[keyof typeof ADMIN_GROUP_ACTION_LIST_IDS])) {
                  if (!(await ensurePlan())) {
                    return;
                  }
                  if (id === ADMIN_GROUP_ACTION_LIST_IDS.back) {
                    await sendAdminPanelMenu({
                      webhook: credentials,
                      to: from,
                      availability: {
                        canManageInstances: true,
                        canManageGroups: hasActivePlan(),
                      },
                    });
                  } else if (id === ADMIN_GROUP_ACTION_LIST_IDS.list) {
                    await sendAdminGroupListMenu({ webhook: credentials, to: from, user });
                  } else if (id === ADMIN_GROUP_ACTION_LIST_IDS.create) {
                    await sendAdminGroupCreateInstancePicker({ webhook: credentials, to: from, user });
                  } else if (id === ADMIN_GROUP_ACTION_LIST_IDS.remove) {
                    await sendAdminGroupDeletionList({ webhook: credentials, to: from, user });
                  }
                  return;
                }
    
                // Grupo: paginação e seleção
                if (id.startsWith(ADMIN_GROUP_NEXT_PREFIX)) {
                  const page = Number.parseInt(id.slice(ADMIN_GROUP_NEXT_PREFIX.length), 10);
                  if (Number.isFinite(page) && page > 0) {
                    await sendAdminGroupListMenu({ webhook: credentials, to: from, user, page });
                  } else {
                    await sendAdminGroupListMenu({ webhook: credentials, to: from, user });
                  }
                  return;
                }
                if (id.startsWith(ADMIN_GROUP_ROW_PREFIX)) {
                  const groupId = Number.parseInt(id.slice(ADMIN_GROUP_ROW_PREFIX.length), 10);
                  if (Number.isFinite(groupId)) {
                    await syncGroupInfo(user.id, groupId).catch(() => {});
                    const group = await getGroupByIdForUser(user.id, groupId);
                    if (group) {
                      await sendAdminGroupDetailsMessage({ webhook: credentials, to: from, group, header: "Grupo selecionado" });
                    } else {
                      await sendTextMessage({ webhook: credentials, to: from, text: "Grupo não encontrado." });
                    }
                  } else {
                    await sendAdminGroupListMenu({ webhook: credentials, to: from, user });
                  }
                  return;
                }
                if (id.startsWith(ADMIN_GROUP_CREATE_INSTANCE_PREFIX)) {
                  const instanceId = Number.parseInt(id.slice(ADMIN_GROUP_CREATE_INSTANCE_PREFIX.length), 10);
                  if (Number.isFinite(instanceId)) {
                    await sendAdminGroupCreatePromptForInstance({ webhook: credentials, to: from, instanceId });
                  } else {
                    await sendAdminGroupCreateInstancePicker({ webhook: credentials, to: from, user });
                  }
                  return;
                }
                if (id.startsWith(ADMIN_GROUP_DELETE_PREFIX)) {
                  const groupId = Number.parseInt(id.slice(ADMIN_GROUP_DELETE_PREFIX.length), 10);
                  if (Number.isFinite(groupId)) {
                    await sendAdminGroupDeletionPrompt({ webhook: credentials, to: from, groupId });
                  } else {
                    await sendAdminGroupDeletionList({ webhook: credentials, to: from, user });
                  }
                  return;
                }
    
                if (id.startsWith(ADMIN_GROUP_DELETE_NEXT_PREFIX)) {
                  const page = Number.parseInt(id.slice(ADMIN_GROUP_DELETE_NEXT_PREFIX.length), 10);
                  if (Number.isFinite(page) && page > 0) {
                    await sendAdminGroupDeletionList({ webhook: credentials, to: from, user, page });
                  } else {
                    await sendAdminGroupDeletionList({ webhook: credentials, to: from, user });
                  }
                  return;
                }
    
                // Botões de confirmação/cancelamento de exclusão
                if (id.startsWith(ADMIN_GROUP_CONFIRM_DELETE_PREFIX)) {
                  const groupId = Number.parseInt(id.slice(ADMIN_GROUP_CONFIRM_DELETE_PREFIX.length), 10);
                  if (Number.isFinite(groupId)) {
                    await handleAdminGroupDeletion({ webhook: credentials, to: from, user, groupId });
                  }
                  return;
                }
                if (id.startsWith(ADMIN_GROUP_CANCEL_DELETE_PREFIX)) {
                  await sendAdminGroupDeletionList({ webhook: credentials, to: from, user });
                  return;
                }
    
                if (id.startsWith(ADMIN_PLAN_ROW_PREFIX)) {
                  const numeric = Number.parseInt(id.slice(ADMIN_PLAN_ROW_PREFIX.length), 10);
                  if (Number.isFinite(numeric)) {
                    const plan = await getSubscriptionPlanById(numeric);
                    if (plan) {
                      await sendAdminPlanPayment({ webhook: credentials, to: from, user, plan });
                    } else {
                      await sendTextMessage({
                        webhook: credentials,
                        to: from,
                        text: "Plano não encontrado. Abra o painel web para concluir.",
                      });
                    }
                  } else {
                    await sendAdminUnknownOptionMessage({ webhook: credentials, to: from });
                  }
                  await refreshContext();
                  return;
                }

                if (
                  id.startsWith(ADMIN_PLAN_PAY_PIX_PREFIX) ||
                  id.startsWith(ADMIN_PLAN_PAY_POLOPAG_PREFIX) ||
                  id.startsWith(ADMIN_PLAN_PAY_CHECKOUT_PREFIX)
                ) {
                  const methodFromId = resolvePlanPaymentMethod(id, title);
                  const prefix = id.startsWith(ADMIN_PLAN_PAY_CHECKOUT_PREFIX)
                    ? ADMIN_PLAN_PAY_CHECKOUT_PREFIX
                    : id.startsWith(ADMIN_PLAN_PAY_POLOPAG_PREFIX)
                      ? ADMIN_PLAN_PAY_POLOPAG_PREFIX
                      : ADMIN_PLAN_PAY_PIX_PREFIX;
                  const planId = Number.parseInt(id.slice(prefix.length), 10);
                  if (Number.isFinite(planId)) {
                    const plan = await getSubscriptionPlanById(planId);
                    if (plan) {
                      await sendAdminPlanPayment({
                        webhook: credentials,
                        to: from,
                        user,
                        plan,
                        method: methodFromId ?? "mercadopago_pix",
                      });
                      // Mantém o contexto do plano selecionado para reuso do mesmo seletor antigo
                      await updateAdminBotSessionFlow(from, { name: "plan_payment_method_pick", planId });
                    } else {
                      await sendTextMessage({
                        webhook: credentials,
                        to: from,
                        text: "Plano não encontrado. Abra o painel web para concluir.",
                      });
                    }
                  } else {
                    await sendAdminUnknownOptionMessage({ webhook: credentials, to: from });
                  }
                  return;
                }

                // Fallback: alguns provedores não retornam o id da linha (apenas o título)
                if (!id && title) {
                  const paymentSession = await getAdminBotSession(from);
                  if (paymentSession?.flowState?.name === "plan_payment_method_pick") {
                    const inferredMethod = resolvePlanPaymentMethod(id, title) ?? resolvePlanPaymentMethod("", title);
                    const planId = paymentSession.flowState.planId;
                    const plan = Number.isFinite(planId) ? await getSubscriptionPlanById(planId) : null;
                    if (plan) {
                      await sendAdminPlanPayment({
                        webhook: credentials,
                        to: from,
                        user,
                        plan,
                        method: inferredMethod ?? "mercadopago_pix",
                      });
                      // Mantém o contexto para reutilização do mesmo seletor
                      await updateAdminBotSessionFlow(from, { name: "plan_payment_method_pick", planId });
                      return;
                    }
                  }
                }

                await sendAdminUnknownOptionMessage({ webhook: credentials, to: from });
                return;
              }

              // Mensagem de texto comum → sempre exibe o menu principal.
    
              const pushName = (() => {
                try {
                  const c = Array.isArray(value.contacts) ? value.contacts[0] : null;
                  const p = c?.profile?.name || c?.profile?.Name;
                  return typeof p === 'string' ? p : null;
                } catch { return null; }
              })();
    
              // Verifica se há fluxo em andamento para cadastro de grupo
              const activeSession = await getAdminBotSession(from);
              // Fluxo: criar instância (coleta do número)
              if (activeSession?.flowState?.name === "instance_create_phone_input") {
                const textBody = (msg.text?.body || '').replace(/\D+/g, '').trim();
                if (!textBody || textBody.length < 10) {
                  await sendTextMessage({ webhook: credentials, to: from, text: "Envie o número no formato DDI+DDD+Número (ex.: 559295333643)." });
                  return;
                }
                try {
                  const instance = await createInstanceForUser(user.id, { serverId: activeSession.flowState.serverId, phone: textBody, name: textBody });
                  await updateAdminBotSessionFlow(from, null);
                  await sendTextMessage({ webhook: credentials, to: from, text: `✅ Instância criada: ${instance.name} (${instance.phone}).` });
                  await sendAdminInstanceActionsMenu({ webhook: credentials, to: from, user, instanceId: instance.id });
                } catch (e) {
                  const message = (e as Error)?.message || 'Não foi possível criar a instância.';
                  await sendTextMessage({ webhook: credentials, to: from, text: `⚠️ ${message}` });
                }
                return;
              }
              if (activeSession?.flowState?.name === "group_create_input") {
                const textBody = (msg.text?.body || '').trim();
                const invite = textBody;
                const looksLikeInvite = /https?:\/\/chat\.whatsapp\.com\//i.test(invite);
                if (!looksLikeInvite) {
                  await sendTextMessage({ webhook: credentials, to: from, text: "Envie um link de convite válido do WhatsApp (https://chat.whatsapp.com/...). Ou toque em Cancelar." });
                  return;
                }
                try {
                  const created = await createGroupForUser(user.id, { instanceId: activeSession.flowState.instanceId, invite });
                  await updateAdminBotSessionFlow(from, null);
                  await sendAdminGroupDetailsMessage({ webhook: credentials, to: from, group: created, header: "✅ Grupo cadastrado" });
                } catch (e) {
                  const message = (e as Error)?.message || 'Não foi possível cadastrar o grupo.';
                  await sendTextMessage({ webhook: credentials, to: from, text: message });
                }
                return;
              }
    
              // Fluxo: trocar grupo (editar) — aguarda novo link e aplica sem perder configurações
              if (activeSession?.flowState?.name === "group_switch_input") {
                const textBody = (msg.text?.body || '').trim();
                const invite = textBody;
                const looksLikeInvite = /https?:\/\/chat\.whatsapp\.com\//i.test(invite);
                if (!looksLikeInvite) {
                  await sendTextMessage({ webhook: credentials, to: from, text: "Envie um link válido do WhatsApp (https://chat.whatsapp.com/...). Ou toque em Cancelar." });
                  return;
                }
                try {
                  const updated = await updateGroupInviteForUser(user.id, activeSession.flowState.groupId, invite);
                  await updateAdminBotSessionFlow(from, null);
                  await sendAdminGroupDetailsMessage({ webhook: credentials, to: from, group: updated, header: "✅ Grupo atualizado" });
                } catch (e) {
                  const message = (e as Error)?.message || 'Não foi possível atualizar o grupo.';
                  await sendTextMessage({ webhook: credentials, to: from, text: message });
                }
                return;
              }
    
              // Comandos de texto (ex.: /addgroup <instanceId> <link>)
              const textBody = (msg.text?.body || '').trim();
              if (textBody.startsWith('/addgroup')) {
                const m = textBody.match(/^\/addgroup\s+(\d+)\s+(\S+)/i);
                if (!m) {
                  await sendTextMessage({ webhook: credentials, to: from, text: 'Formato inválido. Use: /addgroup <ID_DA_INSTANCIA> <link>' });
                } else {
                  const instanceId = Number.parseInt(m[1], 10);
                  const invite = m[2];
                  try {
                    const created = await createGroupForUser(user.id, { instanceId, invite });
                    await sendAdminGroupDetailsMessage({ webhook: credentials, to: from, group: created, header: "✅ Grupo cadastrado" });
                  } catch (e) {
                    const message = (e as Error)?.message || 'Não foi possível cadastrar o grupo.';
                    await sendTextMessage({ webhook: credentials, to: from, text: message });
                  }
                }
                return;
              }
    
              const statusNow = await getUserPlanStatus(user.id);
              await sendAdminMainMenu({
                webhook: credentials,
                to: from,
                user,
                config,
                extraInfo: {
                  number: (user.whatsappNumber || from),
                  pushName,
                  planExpiresAt: statusNow.currentPeriodEnd,
                  planName: statusNow.plan?.name ?? null,
                },
              });
            
  };

          try {
            await processMessage();
          } catch (error) {
            markError();
            console.error("[Admin Meta Webhook] Falha ao processar mensagem", error);
          } finally {
            if (messageId) {
              await sendReactionSafely(finalReaction);
            }
          }
        }
      }
    }
  };

  try {
    await handleEntries();
  } catch (error) {
    console.error("[Admin Meta Webhook] Falha ao processar evento", error);
  }

  return new Response("ok");
}
