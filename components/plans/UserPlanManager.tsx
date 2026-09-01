"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, Card, Col, Form, Row, Modal } from "react-bootstrap";
import { IconDiamond, IconInfoCircle, IconWallet } from "@tabler/icons-react";

import type {
  PlanAddonSelection,
  PlanCheckoutResponse,
  SubscriptionPlan,
  UserPlanAddon,
  UserPlanLimits,
  UserPlanStatus,
} from "types/plans";
import type { PaymentMethodSummary } from "types/payments";
import type { BotGroup } from "types/bot-groups";
import FloatingAlert from "components/common/FloatingAlert";

type AddonSlot = {
  key: string;
  addonId: number;
  type: "group" | "instance";
  index: number;
  formattedExpiresAt: string | null;
  expiresAt: string | null;
  groupName: string | null;
  groupId: number | null;
  groupSlot: number | null;
  isExpired: boolean;
};

interface UserPlanManagerProps {
  plans: SubscriptionPlan[];
  status: UserPlanStatus;
  userName: string;
  userEmail: string;
  balance: number;
  addons: UserPlanAddon[];
  limits: UserPlanLimits;
  paymentMethods: PaymentMethodSummary[];
  groups: BotGroup[];
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type PendingCheckout = PlanCheckoutResponse & {
  plan: SubscriptionPlan;
};

type PendingAddonCheckout = PlanCheckoutResponse & {
  plan: SubscriptionPlan;
  selections: PlanAddonSelection[];
};

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDateTime = (value: string | null) => {
  if (!value) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const toAddonTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isGroupLicenseActive = (group: BotGroup, status: UserPlanStatus) => {
  const planEnd = toAddonTimestamp(status.currentPeriodEnd ?? null);
  if (status.status === "active" && typeof planEnd === "number" && planEnd > Date.now()) {
    return true;
  }
  const expiresAt = toAddonTimestamp(group.metadata?.licenseExpiresAt ?? null);
  return typeof expiresAt === "number" && expiresAt > Date.now();
};

const sortAddonsByCoverageOrder = (addonList: UserPlanAddon[]) =>
  addonList
    .slice()
    .sort((left, right) => {
      const leftTs = toAddonTimestamp(left.purchasedAt) ?? Number.MAX_SAFE_INTEGER;
      const rightTs = toAddonTimestamp(right.purchasedAt) ?? Number.MAX_SAFE_INTEGER;
      if (leftTs !== rightTs) {
        return leftTs - rightTs;
      }
      return left.id - right.id;
    });

const formatInstanceLimit = (value: number) =>
  value === 0 ? "instâncias ilimitadas" : `${value} instância(s)`;

const formatGroupLimit = (value: number) =>
  value === 0 ? "grupos ilimitados" : `${value} grupo(s)`;

const getStatusBadgeVariant = (status: UserPlanStatus["status"]) => {
  switch (status) {
    case "active":
      return "success";
    case "pending":
      return "warning";
    case "expired":
      return "danger";
    default:
      return "secondary";
  }
};

type PlanPaymentProvider = "mercadopago_pix" | "polopag_pix" | "mercadopago_checkout";

const PROVIDER_PRIORITY: readonly PlanPaymentProvider[] = ["mercadopago_pix", "polopag_pix", "mercadopago_checkout"] as const;

const PROVIDER_LABELS: Record<PlanPaymentProvider, string> = {
  mercadopago_pix: "Pix (Mercado Pago)",
  polopag_pix: "Pix (PoloPag)",
  mercadopago_checkout: "Checkout (cartão/Pix)",
};

const UserPlanManager = ({
  plans,
  status,
  userName,
  userEmail,
  balance,
  addons,
  limits,
  paymentMethods,
  groups,
}: UserPlanManagerProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingPlanCheckout, setPendingPlanCheckout] = useState<PendingCheckout | null>(null);
  const [pendingTopUpCheckout, setPendingTopUpCheckout] = useState<PlanCheckoutResponse | null>(null);
  const [pendingTopUpAmount, setPendingTopUpAmount] = useState<number | null>(null);
  const [topUpProvider, setTopUpProvider] = useState<PlanPaymentProvider>("mercadopago_pix");
  const [topUpAmount, setTopUpAmount] = useState('50');
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<{
    planName: string;
    amount: number;
    dueAt: string | null;
  } | null>(null);
  const [topUpSuccess, setTopUpSuccess] = useState<{
    amountAdded: number;
    newBalance: number;
  } | null>(null);
  const [addonProvider, setAddonProvider] = useState<PlanPaymentProvider>("mercadopago_pix");
  const [pendingAddonCheckout, setPendingAddonCheckout] = useState<PendingAddonCheckout | null>(null);
  const [showAddonModal, setShowAddonModal] = useState(false);
  const [addonSuccess, setAddonSuccess] = useState<{
    summary: string;
    expiresAt: string | null;
  } | null>(null);
  const [addonPlan, setAddonPlan] = useState<SubscriptionPlan | null>(null);
  const [addonQtyInstance, setAddonQtyInstance] = useState('0');
  const [addonQtyGroup, setAddonQtyGroup] = useState('0');

  // Fluxo de renovação/assinatura via modal
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewPlan, setRenewPlan] = useState<SubscriptionPlan | null>(null);
  const [renewOption, setRenewOption] = useState<'plan_only' | 'plan_plus_current_addons' | 'addons_only' | 'plan_custom_addons'>('plan_only');
  const [renewProvider, setRenewProvider] = useState<PlanPaymentProvider>("mercadopago_pix");
  const [renewCustomInstance, setRenewCustomInstance] = useState('0');
  const [renewCustomGroup, setRenewCustomGroup] = useState('0');
  const [renewSelectedSlotKeys, setRenewSelectedSlotKeys] = useState<string[]>([]);

  const providerSummaries = useMemo(() => {
    const map = new Map<PlanPaymentProvider, PaymentMethodSummary>();
    paymentMethods.forEach((summary) => {
      const provider = summary?.provider as PlanPaymentProvider | undefined;
      if (provider && PROVIDER_PRIORITY.includes(provider)) {
        map.set(provider, summary);
      }
    });
    return map;
  }, [paymentMethods]);

  const selectableProviders = useMemo(() => {
    return PROVIDER_PRIORITY.filter((provider) => {
      const summary = providerSummaries.get(provider);
      return Boolean(summary?.isConfigured && summary?.isActive);
    });
  }, [providerSummaries]);

  const selectableProviderSet = useMemo(
    () => new Set<PlanPaymentProvider>(selectableProviders),
    [selectableProviders],
  );

  const defaultProvider = useMemo<PlanPaymentProvider>(
    () => selectableProviders[0] ?? "mercadopago_pix",
    [selectableProviders],
  );

  const paymentProvidersUnavailable = selectableProviders.length === 0;
  const paymentUnavailableMessage =
    "Nenhuma forma de pagamento ativa foi encontrada. Configure um Pix em Pagamentos > Gateways.";

  useEffect(() => {
    if (!selectableProviderSet.has(topUpProvider)) {
      setTopUpProvider(defaultProvider);
    }
    if (!selectableProviderSet.has(addonProvider)) {
      setAddonProvider(defaultProvider);
    }
    if (!selectableProviderSet.has(renewProvider)) {
      setRenewProvider(defaultProvider);
    }
  }, [selectableProviderSet, defaultProvider, topUpProvider, addonProvider, renewProvider]);

