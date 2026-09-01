"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { useRouter } from "next/navigation";

import { formatAmount, parseAmountText } from "components/payments/amountHelpers";
import type {
  MercadoPagoCheckoutConfig,
  MercadoPagoCheckoutPaymentMethod,
  MercadoPagoCheckoutPaymentType,
} from "types/payments";
import {
  META_INTERACTIVE_BODY_LIMIT,
  META_INTERACTIVE_ROW_TITLE_LIMIT,
} from "lib/meta-limits";

const PAYMENT_TYPE_OPTIONS: readonly {
  id: MercadoPagoCheckoutPaymentType;
  label: string;
  description: string;
}[] = [
  {
    id: "credit_card",
    label: "Cartão de crédito",
    description: "Aceite pagamentos parcelados e à vista com cartões de crédito.",
  },
  {
    id: "debit_card",
    label: "Cartão de débito",
    description: "Disponibilize pagamentos instantâneos via cartões de débito.",
  },
  {
    id: "ticket",
    label: "Boleto bancário",
    description: "Gere boletos do Mercado Pago diretamente no checkout.",
  },
  {
    id: "bank_transfer",
    label: "Transferência bancária",
    description: "Permita pagamentos por transferência ou Pix no fluxo web.",
  },
  {
    id: "atm",
    label: "Pagamento em lotérica",
    description: "Libere pagamentos em dinheiro através de pontos parceiros.",
  },
  {
    id: "account_money",
    label: "Saldo Mercado Pago",
    description: "Habilite clientes a pagar com saldo disponível na conta Mercado Pago.",
  },
];

const PAYMENT_METHOD_OPTIONS: readonly {
  id: MercadoPagoCheckoutPaymentMethod;
  label: string;
  description: string;
}[] = [
  {
    id: "pix",
    label: "Pix integrado",
    description: "Mostre o botão de Pix rápido diretamente no checkout oficial.",
  },
];

