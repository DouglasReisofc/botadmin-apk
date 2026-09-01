"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconDotsVertical, IconFilter, IconSearch } from "@tabler/icons-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Dropdown,
  DropdownButton,
  Form,
  InputGroup,
  Modal,
  Row,
  Spinner,
  Table,
} from "react-bootstrap";
import { useRouter } from "next/navigation";
import NextImage from "next/image";

import type { AdminUserSummary } from "types/users";
import type {
  SubscriptionPlan,
  UserPlanLimits,
  UserPlanStatus,
} from "types/plans";
import type { BotGroup } from "types/bot-groups";
import { buildGroupLicenseStatusSummary } from "lib/group-license-display";
import { PHONE_COUNTRIES, findCountryByDialCode } from "data/phone-countries";
import adminStyles from "components/admin/AdminBotWorkspace.module.css";

type Feedback = { type: "success" | "danger"; message: string } | null;

type PlanStatusValue = UserPlanStatus["status"] | "inactive";

type PlanFormState = {
  planId: string;
  status: PlanStatusValue;
  periodEnd: string;
  autoRenewPlan: boolean;
};

type PlanOverview = {
  status: UserPlanStatus;
  limits: UserPlanLimits;
  plans: SubscriptionPlan[];
  groups: BotGroup[];
};

type PlanModalState = {
  visible: boolean;
  user: AdminUserSummary | null;
  loading: boolean;
  overview: PlanOverview | null;
  error: string | null;
  feedback: Feedback;
  saving: boolean;
  removing: boolean;
  planForm: PlanFormState;
};

type EmptyRegistrationCleanupPreview = {
  minimumAgeDays: number;
  eligibleCount: number;
  candidates: Array<{
    id: number;
    name: string;
    email: string | null;
    createdAt: string;
  }>;
};

type EmptyRegistrationCleanupModal = {
  visible: boolean;
  loading: boolean;
  deleting: boolean;
  error: string | null;
  preview: EmptyRegistrationCleanupPreview | null;
  confirmation: string;
};

type GroupPlanDraft = {
  planId: string;
  expiresAt: string;
  active: boolean;
};

const createEmptyPlanForm = (): PlanFormState => ({
  planId: "",
  status: "inactive",
  periodEnd: "",
  autoRenewPlan: false,
});

interface AdminUserManagerProps {
  initialQuery: string;
  initialStatus: "all" | "active" | "inactive";
  initialPlan: "all" | "with_active" | "without_active";
  initialUsers: AdminUserSummary[];
  initialPage: number;
  initialPageSize: number;
  initialTotal: number;
  initialHasMore: boolean;
}

