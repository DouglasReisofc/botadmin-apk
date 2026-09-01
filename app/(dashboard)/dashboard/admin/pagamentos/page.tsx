import { redirect } from "next/navigation";

const AdminPaymentsRedirectPage = () => {
  redirect("/dashboard/admin?section=payments");
};

export default AdminPaymentsRedirectPage;