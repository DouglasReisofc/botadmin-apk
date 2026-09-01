"use client";

import { useState } from "react";
import { Card, Form } from "react-bootstrap";

import UserPaymentsConfig from "components/payments/UserPaymentsConfig";
import PaymentsHistory from "components/payments/payments-history";
import type { PaymentCharge } from "types/payments";
import type {
  PaymentConfirmationMessageConfig,
  MercadoPagoCheckoutConfig,
  MercadoPagoPixConfig,
} from "lib/payments";

type Props = {
  pixConfig: MercadoPagoPixConfig | null;
  checkoutConfig: MercadoPagoCheckoutConfig | null;
  confirmationConfig: PaymentConfirmationMessageConfig | null;
  charges: PaymentCharge[];
};

const UserPaymentsTabbedView = ({ pixConfig, checkoutConfig, confirmationConfig, charges }: Props) => {
  const [view, setView] = useState<"gateways" | "history">("gateways");

  return (
    <div className="d-flex flex-column gap-4">
      <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-lg-between gap-3">
        <div>
          <h1 className="mb-1">Pagamentos</h1>
          <p className="text-secondary mb-0">Configure os gateways e acompanhe o histórico de pagamentos do bot.</p>
        </div>
        <Form.Group className="mb-0">
          <Form.Label className="text-secondary small fw-semibold">Exibir</Form.Label>
          <Form.Select value={view} onChange={(e) => setView(e.target.value === 'history' ? 'history' : 'gateways')}>
            <option value="gateways">Gateways de pagamentos</option>
            <option value="history">Histórico de pagamentos</option>
          </Form.Select>
        </Form.Group>
      </div>

      {view === "gateways" ? (
        <UserPaymentsConfig pixConfig={pixConfig} checkoutConfig={checkoutConfig} confirmationConfig={confirmationConfig} />
      ) : (
        <Card>
          <Card.Header>
            <h2 className="h5 mb-0">Histórico de pagamentos</h2>
          </Card.Header>
          <Card.Body>
            <PaymentsHistory charges={charges} />
          </Card.Body>
        </Card>
      )}
    </div>
  );
};

export default UserPaymentsTabbedView;

