import { redirect } from "next/navigation";

const AdminBotRedirectPage = () => {
  redirect("/dashboard/admin?section=botinterage");
};

export default AdminBotRedirectPage;