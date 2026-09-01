import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "lib/auth";

export const metadata: Metadata = {
  title: "Conversas WhatsApp | BotAdmin",
  description: "Gerencie conversas do WhatsApp pela instância conectada.",
};

export const dynamic = "force-dynamic";

const UserWhatsappConversationsPage = async () => {
  const user = await getCurrentUser();
  if (!user) return null;

  redirect("/dashboard/user?section=conversations");
};

export default UserWhatsappConversationsPage;
