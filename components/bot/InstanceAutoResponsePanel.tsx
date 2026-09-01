"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Form, Modal, Offcanvas, Spinner } from "react-bootstrap";

import type { BotInstance } from "types/bot-instances";
import type {
  BotAutoResponse,
  BotAutoResponseMedia,
  BotAutoResponseVcard,
} from "types/bot-auto-responses";
import { canonicalizeCommandText } from "lib/commands/text";
import { ALL_PV_COMMAND_KEYS, PV_COMMAND_CATEGORIES } from "resources/pv-command-catalog";

type Feedback = { type: "success" | "danger" | "warning"; message: string } | null;

type AutoResponseMediaMode = "none" | "url" | "upload";

type ReplyButtonDraft = {
  id: string;
  text: string;
};

type CtaButtonDraft = {
  id: string;
  text: string;
  type: "cta_url" | "cta_call" | "cta_copy";
  url: string;
  phoneNumber: string;
  copyCode: string;
};

type AutoResponseModalDraft = {
  id: string;
  triggers: string;
  responseText: string;
  matchMode: "contains" | "equals";
  matchAnyMessage: boolean;
  perContactLimit: string;
  includeMedia: boolean;
  mediaMode: AutoResponseMediaMode;
  mediaType: BotAutoResponseMedia["mediaType"];
  mediaUrl: string;
  mediaCaption: string;
  mediaPath: string;
  mediaFileName: string;
  mediaMimeType: string;
  includeVcard: boolean;
  vcardName: string;
  vcardPhone: string;
  vcardOrganization: string;
  vcardEmail: string;
  vcardCustom: string;
  includeButtons: boolean;
  buttonType: "button_reply" | "button_cta";
  buttonTitle: string;
  buttonBody: string;
  buttonFooter: string;
  replyButtons: ReplyButtonDraft[];
  ctaButtons: CtaButtonDraft[];
};

const createReplyButtonDraft = (): ReplyButtonDraft => ({
  id: "",
  text: "",
});

const createCtaButtonDraft = (): CtaButtonDraft => ({
  id: "",
  text: "",
  type: "cta_url",
  url: "",
  phoneNumber: "",
  copyCode: "",
});

const AUTO_RESPONSE_LIMIT = 50;

const DEFAULT_DRAFT: AutoResponseModalDraft = {
  id: "",
  triggers: "",
  responseText: "",
  matchMode: "equals",
  matchAnyMessage: false,
  perContactLimit: "",
  includeMedia: false,
  mediaMode: "none",
  mediaType: "image",
  mediaUrl: "",
  mediaCaption: "",
  mediaPath: "",
  mediaFileName: "",
  mediaMimeType: "",
  includeVcard: false,
  vcardName: "",
  vcardPhone: "",
  vcardOrganization: "",
  vcardEmail: "",
  vcardCustom: "",
  includeButtons: false,
  buttonType: "button_reply",
  buttonTitle: "",
  buttonBody: "",
  buttonFooter: "",
  replyButtons: [createReplyButtonDraft()],
  ctaButtons: [createCtaButtonDraft()],
};

const generateAutoResponseId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
};

const sanitizeAutoResponseMedia = (
  media: BotAutoResponseMedia | null,
): BotAutoResponseMedia | null => {
  if (!media) {
    return null;
  }

  const mediaType: BotAutoResponseMedia["mediaType"] =
    media.mediaType && ["image", "video", "audio", "document", "sticker"].includes(media.mediaType)
      ? media.mediaType
      : "document";
  const path = media.path?.trim() ?? "";
  const url = media.url?.trim() ?? "";

  if (!path && !url) {
    return null;
  }

  return {
    mediaType,
    path: path || null,
    url: url || null,
    fileName: media.fileName?.trim() || null,
    mimeType: media.mimeType?.trim() || null,
    caption: media.caption?.trim() || null,
  };
};

const sanitizeAutoResponseVcard = (
  card: BotAutoResponseVcard | null,
): BotAutoResponseVcard | null => {
  if (!card) {
    return null;
  }

  const vcard = card.vcard.replace(/\r\n/g, "\n").trim();
  if (!vcard) {
    return null;
  }

  const name = card.name?.trim() || "";
  const phone = card.phone?.trim() || null;
  const organization = card.organization?.trim() || null;
  const email = card.email?.trim() || null;

  return {
    name: name || phone || "Contato",
    phone,
    organization,
    email,
    vcard,
  };
};

const sanitizeAutoResponses = (entries: BotAutoResponse[]): BotAutoResponse[] => {
  const seenIds = new Set<string>();
  const list: BotAutoResponse[] = [];

  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    const matchAny = entry.matchAnyMessage === true;
    const triggers = (entry.triggers || [])
      .map((trigger) => trigger.trim().toLowerCase())
      .filter((trigger, index, array) => trigger.length > 0 && array.indexOf(trigger) === index);
    if (!matchAny && triggers.length === 0) {
      continue;
    }

    const responseText = typeof entry.responseText === "string" ? entry.responseText.trim() : "";
    const responseMedia = sanitizeAutoResponseMedia(entry.responseMedia ?? null);
    const responseVcard = sanitizeAutoResponseVcard(entry.responseVcard ?? null);
    const responseButtons = entry.responseButtons ?? null;

    if (!responseText && !responseMedia && !responseVcard && !responseButtons) {
      continue;
    }

    const id = entry.id || generateAutoResponseId();
    if (seenIds.has(id)) {
      continue;
    }

    const createdAt =
      typeof entry.createdAt === "string" && entry.createdAt.trim()
        ? entry.createdAt
        : new Date().toISOString();
    const updatedAt =
      typeof entry.updatedAt === "string" && entry.updatedAt.trim()
        ? entry.updatedAt
        : createdAt;

    const perContactLimitValue = Number(entry.perContactLimit);
    const perContactLimit = Number.isFinite(perContactLimitValue)
      ? Math.max(0, Math.floor(perContactLimitValue))
      : null;

    seenIds.add(id);
    list.push({
      id,
      triggers,
      responseText,
      responseMedia,
      responseVcard,
      responseButtons: responseButtons ?? null,
      matchMode: entry.matchMode === "contains" ? "contains" : "equals",
      matchAnyMessage: matchAny,
      perContactLimit: perContactLimit && perContactLimit > 0 ? perContactLimit : null,
      createdAt,
      updatedAt,
    });

    if (list.length >= AUTO_RESPONSE_LIMIT) {
      break;
    }
  }

  return list;
};

