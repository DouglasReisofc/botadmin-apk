import { redirect } from "next/navigation";

const AdminMegaRedirectPage = () => {
  redirect("/dashboard/admin?section=mega");
};

export default AdminMegaRedirectPage;