"use client";

import { FormEvent, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Modal, Row } from "react-bootstrap";
import { useRouter } from "next/navigation";

import type { AdminEmailTemplate } from "types/email-templates";
import FloatingAlert from "components/common/FloatingAlert";

interface AdminEmailTemplatesManagerProps {
  templates: AdminEmailTemplate[];
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type TemplateFormState = {
  subject: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footerText: string;
};

const buildFormState = (template: AdminEmailTemplate): TemplateFormState => ({
  subject: template.subject,
  heading: template.heading,
  bodyHtml: template.bodyHtml,
  ctaLabel: template.ctaLabel ?? "",
  ctaUrl: template.ctaUrl ?? "",
  footerText: template.footerText ?? "",
});

const AdminEmailTemplatesManager = ({ templates }: AdminEmailTemplatesManagerProps) => {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [formState, setFormState] = useState<TemplateFormState | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [modalFeedback, setModalFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const templatesMap = useMemo(() => {
    const map = new Map<string, AdminEmailTemplate>();
    for (const template of templates) {
      map.set(template.key, template);
    }
    return map;
  }, [templates]);

  const openModal = (key: string) => {
    const template = templatesMap.get(key);
    if (!template) {
      setFeedback({ type: "danger", message: "Modelo não encontrado." });
      return;
    }

    setSelectedKey(key);
    setFormState(buildFormState(template));
    setModalFeedback(null);
  };

  const closeModal = () => {
    if (isSubmitting) {
      return;
    }
    setSelectedKey(null);
    setFormState(null);
    setModalFeedback(null);
  };

  const handleChange = <Field extends keyof TemplateFormState>(field: Field, value: TemplateFormState[Field]) => {
    setFormState((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedKey || !formState) {
      setModalFeedback({ type: "danger", message: "Selecione um modelo antes de salvar." });
      return;
    }

    setIsSubmitting(true);
    setModalFeedback(null);

    const payload = {
      subject: formState.subject,
      heading: formState.heading,
      bodyHtml: formState.bodyHtml,
      ctaLabel: formState.ctaLabel || null,
      ctaUrl: formState.ctaUrl || null,
      footerText: formState.footerText || null,
    };

    const response = await fetch(`/api/admin/notifications/templates/${selectedKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setModalFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível atualizar o modelo de e-mail.",
      });
      setIsSubmitting(false);
      return;
    }

    setModalFeedback({ type: "success", message: data.message ?? "Modelo atualizado com sucesso." });
    setIsSubmitting(false);
    router.refresh();
  };

  return (
    <section className="mt-5">
      <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="d-flex flex-column gap-4">
        {templates.length === 0 ? (
          <Card>
            <Card.Body>
              <p className="mb-0 text-secondary">Nenhum modelo disponível.</p>
            </Card.Body>
          </Card>
        ) : (
          <Row className="g-4">
            {templates.map((template) => (
              <Col md={6} key={template.key}>
                <Card className="h-100">
                  <Card.Body>
                    <div className="d-flex justify-content-between align-items-start mb-3">
                      <div>
                        <Card.Title as="h3" className="h6 mb-1">
                          {template.name}
                        </Card.Title>
                        <Card.Subtitle className="text-secondary small">
                          Atualizado em {new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                            timeZone: "America/Sao_Paulo",
                          }).format(new Date(template.updatedAt))}
                        </Card.Subtitle>
                      </div>
                      <Badge bg="dark" pill>
                        {template.key}
                      </Badge>
                    </div>
                    <p className="mb-2"><strong>Assunto:</strong> {template.subject}</p>
                    <p className="text-secondary mb-3" style={{ whiteSpace: "pre-line" }}>
                      {template.heading}
                    </p>
                    <Button variant="outline-primary" size="sm" onClick={() => openModal(template.key)}>
                      Editar modelo
                    </Button>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>

      <Modal show={Boolean(selectedKey && formState)} onHide={closeModal} centered size="lg">
        <Form onSubmit={handleSubmit}>
          <Modal.Header closeButton={!isSubmitting}>
            <Modal.Title>Editar modelo de e-mail</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <FloatingAlert
              feedback={modalFeedback}
              onClose={() => setModalFeedback(null)}
            />

            {formState ? (
              <div className="d-flex flex-column gap-3">
                <Form.Group controlId="templateSubject">
                  <Form.Label>Assunto</Form.Label>
                  <Form.Control
                    value={formState.subject}
                    onChange={(event) => handleChange("subject", event.target.value)}
                    maxLength={255}
                    required
                  />
                </Form.Group>

                <Form.Group controlId="templateHeading">
                  <Form.Label>Título no topo</Form.Label>
                  <Form.Control
                    value={formState.heading}
                    onChange={(event) => handleChange("heading", event.target.value)}
                    maxLength={255}
                    required
                  />
                </Form.Group>

                <Form.Group controlId="templateBody">
                  <Form.Label>Mensagem em HTML</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={8}
                    value={formState.bodyHtml}
                    onChange={(event) => handleChange("bodyHtml", event.target.value)}
                    required
                  />
                  <Form.Text className="text-secondary">
                    {"Use HTML básico e as variáveis disponíveis, por exemplo: {{userName}}, {{planName}}, {{amount}}."}
                  </Form.Text>
                </Form.Group>

                <Row className="g-3">
                  <Col md={6}>
                    <Form.Group controlId="templateCtaLabel">
                      <Form.Label>Texto do botão (opcional)</Form.Label>
                      <Form.Control
                        value={formState.ctaLabel}
                        onChange={(event) => handleChange("ctaLabel", event.target.value)}
                        maxLength={120}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group controlId="templateCtaUrl">
                      <Form.Label>URL do botão (opcional)</Form.Label>
                      <Form.Control
                        value={formState.ctaUrl}
                        onChange={(event) => handleChange("ctaUrl", event.target.value)}
                        maxLength={255}
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <Form.Group controlId="templateFooter">
                  <Form.Label>Rodapé</Form.Label>
                  <Form.Control
                    value={formState.footerText}
                    onChange={(event) => handleChange("footerText", event.target.value)}
                    maxLength={255}
                    placeholder="Equipe StoreBot"
                  />
                </Form.Group>
              </div>
            ) : (
              <div className="d-flex justify-content-center py-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Carregando...</span>
                </div>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={closeModal} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </section>
  );
};

export default AdminEmailTemplatesManager;
