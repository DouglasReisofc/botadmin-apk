import type { Metadata } from "next";
import { Container } from "react-bootstrap";
import Link from "next/link";

import { getAdminSiteSettings } from "lib/admin-site";
import { getGeneratedCommandTutorialSections } from "lib/command-tutorials";
import { getPublicFieldTutorials } from "lib/tutorials";
import { getPublicAppBaseUrl } from "lib/meta";
import { summarizeRichText } from "lib/terms";
import TutorialsDirectory, {
  TutorialsSectionData,
} from "components/site/TutorialsDirectory";
import { TUTORIAL_SECTIONS } from "types/tutorials";
import PublicPageShell from "components/site/PublicPageShell";

const FALLBACK_TITLE = "Tutoriais do Bot Admin";
const FALLBACK_DESCRIPTION =
  "Explore guias passo a passo para configurar integrações, comandos e recursos avançados do Bot Admin.";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getPublicAppBaseUrl();

  try {
    const settings = await getAdminSiteSettings();
    const siteName = settings.siteName ?? "Bot Admin";
    const title = `${siteName} | Tutoriais e guias`;
    const description =
      settings.seoDescription ?? settings.tagline ?? FALLBACK_DESCRIPTION;
    const canonical = new URL("/tutorials", baseUrl).toString();

    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        title,
        description,
        url: canonical,
        siteName,
        type: "website",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch (error) {
    console.error("Failed to load tutorials metadata", error);
    return {
      title: FALLBACK_TITLE,
      description: FALLBACK_DESCRIPTION,
      openGraph: {
        title: FALLBACK_TITLE,
        description: FALLBACK_DESCRIPTION,
        url: new URL("/tutorials", baseUrl).toString(),
        siteName: "Bot Admin",
        type: "website",
      },
      twitter: {
        card: "summary",
        title: FALLBACK_TITLE,
        description: FALLBACK_DESCRIPTION,
      },
    };
  }
}

const TutorialsPage = async () => {
  const [settings, tutorials] = await Promise.all([
    getAdminSiteSettings(),
    getPublicFieldTutorials(),
  ]);

  const tutorialsBySlug = new Map(tutorials.map((tutorial) => [tutorial.slug, tutorial]));

  const configuredSections: TutorialsSectionData[] = TUTORIAL_SECTIONS.filter(
    (section) => section.id !== "group-commands",
  ).map((section) => {
    const items = section.fields
      .map((field) => tutorialsBySlug.get(field.slug))
      .filter((tutorial): tutorial is NonNullable<typeof tutorial> => Boolean(tutorial));

    return {
      id: section.id,
      title: section.title,
      description: section.description,
      tutorials: items,
    };
  }).filter((section) => section.tutorials.length > 0);
  const commandSections: TutorialsSectionData[] = getGeneratedCommandTutorialSections(tutorialsBySlug)
    .filter((section) => section.tutorials.length > 0)
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      tutorials: section.tutorials,
    }));
  const sections: TutorialsSectionData[] = [...configuredSections, ...commandSections];

  const hasTutorials = sections.some((section) => section.tutorials.length > 0);
  const introDescription = summarizeRichText(settings.footerText ?? settings.tagline ?? "", 180);

  return (
    <PublicPageShell
      logoUrl={settings.logoUrl}
      siteName={settings.siteName ?? "Bot Admin"}
      activePath="/tutorials"
    >
      <div className="d-flex justify-content-start mb-4">
        <Link href="/" className="landing-btn landing-btn--ghost">
          ← Voltar para inicio
        </Link>
      </div>
      <header className="mb-5 text-center">
        <span className="badge bg-primary-subtle text-primary text-uppercase mb-3">
          Tutoriais
        </span>
        <h1 className="fw-bold mb-3 landing-title">Guia completo do Bot Admin</h1>
        <p className="text-secondary mb-0">
          Configure webhooks, comandos, ativações e fluxos avançados com os materiais abaixo.
          {introDescription ? ` ${introDescription}` : ""}
        </p>
      </header>

      {hasTutorials ? (
        <TutorialsDirectory sections={sections} />
      ) : (
        <section className="landing-card p-4 p-md-5 text-center">
          <h2 className="h5 mb-2">Nenhum tutorial disponível ainda</h2>
          <p className="text-secondary mb-0">
            Os tutoriais cadastrados no painel administrativo aparecerão aqui automaticamente.
          </p>
        </section>
      )}
    </PublicPageShell>
  );
};

export default TutorialsPage;
