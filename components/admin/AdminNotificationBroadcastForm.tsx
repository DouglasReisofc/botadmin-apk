"use client";

import { FormEvent, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row } from "react-bootstrap";

import FloatingAlert from "components/common/FloatingAlert";

interface AdminNotificationBroadcastFormProps {
  users: Array<{ id: number; name: string; email: string | null }>;
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type TargetOption = "all" | "email";

const AdminNotificationBroadcastForm = ({ users }: AdminNotificationBroadcastFormProps) => {
  const [target, setTarget] = useState<TargetOption>("all");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailSuggestions = useMemo(
    () =>
      users
        .filter((user) => typeof user.email === "string" && user.email.trim().length > 0)
        .map((user) => ({
          value: user.email as string,
          label: `${user.name} <${user.email}>`,
        })),
    [users],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    const payload = {
      subject,
      message,
      target,
      email: target === "email" ? email : null,
    };

    const response = await fetch("/api/admin/notifications/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível enviar a notificação.",
      });
      setIsSubmitting(false);
      return;
    }

    setFeedback({
      type: "success",
      message: data.message ?? "Notificação enviada com sucesso.",
    });
    setIsSubmitting(false);
    setSubject("");
    setMessage("");
    if (target === "email") {
      setEmail("");
    }
  };

  return (
    <Card className="mb-5">
      <Card.Header>
        <Card.Title as="h2" className="h5 mb-0">
          Enviar notificação aos usuários
        </Card.Title>
        <Card.Subtitle className="text-secondary small mt-1">
          Dispare um aviso emergencial ou informe novidades para todos os usuários ou apenas um destinatário específico.
        </Card.Subtitle>
      </Card.Header>
      <Card.Body>
        <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

        <Form onSubmit={handleSubmit} className="d-flex flex-column gap-4">
          <Row className="gy-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Destinatários</Form.Label>
                <div className="d-flex gap-3">
                  <Form.Check
                    type="radio"
                    id="targetAll"
                    name="notificationTarget"
                    label="Todos os usuários"
                    checked={target === "all"}
                    onChange={() => setTarget("all")}
                  />
                  <Form.Check
                    type="radio"
                    id="targetEmail"
                    name="notificationTarget"
                    label="Apenas um e-mail"
                    checked={target === "email"}
                    onChange={() => setTarget("email")}
                  />
                </div>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>E-mail do destinatário</Form.Label>
                <Form.Control
                  type="email"
                  list="adminNotificationEmails"
                  placeholder="usuario@dominio.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={target === "all"}
                  required={target === "email"}
                />
                <Form.Text className="text-secondary">
                  Informe o e-mail do usuário que receberá a mensagem.
                </Form.Text>
                <datalist id="adminNotificationEmails">
                  {emailSuggestions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </datalist>
              </Form.Group>
            </Col>
          </Row>

          <Form.Group>
            <Form.Label>Assunto da mensagem</Form.Label>
            <Form.Control
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Atualização importante"
              maxLength={120}
              required
            />
          </Form.Group>

          <Form.Group>
            <Form.Label>Mensagem</Form.Label>
            <Form.Control
              as="textarea"
              rows={6}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Descreva aqui a notificação que será enviada por e-mail e exibida no painel."
              maxLength={2000}
              required
            />
            <Form.Text className="text-secondary">
              O conteúdo também aparecerá no sino de notificações dos usuários.
            </Form.Text>
          </Form.Group>

          <div className="d-flex justify-content-end">
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Enviando..." : "Enviar notificação"}
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
};

export default AdminNotificationBroadcastForm;
