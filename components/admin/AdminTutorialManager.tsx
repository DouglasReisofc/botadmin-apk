"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { Badge, Button, Card, Form, ListGroup, Modal } from "react-bootstrap";
import Image from "next/image";
import { IconPhoto, IconVideo } from "@tabler/icons-react";

import type {
  FieldTutorial,
  FieldTutorialMap,
  TutorialFieldDefinition,
  TutorialSection,
} from "types/tutorials";
import FloatingAlert from "components/common/FloatingAlert";

type Feedback = { type: "success" | "danger"; message: string } | null;

type TutorialFormState = {
  slug: string;
  title: string;
  description: string;
  mediaType: "image" | "video" | "";
  file: File | null;
  feedback: Feedback;
  isSubmitting: boolean;
};

const DEFAULT_DESCRIPTION =
  "Preencha as instruções que serão apresentadas aos usuários nesta etapa.";

const getAdminSections = (sections: TutorialSection[]): TutorialSection[] =>
  sections.filter((section) => section.id !== "webhook");

const getAdminFields = (sections: TutorialSection[]): TutorialFieldDefinition[] =>
  getAdminSections(sections).flatMap((section) => section.fields);

const findFieldBySlug = (sections: TutorialSection[], slug: string) =>
  getAdminFields(sections).find((field) => field.slug === slug) ?? null;

const resolveInitialSlug = (sections: TutorialSection[], tutorials: FieldTutorialMap): string => {
  const fields = getAdminFields(sections);
  const unconfigured = fields.find(
    (field) => !tutorials[field.slug]?.description?.trim(),
  );
  return unconfigured?.slug ?? fields[0]?.slug ?? "";
};

const createInitialState = (
  sections: TutorialSection[],
  tutorials: FieldTutorialMap,
  slug: string,
): TutorialFormState => {
  const fields = getAdminFields(sections);
  const normalizedSlug = slug || fields[0]?.slug || "";
  const field = findFieldBySlug(sections, normalizedSlug);
  const tutorial = normalizedSlug ? tutorials[normalizedSlug] : undefined;

  return {
    slug: normalizedSlug,
    title: (tutorial?.title ?? field?.label ?? normalizedSlug) || "Tutorial",
    description: tutorial?.description ?? "",
    mediaType: tutorial?.mediaType ?? (tutorial?.mediaUrl ? "image" : ""),
    file: null,
    feedback: null,
    isSubmitting: false,
  };
};

