import { redirect } from "next/navigation";

const AdminPlansRedirectPage = () => {
  redirect("/dashboard/admin?section=plans");
};

export default AdminPlansRedirectPage;