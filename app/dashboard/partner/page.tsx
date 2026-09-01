import { redirect } from "next/navigation";

import { getCurrentUser } from "lib/auth";

export const dynamic = "force-dynamic";

export default async function PartnerDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/dashboard/partner");
  if (user.role === "admin") redirect("/dashboard/admin");
  // O painel de parceiro compartilha deliberadamente o mesmo shell Flutter
  // do usuário final. Assim web, Android e futuras plataformas não divergem
  // em espaçamento, navegação ou responsividade.
  redirect("/dashboard/user?partner=1&section=affiliates");
}
