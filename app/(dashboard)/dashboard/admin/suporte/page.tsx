import { redirect } from "next/navigation";

const AdminSupportRedirectPage = () => {
  redirect("/dashboard/admin?section=support");
};

export default AdminSupportRedirectPage;