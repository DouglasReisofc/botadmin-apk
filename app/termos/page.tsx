import { Container } from "react-bootstrap";
import type { Metadata } from "next";
import Link from "next/link";

import { getAdminSiteSettings } from "lib/admin-site";
import { getPublicAppBaseUrl } from "lib/meta";
import { summarizeTermsContent, termsContentToHtml } from "lib/terms";
import PublicPageShell from "components/site/PublicPageShell";

const FALLBACK_TITLE = "Termos de Uso | Bot Admin";
const FALLBACK_DESCRIPTION =
  "Leia os termos de uso do Bot Admin, incluindo regras de reembolso, boas práticas e responsabilidades do usuário.";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getPublicAppBaseUrl();

  try {
    const settings = await getAdminSiteSettings();
    const siteName = settings.siteName ?? "Bot Admin";
    const title = `${siteName} | Termos de uso`;
    const description =
      summarizeTermsContent(settings.termsContent, 200) || FALLBACK_DESCRIPTION;
    const canonical = new URL("/termos", baseUrl).toString();

    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        title,
        description,
        url: canonical,
        siteName,
        type: "article",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch (error) {
    console.error("Failed to load terms metadata", error);
    return {
      title: FALLBACK_TITLE,
      description: FALLBACK_DESCRIPTION,
      openGraph: {
        title: FALLBACK_TITLE,
        description: FALLBACK_DESCRIPTION,
        url: new URL("/termos", baseUrl).toString(),
        siteName: "Bot Admin",
        type: "article",
      },
      twitter: {
        card: "summary",
        title: FALLBACK_TITLE,
        description: FALLBACK_DESCRIPTION,
      },
    };
  }
}

const TermsPage = async () => {
  const settings = await getAdminSiteSettings();
  const siteName = settings.siteName ?? "Bot Admin";
  const htmlContent = termsContentToHtml(settings.termsContent);

  const updatedLabel = (() => {
    if (!settings.updatedAt) {
      return null;
    }

    try {
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "long",
      }).format(new Date(settings.updatedAt));
    } catch {
      return null;
    }
  })();

  return (
    <PublicPageShell
      logoUrl={settings.logoUrl}
      siteName={siteName}
      activePath="/termos"
    >
      <Container>
        <div className="mx-auto" style={{ maxWidth: "860px" }}>
          <header className="mb-5 text-center">
            <span className="badge bg-primary-subtle text-primary text-uppercase mb-3">
              Termos de uso
            </span>
            <h1 className="fw-bold mb-3">Condições gerais do Bot Admin</h1>
            <p className="text-secondary mb-0">
              Leia atentamente as regras de utilização, política de reembolso e as responsabilidades
              ao utilizar o Bot Admin para automatizar seus grupos de WhatsApp.
            </p>
            {updatedLabel && (
              <p className="text-secondary small mt-3 mb-0">Última atualização em {updatedLabel}</p>
            )}
          </header>

          <article
            className="landing-card p-4 p-lg-5"
            style={{ lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{
              __html:
                htmlContent ||
                "<p class='text-secondary'>Os termos de uso serão publicados em breve.</p>",
            }}
          />
          <p className="text-secondary small mt-4 mb-0 text-center">
            Consulte também nossa{" "}
            <Link href="/privacidade" className="text-decoration-none">
              Política de privacidade
            </Link>
            .
          </p>
        </div>
      </Container>
    </PublicPageShell>
  );
};

export default TermsPage;
