"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import { Badge, Button, Card, Form, InputGroup, ListGroup, Modal, Spinner, Table } from "react-bootstrap";
import { useRouter } from "next/navigation";

import type { BotInstanceAdminSummary, BotServer } from "types/bot-instances";
import FloatingAlert from "components/common/FloatingAlert";

interface BotServerManagerProps {
  servers: BotServer[];
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type ModalMode = "create" | "edit";

type FormState = {
  name: string;
  baseUrl: string;
  apiType: string;
  globalApiKey: string;
  sessionLimit: string;
  isActive: boolean;
};

const defaultFormState: FormState = {
  name: "",
  baseUrl: "",
  apiType: "wuzapi",
  globalApiKey: "",
  sessionLimit: "0",
  isActive: true,
};

const buildFormStateFromServer = (server: BotServer): FormState => ({
  name: server.name,
  baseUrl: server.baseUrl,
  apiType: server.apiType,
  globalApiKey: server.globalApiKey ?? "",
  sessionLimit: server.sessionLimit.toString(),
  isActive: server.isActive,
});

const BotServerManager = ({ servers }: BotServerManagerProps) => {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [showModal, setShowModal] = useState(false);
  const [formState, setFormState] = useState<FormState>(defaultFormState);
  const [currentServer, setCurrentServer] = useState<BotServer | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingServerId, setPendingServerId] = useState<number | null>(null);
  const [selectedInstances, setSelectedInstances] = useState<BotInstanceAdminSummary[]>([]);
  const [instanceSearchTerm, setInstanceSearchTerm] = useState("");
  const [instanceResults, setInstanceResults] = useState<BotInstanceAdminSummary[]>([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState(false);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  const sortedServers = useMemo(
    () =>
      [...servers].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [servers],
  );

  const selectedInstanceIdSet = useMemo(
    () => new Set(selectedInstances.map((instance) => instance.id)),
    [selectedInstances],
  );

  const resetInstanceSelection = useCallback(() => {
    setSelectedInstances([]);
    setInstanceResults([]);
    setInstanceSearchTerm("");
    setInstanceError(null);
    setIsLoadingInstances(false);
  }, []);

  const loadInstancesForServer = useCallback(async (serverId: number) => {
    setIsLoadingInstances(true);
    setInstanceError(null);
    try {
      const response = await fetch(
        `/api/admin/bot-servers/instances?serverId=${serverId}&limit=200`,
        { method: "GET", headers: { "Cache-Control": "no-store" } },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.message === "string" ? data.message : "Falha ao carregar instâncias.");
      }
      const items = Array.isArray(data.instances) ? (data.instances as BotInstanceAdminSummary[]) : [];
      setSelectedInstances(items);
    } catch (error) {
      console.error("Failed to load server instances", error);
      setInstanceError("Não foi possível carregar as instâncias vinculadas.");
      setSelectedInstances([]);
    } finally {
      setIsLoadingInstances(false);
    }
  }, []);

  const openCreateModal = () => {
    setModalMode("create");
    setFormState(defaultFormState);
    setCurrentServer(null);
    resetInstanceSelection();
    setShowModal(true);
  };

  const openEditModal = (server: BotServer) => {
    setModalMode("edit");
    setFormState(buildFormStateFromServer(server));
    setCurrentServer(server);
    resetInstanceSelection();
    loadInstancesForServer(server.id);
    setShowModal(true);
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setShowModal(false);
    setCurrentServer(null);
    setFormState(defaultFormState);
    resetInstanceSelection();
  };

  const handleChange = <Field extends keyof FormState>(field: Field, value: FormState[Field]) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  };

