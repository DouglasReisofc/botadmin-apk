import { redirect } from "next/navigation";

type AdminUsersRedirectPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

const AdminUsersRedirectPage = ({ searchParams }: AdminUsersRedirectPageProps) => {
  const params = new URLSearchParams();
  params.set("section", "users");
  const query = searchParams?.query ?? searchParams?.q;
  if (typeof query === "string" && query.trim()) {
    params.set("query", query);
  }
  if (typeof searchParams?.status === "string" && searchParams.status.trim()) {
    params.set("status", searchParams.status);
  }
  if (typeof searchParams?.plan === "string" && searchParams.plan.trim()) {
    params.set("plan", searchParams.plan);
  }
  redirect(`/dashboard/admin?${params.toString()}`);
};

export default AdminUsersRedirectPage;