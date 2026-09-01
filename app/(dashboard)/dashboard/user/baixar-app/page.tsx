import type { Metadata } from "next";

import UserAppDownloadClient from "components/users/UserAppDownloadClient";
import DashboardPageTitle from "components/common/DashboardPageTitle";

export const metadata: Metadata = {
  title: "Baixar aplicativo | StoreBot Dashboard",
  description:
    "Distribua o aplicativo móvel do dashboard para Android ou iOS com builds gerenciados pelo painel.",
};

const DownloadAppPage = () => {
  return (
    <>
      <DashboardPageTitle
        title="Aplicativo mobile"
        subtitle="Baixe e compartilhe o app do painel."
      />
      <UserAppDownloadClient />
    </>
  );
};

export default DownloadAppPage;
