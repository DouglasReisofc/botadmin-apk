"use client";

//import node modules libraries
import React, { useState } from "react";
import { Button, Dropdown } from "react-bootstrap";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowBarLeft, IconDiamond, IconLogout, IconPencil, IconWallet } from "@tabler/icons-react";

//import routes files
import { UserMenuItem } from "routes/HeaderRoute";

//import custom components
import { Avatar } from "components/common/Avatar";
import { clearSupportCacheStorage } from "lib/support-storage";
import type { SessionUser } from "types/auth";
import type { UserPlanStatus } from "types/plans";
import ProfileEditModal from "components/profile/ProfileEditModal";

interface UserToggleProps {
  children?: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

const CustomToggle = React.forwardRef<HTMLAnchorElement, UserToggleProps>(
  ({ children, onClick }, ref) => (
    <Link
      ref={ref}
      href="#"
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      className="d-inline-flex align-items-center"
    >
      {children}
    </Link>
  ),
);
CustomToggle.displayName = "UserMenuToggle";

interface UserMenuProps {
  user: SessionUser;
  planSnapshot?: {
    status: UserPlanStatus;
    balance: number;
  };
}

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatPlanDueDate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
};

const UserMenu: React.FC<UserMenuProps> = ({ user, planSnapshot }) => {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isRestoringAdmin, setIsRestoringAdmin] = useState(false);
  const [isProfileModalOpen, setProfileModalOpen] = useState(false);

  const filteredMenu = user.isImpersonated
    ? UserMenuItem
    : UserMenuItem.filter((item) => item.roles.includes(user.role));
  const avatarSrc = user.avatarUrl ?? "/images/avatar/avatar-fallback.jpg";

  const planStatus = planSnapshot?.status;
  const planDueDate = formatPlanDueDate(planStatus?.currentPeriodEnd ?? null);
  const balanceLabel = typeof planSnapshot?.balance === "number" ? `R$ ${formatCurrency(planSnapshot.balance)}` : null;

  let planLabel: string | null = null;
  if (planStatus) {
    switch (planStatus.status) {
      case "active":
        planLabel = planDueDate ? `Plano ativo até ${planDueDate}` : "Plano ativo";
        break;
      case "pending":
        planLabel = "Pagamento do plano pendente";
        break;
      case "expired":
        planLabel = "Plano expirado — renove para continuar";
        break;
      default:
        planLabel = "Nenhum plano ativo";
    }
  }

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // Clear support-related caches before session ends
      try { clearSupportCacheStorage(); } catch {}
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/sign-in");
      router.refresh();
    } catch (error) {
      console.error("Logout error", error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleReturnToAdmin = async () => {
    setIsRestoringAdmin(true);
    try {
      const response = await fetch("/api/admin/users/impersonate/revert", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const redirectTarget = typeof data.redirectTo === "string" ? data.redirectTo : "/dashboard/admin";
        router.replace(redirectTarget);
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to restore admin session", error);
    } finally {
      setIsRestoringAdmin(false);
    }
  };

  return (
    <>
      <Dropdown align="end" className="user-menu-dropdown">
        <Dropdown.Toggle as={CustomToggle}>
          <Avatar
            type="image"
            src={avatarSrc}
            alt={user.name}
            size="sm"
            className="rounded-circle border"
          />
        </Dropdown.Toggle>
        <Dropdown.Menu align="end" className="p-0 dropdown-menu-md">
          <div className="d-flex gap-3 align-items-center border-bottom px-4 py-4 bg-white">
            <Avatar
              type="image"
              src={avatarSrc}
              alt={user.name}
              size="md"
              className="rounded-circle border"
            />
            <div>
              <h4 className="mb-0 fs-5 text-capitalize">{user.name}</h4>
              <p className="mb-0 text-secondary small">{user.email ?? "E-mail não informado"}</p>
              <span className="badge bg-light text-dark text-uppercase mt-2">
                {user.isImpersonated ? "Modo administrador" : user.role}
              </span>
              {(balanceLabel || planLabel) && (
                <div className="d-flex flex-column gap-1 mt-3">
                  {balanceLabel && (
                    <div className="d-flex align-items-center gap-2 text-secondary small">
                      <IconWallet size={18} className="text-primary" />
                      <span>
                        Saldo: <strong>{balanceLabel}</strong>
                      </span>
                    </div>
                  )}
                  {planLabel && (
                    <div className="d-flex align-items-center gap-2 text-secondary small">
                      <IconDiamond size={18} className="text-primary" />
                      <span>{planLabel}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="px-4 py-3 border-bottom bg-light-subtle d-flex flex-column gap-2">
            <Button
              variant="outline-primary"
              size="sm"
              className="d-inline-flex align-items-center gap-2"
              onClick={() => setProfileModalOpen(true)}
            >
              <IconPencil size={18} />
              Editar perfil
            </Button>
            {user.isImpersonated && user.canReturnToAdmin ? (
              <Button
                variant="outline-secondary"
                size="sm"
                className="d-inline-flex align-items-center gap-2"
                onClick={handleReturnToAdmin}
                disabled={isRestoringAdmin}
              >
                <IconArrowBarLeft size={18} />
                {isRestoringAdmin ? "Retornando..." : "Voltar ao painel admin"}
              </Button>
            ) : null}
          </div>
          <div className="p-3 d-flex flex-column gap-1">
            {filteredMenu.map((item) => (
              <Dropdown.Item
                key={item.id}
                as={Link}
                href={item.link}
                className="d-flex align-items-center gap-2"
              >
                <span>{item.icon}</span>
                <span>{item.title}</span>
              </Dropdown.Item>
            ))}
          </div>
          <div className="border-top px-4 py-3 bg-light-subtle">
            <button
              type="button"
              className="btn btn-link text-secondary d-flex align-items-center gap-2 p-0"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              <span>
                <IconLogout size={20} strokeWidth={1.5} />
              </span>
              <span>{isLoggingOut ? "Saindo..." : "Sair"}</span>
            </button>
          </div>
        </Dropdown.Menu>
      </Dropdown>
      <ProfileEditModal
        show={isProfileModalOpen}
        onHide={() => setProfileModalOpen(false)}
        user={user}
      />
    </>
  );
};

export default UserMenu;
