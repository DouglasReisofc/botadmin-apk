import { NextResponse } from "next/server";

import { sendAdminOperationalText } from "lib/admin-operational-instance";
import { creditCustomerBalanceByWhatsapp } from "lib/customers";
import { getAdminPoloPagPixConfig } from "lib/admin-payments";
import {
  getBalancePaymentByProviderPaymentId,
  getBalancePaymentByExternalReference,
  updateBalancePaymentStatus,
} from "lib/balance-payments";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import { getAdminBotConfig } from "lib/admin-bot-config";
import { ADMIN_MENU_BUTTON_IDS } from "lib/admin-bot";
import {
  notifyAdminsOfPlanAddon,
  notifyAdminsOfApiRequestPurchase,
  sendBalanceTopUpNotification,
  sendCustomerBalanceCreditNotification,
  sendPlanAddonConfirmationNotification,
  sendApiRequestPurchaseNotification,
} from "lib/notifications";
import {
  getPoloPagPixChargeByProviderPaymentId,
  getPoloPagPixConfigForUser,
  getPaymentConfirmationConfigForUser,
  updatePaymentChargeStatus,
} from "lib/payments";
import { checkPoloPagPixCharge } from "lib/polopag";
import {
  activateUserPlan,
  getSubscriptionPlanById,
  getUserPlanAddons,
  getUserPlanStatus,
  grantPlanAddons,
} from "lib/plans";
import {
  getPlanPaymentByExternalReference,
  getPlanPaymentByProviderPaymentId,
  updatePlanPaymentStatus,
} from "lib/plan-payments";
import { sendInteractiveReplyButtonsMessage, sendPaymentConfirmationMessage, getAppBaseUrl as getCommonAppBaseUrl } from "lib/meta";
import { getWebhookRowForUser } from "lib/webhooks";
import { getUserBasicById, getSessionUserById, increaseUserBalance } from "lib/users";
import { markRaffleTicketsPaidByCharge, announceRafflePaymentToGroups } from "lib/user-raffles";
import type { PlanCheckoutAddonLine, PlanCheckoutBreakdown } from "types/plans";
import { grantApiRequestPackage } from "lib/api-request-payments";
import { grantPremiumSubscription } from "lib/group-premium";
import { grantUserMediaStorageEntitlement } from "lib/user-media-storage";
import {
  applyGroupLicenseForUser,
  getGroupDispatchContextForUser,
  refreshBasePlanGroupLicensesForUser,
} from "lib/bot-groups";
import { applyInstanceProfileLicenseForUser } from "lib/bot-instances";
import { sendTextMessage } from "lib/wuzapi";
import { sendPurchaseSupportMessage } from "lib/support-automation";
import { processBotStoreApprovedCharge } from "lib/bot-store";
import { notifyPlanPaymentCompleted } from "lib/plan-payment-notifications";

const PLAN_PAYMENT_TYPE_PURCHASE = "plan_purchase" as const;
const PLAN_PAYMENT_TYPE_ADDON = "plan_addon" as const;

const resolvePlanPaymentType = (value: unknown): typeof PLAN_PAYMENT_TYPE_PURCHASE | typeof PLAN_PAYMENT_TYPE_ADDON => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === PLAN_PAYMENT_TYPE_ADDON) {
      return PLAN_PAYMENT_TYPE_ADDON;
    }
    if (normalized === PLAN_PAYMENT_TYPE_PURCHASE || normalized === "plan") {
      return PLAN_PAYMENT_TYPE_PURCHASE;
    }
  }
  return PLAN_PAYMENT_TYPE_PURCHASE;
};

const maybeApplyGroupLicenseFromPlanPayment = async (
  userId: number,
  metadata: Record<string, unknown> | null,
  plan: Awaited<ReturnType<typeof getSubscriptionPlanById>>,
  paymentReference: string,
) => {
  const context = metadata && typeof metadata.context === "object" && metadata.context !== null
    ? (metadata.context as Record<string, unknown>)
    : null;
  const mode = typeof context?.mode === "string" ? context.mode.trim().toLowerCase() : "";
  const groupId = Number(context?.groupId ?? context?.group_id);
	  const isGroupPayment =
	    context?.activateGroupOnApproval === true ||
	    mode === "group_activation" ||
	    mode === "group_renewal";
  if (!context || !isGroupPayment || !plan) {
    return null;
  }

  if (!Number.isFinite(groupId) || groupId <= 0) {
    return null;
  }

  const licenseSource =
    context?.source === "whatsapp_bot_resale" || metadata?.resale === true
      ? "bot_resale"
      : "group_purchase";

  try {
    return await applyGroupLicenseForUser(userId, groupId, plan, paymentReference, {
      licenseSource,
    });
  } catch (error) {
    console.error("[PoloPag Webhook] Falha ao aplicar licença do grupo após pagamento", {
      userId,
      groupId,
      error,
    });
    return null;
  }
};

