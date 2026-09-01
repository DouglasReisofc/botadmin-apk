import { redirect } from "next/navigation";

const AdminAppRedirectPage = () => {
  redirect("/dashboard/admin?section=aplicativo");
};

export default AdminAppRedirectPage;