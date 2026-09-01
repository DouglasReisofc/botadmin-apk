"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Button, Modal } from "react-bootstrap";
import { usePathname } from "next/navigation";
import { IconMessageChatbot } from "@tabler/icons-react";

import AdminSupportCenter from "components/admin/AdminSupportCenter";

type RoleState = "loading" | "user" | "admin" | "guest";

const AdminSupportLauncher = () => {
  const pathname = usePathname();
  const [role, setRole] = useState<RoleState>("loading");
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchRole = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!active) return;
        const fetchedRole = data?.user?.role;
        if (fetchedRole === "admin") setRole("admin");
        else if (fetchedRole === "user") setRole("user");
        else setRole("guest");
      } catch {
        if (active) setRole("guest");
      }
    };
    fetchRole();
    return () => {
      active = false;
    };
  }, []);

  const isOnAdminArea = useMemo(
    () => (pathname?.startsWith("/dashboard/admin") ?? false),
    [pathname],
  );
  const shouldRenderLauncher = useMemo(
    () => false,
    [],
  );

  const handleOpenSupport = useCallback(() => setShow(true), []);
  const handleClose = useCallback(() => setShow(false), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const listener = (ev: Event) => {
      if (role === "admin" && isOnAdminArea) {
        const e = ev as CustomEvent;
        if (e.cancelable) {
          e.preventDefault();
        }
        setShow(true);
      }
    };
    window.addEventListener("user-support:open", listener as EventListener);
    return () => window.removeEventListener("user-support:open", listener as EventListener);
  }, [role, isOnAdminArea]);

  if (role !== "admin" && !show) return null;

  return (
    <>
      {shouldRenderLauncher && (
        <div className="admin-support-launcher">
          <Button
            type="button"
            variant="secondary"
            className="admin-support-launcher__button shadow-lg"
            onClick={handleOpenSupport}
          >
            <IconMessageChatbot size={22} />
            <span>Atendimentos</span>
          </Button>
        </div>
      )}

      <Modal show={show} onHide={handleClose} size="xl" centered scrollable backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title>Atendimentos recentes</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          <div className="p-3">
            <AdminSupportCenter />
          </div>
        </Modal.Body>
      </Modal>

      <style jsx>{`
        .admin-support-launcher {
          position: fixed;
          z-index: 1045;
          bottom: 1.5rem;
          right: 1.5rem;
        }
        .admin-support-launcher__button {
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          font-weight: 600;
          box-shadow: 0 1rem 2rem rgba(108, 117, 125, 0.25);
        }
        @media (max-width: 575.98px) {
          .admin-support-launcher {
            bottom: 1rem;
            right: 1rem;
          }
          .admin-support-launcher__button {
            padding: 0.65rem 1.2rem;
          }
        }
      `}</style>
    </>
  );
};

export default AdminSupportLauncher;