const maybeApplyProfileLicenseFromPlanPayment = async (
  userId: number,
  metadata: Record<string, unknown> | null,
  plan: Awaited<ReturnType<typeof getSubscriptionPlanById>>,
  paymentReference: string,
) => {
  const context = metadata && typeof metadata.context === "object" && metadata.context !== null
    ? (metadata.context as Record<string, unknown>)
    : null;
  const mode = typeof context?.mode === "string" ? context.mode.trim().toLowerCase() : "";
  const isProfilePayment =
    mode === "instance_renewal" ||
    mode === "instance_creation" ||
    mode === "profile_unlimited";
  if (!context || !isProfilePayment || !plan) {
    return null;
  }

  const fulfillment = metadata?.profileLicenseFulfillment;
  if (fulfillment && typeof fulfillment === "object") {
    const fulfilledReference = String(
      (fulfillment as Record<string, unknown>).paymentReference ?? "",
    );
    if (fulfilledReference === paymentReference) {
      return { alreadyApplied: true };
    }
  }

  const instanceId = Number(context.instanceId ?? context.instance_id);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    throw new Error("Pagamento de perfil aprovado sem identificador de perfil válido.");
  }

  try {
    const applied = await applyInstanceProfileLicenseForUser(userId, instanceId, plan);
    await updatePlanPaymentStatus(paymentReference, "approved", null, {
      ...metadata,
      profileLicenseFulfillment: {
        paymentReference,
        instanceId,
        expiresAt: applied.expiresAt,
        appliedAt: new Date().toISOString(),
      },
    });
    return applied;
  } catch (error) {
    console.error("[PoloPag Webhook] Falha ao aplicar licença do perfil após pagamento", {
      userId,
      instanceId,
      paymentReference,
      error,
    });
    throw error;
  }
};

const normalizeStatus = (status: string | null | undefined): string => {
  if (typeof status !== "string") {
    return "pending";
  }
  const normalized = status.trim().toLowerCase();
  switch (normalized) {
    case "aprovado":
    case "aprovada":
    case "concluida":
    case "concluída":
      return "approved";
    case "expirado":
    case "expirada":
      return "expired";
    case "cancelado":
    case "cancelada":
      return "cancelled";
    case "ativa":
    case "ativo":
    case "pendente":
      return "pending";
    default:
      return normalized || "pending";
  }
};

const pickString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const extractIdentifiers = (payload: Record<string, unknown> | null) => {
  const raw = payload as any;
  const rawPix = raw?.pix as any;

  const txid = pickString(raw?.txid)
    || pickString(rawPix?.txid)
    || pickString(rawPix?.Txid)
    || pickString(raw?.Txid);

  const internalId = pickString(raw?.internalId)
    || pickString(rawPix?.internalId)
    || pickString(rawPix?.InternalId);

  const reference = pickString(raw?.referencia)
    || pickString(rawPix?.referencia)
    || pickString(raw?.reference)
    || pickString(rawPix?.reference);

  return {
    txid,
    internalId,
    reference,
  };
};

const parseMetadata = (metadata: unknown): Record<string, unknown> | null => {
  if (!metadata) {
    return null;
  }

  if (typeof metadata === "object") {
    return metadata as Record<string, unknown>;
  }

  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch (error) {
      console.warn("[PoloPag Webhook] Falha ao converter metadata", error);
      return null;
    }
  }

  return null;
};

const toUniqueNumberList = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const numbers = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);

  return Array.from(new Set(numbers));
};

const ensureTxidLength = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length >= 26 && trimmed.length <= 35 ? trimmed : "";
};

type PlanPaymentRow = NonNullable<Awaited<ReturnType<typeof getPlanPaymentByProviderPaymentId>>>;
type BalancePaymentRow = NonNullable<Awaited<ReturnType<typeof getBalancePaymentByProviderPaymentId>>>;
type ChargeRow = NonNullable<Awaited<ReturnType<typeof getPoloPagPixChargeByProviderPaymentId>>>;

