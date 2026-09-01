import { redirect } from "next/navigation";

export default function UserPaymentsRedirectPage() {
  redirect("/dashboard/user");
}
