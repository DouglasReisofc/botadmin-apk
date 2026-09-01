import { Fragment } from "react";
import { Metadata } from "next";

import UserSiteSettingsForm from "components/site/UserSiteSettingsForm";
import DashboardPageTitle from "components/common/DashboardPageTitle";
import { getCurrentUser } from "lib/auth";
import { getSiteSettingsForUser } from "lib/site";

export const metadata: Metadata = {
  title: "Configurações do site | StoreBot Dashboard",
  description:
    "Gerencie nome, identidade visual, SEO e conteúdo do rodapé do seu site diretamente pelo painel.",
};

const UserSiteSettingsPage = async () => {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const settings = await getSiteSettingsForUser(user.id);

  return (
    <Fragment>
      <DashboardPageTitle
        title="Config. do site"
        subtitle="Personalize identidade visual e links."
      />

      <UserSiteSettingsForm settings={settings} />
    </Fragment>
  );
};

export default UserSiteSettingsPage;
