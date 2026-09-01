import { redirect } from "next/navigation";

const UserBotInstancesRedirectPage = () => {
  redirect("/dashboard/user?section=instances");
};

export default UserBotInstancesRedirectPage;
