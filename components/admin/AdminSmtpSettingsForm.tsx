"use client";

import { Fragment, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Badge, Button, Card, Col, Form, Modal, Row } from "react-bootstrap";
import { useRouter } from "next/navigation";

import type { AdminSmtpSettings } from "types/notifications";
import FloatingAlert from "components/common/FloatingAlert";

interface AdminSmtpSettingsFormProps {
  initialSettings: AdminSmtpSettings;
}

type FormState = {
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

type Feedback = { type: "success" | "danger"; message: string } | null;

const buildInitialState = (settings: AdminSmtpSettings): FormState => ({
  host: settings.host,
  port: settings.port.toString(),
  secure: settings.secure,
  username: settings.username ?? "",
  password: "",
  fromName: settings.fromName,
  fromEmail: settings.fromEmail,
  replyTo: settings.replyTo ?? "",
});

const AdminSmtpSettingsForm = ({ initialSettings }: AdminSmtpSettingsFormProps) => {
  const router = useRouter();
  const [formState, setFormState] = useState<FormState>(() => buildInitialState(initialSettings));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("-");
  const [showTestModal, setShowTestModal] = useState(false);
  const [testEmail, setTestEmail] = useState(() => initialSettings.fromEmail || "");
  const [testFeedback, setTestFeedback] = useState<Feedback>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!initialSettings.updatedAt) {
      setLastUpdatedLabel("-");
      return;
    }

    try {
      const formatter = new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      });
      setLastUpdatedLabel(formatter.format(new Date(initialSettings.updatedAt)));
    } catch (error) {
      console.warn("Failed to format SMTP updated date", error);
      setLastUpdatedLabel("-");
    }
  }, [initialSettings.updatedAt]);

  useEffect(() => {
    setFormState(buildInitialState(initialSettings));
    setFeedback(null);
    setTestEmail(initialSettings.fromEmail || "");
  }, [initialSettings]);

  const handleChange = <Field extends keyof FormState>(field: Field, value: FormState[Field]) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleReset = () => {
    setFormState(buildInitialState(initialSettings));
    setFeedback(null);
  };

  const openTestModal = () => {
    setTestEmail(initialSettings.fromEmail || "");
    setTestFeedback(null);
    setShowTestModal(true);
  };

  const closeTestModal = () => {
    if (isTesting) {
      return;
    }
    setShowTestModal(false);
  };

  const handleTestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsTesting(true);
    setTestFeedback(null);

    const response = await fetch("/api/admin/notifications/smtp/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: testEmail }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setTestFeedback({
        type: "danger",
        message: data.message ?? "Falha ao enviar o e-mail de teste.",
      });
      setIsTesting(false);
      return;
    }

    setTestFeedback({
      type: "success",
      message: data.message ?? "E-mail de teste enviado com sucesso.",
    });
    setIsTesting(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    const payload = {
      host: formState.host,
      port: Number.parseInt(formState.port, 10),
      secure: formState.secure,
      username: formState.username || null,
      password: formState.password || null,
      fromName: formState.fromName,
      fromEmail: formState.fromEmail,
      replyTo: formState.replyTo || null,
    };

    const response = await fetch("/api/admin/notifications/smtp", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível salvar as configurações SMTP.",
      });
      setIsSubmitting(false);
      return;
    }

    setFeedback({
      type: "success",
      message: data.message ?? "Configurações atualizadas com sucesso.",
    });
    setIsSubmitting(false);
    router.refresh();
  };

  return (
    <Fragment>
      <Card>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <div>
          <Card.Title as="h2" className="h5 mb-1">
            Servidor SMTP
          </Card.Title>
          <Card.Subtitle className="text-secondary small">
            Configure as credenciais usadas para enviar e-mails de notificações automáticas do StoreBot.
          </Card.Subtitle>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button variant="outline-primary" size="sm" onClick={openTestModal}>
            Testar SMTP
          </Button>
          <Badge bg={initialSettings.isConfigured ? "success" : "secondary"}>
            {initialSettings.isConfigured ? "Configurado" : "Incompleto"}
          </Badge>
        </div>
      </Card.Header>
      <Card.Body>
        <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

        <Form onSubmit={handleSubmit}>
          <Row className="gy-4">
            <Col md={6}>
              <Form.Group controlId="smtpHost" className="mb-3">
                <Form.Label>Host</Form.Label>
                <Form.Control
                  value={formState.host}
                  onChange={(event) => handleChange("host", event.target.value)}
                  placeholder="smtp.seudominio.com"
                  required
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="smtpPort" className="mb-3">
                <Form.Label>Porta</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={65535}
                  value={formState.port}
                  onChange={(event) => handleChange("port", event.target.value)}
                  required
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="smtpSecure" className="mb-3">
                <Form.Label>Conexão segura</Form.Label>
                <Form.Check
                  type="switch"
                  label={formState.secure ? "TLS/SSL" : "STARTTLS"}
                  checked={formState.secure}
                  onChange={(event) => handleChange("secure", event.target.checked)}
                />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group controlId="smtpUsername" className="mb-3">
                <Form.Label>Usuário</Form.Label>
                <Form.Control
                  value={formState.username}
                  onChange={(event) => handleChange("username", event.target.value)}
                  placeholder="usuario@seudominio.com"
                />
                <Form.Text className="text-secondary">
                  Informe o usuário de autenticação do SMTP (deixe em branco se não for necessário).
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="smtpPassword" className="mb-3">
                <Form.Label>Senha</Form.Label>
                <Form.Control
                  value={formState.password}
                  onChange={(event) => handleChange("password", event.target.value)}
                  type="password"
                  placeholder={initialSettings.hasPassword ? "••••••••" : "Senha do SMTP"}
                />
                <Form.Text className="text-secondary">
                  {initialSettings.hasPassword
                    ? "Deixe em branco para manter a senha atual."
                    : "Informe a senha ou token do seu provedor SMTP."}
                </Form.Text>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group controlId="smtpFromName" className="mb-3">
                <Form.Label>Nome do remetente</Form.Label>
                <Form.Control
                  value={formState.fromName}
                  onChange={(event) => handleChange("fromName", event.target.value)}
                  placeholder="Equipe StoreBot"
                  required
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="smtpFromEmail" className="mb-3">
                <Form.Label>E-mail do remetente</Form.Label>
                <Form.Control
                  type="email"
                  value={formState.fromEmail}
                  onChange={(event) => handleChange("fromEmail", event.target.value)}
                  placeholder="notificacoes@seudominio.com"
                  required
                />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group controlId="smtpReplyTo" className="mb-3">
                <Form.Label>Reply-to (opcional)</Form.Label>
                <Form.Control
                  type="email"
                  value={formState.replyTo}
                  onChange={(event) => handleChange("replyTo", event.target.value)}
                  placeholder="suporte@seudominio.com"
                />
                <Form.Text className="text-secondary">
                  Caso preencha, as respostas dos clientes serão encaminhadas para este endereço.
                </Form.Text>
              </Form.Group>
            </Col>

            <Col md={6} className="d-flex align-items-end justify-content-md-end">
              <Form.Text className="text-secondary">
                Última atualização: {lastUpdatedLabel}
              </Form.Text>
            </Col>
          </Row>

          <div className="d-flex justify-content-end gap-3 mt-3">
            <Button variant="outline-secondary" type="button" onClick={handleReset} disabled={isSubmitting}>
              Restaurar valores atuais
            </Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar configurações"}
            </Button>
          </div>
        </Form>
      </Card.Body>
      </Card>

      <Modal show={showTestModal} onHide={closeTestModal} centered>
      <Form onSubmit={handleTestSubmit}>
        <Modal.Header closeButton={!isTesting}>
          <Modal.Title>Enviar e-mail de teste</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <FloatingAlert feedback={testFeedback} onClose={() => setTestFeedback(null)} />
          <Form.Group controlId="smtpTestEmail" className="mb-3">
            <Form.Label>E-mail de destino</Form.Label>
            <Form.Control
              type="email"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
              placeholder="email@seudominio.com"
              required
            />
            <Form.Text className="text-secondary">
              Usaremos as credenciais salvas para enviar um e-mail de confirmação para este endereço.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={closeTestModal} disabled={isTesting}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={isTesting}>
            {isTesting ? "Enviando..." : "Enviar e-mail de teste"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
    </Fragment>
  );
};

export default AdminSmtpSettingsForm;