const AdminUserManager = ({
  initialQuery,
  initialStatus,
  initialPlan,
  initialUsers,
  initialPage,
  initialPageSize,
  initialTotal,
  initialHasMore,
}: AdminUserManagerProps) => {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [query, setQuery] = useState(initialQuery || "");
  const [status, setStatus] = useState<"all" | "active" | "inactive">(initialStatus);
  const [plan, setPlan] = useState<"all" | "with_active" | "without_active">(initialPlan);
  const [users, setUsers] = useState<AdminUserSummary[]>(initialUsers);
  const [page, setPage] = useState(initialPage || 1);
  const [pageSize, setPageSize] = useState(initialPageSize || 20);
  const [total, setTotal] = useState(initialTotal || users.length);
  const [hasMore, setHasMore] = useState(initialHasMore || false);
  const usersRequestIdRef = useRef(0);
  const hasMountedSearchRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<number | null>(null);
  const [menuResetId, setMenuResetId] = useState<number | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUserSummary | null>(null);
  const [groupStatusPendingId, setGroupStatusPendingId] = useState<number | null>(null);
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    role: "user" as "admin" | "user",
    password: "",
    balance: "0",
    customPlanPrice: "",
    isActive: true,
    revokeSessions: false,
    whatsappDialCode: PHONE_COUNTRIES[0].dialCode,
    whatsappNumber: "",
  });
  const [planModal, setPlanModal] = useState<PlanModalState>({
    visible: false,
    user: null,
    loading: false,
    overview: null,
    error: null,
    feedback: null,
    saving: false,
    removing: false,
    planForm: createEmptyPlanForm(),
  });
  const [groupPlanDrafts, setGroupPlanDrafts] = useState<Record<number, GroupPlanDraft>>({});
  const [emptyRegistrationCleanup, setEmptyRegistrationCleanup] =
    useState<EmptyRegistrationCleanupModal>({
      visible: false,
      loading: false,
      deleting: false,
      error: null,
      preview: null,
      confirmation: "",
    });

  const formatDateTimeInputValue = (value: string | null): string => {
    if (!value) {
      return "";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    const hours = String(parsed.getHours()).padStart(2, "0");
    const minutes = String(parsed.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const dateTimeInputToIso = (value: string): string | null => {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  };

  const safeAddDays = (date: Date, days: number): Date => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  };

  const resetForm = () => {
    setFormState({
      name: "",
      email: "",
      role: "user",
      password: "",
      balance: "0",
      customPlanPrice: "",
      isActive: true,
      revokeSessions: false,
      whatsappDialCode: PHONE_COUNTRIES[0].dialCode,
      whatsappNumber: "",
    });
  };

  const closeModal = () => {
    setEditingUser(null);
    resetForm();
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
    }).format(value);

  const userInitials = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return (parts.map((part) => part[0]).join("") || "U").slice(0, 2).toUpperCase();
  };

  const filtersActive = status !== "all" || plan !== "all";

  const formatWhatsapp = (value: string | null) => {
    if (!value) {
      return "-";
    }

    const trimmed = value.trim();
    const match = trimmed.match(/^(\+\d{1,4})(\d{4,})$/);
    if (!match) {
      return trimmed;
    }

    const [, dialCode, rest] = match;
    if (rest.length === 10) {
      return `${dialCode} ${rest.slice(0, 2)} ${rest.slice(2, 6)}-${rest.slice(6)}`;
    }
    if (rest.length === 11) {
      return `${dialCode} ${rest.slice(0, 2)} ${rest.slice(2, 7)}-${rest.slice(7)}`;
    }
    return `${dialCode} ${rest}`;
  };

  const fetchUsers = async ({
    query: q,
    status: s,
    plan: p,
    page: requestedPage,
    append = false,
  }: {
    query: string;
    status: "all" | "active" | "inactive";
    plan: "all" | "with_active" | "without_active";
    page: number;
    append?: boolean;
  }) => {
    const requestId = ++usersRequestIdRef.current;
    const params = new URLSearchParams();
    if (q.trim()) params.set("query", q.trim());
    if (s !== "all") params.set("status", s);
    if (p !== "all") params.set("plan", p);
    params.set("page", String(requestedPage));
    params.set("pageSize", String(pageSize || 20));

    setError(null);
    if (append) {
      setLoading(false);
      setLoadingMore(true);
    } else {
      setLoadingMore(false);
      setLoading(true);
    }

    try {
      const r = await fetch(`/api/admin/users/list?${params.toString()}`, { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.message ?? "Falha ao buscar usuários.");
      }
      if (requestId !== usersRequestIdRef.current) {
        return;
      }
      const nextUsers: AdminUserSummary[] = Array.isArray(data.users) ? data.users : [];
      setUsers((prev) => (append ? [...prev, ...nextUsers] : nextUsers));
      setPage(Number.isFinite(data.page) ? Number(data.page) : requestedPage);
      setPageSize(Number.isFinite(data.pageSize) ? Number(data.pageSize) : pageSize);
      setTotal(Number.isFinite(data.total) ? Number(data.total) : nextUsers.length);
      setHasMore(Boolean(data.hasMore));
    } catch (err) {
      if (requestId === usersRequestIdRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao buscar usuários.");
      }
    } finally {
      if (requestId === usersRequestIdRef.current) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!hasMountedSearchRef.current) {
      hasMountedSearchRef.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      void fetchUsers({ query, status, plan, page: 1 });
    }, 350);

    return () => window.clearTimeout(timeout);
    // A busca deve reagir somente aos filtros digitados; fetchUsers usa o pageSize atual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, plan]);

  const formatDateDisplay = (value: string | null): string => {
    if (!value) {
      return "Sem data";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(parsed);
  };

  const planStatusOptions = useMemo(
    () => [
      { value: "pending", label: "Pendente" },
      { value: "active", label: "Ativo" },
      { value: "expired", label: "Expirado" },
      { value: "cancelled", label: "Cancelado" },
    ],
    [],
  );

const buildPlanFormFromOverview = (overview: PlanOverview): PlanFormState => ({
  planId: overview.status.planId ? overview.status.planId.toString() : "",
  status: overview.status.plan ? overview.status.status : "inactive",
  periodEnd: formatDateTimeInputValue(overview.status.currentPeriodEnd),
  autoRenewPlan: overview.status.autoRenewPlan,
});

  const buildGroupPlanDraft = (group: BotGroup, plans: SubscriptionPlan[]): GroupPlanDraft => {
    const currentPlanId = group.metadata.licensePlanId
      ? String(group.metadata.licensePlanId)
      : "";
    const selectedPlan = plans.find((plan) => plan.id.toString() === currentPlanId) ?? null;
    const expiresAt =
      formatDateTimeInputValue(group.metadata.licenseExpiresAt ?? null) ||
      (selectedPlan
        ? formatDateTimeInputValue(safeAddDays(new Date(), selectedPlan.durationDays).toISOString())
        : "");
    return {
      planId: currentPlanId,
      expiresAt,
      active: group.status === "active",
    };
  };

  const buildGroupPlanDrafts = (
    groups: BotGroup[],
    plans: SubscriptionPlan[],
  ): Record<number, GroupPlanDraft> =>
    groups.reduce<Record<number, GroupPlanDraft>>((drafts, group) => {
      drafts[group.id] = buildGroupPlanDraft(group, plans);
      return drafts;
    }, {});

  const getGroupInitials = (name: string | null | undefined): string => {
    const parts = (name || "Grupo")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part[0]).join("") || "G").toUpperCase();
  };

  const isFutureDate = (value: string | null | undefined): boolean => {
    if (!value) {
      return false;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > Date.now();
  };

  const fetchPlanOverview = async (userId: number): Promise<PlanOverview> => {
    const response = await fetch(`/api/admin/users/${userId}/plan`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        typeof data.message === "string"
          ? data.message
          : "Não foi possível carregar as informações de plano.",
      );
    }

    const overview: PlanOverview = {
      status: data.status as UserPlanStatus,
      limits: (data.limits as UserPlanLimits) ?? { instanceLimit: 0, groupLimit: 0 },
      plans: Array.isArray(data.plans) ? (data.plans as SubscriptionPlan[]) : [],
      groups: Array.isArray(data.groups) ? (data.groups as BotGroup[]) : [],
    };

    return overview;
  };

  const closePlanModal = () => {
    setGroupPlanDrafts({});
    setPlanModal({
      visible: false,
      user: null,
      loading: false,
      overview: null,
      error: null,
      feedback: null,
      saving: false,
      removing: false,
      planForm: createEmptyPlanForm(),
    });
  };

  const openPlanModal = async (user: AdminUserSummary) => {
    setGroupPlanDrafts({});
    setPlanModal({
      visible: true,
      user,
      loading: true,
      overview: null,
      error: null,
      feedback: null,
      saving: false,
      removing: false,
      planForm: createEmptyPlanForm(),
    });

    try {
      const overview = await fetchPlanOverview(user.id);
      setGroupPlanDrafts(buildGroupPlanDrafts(overview.groups, overview.plans));
      setPlanModal((previous) => {
        if (!previous.visible || !previous.user || previous.user.id !== user.id) {
          return previous;
        }
        return {
          ...previous,
          loading: false,
          overview,
          planForm: buildPlanFormFromOverview(overview),
        };
      });
    } catch (error) {
      setPlanModal((previous) => {
        if (!previous.visible || !previous.user || previous.user.id !== user.id) {
          return previous;
        }
        return {
          ...previous,
          loading: false,
          error: error instanceof Error
            ? error.message
            : "Não foi possível carregar as informações de plano.",
        };
      });
    }
  };

  const handlePlanSelect = (planId: string) => {
    setPlanModal((previous) => {
      if (!previous.visible) {
        return previous;
      }

      const selectedPlan =
        previous.overview?.plans.find((plan) => plan.id.toString() === planId) ?? null;

      let periodEnd = previous.planForm.periodEnd;
      const planChanged = previous.planForm.planId !== planId;
      if (selectedPlan && (planChanged || !periodEnd)) {
        const baseDate = new Date();
        const computedEnd = safeAddDays(baseDate, selectedPlan.durationDays);
        periodEnd = formatDateTimeInputValue(computedEnd.toISOString());
      }

      const status: PlanStatusValue =
        previous.planForm.status === "inactive" ? "active" : previous.planForm.status;

      return {
        ...previous,
        planForm: {
          ...previous.planForm,
          planId,
          periodEnd,
          status,
        },
        feedback: null,
        error: null,
      };
    });
  };

  const handlePlanFormChange = <Field extends keyof PlanFormState>(
    field: Field,
    value: PlanFormState[Field],
  ) => {
    setPlanModal((previous) => ({
      ...previous,
      planForm: {
        ...previous.planForm,
        [field]: value,
      },
      feedback: null,
      error: null,
    }));
  };

  const handlePlanExpiryChange = (value: string) => {
    setPlanModal((previous) => ({
      ...previous,
      planForm: {
        ...previous.planForm,
        periodEnd: value,
      },
      feedback: null,
      error: null,
    }));
  };

  const handlePlanToggle = (field: "autoRenewPlan") => {
    setPlanModal((previous) => ({
      ...previous,
      planForm: {
        ...previous.planForm,
        [field]: !previous.planForm[field],
      },
      feedback: null,
      error: null,
    }));
  };

  const submitPlanUpdate = async () => {
    if (!planModal.user || !planModal.overview) {
      return;
    }

    const planIdNumber = Number.parseInt(planModal.planForm.planId, 10);
    if (!Number.isFinite(planIdNumber) || planIdNumber <= 0) {
      setPlanModal((previous) => ({
        ...previous,
        error: "Selecione um plano para aplicar ao usuário.",
      }));
      return;
    }

    setPlanModal((previous) => ({
      ...previous,
      saving: true,
      feedback: null,
      error: null,
    }));

    try {
      const response = await fetch(`/api/admin/users/${planModal.user.id}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: planIdNumber,
          status: planModal.planForm.status,
          periodEnd: dateTimeInputToIso(planModal.planForm.periodEnd),
          autoRenewPlan: planModal.planForm.autoRenewPlan,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar o plano do usuário.",
        );
      }

      setPlanModal((previous) => {
        if (!previous.visible || !previous.user || previous.user.id !== planModal.user!.id) {
          return previous;
        }

        const previousOverview = previous.overview;
        const previousStatus = previousOverview?.status ?? null;
        const fallbackStatus: UserPlanStatus = previousStatus
          ? {
              ...previousStatus,
              currentPeriodEnd: planModal.planForm.periodEnd || previousStatus.currentPeriodEnd,
              autoRenewPlan: planModal.planForm.autoRenewPlan,
            }
          : {
              planId: planIdNumber,
              subscriptionId: null,
              plan: null,
              status: "active",
              currentPeriodStart: null,
	              currentPeriodEnd: planModal.planForm.periodEnd || null,
	              daysRemaining: null,
	              autoRenewPlan: planModal.planForm.autoRenewPlan,
	              isTrial: false,
	              trialEndsAt: null,
	              trialDurationHours: null,
	            };

        const overview: PlanOverview = {
          status:
            (data.status as UserPlanStatus) ??
            fallbackStatus,
          limits:
            (data.limits as UserPlanLimits) ??
            previousOverview?.limits ?? { instanceLimit: 0, groupLimit: 0 },
          plans: Array.isArray(data.plans)
            ? (data.plans as SubscriptionPlan[])
            : previousOverview?.plans ?? [],
          groups: Array.isArray(data.groups)
            ? (data.groups as BotGroup[])
            : previousOverview?.groups ?? [],
        };

        return {
          ...previous,
          overview,
          planForm: buildPlanFormFromOverview(overview),
          saving: false,
          feedback: {
            type: "success",
            message:
              typeof data.message === "string"
                ? data.message
                : "Plano atualizado com sucesso.",
          },
        };
      });
      router.refresh();
    } catch (error) {
      setPlanModal((previous) => ({
        ...previous,
        saving: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o plano do usuário.",
      }));
    }
  };

  const removeUserPlan = async () => {
    if (!planModal.user) {
      return;
    }
    const confirmation = window.confirm(
      "Remover o plano do usuário? Esta ação pode limitar recursos disponíveis imediatamente.",
    );
    if (!confirmation) {
      return;
    }

    setPlanModal((previous) => ({
      ...previous,
      removing: true,
      feedback: null,
      error: null,
    }));

    try {
      const response = await fetch(`/api/admin/users/${planModal.user.id}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: null,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível remover o plano do usuário.",
        );
      }

      setPlanModal((previous) => {
        if (!previous.visible || !previous.user || previous.user.id !== planModal.user!.id) {
          return previous;
        }

        const previousOverview = previous.overview;
        const overview: PlanOverview = {
          status:
            (data.status as UserPlanStatus) ??
            previousOverview?.status ?? {
              planId: null,
              subscriptionId: null,
              plan: null,
              status: "inactive",
              currentPeriodStart: null,
	              currentPeriodEnd: null,
	              daysRemaining: null,
	              autoRenewPlan: false,
	              isTrial: false,
	              trialEndsAt: null,
	              trialDurationHours: null,
	            },
          limits:
            (data.limits as UserPlanLimits) ??
            previousOverview?.limits ?? { instanceLimit: 0, groupLimit: 0 },
          plans: Array.isArray(data.plans)
            ? (data.plans as SubscriptionPlan[])
            : previousOverview?.plans ?? [],
          groups: Array.isArray(data.groups)
            ? (data.groups as BotGroup[])
            : previousOverview?.groups ?? [],
        };

        return {
          ...previous,
          overview,
          planForm: buildPlanFormFromOverview(overview),
          removing: false,
          feedback: {
            type: "success",
            message:
              typeof data.message === "string"
                ? data.message
                : "Plano removido do usuário.",
          },
        };
      });
      router.refresh();
    } catch (error) {
      setPlanModal((previous) => ({
        ...previous,
        removing: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível remover o plano do usuário.",
      }));
    }
  };

  const updateUser = async (
    user: AdminUserSummary,
    payload: Record<string, unknown>,
    successMessage: string,
  ) => {
    setPendingId(user.id);
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível atualizar o usuário.",
        });
        return false;
      }

      setFeedback({ type: "success", message: successMessage });
      router.refresh();
      return true;
    } catch (error) {
      console.error("Failed to update user", error);
      setFeedback({
        type: "danger",
        message: "Não foi possível se comunicar com o servidor.",
      });
      return false;
    } finally {
      setPendingId(null);
    }
  };

  const toggleStatus = async (user: AdminUserSummary) => {
    const nextState = !user.isActive;
    await updateUser(
      user,
      { isActive: nextState },
      nextState ? "Usuário reativado." : "Usuário desativado.",
    );
  };

  const revokeSessions = async (user: AdminUserSummary) => {
    await updateUser(user, { revokeSessions: true }, "Sessões encerradas.");
  };

  const resetUserMenuTexts = async (user: AdminUserSummary) => {
    if (
      !window.confirm(
        `Tem certeza de que deseja restaurar os textos padrão dos menus em todos os grupos de ${user.name}? Quaisquer personalizações serão perdidas.`,
      )
    ) {
      return;
    }

    setMenuResetId(user.id);
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetMenuTexts: true }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível resetar os menus.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ?? "Menus padrão restaurados para todos os grupos do usuário.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to reset menu texts", error);
      setFeedback({
        type: "danger",
        message: "Não foi possível se comunicar com o servidor.",
      });
    } finally {
      setMenuResetId(null);
    }
  };

  const handleGroupPlanDraftChange = (
    group: BotGroup,
    field: keyof GroupPlanDraft,
    value: string | boolean,
  ) => {
    const current =
      groupPlanDrafts[group.id] ??
      buildGroupPlanDraft(group, planModal.overview?.plans ?? []);
    const next: GroupPlanDraft = {
      ...current,
      [field]: value,
    };

    if (field === "planId" && typeof value === "string") {
      const selectedPlan = planModal.overview?.plans.find((plan) => plan.id.toString() === value) ?? null;
      if (selectedPlan && (current.planId !== value || !current.expiresAt)) {
        next.expiresAt = formatDateTimeInputValue(
          safeAddDays(new Date(), selectedPlan.durationDays).toISOString(),
        );
      }
    }

    setGroupPlanDrafts((previous) => ({
      ...previous,
      [group.id]: next,
    }));
    setPlanModal((previous) => ({
      ...previous,
      feedback: null,
      error: null,
    }));

    if ((field === "planId" || field === "expiresAt") && next.planId) {
      void submitGroupPlanUpdate(group, next.active, next);
    }
  };

  const applyGroupPlanPayload = (
    data: Record<string, unknown>,
    fallbackGroup: BotGroup,
  ) => {
    const responseGroups = Array.isArray(data.groups)
      ? (data.groups as BotGroup[])
      : null;
    const responsePlans = Array.isArray(data.plans)
      ? (data.plans as SubscriptionPlan[])
      : null;
    if (responseGroups && responsePlans) {
      setGroupPlanDrafts(buildGroupPlanDrafts(responseGroups, responsePlans));
    }

    setPlanModal((previous) => {
      if (!previous.overview) {
        return previous;
      }

      const updatedGroup = (data.group as BotGroup | undefined) ?? null;
      const groups =
        responseGroups ??
        previous.overview.groups.map((entry) =>
          entry.id === fallbackGroup.id ? updatedGroup ?? fallbackGroup : entry,
        );
      const plans = responsePlans ?? previous.overview.plans;

      return {
        ...previous,
        feedback: {
          type: "success",
          message: typeof data.message === "string" ? data.message : "Licença legada do grupo atualizada.",
        },
        overview: {
          ...previous.overview,
          status: (data.status as UserPlanStatus) ?? previous.overview.status,
          limits: (data.limits as UserPlanLimits) ?? previous.overview.limits,
          plans,
          groups,
        },
      };
    });
  };

  const submitGroupPlanUpdate = async (
    group: BotGroup,
    activeOverride?: boolean,
    draftOverride?: GroupPlanDraft,
  ) => {
    if (!planModal.user || !planModal.overview) {
      return;
    }
    const draft =
      draftOverride ??
      groupPlanDrafts[group.id] ??
      buildGroupPlanDraft(group, planModal.overview.plans);
    const planIdNumber = Number.parseInt(draft.planId, 10);
    if (!Number.isFinite(planIdNumber) || planIdNumber <= 0) {
      setPlanModal((previous) => ({
        ...previous,
        error: "Selecione um plano para este grupo.",
        feedback: null,
      }));
      return;
    }

    setGroupStatusPendingId(group.id);
    setPlanModal((previous) => ({
      ...previous,
      feedback: null,
      error: null,
    }));

    try {
      const response = await fetch(`/api/admin/users/${planModal.user.id}/plan/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: planIdNumber,
          expiresAt: dateTimeInputToIso(draft.expiresAt),
          active: activeOverride ?? draft.active,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar o plano do grupo.",
        );
      }

      applyGroupPlanPayload(data as Record<string, unknown>, group);
    } catch (error) {
      setPlanModal((previous) => ({
        ...previous,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o plano do grupo.",
      }));
    } finally {
      setGroupStatusPendingId(null);
    }
  };

  const updatePlanModalGroupActivation = async (group: BotGroup, active: boolean) => {
    const draft =
      groupPlanDrafts[group.id] ??
      buildGroupPlanDraft(group, planModal.overview?.plans ?? []);
    const nextDraft = {
      ...draft,
      active,
    };
    setGroupPlanDrafts((previous) => ({
      ...previous,
      [group.id]: nextDraft,
    }));
    await submitGroupPlanUpdate(group, active, nextDraft);
  };

  const removeGroupPlan = async (group: BotGroup) => {
    if (!planModal.user) {
      return;
    }
    if (!window.confirm(`Remover o plano individual do grupo "${group.name || group.remoteId}"?`)) {
      return;
    }

    setGroupStatusPendingId(group.id);
    setPlanModal((previous) => ({
      ...previous,
      feedback: null,
      error: null,
    }));

    try {
      const response = await fetch(`/api/admin/users/${planModal.user.id}/plan/groups/${group.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível remover o plano do grupo.",
        );
      }
      applyGroupPlanPayload(data as Record<string, unknown>, group);
    } catch (error) {
      setPlanModal((previous) => ({
        ...previous,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível remover o plano do grupo.",
      }));
    } finally {
      setGroupStatusPendingId(null);
    }
  };

  const impersonateUser = async (user: AdminUserSummary) => {
    if (
      !window.confirm(
        `Você será desconectado da sua conta atual para acessar o painel como ${user.name}. Deseja continuar?`,
      )
    ) {
      return;
    }

    setImpersonatingId(user.id);
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/users/${user.id}/impersonate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível iniciar sessão como o usuário.",
        });
        return;
      }

      const redirectTarget =
        typeof data.redirectTo === "string" && data.redirectTo.trim()
          ? data.redirectTo
          : "/dashboard/user";

      window.location.href = redirectTarget;
    } catch (error) {
      console.error("Failed to impersonate user", error);
      setFeedback({
        type: "danger",
        message: "Não foi possível iniciar sessão como o usuário.",
      });
    } finally {
      setImpersonatingId(null);
    }
  };

  const deleteUser = async (user: AdminUserSummary) => {
    if (!window.confirm(`Tem certeza de que deseja excluir permanentemente ${user.name}?`)) {
      return;
    }

    setDeletingId(user.id);
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível excluir o usuário.",
        });
        setDeletingId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Usuário excluído permanentemente.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to delete user", error);
      setFeedback({ type: "danger", message: "Não foi possível se comunicar com o servidor." });
    } finally {
      setDeletingId(null);
    }
  };

  const closeEmptyRegistrationCleanup = () => {
    if (emptyRegistrationCleanup.deleting) {
      return;
    }
    setEmptyRegistrationCleanup({
      visible: false,
      loading: false,
      deleting: false,
      error: null,
      preview: null,
      confirmation: "",
    });
  };

  const openEmptyRegistrationCleanup = async () => {
    setEmptyRegistrationCleanup({
      visible: true,
      loading: true,
      deleting: false,
      error: null,
      preview: null,
      confirmation: "",
    });

    try {
      const response = await fetch("/api/admin/users/cleanup?limit=20", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível validar os cadastros vazios.");
      }
      setEmptyRegistrationCleanup((previous) => ({
        ...previous,
        loading: false,
        preview: data as EmptyRegistrationCleanupPreview,
      }));
    } catch (error) {
      setEmptyRegistrationCleanup((previous) => ({
        ...previous,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível validar os cadastros vazios.",
      }));
    }
  };

  const deleteEmptyRegistrations = async () => {
    if (emptyRegistrationCleanup.confirmation !== "LIMPAR-CADASTROS-VAZIOS") {
      setEmptyRegistrationCleanup((previous) => ({
        ...previous,
        error: "Digite LIMPAR-CADASTROS-VAZIOS para confirmar a limpeza.",
      }));
      return;
    }

    setEmptyRegistrationCleanup((previous) => ({ ...previous, deleting: true, error: null }));
    try {
      const response = await fetch("/api/admin/users/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: emptyRegistrationCleanup.confirmation }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível concluir a limpeza.");
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Limpeza concluída.",
      });
      closeEmptyRegistrationCleanup();
      void fetchUsers({ query, status, plan, page: 1 });
      router.refresh();
    } catch (error) {
      setEmptyRegistrationCleanup((previous) => ({
        ...previous,
        deleting: false,
        error: error instanceof Error ? error.message : "Não foi possível concluir a limpeza.",
      }));
    }
  };

  const openEditModal = (user: AdminUserSummary) => {
    setEditingUser(user);

    const splitWhatsapp = (() => {
      if (!user.whatsappNumber) {
        return {
          dialCode: PHONE_COUNTRIES[0].dialCode,
          number: "",
        };
      }

      const trimmed = user.whatsappNumber.trim();
      const matchedCountry = [...PHONE_COUNTRIES]
        .sort((a, b) => b.dialCode.length - a.dialCode.length)
        .find((country) => trimmed.startsWith(country.dialCode));

      if (matchedCountry) {
        const rest = trimmed.slice(matchedCountry.dialCode.length).replace(/[^0-9]/g, "");
        return {
          dialCode: matchedCountry.dialCode,
          number: rest,
        };
      }

      const digits = trimmed.replace(/[^0-9]/g, "");
      return {
        dialCode: PHONE_COUNTRIES[0].dialCode,
        number: digits,
      };
    })();

    setFormState({
      name: user.name,
      email: user.email ?? "",
      role: user.role,
      password: "",
      balance: user.balance.toFixed(2),
      customPlanPrice:
        typeof user.customPlanPrice === "number"
          ? user.customPlanPrice.toFixed(2)
          : "",
      isActive: user.isActive,
      revokeSessions: false,
      whatsappDialCode: splitWhatsapp.dialCode,
      whatsappNumber: splitWhatsapp.number,
    });
  };

  const handleFormChange = (
    field: keyof typeof formState,
    value: string | boolean,
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const submitEdit = async () => {
    if (!editingUser) {
      return;
    }

    const payload: Record<string, unknown> = {
      role: formState.role,
      isActive: formState.isActive,
    };

    const trimmedName = formState.name.trim();
    if (trimmedName.length > 0) {
      payload.name = trimmedName;
    }

    const trimmedEmail = formState.email.trim();
    if (trimmedEmail.length > 0) {
      payload.email = trimmedEmail;
    }

    const parsedBalance = Number.parseFloat(
      formState.balance.replace(/,/g, "."),
    );
    if (!Number.isNaN(parsedBalance)) {
      payload.balance = parsedBalance;
    }

    const parseCustomPriceField = (
      rawValue: string,
      label: string,
    ): number | null | "error" => {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        return null;
      }
      const parsed = Number.parseFloat(trimmed.replace(/,/g, "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFeedback({
          type: "danger",
          message: `${label} inv�lido.`,
        });
        return "error";
      }
      return Math.round(parsed * 100) / 100;
    };

    const planOverride = parseCustomPriceField(
      formState.customPlanPrice,
      "Valor personalizado do plano",
    );
    if (planOverride === "error") {
      return;
    }
    payload.customPlanPrice = planOverride;

	    if (formState.password.trim().length > 0) {
	      payload.password = formState.password.trim();
	    }

    if (formState.revokeSessions) {
      payload.revokeSessions = true;
    }

    const whatsappDigits = formState.whatsappNumber.replace(/[^0-9]/g, "");
    if (whatsappDigits.length > 0 && (whatsappDigits.length < 8 || whatsappDigits.length > 15)) {
      setFeedback({
        type: "danger",
        message: "Informe um número de WhatsApp válido (DDD + número).",
      });
      return;
    }

    if (whatsappDigits.length > 0) {
      payload.whatsappDialCode = formState.whatsappDialCode;
      payload.whatsappNumber = whatsappDigits;
    } else if (editingUser.whatsappNumber) {
      payload.whatsappDialCode = null;
      payload.whatsappNumber = null;
    }

    const success = await updateUser(
      editingUser,
      payload,
      "Dados do usuário atualizados.",
    );

    if (success) {
      closeModal();
    }
  };

  return (
    <section className={adminStyles.adminUserManager}>
      <div className={adminStyles.adminUserToolbar}>
        <div className={adminStyles.adminUserToolbarHead}>
          <div>
            <h2>Usuários</h2>
            <p>Lista estilo conversas com busca rápida e ações compactas.</p>
          </div>
          <span className={adminStyles.adminUserMeta}>
            Página {page} • {users.length} / {total}
          </span>
        </div>
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            void fetchUsers({ query, status, plan, page: 1 });
          }}
        >
          <div className={adminStyles.adminSearchBar}>
            <IconSearch size={18} aria-hidden="true" />
            <input
              placeholder="Buscar por nome, e-mail, WhatsApp ou ID"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              aria-label="Buscar por nome, e-mail, WhatsApp ou ID"
            />
            <Dropdown align="end">
              <Dropdown.Toggle
                as="button"
                type="button"
                className={`${adminStyles.adminFilterBtn}${filtersActive ? ` ${adminStyles.adminFilterBtnActive}` : ""}`}
                aria-label="Filtros"
              >
                <IconFilter size={18} />
              </Dropdown.Toggle>
              <Dropdown.Menu className={adminStyles.adminFilterMenu}>
                <label>
                  Status
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.currentTarget.value as "all" | "active" | "inactive")}
                  >
                    <option value="all">Todos</option>
                    <option value="active">Ativos</option>
                    <option value="inactive">Inativos</option>
                  </select>
                </label>
                <label>
                  Plano
                  <select
                    value={plan}
                    onChange={(e) =>
                      setPlan(e.currentTarget.value as "all" | "with_active" | "without_active")
                    }
                  >
                    <option value="all">Todos</option>
                    <option value="with_active">Com plano ativo</option>
                    <option value="without_active">Sem plano ativo</option>
                  </select>
                </label>
                <div className={adminStyles.adminFilterMenuActions}>
                  <button type="submit" className={adminStyles.adminUserBtn} disabled={loading}>
                    {loading ? "..." : "Aplicar"}
                  </button>
                  <button
                    type="button"
                    className={adminStyles.adminUserBtnGhost}
                    onClick={() => {
                      setQuery("");
                      setStatus("all");
                      setPlan("all");
                      void fetchUsers({ query: "", status: "all", plan: "all", page: 1 });
                    }}
                  >
                    Limpar
                  </button>
                </div>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </Form>
        {error ? (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        ) : (
          <div className={adminStyles.adminUserMeta}>
            Mostrando {users.length} de {total} usuários.
          </div>
        )}
        <div className="d-flex justify-content-end">
          <Button
            variant="outline-danger"
            size="sm"
            onClick={() => void openEmptyRegistrationCleanup()}
          >
            Limpar cadastros vazios
          </Button>
        </div>
      </div>
      {feedback && (
        <Alert
          variant={feedback.type}
          onClose={() => setFeedback(null)}
          dismissible
          className="mb-4"
        >
          {feedback.message}
        </Alert>
      )}

      <div className={adminStyles.adminUserTableWrap}>
        <div className={adminStyles.adminUserPagination}>
          <span className={adminStyles.adminUserMeta}>
            Lista atualizada • {users.length} registros visíveis
          </span>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => void fetchUsers({ query, status, plan, page: 1 })}
            disabled={loading}
          >
            {loading ? "Atualizando..." : "Atualizar lista"}
          </Button>
        </div>
        <div className={adminStyles.adminRecordList}>
          {users.length === 0 ? (
            <div className={adminStyles.adminListEmpty}>
              {loading ? "Carregando usuários..." : "Nenhum usuário encontrado."}
            </div>
          ) : (
            users.map((user) => {
              const isPending = pendingId === user.id;
              const isDeleting = deletingId === user.id;
              const isImpersonating = impersonatingId === user.id;
              const isMenuResetting = menuResetId === user.id;
              const disableBaseActions = isDeleting || isMenuResetting;

              return (
                <article key={user.id} className={adminStyles.adminRecordCard}>
                  <button
                    type="button"
                    className={adminStyles.adminRecordMain}
                    onClick={() => openEditModal(user)}
                  >
                    <span className={adminStyles.adminRecordAvatar}>{userInitials(user.name)}</span>
                    <span className={adminStyles.adminRecordText}>
                      <strong>{user.name}</strong>
                      <span>{user.email ?? "Sem e-mail"}</span>
                      <small>
                        {formatWhatsapp(user.whatsappNumber)} · Saldo {formatCurrency(user.balance)} ·{" "}
                        {user.activeSessions} sessão(ões)
                      </small>
                      <span className={adminStyles.adminRecordTags}>
                        <span className={adminStyles.adminRecordTag}>{user.role}</span>
                        <span
                          className={`${adminStyles.adminRecordTag} ${
                            user.isActive
                              ? adminStyles.adminRecordTagSuccess
                              : adminStyles.adminRecordTagMuted
                          }`}
                        >
                          {user.isActive ? "Ativo" : "Inativo"}
                        </span>
                      </span>
                    </span>
                  </button>
                  <Dropdown align="end" className={adminStyles.adminActionMenu}>
                    <Dropdown.Toggle variant="light" aria-label={`Ações de ${user.name}`}>
                      <IconDotsVertical size={18} />
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item onClick={() => openPlanModal(user)} disabled={disableBaseActions}>
                        Gerenciar plano
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => openEditModal(user)} disabled={disableBaseActions}>
                        Editar usuário
                      </Dropdown.Item>
                      <Dropdown.Item
                        onClick={() => toggleStatus(user)}
                        disabled={isPending || disableBaseActions}
                      >
                        {isPending
                          ? "Atualizando..."
                          : user.isActive
                            ? "Desativar conta"
                            : "Reativar conta"}
                      </Dropdown.Item>
                      <Dropdown.Item
                        onClick={() => revokeSessions(user)}
                        disabled={isPending || disableBaseActions || isImpersonating}
                      >
                        {isPending ? "Processando..." : "Encerrar sessões"}
                      </Dropdown.Item>
                      <Dropdown.Item
                        onClick={() => resetUserMenuTexts(user)}
                        disabled={isMenuResetting || isDeleting || isPending}
                      >
                        {isMenuResetting ? "Resetando menus..." : "Resetar menus"}
                      </Dropdown.Item>
                      <Dropdown.Item
                        onClick={() => impersonateUser(user)}
                        disabled={isImpersonating || disableBaseActions || isPending}
                      >
                        {isImpersonating ? "Entrando..." : "Entrar como usuário"}
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Item
                        className="text-danger"
                        onClick={() => deleteUser(user)}
                        disabled={disableBaseActions || isPending}
                      >
                        {isDeleting ? "Excluindo..." : "Excluir usuário"}
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </article>
              );
            })
          )}
        </div>
        <div className={adminStyles.adminUserPagination}>
          <div className={adminStyles.adminUserMeta}>{hasMore ? "Há mais resultados" : "Fim da lista"}</div>
          <Button
            variant="outline-primary"
            onClick={() => void fetchUsers({ query, status, plan, page: page + 1, append: true })}
            disabled={!hasMore || loadingMore}
          >
            {loadingMore ? "Carregando..." : hasMore ? "Carregar mais" : "—"}
          </Button>
        </div>
      </div>

      <Modal
        show={emptyRegistrationCleanup.visible}
        onHide={closeEmptyRegistrationCleanup}
        centered
      >
        <Modal.Header closeButton={!emptyRegistrationCleanup.deleting}>
          <Modal.Title>Limpar cadastros vazios</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {emptyRegistrationCleanup.error && (
            <Alert variant="danger">{emptyRegistrationCleanup.error}</Alert>
          )}
          {emptyRegistrationCleanup.loading ? (
            <div className="d-flex align-items-center gap-2">
              <Spinner size="sm" /> Validando vínculos e histórico dos cadastros...
            </div>
          ) : emptyRegistrationCleanup.preview ? (
            <>
              <Alert variant="warning">
                Serão considerados somente usuários comuns com pelo menos{" "}
                {emptyRegistrationCleanup.preview.minimumAgeDays} dias, saldo zero, sem WhatsApp,
                perfil, sessão, assinatura, pagamento, grupo, mensagem, configuração ou qualquer
                outro vínculo de usuário. A exclusão é permanente.
              </Alert>
              <p className="mb-2">
                <strong>{emptyRegistrationCleanup.preview.eligibleCount}</strong> cadastro(s)
                elegível(is) encontrado(s).
              </p>
              {emptyRegistrationCleanup.preview.candidates.length > 0 && (
                <div className="border rounded p-2 mb-3" style={{ maxHeight: 180, overflowY: "auto" }}>
                  {emptyRegistrationCleanup.preview.candidates.map((candidate) => (
                    <div key={candidate.id} className="small py-1">
                      <strong>#{candidate.id}</strong> {candidate.name} — {candidate.email ?? "sem e-mail"}
                      <span className="text-muted"> · {formatDateDisplay(candidate.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
              {emptyRegistrationCleanup.preview.eligibleCount > 0 && (
                <Form.Group controlId="emptyRegistrationCleanupConfirmation">
                  <Form.Label>
                    Para confirmar, digite <code>LIMPAR-CADASTROS-VAZIOS</code>
                  </Form.Label>
                  <Form.Control
                    value={emptyRegistrationCleanup.confirmation}
                    onChange={(event) =>
                      setEmptyRegistrationCleanup((previous) => ({
                        ...previous,
                        confirmation: event.currentTarget.value,
                        error: null,
                      }))
                    }
                    disabled={emptyRegistrationCleanup.deleting}
                  />
                </Form.Group>
              )}
            </>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={closeEmptyRegistrationCleanup}
            disabled={emptyRegistrationCleanup.deleting}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => void deleteEmptyRegistrations()}
            disabled={
              emptyRegistrationCleanup.loading ||
              emptyRegistrationCleanup.deleting ||
              !emptyRegistrationCleanup.preview ||
              emptyRegistrationCleanup.preview.eligibleCount === 0
            }
          >
            {emptyRegistrationCleanup.deleting ? "Limpando..." : "Excluir cadastros elegíveis"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={Boolean(editingUser)} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Editar usuário</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="editUserName">
                  <Form.Label>Nome</Form.Label>
                  <Form.Control
                    type="text"
                    value={formState.name}
                    onChange={(event) => handleFormChange("name", event.target.value)}
                    placeholder="Nome completo"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="editUserEmail">
                  <Form.Label>E-mail</Form.Label>
                  <Form.Control
                    type="email"
                    value={formState.email}
                    onChange={(event) => handleFormChange("email", event.target.value)}
                    placeholder="usuario@exemplo.com"
                  />
                </Form.Group>
              </Col>
              <Col md={12}>
                <Form.Group controlId="editUserWhatsapp">
                  <Form.Label>WhatsApp</Form.Label>
                  <InputGroup>
                    <DropdownButton
                      variant="outline-secondary"
                      id="editUserWhatsappDial"
                      title={(() => {
                        const selected = findCountryByDialCode(formState.whatsappDialCode) ?? PHONE_COUNTRIES[0];
                        return (
                          <span className="d-inline-flex align-items-center gap-2">
                            <NextImage
                              src={`/flags/${selected.code.toLowerCase()}.svg`}
                              alt={`Bandeira ${selected.label}`}
                              width={24}
                              height={16}
                              className="rounded border"
                              sizes="24px"
                            />
                            <span>{selected.dialCode}</span>
                          </span>
                        );
                      })()}
                      onSelect={(eventKey) => {
                        if (!eventKey) {
                          return;
                        }
                        setFormState((prev) => ({
                          ...prev,
                          whatsappDialCode: eventKey,
                        }));
                      }}
                    >
                      {PHONE_COUNTRIES.map((country) => (
                        <Dropdown.Item eventKey={country.dialCode} key={country.code}>
                          <span className="d-inline-flex align-items-center gap-2">
                            <NextImage
                              src={`/flags/${country.code.toLowerCase()}.svg`}
                              alt={`Bandeira ${country.label}`}
                              width={24}
                              height={16}
                              className="rounded border"
                              sizes="24px"
                            />
                            <span>{country.label} ({country.dialCode})</span>
                          </span>
                        </Dropdown.Item>
                      ))}
                    </DropdownButton>
                    <Form.Control
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]{0,15}"
                      placeholder="DDD + número"
                      value={formState.whatsappNumber}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/[^0-9]/g, "");
                        setFormState((prev) => ({
                          ...prev,
                          whatsappNumber: digits,
                        }));
                      }}
                    />
                  </InputGroup>
                  <Form.Text className="text-secondary">
                    Informe apenas números. Para remover o WhatsApp, deixe em branco.
                  </Form.Text>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="editUserRole">
                  <Form.Label>Perfil</Form.Label>
                  <Form.Select
                    value={formState.role}
                    onChange={(event) =>
                      handleFormChange("role", event.target.value as "admin" | "user")
                    }
                  >
                    <option value="user">Usuário</option>
                    <option value="admin">Administrador</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="editUserBalance">
                  <Form.Label>Saldo (R$)</Form.Label>
                  <Form.Control
                    type="number"
                    min="0"
                    step="0.01"
                    value={formState.balance}
                    onChange={(event) => handleFormChange("balance", event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="editUserPassword">
                  <Form.Label>Senha</Form.Label>
                  <Form.Control
                    type="password"
                    value={formState.password}
                    autoComplete="new-password"
                    onChange={(event) => handleFormChange("password", event.target.value)}
                    placeholder="Deixe em branco para manter"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="editUserStatus">
                  <Form.Label>Status</Form.Label>
                  <Form.Select
                    value={formState.isActive ? "active" : "inactive"}
                    onChange={(event) =>
                      handleFormChange("isActive", event.target.value === "active")
                    }
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col xs={12}>
                <div className="border-top pt-3 mt-2">
                  <Form.Label className="fw-semibold">Valores personalizados (opcional)</Form.Label>
	                  <Form.Text className="text-secondary d-block">
	                    Utilize para aplicar descontos permanentes neste usu�rio. Deixe em branco para
	                    usar os valores padr�o do plano.
	                  </Form.Text>
	                </div>
	              </Col>
	              <Col md={6}>
	                <Form.Group controlId="editUserCustomPlanPrice">
	                  <Form.Label>Plano (R$)</Form.Label>
	                  <Form.Control
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Padr�o do plano"
                    value={formState.customPlanPrice}
                    onChange={(event) => handleFormChange("customPlanPrice", event.target.value)}
	                  />
	                </Form.Group>
	              </Col>
              <Col xs={12}>
                <Form.Check
                  type="switch"
                  id="editUserRevokeSessions"
                  label="Encerrar sessões ativas"
                  checked={formState.revokeSessions}
                  onChange={(event) => handleFormChange("revokeSessions", event.target.checked)}
                />
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={closeModal}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={submitEdit}
            disabled={editingUser ? pendingId === editingUser.id : false}
          >
            {editingUser && pendingId === editingUser.id ? "Salvando..." : "Salvar alterações"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={planModal.visible}
        onHide={closePlanModal}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>
            Gerenciar plano
            {planModal.user ? ` — ${planModal.user.name}` : ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {planModal.error && (
            <Alert
              variant="danger"
              onClose={() =>
                setPlanModal((previous) => ({
                  ...previous,
                  error: null,
                }))
              }
              dismissible
            >
              {planModal.error}
            </Alert>
          )}
          {planModal.feedback && (
            <Alert
              variant={planModal.feedback.type}
              onClose={() =>
                setPlanModal((previous) => ({
                  ...previous,
                  feedback: null,
                }))
              }
              dismissible
            >
              {planModal.feedback.message}
            </Alert>
          )}

          {planModal.loading ? (
            <div className="d-flex justify-content-center py-4">
              <Spinner animation="border" role="status">
                <span className="visually-hidden">Carregando...</span>
              </Spinner>
            </div>
          ) : planModal.overview ? (
            <>
              <div className="mb-4">
                <h6 className="mb-1">Resumo atual</h6>
                {planModal.overview.status.plan ? (
                  <div className="text-secondary">
                    <p className="mb-1">
                      Plano: <strong>{planModal.overview.status.plan.name}</strong>{" "}
                      ({formatCurrency(planModal.overview.status.plan.price)} / {planModal.overview.status.plan.durationDays} dias)
	                    </p>
	                    {(() => {
	                      const customPlanPrice = planModal.user?.customPlanPrice;

	                      if (typeof customPlanPrice !== "number") {
	                        return null;
	                      }

	                      return (
	                        <div className="text-warning small mb-2">
	                          Valor personalizado do plano:{" "}
	                          <strong>{formatCurrency(customPlanPrice)}</strong>
	                        </div>
	                      );
	                    })()}
                    <p className="mb-1">
                      Instâncias incluídas:{" "}
                      {planModal.overview.status.plan.instanceLimit === 0
                        ? "Ilimitadas"
                        : planModal.overview.status.plan.instanceLimit}
                      {" · "}Grupos incluídos:{" "}
                      {planModal.overview.status.plan.groupLimit === 0
                        ? "Ilimitados"
                        : planModal.overview.status.plan.groupLimit}
                    </p>
                    <p className="mb-0">
                      Período:{" "}
                      {planModal.overview.status.currentPeriodStart
                        ? `${formatDateDisplay(planModal.overview.status.currentPeriodStart)} → ${formatDateDisplay(planModal.overview.status.currentPeriodEnd)}`
                        : "Sem período registrado"}
                    </p>
                  </div>
                ) : (
                  <p className="text-secondary mb-0">
                    Usuário sem plano atribuído no momento.
                  </p>
                )}
              </div>

              <Form
                className="d-flex flex-column gap-3 mb-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPlanUpdate();
                }}
              >
                <Row className="g-3">
                  <Col lg={6}>
                    <Form.Group controlId="planManagerSelect">
                      <Form.Label>Plano</Form.Label>
                      <Form.Select
                        value={planModal.planForm.planId}
                        onChange={(event) => handlePlanSelect(event.target.value)}
                      >
                        <option value="">Selecione um plano</option>
                        {planModal.overview.plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name} — {formatCurrency(plan.price)} ({plan.durationDays} dias)
                          </option>
                        ))}
                      </Form.Select>
                      <Form.Text className="text-secondary">
                        O valor mensal já inclui os limites definidos para o plano.
                      </Form.Text>
                    </Form.Group>
                  </Col>
                  <Col lg={6}>
                    <Form.Group controlId="planManagerStatus">
                      <Form.Label>Status da assinatura</Form.Label>
                      <Form.Select
                        value={planModal.planForm.status}
                        onChange={(event) =>
                          handlePlanFormChange(
                            "status",
                            event.target.value as PlanStatusValue,
                          )
                        }
                        disabled={!planModal.planForm.planId}
                      >
                        {planStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                </Row>
                <Row className="g-3">
                  <Col lg={6}>
                    <Form.Group controlId="planManagerEnd">
                      <Form.Label>Data de vencimento</Form.Label>
                      <Form.Control
                        type="datetime-local"
                        step={60}
                        value={planModal.planForm.periodEnd}
                        onChange={(event) => handlePlanExpiryChange(event.target.value)}
                        disabled={!planModal.planForm.planId}
                      />
                      <Form.Text className="text-secondary">
                        Ajuste o vencimento atual do plano com data e hora.
                      </Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
                <div className="d-flex flex-column gap-2">
	                  <Form.Check
	                    type="switch"
	                    id="planManagerAutoRenew"
	                    label="Renovar plano automaticamente"
	                    checked={planModal.planForm.autoRenewPlan}
	                    onChange={() => handlePlanToggle("autoRenewPlan")}
	                    disabled={!planModal.planForm.planId}
	                  />
	                </div>
                <div className="d-flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={planModal.saving || !planModal.planForm.planId}
                  >
                    {planModal.saving ? "Salvando..." : "Salvar plano"}
                  </Button>
                  <Button
                    variant="outline-danger"
                    onClick={removeUserPlan}
                    disabled={
                      planModal.removing || !planModal.overview.status.planId
                    }
                  >
                    {planModal.removing ? "Removendo..." : "Remover plano"}
                  </Button>
                </div>
              </Form>

	              <div>
	                <div className="d-flex justify-content-between align-items-center mb-3">
	                  <div>
		                    <h6 className="mb-1">Licenças legadas dos grupos</h6>
		                    <p className="text-secondary small mb-0">
		                      A assinatura atual é única por perfil. Use esta área só para consultar ou corrigir dados antigos.
		                    </p>
	                  </div>
	                </div>

	                {planModal.overview.groups.length === 0 ? (
	                  <p className="text-secondary mb-0">
	                    Nenhum grupo registrado para este usuário.
	                  </p>
	                ) : (
	                  <div className="table-responsive">
	                    <Table size="sm" hover className="align-middle">
	                      <thead>
	                        <tr>
	                          <th>Grupo</th>
	                          <th>Status</th>
		                          <th>Plano da licença</th>
	                          <th>Validade do grupo</th>
	                          <th className="text-end">Ações</th>
	                        </tr>
	                      </thead>
	                      <tbody>
	                        {planModal.overview.groups.map((group) => {
	                          const draft =
	                            groupPlanDrafts[group.id] ??
	                            buildGroupPlanDraft(group, planModal.overview?.plans ?? []);
	                          const isSaving = groupStatusPendingId === group.id;
	                          const licenseSummary = buildGroupLicenseStatusSummary(group.metadata);
	                          const licenseActive = licenseSummary.isActive;
	                          const selectedPlan = planModal.overview?.plans.find(
	                            (plan) => plan.id.toString() === draft.planId,
	                          );

	                          return (
	                            <tr key={group.id}>
	                              <td style={{ minWidth: 260 }}>
	                                <div className="d-flex align-items-center gap-2">
	                                  {group.imageUrl ? (
	                                    <img
	                                      src={group.imageUrl}
	                                      alt=""
	                                      width={40}
	                                      height={40}
	                                      className="rounded-circle object-fit-cover"
	                                    />
	                                  ) : (
	                                    <span
	                                      className="rounded-circle bg-success text-white d-inline-flex align-items-center justify-content-center fw-semibold"
	                                      style={{ width: 40, height: 40, flex: "0 0 40px" }}
	                                    >
	                                      {getGroupInitials(group.name)}
	                                    </span>
	                                  )}
	                                  <div>
	                                    <div className="fw-semibold">{group.name || "Grupo sem nome"}</div>
	                                    <div className="small text-secondary">
	                                      {group.remoteId || "ID não disponível"}
	                                      {group.slot > 0 ? ` · Slot ${group.slot}` : ""}
	                                    </div>
	                                  </div>
	                                </div>
	                              </td>
	                              <td>
	                                <div className="d-flex flex-column gap-1 align-items-start">
	                                  <Badge bg={group.status === "active" ? "success" : "secondary"}>
	                                    {group.status === "active" ? "Ativo" : "Desativado"}
	                                  </Badge>
	                                  <Badge
	                                    bg={licenseSummary.statusVariant}
	                                    text={licenseSummary.statusVariant === "warning" ? "dark" : undefined}
	                                  >
	                                    {licenseSummary.statusLabel}
	                                  </Badge>
	                                  <Badge bg="light" text="dark">{licenseSummary.sourceLabel}</Badge>
	                                </div>
	                              </td>
	                              <td style={{ minWidth: 220 }}>
	                                <Form.Select
	                                  size="sm"
	                                  value={draft.planId}
	                                  onChange={(event) =>
	                                    handleGroupPlanDraftChange(group, "planId", event.target.value)
	                                  }
	                                  disabled={isSaving}
	                                >
	                                  <option value="">Selecione um plano</option>
	                                  {planModal.overview?.plans.map((plan) => (
	                                    <option key={plan.id} value={plan.id}>
	                                      {plan.name} — {formatCurrency(plan.price)}
	                                    </option>
	                                  ))}
	                                </Form.Select>
	                                <div className="small text-secondary mt-1">
	                                  {selectedPlan
	                                    ? `${selectedPlan.durationDays} dias`
	                                    : group.metadata.licensePlanName || "Sem plano definido"}
	                                </div>
	                              </td>
	                              <td style={{ minWidth: 160 }}>
	                                <Form.Control
                                  type="datetime-local"
                                  step={60}
                                  size="sm"
	                                  value={draft.expiresAt}
	                                  onChange={(event) =>
	                                    handleGroupPlanDraftChange(group, "expiresAt", event.target.value)
	                                  }
	                                  disabled={isSaving}
	                                />
	                                <div className="small text-secondary mt-1">
	                                  {group.metadata.licenseExpiresAt
	                                    ? `${licenseActive ? "Vence" : "Venceu"}: ${formatDateDisplay(group.metadata.licenseExpiresAt)}`
	                                    : "Defina a validade para ativar o grupo"}
	                                </div>
	                              </td>
	                              <td className="text-end" style={{ minWidth: 270 }}>
	                                <div className="d-flex justify-content-end gap-2 flex-wrap">
	                                  <Button
	                                    size="sm"
	                                    variant="primary"
	                                    disabled={isSaving || !draft.planId}
	                                    onClick={() => submitGroupPlanUpdate(group, true)}
	                                  >
	                                    {isSaving ? "Salvando..." : "Salvar e ativar"}
	                                  </Button>
	                                  <Button
	                                    size="sm"
	                                    variant="outline-secondary"
	                                    disabled={isSaving || !draft.planId}
	                                    onClick={() => updatePlanModalGroupActivation(group, false)}
	                                  >
	                                    Desativar
	                                  </Button>
	                                  <Button
	                                    size="sm"
	                                    variant="outline-danger"
	                                    disabled={isSaving || !licenseSummary.expiresAt}
	                                    onClick={() => removeGroupPlan(group)}
	                                  >
	                                    Remover plano
	                                  </Button>
	                                </div>
	                              </td>
	                            </tr>
	                          );
	                        })}
	                      </tbody>
	                    </Table>
	                  </div>
	                )}
	              </div>
            </>
          ) : (
            <p className="text-secondary mb-0">
              Nenhuma informação de plano disponível para este usuário.
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={closePlanModal}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>

	    </section>
  );
};

export default AdminUserManager;
