/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Col, Form, Row } from "react-bootstrap";

import FloatingAlert from "components/common/FloatingAlert";
import type { PlanGuardSettings, PlanGuardTemplateType } from "types/plan-guard";

const TEMPLATE_ORDER: readonly PlanGuardTemplateType[] = ["plan", "instance", "group"];

const TEMPLATE_LABELS: Record<PlanGuardTemplateType, { title: string; description: string }> = {
  plan: {
    title: "Plano principal",
    description: "Mensagem mostrada quando o plano do usuário está inativo.",
  },
  instance: {
    title: "Instâncias adicionais",
    description: "Utilizada quando uma instância extra está sem cobertura ativa.",
  },
  group: {
    title: "Grupos adicionais",
    description: "Enviada quando um grupo extra perdeu o add-on correspondente.",
  },
};

type TemplateEditorState = {
  caption: string;
  imageUrl: string | null;
  previewUrl: string | null;
  file: File | null;
  removeImage: boolean;
};

type AdminPlanGuardSettingsProps = {
  initialSettings: PlanGuardSettings;
  variables: Array<{ token: string; description: string }>;
};

const buildInitialTemplateState = (settings: PlanGuardSettings): Record<PlanGuardTemplateType, TemplateEditorState> => {
  const state = {} as Record<PlanGuardTemplateType, TemplateEditorState>;
  TEMPLATE_ORDER.forEach((type) => {
    const template = settings.templates[type];
    state[type] = {
      caption: template.caption,
      imageUrl: template.imageUrl ?? null,
      previewUrl: null,
      file: null,
      removeImage: false,
    };
  });
  return state;
};

