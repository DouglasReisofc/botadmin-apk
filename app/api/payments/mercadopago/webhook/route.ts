import { NextResponse } from "next/server";

import { sendAdminOperationalText } from "lib/admin-operational-instance";
import { creditCustomerBalanceByWhatsapp } from "lib/customers";
import { fetchMercadoPagoPayment } from "lib/mercadopago";
import {
  getMercadoPagoCheckoutConfigForUser,
  getMercadoPagoPixConfigForUser,
  getPaymentConfirmationConfigForUser,
  getPaymentChargeByProviderPaymentId,
  updatePaymentChargeStatus,
} from "lib/payments";
import { sendPaymentConfirmationMessage, sendInteractiveReplyButtonsMessage, getAppBaseUrl as getCommonAppBaseUrl } from "lib/meta";
import { getUserBasicById, getSessionUserById, increaseUserBalance } from "lib/users";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  sendBalanceTopUpNotification,
  sendCustomerBalanceCreditNotification,
  sendApiRequestPurchaseNotification,
  notifyAdminsOfPlanAddon,
  notifyAdminsOfApiRequestPurchase,
} from "lib/notifications";
import {
  getPlanPaymentByProviderPaymentId,
  getPlanPaymentByExternalReference,
  updatePlanPaymentStatus,
} from "lib/plan-payments";
import {
  getBalancePaymentByProviderPaymentId,
  updateBalancePaymentStatus,
} from "lib/balance-payments";
import {
  getAdminMercadoPagoCheckoutConfig,
  getAdminMercadoPagoPixConfig,
} from "lib/admin-payments";
import {
  processBotResaleApprovedPayment,
  resolvePlanPaymentAccessToken,
} from "lib/bot-resale-payments";
import { creditBotAdminAffiliateCommissionForPayment } from "lib/bot-admin-affiliates";
import { activateUserPlan, getSubscriptionPlanById, getUserPlanStatus, grantPlanAddons, getUserPlanAddons } from "lib/plans";
import type { PlanCheckoutAddonLine, PlanCheckoutBreakdown } from "types/plans";
import { getAdminBotConfig } from "lib/admin-bot-config";
import { ADMIN_MENU_BUTTON_IDS } from "lib/admin-bot";
import { markRaffleTicketsPaidByCharge, announceRafflePaymentToGroups } from "lib/user-raffles";
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
import {
  getPartnerMercadoPagoAccessToken,
  getPartnerCreditOrderByReference,
  processPartnerCreditPayment,
} from "lib/partner-payments";

const extractPaymentIdFromResource = (resource: unknown): string | null => {
  if (typeof resource !== "string" || resource.trim().length === 0) {
    return null;
  }

  const trimmed = resource.trim();
  const segments = trimmed.split("/");
  const lastSegment = segments.pop();

  if (!lastSegment) {
    return null;
  }

  return lastSegment;
};

const PLAN_PAYMENT_TYPE_PURCHASE = "plan_purchase";
const PLAN_PAYMENT_TYPE_ADDON = "plan_addon";

const parseMetadataRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
};

