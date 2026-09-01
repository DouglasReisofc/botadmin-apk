import { Metadata } from "next";

import SignUpClient from "./sign-up-client";
import { getAdminSiteSettings } from "lib/admin-site";
import { getCurrentUser } from "lib/auth";
import RedirectIfAuthenticated from "components/auth/RedirectIfAuthenticated";
import { readPendingInternalGroupInvite } from "lib/internal-group-invite-intent";

export const metadata: Metadata = {
  title: "Criar conta | Bot Admin",
  description: "Crie sua conta para acessar os painéis StoreBot.",
};

const safeNextPath = (value?: string) =>
  value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard/user";

const SignUpPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) => {
  const requestedNext = (await searchParams).next;
  const pendingInvite = await readPendingInternalGroupInvite().catch(() => null);
  const nextPath = safeNextPath(
    requestedNext || (pendingInvite ? `/g/${encodeURIComponent(pendingInvite)}` : undefined),
  );
  const [settings, user] = await Promise.all([
    getAdminSiteSettings().catch((error) => {
      console.warn("[sign-up] Falha ao carregar marca do site", error);
      return { logoUrl: null, siteName: "BotAdmin" };
    }),
    getCurrentUser().catch((error) => {
      console.warn("[sign-up] Falha ao consultar sessão atual", error);
      return null;
    }),
  ]);
  return (
    <>
      <RedirectIfAuthenticated
        isAuthenticated={Boolean(user)}
        redirectTo={nextPath}
      />
      <SignUpClient
        brand={{ logoUrl: settings.logoUrl, siteName: settings.siteName }}
        nextPath={nextPath}
      />
    </>
  );
};

export default SignUpPage;
