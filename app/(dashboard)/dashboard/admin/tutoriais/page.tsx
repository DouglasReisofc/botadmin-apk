import { redirect } from "next/navigation";

const AdminTutorialsRedirectPage = () => {
  redirect("/dashboard/admin?section=tutoriais");
};

export default AdminTutorialsRedirectPage;