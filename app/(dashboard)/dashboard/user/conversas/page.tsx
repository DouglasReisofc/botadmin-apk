import { Metadata } from "next";

import { getCurrentUser } from "lib/auth";
import UserConversationsClient from "components/conversations/UserConversationsClient";
import DashboardPageTitle from "components/common/DashboardPageTitle";

export const metadata: Metadata = {
  title: "Suporte | Painel do usuário",
  description: "Centralize e responda aos atendimentos de suporte pelo painel.",
};

export const dynamic = "force-dynamic";

const UserConversationsPage = async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <>
      <DashboardPageTitle
        title="Central de suporte"
        subtitle="Responda clientes direto do painel."
      />
      <UserConversationsClient />
    </>
  );
};

export default UserConversationsPage;
