import { redirect } from "next/navigation";

const AdminBotInterageRedirectPage = () => {
  redirect("/dashboard/admin?section=botinterage");
};

export default AdminBotInterageRedirectPage;