import { redirect } from "next/navigation";

const AdminNotificationsRedirectPage = () => {
  redirect("/dashboard/admin?section=notificacoes");
};

export default AdminNotificationsRedirectPage;