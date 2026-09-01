"use client";

import { useCallback, useEffect, useMemo, useRef, useState, FormEvent } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { io, Socket } from "socket.io-client";
import NextImage from "next/image";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Image,
  Modal,
  Offcanvas,
  Row,
  Spinner,
} from "react-bootstrap";
import {
  IconMicrophone,
  IconMoodSmile,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconTrash,
} from "@tabler/icons-react";

type ThreadSummary = {
  whatsappId: string;
  customerName: string | null;
  profileName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  status: "open" | "closed";
  within24h: boolean;
  minutesLeft24h: number;
  handlingMode: "bot" | "human";
  reminderSentAt: string | null;
  displayWhatsappId?: string | null;
  isAdminThread?: boolean;
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
  thread: {
    whatsappId: string;
    customerName: string | null;
    profileName: string | null;
    status: "open" | "closed";
    handlingMode: "bot" | "human";
    lastMessageAt: string | null;
    lastMessagePreview?: string | null;
    displayWhatsappId?: string | null;
  };
  messages: SupportMessage[];
  within24h: boolean;
  minutesLeft24h: number;
};

type PendingMedia = {
  file: File;
  previewUrl: string;
  mediaType: "image" | "video" | "audio" | "document" | "sticker";
};

type LoadConversationResult = {
  ok: boolean;
  status?: number;
  message?: string;
};

type UserConversationsClientProps = {
  hideThreadList?: boolean;
  initialThreadId?: string | null;
  onRequestClose?: () => void;
  refreshKey?: number;
};

type InteractiveButtonState = {
  id: string;
  title: string;
};

type SocketMessageEvent = {
  whatsappId: string;
  message: SupportMessage;
};

const RAW_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const BASE_PREFIX = RAW_BASE_PATH && RAW_BASE_PATH !== "/"
  ? (RAW_BASE_PATH.startsWith("/") ? RAW_BASE_PATH : `/${RAW_BASE_PATH}`)
  : "";
const SOCKET_PATH = `${BASE_PREFIX}/api/socket/io`;
const SSE_PATH = `${BASE_PREFIX}/api/support/stream`;
const SITE_PUBLIC_SETTINGS_ENDPOINT = `${BASE_PREFIX}/api/public/site`;

const inferMediaTypeFromFile = (file: File): PendingMedia["mediaType"] => {
  const type = file.type.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "image/webp") return "sticker";
  return "document";
};

const mediaUrlFromId = (mediaId: string) => `/api/support/media/${encodeURIComponent(mediaId)}`;

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

const formatAudioTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const AudioMessagePlayer = ({
  src,
  mimeType,
  outbound,
}: {
  src: string;
  mimeType?: string | null;
  outbound: boolean;
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const syncProgress = () => {
      setCurrentTime(audio.currentTime);
      const ratio = audio.duration > 0 ? Math.min(Math.max(audio.currentTime / audio.duration, 0), 1) : 0;
      progressRef.current?.style.setProperty("--support-audio-progress", `${ratio * 100}%`);
    };
    const loaded = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      syncProgress();
    };
    const ended = () => {
      setPlaying(false);
      setCurrentTime(0);
      progressRef.current?.style.setProperty("--support-audio-progress", "0%");
    };

    audio.addEventListener("loadedmetadata", loaded);
    audio.addEventListener("timeupdate", syncProgress);
    audio.addEventListener("ended", ended);
    return () => {
      audio.removeEventListener("loadedmetadata", loaded);
      audio.removeEventListener("timeupdate", syncProgress);
      audio.removeEventListener("ended", ended);
    };
  }, [src]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  return (
    <>
      <div className={`support-audio-player ${outbound ? "support-audio-player--out" : ""}`}>
        <button type="button" onClick={toggle} aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}>
          {playing ? <IconPlayerPauseFilled size={18} /> : <IconPlayerPlayFilled size={18} />}
        </button>
        <div className="support-audio-player__body">
          <div ref={progressRef} className="support-audio-player__track">
            <span />
          </div>
          <div className="support-audio-player__time">
            <span>{formatAudioTime(currentTime)}</span>
            <span>{duration > 0 ? formatAudioTime(duration) : "--:--"}</span>
          </div>
        </div>
        <audio ref={audioRef} src={src} preload="metadata">
          {mimeType ? <source src={src} type={mimeType} /> : null}
        </audio>
      </div>
      <style jsx>{`
        .support-audio-player {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          min-width: 220px;
          max-width: 330px;
          border-radius: 999px;
          padding: 0.5rem 0.75rem;
          background: #f1f5f9;
          color: #0f172a;
        }
        .support-audio-player--out {
          background: rgba(255, 255, 255, 0.18);
          color: #fff;
        }
        .support-audio-player button {
          width: 36px;
          height: 36px;
          border: 0;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #0aa885;
          color: #fff;
          flex: 0 0 auto;
        }
        .support-audio-player--out button {
          background: #fff;
          color: #057a5f;
        }
        .support-audio-player__body {
          min-width: 0;
          flex: 1 1 auto;
        }
        .support-audio-player__track {
          position: relative;
          height: 4px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(100, 116, 139, 0.28);
        }
        .support-audio-player__track span {
          position: absolute;
          inset: 0;
          width: var(--support-audio-progress, 0%);
          background: currentColor;
          transition: width 120ms linear;
        }
        .support-audio-player__time {
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
          margin-top: 0.25rem;
          font-size: 0.72rem;
          opacity: 0.78;
        }
      `}</style>
    </>
  );
};

const MediaPreview = ({
  media,
  direction,
}: {
  media: NonNullable<SupportMessage["media"]>;
  direction: "inbound" | "outbound";
}) => {
  const caption = media.caption ?? media.filename ?? null;
  const resolvedUrl = media.mediaUrl || (media.mediaId ? mediaUrlFromId(media.mediaId) : null);

  if (!resolvedUrl) {
    return (
      <span className="text-secondary">
        Arquivo enviado. Atualize a página para visualizar.
      </span>
    );
  }

  switch (media.mediaType) {
    case "image":
      return (
        <div className="d-flex flex-column gap-2">
          <NextImage
            src={resolvedUrl}
            alt={caption ?? "Imagem recebida"}
            width={800}
            height={600}
            className="img-fluid rounded"
            style={{ maxHeight: 260, height: "auto" }}
            unoptimized
          />
          {caption && <span>{caption}</span>}
        </div>
      );
    case "document":
      return (
        <div className="d-flex flex-column gap-2">
          <Button
            as="a"
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant={direction === "outbound" ? "outline-light" : "outline-secondary"}
            size="sm"
            className="text-start"
          >
            Baixar {media.filename ?? "documento"}
          </Button>
          {caption && <span>{caption}</span>}
        </div>
      );
    case "audio":
      if (!resolvedUrl) {
        return <span className="text-secondary">Áudio indisponível.</span>;
      }

      const audioMime =
        media.mimeType ||
        inferMimeTypeFromSource(media.mediaUrl ?? undefined) ||
        inferMimeTypeFromSource(media.filename ?? undefined) ||
        inferMimeTypeFromSource(resolvedUrl) ||
        undefined;

      return (
        <AudioMessagePlayer
          src={resolvedUrl}
          mimeType={audioMime}
          outbound={direction === "outbound"}
        />
      );
    case "video":
      return (
        <div className="d-flex flex-column gap-2">
          <video controls className="w-100" style={{ maxHeight: 260 }}>
            <source src={resolvedUrl} type={media.mimeType ?? undefined} />
            Seu navegador não suporta vídeo.
          </video>
          {caption && <span>{caption}</span>}
        </div>
      );
    case "sticker":
      return (
        <NextImage
          src={resolvedUrl}
          alt="Sticker"
          width={320}
          height={320}
          className="img-fluid"
          style={{ maxHeight: 180, height: "auto" }}
          unoptimized
        />
      );
    default:
      return (
        <Button
          as="a"
          href={resolvedUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant={direction === "outbound" ? "outline-light" : "outline-secondary"}
          size="sm"
          className="text-start"
        >
          Abrir arquivo ({media.mediaType})
        </Button>
      );
  }
};

const formatDateTime = (iso: string | null) => {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch (error) {
    console.error("Failed to format date", error);
    return date.toISOString().replace("T", " ").slice(0, 19);
  }
};

const sortThreads = (threads: ThreadSummary[]) => {
  return [...threads].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "open" ? -1 : 1;
    }
    const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return timeB - timeA;
  });
};

