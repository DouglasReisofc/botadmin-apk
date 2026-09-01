"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Col, Form, InputGroup, Modal, Row, Spinner, Table } from "react-bootstrap";

import { mapBotGroupToAdminSummary } from "lib/admin-groups-map";
import { buildGroupLicenseStatusSummary } from "lib/group-license-display";
import { formatDateTime } from "lib/format";
import type { AdminGroupDetail, AdminGroupSummary } from "types/admin-groups";
import FloatingAlert from "components/common/FloatingAlert";

type Feedback = { type: "success" | "danger" | "info" | "warning"; message: string } | null;

type ModalFeedback = { type: "success" | "info" | "danger"; message: string } | null;

type ManageFormState = {
  name: string;
  description: string;
  inviteLink: string;
  adminsOnly: boolean;
  locked: boolean;
};

type ManageModalState = {
  visible: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  feedback: ModalFeedback;
  groupId: number | null;
  summary: AdminGroupSummary | null;
  detail: AdminGroupDetail | null;
  form: ManageFormState;
};

type DeleteModalState = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  group: AdminGroupSummary | null;
};

type TransferUser = {
  id: number;
  name: string;
  email: string | null;
};

type TransferInstance = {
  id: number;
  name: string;
  phone: string;
  sessionStatus: string;
};

type TransferState = {
  search: string;
  searching: boolean;
  results: TransferUser[];
  selectedUser: TransferUser | null;
  instances: TransferInstance[];
  fetchingInstances: boolean;
  selectedInstanceId: string;
  transferring: boolean;
  error: string | null;
  feedback: ModalFeedback;
};

const createEmptyForm = (): ManageFormState => ({
  name: "",
  description: "",
  inviteLink: "",
  adminsOnly: false,
  locked: false,
});

const createInitialTransferState = (): TransferState => ({
  search: "",
  searching: false,
  results: [],
  selectedUser: null,
  instances: [],
  fetchingInstances: false,
  selectedInstanceId: "",
  transferring: false,
  error: null,
  feedback: null,
});

const buildFormFromDetail = (detail: AdminGroupDetail): ManageFormState => ({
  name: detail.group.name,
  description: detail.group.description ?? "",
  inviteLink: detail.group.inviteLink ?? "",
  adminsOnly: Boolean(detail.group.metadata?.adminsOnly),
  locked: Boolean(detail.group.metadata?.locked),
});

const toSummary = (
  detail: AdminGroupDetail,
  previous?: AdminGroupSummary | null,
): AdminGroupSummary => {
  const summary = mapBotGroupToAdminSummary(detail.group, detail.user);
  if (!previous) {
    return summary;
  }
  return {
    ...summary,
    instanceId: summary.instanceId ?? previous.instanceId,
    instanceName: summary.instanceName ?? previous.instanceName,
    instancePhone: summary.instancePhone ?? previous.instancePhone,
    owner: summary.owner ?? previous.owner,
    imageUrl: summary.imageUrl ?? previous.imageUrl,
  };
};

const renderLicenseSummary = (group: AdminGroupSummary) => {
  const license = buildGroupLicenseStatusSummary({
    licenseExpiresAt: group.licenseExpiresAt,
    licensePlanName: group.licensePlanName,
    licenseSource: group.licenseSource,
  });

  return (
    <div className="d-flex flex-column gap-1 align-items-start">
      <Badge bg={license.statusVariant} text={license.statusVariant === "warning" ? "dark" : undefined}>
        {license.statusLabel}
      </Badge>
      <small className="text-secondary">
        {license.expiresAt ? formatDateTime(license.expiresAt) : "Sem validade registrada"}
      </small>
      {license.planName ? (
        <small className="text-secondary">{license.planName}</small>
      ) : null}
      <small className="text-secondary">{license.sourceLabel}</small>
    </div>
  );
};

interface AdminGroupManagerProps {
  initialQuery: string;
  initialGroups: AdminGroupSummary[];
  initialPage: number;
  initialPageSize: number;
  initialTotal: number;
  initialHasMore: boolean;
}