const AdminPlanGuardSettings = ({ initialSettings, variables }: AdminPlanGuardSettingsProps) => {
  const [siteUrl, setSiteUrl] = useState(() => initialSettings.siteUrl ?? "");
  const [templates, setTemplates] = useState(() => buildInitialTemplateState(initialSettings));
  const [alert, setAlert] = useState<{ variant: "success" | "danger"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => {
    TEMPLATE_ORDER.forEach((type) => {
      const preview = templates[type].previewUrl;
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCaptionChange = (type: PlanGuardTemplateType, value: string) => {
    setTemplates((previous) => ({
      ...previous,
      [type]: {
        ...previous[type],
        caption: value,
      },
    }));
  };

  const handleFileChange = (type: PlanGuardTemplateType, file: File | null) => {
    setTemplates((previous) => {
      const current = previous[type];
      if (current.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      if (!file) {
        return {
          ...previous,
          [type]: {
            ...current,
            file: null,
            previewUrl: null,
            removeImage: current.imageUrl ? current.removeImage : false,
          },
        };
      }
      const previewUrl = URL.createObjectURL(file);
      return {
        ...previous,
        [type]: {
          ...current,
          file,
          previewUrl,
          removeImage: false,
        },
      };
    });
  };

  const handleRemoveImage = (type: PlanGuardTemplateType) => {
    setTemplates((previous) => {
      const current = previous[type];
      if (current.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return {
        ...previous,
        [type]: {
          ...current,
          file: null,
          previewUrl: null,
          imageUrl: null,
          removeImage: true,
        },
      };
    });
  };

  const resetTemplateState = (nextSettings: PlanGuardSettings) => {
    setTemplates((prev) => {
      TEMPLATE_ORDER.forEach((type) => {
        const preview = prev[type].previewUrl;
        if (preview) {
          URL.revokeObjectURL(preview);
        }
      });
      return buildInitialTemplateState(nextSettings);
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setAlert(null);

    try {
      const formData = new FormData();
      formData.append("siteUrl", siteUrl);

      TEMPLATE_ORDER.forEach((type) => {
        const template = templates[type];
        formData.append(`caption_${type}`, template.caption);
        if (template.removeImage) {
          formData.append(`removeImage_${type}`, "true");
        }
        if (template.file) {
          formData.append(`image_${type}`, template.file);
        }
      });

      const response = await fetch("/api/admin/plan-guard", {
        method: "PUT",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data.message === "string" ? data.message : "Não foi possível salvar as configurações.");
      }

      if (data.settings) {
        setSiteUrl(data.settings.siteUrl ?? "");
        resetTemplateState(data.settings as PlanGuardSettings);
      }

      setAlert({
        variant: "success",
        message: typeof data.message === "string" ? data.message : "Configurações atualizadas com sucesso.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível salvar as configurações.";
      setAlert({ variant: "danger", message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <Form onSubmit={handleSubmit} className="card-body d-flex flex-column gap-4">
        <div>
          <h2 className="h5 mb-2">Bloqueio por plano vencido</h2>
          <p className="text-secondary mb-0">
            Personalize a mensagem e a mídia enviadas quando um administrador tentar usar o robô com plano, instância ou grupo vencidos.
          </p>
        </div>

        <Row className="g-3">
          <Col md={6}>
            <Form.Group controlId="planGuardSiteUrl">
              <Form.Label>URL do painel / loja</Form.Label>
              <Form.Control
                type="url"
                placeholder="https://example.com"
                value={siteUrl}
                onChange={(event) => setSiteUrl(event.target.value)}
              />
              <Form.Text className="text-secondary">
                Essa URL será usada para direcionar o usuário a regularizar o pagamento.
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Card className="h-100">
              <Card.Body>
                <Card.Title as="h3" className="h6">Variáveis disponíveis</Card.Title>
                <ul className="mb-0 small text-secondary ps-3">
                  {variables.map((entry) => (
                    <li key={entry.token}>
                      <code>{entry.token}</code> — {entry.description}
                    </li>
                  ))}
                </ul>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <div className="d-flex flex-column gap-4">
          {TEMPLATE_ORDER.map((type) => {
            const state = templates[type];
            const label = TEMPLATE_LABELS[type];
            const preview = state.previewUrl ?? state.imageUrl;
            return (
              <Card key={type}>
                <Card.Body className="d-flex flex-column gap-3">
                  <div>
                    <Card.Title as="h3" className="h6 mb-1">{label.title}</Card.Title>
                    <p className="text-secondary mb-0">{label.description}</p>
                  </div>

                  <Form.Group controlId={`caption-${type}`}>
                    <Form.Label>Legenda do aviso</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={5}
                      value={state.caption}
                      onChange={(event) => handleCaptionChange(type, event.target.value)}
                    />
                    <Form.Text className="text-secondary">
                      Utilize as variáveis para dinamizar a mensagem. Quebras de linha são preservadas.
                    </Form.Text>
                  </Form.Group>

                  <div className="d-flex flex-column flex-md-row gap-3">
                    <Form.Group controlId={`image-${type}`} className="mb-0">
                      <Form.Label>Mídia opcional</Form.Label>
                      <Form.Control
                        type="file"
                        accept="image/*"
                        onChange={(event) => handleFileChange(type, event.target.files?.[0] ?? null)}
                      />
                      <Form.Text className="text-secondary">
                        Envie uma imagem para acompanhar a legenda. Formatos PNG, JPG ou WEBP são aceitos.
                      </Form.Text>
                    </Form.Group>
                    {preview ? (
                      <div className="border rounded p-2 align-self-start">
                        <img src={preview} alt="Pré-visualização" style={{ maxWidth: 200, height: "auto" }} />
                        <div className="mt-2 d-flex gap-2">
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            type="button"
                            onClick={() => handleRemoveImage(type)}
                          >
                            Remover imagem
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </Card.Body>
              </Card>
            );
          })}
        </div>

        <div className="d-flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Salvar alterações"}
          </Button>
          {alert ? <FloatingAlert variant={alert.variant} message={alert.message} onClose={() => setAlert(null)} /> : null}
        </div>
      </Form>
    </section>
  );
};

export default AdminPlanGuardSettings;
