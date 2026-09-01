"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Dropdown, Form, ListGroup, Modal, Spinner } from "react-bootstrap";
import { IconDotsVertical, IconPhone, IconShield } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import adminStyles from "components/admin/AdminBotWorkspace.module.css";

import type { BotInstance, BotInstanceAdminSummary, BotServer } from "types/bot-instances";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  formatPhoneCountryLabel,
  findPhoneCountryByIso,
} from "lib/phone-countries";
import FloatingAlert from "components/common/FloatingAlert";

type Feedback = { type: "success" | "danger" | "warning"; message: string } | null;
type FeedbackType = NonNullable<Feedback>["type"];

type PairingState =
  | null
  | {
      instanceId: number;
      name: string;
      purpose?: "admin_system" | "regular";
      linkingCode?: string;
      qrCode?: string;
    };

interface AdminInstanceManagerProps {
  instances: BotInstanceAdminSummary[];
  servers: BotServer[];
}

type UserOption = {
  id: number;
  email: string | null;
  name: string;
};

const statusBadge = (status: string) => {
  switch (status) {
    case "conectado":
      return { label: "Conectado", variant: "success" as const };
    case "aguardando_qr":
      return { label: "Aguardando QR", variant: "warning" as const };
    case "aguardando_pareamento":
      return { label: "Aguardando pareamento", variant: "warning" as const };
    case "inicializando":
      return { label: "Inicializando", variant: "info" as const };
    default:
      return { label: "Desconectado", variant: "secondary" as const };
  }
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const AdminInstanceManager = ({ instances, servers }: AdminInstanceManagerProps) => {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pendingInstanceId, setPendingInstanceId] = useState<number | null>(null);
  const [pairingState, setPairingState] = useState<PairingState>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [systemInstance, setSystemInstance] = useState<BotInstance | null>(null);
  const [systemServers, setSystemServers] = useState<BotServer[]>(servers);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemSaving, setSystemSaving] = useState(false);
  const [showSystemModal, setShowSystemModal] = useState(false);
  const [systemForm, setSystemForm] = useState({
    serverId: servers.length > 0 ? servers[0].id.toString() : "",
    name: "BotAdmin Verificações",
    phone: "",
  });
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isDeletingDisconnected, setIsDeletingDisconnected] = useState(false);
  const [nativeButtonsSummary, setNativeButtonsSummary] = useState<{
    totalInstances: number;
    enabledInstances: number;
  } | null>(null);
  const [nativeButtonsLoading, setNativeButtonsLoading] = useState(false);
  const [nativeButtonsUpdating, setNativeButtonsUpdating] = useState(false);
  const [createForm, setCreateForm] = useState({
    userId: "",
    serverId: servers.length > 0 ? servers[0].id.toString() : "",
    phoneCountryIso: DEFAULT_PHONE_COUNTRY.iso2,
    phoneLocal: "",
    name: "",
  });
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [userFetchError, setUserFetchError] = useState<string | null>(null);
  const [userListHasMore, setUserListHasMore] = useState(false);
  const userFetchAbort = useRef<AbortController | null>(null);

  const serverOptions = useMemo(
    () => servers.map((server) => ({ label: server.name, value: server.id.toString() })),
    [servers],
  );

  const systemServerOptions = useMemo(
    () => systemServers.map((server) => ({ label: server.name, value: server.id.toString() })),
    [systemServers],
  );

  const disconnectedSessionInstances = useMemo(
    () =>
      instances.filter(
        (instance) =>
          instance.purpose !== "admin_system" && instance.sessionStatus === "desconectado",
      ),
    [instances],
  );

  const resetCreateModalState = useCallback(() => {
    setCreateForm({
      userId: "",
      serverId: servers.length > 0 ? servers[0].id.toString() : "",
      phoneCountryIso: DEFAULT_PHONE_COUNTRY.iso2,
      phoneLocal: "",
      name: "",
    });
    userFetchAbort.current?.abort();
    userFetchAbort.current = null;
    setUserSearchTerm("");
    setUserOptions([]);
    setSelectedUser(null);
    setUserFetchError(null);
    setUserListHasMore(false);
    setIsLoadingUsers(false);
  }, [servers]);

  const loadUserOptions = useCallback(
    async (term: string) => {
      const normalizedTerm = term.trim();

      if (userFetchAbort.current) {
        userFetchAbort.current.abort();
      }

      const controller = new AbortController();
      userFetchAbort.current = controller;

      setIsLoadingUsers(true);
      setUserFetchError(null);

      try {
        const params = new URLSearchParams();
        if (normalizedTerm) {
          params.set("q", normalizedTerm);
        }
        params.set("limit", "20");

        const response = await fetch(`/api/admin/users?${params.toString()}`, {
          signal: controller.signal,
        });

        const data = (await response.json().catch(() => ({}))) as {
          users?: Array<{ id: number; email: string; name?: string | null }>;
          hasMore?: boolean;
          message?: string;
        };

        if (!response.ok) {
          throw new Error(data.message ?? "Nao foi possivel carregar os usuarios.");
        }

        const mapped =
          Array.isArray(data.users) && data.users.length > 0
            ? data.users.map((user) => ({
                id: user.id,
                email: user.email ?? null,
                name: user.name ?? "",
              }))
            : [];

        let nextOptions = mapped;
        if (selectedUser && selectedUser.id && !nextOptions.some((option) => option.id === selectedUser.id)) {
          nextOptions = [selectedUser, ...nextOptions];
        }

        setUserOptions(nextOptions);
        setUserListHasMore(Boolean(data.hasMore));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        console.error("Failed to fetch admin users", error);
        setUserFetchError("Nao foi possivel carregar os usuarios. Tente novamente.");
        setUserOptions(selectedUser ? [selectedUser] : []);
        setUserListHasMore(false);
      } finally {
        if (userFetchAbort.current === controller) {
          userFetchAbort.current = null;
        }
        setIsLoadingUsers(false);
      }
    },
    [selectedUser],
  );

  const handleSelectUser = useCallback((user: UserOption) => {
    setSelectedUser(user);
    setCreateForm((prev) => ({ ...prev, userId: user.id.toString() }));
    setUserSearchTerm(user.email ?? "");
    setUserFetchError(null);
  }, []);

  const loadNativeButtonsSummary = useCallback(async () => {
    setNativeButtonsLoading(true);
    try {
      const response = await fetch("/api/admin/bot-instances/native-buttons", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.message === "string"
            ? data.message
            : "Não foi possível carregar o status global dos botões.",
        );
      }
      setNativeButtonsSummary(
        data?.summary ?? { totalInstances: 0, enabledInstances: 0 },
      );
    } catch (error) {
      console.error("Failed to load native buttons summary (admin)", error);
      setFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o status global dos botões.",
      });
    } finally {
      setNativeButtonsLoading(false);
    }
  }, []);

  const loadAdminSystemInstance = useCallback(async () => {
    setSystemLoading(true);
    try {
      const response = await fetch("/api/admin/system-instance", {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        instance?: BotInstance | null;
        servers?: BotServer[];
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível carregar a instância operacional.");
      }
      setSystemInstance(data.instance ?? null);
      setSystemServers(Array.isArray(data.servers) ? data.servers : servers);
    } catch (error) {
      console.error("Failed to load admin system instance", error);
      setFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a instância operacional.",
      });
    } finally {
      setSystemLoading(false);
    }
  }, [servers]);

  useEffect(() => {
    void loadAdminSystemInstance();
  }, [loadAdminSystemInstance]);

  useEffect(() => {
    void loadNativeButtonsSummary();
  }, [loadNativeButtonsSummary]);

  const handleToggleNativeButtons = useCallback(async () => {
    if (!nativeButtonsSummary || nativeButtonsSummary.totalInstances === 0) {
      setFeedback({
        type: "warning",
        message: "Cadastre ao menos uma instância para usar esta opção.",
      });
      return;
    }
    if (nativeButtonsUpdating || nativeButtonsLoading) {
      return;
    }
    const currentlyEnabled =
      nativeButtonsSummary.enabledInstances === nativeButtonsSummary.totalInstances;
    const nextValue = !currentlyEnabled;
    setNativeButtonsUpdating(true);
    try {
      const response = await fetch("/api/admin/bot-instances/native-buttons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextValue }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.message === "string"
            ? data.message
            : "Não foi possível atualizar os botões.",
        );
      }
      if (data?.summary) {
        setNativeButtonsSummary(data.summary);
      } else {
        await loadNativeButtonsSummary();
      }
      setFeedback({
        type: "success",
        message:
          typeof data?.message === "string"
            ? data.message
            : "Configuração global atualizada.",
      });
    } catch (error) {
      console.error("Failed to toggle native buttons globally", error);
      setFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Erro ao atualizar os botões nativos.",
      });
    } finally {
      setNativeButtonsUpdating(false);
    }
  }, [nativeButtonsSummary, nativeButtonsUpdating, nativeButtonsLoading, loadNativeButtonsSummary]);

  useEffect(() => {
    if (!showCreateModal) {
      return;
    }

    setIsLoadingUsers(true);

    const handler = window.setTimeout(() => {
      loadUserOptions(userSearchTerm);
    }, 300);

    return () => {
      window.clearTimeout(handler);
    };
  }, [showCreateModal, userSearchTerm, loadUserOptions]);

  useEffect(() => {
    return () => {
      userFetchAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!pairingState) {
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const response =
          pairingState.purpose === "admin_system"
            ? await fetch("/api/admin/system-instance/status", { cache: "no-store" })
            : await fetch(`/api/admin/bot-instances/${pairingState.instanceId}/status`, {
                cache: "no-store",
              });
        const payload = (await response.json().catch(() => ({}))) as {
          status?: string;
          instance?: BotInstance | null;
        };
        const nextStatus =
          payload.status ?? (payload.instance?.sessionStatus ? payload.instance.sessionStatus : undefined);
        if (!response.ok || nextStatus !== "conectado" || cancelled) {
          return;
        }
        if (pairingState.purpose === "admin_system" && payload.instance) {
          setSystemInstance(payload.instance);
        }
        setPairingState(null);
        setFeedback({ type: "success", message: "Conexão estabelecida. Pareamento concluído." });
        router.refresh();
        if (interval) window.clearInterval(interval);
        if (timeout) window.clearTimeout(timeout);
      } catch {
        // polling permanece como fallback silencioso
      }
    };

    void check();
    interval = window.setInterval(() => {
      void check();
    }, 1000);
    timeout = window.setTimeout(() => {
      if (interval) window.clearInterval(interval);
    }, 120000);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [pairingState, router]);

  const handleCloseModal = () => {
    if (isSaving) return;
    setShowCreateModal(false);
    resetCreateModalState();
  };

  const handleCreateInstance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!createForm.userId) {
      setFeedback({
        type: "warning",
        message: "Selecione um usuario para vincular a instancia.",
      });
      return;
    }

    const selectedCountry =
      findPhoneCountryByIso(createForm.phoneCountryIso) ?? DEFAULT_PHONE_COUNTRY;
    const localDigits = createForm.phoneLocal.replace(/\D+/g, "");
    const trimmedLocal = localDigits.replace(/^0+/, "");
    if (!trimmedLocal) {
      setFeedback({
        type: "warning",
        message: "Informe o número com DDD (somente dígitos).",
      });
      return;
    }
    const combinedPhone = `${selectedCountry.dialCode}${trimmedLocal}`;

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/bot-instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: createForm.userId,
          serverId: createForm.serverId,
          phone: combinedPhone,
          name: createForm.name,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível criar a instância.",
        });
        setIsSaving(false);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Instância criada com sucesso.",
      });
      setIsSaving(false);
      setShowCreateModal(false);
      resetCreateModalState();
      router.refresh();
    } catch (error) {
      console.error("Failed to create instance (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao criar a instância.",
      });
      setIsSaving(false);
    }
  };

  const openSystemModal = () => {
    const fallbackServerId =
      systemInstance?.serverId?.toString() ??
      systemServers[0]?.id?.toString() ??
      servers[0]?.id?.toString() ??
      "";
    setSystemForm({
      serverId: fallbackServerId,
      name: systemInstance?.name ?? "BotAdmin Verificações",
      phone: systemInstance?.phone ?? "",
    });
    setShowSystemModal(true);
  };

  const requestSystemPairing = async (forceReconnect: boolean, instanceOverride?: BotInstance) => {
    const target = instanceOverride ?? systemInstance;
    if (!target) {
      setFeedback({
        type: "warning",
        message: "Configure a instância operacional antes de gerar o pareamento.",
      });
      return;
    }

    setPendingInstanceId(target.id);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/system-instance/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto", forceReconnect }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível gerar o pareamento da instância operacional.",
        });
        return;
      }
      setPairingState({
        instanceId: target.id,
        name: target.name,
        purpose: "admin_system",
        linkingCode: data.data?.linkingCode,
        qrCode: data.data?.qrCode,
      });
      if (data.instance) {
        setSystemInstance(data.instance);
      }
      if (forceReconnect) {
        setFeedback({
          type: "success",
          message: "Sessão antiga reiniciada. Use o pareamento para conectar o novo número.",
        });
      }
    } catch (error) {
      console.error("Failed to request admin system pairing", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao gerar o pareamento da instância operacional.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const saveSystemInstance = async (pairAfterSave: boolean) => {
    const phone = systemForm.phone.replace(/\D+/g, "");
    if (phone.length < 10) {
      setFeedback({
        type: "warning",
        message: "Informe o número completo da instância operacional com DDI e DDD.",
      });
      return;
    }

    if (!systemInstance && !systemForm.serverId) {
      setFeedback({
        type: "warning",
        message: "Selecione um servidor para criar a instância operacional.",
      });
      return;
    }

    setSystemSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/system-instance", {
        method: systemInstance ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: systemForm.serverId,
          name: systemForm.name.trim() || "BotAdmin Verificações",
          phone,
          resetSession: pairAfterSave && Boolean(systemInstance),
          forceReconnect: pairAfterSave && Boolean(systemInstance),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível salvar a instância operacional.",
        });
        return;
      }

      const saved = data.instance as BotInstance | undefined;
      if (saved) {
        setSystemInstance(saved);
      }
      setShowSystemModal(false);
      setFeedback({
        type: "success",
        message:
          data.message ??
          (pairAfterSave
            ? "Instância operacional salva. Gere o pareamento do novo número."
            : "Instância operacional salva."),
      });
      router.refresh();

      if (pairAfterSave && saved) {
        await requestSystemPairing(Boolean(systemInstance), saved);
      }
    } catch (error) {
      console.error("Failed to save admin system instance", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao salvar a instância operacional.",
      });
    } finally {
      setSystemSaving(false);
    }
  };

  const handlePairing = async (instance: BotInstanceAdminSummary) => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}/pair`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível gerar o pareamento.",
        });
        setPendingInstanceId(null);
        return;
      }

      setPairingState({
        instanceId: instance.id,
        name: instance.name,
        purpose: "regular",
        linkingCode: data.data?.linkingCode,
        qrCode: data.data?.qrCode,
      });
    } catch (error) {
      console.error("Failed to request pairing (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao gerar o pareamento.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleRename = async (instance: BotInstanceAdminSummary) => {
    const newName = window.prompt("Informe o novo nome da instância:", instance.name);
    if (!newName || newName.trim() === instance.name) {
      return;
    }

    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível renomear a instância.",
        });
        setPendingInstanceId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Instância renomeada.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to rename instance (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao renomear a instância.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleTransfer = async (instance: BotInstanceAdminSummary) => {
    const value = window.prompt(
      "Informe o e-mail do usuário que receberá esta instância:",
      instance.userEmail ?? "",
    );
    if (!value) {
      return;
    }

    const trimmedEmail = value.trim();
    if (!trimmedEmail || trimmedEmail.toLowerCase() === (instance.userEmail ?? "").toLowerCase()) {
      return;
    }

    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userEmail: trimmedEmail }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível transferir a instância.",
        });
        setPendingInstanceId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Instância transferida.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to transfer instance (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao transferir a instância.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleLicenseSalesToggle = async (instance: BotInstanceAdminSummary, enabled: boolean) => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseSalesEnabled: enabled }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível atualizar a renovação pelo grupo.",
        });
        setPendingInstanceId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: enabled
          ? "Renovação pelo grupo ativada para a instância."
          : "Renovação pelo grupo desativada para a instância.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to update instance license sales (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao atualizar a renovação pelo grupo.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handlePurgeSession = async (instance: BotInstanceAdminSummary) => {
    const confirmation = window.confirm(
      `Remover a instância desconectada "${instance.name}" do painel e do servidor? O perfil do usuário será preservado para reconexão.`,
    );
    if (!confirmation) {
      return;
    }

    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}/purge`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível limpar a sessão.",
        });
        setPendingInstanceId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Instância removida. O perfil do usuário foi preservado.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to purge instance session (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao limpar a sessão.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleDelete = async (instance: BotInstanceAdminSummary) => {
    const confirmation = window.confirm(
      `Excluir permanentemente o perfil "${instance.name}"? Esta ação remove o slot do usuário, desconecta o número e apaga conversas, histórico e mídias. Não pode ser desfeita.`,
    );
    if (!confirmation) {
      return;
    }

    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível remover a instância.",
        });
        setPendingInstanceId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Instância removida.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to delete instance (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao remover a instância.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleAction = async (
    instance: BotInstanceAdminSummary,
    action: "connect" | "logout" | "restart",
  ) => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível executar a ação.",
        });
        setPendingInstanceId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Ação enviada.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to execute instance action (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao executar a ação.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleSyncWebhook = async (instance: BotInstanceAdminSummary) => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}/webhook`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Nao foi possivel sincronizar o webhook.",
        });
        setPendingInstanceId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Webhook sincronizado com sucesso.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to sync instance webhook (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao sincronizar o webhook.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleRefreshStatus = async (instance: BotInstanceAdminSummary) => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instance.id}/status`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível atualizar o status.",
        });
        setPendingInstanceId(null);
        return;
      }
      setFeedback({
        type: "success",
        message: "Status atualizado.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to refresh instance status (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao atualizar o status.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleRefreshAll = async () => {
    setIsRefreshingAll(true);
    setFeedback(null);
    try {
      await Promise.all(
        instances.map(async (instance) => {
          await fetch(`/api/admin/bot-instances/${instance.id}/status`).catch(() => null);
        }),
      );
      router.refresh();
      setFeedback({ type: "success", message: "Status das instâncias atualizado." });
    } catch (error) {
      console.error("Failed to refresh all instances (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao atualizar os status.",
      });
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const handleSyncAllWebhooks = async () => {
    setIsSyncingAll(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/bot-instances/webhooks", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.message === "string"
            ? data.message
            : "N�o foi poss�vel sincronizar os webhooks.",
        );
      }
      router.refresh();
      const summary = data?.summary ?? {};
      const total = typeof summary?.total === "number" ? summary.total : instances.length;
      const failures = Array.isArray(summary?.failures) ? summary.failures : [];
      const succeeded =
        typeof summary?.succeeded === "number"
          ? summary.succeeded
          : Math.max(0, total - failures.length);

      if (failures.length > 0) {
        const sampleNames = failures
          .slice(0, 3)
          .map((item: Record<string, unknown>) =>
            typeof item?.name === "string" && item.name.trim()
              ? item.name.trim()
              : item?.instanceId != null
                ? String(item.instanceId)
                : "",
          )
          .filter(Boolean);

        setFeedback({
          type: "warning",
          message:
            (typeof data?.message === "string" && data.message) ||
            `Webhooks sincronizados para ${succeeded} de ${total} inst�ncias. Falhas: ${
              failures.length
            }${
              sampleNames.length
                ? ` (${sampleNames.join(", ")}${
                    failures.length > sampleNames.length ? "..." : ""
                  })`
                : ""
            }.`,
        });
      } else {
        setFeedback({
          type: "success",
          message:
            (typeof data?.message === "string" && data.message) ||
            `Webhooks sincronizados com sucesso para ${succeeded} inst�ncias.`,
        });
      }
    } catch (error) {
      console.error("Failed to sync webhooks (admin)", error);
      setFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "N�o foi poss�vel sincronizar os webhooks solicitados.",
      });
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handlePurgeDisconnectedSessions = async () => {
    if (disconnectedSessionInstances.length === 0) {
      setFeedback({
        type: "warning",
        message: "Não há sessões desconectadas para limpar.",
      });
      return;
    }

    const confirmRemoval =
      typeof window !== "undefined"
        ? window.confirm(
            `Remover ${disconnectedSessionInstances.length} instância(s) desconectada(s) do painel e dos servidores? Os perfis dos usuários serão preservados para reconexão.`,
          )
        : true;
    if (!confirmRemoval) {
      return;
    }

    setIsDeletingDisconnected(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/bot-instances/purge-disconnected", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível limpar as sessões desconectadas.",
        });
        return;
      }

      setFeedback({
        type: data.summary?.failed > 0 ? "warning" : "success",
        message:
          data.message ??
          "Instâncias desconectadas removidas com sucesso. Os perfis dos usuários foram preservados.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to purge disconnected instances (admin)", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao limpar sessões desconectadas.",
      });
    } finally {
      setIsDeletingDisconnected(false);
    }
  };

  return (
    <section className={adminStyles.adminUserManager}>
      <Card className={adminStyles.adminSystemInstanceCard}>
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-start gap-3">
            <div className="d-flex gap-3 align-items-start">
              <span className={adminStyles.adminRecordAvatar}>
                <IconShield size={22} />
              </span>
              <div>
                <Card.Title className="mb-1">Instância operacional do admin</Card.Title>
                <Card.Subtitle className="text-secondary small">
                  Número usado para verificações, avatares e avisos internos do BotAdmin.
                </Card.Subtitle>
              </div>
            </div>
            <div className="d-flex flex-wrap gap-2 justify-content-lg-end">
              <Button
                variant="outline-secondary"
                onClick={() => void loadAdminSystemInstance()}
                disabled={systemLoading || systemSaving}
              >
                {systemLoading ? <Spinner animation="border" size="sm" /> : null}
                {systemLoading ? " Atualizando..." : "Atualizar"}
              </Button>
              <Button
                variant={systemInstance ? "outline-primary" : "primary"}
                onClick={openSystemModal}
                disabled={systemLoading || systemSaving || systemServerOptions.length === 0}
              >
                {systemInstance ? "Editar dados" : "Configurar instância"}
              </Button>
              {systemInstance ? (
                systemInstance.sessionStatus === "conectado" ? (
                  <Button
                    variant="warning"
                    onClick={openSystemModal}
                    disabled={systemLoading || systemSaving || pendingInstanceId === systemInstance.id}
                  >
                    Trocar número e parear
                  </Button>
                ) : (
                  <Button
                    variant="success"
                    onClick={() => void requestSystemPairing(false)}
                    disabled={systemLoading || systemSaving || pendingInstanceId === systemInstance.id}
                  >
                    {pendingInstanceId === systemInstance.id ? <Spinner animation="border" size="sm" /> : null}
                    {pendingInstanceId === systemInstance.id ? " Gerando..." : "Gerar pareamento"}
                  </Button>
                )
              ) : null}
            </div>
          </div>

          {systemInstance ? (
            <div className={adminStyles.adminRecordTags}>
              <span className={adminStyles.adminRecordTag}>{systemInstance.name}</span>
              <span className={adminStyles.adminRecordTag}>{systemInstance.phone || "sem número"}</span>
              <span
                className={`${adminStyles.adminRecordTag} ${
                  statusBadge(systemInstance.sessionStatus).variant === "success"
                    ? adminStyles.adminRecordTagSuccess
                    : statusBadge(systemInstance.sessionStatus).variant === "warning"
                      ? adminStyles.adminRecordTagWarning
                      : adminStyles.adminRecordTagMuted
                }`}
              >
                {statusBadge(systemInstance.sessionStatus).label}
              </span>
              <span className={adminStyles.adminRecordTag}>
                Sync {formatDateTime(systemInstance.lastStatusSync)}
              </span>
            </div>
          ) : (
            <p className="text-secondary small mb-0">
              Nenhuma instância operacional configurada. Cadastre um número central para o painel admin.
            </p>
          )}
        </Card.Body>
      </Card>

      <div className={adminStyles.adminUserToolbar}>
        <div className={adminStyles.adminUserToolbarHead}>
          <div>
            <h2>Instâncias</h2>
            <p>Sessões WhatsApp ativas no servidor. Limpe instâncias desconectadas sem apagar os perfis dos usuários.</p>
          </div>
          <span className={adminStyles.adminUserMeta}>{instances.length} instância(s)</span>
        </div>
        <div className={adminStyles.adminInstanceToolbar}>
          <Button variant="outline-primary" onClick={() => setShowCreateModal(true)}>
            Nova instância
          </Button>
          <Button
            variant="outline-info"
            onClick={handleSyncAllWebhooks}
            disabled={isSyncingAll || instances.length === 0}
          >
            {isSyncingAll ? <Spinner animation="border" size="sm" /> : null}
            {isSyncingAll ? " Sincronizando..." : "Sincronizar webhooks"}
          </Button>
          <Button
            variant="outline-secondary"
            onClick={handleRefreshAll}
            disabled={isRefreshingAll || instances.length === 0}
          >
            {isRefreshingAll ? <Spinner animation="border" size="sm" /> : null}
            {isRefreshingAll ? " Atualizando..." : "Atualizar status"}
          </Button>
          <Button
            variant="outline-danger"
            onClick={handlePurgeDisconnectedSessions}
            disabled={isDeletingDisconnected || disconnectedSessionInstances.length === 0}
          >
            {isDeletingDisconnected ? <Spinner animation="border" size="sm" /> : null}
            {isDeletingDisconnected
              ? " Limpando..."
              : `Remover instâncias desconectadas (${disconnectedSessionInstances.length})`}
          </Button>
        </div>
        <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />
      </div>

      <div className={adminStyles.adminUserTableWrap}>
        <div className={adminStyles.adminRecordList}>
          {instances.length === 0 ? (
            <div className={adminStyles.adminListEmpty}>Nenhuma instância cadastrada.</div>
          ) : (
            instances.map((instance) => {
              const status = statusBadge(instance.sessionStatus);
              const isPending = pendingInstanceId === instance.id;
              return (
                <article key={instance.id} className={adminStyles.adminRecordCard}>
                  <div className={adminStyles.adminRecordMain} style={{ cursor: "default" }}>
                    <span className={adminStyles.adminRecordAvatar}>
                      <IconPhone size={20} />
                    </span>
                    <span className={adminStyles.adminRecordText}>
                      <strong>{instance.name}</strong>
                      <span>{instance.phone}</span>
                      <small>
                        {instance.userName} · {instance.userEmail ?? "sem e-mail"} · {instance.serverName}
                      </small>
                      <span className={adminStyles.adminRecordTags}>
                        <span
                          className={`${adminStyles.adminRecordTag} ${
                            status.variant === "success"
                              ? adminStyles.adminRecordTagSuccess
                              : status.variant === "warning"
                                ? adminStyles.adminRecordTagWarning
                                : adminStyles.adminRecordTagMuted
                          }`}
                        >
                          {status.label}
                        </span>
                        <span className={adminStyles.adminRecordTag}>
                          Renovação pelo grupo: {instance.licenseSalesEnabled ? "Ativa" : "Inativa"}
                        </span>
                        <span className={adminStyles.adminRecordTag}>
                          Sync {formatDateTime(instance.lastStatusSync)}
                        </span>
                      </span>
                    </span>
                  </div>
                  <div className="d-flex flex-column align-items-end gap-2">
                    <Form.Check
                      type="switch"
                      id={`license-sales-${instance.id}`}
                      label={instance.licenseSalesEnabled ? "Renovação ativa" : "Renovação inativa"}
                      checked={instance.licenseSalesEnabled}
                      disabled={isPending}
                      onChange={(event) =>
                        handleLicenseSalesToggle(instance, event.currentTarget.checked)
                      }
                    />
                    <Dropdown align="end" className={adminStyles.adminActionMenu}>
                      <Dropdown.Toggle variant="light" aria-label={`Ações da instância ${instance.name}`}>
                        <IconDotsVertical size={18} />
                      </Dropdown.Toggle>
                      <Dropdown.Menu>
                        <Dropdown.Item onClick={() => handleRefreshStatus(instance)} disabled={isPending}>
                          Atualizar status
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleSyncWebhook(instance)} disabled={isPending}>
                          Sincronizar webhook
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handlePairing(instance)} disabled={isPending}>
                          Parear número
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleAction(instance, "connect")} disabled={isPending}>
                          Conectar
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleAction(instance, "restart")} disabled={isPending}>
                          Reiniciar
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleAction(instance, "logout")} disabled={isPending}>
                          Desconectar
                        </Dropdown.Item>
                        <Dropdown.Divider />
                        <Dropdown.Item onClick={() => handleRename(instance)} disabled={isPending}>
                          Renomear perfil
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleTransfer(instance)} disabled={isPending}>
                          Transferir servidor
                        </Dropdown.Item>
                        <Dropdown.Item
                          onClick={() => handlePurgeSession(instance)}
                          disabled={isPending}
                        >
                          Remover instância (preserva perfil)
                        </Dropdown.Item>
                        <Dropdown.Item
                          className="text-danger"
                          onClick={() => handleDelete(instance)}
                          disabled={isPending}
                        >
                          Excluir perfil permanentemente
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
      <Card>
        <Card.Body className="d-flex flex-column gap-2">
          <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
            <div>
              <Card.Title className="mb-1">Botões nativos (global)</Card.Title>
              <Card.Subtitle className="text-secondary small">
                Liga ou desliga o envio de botões nativos para todas as instâncias ao mesmo tempo.
                Ideal para alternar rapidamente entre comandos tradicionais e botões interativos.
              </Card.Subtitle>
            </div>
            <Form.Check
              type="switch"
              id="admin-native-buttons-toggle"
              label={
                nativeButtonsSummary && nativeButtonsSummary.totalInstances > 0
                  ? nativeButtonsSummary.enabledInstances === nativeButtonsSummary.totalInstances
                    ? "Ativado"
                    : "Desativado"
                  : "Sem instâncias"
              }
              checked={
                Boolean(nativeButtonsSummary) &&
                nativeButtonsSummary.totalInstances > 0 &&
                nativeButtonsSummary.enabledInstances === nativeButtonsSummary.totalInstances
              }
              disabled={
                nativeButtonsLoading ||
                nativeButtonsUpdating ||
                !nativeButtonsSummary ||
                nativeButtonsSummary.totalInstances === 0
              }
              onChange={handleToggleNativeButtons}
            />
          </div>
          <small className="text-secondary">
            {nativeButtonsSummary ? (
              nativeButtonsSummary.totalInstances === 0 ? (
                "Cadastre uma instância para utilizar esta configuração."
              ) : (
                `Ativo em ${nativeButtonsSummary.enabledInstances} de ${nativeButtonsSummary.totalInstances} instância(s).`
              )
            ) : nativeButtonsLoading ? (
              "Carregando status global..."
            ) : (
              "Status indisponível."
            )}
          </small>
          <small className="text-secondary">
            Ao alterar este controle, cada instância terá seu comportamento atualizado automaticamente.
          </small>
        </Card.Body>
      </Card>

      <Modal show={showCreateModal} onHide={handleCloseModal} centered>
        <Form onSubmit={handleCreateInstance}>
          <Modal.Header closeButton>
            <Modal.Title>Nova instância</Modal.Title>
          </Modal.Header>
          <Modal.Body className="d-flex flex-column gap-3">
            <Form.Group controlId="adminNewInstanceUser">
              <Form.Label>Usuário</Form.Label>
              <Form.Control
                type="search"
                placeholder="Busque pelo e-mail ou nome"
                value={userSearchTerm}
                onChange={(event) => {
                  const value = event.target.value;
                  setUserSearchTerm(value);
                  setSelectedUser(null);
                  setCreateForm((prev) => ({ ...prev, userId: "" }));
                  setUserFetchError(null);
                }}
                autoComplete="off"
                disabled={isSaving}
              />
              <div className="mt-2 border rounded" style={{ maxHeight: 220, overflowY: "auto" }}>
                <ListGroup variant="flush">
                  {isLoadingUsers ? (
                    <ListGroup.Item className="d-flex align-items-center gap-2 text-secondary">
                      <Spinner animation="border" size="sm" role="status" />
                      <span>Carregando usuários...</span>
                    </ListGroup.Item>
                  ) : userOptions.length === 0 ? (
                    <ListGroup.Item className="text-secondary">
                      Nenhum usuário encontrado.
                    </ListGroup.Item>
                  ) : (
                    userOptions.map((option) => (
                      <ListGroup.Item
                        key={option.id}
                        action={!isSaving}
                        active={selectedUser?.id === option.id}
                        onClick={() => !isSaving && handleSelectUser(option)}
                      >
                        <div className="fw-semibold">{option.email ?? "Sem e-mail"}</div>
                        {option.name ? (
                          <div className="small text-secondary">{option.name}</div>
                        ) : null}
                      </ListGroup.Item>
                    ))
                  )}
                </ListGroup>
              </div>
              {userFetchError ? (
                <Form.Text className="text-danger d-block mt-2">{userFetchError}</Form.Text>
              ) : null}
              {userListHasMore ? (
                <Form.Text className="text-secondary d-block mt-1">
                  Exibindo os primeiros resultados. Refine a busca para encontrar outros usuários.
                </Form.Text>
              ) : null}
              {selectedUser ? (
                <Form.Text className="text-success d-block mt-1">
                  Usuário selecionado: {selectedUser.email ?? selectedUser.name}
                </Form.Text>
              ) : (
                <Form.Text className="text-secondary d-block mt-1">
                  Escolha um usuário para vincular à instância.
                </Form.Text>
              )}
            </Form.Group>

            <Form.Group controlId="adminNewInstanceServer">
              <Form.Label>Servidor</Form.Label>
              <Form.Select
                value={createForm.serverId}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, serverId: event.target.value }))
                }
                disabled={serverOptions.length === 0}
                required
              >
                {serverOptions.length === 0 ? (
                  <option value="">Nenhum servidor disponível</option>
                ) : (
                  serverOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </Form.Select>
            </Form.Group>

            <Form.Group controlId="adminNewInstanceCountry">
              <Form.Label>DDI</Form.Label>
              <Form.Select
                value={createForm.phoneCountryIso}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, phoneCountryIso: event.target.value }))
                }
                disabled={isSaving}
                required
              >
                {PHONE_COUNTRIES.map((country) => (
                  <option key={country.iso2} value={country.iso2}>
                    {formatPhoneCountryLabel(country)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group controlId="adminNewInstancePhone">
              <Form.Label>Número (DDD + WhatsApp)</Form.Label>
              <Form.Control
                type="text"
                placeholder="DDD + número (apenas dígitos)"
                value={createForm.phoneLocal}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, phoneLocal: event.target.value }))
                }
                required
              />
              <Form.Text className="text-secondary">
                Informe apenas números, sem o código do país.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="adminNewInstanceName">
              <Form.Label>Nome da instância</Form.Label>
              <Form.Control
                type="text"
                placeholder="Opcional"
                value={createForm.name}
                maxLength={120}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={handleCloseModal} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving || serverOptions.length === 0}>
              {isSaving ? "Criando..." : "Criar instância"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={showSystemModal}
        onHide={() => {
          if (!systemSaving) setShowSystemModal(false);
        }}
        centered
      >
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            void saveSystemInstance(false);
          }}
        >
          <Modal.Header closeButton>
            <Modal.Title>
              {systemInstance ? "Editar instância do admin" : "Configurar instância do admin"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="d-flex flex-column gap-3">
            {!systemInstance ? (
              <Form.Group controlId="adminSystemInstanceServer">
                <Form.Label>Servidor</Form.Label>
                <Form.Select
                  value={systemForm.serverId}
                  onChange={(event) =>
                    setSystemForm((prev) => ({ ...prev, serverId: event.target.value }))
                  }
                  disabled={systemSaving || systemServerOptions.length === 0}
                  required
                >
                  {systemServerOptions.length === 0 ? (
                    <option value="">Nenhum servidor disponível</option>
                  ) : (
                    systemServerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))
                  )}
                </Form.Select>
              </Form.Group>
            ) : null}
            <Form.Group controlId="adminSystemInstanceName">
              <Form.Label>Nome da instância</Form.Label>
              <Form.Control
                type="text"
                value={systemForm.name}
                maxLength={120}
                onChange={(event) =>
                  setSystemForm((prev) => ({ ...prev, name: event.target.value }))
                }
                disabled={systemSaving}
              />
            </Form.Group>
            <Form.Group controlId="adminSystemInstancePhone">
              <Form.Label>Número do WhatsApp</Form.Label>
              <Form.Control
                type="text"
                placeholder="Ex.: 5592999999999"
                value={systemForm.phone}
                onChange={(event) =>
                  setSystemForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                disabled={systemSaving}
                required
              />
              <Form.Text className="text-secondary">
                Informe o número completo com DDI e DDD. Para trocar o número conectado, use “Salvar e parear outro número”.
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-center">
            <Button
              variant="outline-secondary"
              onClick={() => setShowSystemModal(false)}
              disabled={systemSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="outline-primary" disabled={systemSaving}>
              {systemSaving ? "Salvando..." : "Salvar"}
            </Button>
            <Button
              type="button"
              variant="success"
              disabled={systemSaving}
              onClick={() => void saveSystemInstance(true)}
            >
              {systemSaving
                ? "Preparando..."
                : systemInstance
                  ? "Salvar e parear outro número"
                  : "Salvar e gerar pareamento"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={pairingState !== null}
        onHide={() => setPairingState(null)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Pareamento - {pairingState?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {pairingState?.linkingCode && (
            <div className="mb-3 text-center">
              <p className="text-secondary">Código de pareamento</p>
              <span className="fs-3 fw-semibold letter-spacing-1">
                {pairingState.linkingCode}
              </span>
            </div>
          )}
          {pairingState?.qrCode && (
            <div className="d-flex flex-column align-items-center gap-3">
              <p className="text-secondary mb-0">
                Escaneie o QR Code abaixo no WhatsApp do número selecionado.
              </p>
              <img
                src={pairingState.qrCode.startsWith("data:")
                  ? pairingState.qrCode
                  : `data:image/png;base64,${pairingState.qrCode}`}
                alt="QR Code para pareamento"
                className="img-fluid"
                style={{ maxWidth: 260 }}
              />
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setPairingState(null)}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>
    </section>
  );
};

export default AdminInstanceManager;
