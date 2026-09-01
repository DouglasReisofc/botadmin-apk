import type { Metadata } from "next";
import Link from "next/link";

import { getAdminSiteSettings } from "lib/admin-site";
import {
  getCommandPagePathFromTutorialSlug,
  getGeneratedCommandTutorialSections,
} from "lib/command-tutorials";
import { getPublicAppBaseUrl } from "lib/meta";
import { summarizeRichText } from "lib/terms";
import { getPublicFieldTutorials } from "lib/tutorials";
import CommandsDirectory, {
  type CommandsSectionData,
} from "components/site/CommandsDirectory";
import PublicPageShell from "components/site/PublicPageShell";

const FALLBACK_TITLE = "Comandos do Bot Admin para WhatsApp";
const FALLBACK_DESCRIPTION =
  "Consulte todos os comandos do Bot Admin para administrar grupos de WhatsApp, com categorias, busca e explicacao completa de cada recurso.";

const jsonLdString = (payload: unknown): string =>
  JSON.stringify(payload).replace(/</g, "\\u003c");

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getPublicAppBaseUrl();
  const canonical = new URL("/comandos", baseUrl).toString();

  try {
    const settings = await getAdminSiteSettings();
    const siteName = settings.siteName ?? "Bot Admin";
    const title = `${siteName} | Comandos para grupos de WhatsApp`;
    const description = FALLBACK_DESCRIPTION;

    return {
      title,
      description,
      keywords: [
        "comandos bot admin",
        "comandos bot whatsapp",
        "bot administrador whatsapp",
        "comando fechar grupo whatsapp",
        "comando regras whatsapp",
      ],
      alternates: { canonical },
      robots: {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          "max-snippet": -1,
          "max-image-preview": "large",
        },
      },
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
    console.error("Failed to load commands metadata", error);
    return {
      title: FALLBACK_TITLE,
      description: FALLBACK_DESCRIPTION,
      alternates: { canonical },
    };
  }
}

const buildCommandsJsonLd = (params: {
  baseUrl: string;
  siteName: string;
  sections: CommandsSectionData[];
}) => {
  const pageUrl = new URL("/comandos", params.baseUrl).toString();
  const commands = params.sections.flatMap((section) =>
    section.tutorials.map((tutorial) => ({
      sectionTitle: section.title,
      tutorial,
      url: new URL(getCommandPagePathFromTutorialSlug(tutorial.slug) ?? "/comandos", params.baseUrl).toString(),
    })),
  );

  const summarizeCommand = (title: string, description: string) =>
    summarizeRichText(description, 240)
      .replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
      .trim();

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${pageUrl}#collection`,
        name: FALLBACK_TITLE,
        description: FALLBACK_DESCRIPTION,
        url: pageUrl,
        isPartOf: {
          "@type": "WebSite",
          name: params.siteName,
          url: params.baseUrl,
        },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: commands.length,
          itemListElement: commands.map(({ sectionTitle, tutorial, url }, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: tutorial.title,
            url,
            description: summarizeCommand(tutorial.title, tutorial.description),
            item: {
              "@type": "HowTo",
              name: tutorial.title,
              description: summarizeCommand(tutorial.title, tutorial.description),
              url,
              about: sectionTitle,
            },
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Inicio",
            item: params.baseUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Comandos",
            item: pageUrl,
          },
        ],
      },
    ],
  };
};

const CommandsPage = async () => {
  const [settings, tutorials] = await Promise.all([
    getAdminSiteSettings(),
    getPublicFieldTutorials(),
  ]);
  const baseUrl = getPublicAppBaseUrl();
  const siteName = settings.siteName ?? "Bot Admin";
  const tutorialsBySlug = new Map(tutorials.map((tutorial) => [tutorial.slug, tutorial]));
  const sections = getGeneratedCommandTutorialSections(tutorialsBySlug);
  const totalCommands = sections.reduce((sum, section) => sum + section.tutorials.length, 0);
  const jsonLd = buildCommandsJsonLd({ baseUrl, siteName, sections });

  return (
    <PublicPageShell
      logoUrl={settings.logoUrl}
      siteName={siteName}
      activePath="/comandos"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-4">
        <Link href="/" className="landing-btn landing-btn--ghost">
          Voltar para inicio
        </Link>
        <Link href="/tutorials" className="landing-btn landing-btn--neon">
          Ver todos os tutoriais
        </Link>
      </div>

      <header className="text-center mb-5">
        <span className="badge bg-primary-subtle text-primary text-uppercase mb-3">
          Comandos do Bot Admin
        </span>
        <h1 className="fw-bold mb-3 landing-title">
          Comandos do Bot Admin para administrar grupos de WhatsApp
        </h1>
        <p className="text-secondary mb-0">
          Consulte {totalCommands} comandos organizados por categoria. Clique em
          qualquer comando para abrir a explicacao completa e exemplos de uso
          dentro do WhatsApp.
        </p>
      </header>

      <CommandsDirectory sections={sections} />
    </PublicPageShell>
  );
};

export default CommandsPage;