const formatLastMessagePreview = (preview?: string | null, maxLength = 80) => {
  if (!preview) return "Sem mensagens";
  const normalized = preview.replace(/\s+/g, " ").trim();
  if (!normalized) return "Sem mensagens";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const describeMessagePreview = (message: SupportMessage): string => {
  const text = typeof message.text === "string" ? message.text.trim() : "";
  if (text) {
    return text;
  }

  const caption = message.media?.caption;
  if (typeof caption === "string" && caption.trim()) {
    return caption.trim();
  }

  switch (message.messageType) {
    case "image":
      return "📷 Imagem recebida";
    case "video":
      return "🎞️ Vídeo recebido";
    case "audio":
      return "🎧 Áudio recebido";
    case "document":
      return message.media?.filename ? `📄 ${message.media.filename}` : "📄 Documento recebido";
    case "sticker":
      return "😊 Figurinha recebida";
    case "interactive":
      return "🧩 Interação recebida";
    default:
      return "Nova mensagem";
  }
};

const formatRecordingElapsed = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const SUPPORT_FALLBACK_ID = "__admin__";
const LAST_THREAD_STORAGE_KEY = "support:last-thread-id";

const UserConversationsClient = ({
  hideThreadList = false,
  initialThreadId = null,
  onRequestClose,
  refreshKey = 0,
}: UserConversationsClientProps) => {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(
    hideThreadList ? SUPPORT_FALLBACK_ID : null,
  );
  const [conversation, setConversation] = useState<ConversationPayload | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);

  const [messageDraft, setMessageDraft] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileContactsOpen, setMobileContactsOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "danger"; message: string } | null>(null);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [brand, setBrand] = useState<{ siteName: string; logoUrl: string | null } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingMediaRef = useRef<PendingMedia[]>([]);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const conversationThreadIdRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeThreadRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const isMobileViewportRef = useRef(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const autoScrollRef = useRef(true);
  const sseRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const fallbackAttemptKeyRef = useRef<number | null>(null);

  const [showInteractiveModal, setShowInteractiveModal] = useState(false);
  const [interactiveType, setInteractiveType] = useState<"buttons" | "cta_url">("buttons");
  const [interactiveButtons, setInteractiveButtons] = useState<Array<InteractiveButtonState>>([
    { id: "btn_1", title: "Sim" },
    { id: "btn_2", title: "Não" },
  ]);
  const [interactiveBody, setInteractiveBody] = useState("Posso ajudar com algo?");
  const [interactiveFooter, setInteractiveFooter] = useState("");
  const [interactiveHeader, setInteractiveHeader] = useState("");
  const [interactiveUrl, setInteractiveUrl] = useState("https://");
  const [interactiveButtonText, setInteractiveButtonText] = useState("Abrir link");
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const unreadCountsRef = useRef<Record<string, number>>({});

  const updateUnreadCounts = useCallback(
    (updater: (prev: Record<string, number>) => Record<string, number>) => {
      setUnreadCounts((prev) => {
        const next = updater(prev);
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem("support-unread-counts", JSON.stringify(next));
            window.dispatchEvent(
              new CustomEvent("support:unread-counts", { detail: { counts: next } }),
            );
          } catch {
            // ignore storage failures
          }
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 991.98px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);
    isMobileViewportRef.current = mediaQuery.matches;

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    isMobileViewportRef.current = isMobileViewport;
  }, [isMobileViewport]);

  useEffect(() => {
    if (hideThreadList) {
      setMobileContactsOpen(false);
      return;
    }
    if (!isMobileViewport) {
      setMobileContactsOpen(false);
    }
  }, [hideThreadList, isMobileViewport]);

  useEffect(() => {
    if (hideThreadList) {
      setMobileContactsOpen(false);
      return;
    }
    if (!selectedId) {
      setMobileContactsOpen(false);
    }
  }, [hideThreadList, selectedId]);

  useEffect(() => {
    if (!hideThreadList && isMobileViewport && threads.length > 0 && !selectedId) {
      setMobileContactsOpen(true);
    }
  }, [hideThreadList, isMobileViewport, selectedId, threads.length]);

  useEffect(() => {
    fallbackAttemptKeyRef.current = null;
  }, [refreshKey]);

  useEffect(() => {
    unreadCountsRef.current = unreadCounts;
  }, [unreadCounts]);
  const loadThreads = useCallback(async () => {
    try {
      setLoadingThreads(true);
      setThreadsError(null);
      const res = await fetch("/api/support/threads", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? "Não foi possível carregar as conversas.");
      }
      const list: ThreadSummary[] = Array.isArray(data?.threads) ? data.threads : [];
      setThreads(sortThreads(list));
    } catch (error) {
      console.error(error);
      setThreadsError(error instanceof Error ? error.message : "Erro ao carregar conversas.");
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  const fetchConversationPayload = useCallback(async (whatsappId: string) => {
    const res = await fetch(`/api/support/threads/${encodeURIComponent(whatsappId)}`, {
      cache: "no-store",
    });
    let parsed: unknown = null;
    let isJson = false;
    try {
      parsed = await res.json();
      isJson = true;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const message =
        isJson &&
        parsed &&
        typeof parsed === "object" &&
        parsed !== null &&
        "message" in parsed &&
        typeof (parsed as { message?: unknown }).message === "string"
          ? (parsed as { message: string }).message
          : "Não foi possível carregar a conversa.";
      const error = new Error(message) as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
    if (!isJson || parsed === null) {
      const error = new Error("Não foi possível carregar a conversa.") as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
    return parsed as ConversationPayload;
  }, []);

  const loadConversation = useCallback(
    async (
      whatsappId: string,
      options?: { suppressError?: boolean },
    ): Promise<LoadConversationResult> => {
      setConversationError(null);
      setLoadingConversation(true);
      try {
        const data = await fetchConversationPayload(whatsappId);
        setConversation(data);
        return { ok: true, status: 200 };
      } catch (error) {
        let status: number | undefined;
        if (error && typeof error === "object" && "status" in error) {
          const candidate = (error as { status?: number }).status;
          if (typeof candidate === "number") {
            status = candidate;
          }
        }
        const message =
          error instanceof Error ? error.message : "Erro ao carregar a conversa.";
        if (!(options?.suppressError && status === 404)) {
          console.error(error);
        }
        if (!options?.suppressError) {
          setConversationError(message);
          setConversation(null);
        }
        return { ok: false, status, message };
      } finally {
        setLoadingConversation(false);
      }
    },
    [fetchConversationPayload],
  );

  const loadFallbackConversation = useCallback(async () => {
    if (fallbackAttemptKeyRef.current === refreshKey) {
      return;
    }
    fallbackAttemptKeyRef.current = refreshKey;
    const result = await loadConversation(SUPPORT_FALLBACK_ID, { suppressError: true });
    if (!result.ok) {
      if (result.status === 404) {
        setConversation({
          thread: {
            whatsappId: SUPPORT_FALLBACK_ID,
            customerName: brand?.siteName ? `Equipe ${brand.siteName}` : "Equipe de suporte",
            profileName: null,
            status: "open",
            handlingMode: "human",
            lastMessageAt: null,
            lastMessagePreview: null,
            displayWhatsappId: null,
          },
          messages: [],
          within24h: true,
          minutesLeft24h: 24 * 60,
        });
        setConversationError(null);
      } else if (result.message) {
        setConversationError(result.message);
      }
    } else {
      setConversationError(null);
    }
  }, [brand?.siteName, loadConversation, refreshKey]);

  const applyIncomingMessage = useCallback(
    (payload: SocketMessageEvent) => {
      let threadFound = false;

      setThreads((prev) => {
        const index = prev.findIndex((item) => item.whatsappId === payload.whatsappId);
        if (index === -1) {
          return prev;
        }
        threadFound = true;
        const next = [...prev];
        next[index] = {
          ...next[index],
          lastMessageAt: payload.message.timestamp,
          lastMessagePreview: describeMessagePreview(payload.message),
        };
        return sortThreads(next);
      });

      if (!threadFound) {
        void loadThreads();
      }

      const isActiveThread = selectedIdRef.current === payload.whatsappId;
      const isPageVisible = typeof document === "undefined" || document.visibilityState !== "hidden";
      const conversationVisible = isActiveThread && isPageVisible;

      if (payload.message.direction === "inbound" && !conversationVisible) {
        updateUnreadCounts((prev) => ({
          ...prev,
          [payload.whatsappId]: (prev[payload.whatsappId] ?? 0) + 1,
        }));

        if (isMobileViewportRef.current && !hideThreadList) {
          setMobileContactsOpen(true);
        }
      }
    },
    [hideThreadList, loadThreads, updateUnreadCounts],
  );

  useEffect(() => {
    setLoadingThreads(true);
    loadThreads().catch(() => {
      // errors handled inside loadThreads
    });
  }, [loadThreads, refreshKey]);

  const startPollingFallback = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (pollIntervalRef.current !== null) {
      return;
    }
    pollIntervalRef.current = window.setInterval(() => {
      void loadThreads();
      const current = selectedIdRef.current;
      if (current) {
        if (hideThreadList && current === SUPPORT_FALLBACK_ID) {
          void loadFallbackConversation();
        } else {
          void loadConversation(current);
        }
      }
    }, 10000);
  }, [hideThreadList, loadConversation, loadFallbackConversation, loadThreads]);

  const stopPollingFallback = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (loadingThreads) {
      return;
    }

    const trySelect = (threadId: string | null | undefined): boolean => {
      if (!threadId) {
        return false;
      }
      if (threads.some((thread) => thread.whatsappId === threadId)) {
        setSelectedId(threadId);
        return true;
      }
      return false;
    };

    try {
      const target = sessionStorage.getItem("support:target-thread");
      if (target) {
        sessionStorage.removeItem("support:target-thread");
        let targetId: string | null = null;
        try {
          const parsed = JSON.parse(target);
          if (parsed && typeof parsed === "object" && typeof parsed.whatsappId === "string") {
            targetId = parsed.whatsappId;
          }
        } catch {
          targetId = target;
        }
        if (trySelect(targetId)) {
          return;
        }
      }

      const lastThreadRaw = sessionStorage.getItem(LAST_THREAD_STORAGE_KEY);
      if (lastThreadRaw) {
        let lastId: string | null = null;
        try {
          const parsed = JSON.parse(lastThreadRaw);
          if (parsed && typeof parsed === "object" && typeof parsed.whatsappId === "string") {
            lastId = parsed.whatsappId;
          }
        } catch {
          lastId = lastThreadRaw;
        }
        if (trySelect(lastId)) {
          return;
        }
      }
    } catch {
      // ignore storage errors
    }

    if (trySelect(initialThreadId)) {
      return;
    }

    if (!selectedIdRef.current && hideThreadList) {
      setSelectedId(SUPPORT_FALLBACK_ID);
    }
  }, [hideThreadList, initialThreadId, loadingThreads, threads]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (!selectedId) {
      setConversation(null);
      setConversationError(null);
      setLoadingConversation(false);
      return;
    }

    const threadExists = threads.some((thread) => thread.whatsappId === selectedId);

    if (!threads.length) {
      if (hideThreadList && selectedId !== SUPPORT_FALLBACK_ID) {
        setSelectedId(SUPPORT_FALLBACK_ID);
        return;
      }
      if (hideThreadList && selectedId === SUPPORT_FALLBACK_ID) {
        void loadFallbackConversation();
        return;
      }
    }

    if (!threadExists) {
      if (hideThreadList && selectedId === SUPPORT_FALLBACK_ID) {
        void loadFallbackConversation();
        return;
      }
      setConversationError(null);
      void loadConversation(selectedId);
      return;
    }

    setConversationError(null);
    void loadConversation(selectedId);
  }, [
    hideThreadList,
    loadConversation,
    loadFallbackConversation,
    selectedId,
    threads,
  ]);

  useEffect(() => {
    if (!threads.length) {
      if (hideThreadList && selectedId !== SUPPORT_FALLBACK_ID) {
        setSelectedId(SUPPORT_FALLBACK_ID);
      }
      return;
    }

    const exists = selectedIdRef.current
      ? threads.some((item) => item.whatsappId === selectedIdRef.current)
      : false;
    if (exists) {
      return;
    }

    const preferredId = initialThreadId && threads.some((item) => item.whatsappId === initialThreadId)
      ? initialThreadId
      : threads[0].whatsappId;
    setSelectedId(preferredId);
  }, [hideThreadList, initialThreadId, selectedId, threads]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      selectedId !== SUPPORT_FALLBACK_ID &&
      threads.some((thread) => thread.whatsappId === selectedId)
    ) {
      try {
        sessionStorage.setItem(
          LAST_THREAD_STORAGE_KEY,
          JSON.stringify({ whatsappId: selectedId }),
        );
      } catch {
        // ignore storage errors
      }
    }
    updateUnreadCounts((prev) => {
      if (!prev[selectedId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
    window.dispatchEvent(
      new CustomEvent("support:thread-opened", { detail: { whatsappId: selectedId } }),
    );
  }, [selectedId, threads, updateUnreadCounts]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("support-unread-counts");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setUnreadCounts(parsed as Record<string, number>);
        }
      }
    } catch {
      // ignore storage errors
    }

    const handleCounts = (event: Event) => {
      const detail = (event as CustomEvent<{ counts?: Record<string, number> }>).detail;
      if (detail?.counts) {
        setUnreadCounts(detail.counts);
      }
    };

    window.addEventListener("support:unread-counts", handleCounts as EventListener);
    return () => {
      window.removeEventListener("support:unread-counts", handleCounts as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleInbound = (event: Event) => {
      const detail = (event as CustomEvent<{ whatsappId?: string }>).detail;
      const whatsappId = detail?.whatsappId;
      if (!whatsappId || selectedIdRef.current !== whatsappId) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent("support:thread-opened", { detail: { whatsappId } }),
      );

      updateUnreadCounts((prev) => {
        if (!prev[whatsappId]) {
          return prev;
        }
        const next = { ...prev };
        delete next[whatsappId];
        return next;
      });
    };

    window.addEventListener("support:new-inbound", handleInbound as EventListener);
    return () => {
      window.removeEventListener("support:new-inbound", handleInbound as EventListener);
    };
  }, [updateUnreadCounts]);

  useEffect(() => {
    const handleOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ whatsappId?: string }>).detail;
      if (!detail?.whatsappId) {
        return;
      }
      setSelectedId(detail.whatsappId);
    };

    window.addEventListener("support:open-thread", handleOpenRequest as EventListener);
    return () => {
      window.removeEventListener("support:open-thread", handleOpenRequest as EventListener);
    };
  }, []);

  useEffect(() => {
    const socket = io({
      path: SOCKET_PATH,
      transports: ["polling"],
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      stopPollingFallback();
      const currentSelected = selectedIdRef.current;
      const conversationThreadId = conversationThreadIdRef.current;
      const targetId =
        currentSelected && currentSelected !== SUPPORT_FALLBACK_ID
          ? currentSelected
          : conversationThreadId && conversationThreadId !== SUPPORT_FALLBACK_ID
            ? conversationThreadId
            : currentSelected ?? conversationThreadId;
      if (targetId) {
        socket.emit("support:join-thread", { whatsappId: targetId });
        activeThreadRef.current = targetId;
      }
    });

    socket.on("support:thread-updated", (thread: ThreadSummary) => {
      setThreads((prev) => {
        const index = prev.findIndex((item) => item.whatsappId === thread.whatsappId);
        if (index === -1) {
          return sortThreads([...prev, thread]);
        }
        const next = [...prev];
        next[index] = { ...next[index], ...thread };
        return sortThreads(next);
      });

      setConversation((prev) => {
        if (!prev || prev.thread.whatsappId !== thread.whatsappId) {
          return prev;
        }
        return {
          ...prev,
          thread: {
            ...prev.thread,
            customerName: thread.customerName,
            profileName: thread.profileName,
            status: thread.status,
            lastMessageAt: thread.lastMessageAt,
            handlingMode: thread.handlingMode,
            reminderSentAt: thread.reminderSentAt,
          },
          within24h: thread.within24h,
          minutesLeft24h: thread.minutesLeft24h,
        };
      });
    });

    socket.on("support:message-created", (payload: SocketMessageEvent) => {
      setConversation((prev) => {
        if (!prev || prev.thread.whatsappId !== payload.whatsappId) {
          return prev;
        }
        if (prev.messages.some((msg) => msg.id === payload.message.id)) {
          return prev;
        }
        const nextMessages = [...prev.messages, payload.message].sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        return {
          ...prev,
          messages: nextMessages,
          thread: {
            ...prev.thread,
            lastMessageAt: payload.message.timestamp,
          },
        };
      });

      applyIncomingMessage(payload);

      if (!autoScrollRef.current) {
        setShowScrollToBottom(true);
      }
    });

    socket.on("support:thread-not-found", ({ whatsappId }: { whatsappId: string }) => {
      if (selectedIdRef.current === whatsappId) {
        setFeedback({
          type: "danger",
          message: "Conversa não encontrada. Atualize a lista de atendimentos.",
        });
        setSelectedId(null);
        setConversation(null);
      }
      loadThreads();
    });

    const ensureSse = () => {
      if (sseRef.current) return;
      try {
        const es = new EventSource(SSE_PATH, { withCredentials: true });
        sseRef.current = es;

        es.addEventListener("open", () => {
          stopPollingFallback();
        });

        es.addEventListener("support:thread-updated", (ev: MessageEvent) => {
        try {
          const thread = JSON.parse(ev.data) as ThreadSummary;
          setThreads((prev) => {
            const index = prev.findIndex((item) => item.whatsappId === thread.whatsappId);
            if (index === -1) return sortThreads([...prev, thread]);
            const next = [...prev];
            next[index] = { ...next[index], ...thread };
            return sortThreads(next);
          });
          setConversation((prev) => {
            if (!prev || prev.thread.whatsappId !== thread.whatsappId) return prev;
            return {
              ...prev,
              thread: {
                ...prev.thread,
                customerName: thread.customerName,
                profileName: thread.profileName,
                status: thread.status,
                lastMessageAt: thread.lastMessageAt,
              },
              within24h: thread.within24h,
              minutesLeft24h: thread.minutesLeft24h,
            };
          });
        } catch {}
      });

        es.addEventListener("support:message-created", (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data) as SocketMessageEvent;
          setConversation((prev) => {
            if (!prev || prev.thread.whatsappId !== payload.whatsappId) return prev;
            if (prev.messages.some((m) => m.id === payload.message.id)) return prev;
            const nextMessages = [...prev.messages, payload.message].sort((a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
            );
            return {
              ...prev,
              messages: nextMessages,
              thread: { ...prev.thread, lastMessageAt: payload.message.timestamp },
            };
          });
          applyIncomingMessage(payload);
          if (!autoScrollRef.current) setShowScrollToBottom(true);
        } catch {}
      });

        es.onerror = () => {
          es.close();
          sseRef.current = null;
          startPollingFallback();
          window.setTimeout(() => {
            if (!sseRef.current) {
              ensureSse();
            }
          }, 15000);
        };
      } catch (error) {
        try { console.debug("Falha ao iniciar SSE", error); } catch {}
        startPollingFallback();
        window.setTimeout(() => {
          if (!sseRef.current) {
            ensureSse();
          }
        }, 15000);
      }
    };

    // Start SSE proactively as a fallback/secondary stream
    ensureSse();

    socket.on("connect_error", (error) => {
      try { console.debug("Falha na conexão em tempo real", error); } catch {}
      ensureSse();
      startPollingFallback();
    });

    socket.on("disconnect", () => {
      ensureSse();
      startPollingFallback();
    });

    return () => {
      activeThreadRef.current = null;
      socketRef.current = null;
      socket.removeAllListeners();
      socket.disconnect();
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      stopPollingFallback();
    };
  }, [applyIncomingMessage, loadThreads, startPollingFallback, stopPollingFallback]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    const previous = activeThreadRef.current;
    if (previous && previous !== selectedId && previous !== SUPPORT_FALLBACK_ID) {
      socket.emit("support:leave-thread", { whatsappId: previous });
      activeThreadRef.current = null;
    }

    if (selectedId && selectedId !== SUPPORT_FALLBACK_ID && activeThreadRef.current !== selectedId) {
      socket.emit("support:join-thread", { whatsappId: selectedId });
      activeThreadRef.current = selectedId;
    }
  }, [selectedId]);

  useEffect(() => {
    if (conversation && autoScroll && conversationRef.current) {
      const el = conversationRef.current;
      el.scrollTop = el.scrollHeight;
      setShowScrollToBottom(false);
    }
  }, [conversation, autoScroll]);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    pendingMediaRef.current = pendingMedia;
  }, [pendingMedia]);

  useEffect(() => {
    conversationThreadIdRef.current = conversation?.thread.whatsappId ?? null;
  }, [conversation]);

  useEffect(() => () => {
    pendingMediaRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  const selectedThread = useMemo(() => {
    if (!selectedId) return null;
    const found = threads.find((thread) => thread.whatsappId === selectedId);
    if (found) {
      return found;
    }
    if (hideThreadList) {
      return {
        whatsappId: selectedId,
        customerName: "Suporte Bot Admin",
        profileName: null,
        lastMessagePreview: null,
        lastMessageAt: null,
        status: "open",
        within24h: true,
        minutesLeft24h: 24 * 60,
        handlingMode: "human",
        reminderSentAt: null,
        displayWhatsappId: null,
        isAdminThread: true,
      } satisfies ThreadSummary;
    }
    return null;
  }, [hideThreadList, threads, selectedId]);

  const handleSelect = (thread: ThreadSummary) => {
    const alreadySelected = thread.whatsappId === selectedId;

    if (alreadySelected) {
      if (!conversation && !loadingConversation) {
        setConversationError(null);
        void loadConversation(thread.whatsappId);
      }
    } else {
      setSelectedId(thread.whatsappId);
      setMessageDraft("");
      setMessageSearch("");
      setPendingMedia([]);
      setAutoScroll(true);
      setConversation(null);
      setConversationError(null);
    }

    setFeedback(null);
    if (isMobileViewport) {
      setMobileContactsOpen(false);
    }
    updateUnreadCounts((prev) => {
      if (!prev[thread.whatsappId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[thread.whatsappId];
      return next;
    });
    window.dispatchEvent(
      new CustomEvent("support:thread-opened", { detail: { whatsappId: thread.whatsappId } }),
    );
  };

  const dispatchOutboundMessage = useCallback((whatsappId: string, messagePayload: unknown) => {
    if (typeof window === "undefined") return;
    if (!whatsappId) return;

    const message = (messagePayload as { id?: unknown } | null) ?? null;
    const rawId = message && "id" in message ? (message as { id?: unknown }).id : undefined;
    const messageId = typeof rawId === "string" ? Number.parseInt(rawId, 10) : rawId;

    if (typeof messageId === "number" && Number.isFinite(messageId)) {
      window.dispatchEvent(
        new CustomEvent("support:outbound-sent", {
          detail: { whatsappId, messageId },
        }),
      );
    }
  }, []);

  const handleSend = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!selectedId || isSending) return;
    if (!messageDraft.trim() && pendingMedia.length === 0) return;
    setIsSending(true);
    setFeedback(null);
    try {
      const usedDraftAsCaption = pendingMedia.length === 1 && messageDraft.trim().length > 0;

      for (const item of pendingMedia) {
        const formData = new FormData();
        formData.append("to", selectedId);
        formData.append("mode", "media");
        formData.append("mediaType", item.mediaType);
        formData.append("file", item.file);
        if (usedDraftAsCaption && messageDraft.trim()) {
          formData.append("caption", messageDraft.trim());
        }

        const res = await fetch("/api/support/messages", {
          method: "POST",
          body: formData,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message ?? "Não foi possível enviar a mídia.");
        }
        dispatchOutboundMessage(selectedId, data?.message ?? null);
      }

      if (messageDraft.trim() && (!pendingMedia.length || pendingMedia.length > 1)) {
        const formData = new FormData();
        formData.append("to", selectedId);
        formData.append("mode", "text");
        formData.append("text", messageDraft.trim());
        const res = await fetch("/api/support/messages", {
          method: "POST",
          body: formData,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message ?? "Não foi possível enviar a mensagem.");
        }
        dispatchOutboundMessage(selectedId, data?.message ?? null);
      }

      setMessageDraft("");
      setPendingMedia((prev) => {
        prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return [];
      });
      setFeedback({ type: "success", message: "Mensagem enviada." });
      setAutoScroll(true);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao enviar mensagem.",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleCloseThread = async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/support/threads/${encodeURIComponent(selectedId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message ?? "Não foi possível encerrar a conversa.");
      }
      setFeedback({ type: "success", message: "Conversa encerrada." });
      await Promise.all([loadConversation(selectedId), loadThreads()]);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao encerrar conversa.",
      });
    }
  };

  const canSend = Boolean(
    !isSending && (messageDraft.trim().length > 0 || pendingMedia.length > 0),
  );

  const adminAvatarUrl = brand?.logoUrl ?? null;
  useEffect(() => {
    let active = true;
    const loadBrand = async () => {
      try {
        const r = await fetch(SITE_PUBLIC_SETTINGS_ENDPOINT, { cache: "force-cache" });
        const data = await r.json().catch(() => null);
        if (!active) return;
        const settings = (data?.settings ?? null) as
          | { siteName?: string | null; logoUrl?: string | null; faviconAssets?: { appleTouchIconUrl?: string | null } | null }
          | null;
        const siteName: string = settings?.siteName ?? "Suporte";
        const logoUrl: string | null =
          settings?.faviconAssets?.appleTouchIconUrl ?? settings?.logoUrl ?? null;
        setBrand({ siteName, logoUrl });
      } catch {}
    };
    loadBrand();
    return () => {
      active = false;
    };
  }, []);

  const renderThreadCard = (thread: ThreadSummary, options?: { active?: boolean }) => {
    const isAdminThread = Boolean(thread.displayWhatsappId);
    const displayName = isAdminThread
      ? (brand?.siteName ? `Suporte ${brand.siteName}` : "Suporte Administrativo")
      : thread.customerName || thread.profileName;
    const title = displayName || (isAdminThread ? "Suporte" : thread.whatsappId);
    const identifier = thread.displayWhatsappId ?? thread.whatsappId;
    const unread = unreadCounts[thread.whatsappId] ?? 0;
    const isActive = options?.active ?? false;
    const previewText = formatLastMessagePreview(thread.lastMessagePreview);

    return (
      <Card
        role="button"
        onClick={() => handleSelect(thread)}
        className={`support-thread-card shadow-sm h-100${
          isActive ? " support-thread-card--active" : ""
        }`}
        aria-pressed={isActive}
        style={{ cursor: "pointer" }}
      >
        <Card.Body className="support-thread-card__body d-flex flex-column gap-3 h-100">
          <div className="support-thread-card__header d-flex justify-content-between align-items-start gap-2">
            <div className="support-thread-card__title text-truncate d-flex align-items-center gap-2">
              {isAdminThread && adminAvatarUrl && (
                <NextImage src={adminAvatarUrl} alt={brand?.siteName ?? "Admin"} width={24} height={24} className="rounded-circle" />
              )}
              <span className="fw-semibold d-block text-truncate" title={title}>
                {title}
              </span>
              {displayName ? (
                <span className="support-thread-card__identifier text-secondary small text-truncate">
                  {identifier}
                </span>
              ) : null}
            </div>
            <div className="support-thread-card__meta d-flex align-items-center gap-2 flex-shrink-0">
              {unread > 0 && <Badge bg="danger">{unread}</Badge>}
              {!isAdminThread && (
                <Badge bg={thread.handlingMode === "human" ? "warning" : "info"}>
                  {thread.handlingMode === "human" ? "Humanizado" : "Automático"}
                </Badge>
              )}
              <Badge bg={thread.status === "open" ? "success" : "secondary"}>
                {thread.status === "open" ? "Aberto" : "Encerrado"}
              </Badge>
            </div>
          </div>
          <div
            className="support-thread-card__preview text-secondary small text-truncate d-none d-sm-block"
            title={thread.lastMessagePreview ?? undefined}
          >
            {previewText}
          </div>
          <div
            className="support-thread-card__timestamp text-secondary small mt-auto d-none d-sm-block"
            suppressHydrationWarning
          >
            {thread.lastMessageAt ? formatDateTime(thread.lastMessageAt) : "-"}
          </div>
        </Card.Body>
      </Card>
    );
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const files = event.target.files;
    if (!files) return;
    const next: PendingMedia[] = [];
    Array.from(files).forEach((file) => {
      next.push({
        file,
        previewUrl: URL.createObjectURL(file),
        mediaType: inferMediaTypeFromFile(file),
      });
    });
    setPendingMedia((prev) => [...prev, ...next]);
    event.target.value = "";
  };

  const removePendingMedia = (url: string) => {
    setPendingMedia((prev) => {
      const filtered = prev.filter((item) => item.previewUrl !== url);
      prev
        .filter((item) => item.previewUrl === url)
        .forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return filtered;
    });
  };

  const handleConversationScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    const el = event.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAutoScroll(nearBottom);
    setShowScrollToBottom(!nearBottom);
  };

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const sendAudioMessage = useCallback(
    async (blob: Blob, mimeType: string) => {
      const threadId = selectedIdRef.current;
      if (!threadId) {
        setFeedback({
          type: "danger",
          message: "Nenhuma conversa selecionada para enviar o áudio.",
        });
        return;
      }
      setIsSending(true);
      try {
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        const fileName = `audio-${Date.now()}.${extension}`;
        const file = new File([blob], fileName, { type: mimeType });
        const formData = new FormData();
        formData.append("to", threadId);
        formData.append("mode", "media");
        formData.append("mediaType", "audio");
        formData.append("file", file);
        const response = await fetch("/api/support/messages", {
          method: "POST",
          body: formData,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.message ?? "Não foi possível enviar o áudio.");
        }
        setFeedback({ type: "success", message: "Áudio enviado." });
        setAutoScroll(true);
      } catch (error) {
        console.error(error);
        setFeedback({
          type: "danger",
          message:
            error instanceof Error ? error.message : "Falha ao enviar o áudio. Tente novamente.",
        });
      } finally {
        setIsSending(false);
      }
    },
    [setAutoScroll],
  );

  const recordingMimeTypeRef = useRef<string>("audio/webm");
  const recordingCancelledRef = useRef(false);
  const pointerRecordingRef = useRef(false);
  const pointerRecordingIdRef = useRef<number | null>(null);
  const pointerListenersCleanupRef = useRef<(() => void) | null>(null);
  const pointerDownAtRef = useRef<number | null>(null);
  const pointerHoldModeRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const HOLD_THRESHOLD_MS = 350;
  const MIN_AUDIO_MS = 450;
  const ignoreNextMicClickRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);

  const cleanupPointerListeners = useCallback(() => {
    if (pointerListenersCleanupRef.current) {
      pointerListenersCleanupRef.current();
      pointerListenersCleanupRef.current = null;
    }
    pointerRecordingIdRef.current = null;
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    pointerDownAtRef.current = null;
    pointerHoldModeRef.current = false;
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording || isSending) {
      return;
    }
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setFeedback({
        type: "danger",
        message: "Este dispositivo não suporta gravação de áudio no navegador.",
      });
      return;
    }
    try {
      setFeedback(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const supportedMime =
        mimeCandidates.find((type) => {
          try {
            return MediaRecorder.isTypeSupported(type);
          } catch {
            return type === "audio/webm";
          }
        }) ?? "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType: supportedMime });
      recordingMimeTypeRef.current = supportedMime;
      recordingCancelledRef.current = false;
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        clearRecordingTimer();
        if (recordingStreamRef.current) {
          recordingStreamRef.current.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
        }
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        mediaRecorderRef.current = null;
        setRecordingElapsed(0);
        setIsRecording(false);
        const startedAt = recordingStartedAtRef.current;
        recordingStartedAtRef.current = null;
        const elapsedMs = typeof startedAt === "number" ? Date.now() - startedAt : 0;
        const shouldSend = !recordingCancelledRef.current && chunks.length > 0 && elapsedMs >= MIN_AUDIO_MS;
        if (shouldSend) {
          const blob = new Blob(chunks, { type: recordingMimeTypeRef.current });
          void sendAudioMessage(blob, recordingMimeTypeRef.current);
        } else if (!recordingCancelledRef.current) {
          setFeedback({ type: "danger", message: "Áudio muito curto. Pressione para gravar novamente." });
        }
      });

      mediaRecorderRef.current = recorder;
      setRecordingElapsed(0);
      setIsRecording(true);
      clearRecordingTimer();
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingElapsed((prev) => prev + 1);
      }, 1000);
      recorder.start();
    } catch (error) {
      console.error(error);
      setIsRecording(false);
      clearRecordingTimer();
      setRecordingElapsed(0);
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
      }
      pointerRecordingRef.current = false;
      cleanupPointerListeners();
      ignoreNextMicClickRef.current = false;
      setFeedback({
        type: "danger",
        message:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Permita o acesso ao microfone para enviar áudios."
            : "Não foi possível iniciar a gravação de áudio.",
      });
    }
  }, [cleanupPointerListeners, clearRecordingTimer, isRecording, isSending, sendAudioMessage]);

  const stopRecording = useCallback(
    (options?: { cancel?: boolean }) => {
      recordingCancelledRef.current = Boolean(options?.cancel);
      pointerRecordingRef.current = false;
      cleanupPointerListeners();
      clearRecordingTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      } else {
        if (recordingStreamRef.current) {
          recordingStreamRef.current.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
        }
        recordingChunksRef.current = [];
        mediaRecorderRef.current = null;
        setRecordingElapsed(0);
        setIsRecording(false);
        recordingStartedAtRef.current = null;
      }
    },
    [cleanupPointerListeners, clearRecordingTimer],
  );

