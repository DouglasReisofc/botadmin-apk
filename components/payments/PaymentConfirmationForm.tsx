"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Alert, Badge, Button, Card, Col, Form, Image, Row } from "react-bootstrap";
import { useRouter } from "next/navigation";

import type { PaymentConfirmationMessageConfig } from "types/payments";
import {
  META_INTERACTIVE_BODY_LIMIT,
  META_INTERACTIVE_BUTTON_LIMIT,
} from "lib/meta-limits";

interface PaymentConfirmationFormProps {
  config: PaymentConfirmationMessageConfig;
  updatePath?: string;
}

type FormState = {
  messageText: string;
  buttonLabel: string;
};

type Feedback = { type: "success" | "danger"; message: string } | null;

const buildInitialState = (config: PaymentConfirmationMessageConfig): FormState => ({
  messageText: config.messageText,
  buttonLabel: config.buttonLabel,
});

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const PaymentConfirmationForm = ({
  config,
  updatePath = "/api/payments/confirmation",
}: PaymentConfirmationFormProps) => {
  const router = useRouter();
  const [formState, setFormState] = useState<FormState>(() => buildInitialState(config));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("-");
  const [removeImage, setRemoveImage] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<string | null>(() => config.mediaUrl);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!config.updatedAt) {
      setLastUpdatedLabel("-");
      return;
    }

    try {
      const formatter = new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      });
      setLastUpdatedLabel(formatter.format(new Date(config.updatedAt)));
    } catch (error) {
      console.warn("Failed to format payment confirmation last update", error);
      setLastUpdatedLabel("-");
    }
  }, [config.updatedAt]);

  useEffect(() => {
    setFormState(buildInitialState(config));
    setFeedback(null);
    setRemoveImage(false);
    setSelectedFile(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setMediaPreview(config.mediaUrl);
  }, [config]);

  useEffect(() => () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const handleChange = <Field extends keyof FormState>(field: Field, value: FormState[Field]) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (file) {
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        setSelectedFile(null);
        setMediaPreview(config.mediaUrl);
        setFeedback({
          type: "danger",
          message: "A imagem deve ter no máximo 5 MB.",
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      setSelectedFile(file);
      setMediaPreview(objectUrl);
      setRemoveImage(false);
    } else {
      setSelectedFile(null);
      setMediaPreview(config.mediaUrl);
    }
  };

  const handleRemoveImage = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setSelectedFile(null);
    setMediaPreview(null);
    setRemoveImage(true);
  };

  const handleReset = () => {
    setFormState(buildInitialState(config));
    setFeedback(null);
    setRemoveImage(false);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setMediaPreview(config.mediaUrl);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    const payload = new FormData();
    payload.set("messageText", formState.messageText);
    payload.set("buttonLabel", formState.buttonLabel);
    payload.set("removeImage", removeImage ? "true" : "false");

    if (selectedFile) {
      payload.set("media", selectedFile);
    }

    const response = await fetch(updatePath, {
      method: "PUT",
      body: payload,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível salvar a mensagem de confirmação.",
      });
      setIsSubmitting(false);
      return;
    }

    setFeedback({
      type: "success",
      message: data.message ?? "Mensagem de confirmação atualizada com sucesso.",
    });

    if (data.config) {
      setFormState(buildInitialState(data.config));
      setRemoveImage(false);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setMediaPreview(data.config.mediaUrl ?? null);
    }

    setIsSubmitting(false);
    router.refresh();
  };

  return (
    <Card>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <div>
          <Card.Title as="h2" className="h5 mb-1">
            Mensagem após pagamento aprovado
          </Card.Title>
          <Card.Subtitle className="text-secondary small">
            Personalize o texto enviado automaticamente quando o pagamento for confirmado.
          </Card.Subtitle>
        </div>
        <Badge bg="secondary">Automático</Badge>
      </Card.Header>
      <Card.Body>
        {feedback && (
          <Alert variant={feedback.type} onClose={() => setFeedback(null)} dismissible>
            {feedback.message}
          </Alert>
        )}
        <Form onSubmit={handleSubmit} encType="multipart/form-data">
          <Row className="gy-4">
            <Col xs={12} className="text-md-end">
              <Form.Text className="text-secondary">
                Última atualização: {lastUpdatedLabel}
              </Form.Text>
            </Col>
            <Col xs={12}>
              <Form.Group className="mb-3" controlId="confirmationMessageText">
                <Form.Label>Mensagem principal</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={formState.messageText}
                  onChange={(event) => handleChange("messageText", event.target.value)}
                  placeholder="Pagamento confirmado! Seu saldo foi atualizado automaticamente."
                  maxLength={META_INTERACTIVE_BODY_LIMIT}
                  required
                />
                <Form.Text className="text-secondary">
                  {"Use {{valor}} e {{saldo}} para inserir automaticamente o valor pago e o saldo atual."}
                  {` Máximo de ${META_INTERACTIVE_BODY_LIMIT} caracteres enviados ao WhatsApp.`}
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="confirmationButtonLabel">
                <Form.Label>Texto do botão</Form.Label>
                <Form.Control
                  value={formState.buttonLabel}
                  onChange={(event) => handleChange("buttonLabel", event.target.value)}
                  placeholder="Ir para o menu"
                  maxLength={META_INTERACTIVE_BUTTON_LIMIT}
                  required
                />
                <Form.Text className="text-secondary">
                  Máximo de {META_INTERACTIVE_BUTTON_LIMIT} caracteres. O botão abre o menu de compras automaticamente.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="confirmationMediaUrl">
                <Form.Label>Imagem opcional</Form.Label>
                {mediaPreview && (
                  <div className="mb-3">
                    <Image src={mediaPreview} alt="Pré-visualização da imagem" thumbnail fluid />
                  </div>
                )}
                <Form.Control
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                />
                <Form.Text className="text-secondary d-block mt-1">
                  Envie uma imagem em formato JPG ou PNG com até 5&nbsp;MB para personalizar o topo da mensagem.
                </Form.Text>
                {!removeImage && (mediaPreview || config.mediaPath) && (
                  <Button
                    variant="outline-danger"
                    size="sm"
                    className="mt-3"
                    onClick={handleRemoveImage}
                    disabled={isSubmitting}
                  >
                    Remover imagem
                  </Button>
                )}
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
            <Button variant="outline-secondary" onClick={handleReset} disabled={isSubmitting}>
              Desfazer mudanças
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
};

export default PaymentConfirmationForm;
