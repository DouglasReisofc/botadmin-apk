"use client";

//import node module libraries
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useCallback } from "react";
import { Image, Nav } from "react-bootstrap";
import useSupportUnreadCount from "hooks/useSupportUnreadCount";

//import custom routes
import { getDashboardMenu } from "routes/DashboardRoute";

//import helper
import { getAssetPath } from "helper/assetPath";

interface SidebarProps {
  hideLogo: boolean;
  containerId?: string;
  role: "admin" | "user";
  siteSettings?: {
    siteName: string;
    logoUrl: string | null;
  };
}

const Sidebar: React.FC<SidebarProps> = ({ hideLogo = false, containerId, role, siteSettings }) => {
  const pathname = usePathname();
  const menuItems = getDashboardMenu(role);
  const supportUnread = useSupportUnreadCount(role === "user");
  const logoSrc = siteSettings?.logoUrl ?? "/images/brand/logo/logo-icon.svg";
  const siteTitle = siteSettings?.siteName ?? "StoreBot";
  const router = useRouter();

  const isActiveLink = (link?: string) => {
    if (!link) return false;

    const [basePath] = link.split("#");

    if (basePath === "/") {
      return pathname === "/";
    }

    return pathname === basePath || pathname.startsWith(`${basePath}/`);
  };

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const isGroupActive = (children?: { link?: string }[]) =>
    Boolean(children?.some((c) => isActiveLink(c.link)));

  const toggleGroup = (id: string) => {
    setExpanded((curr) => ({ ...curr, [id]: !curr[id] }));
  };

  const renderMenuIcon = (item: { icon?: React.ReactNode }) =>
    item.icon ? (
      <span className="sidebar-menu-icon" aria-hidden="true">
        {item.icon}
      </span>
    ) : null;

  const handleMenuAction = useCallback(
    (action?: string) => {
      if (!action) {
        return;
      }
      if (action === "open-user-support") {
        if (typeof window !== "undefined") {
          const event = new CustomEvent("user-support:open", { cancelable: true });
          const prevented = !window.dispatchEvent(event);
          if (prevented) {
            return;
          }
        }
        router.push("/dashboard/user/conversas");
      }
    },
    [router],
  );

  return (
    <div id={containerId}>
      <div>
        {hideLogo || (
          <div className="brand-logo">
            <Link href="/" className="d-flex w-100 align-items-center justify-content-center justify-content-md-start gap-2">
              <Image
                src={getAssetPath(logoSrc)}
                alt={siteTitle}
                className="logo-circle border"
              />
              <span className="fw-bold fs-4 site-logo-text">{siteTitle}</span>
            </Link>
          </div>
        )}

        <Nav as="ul" bsPrefix="navbar-nav flex-column" className="mt-4">
          {menuItems.map((item) => {
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;
            if (!hasChildren) {
              if (item.action) {
                return (
                  <Nav.Item as="li" key={item.id}>
                    <button
                      type="button"
                      className="nav-link d-flex align-items-center gap-2 w-100 text-start"
                      style={{ background: "none", border: 0 }}
                      onClick={() => handleMenuAction(item.action)}
                    >
                      {renderMenuIcon(item)}
                      <span className="text flex-grow-1">{item.title}</span>
                      {role === "user" && item.id === "user-conversations" && supportUnread > 0 ? (
                        <span className="badge bg-danger rounded-pill ms-auto">
                          {supportUnread > 99 ? "99+" : supportUnread}
                        </span>
                      ) : null}
                    </button>
                  </Nav.Item>
                );
              }

              return (
                <Nav.Item as="li" key={item.id}>
                  <Link
                    href={item.link ?? "#"}
                    className={`nav-link d-flex align-items-center gap-2 ${
                      isActiveLink(item.link) ? "active" : ""
                    }`}
                  >
                    {renderMenuIcon(item)}
                    <span className="text flex-grow-1">{item.title}</span>
                    {role === "user" && item.id === "user-conversations" && supportUnread > 0 ? (
                      <span className="badge bg-danger rounded-pill ms-auto">
                        {supportUnread > 99 ? "99+" : supportUnread}
                      </span>
                    ) : null}
                  </Link>
                </Nav.Item>
              );
            }

            const active = isGroupActive(item.children);
            const open = expanded[item.id] ?? active;

            return (
              <li key={item.id} className="nav-item">
                <button
                  type="button"
                  className={`nav-link d-flex align-items-center gap-2 w-100 text-start ${
                    open ? "" : "collapsed"
                  } ${active ? "active" : ""}`}
                  onClick={() => toggleGroup(item.id)}
                  aria-expanded={open}
                  aria-controls={`nav-group-${item.id}`}
                  style={{ background: "none", border: 0 }}
                >
                  {renderMenuIcon(item)}
                  <span className="text flex-grow-1">{item.title}</span>
                  <span aria-hidden className="small text-secondary">{open ? "▾" : "▸"}</span>
                </button>
                <ul id={`nav-group-${item.id}`} className="nav flex-column ms-4 mb-2" style={{ display: open ? "block" : "none" }}>
                  {item.children!.map((child) => (
                    <li key={child.id} className="nav-item">
                      <Link
                        href={child.link ?? "#"}
                        className={`nav-link d-flex align-items-center gap-2 ${
                          isActiveLink(child.link) ? "active" : ""
                        }`}
                      >
                        <span className="text">{child.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </Nav>
      </div>
    </div>
  );
};

export default Sidebar;
