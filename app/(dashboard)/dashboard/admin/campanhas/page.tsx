import { redirect } from "next/navigation";

const AdminCampaignsRedirectPage = () => {
  redirect("/dashboard/admin?section=campaigns");
};

export default AdminCampaignsRedirectPage;