"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Form, Modal, Table } from "react-bootstrap";
import { useRouter } from "next/navigation";

import type { CustomerSummary } from "types/customers";
import { formatDate } from "lib/format";

const formatCurrency = (value: number) => {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPhoneNumber = (phone: string) => {
  if (!phone) {
    return "-";
  }

  const normalized = phone.replace(/[^0-9]/g, "");

  if (normalized.length === 13) {
    return normalized.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 ($2) $3-$4");
  }

  if (normalized.length === 12) {
    return normalized.replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, "+$1 ($2) $3-$4");
  }

  if (normalized.length === 11) {
    return normalized.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }

  if (normalized.length === 10) {
    return normalized.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }

  return phone;
};

const getDisplayName = (customer: CustomerSummary) => {
  if (customer.displayName && customer.displayName.trim()) {
    return customer.displayName.trim();
  }

  if (customer.profileName && customer.profileName.trim()) {
    return customer.profileName.trim();
  }

  return customer.phoneNumber;
};

interface CustomerFormState {
  displayName: string;
  balance: string;
  notes: string;
  isBlocked: boolean;
}

interface FeedbackState {
  type: "success" | "danger";
  message: string;
}

const UserCustomerManager = ({ customers }: { customers: CustomerSummary[] }) => {
  const router = useRouter();

  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerSummary | null>(null);
  const [formState, setFormState] = useState<CustomerFormState>({
    displayName: "",
    balance: "0,00",
    notes: "",
    isBlocked: false,
  });

  const hasCustomers = customers.length > 0;

  const totalBlocked = useMemo(
    () => customers.filter((customer) => customer.isBlocked).length,
    [customers],
  );

  const totalBalance = useMemo(
    () => customers.reduce((sum, customer) => sum + customer.balance, 0),
    [customers],
  );

  const openModal = (customer: CustomerSummary) => {
    setEditingCustomer(customer);
    setFormState({
      displayName: customer.displayName ?? "",
      balance: formatCurrency(customer.balance),
      notes: customer.notes ?? "",
      isBlocked: customer.isBlocked,
    });
    setFeedback(null);
  };

  const closeModal = () => {
    setEditingCustomer(null);
    setFormState({
      displayName: "",
      balance: "0,00",
      notes: "",
      isBlocked: false,
    });
    setIsSubmitting(false);
  };

  const handleChange = <Field extends keyof CustomerFormState>(field: Field, value: CustomerFormState[Field]) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!editingCustomer) {
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const payload = {
      displayName: formState.displayName,
      notes: formState.notes,
      isBlocked: formState.isBlocked,
      balance: formState.balance,
    };

    const response = await fetch(`/api/customers/${editingCustomer.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível atualizar o cliente.",
      });
      setIsSubmitting(false);
      return;
    }

    setFeedback({ type: "success", message: "Cliente atualizado com sucesso." });
    setTimeout(() => {
      closeModal();
      router.refresh();
    }, 400);
  };

  return (
    <div className="d-flex flex-column gap-4">
      <div className="row g-4">
        <div className="col-md-4">
          <Card>
            <Card.Body>
              <p className="text-secondary mb-1">Clientes cadastrados</p>
              <h3 className="mb-0">{customers.length}</h3>
            </Card.Body>
          </Card>
        </div>
        <div className="col-md-4">
          <Card>
            <Card.Body>
              <p className="text-secondary mb-1">Clientes bloqueados</p>
              <h3 className="mb-0">{totalBlocked}</h3>
            </Card.Body>
          </Card>
        </div>
        <div className="col-md-4">
          <Card>
            <Card.Body>
              <p className="text-secondary mb-1">Saldo total</p>
              <h3 className="mb-0">R$ {formatCurrency(totalBalance)}</h3>
            </Card.Body>
          </Card>
        </div>
      </div>

      <Card>
        <Card.Header>
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <Card.Title as="h2" className="h5 mb-0">Lista de clientes</Card.Title>
              <Card.Text className="text-secondary mb-0">
                Clientes são criados automaticamente quando o robô recebe uma mensagem no WhatsApp.
              </Card.Text>
            </div>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          {hasCustomers ? (
            <div className="table-responsive">
              <Table hover responsive className="mb-0">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Número</th>
                    <th>Última interação</th>
                    <th>Saldo</th>
                    <th>Status</th>
                    <th className="text-end">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td className="align-middle">
                        <div className="fw-semibold">{getDisplayName(customer)}</div>
                        {customer.notes && (
                          <div className="text-secondary small">{customer.notes}</div>
                        )}
                      </td>
                      <td className="align-middle">{formatPhoneNumber(customer.phoneNumber)}</td>
                      <td className="align-middle">{customer.lastInteraction ? formatDate(customer.lastInteraction) : "-"}</td>
                      <td className="align-middle">R$ {formatCurrency(customer.balance)}</td>
                      <td className="align-middle">
                        {customer.isBlocked ? (
                          <Badge bg="danger">Bloqueado</Badge>
                        ) : (
                          <Badge bg="success">Ativo</Badge>
                        )}
                      </td>
                      <td className="align-middle text-end">
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => openModal(customer)}
                        >
                          Gerenciar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <div className="p-4">
              <Alert variant="secondary" className="mb-0">
                Ainda não recebemos mensagens no robô. Assim que um contato falar com você pelo WhatsApp, ele aparecerá aqui automaticamente.
              </Alert>
            </div>
          )}
        </Card.Body>
      </Card>

      <Modal show={Boolean(editingCustomer)} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Gerenciar cliente</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {feedback && (
            <Alert variant={feedback.type} onClose={() => setFeedback(null)} dismissible>
              {feedback.message}
            </Alert>
          )}
          <Form className="d-flex flex-column gap-3">
            <Form.Group controlId="customerDisplayName">
              <Form.Label>Nome do cliente</Form.Label>
              <Form.Control
                type="text"
                value={formState.displayName}
                placeholder="Adicione um nome interno para o cliente"
                onChange={(event) => handleChange("displayName", event.target.value)}
              />
              <Form.Text muted>
                Caso o cliente não tenha um nome, usaremos o número do WhatsApp nas listagens.
              </Form.Text>
            </Form.Group>
            <Form.Group controlId="customerBalance">
              <Form.Label>Saldo disponível</Form.Label>
              <Form.Control
                type="text"
                value={formState.balance}
                onChange={(event) => handleChange("balance", event.target.value)}
              />
              <Form.Text muted>
                Use vírgula para centavos, por exemplo: 10,00
              </Form.Text>
            </Form.Group>
            <Form.Group controlId="customerNotes">
              <Form.Label>Observações</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={formState.notes}
                onChange={(event) => handleChange("notes", event.target.value)}
              />
            </Form.Group>
            <Form.Check
              id="customerBlocked"
              type="switch"
              label="Bloquear acesso do cliente"
              checked={formState.isBlocked}
              onChange={(event) => handleChange("isBlocked", event.target.checked)}
            />
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeModal} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar alterações"}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default UserCustomerManager;
