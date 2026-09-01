"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  IconArrowLeft,
  IconBook,
  IconBrandFirebase,
  IconChevronRight,
  IconCloudDownload,
  IconCreditCard,
  IconDeviceMobile,
  IconLayoutDashboard,
  IconLink,
  IconLogout2,
  IconMail,
  IconMenu2,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconSettings,
  IconShield,
  IconShoppingCart,
  IconSpeakerphone,
  IconUsers,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import useSupportUnreadCount from "hooks/useSupportUnreadCount";
import { getAssetPath } from "helper/assetPath";
import AdminBotWorkspaceContent, {
  type AdminWorkspaceContentProps,
} from "components/admin/AdminBotWorkspaceContent";
import {
  ADMIN_MENU_ITEMS,
  ADMIN_MOBILE_BREAKPOINT,
  ADMIN_MOBILE_VIEW_STORAGE_KEY,
  ADMIN_RAIL_ITEMS,
  ADMIN_SECTION_STORAGE_KEY,
  type AdminDetailSection,
  type AdminRailSection,
  getAdminMenuItemsForRail,
  isAdminFullWidthSection,
  resolveAdminDetailSection,
  resolveAdminRailSection,
} from "components/admin/admin-workspace-config";

import styles from "components/bot/BotAdminWorkspace.module.css";
import adminStyles from "components/admin/AdminBotWorkspace.module.css";

type MobileView = "list" | "detail";

const classNames = (...items: Array<string | false | null | undefined>) =>
  items.filter(Boolean).join(" ");

const ADMIN_RAIL_ICONS: Record<AdminRailSection, ReactNode> = {
  dashboard: <IconLayoutDashboard size={18} />,
  support: <IconMail size={18} />,
  users: <IconUsers size={18} />,
  infrastructure: <IconPlugConnected size={18} />,
  bot: <IconRobot size={18} />,
  campaigns: <IconSpeakerphone size={18} />,
  business: <IconCreditCard size={18} />,
  settings: <IconSettings size={18} />,
};

const ADMIN_MENU_ICONS: Record<AdminDetailSection, ReactNode> = {
  dashboard: <IconLayoutDashboard size={18} />,
  support: <IconMail size={18} />,
  users: <IconUsers size={18} />,
  instances: <IconRobot size={18} />,
  servers: <IconPlugConnected size={18} />,
  botinterage: <IconRobot size={18} />,
  mega: <IconCloudDownload size={18} />,
  groups: <IconUsersGroup size={18} />,
  campaigns: <IconSpeakerphone size={18} />,
  plans: <IconCreditCard size={18} />,
  payments: <IconCreditCard size={18} />,
  affiliates: <IconShoppingCart size={18} />,
  site: <IconSettings size={18} />,
  firebase: <IconBrandFirebase size={18} />,
  aplicativo: <IconDeviceMobile size={18} />,
  notificacoes: <IconMail size={18} />,
  linksuteis: <IconLink size={18} />,
  tutoriais: <IconBook size={18} />,
};

type AdminBotWorkspaceProps = AdminWorkspaceContentProps & {
  brandSiteName: string;
  brandLogoUrl: string | null;
  brandUpdatedAt?: string | null;
};

