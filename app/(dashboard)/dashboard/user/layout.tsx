import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import "./layout.css";

import { getCurrentUser } from "lib/auth";
import { getPartnerPanelAccess } from "lib/reseller-program";

interface UserDashboardLayoutProps {
  children: ReactNode;
}

export const dynamic = "force-dynamic";

const UserDashboardLayout = async ({ children }: UserDashboardLayoutProps) => {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (user.role !== "user") {
    redirect("/dashboard/admin");
  }

  if (await getPartnerPanelAccess(user.id)) {
    redirect("/dashboard/partner");
  }

  return children;
};

export default UserDashboardLayout;
