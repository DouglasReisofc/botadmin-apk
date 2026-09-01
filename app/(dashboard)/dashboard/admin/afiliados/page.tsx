import { redirect } from "next/navigation";

const AdminAffiliatesRedirectPage = () => {
  redirect("/dashboard/admin?section=affiliates");
};

export default AdminAffiliatesRedirectPage;