async function handlePlanPayment({
  planPayment,
  txid,
  fallbackTxid,
  payload,
}: {
  planPayment: PlanPaymentRow;
  txid: string;
  fallbackTxid?: string;
  payload: Record<string, unknown> | null;
}): Promise<NextResponse> {
  const adminConfig = await getAdminPoloPagPixConfig();

  if (!adminConfig.isConfigured || !adminConfig.apiKey) {
    console.warn("[PoloPag Webhook] Configuração PoloPag admin indisponível");
    return NextResponse.json({ message: "Configuração indisponível." });
  }

  const baseMetadata = parseMetadata(planPayment.metadata);
  const metadataTxid = ensureTxidLength(pickString(baseMetadata?.txid));
  const txidForCheck = ensureTxidLength(txid) || metadataTxid || ensureTxidLength(fallbackTxid) || ensureTxidLength(planPayment.provider_payment_id);

  if (!txidForCheck) {
    console.warn("[PoloPag Webhook] Não foi possível determinar txid para cobrança de plano", planPayment.provider_payment_id);
    return NextResponse.json({ message: "Cobrança de plano aguardando verificação." });
  }

  let checkInfo;
  try {
    checkInfo = await checkPoloPagPixCharge(adminConfig.apiKey, txidForCheck);
  } catch (error) {
    console.error("[PoloPag Webhook] Falha ao consultar cobrança do plano", error);
    return NextResponse.json({ message: "Falha ao consultar cobrança." });
  }

  const normalizedStatus = normalizeStatus(checkInfo.status);
  const previousStatus = String(planPayment.status ?? "").toLowerCase();

  const mergedMetadata = {
    ...(baseMetadata ?? {}),
    lastStatus: {
      status: checkInfo.status ?? normalizedStatus,
      statusDetail: checkInfo.status ?? null,
      syncedAt: new Date().toISOString(),
    },
    lastPayload: {
      webhook: payload,
      check: checkInfo.raw ?? checkInfo,
    },
  } satisfies Record<string, unknown>;

  const updatedPayment = await updatePlanPaymentStatus(
    planPayment.provider_payment_id,
    normalizedStatus,
    checkInfo.status ?? null,
    mergedMetadata,
    planPayment.subscription_id ?? null,
  );

  if (!updatedPayment) {
    return NextResponse.json({ message: "Pagamento de plano não encontrado." });
  }

  if (normalizedStatus === "approved" && previousStatus === "approved") {
    const paymentMetadata = parseMetadata(updatedPayment.metadata) ?? {};
    const contextualPlan = await getSubscriptionPlanById(updatedPayment.plan_id);
    const appliedProfileLicense = await maybeApplyProfileLicenseFromPlanPayment(
      updatedPayment.user_id,
      paymentMetadata,
      contextualPlan,
      updatedPayment.provider_payment_id,
    );
    if (appliedProfileLicense) {
      await refreshBasePlanGroupLicensesForUser(updatedPayment.user_id);
      return NextResponse.json({ message: "Licença do perfil reconciliada." });
    }
    return NextResponse.json({ message: "Pagamento já aprovado (ignorado)." });
  }

  if (normalizedStatus === "approved" && previousStatus !== "approved") {
    const paymentMetadata = parseMetadata(updatedPayment.metadata) ?? {};
    const paymentTypeRaw = paymentMetadata.paymentType ?? paymentMetadata.type;
    let paymentType = resolvePlanPaymentType(paymentTypeRaw);

    const externalRef = typeof paymentMetadata.externalReference === "string"
      ? paymentMetadata.externalReference.trim().toLowerCase()
      : null;

    if (externalRef && externalRef.startsWith("plan-addon:")) {
      paymentType = PLAN_PAYMENT_TYPE_ADDON;
    }

    const breakdown = paymentMetadata.breakdown as PlanCheckoutBreakdown | undefined;

    if (paymentType === PLAN_PAYMENT_TYPE_ADDON) {
      const addonLines = Array.isArray(breakdown?.addons)
        ? (breakdown?.addons as PlanCheckoutAddonLine[])
        : [];

      if (addonLines.length > 0) {
        const addonExpiresAtValue = paymentMetadata.addonExpiresAt ?? paymentMetadata.addon_expires_at ?? null;
        const subscriptionFromMetadata = typeof paymentMetadata.subscriptionId === "number"
          ? Number(paymentMetadata.subscriptionId)
          : typeof paymentMetadata.subscription_id === "number"
            ? Number(paymentMetadata.subscription_id)
            : null;

        const [planStatusSnapshot, plan, adminWebhook] = await Promise.all([
          getUserPlanStatus(updatedPayment.user_id),
          getSubscriptionPlanById(updatedPayment.plan_id),
          getAdminWebhookRow(),
        ]);

        const addonExpiresAtDate = (() => {
          if (addonExpiresAtValue) {
            const parsed = new Date(String(addonExpiresAtValue));
            if (!Number.isNaN(parsed.getTime())) {
              return parsed;
            }
          }
          if (planStatusSnapshot.currentPeriodEnd) {
            const parsed = new Date(planStatusSnapshot.currentPeriodEnd);
            if (!Number.isNaN(parsed.getTime())) {
              return parsed;
            }
          }
          return null;
        })();

        const effectiveSubscriptionId = updatedPayment.subscription_id
          ?? subscriptionFromMetadata
          ?? planStatusSnapshot.subscriptionId
          ?? null;

        const existingAddons = await getUserPlanAddons(updatedPayment.user_id, { includeExpired: true });
        const alreadyGranted = existingAddons.some((addon) => {
          const metadata =
            addon.metadata && typeof addon.metadata === "object"
              ? (addon.metadata as Record<string, unknown>)
              : null;
          if (!metadata) {
            return false;
          }

          const direct = metadata["paymentReference"];
          if (typeof direct === "string" && direct === updatedPayment.provider_payment_id) {
            return true;
          }

          const list = metadata["paymentReferences"];
          return Array.isArray(list) &&
            list.some((entry) => typeof entry === "string" && entry === updatedPayment.provider_payment_id);
        });

        if (!alreadyGranted) {
          await grantPlanAddons({
            userId: updatedPayment.user_id,
            subscriptionId: effectiveSubscriptionId,
            planId: updatedPayment.plan_id,
            addons: addonLines,
            periodEnd: addonExpiresAtDate ?? null,
            paymentReference: updatedPayment.provider_payment_id,
            source: "addon_purchase",
          });
        }
        await maybeApplyGroupLicenseFromPlanPayment(
          updatedPayment.user_id,
          paymentMetadata,
          plan,
          updatedPayment.provider_payment_id,
        );

        if (effectiveSubscriptionId) {
          await updatePlanPaymentStatus(
            updatedPayment.provider_payment_id,
            normalizedStatus,
            checkInfo.status ?? null,
            undefined,
            effectiveSubscriptionId,
          );
        }

        const user = await getUserBasicById(updatedPayment.user_id);

        if (plan && user) {
          const instanceAddon = addonLines.find((line) => line.type === "instance");
          const groupAddon = addonLines.find((line) => line.type === "group");

          const summaryParts: string[] = [];
          if (instanceAddon && instanceAddon.quantity > 0) {
            summaryParts.push(`${instanceAddon.quantity} instância(s)`);
          }
          if (groupAddon && groupAddon.quantity > 0) {
            summaryParts.push(`${groupAddon.quantity} grupo(s)`);
          }
          const summaryText = summaryParts.length > 0 ? summaryParts.join(" e ") : "add-ons";

          if (!alreadyGranted) {
            const addonsTotal = typeof breakdown?.addonsTotal === "number"
              ? breakdown.addonsTotal
              : addonLines.reduce((acc, addon) => {
                  const totalValue = Number(addon.totalPrice);
                  if (Number.isFinite(totalValue)) {
                    return acc + totalValue;
                  }
                  const unit = Number(addon.unitPrice);
                  const quantity = Number.isFinite(addon.quantity) ? addon.quantity : 0;
                  return acc + quantity * (Number.isFinite(unit) ? unit : 0);
                }, 0);

            await notifyAdminsOfPlanAddon({
              planName: plan.name,
              amount: addonsTotal,
              addonSummary: summaryText,
              buyerName: user.name,
              buyerEmail: user.email,
              buyerUserId: user.id,
              paymentReference: updatedPayment.provider_payment_id,
            });

            await sendPlanAddonConfirmationNotification({
              userId: user.id,
              userName: user.name,
              userEmail: user.email,
              planName: plan.name,
              addonSummary: summaryText,
              amount: addonsTotal,
              addonExpiresAt: addonExpiresAtDate ? addonExpiresAtDate.toISOString() : null,
            });
          }

          try {
            const userDigits = await getSessionUserById(updatedPayment.user_id);
            const to = userDigits?.whatsappNumber?.replace(/[^0-9]/g, "") ?? null;
            const sender = (adminWebhook?.phone_number_id && adminWebhook?.access_token)
              ? { access_token: adminWebhook.access_token, phone_number_id: adminWebhook.phone_number_id }
              : null;

            if (to && !alreadyGranted) {
              const base = getCommonAppBaseUrl();
              const expiresLabel = addonExpiresAtDate
                ? new Intl.DateTimeFormat("pt-BR").format(addonExpiresAtDate)
                : "o término do ciclo atual";
              const config = await getAdminBotConfig();
              const headerText = (config.addonConfirmHeaderText || "Add-ons ativados").slice(0, 60);
              const bodyTemplate = config.addonConfirmBodyText
                || "🧩 Add-ons ativados com sucesso!\n• Itens: {{addons_summary}}\n• Validade: {{addon_expires_at}}\n\nUse o botão abaixo para gerenciar seus recursos.";
              const body = bodyTemplate
                .replace(/\{\{addons_summary\}\}/gi, summaryText)
                .replace(/\{\{addon_expires_at\}\}/gi, expiresLabel);
              const buttonText = (config.addonConfirmButtonText || "Abrir painel").slice(0, 20);
              const addonRawUrl = config.addonConfirmMediaUrl
                ? (config.addonConfirmMediaUrl.startsWith("http")
                  ? config.addonConfirmMediaUrl
                  : `${base.replace(/\/$/, "")}/${config.addonConfirmMediaUrl.replace(/^\//, "")}`)
                : undefined;
              const addonImageUrl = addonRawUrl && /^https?:/i.test(addonRawUrl) && !/localhost|127\.0\.0\.1/i.test(addonRawUrl)
                ? addonRawUrl
                : undefined;

              const operationalSent = await sendAdminOperationalText({
                toDigits: to,
                body: `${body}\n\nPainel: ${base.replace(/\/$/, "")}/dashboard/user`,
              }).catch(() => false);
              if (!operationalSent && sender) {
                await sendInteractiveReplyButtonsMessage({
                  webhook: sender,
                  to,
                  bodyText: body,
                  headerText,
                  headerImageUrl: addonImageUrl,
                  buttons: [{ id: ADMIN_MENU_BUTTON_IDS.home, title: buttonText }],
                });
              }
            } else if (!to || alreadyGranted) {
              console.warn("[PoloPag Webhook] Destinatário ausente ou add-on já concedido. Mensagem não enviada.");
            }
          } catch (botError) {
            console.error("[PoloPag Webhook] Falha ao enviar confirmação de add-ons pelo bot", botError);
          }
        }

        console.info(
          "[PoloPag Webhook] Add-ons do plano ativados",
          JSON.stringify({
            userId: updatedPayment.user_id,
            planId: updatedPayment.plan_id,
            addons: addonLines,
          }),
        );

        return NextResponse.json({ message: "Add-ons do plano processados." });
      }
    }

    const contextualPlan = await getSubscriptionPlanById(updatedPayment.plan_id);
    const appliedGroupLicense = await maybeApplyGroupLicenseFromPlanPayment(
      updatedPayment.user_id,
      paymentMetadata,
      contextualPlan,
      updatedPayment.provider_payment_id,
    );
    if (appliedGroupLicense) {
      if (contextualPlan) {
        await notifyPlanPaymentCompleted({
          userId: updatedPayment.user_id,
          planName: contextualPlan.name,
          amount: Number(breakdown?.totalAmount ?? updatedPayment.amount ?? contextualPlan.price),
          paymentReference: updatedPayment.provider_payment_id,
        });
      }
      return NextResponse.json({ message: "Licença do grupo processada." });
    }

    const appliedProfileLicense = await maybeApplyProfileLicenseFromPlanPayment(
      updatedPayment.user_id,
      paymentMetadata,
      contextualPlan,
      updatedPayment.provider_payment_id,
    );
    if (appliedProfileLicense) {
      await refreshBasePlanGroupLicensesForUser(updatedPayment.user_id);
      if (contextualPlan) {
        await notifyPlanPaymentCompleted({
          userId: updatedPayment.user_id,
          planName: contextualPlan.name,
          amount: Number(breakdown?.totalAmount ?? updatedPayment.amount ?? contextualPlan.price),
          paymentReference: updatedPayment.provider_payment_id,
        });
      }
      return NextResponse.json({ message: "Plano ilimitado do perfil processado." });
    }

    const { status: planStatus, subscriptionId, periodEnd } = await activateUserPlan(
      updatedPayment.user_id,
      updatedPayment.plan_id,
    );
    await refreshBasePlanGroupLicensesForUser(updatedPayment.user_id);

    if (subscriptionId) {
      await updatePlanPaymentStatus(
        updatedPayment.provider_payment_id,
        normalizedStatus,
        checkInfo.status ?? null,
        undefined,
        subscriptionId,
      );
    }

    if (breakdown && Array.isArray(breakdown.addons) && breakdown.addons.length > 0) {
      await grantPlanAddons({
        userId: updatedPayment.user_id,
        subscriptionId,
        planId: updatedPayment.plan_id,
        addons: breakdown.addons,
        periodEnd,
        paymentReference: updatedPayment.provider_payment_id,
      });
    }
    const [plan, user, adminWebhook] = await Promise.all([
      getSubscriptionPlanById(updatedPayment.plan_id),
      getUserBasicById(updatedPayment.user_id),
      getAdminWebhookRow(),
    ]);

    if (plan && user) {
      await notifyPlanPaymentCompleted({
        userId: user.id,
        planName: plan.name,
        amount: breakdown?.totalAmount ?? plan.price,
        paymentReference: updatedPayment.provider_payment_id,
      });

      try {
        const userDigits = await getSessionUserById(updatedPayment.user_id);
        const to = userDigits?.whatsappNumber?.replace(/[^0-9]/g, "") ?? null;
        const sender = (adminWebhook?.phone_number_id && adminWebhook?.access_token)
          ? { access_token: adminWebhook.access_token, phone_number_id: adminWebhook.phone_number_id }
          : null;

        if (to) {
          const amountPaid = breakdown?.totalAmount ?? plan.price;
          const dueLabel = periodEnd ? new Intl.DateTimeFormat("pt-BR").format(new Date(periodEnd)) : "—";
          const base = getCommonAppBaseUrl();
          const config = await getAdminBotConfig();
          const headerText = (config.planConfirmHeaderText || "Assinatura confirmada").slice(0, 60);
          const bodyTemplate = config.planConfirmBodyText
            || "✅ Assinatura confirmada!\n• Plano: {{plan_name}}\n• Valor pago: R$ {{amount}}\n• Novo vencimento: {{new_due_date}}\n\nAcesse o painel pelo botão abaixo para continuar.";
          const body = bodyTemplate
            .replace(/\{\{plan_name\}\}/gi, plan.name)
            .replace(/\{\{amount\}\}/gi, Number(amountPaid).toFixed(2))
            .replace(/\{\{new_due_date\}\}/gi, dueLabel || "—");
          const buttonText = (config.planConfirmButtonText || "Abrir painel").slice(0, 20);
          const planRawUrl = config.planConfirmMediaUrl
            ? (config.planConfirmMediaUrl.startsWith("http")
              ? config.planConfirmMediaUrl
              : `${base.replace(/\/$/, "")}/${config.planConfirmMediaUrl.replace(/^\//, "")}`)
            : undefined;
          const planImageUrl = planRawUrl && /^https?:/i.test(planRawUrl) && !/localhost|127\.0\.0\.1/i.test(planRawUrl)
            ? planRawUrl
            : undefined;

          const operationalSent = await sendAdminOperationalText({
            toDigits: to,
            body: `${body}\n\nPainel: ${base.replace(/\/$/, "")}/dashboard/user`,
          }).catch(() => false);
          if (!operationalSent && sender) {
            await sendInteractiveReplyButtonsMessage({
              webhook: sender,
              to,
              bodyText: body,
              headerText,
              headerImageUrl: planImageUrl,
              buttons: [{ id: ADMIN_MENU_BUTTON_IDS.home, title: buttonText }],
            });
          }
        } else if (!to) {
          console.warn("[PoloPag Webhook] Destinatário ausente para confirmação de plano.");
        }
      } catch (botError) {
        console.error("[PoloPag Webhook] Falha ao enviar confirmação pelo bot", botError);
      }
    }

    console.info(
      "[PoloPag Webhook] Plano ativado",
      JSON.stringify({ userId: updatedPayment.user_id, planId: updatedPayment.plan_id, status: planStatus }),
    );

    return NextResponse.json({ message: "Pagamento de plano processado." });
  }

  return NextResponse.json({ message: "Pagamento de plano processado." });
}