const formatDateTime = (value: string | null): string => {
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

type InstanceAutoResponsePanelProps = {
  instance: BotInstance | null;
  show: boolean;
  onClose: () => void;
};

const InstanceAutoResponsePanel = ({ instance, show, onClose }: InstanceAutoResponsePanelProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [autorespostaEnabled, setAutorespostaEnabled] = useState(false);
  const [nativeButtonsEnabled, setNativeButtonsEnabled] = useState(false);
  const [prefixCommandsEnabled, setPrefixCommandsEnabled] = useState(false);
  const [autoResponses, setAutoResponses] = useState<BotAutoResponse[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [savingToggle, setSavingToggle] = useState(false);
  const [savingPrefixToggle, setSavingPrefixToggle] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [modalError, setModalError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutoResponseModalDraft>(() => ({
    ...DEFAULT_DRAFT,
    replyButtons: DEFAULT_DRAFT.replyButtons.map((button) => ({ ...button })),
    ctaButtons: DEFAULT_DRAFT.ctaButtons.map((button) => ({ ...button })),
  }));
  const [originalEntry, setOriginalEntry] = useState<BotAutoResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pvCommandAllowlist, setPvCommandAllowlist] = useState<string[] | null>(null);
  const [showPvCommandModal, setShowPvCommandModal] = useState(false);
  const [pvCommandDraft, setPvCommandDraft] = useState<Set<string>>(new Set());
  const [savingPvCommands, setSavingPvCommands] = useState(false);
  const [pvCommandModalError, setPvCommandModalError] = useState<string | null>(null);
  const [pvCommandSearch, setPvCommandSearch] = useState("");

  const allPvCommandList = useMemo(() => Array.from(new Set(ALL_PV_COMMAND_KEYS)), []);
  const allPvCommandSet = useMemo(() => new Set(allPvCommandList), [allPvCommandList]);

  const normalizePvAllowlistFromSettings = useCallback(
    (value: unknown): string[] => {
      if (!Array.isArray(value)) {
        return [];
      }
      const normalized = new Set<string>();
      for (const entry of value) {
        const key = canonicalizeCommandText(
          typeof entry === "string" || typeof entry === "number" ? String(entry) : "",
        );
        if (!key || !allPvCommandSet.has(key)) {
          continue;
        }
        normalized.add(key);
      }
      return Array.from(normalized);
    },
    [allPvCommandSet],
  );

  const applySettingsSnapshot = useCallback(
    (
      settings: Record<string, unknown> | null | undefined,
      options?: { fallbackAutoResponses?: BotAutoResponse[] },
    ) => {
      if (!settings) {
        return;
      }
      const toggles = (settings.commandToggles ??
        (settings as Record<string, unknown>).command_toggles ??
        {}) as Record<string, unknown>;
      setAutorespostaEnabled(Boolean(toggles.autoresposta));
      setNativeButtonsEnabled(Boolean(toggles.nativeButtons));
      setPrefixCommandsEnabled(Boolean(toggles.prefixoPv));
      const rawAllowlist = toggles.pvCommandAllowlist;
      if (rawAllowlist === null) {
        setPvCommandAllowlist(null);
      } else if (Array.isArray(rawAllowlist)) {
        setPvCommandAllowlist(normalizePvAllowlistFromSettings(rawAllowlist));
      } else if (rawAllowlist === undefined) {
        setPvCommandAllowlist(null);
      } else {
        setPvCommandAllowlist(null);
      }
      if (Array.isArray((settings as Record<string, unknown>).autoResponses)) {
        setAutoResponses(
          sanitizeAutoResponses(
            ((settings as Record<string, unknown>).autoResponses ?? []) as BotAutoResponse[],
          ),
        );
      } else if (options?.fallbackAutoResponses) {
        setAutoResponses(sanitizeAutoResponses(options.fallbackAutoResponses));
      }
      const updatedAtCandidate = (settings as Record<string, unknown>).updatedAt;
      setLastUpdated(
        typeof updatedAtCandidate === "string"
          ? updatedAtCandidate
          : new Date().toISOString(),
      );
    },
    [normalizePvAllowlistFromSettings],
  );

  const canCreateMore = autoResponses.length < AUTO_RESPONSE_LIMIT;
  const totalPvCommands = allPvCommandList.length;
  const pvCommandSummary = useMemo(() => {
    if (pvCommandAllowlist === null) {
      return "Todos os comandos com prefixo respondem no PV.";
    }
    if (pvCommandAllowlist.length === 0) {
      return "Nenhum comando com prefixo está liberado no PV.";
    }
    return `${pvCommandAllowlist.length}/${totalPvCommands} comandos com prefixo liberados no PV.`;
  }, [pvCommandAllowlist, totalPvCommands]);

  const pvCommandBadgeVariant =
    pvCommandAllowlist === null
      ? "success"
      : pvCommandAllowlist.length === 0
        ? "secondary"
        : "info";
  const pvCommandBadgeText =
    pvCommandAllowlist === null
      ? "Todos"
      : `${pvCommandAllowlist.length}/${totalPvCommands}`;

  useEffect(() => {
    if (!show || !instance) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setFeedback(null);

    const loadSettings = async () => {
      try {
        const response = await fetch(`/api/bot-instances/${instance.id}/settings`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof data.message === "string"
              ? data.message
              : "Não foi possível carregar as configurações.",
          );
        }
        if (cancelled) {
          return;
        }
        applySettingsSnapshot(data.settings ?? {});
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar as configurações da instância.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [applySettingsSnapshot, instance, show]);

  useEffect(() => {
    if (!show) {
      setShowModal(false);
      setModalError(null);
      setShowPvCommandModal(false);
      setPvCommandModalError(null);
      setPvCommandDraft(new Set());
      setPvCommandSearch("");
    }
  }, [show]);

  useEffect(() => {
    if (!nativeButtonsEnabled) {
      setDraft((prev) =>
        prev.includeButtons ? { ...prev, includeButtons: false } : prev,
      );
    }
  }, [nativeButtonsEnabled]);

  const resetDraft = () => {
    setDraft({
      ...DEFAULT_DRAFT,
      id: generateAutoResponseId(),
      replyButtons: DEFAULT_DRAFT.replyButtons.map((button) => ({ ...button })),
      ctaButtons: DEFAULT_DRAFT.ctaButtons.map((button) => ({ ...button })),
    });
    setModalError(null);
    setOriginalEntry(null);
  };

  const handleToggleAutoresposta = async () => {
    if (!instance) {
      return;
    }
    const nextValue = !autorespostaEnabled;
    setSavingToggle(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandToggles: { autoresposta: nextValue } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar a autoresposta.",
        );
      }
      applySettingsSnapshot(data.settings ?? {});
      setFeedback({
        type: "success",
        message: nextValue
          ? "Autorespostas para o PV ativadas."
          : "Autorespostas para o PV desativadas.",
      });
    } catch (err) {
      setFeedback({
        type: "danger",
        message:
          err instanceof Error
            ? err.message
            : "Não foi possível atualizar a autoresposta.",
      });
    } finally {
      setSavingToggle(false);
    }
  };

  const handleTogglePrefixCommands = async () => {
    if (!instance) {
      return;
    }
    const nextValue = !prefixCommandsEnabled;
    setSavingPrefixToggle(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandToggles: { prefixoPv: nextValue } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar os comandos do PV.",
        );
      }
      applySettingsSnapshot(data.settings ?? {});
      setFeedback({
        type: "success",
        message: nextValue
          ? "Comandos com prefixo liberados no PV."
          : "Comandos com prefixo bloqueados no PV.",
      });
    } catch (err) {
      setFeedback({
        type: "danger",
        message:
          err instanceof Error
            ? err.message
            : "Não foi possível atualizar os comandos do PV.",
      });
    } finally {
      setSavingPrefixToggle(false);
    }
  };

  const saveAutoResponses = async (entries: BotAutoResponse[]) => {
    if (!instance) {
      return;
    }
    setSavingList(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoResponses: entries }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível salvar as autorespostas.",
        );
      }
      applySettingsSnapshot(data.settings ?? {}, { fallbackAutoResponses: entries });
      setFeedback({ type: "success", message: "Autorespostas atualizadas com sucesso." });
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Não foi possível salvar as autorespostas.";
      setFeedback({ type: "danger", message });
      setModalError(message);
      return false;
    } finally {
      setSavingList(false);
    }
  };

  const handleOpenPvCommandsModal = () => {
    if (!instance) {
      return;
    }
    const initialSelection =
      pvCommandAllowlist === null
        ? new Set(allPvCommandList)
        : new Set(pvCommandAllowlist);
    setPvCommandDraft(initialSelection);
    setPvCommandModalError(null);
    setPvCommandSearch("");
    setShowPvCommandModal(true);
  };

  const handlePvCommandDraftToggle = (key: string) => {
    if (!allPvCommandSet.has(key)) {
      return;
    }
    setPvCommandDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSelectAllPvCommands = () => {
    setPvCommandDraft(new Set(allPvCommandList));
  };

  const handleClearPvCommands = () => {
    setPvCommandDraft(new Set());
  };

  const handleSavePvCommandSelection = async () => {
    if (!instance) {
      return;
    }
    setSavingPvCommands(true);
    setPvCommandModalError(null);
    setFeedback(null);
    try {
      const selected = Array.from(pvCommandDraft).filter((key) => allPvCommandSet.has(key));
      const payloadValue =
        selected.length === totalPvCommands ? null : selected.sort();
      const response = await fetch(`/api/bot-instances/${instance.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandToggles: { pvCommandAllowlist: payloadValue } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar os comandos permitidos no PV.",
        );
      }
      applySettingsSnapshot(data.settings ?? {});
      setFeedback({
        type: "success",
        message: "Lista de comandos liberados no PV atualizada.",
      });
      setShowPvCommandModal(false);
    } catch (err) {
      setPvCommandModalError(
        err instanceof Error
          ? err.message
          : "Não foi possível atualizar os comandos permitidos no PV.",
      );
    } finally {
      setSavingPvCommands(false);
    }
  };

  const handleOpenCreate = () => {
    resetDraft();
    setModalMode("create");
    setShowModal(true);
  };

  const handleOpenEdit = (entry: BotAutoResponse) => {
    const entryButtons = entry.responseButtons ?? null;
    const includeButtons = nativeButtonsEnabled && Boolean(entryButtons);
    const buttonType = entryButtons?.type ?? "button_reply";
    const replyButtons =
      entryButtons?.type === "button_reply" && Array.isArray(entryButtons.buttons)
        ? entryButtons.buttons.map((button) => ({
            id: button.id,
            text: button.text,
          }))
        : [createReplyButtonDraft()];
    const ctaButtons =
      entryButtons?.type === "button_cta" && Array.isArray(entryButtons.buttons)
        ? entryButtons.buttons.map((button) => ({
            id: button.id,
            text: button.text,
            type: button.type,
            url: button.url ?? "",
            phoneNumber: button.phoneNumber ?? "",
            copyCode: button.copyCode ?? "",
          }))
        : [createCtaButtonDraft()];
    setOriginalEntry(entry);
    setDraft({
      id: entry.id,
      triggers: entry.matchAnyMessage ? "" : entry.triggers.join(", "),
      responseText: entry.responseText,
      matchMode: entry.matchMode,
      matchAnyMessage: entry.matchAnyMessage,
      perContactLimit: entry.perContactLimit ? String(entry.perContactLimit) : "",
      includeMedia: Boolean(entry.responseMedia),
      mediaMode: entry.responseMedia
        ? entry.responseMedia.url
          ? "url"
          : entry.responseMedia.path
          ? "upload"
          : "none"
        : "none",
      mediaType: entry.responseMedia?.mediaType ?? "image",
      mediaUrl: entry.responseMedia?.url ?? "",
      mediaCaption: entry.responseMedia?.caption ?? "",
      mediaPath: entry.responseMedia?.path ?? "",
      mediaFileName: entry.responseMedia?.fileName ?? "",
      mediaMimeType: entry.responseMedia?.mimeType ?? "",
      includeVcard: Boolean(entry.responseVcard),
      vcardName: entry.responseVcard?.name ?? "",
      vcardPhone: entry.responseVcard?.phone ?? "",
      vcardOrganization: entry.responseVcard?.organization ?? "",
      vcardEmail: entry.responseVcard?.email ?? "",
      vcardCustom: entry.responseVcard?.vcard ?? "",
      includeButtons,
      buttonType,
      buttonTitle: entryButtons?.title ?? "",
      buttonBody: entryButtons?.body ?? "",
      buttonFooter: entryButtons?.footer ?? "",
      replyButtons: includeButtons && buttonType === "button_reply" ? replyButtons : [createReplyButtonDraft()],
      ctaButtons: includeButtons && buttonType === "button_cta" ? ctaButtons : [createCtaButtonDraft()],
    });
    setModalMode("edit");
    setModalError(null);
    setShowModal(true);
  };

  const handleModalClose = () => {
    if (savingList || uploading) {
      return;
    }
    setShowModal(false);
    setModalError(null);
  };

  const handleDraftChange = (patch: Partial<AutoResponseModalDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleReplyButtonChange = (index: number, patch: Partial<ReplyButtonDraft>) => {
    setDraft((prev) => {
      if (!prev.replyButtons[index]) {
        return prev;
      }
      const nextButtons = prev.replyButtons.map((button, idx) =>
        idx === index ? { ...button, ...patch } : button,
      );
      return { ...prev, replyButtons: nextButtons };
    });
  };

  const handleAddReplyButton = () => {
    setDraft((prev) => {
      if (prev.replyButtons.length >= 3) {
        return prev;
      }
      return { ...prev, replyButtons: [...prev.replyButtons, createReplyButtonDraft()] };
    });
  };

  const handleRemoveReplyButton = (index: number) => {
    setDraft((prev) => {
      if (prev.replyButtons.length <= 1) {
        return { ...prev, replyButtons: [createReplyButtonDraft()] };
      }
      const next = prev.replyButtons.filter((_, idx) => idx !== index);
      return { ...prev, replyButtons: next.length ? next : [createReplyButtonDraft()] };
    });
  };

  const handleCtaButtonChange = (index: number, patch: Partial<CtaButtonDraft>) => {
    setDraft((prev) => {
      if (!prev.ctaButtons[index]) {
        return prev;
      }
      const nextButtons = prev.ctaButtons.map((button, idx) => {
        if (idx !== index) {
          return button;
        }
        const next = { ...button, ...patch };
        if (patch.type && patch.type !== button.type) {
          next.url = "";
          next.phoneNumber = "";
          next.copyCode = "";
        }
        return next;
      });
      return { ...prev, ctaButtons: nextButtons };
    });
  };

  const handleAddCtaButton = () => {
    setDraft((prev) => {
      if (prev.ctaButtons.length >= 3) {
        return prev;
      }
      return { ...prev, ctaButtons: [...prev.ctaButtons, createCtaButtonDraft()] };
    });
  };

  const handleRemoveCtaButton = (index: number) => {
    setDraft((prev) => {
      if (prev.ctaButtons.length <= 1) {
        return { ...prev, ctaButtons: [createCtaButtonDraft()] };
      }
      const next = prev.ctaButtons.filter((_, idx) => idx !== index);
      return { ...prev, ctaButtons: next.length ? next : [createCtaButtonDraft()] };
    });
  };

  const handleToggleButtons = (enabled: boolean) => {
    if (!nativeButtonsEnabled) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      includeButtons: enabled,
      replyButtons:
        enabled && prev.replyButtons.length === 0 ? [createReplyButtonDraft()] : prev.replyButtons,
      ctaButtons:
        enabled && prev.ctaButtons.length === 0 ? [createCtaButtonDraft()] : prev.ctaButtons,
    }));
  };

  const handleMediaFileChange = async (file: File | undefined | null) => {
    if (!file || !instance) {
      return;
    }
    setUploading(true);
    setModalError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mediaType", draft.mediaType);
      if (draft.mediaPath) {
        formData.append("previousPath", draft.mediaPath);
      }
      const response = await fetch(
        `/api/bot-instances/${instance.id}/auto-responses/upload`,
        {
          method: "POST",
          body: formData,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.media) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível enviar a mídia.",
        );
      }
      handleDraftChange({
        includeMedia: true,
        mediaMode: "upload",
        mediaPath: data.media.path ?? "",
        mediaUrl: data.media.url ?? "",
        mediaFileName: data.media.fileName ?? file.name,
        mediaMimeType: data.media.mimeType ?? file.type ?? "",
      });
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : "Não foi possível enviar a mídia.",
      );
    } finally {
      setUploading(false);
    }
  };

  const buildNormalizedPhone = (value: string) => {
    const digits = value.replace(/[^0-9+]/g, "");
    if (!digits) {
      return "";
    }
    if (digits.startsWith("+")) {
      return digits;
    }
    if (digits.startsWith("00")) {
      return `+${digits.slice(2)}`;
    }
    return `+${digits}`;
  };

  const handleModalSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setModalError(null);

    const matchAny = draft.matchAnyMessage;
    const triggerTokens = draft.triggers
      .split(/[\r\n,;]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    const triggers = triggerTokens.filter(
      (token, index, array) =>
        array.findIndex((candidate) => candidate.toLowerCase() === token.toLowerCase()) === index,
    );

    if (!matchAny && triggers.length === 0) {
      setModalError("Cadastre ao menos um gatilho para a autoresposta ou ative o modo global.");
      return;
    }

    const limitToken = draft.perContactLimit.trim();
    let perContactLimit: number | null = null;
    if (limitToken) {
      const parsedLimit = Number.parseInt(limitToken, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        setModalError("Informe um limite por contato válido (número inteiro acima de zero).");
        return;
      }
      perContactLimit = Math.floor(parsedLimit);
    }

    const responseText = draft.responseText.trim();
    let responseMedia: BotAutoResponseMedia | null = null;
    let responseVcard: BotAutoResponseVcard | null = null;
    let responseButtons: BotAutoResponse["responseButtons"] | null = null;

    if (draft.includeMedia) {
      const mediaType = draft.mediaType;
      const caption = draft.mediaCaption.trim();
      if (draft.mediaMode === "url") {
        const url = draft.mediaUrl.trim();
        if (!url) {
          setModalError("Informe o link da mídia que o bot deve enviar.");
          return;
        }
        responseMedia = {
          mediaType,
          url,
          path: null,
          fileName: null,
          mimeType: null,
          caption: caption || null,
        };
      } else if (draft.mediaMode === "upload") {
        if (!draft.mediaPath) {
          setModalError("Envie um arquivo para habilitar a resposta automática com mídia.");
          return;
        }
        responseMedia = {
          mediaType,
          url: draft.mediaUrl ? draft.mediaUrl : null,
          path: draft.mediaPath,
          fileName: draft.mediaFileName || null,
          mimeType: draft.mediaMimeType || null,
          caption: caption || null,
        };
      } else {
        setModalError("Selecione como deseja enviar a mídia da autoresposta.");
        return;
      }
    }

    if (draft.includeVcard) {
      const name = draft.vcardName.trim();
      const organization = draft.vcardOrganization.trim();
      const email = draft.vcardEmail.trim();
      const normalizedPhone = buildNormalizedPhone(draft.vcardPhone.trim());
      let vcardContent = draft.vcardCustom.replace(/\r\n/g, "\n").trim();
      if (!vcardContent) {
        if (!name && !normalizedPhone) {
          setModalError("Informe o nome ou telefone para montar o contato do bot.");
          return;
        }
        const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${name || normalizedPhone || "Contato"}`];
        if (organization) {
          lines.push(`ORG:${organization}`);
        }
        if (email) {
          lines.push(`EMAIL:${email}`);
        }
        if (normalizedPhone) {
          lines.push(`TEL:${normalizedPhone}`);
        }
        lines.push("END:VCARD");
        vcardContent = lines.join("\n");
      }
      if (!vcardContent) {
        setModalError("Não foi possível gerar o VCard informado.");
        return;
      }
      responseVcard = {
        name: name || normalizedPhone || "Contato",
        phone: normalizedPhone || null,
        organization: organization || null,
        email: email || null,
        vcard: vcardContent,
      };
    }

    if (nativeButtonsEnabled && draft.includeButtons) {
      if (draft.buttonType === "button_reply") {
        const buttons: { id: string; text: string }[] = [];
        draft.replyButtons.forEach((button) => {
          if (buttons.length >= 3) {
            return;
          }
          const text = button.text.trim();
          if (!text) {
            return;
          }
          const id = button.id.trim() || `reply_${buttons.length + 1}`;
          buttons.push({ id, text: text.slice(0, 20) });
        });
        if (buttons.length === 0) {
          setModalError("Cadastre ao menos um botão de resposta rápida.");
          return;
        }
        responseButtons = {
          type: "button_reply",
          title: draft.buttonTitle.trim() || undefined,
          body: draft.buttonBody.trim() || undefined,
          footer: draft.buttonFooter.trim() || undefined,
          buttons,
        };
      } else {
        const buttons: Array<{
          id: string;
          text: string;
          type: "cta_url" | "cta_call" | "cta_copy";
          url?: string;
          phoneNumber?: string;
          copyCode?: string;
        }> = [];
        for (let i = 0; i < draft.ctaButtons.length && buttons.length < 3; i += 1) {
          const button = draft.ctaButtons[i];
          const text = button.text.trim();
          if (!text) {
            continue;
          }
          const id = button.id.trim() || `cta_${buttons.length + 1}`;
          if (button.type === "cta_url") {
            const url = button.url.trim();
            if (!url) {
              setModalError(`Informe o link do botão ${i + 1}.`);
              return;
            }
            buttons.push({ id, text: text.slice(0, 20), type: "cta_url", url });
            continue;
          }
          if (button.type === "cta_call") {
            const phoneNumber = buildNormalizedPhone(button.phoneNumber.trim());
            if (!phoneNumber) {
              setModalError(`Informe o telefone do botão ${i + 1}.`);
              return;
            }
            buttons.push({ id, text: text.slice(0, 20), type: "cta_call", phoneNumber });
            continue;
          }
          const copyCode = button.copyCode.trim();
          if (!copyCode) {
            setModalError(`Informe o código para copiar no botão ${i + 1}.`);
            return;
          }
          buttons.push({ id, text: text.slice(0, 20), type: "cta_copy", copyCode });
        }
        if (buttons.length === 0) {
          setModalError("Cadastre ao menos um botão CTA válido.");
          return;
        }
        responseButtons = {
          type: "button_cta",
          title: draft.buttonTitle.trim() || undefined,
          body: draft.buttonBody.trim() || undefined,
          footer: draft.buttonFooter.trim() || undefined,
          buttons,
        };
      }
    } else if (modalMode === "edit" && originalEntry?.responseButtons) {
      responseButtons = originalEntry.responseButtons;
    }

    if (!responseText && !responseMedia && !responseVcard && !responseButtons) {
      setModalError("Defina uma mensagem, mídia ou contato para enviar ao cliente.");
      return;
    }

    const now = new Date().toISOString();
    const nextEntries = [...autoResponses];

    if (modalMode === "edit" && originalEntry) {
      const index = nextEntries.findIndex((item) => item.id === originalEntry.id);
      const updated: BotAutoResponse = {
        id: originalEntry.id,
        triggers: matchAny ? [] : triggers.map((token) => token.toLowerCase()),
        responseText,
        matchMode: draft.matchMode,
        matchAnyMessage: matchAny,
        perContactLimit,
        responseMedia,
        responseVcard,
        responseButtons,
        createdAt: originalEntry.createdAt || now,
        updatedAt: now,
      };
      if (index >= 0) {
        nextEntries[index] = updated;
      } else {
        nextEntries.push(updated);
      }
    } else {
      nextEntries.push({
        id: draft.id || generateAutoResponseId(),
        triggers: matchAny ? [] : triggers.map((token) => token.toLowerCase()),
        responseText,
        matchMode: draft.matchMode,
        matchAnyMessage: matchAny,
        perContactLimit,
        responseMedia,
        responseVcard,
        responseButtons,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (nextEntries.length > AUTO_RESPONSE_LIMIT) {
      setModalError(
        `Limite de ${AUTO_RESPONSE_LIMIT} autorespostas atingido. Remova alguma entrada antes de adicionar outra.`,
      );
      return;
    }

    const sanitized = sanitizeAutoResponses(nextEntries);
    const success = await saveAutoResponses(sanitized);
    if (success) {
      handleModalClose();
    }
  };

  const handleDelete = async (entry: BotAutoResponse) => {
    if (savingList || uploading) {
      return;
    }
    if (!window.confirm("Tem certeza de que deseja remover esta autoresposta?")) {
      return;
    }
    const remaining = autoResponses.filter((item) => item.id !== entry.id);
    await saveAutoResponses(remaining);
  };

  const handleMediaRemove = () => {
    handleDraftChange({
      includeMedia: false,
      mediaMode: "none",
      mediaUrl: "",
      mediaCaption: "",
      mediaPath: "",
      mediaFileName: "",
      mediaMimeType: "",
    });
  };

  const draftedMediaSource = useMemo(() => {
    if (!draft.includeMedia) {
      return null;
    }
    if (draft.mediaMode === "url" && draft.mediaUrl) {
      return draft.mediaUrl.trim();
    }
    if (draft.mediaMode === "upload" && draft.mediaPath) {
      return draft.mediaPath;
    }
    return null;
  }, [draft.includeMedia, draft.mediaMode, draft.mediaUrl, draft.mediaPath]);

  if (!instance) {
    return null;
  }

  return (
    <>
      <Offcanvas
        placement="end"
        show={show}
        onHide={onClose}
        scroll
        backdrop
        className="instance-autoresponse-offcanvas"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            Autorespostas do PV — {instance.name || instance.phone}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="d-flex flex-column gap-3">
          {loading ? (
            <div className="d-flex align-items-center gap-2 text-secondary">
              <Spinner animation="border" role="status" size="sm" />
              Carregando configurações...
            </div>
          ) : error ? (
            <Alert variant="danger" className="mb-0">
              {error}
            </Alert>
          ) : (
            <>
              <p className="text-secondary mb-0">
                Configure gatilhos para que o robô responda mensagens privadas automaticamente.
                Cada entrada pode enviar texto, mídia ou contato assim que o cliente enviar o gatilho.
              </p>
              <p className="text-secondary mb-0">
                Use prefixos como <code>/help</code> ou palavras-chave como <code>promoção</code> para personalizar o atendimento 24/7.
              </p>

              {feedback ? (
                <Alert
                  variant={feedback.type}
                  onClose={() => setFeedback(null)}
                  dismissible
                  className="mb-0"
                >
                  {feedback.message}
                </Alert>
              ) : null}

              <Card>
                <Card.Body className="d-flex flex-column gap-2">
                  <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                      <Card.Title className="mb-0">Comandos com prefixo (PV)</Card.Title>
                      <small className="text-secondary">
                        Controle se comandos iniciados com /, ! ou # devem responder no privado. As
                        autorespostas seguem ativas conforme configurado.
                      </small>
                    </div>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <Form.Check
                        type="switch"
                        id={`instance-${instance.id}-prefixo-pv`}
                        label={prefixCommandsEnabled ? "Permitido" : "Bloqueado"}
                        checked={prefixCommandsEnabled}
                        onChange={handleTogglePrefixCommands}
                        disabled={savingPrefixToggle || savingToggle || savingList}
                      />
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={handleOpenPvCommandsModal}
                        disabled={loading || savingPrefixToggle || savingToggle || savingList}
                      >
                        Gerenciar permissões
                      </Button>
                      <Badge bg={pvCommandBadgeVariant}>{pvCommandBadgeText}</Badge>
                    </div>
                  </div>
                  <small className="text-secondary">
                    {prefixCommandsEnabled
                      ? pvCommandSummary
                      : "Ative a opção acima para liberar comandos com prefixo no PV."}
                  </small>
                </Card.Body>
              </Card>

              <Card>
                <Card.Body className="d-flex flex-column gap-3">
                  <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                      <Card.Title className="mb-0">Autorespostas inteligentes (PV)</Card.Title>
                      <small className="text-secondary">
                        Ative para liberar os gatilhos configurados abaixo.
                      </small>
                    </div>
                    <Form.Check
                      type="switch"
                      id={`instance-${instance.id}-autoresposta`}
                      label="Ativar autorespostas"
                      checked={autorespostaEnabled}
                      onChange={handleToggleAutoresposta}
                      disabled={savingToggle || savingList || savingPrefixToggle}
                    />
                  </div>

                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <Button
                      size="sm"
                      onClick={handleOpenCreate}
                      disabled={!canCreateMore || savingList || uploading}
                    >
                      Nova autoresposta
                    </Button>
                    {!canCreateMore ? (
                      <Badge bg="warning" text="dark">
                        Limite atingido
                      </Badge>
                    ) : null}
                    {savingList ? (
                      <span className="d-flex align-items-center gap-2 text-secondary small">
                        <Spinner animation="border" size="sm" role="status" />
                        Salvando autorespostas...
                      </span>
                    ) : null}
                  </div>

                  <div className="text-secondary small">
                    {`${autoResponses.length} de ${AUTO_RESPONSE_LIMIT} autorespostas cadastradas.`}
                    {lastUpdated ? ` Última atualização em ${formatDateTime(lastUpdated)}.` : ""}
                  </div>

                  {autoResponses.length === 0 ? (
                    <Alert variant="secondary" className="mb-0">
                      Nenhuma autoresposta cadastrada ainda. Clique em &quot;Nova autoresposta&quot; para adicionar a primeira configuração.
                    </Alert>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {autoResponses.map((response) => (
                        <div key={response.id} className="border rounded p-3 bg-body-tertiary">
                          <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                            <div className="d-flex flex-column gap-1">
                              <div className="d-flex flex-wrap align-items-center gap-2">
                                <strong>
                                  {response.matchAnyMessage
                                    ? "Qualquer mensagem recebida"
                                    : response.triggers.join(", ") || "—"}
                                </strong>
                                {response.matchAnyMessage ? (
                                  <span className="badge bg-info text-dark text-uppercase">
                                    Gatilho global
                                  </span>
                                ) : (
                                  <span className="badge bg-secondary text-uppercase">
                                    {response.matchMode === "contains" ? "Contém" : "Igual"}
                                  </span>
                                )}
                                {response.perContactLimit ? (
                                  <span className="badge bg-warning text-dark text-uppercase">
                                    {`Limite ${response.perContactLimit}× por contato`}
                                  </span>
                                ) : null}
                                {response.responseButtons ? (
                                  <span className="badge bg-primary text-uppercase">
                                    {response.responseButtons.type === "button_reply"
                                      ? "Botões reply"
                                      : "Botões CTA"}
                                  </span>
                                ) : null}
                              </div>
                              <small className="text-secondary">
                                {response.matchAnyMessage
                                  ? "Dispara para qualquer mensagem enviada no PV."
                                  : response.matchMode === "contains"
                                    ? "Mensagem do cliente precisa conter o gatilho."
                                    : "Mensagem do cliente precisa ser exatamente igual ao gatilho."}
                              </small>
                              <small className="text-secondary">
                                Última atualização em {formatDateTime(response.updatedAt ?? null)}.
                              </small>
                              {response.responseButtons ? (
                                <small className="text-secondary">
                                  Botões cadastrados:{" "}
                                  {response.responseButtons.buttons
                                    .map((button) => button.text)
                                    .join(" · ")}
                                </small>
                              ) : null}
                            </div>
                            <div className="d-flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline-primary"
                                onClick={() => handleOpenEdit(response)}
                                disabled={savingList || uploading}
                              >
                                Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline-danger"
                                onClick={() => void handleDelete(response)}
                                disabled={savingList || uploading}
                              >
                                Remover
                              </Button>
                            </div>
                          </div>
                          {response.responseText ? (
                            <p className="mb-0 text-secondary" style={{ whiteSpace: "pre-wrap" }}>
                              {response.responseText}
                            </p>
                          ) : null}
                          {response.responseMedia ? (
                            <div className="text-secondary small mt-2">
                              <div>
                                {`Mídia: ${response.responseMedia.mediaType}`}
                                {response.responseMedia.url
                                  ? " · link"
                                  : response.responseMedia.fileName
                                    ? ` · ${response.responseMedia.fileName}`
                                    : response.responseMedia.path
                                      ? ` · ${response.responseMedia.path}`
                                      : ""}
                              </div>
                              {response.responseMedia.caption ? (
                                <div style={{ whiteSpace: "pre-wrap" }}>
                                  {`Legenda: ${response.responseMedia.caption}`}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {response.responseVcard ? (
                            <div className="text-secondary small mt-2">
                              {`Contato: ${response.responseVcard.name}`}
                              {response.responseVcard.phone ? ` • ${response.responseVcard.phone}` : ""}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </>
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <Modal show={showModal} onHide={handleModalClose} centered backdrop="static" size="lg">
        <Form onSubmit={handleModalSubmit} className="d-flex flex-column">
          <Modal.Header closeButton={!savingList && !uploading}>
            <Modal.Title>
              {modalMode === "edit" ? "Editar autoresposta" : "Nova autoresposta"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="d-flex flex-column gap-3">
            {modalError ? (
              <Alert variant="danger" className="mb-0">
                {modalError}
              </Alert>
            ) : null}

            <Form.Check
              type="switch"
              id="instance-auto-response-global-trigger"
              label="Responder a qualquer mensagem recebida"
              checked={draft.matchAnyMessage}
              onChange={(event) =>
                handleDraftChange({
                  matchAnyMessage: event.target.checked,
                  triggers: event.target.checked ? "" : draft.triggers,
                })
              }
              disabled={savingList || uploading}
            />

            <Form.Group>
              <Form.Label>Gatilhos</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={draft.triggers}
                onChange={(event) => handleDraftChange({ triggers: event.target.value })}
                placeholder="Informe palavras ou comandos separados por vírgula ou linha."
                disabled={savingList || uploading || draft.matchAnyMessage}
              />
              <Form.Text className="text-secondary">
                {draft.matchAnyMessage
                  ? "Com o modo global ativo, o bot responde qualquer mensagem recebida."
                  : "O bot responde quando a mensagem do cliente corresponde a algum gatilho cadastrado."}
              </Form.Text>
            </Form.Group>

            <Form.Group>
              <Form.Label>Modo de correspondência</Form.Label>
              <Form.Select
                value={draft.matchMode}
                onChange={(event) =>
                  handleDraftChange({ matchMode: event.target.value as "contains" | "equals" })
                }
                disabled={savingList || uploading || draft.matchAnyMessage}
              >
                <option value="equals">Mensagem igual ao gatilho</option>
                <option value="contains">Mensagem contém o gatilho</option>
              </Form.Select>
              <Form.Text className="text-secondary">
                {draft.matchAnyMessage
                  ? "Desativado porque a resposta é enviada para qualquer mensagem."
                  : "Escolha se o texto precisa ser exatamente igual ou apenas conter o gatilho."}
              </Form.Text>
            </Form.Group>

            <Form.Group>
              <Form.Label>Limite de respostas por contato</Form.Label>
              <Form.Control
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ilimitado"
                value={draft.perContactLimit}
                onChange={(event) =>
                  handleDraftChange({
                    perContactLimit: event.target.value.replace(/[^0-9]/g, ""),
                  })
                }
                disabled={savingList || uploading}
              />
              <Form.Text className="text-secondary">
                Deixe em branco para liberar envios ilimitados. Defina um número para limitar quantas vezes cada contato recebe essa resposta automaticamente.
              </Form.Text>
            </Form.Group>

            <Form.Group>
              <Form.Label>Mensagem de resposta</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={draft.responseText}
                onChange={(event) => handleDraftChange({ responseText: event.target.value })}
                placeholder="Escreva o texto que será enviado ao cliente."
                disabled={savingList || uploading}
              />
            </Form.Group>

            <div className="d-flex flex-column gap-2 border rounded p-3">
              <Form.Check
                type="switch"
                id="instance-auto-response-media-toggle"
                label="Incluir mídia na resposta"
                checked={draft.includeMedia}
                onChange={(event) =>
                  handleDraftChange({
                    includeMedia: event.target.checked,
                    mediaMode: event.target.checked ? draft.mediaMode : "none",
                  })
                }
                disabled={savingList || uploading}
              />

              {draft.includeMedia ? (
                <div className="d-flex flex-column gap-2">
                  <Form.Group>
                    <Form.Label>Tipo de mídia</Form.Label>
                    <Form.Select
                      value={draft.mediaType}
                      onChange={(event) =>
                        handleDraftChange({
                          mediaType: event.target.value as BotAutoResponseMedia["mediaType"],
                        })
                      }
                      disabled={savingList || uploading}
                    >
                      <option value="image">Imagem</option>
                      <option value="video">Vídeo</option>
                      <option value="audio">Áudio</option>
                      <option value="document">Documento</option>
                      <option value="sticker">Sticker</option>
                    </Form.Select>
                  </Form.Group>

                  <div className="d-flex flex-column gap-2">
                    <Form.Check
                      type="radio"
                      id="instance-auto-response-media-url"
                      name="instance-auto-response-media-mode"
                      label="Enviar por link"
                      checked={draft.mediaMode === "url"}
                      onChange={() =>
                        handleDraftChange({
                          mediaMode: "url",
                          mediaUrl: draft.mediaUrl,
                        })
                      }
                      disabled={savingList || uploading}
                    />
                    {draft.mediaMode === "url" ? (
                      <Form.Control
                        type="url"
                        value={draft.mediaUrl}
                        onChange={(event) => handleDraftChange({ mediaUrl: event.target.value })}
                        placeholder="https://..."
                        disabled={savingList || uploading}
                      />
                    ) : null}

                    <Form.Check
                      type="radio"
                      id="instance-auto-response-media-upload"
                      name="instance-auto-response-media-mode"
                      label="Enviar arquivo hospedado"
                      checked={draft.mediaMode === "upload"}
                      onChange={() =>
                        handleDraftChange({
                          mediaMode: "upload",
                        })
                      }
                      disabled={savingList || uploading}
                    />
                    {draft.mediaMode === "upload" ? (
                      <Form.Control
                        type="file"
                        accept={draft.mediaType === "sticker" ? "image/*" : undefined}
                        onChange={(event) => handleMediaFileChange(event.target.files?.[0])}
                        disabled={savingList || uploading}
                      />
                    ) : null}

                    {draftedMediaSource ? (
                      <div className="text-secondary small">Fonte atual: {draftedMediaSource}</div>
                    ) : null}

                    <Form.Control
                      type="text"
                      value={draft.mediaCaption}
                      onChange={(event) => handleDraftChange({ mediaCaption: event.target.value })}
                      placeholder="Legenda da mídia (opcional)"
                      disabled={savingList || uploading}
                    />

                    <div className="d-flex gap-2">
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={handleMediaRemove}
                        disabled={savingList || uploading}
                      >
                        Remover mídia
                      </Button>
                      {uploading ? (
                        <span className="d-inline-flex align-items-center gap-2 text-secondary small">
                          <Spinner animation="border" size="sm" role="status" /> Enviando mídia...
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="d-flex flex-column gap-2 border rounded p-3">
              <Form.Check
                type="switch"
                id="instance-auto-response-buttons-toggle"
                label="Incluir botões interativos"
                checked={draft.includeButtons}
                onChange={(event) => handleToggleButtons(event.target.checked)}
                disabled={!nativeButtonsEnabled || savingList || uploading}
              />

              {!nativeButtonsEnabled ? (
                <Alert variant="light" className="mb-0 text-secondary small">
                  Os botões nativos estão desativados para esta instância. Peça ao administrador para habilitar a opção
                  <strong> Botões nativos</strong> no painel para liberar esta funcionalidade.
                </Alert>
              ) : null}

              {nativeButtonsEnabled && draft.includeButtons ? (
                <div className="d-flex flex-column gap-2">
                  <Form.Group>
                    <Form.Label>Tipo de botão</Form.Label>
                    <Form.Select
                      value={draft.buttonType}
                      onChange={(event) =>
                        handleDraftChange({
                          buttonType: event.target.value as "button_reply" | "button_cta",
                        })
                      }
                      disabled={savingList || uploading}
                    >
                      <option value="button_reply">Resposta rápida (até 3 opções)</option>
                      <option value="button_cta">
                        CTA (link, ligação ou código para copiar)
                      </option>
                    </Form.Select>
                  </Form.Group>

                  <Form.Group>
                    <Form.Label>Título (opcional)</Form.Label>
                    <Form.Control
                      type="text"
                      value={draft.buttonTitle}
                      onChange={(event) => handleDraftChange({ buttonTitle: event.target.value })}
                      placeholder="Texto do cabeçalho exibido acima dos botões."
                      disabled={savingList || uploading}
                    />
                  </Form.Group>

                  <Form.Group>
                    <Form.Label>Mensagem exibida nos botões</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={draft.buttonBody}
                      onChange={(event) => handleDraftChange({ buttonBody: event.target.value })}
                      placeholder="Texto principal mostrado antes das opções."
                      disabled={savingList || uploading}
                    />
                    <Form.Text className="text-secondary">
                      Se deixar em branco, o bot reaproveita o texto da resposta para montar a mensagem dos botões.
                    </Form.Text>
                  </Form.Group>

                  <Form.Group>
                    <Form.Label>Rodapé (opcional)</Form.Label>
                    <Form.Control
                      type="text"
                      value={draft.buttonFooter}
                      onChange={(event) => handleDraftChange({ buttonFooter: event.target.value })}
                      placeholder="Texto exibido abaixo dos botões."
                      disabled={savingList || uploading}
                    />
                  </Form.Group>

                  {draft.buttonType === "button_reply" ? (
                    <div className="d-flex flex-column gap-2">
                      {draft.replyButtons.map((button, index) => (
                        <div key={`reply-button-${index}`} className="border rounded p-2">
                          <div className="d-flex flex-column flex-md-row gap-2 align-items-start">
                            <Form.Control
                              type="text"
                              value={button.text}
                              onChange={(event) =>
                                handleReplyButtonChange(index, { text: event.target.value })
                              }
                              placeholder={`Texto do botão ${index + 1}`}
                              disabled={savingList || uploading}
                            />
                            <Form.Control
                              type="text"
                              value={button.id}
                              onChange={(event) =>
                                handleReplyButtonChange(index, { id: event.target.value })
                              }
                              placeholder="ID (opcional)"
                              disabled={savingList || uploading}
                            />
                            {draft.replyButtons.length > 1 ? (
                              <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => handleRemoveReplyButton(index)}
                                disabled={savingList || uploading}
                              >
                                Remover
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                      {draft.replyButtons.length < 3 ? (
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={handleAddReplyButton}
                          disabled={savingList || uploading}
                        >
                          Adicionar botão
                        </Button>
                      ) : null}
                      <Form.Text className="text-secondary">
                        O WhatsApp permite até 3 botões de resposta rápida. Utilize o ID para identificar o clique,
                        caso precise automatizar o tratamento.
                      </Form.Text>
                    </div>
                  ) : (
                    <div className="d-flex flex-column gap-3">
                      {draft.ctaButtons.map((button, index) => (
                        <div key={`cta-button-${index}`} className="border rounded p-3">
                          <div className="row g-2 align-items-center">
                            <div className="col-md-5">
                              <Form.Control
                                type="text"
                                value={button.text}
                                onChange={(event) =>
                                  handleCtaButtonChange(index, { text: event.target.value })
                                }
                                placeholder={`Texto do botão ${index + 1}`}
                                disabled={savingList || uploading}
                              />
                            </div>
                            <div className="col-md-4">
                              <Form.Select
                                value={button.type}
                                onChange={(event) =>
                                  handleCtaButtonChange(index, {
                                    type: event.target.value as CtaButtonDraft["type"],
                                  })
                                }
                                disabled={savingList || uploading}
                              >
                                <option value="cta_url">Abrir link</option>
                                <option value="cta_call">Iniciar ligação</option>
                                <option value="cta_copy">Copiar código</option>
                              </Form.Select>
                            </div>
                            <div className="col-md-3 d-flex gap-2">
                              <Form.Control
                                type="text"
                                value={button.id}
                                onChange={(event) =>
                                  handleCtaButtonChange(index, { id: event.target.value })
                                }
                                placeholder="ID (opcional)"
                                disabled={savingList || uploading}
                              />
                              {draft.ctaButtons.length > 1 ? (
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  onClick={() => handleRemoveCtaButton(index)}
                                  disabled={savingList || uploading}
                                >
                                  Remover
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-2">
                            {button.type === "cta_url" ? (
                              <Form.Control
                                type="url"
                                value={button.url}
                                onChange={(event) =>
                                  handleCtaButtonChange(index, { url: event.target.value })
                                }
                                placeholder="https://exemplo.com"
                                disabled={savingList || uploading}
                              />
                            ) : button.type === "cta_call" ? (
                              <Form.Control
                                type="tel"
                                value={button.phoneNumber}
                                onChange={(event) =>
                                  handleCtaButtonChange(index, { phoneNumber: event.target.value })
                                }
                                placeholder="+5511999999999"
                                disabled={savingList || uploading}
                              />
                            ) : (
                              <Form.Control
                                type="text"
                                value={button.copyCode}
                                onChange={(event) =>
                                  handleCtaButtonChange(index, { copyCode: event.target.value })
                                }
                                placeholder="Código que será copiado"
                                disabled={savingList || uploading}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                      {draft.ctaButtons.length < 3 ? (
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={handleAddCtaButton}
                          disabled={savingList || uploading}
                        >
                          Adicionar botão
                        </Button>
                      ) : null}
                      <Form.Text className="text-secondary">
                        É possível combinar até 3 botões CTA. Preencha o campo correspondente de acordo com o tipo selecionado (link, telefone ou código).
                      </Form.Text>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="d-flex flex-column gap-2 border rounded p-3">
              <Form.Check
                type="switch"
                id="instance-auto-response-vcard-toggle"
                label="Incluir contato (VCard)"
                checked={draft.includeVcard}
                onChange={(event) =>
                  handleDraftChange({ includeVcard: event.target.checked })
                }
                disabled={savingList || uploading}
              />

              {draft.includeVcard ? (
                <div className="d-flex flex-column gap-2">
                  <Form.Control
                    type="text"
                    value={draft.vcardName}
                    onChange={(event) => handleDraftChange({ vcardName: event.target.value })}
                    placeholder="Nome"
                    disabled={savingList || uploading}
                  />
                  <Form.Control
                    type="tel"
                    value={draft.vcardPhone}
                    onChange={(event) => handleDraftChange({ vcardPhone: event.target.value })}
                    placeholder="Telefone (incluir DDI)"
                    disabled={savingList || uploading}
                  />
                  <Form.Control
                    type="text"
                    value={draft.vcardOrganization}
                    onChange={(event) =>
                      handleDraftChange({ vcardOrganization: event.target.value })
                    }
                    placeholder="Empresa (opcional)"
                    disabled={savingList || uploading}
                  />
                  <Form.Control
                    type="email"
                    value={draft.vcardEmail}
                    onChange={(event) => handleDraftChange({ vcardEmail: event.target.value })}
                    placeholder="E-mail (opcional)"
                    disabled={savingList || uploading}
                  />
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={draft.vcardCustom}
                    onChange={(event) => handleDraftChange({ vcardCustom: event.target.value })}
                    placeholder="Cole um VCard completo se preferir utilizar um formato personalizado."
                    disabled={savingList || uploading}
                  />
                  <Form.Text className="text-secondary">
                    Caso deixe o campo de VCard em branco, o contato será gerado automaticamente com os dados acima.
                  </Form.Text>
                </div>
              ) : null}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleModalClose} disabled={savingList || uploading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={savingList || uploading}>
              {savingList ? (
                <span className="d-inline-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" role="status" />
                  Salvando...
                </span>
              ) : modalMode === "edit" ? (
                "Salvar alterações"
              ) : (
                "Criar autoresposta"
              )}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={showPvCommandModal}
        onHide={() => {
          if (!savingPvCommands) {
            setShowPvCommandModal(false);
          }
        }}
        centered
        size="lg"
        backdrop="static"
      >
        <Modal.Header closeButton={!savingPvCommands}>
          <Modal.Title>Permitir comandos no PV</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0">
            Escolha quais comandos com prefixo responderão no privado. Quando todos estiverem
            selecionados, o bot replica o comportamento atual do menu completo.
          </p>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <Badge bg="primary">
              {pvCommandDraft.size}/{totalPvCommands} selecionados
            </Badge>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={handleSelectAllPvCommands}
              disabled={savingPvCommands}
            >
              Marcar todos
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={handleClearPvCommands}
              disabled={savingPvCommands}
            >
              Limpar
            </Button>
            <Form.Control
              type="search"
              size="sm"
              placeholder="Buscar comando..."
              value={pvCommandSearch}
              onChange={(event) => setPvCommandSearch(event.target.value)}
              style={{ maxWidth: 220 }}
            />
          </div>
          {pvCommandModalError ? (
            <Alert variant="danger" className="mb-0">
              {pvCommandModalError}
            </Alert>
          ) : null}
          <div className="border rounded p-3" style={{ maxHeight: "50vh", overflowY: "auto" }}>
            {(() => {
              const searchTerm = pvCommandSearch.trim().toLowerCase();
              let rendered = false;
              const blocks = PV_COMMAND_CATEGORIES.map((category) => {
                const commandList = searchTerm
                  ? category.commands.filter((cmd) =>
                      `${cmd.label} ${cmd.description ?? ""}`.toLowerCase().includes(searchTerm),
                    )
                  : category.commands;
                if (commandList.length === 0) {
                  return null;
                }
                rendered = true;
                return (
                  <div key={category.id} className="mb-4">
                    <div className="fw-semibold text-uppercase small text-secondary mb-1">
                      {category.title}
                    </div>
                    {category.description ? (
                      <small className="text-secondary d-block mb-2">
                        {category.description}
                      </small>
                    ) : null}
                    <div className="d-flex flex-column gap-2">
                      {commandList.map((cmd) => (
                        <Form.Check
                          key={`${category.id}-${cmd.key}`}
                          type="switch"
                          id={`pv-command-${category.id}-${cmd.key}`}
                          label={
                            <span className="d-flex flex-column">
                              <span className="fw-semibold text-uppercase">{cmd.label}</span>
                              {cmd.description ? (
                                <small className="text-secondary">{cmd.description}</small>
                              ) : null}
                            </span>
                          }
                          checked={pvCommandDraft.has(cmd.key)}
                          onChange={() => handlePvCommandDraftToggle(cmd.key)}
                          disabled={savingPvCommands}
                        />
                      ))}
                    </div>
                  </div>
                );
              });
              if (!rendered) {
                return (
                  <div className="text-center text-secondary py-4">
                    Nenhum comando corresponde à busca.
                  </div>
                );
              }
              return blocks;
            })()}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            onClick={() => {
              if (!savingPvCommands) {
                setShowPvCommandModal(false);
              }
            }}
            disabled={savingPvCommands}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSavePvCommandSelection}
            disabled={savingPvCommands}
          >
            {savingPvCommands ? "Salvando..." : "Salvar"}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default InstanceAutoResponsePanel;
