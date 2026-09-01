"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "react-bootstrap";
import {
  IconArrowLeft,
  IconDotsVertical,
  IconPaperclip,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconRefresh,
  IconSearch,
  IconSend,
  IconSpeakerphone,
  IconTrash,
  IconUser,
  IconUserCircle,
  IconUsersGroup,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import FloatingAlert from "components/common/FloatingAlert";
import botStyles from "components/bot/BotAdminWorkspace.module.css";
import supportStyles from "components/admin/AdminSupportWhatsApp.module.css";
import waStyles from "components/whatsapp/WhatsAppConversationsClient.module.css";
import type { BotInstanceAdminSummary, BotInstanceStatus } from "types/bot-instances";
import type { BotGroup } from "types/bot-groups";

const RAW_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const BASE_PREFIX = RAW_BASE_PATH && RAW_BASE_PATH !== "/"
  ? (RAW_BASE_PATH.startsWith("/") ? RAW_BASE_PATH : `/${RAW_BASE_PATH}`)
  : "";
const ADMIN_SSE_PATH = `${BASE_PREFIX}/api/admin/support/stream`;

type ThreadUserInfo = {
  id: number;
  name: string;
  email: string | null;
  whatsappNumber: string | null;
  avatarUrl?: string | null;
};

type ThreadSummary = {
  whatsappId: string;
  customerName: string | null;
  profileName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  status: "open" | "closed";
  handlingMode: "bot" | "human";
  reminderSentAt: string | null;
  within24h: boolean;
  minutesLeft24h: number;
  displayWhatsappId?: string | null;
  isAdminThread?: boolean;
};

type ThreadEntry = {
  user: ThreadUserInfo;
  thread: ThreadSummary;
  isDirectoryResult?: boolean;
};

type DirectoryUser = {
  id: number;
  name: string;
  email: string | null;
};

type SupportMessage = {
  id: number;
  direction: "inbound" | "outbound";
  messageType: string;
  text: string | null;
  timestamp: string;
  senderUserId: number | null;
  senderRole: "user" | "admin" | "contact" | "system";
  media?: {
    mediaId?: string | null;
    mediaUrl?: string | null;
    mediaType: string;
    mimeType: string | null;
    filename?: string | null;
    caption?: string | null;
  } | null;
};

type ConversationPayload = {
  user: ThreadUserInfo | null;
  thread: ThreadSummary;
  messages: SupportMessage[];
};

type Feedback = { type: "success" | "danger" | "warning"; message: string } | null;

type AdminSupportCenterProps = {
  embedded?: boolean;
};

const classNames = (...items: Array<string | false | null | undefined>) =>
  items.filter(Boolean).join(" ");

const normalizeSearchValue = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const formatShortTime = (value: string | null) => {
  if (!value) return "";
  try {
    const date = new Date(value);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
};

const formatDateTime = (value: string | null) => {
  if (!value) return "Sem registro";
  try {
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const resolveMediaUrl = (media?: SupportMessage["media"]) => {
  if (!media) return null;
  if (media.mediaUrl) return media.mediaUrl;
  if (media.mediaId) return `/api/admin/support/media/${encodeURIComponent(media.mediaId)}`;
  return null;
};

const inferMimeTypeFromSource = (source?: string | null) => {
  if (!source) return null;
  const normalized = source.split("?")[0]?.toLowerCase() ?? "";
  if (normalized.endsWith(".mp3")) return "audio/mpeg";
  if (normalized.endsWith(".ogg")) return "audio/ogg";
  if (normalized.endsWith(".m4a") || normalized.endsWith(".mp4")) return "audio/mp4";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".aac")) return "audio/aac";
  return null;
};

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const AudioMessagePlayer = ({
  src,
  mimeType,
  isOutbound,
}: {
  src: string;
  mimeType?: string | null;
  isOutbound: boolean;
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (progressRef.current) {
        const ratio =
          duration > 0 ? Math.min(Math.max(audio.currentTime / duration, 0), 1) : 0;
        progressRef.current.style.setProperty("--audio-progress", `${ratio * 100}%`);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (progressRef.current) {
        progressRef.current.style.setProperty("--audio-progress", "0%");
      }
    };

    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [duration]);

  useEffect(() => {
    // Reset state when source changes
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    if (progressRef.current) {
      progressRef.current.style.setProperty("--audio-progress", "0%");
    }
  }, [src]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) {
        await audio.play();
        setIsPlaying(true);
      } else {
        audio.pause();
        setIsPlaying(false);
      }
    } catch (error) {
      console.error("[support-audio] Falha ao reproduzir áudio", error);
    }
  };

  const bubbleStyle: React.CSSProperties = {
    backgroundColor: isOutbound ? "rgba(255, 255, 255, 0.18)" : "#f1f5f9",
    color: isOutbound ? "#fff" : "#0f172a",
    borderRadius: 999,
    padding: "8px 14px",
    minWidth: 220,
    maxWidth: 320,
  };

  const progressTrackStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: 4,
    borderRadius: 999,
    backgroundColor: isOutbound ? "rgba(255, 255, 255, 0.35)" : "#cbd5f5",
    overflow: "hidden",
  };

  const progressBarStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "var(--audio-progress, 0%)",
    backgroundColor: isOutbound ? "#ffffff" : "#0d6efd",
    transition: "width 140ms linear",
  };

  const buttonClass = isOutbound
    ? "btn btn-light btn-sm rounded-circle d-flex align-items-center justify-content-center shadow-sm"
    : "btn btn-outline-primary btn-sm rounded-circle d-flex align-items-center justify-content-center shadow-sm";

  return (
    <div className="audio-message-player d-flex align-items-center gap-3" style={bubbleStyle}>
      <button
        type="button"
        className={buttonClass}
        style={{ width: 36, height: 36 }}
        onClick={togglePlayback}
        aria-label={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {isPlaying ? <IconPlayerPauseFilled size={18} /> : <IconPlayerPlayFilled size={18} />}
      </button>
      <div className="flex-grow-1 d-flex flex-column gap-1">
        <div ref={progressRef} style={progressTrackStyle}>
          <div style={progressBarStyle} />
        </div>
        <div className="d-flex justify-content-between small">
          <span>{formatTime(currentTime)}</span>
          <span>{duration > 0 ? formatTime(duration) : "--:--"}</span>
        </div>
      </div>
      <audio ref={audioRef} src={src} preload="metadata">
        {mimeType ? <source src={src} type={mimeType} /> : null}
        Seu navegador não suporta reprodução de áudio.
      </audio>
    </div>
  );
};

const renderSupportMedia = (
  media: SupportMessage["media"],
  isOutbound: boolean,
) => {
  if (!media) return null;
  const url = resolveMediaUrl(media);
  if (!url) return null;

  const caption = media.caption ?? media.filename ?? null;

  switch (media.mediaType) {
    case "image":
      return (
        <div className="d-flex flex-column gap-2 mb-2">
          <NextImage
            src={url}
            alt={caption ?? "Imagem"}
            width={800}
            height={600}
            className="img-fluid rounded"
            style={{ maxHeight: 260, height: "auto" }}
            unoptimized
          />
          {caption && <span>{caption}</span>}
        </div>
      );
    case "video":
      return (
        <div className="d-flex flex-column gap-2 mb-2">
          <video controls className="w-100" style={{ maxHeight: 260 }}>
            <source src={url} type={media.mimeType ?? undefined} />
            Seu dispositivo não suporta reprodução de vídeo embutido.
          </video>
          {caption && <span>{caption}</span>}
        </div>
      );
    case "audio": {
      const audioMime =
        media.mimeType ||
        inferMimeTypeFromSource(media.mediaUrl ?? undefined) ||
        inferMimeTypeFromSource(media.filename ?? undefined) ||
        inferMimeTypeFromSource(url) ||
        undefined;

      return (
        <div className="mb-2">
          <AudioMessagePlayer src={url} mimeType={audioMime ?? undefined} isOutbound={isOutbound} />
          {caption && <div className="small mt-2">{caption}</div>}
        </div>
      );
    }
    case "sticker":
      return (
        <div className="mb-2">
          <NextImage
            src={url}
            alt="Sticker"
            width={320}
            height={320}
            className="img-fluid"
            style={{ maxHeight: 180, height: "auto" }}
            unoptimized
          />
        </div>
      );
    case "document":
    default:
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={waStyles.messageDocumentPreview}
        >
          <span>
            <strong>Baixar arquivo</strong>
            <small>{caption ?? media.filename ?? "documento"}</small>
          </span>
        </a>
      );
  }
};

const PLACEHOLDER_PATTERNS = [/^suporte\b/i, /^equipe\b/i];