async function handleBalancePayment({
  balancePayment,
  txid,
  fallbackTxid,
  payload,
}: {
  balancePayment: BalancePaymentRow;
  txid: string;
  fallbackTxid?: string;
  payload: Record<string, unknown> | null;
}): Promise<NextResponse> {
  const adminConfig = await getAdminPoloPagPixConfig();

  if (!adminConfig.isConfigured || !adminConfig.apiKey) {
    console.warn("[PoloPag Webhook] Configuração PoloPag admin indisponível (saldo)");
    return NextResponse.json({ message: "Configuração indisponível." });
  }

  const baseMetadata = parseMetadata(balancePayment.metadata);
  const metadataTxid = ensureTxidLength(pickString(baseMetadata?.txid));
  const txidForCheck = ensureTxidLength(txid) || metadataTxid || ensureTxidLength(fallbackTxid) || ensureTxidLength(balancePayment.provider_payment_id);

  if (!txidForCheck) {
    console.warn("[PoloPag Webhook] Txid ausente para recarga", balancePayment.provider_payment_id);
    return NextResponse.json({ message: "Recarga aguardando verificação." });
  }

  let checkInfo;
  try {
    checkInfo = await checkPoloPagPixCharge(adminConfig.apiKey, txidForCheck);
  } catch (error) {
    console.error("[PoloPag Webhook] Falha ao consultar recarga", error);
    return NextResponse.json({ message: "Falha ao consultar recarga." });
  }

  const normalizedStatus = normalizeStatus(checkInfo.status);
  const previousStatus = String(balancePayment.status ?? "").toLowerCase();

  const mergedMetadata = {
    ...(baseMetadata ?? {}),
    lastStatus: {
      status: checkInfo.status ?? normalizedStatus,
      statusDetail: checkInfo.status ?? null,
      syncedAt: new Date().toISOString(),
    },
    lastPayload: {
      webhook: payload,
      check: checkInfo.raw ?? checkInfo,
    },
  } satisfies Record<string, unknown>;

  await updateBalancePaymentStatus(
    balancePayment.provider_payment_id,
    normalizedStatus,
    checkInfo.status ?? null,
    mergedMetadata,
  );

  if (normalizedStatus === "approved" && previousStatus !== "approved") {
    if (baseMetadata?.type === "media_storage_purchase") {
      const storagePlanId = Number(baseMetadata.storagePlanId ?? baseMetadata.storage_plan_id ?? 0);
      await grantUserMediaStorageEntitlement({
        userId: balancePayment.user_id,
        planId: storagePlanId,
        paymentProvider: balancePayment.provider,
        paymentReference: balancePayment.provider_payment_id,
        metadata: {
          ...baseMetadata,
          providerStatus: checkInfo.status ?? normalizedStatus,
        },
      });
      const user = await getUserBasicById(balancePayment.user_id).catch(() => null);
      await sendPurchaseSupportMessage({
        userId: balancePayment.user_id,
        userName: user?.name ?? null,
        productName: "Armazenamento persistente R2",
        amount: balancePayment.amount,
      });
      console.info(
        "[PoloPag Webhook] Armazenamento R2 liberado",
        JSON.stringify({
          userId: balancePayment.user_id,
          storagePlanId,
          paymentReference: balancePayment.provider_payment_id,
        }),
      );
      return NextResponse.json({ message: "Armazenamento processado." });
    }

    const amount = Number.parseFloat(String(balancePayment.amount ?? "0"));

    if (Number.isFinite(amount) && amount > 0) {
      const newBalance = await increaseUserBalance(balancePayment.user_id, amount);
      const user = await getUserBasicById(balancePayment.user_id);

      if (user) {
        await sendBalanceTopUpNotification({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          amount,
          newBalance,
        });
        await sendPurchaseSupportMessage({
          userId: user.id,
          userName: user.name,
          productName: "Recarga de saldo",
          amount,
        });
      }

      console.info(
        "[PoloPag Webhook] Saldo do usuário atualizado",
        JSON.stringify({ userId: balancePayment.user_id, amount, newBalance }),
      );
    }

    return NextResponse.json({ message: "Recarga de saldo processada." });
  }

  return NextResponse.json({ message: "Recarga de saldo processada." });
}