const handleMicButtonClick = useCallback(async () => {
  if (ignoreNextMicClickRef.current) {
    // Pointer gestures handle the lifecycle; ignore this synthetic click.
    ignoreNextMicClickRef.current = false;
    return;
  }
  if (isRecording) {
    if (!isSending) {
      stopRecording();
    }
  } else {
    await startRecording();
  }
}, [isRecording, isSending, startRecording, stopRecording]);

const handleMicPointerDown = useCallback(
  (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isSending || isRecording) {
      pointerRecordingRef.current = false;
      ignoreNextMicClickRef.current = false;
      cleanupPointerListeners();
      return;
    }

    pointerRecordingRef.current = true;
    pointerRecordingIdRef.current = event.pointerId;
    ignoreNextMicClickRef.current = true;
    pointerDownAtRef.current = Date.now();
    pointerHoldModeRef.current = false;
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdTimerRef.current = window.setTimeout(() => {
      pointerHoldModeRef.current = true;
    }, HOLD_THRESHOLD_MS);

    const handleGlobalPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerRecordingIdRef.current) return;
      ev.preventDefault();
      pointerRecordingRef.current = false;
      cleanupPointerListeners();
      if (pointerHoldModeRef.current) {
        // Hold-to-record: soltar para parar
        stopRecording();
      } else {
        // Toque curto: mantém gravando até o usuário parar manualmente
      }
    };

    const handleGlobalPointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerRecordingIdRef.current) return;
      ev.preventDefault();
      pointerRecordingRef.current = false;
      cleanupPointerListeners();
      if (pointerHoldModeRef.current) {
        // Cancelar somente se estava em modo segurar-para-gravar
        stopRecording({ cancel: true });
      } else {
        // Toque curto: mantém gravando
      }
    };

    window.addEventListener("pointerup", handleGlobalPointerUp, { passive: false });
    window.addEventListener("pointercancel", handleGlobalPointerCancel, { passive: false });

    pointerListenersCleanupRef.current = () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerCancel);
      ignoreNextMicClickRef.current = false;
    };

    void startRecording();
  },
  [cleanupPointerListeners, isRecording, isSending, startRecording, stopRecording],
);

