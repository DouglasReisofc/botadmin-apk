import { redirect } from "next/navigation";

const UserAffiliatesRedirectPage = () => {
  redirect("/dashboard/user?section=affiliates");
};

export default UserAffiliatesRedirectPage;