  const copyToClipboard = async (text: string, success: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setFeedback({ type: 'success', message: success });
    } catch {
      setFeedback({ type: 'danger', message: 'Não foi possível copiar para a área de transferência.' });
    }
  };

  const computeAddonTotal = (plan: SubscriptionPlan, selections: PlanAddonSelection[]): number =>
    selections.reduce((sum, selection) => {
      const unitPrice = selection.type === "instance" ? plan.addonInstancePrice : 0;
      return sum + unitPrice * selection.quantity;
    }, 0);

  const sanitizeAddonQuantity = (value: string): number =>
    Math.max(0, Number.parseInt(value.replace(/[^0-9]/g, ""), 10) || 0);

  const buildSelectionsFromTotals = (totals: { instance: number; group: number }): PlanAddonSelection[] => {
    const selections: PlanAddonSelection[] = [];
    if (totals.instance > 0) {
      selections.push({ type: "instance", quantity: totals.instance });
    }
    return selections;
  };

  const computeAddonAmountFromTotals = (
    plan: SubscriptionPlan | null,
    totals: { instance: number; group: number },
  ): number => {
    if (!plan) {
      return 0;
    }
    return plan.addonInstancePrice * totals.instance;
  };

  const buildAddonSummaryLabel = (selections: PlanAddonSelection[]): string => {
    const parts = selections
      .filter((selection) => selection.quantity > 0)
      .map((selection) => `${selection.quantity} instância(s)`);
    return parts.length > 0 ? parts.join(" e ") : "sem extras";
  };

  const baseInstanceLimit = status.plan?.instanceLimit ?? 0;
  const baseGroupLimit = 0;

	  const sortedActiveGroups = useMemo(
	    () =>
	      [...groups]
	        .filter((group) => isGroupLicenseActive(group, status))
	        .sort((a, b) => a.slot - b.slot),
	    [groups, status],
	  );

  const extraGroupReferencesByAddonIndex = useMemo(() => {
    const references = new Map<number, BotGroup>();
    if (sortedActiveGroups.length === 0) {
      return references;
    }

    sortedActiveGroups.forEach((group, position) => {
      const storedSlot = Math.floor(Number(group.slot ?? 0));
      const coverageSlot = Number.isFinite(storedSlot) && storedSlot > 0
        ? storedSlot
        : position + 1;
      const addonIndex = baseGroupLimit <= 0 ? coverageSlot : coverageSlot - baseGroupLimit;
      if (addonIndex > 0 && !references.has(addonIndex)) {
        references.set(addonIndex, group);
      }
    });

    return references;
  }, [sortedActiveGroups, baseGroupLimit]);

  const activePlan = status.plan && status.status === "active" ? status.plan : null;
  const activeUntil = formatDateTime(status.currentPeriodEnd);
  const daysRemainingLabel = status.daysRemaining !== null ? `${status.daysRemaining} dia(s)` : null;

  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => a.price - b.price),
    [plans],
  );

  const planIncludedLabel = status.plan
    ? {
        instance: formatInstanceLimit(baseInstanceLimit),
        group: formatGroupLimit(baseGroupLimit),
      }
    : null;

  const addonTotals = useMemo(() => {
    const totals = { instance: 0, group: 0 };
    const expiredTotals = { instance: 0, group: 0 };
    let nearestExpiry: string | null = null;
    let nearestExpiryTime: number | null = null;
    const now = Date.now();

    addons.forEach((addon) => {
      const expiryDate = addon.expiresAt ? new Date(addon.expiresAt) : null;
      const expiryTime = expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate.getTime() : null;
      const isExpired = typeof expiryTime === "number" && expiryTime < now;

      if (isExpired) {
        if (addon.type === "instance") {
          expiredTotals.instance += addon.quantity;
        }
      } else {
        if (addon.type !== "instance") {
          return;
        }
        totals.instance += addon.quantity;
        if (typeof expiryTime === "number" && (nearestExpiryTime === null || expiryTime < nearestExpiryTime)) {
          nearestExpiryTime = expiryTime;
          nearestExpiry = addon.expiresAt;
        }
      }
    });

    const showExpiredNotice = expiredTotals.instance > 0;

    return { totals, nearestExpiry, expiredTotals, showExpiredNotice };
  }, [addons]);

  const addonSlots = useMemo(() => {
    const slots: Record<"group" | "instance", AddonSlot[]> = { group: [], instance: [] };
    const counters: Record<"group" | "instance", number> = { group: 0, instance: 0 };
    const now = Date.now();

    sortAddonsByCoverageOrder(addons).forEach((addon) => {
      if (addon.type !== "instance") {
        return;
      }
      const formattedExpiry = formatDateTime(addon.expiresAt);
      const expiryTime =
        addon.expiresAt && !Number.isNaN(new Date(addon.expiresAt).getTime())
          ? new Date(addon.expiresAt).getTime()
          : null;
      const isExpired = typeof expiryTime === "number" && expiryTime < now;

      for (let slotIndex = 0; slotIndex < addon.quantity; slotIndex += 1) {
        counters[addon.type] += 1;
        const slotNumber = counters[addon.type];
        const groupReference = undefined;
        slots[addon.type].push({
          addonId: addon.id,
          key: `${addon.id}-${slotIndex}`,
          type: addon.type,
          index: slotNumber,
          formattedExpiresAt: formattedExpiry,
          expiresAt: addon.expiresAt,
          groupName: groupReference ? groupReference.name : null,
          groupId: groupReference ? groupReference.id : null,
          groupSlot: groupReference ? groupReference.slot : null,
          isExpired,
        });
      }
    });

    return slots;
  }, [addons, extraGroupReferencesByAddonIndex]);

  const addonSlotList = useMemo(
    () => [...addonSlots.instance],
    [addonSlots],
  );

  const renewCustomTotals = useMemo(
    () => ({
	      instance: sanitizeAddonQuantity(renewCustomInstance),
	      group: 0,
    }),
    [renewCustomInstance],
  );

  const renewSelectedTotals = useMemo(() => {
    if (renewSelectedSlotKeys.length === 0) {
      return { instance: 0, group: 0 };
    }
    const selected = new Set(renewSelectedSlotKeys);
    const totals = { instance: 0, group: 0 };
    addonSlots.instance.forEach((slot) => {
      if (selected.has(slot.key)) {
        totals.instance += 1;
      }
    });
	    return totals;
  }, [renewSelectedSlotKeys, addonSlots]);

  const renewActiveAddonTotals = useMemo(() => {
    if (renewOption === "plan_plus_current_addons" || renewOption === "addons_only") {
      return { ...renewSelectedTotals };
    }
    if (renewOption === "plan_custom_addons") {
      return { ...renewCustomTotals };
    }
    return { instance: 0, group: 0 };
  }, [renewOption, renewSelectedTotals, renewCustomTotals]);

  const renewAddonAmount = useMemo(
    () => computeAddonAmountFromTotals(renewPlan, renewActiveAddonTotals),
    [renewPlan, renewActiveAddonTotals],
  );

  const includesPlanInRenewal = renewOption !== "addons_only";
  const renewPlanAmount = includesPlanInRenewal && renewPlan ? renewPlan.price : 0;
  const renewTotalAmount = renewPlanAmount + renewAddonAmount;

  useEffect(() => {
    setRenewSelectedSlotKeys((previous) => {
      if (previous.length === 0) {
        return previous;
      }
      const allowedKeys = new Set(addonSlotList.map((slot) => slot.key));
      const filtered = previous.filter((key) => allowedKeys.has(key));
      return filtered.length === previous.length ? previous : filtered;
    });
  }, [addonSlotList]);

  const createPlanCheckout = async (
    plan: SubscriptionPlan,
    provider: PlanPaymentProvider,
    addonSelections: PlanAddonSelection[],
  ) => {
    if (!selectableProviderSet.has(provider)) {
      setFeedback({ type: "danger", message: paymentUnavailableMessage });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);
    setPendingPlanCheckout(null);

    try {
      const response = await fetch("/api/user/plan/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, provider, addons: addonSelections }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ type: "danger", message: data.message ?? "Não foi possível gerar o pagamento do plano." });
        setIsProcessing(false);
        return;
      }

      const checkout: PlanCheckoutResponse | undefined = data.checkout;
      if (!checkout) {
        setFeedback({ type: "danger", message: "Resposta inesperada do servidor." });
        setIsProcessing(false);
        return;
      }

      const addonAmount = computeAddonTotal(plan, addonSelections);
      const totalAmount = plan.price + addonAmount;

      const nextCheckout = { ...checkout, plan } as PendingCheckout;
      nextCheckout.amount = checkout.amount ?? totalAmount;
      setPendingPlanCheckout(nextCheckout);
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(
            'plan:pending-payment',
            JSON.stringify({ id: checkout.providerPaymentId, planName: plan.name, amount: totalAmount }),
          );
        }
      } catch {}

      setFeedback({ type: "success", message: "Pagamento criado com sucesso. A confirmação é automática após o pagamento." });
      setShowPlanModal(true);
    } catch (error) {
      console.error("Failed to create plan checkout", error);
      setFeedback({ type: "danger", message: "Falha inesperada ao iniciar a assinatura. Tente novamente em instantes." });
    }

    setIsProcessing(false);
  };

  const openRenewModal = (plan: SubscriptionPlan) => {
    if (paymentProvidersUnavailable) {
      setFeedback({ type: "danger", message: paymentUnavailableMessage });
      return;
    }

    setRenewPlan(plan);
    setRenewOption('plan_only');
    setRenewProvider(defaultProvider);
    setRenewCustomInstance('0');
    setRenewCustomGroup('0');
    setRenewSelectedSlotKeys(addonSlotList.map((slot) => slot.key));
    setShowRenewModal(true);
  };

  const closeRenewModal = () => {
    setShowRenewModal(false);
    setRenewPlan(null);
    setRenewSelectedSlotKeys([]);
  };

  const handleConfirmRenew = async () => {
    if (!renewPlan) return;
    if (renewOption === 'addons_only') {
      if (renewSelectedTotals.instance === 0) {
        setFeedback({
          type: 'danger',
          message: 'Selecione ao menos um extra para renovar ou escolha outra opção.',
        });
        return;
      }
      const selections = buildSelectionsFromTotals(renewSelectedTotals);
      setShowRenewModal(false);
      const created = await generateAddonCheckout({
        plan: renewPlan,
        provider: renewProvider,
        selections,
        successMessage: 'Pagamento dos extras criado com sucesso. A confirmação é automática após o pagamento.',
      });
      if (created) {
        setAddonPlan(renewPlan);
        setAddonProvider(renewProvider);
        setAddonSuccess(null);
        setShowAddonModal(true);
      }
      return;
    }

    const selections: PlanAddonSelection[] = [];
    if (renewOption === 'plan_plus_current_addons') {
      if (renewSelectedTotals.instance === 0) {
        setFeedback({
          type: 'danger',
          message: 'Selecione ao menos um extra para renovar ou escolha outra opção.',
        });
        return;
      }
      selections.push(...buildSelectionsFromTotals(renewSelectedTotals));
    } else if (renewOption === 'plan_custom_addons') {
      selections.push(...buildSelectionsFromTotals(renewCustomTotals));
    }

    setShowRenewModal(false);
    await createPlanCheckout(renewPlan, renewProvider, selections);
  };

  const openAddonModal = (plan: SubscriptionPlan) => {
    if (!activePlan || activePlan.id !== plan.id) {
      setFeedback({ type: 'danger', message: 'Somente o plano ativo pode receber extras adicionais.' });
      return;
    }
    if (paymentProvidersUnavailable) {
      setFeedback({ type: "danger", message: paymentUnavailableMessage });
      return;
    }
    setAddonPlan(plan);
    setAddonQtyInstance('0');
    setAddonQtyGroup('0');
    setAddonProvider(defaultProvider);
    setPendingAddonCheckout(null);
    setAddonSuccess(null);
    setShowAddonModal(true);
  };

  const openTopUpModalManual = () => {
    if (paymentProvidersUnavailable) {
      setFeedback({ type: "danger", message: paymentUnavailableMessage });
      return;
    }

    setShowInfoModal(false);
    setTopUpSuccess(null);
    setPendingTopUpCheckout(null);
    setPendingTopUpAmount(null);
    setTopUpProvider(defaultProvider);
    setTopUpAmount('50');
    setShowTopUpModal(true);
  };

  const generateAddonCheckout = async ({
    plan,
    provider,
    selections,
    successMessage,
  }: {
    plan: SubscriptionPlan;
    provider: PlanPaymentProvider;
    selections: PlanAddonSelection[];
    successMessage?: string;
  }): Promise<boolean> => {
    if (!selectableProviderSet.has(provider)) {
      setFeedback({ type: 'danger', message: paymentUnavailableMessage });
      return false;
    }
    if (selections.length === 0) {
      setFeedback({ type: 'danger', message: 'Informe ao menos um extra válido.' });
      return false;
    }
    if (computeAddonTotal(plan, selections) <= 0) {
      setFeedback({ type: 'danger', message: 'Não há valores configurados para os extras selecionados.' });
      return false;
    }

    setIsProcessing(true);
    setFeedback(null);

    try {
      const response = await fetch('/api/user/plan/addons/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, provider, addons: selections }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ type: 'danger', message: data.message ?? 'Não foi possível gerar o pagamento dos extras.' });
        return false;
      }

      const checkout: PlanCheckoutResponse | undefined = data.checkout;
      if (!checkout) {
        setFeedback({ type: 'danger', message: 'Resposta inesperada do servidor ao preparar os extras.' });
        return false;
      }

      const nextCheckout: PendingAddonCheckout = { ...checkout, plan, selections };
      setPendingAddonCheckout(nextCheckout);
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('addon:pending-payment', JSON.stringify({ id: checkout.providerPaymentId, selections }));
        }
      } catch {}

      if (successMessage || !showAddonModal) {
        setFeedback({
          type: 'success',
          message: successMessage ?? 'Pagamento criado com sucesso. A confirmação é automática após o pagamento.',
        });
      }

      return true;
    } catch (error) {
      console.error('Failed to create addon checkout', error);
      setFeedback({ type: 'danger', message: 'Falha inesperada ao gerar os extras. Tente novamente em instantes.' });
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmAddonCheckout = async () => {
    if (!addonPlan) return;

    const totals = {
      instance: sanitizeAddonQuantity(addonQtyInstance),
      group: 0,
    };
    const addonSelections = buildSelectionsFromTotals(totals);

    if (addonSelections.length === 0) {
      setFeedback({ type: 'danger', message: 'Informe a quantidade de extras adicionais.' });
      return;
    }

    await generateAddonCheckout({
      plan: addonPlan,
      provider: addonProvider,
      selections: addonSelections,
    });
  };

  // O status do plano é carregado do servidor a cada navegação.
  // Mantemos sincronização automática via modais/polling quando há pagamentos em andamento.

  // Feche o modal do plano apenas quando já houver confirmação explícita
  // (evita fechar imediatamente ao renovar um plano que ainda está ativo).
  useEffect(() => {
    if (confirmationMessage && status.status === "active" && pendingPlanCheckout) {
      setPendingPlanCheckout(null);
      setShowPlanModal(false);
      setConfirmationMessage(null);
    }
  }, [status.status, pendingPlanCheckout, confirmationMessage]);

  useEffect(() => {
    setCurrentBalance((previous) => {
      const next = balance;
      if (pendingTopUpCheckout && next > previous) {
        setPendingTopUpCheckout(null);
        setPendingTopUpAmount(null);
        setShowTopUpModal(false);
      }
      return next;
    });
  }, [balance, pendingTopUpCheckout]);

  // Poll plan payment status while the modal is open
  useEffect(() => {
    if (!showPlanModal || !pendingPlanCheckout) return;
    const paymentId = pendingPlanCheckout.providerPaymentId;
    const poll = async () => {
      try {
        const res = await fetch(`/api/user/plan/status?paymentId=${encodeURIComponent(paymentId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({} as any));
        const status = String(data.status || "").toLowerCase();
        if (status === "approved") {
          const planStatus = (data as any).planStatus as UserPlanStatus | undefined;
          const planName = planStatus?.plan?.name ?? pendingPlanCheckout.plan.name;
          const amount = typeof (data as any).amount === "number"
            ? (data as any).amount
            : (pendingPlanCheckout.amount ?? pendingPlanCheckout.plan.price);
          const dueAt = planStatus?.currentPeriodEnd ?? null;

          setPlanSuccess({ planName, amount, dueAt });
          setPendingPlanCheckout(null);
          setConfirmationMessage(null);
          try { if (typeof window !== 'undefined') { window.sessionStorage.removeItem('plan:pending-payment'); } } catch {}
          router.refresh();
        }
      } catch {}
    };

    const interval = setInterval(poll, 5000);
    const kickoff = setTimeout(poll, 2000);
    return () => {
      clearInterval(interval);
      clearTimeout(kickoff);
    };
  }, [showPlanModal, pendingPlanCheckout, router]);

  // Poll addon payment status while the modal is open
  useEffect(() => {
    if (!showAddonModal || !pendingAddonCheckout) return;
    const paymentId = pendingAddonCheckout.providerPaymentId;

    const poll = async () => {
      try {
        const res = await fetch(`/api/user/plan/status?paymentId=${encodeURIComponent(paymentId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({} as any));
        const statusValue = String(data.status || "").toLowerCase();
        if (statusValue === "approved") {
          const addonExpiresAt: string | null = typeof data.addonExpiresAt === "string" ? data.addonExpiresAt : null;
          const summary = buildAddonSummaryLabel(pendingAddonCheckout.selections);

          setAddonSuccess({
            summary,
            expiresAt: addonExpiresAt,
          });
          setPendingAddonCheckout(null);
          setPlanAddonInputs((previous) => ({
            ...previous,
            [pendingAddonCheckout.plan.id]: { instance: "0", group: "0" },
          }));
          try { if (typeof window !== 'undefined') { window.sessionStorage.removeItem('addon:pending-payment'); } } catch {}
          router.refresh();
        }
      } catch {}
    };

    const interval = setInterval(poll, 5000);
    const kickoff = setTimeout(poll, 2000);
    return () => {
      clearInterval(interval);
      clearTimeout(kickoff);
    };
  }, [showAddonModal, pendingAddonCheckout, router]);

  // Preenche dueAt quando atualizado após refresh
  useEffect(() => {
    if (planSuccess && !planSuccess.dueAt && status.currentPeriodEnd) {
      setPlanSuccess({ ...planSuccess, dueAt: status.currentPeriodEnd });
    }
  }, [planSuccess, status.currentPeriodEnd]);

  // Fecha automaticamente o modal do plano após sucesso
  useEffect(() => {
    if (!planSuccess) return;
    const timer = setTimeout(() => {
      closePlanModal();
    }, 1500);
    return () => clearTimeout(timer);
  }, [planSuccess]);

  // Detecta retorno do checkout (?status=success) e reabre modal com confirmação
  useEffect(() => {
    try {
      const statusParam = (searchParams?.get('status') || '').toLowerCase();
      if (statusParam !== 'success') {
        return;
      }

      if (typeof window === 'undefined') {
        return;
      }

      // Tenta plano primeiro
      const planRaw = window.sessionStorage.getItem('plan:pending-payment');
      if (planRaw) {
        const cached = JSON.parse(planRaw) as { id: string; planName?: string; amount?: number };
        const id = String(cached?.id || '').trim();
        if (id) {
          // confirma status do pagamento e exibe modal
          (async () => {
            try {
              const res = await fetch(`/api/user/plan/status?paymentId=${encodeURIComponent(id)}`, { cache: 'no-store' });
              const data = await res.json().catch(() => ({} as any));
              const s = String((data as any).status || '').toLowerCase();
              if (res.ok && s === 'approved') {
                const planName = (data as any).planStatus?.plan?.name || cached.planName || 'Plano';
                const amount = typeof (data as any).amount === 'number' ? (data as any).amount : (cached.amount ?? 0);
                const dueAt = (data as any).planStatus?.currentPeriodEnd || null;
                setPlanSuccess({ planName, amount, dueAt });
                setShowPlanModal(true);
                window.sessionStorage.removeItem('plan:pending-payment');
              }
            } catch {}
          })();
        }
        return; // se havia plano, não tenta top-up
      }

      // Tenta top-up
      const topUpRaw = window.sessionStorage.getItem('topup:pending-payment');
      if (topUpRaw) {
        const cached = JSON.parse(topUpRaw) as { id: string; amount?: number };
        const id = String(cached?.id || '').trim();
        if (id) {
          (async () => {
            try {
              const res = await fetch(`/api/user/balance/status?paymentId=${encodeURIComponent(id)}`, { cache: 'no-store' });
              const data = await res.json().catch(() => ({} as any));
              const s = String((data as any).status || '').toLowerCase();
              if (res.ok && s === 'approved') {
                const amount = typeof (data as any).amount === 'number' ? (data as any).amount : (cached.amount ?? 0);
                const newBalance = typeof (data as any).balance === 'number' ? (data as any).balance : currentBalance;
                setTopUpSuccess({ amountAdded: amount, newBalance });
                setShowTopUpModal(true);
                window.sessionStorage.removeItem('topup:pending-payment');
              }
            } catch {}
          })();
        }
      }
    } catch {}
  }, [searchParams, currentBalance]);

  // Fecha automaticamente o modal de extras após sucesso
  useEffect(() => {
    if (!addonSuccess) return;
    const timer = setTimeout(() => {
      closeAddonModal();
    }, 1500);
    return () => clearTimeout(timer);
  }, [addonSuccess]);

  // Fecha automaticamente o modal de saldo após sucesso
  useEffect(() => {
    if (!topUpSuccess) return;
    const timer = setTimeout(() => {
      closeTopUpModal();
    }, 1500);
    return () => clearTimeout(timer);
  }, [topUpSuccess]);

  // Poll balance top-up status enquanto o modal está aberto
  useEffect(() => {
    if (!showTopUpModal || !pendingTopUpCheckout) return;
    const paymentId = pendingTopUpCheckout.providerPaymentId;

    const poll = async () => {
      try {
        const res = await fetch(`/api/user/balance/status?paymentId=${encodeURIComponent(paymentId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({} as any));
        const status = String(data.status || "").toLowerCase();
        if (status === "approved") {
          const newBalance = typeof data.balance === "number" ? data.balance : currentBalance;
          const added = typeof data.amount === "number" ? data.amount : (pendingTopUpAmount ?? pendingTopUpCheckout.amount);
          setCurrentBalance(newBalance);
          setTopUpSuccess({ amountAdded: added, newBalance });
          setFeedback(null);
          setPendingTopUpCheckout(null);
          // mantém o modal aberto exibindo a confirmação
          try { if (typeof window !== 'undefined') { window.sessionStorage.removeItem('topup:pending-payment'); } } catch {}
          router.refresh();
        }
      } catch {}
    };

    const interval = setInterval(poll, 5000);
    const kickoff = setTimeout(poll, 2000);
    return () => {
      clearInterval(interval);
      clearTimeout(kickoff);
    };
  }, [showTopUpModal, pendingTopUpCheckout, pendingTopUpAmount, currentBalance, router]);

  const handlePayWithBalance = async (plan: SubscriptionPlan) => {
    setIsProcessing(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/user/plan/pay-with-balance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ planId: plan.id }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível ativar o plano com o saldo disponível.",
        });
        setIsProcessing(false);
        return;
      }

      setCurrentBalance(typeof data.balance === "number" ? data.balance : currentBalance);
      // Exibe confirmação com GIF e detalhes
      setPlanSuccess({ planName: plan.name, amount: plan.price, dueAt: null });
      setConfirmationMessage(null);
      setShowPlanModal(true);
      await router.refresh();
    } catch (error) {
      console.error("Failed to pay plan with balance", error);
      setFeedback({
        type: "danger",
        message: "Não foi possível ativar o plano com o saldo disponível.",
      });
    }

    setIsProcessing(false);
  };

  const parsedTopUpAmount = useMemo(() => {
    const value = Number.parseFloat(topUpAmount.replace(/,/g, "."));
    return Number.isFinite(value) ? Math.max(value, 0) : 0;
  }, [topUpAmount]);

  const handleTopUp = async () => {
    if (parsedTopUpAmount <= 0) {
      setFeedback({ type: "danger", message: "Informe um valor válido para adicionar saldo." });
      return;
    }
    if (!selectableProviderSet.has(topUpProvider)) {
      setFeedback({ type: "danger", message: paymentUnavailableMessage });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);
    setPendingTopUpCheckout(null);

    try {
      const response = await fetch("/api/user/balance/topup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: parsedTopUpAmount, provider: topUpProvider }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível gerar o pagamento de saldo.",
        });
        setIsProcessing(false);
        return;
      }

      const checkout: PlanCheckoutResponse | undefined = data.checkout;
      if (!checkout) {
        setFeedback({
          type: "danger",
          message: "Resposta inesperada do servidor.",
        });
        setIsProcessing(false);
        return;
      }

      setPendingTopUpCheckout(checkout);
      setPendingTopUpAmount(parsedTopUpAmount);
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(
            'topup:pending-payment',
            JSON.stringify({ id: checkout.providerPaymentId, amount: parsedTopUpAmount }),
          );
        }
      } catch {}
      setShowTopUpModal(true);
    } catch (error) {
      console.error("Failed to create balance top-up", error);
      setFeedback({
        type: "danger",
        message: "Não foi possível gerar o pagamento de saldo.",
      });
    }

    setIsProcessing(false);
  };

  const renderPlanStatusSection = () => (
    <div className="p-4 border rounded-3 d-flex flex-column gap-3">
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <h3 className="h6 mb-1 text-uppercase text-secondary fw-semibold">Status da assinatura</h3>
          {activePlan ? (
            <div className="text-secondary">
              <div>
                Plano <strong>{activePlan.name}</strong> ativo.
              </div>
              <div className="d-flex align-items-center gap-2 mt-1">
                <IconDiamond size={18} className="text-primary" />
                <span>
                  Expira em {activeUntil ?? "-"}
                  {daysRemainingLabel ? ` (${daysRemainingLabel} restantes)` : ""}
                </span>
              </div>
              <div className="mt-2 small text-secondary">
                A renovação do plano é feita manualmente pelo painel quando você quiser manter a assinatura ativa.
              </div>
            </div>
          ) : (
            <div className="text-secondary">
              Nenhum plano ativo no momento. Escolha uma opção abaixo para liberar todos os recursos do painel.
            </div>
          )}
        </div>
        <Badge bg={getStatusBadgeVariant(status.status)} className="px-3 py-2">
          {status.status === "active"
            ? "Plano ativo"
            : status.status === "pending"
              ? "Pagamento pendente"
              : status.status === "expired"
                ? "Plano expirado"
                : "Sem plano"}
        </Badge>
      </div>

      {pendingPlanCheckout && (
        <div className="d-flex justify-content-end">
          <Button
            variant="outline-secondary"
            onClick={() => setPendingPlanCheckout(null)}
            disabled={isProcessing}
          >
            Limpar boleto gerado
          </Button>
        </div>
      )}
    </div>
  );

  const renderBalanceSection = () => (
    <div className="p-4 border rounded-3 d-flex flex-column gap-3">
      <div className="d-flex align-items-center gap-3">
        <span className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary" style={{ width: 40, height: 40 }}>
          <IconWallet size={22} />
        </span>
        <div>
          <h3 className="h6 mb-1">Saldo disponível</h3>
          <p className="text-secondary mb-0 small">Use o saldo para assinar ou renovar planos rapidamente.</p>
        </div>
      </div>
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <strong className="fs-4">R$ {formatCurrency(currentBalance)}</strong>
        <Button
          variant="outline-primary"
          onClick={openTopUpModalManual}
          disabled={paymentProvidersUnavailable}
        >
          Adicionar saldo
        </Button>
      </div>
    </div>
  );

  const renderAccountHolderSection = () => (
    <div className="p-4 border rounded-3">
      <h3 className="h6 mb-2">Dados do titular</h3>
      <p className="text-secondary mb-0">
        Assinatura vinculada a <strong>{userName}</strong> ({userEmail}). Mantenha esses dados atualizados para evitar
        divergências nos pagamentos.
      </p>
    </div>
  );

  const renderPlans = () => (
    sortedPlans.length === 0 ? (
      <Card>
        <Card.Body>
          <p className="mb-0 text-secondary">
            Nenhum plano disponível no momento. Fale com o administrador para configurar as opções.
          </p>
        </Card.Body>
      </Card>
    ) : (
      <Row className="g-4">
        {sortedPlans.map((plan) => {
          // Seleções de extras agora são feitas no modal; mantemos somente exibição de preços

          return (
            <Col md={6} key={plan.id}>
              <Card className={plan.id === activePlan?.id ? "border-primary shadow-sm" : "shadow-sm"}>
                <Card.Body className="d-flex flex-column gap-2">
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <Card.Title as="h3" className="h5 mb-1">
                        {plan.name}
                      </Card.Title>
                      <Card.Subtitle className="text-secondary small">
                        {plan.description ?? "Assinatura do Bot Admin"}
                      </Card.Subtitle>
                    </div>
                    {plan.id === activePlan?.id && <Badge bg="primary">Plano atual</Badge>}
                  </div>
                  <div>
                    <span className="fs-1 fw-semibold">R$ {formatCurrency(plan.price)}</span>
                    <span className="text-secondary"> / {plan.durationDays} dias</span>
                  </div>
                  <ul className="mb-0 text-secondary small ps-3">
                    <li>
                      {plan.instanceLimit === 0
                        ? "Instâncias ilimitadas"
                        : `Até ${plan.instanceLimit} instâncias ativas`}
                    </li>
                    <li>
	                      Grupos ilimitados
                    </li>
                  </ul>
                  <div className="d-flex flex-wrap gap-2 pt-1">
                    <Badge bg="light" text="dark" className="border fw-medium">
                      Instância extra: R$ {formatCurrency(plan.addonInstancePrice)}
                    </Badge>
                  </div>
                  <div className="d-flex flex-column gap-2 pt-1">
                    {/* Seletor de pagamento removido do card; ficará no modal */}
                    {plan.id === activePlan?.id ? (
                      <Button
                        variant="primary"
                        onClick={() => openRenewModal(plan)}
                        disabled={isProcessing || paymentProvidersUnavailable}
                      >
                        Renovar plano
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={() => openRenewModal(plan)}
                        disabled={isProcessing || paymentProvidersUnavailable}
                      >
                        Assinar plano
                      </Button>
                    )}
                    {plan.price <= currentBalance && (
                      <Button
                        variant="outline-success"
                        onClick={() => handlePayWithBalance(plan)}
                        disabled={isProcessing}
                      >
                        Pagar com saldo
                      </Button>
                    )}
                    {plan.id === activePlan?.id && (
                      <div className="d-flex flex-column gap-2 mt-2">
                        <Button
                          variant="outline-primary"
                          onClick={() => openAddonModal(plan)}
                          disabled={isProcessing || paymentProvidersUnavailable}
                        >
                          Comprar extras
                        </Button>
                      </div>
                    )}
                  </div>
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>
    )
  );

  const renderAddonSummarySection = () => (
    <div className="p-4 border rounded-3 d-flex flex-column gap-3">
      <div>
        <h3 className="h6 mb-1">Extras ativos do plano</h3>
        <p className="text-secondary mb-0 small">
          Limites atuais: {limits.instanceLimit === 0 ? "instâncias ilimitadas" : `${limits.instanceLimit} instância(s)`} •
          {" "}
          {limits.groupLimit === 0 ? "grupos ilimitados" : `${limits.groupLimit} grupo(s)`}.
        </p>
        {planIncludedLabel && (
          <p className="text-secondary mb-0 small">
            Inclusos no plano: {planIncludedLabel.instance} • {planIncludedLabel.group}.
          </p>
        )}
      </div>
      {addons.length === 0 ? (
        <div className="text-secondary small d-flex flex-column gap-1">
          <span>
	            Nenhum extra está ativo no momento. Utilize os botões do plano para contratar instâncias adicionais quando precisar.
          </span>
          {planIncludedLabel && (
            <span>
              Mesmo sem extras, seu plano já inclui {planIncludedLabel.instance} e {planIncludedLabel.group}.
            </span>
          )}
        </div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {planIncludedLabel && (
            <div className="text-secondary">
              Plano inclui: <strong>{planIncludedLabel.instance}</strong> • <strong>{planIncludedLabel.group}</strong>
            </div>
          )}
          <div className="text-secondary">
	            Extras ativos além do plano: <strong>+{addonTotals.totals.instance}</strong> instância(s)
          </div>
          <div className="text-secondary small">
            Cada extra tem validade independente e exige um plano ativo. Confira as datas abaixo e renove apenas os que fizerem
            sentido para o seu uso.
          </div>
          {addonTotals.showExpiredNotice && (
            <div className="text-warning small">
              Você possui extras vencidos{" "}
              {[
                addonTotals.expiredTotals.instance > 0
                  ? `${addonTotals.expiredTotals.instance} instância(s)`
                  : null,
              ]
                .filter(Boolean)
                .join(" e ") || ""}
              . Eles permanecem listados abaixo para facilitar a renovação.
            </div>
          )}
          <div className="d-flex flex-column gap-3">
	            {(["instance"] as const).map((type) => {
              const slots = addonSlots[type];
              if (slots.length === 0) {
                return null;
              }
              const sectionTitle = "Instâncias extras";
              const slotLabel = "Instância extra";
              return (
                <div key={type} className="d-flex flex-column gap-2">
                  <div className="fw-semibold text-secondary small">{sectionTitle}</div>
                  <div className="d-flex flex-column gap-2">
                    {slots
                      .slice()
                      .sort((a, b) => {
                        if (a.isExpired === b.isExpired) {
                          return a.index - b.index;
                        }
                        return a.isExpired ? 1 : -1;
                      })
                      .map((slot) => {
                      const slotBaseLabel = `${slotLabel} ${slot.index}`;
                      const primaryLabel = slot.groupName ?? slotBaseLabel;
                      const slotInfo = slot.groupName
                        ? slot.groupSlot
                          ? `Slot ${slot.groupSlot}`
                          : slotBaseLabel
                        : "Nenhum grupo vinculado";
                      const expiryLabel = slot.formattedExpiresAt
                        ? slot.isExpired
                          ? `Venceu em ${slot.formattedExpiresAt}`
                          : `Vence em ${slot.formattedExpiresAt}`
                        : "Sem data de vencimento";
                      return (
                        <div key={`${type}-${slot.key}`} className="border rounded-2 px-3 py-2">
                          <div className="d-flex justify-content-between flex-wrap gap-2">
                            <span className="fw-medium">{primaryLabel}</span>
                            <div className="d-flex align-items-center gap-2">
                              {slot.isExpired ? (
                                <Badge bg="danger" pill>
                                  Expirado
                                </Badge>
                              ) : null}
                              <span className="text-secondary small">{expiryLabel}</span>
                            </div>
                          </div>
                          <div className="text-secondary small mt-1">{slotInfo}</div>
                          {slot.isExpired ? (
                            <div className="text-secondary small mt-1">
                              Renove este extra para voltar a utilizá-lo.
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {addonTotals.nearestExpiry && (
            <div className="text-secondary small">
              Próximo vencimento: {formatDateTime(addonTotals.nearestExpiry)}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderAddonCheckoutDetails = () => {
    // Pagamento de extras agora é exibido prioritariamente no modal
    if (!pendingAddonCheckout || showAddonModal) {
      return null;
    }

    const expiresAt = formatDateTime(pendingAddonCheckout.expiresAt);
    const summary = buildAddonSummaryLabel(pendingAddonCheckout.selections);

    return (
      <Card className="mt-4">
        <Card.Body>
          <Card.Title as="h3" className="h5 mb-3">
            Pagamento de extras pendente
          </Card.Title>
          <p className="text-secondary">
            Conclua o pagamento de <strong>R$ {formatCurrency(pendingAddonCheckout.amount)}</strong> para liberar {summary} do plano <strong>{pendingAddonCheckout.plan.name}</strong>.
          </p>

          {pendingAddonCheckout.qrCodeBase64 && (
            <div className="d-flex flex-column flex-md-row align-items-center gap-4">
              <Image
                src={`data:image/png;base64,${pendingAddonCheckout.qrCodeBase64}`}
                alt="QR Code Pix"
                width={220}
                height={220}
              />
              <div className="d-flex flex-column gap-2 w-100">
                {pendingAddonCheckout.qrCode && (
                  <Form.Group>
                    <Form.Label>Copie o código Pix</Form.Label>
                    <Form.Control as="textarea" rows={4} readOnly value={pendingAddonCheckout.qrCode} />
                  </Form.Group>
                )}
                <div className="text-secondary small">
                  {expiresAt ? `Expira em ${expiresAt}. ` : ""}
                  A confirmação ocorre automaticamente após o pagamento.
                </div>
                <div className="d-flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => copyToClipboard(pendingAddonCheckout.qrCode ?? '', 'Código Pix copiado.')}
                    disabled={!pendingAddonCheckout.qrCode}
                  >
                    Copiar código Pix
                  </Button>
                  {pendingAddonCheckout.ticketUrl && (
                    <Button variant="outline-secondary" href={pendingAddonCheckout.ticketUrl} target="_blank">
                      Abrir link de pagamento
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!pendingAddonCheckout.qrCodeBase64 && pendingAddonCheckout.ticketUrl && (
            <div className="d-flex flex-column gap-3">
                  <div className="text-secondary small">
                    Abra o link abaixo para finalizar o pagamento. Os extras serão liberados automaticamente após a confirmação.
                  </div>
              <div className="d-flex gap-2">
                <Button variant="primary" href={pendingAddonCheckout.ticketUrl} target="_blank">
                  Abrir link de pagamento
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => copyToClipboard(pendingAddonCheckout.ticketUrl!, 'Link copiado.')}
                >
                  Copiar link
                </Button>
              </div>
            </div>
          )}
        </Card.Body>
      </Card>
    );
  };

  const renderCheckoutDetails = () => {
    if (!pendingPlanCheckout) {
      return null;
    }

    const expiresAt = formatDateTime(pendingPlanCheckout.expiresAt);

    return (
      <Card className="mt-4">
        <Card.Body>
          <Card.Title as="h3" className="h5 mb-3">
            Pagamento pendente
          </Card.Title>
          <p className="text-secondary">
            Conclua o pagamento do plano <strong>{pendingPlanCheckout.plan.name}</strong> no valor de R$
            {` ${formatCurrency(pendingPlanCheckout.amount ?? pendingPlanCheckout.plan.price)}`}.
            Assim que o Mercado Pago confirmar, o plano será liberado automaticamente e você receberá um e-mail de confirmação.
          </p>

          {pendingPlanCheckout.qrCodeBase64 && (
            <div className="d-flex flex-column flex-md-row align-items-center gap-4">
              <Image
                src={`data:image/png;base64,${pendingPlanCheckout.qrCodeBase64}`}
                alt="QR Code Pix"
                width={220}
                height={220}
              />
              <div className="d-flex flex-column gap-2 w-100">
                {pendingPlanCheckout.qrCode && (
                  <Form.Group>
                    <Form.Label>Copie o código Pix</Form.Label>
                    <Form.Control as="textarea" rows={4} readOnly value={pendingPlanCheckout.qrCode} />
                  </Form.Group>
                )}
                <div className="text-secondary small">
                  {expiresAt ? `Expira em ${expiresAt}. ` : ""}
                  A confirmação ocorre automaticamente após o pagamento.
                </div>
                <div className="d-flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => copyToClipboard(pendingPlanCheckout.qrCode ?? '', 'Código Pix copiado.')}
                    disabled={!pendingPlanCheckout.qrCode}
                  >
                    Copiar código Pix
                  </Button>
                  {pendingPlanCheckout.ticketUrl && (
                    <Button variant="outline-secondary" href={pendingPlanCheckout.ticketUrl} target="_blank">
                      Abrir link de pagamento
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!pendingPlanCheckout.qrCodeBase64 && pendingPlanCheckout.ticketUrl && (
            <div className="d-flex flex-column gap-3">
              <div className="text-secondary small">
                Abra o link abaixo para finalizar o pagamento. A confirmação é automática.
              </div>
              <div className="d-flex gap-2">
                <Button variant="primary" href={pendingPlanCheckout.ticketUrl} target="_blank">
                  Abrir link de pagamento
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => copyToClipboard(pendingPlanCheckout.ticketUrl!, 'Link copiado.')}
                >
                  Copiar link
                </Button>
              </div>
            </div>
          )}
        </Card.Body>
      </Card>
    );
  };

  const renderTopUpCheckoutDetails = () => {
    if (!pendingTopUpCheckout) {
      return null;
    }

    const expiresAt = formatDateTime(pendingTopUpCheckout.expiresAt);

    return (
      <Card className="mt-3">
        <Card.Body>
          <Card.Title as="h3" className="h5 mb-3">
            Pagamento de saldo pendente
          </Card.Title>
          <p className="text-secondary">
            Conclua o pagamento de <strong>R$ {formatCurrency(pendingTopUpAmount ?? pendingTopUpCheckout.amount)}</strong> para adicionar saldo à sua conta.
          </p>

          {pendingTopUpCheckout.qrCodeBase64 && (
            <div className="d-flex flex-column flex-md-row align-items-center gap-4">
              <Image
                src={`data:image/png;base64,${pendingTopUpCheckout.qrCodeBase64}`}
                alt="QR Code Pix"
                width={220}
                height={220}
              />
              <div className="d-flex flex-column gap-2 w-100">
                {pendingTopUpCheckout.qrCode && (
                  <Form.Group>
                    <Form.Label>Copie o código Pix</Form.Label>
                    <Form.Control as="textarea" rows={4} readOnly value={pendingTopUpCheckout.qrCode} />
                  </Form.Group>
                )}
                <div className="text-secondary small">
                  {expiresAt ? `Expira em ${expiresAt}. ` : ""}
                  A confirmação do pagamento e crédito do saldo é automática.
                </div>
                <div className="d-flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => copyToClipboard(pendingTopUpCheckout.qrCode ?? '', 'Código Pix copiado.')}
                    disabled={!pendingTopUpCheckout.qrCode}
                  >
                    Copiar código Pix
                  </Button>
                  {pendingTopUpCheckout.ticketUrl && (
                    <Button variant="outline-secondary" href={pendingTopUpCheckout.ticketUrl} target="_blank">
                      Abrir link de pagamento
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!pendingTopUpCheckout.qrCodeBase64 && pendingTopUpCheckout.ticketUrl && (
            <div className="d-flex flex-column gap-3">
              <div className="text-secondary small">
                Abra o link abaixo para pagar. O saldo será creditado automaticamente após a confirmação.
              </div>
              <div className="d-flex gap-2">
                <Button variant="primary" href={pendingTopUpCheckout.ticketUrl} target="_blank">
                  Abrir link de pagamento
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => copyToClipboard(pendingTopUpCheckout.ticketUrl!, 'Link copiado.')}
                >
                  Copiar link
                </Button>
              </div>
            </div>
          )}
        </Card.Body>
      </Card>
    );
  };

  const closePlanModal = () => {
    setShowPlanModal(false);
    setConfirmationMessage(null);
    setPlanSuccess(null);
    try { if (typeof window !== 'undefined') { window.sessionStorage.removeItem('plan:pending-payment'); } } catch {}
  };

  const closeTopUpModal = () => {
    setShowTopUpModal(false);
    setTopUpSuccess(null);
    try { if (typeof window !== 'undefined') { window.sessionStorage.removeItem('topup:pending-payment'); } } catch {}
  };

  const closeAddonModal = () => {
    setShowAddonModal(false);
    setAddonSuccess(null);
    setPendingAddonCheckout(null);
    try { if (typeof window !== 'undefined') { window.sessionStorage.removeItem('addon:pending-payment'); } } catch {}
  };

  return (
    <div className="d-flex flex-column gap-4">
      <div className="d-flex justify-content-end">
        <Button
          variant="outline-secondary"
          size="sm"
          className="d-inline-flex align-items-center gap-2 px-3"
          onClick={() => setShowInfoModal(true)}
        >
          <IconInfoCircle size={16} />
          Resumo do plano
        </Button>
      </div>

      <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

      {paymentProvidersUnavailable && (
        <div className="alert alert-warning">{paymentUnavailableMessage}</div>
      )}

      {renderPlans()}
      {renderCheckoutDetails()}
      {renderAddonCheckoutDetails()}
      {renderTopUpCheckoutDetails()}

      <Modal show={showInfoModal} onHide={() => setShowInfoModal(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Detalhes da assinatura</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-4">
          {renderPlanStatusSection()}
          {renderBalanceSection()}
          {renderAddonSummarySection()}
          {renderAccountHolderSection()}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowInfoModal(false)}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showPlanModal} onHide={closePlanModal} centered size="lg">
        <Modal.Header closeButton={!isProcessing}>
          <Modal.Title>Pagamento do plano</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {planSuccess ? (
            <div className="d-flex flex-column align-items-center text-center gap-3">
              <Image src="/payments/pagamento-concluido.gif" alt="Pagamento concluído" width={220} height={220} />
              <div>
                <div className="fw-semibold">Pagamento confirmado!</div>
                <div className="text-secondary">
                  Plano <strong>{planSuccess.planName}</strong> ativado. {""}
                  {planSuccess.dueAt
                    ? (<>
                        Novo vencimento: <strong>{formatDateTime(planSuccess.dueAt)}</strong>.
                      </>)
                    : (<>Estamos atualizando seu vencimento…</>)}
                </div>
              </div>
            </div>
          ) : (
          pendingPlanCheckout && (
            <div className="d-flex flex-column gap-3">
              <div className="text-secondary">
                Conclua o pagamento do plano <strong>{pendingPlanCheckout.plan.name}</strong> no valor de R$
                {` ${formatCurrency(pendingPlanCheckout.amount ?? pendingPlanCheckout.plan.price)}`}.
              </div>
              {pendingPlanCheckout.qrCodeBase64 && (
                <div className="d-flex flex-column flex-md-row align-items-center gap-4">
                  <Image
                    src={`data:image/png;base64,${pendingPlanCheckout.qrCodeBase64}`}
                    alt="QR Code Pix"
                    width={220}
                    height={220}
                  />
                  <div className="d-flex flex-column gap-2 w-100">
                    {pendingPlanCheckout.qrCode && (
                      <Form.Group>
                        <Form.Label>Copie o código Pix</Form.Label>
                        <Form.Control as="textarea" rows={4} readOnly value={pendingPlanCheckout.qrCode} />
                      </Form.Group>
                    )}
                    <div className="text-secondary small">
                      {formatDateTime(pendingPlanCheckout.expiresAt)
                        ? `Expira em ${formatDateTime(pendingPlanCheckout.expiresAt)}. `
                        : ""}
                      A confirmação ocorre automaticamente após o pagamento.
                    </div>
                    <div className="d-flex gap-2">
                      <Button
                        variant="primary"
                        onClick={() => copyToClipboard(pendingPlanCheckout.qrCode ?? '', 'Código Pix copiado.')}
                        disabled={!pendingPlanCheckout.qrCode}
                      >
                        Copiar código Pix
                      </Button>
                      {pendingPlanCheckout.ticketUrl && (
                        <Button variant="outline-secondary" href={pendingPlanCheckout.ticketUrl} target="_blank">
                          Abrir link de pagamento
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!pendingPlanCheckout.qrCodeBase64 && pendingPlanCheckout.ticketUrl && (
                <div className="d-flex flex-column gap-3">
                  <div className="text-secondary small">
                    Abra o link abaixo para finalizar o pagamento. A confirmação é automática.
                  </div>
                  <div className="d-flex gap-2">
                    <Button variant="primary" href={pendingPlanCheckout.ticketUrl} target="_blank">
                      Abrir link de pagamento
                    </Button>
                    <Button
                      variant="outline-secondary"
                      onClick={() => copyToClipboard(pendingPlanCheckout.ticketUrl!, 'Link copiado.')}
                    >
                      Copiar link
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={closePlanModal} disabled={isProcessing}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Modal de opções de renovação/assinatura */}
      <Modal show={showRenewModal} onHide={closeRenewModal} centered>
        <Modal.Header closeButton={!isProcessing}>
          <Modal.Title>
            {renewPlan && activePlan && renewPlan.id === activePlan.id ? 'Renovar assinatura' : 'Assinar plano'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {renewPlan && (
            <div className="d-flex flex-column gap-3">
              <div>
                <div className="fw-semibold">{renewPlan.name}</div>
                <div className="text-secondary small">Valor: R$ {formatCurrency(renewPlan.price)} • Duração: {renewPlan.durationDays} dias</div>
                {planIncludedLabel && (
                  <div className="text-secondary small">
                    Inclusos no plano: {planIncludedLabel.instance} • {planIncludedLabel.group}
                  </div>
                )}
              </div>

              <Form.Group>
                <Form.Label className="fw-semibold">O que deseja renovar?</Form.Label>
                <div className="d-flex flex-column gap-2">
                  <Form.Check
                    type="radio"
                    id="renew-plan-only"
                    name="renew-option"
                    label="Somente o plano"
                    checked={renewOption === 'plan_only'}
                    onChange={() => setRenewOption('plan_only')}
                  />
                  <Form.Check
                    type="radio"
                    id="renew-plan-plus"
                    name="renew-option"
                    label="Plano + seus extras atuais (escolha quais renovar)"
                    checked={renewOption === 'plan_plus_current_addons'}
                    onChange={() => setRenewOption('plan_plus_current_addons')}
                    disabled={addonSlotList.length === 0}
                  />
                  <Form.Check
                    type="radio"
                    id="renew-addons-only"
                    name="renew-option"
                    label="Somente os extras atuais"
                    checked={renewOption === 'addons_only'}
                    onChange={() => setRenewOption('addons_only')}
                    disabled={addonSlotList.length === 0}
                  />
                  {(renewOption === 'plan_plus_current_addons' || renewOption === 'addons_only') && (
                    <div className="rounded border bg-light-subtle px-3 py-3">
                      {addonSlotList.length === 0 ? (
                        <div className="text-secondary small mb-0">Você não possui extras ativos para renovar.</div>
                      ) : (
                        <div className="d-flex flex-column gap-3">
                          <div className="d-flex flex-column gap-1">
                            <span className="fw-semibold small">
                              {renewOption === 'addons_only'
                                ? 'Selecione os extras que deseja renovar (sem renovar o plano)'
                                : 'Selecione quais extras renovar'}
                            </span>
                            {planIncludedLabel && (
                              <span className="text-secondary small">
                                Incluídos no plano: {planIncludedLabel.instance} • {planIncludedLabel.group}
                              </span>
                            )}
                            <span className="text-secondary small">
	                              Extras ativos além do plano: +{addonTotals.totals.instance} instância(s)
                            </span>
                            {addonTotals.showExpiredNotice && (
                              <span className="text-warning small">
	                                Extras vencidos: +{addonTotals.expiredTotals.instance} instância(s)
                              </span>
                            )}
                            <span className="text-secondary small">
	                              Renovando agora: +{renewSelectedTotals.instance} instância(s)
                            </span>
                          </div>
	                          {(['instance'] as const).map((type) => {
                            const slots = addonSlots[type];
                            if (slots.length === 0) {
                              return null;
                            }
                            const sectionTitle = 'Extras de instâncias vinculados';
                            const sortedSlots = [...slots].sort((a, b) => {
                              if (a.isExpired === b.isExpired) {
                                return a.index - b.index;
                              }
                              return a.isExpired ? 1 : -1;
                            });
                            return (
                              <div key={type} className="d-flex flex-column gap-2">
                                <span className="fw-semibold small">{sectionTitle}</span>
                                <div className="d-flex flex-column gap-1">
                                  {sortedSlots.map((slot) => {
                                    const controlId = `renew-slot-${slot.key}`;
                                    const expiryLabel = slot.formattedExpiresAt
                                      ? slot.isExpired
                                        ? `venceu em ${slot.formattedExpiresAt}`
                                        : `vence em ${slot.formattedExpiresAt}`
                                      : 'sem data de vencimento';
                                    const primaryLabel = `Instância extra ${slot.index}`;
                                    const helperLabel = `Slot extra ${slot.index}`;
                                    return (
                                      <Form.Check
                                        key={slot.key}
                                        type="checkbox"
                                        id={controlId}
                                        label={
                                          <div className="d-flex flex-column">
                                            <span className="fw-medium">{primaryLabel}</span>
                                            <span className="text-secondary small">
                                              {helperLabel} • {expiryLabel}
                                              {slot.isExpired ? (
                                                <span className="text-danger ms-1">• expirado</span>
                                              ) : null}
                                            </span>
                                          </div>
                                        }
                                        checked={renewSelectedSlotKeys.includes(slot.key)}
                                        onChange={(event) => {
                                          const { checked } = event.target;
                                          setRenewSelectedSlotKeys((previous) => {
                                            if (checked) {
                                              if (previous.includes(slot.key)) {
                                                return previous;
                                              }
                                              return [...previous, slot.key];
                                            }
                                            return previous.filter((currentKey) => currentKey !== slot.key);
                                          });
                                        }}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                          <div className="d-flex gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => setRenewSelectedSlotKeys(addonSlotList.map((slot) => slot.key))}
                              disabled={renewSelectedSlotKeys.length === addonSlotList.length && addonSlotList.length > 0}
                            >
                              Selecionar todos
                            </Button>
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => setRenewSelectedSlotKeys([])}
                              disabled={renewSelectedSlotKeys.length === 0}
                            >
                              Limpar seleção
                            </Button>
                          </div>
                        </div>
                      )}
                      {renewOption === 'addons_only' && (
                        <div className="text-secondary small">
                          Apenas os extras selecionados serão cobrados; o plano permanecerá com a data de renovação atual.
                        </div>
                      )}
                    </div>
                  )}
                  <Form.Check
                    type="radio"
                    id="renew-plan-custom"
                    name="renew-option"
                    label="Plano + escolher novos extras"
                    checked={renewOption === 'plan_custom_addons'}
                    onChange={() => setRenewOption('plan_custom_addons')}
                  />
                </div>
              </Form.Group>

              {renewOption === 'plan_custom_addons' && (
                <div className="rounded border bg-light-subtle px-3 py-3">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span className="fw-semibold small">Selecionar extras</span>
	                    <span className="text-secondary small">Instância: R$ {formatCurrency(renewPlan.addonInstancePrice)}</span>
                  </div>
                  <Row className="g-2">
	                    <Col xs={12}>
	                      <Form.Group>
	                        <Form.Label className="small mb-1">Instâncias extras</Form.Label>
	                        <Form.Control type="number" min={0} value={renewCustomInstance} onChange={(e) => setRenewCustomInstance(e.target.value)} />
	                      </Form.Group>
	                    </Col>
                  </Row>
                  {planIncludedLabel && (
                    <div className="text-secondary small mt-1">
                      Incluídos no plano: {planIncludedLabel.instance} • {planIncludedLabel.group}
                    </div>
                  )}
                  <div className="text-secondary small mt-2">Ao confirmar, os extras escolhidos terão a validade estendida até o próximo vencimento do plano.</div>
                </div>
              )}

              {renewPlan && (
                <div className="rounded border bg-light-subtle px-3 py-3 d-flex flex-column gap-2">
                  <div className="d-flex justify-content-between">
                    <span>{includesPlanInRenewal ? 'Plano' : 'Plano (não será cobrado)'}</span>
                    <span>R$ {formatCurrency(renewPlanAmount)}</span>
                  </div>
                  <div className="d-flex justify-content-between text-secondary">
                    <span>Extras selecionados</span>
                    <span>R$ {formatCurrency(renewAddonAmount)}</span>
                  </div>
                  <div className="border-top pt-2 d-flex justify-content-between fw-semibold">
                    <span>Total estimado</span>
                    <span>R$ {formatCurrency(renewTotalAmount)}</span>
                  </div>
                  {planIncludedLabel && (
                    <div className="text-secondary small">
                      Plano inclui {planIncludedLabel.instance} e {planIncludedLabel.group} sem custo adicional.
                    </div>
                  )}
                </div>
              )}

              <Form.Group>
                <Form.Label>Forma de pagamento</Form.Label>
                <Form.Select
                  value={renewProvider}
                  onChange={(e) => setRenewProvider(e.target.value as PlanPaymentProvider)}
                  disabled={paymentProvidersUnavailable}
                >
                  {selectableProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <div className="text-secondary small">Os extras selecionados funcionam enquanto o plano estiver ativo e terão a validade ajustada para o novo ciclo.</div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={closeRenewModal} disabled={isProcessing}>Cancelar</Button>
          <Button variant="primary" onClick={handleConfirmRenew} disabled={isProcessing || !renewPlan}>Gerar pagamento</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showAddonModal} onHide={closeAddonModal} centered size="lg">
        <Modal.Header closeButton={!isProcessing}>
          <Modal.Title>Comprar extras</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {addonSuccess ? (
            <div className="d-flex flex-column align-items-center text-center gap-3">
              <Image src="/payments/pagamento-concluido.gif" alt="Pagamento concluído" width={220} height={220} />
              <div>
                <div className="fw-semibold">Pagamento confirmado!</div>
                <div className="text-secondary">
                  Add-ons liberados: <strong>{addonSuccess.summary}</strong> {addonSuccess.expiresAt ? (<>
                    até <strong>{formatDateTime(addonSuccess.expiresAt)}</strong>.
                  </>) : (<>até o fim do ciclo atual.</>)}
                </div>
              </div>
            </div>
          ) : pendingAddonCheckout ? (
            <div className="d-flex flex-column gap-3">
              <div className="text-secondary">
                Conclua o pagamento de <strong>R$ {formatCurrency(pendingAddonCheckout.amount)}</strong> para liberar {buildAddonSummaryLabel(pendingAddonCheckout.selections)}.
              </div>
              {pendingAddonCheckout.qrCodeBase64 && (
                <div className="d-flex flex-column flex-md-row align-items-center gap-4">
                  <Image src={`data:image/png;base64,${pendingAddonCheckout.qrCodeBase64}`} alt="QR Code Pix" width={220} height={220} />
                  <div className="d-flex flex-column gap-2 w-100">
                    {pendingAddonCheckout.qrCode && (
                      <Form.Group>
                        <Form.Label>Copie o código Pix</Form.Label>
                        <Form.Control as="textarea" rows={4} readOnly value={pendingAddonCheckout.qrCode} />
                      </Form.Group>
                    )}
                    <div className="text-secondary small">
                      {formatDateTime(pendingAddonCheckout.expiresAt) ? `Expira em ${formatDateTime(pendingAddonCheckout.expiresAt)}. ` : ''}
                      A confirmação ocorre automaticamente após o pagamento.
                    </div>
                    <div className="d-flex gap-2">
                      <Button variant="primary" onClick={() => copyToClipboard(pendingAddonCheckout.qrCode ?? '', 'Código Pix copiado.')} disabled={!pendingAddonCheckout.qrCode}>Copiar código Pix</Button>
                      {pendingAddonCheckout.ticketUrl && (
                        <Button variant="outline-secondary" href={pendingAddonCheckout.ticketUrl} target="_blank">Abrir link de pagamento</Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {!pendingAddonCheckout.qrCodeBase64 && pendingAddonCheckout.ticketUrl && (
                <div className="d-flex flex-column gap-3">
                  <div className="text-secondary small">Abra o link abaixo para finalizar o pagamento. Os extras serão liberados automaticamente após a confirmação.</div>
                  <div className="d-flex gap-2">
                    <Button variant="primary" href={pendingAddonCheckout.ticketUrl} target="_blank">Abrir link de pagamento</Button>
                    <Button variant="outline-secondary" onClick={() => copyToClipboard(pendingAddonCheckout.ticketUrl!, 'Link copiado.')}>Copiar link</Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="d-flex flex-column gap-3">
              <div className="text-secondary">Selecione as quantidades e a forma de pagamento para contratar extras neste ciclo do plano.</div>
              <Row className="g-2">
	                <Col xs={12}>
	                  <Form.Group>
	                    <Form.Label className="small mb-1">Instâncias extras</Form.Label>
	                    <Form.Control type="number" min={0} value={addonQtyInstance} onChange={(e) => setAddonQtyInstance(e.target.value)} />
	                  </Form.Group>
	                </Col>
              </Row>
              <Form.Group>
                <Form.Label>Forma de pagamento</Form.Label>
                <Form.Select
                  value={addonProvider}
                  onChange={(e) => setAddonProvider(e.target.value as PlanPaymentProvider)}
                  disabled={paymentProvidersUnavailable}
                >
                  {selectableProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
              <div className="text-secondary small">Validade: após a confirmação do pagamento, cada extra exibirá sua data de vencimento específica.</div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          {pendingAddonCheckout || addonSuccess ? (
            <Button variant="outline-secondary" onClick={closeAddonModal} disabled={isProcessing}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline-secondary" onClick={closeAddonModal} disabled={isProcessing}>Cancelar</Button>
              <Button variant="primary" onClick={confirmAddonCheckout} disabled={isProcessing || !addonPlan}>Gerar pagamento</Button>
            </>
          )}
        </Modal.Footer>
      </Modal>

      <Modal show={showTopUpModal} onHide={closeTopUpModal} centered size="lg">
        <Modal.Header closeButton={!isProcessing}>
          <Modal.Title>Pagamento de saldo</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {topUpSuccess ? (
            <div className="d-flex flex-column align-items-center text-center gap-3">
              <Image src="/payments/pagamento-concluido.gif" alt="Pagamento concluído" width={220} height={220} />
              <div>
                <div className="fw-semibold">Pagamento confirmado!</div>
                <div className="text-secondary">
                  Valor adicionado: <strong>R$ {formatCurrency(topUpSuccess.amountAdded)}</strong>. {" "}
                  Novo saldo: <strong>R$ {formatCurrency(topUpSuccess.newBalance)}</strong>.
                </div>
              </div>
            </div>
          ) : pendingTopUpCheckout ? (
            <div className="d-flex flex-column gap-3">
              <div className="text-secondary">
                Conclua o pagamento de <strong>R$ {formatCurrency(pendingTopUpAmount ?? pendingTopUpCheckout.amount)}</strong> para adicionar saldo à sua conta.
              </div>
              {pendingTopUpCheckout.qrCodeBase64 && (
                <div className="d-flex flex-column flex-md-row align-items-center gap-4">
                  <Image
                    src={`data:image/png;base64,${pendingTopUpCheckout.qrCodeBase64}`}
                    alt="QR Code Pix"
                    width={220}
                    height={220}
                  />
                  <div className="d-flex flex-column gap-2 w-100">
                    {pendingTopUpCheckout.qrCode && (
                      <Form.Group>
                        <Form.Label>Copie o código Pix</Form.Label>
                        <Form.Control as="textarea" rows={4} readOnly value={pendingTopUpCheckout.qrCode} />
                      </Form.Group>
                    )}
                    <div className="text-secondary small">
                      {formatDateTime(pendingTopUpCheckout.expiresAt)
                        ? `Expira em ${formatDateTime(pendingTopUpCheckout.expiresAt)}. `
                        : ""}
                      A confirmação do pagamento e crédito do saldo é automática.
                    </div>
                    <div className="d-flex gap-2">
                      <Button
                        variant="primary"
                        onClick={() => copyToClipboard(pendingTopUpCheckout.qrCode ?? '', 'Código Pix copiado.')}
                        disabled={!pendingTopUpCheckout.qrCode}
                      >
                        Copiar código Pix
                      </Button>
                      {pendingTopUpCheckout.ticketUrl && (
                        <Button variant="outline-secondary" href={pendingTopUpCheckout.ticketUrl} target="_blank">
                          Abrir link de pagamento
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!pendingTopUpCheckout.qrCodeBase64 && pendingTopUpCheckout.ticketUrl && (
                <div className="d-flex flex-column gap-3">
                  <div className="text-secondary small">
                    Abra o link abaixo para pagar. O saldo será creditado automaticamente após a confirmação.
                  </div>
                  <div className="d-flex gap-2">
                    <Button variant="primary" href={pendingTopUpCheckout.ticketUrl} target="_blank">
                      Abrir link de pagamento
                    </Button>
                    <Button
                      variant="outline-secondary"
                      onClick={() => copyToClipboard(pendingTopUpCheckout.ticketUrl!, 'Link copiado.')}
                    >
                      Copiar link
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Form
              onSubmit={(event) => {
                event.preventDefault();
                handleTopUp();
              }}
              className="d-flex flex-column gap-3"
            >
              <div className="text-secondary">
                Informe o valor e a forma de pagamento para gerar um boleto ou QR Code Pix e adicionar saldo à conta.
              </div>
              <div className="row g-3">
                <div className="col-sm-6 col-lg-4">
                  <Form.Group controlId="topUpAmount">
                    <Form.Label>Valor</Form.Label>
                    <Form.Control
                      type="number"
                      min={0}
                      step="0.01"
                      value={topUpAmount}
                      onChange={(event) => setTopUpAmount(event.target.value)}
                      required
                    />
                  </Form.Group>
                </div>
                <div className="col-sm-6 col-lg-4">
                  <Form.Group controlId="topUpProvider">
                    <Form.Label>Forma de pagamento</Form.Label>
                    <Form.Select
                      value={topUpProvider}
                      onChange={(event) => setTopUpProvider(event.target.value as PlanPaymentProvider)}
                      disabled={paymentProvidersUnavailable}
                    >
                      {selectableProviders.map((provider) => (
                        <option key={provider} value={provider}>
                          {PROVIDER_LABELS[provider]}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>
              </div>
              <div className="text-secondary small">
                O saldo fica disponível imediatamente após a confirmação do pagamento e pode ser usado para pagar planos ativos.
              </div>
              <button type="submit" className="d-none" />
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={closeTopUpModal} disabled={isProcessing}>
            {topUpSuccess || pendingTopUpCheckout ? "Fechar" : "Cancelar"}
          </Button>
          {!topUpSuccess && !pendingTopUpCheckout && (
            <Button variant="primary" onClick={handleTopUp} disabled={isProcessing}>
              Gerar pagamento
            </Button>
          )}
        </Modal.Footer>
      </Modal>

    </div>
  );
};

export default UserPlanManager;