const AdminGroupManager = ({
  initialQuery,
  initialGroups,
  initialPage,
  initialPageSize,
  initialTotal,
  initialHasMore,
}: AdminGroupManagerProps) => {
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery.trim());
  const [groups, setGroups] = useState<AdminGroupSummary[]>(initialGroups);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize || 20);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const fetchSequenceRef = useRef(0);

  const [manageModal, setManageModal] = useState<ManageModalState>({
    visible: false,
    loading: false,
    saving: false,
    error: null,
    feedback: null,
    groupId: null,
    summary: null,
    detail: null,
    form: createEmptyForm(),
  });

  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    visible: false,
    loading: false,
    error: null,
    group: null,
  });
  const [transferState, setTransferState] = useState<TransferState>(createInitialTransferState());

  const resultsInfo = useMemo(() => {
    if (loading && groups.length === 0) {
      return "Buscando grupos…";
    }

    if (total === 0) {
      return activeQuery
        ? `Nenhum resultado encontrado para “${activeQuery}”.`
        : "Nenhum grupo vinculado por enquanto.";
    }

    if (activeQuery) {
      return `Mostrando ${groups.length} de ${total} grupo(s) para “${activeQuery}”.`;
    }

    return `Mostrando ${groups.length} de ${total} grupo(s) cadastrados.`;
  }, [activeQuery, groups.length, loading, total]);

  const fetchGroups = async ({
    query: rawQuery,
    page: requestedPage,
    append = false,
    silent = false,
  }: {
    query: string;
    page: number;
    append?: boolean;
    silent?: boolean;
  }) => {
    const trimmedQuery = rawQuery.trim();
    const params = new URLSearchParams();
    if (trimmedQuery) {
      params.set("query", trimmedQuery);
    }
    params.set("page", String(requestedPage));
    params.set("pageSize", String(pageSize || 20));

    const fetchId = ++fetchSequenceRef.current;

    if (append) {
      setLoadingMore(true);
    } else if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(`/api/admin/groups?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível carregar os grupos.",
        );
      }

      if (fetchId !== fetchSequenceRef.current) {
        return;
      }

      const list: AdminGroupSummary[] = Array.isArray(data.groups) ? data.groups : [];
      const nextPage = Number.isFinite(data.page) ? Number(data.page) : requestedPage;
      const nextPageSize = Number.isFinite(data.pageSize)
        ? Number(data.pageSize)
        : pageSize;
      const nextTotal = Number.isFinite(data.total) ? Number(data.total) : total;
      const nextHasMore = Boolean(data.hasMore);

      setGroups((prev) => (append ? [...prev, ...list] : list));
      setPage(nextPage);
      setPageSize(nextPageSize);
      setTotal(nextTotal);
      setHasMore(nextHasMore);
      setActiveQuery(trimmedQuery);
    } catch (fetchError) {
      if (fetchId !== fetchSequenceRef.current) {
        return;
      }
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Não foi possível carregar os grupos.",
      );
      throw fetchError;
    } finally {
      if (fetchId !== fetchSequenceRef.current) {
        return;
      }
      if (append) {
        setLoadingMore(false);
      } else if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleSearchSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await fetchGroups({ query, page: 1 });
    } catch {
      /* errors já tratados no estado */
    }
  };

  const handleResetSearch = async () => {
    setQuery("");
    try {
      await fetchGroups({ query: "", page: 1 });
    } catch {
      /* ignore */
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) {
      return;
    }
    try {
      await fetchGroups({ query: activeQuery, page: page + 1, append: true, silent: true });
    } catch {
      /* ignore */
    }
  };

  const closeManageModal = () => {
    setManageModal({
      visible: false,
      loading: false,
      saving: false,
      error: null,
      feedback: null,
      groupId: null,
      summary: null,
      detail: null,
      form: createEmptyForm(),
    });
    setTransferState(createInitialTransferState());
  };

  const openManageModal = (summary: AdminGroupSummary) => {
    setTransferState(createInitialTransferState());
    setManageModal({
      visible: true,
      loading: true,
      saving: false,
      error: null,
      feedback: null,
      groupId: summary.id,
      summary,
      detail: null,
      form: {
        name: summary.name,
        description: summary.description ?? "",
        inviteLink: summary.inviteLink ?? "",
        adminsOnly: false,
        locked: false,
      },
    });

    void (async () => {
      try {
        const response = await fetch(`/api/admin/groups/${summary.id}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof data.message === "string"
              ? data.message
              : "Não foi possível carregar os detalhes do grupo.",
          );
        }

        const detail: AdminGroupDetail = {
          group: data.group,
          user: data.user,
        };

        setManageModal((current) => ({
          ...current,
          loading: false,
          detail,
          summary: data.summary ?? current.summary ?? toSummary(detail, current.summary),
          form: buildFormFromDetail(detail),
        }));

        if (data.summary) {
          setGroups((prev) =>
            prev.map((item) => (item.id === data.summary.id ? data.summary : item)),
          );
        }
      } catch (fetchError) {
        setManageModal((current) => ({
          ...current,
          loading: false,
          error:
            fetchError instanceof Error
              ? fetchError.message
              : "Não foi possível carregar os detalhes do grupo.",
        }));
      }
    })();
  };

  const handleTransferSearch = async () => {
    const term = transferState.search.trim();
    if (term.length < 3) {
      setTransferState((curr) => ({
        ...curr,
        results: [],
        error: "Digite pelo menos 3 caracteres para buscar.",
        feedback: null,
      }));
      return;
    }

    setTransferState((curr) => ({
      ...curr,
      searching: true,
      error: null,
      feedback: null,
      results: [],
    }));

    try {
      const response = await fetch(
        `/api/admin/users?q=${encodeURIComponent(term)}&limit=8`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível buscar usuários.",
        );
      }

      const list: TransferUser[] = Array.isArray(data.users)
        ? data.users
            .map((item: any) => ({
              id: Number(item.id),
              name:
                typeof item.name === "string" && item.name.trim()
                  ? item.name.trim()
                  : "Usuário sem nome",
              email: typeof item.email === "string" ? item.email : null,
            }))
            .filter((user) => Number.isFinite(user.id) && user.id > 0)
        : [];

      setTransferState((curr) => ({
        ...curr,
        searching: false,
        results: list,
        error: null,
        feedback:
          list.length === 0
            ? {
                type: "info",
                message: "Nenhum usuário encontrado para a busca informada.",
              }
            : null,
      }));
    } catch (searchError) {
      setTransferState((curr) => ({
        ...curr,
        searching: false,
        results: [],
        error:
          searchError instanceof Error
            ? searchError.message
            : "Não foi possível buscar usuários.",
      }));
    }
  };

  const loadInstancesForUser = async (userId: number) => {
    setTransferState((curr) => ({
      ...curr,
      fetchingInstances: true,
      instances: [],
      selectedInstanceId: "",
      error: null,
      feedback: null,
    }));

    try {
      const response = await fetch(
        `/api/admin/bot-instances?userId=${userId}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível carregar as instâncias do usuário.",
        );
      }

      const list = Array.isArray(data.instances) ? data.instances : [];
      const instances: TransferInstance[] = list
        .filter((entry: any) => {
          const owner = Number(entry.userId ?? entry.user_id);
          return Number.isFinite(owner) && owner === userId;
        })
        .map((entry: any) => ({
          id: Number(entry.id),
          name:
            typeof entry.name === "string" && entry.name.trim()
              ? entry.name.trim()
              : "Instância sem nome",
          phone: typeof entry.phone === "string" ? entry.phone : "",
          sessionStatus:
            typeof entry.sessionStatus === "string"
              ? entry.sessionStatus
              : typeof entry.session_status === "string"
                ? entry.session_status
                : "desconectado",
        }))
        .filter((instance) => Number.isFinite(instance.id) && instance.id > 0);

      setTransferState((curr) => ({
        ...curr,
        fetchingInstances: false,
        instances,
        selectedInstanceId: instances.length > 0 ? String(instances[0].id) : "",
        feedback:
          instances.length === 0
            ? {
                type: "info",
                message:
                  "O usuário selecionado não possui instâncias cadastradas. Cadastre uma instância antes de concluir a transferência.",
              }
            : curr.feedback && curr.feedback.type === "success"
              ? curr.feedback
              : null,
        error: null,
      }));
    } catch (instanceError) {
      setTransferState((curr) => ({
        ...curr,
        fetchingInstances: false,
        instances: [],
        selectedInstanceId: "",
        error:
          instanceError instanceof Error
            ? instanceError.message
            : "Não foi possível carregar as instâncias do usuário.",
      }));
    }
  };

  const handleSelectTransferUser = (user: TransferUser) => {
    setTransferState({
      ...createInitialTransferState(),
      search: user.name,
      selectedUser: user,
    });
    void loadInstancesForUser(user.id);
  };

  const handleTransferReset = () => {
    setTransferState(createInitialTransferState());
  };

  const handleTransferSubmit = async () => {
    if (!manageModal.groupId) {
      setTransferState((curr) => ({
        ...curr,
        error: "Selecione um grupo antes de transferir.",
        feedback: null,
      }));
      return;
    }

    if (!transferState.selectedUser) {
      setTransferState((curr) => ({
        ...curr,
        error: "Escolha o usuário que receberá o grupo.",
        feedback: null,
      }));
      return;
    }

    setTransferState((curr) => ({
      ...curr,
      transferring: true,
      error: null,
      feedback: null,
    }));

    try {
      const payload: Record<string, unknown> = {
        transferToUserId: transferState.selectedUser.id,
      };
      if (transferState.selectedInstanceId) {
        const parsedInstance = Number.parseInt(transferState.selectedInstanceId, 10);
        if (Number.isFinite(parsedInstance) && parsedInstance > 0) {
          payload.targetInstanceId = parsedInstance;
        }
      }

      const response = await fetch(`/api/admin/groups/${manageModal.groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível transferir o grupo.",
        );
      }

      const detail: AdminGroupDetail = {
        group: data.group,
        user: data.user,
      };
      const summary = data.summary ?? toSummary(detail, manageModal.summary);

      setManageModal((current) => ({
        ...current,
        detail,
        summary,
        form: buildFormFromDetail(detail),
        feedback: {
          type: "success",
          message:
            typeof data.message === "string"
              ? data.message
              : "Grupo transferido com sucesso.",
        },
      }));

      setGroups((prev) => prev.map((item) => (item.id === summary.id ? summary : item)));

      setTransferState((curr) => ({
        ...curr,
        transferring: false,
        feedback: {
          type: "success",
          message:
            typeof data.message === "string"
              ? data.message
              : "Grupo transferido com sucesso.",
        },
        error: null,
        search: summary.userName,
        selectedUser: {
          id: summary.userId,
          name: summary.userName,
          email: summary.userEmail,
        },
        results: [],
      }));

      setFeedback({
        type: "success",
        message:
          typeof data.message === "string"
            ? data.message
            : "Grupo transferido com sucesso.",
      });
    } catch (transferError) {
      setTransferState((curr) => ({
        ...curr,
        transferring: false,
        error:
          transferError instanceof Error
            ? transferError.message
            : "Não foi possível transferir o grupo.",
      }));
    }
  };

  const updateManageForm = (updates: Partial<ManageFormState>) => {
    setManageModal((current) => ({
      ...current,
      form: { ...current.form, ...updates },
      feedback: null,
    }));
  };

  const handleSaveManage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manageModal.groupId || !manageModal.detail) {
      return;
    }

    const formName = manageModal.form.name.trim();
    if (!formName) {
      setManageModal((current) => ({
        ...current,
        error: "Informe um nome para o grupo.",
      }));
      return;
    }

    const payload: Record<string, unknown> = {};
    const original = manageModal.detail.group;

    if (formName !== original.name) {
      payload.name = formName;
    }

    if (manageModal.form.description !== (original.description ?? "")) {
      const trimmedDescription = manageModal.form.description.trim();
      payload.description = trimmedDescription.length > 0 ? manageModal.form.description : null;
    }

    const trimmedInvite = manageModal.form.inviteLink.trim();
    if (trimmedInvite.length > 0 && trimmedInvite !== (original.inviteLink ?? "")) {
      payload.inviteLink = trimmedInvite;
    }

    if (manageModal.form.adminsOnly !== Boolean(original.metadata?.adminsOnly)) {
      payload.adminsOnly = manageModal.form.adminsOnly;
    }

    if (manageModal.form.locked !== Boolean(original.metadata?.locked)) {
      payload.locked = manageModal.form.locked;
    }

    if (Object.keys(payload).length === 0) {
      setManageModal((current) => ({
        ...current,
        feedback: {
          type: "info",
          message: "Nenhuma alteração detectada para salvar.",
        },
      }));
      return;
    }

    setManageModal((current) => ({
      ...current,
      saving: true,
      error: null,
      feedback: null,
    }));

    try {
      const response = await fetch(`/api/admin/groups/${manageModal.groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar o grupo.",
        );
      }

      const detail: AdminGroupDetail = {
        group: data.group,
        user: data.user,
      };
      const summary = data.summary ?? toSummary(detail, manageModal.summary);

      setManageModal((current) => ({
        ...current,
        saving: false,
        detail,
        summary,
        form: buildFormFromDetail(detail),
        feedback: {
          type: "success",
          message:
            typeof data.message === "string"
              ? data.message
              : "Grupo atualizado com sucesso.",
        },
      }));

      setGroups((prev) => prev.map((item) => (item.id === summary.id ? summary : item)));
      setFeedback({
        type: "success",
        message:
          typeof data.message === "string"
            ? data.message
            : "Grupo atualizado com sucesso.",
      });
    } catch (saveError) {
      setManageModal((current) => ({
        ...current,
        saving: false,
        error:
          saveError instanceof Error
            ? saveError.message
            : "Não foi possível atualizar o grupo.",
      }));
    }
  };

  const openDeleteModal = (group: AdminGroupSummary) => {
    setDeleteModal({
      visible: true,
      loading: false,
      error: null,
      group,
    });
  };

  const closeDeleteModal = () => {
    setDeleteModal({
      visible: false,
      loading: false,
      error: null,
      group: null,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteModal.group) {
      return;
    }

    const removingLastItem = groups.length === 1;
    const currentPage = page;

    setDeleteModal((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    try {
      const response = await fetch(`/api/admin/groups/${deleteModal.group.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível remover o grupo.",
        );
      }

      const removedId = deleteModal.group.id;
      setGroups((prev) => prev.filter((item) => item.id !== removedId));
      setTotal((prev) => Math.max(prev - 1, 0));

      if (manageModal.groupId === removedId) {
        closeManageModal();
      }

      setFeedback({
        type: "success",
        message:
          typeof data.message === "string"
            ? data.message
            : "Grupo removido com sucesso.",
      });

      closeDeleteModal();

      if (removingLastItem && currentPage > 1) {
        try {
          await fetchGroups({ query: activeQuery, page: currentPage - 1 });
        } catch {
          /* erros já tratados pelo estado de fetch */
        }
      }
    } catch (deleteError) {
      setDeleteModal((current) => ({
        ...current,
        loading: false,
        error:
          deleteError instanceof Error
            ? deleteError.message
            : "Não foi possível remover o grupo.",
      }));
    }
  };

  return (
    <>
      <Card className="shadow-sm">
        <Card.Body>
          <Form onSubmit={handleSearchSubmit} className="mb-4">
            <Row className="g-2 align-items-center">
              <Col md={8}>
                <Form.Label htmlFor="admin-group-search" className="visually-hidden">
                  Buscar grupos
                </Form.Label>
                <InputGroup>
                  <Form.Control
                    id="admin-group-search"
                    placeholder="Buscar por nome do grupo, e-mail do responsável ou ID remoto"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    disabled={loading && !loadingMore}
                  />
                  {query ? (
                    <Button
                      type="button"
                      variant="outline-secondary"
                      onClick={handleResetSearch}
                      disabled={loading && !loadingMore}
                    >
                      Limpar
                    </Button>
                  ) : null}
                  <Button type="submit" variant="primary" disabled={loading && !loadingMore}>
                    {loading && !loadingMore ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Buscando…
                      </>
                    ) : (
                      "Buscar"
                    )}
                  </Button>
                </InputGroup>
              </Col>
              <Col
                md={4}
                className="d-flex justify-content-md-end align-items-center mt-2 mt-md-0"
              >
                <small className="text-secondary">{resultsInfo}</small>
              </Col>
            </Row>
          </Form>

          <FloatingAlert
            feedback={feedback ?? (error ? { type: "danger", message: error } : null)}
            onClose={() => {
              if (feedback) {
                setFeedback(null);
              } else if (error) {
                setError(null);
              }
            }}
          />

          <div className="table-responsive">
            <Table hover responsive className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Responsável</th>
                  <th>Instância</th>
                  <th>Licença / validade</th>
                  <th>Criação</th>
                  <th className="text-end">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading && groups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-5">
                      <Spinner animation="border" role="status" className="me-2" />
                      Carregando grupos…
                    </td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-4 text-secondary">
                      Nenhum grupo encontrado.
                    </td>
                  </tr>
                ) : (
                  groups.map((group) => (
                    <tr key={group.id}>
                      <td>
                        <div className="fw-semibold">{group.name}</div>
                        <div className="d-flex flex-wrap gap-2 mt-2">
                          <Badge bg={group.status === "active" ? "success" : "secondary"}>
                            {group.status === "active" ? "Ativo" : "Inativo"}
                          </Badge>
                          {group.awaitingApproval ? (
                            <Badge bg="warning" text="dark">
                              Aguardando aprovação
                            </Badge>
                          ) : null}
                          {group.awaitingEntry ? (
                            <Badge bg="info" text="dark">
                              Aguardando entrada
                            </Badge>
                          ) : null}
                          {group.slot ? (
                            <Badge bg="light" text="dark">
                              Slot {group.slot}
                            </Badge>
                          ) : null}
                        </div>
                        <small className="text-secondary d-block mt-2">
                          ID remoto: <code>{group.remoteId}</code>
                        </small>
                        {group.inviteLink ? (
                          <small className="text-secondary d-block">
                            Link: {group.inviteLink}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <div className="fw-semibold">{group.userName}</div>
                        <small className="text-secondary d-block">
                          {group.userEmail ?? "Sem e-mail cadastrado"}
                        </small>
                      </td>
                      <td>
                        {group.instanceName ? (
                          <>
                            <div className="fw-semibold">{group.instanceName}</div>
                            <small className="text-secondary d-block">
                              {group.instancePhone || "-"}
                            </small>
                          </>
                        ) : (
                          <span className="text-secondary">-</span>
                        )}
                      </td>
                      <td style={{ minWidth: 180 }}>{renderLicenseSummary(group)}</td>
                      <td>
                        <div>{formatDateTime(group.createdAt)}</div>
                        <small className="text-secondary d-block">
                          Atualizado {formatDateTime(group.updatedAt)}
                        </small>
                      </td>
                      <td className="text-end">
                        <div className="d-flex gap-2 justify-content-end flex-wrap">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => openManageModal(group)}
                          >
                            Gerenciar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => openDeleteModal(group)}
                          >
                            Remover
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </Card.Body>
        {hasMore ? (
          <Card.Footer className="bg-transparent border-top-0">
            <div className="d-flex justify-content-center">
              <Button
                variant="outline-primary"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Carregando…
                  </>
                ) : (
                  "Carregar mais"
                )}
              </Button>
            </div>
          </Card.Footer>
        ) : null}
      </Card>

      <Modal
        show={manageModal.visible}
        onHide={closeManageModal}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>Gerenciar grupo</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <FloatingAlert
            feedback={
              manageModal.feedback
                ? {
                    type: manageModal.feedback.type,
                    message: manageModal.feedback.message,
                  }
                : manageModal.error
                ? { type: "danger", message: manageModal.error }
                : null
            }
            onClose={() =>
              setManageModal((current) => ({
                ...current,
                error: null,
                feedback: null,
              }))
            }
          />
          {manageModal.loading ? (
            <div className="d-flex align-items-center justify-content-center py-5">
              <Spinner animation="border" role="status" className="me-2" />
              Carregando dados do grupo…
            </div>
          ) : manageModal.detail ? (
            <Form id="admin-group-manage-form" onSubmit={handleSaveManage}>
              <Row className="g-4">
                <Col lg={8}>
                  <Form.Group className="mb-3" controlId="admin-group-name">
                    <Form.Label>Nome do grupo</Form.Label>
                    <Form.Control
                      type="text"
                      value={manageModal.form.name}
                      onChange={(event) => updateManageForm({ name: event.target.value })}
                      disabled={manageModal.saving}
                      required
                    />
                  </Form.Group>
                  <Form.Group className="mb-3" controlId="admin-group-description">
                    <Form.Label>Descrição</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={manageModal.form.description}
                      onChange={(event) =>
                        updateManageForm({ description: event.target.value })
                      }
                      disabled={manageModal.saving}
                      placeholder="Opcional: mensagem exibida na descrição do grupo."
                    />
                  </Form.Group>
                  <Form.Group className="mb-4" controlId="admin-group-invite">
                    <Form.Label>Link de convite</Form.Label>
                    <Form.Control
                      type="text"
                      value={manageModal.form.inviteLink}
                      onChange={(event) =>
                        updateManageForm({ inviteLink: event.target.value })
                      }
                      disabled={manageModal.saving}
                      placeholder="https://chat.whatsapp.com/..."
                    />
                    <Form.Text className="text-secondary">
                      Informe um link válido para sincronizar novamente as informações do grupo.
                    </Form.Text>
                  </Form.Group>

                  <div className="border rounded p-3 d-flex flex-column gap-3">
                    <Form.Check
                      type="switch"
                      id="admin-group-admins-only"
                      label="Apenas administradores podem enviar mensagens"
                      checked={manageModal.form.adminsOnly}
                      onChange={(event) =>
                        updateManageForm({ adminsOnly: event.currentTarget.checked })
                      }
                      disabled={manageModal.saving}
                    />
                    <Form.Check
                      type="switch"
                      id="admin-group-locked"
                      label="Bloquear edição por participantes (somente admins convidam)"
                      checked={manageModal.form.locked}
                      onChange={(event) =>
                        updateManageForm({ locked: event.currentTarget.checked })
                      }
                      disabled={manageModal.saving}
                    />
                  </div>
                  <div className="border rounded p-3 d-flex flex-column gap-3 mt-4">
                    <div>
                      <h6 className="text-secondary text-uppercase small mb-3">
                        Transferir grupo para outro usuário
                      </h6>
                      <FloatingAlert
                        feedback={
                          transferState.feedback
                            ? {
                                type: transferState.feedback.type,
                                message: transferState.feedback.message,
                              }
                            : transferState.error
                            ? { type: "danger", message: transferState.error }
                            : null
                        }
                        onClose={() =>
                          setTransferState((curr) => ({
                            ...curr,
                            feedback: null,
                            error: null,
                          }))
                        }
                      />
                      <Form.Label htmlFor="admin-group-transfer-search">
                        Buscar usuário destino
                      </Form.Label>
                      <InputGroup>
                        <Form.Control
                          id="admin-group-transfer-search"
                          placeholder="Digite o nome ou e-mail do usuário"
                          value={transferState.search}
                          onChange={(event) =>
                            setTransferState((curr) => ({ ...curr, search: event.target.value }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleTransferSearch();
                            }
                          }}
                          disabled={transferState.transferring}
                        />
                        <Button
                          type="button"
                          variant="outline-primary"
                          onClick={() => void handleTransferSearch()}
                          disabled={transferState.transferring || transferState.searching}
                        >
                          {transferState.searching ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Buscando…
                            </>
                          ) : (
                            "Buscar"
                          )}
                        </Button>
                      </InputGroup>
                      <Form.Text className="text-secondary">
                        Procure pelo usuário que ficará responsável por este grupo.
                      </Form.Text>
                    </div>
                    {transferState.results.length > 0 ? (
                      <div className="d-flex flex-wrap gap-2">
                        {transferState.results.map((user) => (
                          <Button
                            key={user.id}
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => handleSelectTransferUser(user)}
                            disabled={transferState.transferring}
                          >
                            {user.name}
                            {user.email ? (
                              <span className="text-secondary ms-1 small">({user.email})</span>
                            ) : null}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    {transferState.fetchingInstances ? (
                      <div className="d-flex align-items-center gap-2 text-secondary small">
                        <Spinner animation="border" size="sm" />
                        Carregando instâncias do usuário…
                      </div>
                    ) : null}
                    {transferState.selectedUser ? (
                      <div className="d-flex flex-column gap-3">
                        <div className="small">
                          <span className="text-secondary">Usuário selecionado:</span>{" "}
                          <span className="fw-semibold">{transferState.selectedUser.name}</span>
                          {transferState.selectedUser.email ? (
                            <span className="text-secondary">
                              {" "}
                              — {transferState.selectedUser.email}
                            </span>
                          ) : null}
                        </div>
                        <Form.Group controlId="admin-group-transfer-instance" className="mb-0">
                          <Form.Label>Instância de destino</Form.Label>
                          <Form.Select
                            value={transferState.selectedInstanceId}
                            onChange={(event) =>
                              setTransferState((curr) => ({
                                ...curr,
                                selectedInstanceId: event.target.value,
                              }))
                            }
                            disabled={
                              transferState.fetchingInstances ||
                              transferState.instances.length === 0 ||
                              transferState.transferring
                            }
                          >
                            {transferState.instances.length === 0 ? (
                              <option value="">Nenhuma instância disponível</option>
                            ) : (
                              transferState.instances.map((instance) => (
                                <option key={instance.id} value={instance.id}>
                                  {instance.name} • {instance.phone} ({instance.sessionStatus})
                                </option>
                              ))
                            )}
                          </Form.Select>
                          <Form.Text className="text-secondary">
                            Escolha a instância que continuará administrando o grupo após a
                            transferência.
                          </Form.Text>
                        </Form.Group>
                      </div>
                    ) : null}
                    <div className="d-flex flex-wrap gap-2">
                      <Button
                        variant="outline-primary"
                        onClick={() => void handleTransferSubmit()}
                        disabled={
                          transferState.transferring ||
                          transferState.fetchingInstances ||
                          !transferState.selectedUser ||
                          transferState.instances.length === 0
                        }
                      >
                        {transferState.transferring ? (
                          <>
                            <Spinner animation="border" size="sm" className="me-2" />
                            Transferindo…
                          </>
                        ) : (
                          "Transferir grupo"
                        )}
                      </Button>
                      <Button
                        variant="outline-secondary"
                        onClick={handleTransferReset}
                        disabled={transferState.transferring}
                      >
                        Limpar seleção
                      </Button>
                    </div>
                  </div>
                </Col>
                <Col lg={4}>
                  <div className="border rounded p-3 h-100">
                    <h6 className="text-secondary text-uppercase small mb-3">Informações atuais</h6>
                    <dl className="mb-0 small">
                      <dt className="text-secondary">Responsável</dt>
                      <dd className="mb-2">
                        <div className="fw-semibold">{manageModal.detail.user.name}</div>
                        <div className="text-secondary">
                          {manageModal.detail.user.email ?? "Sem e-mail"}
                        </div>
                      </dd>
                      <dt className="text-secondary">Instância</dt>
                      <dd className="mb-2">
                        <div className="fw-semibold">
                          {manageModal.detail.group.instanceName || "-"}
                        </div>
                        <div className="text-secondary">
                          {manageModal.detail.group.instancePhone || "-"}
                        </div>
                      </dd>
                      <dt className="text-secondary">ID remoto</dt>
                      <dd className="mb-2">
                        <code>{manageModal.detail.group.remoteId}</code>
                      </dd>
                      <dt className="text-secondary">Status</dt>
                      <dd className="mb-2">
                        <Badge
                          bg={
                            manageModal.detail.group.status === "active"
                              ? "success"
                              : "secondary"
                          }
                        >
                          {manageModal.detail.group.status === "active"
                            ? "Ativo"
                            : "Inativo"}
                        </Badge>
                      </dd>
                      <dt className="text-secondary">Licença do grupo</dt>
                      <dd className="mb-2">
                        {renderLicenseSummary(
                          mapBotGroupToAdminSummary(
                            manageModal.detail.group,
                            manageModal.detail.user,
                          ),
                        )}
                      </dd>
                      <dt className="text-secondary">Participantes</dt>
                      <dd className="mb-2">
                        {manageModal.detail.group.participants.length}
                      </dd>
                      <dt className="text-secondary">Criado em</dt>
                      <dd className="mb-0">
                        {formatDateTime(manageModal.detail.group.createdAt)}
                        <div className="text-secondary">
                          Atualizado {formatDateTime(manageModal.detail.group.updatedAt)}
                        </div>
                      </dd>
                    </dl>
                  </div>
                </Col>
              </Row>
            </Form>
          ) : (
            <p className="text-secondary mb-0">
              Selecione um grupo para visualizar os detalhes completos.
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeManageModal} disabled={manageModal.saving}>
            Fechar
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="admin-group-manage-form"
            disabled={manageModal.saving || manageModal.loading || !manageModal.detail}
          >
            {manageModal.saving ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Salvando…
              </>
            ) : (
              "Salvar alterações"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={deleteModal.visible} onHide={closeDeleteModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Remover grupo</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <FloatingAlert
            feedback={deleteModal.error ? { type: "danger", message: deleteModal.error } : null}
            onClose={() => setDeleteModal((curr) => ({ ...curr, error: null }))}
          />
          <p className="mb-2">
            Tem certeza de que deseja remover o grupo{" "}
            <strong>{deleteModal.group?.name}</strong> do usuário{" "}
            <strong>{deleteModal.group?.userName}</strong>?
          </p>
          <p className="mb-0 text-secondary">
            Essa ação é definitiva e não poderá ser desfeita.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeDeleteModal} disabled={deleteModal.loading}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirmDelete}
            disabled={deleteModal.loading}
          >
            {deleteModal.loading ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Removendo…
              </>
            ) : (
              "Remover"
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AdminGroupManager;
