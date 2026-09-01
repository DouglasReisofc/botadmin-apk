import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminSiteSettings } from "lib/admin-site";
import {
  findGeneratedCommandTutorialSection,
  getCommandPagePathFromTutorialSlug,
  getCommandTutorialSlug,
  normalizeCommand,
  stripCommandRelatedSection,
} from "lib/command-tutorials";
import { getPublicAppBaseUrl } from "lib/meta";
import { renderRichTextToHtml, summarizeRichText } from "lib/terms";
import { getPublicTutorialBySlug } from "lib/tutorials";
import CommandPhoneDemo from "components/site/CommandPhoneDemo";
import PublicPageShell from "components/site/PublicPageShell";

type CommandPageParams = {
  params: Promise<{
    command: string;
  }>;
};

export const dynamic = "force-dynamic";

const jsonLdString = (payload: unknown): string =>
  JSON.stringify(payload).replace(/</g, "\\u003c");

const summarizeCommandDescription = (title: string, description: string, maxLength = 220) =>
  summarizeRichText(description, maxLength)
    .replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    .trim();

const getCommandTutorial = async (commandParam: string) => {
  const command = normalizeCommand(decodeURIComponent(commandParam));
  const slug = getCommandTutorialSlug(command);
  if (!command || !slug) {
    return null;
  }

  const tutorial = await getPublicTutorialBySlug(slug);
  return tutorial ? { command, slug, tutorial } : null;
};

export async function generateMetadata({ params }: CommandPageParams): Promise<Metadata> {
  const { command: commandParam } = await params;
  const baseUrl = getPublicAppBaseUrl();
  const [settings, commandData] = await Promise.all([
    getAdminSiteSettings().catch(() => null),
    getCommandTutorial(commandParam),
  ]);

  if (!commandData) {
    return {
      title: "Comando nao encontrado",
      robots: { index: false, follow: false },
    };
  }

  const siteName = settings?.siteName ?? "Bot Admin";
  const path = getCommandPagePathFromTutorialSlug(commandData.slug) ?? `/comandos/${commandData.command}`;
  const canonical = new URL(path, baseUrl).toString();
  const description =
    summarizeCommandDescription(commandData.tutorial.title, commandData.tutorial.description) ||
    `Veja como usar o comando !${commandData.command} no BotAdmin para WhatsApp.`;

  return {
    title: `${commandData.tutorial.title} para WhatsApp | ${siteName}`,
    description,
    alternates: { canonical },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-snippet": -1,
      },
    },
    openGraph: {
      title: commandData.tutorial.title,
      description,
      url: canonical,
      siteName,
      type: "article",
    },
    twitter: {
      card: "summary",
      title: commandData.tutorial.title,
      description,
    },
  };
}

const CommandDetailPage = async ({ params }: CommandPageParams) => {
  const { command: commandParam } = await params;
  const [settings, commandData] = await Promise.all([
    getAdminSiteSettings().catch(() => null),
    getCommandTutorial(commandParam),
  ]);

  if (!commandData) {
    notFound();
  }

  const baseUrl = getPublicAppBaseUrl();
  const siteName = settings?.siteName ?? "Bot Admin";
  const section = findGeneratedCommandTutorialSection(commandData.slug);
  const commandPath = getCommandPagePathFromTutorialSlug(commandData.slug) ?? `/comandos/${commandData.command}`;
  const pageUrl = new URL(commandPath, baseUrl).toString();
  const cleanDescription = stripCommandRelatedSection(commandData.tutorial.description);
  const htmlDescription = renderRichTextToHtml(cleanDescription);
  const summary = summarizeCommandDescription(commandData.tutorial.title, cleanDescription);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "HowTo",
        "@id": `${pageUrl}#howto`,
        name: commandData.tutorial.title,
        description: summary,
        url: pageUrl,
        about: section?.title ?? "Comandos do Bot Admin",
        isPartOf: {
          "@type": "WebSite",
          name: siteName,
          url: baseUrl,
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
            item: baseUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Comandos",
            item: new URL("/comandos", baseUrl).toString(),
          },
          {
            "@type": "ListItem",
            position: 3,
            name: commandData.tutorial.title,
            item: pageUrl,
          },
        ],
      },
    ],
  };

  return (
    <PublicPageShell
      logoUrl={settings?.logoUrl}
      siteName={siteName}
      activePath="/comandos"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-4">
        <Link href="/comandos" className="landing-btn landing-btn--ghost">
          Voltar para comandos
        </Link>
        <span className="badge bg-primary-subtle text-primary text-uppercase">
          {section?.title ?? "Comando do BotAdmin"}
        </span>
      </div>

      <header className="text-center mb-5">
        <span className="badge bg-dark-subtle text-dark mb-3">!{commandData.command}</span>
        <h1 className="fw-bold mb-3 landing-title">{commandData.tutorial.title}</h1>
        {summary && <p className="text-secondary mb-0">{summary}</p>}
      </header>

      <CommandPhoneDemo
        command={commandData.command}
        title={commandData.tutorial.title}
        summary={summary}
        sectionTitle={section?.title}
      />

      <article
        className="landing-card p-4 p-lg-5 mt-4"
        style={{ lineHeight: 1.7 }}
        dangerouslySetInnerHTML={{
          __html:
            htmlDescription ||
            "<p class='text-secondary'>Este comando ainda nao possui conteudo detalhado.</p>",
        }}
      />
    </PublicPageShell>
  );
};

export default CommandDetailPage;
