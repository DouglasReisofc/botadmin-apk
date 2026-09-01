import { Fragment } from "react";
import { Metadata } from "next";

import { getCurrentUser } from "lib/auth";
import { getChargeHistoryForUser } from "lib/payments";
import PaymentsHistory from "components/payments/payments-history";
import DashboardPageTitle from "components/common/DashboardPageTitle";

export const metadata: Metadata = {
  title: "Histórico de pagamentos | StoreBot Dashboard",
  description: "Visualize pagamentos aprovados, pendentes e cancelados do seu robô.",
};

const UserPaymentsHistoryPage = async () => {
  const user = await getCurrentUser();
  if (!user) return null;

  const charges = await getChargeHistoryForUser(user.id, 200);

  return (
    <Fragment>
      <DashboardPageTitle
        title="Histórico de pagamentos"
        subtitle="Filtre cobranças por cliente ou status."
      />
      <PaymentsHistory charges={charges} />
    </Fragment>
  );
};

export default UserPaymentsHistoryPage;
