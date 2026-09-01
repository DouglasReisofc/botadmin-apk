"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { useRouter } from "next/navigation";

import { formatAmount, parseAmountText } from "components/payments/amountHelpers";
import type { MercadoPagoPixConfig } from "types/payments";
import {
  META_INTERACTIVE_BODY_LIMIT,
  META_INTERACTIVE_ROW_TITLE_LIMIT,
} from "lib/meta-limits";

interface MercadoPagoPixFormProps {
  config: MercadoPagoPixConfig;
  updatePath?: string;
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type FormState = {
  isActive: boolean;
  displayName: string;
  accessToken: string;
  publicKey: string;
  pixKey: string;
  notificationUrl: string;
  expirationMinutes: string;
  amountOptionsText: string;
  instructions: string;
};

const buildInitialState = (config: MercadoPagoPixConfig): FormState => ({
  isActive: config.isActive,
  displayName: config.displayName,
  accessToken: config.accessToken,
  publicKey: config.publicKey ?? "",
  pixKey: config.pixKey ?? "",
  notificationUrl: config.notificationUrl ?? "",
  expirationMinutes: config.pixExpirationMinutes.toString(),
  amountOptionsText: config.amountOptions.map((value) => formatAmount(value)).join("\n"),
  instructions: config.instructions ?? "",
});

const MercadoPagoPixForm = ({ config, updatePath = "/api/payments/mercadopago" }: MercadoPagoPixFormProps) => {
  const router = useRouter();
  const [formState, setFormState] = useState<FormState>(() => buildInitialState(config));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("-");

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
      console.warn("Failed to format Mercado Pago Pix last update", error);
      setLastUpdatedLabel("-");
    }
  }, [config.updatedAt]);

  useEffect(() => {
    setFormState(buildInitialState(config));
  }, [config]);

  const handleChange = <Field extends keyof FormState>(field: Field, value: FormState[Field]) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleReset = () => {
    setFormState(buildInitialState(config));
    setFeedback(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    const amountOptions = parseAmountText(formState.amountOptionsText);
    const expirationMinutes = Number.parseInt(formState.expirationMinutes, 10);

    const payload = {
      isActive: formState.isActive,
      displayName: formState.displayName,
      accessToken: formState.accessToken,
      publicKey: formState.publicKey,
      pixKey: formState.pixKey,
      notificationUrl: formState.notificationUrl,
      pixExpirationMinutes: Number.isFinite(expirationMinutes) ? expirationMinutes : undefined,
      amountOptions,
      instructions: formState.instructions,
    };

    const response = await fetch(updatePath, {
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
        message: data.message ?? "Não foi possível salvar as configurações.",
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
    <Card>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <div>
          <Card.Title as="h2" className="h5 mb-1">
            Mercado Pago Pix
          </Card.Title>
          <Card.Subtitle className="text-secondary small">
            Configure o access token e os valores sugeridos para gerar cobranças Pix automáticas.
          </Card.Subtitle>
        </div>
        <Badge bg={config.isActive ? "success" : "secondary"}>
          {config.isActive ? "Ativo" : "Inativo"}
        </Badge>
      </Card.Header>
      <Card.Body>
        {feedback && (
          <Alert variant={feedback.type} onClose={() => setFeedback(null)} dismissible>
            {feedback.message}
          </Alert>
        )}
        <Form onSubmit={handleSubmit}>
          <Row className="gy-4">
            <Col md={6}>
              <Form.Group controlId="pixActive">
                <Form.Check
                  type="switch"
                  label="Ativar pagamentos via Pix"
                  checked={formState.isActive}
                  onChange={(event) => handleChange("isActive", event.target.checked)}
                />
              </Form.Group>
            </Col>
            <Col md={6} className="text-md-end">
              <Form.Text className="text-secondary">
                Última atualização: {lastUpdatedLabel}
              </Form.Text>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="displayName">
                <Form.Label>Nome de exibição</Form.Label>
                <Form.Control
                  value={formState.displayName}
                  onChange={(event) => handleChange("displayName", event.target.value)}
                  placeholder="Mercado Pago Pix"
                  maxLength={META_INTERACTIVE_ROW_TITLE_LIMIT}
                  required
                />
                <Form.Text className="text-secondary">
                  Máximo de {META_INTERACTIVE_ROW_TITLE_LIMIT} caracteres mostrados no menu do bot.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="accessToken">
                <Form.Label>Access token</Form.Label>
                <Form.Control
                  value={formState.accessToken}
                  onChange={(event) => handleChange("accessToken", event.target.value)}
                  placeholder="APP_USR-..."
                  type="password"
                  required={formState.isActive}
                />
                <Form.Text className="text-secondary">
                  Use um token de produção com permissões de pagamentos Pix.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="publicKey">
                <Form.Label>Public key (opcional)</Form.Label>
                <Form.Control
                  value={formState.publicKey}
                  onChange={(event) => handleChange("publicKey", event.target.value)}
                  placeholder="APP_USR-..."
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="pixKey">
                <Form.Label>Chave Pix (opcional)</Form.Label>
                <Form.Control
                  value={formState.pixKey}
                  onChange={(event) => handleChange("pixKey", event.target.value)}
                  placeholder="chave Pix cadastrada no Mercado Pago"
                />
                <Form.Text className="text-secondary">
                  Esta informação é exibida apenas nas instruções ao cliente.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="notificationUrl">
                <Form.Label>Notification URL (automática)</Form.Label>
                <Form.Control
                  value={formState.notificationUrl}
                  readOnly
                  placeholder="https://"
                  title="Esta URL é definida automaticamente pelo sistema."
                />
                <Form.Text className="text-secondary">
                  Utilizamos este endereço por padrão para confirmar pagamentos e creditar o saldo do cliente automaticamente.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="expirationMinutes">
                <Form.Label>Validade do Pix (minutos)</Form.Label>
                <Form.Control
                  value={formState.expirationMinutes}
                  onChange={(event) => handleChange("expirationMinutes", event.target.value)}
                  type="number"
                  min={5}
                  max={1440}
                  required
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="amountOptions">
                <Form.Label>Valores sugeridos</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={formState.amountOptionsText}
                  onChange={(event) => handleChange("amountOptionsText", event.target.value)}
                  inputMode="decimal"
                  spellCheck={false}
                  placeholder={"25,00\n50,00\n100,00"}
                />
                <Form.Text className="text-secondary">
                  Separe os valores por quebra de linha, vírgula ou ponto e vírgula. Máximo de 20 opções.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="instructions">
                <Form.Label>Instruções adicionais (opcional)</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={formState.instructions}
                  onChange={(event) => handleChange("instructions", event.target.value)}
                  placeholder="Ex.: O saldo será liberado após a confirmação automática do Mercado Pago."
                  maxLength={META_INTERACTIVE_BODY_LIMIT}
                />
                <Form.Text className="text-secondary">
                  Máximo de {META_INTERACTIVE_BODY_LIMIT} caracteres enviados junto com o QR Code.
                </Form.Text>
              </Form.Group>
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
  );
};

export default MercadoPagoPixForm;
