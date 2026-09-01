import { Fragment } from "react";
import type { Metadata } from "next";

import UserRaffleManager from "components/raffles/UserRaffleManager";
import DashboardPageTitle from "components/common/DashboardPageTitle";
import { getCurrentUser } from "lib/auth";
import { listGroupsForUser } from "lib/bot-groups";
import { listUserRafflesForUser, summarizeRaffle } from "lib/user-raffles";
import { getMercadoPagoPixConfigForUser, getPoloPagPixConfigForUser } from "lib/payments";

export const metadata: Metadata = {
  title: "Rifas pagas | StoreBot Dashboard",
  description:
    "Crie rifas pagas, gerencie participantes e realize sorteios automáticos utilizando o Pix configurado no seu painel.",
};

const UserRafflesPage = async () => {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  let pixConfigured = false;
  let groups = [] as Awaited<ReturnType<typeof listGroupsForUser>>;
  let raffles = [] as Awaited<ReturnType<typeof listUserRafflesForUser>>;
  let initialError: string | null = null;

  try {
    const [groupsResult, rafflesResult, mpCfg, polopagCfg] = await Promise.all([
      listGroupsForUser(user.id),
      listUserRafflesForUser(user.id),
      getMercadoPagoPixConfigForUser(user.id),
      getPoloPagPixConfigForUser(user.id),
    ]);

    groups = groupsResult;
    raffles = rafflesResult;
    pixConfigured = Boolean((mpCfg?.isConfigured && mpCfg?.isActive) || (polopagCfg?.isConfigured && polopagCfg?.isActive));
  } catch (error) {
    console.error("[raffles] Failed to load initial data", error);
    initialError = "Não foi possível carregar as rifas. Tente novamente em instantes.";
  }

  return (
    <Fragment>
      <DashboardPageTitle
        title="Rifas pagas"
        subtitle="Crie rifas automáticas com Pix."
      />
      <UserRaffleManager
        groups={groups}
        initialRaffles={raffles.map(summarizeRaffle)}
        pixConfigured={pixConfigured}
        initialError={initialError}
      />
    </Fragment>
  );
};

export default UserRafflesPage;