async function handleUserCharge({
  charge,
  txid,
  payload,
}: {
  charge: ChargeRow;
  txid: string;
  payload: Record<string, unknown> | null;
}): Promise<NextResponse> {
  const config = await getPoloPagPixConfigForUser(charge.userId);

  if (!config.isConfigured || !config.apiKey) {
    console.error("[PoloPag Webhook] API key não configurada para usuário", charge.userId);
    return NextResponse.json({ message: "Configuração inválida." });
  }

  const metadataTxid = ensureTxidLength(pickString((charge.metadata as Record<string, unknown> | undefined)?.txid));
  const txidForCheck = ensureTxidLength(txid) || metadataTxid || ensureTxidLength(charge.providerPaymentId);

  if (!txidForCheck) {
    console.warn("[PoloPag Webhook] Txid ausente para cobrança do usuário", charge.publicId);
    return NextResponse.json({ message: "Cobrança aguardando verificação." });
  }

  let checkInfo;
  try {
    checkInfo = await checkPoloPagPixCharge(config.apiKey, txidForCheck);
  } catch (error) {
    console.error("[PoloPag Webhook] Falha ao consultar cobrança", error);
    return NextResponse.json({ message: "Falha ao consultar cobrança." });
  }

  const normalizedStatus = normalizeStatus(checkInfo.status);
  const previousStatus = String(charge.status ?? "").toLowerCase();
  const chargeMetadata = charge.metadata ?? null;
  const skipBalanceCredit = Boolean(
    chargeMetadata
    && typeof chargeMetadata === "object"
    && (chargeMetadata as Record<string, unknown>).skipBalanceCredit === true,
  );

  let creditResult: Awaited<ReturnType<typeof creditCustomerBalanceByWhatsapp>> | null = null;

  if (
    normalizedStatus === "approved"
    && previousStatus !== "approved"
    && charge.customerWhatsapp
    && !skipBalanceCredit
  ) {
    creditResult = await creditCustomerBalanceByWhatsapp(charge.userId, charge.customerWhatsapp, charge.amount, {
      displayName: charge.customerName,
      phoneNumber: charge.customerWhatsapp,
    });
  }

  const updatedCharge = await updatePaymentChargeStatus({
    chargeId: charge.id,
    status: normalizedStatus,
    statusDetail: checkInfo.status ?? null,
    rawPayload: {
      webhook: payload,
      check: checkInfo.raw ?? checkInfo,
    },
    creditResult: creditResult
      ? {
          success: creditResult.success,
          amount: charge.amount,
          balance: creditResult.balance,
          customerId: creditResult.customer?.id ?? null,
          customerWhatsapp: charge.customerWhatsapp,
          creditedAt: new Date().toISOString(),
          reason: creditResult.reason ?? null,
        }
      : undefined,
  });

  if (!updatedCharge) {
    return NextResponse.json({ message: "Cobrança não encontrada." });
  }

  if (normalizedStatus === "approved" && previousStatus !== "approved") {
    await processBotStoreApprovedCharge(updatedCharge).catch((storeError) => {
      console.error("[PoloPag Webhook] Falha ao entregar compra da loja", storeError);
    });
    const context = updatedCharge.metadata?.context as Record<string, unknown> | undefined;
    if (context && context.type === "raffle_purchase") {
      const raffleIdRaw = context.raffleId ?? (context.raffle_id as unknown);
      const raffleId = Number(raffleIdRaw);
      const quantityRaw = context.ticketQuantity ?? context.quantity ?? context.tickets;
      const quantity = Number(quantityRaw);
      const suggested = context.suggestedNumbers ?? context.ticketNumbers ?? context.numbers;
      const suggestedNumbers = toUniqueNumberList(suggested);
      const groupJid = typeof context.groupJid === "string" ? context.groupJid : null;
      const contextName = typeof context.purchaserName === "string" ? context.purchaserName : null;
      const contextWhatsapp = typeof context.purchaserWhatsapp === "string" ? context.purchaserWhatsapp : null;

      const raffleResult = await markRaffleTicketsPaidByCharge({
        userId: updatedCharge.userId,
        chargePublicId: updatedCharge.publicId,
        raffleId: Number.isFinite(raffleId) && raffleId > 0 ? raffleId : undefined,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
        suggestedNumbers,
        customerName: updatedCharge.customerName ?? contextName ?? null,
        customerWhatsapp: updatedCharge.customerWhatsapp ?? contextWhatsapp ?? null,
        groupJid,
      });

      if (raffleResult) {
        announceRafflePaymentToGroups({
          userId: updatedCharge.userId,
          raffle: raffleResult.raffle,
          numbers: raffleResult.numbers,
          customerName: updatedCharge.customerName ?? contextName ?? null,
          customerWhatsapp: updatedCharge.customerWhatsapp ?? contextWhatsapp ?? null,
          groupJid,
          amount: updatedCharge.amount,
        }).catch((groupError) => {
          console.error("[PoloPag Webhook] Falha ao avisar grupo sobre pagamento de rifa", groupError);
        });
      }

      try {
        const user = await getUserBasicById(updatedCharge.userId);
        if (user) {
          const { sendRafflePurchaseNotification } = await import("lib/notifications");
          await sendRafflePurchaseNotification({
            userId: user.id,
            userName: user.name,
            userEmail: user.email ?? null,
            amount: Number(updatedCharge.amount),
            customerName: updatedCharge.customerName ?? contextName ?? null,
            customerWhatsapp: updatedCharge.customerWhatsapp ?? contextWhatsapp ?? null,
            ticketQuantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
            raffleTitle: typeof context.raffleTitle === "string" ? context.raffleTitle : null,
            ticketNumbers: raffleResult?.numbers ?? null,
          });
        }
      } catch (notifyErr) {
        console.error("[PoloPag Webhook] Falha ao notificar compra de rifa", notifyErr);
      }
    } else if (context && context.type === "group_premium_purchase") {
      try {
        const groupIdRaw = (context.groupId ?? context.group_id) as unknown;
        const groupId = Number(groupIdRaw);
        const memberJidRaw =
          typeof context.memberJid === "string"
            ? context.memberJid
            : typeof context.member_jid === "string"
              ? context.member_jid
              : "";
        const memberJid = memberJidRaw.replace(/\D+/g, "");
        const durationDays = Number(context.durationDays ?? context.days ?? 0);
        const planLabel = typeof context.planLabel === "string" ? context.planLabel : "Premium";

        if (Number.isFinite(groupId) && groupId > 0 && memberJid && Number.isFinite(durationDays) && durationDays > 0) {
          const premium = await grantPremiumSubscription({
            groupId,
            memberJid,
            durationDays: Math.floor(durationDays),
          });

          if (premium?.expiresAt) {
            const user = await getUserBasicById(updatedCharge.userId).catch(() => null);
            await sendPurchaseSupportMessage({
              userId: updatedCharge.userId,
              userName: user?.name ?? null,
              productName: `Premium do grupo - ${planLabel}`,
              amount: Number(updatedCharge.amount),
            });

            try {
              const dispatch = await getGroupDispatchContextForUser(updatedCharge.userId, groupId);
              if (dispatch) {
                const mentionHandle = memberJid ? `@${memberJid}` : "";
                const lines = [
                  "✅ Compra de Premium confirmada!",
                  `💎 Plano: ${planLabel}`,
                  `Validade: ${premium.expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
                  mentionHandle ? `👤 ${mentionHandle}` : null,
                ].filter(Boolean) as string[];
                await sendTextMessage(dispatch.client, {
                  to: dispatch.groupJid,
                  body: lines.join("\n"),
                  mentions: memberJid ? [memberJid] : undefined,
                });
              }
            } catch (messageError) {
              console.error("[PoloPag Webhook] Falha ao avisar compra de Premium", messageError);
            }
          }
        }
      } catch (premiumError) {
        console.error("[PoloPag Webhook] Falha ao liberar Premium", premiumError);
      }
    } else if (context && context.type === "api_request_package") {
      try {
        const planIdRaw =
          (context.planId ?? context.plan_id ?? context.packageId ?? context.package_id) as unknown;
        const requestAmountRaw =
          (context.requestAmount ?? context.requests ?? context.quantity ?? context.amount) as unknown;
        const planId = Number(planIdRaw);
        const requestAmount = Number(requestAmountRaw);

        const grantResult = await grantApiRequestPackage({
          userId: updatedCharge.userId,
          provider: updatedCharge.provider,
          providerPaymentId: updatedCharge.providerPaymentId,
          planId: Number.isFinite(planId) && planId > 0 ? planId : undefined,
          requestAmount: Number.isFinite(requestAmount) && requestAmount > 0 ? requestAmount : undefined,
          amount: Number(updatedCharge.amount),
          metadata:
            updatedCharge.metadata && typeof updatedCharge.metadata === "object"
              ? (updatedCharge.metadata as Record<string, unknown>)
              : null,
        });

        if (grantResult.granted) {
          console.info(
            "[PoloPag Webhook] Limite da API creditado",
            JSON.stringify({
              userId: updatedCharge.userId,
              planId: grantResult.plan?.id ?? (Number.isFinite(planId) ? planId : null),
              requestsAdded: grantResult.requestsAdded,
              amount: Number(updatedCharge.amount),
            }),
          );

          try {
            const chargeMetadata =
              updatedCharge.metadata && typeof updatedCharge.metadata === "object"
                ? (updatedCharge.metadata as Record<string, unknown>)
                : null;
            const user = await getUserBasicById(updatedCharge.userId);
            const contextPlanName =
              typeof context.planName === "string"
                ? context.planName
                : typeof chargeMetadata?.planName === "string"
                  ? (chargeMetadata.planName as string)
                  : null;
            const planName = grantResult.plan?.name ?? contextPlanName ?? null;
            const purchaserName =
              user?.name
              || (typeof context.purchaserName === "string" ? context.purchaserName : null)
              || (typeof context.customerName === "string" ? context.customerName : null)
              || null;
            const purchaserEmail =
              user?.email
              || (typeof context.purchaserEmail === "string" ? context.purchaserEmail : null)
              || null;

            if (user) {
              await sendApiRequestPurchaseNotification({
                userId: user.id,
                userName: user.name,
                userEmail: user.email ?? null,
                amount: Number(updatedCharge.amount),
                requestAmount: grantResult.requestsAdded,
                planName,
              });
              await sendPurchaseSupportMessage({
                userId: user.id,
                userName: user.name,
                productName: planName ?? "Pacote de requisições da API",
                amount: Number(updatedCharge.amount),
              });
            }

            await notifyAdminsOfApiRequestPurchase({
              amount: Number(updatedCharge.amount),
              requestAmount: grantResult.requestsAdded,
              planName,
              buyerName: purchaserName,
              buyerEmail: purchaserEmail,
              buyerUserId: user?.id ?? updatedCharge.userId,
              paymentReference: updatedCharge.providerPaymentId,
            });
          } catch (notifyTopupError) {
            console.error("[PoloPag Webhook] Falha ao notificar limite de API", notifyTopupError);
          }
        } else {
          console.warn(
            "[PoloPag Webhook] Pacote de API não creditado",
            JSON.stringify({
              userId: updatedCharge.userId,
              planId: Number.isFinite(planId) ? planId : null,
              requestAmount: Number.isFinite(requestAmount) ? requestAmount : null,
            }),
          );
        }
      } catch (apiError) {
        console.error("[PoloPag Webhook] Erro ao processar pacote de requisições", apiError);
      }
    }
  }

  if (updatedCharge && creditResult?.success) {
    console.info(
      "[PoloPag Webhook] Saldo creditado automaticamente",
      JSON.stringify({
        userId: updatedCharge.userId,
        customerId: creditResult.customer?.id ?? null,
        whatsapp: updatedCharge.customerWhatsapp,
        amount: charge.amount,
      }),
    );

    if (updatedCharge.customerWhatsapp) {
      try {
        const [confirmationConfig, webhookRow] = await Promise.all([
          getPaymentConfirmationConfigForUser(updatedCharge.userId),
          getWebhookRowForUser(updatedCharge.userId),
        ]);

        if (webhookRow) {
          await sendPaymentConfirmationMessage({
            webhook: webhookRow,
            to: updatedCharge.customerWhatsapp,
            config: confirmationConfig,
            amount: charge.amount,
            balance: creditResult.balance,
          });
        }
      } catch (messageError) {
        console.error("[PoloPag Webhook] Falha ao enviar mensagem de confirmação", messageError);
      }
    }

    try {
      const user = await getUserBasicById(updatedCharge.userId);
      if (user) {
        await sendCustomerBalanceCreditNotification({
          userId: user.id,
          userName: user.name,
          userEmail: user.email ?? null,
          amount: charge.amount,
          customerName:
            creditResult.customer?.displayName
            ?? creditResult.customer?.profileName
            ?? updatedCharge.customerName
            ?? null,
          customerWhatsapp: updatedCharge.customerWhatsapp,
          newCustomerBalance: creditResult.balance,
        });
      }
    } catch (notificationError) {
      console.error("[PoloPag Webhook] Falha ao notificar crédito de cliente", notificationError);
    }
  }

  return NextResponse.json({ message: "Webhook processado." });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    const { txid, internalId, reference } = extractIdentifiers(payload);

    if (!txid && !internalId) {
      return NextResponse.json({ message: "Evento ignorado: identificadores ausentes." });
    }

    let charge: ChargeRow | null = txid
      ? await getPoloPagPixChargeByProviderPaymentId(txid)
      : null;
    if (!charge && internalId) {
      charge = await getPoloPagPixChargeByProviderPaymentId(internalId);
    }

    let planPayment: PlanPaymentRow | null = txid
      ? await getPlanPaymentByProviderPaymentId(txid)
      : null;
    if (!planPayment && internalId) {
      planPayment = await getPlanPaymentByProviderPaymentId(internalId);
    }
    if (!planPayment && reference) {
      planPayment = await getPlanPaymentByExternalReference(reference);
    }

    let balancePayment: BalancePaymentRow | null = txid
      ? await getBalancePaymentByProviderPaymentId(txid)
      : null;
    if (!balancePayment && internalId) {
      balancePayment = await getBalancePaymentByProviderPaymentId(internalId);
    }
    if (!balancePayment && reference) {
      balancePayment = await getBalancePaymentByExternalReference(reference);
    }

    if (planPayment) {
      return handlePlanPayment({
        planPayment,
        txid,
        fallbackTxid: internalId,
        payload,
      });
    }

    if (balancePayment) {
      return handleBalancePayment({
        balancePayment,
        txid,
        fallbackTxid: internalId,
        payload,
      });
    }

    if (charge) {
      return handleUserCharge({
        charge,
        txid: txid || internalId,
        payload,
      });
    }

    return NextResponse.json({ message: "Cobrança não localizada." });
  } catch (error) {
    console.error("[PoloPag Webhook] Falha ao processar evento", error);
    return NextResponse.json({ message: "Erro ao processar webhook." }, { status: 500 });
  }
}
