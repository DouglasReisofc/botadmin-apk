"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

interface SupportThreadUpdateDetail {
  whatsappId: string;
  customerName: string | null;
  profileName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  status: "open" | "closed";
  within24h?: boolean;
  minutesLeft24h?: number;
  isAdminThread?: boolean;
}

interface SupportMessageDetail {
  whatsappId: string;
  message: {
    id: number;
    direction: "inbound" | "outbound";
    messageType: string;
    text: string | null;
    timestamp: string;
    senderUserId: number | null;
    senderRole: "user" | "admin" | "contact" | "system";
    media?: {
      mediaType: string;
      caption?: string | null;
      filename?: string | null;
    } | null;
  };
}

const BUBBLE_HIDE_DELAY = 7_000;
const MIN_MARGIN = 16;
const DRAG_THRESHOLD = 6;

type BubblePreview = {
  id: string;
  whatsappId: string;
  customerLabel: string;
  message: string;
  timestamp: string;
};

type Position = {
  top: number;
  left: number;
};

type SupportChannelState = "loading" | "chat" | "whatsapp";

const getMessagePreview = (detail: SupportMessageDetail["message"]): string => {
  if (detail.text && detail.text.trim()) {
    return detail.text.trim();
  }

  switch (detail.messageType) {
    case "image":
      return "📷 Imagem recebida";
    case "video":
      return "🎞️ Vídeo recebido";
    case "audio":
      return "🎧 Áudio recebido";
    case "document":
      return detail.media?.filename
        ? `📄 Documento: ${detail.media.filename}`
        : "📄 Documento recebido";
    case "sticker":
      return "😊 Sticker recebido";
    default:
      return "Nova mensagem recebida";
  }
};

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const SupportFloatingBubble = () => {
  const router = useRouter();
  const pathname = usePathname();
  const [isUserRole, setIsUserRole] = useState<boolean | null>(null);
  const [supportChannel, setSupportChannel] = useState<SupportChannelState>("loading");
  const [currentPreview, setCurrentPreview] = useState<BubblePreview | null>(null);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const queueRef = useRef<BubblePreview[]>([]);
  const currentRef = useRef<BubblePreview | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const seenMessagesRef = useRef<Set<string>>(new Set());
  const threadsRef = useRef<Record<string, SupportThreadUpdateDetail>>({});
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const pointerMovedRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingPosRef = useRef<Position | null>(null);
  const overscrollRestoreRef = useRef<{ body: string; html: string } | null>(null);

  const isSupportPage =
    pathname?.startsWith("/dashboard/user/conversas") ||
    pathname?.startsWith("/dashboard/user/whatsapp-conversas");
  const isHiddenPage =
    pathname === "/linksuteis" || pathname?.startsWith("/linksuteis/");

  useEffect(() => {
    let active = true;
    const fetchRole = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!active) {
          return;
        }
        setIsUserRole(data?.user?.role === "user");
      } catch {
        if (active) {
          setIsUserRole(false);
        }
      }
    };
    fetchRole();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/public/support-config", { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!active) {
          return;
        }
        const channel = data?.supportChannel === "whatsapp" ? "whatsapp" : "chat";
        setSupportChannel(channel);
      } catch {
        if (active) {
          setSupportChannel("chat");
        }
      }
    };
    fetchConfig();
    return () => {
      active = false;
    };
  }, []);

  const ensurePosition = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    setPosition((prev) => {
      if (prev) {
        const bubbleWidth = bubbleRef.current?.offsetWidth ?? 180;
        const bubbleHeight = bubbleRef.current?.offsetHeight ?? 80;
        return {
          top: clamp(prev.top, MIN_MARGIN, window.innerHeight - bubbleHeight - MIN_MARGIN),
          left: clamp(prev.left, MIN_MARGIN, window.innerWidth - bubbleWidth - MIN_MARGIN),
        };
      }
      const initialTop = window.innerHeight - 180;
      const initialLeft = window.innerWidth - 220;
      return {
        top: clamp(initialTop, MIN_MARGIN, window.innerHeight - 140),
        left: clamp(initialLeft, MIN_MARGIN, window.innerWidth - 200),
      };
    });
  }, []);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => {
      setCurrentPreview(null);
      currentRef.current = null;
    }, BUBBLE_HIDE_DELAY);
  }, [clearHideTimeout]);

  const showNextPreview = useCallback(() => {
    if (queueRef.current.length === 0) {
      setCurrentPreview(null);
      currentRef.current = null;
      clearHideTimeout();
      return;
    }

    const next = queueRef.current.shift();
    if (!next) {
      return;
    }

    currentRef.current = next;
    setCurrentPreview(next);
    scheduleHide();
  }, [clearHideTimeout, scheduleHide]);

  const enqueuePreview = useCallback(
    (preview: BubblePreview) => {
      queueRef.current.push(preview);
      if (!currentRef.current) {
        showNextPreview();
      }
    },
    [showNextPreview],
  );

  const handleMessageEvent = useCallback(
    (detail: SupportMessageDetail | null | undefined) => {
      if (!detail) {
        return;
      }

      const messageKey = `${detail.whatsappId}:${detail.message.id}`;
      if (seenMessagesRef.current.has(messageKey)) {
        return;
      }
      seenMessagesRef.current.add(messageKey);

      const existing = threadsRef.current[detail.whatsappId];
      threadsRef.current[detail.whatsappId] = {
        whatsappId: detail.whatsappId,
        customerName: existing?.customerName ?? null,
        profileName: existing?.profileName ?? null,
        lastMessagePreview: detail.message.text ?? existing?.lastMessagePreview ?? null,
        lastMessageAt: detail.message.timestamp,
        status: "open",
        within24h: existing?.within24h,
        minutesLeft24h: existing?.minutesLeft24h,
      };

      const threadInfo = threadsRef.current[detail.whatsappId];
      const label = threadInfo?.customerName
        || threadInfo?.profileName
        || detail.whatsappId;

      enqueuePreview({
        id: messageKey,
        whatsappId: detail.whatsappId,
        customerLabel: label,
        message: getMessagePreview(detail.message),
        timestamp: detail.message.timestamp,
      });
    },
    [enqueuePreview],
  );

  const handleThreadUpdate = useCallback((detail: SupportThreadUpdateDetail | null | undefined) => {
    if (!detail || !detail.whatsappId) {
      return;
    }

    threadsRef.current[detail.whatsappId] = detail;
  }, []);

  const dismissCurrent = useCallback(() => {
    clearHideTimeout();
    setCurrentPreview(null);
    currentRef.current = null;
  }, [clearHideTimeout]);

  const handleBubblePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!bubbleRef.current) {
      return;
    }

    pointerMovedRef.current = false;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    isDraggingRef.current = true;
    const rect = bubbleRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    bubbleRef.current.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    if (typeof document !== "undefined" && overscrollRestoreRef.current === null) {
      overscrollRestoreRef.current = {
        body: document.body.style.overscrollBehavior || "",
        html: document.documentElement.style.overscrollBehavior || "",
      };
      document.body.style.overscrollBehavior = "contain";
      document.documentElement.style.overscrollBehavior = "contain";
    }
  };

  const handleBubblePointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!isDraggingRef.current) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    if (bubbleRef.current && !bubbleRef.current.hasPointerCapture(event.pointerId)) {
      try {
        bubbleRef.current.setPointerCapture(event.pointerId);
      } catch {}
    }

    const start = pointerStartRef.current;
    if (start) {
      const deltaX = Math.abs(event.clientX - start.x);
      const deltaY = Math.abs(event.clientY - start.y);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        pointerMovedRef.current = true;
      }
    }

    const bubbleWidth = bubbleRef.current?.offsetWidth ?? 180;
    const bubbleHeight = bubbleRef.current?.offsetHeight ?? 80;
    const nextLeft = clamp(
      event.clientX - dragOffsetRef.current.x,
      MIN_MARGIN,
      window.innerWidth - bubbleWidth - MIN_MARGIN,
    );
    const nextTop = clamp(
      event.clientY - dragOffsetRef.current.y,
      MIN_MARGIN,
      window.innerHeight - bubbleHeight - MIN_MARGIN,
    );
    pendingPosRef.current = { top: nextTop, left: nextLeft };
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        if (pendingPosRef.current) {
          setPosition(pendingPosRef.current);
        }
      });
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const handleBubblePointerUp: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!isDraggingRef.current) {
      return;
    }

    isDraggingRef.current = false;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingPosRef.current = null;
    bubbleRef.current?.releasePointerCapture(event.pointerId);

    const wasClick = !pointerMovedRef.current;
    pointerMovedRef.current = false;
    pointerStartRef.current = null;
    event.stopPropagation();
    event.preventDefault();
    if (typeof document !== "undefined" && overscrollRestoreRef.current !== null) {
      document.body.style.overscrollBehavior = overscrollRestoreRef.current.body;
      document.documentElement.style.overscrollBehavior = overscrollRestoreRef.current.html;
      overscrollRestoreRef.current = null;
    }

    if (wasClick && currentRef.current) {
      const threadId = currentRef.current.whatsappId;

      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("support:target-thread", threadId);
        } catch {
          // ignore storage errors
        }

        const event = new CustomEvent("user-support:open", {
          cancelable: true,
          detail: { whatsappId: threadId },
        });
        const prevented = !window.dispatchEvent(event);
        if (prevented) {
          dismissCurrent();
          return;
        }
      }

      if (pathname?.includes("/dashboard/user/conversas")) {
        window.dispatchEvent(
          new CustomEvent("support:open-thread", {
            detail: { whatsappId: threadId },
          }),
        );
      } else {
        router.push("/dashboard/user/conversas");
      }
      dismissCurrent();
      return;
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    // restaurar posição persistida
    try {
      const key = "support-bubble-pos";
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.top === "number" && typeof parsed?.left === "number") {
          setPosition({
            top: clamp(parsed.top, MIN_MARGIN, window.innerHeight - 140),
            left: clamp(parsed.left, MIN_MARGIN, window.innerWidth - 200),
          });
        }
      }
    } catch {
      /* ignore */
    }

    ensurePosition();
    const handleResize = () => ensurePosition();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [ensurePosition]);

  useEffect(() => () => clearHideTimeout(), [clearHideTimeout]);

  useEffect(() => {
    if (typeof window === "undefined" || !position) return;
    try {
      localStorage.setItem("support-bubble-pos", JSON.stringify(position));
    } catch {
      /* ignore */
    }
  }, [position]);

  useEffect(() => {
    if (!isSupportPage && !isHiddenPage) {
      return;
    }
    clearHideTimeout();
    queueRef.current = [];
    currentRef.current = null;
    setCurrentPreview(null);
  }, [clearHideTimeout, isHiddenPage, isSupportPage]);

  // Quando o modal de suporte do usuário estiver aberto, ocultar a bolha
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOpened = () => {
      setIsSupportModalOpen(true);
      clearHideTimeout();
      queueRef.current = [];
      currentRef.current = null;
      setCurrentPreview(null);
    };
    const handleClosed = () => {
      setIsSupportModalOpen(false);
    };
    window.addEventListener("user-support:modal-opened", handleOpened);
    window.addEventListener("user-support:modal-closed", handleClosed);
    return () => {
      window.removeEventListener("user-support:modal-opened", handleOpened);
      window.removeEventListener("user-support:modal-closed", handleClosed);
    };
  }, [clearHideTimeout]);

  useEffect(() => {
    if (isUserRole !== true) {
      return;
    }

    const handleMessage = (event: Event) => {
      const detail = (event as CustomEvent<SupportMessageDetail>).detail;
      handleMessageEvent(detail);
    };

    const handleThread = (event: Event) => {
      const detail = (event as CustomEvent<SupportThreadUpdateDetail>).detail;
      handleThreadUpdate(detail);
    };

    window.addEventListener("support:message-created", handleMessage as EventListener);
    window.addEventListener("support:thread-updated", handleThread as EventListener);

    return () => {
      window.removeEventListener("support:message-created", handleMessage as EventListener);
      window.removeEventListener("support:thread-updated", handleThread as EventListener);
    };
  }, [handleMessageEvent, handleThreadUpdate, isUserRole]);

  useEffect(() => {
    if (!currentPreview && queueRef.current.length > 0) {
      showNextPreview();
    }
  }, [currentPreview, showNextPreview]);

  if (supportChannel === "loading") {
    return null;
  }

  if (supportChannel !== "chat") {
    return null;
  }

  if (isUserRole !== true) {
    return null;
  }

  if (isSupportPage || isHiddenPage || isSupportModalOpen || !position || !currentPreview) {
    return null;
  }

  return (
    <div
      ref={bubbleRef}
      role="button"
      tabIndex={0}
      onPointerDown={handleBubblePointerDown}
      onPointerMove={handleBubblePointerMove}
      onPointerUp={handleBubblePointerUp}
      onPointerCancel={handleBubblePointerUp}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (currentRef.current) {
            if (pathname?.includes("/dashboard/user/conversas")) {
              window.dispatchEvent(
                new CustomEvent("support:open-thread", {
                  detail: { whatsappId: currentRef.current.whatsappId },
                }),
              );
            } else {
              try {
                sessionStorage.setItem("support:target-thread", currentRef.current.whatsappId);
              } catch {
                // ignore storage errors
              }
              router.push("/dashboard/user/conversas");
            }
            dismissCurrent();
          }
        } else if (event.key === "Escape") {
          dismissCurrent();
        }
      }}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 1080,
        cursor: "grab",
        userSelect: "none",
        touchAction: "none",
        boxShadow: "0 12px 32px rgba(30, 41, 59, 0.35)",
        borderRadius: "999px",
        background: "#1f2937",
        color: "#fff",
        padding: "12px 18px",
        maxWidth: 280,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: "#3b82f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 600,
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {(currentPreview.customerLabel?.trim()?.[0] ?? "?").toUpperCase()}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>
          {currentPreview.customerLabel}
        </span>
        <span
          style={{
            fontSize: 13,
            lineHeight: 1.2,
            color: "#e2e8f0",
            maxWidth: 200,
            wordBreak: "break-word",
          }}
        >
          {currentPreview.message}
        </span>
      </div>
      <button
        type="button"
        aria-label="Fechar notificação de suporte"
        onClick={(event) => {
          event.stopPropagation();
          dismissCurrent();
        }}
        style={{
          background: "transparent",
          border: "none",
          color: "#cbd5f5",
          fontSize: 18,
          lineHeight: 1,
          padding: 0,
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
};

export default SupportFloatingBubble;
