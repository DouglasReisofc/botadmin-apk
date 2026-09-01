"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IconSearch } from "@tabler/icons-react";

type TutorialListItem = {
  slug: string;
  title: string;
  description: string;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  updatedAt: string;
};

export type TutorialsSectionData = {
  id: string;
  title: string;
  description: string;
  tutorials: TutorialListItem[];
};

type TutorialsDirectoryProps = {
  sections: TutorialsSectionData[];
};

const formatDate = (value: string) => {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "medium",
    }).format(new Date(value));
  } catch {
    return null;
  }
};

const buildSnippet = (text: string, maxLength = 160) => {
  const normalized = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
};

const TutorialsDirectory = ({ sections }: TutorialsDirectoryProps) => {
  const [query, setQuery] = useState("");

  const tutorials = useMemo(() => {
    return sections.flatMap((section) =>
      section.tutorials.map((tutorial) => ({
        ...tutorial,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionDescription: section.description,
        formattedUpdatedAt: formatDate(tutorial.updatedAt),
        snippet: buildSnippet(tutorial.description),
      })),
    );
  }, [sections]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) {
      return tutorials;
    }

    return tutorials.filter((tutorial) => {
      const haystack = [
        tutorial.title,
        tutorial.description,
        tutorial.sectionTitle,
        tutorial.slug,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [tutorials, normalizedQuery]);

  const groupBySection = useMemo(() => {
    if (normalizedQuery) {
      return [];
    }

    return sections.map((section) => ({
      ...section,
      tutorials: section.tutorials.map((tutorial) => {
        const flat = tutorials.find((item) => item.slug === tutorial.slug);
        return flat ?? { ...tutorial, snippet: buildSnippet(tutorial.description) };
      }),
    }));
  }, [normalizedQuery, sections, tutorials]);

  return (
    <div className="d-flex flex-column gap-5">
      <section className="card border-0 shadow-sm">
        <div className="card-body p-4 p-lg-5">
          <label className="form-label text-secondary fw-semibold" htmlFor="tutorial-search">
            Buscar tutoriais
          </label>
          <div className="input-group input-group-lg">
            <span className="input-group-text bg-transparent border-end-0">
              <IconSearch size={20} className="text-secondary" />
            </span>
            <input
              id="tutorial-search"
              type="search"
              className="form-control border-start-0"
              placeholder="Pesquise por recurso, comando ou palavra-chave"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <p className="text-secondary small mb-0 mt-2">
            {normalizedQuery
              ? `${filtered.length} tutorial${filtered.length === 1 ? "" : "s"} encontrados`
              : "Explore os guias abaixo ou filtre por nome, descrição ou comando."}
          </p>
        </div>
      </section>

      {normalizedQuery ? (
        <section className="card border-0 shadow-sm">
          <div className="card-body p-4 p-lg-5">
            <h2 className="h4 mb-4">Resultados da busca</h2>
            {filtered.length === 0 ? (
              <p className="text-secondary mb-0">
                Nenhum tutorial corresponde ao termo pesquisado. Tente outras palavras-chave.
              </p>
            ) : (
              <div className="row g-4">
                {filtered.map((tutorial) => (
                  <div className="col-md-6" key={tutorial.slug}>
                    <article className="h-100 border rounded-4 p-4 shadow-sm bg-white d-flex flex-column gap-3">
                      <div>
                        <span className="badge bg-primary-subtle text-primary me-2">
                          {tutorial.sectionTitle}
                        </span>
                        {tutorial.formattedUpdatedAt && (
                          <span className="text-secondary small">
                            Atualizado em {tutorial.formattedUpdatedAt}
                          </span>
                        )}
                      </div>
                      <div className="flex-grow-1">
                        <h3 className="h5 mb-2">
                          <Link href={`/tutorials/${tutorial.slug}`} className="text-decoration-none">
                            {tutorial.title}
                          </Link>
                        </h3>
                        <p className="text-secondary mb-0">{tutorial.snippet}</p>
                      </div>
                      <div>
                        <Link href={`/tutorials/${tutorial.slug}`} className="btn btn-outline-primary btn-sm">
                          Abrir tutorial
                        </Link>
                      </div>
                    </article>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        groupBySection.map((section) => (
          <section key={section.id} className="card border-0 shadow-sm">
            <div className="card-body p-4 p-lg-5">
              <header className="mb-4">
                <h2 className="h4 mb-2">{section.title}</h2>
                <p className="text-secondary mb-0">{section.description}</p>
              </header>
              {section.tutorials.length === 0 ? (
                <p className="text-secondary mb-0">
                  Nenhum tutorial cadastrado para esta seção por enquanto.
                </p>
              ) : (
                <div className="row g-4">
                  {section.tutorials.map((tutorial) => {
                    const formattedUpdatedAt = formatDate(tutorial.updatedAt);
                    const snippet = buildSnippet(tutorial.description);

                    return (
                      <div className="col-md-6" key={tutorial.slug}>
                        <article className="h-100 border rounded-4 p-4 shadow-sm bg-white d-flex flex-column gap-3">
                          <div className="flex-grow-1">
                            <h3 className="h5 mb-2">
                              <Link
                                href={`/tutorials/${tutorial.slug}`}
                                className="text-decoration-none"
                              >
                                {tutorial.title}
                              </Link>
                            </h3>
                            <p className="text-secondary mb-0">{snippet}</p>
                          </div>
                          <div className="d-flex justify-content-between align-items-center">
                            {formattedUpdatedAt && (
                              <span className="text-secondary small">
                                Atualizado em {formattedUpdatedAt}
                              </span>
                            )}
                            <Link
                              href={`/tutorials/${tutorial.slug}`}
                              className="btn btn-outline-primary btn-sm"
                            >
                              Ver detalhes
                            </Link>
                          </div>
                        </article>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        ))
      )}
    </div>
  );
};

export default TutorialsDirectory;
