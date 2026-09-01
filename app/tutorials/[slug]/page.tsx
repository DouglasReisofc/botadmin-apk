/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "react-bootstrap";

import { getAdminSiteSettings } from "lib/admin-site";
import { getCommandFromTutorialSlug, stripCommandRelatedSection } from "lib/command-tutorials";
import { getPublicAppBaseUrl } from "lib/meta";
import { findPublicTutorialSection, getPublicTutorialBySlug } from "lib/tutorials";
import { renderRichTextToHtml, summarizeRichText } from "lib/terms";
import CommandPhoneDemo from "components/site/CommandPhoneDemo";

type TutorialPageParams = {
  params: Promise<{
    slug: string;
  }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: TutorialPageParams): Promise<Metadata> {
  const { slug } = await params;
  const baseUrl = getPublicAppBaseUrl();
  const [settings, tutorial] = await Promise.all([
    getAdminSiteSettings().catch(() => null),
    getPublicTutorialBySlug(slug),
  ]);

  if (!tutorial) {
    return {
      title: "Tutorial não encontrado",
      robots: { index: false },
    };
  }

  const siteName = settings?.siteName ?? "Bot Admin";
  const canonical = new URL(`/tutorials/${slug}`, baseUrl).toString();
  const description =
    summarizeRichText(tutorial.description, 200) ||
    "Aprenda a configurar este recurso do Bot Admin com o passo a passo completo.";

  const images: string[] = [];
  if (tutorial.mediaUrl && tutorial.mediaType === "image") {
    images.push(new URL(tutorial.mediaUrl, baseUrl).toString());
  } else if (settings?.seoImageUrl) {
    images.push(new URL(settings.seoImageUrl, baseUrl).toString());
  }

  return {
    title: `${tutorial.title} | Tutoriais ${siteName}`,
    description,
    alternates: { canonical },
    openGraph: {
      title: tutorial.title,
      description,
      url: canonical,
      siteName,
      type: "article",
      images: images.length ? images.map((url) => ({ url })) : undefined,
    },
    twitter: {
      card: images.length ? "summary_large_image" : "summary",
      title: tutorial.title,
      description,
      images: images.length ? images : undefined,
    },
  };
}

const TutorialDetailPage = async ({ params }: TutorialPageParams) => {
  const { slug } = await params;
  const tutorial = await getPublicTutorialBySlug(slug);

  if (!tutorial) {
    notFound();
  }

  const section = findPublicTutorialSection(tutorial.slug);
  const command = getCommandFromTutorialSlug(tutorial.slug);
  const cleanDescription = command
    ? stripCommandRelatedSection(tutorial.description)
    : tutorial.description;
  const htmlDescription = renderRichTextToHtml(cleanDescription);
  const summary = summarizeRichText(cleanDescription, 220)
    .replace(new RegExp(`^${tutorial.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    .trim();
  const updatedLabel = (() => {
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "long",
      }).format(new Date(tutorial.updatedAt));
    } catch {
      return null;
    }
  })();

  const renderMedia = () => {
    if (!tutorial.mediaUrl) {
      return null;
    }

    if (tutorial.mediaType === "video") {
      return (
        <div className="ratio ratio-16x9 rounded-4 overflow-hidden shadow-sm">
          <video controls preload="metadata" src={tutorial.mediaUrl} className="w-100 h-100">
            Seu navegador não suporta a reprodução deste vídeo.
          </video>
        </div>
      );
    }

    return (
      <img
        src={tutorial.mediaUrl}
        alt={`Tutorial ${tutorial.title}`}
        className="img-fluid rounded-4 shadow-sm"
        style={{ maxHeight: "420px", objectFit: "cover" }}
      />
    );
  };

  return (
    <main className="py-10 py-lg-12 bg-light">
      <Container>
        <div className="mx-auto" style={{ maxWidth: "920px" }}>
          <header className="mb-5 text-center">
            {section && (
              <div className="d-flex flex-column gap-2 align-items-center mb-3">
                <span className="badge bg-primary-subtle text-primary text-uppercase">
                  {section.title}
                </span>
                <span className="text-secondary small text-center" style={{ maxWidth: "640px" }}>
                  {section.fieldDescription}
                </span>
              </div>
            )}
            <h1 className="fw-bold mb-3">{tutorial.title}</h1>
            {updatedLabel && (
              <p className="text-secondary small mb-0">Atualizado em {updatedLabel}</p>
            )}
          </header>

          <div className="d-flex flex-column gap-5">
            {renderMedia()}
            {command ? (
              <CommandPhoneDemo
                command={command}
                title={tutorial.title}
                summary={summary}
                sectionTitle={section?.title}
              />
            ) : null}
            <article
              className="bg-white border rounded-4 shadow-sm p-4 p-lg-5"
              style={{ lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{
                __html:
                  htmlDescription ||
                  "<p class='text-secondary'>Este tutorial ainda não possui conteúdo detalhado.</p>",
              }}
            />

            <div className="text-center">
              <Link href="/tutorials" className="btn btn-outline-primary">
                Voltar para todos os tutoriais
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </main>
  );
};

export default TutorialDetailPage;
