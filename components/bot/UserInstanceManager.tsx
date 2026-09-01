"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import { useRouter } from "next/navigation";
import { InfoCircleFill } from "react-bootstrap-icons";

import InstanceAutoResponsePanel from "components/bot/InstanceAutoResponsePanel";
import {
  DEFAULT_STICKER_PACK_AUTHOR,
  DEFAULT_STICKER_PACK_NAME,
} from "lib/sticker";
import type { BotInstance, BotServer } from "types/bot-instances";
import type { PlanCheckoutResponse, UserPlanLimits, UserPlanStatus } from "types/plans";
import type { FieldTutorialMap } from "types/tutorials";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  formatPhoneCountryLabel,
  findPhoneCountryByIso,
} from "lib/phone-countries";
import FloatingAlert from "components/common/FloatingAlert";
import TutorialTrigger from "components/tutorial/TutorialTrigger";

type Feedback = { type: "success" | "danger" | "warning"; message: string } | null;
type PairingMode = "auto" | "code" | "qr";

type InstanceFeatureSettings = {
  recoverDeletedMessages: boolean;
  keepDeletedChatsInHistory: boolean;
  persistentMediaStorage: boolean;
  stickerPack: string;
  stickerAuthor: string;
  storage?: {
    quotaBytes: number;
    usedBytes: number;
    remainingBytes: number;
    objectCount: number;
    hasActivePlan?: boolean;
    expiresAt?: string | null;
  } | null;
};
type InstanceFeatureToggleKey = Exclude<keyof InstanceFeatureSettings, "storage">;

type UserMediaStoragePlan = {
  id: number;
  name: string;
  description: string | null;
  quotaGb: number;
  quotaBytes: number;
  price: number;
  durationDays: number;
  isActive: boolean;
};

type PaymentProvider = PlanCheckoutResponse["provider"];

