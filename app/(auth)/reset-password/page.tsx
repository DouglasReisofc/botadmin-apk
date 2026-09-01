import ResetPasswordClient from "./reset-password-client";

export const metadata = {
  title: "Definir nova senha | StoreBot Dashboard",
  description: "Crie uma nova senha a partir do link recebido por e-mail.",
};

const ResetPasswordPage = ({ searchParams }: { searchParams: { token?: string } }) => {
  return <ResetPasswordClient token={searchParams?.token || ""} />;
};

export default ResetPasswordPage;

