import { Fragment } from "react";
import { Metadata } from "next";
import { redirect } from "next/navigation";

import UserWhatsappPanel from "components/bot/UserWhatsappPanel";
import DashboardPageTitle from "components/common/DashboardPageTitle";
import { getAdminOperationalWuzapiClient } from "lib/admin-operational-instance";
import { getCurrentUser } from "lib/auth";

export const metadata: Metadata = {
  title: "Painel WhatsApp | StoreBot Dashboard",
  description: "Conecte-se ao bot administrativo pelo WhatsApp e confirme seu número a qualquer momento.",
};

const UserWhatsappPanelPage = async () => {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }

  const operationalClient = await getAdminOperationalWuzapiClient();
  const adminWhatsapp = operationalClient?.conversation.instancePhone ?? null;

  return (
    <Fragment>
      <DashboardPageTitle
        title="Painel WhatsApp"
        subtitle="Confirme número e receba alertas no WhatsApp."
      />

      <UserWhatsappPanel
        adminNumber={adminWhatsapp}
        userWhatsapp={user.whatsappNumber ?? null}
      />
    </Fragment>
  );
};

export default UserWhatsappPanelPage;