const parseMediaType = (file: File | null) => {
  if (!file) {
    return "";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  if (file.type.startsWith("image/")) {
    return "image";
  }

  return "";
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const renderMediaPreview = (tutorial?: FieldTutorial) => {
  if (!tutorial?.mediaUrl) {
    return null;
  }

  if (tutorial.mediaType === "video") {
    return (
      <video
        controls
        className="w-100 rounded border"
        src={tutorial.mediaUrl}
        aria-label="Pré-visualização do vídeo do tutorial"
      />
    );
  }

  return (
    <Image
      src={tutorial.mediaUrl}
      alt="Pré-visualização do tutorial"
      width={960}
      height={540}
      className="img-fluid rounded border"
      style={{ height: "auto" }}
      unoptimized
    />
  );
};

type Props = {
  tutorials: FieldTutorialMap;
  sections: TutorialSection[];
};

const AdminTutorialManager = ({ tutorials, sections }: Props) => {
  const adminSections = useMemo(() => getAdminSections(sections), [sections]);
  const adminFields = useMemo(() => getAdminFields(sections), [sections]);
  const [tutorialMap, setTutorialMap] = useState<FieldTutorialMap>(() => ({ ...tutorials }));
  const [modalState, setModalState] = useState<TutorialFormState>(() =>
    createInitialState(sections, tutorials, resolveInitialSlug(sections, tutorials)),
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [listFeedback, setListFeedback] = useState<Feedback>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const totalConfigured = useMemo(() => {
    return adminFields.filter((field) =>
      Boolean(tutorialMap[field.slug]?.description?.trim()),
    ).length;
  }, [adminFields, tutorialMap]);

  const configuredTutorials = useMemo(() => {
    return adminFields.reduce<Array<{ field: TutorialFieldDefinition; tutorial: FieldTutorial }>>(
      (accumulator, field) => {
        const tutorial = tutorialMap[field.slug];
        if (tutorial?.description?.trim()) {
          accumulator.push({ field, tutorial });
        }
        return accumulator;
      },
      [],
    );
  }, [adminFields, tutorialMap]);

  const currentTutorial = modalState.slug ? tutorialMap[modalState.slug] : undefined;
  const currentField = modalState.slug ? findFieldBySlug(sections, modalState.slug) : null;

  const openModal = (slug?: string) => {
    const targetSlug = slug || resolveInitialSlug(sections, tutorialMap);
    if (!targetSlug && !adminFields.length) {
      return;
    }

    setModalState((previous) => ({
      ...createInitialState(sections, tutorialMap, targetSlug || previous.slug),
      feedback: null,
    }));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalState((previous) => ({ ...previous, file: null, isSubmitting: false, feedback: null }));
  };

  const updateModalState = (patch: Partial<TutorialFormState>) => {
    setModalState((previous) => ({ ...previous, ...patch }));
  };

  const handleSlugChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSlug = event.currentTarget.value;
    setModalState((previous) => ({
      ...createInitialState(sections, tutorialMap, nextSlug || previous.slug),
      feedback: null,
    }));
  };

  const handleInputChange = (field: "title" | "description") =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      updateModalState({ [field]: event.currentTarget.value } as Partial<TutorialFormState>);
    };

  const handleMediaTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    if (value !== "image" && value !== "video" && value !== "") {
      return;
    }
    updateModalState({ mediaType: value as TutorialFormState["mediaType"] });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    updateModalState({
      file,
      mediaType: parseMediaType(file),
    });
  };

  const sendRequest = async (
    slug: string,
    bodyBuilder: (formData: FormData) => void,
  ): Promise<Response> => {
    const formData = new FormData();
    bodyBuilder(formData);
    return fetch(`/api/admin/tutorials/${slug}`, {
      method: "PUT",
      body: formData,
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { slug } = modalState;
    if (!slug) {
      return;
    }

    updateModalState({ isSubmitting: true, feedback: null });

    try {
      const response = await sendRequest(slug, (formData) => {
        formData.append("title", modalState.title);
        formData.append("description", modalState.description || DEFAULT_DESCRIPTION);
        formData.append("mediaType", modalState.mediaType ?? "");
        if (modalState.file) {
          formData.append("media", modalState.file);
        }
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível salvar o tutorial.";
        updateModalState({
          feedback: { type: "danger", message },
          isSubmitting: false,
        });
        return;
      }

      const tutorial = payload?.tutorial as FieldTutorial | undefined;
      if (tutorial) {
        setTutorialMap((previous) => ({ ...previous, [tutorial.slug]: tutorial }));
        updateModalState({
          title: tutorial.title,
          description: tutorial.description,
          mediaType: tutorial.mediaType ?? "",
          file: null,
          feedback: { type: "success", message: payload?.message ?? "Tutorial salvo com sucesso." },
          isSubmitting: false,
        });
      } else {
        updateModalState({
          file: null,
          feedback: { type: "success", message: payload?.message ?? "Tutorial salvo com sucesso." },
          isSubmitting: false,
        });
      }
    } catch (error) {
      console.error("Failed to submit tutorial", error);
      updateModalState({
        feedback: {
          type: "danger",
          message: "Não foi possível salvar o tutorial. Tente novamente em instantes.",
        },
        isSubmitting: false,
      });
    }
  };

  const handleRemoveMedia = async () => {
    const { slug } = modalState;
    if (!slug || !currentTutorial?.mediaUrl) {
      return;
    }

    updateModalState({ isSubmitting: true, feedback: null });

    try {
      const response = await sendRequest(slug, (formData) => {
        formData.append("title", modalState.title);
        formData.append("description", modalState.description || DEFAULT_DESCRIPTION);
        formData.append("removeMedia", "true");
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível remover a mídia.";
        updateModalState({
          feedback: { type: "danger", message },
          isSubmitting: false,
        });
        return;
      }

      const tutorial = payload?.tutorial as FieldTutorial | undefined;
      setTutorialMap((previous) => {
        if (tutorial) {
          return { ...previous, [slug]: tutorial };
        }

        const existing = previous[slug];
        if (!existing) {
          return previous;
        }

        return {
          ...previous,
          [slug]: {
            ...existing,
            mediaUrl: null,
            mediaPath: null,
            mediaType: null,
            updatedAt: new Date().toISOString(),
          },
        };
      });

      updateModalState({
        mediaType: "",
        file: null,
        feedback: { type: "success", message: payload?.message ?? "Mídia removida com sucesso." },
        isSubmitting: false,
      });
    } catch (error) {
      console.error("Failed to remove tutorial media", error);
      updateModalState({
        feedback: {
          type: "danger",
          message: "Não foi possível remover a mídia. Tente novamente em instantes.",
        },
        isSubmitting: false,
      });
    }
  };

  const handleDeleteTutorial = async (slug: string) => {
    if (!slug) {
      return;
    }

    setListFeedback(null);
    setDeletingSlug(slug);

    try {
      const response = await fetch(`/api/admin/tutorials/${slug}`, {
        method: "DELETE",
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível remover o tutorial.";
        setListFeedback({ type: "danger", message });
        return;
      }

      setTutorialMap((previous) => {
        const next = { ...previous };
        delete next[slug];
        setModalState((prevModal) => {
          const fallbackSlug =
            prevModal.slug === slug ? resolveInitialSlug(sections, next) : prevModal.slug;
          const nextState = createInitialState(sections, next, fallbackSlug);
          return nextState;
        });
        return next;
      });

      setListFeedback({
        type: "success",
        message: payload?.message ?? "Tutorial removido com sucesso.",
      });
    } catch (error) {
      console.error("Failed to delete tutorial", error);
      setListFeedback({
        type: "danger",
        message: "Não foi possível remover o tutorial. Tente novamente em instantes.",
      });
    } finally {
      setDeletingSlug(null);
    }
  };

  const renderFieldStatus = (tutorial?: FieldTutorial) => {
    if (!tutorial) {
      return (
        <div className="d-flex flex-column align-items-lg-end gap-1 text-secondary small">
          <Badge bg="secondary">Sem conteúdo</Badge>
          <span className="text-secondary small">Nenhuma atualização registrada</span>
        </div>
      );
    }

    const isVideo = tutorial.mediaType === "video";
    const isImage = tutorial.mediaType === "image";

    const badgeVariant = isVideo ? "info" : isImage ? "success" : "secondary";
    const badgeLabel = isVideo ? "Vídeo" : isImage ? "Imagem" : "Somente texto";
    const Icon = isVideo ? IconVideo : IconPhoto;

    return (
      <div className="d-flex flex-column align-items-lg-end gap-1 text-secondary small">
        <div className="d-flex align-items-center gap-2">
          <Badge bg={badgeVariant}>{badgeLabel}</Badge>
          {(isVideo || isImage) && <Icon size={16} strokeWidth={1.75} />}
        </div>
        <span className="text-secondary small">
          Atualizado em {formatDateTime(tutorial.updatedAt)}
        </span>
      </div>
    );
  };

  return (
    <div className="d-flex flex-column gap-5">
      <div>
        <h2 className="h4 mb-1">Tutoriais do painel</h2>
        <p className="text-secondary mb-0">
          Centralize vídeos, imagens e textos de apoio exibidos nas principais telas do painel do usuário.
          Selecione o destino desejado e cadastre materiais que orientem o uso dos recursos.
        </p>
        <p className="text-secondary small mb-0 mt-2">
          {totalConfigured > 0
            ? `${totalConfigured} campo(s) possuem tutoriais configurados.`
            : "Nenhum tutorial configurado até o momento."}
        </p>
      </div>

      <Card>
        <Card.Header className="d-flex flex-column flex-lg-row gap-3 justify-content-between align-items-lg-center">
          <div>
            <Card.Title as="h3" className="h5 mb-0">
              Biblioteca de tutoriais
            </Card.Title>
            <Card.Text className="text-secondary mb-0 mt-1">
              Acesse rapidamente todos os pontos do painel que aceitam tutoriais personalizados.
              Utilize o botão abaixo para criar ou editar conteúdos sem precisar percorrer vários cartões.
            </Card.Text>
          </div>
          <Button
            type="button"
            onClick={() => openModal()}
            disabled={!adminFields.length}
          >
            Novo tutorial
          </Button>
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-3">
          <FloatingAlert feedback={listFeedback} onClose={() => setListFeedback(null)} />

          {configuredTutorials.length === 0 ? (
            <p className="text-secondary mb-0">
              Nenhum tutorial foi cadastrado ainda. Clique em &quot;Novo tutorial&quot; para começar.
            </p>
          ) : (
            <ListGroup variant="flush" className="rounded border">
              {configuredTutorials.map(({ field, tutorial }) => (
                <ListGroup.Item
                  key={field.slug}
                  className="d-flex flex-column flex-lg-row gap-3 align-items-lg-center"
                >
                  <div className="flex-grow-1">
                    <div className="fw-semibold text-truncate">{tutorial.title}</div>
                    <div className="text-secondary small text-truncate">
                      {field.label} · {field.description}
                    </div>
                  </div>
                  {renderFieldStatus(tutorial)}
                  <div className="d-flex gap-2">
                    <Button
                      type="button"
                      variant="outline-primary"
                      size="sm"
                      onClick={() => openModal(field.slug)}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleDeleteTutorial(field.slug)}
                      disabled={deletingSlug === field.slug}
                    >
                      {deletingSlug === field.slug ? "Excluindo..." : "Excluir"}
                    </Button>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>

      <Modal show={isModalOpen} onHide={closeModal} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {currentField ? `Tutorial · ${currentField.label}` : "Gerenciar tutorial"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            <FloatingAlert
              feedback={modalState.feedback}
              onClose={() => updateModalState({ feedback: null })}
            />

            <Form.Group controlId="tutorial-slug">
              <Form.Label>Destino do tutorial</Form.Label>
              <Form.Select
                value={modalState.slug}
                onChange={handleSlugChange}
                disabled={modalState.isSubmitting}
              >
                {adminSections.map((section) => (
                  <optgroup key={section.id} label={section.title}>
                    {section.fields.map((field) => (
                      <option key={field.slug} value={field.slug}>
                        {field.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Form.Select>
              {currentField ? (
                <Form.Text className="text-secondary">
                  {currentField.description}
                </Form.Text>
              ) : null}
            </Form.Group>

            <Form.Group controlId="tutorial-title">
              <Form.Label>Título do tutorial</Form.Label>
              <Form.Control
                value={modalState.title}
                onChange={handleInputChange("title")}
                placeholder="Ex.: Como configurar este recurso"
                disabled={modalState.isSubmitting}
                required
              />
            </Form.Group>

            <Form.Group controlId="tutorial-description">
              <Form.Label>Descrição detalhada</Form.Label>
              <Form.Control
                as="textarea"
                rows={5}
                value={modalState.description}
                onChange={handleInputChange("description")}
                placeholder={DEFAULT_DESCRIPTION}
                disabled={modalState.isSubmitting}
                required
              />
            </Form.Group>

            <div className="d-flex flex-column gap-2">
              <Form.Label className="mb-0">Mídia de apoio</Form.Label>
              {renderMediaPreview(currentTutorial)}

              <div className="d-flex flex-column flex-md-row gap-2">
                <Form.Group controlId="tutorial-media-type" className="flex-grow-1">
                  <Form.Select
                    value={modalState.mediaType ?? ""}
                    onChange={handleMediaTypeChange}
                    disabled={modalState.isSubmitting}
                  >
                    <option value="">Selecionar tipo de mídia</option>
                    <option value="image">Imagem</option>
                    <option value="video">Vídeo</option>
                  </Form.Select>
                </Form.Group>
                <Form.Group controlId="tutorial-media-file" className="flex-grow-1">
                  <Form.Control
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileChange}
                    disabled={modalState.isSubmitting}
                  />
                  {modalState.file && (
                    <Form.Text className="text-truncate d-block">
                      Arquivo selecionado: {modalState.file.name}
                    </Form.Text>
                  )}
                </Form.Group>
              </div>

              <Form.Text className="text-secondary">
                Você pode enviar imagens (JPG, PNG, WebP) ou vídeos (MP4, MOV, WEBM) com ou sem legenda.
                Caso não queira utilizar mídia, deixe este campo em branco.
              </Form.Text>

              <div className="d-flex gap-2">
                <Button
                  type="button"
                  variant="outline-danger"
                  onClick={handleRemoveMedia}
                  disabled={modalState.isSubmitting || !currentTutorial?.mediaUrl}
                >
                  Remover mídia
                </Button>
              </div>
            </div>

            <div className="d-flex justify-content-end gap-2">
              <Button type="button" variant="outline-secondary" onClick={closeModal}>
                Cancelar
              </Button>
              <Button type="submit" disabled={modalState.isSubmitting}>
                {modalState.isSubmitting ? "Salvando..." : "Salvar tutorial"}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default AdminTutorialManager;