  const handleSearchInstances = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      if (event) {
        event.preventDefault();
      }
      setIsLoadingInstances(true);
      setInstanceError(null);
      try {
        const params = new URLSearchParams();
        if (instanceSearchTerm.trim()) {
          params.set("q", instanceSearchTerm.trim());
        }
        params.set("limit", "50");
        const response = await fetch(`/api/admin/bot-servers/instances?${params.toString()}`, {
          method: "GET",
          headers: { "Cache-Control": "no-store" },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data.message === "string" ? data.message : "Não foi possível buscar instâncias.");
        }
        const items = Array.isArray(data.instances) ? (data.instances as BotInstanceAdminSummary[]) : [];
        setInstanceResults(items);
      } catch (error) {
        console.error("Failed to search instances", error);
        setInstanceError("Não foi possível buscar instâncias. Tente novamente.");
        setInstanceResults([]);
      } finally {
        setIsLoadingInstances(false);
      }
    },
    [instanceSearchTerm],
  );

  const handleAddInstance = useCallback(
    (instance: BotInstanceAdminSummary) => {
      setSelectedInstances((previous) => {
        if (previous.some((item) => item.id === instance.id)) {
          return previous;
        }
        return [...previous, instance];
      });
    },
    [],
  );

  const handleRemoveInstance = useCallback((instanceId: number) => {
    setSelectedInstances((previous) => previous.filter((item) => item.id !== instanceId));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    setInstanceError(null);

    const payload = {
      name: formState.name,
      baseUrl: formState.baseUrl,
      apiType: formState.apiType,
      globalApiKey: formState.globalApiKey,
      sessionLimit: Number.parseInt(formState.sessionLimit, 10),
      isActive: formState.isActive,
    };

    const isEditing = modalMode === "edit" && currentServer;
    const endpoint = isEditing ? `/api/admin/bot-servers/${currentServer!.id}` : "/api/admin/bot-servers";
    const method = isEditing ? "PUT" : "POST";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível salvar o servidor.",
      });
      setIsSubmitting(false);
      return;
    }

    const serverId = (data.server?.id ?? currentServer?.id) as number | undefined;

    if (serverId && selectedInstances.length > 0) {
      const assignResponse = await fetch(`/api/admin/bot-servers/${serverId}/instances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceIds: selectedInstances.map((instance) => instance.id) }),
      });

      const assignData = await assignResponse.json().catch(() => ({}));
      if (!assignResponse.ok) {
        setInstanceError(
          assignData.message ?? "Servidor salvo, mas não foi possível vincular as instâncias selecionadas.",
        );
        setIsSubmitting(false);
        return;
      }
    }

    setFeedback({
      type: "success",
      message: data.message ?? (isEditing ? "Servidor atualizado com sucesso." : "Servidor cadastrado com sucesso."),
    });

    setIsSubmitting(false);
    setShowModal(false);
    setCurrentServer(null);
    resetInstanceSelection();
    router.refresh();
  };

  const handleDelete = async (server: BotServer) => {
    const confirmation = window.confirm(
      `Deseja realmente remover o servidor "${server.name}"? Instâncias associadas não poderão ser criadas novamente.`,
    );
    if (!confirmation) return;

    setPendingServerId(server.id);
    setFeedback(null);

    const response = await fetch(`/api/admin/bot-servers/${server.id}`, {
      method: "DELETE",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível remover o servidor.",
      });
      setPendingServerId(null);
      return;
    }

    setFeedback({ type: "success", message: data.message ?? "Servidor removido." });
    setPendingServerId(null);
    router.refresh();
  };

  return (
    <section className="d-flex flex-column gap-4">
      <Card>
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <Card.Title className="mb-0">Servidores de instância</Card.Title>
              <Card.Subtitle className="text-secondary small">
                Registre servidores Wuzapi ou compatíveis para disponibilizar novas instâncias aos usuários.
              </Card.Subtitle>
            </div>
            <Button variant="primary" onClick={openCreateModal}>
              Novo servidor
            </Button>
          </div>

          <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

          <div className="table-responsive">
            <Table hover responsive>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Base URL</th>
                  <th>Tipo</th>
                  <th>Limite de sessões</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {sortedServers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-secondary py-4">
                      Nenhum servidor cadastrado ainda.
                    </td>
                  </tr>
                ) : (
                  sortedServers.map((server) => (
                    <tr key={server.id}>
                      <td>{server.name}</td>
                      <td>
                        <span className="text-break">{server.baseUrl}</span>
                      </td>
                      <td className="text-capitalize">{server.apiType}</td>
                      <td>{server.sessionLimit === 0 ? "Ilimitado" : server.sessionLimit}</td>
                      <td>
                        <Badge bg={server.isActive ? "success" : "secondary"}>
                          {server.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="d-flex gap-2">
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openEditModal(server)}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-danger"
                          onClick={() => handleDelete(server)}
                          disabled={pendingServerId === server.id}
                        >
                          {pendingServerId === server.id ? "Removendo..." : "Remover"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>

      <Modal show={showModal} onHide={closeModal} centered>
        <Form onSubmit={handleSubmit}>
          <Modal.Header closeButton>
            <Modal.Title>
              {modalMode === "edit" ? "Editar servidor" : "Novo servidor"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="d-flex flex-column gap-3">
            <Form.Group controlId="serverName">
              <Form.Label>Nome</Form.Label>
              <Form.Control
                type="text"
                value={formState.name}
                onChange={(event) => handleChange("name", event.target.value)}
                required
              />
            </Form.Group>

            <Form.Group controlId="serverBaseUrl">
              <Form.Label>Base URL</Form.Label>
              <Form.Control
                type="url"
                value={formState.baseUrl}
                onChange={(event) => handleChange("baseUrl", event.target.value)}
                placeholder="https://example.com"
                required
              />
            </Form.Group>

            <Form.Group controlId="serverApiType">
              <Form.Label>Tipo de API</Form.Label>
              <Form.Select
                value={formState.apiType}
                onChange={(event) => handleChange("apiType", event.target.value)}
              >
                <option value="wuzapi">Wuzapi / WPPConnect</option>
                <option value="other">Outro compatível</option>
              </Form.Select>
            </Form.Group>

            <Form.Group controlId="serverGlobalApiKey">
              <Form.Label>Chave administrativa</Form.Label>
              <Form.Control
                type="text"
                value={formState.globalApiKey}
                onChange={(event) => handleChange("globalApiKey", event.target.value)}
                required
              />
              <Form.Text className="text-secondary">
                Token de administrador utilizado para criar e remover usuários remotamente.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="serverSessionLimit">
              <Form.Label>Limite de sessões</Form.Label>
              <Form.Control
                type="number"
                min="0"
                value={formState.sessionLimit}
                onChange={(event) => handleChange("sessionLimit", event.target.value)}
                required
              />
              <Form.Text className="text-secondary">
                Use 0 para permitir instâncias ilimitadas.
              </Form.Text>
            </Form.Group>

          <Form.Group controlId="serverStatus">
            <Form.Check
              type="switch"
              label="Servidor ativo"
              checked={formState.isActive}
              onChange={(event) => handleChange("isActive", event.target.checked)}
            />
          </Form.Group>

          <hr className="my-2" />

          <div className="d-flex flex-column gap-3">
            <div>
              <h6 className="mb-1">Vincular instâncias existentes</h6>
              <p className="text-secondary small mb-0">
                Selecione instâncias já migradas para apontar este servidor como destino. Elas continuarão
                funcionando até que você conclua a migração para o novo servidor.
              </p>
            </div>

            <InputGroup>
              <Form.Control
                type="search"
                placeholder="Buscar por nome, e-mail ou número do WhatsApp"
                value={instanceSearchTerm}
                onChange={(event) => setInstanceSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSearchInstances();
                  }
                }}
                disabled={isSubmitting}
              />
              <Button variant="outline-primary" onClick={() => handleSearchInstances()} disabled={isSubmitting}>
                Buscar
              </Button>
            </InputGroup>
            <FloatingAlert
              feedback={instanceError ? { type: "danger", message: instanceError } : null}
              onClose={() => setInstanceError(null)}
            />

            <div className="d-flex flex-column gap-2">
              <h6 className="mb-1">Instâncias selecionadas</h6>
              {selectedInstances.length === 0 ? (
                <p className="text-secondary small mb-0">Nenhuma instância selecionada até o momento.</p>
              ) : (
                <ListGroup className="border">
                  {selectedInstances.map((instance) => (
                    <ListGroup.Item
                      key={instance.id}
                      className="d-flex flex-column flex-lg-row gap-2 gap-lg-3 align-items-lg-center justify-content-lg-between"
                    >
                      <div>
                        <div className="fw-semibold">
                          {instance.userName} · {instance.name}
                        </div>
                        <div className="text-secondary small">
                          WhatsApp: {instance.phone} • Servidor atual: {instance.serverName}
                        </div>
                      </div>
                      <div className="d-flex gap-2">
                        <Button
                          size="sm"
                          variant="outline-danger"
                          onClick={() => handleRemoveInstance(instance.id)}
                          disabled={isSubmitting}
                        >
                          Remover da lista
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
              <Form.Text className="text-secondary">
                Remover da lista não desvincula a instância do servidor anterior automaticamente. Para realocar,
                atribua-a a outro servidor.
              </Form.Text>
            </div>

            <div className="d-flex flex-column gap-2">
              <h6 className="mb-1">Resultados da busca</h6>
              {isLoadingInstances ? (
                <div className="text-secondary d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" />
                  <span>Carregando instâncias...</span>
                </div>
              ) : instanceResults.length === 0 ? (
                <p className="text-secondary small mb-0">
                  {instanceSearchTerm.trim()
                    ? "Nenhuma instância encontrada com os critérios informados."
                    : "Informe um termo de busca para localizar instâncias."}
                </p>
              ) : (
                <ListGroup className="border">
                  {instanceResults.map((instance) => {
                    const isSelected = selectedInstanceIdSet.has(instance.id);
                    return (
                      <ListGroup.Item
                        key={`search-${instance.id}`}
                        className="d-flex flex-column flex-lg-row gap-2 gap-lg-3 align-items-lg-center justify-content-lg-between"
                      >
                        <div>
                          <div className="fw-semibold">
                            {instance.userName} · {instance.name}
                          </div>
                          <div className="text-secondary small">
                            WhatsApp: {instance.phone} • Servidor atual: {instance.serverName}
                          </div>
                        </div>
                        <div className="d-flex gap-2">
                          <Button
                            size="sm"
                            variant={isSelected ? "outline-success" : "outline-primary"}
                            onClick={() => handleAddInstance(instance)}
                            disabled={isSelected || isSubmitting}
                          >
                            {isSelected ? "Adicionada" : "Adicionar"}
                          </Button>
                        </div>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}
            </div>
          </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={closeModal} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </section>
  );
};

export default BotServerManager;
