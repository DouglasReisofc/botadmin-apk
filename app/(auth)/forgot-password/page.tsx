import ForgotPasswordClient from "./forgot-password-client";

export const metadata = {
  title: "Redefinir senha | StoreBot Dashboard",
  description: "Receba um código e defina uma nova senha para sua conta.",
};

export const dynamic = "force-dynamic";

const ForgotPasswordPage = () => {
  return <ForgotPasswordClient />;
};

export default ForgotPasswordPage;
