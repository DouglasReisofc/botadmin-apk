"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Alert, Badge, Button, Form, Modal, Table } from "react-bootstrap";

type ApiRequestPlan = {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  requestAmount: number;
  isActive: boolean;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

type Feedback = { type: "success" | "danger"; message: string } | null;
type FormMode = "create" | "edit";

type FormState = {
  name: string;
  description: string;
  price: string;
  requestAmount: string;
  orderIndex: string;
  isActive: boolean;
};

const buildInitialFormState = (): FormState => ({
  name: "",
  description: "",
  price: "",
  requestAmount: "1000",
  orderIndex: "",
  isActive: true,
});

const buildFormStateFromPlan = (plan: ApiRequestPlan): FormState => ({
  name: plan.name,
  description: plan.description ?? "",
  price: (plan.priceCents / 100).toString(),
  requestAmount: plan.requestAmount.toString(),
  orderIndex: plan.orderIndex.toString(),
  isActive: plan.isActive,
});

const formatCurrency = (value: number): string =>
  (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatInteger = (value: number): string =>
  value.toLocaleString("pt-BR");

const ApiRequestPlanManager = () => {
  const [plans, setPlans] = useState<ApiRequestPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [currentPlan, setCurrentPlan] = useState<ApiRequestPlan | null>(null);
  const [formState, setFormState] = useState<FormState>(() => buildInitialFormState());
  const [isSaving, setIsSaving] = useState(false);
  const [pendingToggleId, setPendingToggleId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const sortedPlans = useMemo(
    () => plans.slice().sort((a, b) => {
      if (a.orderIndex !== b.orderIndex) {
        return a.orderIndex - b.orderIndex;
      }
      if (a.priceCents !== b.priceCents) {
        return a.priceCents - b.priceCents;
      }
      return a.requestAmount - b.requestAmount;
    }),
    [plans],
  );

  const loadPlans = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/admin/apirequest/plans");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          (data && typeof data.message === "string" && data.message) ||
          "Não foi possível carregar os pacotes.";
        throw new Error(message);
      }
      setPlans(Array.isArray(data.plans) ? data.plans : []);
    } catch (error) {
      console.error("Failed to load API request plans", error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao carregar pacotes.",
      });
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const openCreateModal = () => {
    setFormMode("create");
    setFormState(buildInitialFormState());
    setCurrentPlan(null);
    setShowFormModal(true);
  };

  const openEditModal = (plan: ApiRequestPlan) => {
    setFormMode("edit");
    setFormState(buildFormStateFromPlan(plan));
    setCurrentPlan(plan);
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    if (isSaving) {
      return;
    }
    setShowFormModal(false);
    setCurrentPlan(null);
    setFormState(buildInitialFormState());
  };

  const handleFormChange = <Field extends keyof FormState>(field: Field, value: FormState[Field]) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    const payload: Record<string, unknown> = {
      name: formState.name,
      description: formState.description || null,
      price: formState.price,
      requestAmount: formState.requestAmount,
      isActive: formState.isActive,
    };

    if (formState.orderIndex.trim()) {
      payload.orderIndex = formState.orderIndex;
    }

    const isEditing = formMode === "edit" && currentPlan;
    const endpoint = isEditing ? `/api/admin/apirequest/plans/${currentPlan!.id}` : "/api/admin/apirequest/plans";
    const method = isEditing ? "PUT" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          (data && typeof data.message === "string" && data.message) ||
          "Não foi possível salvar o pacote.";
        throw new Error(message);
      }

      setFeedback({
        type: "success",
        message:
          (data && typeof data.message === "string" && data.message) ||
          (isEditing ? "Pacote atualizado com sucesso." : "Pacote criado com sucesso."),
      });
      setShowFormModal(false);
      setCurrentPlan(null);
      setFormState(buildInitialFormState());
      await loadPlans();
    } catch (error) {
      console.error("Failed to save API request plan", error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao salvar o pacote.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (plan: ApiRequestPlan) => {
    if (pendingToggleId !== null) {
      return;
    }
    setPendingToggleId(plan.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/apirequest/plans/${plan.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: plan.name,
          description: plan.description,
          price: plan.priceCents / 100,
          requestAmount: plan.requestAmount,
          orderIndex: plan.orderIndex,
          isActive: !plan.isActive,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          (data && typeof data.message === "string" && data.message) ||
          "Não foi possível atualizar o status do pacote.";
        throw new Error(message);
      }
      setFeedback({
        type: "success",
        message: (data && typeof data.message === "string" && data.message) || "Pacote atualizado.",
      });
      await loadPlans();
    } catch (error) {
      console.error("Failed to toggle API request plan status", error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao atualizar o pacote.",
      });
    } finally {
      setPendingToggleId(null);
    }
  };

  const handleDelete = async (plan: ApiRequestPlan) => {
    if (pendingDeleteId !== null) {
      return;
    }
    const confirmation = window.confirm(
      `Remover o pacote "${plan.name}"? Usuários não poderão comprá-lo novamente.`,
    );
    if (!confirmation) {
      return;
    }

    setPendingDeleteId(plan.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/apirequest/plans/${plan.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          (data && typeof data.message === "string" && data.message) ||
          "Não foi possível remover o pacote.";
        throw new Error(message);
      }
      setFeedback({
        type: "success",
        message: (data && typeof data.message === "string" && data.message) || "Pacote removido.",
      });
      await loadPlans();
    } catch (error) {
      console.error("Failed to delete API request plan", error);
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao remover o pacote.",
      });
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleRefresh = () => {
    void loadPlans();
  };

  return (
    <div>
      {feedback ? (
        <Alert
          variant={feedback.type === "success" ? "success" : "danger"}
          onClose={() => setFeedback(null)}
          dismissible
          className="mb-3"
        >
          {feedback.message}
        </Alert>
      ) : null}

      <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3 mb-3">
        <div>
          <h3 className="h5 mb-1">Pacotes de requisições</h3>
          <p className="text-secondary mb-0 small">
            Defina os valores, quantidades e ordem dos pacotes disponíveis para os clientes comprarem requisições extras.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-secondary" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            {isRefreshing ? "Atualizando..." : "Atualizar"}
          </Button>
          <Button variant="primary" size="sm" onClick={openCreateModal}>
            Novo pacote
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-4 text-secondary">Carregando pacotes...</div>
      ) : !sortedPlans.length ? (
        <div className="border rounded p-4 text-center text-secondary">
          Nenhum pacote cadastrado. Crie o primeiro para habilitar a venda de requisições.
        </div>
      ) : (
        <div className="table-responsive">
          <Table bordered hover size="sm" className="align-middle">
            <thead>
              <tr>
                <th>Pacote</th>
                <th>Valor</th>
                <th>Requisições</th>
                <th>Ordem</th>
                <th>Status</th>
                <th style={{ width: 160 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <div className="fw-semibold">{plan.name}</div>
                    {plan.description ? (
                      <div className="text-secondary small">{plan.description}</div>
                    ) : null}
                  </td>
                  <td>{formatCurrency(plan.priceCents)}</td>
                  <td>{formatInteger(plan.requestAmount)}</td>
                  <td>{plan.orderIndex}</td>
                  <td>
                    <Badge bg={plan.isActive ? "success" : "secondary"}>
                      {plan.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </td>
                  <td>
                    <div className="d-flex flex-wrap gap-2">
                      <Button variant="outline-primary" size="sm" onClick={() => openEditModal(plan)}>
                        Editar
                      </Button>
                      <Button
                        variant={plan.isActive ? "outline-warning" : "outline-success"}
                        size="sm"
                        onClick={() => handleToggleStatus(plan)}
                        disabled={pendingToggleId === plan.id}
                      >
                        {plan.isActive ? "Desativar" : "Ativar"}
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => handleDelete(plan)}
                        disabled={pendingDeleteId === plan.id}
                      >
                        Remover
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <Modal show={showFormModal} onHide={closeFormModal} centered>
        <Modal.Header closeButton={!isSaving}>
          <Modal.Title>
            {formMode === "edit" ? "Editar pacote de requisições" : "Novo pacote de requisições"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            <Form.Group controlId="apiRequestPlanName">
              <Form.Label>Nome</Form.Label>
              <Form.Control
                type="text"
                value={formState.name}
                onChange={(event) => handleFormChange("name", event.target.value)}
                placeholder="Ex.: Pacote 5k"
                required
              />
            </Form.Group>

            <Form.Group controlId="apiRequestPlanDescription">
              <Form.Label>Descrição</Form.Label>
              <Form.Control
                as="textarea"
                value={formState.description}
                onChange={(event) => handleFormChange("description", event.target.value)}
                rows={2}
                placeholder="Texto exibido para ajudar o cliente a escolher (opcional)."
              />
            </Form.Group>

            <Form.Group controlId="apiRequestPlanPrice">
              <Form.Label>Valor (R$)</Form.Label>
              <Form.Control
                type="number"
                min="0"
                step="0.01"
                value={formState.price}
                onChange={(event) => handleFormChange("price", event.target.value)}
                placeholder="Ex.: 29.90"
                required
              />
              <Form.Text className="text-secondary">
                Informe o valor total que será cobrado pelo pacote.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="apiRequestPlanRequests">
              <Form.Label>Quantidade de requisições</Form.Label>
              <Form.Control
                type="number"
                min="1"
                step="1"
                value={formState.requestAmount}
                onChange={(event) => handleFormChange("requestAmount", event.target.value)}
                placeholder="Ex.: 5000"
                required
              />
            </Form.Group>

            <Form.Group controlId="apiRequestPlanOrder">
              <Form.Label>Ordem de exibição</Form.Label>
              <Form.Control
                type="number"
                min="0"
                step="1"
                value={formState.orderIndex}
                onChange={(event) => handleFormChange("orderIndex", event.target.value)}
                placeholder="0, 1, 2..."
              />
              <Form.Text className="text-secondary">
                Pacotes com ordem menor aparecem primeiro. Deixe vazio para usar a ordem padrão.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="apiRequestPlanStatus">
              <Form.Check
                type="switch"
                label="Pacote ativo"
                checked={formState.isActive}
                onChange={(event) => handleFormChange("isActive", event.target.checked)}
              />
            </Form.Group>

            <div className="d-flex justify-content-end gap-2">
              <Button variant="outline-secondary" onClick={closeFormModal} disabled={isSaving}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving ? "Salvando..." : formMode === "edit" ? "Salvar alterações" : "Criar pacote"}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default ApiRequestPlanManager;
