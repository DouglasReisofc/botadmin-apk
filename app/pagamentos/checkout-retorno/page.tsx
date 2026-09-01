import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Retorno do pagamento | Bot Admin",
  robots: {
    index: false,
    follow: true,
    googleBot: {
      index: false,
      follow: true,
    },
  },
};

type PageProps = {
  searchParams: { [key: string]: string | string[] | undefined };
};

const getStatus = (value: unknown): "success" | "pending" | "failure" | null => {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v === "success" || v === "pending" || v === "failure") return v;
  return null;
};

export default async function CheckoutRetornoPage({ searchParams }: PageProps) {
  const status = getStatus(searchParams?.status);

  const title =
    status === "success"
      ? "Pagamento confirmado"
      : status === "pending"
        ? "Pagamento pendente"
        : status === "failure"
          ? "Pagamento não concluído"
          : "Retorno do pagamento";

  const description =
    status === "success"
      ? "Recebemos a confirmação do pagamento. Você pode fechar esta página e voltar para o app."
      : status === "pending"
        ? "O pagamento ainda está pendente. Assim que for confirmado você será notificado."
        : status === "failure"
          ? "O pagamento não foi concluído. Tente novamente ou selecione outra forma de pagamento."
          : "Processamos seu retorno de pagamento. Você pode fechar esta página.";

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <div className="card shadow-sm">
            <div className="card-body p-4 d-flex flex-column gap-2">
              <h1 className="h4 mb-1">{title}</h1>
              <p className="text-secondary mb-3">{description}</p>
              <div className="d-flex gap-2">
                <Link className="btn btn-primary" href="/dashboard/user?section=conversations">Ir para conversas</Link>
                <Link className="btn btn-outline-secondary" href="/">Ir para o início</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