const resolvePlanPaymentType = (value: unknown): string => {
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
    console.error("[Mercado Pago Webhook] Falha ao aplicar licença do grupo após pagamento", {
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
    console.error("[Mercado Pago Webhook] Falha ao aplicar licença do perfil após pagamento", {
      userId,
      instanceId,
      paymentReference,
      error,
    });
    throw error;
  }
};

const extractPaymentId = (request: Request, body: unknown): string | null => {
  const url = new URL(request.url);
  const queryId = url.searchParams.get("id");
  if (queryId && queryId.trim()) {
    return queryId.trim();
  }

  if (body && typeof body === "object") {
    const data = body as Record<string, unknown>;

    const directId = data.id ?? data["payment_id"] ?? data["data_id"];
    if (typeof directId === "string" && directId.trim()) {
      return directId.trim();
    }

    if (typeof directId === "number" && Number.isFinite(directId)) {
      return String(directId);
    }

    const dataNode = data.data as Record<string, unknown> | undefined;
    if (dataNode) {
      const nestedId = dataNode.id ?? dataNode["payment_id"];
      if (typeof nestedId === "string" && nestedId.trim()) {
        return nestedId.trim();
      }
      if (typeof nestedId === "number" && Number.isFinite(nestedId)) {
        return String(nestedId);
      }
    }

    if (typeof data.resource === "string") {
      const extracted = extractPaymentIdFromResource(data.resource);
      if (extracted) {
        return extracted;
      }
    }
  }

  return null;
};

export async function GET(request: Request) {
  console.info('[Mercado Pago Webhook] GET', request.url);
  // Alguns eventos do Mercado Pago chegam via GET com query param id.
  // Para reaproveitar a lógica do POST, despachamos internamente um POST
  // para este mesmo endpoint quando houver id na URL.
  try {
    const url = new URL(request.url);
    const id = (url.searchParams.get('id') || url.searchParams.get('payment_id') || '').trim();
    if (id) {
      const payload = { id };
      console.info('[Mercado Pago Webhook] GET forwarding as POST', payload);
      await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch((error) => console.error('[Mercado Pago Webhook] GET forward failed', error));
      return NextResponse.json({ message: 'Mercado Pago webhook (GET->POST) processado.' });
    }
    return NextResponse.json({ message: 'Mercado Pago webhook ativo.' });
  } catch (error) {
    console.error('[Mercado Pago Webhook] GET error', error);
    return NextResponse.json({ message: 'Mercado Pago webhook ativo.' });
  }
}

export async function POST(request: Request) {
  console.info('[Mercado Pago Webhook] POST', request.url);
  try {
    const body = await request.json().catch(() => null);
    const logSummary = body && typeof body === 'object'
      ? JSON.stringify(body).slice(0, 2000)
      : body;
    if (logSummary) {
      console.info('[Mercado Pago Webhook] Payload', logSummary);
    }
    const paymentId = extractPaymentId(request, body);

    if (!paymentId) {
      console.warn('[Mercado Pago Webhook] Nenhum paymentId identificado');
      return NextResponse.json({ message: "Evento ignorado." });
    }

    // Pagamentos de marketplace podem chegar pelo token da conta vendedora,
    // informado de forma não sensível na URL de notificação. Buscamos o
    // pagamento antes de localizar a cobrança para também reconciliar
    // preferências cujo ID ainda não foi substituído pelo ID do pagamento.
    const webhookUrl = new URL(request.url);
    const hintedSellerId = Number(webhookUrl.searchParams.get("partner_seller_user_id") || 0);
    let hintedToken: string | null = hintedSellerId > 0
      ? await getPartnerMercadoPagoAccessToken(hintedSellerId)
      : null;
    if (!hintedToken) {
      const adminConfig = await getAdminMercadoPagoCheckoutConfig();
      hintedToken = adminConfig.isConfigured ? adminConfig.accessToken : null;
    }
    let hintedPayment: Awaited<ReturnType<typeof fetchMercadoPagoPayment>> | null = null;
    if (hintedToken) {
      hintedPayment = await fetchMercadoPagoPayment({ accessToken: hintedToken, paymentId }).catch((error) => {
        console.warn("[Mercado Pago Webhook] Não foi possível consultar pagamento com token inicial", error);
        return null;
      });
    }
    const hintedExternalReference = hintedPayment?.raw && typeof hintedPayment.raw.external_reference === "string"
      ? hintedPayment.raw.external_reference
      : null;
    if (hintedExternalReference?.startsWith("partner-credit:")) {
      const order = await getPartnerCreditOrderByReference(hintedExternalReference);
      if (order) {
        const processed = await processPartnerCreditPayment({
          externalReference: hintedExternalReference,
          paymentId,
          status: hintedPayment?.status ?? "unknown",
          statusDetail: hintedPayment?.statusDetail,
        });
        return NextResponse.json({ message: processed?.approved ? "Créditos adicionados." : "Pagamento de créditos atualizado." });
      }
    }

    const charge = await getPaymentChargeByProviderPaymentId(paymentId);

    if (!charge) {
      const planPayment = await getPlanPaymentByProviderPaymentId(paymentId)
        || (hintedExternalReference ? await getPlanPaymentByExternalReference(hintedExternalReference) : null);
      if (planPayment) {
        let accessToken: string | null = null;

        if (planPayment.provider === "mercadopago_pix") {
          let planMetadata: Record<string, unknown> | null = null;
          if (planPayment.metadata) {
            try {
              planMetadata = JSON.parse(planPayment.metadata) as Record<string, unknown>;
            } catch {
              planMetadata = null;
            }
          }
          const partnerSellerUserId = Number(planMetadata?.partnerSellerUserId ?? planMetadata?.seller_user_id ?? 0);
          accessToken = partnerSellerUserId > 0
            ? await getPartnerMercadoPagoAccessToken(partnerSellerUserId)
            : await resolvePlanPaymentAccessToken(planMetadata, Number(planPayment.user_id));
          if (!accessToken) {
            console.warn("[Mercado Pago Webhook] Token Pix indisponível para pagamento de plano");
            return NextResponse.json({ message: "Configuração indisponível." });
          }
        } else if (planPayment.provider === "mercadopago_checkout") {
          const metadataForToken = planPayment.metadata ? parseMetadataRecord(planPayment.metadata) : null;
          const partnerSellerUserId = Number(metadataForToken?.partnerSellerUserId ?? metadataForToken?.seller_user_id ?? 0);
          accessToken = partnerSellerUserId > 0
            ? await getPartnerMercadoPagoAccessToken(partnerSellerUserId)
            : null;
          if (!accessToken) {
            const config = await getAdminMercadoPagoCheckoutConfig();
            accessToken = config.isConfigured ? config.accessToken : null;
          }
          if (!accessToken) {
            console.warn("[Mercado Pago Webhook] Configuração checkout admin indisponível");
            return NextResponse.json({ message: "Configuração indisponível." });
          }
        } else {
          console.warn("[Mercado Pago Webhook] Provedor de plano não suportado", planPayment.provider);
          return NextResponse.json({ message: "Provedor não suportado." });
        }

        const payment = hintedPayment ?? await fetchMercadoPagoPayment({ accessToken, paymentId });

        const normalizedStatus = payment.status.toLowerCase();
        const previousStatus = String(planPayment.status || '').toLowerCase();

        let existingMetadata: Record<string, unknown> | null = null;
        if (planPayment.metadata) {
          try {
            existingMetadata = JSON.parse(planPayment.metadata);
          } catch {
            existingMetadata = null;
          }
        }

        // Pagamentos antigos podiam ser marcados como aprovados antes de a
        // validade do perfil ser realmente aplicada. Em eventos repetidos,
        // reconcilia esse perfil uma única vez usando o marcador persistido.
        if (previousStatus === 'approved' && normalizedStatus === 'approved') {
          const plan = await getSubscriptionPlanById(planPayment.plan_id);
          const appliedProfileLicense = await maybeApplyProfileLicenseFromPlanPayment(
            Number(planPayment.user_id),
            existingMetadata,
            plan,
            planPayment.provider_payment_id,
          );
          if (appliedProfileLicense) {
            await refreshBasePlanGroupLicensesForUser(Number(planPayment.user_id));
            return NextResponse.json({ message: 'Licença do perfil reconciliada.' });
          }
          console.info('[Mercado Pago Webhook] Pagamento de plano já aprovado anteriormente. Ignorando evento duplicado.', paymentId);
          return NextResponse.json({ message: 'Pagamento já aprovado (ignorado).' });
        }

        const mergedMetadata = {
          ...(existingMetadata ?? {}),
          lastStatus: {
            status: payment.status,
            statusDetail: payment.statusDetail ?? null,
            syncedAt: new Date().toISOString(),
          },
        };

        const updatedPayment = await updatePlanPaymentStatus(
          planPayment.provider_payment_id,
          payment.status,
          payment.statusDetail ?? null,
          mergedMetadata,
        );

        if (normalizedStatus === "approved" && updatedPayment && previousStatus !== 'approved') {
          let paymentMetadata: Record<string, unknown> | null = null;
          if (updatedPayment.metadata) {
            try {
              paymentMetadata = JSON.parse(updatedPayment.metadata);
            } catch {
              paymentMetadata = null;
            }
          }

          const paymentTypeRaw = paymentMetadata && typeof paymentMetadata === "object"
            ? paymentMetadata["paymentType"] ?? paymentMetadata["type"]
            : null;
          let paymentType = resolvePlanPaymentType(paymentTypeRaw);
          const externalRef = paymentMetadata && typeof paymentMetadata === 'object'
            ? (paymentMetadata as any).externalReference
            : null;
          if (typeof externalRef === 'string' && externalRef.trim().toLowerCase().startsWith('plan-addon:')) {
            paymentType = PLAN_PAYMENT_TYPE_ADDON;
          }

          const breakdown = paymentMetadata && typeof paymentMetadata === "object"
            ? (paymentMetadata["breakdown"] as PlanCheckoutBreakdown | undefined)
            : undefined;

          const isBotResalePayment =
            paymentMetadata?.resale === true && paymentType === PLAN_PAYMENT_TYPE_PURCHASE;

	          if (isBotResalePayment) {
	            const plan = await getSubscriptionPlanById(updatedPayment.plan_id);
	            const appliedGroupLicense = await maybeApplyGroupLicenseFromPlanPayment(
	              updatedPayment.user_id,
	              paymentMetadata,
	              plan,
	              updatedPayment.provider_payment_id,
	            );
	            const appliedProfileLicense = await maybeApplyProfileLicenseFromPlanPayment(
	              updatedPayment.user_id,
	              paymentMetadata,
	              plan,
	              updatedPayment.provider_payment_id,
	            );
	            if (appliedProfileLicense) {
	              await refreshBasePlanGroupLicensesForUser(updatedPayment.user_id);
	            }

	            await processBotResaleApprovedPayment({
	              userId: updatedPayment.user_id,
              planPaymentId: updatedPayment.provider_payment_id,
              amount: Number.parseFloat(String(updatedPayment.amount ?? 0)) || 0,
              metadata: paymentMetadata,
            });

            console.info(
              "[Mercado Pago Webhook] Venda do robô processada",
              JSON.stringify({
	                userId: updatedPayment.user_id,
	                planId: updatedPayment.plan_id,
	                payoutMode: paymentMetadata?.resalePayoutMode ?? "split",
	                appliedGroupLicense: Boolean(appliedGroupLicense),
	                appliedProfileLicense: Boolean(appliedProfileLicense),
	              }),
	            );

            return NextResponse.json({ message: "Venda do robô processada." });
          }

          if (paymentType === PLAN_PAYMENT_TYPE_ADDON) {
            const addonLines = Array.isArray(breakdown?.addons)
              ? (breakdown?.addons as PlanCheckoutAddonLine[])
              : [];

            if (addonLines.length > 0) {
              const addonExpiresAtValue = paymentMetadata && typeof paymentMetadata === "object"
                ? paymentMetadata["addonExpiresAt"]
                : null;
              const subscriptionFromMetadata = paymentMetadata && typeof paymentMetadata === "object" && typeof paymentMetadata["subscriptionId"] === "number"
                ? Number(paymentMetadata["subscriptionId"])
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

              const effectiveSubscriptionId =
                updatedPayment.subscription_id
                ?? subscriptionFromMetadata
                ?? planStatusSnapshot.subscriptionId
                ?? null;

              // Idempotência: não cria duas vezes para o mesmo pagamento
              const existing = await getUserPlanAddons(updatedPayment.user_id, { includeExpired: true });
              const alreadyGranted = existing.some((addon) => {
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
                  payment.status,
                  payment.statusDetail ?? null,
                  undefined,
                  effectiveSubscriptionId,
                );
              }

              const user = await getUserBasicById(updatedPayment.user_id);

              if (plan && user) {
                const instanceAddon = addonLines.find((line) => line.type === "instance");
                const groupAddon = addonLines.find((line) => line.type === "group");

                const parts: string[] = [];
                if (instanceAddon && instanceAddon.quantity > 0) {
                  parts.push(`${instanceAddon.quantity} instância(s)`);
                }
                if (groupAddon && groupAddon.quantity > 0) {
                  parts.push(`${groupAddon.quantity} grupo(s)`);
                }
                const summaryText = parts.length > 0 ? parts.join(" e ") : "add-ons";

                if (!alreadyGranted) {
                  const addonsTotal =
                    typeof breakdown?.addonsTotal === "number"
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
                }

                try {
                  const userDigits = await getSessionUserById(updatedPayment.user_id);
                  const to = userDigits?.whatsappNumber?.replace(/[^0-9]/g, "") ?? null;
                  const sender = (adminWebhook?.phone_number_id && adminWebhook?.access_token)
                    ? { access_token: adminWebhook.access_token, phone_number_id: adminWebhook.phone_number_id }
                    : null;
                  // Só envia confirmação de add-ons se não tinham sido concedidos ainda (evita duplicidade)
                  if (to && !alreadyGranted) {
                        const base = getCommonAppBaseUrl();
                        const expiresLabel = addonExpiresAtDate
                          ? new Intl.DateTimeFormat("pt-BR").format(addonExpiresAtDate)
                          : "o término do ciclo atual";
                        const config = await getAdminBotConfig();
                        const headerText = (config.addonConfirmHeaderText || "Add-ons ativados").slice(0, 60);
                        const bodyTemplate = config.addonConfirmBodyText || "🧩 Add-ons ativados com sucesso!\n• Itens: {{addons_summary}}\n• Validade: {{addon_expires_at}}\n\nUse o botão abaixo para gerenciar seus recursos.";
                        const body = bodyTemplate
                          .replace(/\{\{addons_summary\}\}/gi, summaryText)
                          .replace(/\{\{addon_expires_at\}\}/gi, expiresLabel);
                        const buttonText = (config.addonConfirmButtonText || "Abrir painel").slice(0, 20);
                        const addonRawUrl = config.addonConfirmMediaUrl
                          ? (config.addonConfirmMediaUrl.startsWith("http")
                            ? config.addonConfirmMediaUrl
                            : `${base.replace(/\/$/, '')}/${config.addonConfirmMediaUrl.replace(/^\//, '')}`)
                          : undefined;
                        const addonImageUrl = addonRawUrl && /^https?:/i.test(addonRawUrl) && !/localhost|127\.0\.0\.1/i.test(addonRawUrl) ? addonRawUrl : undefined;
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
                  } else {
                    console.warn("[Mercado Pago Webhook] Destinatário ausente ou add-on já concedido. Mensagem não enviada.");
                  }
                } catch (e) {
                  console.error("[Mercado Pago Webhook] Falha ao enviar confirmação de add-ons pelo bot", e);
                }
              }

              console.info(
                "[Mercado Pago Webhook] Add-ons do plano ativados",
                JSON.stringify({
                  userId: updatedPayment.user_id,
                  planId: updatedPayment.plan_id,
                  addons: addonLines,
                }),
              );
            }

            return NextResponse.json({ message: "Add-ons do plano processados." });
          }

          if (typeof externalRef === "string" && externalRef.trim().toLowerCase().startsWith("plan-addon:")) {
            console.warn("[Mercado Pago Webhook] Pagamento identificado como add-on (fallback)", externalRef);
            return NextResponse.json({ message: "Pagamento de add-on processado." });
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
              payment.status,
              payment.statusDetail ?? null,
              undefined,
              subscriptionId,
            );
          }

          if (breakdown && Array.isArray(breakdown?.addons) && breakdown.addons.length > 0) {
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
            const paidAmount = Number(breakdown?.totalAmount ?? plan.price);
            const affiliateCredit = await creditBotAdminAffiliateCommissionForPayment({
              buyerUserId: updatedPayment.user_id,
              planPaymentId: updatedPayment.provider_payment_id,
              amount: Number.isFinite(paidAmount) ? paidAmount : 0,
              metadata: {
                planId: plan.id,
                planName: plan.name,
                buyerUserId: user.id,
                buyerEmail: user.email,
                sourcePaymentProvider: updatedPayment.provider,
              },
            }).catch((error) => {
              console.error("[Mercado Pago Webhook] Falha ao creditar afiliado BotAdmin", error);
              return null;
            });

            if (affiliateCredit?.credited) {
              console.info(
                "[Mercado Pago Webhook] Comissão Bot Admin afiliados creditada",
                JSON.stringify({
                  referrerUserId: affiliateCredit.referrerUserId,
                  buyerUserId: user.id,
                  amount: affiliateCredit.amount,
                  planId: plan.id,
                }),
              );
            }

            await notifyPlanPaymentCompleted({
              userId: user.id,
              planName: plan.name,
              amount: paidAmount,
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
                const dueLabel = periodEnd ? new Intl.DateTimeFormat("pt-BR").format(new Date(periodEnd)) : null;
                const base = getCommonAppBaseUrl();
                const config = await getAdminBotConfig();
                const headerText = (config.planConfirmHeaderText || "Assinatura confirmada").slice(0, 60);
                const bodyTemplate =
                  config.planConfirmBodyText
                  || "✅ Assinatura confirmada!\n• Plano: {{plan_name}}\n• Valor pago: R$ {{amount}}\n• Novo vencimento: {{new_due_date}}\n\nAcesse o painel pelo botão abaixo para continuar.";
                const body = bodyTemplate
                  .replace(/\{\{plan_name\}\}/gi, plan.name)
                  .replace(/\{\{amount\}\}/gi, Number(amountPaid).toFixed(2))
                  .replace(/\{\{new_due_date\}\}/gi, dueLabel || "—");
                const buttonText = (config.planConfirmButtonText || "Abrir painel").slice(0, 20);
                const planRawUrl = config.planConfirmMediaUrl
                  ? (config.planConfirmMediaUrl.startsWith("http")
                    ? config.planConfirmMediaUrl
                    : `${base.replace(/\/$/, '')}/${config.planConfirmMediaUrl.replace(/^\//, '')}`)
                  : undefined;
                const planImageUrl = planRawUrl && /^https?:/i.test(planRawUrl) && !/localhost|127\.0\.0\.1/i.test(planRawUrl) ? planRawUrl : undefined;
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
              } else {
                console.warn("[Mercado Pago Webhook] Destinatário ausente para confirmação de plano.");
              }
            } catch (e) {
              console.error("[Mercado Pago Webhook] Falha ao enviar confirmação pelo bot", e);
            }
          }

          console.info(
            "[Mercado Pago Webhook] Plano ativado",
            JSON.stringify({ userId: updatedPayment.user_id, planId: updatedPayment.plan_id, status: planStatus }),
          );

          return NextResponse.json({ message: "Pagamento de plano processado." });
        }

        return NextResponse.json({ message: "Pagamento de plano processado." });
      }

      const balancePayment = await getBalancePaymentByProviderPaymentId(paymentId);
      if (balancePayment) {
        let accessToken: string | null = null;

        if (balancePayment.provider === "mercadopago_pix") {
          const config = await getAdminMercadoPagoPixConfig();
          if (!config.isConfigured || !config.accessToken) {
            console.warn("[Mercado Pago Webhook] Configuração Pix admin indisponível");
            return NextResponse.json({ message: "Configuração indisponível." });
          }
          accessToken = config.accessToken;
        } else if (balancePayment.provider === "mercadopago_checkout") {
          const config = await getAdminMercadoPagoCheckoutConfig();
          if (!config.isConfigured || !config.accessToken) {
            console.warn("[Mercado Pago Webhook] Configuração checkout admin indisponível");
            return NextResponse.json({ message: "Configuração indisponível." });
          }
          accessToken = config.accessToken;
        } else {
          console.warn("[Mercado Pago Webhook] Provedor de recarga não suportado", balancePayment.provider);
          return NextResponse.json({ message: "Provedor não suportado." });
        }

        const payment = await fetchMercadoPagoPayment({ accessToken, paymentId });

        const previousStatus = balancePayment.status.toLowerCase();
        const normalizedStatus = payment.status.toLowerCase();

        await updateBalancePaymentStatus(
          balancePayment.provider_payment_id,
          payment.status,
          payment.statusDetail ?? null,
          { raw: payment.raw },
        );

        if (normalizedStatus === "approved" && previousStatus !== "approved") {
          const metadata = parseMetadataRecord(balancePayment.metadata);
          if (metadata?.type === "media_storage_purchase") {
            const storagePlanId = Number(metadata.storagePlanId ?? metadata.storage_plan_id ?? 0);
            await grantUserMediaStorageEntitlement({
              userId: balancePayment.user_id,
              planId: storagePlanId,
              paymentProvider: balancePayment.provider,
              paymentReference: balancePayment.provider_payment_id,
              metadata: {
                ...metadata,
                providerStatus: payment.status,
                providerStatusDetail: payment.statusDetail ?? null,
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
              "[Mercado Pago Webhook] Armazenamento R2 liberado",
              JSON.stringify({
                userId: balancePayment.user_id,
                storagePlanId,
                paymentReference: balancePayment.provider_payment_id,
              }),
            );
            return NextResponse.json({ message: "Armazenamento processado." });
          }

          const amount = Number.parseFloat(balancePayment.amount ?? "0");

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
              "[Mercado Pago Webhook] Saldo do usuário atualizado",
              JSON.stringify({ userId: balancePayment.user_id, amount, newBalance }),
            );
          }
        }

        return NextResponse.json({ message: "Recarga de saldo processada." });
      }

      return NextResponse.json({ message: "Cobrança não localizada." });
    }

    let accessToken: string | null = null;

    if (charge.provider === "mercadopago_pix") {
      const config = await getMercadoPagoPixConfigForUser(charge.userId);

      if (!config.isConfigured || !config.accessToken) {
        console.warn("[Mercado Pago Webhook] Configuração Pix indisponível", charge.userId);
        return NextResponse.json({ message: "Configuração indisponível." });
      }

      accessToken = config.accessToken;
    } else if (charge.provider === "mercadopago_checkout") {
      const config = await getMercadoPagoCheckoutConfigForUser(charge.userId);

      if (!config.isConfigured || !config.accessToken) {
        console.warn("[Mercado Pago Webhook] Configuração de checkout indisponível", charge.userId);
        return NextResponse.json({ message: "Configuração indisponível." });
      }

      accessToken = config.accessToken;
    } else {
      console.warn("[Mercado Pago Webhook] Provedor de cobrança não suportado", charge.provider);
      return NextResponse.json({ message: "Provedor não suportado." });
    }

    const payment = await fetchMercadoPagoPayment({
      accessToken,
      paymentId,
    });

    const normalizedStatus = payment.status.toLowerCase();
    const previousStatus = charge.status.toLowerCase();

    const chargeMetadata = charge.metadata ?? null;
    const skipBalanceCredit = Boolean(
      chargeMetadata && typeof chargeMetadata === "object" && (chargeMetadata as Record<string, unknown>).skipBalanceCredit === true,
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
      status: payment.status,
      statusDetail: payment.statusDetail,
      rawPayload: payment.raw,
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

    if (updatedCharge && normalizedStatus === "approved" && previousStatus !== "approved") {
      await processBotStoreApprovedCharge(updatedCharge).catch((storeError) => {
        console.error(
          "[Mercado Pago Webhook] Falha ao entregar compra da loja",
          storeError,
        );
      });
      if (updatedCharge.metadata && typeof updatedCharge.metadata === "object") {
        try {
          const context = (updatedCharge.metadata as Record<string, unknown>).context as Record<string, unknown> | undefined;
          if (context && typeof context === "object" && context.type === "raffle_purchase") {
            const raffleIdRaw = (context.raffleId ?? (context.raffle_id as unknown)) as unknown;
            const raffleId = Number(raffleIdRaw);
            const quantityRaw = (context.ticketQuantity ?? context.quantity ?? context.tickets) as unknown;
            const quantity = Number(quantityRaw);
            const suggested = (context.suggestedNumbers ?? context.ticketNumbers ?? context.numbers) as unknown;
            const suggestedNumbers = Array.isArray(suggested)
              ? suggested
                  .map((entry) => Number(entry))
                  .filter((entry, index, array) => Number.isFinite(entry) && entry > 0 && array.indexOf(entry) === index)
              : [];
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
                console.error("[Mercado Pago Webhook] Falha ao avisar grupo sobre pagamento de rifa", groupError);
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
                  amount: updatedCharge.amount,
                  customerName: updatedCharge.customerName ?? contextName ?? null,
                  customerWhatsapp: updatedCharge.customerWhatsapp ?? contextWhatsapp ?? null,
                  ticketQuantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
                  raffleTitle: typeof context.raffleTitle === 'string' ? context.raffleTitle : null,
                  ticketNumbers: raffleResult?.numbers ?? null,
                });
              }
            } catch (notifyErr) {
              console.error("[Mercado Pago Webhook] Falha ao notificar compra de rifa", notifyErr);
            }
          } else if (context && typeof context === "object" && context.type === "group_premium_purchase") {
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
                    amount: updatedCharge.amount,
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
                        body: lines.join("\\n"),
                        mentions: memberJid ? [memberJid] : undefined,
                      });
                    }
                  } catch (messageError) {
                    console.error("[Mercado Pago Webhook] Falha ao avisar compra de Premium", messageError);
                  }
                }
              }
            } catch (premiumError) {
              console.error("[Mercado Pago Webhook] Falha ao liberar Premium", premiumError);
            }
          } else if (context && typeof context === "object" && context.type === "api_request_package") {
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
                amount: updatedCharge.amount,
                metadata:
                  updatedCharge.metadata && typeof updatedCharge.metadata === "object"
                    ? (updatedCharge.metadata as Record<string, unknown>)
                    : null,
              });

              if (grantResult.granted) {
                console.info(
                  "[Mercado Pago Webhook] Limite da API creditado",
                  JSON.stringify({
                    userId: updatedCharge.userId,
                    planId: grantResult.plan?.id ?? (Number.isFinite(planId) ? planId : null),
                    requestsAdded: grantResult.requestsAdded,
                    amount: updatedCharge.amount,
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
                      amount: updatedCharge.amount,
                      requestAmount: grantResult.requestsAdded,
                      planName,
                    });
                    await sendPurchaseSupportMessage({
                      userId: user.id,
                      userName: user.name,
                      productName: planName ?? "Pacote de requisições da API",
                      amount: updatedCharge.amount,
                    });
                  }

                  await notifyAdminsOfApiRequestPurchase({
                    amount: updatedCharge.amount,
                    requestAmount: grantResult.requestsAdded,
                    planName,
                    buyerName: purchaserName,
                    buyerEmail: purchaserEmail,
                    buyerUserId: user?.id ?? updatedCharge.userId,
                    paymentReference: updatedCharge.providerPaymentId,
                  });
                } catch (notifyTopupError) {
                  console.error("[Mercado Pago Webhook] Falha ao notificar limite de API", notifyTopupError);
                }
              } else {
                console.warn(
                  "[Mercado Pago Webhook] Pacote de API não creditado",
                  JSON.stringify({
                    userId: updatedCharge.userId,
                    planId: Number.isFinite(planId) ? planId : null,
                    requestAmount: Number.isFinite(requestAmount) ? requestAmount : null,
                  }),
                );
              }
            } catch (apiError) {
              console.error("[Mercado Pago Webhook] Erro ao processar pacote de requisições", apiError);
            }
          }
        } catch (raffleError) {
          console.error("[Mercado Pago Webhook] Falha ao atualizar rifa após pagamento", raffleError);
        }
      }
    }

    if (updatedCharge && creditResult?.success) {
      console.info(
        "[Mercado Pago Webhook] Saldo creditado automaticamente",
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
          console.error(
            "[Mercado Pago Webhook] Falha ao enviar mensagem de confirmação",
            messageError,
          );
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
        console.error(
          "[Mercado Pago Webhook] Falha ao notificar crédito de cliente",
          notificationError,
        );
      }
    }

    return NextResponse.json({ message: "Webhook processado." });
  } catch (error) {
    console.error("[Mercado Pago Webhook] Falha ao processar evento", error);
    return NextResponse.json({ message: "Erro ao processar webhook." }, { status: 500 });
  }
}



