"use client";

import { useMemo, useState } from "react";
import { Button, Card } from "react-bootstrap";

import type {
  MercadoPagoCheckoutConfig,
  MercadoPagoPixConfig,
  PaymentConfirmationMessageConfig,
  PoloPagPixConfig,
} from "types/payments";

import MercadoPagoCheckoutForm from "./MercadoPagoCheckoutForm";
import MercadoPagoPixForm from "./MercadoPagoPixForm";
import PaymentConfirmationForm from "./PaymentConfirmationForm";
import PoloPagPixForm from "./PoloPagPixForm";

type ViewId = "pix" | "polopag" | "checkout" | "confirmation";

type ViewOption = {
  id: ViewId;
  label: string;
  description: string;
};

type PaymentsEndpoints = {
  pix?: string;
  polopag?: string;
  checkout?: string;
  confirmation?: string;
};

type ViewOptionsOverride = Partial<Record<ViewId, Partial<ViewOption>>>;

interface UserPaymentsConfigProps {
  pixConfig: MercadoPagoPixConfig;
  polopagConfig: PoloPagPixConfig;
  checkoutConfig: MercadoPagoCheckoutConfig;
  confirmationConfig: PaymentConfirmationMessageConfig;
  endpoints?: PaymentsEndpoints;
  cardTitle?: string;
  cardDescription?: string;
  viewOptionsOverride?: ViewOptionsOverride;
  /** Restringe quais gateways aparecem no painel (ex.: somente split para venda do robô). */
  enabledViews?: ViewId[];
}

const VIEW_OPTIONS: readonly ViewOption[] = [
  {
    id: "pix",
    label: "Mercado Pago Pix",
    description:
      "Gere QR Codes e códigos copia e cola diretamente para o bot responder automaticamente os clientes.",
  },
  {
    id: "polopag",
    label: "PoloPag Pix",
    description:
      "Conecte sua conta PoloPag para gerar cobranças Pix com expiração personalizada e notificações automáticas.",
  },
  {
    id: "checkout",
    label: "Mercado Pago Checkout",
    description:
      "Use o checkout transparente do Mercado Pago para aceitar cartões, Pix e boleto em páginas externas.",
  },
  {
    id: "confirmation",
    label: "Mensagem de confirmação",
    description:
      "Defina a mensagem enviada automaticamente após a aprovação do pagamento, válida para todos os métodos.",
  },
];

const resolveInitialView = (
  pixConfig: MercadoPagoPixConfig,
  polopagConfig: PoloPagPixConfig,
  checkoutConfig: MercadoPagoCheckoutConfig,
): ViewId => {
  if (pixConfig.isConfigured || pixConfig.isActive) {
    return "pix";
  }

  if (polopagConfig.isConfigured || polopagConfig.isActive) {
    return "polopag";
  }

  if (checkoutConfig.isConfigured || checkoutConfig.isActive) {
    return "checkout";
  }

  return "confirmation";
};

const UserPaymentsConfig = ({
  pixConfig,
  polopagConfig,
  checkoutConfig,
  confirmationConfig,
  endpoints,
  cardTitle,
  cardDescription,
  viewOptionsOverride,
  enabledViews,
}: UserPaymentsConfigProps) => {
  const baseOptions = useMemo(() => {
    const mapped = VIEW_OPTIONS.map((option) => {
      const override = viewOptionsOverride?.[option.id];
      return override ? { ...option, ...override } : option;
    });
    if (!enabledViews || enabledViews.length === 0) {
      return mapped;
    }
    const allowed = new Set(enabledViews);
    return mapped.filter((option) => allowed.has(option.id));
  }, [enabledViews, viewOptionsOverride]);

  const [activeView, setActiveView] = useState<ViewId>(() => {
    if (baseOptions.length > 0) {
      return baseOptions[0]!.id;
    }
    return resolveInitialView(pixConfig, polopagConfig, checkoutConfig);
  });

  const options = baseOptions;

  const activeOption = useMemo(
    () => options.find((option) => option.id === activeView) ?? options[0],
    [activeView, options],
  );

  return (
    <div className="d-flex flex-column gap-4">
      <Card>
        <Card.Body>
          <Card.Title as="h2" className="h5">
            {cardTitle ?? "Integrações de pagamento"}
          </Card.Title>
          <Card.Text className="text-secondary mb-3">
            {cardDescription ??
              "Selecione abaixo qual modalidade deseja configurar para personalizar a experiência de pagamento do seu bot."}
          </Card.Text>

          <div className="d-flex flex-wrap gap-2">
            {options.map((option) => (
              <Button
                key={option.id}
                variant={activeView === option.id ? "primary" : "outline-primary"}
                onClick={() => setActiveView(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <Card.Text className="text-secondary mb-0 mt-3">{activeOption.description}</Card.Text>
        </Card.Body>
      </Card>

      {activeView === "pix" && (
        <MercadoPagoPixForm
          config={pixConfig}
          updatePath={endpoints?.pix}
        />
      )}
      {activeView === "polopag" && (
        <PoloPagPixForm
          config={polopagConfig}
          updatePath={endpoints?.polopag}
        />
      )}
      {activeView === "checkout" && (
        <MercadoPagoCheckoutForm
          config={checkoutConfig}
          updatePath={endpoints?.checkout}
        />
      )}
      {activeView === "confirmation" && (
        <PaymentConfirmationForm
          config={confirmationConfig}
          updatePath={endpoints?.confirmation}
        />
      )}
    </div>
  );
};

export default UserPaymentsConfig;
