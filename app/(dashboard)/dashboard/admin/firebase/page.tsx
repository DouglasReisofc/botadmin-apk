import { redirect } from "next/navigation";

const AdminFirebaseRedirectPage = () => {
  redirect("/dashboard/admin?section=firebase");
};

export default AdminFirebaseRedirectPage;