const withCacheBust = (url: string, token?: string | null) => {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(token)}`;
};

const AdminBotWorkspace = ({
  brandSiteName,
  brandLogoUrl,
  brandUpdatedAt,
  ...contentProps
}: AdminBotWorkspaceProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<AdminDetailSection>("dashboard");
  const [rail, setRail] = useState<AdminRailSection>("dashboard");
  const [menuSearch, setMenuSearch] = useState("");
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const supportUnreadCount = useSupportUnreadCount(true);

  const brandName = brandSiteName?.trim() || "Bot Admin";
  const rawBrandLogo = brandLogoUrl?.trim() || "/images/brand/logo/logo-icon.svg";
  const brandLogoSource = /^https?:\/\//i.test(rawBrandLogo)
    ? rawBrandLogo
    : getAssetPath(rawBrandLogo);
  const brandLogo = withCacheBust(brandLogoSource, brandUpdatedAt ?? rawBrandLogo);

  const changeSection = useCallback(
    (next: AdminDetailSection) => {
      setSection(next);
      setRail(resolveAdminRailSection(next));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ADMIN_SECTION_STORAGE_KEY, next);
      }
      if (isMobileViewport) {
        setMobileView("detail");
        setMobileMenuOpen(false);
      }
    },
    [isMobileViewport],
  );

  const changeRail = useCallback(
    (nextRail: AdminRailSection) => {
      setRail(nextRail);
      const items = getAdminMenuItemsForRail(nextRail);
      if (items.length > 0) {
        changeSection(items[0].id);
      }
    },
    [changeSection],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const querySection = url.searchParams.get("section");
    const nextSection = url.searchParams.has("section")
      ? resolveAdminDetailSection(querySection, "dashboard")
      : resolveAdminDetailSection(window.localStorage.getItem(ADMIN_SECTION_STORAGE_KEY), "dashboard");

    setSection(nextSection);
    setRail(resolveAdminRailSection(nextSection));

    if (url.searchParams.has("section")) {
      url.searchParams.delete("section");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(`(max-width: ${ADMIN_MOBILE_BREAKPOINT}px)`);
    const handleChange = () => setIsMobileViewport(mediaQuery.matches);
    handleChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_MOBILE_VIEW_STORAGE_KEY, mobileView);
  }, [mobileView]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    router.push("/sign-in");
    router.refresh();
  }, [router]);

  const railMenuItems = useMemo(() => getAdminMenuItemsForRail(rail), [rail]);

  const filteredMenuItems = useMemo(() => {
    const query = menuSearch.trim().toLowerCase();
    const source = query ? ADMIN_MENU_ITEMS : railMenuItems;
    if (!query) return source;
    return ADMIN_MENU_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.subtitle.toLowerCase().includes(query),
    );
  }, [menuSearch, railMenuItems]);

  const activeMenuItem = useMemo(
    () => ADMIN_MENU_ITEMS.find((item) => item.id === section) ?? ADMIN_MENU_ITEMS[0],
    [section],
  );

  const hideLeftPane = isAdminFullWidthSection(section);
  const showMobileDetailPane = hideLeftPane || mobileView === "detail";

  useEffect(() => {
    if (!isMobileViewport) return;
    if (section === "dashboard" || section === "support") {
      setMobileView("detail");
    }
  }, [isMobileViewport, section]);

  const renderRailIcon = (railId: AdminRailSection) => (
    <span className={styles.railIcon} aria-hidden="true">
      {ADMIN_RAIL_ICONS[railId]}
    </span>
  );

  const renderMenuIcon = (sectionId: AdminDetailSection) => (
    <span className={adminStyles.adminMenuIcon} aria-hidden="true">
      {ADMIN_MENU_ICONS[sectionId]}
    </span>
  );

  const mobileDrawerItems = ADMIN_RAIL_ITEMS.flatMap((railItem) => {
    const children = getAdminMenuItemsForRail(railItem.id);
    return children.map((child) => ({
      rail: railItem,
      item: child,
    }));
  });

  return (
    <div
      className={classNames(
        styles.shell,
        adminStyles.adminShell,
        isMobileViewport && styles.shellMobile,
        hideLeftPane && styles.shellStatusFocus,
      )}
    >
      <aside className={styles.rail}>
        <button
          type="button"
          className={classNames(
            styles.profileSwitcherButton,
            styles.profileSwitcherButtonActive,
          )}
          title="Painel administrativo"
          aria-label="Painel administrativo"
        >
          <span className={styles.profileSwitcherAvatar}>
            <IconShield size={18} />
          </span>
        </button>

        {ADMIN_RAIL_ITEMS.map((item) => (
          <span key={item.id} className={adminStyles.railBtnWrap}>
            <button
              type="button"
              className={classNames(styles.railBtn, rail === item.id && styles.railBtnActive)}
              onClick={() => changeRail(item.id)}
              title={item.title}
              aria-label={item.title}
            >
              {renderRailIcon(item.id)}
            </button>
            {item.id === "support" && supportUnreadCount > 0 ? (
              <span className={adminStyles.railUnreadBadge} aria-label={`${supportUnreadCount} mensagens não lidas`}>
                {supportUnreadCount > 99 ? "99+" : supportUnreadCount}
              </span>
            ) : null}
          </span>
        ))}

        <button
          type="button"
          className={classNames(styles.railBtn, quickActionsOpen && styles.railBtnActive)}
          onClick={() => setQuickActionsOpen((open) => !open)}
          title="Ações rápidas"
          aria-label="Ações rápidas"
          aria-expanded={quickActionsOpen}
        >
          <IconPlus size={19} />
        </button>

        <button
          type="button"
          className={styles.railFooter}
          onClick={() => void handleLogout()}
          title="Sair"
          aria-label="Sair"
        >
          <IconLogout2 size={16} />
        </button>
      </aside>

      <section
        className={classNames(
          styles.leftPane,
          hideLeftPane && styles.leftPaneStatusHidden,
          isMobileViewport && showMobileDetailPane && styles.mobilePaneHidden,
        )}
      >
        <header className={styles.paneHeader}>
          <div className={styles.paneHeaderTitles}>
            <div className={styles.headerBrand}>
              <img src={brandLogo} alt={brandName} className={styles.headerBrandLogo} />
              <span>{brandName}</span>
            </div>
            <h2>Administração</h2>
          </div>
        </header>

        <label className={styles.searchBox}>
          <IconSearch size={14} />
          <input
            value={menuSearch}
            onChange={(event) => setMenuSearch(event.currentTarget.value)}
            placeholder="Buscar no painel admin"
          />
        </label>

        <div className={styles.listArea}>
          {filteredMenuItems.map((item) => {
            const active = section === item.id;
            return (
              <div
                key={item.id}
                className={classNames(
                  styles.listItemRow,
                  styles.listItemRowGroup,
                  active && styles.listItemRowActive,
                )}
              >
                <button
                  type="button"
                  className={classNames(styles.listItem, styles.listItemMain, active && styles.listItemActive)}
                  onClick={() => changeSection(item.id)}
                >
                  {renderMenuIcon(item.id)}
                  <div className={styles.listText}>
                    <div className={styles.nameLine}>
                      <span className={styles.groupName}>{item.title}</span>
                    </div>
                    <div className={styles.metaLine}>
                      <span>{item.subtitle}</span>
                    </div>
                  </div>
                  {item.id === "support" && supportUnreadCount > 0 ? (
                    <span className={adminStyles.menuUnreadBadge}>
                      {supportUnreadCount > 99 ? "99+" : supportUnreadCount}
                    </span>
                  ) : (
                    <IconChevronRight size={14} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section
        className={classNames(
          styles.rightPane,
          hideLeftPane && styles.rightPaneStatusExpanded,
          isMobileViewport && !showMobileDetailPane && styles.mobilePaneHidden,
        )}
      >
        <div className={styles.moduleWorkspace}>
          {section !== "support" && section !== "dashboard" ? (
            <header className={styles.detailHeader}>
              <div className={styles.detailHeaderMain}>
                {isMobileViewport && showMobileDetailPane && !hideLeftPane ? (
                  <button
                    type="button"
                    className={styles.mobileBackButton}
                    onClick={() => setMobileView("list")}
                    aria-label="Voltar para lista"
                  >
                    <IconArrowLeft size={18} />
                  </button>
                ) : null}
                <div>
                  <div className={styles.moduleHeaderBrand}>
                    <img src={brandLogo} alt={brandName} className={styles.headerBrandLogo} />
                    <span>{brandName}</span>
                  </div>
                  <h3>{activeMenuItem.title}</h3>
                  <small>{activeMenuItem.subtitle}</small>
                </div>
              </div>
            </header>
          ) : null}
          <div className={classNames(styles.moduleContent, section === "support" && adminStyles.adminModuleContentFlush)}>
            <AdminBotWorkspaceContent {...contentProps} section={section} />
          </div>
        </div>
      </section>

      {isMobileViewport ? (
        <div className={styles.mobileTopChrome}>
          <button
            type="button"
            className={styles.mobileMenuButton}
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
            title="Abrir menu"
          >
            <IconMenu2 size={22} />
          </button>
          <div className={styles.mobileTopBrand}>
            <img src={brandLogo} alt={brandName} className={styles.mobileTopBrandLogo} />
            <span>{brandName}</span>
          </div>
          <button
            type="button"
            className={styles.mobileTopAction}
            onClick={() => changeSection("support")}
            aria-label="Abrir suporte"
            title="Suporte"
          >
            <IconSpeakerphone size={18} />
            {supportUnreadCount > 0 ? (
              <span className={adminStyles.railUnreadBadge}>
                {supportUnreadCount > 99 ? "99+" : supportUnreadCount}
              </span>
            ) : null}
          </button>
          {mobileMenuOpen ? (
            <button
              type="button"
              className={styles.mobileDrawerBackdrop}
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
            />
          ) : null}
          <aside
            className={classNames(styles.mobileDrawer, mobileMenuOpen && styles.mobileDrawerOpen)}
            aria-label="Menu administrativo"
          >
            <header className={styles.mobileDrawerHeader}>
              <div>
                <strong>Painel administrativo</strong>
                <span>{activeMenuItem.title}</span>
              </div>
              <button
                type="button"
                className={styles.mobileDrawerClose}
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fechar menu"
              >
                <IconX size={18} />
              </button>
            </header>
            <nav className={styles.mobileDrawerList}>
              {mobileDrawerItems.map(({ rail: railItem, item }) => (
                <button
                  key={item.id}
                  type="button"
                  className={classNames(
                    styles.mobileDrawerItem,
                    section === item.id && styles.mobileDrawerItemActive,
                  )}
                  onClick={() => changeSection(item.id)}
                >
                  <span className={styles.mobileDrawerIcon}>
                    {ADMIN_MENU_ICONS[item.id]}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{railItem.title}</small>
                  </span>
                </button>
              ))}
            </nav>
            <footer className={styles.mobileDrawerFooter}>
              <button type="button" onClick={() => void handleLogout()}>
                <IconLogout2 size={18} />
                <span>Sair da conta</span>
              </button>
            </footer>
          </aside>
        </div>
      ) : null}

      {quickActionsOpen ? (
        <div
          className={styles.quickActionBackdrop}
          onClick={() => setQuickActionsOpen(false)}
          role="presentation"
        >
          <section
            className={styles.quickActionSheet}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Ações rápidas"
          >
            <div className={styles.quickActionHandle} />
            <header className={styles.quickActionHeader}>
              <div>
                <strong>Ações rápidas</strong>
                <span>Atalhos do painel administrativo</span>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setQuickActionsOpen(false)}
                aria-label="Fechar ações rápidas"
              >
                <IconX size={16} />
              </button>
            </header>
            <button
              type="button"
              className={styles.quickActionItem}
              onClick={() => {
                setQuickActionsOpen(false);
                changeSection("support");
              }}
            >
              <span className={styles.quickActionIcon}>
                <IconSpeakerphone size={20} />
              </span>
              <span>
                <strong>Atendimentos</strong>
                <small>
                  {supportUnreadCount > 0
                    ? `${supportUnreadCount} mensagem(ns) aguardando resposta`
                    : "Conversas de suporte em tempo real"}
                </small>
              </span>
            </button>
            <button
              type="button"
              className={styles.quickActionItem}
              onClick={() => {
                setQuickActionsOpen(false);
                changeSection("users");
              }}
            >
              <span className={styles.quickActionIcon}>
                <IconUsers size={20} />
              </span>
              <span>
                <strong>Usuários</strong>
                <small>Contas, planos, saldo e permissões</small>
              </span>
            </button>
            <button
              type="button"
              className={styles.quickActionItem}
              onClick={() => {
                setQuickActionsOpen(false);
                changeSection("dashboard");
              }}
            >
              <span className={styles.quickActionIcon}>
                <IconLayoutDashboard size={20} />
              </span>
              <span>
                <strong>Painel geral</strong>
                <small>Indicadores e resumo da plataforma</small>
              </span>
            </button>
            <button
              type="button"
              className={styles.quickActionItem}
              onClick={() => {
                setQuickActionsOpen(false);
                if (typeof window !== "undefined") {
                  window.location.reload();
                }
              }}
            >
              <span className={styles.quickActionIcon}>
                <IconRefresh size={20} />
              </span>
              <span>
                <strong>Atualizar painel</strong>
                <small>Recarregar dados e conversas abertas</small>
              </span>
            </button>
          </section>
        </div>
      ) : null}

      {isMobileViewport && section !== "support" ? (
        <button
          type="button"
          className={styles.quickActionFab}
          onClick={() => setQuickActionsOpen(true)}
          aria-label="Ações rápidas"
          title="Ações rápidas"
        >
          <IconPlus size={24} />
        </button>
      ) : null}
    </div>
  );
};

export default AdminBotWorkspace;