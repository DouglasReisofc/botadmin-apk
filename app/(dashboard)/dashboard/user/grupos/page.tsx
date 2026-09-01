import { redirect } from "next/navigation";

const UserGroupsRedirectPage = () => {
  redirect("/dashboard/user?section=conversations");
};

export default UserGroupsRedirectPage;
