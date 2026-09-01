import { Fragment } from "react";
import { Metadata } from "next";

import { getCurrentUser } from "lib/auth";
import { getRecentWebhookEvents, getWebhookForUser } from "lib/webhooks";
import UserWebhookDetails from "components/webhooks/UserWebhookDetails";
import DashboardPageTitle from "components/common/DashboardPageTitle";

export const metadata: Metadata = {
  title: "Webhook | StoreBot Dashboard",
  description:
    "Consulte o endpoint dedicado da Meta Cloud API, tokens de verificação e eventos recentes recebidos pelo chatbot.",
};

const UserWebhookPage = async () => {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const [webhook, events] = await Promise.all([
    getWebhookForUser(user.id),
    getRecentWebhookEvents(user.id, 25),
  ]);

  return (
    <Fragment>
      <DashboardPageTitle
        title="Webhook"
        subtitle="Veja endpoint e eventos recentes."
      />

      {webhook ? (
        <UserWebhookDetails webhook={webhook} events={events} />
      ) : (
        <p className="text-secondary">Não foi possível carregar as informações do webhook.</p>
      )}
    </Fragment>
  );
};

export default UserWebhookPage;