const handleCancelRecording = useCallback(() => {
  stopRecording({ cancel: true });
}, [stopRecording]);

useEffect(
  () => () => {
    cleanupPointerListeners();
  },
  [cleanupPointerListeners],
);

useEffect(
  () => () => {
    if (isRecording) {
      stopRecording({ cancel: true });
    } else {
      clearRecordingTimer();
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    }
  },
  [clearRecordingTimer, isRecording, stopRecording],
);

  const handleInteractiveSubmit = async () => {
    if (!selectedId) return;
    try {
      const formData = new FormData();
      formData.append("to", selectedId);
      formData.append("mode", "interactive");
      formData.append("interactiveType", interactiveType);

      if (interactiveType === "buttons") {
        formData.append("bodyText", interactiveBody);
        formData.append("footerText", interactiveFooter);
        formData.append("headerText", interactiveHeader);
        const cleaned = interactiveButtons
          .filter((btn) => btn.id.trim() && btn.title.trim())
          .map((btn, index) => ({
            id: btn.id.trim() || `btn_${index + 1}`,
            title: btn.title.trim(),
          }));

        if (!cleaned.length) {
          setFeedback({ type: "danger", message: "Informe ao menos um botão." });
          return;
        }

        formData.append("buttons", JSON.stringify(cleaned));
      } else if (interactiveType === "cta_url") {
        formData.append("bodyText", interactiveBody);
        formData.append("footerText", interactiveFooter);
        formData.append("headerText", interactiveHeader);
        formData.append("buttonText", interactiveButtonText);
        formData.append("buttonUrl", interactiveUrl);
      }

      const res = await fetch("/api/support/messages", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message ?? "Não foi possível enviar a mensagem interativa.");
      }

      setFeedback({ type: "success", message: "Mensagem interativa enviada." });
      setAutoScroll(true);
      setShowInteractiveModal(false);
      await Promise.all([loadConversation(selectedId), loadThreads()]);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao enviar mensagem interativa.",
      });
    }
  };

  const renderThreadListContent = (highlightSelected = false) => {
    if (loadingThreads) {
      return (
        <div className="d-flex align-items-center justify-content-center py-4">
          <Spinner animation="border" size="sm" />
        </div>
      );
    }

    if (threadsError) {
      return (
        <Alert variant="danger" className="m-3 mb-0">
          {threadsError}
        </Alert>
      );
    }

    if (threads.length === 0) {
      return <div className="text-secondary text-center py-4">Nenhum atendimento em andamento.</div>;
    }

    return (
      <div className="support-thread-list d-flex flex-column gap-2">
        {threads.map((thread) => (
          <div key={`thread-${thread.whatsappId}`} className="support-thread-list-item">
            {renderThreadCard(
              thread,
              highlightSelected ? { active: selectedId === thread.whatsappId } : undefined,
            )}
          </div>
        ))}
      </div>
    );
  };

  const desktopThreadList = (
    <Card className="support-sidebar-card shadow-sm h-100">
      <Card.Header className="support-sidebar-card__header d-flex justify-content-between align-items-center">
        <div>
          <h2 className="h6 mb-0">Conversas</h2>
          <small className="text-secondary">Gerencie seus atendimentos</small>
        </div>
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={loadThreads}
          disabled={loadingThreads}
        >
          {loadingThreads ? "Atualizando..." : "Atualizar"}
        </Button>
      </Card.Header>
      <Card.Body className="support-sidebar-card__body">
        {renderThreadListContent(true)}
      </Card.Body>
    </Card>
  );

  const mobileConversationsOffcanvas = (
    <Offcanvas
      show={isMobileViewport && mobileContactsOpen}
      onHide={() => setMobileContactsOpen(false)}
      placement="start"
      className="support-mobile-contacts"
    >
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>Conversas</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body className="d-flex flex-column gap-3">
        <Button
          variant="outline-primary"
          size="sm"
          onClick={loadThreads}
          disabled={loadingThreads}
          className="align-self-start"
        >
          {loadingThreads ? "Atualizando..." : "Atualizar"}
        </Button>
        {renderThreadListContent(true)}
      </Offcanvas.Body>
    </Offcanvas>
  );

  const renderEmptyState = () => (
    <Card className="support-chat-card shadow-sm h-100 d-flex flex-column align-items-center justify-content-center text-center">
      <div className="px-4 py-5 text-secondary d-flex flex-column gap-3 align-items-center">
        <div>
          <h3 className="h5 mb-1">
            {hideThreadList ? "Carregando suporte" : "Selecione uma conversa"}
          </h3>
          <p className="mb-0">
            {hideThreadList
              ? "Estamos preparando o chat com a equipe de suporte."
              : "Escolha um atendimento na coluna à esquerda para visualizar as mensagens."}
          </p>
        </div>
        {!hideThreadList && isMobileViewport && (
          <Button variant="primary" onClick={() => setMobileContactsOpen(true)}>
            Abrir lista de conversas
          </Button>
        )}
      </div>
    </Card>
  );

  const visibleMessages = useMemo(() => {
    const messages = conversation?.messages ?? [];
    const query = messageSearch.trim().toLowerCase();
    if (!query) {
      return messages;
    }
    return messages.filter((message) => {
      const fields = [
        message.text,
        message.messageType,
        message.media?.caption,
        message.media?.filename,
        message.media?.mimeType,
      ];
      return fields.some((field) =>
        typeof field === "string" && field.toLowerCase().includes(query),
      );
    });
  }, [conversation?.messages, messageSearch]);

  const renderConversationCard = () => (
    <Card className="support-chat-card shadow-sm h-100 d-flex flex-column">
      <Card.Header className="d-flex flex-column flex-lg-row justify-content-between align-items-start align-items-lg-center gap-3">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          {(() => {
            const labelRaw =
              conversation?.thread.customerName ||
              conversation?.thread.profileName ||
              selectedThread?.customerName ||
              selectedThread?.profileName ||
              selectedThread?.whatsappId ||
              "Suporte";
            const label = String(labelRaw).trim();
            const initials = label
              .split(/\s+/)
              .map((part) => part[0] ?? "")
              .join("")
              .slice(0, 2)
              .toUpperCase();
            return (
              <>
                <div
                  className="bg-primary-subtle text-primary fw-semibold d-flex align-items-center justify-content-center"
                  style={{ width: 40, height: 40, borderRadius: "999px" }}
                >
                  {initials || "S"}
                </div>
                <div>
                  <h3 className="h6 mb-0">{label || "Suporte"}</h3>
                  <small className="text-secondary">
                    {conversation?.thread.displayWhatsappId ||
                      selectedThread?.displayWhatsappId ||
                      conversation?.thread.whatsappId ||
                      selectedThread?.whatsappId ||
                      "-"}
                  </small>
                  {(conversation?.thread.whatsappId === SUPPORT_FALLBACK_ID ||
                    selectedThread?.isAdminThread) && (
                    <div className="mt-1">
                      <Badge bg="success">Atendimento verificado</Badge>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap w-100 justify-content-start justify-content-lg-end">
          {isMobileViewport && !hideThreadList && (
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setMobileContactsOpen(true)}
            >
              Conversas
            </Button>
          )}
          <Badge bg={selectedThread?.status === "open" ? "success" : "secondary"}>
            {selectedThread?.status === "open" ? "Aberto" : "Encerrado"}
          </Badge>
          {onRequestClose && (
            <Button variant="outline-primary" size="sm" onClick={onRequestClose}>
              Fechar suporte
            </Button>
          )}
          {!hideThreadList && (
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={handleCloseThread}
              disabled={selectedThread?.status === "closed"}
            >
              Encerrar
            </Button>
          )}
        </div>
        <div className="w-100">
          <Form.Control
            type="search"
            size="sm"
            value={messageSearch}
            onChange={(event) => setMessageSearch(event.currentTarget.value)}
            placeholder="Pesquisar mensagem nesta conversa"
            aria-label="Pesquisar mensagem nesta conversa"
          />
        </div>
      </Card.Header>
      <Card.Body
        className="flex-grow-1 d-flex flex-column gap-3 overflow-hidden"
        style={{ minHeight: "480px", height: "calc(100vh - 260px)" }}
      >
        {feedback && (
          <Alert
            variant={feedback.type === "success" ? "success" : "danger"}
            onClose={() => setFeedback(null)}
            dismissible
          >
            {feedback.message}
          </Alert>
        )}

        {loadingConversation ? (
          <div className="flex-grow-1 d-flex align-items-center justify-content-center">
            <Spinner animation="border" />
          </div>
        ) : conversationError ? (
          <Alert variant="danger" className="mb-0">
            {conversationError}
          </Alert>
        ) : conversation ? (
          <div
            ref={conversationRef}
            onScroll={handleConversationScroll}
            className="flex-grow-1 overflow-auto border rounded p-3 bg-light"
            style={{ minHeight: 0 }}
          >
            {conversation.messages.length === 0 ? (
              <div className="text-secondary text-center">Nenhuma mensagem nesta conversa ainda.</div>
            ) : visibleMessages.length === 0 ? (
              <div className="text-secondary text-center">
                Nenhuma mensagem encontrada para esta busca.
              </div>
            ) : (
              visibleMessages.map((message) => {
                const isOwn = (() => {
                  if (message.senderRole === "user") return true;
                  if (message.senderRole === "admin" || message.senderRole === "system") return false;
                  return message.direction === "outbound";
                })();
                const bubbleClasses = isOwn ? "bg-primary text-white" : "bg-white";
                const metaClasses = isOwn ? "text-white-50" : "text-secondary";
                const mediaDirection: "inbound" | "outbound" = isOwn ? "outbound" : "inbound";

                return (
                  <div
                    key={message.id}
                    className={`d-flex mb-3 ${isOwn ? "justify-content-end" : "justify-content-start"}`}
                  >
                    <div className={`rounded px-3 py-2 shadow-sm ${bubbleClasses}`} style={{ maxWidth: "75%" }}>
                      <div className="small d-flex flex-column gap-2">
                        {message.media ? (
                          <MediaPreview media={message.media} direction={mediaDirection} />
                        ) : null}
                        {message.text && <span>{message.text}</span>}
                        {!message.text && !message.media && <em>({message.messageType})</em>}
                      </div>
                      <div className={`text-end small mt-2 ${metaClasses}`} suppressHydrationWarning>
                        {formatDateTime(message.timestamp)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex-grow-1 d-flex align-items-center justify-content-center text-secondary">
            Aguarde enquanto carregamos a conversa selecionada.
          </div>
        )}

        {selectedThread ? (
          <div className="border-top pt-3">
            {pendingMedia.length > 0 && (
              <div className="mb-3 d-flex flex-wrap gap-2">
                {pendingMedia.map((item) => (
                  <PendingMediaPreview
                    key={item.previewUrl}
                    media={item}
                    onRemove={() => removePendingMedia(item.previewUrl)}
                  />
                ))}
              </div>
            )}
            <form className="support-composer" onSubmit={handleSend}>
              <input type="file" multiple hidden ref={fileInputRef} onChange={handleFileChange} />
              {isRecording ? (
                <div className="support-composer__container support-composer__container--recording">
                  <button
                    type="button"
                    className="support-composer__icon-button support-composer__icon-button--danger"
                    onClick={handleCancelRecording}
                    title="Cancelar áudio"
                    disabled={isSending}
                  >
                    <IconTrash size={18} />
                  </button>
                  <div className="support-composer__recording-info">
                    <span className="support-composer__recording-dot" />
                    <span className="support-composer__recording-time">
                      {formatRecordingElapsed(recordingElapsed)}
                    </span>
                    <span className="support-composer__recording-wave" />
                  </div>
                  <button
                    type="button"
                    className="support-composer__icon-button support-composer__icon-button--primary"
                    onClick={() => stopRecording()}
                    disabled={isSending}
                    title="Enviar áudio"
                  >
                    {isSending ? <Spinner animation="border" size="sm" /> : <span className="support-composer__send-icon">➤</span>}
                  </button>
                </div>
              ) : (
                <>
                  <div className="support-composer__container">
                    <button
                      type="button"
                      className="support-composer__icon-button"
                      onClick={handleAttachClick}
                      title="Anexar arquivos"
                    >
                      <span className="support-composer__icon">+</span>
                    </button>
                    <button
                      type="button"
                      className="support-composer__icon-button"
                      disabled
                      title="Emojis em breve"
                    >
                      <IconMoodSmile size={18} />
                    </button>
                    <textarea
                      className="support-composer__input"
                      rows={1}
                      value={messageDraft}
                      onChange={(event) => setMessageDraft(event.currentTarget.value)}
                      placeholder="Digite uma mensagem"
                      onFocus={() => setAutoScroll(true)}
                    />
                    <button
                      type="button"
                      className="support-composer__icon-button"
                      onClick={handleMicButtonClick}
                      onPointerDown={handleMicPointerDown}
                      disabled={isSending}
                      title="Gravar áudio"
                    >
                      <IconMicrophone size={18} />
                    </button>
                  </div>
                  <div className="support-composer__actions">
                    {showScrollToBottom && (
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => {
                          setAutoScroll(true);
                          if (conversationRef.current) {
                            conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
                          }
                        }}
                      >
                        Ir para o fim
                      </Button>
                    )}
                    <button
                      type="submit"
                      disabled={!canSend}
                      className="support-composer__send"
                      title="Enviar mensagem"
                    >
                      {isSending ? <Spinner animation="border" size="sm" /> : <span className="support-composer__send-icon">➤</span>}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
        ) : null}
      </Card.Body>
    </Card>
  );

  const containerClass = hideThreadList ? "user-support user-support--compact" : "user-support";

  return (
    <div className="user-support-wrapper">
      <div className={containerClass}>
        <Row className={`gy-3${hideThreadList ? "" : " flex-lg-nowrap gx-lg-4"}`}>
          {!hideThreadList && (
            <Col lg={4} className="d-none d-lg-block">
              {desktopThreadList}
            </Col>
          )}
          <Col lg={hideThreadList ? 12 : 8}>
            {selectedThread ? renderConversationCard() : renderEmptyState()}
          </Col>
        </Row>
        {!hideThreadList && mobileConversationsOffcanvas}
      </div>
      <InteractiveModal
        show={showInteractiveModal}
        onHide={() => setShowInteractiveModal(false)}
        type={interactiveType}
        onTypeChange={setInteractiveType}
        buttons={interactiveButtons}
        setButtons={setInteractiveButtons}
        bodyText={interactiveBody}
        setBodyText={setInteractiveBody}
        footerText={interactiveFooter}
        setFooterText={setInteractiveFooter}
        headerText={interactiveHeader}
        setHeaderText={setInteractiveHeader}
        url={interactiveUrl}
        setUrl={setInteractiveUrl}
        buttonText={interactiveButtonText}
        setButtonText={setInteractiveButtonText}
        onSubmit={handleInteractiveSubmit}
      />
    </div>
  );
};

export default UserConversationsClient;

const PendingMediaPreview = ({
  media,
  onRemove,
}: {
  media: PendingMedia;
  onRemove: () => void;
}) => {
  const { mediaType, previewUrl, file } = media;
  return (
    <div className="support-media-preview">
      <button type="button" className="support-media-preview__remove" onClick={onRemove}>
        ×
      </button>
      {mediaType === "image" ? (
        <Image src={previewUrl} alt={file.name} rounded fluid className="support-media-preview__image" />
      ) : (
        <div className="support-media-preview__file">
          <span className="support-media-preview__label" title={file.name}>
            {file.name}
          </span>
          <small className="text-secondary text-capitalize">{mediaType}</small>
        </div>
      )}
    </div>
  );
};

type InteractiveModalProps = {
  show: boolean;
  onHide: () => void;
  type: "buttons" | "cta_url";
  onTypeChange: (value: "buttons" | "cta_url") => void;
  buttons: InteractiveButtonState[];
  setButtons: (value: InteractiveButtonState[]) => void;
  bodyText: string;
  setBodyText: (value: string) => void;
  footerText: string;
  setFooterText: (value: string) => void;
  headerText: string;
  setHeaderText: (value: string) => void;
  url: string;
  setUrl: (value: string) => void;
  buttonText: string;
  setButtonText: (value: string) => void;
  onSubmit: () => void;
};

const InteractiveModal = ({
  show,
  onHide,
  type,
  onTypeChange,
  buttons,
  setButtons,
  bodyText,
  setBodyText,
  footerText,
  setFooterText,
  headerText,
  setHeaderText,
  url,
  setUrl,
  buttonText,
  setButtonText,
  onSubmit,
}: InteractiveModalProps) => {
  const updateButton = (index: number, field: keyof InteractiveButtonState, value: string) => {
    setButtons(
      buttons.map((btn, idx) => (idx === index ? { ...btn, [field]: value } : btn)),
    );
  };

  const addButton = () => {
    if (buttons.length >= 3) return;
    setButtons([...buttons, { id: `btn_${buttons.length + 1}`, title: "Novo" }]);
  };

  const removeButton = (index: number) => {
    setButtons(buttons.filter((_, idx) => idx !== index));
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Mensagem interativa</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-flex flex-column gap-3">
        <Form.Group>
          <Form.Label>Tipo</Form.Label>
          <Form.Select
            value={type}
            onChange={(event) =>
              onTypeChange(event.currentTarget.value as "buttons" | "cta_url")
            }
          >
            <option value="buttons">Botões de resposta</option>
            <option value="cta_url">Botão com link</option>
          </Form.Select>
        </Form.Group>

        <Row className="g-3">
          <Col md={12}>
            <Form.Group>
              <Form.Label>Corpo</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={bodyText}
                onChange={(event) => setBodyText(event.currentTarget.value)}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Cabeçalho (opcional)</Form.Label>
              <Form.Control
                value={headerText}
                onChange={(event) => setHeaderText(event.currentTarget.value)}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Rodapé (opcional)</Form.Label>
              <Form.Control
                value={footerText}
                onChange={(event) => setFooterText(event.currentTarget.value)}
              />
            </Form.Group>
          </Col>
        </Row>

        {type === "buttons" ? (
          <div className="d-flex flex-column gap-2">
            {buttons.map((button, index) => (
              <Row className="g-2 align-items-end" key={button.id + index}>
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>ID</Form.Label>
                    <Form.Control
                      value={button.id}
                      onChange={(event) => updateButton(index, "id", event.currentTarget.value)}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label>Título</Form.Label>
                    <Form.Control
                      value={button.title}
                      onChange={(event) =>
                        updateButton(index, "title", event.currentTarget.value)
                      }
                    />
                  </Form.Group>
                </Col>
                <Col md={2} className="d-flex justify-content-end">
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => removeButton(index)}
                  >
                    Remover
                  </Button>
                </Col>
              </Row>
            ))}
            {buttons.length < 3 && (
              <Button variant="outline-primary" size="sm" onClick={addButton}>
                Adicionar botão
              </Button>
            )}
          </div>
        ) : (
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Texto do botão</Form.Label>
                <Form.Control
                  value={buttonText}
                  onChange={(event) => setButtonText(event.currentTarget.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>URL</Form.Label>
                <Form.Control
                  value={url}
                  onChange={(event) => setUrl(event.currentTarget.value)}
                />
              </Form.Group>
            </Col>
          </Row>
        )}
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-end">
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={onHide}>
            Cancelar
          </Button>
          <Button onClick={onSubmit}>Enviar</Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};
