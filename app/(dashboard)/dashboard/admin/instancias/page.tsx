import { redirect } from "next/navigation";

const AdminInstancesRedirectPage = () => {
  redirect("/dashboard/admin?section=instances");
};

export default AdminInstancesRedirectPage;