const isPlaceholderLabel = (value: string | null | undefined): boolean => {
  if (!value) {
    return true;
  }
  const normalized = value.trim();
  if (!normalized) {
    return true;
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
};

const initialsFor = (value: string | null | undefined) => {
  const normalized = value?.trim() || "U";
  const parts = normalized.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "U";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${second}`.toUpperCase();
};

const getDisplayName = (entry: ThreadEntry) => {
  const ownerName = entry.user.name?.trim();
  if (ownerName) {
    return ownerName;
  }

  const candidateThreadName = entry.thread.customerName?.trim();
  if (candidateThreadName && !isPlaceholderLabel(candidateThreadName)) {
    return candidateThreadName;
  }

  const profileName = entry.thread.profileName?.trim();
  if (profileName && !isPlaceholderLabel(profileName)) {
    return profileName;
  }

  const ownerEmail = entry.user.email?.trim();
  if (ownerEmail) {
    return ownerEmail;
  }

  const phone = entry.user.whatsappNumber?.trim() || entry.thread.displayWhatsappId?.trim();
  if (phone) {
    return phone;
  }

  return entry.thread.whatsappId;
};

const PLAN_STATUS_OPTIONS = [
  { value: "inactive", label: "Inativo", tone: "muted" },
  { value: "pending", label: "Pendente", tone: "amber" },
  { value: "active", label: "Ativo", tone: "emerald" },
  { value: "expired", label: "Expirado", tone: "rose" },
  { value: "cancelled", label: "Cancelado", tone: "slate" },
] as const;

type PlanStatusValue = (typeof PLAN_STATUS_OPTIONS)[number]["value"];

const supportInstanceStatusLabel = (status: BotInstanceStatus) => {
  switch (status) {
    case "conectado":
      return "Conectado";
    case "aguardando_qr":
      return "Aguardando QR";
    case "aguardando_pareamento":
      return "Aguardando pareamento";
    case "inicializando":
      return "Inicializando";
    default:
      return "Desconectado";
  }
};

const PLAN_STATUS_PILL_TONES: Record<
  (typeof PLAN_STATUS_OPTIONS)[number]["tone"],
  string
> = {
  muted: supportStyles.modalOptionPill_muted,
  amber: supportStyles.modalOptionPill_amber,
  emerald: supportStyles.modalOptionPill_emerald,
  rose: supportStyles.modalOptionPill_rose,
  slate: supportStyles.modalOptionPill_slate,
};

const AdminSupportCenter = ({ embedded = false }: AdminSupportCenterProps = {}) => {
  const [threads, setThreads] = useState<ThreadEntry[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const directoryRequestIdRef = useRef(0);
  const [selected, setSelected] = useState<{ userId: number; whatsappId: string } | null>(null);
  const [conversation, setConversation] = useState<ConversationPayload | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const sseRetryRef = useRef<number | null>(null);
  const quickActionPressTimerRef = useRef<number | null>(null);
  const [quickActionEntry, setQuickActionEntry] = useState<ThreadEntry | null>(null);
  const [quickActionBusy, setQuickActionBusy] = useState<string | null>(null);
  const [editUserEntry, setEditUserEntry] = useState<ThreadEntry | null>(null);
  const [editUserForm, setEditUserForm] = useState({
    name: "",
    email: "",
    role: "user" as "user" | "admin",
    password: "",
    balance: "",
    isActive: true,
    revokeSessions: false,
  });
  const [confirmModal, setConfirmModal] = useState<null | "delete">(null);
  const [profilesModalOpen, setProfilesModalOpen] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planModalLoading, setPlanModalLoading] = useState(false);
  const [planModalSaving, setPlanModalSaving] = useState(false);
  const [planModalError, setPlanModalError] = useState<string | null>(null);
  const [planOptions, setPlanOptions] = useState<
    Array<{ id: number; name: string; price: number; durationDays: number }>
  >([]);
  const [planForm, setPlanForm] = useState({
    planId: "",
    status: "inactive" as "inactive" | "pending" | "active" | "expired" | "cancelled",
    periodEnd: "",
  });
  const [profilesModalLoading, setProfilesModalLoading] = useState(false);
  const [profilesModalError, setProfilesModalError] = useState<string | null>(null);
  const [profilesModalTab, setProfilesModalTab] = useState<"instances" | "groups">("instances");
  const [profilesModalBusy, setProfilesModalBusy] = useState<string | null>(null);
  const [supportUserInstances, setSupportUserInstances] = useState<BotInstanceAdminSummary[]>([]);
  const [supportUserGroups, setSupportUserGroups] = useState<BotGroup[]>([]);
  const [supportInstanceRenameId, setSupportInstanceRenameId] = useState<number | null>(null);
  const [supportInstanceRenameValue, setSupportInstanceRenameValue] = useState("");

  const customerDisplayName = useMemo(() => {
    if (!conversation) {
      return "Cliente";
    }
    const candidate =
      conversation.user?.name?.trim() ||
      conversation.thread.customerName?.trim() ||
      conversation.thread.profileName?.trim() ||
      conversation.thread.whatsappId?.trim();
    return candidate && candidate.length > 0 ? candidate : "Cliente";
  }, [conversation]);

  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const res = await fetch("/api/admin/support/threads", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "Não foi possível carregar os atendimentos.");
      }
      const data = (await res.json()) as { threads: ThreadEntry[] };
      setThreads(Array.isArray(data.threads) ? data.threads : []);
    } catch (error) {
      console.error(error);
      setThreadsError(
        error instanceof Error ? error.message : "Falha ao carregar a lista de atendimentos.",
      );
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const fetchConversation = useCallback(async (params: { userId: number; whatsappId: string }) => {
    setConversationLoading(true);
    setConversationError(null);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/admin/support/threads/${params.userId}/${encodeURIComponent(params.whatsappId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "Falha ao carregar a conversa selecionada.");
      }
      const payload = (await res.json()) as ConversationPayload;
      setConversation(payload);
      return payload;
    } catch (error) {
      console.error(error);
      setConversationError(
        error instanceof Error ? error.message : "Não foi possível carregar a conversa.",
      );
      return null;
    } finally {
      setConversationLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    if (!selected && threads.length > 0) {
      const first = threads[0];
      setSelected({ userId: first.user.id, whatsappId: first.thread.whatsappId });
    }
  }, [threads, selected]);

  // SSE live updates (threads + messages) for admins
  useEffect(() => {
    let disposed = false;

    const handleThreadUpdated = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as { userId: number; thread: ThreadSummary };
        let found = false;
        setThreads((prev) => {
          const idx = prev.findIndex(
            (it) => it.user.id === payload.userId && it.thread.whatsappId === payload.thread.whatsappId,
          );
          if (idx === -1) return prev;
          found = true;
          const next = [...prev];
          next[idx] = { ...next[idx], thread: { ...next[idx].thread, ...payload.thread } };
          return next;
        });

        if (!found) {
          void fetchThreads();
        }

        setConversation((prev) => {
          if (!prev) return prev;
          const selectedThread = { userId: prev.user?.id ?? -1, whatsappId: prev.thread.whatsappId };
          if (payload.userId !== selectedThread.userId || payload.thread.whatsappId !== selectedThread.whatsappId) {
            return prev;
          }
          return { ...prev, thread: { ...prev.thread, ...payload.thread } };
        });
      } catch {}
    };

    const handleMessageCreated = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as {
          userId: number;
          whatsappId: string;
          message: SupportMessage;
        };
        setConversation((prev) => {
          if (!prev) return prev;
          if (prev.user?.id !== payload.userId || prev.thread.whatsappId !== payload.whatsappId) return prev;
          if (prev.messages.some((m) => m.id === payload.message.id)) return prev;
          const messages = [...prev.messages, payload.message].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          );
          return { ...prev, messages, thread: { ...prev.thread, lastMessageAt: payload.message.timestamp } };
        });
      } catch {}
    };

    const handleOpen = () => {
      if (sseRetryRef.current) {
        window.clearTimeout(sseRetryRef.current);
        sseRetryRef.current = null;
      }
    };

    const cleanupSse = () => {
      const current = sseRef.current;
      if (!current) return;
      current.removeEventListener("open", handleOpen);
      current.removeEventListener("support:thread-updated", handleThreadUpdated);
      current.removeEventListener("support:message-created", handleMessageCreated);
      try {
        current.close();
      } catch {}
      sseRef.current = null;
    };

    const scheduleReconnect = (delay = 15000) => {
      if (disposed) return;
      if (sseRetryRef.current) return;
      sseRetryRef.current = window.setTimeout(() => {
        sseRetryRef.current = null;
        startSse();
      }, delay);
    };

    const startSse = () => {
      if (disposed || sseRef.current) return;
      try {
        const es = new EventSource(ADMIN_SSE_PATH, { withCredentials: true });
        sseRef.current = es;
        es.addEventListener("open", handleOpen);
        es.addEventListener("support:thread-updated", handleThreadUpdated);
        es.addEventListener("support:message-created", handleMessageCreated);
        es.onerror = () => {
          cleanupSse();
          scheduleReconnect();
          void fetchThreads();
        };
      } catch (error) {
        console.error("[admin-support] Falha ao iniciar SSE", error);
        scheduleReconnect();
      }
    };

    startSse();

    return () => {
      disposed = true;
      if (sseRetryRef.current) {
        window.clearTimeout(sseRetryRef.current);
        sseRetryRef.current = null;
      }
      cleanupSse();
    };
  }, [fetchThreads]);

  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [isMobileSupport, setIsMobileSupport] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsMobileSupport(media.matches);
    apply();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  const handleSelectThread = useCallback(async (entry: ThreadEntry) => {
    let resolvedEntry = entry;

    if (entry.isDirectoryResult) {
      setConversationLoading(true);
      setConversationError(null);
      try {
        const response = await fetch("/api/admin/support/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: entry.user.id }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.entry) {
          throw new Error(data?.message ?? "Não foi possível iniciar a conversa.");
        }
        resolvedEntry = data.entry as ThreadEntry;
        setThreads((previous) => [
          resolvedEntry,
          ...previous.filter(
            (item) =>
              item.user.id !== resolvedEntry.user.id ||
              item.thread.whatsappId !== resolvedEntry.thread.whatsappId,
          ),
        ]);
        setDirectoryUsers((previous) => previous.filter((user) => user.id !== resolvedEntry.user.id));
      } catch (error) {
        setConversationError(
          error instanceof Error ? error.message : "Não foi possível iniciar a conversa.",
        );
        setConversationLoading(false);
        return;
      }
    }

    setSelected({ userId: resolvedEntry.user.id, whatsappId: resolvedEntry.thread.whatsappId });
    if (isMobileSupport) {
      setMobileChatOpen(true);
    }
    try {
      window.dispatchEvent(
        new CustomEvent("support:thread-opened", {
          detail: { userId: resolvedEntry.user.id, whatsappId: resolvedEntry.thread.whatsappId },
        }),
      );
    } catch {}

    // Clear unread counter locally for the selected thread (admin side)
    try {
      const raw = sessionStorage.getItem("support-unread-counts");
      const counts = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      if (counts && typeof counts === "object" && counts[resolvedEntry.thread.whatsappId]) {
        delete counts[resolvedEntry.thread.whatsappId];
        sessionStorage.setItem("support-unread-counts", JSON.stringify(counts));
        window.dispatchEvent(new CustomEvent("support:unread-counts", { detail: { counts } }));
      }
    } catch {}
  }, [isMobileSupport]);

  const openQuickActions = useCallback((entry: ThreadEntry) => {
    setQuickActionEntry(entry);
    setFeedback(null);
  }, []);

  const scheduleQuickActions = useCallback((entry: ThreadEntry) => {
    if (quickActionPressTimerRef.current) {
      window.clearTimeout(quickActionPressTimerRef.current);
    }
    quickActionPressTimerRef.current = window.setTimeout(() => {
      quickActionPressTimerRef.current = null;
      openQuickActions(entry);
    }, 520);
  }, [openQuickActions]);

  const cancelQuickActionsSchedule = useCallback(() => {
    if (quickActionPressTimerRef.current) {
      window.clearTimeout(quickActionPressTimerRef.current);
      quickActionPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelQuickActionsSchedule(), [cancelQuickActionsSchedule]);

  const formatPlanDateInput = (value: string | null) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    const hours = String(parsed.getHours()).padStart(2, "0");
    const minutes = String(parsed.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const planDateInputToIso = (value: string) => {
    if (!value.trim()) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  const closeSupportDialogs = useCallback(() => {
    setQuickActionEntry(null);
    setEditUserEntry(null);
    setPlanModalOpen(false);
    setProfilesModalOpen(false);
    setConfirmModal(null);
    setPlanModalError(null);
    setPlanModalLoading(false);
    setPlanModalSaving(false);
    setProfilesModalLoading(false);
    setProfilesModalError(null);
    setProfilesModalTab("instances");
    setProfilesModalBusy(null);
    setSupportUserInstances([]);
    setSupportUserGroups([]);
    setSupportInstanceRenameId(null);
    setSupportInstanceRenameValue("");
  }, []);

  const loadSupportProfilesData = useCallback(async (userId: number) => {
    setProfilesModalLoading(true);
    setProfilesModalError(null);
    try {
      const [instancesResponse, planResponse] = await Promise.all([
        fetch(`/api/admin/bot-instances?userId=${userId}`, { cache: "no-store" }),
        fetch(`/api/admin/users/${userId}/plan`, { cache: "no-store" }),
      ]);
      const instancesData = await instancesResponse.json().catch(() => ({}));
      const planData = await planResponse.json().catch(() => ({}));

      if (!instancesResponse.ok) {
        throw new Error(
          typeof instancesData.message === "string"
            ? instancesData.message
            : "Não foi possível carregar os perfis WhatsApp.",
        );
      }
      if (!planResponse.ok) {
        throw new Error(
          typeof planData.message === "string"
            ? planData.message
            : "Não foi possível carregar os grupos do usuário.",
        );
      }

      setSupportUserInstances(
        Array.isArray(instancesData.instances)
          ? (instancesData.instances as BotInstanceAdminSummary[])
          : [],
      );
      setSupportUserGroups(Array.isArray(planData.groups) ? (planData.groups as BotGroup[]) : []);
    } catch (error) {
      setProfilesModalError(
        error instanceof Error ? error.message : "Falha ao carregar perfis e grupos.",
      );
      setSupportUserInstances([]);
      setSupportUserGroups([]);
    } finally {
      setProfilesModalLoading(false);
    }
  }, []);

  const startEditUser = useCallback((entry: ThreadEntry) => {
    setPlanModalOpen(false);
    setProfilesModalOpen(false);
    setConfirmModal(null);
    setEditUserEntry(entry);
    setEditUserForm({
      name: entry.user.name || "",
      email: entry.user.email || "",
      role: "user",
      password: "",
      balance: "",
      isActive: true,
      revokeSessions: false,
    });
    setQuickActionEntry(null);
  }, []);

  const openProfilesModalFromSupport = useCallback(
    (entry: ThreadEntry) => {
      setQuickActionEntry(null);
      setPlanModalOpen(false);
      setConfirmModal(null);
      setPlanModalError(null);
      setEditUserEntry(entry);
      setProfilesModalOpen(true);
      setProfilesModalTab("instances");
      void loadSupportProfilesData(entry.user.id);
    },
    [loadSupportProfilesData],
  );

  const saveSupportInstanceRename = useCallback(async () => {
    if (!editUserEntry || supportInstanceRenameId === null) return;
    const trimmed = supportInstanceRenameValue.trim();
    const current = supportUserInstances.find((item) => item.id === supportInstanceRenameId);
    if (!trimmed || !current || trimmed === current.name) {
      setSupportInstanceRenameId(null);
      setSupportInstanceRenameValue("");
      return;
    }

    setProfilesModalBusy(`rename-${supportInstanceRenameId}`);
    setProfilesModalError(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${supportInstanceRenameId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string" ? data.message : "Não foi possível renomear o perfil.",
        );
      }
      setSupportUserInstances((previous) =>
        previous.map((item) =>
          item.id === supportInstanceRenameId ? { ...item, name: trimmed } : item,
        ),
      );
      setSupportInstanceRenameId(null);
      setSupportInstanceRenameValue("");
      setFeedback({ type: "success", message: "Perfil renomeado com sucesso." });
    } catch (error) {
      setProfilesModalError(
        error instanceof Error ? error.message : "Falha ao renomear o perfil.",
      );
    } finally {
      setProfilesModalBusy(null);
    }
  }, [editUserEntry, supportInstanceRenameId, supportInstanceRenameValue, supportUserInstances]);

  const refreshSupportInstanceStatus = useCallback(async (instanceId: number) => {
    setProfilesModalBusy(`status-${instanceId}`);
    setProfilesModalError(null);
    try {
      const response = await fetch(`/api/admin/bot-instances/${instanceId}/status`, {
        method: "GET",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar o status.",
        );
      }
      if (typeof data.status === "string") {
        setSupportUserInstances((previous) =>
          previous.map((item) =>
            item.id === instanceId
              ? { ...item, sessionStatus: data.status as BotInstanceStatus }
              : item,
          ),
        );
      } else {
        await loadSupportProfilesData(editUserEntry?.user.id ?? 0);
      }
    } catch (error) {
      setProfilesModalError(
        error instanceof Error ? error.message : "Falha ao atualizar status do perfil.",
      );
    } finally {
      setProfilesModalBusy(null);
    }
  }, [editUserEntry?.user.id, loadSupportProfilesData]);

  const toggleSupportGroupStatus = useCallback(async (group: BotGroup) => {
    setProfilesModalBusy(`group-${group.id}`);
    setProfilesModalError(null);
    try {
      const response = await fetch(`/api/admin/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: group.status !== "active" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar o grupo.",
        );
      }
      const nextStatus = group.status === "active" ? "disabled" : "active";
      setSupportUserGroups((previous) =>
        previous.map((item) =>
          item.id === group.id ? { ...item, status: nextStatus } : item,
        ),
      );
      setFeedback({
        type: "success",
        message: nextStatus === "active" ? "Grupo ativado." : "Grupo desativado.",
      });
    } catch (error) {
      setProfilesModalError(
        error instanceof Error ? error.message : "Falha ao atualizar o grupo.",
      );
    } finally {
      setProfilesModalBusy(null);
    }
  }, []);

  const openPlanModalFromSupport = useCallback(async (entry: ThreadEntry) => {
    setQuickActionEntry(null);
    setProfilesModalOpen(false);
    setConfirmModal(null);
    setPlanModalOpen(true);
    setPlanModalLoading(true);
    setPlanModalError(null);
    setEditUserEntry(entry);
    try {
      const response = await fetch(`/api/admin/users/${entry.user.id}/plan`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível carregar o plano do usuário.",
        );
      }
      const plans = Array.isArray(data.plans)
        ? data.plans
            .filter(
              (plan: unknown): plan is { id: number; name: string; price: number; durationDays: number } =>
                Boolean(
                  plan &&
                    typeof plan === "object" &&
                    typeof (plan as { id?: unknown }).id === "number" &&
                    typeof (plan as { name?: unknown }).name === "string",
                ),
            )
            .map((plan) => ({
              id: plan.id,
              name: plan.name,
              price: typeof plan.price === "number" ? plan.price : 0,
              durationDays: typeof plan.durationDays === "number" ? plan.durationDays : 0,
            }))
        : [];
      setPlanOptions(plans);
      const currentPlanId = data?.status?.planId ? String(data.status.planId) : "";
      const rawStatus = data?.status?.status;
      const allowedStatuses = ["inactive", "pending", "active", "expired", "cancelled"] as const;
      const normalizedStatus = allowedStatuses.includes(rawStatus) ? rawStatus : "inactive";
      setPlanForm({
        planId: currentPlanId,
        status: normalizedStatus,
        periodEnd: formatPlanDateInput(data?.status?.currentPeriodEnd ?? null),
      });
    } catch (error) {
      setPlanModalError(
        error instanceof Error ? error.message : "Falha ao carregar informações do plano.",
      );
    } finally {
      setPlanModalLoading(false);
    }
  }, []);

  const saveSupportPlan = useCallback(async () => {
    if (!editUserEntry) return;
    const planIdNumber = Number.parseInt(planForm.planId, 10);
    if (!Number.isFinite(planIdNumber) || planIdNumber <= 0) {
      setPlanModalError("Selecione um plano válido.");
      return;
    }
    setPlanModalSaving(true);
    setPlanModalError(null);
    try {
      const response = await fetch(`/api/admin/users/${editUserEntry.user.id}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: planIdNumber,
          status: planForm.status,
          periodEnd: planDateInputToIso(planForm.periodEnd),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível salvar o plano.",
        );
      }
      closeSupportDialogs();
      setFeedback({ type: "success", message: "Plano atualizado com sucesso." });
    } catch (error) {
      setPlanModalError(
        error instanceof Error ? error.message : "Falha ao salvar o plano do usuário.",
      );
    } finally {
      setPlanModalSaving(false);
    }
  }, [closeSupportDialogs, editUserEntry, planForm]);

  const handleImpersonateUser = useCallback(async (entry: ThreadEntry) => {
    setQuickActionBusy("impersonate");
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/users/${entry.user.id}/impersonate`, {
        method: "POST",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível entrar no painel do usuário.");
      }
      window.location.href = "/dashboard/user";
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao entrar no painel do usuário.",
      });
    } finally {
      setQuickActionBusy(null);
    }
  }, []);

  const saveEditedUser = useCallback(async () => {
    if (!editUserEntry) return;
    setQuickActionBusy("edit-user");
    setFeedback(null);
    try {
      const payload: Record<string, unknown> = {
        name: editUserForm.name.trim(),
        email: editUserForm.email.trim(),
        role: editUserForm.role,
        isActive: editUserForm.isActive,
        revokeSessions: editUserForm.revokeSessions,
      };
      if (editUserForm.password.trim()) {
        payload.password = editUserForm.password.trim();
      }
      if (editUserForm.balance.trim()) {
        payload.balance = editUserForm.balance.trim();
      }

      const response = await fetch(`/api/admin/users/${editUserEntry.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível salvar o usuário.");
      }

      const updatedName = editUserForm.name.trim();
      const updatedEmail = editUserForm.email.trim() || null;
      setThreads((previous) =>
        previous.map((entry) =>
          entry.user.id === editUserEntry.user.id
            ? { ...entry, user: { ...entry.user, name: updatedName, email: updatedEmail } }
            : entry,
        ),
      );
      setConversation((previous) =>
        previous?.user?.id === editUserEntry.user.id
          ? { ...previous, user: { ...previous.user, name: updatedName, email: updatedEmail } }
          : previous,
      );
      setEditUserEntry(null);
      setFeedback({ type: "success", message: data?.message ?? "Usuário atualizado." });
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao salvar usuário.",
      });
    } finally {
      setQuickActionBusy(null);
    }
  }, [editUserEntry, editUserForm]);

  useEffect(() => {
    if (threadsLoading) {
      return;
    }

    try {
      const raw = sessionStorage.getItem("support:target-thread");
      if (!raw) {
        return;
      }
      sessionStorage.removeItem("support:target-thread");

      let targetWhatsapp: string | null = null;
      let targetUserId: number | null = null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.whatsappId === "string") {
            targetWhatsapp = parsed.whatsappId;
          }
          if (typeof parsed.userId === "number") {
            targetUserId = parsed.userId;
          }
        }
      } catch {
        targetWhatsapp = raw;
      }

      if (!targetWhatsapp) {
        return;
      }

      const entry = threads.find((item) => {
        if (targetUserId != null) {
          return item.user.id === targetUserId && item.thread.whatsappId === targetWhatsapp;
        }
        return item.thread.whatsappId === targetWhatsapp;
      });

      if (entry) {
        handleSelectThread(entry);
      }
    } catch {
      // ignore storage errors
    }
  }, [threads, threadsLoading, handleSelectThread]);

  useEffect(() => {
    if (!selected) return;
    fetchConversation(selected);
  }, [selected, fetchConversation]);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [conversation?.messages]);

  const updateThreadEntry = (userId: number, summary: ThreadSummary) => {
    setThreads((prev) => {
      const index = prev.findIndex(
        (item) => item.user.id === userId && item.thread.whatsappId === summary.whatsappId,
      );
      if (index === -1) {
        return prev;
      }
      const next = [...prev];
      next[index] = { ...next[index], thread: summary };
      return next;
    });
  };

  const handleSendMessage = async () => {
    if (!selected || !conversation) {
      return;
    }
    const { userId, whatsappId } = selected;

    if (!messageText.trim() && !file) {
      setFeedback({ type: "warning", message: "Escreva uma mensagem ou selecione um arquivo." });
      return;
    }

    setSending(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append("userId", String(userId));
      formData.append("to", whatsappId);

      if (file) {
        formData.append("mode", "media");
        formData.append("file", file);
        if (messageText.trim()) {
          formData.append("caption", messageText.trim());
        }
        formData.append("mediaType", file.type || "");
      } else {
        formData.append("mode", "text");
        formData.append("text", messageText.trim());
      }

      const res = await fetch("/api/admin/support/messages", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message ?? "Falha ao enviar a mensagem.");
      }

      const nextConversation: ConversationPayload = {
        user: conversation.user,
        thread: data.thread as ThreadSummary,
        messages: [...(conversation.messages ?? []), data.message as SupportMessage],
      };
      setConversation(nextConversation);
      updateThreadEntry(userId, data.thread as ThreadSummary);
      setMessageText("");
      setFile(null);
      setFeedback({ type: "success", message: "Mensagem enviada." });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao enviar mensagem.",
      });
    } finally {
      setSending(false);
    }
  };

  const handleDeleteThread = async () => {
    if (!selected) return;

    try {
      const res = await fetch(
        `/api/admin/support/threads/${selected.userId}/${encodeURIComponent(selected.whatsappId)}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message ?? "Não foi possível remover o atendimento.");
      }

      setThreads((prev) => prev.filter(
        (entry) => !(entry.user.id === selected.userId && entry.thread.whatsappId === selected.whatsappId),
      ));

      setFeedback({ type: "success", message: "Atendimento removido." });

      setConversation(null);
      setSelected(null);
      try {
        window.dispatchEvent(new CustomEvent("support:thread-opened", { detail: { whatsappId: null } }));
      } catch {}
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao remover o atendimento.",
      });
    }
  };

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("support-unread-counts");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setUnreadCounts(parsed as Record<string, number>);
        }
      }
    } catch {}

    const handleCounts = (event: Event) => {
      const detail = (event as CustomEvent<{ counts?: Record<string, number> }>).detail;
      if (detail?.counts) {
        setUnreadCounts(detail.counts);
      }
    };
    window.addEventListener("support:unread-counts", handleCounts as EventListener);
    return () => window.removeEventListener("support:unread-counts", handleCounts as EventListener);
  }, []);

  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      const aUnread = unreadCounts[a.thread.whatsappId] ?? 0;
      const bUnread = unreadCounts[b.thread.whatsappId] ?? 0;
      if (aUnread !== bUnread) {
        return bUnread - aUnread; // não lidas primeiro
      }
      const left = a.thread.lastMessageAt ? new Date(a.thread.lastMessageAt).getTime() : 0;
      const right = b.thread.lastMessageAt ? new Date(b.thread.lastMessageAt).getTime() : 0;
      return right - left;
    });
  }, [threads, unreadCounts]);

  const selectedKey = selected ? `${selected.userId}:${selected.whatsappId}` : null;
  const [threadSearch, setThreadSearch] = useState("");

  useEffect(() => {
    const query = threadSearch.trim();
    const requestId = ++directoryRequestIdRef.current;

    if (query.length < 2) {
      setDirectoryUsers([]);
      setDirectoryLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setDirectoryLoading(true);
      try {
        const params = new URLSearchParams({ q: query, limit: "50" });
        const response = await fetch(`/api/admin/users?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.message ?? "Não foi possível pesquisar usuários.");
        }
        if (requestId === directoryRequestIdRef.current) {
          setDirectoryUsers(Array.isArray(data?.users) ? data.users : []);
        }
      } catch (error) {
        if (!controller.signal.aborted && requestId === directoryRequestIdRef.current) {
          setThreadsError(
            error instanceof Error ? error.message : "Não foi possível pesquisar usuários.",
          );
          setDirectoryUsers([]);
        }
      } finally {
        if (requestId === directoryRequestIdRef.current) {
          setDirectoryLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [threadSearch]);

  const messageSendDisabled = (() => {
    if (!conversation) return true;
    const baseDisabled = sending || (!file && !messageText.trim());
    return baseDisabled;
  })();

  const filteredThreads = useMemo(() => {
    const q = normalizeSearchValue(threadSearch);
    if (!q) return sortedThreads;

    const matched = sortedThreads.filter((entry) => {
      const name = normalizeSearchValue(getDisplayName(entry));
      const email = normalizeSearchValue(entry.user.email);
      const whatsappId = normalizeSearchValue(entry.thread.whatsappId);
      const accountWhatsapp = normalizeSearchValue(entry.user.whatsappNumber);
      const userId = String(entry.user.id);
      return (
        name.includes(q) ||
        email.includes(q) ||
        whatsappId.includes(q) ||
        accountWhatsapp.includes(q) ||
        userId.includes(q)
      );
    });

    const result = [...matched];
    const seen = new Set(result.map((entry) => `${entry.user.id}:${entry.thread.whatsappId}`));

    for (const user of directoryUsers) {
      const existing = sortedThreads.filter((entry) => entry.user.id === user.id);
      if (existing.length > 0) {
        for (const entry of existing) {
          const key = `${entry.user.id}:${entry.thread.whatsappId}`;
          if (!seen.has(key)) {
            seen.add(key);
            result.push(entry);
          }
        }
        continue;
      }

      const key = `${user.id}:__admin__`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          isDirectoryResult: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            whatsappNumber: null,
            avatarUrl: null,
          },
          thread: {
            whatsappId: "__admin__",
            customerName: null,
            profileName: null,
            lastMessagePreview: "Clique para iniciar uma conversa interna.",
            lastMessageAt: null,
            status: "open",
            handlingMode: "bot",
            reminderSentAt: null,
            within24h: true,
            minutesLeft24h: 9999,
            isAdminThread: true,
          },
        });
      }
    }

    return result;
  }, [directoryUsers, sortedThreads, threadSearch]);

  const showThreadList = !isMobileSupport || !mobileChatOpen;
  const showChatPanel = !isMobileSupport || mobileChatOpen;

  return (
    <>
      <div
        className={classNames(
          supportStyles.workspace,
          !embedded && supportStyles.workspaceStandalone,
        )}
      >
        <aside
          className={classNames(
            waStyles.threadListPane,
            isMobileSupport && !showThreadList && supportStyles.paneHiddenMobile,
            isMobileSupport && showThreadList && supportStyles.paneVisibleMobile,
          )}
        >
          <header className={waStyles.sidebarHeader}>
            <div className={waStyles.sidebarTitleWrap}>
              <div className={waStyles.sidebarLogo} aria-hidden="true">
                <IconSpeakerphone size={20} />
              </div>
              <div className={waStyles.sidebarTitleText}>
                <h1>Atendimentos</h1>
                <span className={waStyles.sidebarBrandName}>Suporte em tempo real</span>
              </div>
            </div>
            <button
              type="button"
              className={waStyles.headerIconButton}
              onClick={() => void fetchThreads()}
              disabled={threadsLoading}
              aria-label="Atualizar conversas"
              title="Atualizar"
            >
              {threadsLoading ? <Spinner animation="border" size="sm" /> : <IconRefresh size={18} />}
            </button>
          </header>

          <div className={waStyles.sidebarTools}>
            <label className={waStyles.searchBox}>
              <IconSearch size={16} />
              <input
                type="search"
                placeholder="Buscar nome, e-mail ou número"
                value={threadSearch}
                onChange={(event) => setThreadSearch(event.currentTarget.value)}
              />
            </label>
          </div>

          <div className={waStyles.threadScroll}>
            {threadsError ? (
              <FloatingAlert
                feedback={{ type: "danger", message: threadsError }}
                onClose={() => setThreadsError(null)}
              />
            ) : directoryLoading && filteredThreads.length === 0 ? (
              <p className={supportStyles.emptyChat}>
                <Spinner animation="border" size="sm" className="me-2" />
                Pesquisando usuários...
              </p>
            ) : filteredThreads.length === 0 ? (
              <p className={supportStyles.emptyChat}>Nenhum atendimento encontrado.</p>
            ) : (
              filteredThreads.map((entry) => {
                const key = `${entry.user.id}:${entry.thread.whatsappId}`;
                const isSelected = selectedKey === key;
                const displayName = getDisplayName(entry);
                const subtitle = entry.user.email ?? entry.thread.whatsappId ?? "Sem contato";
                const unread = unreadCounts[entry.thread.whatsappId] ?? 0;
                const preview = entry.thread.lastMessagePreview?.trim() || "Sem mensagens";
                return (
                  <button
                    key={key}
                    type="button"
                    className={classNames(
                      waStyles.threadButton,
                      isSelected && waStyles.threadButtonSelected,
                      unread > 0 && waStyles.threadButtonPinned,
                    )}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!entry.isDirectoryResult) openQuickActions(entry);
                    }}
                    onPointerDown={() => {
                      if (!entry.isDirectoryResult) scheduleQuickActions(entry);
                    }}
                    onPointerUp={cancelQuickActionsSchedule}
                    onPointerLeave={cancelQuickActionsSchedule}
                    onPointerCancel={cancelQuickActionsSchedule}
                    onClick={() => {
                      cancelQuickActionsSchedule();
                      handleSelectThread(entry);
                    }}
                  >
                    <span className={waStyles.threadAvatarWrap}>
                      <span className={waStyles.avatar}>
                        {entry.user.avatarUrl ? (
                          <NextImage
                            src={entry.user.avatarUrl}
                            alt={displayName}
                            width={56}
                            height={56}
                            unoptimized
                          />
                        ) : (
                          initialsFor(displayName)
                        )}
                      </span>
                    </span>
                    <span className={waStyles.threadMeta}>
                      <span className={waStyles.threadTop}>
                        <span className={waStyles.threadTitle}>{displayName}</span>
                        <span className={waStyles.threadTime}>
                          {formatShortTime(entry.thread.lastMessageAt)}
                        </span>
                      </span>
                      <span className={waStyles.threadSubtitleLine}>{subtitle}</span>
                      <span className={waStyles.threadPreviewLine}>
                        <span>{preview}</span>
                        {unread > 0 ? (
                          <span className={waStyles.unreadBadge}>{unread > 99 ? "99+" : unread}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section
          className={classNames(
            waStyles.chatPanel,
            isMobileSupport && !showChatPanel && supportStyles.paneHiddenMobile,
            isMobileSupport && showChatPanel && supportStyles.paneVisibleMobile,
          )}
        >
          <header className={waStyles.conversationHeader}>
            {isMobileSupport ? (
              <button
                type="button"
                className={waStyles.mobileBack}
                onClick={() => setMobileChatOpen(false)}
                aria-label="Voltar para conversas"
              >
                <IconArrowLeft size={20} />
              </button>
            ) : null}
            {conversationLoading ? (
              <div className={waStyles.chatIdentity}>
                <Spinner animation="border" size="sm" />
                <span>Carregando conversa...</span>
              </div>
            ) : conversation ? (
              <>
                <button
                  type="button"
                  className={classNames(waStyles.chatIdentity, waStyles.chatIdentityClickable)}
                  onClick={() => {
                    const entry = threads.find(
                      (item) =>
                        item.user.id === selected?.userId &&
                        item.thread.whatsappId === selected?.whatsappId,
                    );
                    if (entry) openQuickActions(entry);
                  }}
                  aria-label="Ações do atendimento"
                >
                  <span className={classNames(waStyles.avatar, waStyles.chatAvatar)}>
                    {conversation.user?.avatarUrl ? (
                      <NextImage
                        src={conversation.user.avatarUrl}
                        alt={customerDisplayName}
                        width={42}
                        height={42}
                        unoptimized
                      />
                    ) : (
                      initialsFor(customerDisplayName)
                    )}
                  </span>
                  <span className={waStyles.chatTitleBlock}>
                    <strong>{customerDisplayName}</strong>
                    <small>
                      {conversation.user?.email ||
                        conversation.thread.displayWhatsappId ||
                        conversation.thread.whatsappId ||
                        "-"}
                    </small>
                  </span>
                </button>
                <div className={waStyles.chatActions}>
                  {!conversation.thread.isAdminThread ? (
                    <span
                      className={classNames(
                        waStyles.balanceChip,
                        !conversation.thread.within24h && waStyles.conversationKindChip,
                      )}
                    >
                      {conversation.thread.within24h
                        ? `${conversation.thread.minutesLeft24h} min`
                        : "Janela expirada"}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={waStyles.headerIconButton}
                    onClick={() => {
                      const entry = threads.find(
                        (item) =>
                          item.user.id === selected?.userId &&
                          item.thread.whatsappId === selected?.whatsappId,
                      );
                      if (entry) openQuickActions(entry);
                    }}
                    aria-label="Mais ações"
                  >
                    <IconDotsVertical size={18} />
                  </button>
                </div>
              </>
            ) : (
              <div className={waStyles.chatIdentity}>
                <span className={classNames(waStyles.avatar, waStyles.chatAvatar)}>SB</span>
                <span className={waStyles.chatTitleBlock}>
                  <strong>Selecione um atendimento</strong>
                  <small>Escolha uma conversa na lista ao lado</small>
                </span>
              </div>
            )}
          </header>

          {conversationError ? (
            <FloatingAlert
              feedback={{ type: "danger", message: conversationError }}
              onClose={() => setConversationError(null)}
            />
          ) : null}

          {conversation ? (
            <>
              <div ref={conversationRef} className={waStyles.messages}>
                {conversation.messages.length === 0 ? (
                  <div className={waStyles.noticePill}>
                    Ainda não há mensagens registradas neste atendimento.
                  </div>
                ) : (
                  conversation.messages.map((message) => {
                    const isTeamMessage =
                      message.senderRole === "admin" || message.senderRole === "system";
                    const mediaPreview = renderSupportMedia(message.media ?? null, isTeamMessage);
                    return (
                      <div
                        key={message.id}
                        className={classNames(
                          waStyles.bubbleRow,
                          isTeamMessage ? waStyles.bubbleRowOutbound : waStyles.bubbleRowInbound,
                        )}
                      >
                        <div
                          className={classNames(
                            waStyles.bubble,
                            isTeamMessage ? waStyles.bubbleOutbound : waStyles.bubbleInbound,
                          )}
                        >
                          {mediaPreview}
                          {message.text ? <div className={waStyles.messageText}>{message.text}</div> : null}
                          {!message.text && !mediaPreview ? (
                            <div className={waStyles.messageText}>
                              Mensagem do tipo {message.messageType}
                            </div>
                          ) : null}
                          <time className={waStyles.messageTime}>{formatDateTime(message.timestamp)}</time>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form
                className={supportStyles.supportComposerShell}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSendMessage();
                }}
              >
                {!conversation.thread.isAdminThread && !conversation.thread.within24h ? (
                  <p className={supportStyles.supportComposerNotice}>
                    Janela de 24h da Meta expirada. Você ainda pode registrar a resposta no painel.
                  </p>
                ) : null}
                {feedback ? (
                  <div className={supportStyles.supportComposerFeedback}>
                    <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />
                  </div>
                ) : null}
                {file ? (
                  <div className={supportStyles.supportPendingFile}>
                    <span className={supportStyles.supportPendingFilePreview}>
                      <IconPaperclip size={20} />
                    </span>
                    <span className={supportStyles.supportPendingFileMeta}>
                      <strong>{file.name}</strong>
                      <small>{file.type || "Arquivo anexado"}</small>
                    </span>
                    <button
                      type="button"
                      className={supportStyles.supportPendingFileRemove}
                      onClick={() => setFile(null)}
                      aria-label="Remover arquivo"
                    >
                      <IconX size={16} />
                    </button>
                  </div>
                ) : null}
                <div className={supportStyles.supportComposer}>
                  <label className={supportStyles.supportComposerAttach} aria-label="Anexar arquivo">
                    <IconPaperclip size={22} />
                    <input
                      type="file"
                      disabled={sending}
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <div className={supportStyles.supportComposerField}>
                    <input
                      className={supportStyles.supportComposerInput}
                      value={messageText}
                      onChange={(event) => setMessageText(event.currentTarget.value)}
                      disabled={sending}
                      placeholder={
                        conversation.thread.isAdminThread || conversation.thread.within24h
                          ? "Digite uma mensagem"
                          : "Digite para registrar no painel"
                      }
                    />
                  </div>
                  <button
                    type="submit"
                    className={supportStyles.supportComposerSend}
                    disabled={messageSendDisabled}
                    aria-label="Enviar mensagem"
                  >
                    {sending ? <Spinner animation="border" size="sm" /> : <IconSend size={20} />}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className={supportStyles.emptyChat}>
              <strong>Nenhuma conversa selecionada</strong>
              <span>Escolha um atendimento na lista para visualizar e responder.</span>
            </div>
          )}
        </section>
      </div>

      {quickActionEntry ? (
        <div
          className={botStyles.quickActionBackdrop}
          onClick={() => setQuickActionEntry(null)}
          role="presentation"
        >
          <section
            className={botStyles.quickActionSheet}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Ações do atendimento"
          >
            <div className={botStyles.quickActionHandle} />
            <header className={botStyles.quickActionHeader}>
              <div>
                <strong>Ações do atendimento</strong>
                <span>Gerencie o usuário sem sair da conversa</span>
              </div>
              <button
                type="button"
                className={waStyles.headerIconButton}
                onClick={() => setQuickActionEntry(null)}
                aria-label="Fechar"
              >
                <IconX size={16} />
              </button>
            </header>
            <div className={supportStyles.sheetUserCard}>
              <strong>{getDisplayName(quickActionEntry)}</strong>
              <small>
                {quickActionEntry.user.email ||
                  quickActionEntry.user.whatsappNumber ||
                  `Usuário #${quickActionEntry.user.id}`}
              </small>
            </div>
            <div className={supportStyles.modalActionGrid}>
              <button
                type="button"
                className={supportStyles.modalActionCard}
                onClick={() => startEditUser(quickActionEntry)}
              >
                <span className={supportStyles.modalActionIcon}>
                  <IconUser size={20} />
                </span>
                <span className={supportStyles.modalActionText}>
                  <strong>Editar usuário</strong>
                  <small>Nome, e-mail, senha e saldo</small>
                </span>
              </button>
              <button
                type="button"
                className={supportStyles.modalActionCard}
                onClick={() => void openPlanModalFromSupport(quickActionEntry)}
              >
                <span className={classNames(supportStyles.modalActionIcon, supportStyles.modalActionIconSky)}>
                  <IconWallet size={20} />
                </span>
                <span className={supportStyles.modalActionText}>
                  <strong>Editar plano</strong>
                  <small>Assinatura, status e vencimento</small>
                </span>
              </button>
              <button
                type="button"
                className={supportStyles.modalActionCard}
                disabled={quickActionBusy === "impersonate"}
                onClick={() => void handleImpersonateUser(quickActionEntry)}
              >
                <span className={classNames(supportStyles.modalActionIcon, supportStyles.modalActionIconViolet)}>
                  <IconUserCircle size={20} />
                </span>
                <span className={supportStyles.modalActionText}>
                  <strong>
                    {quickActionBusy === "impersonate" ? "Entrando..." : "Entrar como usuário"}
                  </strong>
                  <small>Abrir painel do lojista</small>
                </span>
              </button>
              <button
                type="button"
                className={supportStyles.modalActionCard}
                onClick={() => openProfilesModalFromSupport(quickActionEntry)}
              >
                <span className={supportStyles.modalActionIcon}>
                  <IconUsersGroup size={20} />
                </span>
                <span className={supportStyles.modalActionText}>
                  <strong>Perfis e grupos</strong>
                  <small>WhatsApps e permissões avançadas</small>
                </span>
              </button>
              <button
                type="button"
                className={classNames(supportStyles.modalActionCard, supportStyles.modalActionCardDanger)}
                onClick={() => {
                  setQuickActionEntry(null);
                  setConfirmModal("delete");
                }}
              >
                <span className={classNames(supportStyles.modalActionIcon, supportStyles.modalActionIconDanger)}>
                  <IconTrash size={20} />
                </span>
                <span className={supportStyles.modalActionText}>
                  <strong>Remover conversa</strong>
                  <small>Apagar histórico deste atendimento</small>
                </span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editUserEntry && !planModalOpen && !profilesModalOpen ? (
        <div
          className={supportStyles.adminModalOverlay}
          onClick={closeSupportDialogs}
          role="presentation"
        >
          <section
            className={supportStyles.adminModal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Editar usuário"
          >
            <header className={supportStyles.adminModalHeader}>
              <div>
                <strong>Editar usuário</strong>
                <small>{getDisplayName(editUserEntry)}</small>
              </div>
              <button
                type="button"
                className={waStyles.headerIconButton}
                onClick={closeSupportDialogs}
                aria-label="Fechar"
              >
                <IconX size={18} />
              </button>
            </header>
            <div className={supportStyles.adminModalBody}>
              <div className={supportStyles.editForm}>
                <div className={supportStyles.modalField}>
                  <span className={supportStyles.modalFieldLabel}>Nome completo</span>
                  <input
                    className={supportStyles.modalFieldInput}
                    value={editUserForm.name}
                    onChange={(event) =>
                      setEditUserForm((current) => ({ ...current, name: event.currentTarget.value }))
                    }
                  />
                </div>
                <div className={supportStyles.modalField}>
                  <span className={supportStyles.modalFieldLabel}>E-mail</span>
                  <input
                    className={supportStyles.modalFieldInput}
                    type="email"
                    value={editUserForm.email}
                    onChange={(event) =>
                      setEditUserForm((current) => ({ ...current, email: event.currentTarget.value }))
                    }
                  />
                </div>
                <div className={supportStyles.modalField}>
                  <span className={supportStyles.modalFieldLabel}>Nova senha</span>
                  <input
                    className={supportStyles.modalFieldInput}
                    type="password"
                    value={editUserForm.password}
                    placeholder="Preencha somente se for redefinir"
                    onChange={(event) =>
                      setEditUserForm((current) => ({ ...current, password: event.currentTarget.value }))
                    }
                  />
                </div>
                <div className={supportStyles.editFormRow}>
                  <div className={supportStyles.modalField}>
                    <span className={supportStyles.modalFieldLabel}>Saldo</span>
                    <input
                      className={supportStyles.modalFieldInput}
                      inputMode="decimal"
                      value={editUserForm.balance}
                      placeholder="Manter saldo atual"
                      onChange={(event) =>
                        setEditUserForm((current) => ({ ...current, balance: event.currentTarget.value }))
                      }
                    />
                  </div>
                  <div className={supportStyles.modalField}>
                    <span className={supportStyles.modalFieldLabel}>Função</span>
                    <div className={supportStyles.modalOptionPills} role="group" aria-label="Função do usuário">
                      {(
                        [
                          { value: "user", label: "Usuário" },
                          { value: "admin", label: "Admin" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={classNames(
                            supportStyles.modalOptionPill,
                            editUserForm.role === option.value && supportStyles.modalOptionPillActive,
                          )}
                          onClick={() =>
                            setEditUserForm((current) => ({ ...current, role: option.value }))
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={supportStyles.modalToggleRow}
                  onClick={() =>
                    setEditUserForm((current) => ({ ...current, isActive: !current.isActive }))
                  }
                >
                  <span>
                    <strong>Conta ativa</strong>
                    <small>Permite login e uso normal da plataforma</small>
                  </span>
                  <span
                    className={classNames(
                      supportStyles.modalToggleSwitch,
                      editUserForm.isActive && supportStyles.modalToggleSwitchOn,
                    )}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className={supportStyles.modalToggleRow}
                  onClick={() =>
                    setEditUserForm((current) => ({
                      ...current,
                      revokeSessions: !current.revokeSessions,
                    }))
                  }
                >
                  <span>
                    <strong>Encerrar sessões ao salvar</strong>
                    <small>Desconecta dispositivos logados deste usuário</small>
                  </span>
                  <span
                    className={classNames(
                      supportStyles.modalToggleSwitch,
                      editUserForm.revokeSessions && supportStyles.modalToggleSwitchOn,
                    )}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <footer className={supportStyles.adminModalFooter}>
              <button
                type="button"
                className={supportStyles.adminModalBtnGhost}
                onClick={closeSupportDialogs}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={supportStyles.adminModalBtn}
                disabled={quickActionBusy === "edit-user"}
                onClick={() => void saveEditedUser()}
              >
                {quickActionBusy === "edit-user" ? "Salvando..." : "Salvar usuário"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {planModalOpen && editUserEntry ? (
        <div
          className={supportStyles.adminModalOverlay}
          onClick={closeSupportDialogs}
          role="presentation"
        >
          <section
            className={classNames(supportStyles.adminModal, supportStyles.adminModalWide)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Editar plano"
          >
            <header className={supportStyles.adminModalHeader}>
              <div>
                <strong>Editar plano</strong>
                <small>{getDisplayName(editUserEntry)}</small>
              </div>
              <button
                type="button"
                className={waStyles.headerIconButton}
                onClick={closeSupportDialogs}
                aria-label="Fechar"
              >
                <IconX size={18} />
              </button>
            </header>
            <div className={supportStyles.adminModalBody}>
              {planModalLoading ? (
                <div className="d-flex justify-content-center py-3">
                  <Spinner animation="border" size="sm" />
                </div>
              ) : (
                <>
                  {planModalError ? (
                    <div className={classNames(supportStyles.modalAlert, supportStyles.modalAlertDanger)}>
                      {planModalError}
                    </div>
                  ) : null}
                  <div className={supportStyles.modalField}>
                    <span className={supportStyles.modalFieldLabel}>Plano</span>
                    <select
                      className={supportStyles.modalFieldSelect}
                      value={planForm.planId}
                      onChange={(event) =>
                        setPlanForm((current) => ({ ...current, planId: event.currentTarget.value }))
                      }
                    >
                      <option value="">Selecione um plano</option>
                      {planOptions.map((plan) => (
                        <option key={plan.id} value={String(plan.id)}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={supportStyles.modalField}>
                    <span className={supportStyles.modalFieldLabel}>Status da assinatura</span>
                    <div
                      className={supportStyles.modalOptionPills}
                      role="group"
                      aria-label="Status da assinatura"
                    >
                      {PLAN_STATUS_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={classNames(
                            supportStyles.modalOptionPill,
                            PLAN_STATUS_PILL_TONES[option.tone],
                            planForm.status === option.value && supportStyles.modalOptionPillActive,
                          )}
                          onClick={() =>
                            setPlanForm((current) => ({
                              ...current,
                              status: option.value as PlanStatusValue,
                            }))
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={supportStyles.modalField}>
                    <span className={supportStyles.modalFieldLabel}>Vencimento</span>
                    <input
                      className={supportStyles.modalFieldInput}
                      type="datetime-local"
                      value={planForm.periodEnd}
                      onChange={(event) =>
                        setPlanForm((current) => ({
                          ...current,
                          periodEnd: event.currentTarget.value,
                        }))
                      }
                    />
                  </div>
                </>
              )}
            </div>
            <footer className={supportStyles.adminModalFooter}>
              <button
                type="button"
                className={supportStyles.adminModalBtnGhost}
                onClick={closeSupportDialogs}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={supportStyles.adminModalBtn}
                disabled={planModalSaving || planModalLoading}
                onClick={() => void saveSupportPlan()}
              >
                {planModalSaving ? "Salvando..." : "Salvar plano"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {profilesModalOpen && editUserEntry ? (
        <div
          className={supportStyles.adminModalOverlay}
          onClick={closeSupportDialogs}
          role="presentation"
        >
          <section
            className={classNames(supportStyles.adminModal, supportStyles.adminModalWide)}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Perfis e grupos"
          >
            <header className={supportStyles.adminModalHeader}>
              <div>
                <strong>Perfis e grupos</strong>
                <small>{getDisplayName(editUserEntry)}</small>
              </div>
              <button
                type="button"
                className={waStyles.headerIconButton}
                onClick={closeSupportDialogs}
                aria-label="Fechar"
              >
                <IconX size={18} />
              </button>
            </header>
            <div className={supportStyles.adminModalBody}>
              <div className={supportStyles.modalTabBar} role="tablist" aria-label="Seções do atendimento">
                <button
                  type="button"
                  role="tab"
                  aria-selected={profilesModalTab === "instances"}
                  className={classNames(
                    supportStyles.modalTab,
                    profilesModalTab === "instances" && supportStyles.modalTabActive,
                  )}
                  onClick={() => setProfilesModalTab("instances")}
                >
                  Perfis WhatsApp ({supportUserInstances.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={profilesModalTab === "groups"}
                  className={classNames(
                    supportStyles.modalTab,
                    profilesModalTab === "groups" && supportStyles.modalTabActive,
                  )}
                  onClick={() => setProfilesModalTab("groups")}
                >
                  Grupos ({supportUserGroups.length})
                </button>
              </div>

              {profilesModalError ? (
                <div className={classNames(supportStyles.modalAlert, supportStyles.modalAlertDanger)}>
                  {profilesModalError}
                </div>
              ) : null}

              {profilesModalLoading ? (
                <div className="d-flex justify-content-center py-4">
                  <Spinner animation="border" size="sm" />
                </div>
              ) : profilesModalTab === "instances" ? (
                supportUserInstances.length === 0 ? (
                  <p className={supportStyles.modalIntro}>
                    Este usuário ainda não possui perfis WhatsApp cadastrados.
                  </p>
                ) : (
                  <div className={supportStyles.modalEntityList}>
                    {supportUserInstances.map((instance) => {
                      const isRenaming = supportInstanceRenameId === instance.id;
                      const isBusy =
                        profilesModalBusy === `rename-${instance.id}` ||
                        profilesModalBusy === `status-${instance.id}`;
                      return (
                        <article key={instance.id} className={supportStyles.modalEntityCard}>
                          <div className={supportStyles.modalEntityMain}>
                            {isRenaming ? (
                              <input
                                className={supportStyles.modalFieldInput}
                                value={supportInstanceRenameValue}
                                onChange={(event) =>
                                  setSupportInstanceRenameValue(event.currentTarget.value)
                                }
                                autoFocus
                              />
                            ) : (
                              <>
                                <strong>{instance.name}</strong>
                                <small>{instance.phone}</small>
                              </>
                            )}
                            <span
                              className={classNames(
                                supportStyles.modalStatusChip,
                                instance.sessionStatus === "conectado"
                                  ? supportStyles.modalStatusChipSuccess
                                  : supportStyles.modalStatusChipMuted,
                              )}
                            >
                              {supportInstanceStatusLabel(instance.sessionStatus)}
                            </span>
                          </div>
                          <div className={supportStyles.modalEntityActions}>
                            {isRenaming ? (
                              <>
                                <button
                                  type="button"
                                  className={supportStyles.adminModalBtn}
                                  disabled={profilesModalBusy === `rename-${instance.id}`}
                                  onClick={() => void saveSupportInstanceRename()}
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  className={supportStyles.adminModalBtnGhost}
                                  onClick={() => {
                                    setSupportInstanceRenameId(null);
                                    setSupportInstanceRenameValue("");
                                  }}
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={supportStyles.adminModalBtnGhost}
                                  disabled={Boolean(isBusy)}
                                  onClick={() => {
                                    setSupportInstanceRenameId(instance.id);
                                    setSupportInstanceRenameValue(instance.name);
                                  }}
                                >
                                  Renomear
                                </button>
                                <button
                                  type="button"
                                  className={supportStyles.adminModalBtnGhost}
                                  disabled={profilesModalBusy === `status-${instance.id}`}
                                  onClick={() => void refreshSupportInstanceStatus(instance.id)}
                                >
                                  {profilesModalBusy === `status-${instance.id}`
                                    ? "Atualizando..."
                                    : "Atualizar status"}
                                </button>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )
              ) : supportUserGroups.length === 0 ? (
                <p className={supportStyles.modalIntro}>Nenhum grupo vinculado a este usuário.</p>
              ) : (
                <div className={supportStyles.modalEntityList}>
                  {supportUserGroups.map((group) => (
                    <article key={group.id} className={supportStyles.modalEntityCard}>
                      <div className={supportStyles.modalEntityMain}>
                        <strong>{group.name || "Grupo sem nome"}</strong>
                        <small>
                          {group.remoteId || "Sem ID remoto"}
                          {group.slot > 0 ? ` · Slot ${group.slot}` : ""}
                        </small>
                        <span
                          className={classNames(
                            supportStyles.modalStatusChip,
                            group.status === "active"
                              ? supportStyles.modalStatusChipSuccess
                              : supportStyles.modalStatusChipMuted,
                          )}
                        >
                          {group.status === "active" ? "Ativo" : "Desativado"}
                        </span>
                      </div>
                      <div className={supportStyles.modalEntityActions}>
                        <button
                          type="button"
                          className={supportStyles.modalToggleRow}
                          disabled={profilesModalBusy === `group-${group.id}`}
                          onClick={() => void toggleSupportGroupStatus(group)}
                        >
                          <span>
                            <strong>{group.status === "active" ? "Grupo ativo" : "Grupo inativo"}</strong>
                            <small>Toque para alternar o status</small>
                          </span>
                          <span
                            className={classNames(
                              supportStyles.modalToggleSwitch,
                              group.status === "active" && supportStyles.modalToggleSwitchOn,
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
            <footer className={supportStyles.adminModalFooter}>
              <button
                type="button"
                className={supportStyles.adminModalBtnGhost}
                onClick={() => void loadSupportProfilesData(editUserEntry.user.id)}
                disabled={profilesModalLoading}
              >
                Atualizar lista
              </button>
              <button
                type="button"
                className={supportStyles.adminModalBtnGhost}
                onClick={closeSupportDialogs}
              >
                Fechar
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {confirmModal ? (
        <div
          className={supportStyles.adminModalOverlay}
          onClick={() => setConfirmModal(null)}
          role="presentation"
        >
          <section
            className={supportStyles.adminModal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar ação"
          >
            <header className={supportStyles.adminModalHeader}>
              <div className="d-flex align-items-center gap-3">
                <span
                  className={classNames(
                    supportStyles.confirmIcon,
                    confirmModal === "delete" && supportStyles.confirmIconDanger,
                  )}
                >
                  <IconTrash size={22} />
                </span>
                <div>
                  <strong>Remover conversa</strong>
                  <small>Esta ação remove o histórico deste atendimento.</small>
                </div>
              </div>
            </header>
            <footer className={supportStyles.adminModalFooter}>
              <button
                type="button"
                className={supportStyles.adminModalBtnGhost}
                onClick={() => setConfirmModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={
                  confirmModal === "delete"
                    ? supportStyles.adminModalBtnDanger
                    : supportStyles.adminModalBtn
                }
                onClick={() => {
                  setConfirmModal(null);
                  void handleDeleteThread();
                }}
              >
                Confirmar
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
export default AdminSupportCenter;
