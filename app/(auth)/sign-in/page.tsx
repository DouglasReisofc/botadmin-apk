import { Metadata } from "next";

import SignInClient from "./sign-in-client";
import { getAdminSiteSettings } from "lib/admin-site";
import { getCurrentUser } from "lib/auth";
import RedirectIfAuthenticated from "components/auth/RedirectIfAuthenticated";
import NativeAppOpenScript from "components/mobile/NativeAppOpenScript";
import { readPendingInternalGroupInvite } from "lib/internal-group-invite-intent";

export const metadata: Metadata = {
  title: "Entrar | Bot Admin",
  description: "Autentique-se para acessar o painel StoreBot.",
};

const safeNextPath = (value?: string) =>
  value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard/user";

const SignInPage = async ({
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
      console.warn("[sign-in] Falha ao carregar marca do site", error);
      return { logoUrl: null, siteName: "BotAdmin" };
    }),
    getCurrentUser().catch((error) => {
      console.warn("[sign-in] Falha ao consultar sessão atual", error);
      return null;
    }),
  ]);
  return (
    <>
      <NativeAppOpenScript next={nextPath} />
      <RedirectIfAuthenticated
        isAuthenticated={Boolean(user)}
        redirectTo={nextPath}
      />
      <SignInClient
        brand={{ logoUrl: settings.logoUrl, siteName: settings.siteName }}
        nextPath={nextPath}
      />
    </>
  );
};

export default SignInPage;
