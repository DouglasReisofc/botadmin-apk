import { redirect } from "next/navigation";

type AdminGroupsRedirectPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

const AdminGroupsRedirectPage = ({ searchParams }: AdminGroupsRedirectPageProps) => {
  const params = new URLSearchParams();
  params.set("section", "groups");
  const query = searchParams?.query ?? searchParams?.q;
  if (typeof query === "string" && query.trim()) {
    params.set("query", query);
  }
  redirect(`/dashboard/admin?${params.toString()}`);
};

export default AdminGroupsRedirectPage;