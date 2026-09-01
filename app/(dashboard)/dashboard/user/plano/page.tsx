import { redirect } from "next/navigation";

const UserPlanRedirectPage = () => {
  redirect("/dashboard/user?section=conversations");
};

export default UserPlanRedirectPage;
