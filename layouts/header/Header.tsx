"use client";
//import node module libraries
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMediaQuery } from "react-responsive";
import { IconArrowBarLeft, IconArrowBarRight, IconBell, IconMenu2 } from "@tabler/icons-react";
import { Container, ListGroup, Navbar, Button } from "react-bootstrap";

//import custom components
import UserMenu from "./UserMenu";
import Flex from "components/common/Flex";
import NoficationList from "components/common/NoficationList";
import OffcanvasSidebar from "layouts/OffcanvasSidebar";
import BotAdminAffiliateWalletDropdown from "components/payments/BotAdminAffiliateWalletDropdown";
import ThemeToggle from "components/theme/ThemeToggle";

//import custom hooks
import useMenu from "hooks/useMenu";
import { usePageTitle } from "components/common/page-title-context";

import type { SessionUser } from "types/auth";
import type { UserNotification } from "types/notifications";
import type { UserPlanStatus } from "types/plans";

type RealtimeNotificationPayload = {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type SupportMessageEventDetail = {
  userId?: number;
  whatsappId: string;
  message: {
    id: number;
    direction: "inbound" | "outbound";
    messageType: string;
    text: string | null;
    timestamp: string;
    senderUserId: number | null;
    senderRole: "user" | "admin" | "contact" | "system";
  };
};

interface HeaderProps {
  user: SessionUser;
  siteSettings?: {
    siteName: string;
    logoUrl?: string | null;
  };
  planSnapshot?: {
    status: UserPlanStatus;
    balance: number;
  };
}

const isSupportNotification = (notification: UserNotification): boolean => {
  const meta = notification.metadata as { source?: unknown } | null;
  return Boolean(meta && typeof meta.source === "string" && meta.source === "support-local");
};

const buildSupportKey = (whatsappId: string, userId?: number) =>
  userId != null ? `${userId}:${whatsappId}` : whatsappId;

const FALLBACK_TITLES: Array<{ match: (path: string) => boolean; title: string; subtitle?: string }> = [
  {
    match: (path) => path === "/dashboard/user",
    title: "Painel",
    subtitle: "Confira o resumo do seu plano e dos recursos contratados.",
  },
  {
    match: (path) => path.startsWith("/dashboard/user/grupos"),
    title: "Grupos do bot",
  },
  {
    match: (path) => path.startsWith("/dashboard/user/campanhas"),
    title: "Campanhas e anúncios",
    subtitle: "Configure envios em massa para grupos, status e canais.",
  },
  {
    match: (path) => path.startsWith("/dashboard/user/pagamentos"),
    title: "Pagamentos",
    subtitle: "Acompanhe cobranças, webhooks e integrações financeiras.",
  },
];

const Header: React.FC<HeaderProps> = ({ user, siteSettings, planSnapshot }) => {
  const [mounted, setMounted] = useState(false);
  const [isNoficationOpen, setIsNotificationOpen] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { toggleMenuHandler, handleCollapsed } = useMenu();
  const router = useRouter();
  const pathname = usePathname();
  const { title: contextualTitle, subtitle: contextualSubtitle } = usePageTitle();
  const supportInboundCacheRef = useRef<
    Map<
      string,
      {
        userId?: number;
        messageId: number;
        text: string | null;
        timestamp: string;
        messageType: string;
      }
    >
  >(new Map());

  const isTablet = useMediaQuery({ maxWidth: 990 });

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", {
        method: "GET",
        headers: {
          "Cache-Control": "no-store",
        },
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const remoteList: UserNotification[] = Array.isArray(data.notifications)
        ? data.notifications
        : [];
      setNotifications((previous) => {
        const supportLocal = previous.filter(isSupportNotification);
        return [...supportLocal, ...remoteList];
      });
    } catch {
      // ignore errors silently for header badge
    }
  }, []);

  const handleOpenNotifications = useCallback(async () => {
    await loadNotifications();
    setIsNotificationOpen(true);
  }, [loadNotifications]);

  const handleMarkAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setNotifications((previous) =>
      previous.map((notification) =>
        isSupportNotification(notification)
          ? { ...notification, isRead: true, readAt: notification.readAt ?? now }
          : notification,
      ),
    );

    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notificationIds: "all" }),
      });

      if (!response.ok) {
        return;
      }

      await loadNotifications();
    } catch {
      // ignore temporary errors
    }
  }, [loadNotifications]);

  const handleClearAll = useCallback(async () => {
    setNotifications((previous) => previous.filter((notification) => !isSupportNotification(notification)));
    try {
      const response = await fetch("/api/notifications", { method: "DELETE" });
      if (!response.ok) return;
      await loadNotifications();
    } catch {
      // ignore
    }
  }, [loadNotifications]);

  // Permite abrir uma notificação específica (deep link via push)
  const [openNotificationId, setOpenNotificationId] = useState<number | null>(null);
  useEffect(() => {
    setUnreadCount(
      notifications.reduce((sum, notification) => (notification.isRead ? sum : sum + 1), 0),
    );
  }, [notifications]);
  useEffect(() => {
    const tryOpenFromStorage = async () => {
      try {
        const raw = sessionStorage.getItem("notifications:open-id");
        if (raw) {
          sessionStorage.removeItem("notifications:open-id");
          const id = Number.parseInt(raw, 10);
          if (Number.isFinite(id) && id > 0) {
            await loadNotifications();
            setOpenNotificationId(id);
            setIsNotificationOpen(true);
          }
        }
      } catch {}
    };
    void tryOpenFromStorage();

    const handleOpenEvent = async (ev: Event) => {
      const det = (ev as CustomEvent<{ id: number }>).detail;
      if (det?.id) {
        await loadNotifications();
        setOpenNotificationId(det.id);
        setIsNotificationOpen(true);
      }
    };
    window.addEventListener("notifications:open", handleOpenEvent as EventListener);
    return () => window.removeEventListener("notifications:open", handleOpenEvent as EventListener);
  }, [loadNotifications]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const requestFullRefresh = () => {
      void loadNotifications();
    };

    const handleRealtimeNotification = (event: Event) => {
      const rawDetail = (event as CustomEvent<any>).detail;
      const rawUserId = Number(rawDetail?.userId);
      const eventUserId = Number.isFinite(rawUserId) && rawUserId > 0 ? rawUserId : null;
      if (eventUserId != null && eventUserId !== user.id) {
        return;
      }
      const detail = rawDetail && typeof rawDetail === "object" && rawDetail.notification
        ? (rawDetail.notification as RealtimeNotificationPayload)
        : (rawDetail as RealtimeNotificationPayload);

      if (!detail || typeof detail.id !== "number") {
        requestFullRefresh();
        return;
      }

      setNotifications((previous) => {
        const existingIndex = previous.findIndex((notification) => notification.id === detail.id);

        if (existingIndex !== -1) {
          const existing = previous[existingIndex];
          const updated: UserNotification = {
            ...existing,
            type: detail.type,
            title: detail.title,
            message: detail.message,
            metadata: detail.metadata ?? existing.metadata ?? null,
            isRead: detail.isRead,
            createdAt: detail.createdAt,
            readAt: detail.isRead ? existing.readAt : null,
          };

          const next = [...previous];
          next[existingIndex] = updated;
          return next;
        }

        const freshNotification: UserNotification = {
          id: detail.id,
          userId: user.id,
          type: detail.type,
          title: detail.title,
          message: detail.message,
          metadata: detail.metadata ?? null,
          isRead: detail.isRead,
          createdAt: detail.createdAt,
          readAt: null,
        };
        return [freshNotification, ...previous];
      });

      requestFullRefresh();
    };

    window.addEventListener("support:new-inbound", requestFullRefresh);
    window.addEventListener("support:new-outbound", requestFullRefresh);
    window.addEventListener("purchase:created", requestFullRefresh as EventListener);
    window.addEventListener("notification:created", handleRealtimeNotification as EventListener);
    return () => {
      window.removeEventListener("support:new-inbound", requestFullRefresh);
      window.removeEventListener("support:new-outbound", requestFullRefresh);
      window.removeEventListener("purchase:created", requestFullRefresh as EventListener);
      window.removeEventListener("notification:created", handleRealtimeNotification as EventListener);
    };
  }, [loadNotifications, user.id]);

  useEffect(() => {
    if (user.role !== "user" && user.role !== "admin") {
      return;
    }

    const messageCache = supportInboundCacheRef.current;

    const handleMessageCreated = (event: Event) => {
      try {
        const detail = (event as CustomEvent<SupportMessageEventDetail>).detail;
        if (!detail || detail.message.direction !== "inbound") {
          return;
        }
        const cacheKey = buildSupportKey(detail.whatsappId, detail.userId);
        messageCache.set(cacheKey, {
          userId: detail.userId,
          messageId: detail.message.id,
          text: detail.message.text,
          timestamp: detail.message.timestamp,
          messageType: detail.message.messageType,
        });
      } catch (error) {
        console.error("Failed to cache support message", error);
      }
    };

    const handleSupportInbound = (event: Event) => {
      try {
        const detail = (event as CustomEvent<{ whatsappId?: string; messageId?: number; userId?: number }>).detail;
        const whatsappId = typeof detail?.whatsappId === "string" ? detail.whatsappId.trim() : "";
        if (!whatsappId) {
          return;
        }

        const userId = typeof detail?.userId === "number" ? detail.userId : undefined;
        const cacheKey = buildSupportKey(whatsappId, userId);
        const cached = messageCache.get(cacheKey);
        const messageId = detail?.messageId ?? cached?.messageId ?? Date.now();

        setNotifications((previous) => {
          const alreadyExists = previous.some((notification) => {
            if (!isSupportNotification(notification)) {
              return false;
            }
            const meta = notification.metadata as { messageId?: unknown; userId?: unknown } | null;
            return meta?.messageId === messageId && meta?.userId === userId;
          });

          if (alreadyExists) {
            return previous;
          }

          const previewText = cached?.text?.trim() ?? "";
          const createdAt = cached?.timestamp ?? new Date().toISOString();
          const targetRoute = user.role === "admin"
            ? "/dashboard/admin/suporte"
            : "/dashboard/user/conversas";

          const notification: UserNotification = {
            id: -Math.floor(Date.now() + Math.random() * 1000),
            userId: user.id,
            type: "support_inbound",
            title: "Nova mensagem no suporte",
            message:
              previewText.length > 0
                ? previewText
                : "Você recebeu uma nova mensagem no suporte.",
            metadata: {
              source: "support-local",
              route: targetRoute,
              whatsappId,
              userId,
              messageId,
              preview: previewText,
              messageType: cached?.messageType ?? "text",
            },
            isRead: false,
            createdAt,
            readAt: null,
          };

          return [notification, ...previous];
        });

        // Remove para evitar crescimento indefinido do cache
        messageCache.delete(cacheKey);
      } catch (error) {
        console.error("Failed to handle support inbound notification", error);
      }
    };
    const handleSupportOutbound = (event: Event) => {
      try {
        const detail = (event as CustomEvent<{ whatsappId?: string; messageId?: number; userId?: number }>).detail;
        const whatsappId = typeof detail?.whatsappId === "string" ? detail.whatsappId.trim() : "";
        if (!whatsappId) {
          return;
        }

        const userId = typeof detail?.userId === "number" ? detail.userId : undefined;
        const cacheKey = buildSupportKey(whatsappId, userId);
        // Outbound support events are sync-only. A user/admin must not receive a
        // notification for a message they just sent, even in another open tab.
        messageCache.delete(cacheKey);
      } catch (error) {
        console.error("Failed to handle support outbound notification", error);
      }
    };

    window.addEventListener("support:message-created", handleMessageCreated as EventListener);
    window.addEventListener("support:new-inbound", handleSupportInbound as EventListener);
    window.addEventListener("support:new-outbound", handleSupportOutbound as EventListener);

    return () => {
      window.removeEventListener("support:message-created", handleMessageCreated as EventListener);
      window.removeEventListener("support:new-inbound", handleSupportInbound as EventListener);
      window.removeEventListener("support:new-outbound", handleSupportOutbound as EventListener);
    };
  }, [user.role, user.id, setNotifications]);

  useEffect(() => {
    const handleThreadOpened = (event: Event) => {
      const detail = (event as CustomEvent<{ whatsappId?: string; userId?: number }>).detail;
      const whatsappId = typeof detail?.whatsappId === "string" ? detail.whatsappId.trim() : "";
      if (!whatsappId) {
        return;
      }

      const targetKey = buildSupportKey(whatsappId, detail?.userId);
      const now = new Date().toISOString();
      setNotifications((previous) =>
        previous.map((notification) => {
          if (!isSupportNotification(notification) || notification.isRead) {
            return notification;
          }
          const meta = notification.metadata as { whatsappId?: unknown; userId?: unknown } | null;
          const metaKey = meta && typeof meta.whatsappId === "string"
            ? buildSupportKey(meta.whatsappId, typeof meta.userId === "number" ? meta.userId : undefined)
            : null;
          if (metaKey === targetKey) {
            return { ...notification, isRead: true, readAt: notification.readAt ?? now };
          }
          return notification;
        }),
      );
    };

    window.addEventListener("support:thread-opened", handleThreadOpened as EventListener);
    return () => {
      window.removeEventListener("support:thread-opened", handleThreadOpened as EventListener);
    };
  }, []);

  useEffect(() => {
    // Avoid hydration mismatches between SSR and client for responsive UI
    setMounted(true);
  }, []);

  const handleNotificationItemClick = useCallback(
    async (notification: UserNotification) => {
      const meta = notification.metadata as {
        source?: unknown;
        whatsappId?: unknown;
        userId?: unknown;
        route?: unknown;
      } | null;
      if (meta && meta.source === "support-local" && typeof meta.whatsappId === "string") {
        const whatsappId = meta.whatsappId.trim();
        if (!whatsappId) {
          return true;
        }

        const userIdMeta = typeof meta.userId === "number" ? meta.userId : undefined;
        const targetRoute = typeof meta.route === "string"
          ? meta.route
          : user.role === "admin"
            ? "/dashboard/admin/suporte"
            : "/dashboard/user/conversas";

        const now = new Date().toISOString();
        setNotifications((previous) =>
          previous.map((item) =>
            item.id === notification.id
              ? { ...item, isRead: true, readAt: item.readAt ?? now }
              : item,
          ),
        );

        try {
          sessionStorage.setItem(
            "support:target-thread",
            JSON.stringify({ whatsappId, userId: userIdMeta ?? null }),
          );
        } catch {}

        try {
          if (window.location.pathname?.startsWith(targetRoute)) {
            window.dispatchEvent(
              new CustomEvent("support:open-thread", {
                detail: {
                  whatsappId,
                  ...(userIdMeta != null ? { userId: userIdMeta } : {}),
                },
              }),
            );
          } else {
            router.push(targetRoute);
          }
        } catch {
          router.push(targetRoute);
        }

        setIsNotificationOpen(false);
        return true;
      }
      return false;
    },
    [router, setIsNotificationOpen, setNotifications, user.role],
  );

  const fallbackTitle = useMemo(() => {
    if (!pathname) {
      return null;
    }
    return FALLBACK_TITLES.find((entry) => entry.match(pathname)) ?? null;
  }, [pathname]);
  const pageTitle = contextualTitle ?? fallbackTitle?.title ?? null;
  const pageSubtitle = contextualSubtitle ?? fallbackTitle?.subtitle ?? null;

  if (!mounted) {
    return null;
  }

  return (
    <Fragment>
      <Navbar expand="lg" className="navbar-glass px-0 px-lg-4">
        <Container fluid className="px-lg-0">
          <div className="navbar-main-row d-flex align-items-center flex-nowrap w-100 position-relative gap-3">
          <Flex alignItems="center" className="gap-4 flex-shrink-0">
            {isTablet && (
              <div
                className="d-block d-lg-none"
                style={{ cursor: "pointer" }}
                onClick={() => toggleMenuHandler(true)}
              >
                <IconMenu2 size={24} />
              </div>
            )}
            {isTablet || (
              <div>
                <Link href={"#"} className="sidebar-toggle d-flex p-3">
                  <span
                    className="collapse-mini"
                    onClick={() => handleCollapsed("expanded")}
                  >
                    <IconArrowBarLeft
                      size={20}
                      strokeWidth={1.5}
                      className="text-secondary"
                    />
                  </span>
                  <span
                    className="collapse-expanded"
                    onClick={() => handleCollapsed("collapsed")}
                  >
                    <IconArrowBarRight
                      size={20}
                      strokeWidth={1.5}
                      className="text-secondary"
                    />
                  </span>
                </Link>
              </div>
            )}
            {!isTablet && siteSettings?.siteName && (
              <span className="fw-semibold text-secondary ms-2 d-none d-lg-inline">
                {siteSettings.siteName}
              </span>
            )}
          </Flex>
          {pageTitle ? (
            <div className="navbar-page-title position-absolute top-50 start-50 translate-middle text-center">
              <span className="text-truncate px-2">{pageTitle}</span>
              {pageSubtitle ? (
                <small className="navbar-page-subtitle text-truncate px-2">{pageSubtitle}</small>
              ) : null}
            </div>
          ) : null}
          <ListGroup
            bsPrefix="list-unstyled"
            as={"ul"}
            className="d-flex align-items-center mb-0 gap-2 flex-shrink-0 ms-auto"
          >
            <ListGroup.Item as="li" className="d-none d-lg-flex align-items-center">
              <div
                data-audio-badge-anchor
                style={{
                  position: "relative",
                  height: 34,
                  overflow: "visible",
                }}
              />
            </ListGroup.Item>
            <ListGroup.Item as="li" className="d-flex align-items-center">
              <ThemeToggle compact />
            </ListGroup.Item>
            <ListGroup.Item as="li">
              <Button
                 variant="ghost"
                 className="position-relative btn-icon rounded-circle"
                 onClick={handleOpenNotifications}
              >
                <IconBell size={20} />
                {unreadCount > 0 && (
                  <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger mt-2 ms-n2">
                    {unreadCount}
                    <span className="visually-hidden">notificações não lidas</span>
                  </span>
                )}
              </Button>
            </ListGroup.Item>
            {user.role === "user" ? (
              <ListGroup.Item as="li">
                <BotAdminAffiliateWalletDropdown />
              </ListGroup.Item>
            ) : null}
            <ListGroup.Item as="li">
              <UserMenu user={user} planSnapshot={planSnapshot} />
            </ListGroup.Item>
          </ListGroup>
          </div>
        </Container>
      </Navbar>
      <NoficationList
        isOpen={isNoficationOpen}
        onClose={() => setIsNotificationOpen(false)}
        notifications={notifications}
        onMarkAllRead={handleMarkAllRead}
        onRefresh={loadNotifications}
        onClearAll={handleClearAll}
        openNotificationId={openNotificationId}
        onNotificationClick={handleNotificationItemClick}
        viewerRole={user.role}
      />
      {isTablet && (
        <OffcanvasSidebar
          role={user.role}
          siteSettings={{ siteName: siteSettings?.siteName ?? "StoreBot", logoUrl: siteSettings?.logoUrl ?? null }}
        />
      )}
    </Fragment>
  );
};

export default Header;
