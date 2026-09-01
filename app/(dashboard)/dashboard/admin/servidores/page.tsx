import { redirect } from "next/navigation";

const AdminServersRedirectPage = () => {
  redirect("/dashboard/admin?section=servers");
};

export default AdminServersRedirectPage;