interface MercadoPagoCheckoutFormProps {
  config: MercadoPagoCheckoutConfig;
  updatePath?: string;
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type FormState = {
  isActive: boolean;
  displayName: string;
  accessToken: string;
  publicKey: string;
  notificationUrl: string;
  amountOptionsText: string;
  allowedPaymentTypes: MercadoPagoCheckoutPaymentType[];
  allowedPaymentMethods: MercadoPagoCheckoutPaymentMethod[];
};

const uniqueList = <T extends string>(values: readonly T[]): T[] =>
  Array.from(new Set(values));

const buildInitialState = (config: MercadoPagoCheckoutConfig): FormState => ({
  isActive: config.isActive,
  displayName: config.displayName,
  accessToken: config.accessToken,
  publicKey: config.publicKey ?? "",
  notificationUrl: config.notificationUrl ?? "",
  amountOptionsText: config.amountOptions.map((value) => formatAmount(value)).join("\n"),
  allowedPaymentTypes: uniqueList(config.allowedPaymentTypes),
  allowedPaymentMethods: uniqueList(config.allowedPaymentMethods),
});

const MercadoPagoCheckoutForm = ({ config, updatePath = "/api/payments/mercadopago/checkout" }: MercadoPagoCheckoutFormProps) => {
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
      console.warn("Failed to format Mercado Pago Checkout last update", error);
      setLastUpdatedLabel("-");
    }
  }, [config.updatedAt]);

  useEffect(() => {
    setFormState(buildInitialState(config));
  }, [config]);

  const handleChange = <Field extends keyof FormState>(field: Field, value: FormState[Field]) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  };

  const handleToggleType = (typeId: MercadoPagoCheckoutPaymentType, checked: boolean) => {
    setFormState((previous) => {
      const current = new Set(previous.allowedPaymentTypes);
      if (checked) {
        current.add(typeId);
      } else {
        current.delete(typeId);
      }

      return { ...previous, allowedPaymentTypes: Array.from(current) };
    });
  };

  const handleToggleMethod = (methodId: MercadoPagoCheckoutPaymentMethod, checked: boolean) => {
    setFormState((previous) => {
      const current = new Set(previous.allowedPaymentMethods);
      if (checked) {
        current.add(methodId);
      } else {
        current.delete(methodId);
      }

      return { ...previous, allowedPaymentMethods: Array.from(current) };
    });
  };

  const handleReset = () => {
    setFormState(buildInitialState(config));
    setFeedback(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    const selectedOptionsCount =
      formState.allowedPaymentTypes.length + formState.allowedPaymentMethods.length;

    if (formState.isActive && selectedOptionsCount === 0) {
      setFeedback({
        type: "danger",
        message: "Selecione ao menos uma forma de pagamento para manter o checkout ativo.",
      });
      setIsSubmitting(false);
      return;
    }

    if (formState.isActive && !formState.accessToken.trim()) {
      setFeedback({
        type: "danger",
        message: "Informe o access token do Mercado Pago para ativar o checkout.",
      });
      setIsSubmitting(false);
      return;
    }

    const payload = {
      isActive: formState.isActive,
      displayName: formState.displayName,
      accessToken: formState.accessToken,
      publicKey: formState.publicKey,
      notificationUrl: formState.notificationUrl,
      amountOptions: parseAmountText(formState.amountOptionsText),
      allowedPaymentTypes: formState.allowedPaymentTypes,
      allowedPaymentMethods: formState.allowedPaymentMethods,
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
            Mercado Pago Checkout
          </Card.Title>
          <Card.Subtitle className="text-secondary small">
            Configure o checkout transparente para aceitar cartões, Pix e outras formas de pagamento.
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
              <Form.Group controlId="checkoutActive">
                <Form.Check
                  type="switch"
                  label="Ativar checkout Mercado Pago"
                  checked={formState.isActive}
                  onChange={(event) => handleChange("isActive", event.target.checked)}
                />
              </Form.Group>
            </Col>
            <Col md={6} className="text-md-end">
              <Form.Text className="text-secondary">Última atualização: {lastUpdatedLabel}</Form.Text>
            </Col>

            <Col xs={12}>
              <Form.Group className="mb-3" controlId="checkoutAmountOptions">
                <Form.Label>Valores sugeridos</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={formState.amountOptionsText}
                  onChange={(event) => handleChange("amountOptionsText", event.target.value)}
                  inputMode="decimal"
                  spellCheck={false}
                  placeholder={["50,00", "75,00", "100,00"].join("\n")}
                  maxLength={META_INTERACTIVE_BODY_LIMIT}
                />
                <Form.Text className="text-secondary">
                  Defina os valores de recarga que ficarão disponíveis neste checkout. Você pode separar por
                  linha, vírgula ou ponto e vírgula.
                </Form.Text>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group className="mb-3" controlId="checkoutDisplayName">
                <Form.Label>Nome de exibição</Form.Label>
                <Form.Control
                  value={formState.displayName}
                  onChange={(event) => handleChange("displayName", event.target.value)}
                  placeholder="Checkout Mercado Pago"
                  maxLength={META_INTERACTIVE_ROW_TITLE_LIMIT}
                  required
                />
                <Form.Text className="text-secondary">
                  Máximo de {META_INTERACTIVE_ROW_TITLE_LIMIT} caracteres exibidos no menu do bot.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="checkoutAccessToken">
                <Form.Label>Access token</Form.Label>
                <Form.Control
                  value={formState.accessToken}
                  onChange={(event) => handleChange("accessToken", event.target.value)}
                  placeholder="APP_USR-..."
                  type="password"
                  required={formState.isActive}
                />
                <Form.Text className="text-secondary">
                  Utilize um token de produção com permissões de checkout e pagamentos.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="checkoutPublicKey">
                <Form.Label>Public key (opcional)</Form.Label>
                <Form.Control
                  value={formState.publicKey}
                  onChange={(event) => handleChange("publicKey", event.target.value)}
                  placeholder="APP_USR-..."
                />
                <Form.Text className="text-secondary">
                  Necessária apenas para exibir o checkout transparente em páginas públicas.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="checkoutNotificationUrl">
                <Form.Label>Notification URL (automática)</Form.Label>
                <Form.Control
                  value={formState.notificationUrl}
                  readOnly
                  placeholder="https://"
                  title="Esta URL é definida automaticamente pelo sistema."
                />
                <Form.Text className="text-secondary">
                  Usamos este endereço para confirmar pagamentos e liberar saldo assim que o Mercado Pago notifica.
                </Form.Text>
              </Form.Group>
            </Col>

            <Col xs={12}>
              <Form.Group controlId="checkoutPaymentTypes">
                <Form.Label>Formas de pagamento no checkout</Form.Label>
                <Row className="g-3">
                  {PAYMENT_TYPE_OPTIONS.map((option) => (
                    <Col md={6} key={option.id}>
                      <Form.Check
                        type="switch"
                        id={`checkout-type-${option.id}`}
                        label={option.label}
                        checked={formState.allowedPaymentTypes.includes(option.id)}
                        onChange={(event) => handleToggleType(option.id, event.target.checked)}
                      />
                      <Form.Text className="text-secondary d-block small">{option.description}</Form.Text>
                    </Col>
                  ))}
                </Row>
              </Form.Group>
            </Col>

            <Col xs={12}>
              <Form.Group controlId="checkoutPaymentMethods">
                <Form.Label>Botões rápidos adicionais</Form.Label>
                <Row className="g-3">
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <Col md={6} key={option.id}>
                      <Form.Check
                        type="switch"
                        id={`checkout-method-${option.id}`}
                        label={option.label}
                        checked={formState.allowedPaymentMethods.includes(option.id)}
                        onChange={(event) => handleToggleMethod(option.id, event.target.checked)}
                      />
                      <Form.Text className="text-secondary d-block small">{option.description}</Form.Text>
                    </Col>
                  ))}
                </Row>
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

export default MercadoPagoCheckoutForm;
