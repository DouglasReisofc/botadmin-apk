import { redirect } from "next/navigation";

const AdminSiteRedirectPage = () => {
  redirect("/dashboard/admin?section=site");
};

export default AdminSiteRedirectPage;