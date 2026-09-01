import { redirect } from "next/navigation";

const AdminUsefulLinksRedirectPage = () => {
  redirect("/dashboard/admin?section=linksuteis");
};

export default AdminUsefulLinksRedirectPage;