const DEFAULT_FEATURE_SETTINGS: InstanceFeatureSettings = {
  recoverDeletedMessages: true,
  keepDeletedChatsInHistory: true,
  persistentMediaStorage: false,
  stickerPack: DEFAULT_STICKER_PACK_NAME,
  stickerAuthor: DEFAULT_STICKER_PACK_AUTHOR,
  storage: null,
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 GB";
  const gb = value / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`;
  const mb = value / 1024 / 1024;
  return `${mb.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

type PairingState =
  | null
  | {
      instanceId: number;
      name: string;
      linkingCode?: string;
      qrCode?: string;
    };

interface UserInstanceManagerProps {
  instances: BotInstance[];
  servers: Array<Omit<BotServer, "globalApiKey">>;
  planStatus: UserPlanStatus;
  planLimits: UserPlanLimits;
  tutorial?: FieldTutorialMap[string];
}

const formatDate = (value: string | null) => {
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
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const formatStatus = (status: string) => {
  switch (status) {
    case "conectado":
      return { label: "Conectado", variant: "success" as const };
    case "aguardando_qr":
      return { label: "Aguardando QR Code", variant: "warning" as const };
    case "aguardando_pareamento":
      return { label: "Aguardando pareamento", variant: "warning" as const };
    case "inicializando":
      return { label: "Inicializando", variant: "info" as const };
    default:
      return { label: "Desconectado", variant: "secondary" as const };
  }
};

const UserInstanceManager = ({
  instances,
  servers,
  planStatus,
  planLimits,
  tutorial,
}: UserInstanceManagerProps) => {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingInstanceId, setPendingInstanceId] = useState<number | null>(null);
  const [pairingMethodInstance, setPairingMethodInstance] = useState<BotInstance | null>(null);
  const [pairingState, setPairingState] = useState<PairingState>(null);
  const [pairingChecking, setPairingChecking] = useState(false);
  const [pairingConnected, setPairingConnected] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [autoResponseInstance, setAutoResponseInstance] = useState<BotInstance | null>(null);
  const [instanceFeatureSettings, setInstanceFeatureSettings] = useState<Record<number, InstanceFeatureSettings>>({});
  const [storagePurchaseInstance, setStoragePurchaseInstance] = useState<BotInstance | null>(null);
  const [storagePlans, setStoragePlans] = useState<UserMediaStoragePlan[]>([]);
  const [storagePlansLoading, setStoragePlansLoading] = useState(false);
  const [storagePurchaseFeedback, setStoragePurchaseFeedback] = useState<Feedback>(null);
  const [storageProvider, setStorageProvider] = useState<PaymentProvider>("mercadopago_pix");
  const [storageCheckout, setStorageCheckout] = useState<PlanCheckoutResponse | null>(null);
  const [storageCheckoutLoadingId, setStorageCheckoutLoadingId] = useState<number | null>(null);
  const [savingStickerSettingsId, setSavingStickerSettingsId] = useState<number | null>(null);
  const planActive = planStatus.status === "active";
  const [showPlanRequiredModal, setShowPlanRequiredModal] = useState(!planActive);
  const [formState, setFormState] = useState({
    serverId: servers.length > 0 ? servers[0].id.toString() : "",
    phoneCountryIso: DEFAULT_PHONE_COUNTRY.iso2,
    phoneLocal: "",
    name: "",
  });

  const instanceAllowance = planLimits.instanceLimit;

  const canCreateMore =
    planActive && (instanceAllowance === 0 || instances.length < instanceAllowance);
  const isCreateDisabled = planActive ? !canCreateMore || servers.length === 0 : false;

  const loadInstanceSettings = useCallback(async (instanceId: number) => {
    const response = await fetch(`/api/bot-instances/${instanceId}/settings`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message ?? "Não foi possível carregar as configurações do perfil.");
    }
    const toggles = data.settings?.commandToggles ?? {};
    setInstanceFeatureSettings((prev) => ({
      ...prev,
      [instanceId]: {
        recoverDeletedMessages: toggles.recoverDeletedMessages === true,
        keepDeletedChatsInHistory: toggles.keepDeletedChatsInHistory === true,
        persistentMediaStorage: toggles.persistentMediaStorage === true,
        stickerPack:
          typeof toggles.stickerPack === "string" && toggles.stickerPack.trim()
            ? toggles.stickerPack.trim()
            : DEFAULT_STICKER_PACK_NAME,
        stickerAuthor:
          typeof toggles.stickerAuthor === "string" && toggles.stickerAuthor.trim()
            ? toggles.stickerAuthor.trim()
            : DEFAULT_STICKER_PACK_AUTHOR,
        storage: data.storage ?? null,
      },
    }));
  }, []);

  useEffect(() => {
    if (instances.length === 0) {
      setInstanceFeatureSettings({});
      return;
    }
    let cancelled = false;
    Promise.all(
      instances.map(async (instance) => {
        const response = await fetch(`/api/bot-instances/${instance.id}/settings`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return null;
        const toggles = data.settings?.commandToggles ?? {};
        return {
          instanceId: instance.id,
          settings: {
            recoverDeletedMessages: toggles.recoverDeletedMessages === true,
            keepDeletedChatsInHistory: toggles.keepDeletedChatsInHistory === true,
            persistentMediaStorage: toggles.persistentMediaStorage === true,
            stickerPack:
              typeof toggles.stickerPack === "string" && toggles.stickerPack.trim()
                ? toggles.stickerPack.trim()
                : DEFAULT_STICKER_PACK_NAME,
            stickerAuthor:
              typeof toggles.stickerAuthor === "string" && toggles.stickerAuthor.trim()
                ? toggles.stickerAuthor.trim()
                : DEFAULT_STICKER_PACK_AUTHOR,
            storage: data.storage ?? null,
          } satisfies InstanceFeatureSettings,
        };
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        const next: Record<number, InstanceFeatureSettings> = {};
        for (const entry of entries) {
          if (entry) next[entry.instanceId] = entry.settings;
        }
        setInstanceFeatureSettings(next);
      })
      .catch((error) => {
        console.warn("Failed to load instance feature settings", error);
      });
    return () => {
      cancelled = true;
    };
  }, [instances, loadInstanceSettings]);

  const loadStoragePlans = useCallback(async () => {
    setStoragePlansLoading(true);
    setStoragePurchaseFeedback(null);
    try {
      const response = await fetch("/api/user/media-storage/plans", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStoragePurchaseFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível carregar os pacotes de armazenamento.",
        });
        return;
      }
      setStoragePlans(Array.isArray(data.plans) ? data.plans : []);
    } catch (error) {
      console.error("Failed to load media storage plans", error);
      setStoragePurchaseFeedback({
        type: "danger",
        message: "Erro inesperado ao carregar os pacotes de armazenamento.",
      });
    } finally {
      setStoragePlansLoading(false);
    }
  }, []);

  const openStoragePurchaseModal = useCallback(
    async (instance: BotInstance) => {
      setStoragePurchaseInstance(instance);
      setStorageCheckout(null);
      setStoragePurchaseFeedback(null);
      if (storagePlans.length === 0) {
        await loadStoragePlans();
      }
    },
    [loadStoragePlans, storagePlans.length],
  );

  const handleStorageCheckout = async (plan: UserMediaStoragePlan) => {
    setStorageCheckoutLoadingId(plan.id);
    setStorageCheckout(null);
    setStoragePurchaseFeedback(null);
    try {
      const response = await fetch("/api/user/media-storage/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, provider: storageProvider }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && (data.activated || data.adminExempt)) {
        if (storagePurchaseInstance) {
          await loadInstanceSettings(storagePurchaseInstance.id);
        }
        setStoragePurchaseFeedback({
          type: "success",
          message: data.message ?? "Armazenamento R2 liberado para administrador.",
        });
        return;
      }
      if (!response.ok || !data.checkout) {
        setStoragePurchaseFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível gerar o pagamento de armazenamento.",
        });
        return;
      }
      setStorageCheckout(data.checkout as PlanCheckoutResponse);
      setStoragePurchaseFeedback({
        type: "success",
        message: "Pagamento gerado. A ativação será automática após a confirmação.",
      });
    } catch (error) {
      console.error("Failed to create media storage checkout", error);
      setStoragePurchaseFeedback({
        type: "danger",
        message: "Erro inesperado ao gerar o pagamento de armazenamento.",
      });
    } finally {
      setStorageCheckoutLoadingId(null);
    }
  };

  const copyStoragePixCode = async () => {
    if (!storageCheckout?.qrCode) return;
    try {
      await navigator.clipboard.writeText(storageCheckout.qrCode);
      setStoragePurchaseFeedback({ type: "success", message: "Código Pix copiado." });
    } catch {
      setStoragePurchaseFeedback({ type: "warning", message: "Não foi possível copiar automaticamente." });
    }
  };

  const handleFeatureToggle = async (
    instance: BotInstance,
    key: InstanceFeatureToggleKey,
    enabled: boolean,
  ) => {
    const previous = instanceFeatureSettings[instance.id] ?? DEFAULT_FEATURE_SETTINGS;
    const next = { ...previous, [key]: enabled };
    setInstanceFeatureSettings((prev) => ({ ...prev, [instance.id]: next }));
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandToggles: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setInstanceFeatureSettings((prev) => ({ ...prev, [instance.id]: previous }));
        if (key === "persistentMediaStorage" && enabled && data.requiresStoragePurchase) {
          await openStoragePurchaseModal(instance);
          setFeedback({
            type: "warning",
            message: data.message ?? "Contrate um pacote mensal de armazenamento para ativar o R2.",
          });
          return;
        }
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível atualizar as configurações premium.",
        });
        return;
      }
      await loadInstanceSettings(instance.id);
      setFeedback({
        type: "success",
        message: "Configurações do perfil atualizadas.",
      });
    } catch (error) {
      console.error("Failed to update instance feature settings", error);
      setInstanceFeatureSettings((prev) => ({ ...prev, [instance.id]: previous }));
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao atualizar as configurações premium.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleStickerFieldChange = (
    instanceId: number,
    field: "stickerPack" | "stickerAuthor",
    value: string,
  ) => {
    setInstanceFeatureSettings((prev) => ({
      ...prev,
      [instanceId]: {
        ...(prev[instanceId] ?? DEFAULT_FEATURE_SETTINGS),
        [field]: value,
      },
    }));
  };

  const handleStickerSettingsSave = async (instance: BotInstance) => {
    const previous = instanceFeatureSettings[instance.id] ?? DEFAULT_FEATURE_SETTINGS;
    const stickerPack = previous.stickerPack.trim() || DEFAULT_STICKER_PACK_NAME;
    const stickerAuthor = previous.stickerAuthor.trim() || DEFAULT_STICKER_PACK_AUTHOR;
    setSavingStickerSettingsId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandToggles: {
            stickerPack,
            stickerAuthor,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível salvar as configurações de figurinhas.",
        });
        return;
      }
      await loadInstanceSettings(instance.id);
      setFeedback({
        type: "success",
        message: "Pacote de figurinhas atualizado.",
      });
    } catch (error) {
      console.error("Failed to update sticker settings", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao salvar as configurações de figurinhas.",
      });
    } finally {
      setSavingStickerSettingsId(null);
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (!canCreateMore) {
      setFeedback({
        type: "warning",
        message: "Você já atingiu o limite de perfis do seu plano.",
      });
      return;
    }

    const selectedCountry =
      findPhoneCountryByIso(formState.phoneCountryIso) ?? DEFAULT_PHONE_COUNTRY;
    const localDigits = formState.phoneLocal.replace(/\D+/g, "");
    const trimmedLocal = localDigits.replace(/^0+/, "");
    if (!trimmedLocal) {
      setFeedback({
        type: "warning",
        message: "Informe o número com DDD (somente dígitos).",
      });
      return;
    }
    const combinedPhone = `${selectedCountry.dialCode}${trimmedLocal}`;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/bot-instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: Number.parseInt(formState.serverId, 10),
          phone: combinedPhone,
          name: formState.name || null,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível criar o perfil.",
        });
        setIsSubmitting(false);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Perfil criado com sucesso.",
      });
      setFormState((prev) => ({ ...prev, phoneLocal: "", name: "" }));
      setIsCreateOpen(false);
      router.refresh();
    } catch (error) {
      console.error("Failed to create bot instance", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao criar o perfil.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAction = async (instance: BotInstance, action: "connect" | "logout" | "restart") => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}/actions`, {
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
        message: data.message ?? "Ação enviada com sucesso.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to execute instance action", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao executar a ação.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleRefreshStatus = async (instance: BotInstance) => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}/status`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível obter o status.",
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
      console.error("Failed to refresh instance status", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao atualizar o status.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleHistoryResync = async (instance: BotInstance) => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const startResponse = await fetch(
        `/api/bot-instances/${instance.id}/whatsapp-conversations/history-resync`,
        { method: "POST" },
      );
      const startData = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok && startResponse.status !== 409) {
        setFeedback({
          type: "danger",
          message: startData.message ?? "Não foi possível iniciar a resincronização.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          startData.message ??
          "Resincronização iniciada. Mantenha o WhatsApp principal conectado à internet.",
      });

      for (let attempt = 0; attempt < 180; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000));
        const statusResponse = await fetch(
          `/api/bot-instances/${instance.id}/whatsapp-conversations/history-resync`,
          { cache: "no-store" },
        );
        const statusData = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) continue;
        const resync = statusData.resync ?? statusData;
        if (resync.status === "completed") {
          const recovered = Number(resync.messages ?? resync.forwarded ?? 0);
          setFeedback({
            type: "success",
            message: `Histórico resincronizado: ${recovered.toLocaleString("pt-BR")} mensagem(ns) recuperada(s), sem desconectar o perfil.`,
          });
          router.refresh();
          return;
        }
        if (resync.status === "failed") {
          setFeedback({
            type: "danger",
            message:
              resync.error ??
              "O telefone não reemitiu o histórico. Abra o WhatsApp principal e tente novamente.",
          });
          return;
        }
      }

      setFeedback({
        type: "warning",
        message: "A resincronização continua em segundo plano. Você pode acompanhar tentando novamente mais tarde.",
      });
    } catch (error) {
      console.error("Failed to resync WhatsApp history", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao resincronizar o histórico.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handlePairing = async (instance: BotInstance, mode: PairingMode = "auto") => {
    setPairingMethodInstance(null);
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
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

      const payload = data.data ?? {};
      setPairingState({
        instanceId: instance.id,
        name: instance.name,
        linkingCode: payload.linkingCode,
        qrCode: payload.qrCode,
      });
      setPairingConnected(false);
      setPairingChecking(true);
    } catch (error) {
      console.error("Failed to request pairing code", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao gerar o pareamento.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  // Polling em tempo real durante o pareamento para confirmar conexão
  useEffect(() => {
    if (!pairingState) {
      setPairingChecking(false);
      setPairingConnected(false);
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const resp = await fetch(`/api/bot-instances/${pairingState.instanceId}/status`).catch(() => null);
        const payload = await resp?.json().catch(() => ({} as any));
        const status = payload?.status as string | undefined;
        if (status === "conectado") {
          setPairingConnected(true);
          setPairingChecking(false);
          if (!cancelled) router.refresh();
          if (interval) clearInterval(interval);
          if (timeout) clearTimeout(timeout);
          if (!cancelled) setPairingState(null); // fecha imediatamente
        }
      } catch {
        /* ignore */
      }
    };

    // primeira checagem rápida e depois em intervalo curto para fechar o modal logo após o pareamento
    check();
    interval = setInterval(check, 1000);
    timeout = setTimeout(() => {
      if (interval) clearInterval(interval);
      setPairingChecking(false);
    }, 120000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, [pairingState, router]);

  const handleRename = async (instance: BotInstance) => {
    const newName = window.prompt("Informe o novo nome do perfil:", instance.name);
    if (!newName || newName.trim() === instance.name) {
      return;
    }

    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível renomear o perfil.",
        });
        setPendingInstanceId(null);
        return;
      }
      setFeedback({ type: "success", message: "Perfil renomeado com sucesso." });
      router.refresh();
    } catch (error) {
      console.error("Failed to rename bot instance", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao renomear o perfil.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleLicenseSalesToggle = async (instance: BotInstance, enabled: boolean) => {
    setPendingInstanceId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}`, {
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
          ? "Renovação pelo grupo ativada para este perfil."
          : "Renovação pelo grupo desativada para este perfil.",
      });
      router.refresh();
    } catch (error) {
      console.error("Failed to update bot instance license sales", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao atualizar a renovação pelo grupo.",
      });
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleRefreshAll = async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true);
      setFeedback(null);
    }
    try {
      await Promise.all(
        instances.map((instance) =>
          fetch(`/api/bot-instances/${instance.id}/status`).catch(() => null),
        ),
      );
      if (!silent) {
        setFeedback({ type: "success", message: "Status dos perfis atualizado." });
      }
    } finally {
      if (!silent) {
        setIsRefreshing(false);
      }
      router.refresh();
    }
  };

  // Atualiza automaticamente o status ao abrir a página e mantém o badge próximo do estado real.
  useEffect(() => {
    if (instances.length > 0) {
      void handleRefreshAll(true);
    }
    const interval = setInterval(() => {
      if (instances.length > 0) {
        void handleRefreshAll(true);
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances.length]);

  useEffect(() => {
    if (!planActive) {
      setShowPlanRequiredModal(true);
    } else {
      setShowPlanRequiredModal(false);
    }
  }, [planActive]);

  const handleCreateClick = () => {
    if (!planActive) {
      setShowPlanRequiredModal(true);
      return;
    }

    setIsCreateOpen(true);
  };

  const handleViewPlans = () => {
    setShowPlanRequiredModal(false);
    router.push("/dashboard/user?section=conversations");
  };

  return (
    <section className="d-flex flex-column gap-4">
      <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div className="d-flex align-items-center gap-2">
          {tutorial ? (
            <TutorialTrigger
              label="Como conectar o robô"
              tutorial={tutorial}
              buttonVariant="outline-secondary"
              buttonSize="sm"
            />
          ) : null}
        </div>
        <Button onClick={handleCreateClick} disabled={isCreateDisabled}>
          Novo perfil
        </Button>
      </div>

      <Card>
        <Card.Body>
          <Card.Title className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span>Perfis vinculados</span>
            <Button
              variant="outline-primary"
              onClick={handleRefreshAll}
              disabled={isRefreshing || instances.length === 0}
            >
              {isRefreshing ? (
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" />
              ) : null}
              {isRefreshing ? " Atualizando..." : "Atualizar status"}
            </Button>
          </Card.Title>

          {instances.length === 0 ? (
            <p className="text-secondary mb-0">
              Nenhum perfil configurado ainda. Clique em &quot;Novo perfil&quot; para criar o primeiro.
            </p>
          ) : (
            <Row className="g-3">
              {instances.map((instance) => {
                const statusInfo = formatStatus(instance.sessionStatus);
                const isPending = pendingInstanceId === instance.id;
                return (
                  <Col key={instance.id} xs={12} lg={6}>
                    <Card className="h-100">
                      <Card.Body className="d-flex flex-column gap-2">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <Card.Title className="mb-1">{instance.name}</Card.Title>
                            <Card.Subtitle className="text-secondary small">
                              {instance.phone} • {instance.serverName}
                            </Card.Subtitle>
                          </div>
                          <Badge bg={statusInfo.variant}>{statusInfo.label}</Badge>
                        </div>

                        <div className="text-secondary small">
                          <div><strong>Token:</strong> {instance.token}</div>
                          <div><strong>Vencimento:</strong> {formatDate(instance.expiresAt)}</div>
                        </div>

                        <div className="border rounded p-2 bg-light-subtle">
                          <Form.Check
                            type="switch"
                            id={`license-sales-${instance.id}`}
                            label="Renovação pelo grupo"
                            checked={instance.licenseSalesEnabled}
                            disabled={isPending}
                            onChange={(event) => handleLicenseSalesToggle(instance, event.currentTarget.checked)}
                          />
                          <div className="text-secondary small">
                            Mostra botões de renovação quando o grupo estiver vencido.
                          </div>
                        </div>

                        <div className="border rounded p-2 bg-white d-grid gap-2">
                          <div>
                            <strong className="small">Recuperação e armazenamento</strong>
                            <div className="text-secondary small">
                              Recursos premium do histórico deste perfil.
                            </div>
                          </div>
                          {(() => {
                            const featureSettings = instanceFeatureSettings[instance.id] ?? DEFAULT_FEATURE_SETTINGS;
                            return (
                              <>
                                <Form.Check
                                  type="switch"
                                  id={`recover-deleted-${instance.id}`}
                                  label="Recuperar mensagens apagadas"
                                  checked={featureSettings.recoverDeletedMessages}
                                  disabled={isPending}
                                  onChange={(event) =>
                                    handleFeatureToggle(instance, "recoverDeletedMessages", event.currentTarget.checked)
                                  }
                                />
                                <Form.Check
                                  type="switch"
                                  id={`keep-deleted-chat-${instance.id}`}
                                  label="Manter chat no histórico se apagar no celular"
                                  checked={featureSettings.keepDeletedChatsInHistory}
                                  disabled={isPending}
                                  onChange={(event) =>
                                    handleFeatureToggle(instance, "keepDeletedChatsInHistory", event.currentTarget.checked)
                                  }
                                />
                                <Form.Check
                                  type="switch"
                                  id={`persistent-media-${instance.id}`}
                                  label="Armazenamento persistente de mídias no R2"
                                  checked={featureSettings.persistentMediaStorage}
                                  disabled={isPending}
                                  onChange={(event) =>
                                    handleFeatureToggle(instance, "persistentMediaStorage", event.currentTarget.checked)
                                  }
                                />
                                {featureSettings.storage ? (
                                  <div className="text-secondary small d-grid gap-1">
                                    {featureSettings.storage.hasActivePlan ? (
                                      <span>
                                        Uso: {formatBytes(featureSettings.storage.usedBytes)} de{" "}
                                        {formatBytes(featureSettings.storage.quotaBytes)} ·{" "}
                                        {formatBytes(featureSettings.storage.remainingBytes)} livres
                                        {featureSettings.storage.expiresAt
                                          ? ` · ativo até ${formatDate(featureSettings.storage.expiresAt)}`
                                          : ""}
                                      </span>
                                    ) : (
                                      <span>
                                        Sem pacote R2 ativo · histórico gratuito por 24h.
                                      </span>
                                    )}
                                    {!featureSettings.storage.hasActivePlan ? (
                                      <Button
                                        type="button"
                                        variant="outline-success"
                                        size="sm"
                                        className="justify-self-start"
                                        onClick={() => void openStoragePurchaseModal(instance)}
                                      >
                                        Comprar armazenamento
                                      </Button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </>
                            );
                          })()}
                        </div>

                        <div className="border rounded p-2 bg-white d-grid gap-2">
                          <div>
                            <strong className="small">Pacote de figurinhas</strong>
                            <div className="text-secondary small">
                              Nome do pacote e autor exibidos ao salvar figurinhas no WhatsApp.
                            </div>
                          </div>
                          {(() => {
                            const featureSettings = instanceFeatureSettings[instance.id] ?? DEFAULT_FEATURE_SETTINGS;
                            const savingStickers = savingStickerSettingsId === instance.id;
                            return (
                              <>
                                <Form.Group className="mb-0">
                                  <Form.Label className="small mb-1">Nome do pacote</Form.Label>
                                  <Form.Control
                                    size="sm"
                                    value={featureSettings.stickerPack}
                                    placeholder={DEFAULT_STICKER_PACK_NAME}
                                    disabled={isPending || savingStickers}
                                    onChange={(event) =>
                                      handleStickerFieldChange(instance.id, "stickerPack", event.currentTarget.value)
                                    }
                                  />
                                </Form.Group>
                                <Form.Group className="mb-0">
                                  <Form.Label className="small mb-1">Autor</Form.Label>
                                  <Form.Control
                                    size="sm"
                                    value={featureSettings.stickerAuthor}
                                    placeholder={DEFAULT_STICKER_PACK_AUTHOR}
                                    disabled={isPending || savingStickers}
                                    onChange={(event) =>
                                      handleStickerFieldChange(instance.id, "stickerAuthor", event.currentTarget.value)
                                    }
                                  />
                                </Form.Group>
                                <Button
                                  type="button"
                                  variant="outline-primary"
                                  size="sm"
                                  className="justify-self-start"
                                  disabled={isPending || savingStickers}
                                  onClick={() => void handleStickerSettingsSave(instance)}
                                >
                                  {savingStickers ? "Salvando..." : "Salvar figurinhas"}
                                </Button>
                              </>
                            );
                          })()}
                        </div>

                        <div className="d-flex flex-wrap gap-2 mt-2">
                          <Button
                            variant="outline-secondary"
                            onClick={() => handleRefreshStatus(instance)}
                            disabled={isPending}
                          >
                            Atualizar status
                          </Button>
                          <Button
                            variant="primary"
                            onClick={() => setAutoResponseInstance(instance)}
                            disabled={isPending}
                          >
                            Autorespostas
                          </Button>
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => handleRename(instance)}
                            disabled={isPending}
                          >
                            Renomear
                          </Button>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => setPairingMethodInstance(instance)}
                            disabled={isPending}
                          >
                            Conectar e parear
                          </Button>
                          <Button
                            variant="outline-warning"
                            size="sm"
                            onClick={() => handleAction(instance, "restart")}
                            disabled={isPending}
                          >
                            Reiniciar
                          </Button>
                          <Button
                            variant="outline-info"
                            size="sm"
                            onClick={() => void handleHistoryResync(instance)}
                            disabled={isPending}
                          >
                            {isPending ? "Aguarde..." : "Resincronizar histórico"}
                          </Button>
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => handleAction(instance, "logout")}
                            disabled={isPending}
                          >
                            Desconectar
                          </Button>
                        </div>
                      </Card.Body>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          )}
        </Card.Body>
      </Card>

      {/* Modal de criação de perfil */}
      <Modal show={isCreateOpen} onHide={() => setIsCreateOpen(false)} centered>
        <Form onSubmit={handleCreate}>
          <Modal.Header closeButton>
            <Modal.Title>Novo perfil</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col xs={12} md={4}>
                <Form.Group controlId="instanceServer">
                  <Form.Label>Servidor</Form.Label>
                  <Form.Select
                    value={formState.serverId}
                    onChange={(event) => setFormState((prev) => ({ ...prev, serverId: event.target.value }))}
                    disabled={isSubmitting || servers.length === 0}
                    required
                  >
                    {servers.length === 0 ? (
                      <option value="">Nenhum servidor disponível</option>
                    ) : (
                      servers.map((server) => (
                        <option key={server.id} value={server.id}>
                          {server.name}
                        </option>
                      ))
                    )}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col xs={12} md={4}>
                <Form.Group controlId="instanceCountry">
                  <Form.Label>DDI</Form.Label>
                  <Form.Select
                    value={formState.phoneCountryIso}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, phoneCountryIso: event.target.value }))
                    }
                    disabled={isSubmitting}
                    required
                  >
                    {PHONE_COUNTRIES.map((country) => (
                      <option key={country.iso2} value={country.iso2}>
                        {formatPhoneCountryLabel(country)}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col xs={12} md={4}>
                <Form.Group controlId="instancePhone">
                  <Form.Label>Número (DDD + WhatsApp)</Form.Label>
                  <Form.Control
                    type="text"
                    value={formState.phoneLocal}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, phoneLocal: event.target.value }))
                    }
                    placeholder="DDD + número (apenas dígitos)"
                    disabled={isSubmitting}
                    required
                  />
                  <Form.Text className="text-secondary">
                    Informe apenas números, sem o código do país.
                  </Form.Text>
                </Form.Group>
              </Col>
              <Col xs={12} md={4}>
                <Form.Group controlId="instanceName">
                  <Form.Label>Nome do perfil</Form.Label>
                  <Form.Control
                    type="text"
                    value={formState.name}
                    onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Opcional"
                    maxLength={120}
                    disabled={isSubmitting}
                  />
                </Form.Group>
              </Col>
            </Row>
            {!canCreateMore && (
              <p className="text-warning small mt-3 mb-0">
                Você atingiu o limite de perfis do seu plano. Atualize sua assinatura para criar novos perfis.
              </p>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || !canCreateMore || servers.length === 0}>
              {isSubmitting ? "Criando..." : "Criar perfil"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={showPlanRequiredModal} onHide={() => setShowPlanRequiredModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Ative um plano para conectar</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex align-items-start gap-3">
            <div
              className="d-inline-flex align-items-center justify-content-center rounded-circle text-primary"
              style={{ width: 48, height: 48, backgroundColor: "rgba(13, 110, 253, 0.12)" }}
            >
              <InfoCircleFill size={24} />
            </div>
            <div className="d-flex flex-column gap-2">
              <p className="mb-0">
                Para conectar o WhatsApp do seu Bot, é necessário ter um plano ativo.
              </p>
              <p className="mb-0 text-secondary">
                Escolha a melhor opção na aba &quot;Meu plano&quot; e retorne aqui para concluir o pareamento.
              </p>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between">
          <Button variant="outline-secondary" onClick={() => setShowPlanRequiredModal(false)}>
            Depois
          </Button>
          <Button onClick={handleViewPlans}>Ver planos</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={pairingMethodInstance !== null} onHide={() => setPairingMethodInstance(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Escolha como conectar</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-grid gap-3">
          <p className="mb-0 text-secondary">
            Escolha a forma de pareamento para <strong>{pairingMethodInstance?.name ?? "este perfil"}</strong>.
          </p>
          <Button
            variant="outline-primary"
            onClick={() => pairingMethodInstance && void handlePairing(pairingMethodInstance, "qr")}
          >
            QR Code (recomendado)
          </Button>
          <Button
            variant="outline-secondary"
            onClick={() => pairingMethodInstance && void handlePairing(pairingMethodInstance, "code")}
          >
            Código de pareamento
          </Button>
        </Modal.Body>
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
          <div className="mb-3 text-center">
            {pairingConnected ? (
              <Badge bg="success">Conectado</Badge>
            ) : (
              <span className="text-secondary small d-inline-flex align-items-center gap-2">
                {pairingChecking ? <Spinner animation="border" size="sm" role="status" /> : null}
                {pairingChecking ? "Aguardando conexão..." : "Aguardando ação no WhatsApp"}
              </span>
            )}
          </div>
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
            {pairingConnected ? "Fechar" : "Fechar"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={storagePurchaseInstance !== null}
        onHide={() => {
          setStoragePurchaseInstance(null);
          setStorageCheckout(null);
          setStoragePurchaseFeedback(null);
        }}
        centered
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>Armazenamento persistente R2</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-grid gap-3">
          <div>
            <p className="mb-1">
              O histórico gratuito fica disponível por 24h. Para manter mídias e mensagens por mais tempo,
              contrate um pacote mensal de armazenamento.
            </p>
            <p className="mb-0 text-secondary small">
              Perfil: <strong>{storagePurchaseInstance?.name ?? "WhatsApp"}</strong>
            </p>
          </div>

          <Form.Group controlId="storageProvider">
            <Form.Label>Forma de pagamento</Form.Label>
            <Form.Select
              value={storageProvider}
              onChange={(event) => setStorageProvider(event.currentTarget.value as PaymentProvider)}
              disabled={storageCheckoutLoadingId !== null}
            >
              <option value="mercadopago_pix">Mercado Pago Pix</option>
              <option value="polopag_pix">PoloPag Pix</option>
              <option value="mercadopago_checkout">Mercado Pago Checkout</option>
            </Form.Select>
          </Form.Group>

          {storagePlansLoading ? (
            <div className="d-flex align-items-center gap-2 text-secondary">
              <Spinner animation="border" size="sm" /> Carregando pacotes...
            </div>
          ) : (
            <Row className="g-3">
              {storagePlans.map((plan) => (
                <Col xs={12} md={4} key={plan.id}>
                  <Card className="h-100 border-success-subtle">
                    <Card.Body className="d-flex flex-column gap-2">
                      <div>
                        <Card.Title className="mb-1">{plan.name}</Card.Title>
                        <div className="fs-5 fw-bold text-success">{formatCurrency(plan.price)}</div>
                        <div className="text-secondary small">
                          {plan.quotaGb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB por{" "}
                          {plan.durationDays} dias
                        </div>
                      </div>
                      {plan.description ? (
                        <p className="text-secondary small mb-0">{plan.description}</p>
                      ) : null}
                      <Button
                        type="button"
                        variant="success"
                        className="mt-auto"
                        disabled={storageCheckoutLoadingId !== null}
                        onClick={() => void handleStorageCheckout(plan)}
                      >
                        {storageCheckoutLoadingId === plan.id ? (
                          <>
                            <Spinner animation="border" size="sm" className="me-2" />
                            Gerando...
                          </>
                        ) : (
                          "Comprar"
                        )}
                      </Button>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
              {storagePlans.length === 0 ? (
                <Col xs={12}>
                  <p className="text-secondary mb-0">Nenhum pacote de armazenamento ativo no momento.</p>
                </Col>
              ) : null}
            </Row>
          )}

          {storagePurchaseFeedback ? (
            <FloatingAlert
              feedback={storagePurchaseFeedback}
              onClose={() => setStoragePurchaseFeedback(null)}
            />
          ) : null}

          {storageCheckout ? (
            <Card className="border-success-subtle">
              <Card.Body className="d-grid gap-3">
                <div className="d-flex justify-content-between align-items-center gap-3">
                  <div>
                    <strong>Pagamento gerado</strong>
                    <div className="text-secondary small">
                      {formatCurrency(storageCheckout.amount)} · confirmação automática
                    </div>
                  </div>
                  {storageCheckout.ticketUrl ? (
                    <Button
                      type="button"
                      variant="outline-success"
                      onClick={() => window.open(storageCheckout.ticketUrl ?? "", "_blank", "noopener,noreferrer")}
                    >
                      Abrir checkout
                    </Button>
                  ) : null}
                </div>
                {storageCheckout.qrCodeBase64 ? (
                  <div className="text-center">
                    <img
                      src={
                        storageCheckout.qrCodeBase64.startsWith("data:")
                          ? storageCheckout.qrCodeBase64
                          : `data:image/png;base64,${storageCheckout.qrCodeBase64}`
                      }
                      alt="QR Code Pix"
                      width={220}
                      height={220}
                    />
                  </div>
                ) : null}
                {storageCheckout.qrCode ? (
                  <Form.Group controlId="storagePixCode">
                    <Form.Label>Código Pix copia e cola</Form.Label>
                    <Form.Control as="textarea" rows={4} readOnly value={storageCheckout.qrCode} />
                    <Button
                      type="button"
                      variant="primary"
                      className="mt-2"
                      onClick={() => void copyStoragePixCode()}
                    >
                      Copiar código Pix
                    </Button>
                  </Form.Group>
                ) : null}
              </Card.Body>
            </Card>
          ) : null}
        </Modal.Body>
      </Modal>

      <InstanceAutoResponsePanel
        instance={autoResponseInstance}
        show={autoResponseInstance !== null}
        onClose={() => setAutoResponseInstance(null)}
      />
    </section>
  );
};

export default UserInstanceManager;
