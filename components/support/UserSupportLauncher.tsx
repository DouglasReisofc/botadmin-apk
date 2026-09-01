"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { usePathname } from "next/navigation";
import { IconBrandWhatsapp, IconMessageChatbot } from "@tabler/icons-react";

import UserConversationsClient from "components/conversations/UserConversationsClient";

type RoleState = "loading" | "user" | "admin" | "guest";
type SupportChannel = "chat" | "whatsapp";
type SupportConfig = {
  channel: SupportChannel;
  whatsappNumber: string | null;
  testGroups?: { title: string; url: string }[];
};

const UserSupportLauncher = () => {
  const pathname = usePathname();
  const [role, setRole] = useState<RoleState>("loading");
  const [show, setShow] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [initialThreadId, setInitialThreadId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pendingThreadRef = useRef<string | null>(null);
  const [supportConfig, setSupportConfig] = useState<SupportConfig | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    let active = true;
    const fetchRole = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!active) {
          return;
        }
        const fetchedRole = data?.user?.role;
        if (fetchedRole === "user") {
          setRole("user");
        } else if (fetchedRole === "admin") {
          setRole("admin");
        } else {
          setRole("guest");
        }
      } catch {
        if (active) {
          setRole("guest");
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
    const fetchSupportConfig = async () => {
      try {
        const response = await fetch("/api/public/support-config", { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!active) {
          return;
        }
        const channel: SupportChannel = data?.supportChannel === "whatsapp" ? "whatsapp" : "chat";
        const whatsappNumber =
          typeof data?.supportWhatsappNumber === "string" && data.supportWhatsappNumber
            ? data.supportWhatsappNumber
            : null;
        const testGroups =
          Array.isArray(data?.testGroups) && data.testGroups.length > 0
            ? data.testGroups
                .map((group: { title?: unknown; url?: unknown }) => ({
                  title: typeof group?.title === "string" ? group.title : "",
                  url: typeof group?.url === "string" ? group.url : "",
                }))
                .filter((group) => group.title && group.url)
            : [];
        setSupportConfig({ channel, whatsappNumber, testGroups });
      } catch {
        if (active) {
          setSupportConfig({ channel: "chat", whatsappNumber: null, testGroups: [] });
        }
      }
    };
    fetchSupportConfig();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (role !== "user" && pendingThreadRef.current) {
      pendingThreadRef.current = null;
    }
    if (role === "user" && pendingThreadRef.current) {
      setInitialThreadId(pendingThreadRef.current);
      setRefreshKey((value) => value + 1);
      setShow(true);
      pendingThreadRef.current = null;
    }
  }, [role]);

  const handleOpenSupport = useCallback(
    (event?: CustomEvent<{ whatsappId?: string | null }>) => {
      if (!supportConfig || supportConfig.channel === "whatsapp") {
        return;
      }
      const threadId = event?.detail?.whatsappId ?? null;
      if (role !== "user") {
        pendingThreadRef.current = threadId;
        return;
      }
      if (event && event.cancelable) {
        event.preventDefault();
      }
      pendingThreadRef.current = null;
      setInitialThreadId(threadId);
      setRefreshKey((value) => value + 1);
      setShow(true);
    },
    [role, supportConfig],
  );

  useEffect(() => {
    if (supportConfig?.channel !== "chat" || typeof window === "undefined") {
      return;
    }
    const listener = (event: Event) => {
      handleOpenSupport(event as CustomEvent<{ whatsappId?: string | null }>);
    };
    window.addEventListener("user-support:open", listener as EventListener);
    return () => {
      window.removeEventListener("user-support:open", listener as EventListener);
    };
  }, [handleOpenSupport, supportConfig?.channel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("user-support-launcher-pos");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (
          parsed &&
          typeof parsed.x === "number" &&
          typeof parsed.y === "number" &&
          Number.isFinite(parsed.x) &&
          Number.isFinite(parsed.y)
        ) {
          setPosition({ x: parsed.x, y: parsed.y });
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Unread counter for the floating button (user-side)
  useEffect(() => {
    if (supportConfig?.channel !== "chat") {
      setUnreadTotal(0);
      return;
    }
    const readCounts = () => {
      try {
        const raw = sessionStorage.getItem("support-unread-counts");
        if (!raw) {
          setUnreadTotal(0);
          return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
          setUnreadTotal(0);
          return;
        }
        const total = Object.values(parsed as Record<string, number>).reduce((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
        setUnreadTotal(total);
      } catch {
        setUnreadTotal(0);
      }
    };

    readCounts();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ counts?: Record<string, number> }>).detail;
      if (detail?.counts && typeof detail.counts === "object") {
        const total = Object.values(detail.counts).reduce((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
        setUnreadTotal(total);
      } else {
        readCounts();
      }
    };
    window.addEventListener("support:unread-counts", handler as EventListener);
    return () => window.removeEventListener("support:unread-counts", handler as EventListener);
  }, [supportConfig?.channel]);

  // Exibe o botão sempre que for usuário logado, inclusive em /dashboard/user/conversas
  const whatsappLink =
    supportConfig?.whatsappNumber && supportConfig.whatsappNumber.length > 0
      ? `https://wa.me/${supportConfig.whatsappNumber}`
      : null;
  const hasTestGroups = Boolean(supportConfig?.testGroups && supportConfig.testGroups.length > 0);
  const shouldRenderLauncher = useMemo(() => {
    if (!supportConfig) {
      return false;
    }
    if (supportConfig.channel === "whatsapp") {
      return role === "user" && (Boolean(whatsappLink) || hasTestGroups);
    }
    return role === "user";
  }, [role, supportConfig, whatsappLink, hasTestGroups]);

  const handleButtonClick = () => {
    setInitialThreadId(null);
    setRefreshKey((value) => value + 1);
    setShow(true);
  };

  const handleWhatsappLauncherClick = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
  ) => {
    if (!hasTestGroups) {
      return;
    }
    event.preventDefault();
    setShowOptions((current) => !current);
  };

  const handleCloseModal = () => {
    setShow(false);
  };

  // Notifica outros componentes (ex.: bolha flutuante) se o modal está aberto
  useEffect(() => {
    if (typeof window === "undefined" || supportConfig?.channel !== "chat") return;
    try {
      const eventName = show ? "user-support:modal-opened" : "user-support:modal-closed";
      window.dispatchEvent(new CustomEvent(eventName));
    } catch {}
  }, [show, supportConfig]);

  useEffect(() => {
    if (!showOptions) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (launcherRef.current && !launcherRef.current.contains(event.target as Node)) {
        setShowOptions(false);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowOptions(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [showOptions]);

  useEffect(() => {
    setShowOptions(false);
  }, [supportConfig?.channel]);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const handleMove = (event: MouseEvent) => {
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current = { x: event.clientX, y: event.clientY };
      setPosition((prev) => {
        const base = prev ?? { x: 0, y: 0 };
        return { x: base.x + dx, y: base.y + dy };
      });
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - dragRef.current.x;
      const dy = touch.clientY - dragRef.current.y;
      dragRef.current = { x: touch.clientX, y: touch.clientY };
      setPosition((prev) => {
        const base = prev ?? { x: 0, y: 0 };
        return { x: base.x + dx, y: base.y + dy };
      });
    };
    const handleUp = () => {
      endDrag();
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    document.addEventListener("touchmove", handleTouchMove);
    document.addEventListener("touchend", handleUp);
    document.addEventListener("touchcancel", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleUp);
      document.removeEventListener("touchcancel", handleUp);
    };
  }, [dragging]);

  const beginDrag = (clientX: number, clientY: number) => {
    if (!launcherRef.current) return;
    const rect = launcherRef.current.getBoundingClientRect();
    setPosition((prev) => prev ?? { x: rect.left, y: rect.top });
    dragRef.current = { x: clientX, y: clientY };
    setDragging(true);
    // prevent text selection
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
    }
  };

  const endDrag = () => {
    setDragging(false);
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "";
    }
    if (position && typeof window !== "undefined") {
      window.localStorage.setItem("user-support-launcher-pos", JSON.stringify(position));
    }
  };

  const startDragMouse = (event: React.MouseEvent) => {
    event.preventDefault();
    beginDrag(event.clientX, event.clientY);
  };

  const startDragTouch = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    beginDrag(touch.clientX, touch.clientY);
  };

  // Mantém a lógica anterior: só renderiza quando usuário autenticado,
  // mas permite exibir o modal caso já esteja aberto por evento programático.
  const isBotWorkspacePage =
    pathname === "/dashboard/user" ||
    pathname?.startsWith("/dashboard/user/whatsapp-conversas");

  if (!supportConfig || isBotWorkspacePage) {
    return null;
  }

  if (supportConfig.channel !== "chat" && role !== "user") {
    return null;
  }

  if (supportConfig.channel === "chat" && role !== "user" && !show) {
    return null;
  }

  const isWhatsappMode = supportConfig.channel === "whatsapp";
  const groupOptions = supportConfig.testGroups ?? [];

  return (
    <>
      {shouldRenderLauncher && (
        <div
          className="user-support-launcher"
          ref={launcherRef}
          style={
            position
              ? { left: position.x, top: position.y, right: "auto", bottom: "auto", transform: "none" }
              : undefined
          }
        >
          {isWhatsappMode ? (
            <Button
              as="a"
              href={whatsappLink ?? undefined}
              target="_blank"
              rel="noreferrer"
              variant="success"
              className="user-support-launcher__button user-support-launcher__button--whatsapp shadow-lg"
              disabled={!whatsappLink && !hasTestGroups}
              onClick={handleWhatsappLauncherClick}
              onMouseDown={startDragMouse}
              onTouchStart={startDragTouch}
            >
              <IconBrandWhatsapp size={22} />
              <span>Suporte</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              className="user-support-launcher__button shadow-lg"
              onClick={handleButtonClick}
              onMouseDown={startDragMouse}
              onTouchStart={startDragTouch}
            >
              <IconMessageChatbot size={22} />
              <span>Suporte</span>
              {unreadTotal > 0 ? (
                <span className="user-support-launcher__badge">
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </span>
              ) : null}
            </Button>
          )}

          {isWhatsappMode && hasTestGroups && showOptions && (
            <div className="user-support-launcher__card shadow-lg">
              <div className="user-support-launcher__card-header">Suporte e teste rápido</div>
              <div className="user-support-launcher__card-body">
                <p className="user-support-launcher__card-helper">
                  Deseja testar o robô em um dos nossos grupos? Escolha um grupo para entrar.
                </p>
                {groupOptions.map((group, index) => (
                  <a
                    key={`${group.title}-${index}`}
                    href={group.url}
                    target="_blank"
                    rel="noreferrer"
                    className="user-support-launcher__card-link"
                    onClick={() => setShowOptions(false)}
                  >
                    <IconBrandWhatsapp size={18} />
                    <span>{group.title}</span>
                  </a>
                ))}
                {whatsappLink && (
                  <a
                    href={whatsappLink}
                    target="_blank"
                    rel="noreferrer"
                    className="user-support-launcher__card-link user-support-launcher__card-link--support"
                    onClick={() => setShowOptions(false)}
                  >
                    <IconMessageChatbot size={18} />
                    <span>Falar com o suporte</span>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!isWhatsappMode && (
        <Modal show={show} onHide={handleCloseModal} size="lg" centered scrollable backdrop="static">
          <Modal.Header closeButton>
            <Modal.Title>Conversar com o suporte</Modal.Title>
          </Modal.Header>
          <Modal.Body className="p-0">
            <UserConversationsClient
              hideThreadList
              initialThreadId={initialThreadId}
              refreshKey={refreshKey}
              onRequestClose={handleCloseModal}
            />
          </Modal.Body>
        </Modal>
      )}

      <style jsx>{`
        .user-support-launcher {
          position: fixed;
          z-index: 9800;
          bottom: 1.5rem;
          right: 1.5rem;
          cursor: grab;
        }

        .user-support-launcher__button {
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          font-weight: 600;
          box-shadow: 0 1rem 2rem rgba(13, 110, 253, 0.25);
          animation: supportPulse 3.5s ease-in-out infinite;
          }

        .user-support-launcher__button {
          position: relative;
        }
        .user-support-launcher__button--whatsapp {
          background-color: #25d366;
          border-color: #1ebe5d;
        }
        .user-support-launcher__button--whatsapp:hover {
          background-color: #1ebe5d;
          border-color: #19a554;
        }
        .user-support-launcher__card {
          position: absolute;
          right: 0;
          bottom: 64px;
          width: 320px;
          background: #ffffff;
          border-radius: 14px;
          border: 1px solid rgba(0, 0, 0, 0.06);
          overflow: hidden;
          z-index: 2;
        }
        .user-support-launcher__card-header {
          padding: 10px 12px;
          font-weight: 700;
          font-size: 14px;
          background: #f6f6f6;
          border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        }
        .user-support-launcher__card-body {
          padding: 8px 10px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .user-support-launcher__card-helper {
          margin: 0 0 4px;
          font-size: 13px;
          color: #475569;
          line-height: 1.35;
        }
        .user-support-launcher__card-link {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          text-decoration: none;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          transition: all 0.2s ease;
          font-weight: 600;
        }
        .user-support-launcher__card-link:hover {
          background: #f0fdf4;
          border-color: #bbf7d0;
        }
        .user-support-launcher__card-link--support {
          background: #1ebe5d;
          border-color: #1ebe5d;
          color: #fff;
        }
        .user-support-launcher__card-link--support:hover {
          background: #16a34a;
          border-color: #16a34a;
          color: #fff;
        }
        .user-support-launcher__badge {
          position: absolute;
          top: -6px;
          right: -6px;
          background: #dc3545;
          color: #fff;
          min-width: 20px;
          height: 20px;
          border-radius: 999px;
          font-size: 12px;
          line-height: 20px;
          text-align: center;
          font-weight: 700;
          padding: 0 4px;
          box-shadow: 0 4px 10px rgba(220, 53, 69, 0.35);
        }

        @keyframes supportPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(13, 110, 253, 0.35);
          }
          60% {
            box-shadow: 0 0 0 14px rgba(13, 110, 253, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(13, 110, 253, 0);
          }
        }

        @media (max-width: 575.98px) {
          .user-support-launcher {
            bottom: 1rem;
            right: 1rem;
          }
          .user-support-launcher__button {
            padding: 0.65rem 1.2rem;
          }
        }
      `}</style>
    </>
  );
};

export default UserSupportLauncher;
