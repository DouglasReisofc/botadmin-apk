"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Image, Modal, Row, Table } from "react-bootstrap";
import { useRouter } from "next/navigation";

import type { SubscriptionPlan } from "types/plans";
import type { PlanTrialSettings, PlanTrialTemplateVariable } from "types/plan-trial";
import FloatingAlert from "components/common/FloatingAlert";
import ApiRequestPlanManager from "components/admin/ApiRequestPlanManager";

interface AdminPlanManagerProps {
  plans: SubscriptionPlan[];
  trialSettings: PlanTrialSettings;
  trialVariables: PlanTrialTemplateVariable[];
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type ModalMode = "create" | "edit";

type FormState = {
  name: string;
  description: string;
  price: string;
  addonInstancePrice: string;
  addonGroupPrice: string;
  groupLimit: string;
  instanceLimit: string;
  allowFlows: boolean;
  storageQuotaGb: string;
  durationDays: string;
  isActive: boolean;
  features: Record<string, boolean>;
};

const PLAN_FEATURE_OPTIONS = [
  ["conversas", "Conversas"],
  ["grupos_botadmin", "Grupos BotAdmin"],
  ["status", "Status"],
  ["status_programado", "Status programado"],
  ["transmissao", "Transmissões"],
  ["bot_interage", "BotInterage"],
  ["antilink", "Antilink"],
  ["boas_vindas", "Boas-vindas"],
  ["download_media", "Downloads de mídia"],
  ["midia_persistente", "Mídia persistente"],
  ["multi_perfil", "Múltiplos perfis"],
  ["api", "API"],
  ["suporte_prioritario", "Suporte prioritário"],
  ["revenda", "Programa de revenda"],
] as const;

const defaultPlanFeatures = (): Record<string, boolean> =>
  Object.fromEntries(PLAN_FEATURE_OPTIONS.map(([key]) => [key, key === "api" || key === "suporte_prioritario" || key === "revenda" ? false : true]));

const buildInitialFormState = (): FormState => ({
  name: "",
  description: "",
  price: "0",
  addonInstancePrice: "0",
  addonGroupPrice: "0",
  groupLimit: "0",
  instanceLimit: "0",
  allowFlows: true,
  storageQuotaGb: "0",
  durationDays: "30",
  isActive: true,
  features: defaultPlanFeatures(),
});

const buildFormStateFromPlan = (plan: SubscriptionPlan): FormState => ({
  name: plan.name,
  description: plan.description ?? "",
  price: plan.price.toString(),
  addonInstancePrice: plan.addonInstancePrice.toString(),
  addonGroupPrice: plan.addonGroupPrice.toString(),
  groupLimit: plan.groupLimit.toString(),
  instanceLimit: plan.instanceLimit.toString(),
  allowFlows: plan.allowFlows,
  storageQuotaGb: plan.storageQuotaGb.toString(),
  durationDays: plan.durationDays.toString(),
  isActive: plan.isActive,
  features: Object.entries(plan.features ?? {}).reduce<Record<string, boolean>>(
    (result, [key, value]) => {
      result[key] = typeof value === "boolean" ? value : false;
      return result;
    },
    defaultPlanFeatures(),
  ),
});

const MAX_MODAL_STEPS = 3;

type TrialFormState = {
  enabled: boolean;
  planId: string;
  durationAmount: string;
  durationUnit: PlanTrialSettings["duration"]["unit"];
  modalTitle: string;
  modalMessage: string;
  modalSteps: string[];
  modalImageUrl: string | null;
  modalImagePreview: string | null;
  modalImageFile: File | null;
  modalImageRemoved: boolean;
  whatsappMessage: string;
  whatsappMediaUrl: string | null;
  whatsappMediaPreview: string | null;
  whatsappMediaFile: File | null;
  whatsappMediaRemoved: boolean;
};

const buildTrialFormState = (settings: PlanTrialSettings): TrialFormState => {
  const steps = Array.isArray(settings.modal.steps) ? [...settings.modal.steps] : [];
  while (steps.length < MAX_MODAL_STEPS) {
    steps.push("");
  }
  return {
    enabled: settings.enabled,
    planId: settings.planId ? String(settings.planId) : "",
    durationAmount: String(settings.duration.amount),
    durationUnit: settings.duration.unit,
    modalTitle: settings.modal.title,
    modalMessage: settings.modal.message,
    modalSteps: steps.slice(0, MAX_MODAL_STEPS),
    modalImageUrl: settings.modal.imageUrl ?? null,
    modalImagePreview: null,
    modalImageFile: null,
    modalImageRemoved: false,
    whatsappMessage: settings.whatsapp.message,
    whatsappMediaUrl: settings.whatsapp.mediaUrl ?? null,
    whatsappMediaPreview: null,
    whatsappMediaFile: null,
    whatsappMediaRemoved: false,
  };
};

const cleanupPreviewUrl = (url: string | null) => {
  if (url) {
    URL.revokeObjectURL(url);
  }
};

type TrialSettingsCardProps = {
  plans: SubscriptionPlan[];
  initialSettings: PlanTrialSettings;
  variables: PlanTrialTemplateVariable[];
};

const TrialSettingsCard = ({ plans, initialSettings, variables }: TrialSettingsCardProps) => {
  const [formState, setFormState] = useState<TrialFormState>(() => buildTrialFormState(initialSettings));
  const [alert, setAlert] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormState((previous) => {
      cleanupPreviewUrl(previous.modalImagePreview);
      cleanupPreviewUrl(previous.whatsappMediaPreview);
      return buildTrialFormState(initialSettings);
    });
    setAlert(null);
  }, [initialSettings]);

  useEffect(
    () => () => {
      cleanupPreviewUrl(formState.modalImagePreview);
      cleanupPreviewUrl(formState.whatsappMediaPreview);
    },
    [formState.modalImagePreview, formState.whatsappMediaPreview],
  );

  const handleFieldChange = <K extends keyof TrialFormState>(field: K, value: TrialFormState[K]) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  };

  const handleStepChange = (index: number, value: string) => {
    setFormState((previous) => {
      const nextSteps = [...previous.modalSteps];
      nextSteps[index] = value;
      return { ...previous, modalSteps: nextSteps };
    });
  };

  const handleModalImageChange = (file: File | null) => {
    setFormState((previous) => {
      cleanupPreviewUrl(previous.modalImagePreview);
      return {
        ...previous,
        modalImageFile: file,
        modalImagePreview: file ? URL.createObjectURL(file) : null,
        modalImageRemoved: file ? false : previous.modalImageRemoved,
        modalImageUrl: file ? null : previous.modalImageUrl,
      };
    });
  };

  const handleWhatsappMediaChange = (file: File | null) => {
    setFormState((previous) => {
      cleanupPreviewUrl(previous.whatsappMediaPreview);
      return {
        ...previous,
        whatsappMediaFile: file,
        whatsappMediaPreview: file ? URL.createObjectURL(file) : null,
        whatsappMediaRemoved: file ? false : previous.whatsappMediaRemoved,
        whatsappMediaUrl: file ? null : previous.whatsappMediaUrl,
      };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setAlert(null);

    if (formState.enabled && !formState.planId) {
      setAlert({ type: "danger", message: "Selecione qual plano será liberado durante o teste gratuito." });
      setSaving(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("enabled", formState.enabled ? "true" : "false");
      if (formState.planId) {
        formData.append("planId", formState.planId);
      }
      formData.append("durationAmount", formState.durationAmount || "0");
      formData.append("durationUnit", formState.durationUnit);
      formData.append("modalTitle", formState.modalTitle);
      formData.append("modalMessage", formState.modalMessage);
      formState.modalSteps.forEach((step, index) => {
        formData.append(`modalStep${index + 1}`, step);
      });
      if (formState.modalImageRemoved) {
        formData.append("removeModalImage", "true");
      }
      if (formState.modalImageFile) {
        formData.append("modalImage", formState.modalImageFile);
      }
      formData.append("whatsappMessage", formState.whatsappMessage);
      if (formState.whatsappMediaRemoved) {
        formData.append("removeWhatsappMedia", "true");
      }
      if (formState.whatsappMediaFile) {
        formData.append("whatsappMedia", formState.whatsappMediaFile);
      }

      const response = await fetch("/api/admin/plans/trial", {
        method: "PUT",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.message === "string" ? data.message : "Não foi possível salvar as configurações.");
      }

      if (data.settings) {
        setFormState((previous) => {
          cleanupPreviewUrl(previous.modalImagePreview);
          cleanupPreviewUrl(previous.whatsappMediaPreview);
          return buildTrialFormState(data.settings as PlanTrialSettings);
        });
      }

      setAlert({
        type: "success",
        message: typeof data.message === "string" ? data.message : "Configurações de teste gratuito atualizadas.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível salvar as configurações.";
      setAlert({ type: "danger", message });
    } finally {
      setSaving(false);
    }
  };

  const modalPreview = formState.modalImagePreview ?? formState.modalImageUrl;
  const whatsappPreview = formState.whatsappMediaPreview ?? formState.whatsappMediaUrl;

  return (
    <Card className="mt-4">
      <Card.Header>
        <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
          <div>
            <Card.Title as="h2" className="h5 mb-1">
              Teste gratuito automático
            </Card.Title>
            <Card.Subtitle className="text-secondary">
              Ative um período de degustação para novos usuários e personalize as mensagens de boas-vindas no painel e no WhatsApp.
            </Card.Subtitle>
          </div>
        </div>
      </Card.Header>
      <Card.Body>
        {alert ? (
          <Alert variant={alert.type} onClose={() => setAlert(null)} dismissible>
            {alert.message}
          </Alert>
        ) : null}
        <Form onSubmit={handleSubmit} className="d-flex flex-column gap-4">
          <div className="d-flex flex-column gap-2">
            <Form.Check
              type="switch"
              id="trial-enabled"
              label="Ativar teste gratuito para novos cadastros"
              checked={formState.enabled}
              onChange={(event) => handleFieldChange("enabled", event.target.checked)}
              disabled={saving}
            />
            <Form.Text className="text-secondary">
              Quando ativado, todo usuário novo receberá acesso temporário ao plano selecionado e verá a mensagem personalizada logo após o cadastro.
            </Form.Text>
          </div>

          <Row className="g-3">
            <Col md={6}>
              <Form.Group controlId="trial-plan">
                <Form.Label>Plano liberado durante o teste</Form.Label>
                <Form.Select
                  value={formState.planId}
                  onChange={(event) => handleFieldChange("planId", event.target.value)}
                  disabled={saving || !formState.enabled}
                >
                  <option value="">Selecione o plano</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} · {plan.durationDays} dia(s)
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-secondary">
                  Escolha qual plano ficará disponível durante o período gratuito.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trial-duration">
                <Form.Label>Duração do teste gratuito</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control
                    type="number"
                    min={1}
                    value={formState.durationAmount}
                    onChange={(event) => handleFieldChange("durationAmount", event.target.value)}
                    disabled={saving}
                  />
                  <Form.Select
                    value={formState.durationUnit}
                    onChange={(event) =>
                      handleFieldChange(
                        "durationUnit",
                        event.target.value === "days" ? "days" : "hours",
                      )
                    }
                    disabled={saving}
                    style={{ maxWidth: 140 }}
                  >
                    <option value="hours">horas</option>
                    <option value="days">dias</option>
                  </Form.Select>
                </div>
                <Form.Text className="text-secondary">
                  Defina por quanto tempo o usuário poderá testar antes que o plano expire automaticamente.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex flex-column gap-3">
            <div>
              <h3 className="h6 mb-2">Mensagem exibida no painel</h3>
              <Form.Text className="text-secondary">
                Use marcadores como <code>{`{{durationLabel}}`}</code> e <code>{`{{primeiroNome}}`}</code> para personalizar o conteúdo. Veja a lista completa de variáveis abaixo.
              </Form.Text>
            </div>
            <Form.Group controlId="trial-modal-title">
              <Form.Label>Título do modal</Form.Label>
              <Form.Control
                value={formState.modalTitle}
                onChange={(event) => handleFieldChange("modalTitle", event.target.value)}
                disabled={saving}
                maxLength={160}
                required
              />
            </Form.Group>
            <Form.Group controlId="trial-modal-message">
              <Form.Label>Mensagem principal</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={formState.modalMessage}
                onChange={(event) => handleFieldChange("modalMessage", event.target.value)}
                disabled={saving}
                maxLength={2000}
              />
            </Form.Group>
            <Row className="g-3">
              {formState.modalSteps.map((step, index) => (
                <Col md={4} key={`modal-step-${index}`}>
                  <Form.Group controlId={`trial-modal-step-${index}`}>
                    <Form.Label>Passo {index + 1}</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={2}
                      value={step}
                      onChange={(event) => handleStepChange(index, event.target.value)}
                      disabled={saving}
                      maxLength={260}
                      placeholder={["Conecte sua instância", "Cadastre seu grupo", "Ative um comando"][index] ?? ""}
                    />
                  </Form.Group>
                </Col>
              ))}
            </Row>
            <Form.Group controlId="trial-modal-image">
              <Form.Label>Imagem opcional</Form.Label>
              <div className="d-flex flex-column flex-md-row gap-3 align-items-md-center">
                <div className="d-flex flex-column gap-2">
                  <Form.Control
                    type="file"
                    accept="image/*"
                    disabled={saving}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      handleModalImageChange(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div className="d-flex gap-2">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => {
                        setFormState((previous) => {
                          cleanupPreviewUrl(previous.modalImagePreview);
                          return {
                            ...previous,
                            modalImageFile: null,
                            modalImagePreview: null,
                            modalImageRemoved: true,
                            modalImageUrl: null,
                          };
                        });
                      }}
                      disabled={saving || (!modalPreview && !formState.modalImageFile && !formState.modalImageUrl)}
                    >
                      Remover imagem
                    </Button>
                  </div>
                </div>
                {modalPreview ? (
                  <Image
                    src={modalPreview}
                    alt="Pré-visualização"
                    rounded
                    className="border"
                    style={{ maxWidth: 220 }}
                  />
                ) : null}
              </div>
              <Form.Text className="text-secondary">
                Imagens em formato PNG ou JPG com proporção horizontal funcionam melhor.
              </Form.Text>
            </Form.Group>
          </div>

          <div className="d-flex flex-column gap-3">
            <div>
              <h3 className="h6 mb-2">Mensagem automática no WhatsApp</h3>
              <Form.Text className="text-secondary">
                Esta mensagem é enviada imediatamente após o cadastro via bot administrativo.
              </Form.Text>
            </div>
            <Form.Group controlId="trial-whatsapp-message">
              <Form.Label>Mensagem</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={formState.whatsappMessage}
                onChange={(event) => handleFieldChange("whatsappMessage", event.target.value)}
                disabled={saving}
                maxLength={2000}
              />
            </Form.Group>
            <Form.Group controlId="trial-whatsapp-media">
              <Form.Label>Mídia opcional</Form.Label>
              <div className="d-flex flex-column flex-md-row gap-3 align-items-md-center">
                <div className="d-flex flex-column gap-2">
                  <Form.Control
                    type="file"
                    accept="image/*"
                    disabled={saving}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      handleWhatsappMediaChange(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div className="d-flex gap-2">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => {
                        setFormState((previous) => {
                          cleanupPreviewUrl(previous.whatsappMediaPreview);
                          return {
                            ...previous,
                            whatsappMediaFile: null,
                            whatsappMediaPreview: null,
                            whatsappMediaRemoved: true,
                            whatsappMediaUrl: null,
                          };
                        });
                      }}
                      disabled={saving || (!whatsappPreview && !formState.whatsappMediaFile && !formState.whatsappMediaUrl)}
                    >
                      Remover mídia
                    </Button>
                  </div>
                </div>
                {whatsappPreview ? (
                  <Image
                    src={whatsappPreview}
                    alt="Pré-visualização WhatsApp"
                    rounded
                    className="border"
                    style={{ maxWidth: 220 }}
                  />
                ) : null}
              </div>
              <Form.Text className="text-secondary">
                Utilize uma imagem chamativa para reforçar os próximos passos do teste gratuito.
              </Form.Text>
            </Form.Group>
          </div>

          <div>
            <h3 className="h6 mb-2">Variáveis disponíveis</h3>
            <Row className="g-2">
              {variables.map((variable) => (
                <Col md={4} key={variable.token}>
                  <div className="border rounded p-3 h-100 bg-body-secondary-subtle">
                    <div className="fw-semibold small">{variable.token}</div>
                    <div className="text-secondary small">{variable.description}</div>
                  </div>
                </Col>
              ))}
            </Row>
          </div>

          <div className="d-flex justify-content-end">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Salvando..." : "Salvar configurações"}
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
};

const AdminPlanManager = ({ plans, trialSettings, trialVariables }: AdminPlanManagerProps) => {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [showModal, setShowModal] = useState(false);
  const [formState, setFormState] = useState<FormState>(() => buildInitialFormState());
  const [currentPlan, setCurrentPlan] = useState<SubscriptionPlan | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingPlanId, setPendingPlanId] = useState<number | null>(null);
  const [showApiRequestModal, setShowApiRequestModal] = useState(false);

  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }),
    [],
  );

  const openCreateModal = () => {
    setModalMode("create");
    setFormState(buildInitialFormState());
    setCurrentPlan(null);
    setShowModal(true);
  };

  const openEditModal = (plan: SubscriptionPlan) => {
    setModalMode("edit");
    setFormState(buildFormStateFromPlan(plan));
    setCurrentPlan(plan);
    setShowModal(true);
  };

  const closeModal = () => {
    if (isSubmitting) {
      return;
    }

    setShowModal(false);
    setCurrentPlan(null);
    setFormState(buildInitialFormState());
  };

  const handleChange = <Field extends keyof FormState>(field: Field, value: FormState[Field]) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    const payload = {
      name: formState.name,
      description: formState.description || null,
      price: Number.parseFloat(formState.price.replace(/,/g, ".")),
      addonInstancePrice: 0,
      addonGroupPrice: 0,
      groupLimit: 0,
      instanceLimit: 0,
      allowFlows: true,
      storageQuotaGb: 0,
      durationDays: Number.parseInt(formState.durationDays, 10),
      isActive: formState.isActive,
      features: formState.features,
    };

    const isEditing = modalMode === "edit" && currentPlan;

    const endpoint = isEditing ? `/api/admin/plans/${currentPlan!.id}` : "/api/admin/plans";
    const method = isEditing ? "PUT" : "POST";

    const response = await fetch(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível salvar o plano.",
      });
      setIsSubmitting(false);
      return;
    }

    setFeedback({
      type: "success",
      message: data.message ?? (isEditing ? "Plano atualizado com sucesso." : "Plano criado com sucesso."),
    });
    setIsSubmitting(false);
    setShowModal(false);
    setCurrentPlan(null);
    router.refresh();
  };

  const togglePlanStatus = async (plan: SubscriptionPlan) => {
    setPendingPlanId(plan.id);
    setFeedback(null);

    const response = await fetch(`/api/admin/plans/${plan.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: plan.name,
        description: plan.description,
        price: plan.price,
        addonInstancePrice: plan.addonInstancePrice,
        addonGroupPrice: plan.addonGroupPrice,
        groupLimit: plan.groupLimit,
        instanceLimit: plan.instanceLimit,
        allowFlows: plan.allowFlows,
        storageQuotaGb: plan.storageQuotaGb,
        durationDays: plan.durationDays,
        isActive: !plan.isActive,
        features: plan.features,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível atualizar o status do plano.",
      });
      setPendingPlanId(null);
      return;
    }

    setFeedback({ type: "success", message: data.message ?? "Plano atualizado." });
    setPendingPlanId(null);
    router.refresh();
  };

  const removePlan = async (plan: SubscriptionPlan) => {
    const confirmation = window.confirm(
      `Excluir o plano "${plan.name}" removerá essa opção para novas assinaturas. Deseja continuar?`,
    );

    if (!confirmation) {
      return;
    }

    setPendingPlanId(plan.id);
    setFeedback(null);

    const response = await fetch(`/api/admin/plans/${plan.id}`, {
      method: "DELETE",
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFeedback({
        type: "danger",
        message: data.message ?? "Não foi possível remover o plano.",
      });
      setPendingPlanId(null);
      return;
    }

    setFeedback({ type: "success", message: data.message ?? "Plano removido." });
    setPendingPlanId(null);
    router.refresh();
  };

  return (
    <section>
      <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

      <Card>
        <Card.Header className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3">
          <div>
            <Card.Title as="h2" className="h5 mb-1">
              Planos de assinatura
            </Card.Title>
            <Card.Subtitle className="text-secondary">
              Crie planos por perfil. Grupos ficam ilimitados; cobrança por grupo permanece apenas como dado legado.
            </Card.Subtitle>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Button variant="outline-primary" onClick={() => setShowApiRequestModal(true)}>
              APIKey
            </Button>
            <Button variant="primary" onClick={openCreateModal}>
              Criar novo plano
            </Button>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          <div className="table-responsive">
            <Table hover className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Plano</th>
                  <th>Preço</th>
                  <th>Grupos</th>
                  <th>Perfis</th>
                  <th>Fluxos</th>
                  <th>Dias</th>
                  <th>Status</th>
                  <th className="text-end">Ações</th>
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-secondary py-4">
                      Nenhum plano cadastrado até o momento.
                    </td>
                  </tr>
                ) : (
                  plans.map((plan) => (
                    <tr key={plan.id}>
                      <td>
                        <div className="d-flex flex-column">
                          <strong>{plan.name}</strong>
                          {plan.description && (
                            <span className="text-secondary small">{plan.description}</span>
                          )}
                        </div>
                      </td>
                      <td>{currencyFormatter.format(plan.price)}</td>
                      <td>Ilimitado</td>
                      <td>Ilimitado</td>
                      <td>
                        <Badge bg="success">
                          Completo
                        </Badge>
                      </td>
                      <td>{plan.durationDays}</td>
                      <td>
                        <Badge bg={plan.isActive ? "success" : "secondary"}>
                          {plan.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="text-end">
                        <div className="d-flex justify-content-end gap-2">
                          <Button
                            size="sm"
                            variant={plan.isActive ? "outline-secondary" : "outline-success"}
                            onClick={() => togglePlanStatus(plan)}
                            disabled={pendingPlanId === plan.id}
                          >
                            {pendingPlanId === plan.id
                              ? "Atualizando..."
                              : plan.isActive
                                ? "Desativar"
                                : "Ativar"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => openEditModal(plan)}
                            disabled={pendingPlanId === plan.id}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => removePlan(plan)}
                            disabled={pendingPlanId === plan.id}
                          >
                            {pendingPlanId === plan.id ? "Removendo..." : "Excluir"}
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
      </Card>

      <TrialSettingsCard plans={plans} initialSettings={trialSettings} variables={trialVariables} />

      <Modal
        show={showApiRequestModal}
        onHide={() => setShowApiRequestModal(false)}
        size="lg"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Pacotes da API</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ApiRequestPlanManager />
        </Modal.Body>
      </Modal>

      <Modal show={showModal} onHide={closeModal} centered>
        <Form onSubmit={handleSubmit}>
          <Modal.Header closeButton={!isSubmitting}>
            <Modal.Title>
              {modalMode === "edit" ? "Editar plano" : "Criar plano"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3" controlId="planName">
              <Form.Label>Nome do plano</Form.Label>
              <Form.Control
                value={formState.name}
                onChange={(event) => handleChange("name", event.target.value)}
                placeholder="Plano Starter"
                required
                maxLength={120}
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="planDescription">
              <Form.Label>Descrição (opcional)</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={formState.description}
                onChange={(event) => handleChange("description", event.target.value)}
                maxLength={500}
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="planPrice">
              <Form.Label>Preço (R$)</Form.Label>
            <Form.Control
              type="number"
              step="0.01"
              min="0"
              value={formState.price}
              onChange={(event) => handleChange("price", event.target.value)}
              required
            />
          </Form.Group>
	          <Form.Group className="mb-3" controlId="planAddonInstancePrice">
	            <Form.Label>Perfil/grupo adicional</Form.Label>
	            <Form.Control
	              type="number"
	              step="0.01"
	              min="0"
	              value="0"
	              disabled
	              required
	            />
	            <Form.Text className="text-secondary">
	              Desativado para novas compras. Qualquer assinatura ativa libera tudo; storage continua em cobrança própria.
	            </Form.Text>
	          </Form.Group>

          <Row className="g-3 mb-3">
            <Col md={6}>
	              <Form.Group controlId="planInstanceLimit">
	                <Form.Label>Perfis/WhatsApp incluídos</Form.Label>
	                <Form.Control
	                  type="number"
	                  min="0"
	                  value="0"
	                  disabled
	                  required
	                />
	                <Form.Text className="text-secondary">
	                  Qualquer assinatura ativa libera perfis ilimitados.
	                </Form.Text>
	              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="planGroupLimit">
                <Form.Label>Grupos incluídos</Form.Label>
	                <Form.Control
	                  type="number"
	                  min="0"
	                  value="0"
	                  disabled
	                  required
	                />
	                <Form.Text className="text-secondary">
	                  Qualquer assinatura ativa libera grupos ilimitados.
	                </Form.Text>
	              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-3" controlId="planAllowFlows">
	            <Form.Check
	              type="switch"
	              label="Liberar todas as funcionalidades neste plano"
	              checked={Object.values(formState.features).every(Boolean)}
	              onChange={(event) =>
	                setFormState((current) => ({
	                  ...current,
	                  features: Object.fromEntries(
	                    PLAN_FEATURE_OPTIONS.map(([key]) => [
	                      key,
	                      event.currentTarget.checked,
	                    ]),
	                  ),
	                }))
              }
	            />
	            <Form.Text className="text-secondary">
	              Use os recursos abaixo para definir exatamente o que cada plano libera. O servidor aplica essas permissões.
	            </Form.Text>
          </Form.Group>

            <Form.Group className="mb-3" controlId="planDuration">
              <Form.Label>Duração do plano (dias)</Form.Label>
              <Form.Control
                type="number"
                min="1"
                value={formState.durationDays}
                onChange={(event) => handleChange("durationDays", event.target.value)}
                required
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="planFeatures">
              <Form.Label>Recursos liberados</Form.Label>
              <div className="border rounded p-3">
                <Row className="g-2">
                  {PLAN_FEATURE_OPTIONS.map(([key, label]) => (
                    <Col xs={12} md={6} key={key}>
                      <Form.Check
                        type="switch"
                        label={label}
                        checked={Boolean(formState.features[key])}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            features: { ...current.features, [key]: event.currentTarget.checked },
                          }))
                        }
                      />
                    </Col>
                  ))}
                </Row>
                <Form.Text className="text-secondary">
                  O servidor valida esses recursos em cada operação. Alterações valem para novas verificações sem precisar atualizar o aplicativo.
                </Form.Text>
              </div>
            </Form.Group>

            <Form.Group controlId="planStatus">
              <Form.Check
                type="switch"
                label="Plano ativo"
                checked={formState.isActive}
                onChange={(event) => handleChange("isActive", event.target.checked)}
              />
            </Form.Group>
          </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={closeModal} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button variant="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Salvando..." : modalMode === "edit" ? "Salvar alterações" : "Criar plano"}
        </Button>
      </Modal.Footer>
    </Form>
  </Modal>    </section>
  );
};

export default AdminPlanManager;







