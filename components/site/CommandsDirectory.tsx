"use client";

import { useMemo, useState } from "react";
import { Modal } from "react-bootstrap";
import {
  IconHash,
  IconExternalLink,
  IconInfoCircle,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";

import { summarizeRichText } from "lib/terms";

type CommandListItem = {
  slug: string;
  title: string;
  description: string;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  updatedAt: string;
};

export type CommandsSectionData = {
  id: string;
  title: string;
  description: string;
  tutorials: CommandListItem[];
};

type CommandsDirectoryProps = {
  sections: CommandsSectionData[];
};

const getCommandName = (title: string) => {
  const match = title.match(/!(\S+)/);
  return match?.[0] ?? title;
};

const getCommandPageHref = (slug: string) => {
  const command = slug.trim().toLowerCase().replace(/^command-/, "");
  return command ? `/comandos/${encodeURIComponent(command)}` : "/comandos";
};

const buildCommandSnippet = (title: string, description: string) =>
  summarizeRichText(description, 180)
    .replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    .trim();

const descriptionToBlocks = (description: string) =>
  description
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

const CommandsDirectory = ({ sections }: CommandsDirectoryProps) => {
  const [query, setQuery] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("all");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const commands = useMemo(
    () =>
      sections.flatMap((section) =>
        section.tutorials.map((tutorial) => ({
          ...tutorial,
          sectionId: section.id,
          sectionTitle: section.title,
          commandName: getCommandName(tutorial.title),
          snippet: buildCommandSnippet(tutorial.title, tutorial.description),
        })),
      ),
    [sections],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = useMemo(
    () =>
      commands.filter((command) => {
        const matchesSection = activeSectionId === "all" || command.sectionId === activeSectionId;
        if (!matchesSection) return false;
        if (!normalizedQuery) return true;
        return [
          command.title,
          command.commandName,
          command.description,
          command.sectionTitle,
          command.slug,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    [activeSectionId, commands, normalizedQuery],
  );

  const selectedCommand = commands.find((command) => command.slug === selectedSlug) ?? null;
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? null;

  return (
    <>
      <section className="border rounded bg-white shadow-sm overflow-hidden">
        <div className="p-4 p-lg-5 bg-light border-bottom">
          <div className="row g-3 align-items-end">
            <div className="col-lg-7">
              <label className="form-label text-secondary fw-semibold" htmlFor="command-search">
                Buscar comando
              </label>
              <div className="input-group input-group-lg">
                <span className="input-group-text bg-white border-end-0">
                  <IconSearch size={18} className="text-secondary" />
                </span>
                <input
                  id="command-search"
                  type="search"
                  className="form-control border-start-0"
                  placeholder="!fechargrupo, regras, sticker..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="col-lg-5">
              <label className="form-label text-secondary fw-semibold" htmlFor="command-category">
                Categoria
              </label>
              <select
                id="command-category"
                className="form-select form-select-lg"
                value={activeSectionId}
                onChange={(event) => setActiveSectionId(event.target.value)}
              >
                <option value="all">Todas as categorias ({commands.length})</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title} ({section.tutorials.length})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="d-flex align-items-center flex-wrap gap-2 mt-4">
            <span className="d-inline-flex align-items-center gap-2 badge rounded-pill bg-primary-subtle text-primary border border-primary-subtle px-3 py-2">
              <IconHash size={16} />
              {commands.length} comandos ativos
            </span>
            <span className="badge rounded-pill bg-white text-dark border px-3 py-2">
              {activeSection ? activeSection.title : "Todas as categorias"}
            </span>
          </div>
        </div>

        <div className="p-4 border-bottom d-flex justify-content-between align-items-center gap-3">
          <div>
            <h2 className="h5 fw-bold mb-1">Comandos encontrados</h2>
            <p className="text-secondary small mb-0">
              {filteredCommands.length} comando{filteredCommands.length === 1 ? "" : "s"} exibido
              {filteredCommands.length === 1 ? "" : "s"} para o filtro atual.
            </p>
          </div>
          <IconTerminal2 className="text-primary flex-shrink-0" size={28} />
        </div>

        <div className="list-group list-group-flush">
          {filteredCommands.length === 0 ? (
            <div className="p-4 text-secondary">
              Nenhum comando corresponde ao filtro usado.
            </div>
          ) : (
            filteredCommands.map((command) => (
              <div key={command.slug} className="list-group-item p-0">
                <button
                  type="button"
                  className="btn btn-link w-100 p-4 text-start text-decoration-none text-dark"
                  onClick={() => setSelectedSlug(command.slug)}
                >
                  <div className="d-flex align-items-start justify-content-between gap-3">
                    <div>
                      <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
                        <span className="badge bg-primary-subtle text-primary">{command.commandName}</span>
                        <span className="badge bg-light text-dark border">{command.sectionTitle}</span>
                      </div>
                      <h3 className="h6 fw-bold mb-1">{command.title}</h3>
                      <p className="text-secondary mb-0">{command.snippet}</p>
                    </div>
                    <IconInfoCircle className="text-primary flex-shrink-0 mt-1" size={22} />
                  </div>
                </button>
                <div className="px-4 pb-3">
                  <a
                    href={getCommandPageHref(command.slug)}
                    className="small fw-semibold text-decoration-none d-inline-flex align-items-center gap-1"
                  >
                    Ver pagina do comando
                    <IconExternalLink size={14} />
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <Modal show={Boolean(selectedCommand)} onHide={() => setSelectedSlug(null)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>{selectedCommand?.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedCommand ? (
            <div className="d-flex flex-column gap-3">
              <div>
                <span className="badge bg-primary-subtle text-primary me-2">
                  {selectedCommand.commandName}
                </span>
                <span className="badge bg-light text-dark border">{selectedCommand.sectionTitle}</span>
              </div>
              {descriptionToBlocks(selectedCommand.description).map((block, index) => {
                if (block.startsWith("# ")) {
                  return (
                    <h2 key={index} className="h4 fw-bold mb-0">
                      {block.replace(/^#\s+/, "")}
                    </h2>
                  );
                }
                if (block.startsWith("## ")) {
                  return (
                    <h3 key={index} className="h5 fw-bold mb-0">
                      {block.replace(/^##\s+/, "")}
                    </h3>
                  );
                }
                return (
                  <p key={index} className="text-secondary mb-0" style={{ whiteSpace: "pre-line" }}>
                    {block.replace(/^- /gm, "• ")}
                  </p>
                );
              })}
            </div>
          ) : null}
        </Modal.Body>
      </Modal>
    </>
  );
};

export default CommandsDirectory;
